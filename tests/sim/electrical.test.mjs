import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  ELECTRICAL_BATTERY_IDS,
  ELECTRICAL_BREAKER_IDS,
  ELECTRICAL_BUS_IDS,
  ELECTRICAL_LOAD_IDS,
  ELECTRICAL_MICROSECONDS_PER_SECOND,
  FUSION_REACTOR_IDS,
  ShipElectricalNetwork,
  assignTwoBusNetTransferPowerKwForRegressionTest,
  validateElectricalSnapshot,
} from "../../lib/sim/electrical.ts";

const BUS_A_VOLTAGE_SENSOR = "sensor:bus-a:voltageV";

function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

test("baseline is a 4+2 fusion plant on redundant buses with tiered loads and storage", () => {
  const network = new ShipElectricalNetwork({ seed: "topology" });
  const summary = network.getSummary();

  assert.deepEqual(
    network.listReactors().map((reactor) => reactor.id),
    FUSION_REACTOR_IDS,
  );
  assert.deepEqual(
    network.listBuses().map((bus) => bus.id),
    ELECTRICAL_BUS_IDS,
  );
  assert.deepEqual(
    network.listBreakers().map((breaker) => breaker.id),
    ELECTRICAL_BREAKER_IDS,
  );
  assert.deepEqual(
    network.listLoads().map((load) => load.id),
    ELECTRICAL_LOAD_IDS,
  );
  assert.deepEqual(
    network.listBatteries().map((battery) => battery.id),
    ELECTRICAL_BATTERY_IDS,
  );
  assert.equal(summary.onlineReactorCount, 4);
  assert.equal(summary.hotStandbyReactorCount, 2);
  assert.equal(summary.generationPowerKw, 842_000);
  assert.equal(summary.demandedPowerKw, 835_000);
  assert.equal(summary.servedPowerKw, 835_000);
  assert.equal(summary.curtailedGenerationKw, 7_000);
  assert.equal(summary.batteryCapacityKWh, 7_200_000);
  assert.equal(summary.batteryStoredEnergyKWh, 2_400_000);
  assert.equal(summary.powerBalanceErrorKw, 0);
  assert.deepEqual(
    new Set(network.listLoads().map((load) => load.tier)),
    new Set(["critical", "essential", "discretionary", "jump"]),
  );
});

test("external generation authority changes reactor outputs and remains auditable", () => {
  const network = new ShipElectricalNetwork({
    seed: "external-generation",
  });
  const storedBefore = network.getEnergyBalance().storedEnergyKWh;
  const summary = network.applyExternalGenerationPower(
    650_000,
    "god-mode test",
  );

  assert.equal(summary.generationPowerKw, 650_000);
  assert.equal(
    network
      .listReactors()
      .reduce((total, reactor) => total + reactor.outputKw, 0),
    650_000,
  );
  assert.equal(
    network.getEnergyBalance().storedEnergyKWh,
    storedBefore,
  );
  assert.equal(
    network.getControlLog().at(-1).type,
    "external-generation-force",
  );
  assert.deepEqual(
    ShipElectricalNetwork.restore(network.snapshot()).snapshot(),
    network.snapshot(),
  );
});

test("external generation force after stepped loads keeps bus local power balanced", () => {
  const network = new ShipElectricalNetwork({
    seed: "god-mode-force-after-step",
  });
  network.step(3_600);
  const summary = network.applyExternalGenerationPower(
    650_000,
    "god-mode regression",
  );

  assert.equal(summary.generationPowerKw, 650_000);
  for (const bus of network.listBuses()) {
    const localPowerErrorKw =
      bus.generationPowerKw +
      bus.batteryPowerKw +
      bus.netTransferPowerKw -
      bus.servedPowerKw -
      bus.curtailedPowerKw;
    assert.ok(
      Math.abs(localPowerErrorKw) <= 1e-6,
      `${bus.id} local power must reconcile after forced generation`,
    );
  }
});

test("two-bus net transfer assignment survives curtailed-generation float split", () => {
  const network = new ShipElectricalNetwork({
    seed: "net-transfer-float-edge",
  });
  const busA = { ...network.getBus("bus-a") };
  const busB = { ...network.getBus("bus-b") };
  Object.assign(busA, {
    generationPowerKw: 420_000,
    servedPowerKw: 417_500,
    curtailedPowerKw: 2_500,
    batteryPowerKw: 0,
    netTransferPowerKw: 0,
  });
  Object.assign(busB, {
    generationPowerKw: 420_168,
    servedPowerKw: 417_500,
    curtailedPowerKw: 2_501,
    batteryPowerKw: 0,
    netTransferPowerKw: 0,
  });

  assignTwoBusNetTransferPowerKwForRegressionTest(busA, busB);

  assert.equal(busA.netTransferPowerKw, 0);
  assert.equal(busB.netTransferPowerKw, -167);
  for (const bus of [busA, busB]) {
    const localPowerErrorKw =
      bus.generationPowerKw +
      bus.batteryPowerKw +
      bus.netTransferPowerKw -
      bus.servedPowerKw -
      bus.curtailedPowerKw;
    assert.ok(
      Math.abs(localPowerErrorKw) <= 1e-6,
      `${bus.id} local power must reconcile after tie-flow assignment`,
    );
  }
});

