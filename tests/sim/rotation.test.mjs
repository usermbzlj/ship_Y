import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  CounterRotatingHabitat,
  HABITAT_RING_INERTIA_KG_M2,
  HABITAT_RING_MASS_KG,
  HABITAT_RING_RADIUS_M,
  ROTATION_RING_IDS,
  ROTATION_SENSOR_IDS,
  ROTATION_SNAPSHOT_VERSION,
  validateRotationSnapshot,
} from "../../lib/sim/rotation.ts";

const CARRIER_INERTIA_X_KG_M2 = 5e15;

function carrier(
  angularVelocityXRadPerS = 0,
  revision = 0,
) {
  return {
    angularVelocityXRadPerS,
    inertiaXKgM2: CARRIER_INERTIA_X_KG_M2,
    revision,
  };
}

function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function fullPowerStep(system, seconds, carrierState) {
  const preview = system.previewControlInterval(
    seconds,
    carrierState,
  );
  const result = system.step(
    preview,
    carrierState,
    preview.requestedEnergyJByRing,
  );
  return {
    preview,
    result,
    carrierState: {
      ...carrierState,
      angularVelocityXRadPerS:
        result.predictedCarrierAngularVelocityXRadPerS,
      revision: carrierState.revision + 1,
    },
  };
}

function unpoweredStep(system, seconds, carrierState) {
  const preview = system.previewControlInterval(
    seconds,
    carrierState,
  );
  const result = system.step(preview, carrierState, {
    "ring-a": 0,
    "ring-b": 0,
  });
  return {
    preview,
    result,
    carrierState: {
      ...carrierState,
      angularVelocityXRadPerS:
        result.predictedCarrierAngularVelocityXRadPerS,
      revision: carrierState.revision + 1,
    },
  };
}

test("baseline is two fixed one-g thin rings whose relative angular momenta cancel", () => {
  const rotation = new CounterRotatingHabitat({
    seed: "rotation-baseline",
  });
  const snapshot = rotation.snapshot();
  const summary = rotation.getSummary();

  assert.equal(
    snapshot.snapshotVersion,
    ROTATION_SNAPSHOT_VERSION,
  );
  assert.deepEqual(
    rotation.listRings().map((ring) => ring.id),
    ROTATION_RING_IDS,
  );
  assert.deepEqual(
    rotation.listSensors().map((sensor) => sensor.id),
    ROTATION_SENSOR_IDS,
  );
  for (const ring of rotation.listRings()) {
    assert.equal(ring.radiusM, HABITAT_RING_RADIUS_M);
    assert.equal(ring.massKg, HABITAT_RING_MASS_KG);
    assert.equal(
      ring.inertiaKgM2,
      HABITAT_RING_INERTIA_KG_M2,
    );
  }
  assertClose(
    summary.rings[0].relativeRpm,
    2,
    1e-12,
    "ring-a baseline relative rpm",
  );
  assertClose(
    summary.rings[1].relativeRpm,
    -2,
    1e-12,
    "ring-b baseline relative rpm",
  );
  for (const ring of summary.rings) {
    assertClose(
      ring.artificialGravityG,
      1,
      0.002,
      `${ring.id} baseline artificial gravity`,
    );
    assert.ok(ring.structureCentripetalLoadN > 0);
    assert.ok(ring.bearingRadialLoadN > 0);
    assert.ok(
      Number.isFinite(ring.coriolisCoefficientPerSecond),
    );
  }
  assert.equal(
    summary.netRelativeRingAngularMomentumKgM2PerS,
    0,
  );
  assert.equal(summary.totalAngularMomentumXKgM2PerS, 0);
});

