import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  FUSION_TORCH_SPECIFIC_ENERGY_J_PER_KG,
  NAVIGATION_MICROSECONDS_PER_SECOND,
  NAVIGATION_SENSOR_IDS,
  NAVIGATION_SNAPSHOT_VERSION,
  RigidBodyNavigation,
  STANDARD_GRAVITY_M_PER_S2,
  THRUSTER_IDS,
  validateNavigationSnapshot,
} from "../../lib/sim/navigation.ts";

function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function quaternionNorm(quaternion) {
  return Math.hypot(
    quaternion.w,
    quaternion.x,
    quaternion.y,
    quaternion.z,
  );
}

function vectorMagnitude(value) {
  return Math.hypot(value.x, value.y, value.z);
}

test("baseline exposes a large SI rigid body, fixed causal thrusters, and scalar sensors", () => {
  const navigation = new RigidBodyNavigation({ seed: "baseline" });
  const body = navigation.getBodyState();
  const snapshot = navigation.snapshot();

  assert.equal(snapshot.snapshotVersion, NAVIGATION_SNAPSHOT_VERSION);
  assert.equal(body.dryMassKg, 280_000_000);
  assert.equal(body.propellantMassKg, 36_000_000);
  assert.equal(navigation.getSummary().totalMassKg, 316_000_000);
  assert.deepEqual(
    navigation.listThrusters().map((thruster) => thruster.id),
    THRUSTER_IDS,
  );
  assert.deepEqual(
    navigation.listSensors().map((sensor) => sensor.id),
    NAVIGATION_SENSOR_IDS,
  );
  assert.ok(
    navigation
      .listThrusters()
      .every(
        (thruster) =>
          Math.abs(vectorMagnitude(thruster.forceDirectionBody) - 1) <
            1e-12 &&
          thruster.maximumThrustN > 0 &&
          thruster.specificImpulseS > 0 &&
          thruster.lastThrustN === 0,
      ),
  );
  assert.ok(
    Object.values(navigation.getCurrentInertiaDiagonal()).every(
      (value) => value > 0,
    ),
  );
  assertClose(
    quaternionNorm(body.orientationBodyToInertial),
    1,
    1e-14,
    "baseline unit quaternion",
  );
  assert.equal(
    navigation.getSensorReading("sensor:position:x"),
    null,
    "the initial sample is still behind its physical delay",
  );
});

test("jump rebasing starts a new sensor epoch without inventing impulse", () => {
  const navigation = new RigidBodyNavigation({
    seed: "jump-frame-rebase",
    initialCondition: {
      positionM: { x: 12_000, y: -3_000, z: 400 },
      velocityMPerS: { x: 18, y: -2, z: 0.5 },
      angularVelocityBodyRadPerS: {
        x: 2e-7,
        y: -1e-7,
        z: 3e-7,
      },
    },
  });
  navigation.step(3);
  const before = navigation.snapshot();
  assert.ok(
    before.sensors.some(
      (sensor) =>
        sensor.latest?.frameEpoch === 0 ||
        sensor.pending.some(
          (reading) => reading.frameEpoch === 0,
        ),
    ),
  );

  const summary = navigation.rebaseLocalFrameAfterJump(1.25);
  const after = navigation.snapshot();
  assert.equal(summary.frameEpoch, 1);
  assert.equal(summary.anchorCompletedDistanceLightYears, 1.25);
  assert.deepEqual(after.body.positionM, { x: 0, y: 0, z: 0 });
  assert.deepEqual(
    after.body.velocityMPerS,
    before.body.velocityMPerS,
  );
  assert.deepEqual(
    after.body.orientationBodyToInertial,
    before.body.orientationBodyToInertial,
  );
  assert.deepEqual(
    after.body.angularVelocityBodyRadPerS,
    before.body.angularVelocityBodyRadPerS,
  );
  assert.equal(
    after.body.propellantMassKg,
    before.body.propellantMassKg,
  );
  assert.ok(
    after.sensors.every(
      (sensor) =>
        sensor.latest === null &&
        sensor.pending.every(
          (reading) => reading.frameEpoch === 1,
        ),
    ),
    "old-epoch observations must not survive the frame boundary",
  );
  assertClose(
    navigation.getMomentumBalance().linearClosureErrorKgMPerS,
    0,
    1e-5,
    "rebased linear momentum ledger",
  );
  assertClose(
    navigation.getMomentumBalance().angularClosureErrorKgM2PerS,
    0,
    1e-3,
    "rebased angular momentum ledger",
  );
  assertClose(
    navigation.getEnergyBalance().closureErrorJ,
    0,
    1e-3,
    "rebased mechanical energy ledger",
  );
  assert.throws(
    () => navigation.rebaseLocalFrameAfterJump(1),
    /cannot move backwards/,
  );

  const restored = RigidBodyNavigation.restore(after);
  assert.deepEqual(restored.snapshot(), after);
});