test("controller demand fractions and per-load energy expose real downstream service", () => {
  const network = new ShipElectricalNetwork({
    seed: "controller-demand",
  });
  network.synchronizeLoadControllerDemandFraction(
    "jump-drive-a",
    0.25,
  );
  network.synchronizeLoadControllerDemandFraction(
    "jump-drive-b",
    0.25,
  );
  const result = network.step(3_600);
  assertClose(
    result.demandedLoadEnergyKWhById["jump-drive-a"],
    30_000,
    1e-9,
    "jump drive A demanded energy",
  );
  assertClose(
    result.servedLoadEnergyKWhById["jump-drive-a"],
    30_000,
    1e-9,
    "jump drive A served energy",
  );
  assertClose(
    result.demandedLoadEnergyKWhById["jump-drive-b"],
    30_000,
    1e-9,
    "jump drive B demanded energy",
  );

  network.executeControlCommand({
    type: "set-load-enabled",
    loadId: "life-support-a",
    enabled: false,
  });
  assert.equal(
    network.getSummary().criticalServiceFraction,
    0.65,
    "an intentionally disconnected persistent critical load is still unmet service",
  );
  const restored = ShipElectricalNetwork.restore(network.snapshot());
  assert.equal(
    restored.getLoad("jump-drive-a").controllerDemandFraction,
    0.25,
  );
});

test("physical need and controller-requested tier service remain distinct", () => {
  const network = new ShipElectricalNetwork({
    seed: "tier-service-semantics",
  });
  network.synchronizeLoadControllerDemandFraction(
    "hibernation-a",
    0.25,
  );
  network.synchronizeLoadControllerDemandFraction(
    "hibernation-b",
    0.25,
  );

  network.step(60);

  const criticalLoads = network
    .listLoads()
    .filter((load) => load.tier === "critical");
  assert.ok(
    criticalLoads.every(
      (load) =>
        load.servedPowerKw ===
        load.demandedPowerKw * load.controllerDemandFraction,
    ),
    "every controller-requested critical watt must be served",
  );
  const service =
    network.getTierServiceFractions("critical");
  assertClose(
    service.physicalServiceFraction,
    0.775,
    1e-12,
    "critical physical service",
  );
  assertClose(
    service.controllerRequestedServiceFraction,
    1,
    1e-12,
    "critical controller-requested service",
  );
  assertClose(
    network.getSummary().criticalServiceFraction,
    service.physicalServiceFraction,
    1e-12,
    "legacy summary remains the physical service metric",
  );
});

test("power dispatch charges batteries and the cumulative energy ledger closes", () => {
  const network = new ShipElectricalNetwork({ seed: "energy-ledger" });
  const result = network.step(600);
  const balance = network.getEnergyBalance();
  const summary = network.getSummary();

  assert.ok(result.reactorGenerationKWh > 0);
  assert.ok(result.servedLoadKWh > 0);
  assert.ok(result.batteryChargeInputKWh > 0);
  assert.ok(result.batteryConversionLossKWh > 0);
  assert.equal(result.batteryDischargeOutputKWh, 0);
  assertClose(
    result.storedEnergyChangeKWh,
    result.reactorGenerationKWh -
      result.servedLoadKWh -
      result.curtailedGenerationKWh -
      result.batteryConversionLossKWh +
      result.energyClosureErrorKWh,
    1e-9,
    "step energy identity",
  );
  assert.ok(Math.abs(result.energyClosureErrorKWh) < 1e-6);
  assert.ok(Math.abs(balance.closureErrorKWh) < 1e-6);
  assert.equal(summary.batteryNetPowerKw, -7_000);
  assert.equal(summary.curtailedGenerationKw, 0);
  assert.equal(summary.powerBalanceErrorKw, 0);
});