test("loss of drive power causes causal coast with equal opposite carrier reaction", () => {
  const rotation = new CounterRotatingHabitat({
    seed: "rotation-unpowered",
  });
  const initialCarrier = carrier();
  const before = rotation.listRings();
  const { result } = unpoweredStep(
    rotation,
    3_600,
    initialCarrier,
  );
  const after = rotation.listRings();

  assert.ok(
    Math.abs(after[0].relativeAngularVelocityRadPerS) <
      Math.abs(before[0].relativeAngularVelocityRadPerS),
  );
  assert.ok(
    Math.abs(after[1].relativeAngularVelocityRadPerS) <
      Math.abs(before[1].relativeAngularVelocityRadPerS),
  );
  for (let index = 0; index < ROTATION_RING_IDS.length; index += 1) {
    const ringId = ROTATION_RING_IDS[index];
    const expectedCarrierImpulse =
      -HABITAT_RING_INERTIA_KG_M2 *
      (after[index].relativeAngularVelocityRadPerS -
        before[index].relativeAngularVelocityRadPerS);
    assertClose(
      result.carrierBodyAngularImpulseXByRing[ringId],
      expectedCarrierImpulse,
      1e-3,
      `${ringId} equal opposite carrier impulse`,
    );
  }
  assertClose(
    result.carrierBodyAngularImpulseX,
    0,
    1e-6,
    "symmetric coast net carrier impulse",
  );
  assert.ok(result.heatJ > 0);
  assert.equal(result.energyBalance.servedElectricalEnergyJ, 0);
  assertClose(
    result.energyBalance.mechanicalEnergyChangeJ,
    -result.heatJ,
    1e-3,
    "unpowered mechanical loss becomes heat",
  );
});

test("served electrical energy holds both rings at their configured relative speeds", () => {
  const rotation = new CounterRotatingHabitat({
    seed: "rotation-powered-hold",
  });
  const { preview, result } = fullPowerStep(
    rotation,
    3_600,
    carrier(),
  );

  assert.ok(preview.requestedEnergyJByRing["ring-a"] > 0);
  assert.ok(preview.requestedEnergyJByRing["ring-b"] > 0);
  assertClose(
    result.summary.rings[0].relativeRpm,
    2,
    1e-10,
    "powered ring-a speed hold",
  );
  assertClose(
    result.summary.rings[1].relativeRpm,
    -2,
    1e-10,
    "powered ring-b speed hold",
  );
  assertClose(
    result.carrierBodyAngularImpulseX,
    0,
    1e-6,
    "symmetric powered hold net reaction",
  );
  assert.ok(
    result.positiveDriveMechanicalWorkJByRing["ring-a"] > 0,
  );
  assert.ok(
    result.positiveDriveMechanicalWorkJByRing["ring-b"] > 0,
  );
});

test("drive electricity, coupled kinetic-energy change, and every heat source close", () => {
  const rotation = new CounterRotatingHabitat({
    seed: "rotation-energy",
  });
  rotation.configureRing("ring-a", {
    drive: {
      condition: "degraded",
      efficiency: 0.81,
    },
    bearing: {
      condition: "degraded",
    },
  });
  const initialCarrier = carrier(0.003, 7);
  const { preview, result } = fullPowerStep(
    rotation,
    1_800,
    initialCarrier,
  );
  const balance = result.energyBalance;

  for (const ringId of ROTATION_RING_IDS) {
    const efficiency = rotation.getRing(ringId).drive.efficiency;
    assert.ok(
      result.positiveDriveMechanicalWorkJByRing[ringId] <=
        preview.requestedEnergyJByRing[ringId] * efficiency +
          1e-3,
      `${ringId} positive mechanical work must be energy limited`,
    );
  }
  assertClose(
    balance.heatJ,
    balance.heatComponentSumJ,
    1e-3,
    "all heat components",
  );
  assertClose(
    balance.mechanicalEnergyChangeJ,
    balance.mechanicalComponentSumJ,
    1e-3,
    "carrier plus ring energy changes",
  );
  assertClose(
    balance.servedElectricalEnergyJ,
    balance.heatJ +
      balance.mechanicalEnergyChangeJ +
      balance.numericalResidualJ,
    1e-3,
    "electrical to mechanical and heat closure",
  );
  assert.ok(balance.closureErrorJ < 1e-2);
  assertClose(
    rotation.snapshot().carrierAngularImpulseXSinceFrame,
    result.carrierBodyAngularImpulseX,
    1e-9,
    "frame carrier angular impulse",
  );
  assertClose(
    rotation.snapshot().carrierKineticEnergyChangeJSinceFrame,
    balance.carrierKineticEnergyChangeJ,
    1e-3,
    "frame carrier energy exchange",
  );
});