test("external audited impulses change rigid-body momentum without breaking closure", () => {
  const navigation = new RigidBodyNavigation({
    seed: "external-impulse",
  });
  const before = navigation.getMomentumBalance();
  const inertia = navigation.getCurrentInertiaDiagonal();
  const linearImpulse = {
    x: 316_000_000,
    y: -158_000_000,
    z: 79_000_000,
  };
  const angularImpulse = {
    x: inertia.x * 0.001,
    y: inertia.y * -0.0005,
    z: inertia.z * 0.00025,
  };

  const summary = navigation.applyExternalMomentumImpulse(
    linearImpulse,
    angularImpulse,
  );
  const after = navigation.getMomentumBalance();
  assertClose(summary.velocityMPerS.x, 1, 1e-12, "velocity x");
  assertClose(summary.velocityMPerS.y, -0.5, 1e-12, "velocity y");
  assertClose(summary.velocityMPerS.z, 0.25, 1e-12, "velocity z");
  assertClose(
    after.bodyLinearMomentumKgMPerS.x -
      before.bodyLinearMomentumKgMPerS.x,
    linearImpulse.x,
    1e-6,
    "linear impulse",
  );
  assertClose(
    after.bodyAngularMomentumAboutOriginKgM2PerS.x -
      before.bodyAngularMomentumAboutOriginKgM2PerS.x,
    angularImpulse.x,
    1e-3,
    "angular impulse",
  );
  assert.ok(after.linearClosureErrorKgMPerS < 1e-6);
  assert.ok(after.angularClosureErrorKgM2PerS < 1);
  assert.ok(
    Math.abs(navigation.getEnergyBalance().closureErrorJ) < 1,
  );
  assert.deepEqual(
    RigidBodyNavigation.restore(navigation.snapshot()).snapshot(),
    navigation.snapshot(),
  );
});

test("internal rotor exchange changes carrier spin through a dedicated conserved ledger", () => {
  const navigation = new RigidBodyNavigation({
    seed: "internal-rotor-exchange",
  });
  const impulseBody = {
    x: -1_250_000_000,
    y: 0,
    z: 0,
  };
  const energyBefore =
    navigation.getEnergyBalance().bodyMechanicalEnergyJ;
  const result =
    navigation.applyInternalAngularMomentumExchangeBody(
      impulseBody,
    );
  const snapshot = navigation.snapshot();
  const momentum = navigation.getMomentumBalance();
  const energy = navigation.getEnergyBalance();

  assert.deepEqual(
    result.requestedAngularImpulseBodyNms,
    impulseBody,
  );
  assert.deepEqual(
    snapshot.momentumLedger.internalAngularImpulseBodyNms,
    impulseBody,
  );
  assert.ok(
    navigation.getBodyState().angularVelocityBodyRadPerS.x < 0,
  );
  assert.ok(momentum.angularClosureErrorKgM2PerS < 1e-3);
  assert.ok(Math.abs(energy.closureErrorJ) < 1);
  assertClose(
    result.bodyMechanicalEnergyChangeJ,
    energy.bodyMechanicalEnergyJ - energyBefore,
    1e-9,
    "internal carrier energy receipt",
  );
  assertClose(
    snapshot.energyLedger.internalMechanicalEnergyTransferJ,
    result.bodyMechanicalEnergyChangeJ,
    1e-9,
    "internal energy ledger",
  );
  assert.deepEqual(
    RigidBodyNavigation.restore(snapshot).snapshot(),
    snapshot,
  );
});

