import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  BASELINE_ZONE_IDS,
  COMPARTMENT_COUNT,
  CompartmentAtmosphereNetwork,
  GAS_SPECIES,
  MICROSECONDS_PER_SECOND,
  sumZoneGases,
} from "../../lib/sim/compartments.ts";

const PRESSURE_SENSOR_A01 = "sensor:A-01:pressurePa";

function withoutOccupants(network) {
  const snapshot = network.snapshot();
  for (const zone of snapshot.zones) zone.awakeOccupants = 0;
  for (const handler of snapshot.airHandlers) {
    handler.scrubberEnabled = false;
  }
  return CompartmentAtmosphereNetwork.restore(snapshot);
}

function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function assertGasesClose(actual, expected, tolerance, message) {
  for (const gas of GAS_SPECIES) {
    assertClose(actual[gas], expected[gas], tolerance, `${message}.${gas}`);
  }
}

test("baseline has exactly 48 stable pressure zones and a typed connection graph", () => {
  const network = new CompartmentAtmosphereNetwork({ seed: "layout" });
  const zones = network.listZones();
  const connections = network.listConnections();

  assert.equal(zones.length, COMPARTMENT_COUNT);
  assert.deepEqual(
    zones.map((zone) => zone.id),
    BASELINE_ZONE_IDS,
  );
  assert.equal(new Set(zones.map((zone) => zone.id)).size, 48);
  assert.equal(
    zones.reduce((total, zone) => total + zone.volumeCubicMeters, 0),
    450_000,
  );
  assert.equal(
    zones.reduce((total, zone) => total + zone.awakeOccupants, 0),
    218,
  );
  for (const zone of zones) {
    assert.ok(zone.volumeCubicMeters > 0);
    assert.ok(zone.temperatureK > 0);
    for (const gas of GAS_SPECIES) assert.ok(zone.gasesKg[gas] > 0);
  }
  assert.deepEqual(
    new Set(connections.map((connection) => connection.kind)),
    new Set(["door", "duct", "isolation-valve"]),
  );
  assert.ok(
    connections.every(
      (connection) =>
        BASELINE_ZONE_IDS.includes(connection.zoneAId) &&
        BASELINE_ZONE_IDS.includes(connection.zoneBId),
    ),
  );

  const invalidCount = network.snapshot();
  invalidCount.zones.pop();
  assert.throws(
    () => CompartmentAtmosphereNetwork.restore(invalidCount),
    /exactly 48 zones/,
  );

  const invalidGas = network.snapshot();
  invalidGas.zones[0].gasesKg.oxygen = -1;
  assert.throws(
    () => CompartmentAtmosphereNetwork.restore(invalidGas),
    /cannot be negative/,
  );
});

test("bidirectional connection flow mixes zones while conserving every gas species", () => {
  const initial = withoutOccupants(
    new CompartmentAtmosphereNetwork({ seed: "conservation" }),
  ).snapshot();
  initial.zones[0].gasesKg.oxygen *= 1.08;
  initial.zones[0].temperatureK = 300;
  const forward = CompartmentAtmosphereNetwork.restore(initial);

  const before = sumZoneGases(forward.listZones());
  const neighborBefore = forward.getZone("A-02").gasesKg.oxygen;
  const firstStep = forward.step(0.1);
  assert.ok(
    forward
      .listConnections()
      .find((connection) => connection.id === "door:A-01:A-02")
      .lastSignedMassFlowKgPerSecond > 0,
  );
  const result = forward.step(19.9);
  const after = sumZoneGases(forward.listZones());

  assertGasesClose(after, before, 1e-8, "internal conservation");
  assert.ok(firstStep.internalTransferredGasesKg.oxygen > 0);
  assert.ok(result.internalTransferredGasesKg.oxygen > 0);
  assert.ok(forward.getZone("A-02").gasesKg.oxygen > neighborBefore);

  const reverseInitial = withoutOccupants(
    new CompartmentAtmosphereNetwork({ seed: "reverse" }),
  ).snapshot();
  reverseInitial.zones[1].gasesKg.nitrogen *= 1.08;
  const reverse = CompartmentAtmosphereNetwork.restore(reverseInitial);
  reverse.step(0.1);
  assert.ok(
    reverse
      .listConnections()
      .find((connection) => connection.id === "door:A-01:A-02")
      .lastSignedMassFlowKgPerSecond < 0,
  );
});

