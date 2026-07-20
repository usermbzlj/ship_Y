import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  COOLING_LOOP_IDS,
  COOLING_MICROSECONDS_PER_SECOND,
  COOLING_SNAPSHOT_VERSION,
  CoolingThermalNetwork,
  EXTERNAL_THERMAL_SOURCE_IDS,
  HEAT_EXCHANGER_IDS,
  RADIATOR_IDS,
  THERMAL_NODE_IDS,
  validateCoolingSnapshot,
} from "../../lib/sim/cooling.ts";

const BUS_SENSOR = "sensor:thermal-bus:temperatureK";

function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test("baseline exposes two complete redundant entity loops and five SI thermal nodes", () => {
  const network = new CoolingThermalNetwork({ seed: "topology" });
  const snapshot = network.snapshot();

  assert.equal(snapshot.snapshotVersion, COOLING_SNAPSHOT_VERSION);
  assert.equal(COOLING_SNAPSHOT_VERSION, 5);
  assert.deepEqual(
    Object.keys(snapshot.ledger.externalEnergyBySourceJ),
    EXTERNAL_THERMAL_SOURCE_IDS,
  );
  assert.ok(
    Object.values(snapshot.ledger.externalEnergyBySourceJ).every(
      (energyJ) => energyJ === 0,
    ),
  );
  assert.deepEqual(
    network.listLoops().map((loop) => loop.id),
    COOLING_LOOP_IDS,
  );
  assert.deepEqual(
    network.listNodes().map((node) => node.id),
    THERMAL_NODE_IDS,
  );
  assert.deepEqual(
    network.listHeatExchangers().map((exchanger) => exchanger.id),
    HEAT_EXCHANGER_IDS,
  );
  assert.deepEqual(
    network.listRadiators().map((radiator) => radiator.id),
    RADIATOR_IDS,
  );
  assert.equal(network.listPumps().length, 2);
  assert.equal(new Set(network.listLoops().map((loop) => loop.pumpId)).size, 2);
  assert.equal(
    new Set(network.listLoops().map((loop) => loop.radiatorId)).size,
    2,
  );
  assert.ok(
    network
      .listNodes()
      .every(
        (node) =>
          node.temperatureK > 0 &&
          node.heatCapacityJPerK > 0,
      ),
  );
  assert.ok(
    network
      .listPumps()
      .every(
        (pump) =>
          pump.lastMassFlowKgPerSecond > 0 &&
          pump.pressureRisePa > 0,
      ),
  );
});

test("the explicit energy ledger closes heat input, pump work, and space rejection", () => {
  const network = new CoolingThermalNetwork({ seed: "energy-ledger" });
  const result = network.step(600);
  const balance = network.getEnergyBalance();

  assert.ok(result.heatSourceInputJ > 0);
  assert.ok(result.pumpWorkInputJ > 0);
  assert.ok(result.radiatedToSpaceJ > 0);
  assertClose(
    result.nodeThermalEnergyChangeJ,
    result.heatSourceInputJ +
      result.pumpWorkInputJ -
      result.radiatedToSpaceJ +
      result.energyClosureErrorJ,
    1e-6,
    "step energy identity",
  );
  assert.ok(
    Math.abs(result.energyClosureErrorJ) < 20,
    `step energy residual was ${result.energyClosureErrorJ} J`,
  );
  assert.ok(
    Math.abs(balance.closureErrorJ) < 1,
    `cumulative ledger closure was ${balance.closureErrorJ} J`,
  );
  assert.ok(network.getSummary().totalRadiatedPowerW > 0);
});

test("electrical service is a causal pump input and survives restore", () => {
  const network = new CoolingThermalNetwork({
    seed: "pump-electrical-service",
  });
  network.synchronizePumpElectricalSupplyFraction("pump-a", 0);
  network.synchronizePumpElectricalSupplyFraction("pump-b", 0.5);
  const result = network.step(60);
  const pumpA = network
    .listPumps()
    .find((pump) => pump.id === "pump-a");
  const pumpB = network
    .listPumps()
    .find((pump) => pump.id === "pump-b");
  assert.equal(pumpA.electricalSupplyFraction, 0);
  assert.equal(pumpA.lastMassFlowKgPerSecond, 0);
  assert.equal(pumpA.lastElectricalPowerW, 0);
  assert.equal(pumpB.electricalSupplyFraction, 0.5);
  assert.equal(pumpB.lastMassFlowKgPerSecond, 200);
  assert.ok(result.pumpWorkInputJ > 0);
  assert.ok(Math.abs(result.energyClosureErrorJ) < 20);

  const restored = CoolingThermalNetwork.restore(network.snapshot());
  assert.deepEqual(restored.snapshot(), network.snapshot());
});