test("unbalanced internal rotor momentum produces causal gyroscopic carrier reaction", () => {
  const navigation = new RigidBodyNavigation({
    seed: "internal-rotor-gyro",
    initialCondition: {
      angularVelocityBodyRadPerS: {
        x: 0,
        y: 1e-5,
        z: 0,
      },
    },
  });
  const result = navigation.step(1, {
    x: 2.1e11,
    y: 0,
    z: 0,
  });
  const body = navigation.getBodyState();

  assert.ok(
    body.angularVelocityBodyRadPerS.z > 0,
    "pitching a positive-X rotor must react about positive body Z",
  );
  assert.ok(
    Math.abs(
      result
        .internalRotorGyroscopicAngularMomentumExchangeInertialKgM2PerS
        .z,
    ) > 0,
  );
  assert.ok(
    navigation.getMomentumBalance().angularClosureErrorKgM2PerS <
      1e-3,
  );
  assert.ok(
    Math.abs(navigation.getEnergyBalance().closureErrorJ) < 1,
  );
});

test("four symmetric main-engine pulses translate without inventing rotation", () => {
  const navigation = new RigidBodyNavigation({ seed: "symmetric-main" });
  for (const thrusterId of ["main-a", "main-b", "main-c", "main-d"]) {
    navigation.schedulePulse(thrusterId, 0.5, 10);
  }

  const initialMassKg = navigation.getSummary().totalMassKg;
  const result = navigation.step(10);
  const body = navigation.getBodyState();
  const totalThrustN = 4 * 12_000_000 * 0.5;
  const exhaustSpeedMPerS = 50_000 * STANDARD_GRAVITY_M_PER_S2;
  const expectedPropellantKg =
    (totalThrustN / exhaustSpeedMPerS) * 10;
  const expectedFinalMassKg = initialMassKg - expectedPropellantKg;
  const rocketEquationDeltaVelocityMPerS =
    exhaustSpeedMPerS *
    Math.log(initialMassKg / expectedFinalMassKg);

  assertClose(
    result.propellantConsumedKg,
    expectedPropellantKg,
    1e-6,
    "causal mass flow",
  );
  assertClose(
    result.thrustImpulseInertialNs.x,
    totalThrustN * 10,
    1e-6,
    "main-engine impulse",
  );
  assertClose(
    body.velocityMPerS.x,
    rocketEquationDeltaVelocityMPerS,
    1e-7,
    "finite-step rocket-equation result",
  );
  assert.ok(body.positionM.x > 3.7 && body.positionM.x < 3.9);
  assert.deepEqual(body.angularVelocityBodyRadPerS, { x: 0, y: 0, z: 0 });
  assert.deepEqual(body.orientationBodyToInertial, {
    w: 1,
    x: 0,
    y: 0,
    z: 0,
  });
  assert.deepEqual(result.torqueImpulseBodyNms, { x: 0, y: 0, z: 0 });
  assert.ok(result.linearMomentumClosureErrorKgMPerS < 1e-6);
  assert.ok(result.angularMomentumClosureErrorKgM2PerS < 1e-6);
  assert.ok(Math.abs(result.energyClosureErrorJ) < 1e-6);
  assert.ok(navigation.getEnergyBalance().idealJetEnergyJ > 0);
  assert.ok(
    vectorMagnitude(
      navigation.getMomentumBalance().exhaustLinearMomentumKgMPerS,
    ) > 0,
  );
});