test("closing every incident entity connection isolates a pressure zone", () => {
  const baseline = withoutOccupants(
    new CompartmentAtmosphereNetwork({ seed: "isolation" }),
  ).snapshot();
  baseline.zones[0].gasesKg.oxygen *= 1.12;
  baseline.zones[0].temperatureK = 302;
  const network = CompartmentAtmosphereNetwork.restore(baseline);

  for (const connection of network.listConnections()) {
    if (
      connection.zoneAId === "A-01" ||
      connection.zoneBId === "A-01"
    ) {
      network.configureConnection(connection.id, {
        condition: "stuck-closed",
      });
    }
  }

  const before = network.getZone("A-01");
  network.step(60);
  const after = network.getZone("A-01");

  assert.deepEqual(after.gasesKg, before.gasesKg);
  assert.equal(after.temperatureK, before.temperatureK);
  assert.ok(
    network
      .listConnections()
      .filter(
        (connection) =>
          connection.zoneAId === "A-01" ||
          connection.zoneBId === "A-01",
      )
      .every(
        (connection) =>
          connection.lastForwardGrossMassFlowKgPerSecond === 0 &&
          connection.lastReverseGrossMassFlowKgPerSecond === 0,
      ),
  );
});

test("a breach removes each gas into the explicit external sink", () => {
  const network = withoutOccupants(
    new CompartmentAtmosphereNetwork({ seed: "breach" }),
  );
  network.upsertBreach({
    id: "breach:A-01:test",
    zoneId: "A-01",
    areaSquareMeters: 0.002,
    dischargeCoefficient: 0.72,
  });

  const gasesBefore = sumZoneGases(network.listZones());
  const pressureBefore = network.getZoneTruth("A-01").pressurePa;
  const result = network.step(30);
  const gasesAfter = sumZoneGases(network.listZones());
  const sink = network.getSink();

  for (const gas of GAS_SPECIES) {
    assert.ok(result.ventedGasesKg[gas] > 0);
    assertClose(
      gasesBefore[gas] - gasesAfter[gas],
      result.ventedGasesKg[gas],
      1e-8,
      `vented ${gas}`,
    );
    assertClose(
      sink.ventedGasesKg[gas],
      result.ventedGasesKg[gas],
      1e-12,
      `sink ${gas}`,
    );
  }
  assert.ok(network.getZoneTruth("A-01").pressurePa < pressureBefore);
  assert.ok(sink.ventedThermalEnergyJ > 0);
  assert.equal(network.listBreaches()[0].zoneId, "A-01");
});

test("metabolism has an explicit atmosphere exchange ledger", () => {
  const network = new CompartmentAtmosphereNetwork({ seed: "metabolism" });
  const gasesBefore = sumZoneGases(network.listZones());
  const result = network.step(60);
  const gasesAfter = sumZoneGases(network.listZones());

  assert.ok(result.metabolicExchange.oxygenConsumedKg > 0);
  assert.ok(result.metabolicExchange.carbonDioxideProducedKg > 0);
  assert.ok(result.metabolicExchange.waterVaporProducedKg > 0);
  assertClose(
    gasesAfter.oxygen,
    gasesBefore.oxygen - result.metabolicExchange.oxygenConsumedKg,
    1e-8,
    "metabolic oxygen",
  );
  assertClose(
    gasesAfter.carbonDioxide,
    gasesBefore.carbonDioxide +
      result.metabolicExchange.carbonDioxideProducedKg -
      result.capturedCarbonDioxideKg,
    1e-8,
    "metabolic and captured carbon dioxide",
  );
  assertClose(
    gasesAfter.waterVapor,
    gasesBefore.waterVapor +
      result.metabolicExchange.waterVaporProducedKg,
    1e-8,
    "metabolic water vapor",
  );
});

