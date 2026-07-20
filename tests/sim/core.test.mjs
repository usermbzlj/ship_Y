import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicEventQueue,
  MICROSECONDS_PER_SECOND,
  SeededRandom,
  SIMULATION_SNAPSHOT_VERSION,
  SimulationEngine,
} from "../../lib/sim/index.ts";

const zeroBalance = {
  massKg: 0,
  energyJ: 0,
  linearMomentumKgMPerSecond: [0, 0, 0],
  angularMomentumKgM2PerSecond: [0, 0, 0],
  note: "Test-only external override",
};

test("seeded random streams and restored streams are identical", () => {
  const first = new SeededRandom("voyage-17");
  const second = new SeededRandom("voyage-17");

  assert.deepEqual(
    Array.from({ length: 8 }, () => first.nextUint32()),
    Array.from({ length: 8 }, () => second.nextUint32()),
  );

  const snapshot = first.snapshot();
  const restored = SeededRandom.fromSnapshot(snapshot);
  assert.equal(first.nextUint32(), restored.nextUint32());
  assert.equal(first.next(), restored.next());
});

test("event queue orders by time, priority, then insertion sequence", () => {
  const queue = new DeterministicEventQueue();
  queue.schedule({
    type: "marker",
    atMicroseconds: 20,
    priority: 0,
    payload: { label: "later" },
  });
  queue.schedule({
    type: "marker",
    atMicroseconds: 10,
    priority: 1,
    payload: { label: "normal" },
  });
  queue.schedule({
    type: "marker",
    atMicroseconds: 10,
    priority: 5,
    payload: { label: "urgent" },
  });

  assert.deepEqual(
    queue.popDue(10).map((event) => event.payload.label),
    ["urgent", "normal"],
  );
  assert.equal(queue.peek().payload.label, "later");

  const restored = new DeterministicEventQueue();
  restored.restore(queue.snapshot());
  assert.deepEqual(restored.snapshot(), queue.snapshot());
});

test("time scale and multi-rate systems advance on deterministic boundaries", () => {
  const engine = new SimulationEngine({ seed: 42, timeScale: 10 });
  const result = engine.step(6);

  assert.equal(result.toMicroseconds, 60 * MICROSECONDS_PER_SECOND);
  assert.deepEqual(result.systemRuns, {
    power: 60,
    thermal: 30,
    atmosphere: 12,
    water: 1,
    environment: 1,
    population: 1,
    hibernation: 1,
    journey: 1,
  });
  assert.equal(engine.elapsedSeconds, 60);

  const state = engine.getState();
  assert.ok(state.water.recycledKgCumulative > 0);
  assert.ok(state.journey.jumpDriveChargeKWh > 2_400_000);
});

test("sliced real-time stepping preserves clock fractions and aggregate results", () => {
  const direct = new SimulationEngine({
    seed: "sliced-clock",
    timeScale: 2.75,
  });
  const sliced = new SimulationEngine({
    seed: "sliced-clock",
    timeScale: 2.75,
  });
  const slices = [];

  const directFirst = direct.step(61.234567);
  const slicedFirst = sliced.stepSliced(
    61.234567,
    17,
    (slice) => slices.push(slice),
  );
  assert.deepEqual(slicedFirst, directFirst);
  assert.ok(slices.length > 1);
  assert.ok(
    slices.every(
      (slice) => slice.simulatedSeconds > 0 &&
        slice.simulatedSeconds <= 17,
    ),
  );
  for (let index = 1; index < slices.length; index += 1) {
    assert.equal(
      slices[index].fromMicroseconds,
      slices[index - 1].toMicroseconds,
    );
  }
  assert.deepEqual(sliced.snapshot(), direct.snapshot());

  assert.deepEqual(
    sliced.stepSliced(0.0000003, 17),
    direct.step(0.0000003),
  );
  assert.deepEqual(sliced.snapshot(), direct.snapshot());
});

test("dynamic slice limits can tighten a common clock without losing time", () => {
  const direct = new SimulationEngine({
    seed: "dynamic-slice-limit",
  });
  const sliced = new SimulationEngine({
    seed: "dynamic-slice-limit",
  });
  const durations = [];
  const expected = direct.step(7);
  const actual = sliced.stepSliced(
    7,
    ({ fromMicroseconds }) =>
      fromMicroseconds < 3_000_000 ? 3 : 1,
    (slice) => durations.push(slice.simulatedSeconds),
  );

  assert.deepEqual(durations, [3, 1, 1, 1, 1]);
  assert.deepEqual(actual, expected);
  assert.deepEqual(sliced.snapshot(), direct.snapshot());
});