test("fusion torch source energy closes across jet, retained heat, and direct export", () => {
  const navigation = new RigidBodyNavigation({ seed: "torch-energy" });
  for (const thrusterId of ["main-a", "main-b", "main-c", "main-d"]) {
    navigation.schedulePulse(thrusterId, 1, 10);
  }

  const result = navigation.step(10);
  const exhaustSpeedMPerS = 50_000 * STANDARD_GRAVITY_M_PER_S2;
  const expectedPropellantKg =
    ((4 * 12_000_000) / exhaustSpeedMPerS) * 10;
  const expectedIdealJetEnergyJ =
    0.5 * expectedPropellantKg * exhaustSpeedMPerS ** 2;
  const expectedFusionEnergyJ = expectedIdealJetEnergyJ / 0.85;
  const expectedFusionFuelKg =
    expectedFusionEnergyJ /
    FUSION_TORCH_SPECIFIC_ENERGY_J_PER_KG;
  const expectedRetainedHeatJ =
    (expectedFusionEnergyJ - expectedIdealJetEnergyJ) * 0.002;
  const expectedDirectExportJ =
    expectedFusionEnergyJ -
    expectedIdealJetEnergyJ -
    expectedRetainedHeatJ;
  const snapshot = navigation.snapshot();

  assertClose(
    result.propellantConsumedKg,
    expectedPropellantKg,
    1e-6,
    "torch propellant",
  );
  assertClose(
    result.fusionFuelConsumedKg,
    expectedFusionFuelKg,
    1e-9,
    "torch fusion fuel",
  );
  assertClose(
    result.fusionEnergyReleasedJ,
    expectedFusionEnergyJ,
    1,
    "torch source energy",
  );
  assertClose(
    result.retainedWasteHeatJ,
    expectedRetainedHeatJ,
    1e-3,
    "torch retained heat",
  );
  assertClose(
    result.directExportEnergyJ,
    expectedDirectExportJ,
    1,
    "torch direct export",
  );
  assert.ok(
    Math.abs(result.propulsionSourceClosureErrorJ) < 1,
  );
  assertClose(
    snapshot.propulsion.initialFusionFuelMassKg -
      snapshot.propulsion.fusionFuelMassKg,
    snapshot.propulsion.energyLedger.fusionFuelConsumedKg,
    1e-9,
    "fusion inventory ledger",
  );
  assertClose(
    snapshot.propulsion.energyLedger.fusionEnergyReleasedJ,
    snapshot.propulsion.energyLedger.idealJetEnergyJ +
      snapshot.propulsion.energyLedger.retainedWasteHeatJ +
      snapshot.propulsion.energyLedger.directExportEnergyJ,
    1,
    "fusion source allocation",
  );
});

test("fusion-fuel exhaustion uniformly truncates thrust without creating negative inventory", () => {
  const navigation = new RigidBodyNavigation({
    seed: "fusion-dry",
    initialCondition: { propellantMassKg: 100 },
    initialFusionFuelMassKg: 0.00001,
  });
  for (const thrusterId of ["main-a", "main-b", "main-c", "main-d"]) {
    navigation.schedulePulse(thrusterId, 1, 10);
  }

  const result = navigation.step(10);
  const snapshot = navigation.snapshot();
  assertClose(
    result.fusionFuelConsumedKg,
    0.00001,
    1e-12,
    "last fusion fuel consumed",
  );
  assert.equal(snapshot.propulsion.fusionFuelMassKg, 0);
  assert.ok(snapshot.body.propellantMassKg > 99);
  assert.equal(navigation.getSummary().activeThrusterCount, 0);
  assert.ok(result.thrustImpulseInertialNs.x > 0);
  assertClose(
    result.fusionEnergyReleasedJ,
    0.00001 * FUSION_TORCH_SPECIFIC_ENERGY_J_PER_KG,
    1,
    "fuel-limited source energy",
  );
  assert.ok(Math.abs(result.propulsionSourceClosureErrorJ) < 1);
});