test("external thermal authority exports metabolic heat without double-heating cabin gas", () => {
  const retained = new CompartmentAtmosphereNetwork({
    seed: "metabolic-heat-authority",
  });
  const exported = new CompartmentAtmosphereNetwork({
    seed: "metabolic-heat-authority",
    metabolicHeatAuthority: "external-network",
  });
  const unavailableExternalCooling =
    new CompartmentAtmosphereNetwork({
      seed: "metabolic-heat-authority",
      metabolicHeatAuthority: "external-network",
    });
  const retainedResult = retained.step(3_600);
  const exportedResult = exported.step(3_600);
  const unavailableResult = unavailableExternalCooling.step(
    3_600,
    { externalMetabolicHeatRemovalFraction: 0 },
  );

  assertClose(
    exportedResult.metabolicExchange.sensibleHeatAddedJ,
    retainedResult.metabolicExchange.sensibleHeatAddedJ,
    1e-6,
    "exported metabolic heat ledger",
  );
  assert.ok(
    retained.getAggregateState().averageTemperatureK >
      exported.getAggregateState().averageTemperatureK,
  );
  assertClose(
    exportedResult.metabolicHeatTransferredToExternalJ,
    exportedResult.metabolicExchange.sensibleHeatAddedJ,
    1e-6,
    "fully removed metabolic heat",
  );
  assert.equal(
    unavailableResult.metabolicHeatTransferredToExternalJ,
    0,
  );
  assertClose(
    unavailableExternalCooling.getAggregateState()
      .averageTemperatureK,
    retained.getAggregateState().averageTemperatureK,
    1e-9,
    "unpowered external cooling retains metabolic heat in cabin gas",
  );
  assertClose(
    exported.getAggregateState().averageTemperatureK,
    295.15,
    1e-9,
    "externally controlled cabin temperature",
  );
  assert.equal(
    exported.snapshot().metabolicHeatAuthority,
    "external-network",
  );
  assert.throws(
    () =>
      retained.step(1, {
        externalMetabolicHeatRemovalFraction: 0.5,
      }),
    /requires external-network authority/,
  );
});

test("sensor readings are delayed observations with bias, drift, and damage modes", () => {
  const network = withoutOccupants(
    new CompartmentAtmosphereNetwork({ seed: "sensors" }),
  );
  const truth = network.getZoneTruth("A-01").pressurePa;
  network.configureSensor(PRESSURE_SENSOR_A01, {
    sampleIntervalMicroseconds: MICROSECONDS_PER_SECOND,
    delayMicroseconds: 2 * MICROSECONDS_PER_SECOND,
    noiseStandardDeviation: 0,
    bias: 100,
    driftPerSecond: 2,
    condition: "nominal",
  });

  network.step(1);
  assert.equal(network.getSensorReading(PRESSURE_SENSOR_A01), null);
  network.step(1);
  const first = network.getSensorReading(PRESSURE_SENSOR_A01);
  assert.equal(first.sampledAtMicroseconds, 0);
  assertClose(first.value, truth + 100, 1e-8, "delayed biased reading");

  network.step(1);
  const drifted = network.getSensorReading(PRESSURE_SENSOR_A01);
  assert.equal(drifted.sampledAtMicroseconds, MICROSECONDS_PER_SECOND);
  assertClose(drifted.value, truth + 102, 1e-8, "drifted reading");
  assert.notEqual(drifted.value, network.getZoneTruth("A-01").pressurePa);

  network.configureSensor(PRESSURE_SENSOR_A01, {
    delayMicroseconds: 0,
    condition: "stuck",
    stuckValue: 42,
  });
  assert.deepEqual(network.getSensorReading(PRESSURE_SENSOR_A01), {
    sensorId: PRESSURE_SENSOR_A01,
    zoneId: "A-01",
    quantity: "pressurePa",
    sampledAtMicroseconds: 3 * MICROSECONDS_PER_SECOND,
    availableAtMicroseconds: 3 * MICROSECONDS_PER_SECOND,
    value: 42,
    quality: "stuck",
  });

  network.configureSensor(PRESSURE_SENSOR_A01, {
    condition: "offline",
    stuckValue: null,
  });
  const offline = network.getSensorReading(PRESSURE_SENSOR_A01);
  assert.equal(offline.value, null);
  assert.equal(offline.quality, "offline");
});

test("snapshot restore preserves network, delayed sensor, and noise continuation exactly", () => {
  const original = withoutOccupants(
    new CompartmentAtmosphereNetwork({ seed: "restore-noise" }),
  );
  original.configureSensor(PRESSURE_SENSOR_A01, {
    sampleIntervalMicroseconds: 700_000,
    delayMicroseconds: 1_300_000,
    noiseStandardDeviation: 17,
    bias: -4,
    driftPerSecond: 0.3,
    condition: "degraded",
  });
  original.configureConnection("isolation:A-01:B-01", {
    condition: "degraded",
    commandedOpenFraction: 0.7,
  });
  original.upsertBreach({
    id: "breach:restore",
    zoneId: "B-07",
    areaSquareMeters: 0.0004,
    dischargeCoefficient: 0.65,
  });
  original.step(3.25);

  const restored = CompartmentAtmosphereNetwork.restore(original.serialize());
  const originalResult = original.step(11.75);
  const restoredResult = restored.step(11.75);

  assert.deepEqual(restoredResult, originalResult);
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.deepEqual(
    restored.getSensorReading(PRESSURE_SENSOR_A01),
    original.getSensorReading(PRESSURE_SENSOR_A01),
  );
});