test("bearing maintenance restores condition but preserves residual wear history", () => {
  const rotation = new CounterRotatingHabitat({
    seed: "rotation-bearing-maintenance",
  });
  rotation.configureRing("ring-a", {
    bearing: { condition: "degraded" },
  });
  unpoweredStep(rotation, 6 * 60 * 60, carrier());

  const worn = rotation.getRing("ring-a");
  assert.equal(worn.bearing.condition, "degraded");
  assert.ok(worn.bearingWearFraction > 0);

  const serviced = rotation.completeBearingMaintenance("ring-a");
  assert.equal(serviced.bearing.condition, "nominal");
  assert.ok(serviced.bearingWearFraction <= 0.05);
  assert.ok(serviced.bearingWearFraction > 0);
  assert.ok(
    serviced.bearingWearFraction < worn.bearingWearFraction,
    "service should reduce, not erase, bearing wear",
  );

  const restored = CounterRotatingHabitat.restore(rotation.snapshot());
  assert.deepEqual(restored.getRing("ring-a"), serviced);
});

test("braking one ring spins the carrier oppositely and conserves X angular momentum", () => {
  const rotation = new CounterRotatingHabitat({
    seed: "rotation-single-brake",
  });
  rotation.configureRing("ring-a", {
    controlMode: "brake",
  });
  rotation.configureRing("ring-b", {
    controlMode: "coast",
  });
  const initialCarrier = carrier();
  const before = rotation.listRings();
  const { result } = fullPowerStep(
    rotation,
    600,
    initialCarrier,
  );
  const after = rotation.listRings();
  const ringMomentumChange = after.reduce(
    (total, ring, index) =>
      total +
      ring.inertiaKgM2 *
        (ring.relativeAngularVelocityRadPerS -
          before[index].relativeAngularVelocityRadPerS),
    0,
  );

  assert.ok(
    after[0].relativeAngularVelocityRadPerS <
      before[0].relativeAngularVelocityRadPerS,
  );
  assert.ok(result.carrierBodyAngularImpulseX > 0);
  assert.ok(
    result.predictedCarrierAngularVelocityXRadPerS > 0,
  );
  assertClose(
    result.carrierBodyAngularImpulseX + ringMomentumChange,
    0,
    1e-3,
    "internal angular momentum closure",
  );
  assert.ok(result.energyBalance.mechanicalBrakeHeatJ > 0);
});

test("rotation sensors preserve delay and expose independent hardware faults", () => {
  const rotation = new CounterRotatingHabitat({
    seed: "rotation-sensors",
  });
  rotation.configureRing("ring-a", { controlMode: "coast" });
  rotation.configureRing("ring-b", { controlMode: "coast" });
  const sensorId = "sensor:ring-a:relative-rpm";
  rotation.configureSensor(sensorId, {
    sampleIntervalMicroseconds: 1_000_000,
    delayMicroseconds: 2_000_000,
    noiseStandardDeviation: 0,
    bias: 0,
    driftPerSecond: 0,
    condition: "nominal",
  });
  let currentCarrier = carrier();

  assert.equal(rotation.getSensorReading(sensorId), null);
  let stepped = unpoweredStep(rotation, 1, currentCarrier);
  currentCarrier = stepped.carrierState;
  assert.equal(rotation.getSensorReading(sensorId), null);
  stepped = unpoweredStep(rotation, 1, currentCarrier);
  currentCarrier = stepped.carrierState;
  const delayed = rotation.getSensorReading(sensorId);
  assert.ok(delayed);
  assert.equal(delayed.sampledAtMicroseconds, 0);
  assert.equal(delayed.availableAtMicroseconds, 2_000_000);
  assert.equal(delayed.quality, "nominal");
  assert.ok(delayed.value > 1.99 && delayed.value <= 2);

  rotation.configureSensor(sensorId, {
    sampleIntervalMicroseconds: 1_000_000,
    delayMicroseconds: 2_000_000,
    noiseStandardDeviation: 0,
    condition: "offline",
  });
  stepped = unpoweredStep(rotation, 2, currentCarrier);
  const offline = rotation.getSensorReading(sensorId);
  assert.ok(offline);
  assert.equal(offline.quality, "offline");
  assert.equal(offline.value, null);
});