test("propulsion control receipts causally permit or reject torch ignition", () => {
  const powered = new RigidBodyNavigation({
    seed: "powered-ignition",
  });
  for (const thrusterId of ["main-a", "main-b", "main-c", "main-d"]) {
    powered.schedulePulse(thrusterId, 1, 1);
  }
  const poweredPreview =
    powered.previewPropulsionControlInterval(1);
  assert.deepEqual(poweredPreview.requestedEnergyJByTrain, {
    "propulsion-control-a": 42_000_000,
    "propulsion-control-b": 42_000_000,
  });
  const poweredReceipt =
    powered.applyPropulsionControlReceipt(
      poweredPreview,
      poweredPreview.requestedEnergyJByTrain,
    );
  assert.equal(poweredReceipt.terminatedCommandIds.length, 0);
  assert.equal(poweredReceipt.retainedControlHeatJ, 84_000_000);
  assert.ok(powered.step(1).propellantConsumedKg > 0);

  const unpowered = new RigidBodyNavigation({
    seed: "unpowered-ignition",
  });
  unpowered.schedulePulse("main-a", 1, 1);
  const unpoweredPreview =
    unpowered.previewPropulsionControlInterval(1);
  const fuelBefore =
    unpowered.snapshot().propulsion.fusionFuelMassKg;
  const unpoweredReceipt =
    unpowered.applyPropulsionControlReceipt(
      unpoweredPreview,
      {
        "propulsion-control-a": 0,
        "propulsion-control-b": 0,
      },
    );
  assert.deepEqual(unpoweredReceipt.terminatedCommandIds, [
    "navigation-command-1",
  ]);
  const rejectedBurn = unpowered.step(1);
  assert.equal(rejectedBurn.propellantConsumedKg, 0);
  assert.equal(rejectedBurn.fusionFuelConsumedKg, 0);
  assert.equal(
    unpowered.snapshot().propulsion.fusionFuelMassKg,
    fuelBefore,
  );
  assert.equal(
    unpowered.snapshot().propulsion.energyLedger
      .controlEnergyRequestedJ,
    21_000_000,
  );
  assert.equal(
    unpowered.snapshot().propulsion.energyLedger
      .controlEnergyServedJ,
    0,
  );
});

test("a stuck-on torch remains causal when electrical control is unavailable", () => {
  const navigation = new RigidBodyNavigation({
    seed: "stuck-on-control-bypass",
  });
  navigation.configureThruster("main-a", {
    condition: "stuck-on",
    stuckOnThrottleFraction: 0.1,
  });
  const preview = navigation.previewPropulsionControlInterval(1);
  assert.equal(preview.hasTorchActivity, true);
  assert.deepEqual(preview.requestedEnergyJByTrain, {
    "propulsion-control-a": 0,
    "propulsion-control-b": 0,
  });
  navigation.applyPropulsionControlReceipt(preview, {
    "propulsion-control-a": 0,
    "propulsion-control-b": 0,
  });
  const result = navigation.step(1);
  assert.ok(result.propellantConsumedKg > 0);
  assert.ok(result.retainedWasteHeatJ > 0);
});

test("opposed RCS forces cancel translation while their fixed lever arms create torque", () => {
  const navigation = new RigidBodyNavigation({ seed: "pure-torque" });
  navigation.schedulePulse("rcs-fore-y-plus", 1, 5);
  navigation.schedulePulse("rcs-aft-y-minus", 1, 5);

  const result = navigation.step(5);
  const body = navigation.getBodyState();

  assertClose(
    vectorMagnitude(result.thrustImpulseInertialNs),
    0,
    1e-9,
    "net translational impulse",
  );
  assertClose(body.velocityMPerS.x, 0, 1e-12, "x velocity");
  assertClose(body.velocityMPerS.y, 0, 1e-12, "y velocity");
  assertClose(body.velocityMPerS.z, 0, 1e-12, "z velocity");
  assert.equal(result.torqueImpulseBodyNms.z, 1_480_000_000);
  assert.ok(body.angularVelocityBodyRadPerS.z > 0);
  assert.ok(body.orientationBodyToInertial.z > 0);
  assertClose(
    quaternionNorm(body.orientationBodyToInertial),
    1,
    1e-13,
    "post-maneuver unit quaternion",
  );
});