test("external heat and temperature overrides remain explicit in the energy ledger", () => {
  const network = new CoolingThermalNetwork({
    seed: "external-energy",
  });
  const busBefore = network.getNode("thermal-bus");
  const injected = network.applyExternalEnergy(
    "thermal-bus",
    2_500_000_000,
    "propulsion",
  );
  assert.equal(injected.appliedEnergyJ, 2_500_000_000);
  assertClose(
    network.getNode("thermal-bus").temperatureK,
    busBefore.temperatureK +
      2_500_000_000 / busBefore.heatCapacityJPerK,
    1e-12,
    "thermal bus external energy",
  );
  const defaultIntervention = network.applyExternalEnergy(
    "thermal-bus",
    125_000_000,
  );
  assert.equal(defaultIntervention.appliedEnergyJ, 125_000_000);

  const coolantBefore = network
    .listNodes()
    .filter(
      (node) => node.id === "coolant-a" || node.id === "coolant-b",
    );
  const targetTemperatureK = 335;
  const overridden = network.setNodeTemperatures(
    coolantBefore.map((node) => ({
      nodeId: node.id,
      temperatureK: targetTemperatureK,
    })),
  );
  const expectedOverrideEnergyJ = coolantBefore.reduce(
    (total, node) =>
      total +
      (targetTemperatureK - node.temperatureK) *
        node.heatCapacityJPerK,
    0,
  );
  assertClose(
    overridden.appliedEnergyJ,
    expectedOverrideEnergyJ,
    1e-6,
    "coolant override energy",
  );
  assertClose(
    network.getEnergyBalance().externalEnergyJ,
    2_625_000_000 + expectedOverrideEnergyJ,
    1e-6,
    "cumulative external ledger",
  );
  assert.deepEqual(
    network.getEnergyBalance().externalEnergyBySourceJ,
    {
      propulsion: 2_500_000_000,
      "jump-drive": 0,
      "electrical-loss": 0,
      metabolic: 0,
      "rotation-drive": 0,
      "ship-services": 0,
      intervention: 125_000_000 + expectedOverrideEnergyJ,
    },
  );
  assert.ok(Math.abs(network.getEnergyBalance().closureErrorJ) < 1);
  assert.deepEqual(
    CoolingThermalNetwork.restore(network.serialize()).snapshot(),
    network.snapshot(),
  );
});

test("pump seizure and exchanger degradation create causal thermal consequences", () => {
  const nominal = new CoolingThermalNetwork({ seed: "fault-comparison" });
  const oneLoop = CoolingThermalNetwork.restore(nominal.snapshot());
  const noForcedLoops = CoolingThermalNetwork.restore(nominal.snapshot());
  const degradedExchanger = CoolingThermalNetwork.restore(nominal.snapshot());

  oneLoop.configurePump("pump-a", { condition: "stuck-off" });
  noForcedLoops.configurePump("pump-a", { condition: "stuck-off" });
  noForcedLoops.configurePump("pump-b", { condition: "stuck-off" });
  degradedExchanger.configureHeatExchanger("heat-exchanger-a", {
    condition: "degraded",
  });

  nominal.step(3_600);
  oneLoop.step(3_600);
  noForcedLoops.step(3_600);
  degradedExchanger.step(3_600);

  const nominalBus = nominal.getNode("thermal-bus").temperatureK;
  const oneLoopBus = oneLoop.getNode("thermal-bus").temperatureK;
  const noForcedBus = noForcedLoops.getNode("thermal-bus").temperatureK;
  const degradedBus =
    degradedExchanger.getNode("thermal-bus").temperatureK;

  assert.equal(oneLoop.listPumps()[0].lastMassFlowKgPerSecond, 0);
  assert.equal(noForcedLoops.getSummary().activeLoopCount, 0);
  assert.ok(oneLoopBus > nominalBus);
  assert.ok(noForcedBus > oneLoopBus);
  assert.ok(degradedBus > nominalBus);
  assert.ok(
    noForcedLoops.listHeatExchangers()[0].lastHeatTransferW > 0,
    "a seized pump leaves only explicit natural circulation",
  );
  assert.ok(
    noForcedLoops.listHeatExchangers()[0].lastHeatTransferW <
      nominal.listHeatExchangers()[0].lastHeatTransferW,
  );
});