test("zero-duration redispatch uses available batteries without integrating energy", () => {
  const network = new ShipElectricalNetwork({
    seed: "instantaneous-battery-bridge",
  });
  const before = network.snapshot();

  network.tripReactor(
    "fusion-1",
    "instantaneous feasibility regression",
  );

  const after = network.snapshot();
  const summary = network.getSummary();
  assert.equal(network.elapsedMicroseconds, 0);
  assert.equal(summary.unservedPowerKw, 0);
  assert.equal(summary.batteryNetPowerKw, 203_500);
  assert.equal(summary.powerBalanceErrorKw, 0);
  assert.deepEqual(after.ledger, before.ledger);
  for (const [index, battery] of after.batteries.entries()) {
    assert.equal(
      battery.storedEnergyKWh,
      before.batteries[index].storedEnergyKWh,
    );
    assert.equal(
      battery.throughputKWh,
      before.batteries[index].throughputKWh,
    );
    assert.equal(
      battery.conversionLossKWh,
      before.batteries[index].conversionLossKWh,
    );
  }
  assert.equal(after.batteries[0].lastPowerKw, 180_000);
  assert.equal(after.batteries[1].lastPowerKw, 23_500);
});

test("reactor protection trips its generator breaker and batteries bridge the deficit", () => {
  const network = new ShipElectricalNetwork({ seed: "reactor-trip" });
  const storedBefore = network.getSummary().batteryStoredEnergyKWh;

  network.tripReactor("fusion-1", "plasma confinement excursion");

  assert.deepEqual(network.getReactor("fusion-1"), {
    ...network.getReactor("fusion-1"),
    mode: "offline",
    condition: "tripped",
    targetOutputKw: 0,
    outputKw: 0,
    tripReason: "plasma confinement excursion",
  });
  const reactorBreaker = network.getBreaker("breaker:fusion-1");
  assert.equal(reactorBreaker.condition, "tripped");
  assert.equal(reactorBreaker.commandedClosed, false);
  assert.equal(reactorBreaker.currentPowerKw, 0);
  assert.throws(
    () =>
      network.executeControlCommand({
        type: "set-breaker",
        breakerId: "breaker:fusion-1",
        commandedClosed: true,
      }),
    /must be reset/,
  );

  const result = network.step(3_600);
  const summary = network.getSummary();
  assert.ok(result.batteryDischargeOutputKWh > 0);
  assert.ok(summary.batteryStoredEnergyKWh < storedBefore);
  assert.equal(summary.criticalServiceFraction, 1);
  assert.equal(summary.essentialServiceFraction, 1);
  assert.equal(summary.unservedPowerKw, 0);
  assert.equal(summary.powerBalanceErrorKw, 0);
  assert.equal(network.getControlLog()[0].type, "reactor-trip");
});

test("load allocation sheds lower tiers before critical services", () => {
  const network = new ShipElectricalNetwork({ seed: "load-shedding" });
  for (const reactorId of FUSION_REACTOR_IDS.slice(0, 4)) {
    network.tripReactor(reactorId, "common-mode fuel control test");
  }

  network.step(3_600);

  const criticalLoads = network
    .listLoads()
    .filter((load) => load.tier === "critical");
  const discretionaryAndJump = network
    .listLoads()
    .filter(
      (load) => load.tier === "discretionary" || load.tier === "jump",
    );
  assert.ok(
    criticalLoads.every(
      (load) => load.servedPowerKw === load.demandedPowerKw,
    ),
  );
  assert.ok(
    discretionaryAndJump.every((load) => load.servedPowerKw === 0),
  );
  assert.equal(network.getSummary().criticalServiceFraction, 1);
  assertClose(
    network.getSummary().essentialServiceFraction,
    60_000 / 135_000,
    1e-12,
    "essential service includes both ring drive feeders",
  );
  assert.equal(network.getSummary().unservedPowerKw, 475_000);
});

test("opening the bus tie creates two causal islands and prevents remote support", () => {
  const network = new ShipElectricalNetwork({ seed: "islanding" });
  network.executeControlCommand({
    type: "set-breaker",
    breakerId: "breaker:bus-tie",
    commandedClosed: false,
  });
  network.tripReactor("fusion-1", "scheduled islanding test");
  network.tripReactor("fusion-2", "scheduled islanding test");
  network.step(600);

  const busA = network.getBus("bus-a");
  const busB = network.getBus("bus-b");
  assert.equal(busA.netTransferPowerKw, 0);
  assert.equal(busB.netTransferPowerKw, 0);
  assert.ok(busA.unservedPowerKw > 0);
  assert.equal(busB.unservedPowerKw, 0);
  assert.equal(network.getBreaker("breaker:bus-tie").currentPowerKw, 0);
  assert.ok(network.getBattery("battery-a").lastPowerKw > 0);
  assert.ok(network.getBattery("battery-b").lastPowerKw < 0);
});