test("pulse commands temporarily override sustained commands at exact time boundaries", () => {
  const navigation = new RigidBodyNavigation({ seed: "command-timeline" });
  const sustained = navigation.setSustainedThrottle("main-a", 0.2, {
    commandId: "cruise",
  });
  const pulse = navigation.schedulePulse("main-a", 0.8, 1, {
    commandId: "trim-burn",
    startDelaySeconds: 2,
  });

  assert.equal(sustained.mode, "sustained");
  assert.equal(pulse.startsAtMicroseconds, 2_000_000);
  assert.equal(pulse.endsAtMicroseconds, 3_000_000);
  assert.equal(
    navigation.getThruster("main-a").lastCommandedThrottleFraction,
    0.2,
  );

  navigation.step(2);
  assert.equal(
    navigation.getThruster("main-a").lastCommandedThrottleFraction,
    0.8,
    "the newer pulse becomes active exactly at its start",
  );

  navigation.step(1);
  assert.equal(
    navigation.getThruster("main-a").lastCommandedThrottleFraction,
    0.2,
    "the underlying sustained command resumes exactly at pulse end",
  );

  navigation.cancelCommand("cruise");
  assert.equal(
    navigation.getThruster("main-a").lastCommandedThrottleFraction,
    0,
  );
  assert.equal(navigation.cancelCommand("cruise").canceledAtMicroseconds, 3_000_000);
});

test("degradation, seizure, and stuck-on faults alter physical thrust rather than state directly", () => {
  const navigation = new RigidBodyNavigation({ seed: "thruster-faults" });
  navigation.setSustainedThrottle("main-a", 1);
  navigation.configureThruster("main-a", {
    condition: "degraded",
    performanceFraction: 0.4,
  });
  assert.equal(
    navigation.getThruster("main-a").lastActualThrottleFraction,
    0.4,
  );
  assert.equal(navigation.getThruster("main-a").lastThrustN, 4_800_000);

  navigation.configureThruster("main-a", { condition: "stuck-off" });
  assert.equal(navigation.getThruster("main-a").lastThrustN, 0);

  navigation.configureThruster("main-b", {
    condition: "stuck-on",
    performanceFraction: 0.5,
    stuckOnThrottleFraction: 0.25,
  });
  assert.equal(
    navigation.getThruster("main-b").lastCommandedThrottleFraction,
    0,
  );
  assert.equal(
    navigation.getThruster("main-b").lastActualThrottleFraction,
    0.125,
  );
  const positionBefore = navigation.getBodyState().positionM.x;
  navigation.step(2);
  assert.ok(navigation.getBodyState().positionM.x > positionBefore);
});

test("propellant exhaustion truncates a burn and causally stops every thruster", () => {
  const navigation = new RigidBodyNavigation({
    seed: "dry-tank",
    initialCondition: { propellantMassKg: 1 },
  });
  navigation.schedulePulse("main-a", 1, 10);

  const result = navigation.step(10);
  assertClose(result.propellantConsumedKg, 1, 1e-12, "last kilogram consumed");
  assert.equal(navigation.getBodyState().propellantMassKg, 0);
  assert.equal(navigation.getThruster("main-a").lastThrustN, 0);
  assert.equal(navigation.getSummary().activeThrusterCount, 0);
  assert.ok(navigation.getBodyState().velocityMPerS.x > 0);
});

test("navigation sensors preserve delay, deterministic error, drift, and hardware faults", () => {
  const navigation = new RigidBodyNavigation({ seed: "sensor-modes" });
  const sensorId = "sensor:position:x";
  navigation.configureSensor(sensorId, {
    sampleIntervalMicroseconds: NAVIGATION_MICROSECONDS_PER_SECOND,
    delayMicroseconds: 2 * NAVIGATION_MICROSECONDS_PER_SECOND,
    noiseStandardDeviation: 0,
    bias: 1,
    driftPerSecond: 0.5,
    condition: "nominal",
  });

  navigation.step(1);
  assert.equal(navigation.getSensorReading(sensorId), null);
  navigation.step(1);
  assert.deepEqual(navigation.getSensorReading(sensorId), {
    sensorId,
    quantity: "positionX",
    frameEpoch: 0,
    sampledAtMicroseconds: 0,
    availableAtMicroseconds: 2_000_000,
    value: 1,
    quality: "nominal",
  });

  navigation.configureSensor(sensorId, {
    delayMicroseconds: 0,
    condition: "stuck",
    stuckValue: 42,
  });
  assert.deepEqual(navigation.getSensorReading(sensorId), {
    sensorId,
    quantity: "positionX",
    frameEpoch: 0,
    sampledAtMicroseconds: 2_000_000,
    availableAtMicroseconds: 2_000_000,
    value: 42,
    quality: "stuck",
  });

  navigation.configureSensor(sensorId, {
    condition: "offline",
    stuckValue: null,
  });
  const offline = navigation.getSensorReading(sensorId);
  assert.equal(offline.value, null);
  assert.equal(offline.quality, "offline");
});