test("equilibrium fast path stays close to the fine solver and preserves sensor random position", () => {
  const baseline = new CompartmentAtmosphereNetwork({ seed: "fast-fine" }).snapshot();
  // Air-handler capture has its own fast/fine equivalence test below. Keep this
  // assertion focused on the pressure, heat, metabolism, and sensor solvers.
  for (const handler of baseline.airHandlers) handler.scrubberEnabled = false;
  const fast = CompartmentAtmosphereNetwork.restore(baseline);
  const fine = CompartmentAtmosphereNetwork.restore(baseline);

  const fastResult = fast.step(60);
  const fineResult = fine.step(60, { fidelity: "fine" });

  assert.equal(fastResult.fidelityMode, "equilibrium-fast");
  assert.equal(fastResult.fineSubsteps, 0);
  assert.equal(fastResult.equilibriumIntervals, 1);
  assert.equal(fineResult.fidelityMode, "transient-fine");
  assert.ok(fineResult.fineSubsteps >= 600);

  assertGasesClose(
    sumZoneGases(fast.listZones()),
    sumZoneGases(fine.listZones()),
    1e-7,
    "fast/fine global gas balance",
  );
  for (const zoneId of BASELINE_ZONE_IDS) {
    const fastTruth = fast.getZoneTruth(zoneId);
    const fineTruth = fine.getZoneTruth(zoneId);
    assertClose(
      fastTruth.pressurePa,
      fineTruth.pressurePa,
      // The compressed equilibrium solve stays within 8e-7 relative error
      // while avoiding hundreds of substeps for an uneventful minute.
      0.15,
      `${zoneId} fast/fine pressure`,
    );
    assertClose(
      fastTruth.temperatureK,
      fineTruth.temperatureK,
      0.001,
      `${zoneId} fast/fine temperature`,
    );
    const fastZone = fast.getZone(zoneId);
    const fineZone = fine.getZone(zoneId);
    for (const gas of GAS_SPECIES) {
      assertClose(
        fastZone.gasesKg[gas],
        fineZone.gasesKg[gas],
        0.02,
        `${zoneId} fast/fine ${gas}`,
      );
    }
  }

  const fastSensor = fast
    .snapshot()
    .sensors.find((sensor) => sensor.id === PRESSURE_SENSOR_A01);
  const fineSensor = fine
    .snapshot()
    .sensors.find((sensor) => sensor.id === PRESSURE_SENSOR_A01);
  assert.equal(fastSensor.randomState, fineSensor.randomState);
  assert.equal(fastSensor.spareNormal, fineSensor.spareNormal);
  assert.equal(
    fastSensor.latest.sampledAtMicroseconds,
    fineSensor.latest.sampledAtMicroseconds,
  );
  assertClose(
    fastSensor.latest.value,
    fineSensor.latest.value,
    0.02,
    "compressed sensor observation",
  );
});

test("fixed A/B air handlers scrub only their served ring and close the carbon ledger", () => {
  const baseline = new CompartmentAtmosphereNetwork({
    seed: "air-handler-ring-isolation",
  }).snapshot();
  for (const zone of baseline.zones) zone.awakeOccupants = 0;
  for (const zone of baseline.zones) {
    if (zone.id.startsWith("A-")) zone.gasesKg.carbonDioxide += 10;
  }
  const network = CompartmentAtmosphereNetwork.restore(baseline);
  network.configureAirHandler("air-handler-b", { scrubberEnabled: false });
  for (const connection of network.listConnections()) {
    if (connection.zoneAId[0] !== connection.zoneBId[0]) {
      network.configureConnection(connection.id, { condition: "stuck-closed" });
    }
  }

  const ringCarbonDioxide = (ring) =>
    network
      .listZones()
      .filter((zone) => zone.id.startsWith(`${ring}-`))
      .reduce((total, zone) => total + zone.gasesKg.carbonDioxide, 0);
  const aBefore = ringCarbonDioxide("A");
  const bBefore = ringCarbonDioxide("B");
  const result = network.step(10);
  const handlers = network.listAirHandlers();

  assertClose(result.capturedCarbonDioxideKg, 0.9, 1e-10, "A-ring capture");
  assertClose(aBefore - ringCarbonDioxide("A"), 0.9, 1e-8, "A-ring removal");
  assertClose(ringCarbonDioxide("B"), bBefore, 1e-10, "B-ring isolation");
  assertClose(
    handlers[0].cumulativeCapturedCarbonDioxideKg,
    result.capturedCarbonDioxideKg,
    1e-12,
    "handler capture ledger",
  );
  assert.equal(handlers[1].cumulativeCapturedCarbonDioxideKg, 0);
});