test("radiator state changes rejection through area and conductance, never by forcing temperature", () => {
  const nominal = new CoolingThermalNetwork({ seed: "radiator-fault" });
  const stowed = CoolingThermalNetwork.restore(nominal.snapshot());
  const temperatureBefore = stowed.getNode("radiator-a").temperatureK;

  stowed.configureRadiator("radiator-wing-a", { condition: "stowed" });
  assert.equal(
    stowed.getNode("radiator-a").temperatureK,
    temperatureBefore,
  );

  nominal.step(1_800);
  const result = stowed.step(1_800);
  assert.ok(result.radiatedToSpaceJ > 0);
  assert.ok(
    stowed.listRadiators()[0].lastRadiatedPowerW <
      nominal.listRadiators()[0].lastRadiatedPowerW,
  );
  assert.ok(
    stowed.getNode("thermal-bus").temperatureK >
      nominal.getNode("thermal-bus").temperatureK,
  );
});

test("thermal sensors are delayed observations with bias, drift, and hardware faults", () => {
  const network = new CoolingThermalNetwork({ seed: "sensor-modes" });
  const initialTruth = network.getNode("thermal-bus").temperatureK;
  network.configureSensor(BUS_SENSOR, {
    sampleIntervalMicroseconds: COOLING_MICROSECONDS_PER_SECOND,
    delayMicroseconds: 2 * COOLING_MICROSECONDS_PER_SECOND,
    noiseStandardDeviation: 0,
    bias: 1,
    driftPerSecond: 0.5,
    condition: "nominal",
  });

  network.step(1);
  assert.equal(network.getSensorReading(BUS_SENSOR), null);
  network.step(1);
  const first = network.getSensorReading(BUS_SENSOR);
  assert.equal(first.sampledAtMicroseconds, 0);
  assertClose(first.value, initialTruth + 1, 1e-10, "delayed biased sample");
  assert.notEqual(first.value, network.getNode("thermal-bus").temperatureK);

  network.configureSensor(BUS_SENSOR, {
    delayMicroseconds: 0,
    condition: "stuck",
    stuckValue: 42,
  });
  assert.deepEqual(network.getSensorReading(BUS_SENSOR), {
    sensorId: BUS_SENSOR,
    targetId: "thermal-bus",
    quantity: "temperatureK",
    sampledAtMicroseconds: 2 * COOLING_MICROSECONDS_PER_SECOND,
    availableAtMicroseconds: 2 * COOLING_MICROSECONDS_PER_SECOND,
    value: 42,
    quality: "stuck",
  });

  network.configureSensor(BUS_SENSOR, {
    condition: "offline",
    stuckValue: null,
  });
  const offline = network.getSensorReading(BUS_SENSOR);
  assert.equal(offline.value, null);
  assert.equal(offline.quality, "offline");
});

test("snapshot restore preserves faults, delayed readings, and PRNG continuation exactly", () => {
  const original = new CoolingThermalNetwork({ seed: "restore-noise" });
  original.configurePump("pump-b", {
    commandedSpeedFraction: 0.63,
    condition: "degraded",
  });
  original.configureHeatExchanger("heat-exchanger-a", {
    conductanceFraction: 0.72,
  });
  original.configureSensor(BUS_SENSOR, {
    sampleIntervalMicroseconds: 700_000,
    delayMicroseconds: 1_300_000,
    noiseStandardDeviation: 0.8,
    bias: -0.2,
    driftPerSecond: 0.003,
    condition: "degraded",
  });
  original.step(13.4);

  const restored = CoolingThermalNetwork.restore(original.serialize());
  const originalResult = original.step(1_237.65);
  const restoredResult = restored.step(1_237.65);

  assert.deepEqual(restoredResult, originalResult);
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.deepEqual(
    restored.getSensorReading(BUS_SENSOR),
    original.getSensorReading(BUS_SENSOR),
  );
});