test("snapshot restore produces an exact deterministic continuation", () => {
  const original = new SimulationEngine({
    seed: "same-voyage",
    timeScale: 4,
  });
  original.scheduleEvent({
    type: "sensor.marker",
    atMicroseconds: 75 * MICROSECONDS_PER_SECOND,
    payload: { sensor: "R-12", observation: 0.42 },
  });
  original.step(12.5);

  const restored = SimulationEngine.restore(original.serialize());
  const originalResult = original.step(25);
  const restoredResult = restored.step(25);

  assert.deepEqual(restoredResult, originalResult);
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.equal(restored.serialize(), original.serialize());
});

test("external interventions are atomic, audited, and cannot mutate snapshots", () => {
  const engine = new SimulationEngine();
  const detachedState = engine.getState();
  detachedState.power.generationKw = 1;
  assert.equal(engine.getState().power.generationKw, 842_000);

  const applied = engine.applyExternalIntervention({
    actor: "god-mode:test",
    reason: "Simulate total generator trip",
    operations: [
      {
        operation: "set",
        path: "power.generationKw",
        value: 0,
      },
    ],
    declaredBalance: {
      ...zeroBalance,
      energyJ: -345_600_000_000,
    },
  });
  assert.equal(applied.status, "applied");
  assert.equal(applied.operations[0].before, 842_000);
  assert.equal(engine.getState().power.generationKw, 0);

  assert.throws(
    () =>
      engine.applyExternalIntervention({
        actor: "god-mode:test",
        reason: "Try an impossible population edit",
        operations: [
          {
            operation: "add",
            path: "population.awake",
            value: 1,
          },
        ],
        declaredBalance: zeroBalance,
      }),
    /population counts do not reconcile/,
  );

  assert.equal(engine.getState().population.awake, 218);
  assert.deepEqual(
    engine.getInterventionLedger().map((entry) => entry.status),
    ["applied", "rejected"],
  );
});

test("scheduled god-mode interventions execute before systems at the same time", () => {
  const engine = new SimulationEngine();
  engine.scheduleIntervention(MICROSECONDS_PER_SECOND, {
    actor: "god-mode:test",
    reason: "Trip generation at the first power boundary",
    operations: [
      {
        operation: "set",
        path: "power.generationKw",
        value: 0,
      },
    ],
    declaredBalance: zeroBalance,
  });

  const result = engine.stepSimulation(1);
  assert.equal(result.processedEvents[0].outcome, "intervention-applied");
  assert.equal(result.systemRuns.power, 1);
  assert.ok(engine.getState().power.batteryChargeKWh < 2_400_000);
  assert.equal(engine.getInterventionLedger().length, 1);
});

test("a jump consumes stored energy, deposits waste heat, and advances the route", () => {
  const engine = new SimulationEngine();
  engine.applyExternalIntervention({
    actor: "test-fixture",
    reason: "Prepare a fully charged drive for a command-path test",
    operations: [
      {
        operation: "set",
        path: "journey.jumpDriveChargeKWh",
        value: 6_000_000,
      },
      {
        operation: "set",
        path: "journey.status",
        value: "ready",
      },
    ],
    declaredBalance: {
      ...zeroBalance,
      energyJ: 12_960_000_000_000,
    },
  });

  const before = engine.getState();
  const result = engine.executeJump(4.2);
  const after = engine.getState();

  assert.equal(result.distanceLightYears, 4.2);
  assert.equal(after.journey.completedDistanceLightYears, 4.2);
  assert.equal(after.journey.jumpsCompleted, 1);
  assert.equal(after.journey.status, "charging");
  assert.ok(after.journey.jumpDriveChargeKWh < before.journey.jumpDriveChargeKWh);
  assert.ok(after.thermal.coolantTemperatureK > before.thermal.coolantTemperatureK);
});

test("aggregate population can only synchronize to a reconciled individual roster", () => {
  const engine = new SimulationEngine();
  engine.synchronizePopulationCounts({
    awake: 220,
    hibernating: 1_900,
    deceased: 0,
  });
  assert.equal(engine.getState().population.awake, 220);
  assert.equal(engine.getState().hibernation.occupiedPods, 1_900);

  assert.throws(
    () =>
      engine.synchronizePopulationCounts({
        awake: 220,
        hibernating: 1_899,
        deceased: 0,
      }),
    /match the aggregate population/,
  );
});