test("air-handler flow, electrical service, and condition causally bound capture capacity", () => {
  const run = ({ command = 1, service = 1, condition = "nominal" } = {}) => {
    const snapshot = new CompartmentAtmosphereNetwork({
      seed: `air-handler-capacity:${command}:${service}:${condition}`,
    }).snapshot();
    for (const zone of snapshot.zones) zone.awakeOccupants = 0;
    for (const zone of snapshot.zones) {
      if (zone.id.startsWith("A-")) zone.gasesKg.carbonDioxide += 10;
    }
    for (const handler of snapshot.airHandlers) handler.scrubberEnabled = false;
    const network = CompartmentAtmosphereNetwork.restore(snapshot);
    network.configureAirHandler("air-handler-a", {
      commandedFlowFraction: command,
      scrubberEnabled: true,
      condition,
    });
    network.synchronizeAirHandlerElectricalServiceFraction(
      "air-handler-a",
      service,
    );
    const result = network.step(10);
    return {
      captured: result.capturedCarbonDioxideKg,
      handler: network.listAirHandlers()[0],
    };
  };

  const nominal = run();
  const halfCommand = run({ command: 0.5 });
  const halfPower = run({ service: 0.5 });
  const degraded = run({ condition: "degraded" });
  const stopped = [
    run({ command: 0 }),
    run({ service: 0 }),
    run({ condition: "stuck-off" }),
  ];

  assertClose(nominal.captured, 0.9, 1e-10, "nominal capacity");
  assertClose(halfCommand.captured, 0.45, 1e-10, "half command");
  assertClose(halfPower.captured, 0.45, 1e-10, "half electrical service");
  assertClose(degraded.captured, 0.45, 1e-10, "degraded condition");
  assert.equal(degraded.handler.actualFlowFraction, 0.5);
  for (const result of stopped) {
    assert.equal(result.captured, 0);
    assert.equal(result.handler.actualFlowFraction, 0);
  }
});

test("air-handler long steps, split steps, restore, and strict topology validation are deterministic", () => {
  const baseline = new CompartmentAtmosphereNetwork({
    seed: "air-handler-determinism",
  }).snapshot();
  for (const zone of baseline.zones) zone.gasesKg.carbonDioxide += 10;
  const long = CompartmentAtmosphereNetwork.restore(baseline);
  const split = CompartmentAtmosphereNetwork.restore(baseline);

  const longResult = long.step(600);
  let splitCapture = 0;
  for (let index = 0; index < 10; index += 1) {
    splitCapture += split.step(60).capturedCarbonDioxideKg;
  }
  assertClose(
    longResult.capturedCarbonDioxideKg,
    splitCapture,
    1e-9,
    "long/split capture",
  );
  assertGasesClose(
    sumZoneGases(long.listZones()),
    sumZoneGases(split.listZones()),
    1e-7,
    "long/split atmosphere",
  );

  const restored = CompartmentAtmosphereNetwork.restore(split.serialize());
  assert.deepEqual(restored.step(30), split.step(30));
  assert.deepEqual(restored.snapshot(), split.snapshot());

  const forgedFlow = long.snapshot();
  forgedFlow.airHandlers[0].actualFlowFraction = 0.25;
  assert.throws(
    () => CompartmentAtmosphereNetwork.restore(forgedFlow),
    /actualFlowFraction does not match/,
  );
  const forgedTopology = long.snapshot();
  forgedTopology.airHandlers[0].servedZoneIds[0] = "B-01";
  assert.throws(
    () => CompartmentAtmosphereNetwork.restore(forgedTopology),
    /fixed A-ring topology/,
  );
  const forgedSetpoint = long.snapshot();
  forgedSetpoint.airHandlers[0].carbonDioxideSetpointPa = 1;
  assert.throws(
    () => CompartmentAtmosphereNetwork.restore(forgedSetpoint),
    /fixed setpoint/,
  );
});