test("strict restore rejects topology, physical, unknown-field, and energy-ledger corruption", () => {
  const baseline = new CoolingThermalNetwork({ seed: "strict" }).snapshot();

  const extraRootKey = structuredClone(baseline);
  extraRootKey.magicTemperatureOverride = 1;
  assert.throws(
    () => validateCoolingSnapshot(extraRootKey),
    /unexpected keys/,
  );

  const missingLoop = structuredClone(baseline);
  missingLoop.loops.pop();
  assert.throws(
    () => CoolingThermalNetwork.restore(missingLoop),
    /exactly 2 entities/,
  );

  const negativeCapacity = structuredClone(baseline);
  negativeCapacity.nodes[0].heatCapacityJPerK = -1;
  assert.throws(
    () => CoolingThermalNetwork.restore(negativeCapacity),
    /greater than zero/,
  );

  const forcedTemperature = structuredClone(baseline);
  forcedTemperature.nodes[0].temperatureK += 100;
  assert.throws(
    () => CoolingThermalNetwork.restore(forcedTemperature),
    /energy ledger does not reconcile/,
  );

  const invalidSensorTopology = structuredClone(baseline);
  invalidSensorTopology.sensors[0].targetId = "invented-node";
  assert.throws(
    () => CoolingThermalNetwork.restore(invalidSensorTopology),
    /targetId must be thermal-bus/,
  );

  const oldSnapshotVersion = structuredClone(baseline);
  oldSnapshotVersion.snapshotVersion = 3;
  assert.throws(
    () => CoolingThermalNetwork.restore(oldSnapshotVersion),
    /unsupported cooling snapshot version/,
  );

  const missingExternalSource = structuredClone(baseline);
  delete missingExternalSource.ledger.externalEnergyBySourceJ.propulsion;
  assert.throws(
    () => CoolingThermalNetwork.restore(missingExternalSource),
    /externalEnergyBySourceJ has unexpected keys/,
  );

  const inventedExternalSource = structuredClone(baseline);
  inventedExternalSource.ledger.externalEnergyBySourceJ["invented-source"] = 0;
  assert.throws(
    () => CoolingThermalNetwork.restore(inventedExternalSource),
    /externalEnergyBySourceJ has unexpected keys/,
  );

  const mismatchedExternalClassification = structuredClone(baseline);
  mismatchedExternalClassification.ledger.externalEnergyBySourceJ.propulsion =
    1_000_000;
  assert.throws(
    () => CoolingThermalNetwork.restore(mismatchedExternalClassification),
    /does not reconcile with externalEnergyJ/,
  );

  const fabricatedClassifiedExternalEnergy = structuredClone(baseline);
  fabricatedClassifiedExternalEnergy.ledger.externalEnergyJ = 1_000_000;
  fabricatedClassifiedExternalEnergy.ledger.externalEnergyBySourceJ.propulsion =
    1_000_000;
  assert.throws(
    () => CoolingThermalNetwork.restore(fabricatedClassifiedExternalEnergy),
    /energy ledger does not reconcile/,
  );
});

test("a six-hour high-rate step remains fast, deterministic, and energy bounded", () => {
  const original = new CoolingThermalNetwork({ seed: "six-hour-cooling" });
  const startedAt = performance.now();
  const result = original.step(21_600);
  const elapsedMilliseconds = performance.now() - startedAt;

  assert.equal(result.toMicroseconds, 21_600 * COOLING_MICROSECONDS_PER_SECOND);
  assert.ok(result.substeps >= 4_320);
  assert.ok(
    elapsedMilliseconds < 1_000,
    `six-hour cooling step took ${elapsedMilliseconds.toFixed(1)} ms`,
  );
  assert.ok(
    Math.abs(result.energyClosureErrorJ) < 100,
    `six-hour residual was ${result.energyClosureErrorJ} J`,
  );
  assert.ok(
    Math.abs(original.getEnergyBalance().closureErrorJ) < 1,
  );

  const restored = CoolingThermalNetwork.restore(original.serialize());
  const originalContinuation = original.step(3_600);
  const restoredContinuation = restored.step(3_600);
  assert.deepEqual(restoredContinuation, originalContinuation);
  assert.deepEqual(restored.snapshot(), original.snapshot());
});