test("hot-spare startup, reactor ramp and breaker closure require explicit controls", () => {
  const network = new ShipElectricalNetwork({ seed: "hot-spare" });
  network.tripReactor("fusion-1", "planned protection exercise");
  const generationAfterTrip = network.getSummary().generationPowerKw;

  network.executeControlCommand({
    type: "set-reactor-mode",
    reactorId: "fusion-5",
    mode: "online",
  });
  network.executeControlCommand({
    type: "set-reactor-target",
    reactorId: "fusion-5",
    targetOutputKw: 210_500,
  });
  network.executeControlCommand({
    type: "set-breaker",
    breakerId: "breaker:fusion-5",
    commandedClosed: true,
  });

  assert.equal(network.getReactor("fusion-5").outputKw, 0);
  network.step(10);
  assert.equal(network.getReactor("fusion-5").outputKw, 50_000);
  assert.equal(
    network.getSummary().generationPowerKw,
    generationAfterTrip + 50_000,
  );
  network.step(40);
  assert.equal(network.getReactor("fusion-5").outputKw, 210_500);
  assert.equal(network.getSummary().generationPowerKw, 842_000);
  assert.deepEqual(
    network.getControlLog().slice(-3).map((record) => record.type),
    ["set-reactor-mode", "set-reactor-target", "set-breaker"],
  );
});

test("breaker and battery faults change connectivity and available power without editing loads", () => {
  const network = new ShipElectricalNetwork({ seed: "protection" });
  const batteryEnergyBefore = network.getBattery("battery-a").storedEnergyKWh;

  network.tripBreaker(
    "breaker:life-support-a",
    "differential protection pickup",
  );
  network.setBatteryFault(
    "battery-a",
    "thermal-lockout",
    "module temperature above interlock",
  );
  network.tripReactor("fusion-1", "fault cascade");
  network.tripReactor("fusion-2", "fault cascade");
  network.executeControlCommand({
    type: "set-breaker",
    breakerId: "breaker:bus-tie",
    commandedClosed: false,
  });
  network.step(60);

  assert.equal(network.getLoad("life-support-a").servedPowerKw, 0);
  assert.equal(network.getLoad("life-support-a").unservedPowerKw, 0);
  assert.equal(network.getBattery("battery-a").lastPowerKw, 0);
  assert.equal(
    network.getBattery("battery-a").storedEnergyKWh,
    batteryEnergyBefore,
  );
  assert.equal(network.getBus("bus-a").energized, false);
  assert.equal(network.getBus("bus-a").voltageV, 0);
});

test("electrical sensors are delayed noisy observations and can fail independently", () => {
  const network = new ShipElectricalNetwork({ seed: "sensor-modes" });
  const initialTruth = network.getBus("bus-a").voltageV;
  network.configureSensor(BUS_A_VOLTAGE_SENSOR, {
    sampleIntervalMicroseconds: ELECTRICAL_MICROSECONDS_PER_SECOND,
    delayMicroseconds: 2 * ELECTRICAL_MICROSECONDS_PER_SECOND,
    noiseStandardDeviation: 0,
    bias: 2,
    driftPerSecond: 0.5,
    condition: "nominal",
  });

  network.step(1);
  assert.equal(network.getSensorReading(BUS_A_VOLTAGE_SENSOR), null);
  network.step(1);
  const first = network.getSensorReading(BUS_A_VOLTAGE_SENSOR);
  assert.equal(first.sampledAtMicroseconds, 0);
  assertClose(first.value, initialTruth + 2, 1e-12, "delayed biased voltage");

  network.configureSensor(BUS_A_VOLTAGE_SENSOR, {
    delayMicroseconds: 0,
    condition: "stuck",
    stuckValue: 777,
  });
  assert.deepEqual(network.getSensorReading(BUS_A_VOLTAGE_SENSOR), {
    sensorId: BUS_A_VOLTAGE_SENSOR,
    targetId: "bus-a",
    quantity: "voltageV",
    sampledAtMicroseconds: 2 * ELECTRICAL_MICROSECONDS_PER_SECOND,
    availableAtMicroseconds: 2 * ELECTRICAL_MICROSECONDS_PER_SECOND,
    value: 777,
    quality: "stuck",
  });

  network.configureSensor(BUS_A_VOLTAGE_SENSOR, {
    condition: "offline",
    stuckValue: null,
  });
  const offline = network.getSensorReading(BUS_A_VOLTAGE_SENSOR);
  assert.equal(offline.value, null);
  assert.equal(offline.quality, "offline");
});