test("aggregate coupling helpers preserve distribution and exact global totals", () => {
  const network = new CompartmentAtmosphereNetwork({
    seed: "aggregate-coupling",
  });
  const before = network.getAggregateState();

  network.setAwakeOccupantTotal(231);
  assert.equal(network.getAggregateState().awakeOccupants, 231);
  assert.ok(
    network
      .listZones()
      .every(
        (zone) =>
          Number.isSafeInteger(zone.awakeOccupants) &&
          zone.awakeOccupants >= 0,
      ),
  );

  const oxygenTarget = before.gasesKg.oxygen - 125.5;
  const oxygenDelta = network.setTotalGasMass(
    "oxygen",
    oxygenTarget,
  );
  assertClose(oxygenDelta, -125.5, 1e-8, "oxygen coupling delta");
  assertClose(
    network.getAggregateState().gasesKg.oxygen,
    oxygenTarget,
    1e-8,
    "oxygen coupling target",
  );

  const carbonDioxideBefore =
    network.getAggregateState().gasesKg.carbonDioxide;
  const scrubbed = network.removeGasProportionally(
    "carbonDioxide",
    12.25,
  );
  assertClose(scrubbed, 12.25, 1e-10, "scrubber removal");
  assertClose(
    network.getAggregateState().gasesKg.carbonDioxide,
    carbonDioxideBefore - scrubbed,
    1e-8,
    "scrubber global balance",
  );
});

test("breaches, significant pressure gradients, and entity faults force fine fidelity", () => {
  const pressureSnapshot = withoutOccupants(
    new CompartmentAtmosphereNetwork({ seed: "pressure-fallback" }),
  ).snapshot();
  pressureSnapshot.zones[0].gasesKg.oxygen *= 1.1;
  const pressureGradient =
    CompartmentAtmosphereNetwork.restore(pressureSnapshot);
  assert.deepEqual(
    pressureGradient.getFidelityRequirement(),
    {
      requiresFineSolver: true,
      maximumSimulatedSecondsPerStep: 60,
      reasons: ["pressure-temperature-or-composition-gradient"],
    },
  );
  const pressureResult = pressureGradient.step(1);
  assert.equal(pressureResult.fidelityMode, "transient-fine");
  assert.ok(pressureResult.fineSubsteps >= 10);
  assert.equal(pressureResult.equilibriumIntervals, 0);

  const breach = withoutOccupants(
    new CompartmentAtmosphereNetwork({ seed: "breach-fallback" }),
  );
  breach.upsertBreach({
    id: "breach:fidelity",
    zoneId: "A-03",
    areaSquareMeters: 0.0005,
    dischargeCoefficient: 0.7,
  });
  assert.ok(
    breach
      .getFidelityRequirement()
      .reasons.includes("active-breach"),
  );
  const breachResult = breach.step(1);
  assert.equal(breachResult.fidelityMode, "transient-fine");
  assert.ok(breachResult.fineSubsteps >= 10);

  const fault = withoutOccupants(
    new CompartmentAtmosphereNetwork({ seed: "fault-fallback" }),
  );
  fault.configureConnection("door:A-01:A-02", {
    condition: "degraded",
  });
  assert.ok(
    fault
      .getFidelityRequirement()
      .reasons.includes("connection-fault"),
  );
  const faultResult = fault.step(1);
  assert.equal(faultResult.fidelityMode, "transient-fine");
  assert.ok(faultResult.fineSubsteps >= 10);
});

test("six-hour equilibrium step has a generous performance guard and restores deterministically", () => {
  const original = new CompartmentAtmosphereNetwork({
    seed: "six-hour-cruise",
  });
  const startedAt = performance.now();
  const result = original.step(21_600);
  const elapsedMilliseconds = performance.now() - startedAt;

  assert.equal(result.fidelityMode, "equilibrium-fast");
  assert.equal(result.fineSubsteps, 0);
  assert.equal(result.equilibriumIntervals, 1);
  // The intended result is well below 150 ms on the development machine. A
  // one-second CI guard catches accidental O(seconds) sample iteration without
  // turning shared-runner variance into flaky tests.
  assert.ok(
    elapsedMilliseconds < 1_000,
    `six-hour fast step took ${elapsedMilliseconds.toFixed(1)} ms`,
  );

  const restored = CompartmentAtmosphereNetwork.restore(original.serialize());
  const originalContinuation = original.step(3_600);
  const restoredContinuation = restored.step(3_600);
  assert.deepEqual(restoredContinuation, originalContinuation);
  assert.deepEqual(restored.snapshot(), original.snapshot());
});