test("external roster authority prevents aggregate health and morale drift", () => {
  const engine = new SimulationEngine({
    populationAuthority: "external-roster",
  });
  engine.synchronizePopulationAverages({
    averageHealth: 0.731,
    averageMorale: 0.619,
  });
  const before = engine.getState().population;
  const result = engine.stepSimulation(3_600);

  assert.equal(result.systemRuns.population, 60);
  assert.deepEqual(engine.getState().population, before);
  assert.equal(SIMULATION_SNAPSHOT_VERSION, 6);
  assert.equal(engine.snapshot().snapshotVersion, 6);
  assert.equal(
    engine.snapshot().populationAuthority,
    "external-roster",
  );

  const restored = SimulationEngine.restore(engine.snapshot());
  assert.equal(
    restored.snapshot().populationAuthority,
    "external-roster",
  );
  restored.stepSimulation(3_600);
  assert.deepEqual(restored.getState().population, before);
});

test("invalid population authority is rejected in options and snapshots", () => {
  assert.throws(
    () =>
      new SimulationEngine({
        populationAuthority: "crew-manifest",
      }),
    /invalid population authority/,
  );

  const invalid = new SimulationEngine({
    populationAuthority: "external-roster",
  }).snapshot();
  invalid.populationAuthority = "crew-manifest";
  assert.throws(
    () => SimulationEngine.restore(invalid),
    /invalid population authority/,
  );

  const missing = new SimulationEngine().snapshot();
  delete missing.populationAuthority;
  assert.throws(
    () => SimulationEngine.restore(missing),
    /invalid population authority/,
  );
});

test("external atmosphere authority prevents duplicate aggregate metabolism", () => {
  const engine = new SimulationEngine({
    atmosphereAuthority: "external-network",
  });
  const before = engine.getState().atmosphere;
  const result = engine.stepSimulation(60);
  const after = engine.getState().atmosphere;

  assert.equal(result.systemRuns.atmosphere, 12);
  assert.deepEqual(after, before);
  assert.equal(
    engine.snapshot().atmosphereAuthority,
    "external-network",
  );

  const restored = SimulationEngine.restore(engine.snapshot());
  assert.equal(
    restored.snapshot().atmosphereAuthority,
    "external-network",
  );
  restored.stepSimulation(60);
  assert.deepEqual(restored.getState().atmosphere, before);
});

test("external water authority prevents duplicate use and accepts network projections", () => {
  const engine = new SimulationEngine({
    atmosphereAuthority: "external-network",
    waterAuthority: "external-network",
  });
  const before = engine.getState().water;
  const result = engine.stepSimulation(86_400);
  assert.equal(result.systemRuns.water, 1_440);
  assert.deepEqual(engine.getState().water, before);

  engine.applyMetabolicMassExchange({
    oxygenConsumedKg: 10,
    carbonDioxideProducedKg: 12,
    waterVaporProducedKg: 4,
  });
  assert.equal(engine.getState().water.potableKg, before.potableKg);
  engine.synchronizeWaterNetwork({
    ...before,
    potableKg: before.potableKg - 4,
    recycledKgCumulative: 123,
  });
  assert.equal(engine.getState().water.potableKg, before.potableKg - 4);
  assert.equal(engine.getState().water.recycledKgCumulative, 123);

  const restored = SimulationEngine.restore(engine.snapshot());
  assert.equal(restored.snapshot().waterAuthority, "external-network");
  const invalid = restored.snapshot();
  invalid.waterAuthority = "water-bags";
  assert.throws(
    () => SimulationEngine.restore(invalid),
    /invalid water authority/,
  );
});

test("external thermal authority prevents a second aggregate heat solver", () => {
  const engine = new SimulationEngine({
    thermalAuthority: "external-network",
  });
  engine.synchronizeThermalNetwork({
    habitatTemperatureK: 295.15,
    coolantTemperatureK: 319,
    radiatorTemperatureK: 311,
    spaceSinkTemperatureK: 3,
    internalHeatKw: 57_200,
    radiatedHeatKw: 55_800,
    radiatorConductanceKwPerK: 181.16883116883116,
    coolantHeatCapacityKJPerK: 4_000_000,
  });
  const before = engine.getState().thermal;
  const result = engine.stepSimulation(60);

  assert.equal(result.systemRuns.thermal, 30);
  assert.deepEqual(engine.getState().thermal, before);
  assert.equal(
    engine.snapshot().thermalAuthority,
    "external-network",
  );
  const restored = SimulationEngine.restore(engine.snapshot());
  restored.stepSimulation(60);
  assert.deepEqual(restored.getState().thermal, before);
});