test("external battery energy is bounded and explicitly reconciled in the ledger", () => {
  const network = new ShipElectricalNetwork({ seed: "external-energy" });
  const result = network.applyExternalBatteryEnergy(
    "battery-a",
    25_000,
    "God-mode conservation-audited injection",
  );

  assert.equal(result.appliedEnergyKWh, 25_000);
  assert.equal(network.getEnergyBalance().externalEnergyKWh, 25_000);
  assert.ok(Math.abs(network.getEnergyBalance().closureErrorKWh) < 1e-9);
  assert.throws(
    () =>
      network.applyExternalBatteryEnergy(
        "battery-a",
        10_000_000,
        "out of bounds",
      ),
    /exceed battery bounds/,
  );
  assert.deepEqual(
    ShipElectricalNetwork.restore(network.serialize()).snapshot(),
    network.snapshot(),
  );
});

test("strict restore rejects topology, unknown fields, power and energy corruption", () => {
  const baseline = new ShipElectricalNetwork({ seed: "strict" }).snapshot();

  const extraRootKey = structuredClone(baseline);
  extraRootKey.magicPower = 1;
  assert.throws(
    () => validateElectricalSnapshot(extraRootKey),
    /unexpected keys/,
  );

  const missingReactor = structuredClone(baseline);
  missingReactor.reactors.pop();
  assert.throws(
    () => ShipElectricalNetwork.restore(missingReactor),
    /exactly 6 entities/,
  );

  const inventedTopology = structuredClone(baseline);
  inventedTopology.breakers[0].toId = "bus-b";
  assert.throws(
    () => ShipElectricalNetwork.restore(inventedTopology),
    /fixed breaker topology/,
  );

  const forcedBatteryEnergy = structuredClone(baseline);
  forcedBatteryEnergy.batteries[0].storedEnergyKWh += 100;
  assert.throws(
    () => ShipElectricalNetwork.restore(forcedBatteryEnergy),
    /energy ledger does not reconcile/,
  );

  const fabricatedLoadPower = structuredClone(baseline);
  fabricatedLoadPower.loads[0].servedPowerKw -= 1;
  fabricatedLoadPower.loads[0].unservedPowerKw += 1;
  assert.throws(
    () => ShipElectricalNetwork.restore(fabricatedLoadPower),
    /projection does not match|instantaneous power does not reconcile/,
  );
});

test("snapshot restore preserves faults, pending sensors and deterministic continuation", () => {
  const original = new ShipElectricalNetwork({ seed: "restore-noise" });
  original.tripReactor("fusion-2", "restore test");
  original.setBatteryFault("battery-b", "degraded", "restore test");
  original.configureSensor(BUS_A_VOLTAGE_SENSOR, {
    sampleIntervalMicroseconds: 700_000,
    delayMicroseconds: 1_300_000,
    noiseStandardDeviation: 0.8,
    bias: -0.2,
    driftPerSecond: 0.003,
    condition: "degraded",
  });
  original.step(13.4);

  const restored = ShipElectricalNetwork.restore(original.serialize());
  const originalResult = original.step(1_237.65);
  const restoredResult = restored.step(1_237.65);

  assert.deepEqual(restoredResult, originalResult);
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.deepEqual(
    restored.getSensorReading(BUS_A_VOLTAGE_SENSOR),
    original.getSensorReading(BUS_A_VOLTAGE_SENSOR),
  );
});

test("a six-hour step remains fast, deterministic and conservation bounded", () => {
  const original = new ShipElectricalNetwork({
    seed: "six-hour-electrical",
  });
  const startedAt = performance.now();
  const result = original.step(21_600);
  const elapsedMilliseconds = performance.now() - startedAt;

  assert.equal(
    result.toMicroseconds,
    21_600 * ELECTRICAL_MICROSECONDS_PER_SECOND,
  );
  assert.ok(result.substeps >= 2_160);
  assert.ok(
    elapsedMilliseconds < 1_000,
    `six-hour electrical step took ${elapsedMilliseconds.toFixed(1)} ms`,
  );
  assert.ok(
    Math.abs(result.energyClosureErrorKWh) < 1e-5,
    `six-hour residual was ${result.energyClosureErrorKWh} kWh`,
  );
  assert.ok(Math.abs(original.getEnergyBalance().closureErrorKWh) < 1e-6);
  assert.equal(original.getSummary().powerBalanceErrorKw, 0);

  const restored = ShipElectricalNetwork.restore(original.serialize());
  const originalContinuation = original.step(3_600);
  const restoredContinuation = restored.step(3_600);
  assert.deepEqual(restoredContinuation, originalContinuation);
  assert.deepEqual(restored.snapshot(), original.snapshot());
});