test("initial conditions coast in the inertial frame while attitude stays normalized", () => {
  const navigation = new RigidBodyNavigation({
    seed: "initial-condition",
    initialCondition: {
      positionM: { x: 100, y: -20, z: 3 },
      velocityMPerS: { x: 2, y: -0.5, z: 0.1 },
      orientationBodyToInertial: { w: 2, x: 0, y: 0, z: 0 },
      angularVelocityBodyRadPerS: { x: 0.0001, y: 0, z: 0 },
    },
  });

  navigation.step(100);
  const body = navigation.getBodyState();
  assertClose(body.positionM.x, 300, 1e-10, "coast x");
  assertClose(body.positionM.y, -70, 1e-10, "coast y");
  assertClose(body.positionM.z, 13, 1e-10, "coast z");
  assert.deepEqual(body.velocityMPerS, { x: 2, y: -0.5, z: 0.1 });
  assertClose(
    quaternionNorm(body.orientationBodyToInertial),
    1,
    1e-13,
    "coasting unit quaternion",
  );
  assert.deepEqual(
    navigation.getMomentumBalance().exhaustLinearMomentumKgMPerS,
    { x: 0, y: 0, z: 0 },
    "coasting does not fabricate exhaust",
  );
  assert.equal(navigation.getEnergyBalance().idealJetEnergyJ, 0);
  assert.equal(
    navigation.getEnergyBalance().propulsionMechanicalEnergyReleasedJ,
    0,
    "numerical torque-free drift is not mislabeled as propulsion",
  );
});

test("snapshot restore preserves commands, faults, pending observations, and PRNG continuation exactly", () => {
  const original = new RigidBodyNavigation({ seed: "restore-noise" });
  original.setSustainedThrottle("main-c", 0.37, {
    commandId: "long-burn",
  });
  original.schedulePulse("rcs-roll-plus-a", 0.6, 2.4, {
    commandId: "roll-trim",
    startDelaySeconds: 1.1,
  });
  original.configureThruster("main-c", {
    condition: "degraded",
    performanceFraction: 0.72,
  });
  original.configureSensor("sensor:velocity:x", {
    sampleIntervalMicroseconds: 700_000,
    delayMicroseconds: 1_300_000,
    noiseStandardDeviation: 0.4,
    bias: -0.2,
    driftPerSecond: 0.003,
    condition: "degraded",
  });
  original.step(3.4);

  const restored = RigidBodyNavigation.restore(original.serialize());
  const originalResult = original.step(12.65);
  const restoredResult = restored.step(12.65);

  assert.deepEqual(restoredResult, originalResult);
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.deepEqual(
    restored.getSensorReading("sensor:velocity:x"),
    original.getSensorReading("sensor:velocity:x"),
  );
});