test("external electrical authority prevents duplicate battery dispatch", () => {
  const engine = new SimulationEngine({
    powerAuthority: "external-network",
  });
  engine.synchronizePowerNetwork({
    generationKw: 620_000,
    essentialDemandKw: 420_000,
    discretionaryDemandKw: 160_000,
    jumpDriveDemandKw: 240_000,
    servedDemandKw: 620_000,
    unservedDemandKw: 200_000,
    curtailedGenerationKw: 0,
    batteryCapacityKWh: 7_200_000,
    batteryChargeKWh: 2_100_000,
    batteryThroughputKWh: 300_000,
  });
  const before = engine.getState().power;
  const result = engine.stepSimulation(60);

  assert.equal(result.systemRuns.power, 60);
  assert.deepEqual(engine.getState().power, before);
  assert.equal(engine.snapshot().powerAuthority, "external-network");
  const restored = SimulationEngine.restore(engine.snapshot());
  restored.stepSimulation(60);
  assert.deepEqual(restored.getState().power, before);
});

test("external feeder energy is the sole jump-charge authority and its loss is explicit", () => {
  const engine = new SimulationEngine({
    powerAuthority: "external-network",
  });
  const before = engine.getState().journey.jumpDriveChargeKWh;
  const charged =
    engine.acceptExternallySuppliedJumpDriveEnergy(1_000);
  assert.equal(charged.storedFieldEnergyKWh, 860);
  assert.equal(charged.dissipatedHeatEnergyKWh, 140);
  assert.equal(
    engine.getState().journey.jumpDriveChargeKWh,
    before + 860,
  );

  engine.setTimeScale(60);
  engine.stepSimulation(1);
  assert.equal(
    engine.getState().journey.jumpDriveChargeKWh,
    before + 860,
    "the aggregate journey task must not estimate a second charge",
  );
  assert.throws(
    () =>
      new SimulationEngine().acceptExternallySuppliedJumpDriveEnergy(
        1,
      ),
    /requires external electrical authority/,
  );
});

test("compartment atmosphere synchronization is validated and causal", () => {
  const engine = new SimulationEngine({
    atmosphereAuthority: "external-network",
  });
  const beforeRevision = engine.getState().revision;
  engine.synchronizeAtmosphereNetwork({
    volumeCubicMeters: 450_000,
    gasesKg: {
      oxygen: 120_000,
      nitrogen: 400_000,
      carbonDioxide: 475,
      waterVapor: 4_000,
    },
    pressurePa: 99_800,
    oxygenPartialPressurePa: 20_100,
    carbonDioxidePartialPressurePa: 58,
    capturedCarbonDioxideKg: 14,
    ventedGasKg: 2.5,
    leakAreaSquareMeters: 0.000045,
  });
  const after = engine.getState();
  assert.equal(after.atmosphere.gasesKg.oxygen, 120_000);
  assert.equal(after.atmosphere.ventedGasKg, 2.5);
  assert.equal(after.revision, beforeRevision + 1);

  assert.throws(
    () =>
      engine.synchronizeAtmosphereNetwork({
        ...after.atmosphere,
        pressurePa: 1,
      }),
    /partial pressures exceed total pressure/,
  );
});

test("metabolic products debit feedstock and water reservoirs exactly", () => {
  const engine = new SimulationEngine({
    atmosphereAuthority: "external-network",
  });
  const before = engine.getState();
  engine.applyMetabolicMassExchange({
    oxygenConsumedKg: 10,
    carbonDioxideProducedKg: 12,
    waterVaporProducedKg: 4,
  });
  const after = engine.getState();

  assert.equal(
    after.consumables.foodDryKg,
    before.consumables.foodDryKg - 2,
  );
  assert.equal(
    after.consumables.foodConsumedKgCumulative,
    before.consumables.foodConsumedKgCumulative + 2,
  );
  assert.equal(after.water.potableKg, before.water.potableKg - 4);
  assert.throws(
    () =>
      engine.applyMetabolicMassExchange({
        oxygenConsumedKg: 2,
        carbonDioxideProducedKg: 1,
        waterVaporProducedKg: 0,
      }),
    /cannot weigh less/,
  );
});