test("strict v1 restore rejects topology, clock, sensor, and energy-ledger corruption", () => {
  const rotation = new CounterRotatingHabitat({
    seed: "rotation-restore",
  });
  const stepped = fullPowerStep(rotation, 60, carrier());
  const snapshot = rotation.snapshot();
  const restored = CounterRotatingHabitat.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  validateRotationSnapshot(snapshot);

  const unknownField = structuredClone(snapshot);
  unknownField.forceMagic = true;
  assert.throws(
    () => CounterRotatingHabitat.restore(unknownField),
    /must contain exactly/,
  );

  const topology = structuredClone(snapshot);
  topology.rings.reverse();
  assert.throws(
    () => CounterRotatingHabitat.restore(topology),
    /fixed ring topology/,
  );

  const clock = structuredClone(snapshot);
  clock.elapsedMicroseconds = -1;
  assert.throws(
    () => CounterRotatingHabitat.restore(clock),
    /non-negative safe integer/,
  );

  const sensor = structuredClone(snapshot);
  sensor.sensors[0].id = "sensor:ring-b:relative-rpm";
  assert.throws(
    () => CounterRotatingHabitat.restore(sensor),
    /fixed sensor topology/,
  );

  const energy = structuredClone(snapshot);
  energy.energyLedger.heatJ += 1_000;
  assert.throws(
    () => CounterRotatingHabitat.restore(energy),
    /heatJ does not close/,
  );

  const beforeRebase = rotation.snapshot();
  const rebasedCarrier = {
    ...stepped.carrierState,
    revision: stepped.carrierState.revision + 1,
  };
  rotation.rebaseCarrierExchangeLedger(rebasedCarrier);
  const rebased = rotation.snapshot();
  assert.equal(rebased.carrierAngularImpulseXSinceFrame, 0);
  assert.equal(
    rebased.carrierKineticEnergyChangeJSinceFrame,
    0,
  );
  assert.deepEqual(rebased.rings, beforeRebase.rings);
  assert.deepEqual(
    rebased.energyLedger,
    beforeRebase.energyLedger,
  );
});

test("a six-hour interval remains finite, fast, and snapshot deterministic", () => {
  const rotation = new CounterRotatingHabitat({
    seed: "rotation-long-step",
  });
  let currentCarrier = carrier(0.0002, 11);
  const started = performance.now();
  const stepped = fullPowerStep(
    rotation,
    6 * 60 * 60,
    currentCarrier,
  );
  currentCarrier = stepped.carrierState;
  const elapsedMilliseconds = performance.now() - started;
  const summary = rotation.getSummary();

  assert.ok(
    elapsedMilliseconds < 1_500,
    `six-hour rotation interval took ${elapsedMilliseconds.toFixed(1)} ms`,
  );
  for (const value of [
    summary.totalAngularMomentumXKgM2PerS,
    summary.totalCoupledKineticEnergyJ,
    summary.energyClosureErrorJ,
    ...summary.rings.flatMap((ring) => [
      ring.relativeRpm,
      ring.absoluteRpm,
      ring.artificialGravityG,
      ring.structureCentripetalLoadN,
      ring.bearingRadialLoadN,
      ring.coriolisCoefficientPerSecond,
      ring.vibrationMmPerS,
      ring.fatigueFraction,
      ring.bearingWearFraction,
    ]),
  ]) {
    assert.ok(Number.isFinite(value));
  }
  assert.ok(summary.energyClosureErrorJ < 1e-2);

  const restored = CounterRotatingHabitat.restore(
    rotation.serialize(),
  );
  const originalPreview = rotation.previewControlInterval(
    300,
    currentCarrier,
  );
  const restoredPreview = restored.previewControlInterval(
    300,
    currentCarrier,
  );
  assert.deepEqual(restoredPreview, originalPreview);
  const originalResult = rotation.step(
    originalPreview,
    currentCarrier,
    originalPreview.requestedEnergyJByRing,
  );
  const restoredResult = restored.step(
    restoredPreview,
    currentCarrier,
    restoredPreview.requestedEnergyJByRing,
  );
  assert.deepEqual(restoredResult, originalResult);
  assert.deepEqual(restored.snapshot(), rotation.snapshot());
});