test("strict restore rejects unknown fields, topology edits, fake outputs, and ledger corruption", () => {
  const navigation = new RigidBodyNavigation({ seed: "strict" });
  navigation.schedulePulse("main-a", 0.4, 2);
  navigation.step(1);
  const baseline = navigation.snapshot();

  const extraRootKey = structuredClone(baseline);
  extraRootKey.teleport = true;
  assert.throws(
    () => validateNavigationSnapshot(extraRootKey),
    /unexpected keys/,
  );

  const wrongVersion = structuredClone(baseline);
  wrongVersion.snapshotVersion = 999;
  assert.throws(
    () => RigidBodyNavigation.restore(wrongVersion),
    /unsupported navigation snapshot version/,
  );

  const nonUnitAttitude = structuredClone(baseline);
  nonUnitAttitude.body.orientationBodyToInertial.w = 2;
  assert.throws(
    () => RigidBodyNavigation.restore(nonUnitAttitude),
    /unit quaternion/,
  );

  const movedThruster = structuredClone(baseline);
  movedThruster.thrusters[0].positionBodyM.x += 1;
  assert.throws(
    () => RigidBodyNavigation.restore(movedThruster),
    /positionBodyM/,
  );

  const fakeOutput = structuredClone(baseline);
  fakeOutput.thrusters[0].lastThrustN = 1;
  assert.throws(
    () => RigidBodyNavigation.restore(fakeOutput),
    /lastThrustN does not reconcile/,
  );

  const fakeMass = structuredClone(baseline);
  fakeMass.body.propellantMassKg += 100;
  assert.throws(
    () => RigidBodyNavigation.restore(fakeMass),
    /momentum ledger|energy ledger/,
  );

  const fakeEnergy = structuredClone(baseline);
  fakeEnergy.energyLedger.idealJetEnergyJ += 1;
  assert.doesNotThrow(
    () => RigidBodyNavigation.restore(fakeEnergy),
    "ideal jet energy is a diagnostic and does not alter state conservation",
  );
  fakeEnergy.energyLedger.propulsionMechanicalEnergyReleasedJ += 1_000_000;
  assert.throws(
    () => RigidBodyNavigation.restore(fakeEnergy),
    /energy ledger does not reconcile/,
  );

  const fakeFusionInventory = structuredClone(baseline);
  fakeFusionInventory.propulsion.fusionFuelMassKg += 1;
  assert.throws(
    () => RigidBodyNavigation.restore(fakeFusionInventory),
    /initial inventory|fusion fuel inventory/,
  );

  const fakeRetainedHeat = structuredClone(baseline);
  fakeRetainedHeat.propulsion.energyLedger.retainedWasteHeatJ += 1_000_000;
  assert.throws(
    () => RigidBodyNavigation.restore(fakeRetainedHeat),
    /propulsion source allocation/,
  );

  const atomic = new RigidBodyNavigation({ seed: "atomic-configuration" });
  const beforeInvalidPatch = atomic.snapshot();
  assert.throws(
    () =>
      atomic.configureThruster("main-a", {
        condition: "degraded",
        performanceFraction: 2,
      }),
    /between zero and one/,
  );
  assert.deepEqual(
    atomic.snapshot(),
    beforeInvalidPatch,
    "an invalid configuration must not partially mutate the live model",
  );
});

test("a six-hour coast is fast, deterministic, and snapshot-stable", () => {
  const original = new RigidBodyNavigation({
    seed: "six-hour-coast",
    initialCondition: {
      positionM: { x: 10, y: 20, z: 30 },
      velocityMPerS: { x: 4, y: -2, z: 0.5 },
    },
  });
  const startedAt = performance.now();
  const result = original.step(21_600);
  const elapsedMilliseconds = performance.now() - startedAt;

  assert.equal(
    result.toMicroseconds,
    21_600 * NAVIGATION_MICROSECONDS_PER_SECOND,
  );
  assert.ok(result.substeps >= 4_320);
  assert.ok(
    elapsedMilliseconds < 1_500,
    `six-hour navigation coast took ${elapsedMilliseconds.toFixed(1)} ms`,
  );
  assertClose(
    original.getBodyState().positionM.x,
    10 + 4 * 21_600,
    1e-8,
    "six-hour coast position",
  );
  assert.equal(original.getEnergyBalance().closureErrorJ, 0);

  const restored = RigidBodyNavigation.restore(original.snapshot());
  const originalContinuation = original.step(3_600);
  const restoredContinuation = restored.step(3_600);
  assert.deepEqual(restoredContinuation, originalContinuation);
  assert.deepEqual(restored.snapshot(), original.snapshot());
});
