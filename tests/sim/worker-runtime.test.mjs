import assert from "node:assert/strict";
import test from "node:test";

const emitted = [];
globalThis.postMessage = (event) => {
  emitted.push(event);
};
await import("../../lib/sim/worker.ts");

function dispatch(command) {
  emitted.length = 0;
  globalThis.onmessage({ data: command });
  assert.equal(emitted.length, 1);
  return emitted[0];
}

function initialize(requestId = "init") {
  return dispatch({
    type: "initialize",
    requestId,
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: "worker-runtime-test",
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: 21_600,
    },
  });
}

function trackedClosedShipMass(state) {
  const atmosphereMass =
    Object.values(state.atmosphere.gasesKg).reduce(
      (total, mass) => total + mass,
      0,
    ) +
    state.atmosphere.capturedCarbonDioxideKg +
    state.atmosphere.ventedGasKg;
  const waterMass =
    state.water.potableKg +
    state.water.wastewaterKg +
    state.water.reserveIceKg +
    state.water.brineWasteKg;
  return atmosphereMass + waterMass + state.consumables.foodDryKg;
}

const micrometeoroidRequest = {
  actor: "player:god-mode",
  reason: "test micrometeoroid",
  operations: [
    {
      operation: "add",
      path: "atmosphere.leakAreaSquareMeters",
      value: 0.000045,
    },
  ],
  declaredBalance: {
    massKg: -0.34,
    energyJ: 280_000_000,
    linearMomentumKgMPerSecond: [1_180, -240, 90],
    angularMomentumKgM2PerSecond: [0, 28_000, -74_000],
    note: "test projectile balance",
  },
  metadata: {
    mode: "causal-event",
    eventType: "micrometeoroid",
    targetZoneId: "A-18",
    sourceKnownToAi: false,
  },
};

test("worker couples 48 zones, population, aggregate state, and atomic saves", () => {
  const ready = initialize("init-coupling");
  assert.equal(ready.type, "ready");
  assert.equal(ready.payload.compartments.zoneCount, 48);
  assert.equal(ready.payload.cooling.truth.activeLoopCount, 2);
  assert.equal(ready.payload.electrical.truth.onlineReactorCount, 4);
  assert.equal(ready.payload.electrical.truth.hotStandbyReactorCount, 2);
  assert.equal(
    ready.payload.electrical.observed.totalServedPowerKw,
    null,
    "initial electrical readings must respect sensor delay",
  );
  assert.equal(ready.payload.navigation.truth.activeThrusterCount, 0);
  assert.equal(
    ready.payload.navigation.observed.propellantMassKg,
    null,
    "initial navigation readings must respect sensor delay",
  );
  assert.equal(
    ready.payload.cooling.observed.averageCoolantTemperatureK,
    null,
    "initial cooling readings must respect sensor delay",
  );
  assert.deepEqual(
    ready.payload.rotation.observed.rings.map((ring) => ({
      id: ring.id,
      relativeRpm: ring.relativeRpm,
      artificialGravityG: ring.artificialGravityG,
      vibrationMmPerS: ring.vibrationMmPerS,
    })),
    [
      {
        id: "ring-a",
        relativeRpm: null,
        artificialGravityG: null,
        vibrationMmPerS: null,
      },
      {
        id: "ring-b",
        relativeRpm: null,
        artificialGravityG: null,
        vibrationMmPerS: null,
      },
    ],
    "initial ring instruments must not bypass their five-second sensor delay",
  );
  assert.deepEqual(
    ready.payload.rotation.truth.rings.map((ring) => ({
      id: ring.id,
      relativeRpm: ring.relativeRpm,
      controlMode: ring.controlMode,
    })),
    [
      {
        id: "ring-a",
        relativeRpm: 2,
        controlMode: "speed-hold",
      },
      {
        id: "ring-b",
        relativeRpm: -2,
        controlMode: "speed-hold",
      },
    ],
  );
  assert.ok(
    ready.payload.rotation.truth.rings.every(
      (ring) =>
        Math.abs(ring.artificialGravityG - 1) < 0.01,
    ),
    "the authoritative 224 m rings must begin near one standard gravity",
  );
  assert.equal(
    ready.payload.rotation.truth
      .netRelativeRingAngularMomentumKgM2PerS,
    0,
    "equal counter-rotation must begin with zero relative angular momentum",
  );
  assert.equal(
    ready.payload.rotation.truth.totalAngularMomentumXKgM2PerS,
    0,
  );
  assert.equal(ready.payload.commandBus.revision, 0);
  assert.equal(ready.payload.state.atmosphere.volumeCubicMeters, 450_000);
  assert.equal(ready.payload.passengers.awake, 218);
  assert.equal(ready.payload.passengerHighlights.length, 32);
  assert.ok(
    ready.payload.passengerHighlights.every(
      (person) => person.isKeyLlm && person.passengerId,
    ),
  );
  const trackedMassBefore = trackedClosedShipMass(ready.payload.state);

  const oxygenBefore = ready.payload.state.atmosphere.gasesKg.oxygen;
  const stepped = dispatch({
    type: "step",
    requestId: "step-six-hours",
    realSeconds: 1,
    timeScale: 21_600,
  });
  assert.equal(stepped.type, "stepped", stepped.message);
  assert.equal(stepped.payload.elapsedSeconds, 21_600);
  assert.equal(stepped.payload.compartments.fidelityLimited, false);
  assert.equal(
    stepped.payload.compartments.fidelityMode,
    "equilibrium-fast",
  );
  const expectedOxygenConsumption = 218 * 8.5e-6 * 21_600;
  assert.ok(
    Math.abs(
      oxygenBefore -
        stepped.payload.state.atmosphere.gasesKg.oxygen -
        expectedOxygenConsumption
    ) < 1e-7,
  );
  assert.ok(
    Math.abs(
      trackedClosedShipMass(stepped.payload.state) -
        trackedMassBefore
    ) < 1e-6,
    "metabolic, scrubber, water, and vent sinks must close the tracked mass balance",
  );

  const saved = dispatch({
    type: "snapshot",
    requestId: "snapshot-coupling",
  });
  assert.equal(saved.type, "snapshot");
  assert.equal(saved.payload.snapshot.snapshotVersion, 15);
  assert.equal(saved.payload.snapshot.compartments.snapshotVersion, 3);
  assert.deepEqual(
    saved.payload.snapshot.compartments.airHandlers.map(
      ({ id, ring, servedZoneIds }) => ({
        id,
        ring,
        servedZoneCount: servedZoneIds.length,
      }),
    ),
    [
      { id: "air-handler-a", ring: "A", servedZoneCount: 24 },
      { id: "air-handler-b", ring: "B", servedZoneCount: 24 },
    ],
  );
  assert.equal(
    saved.payload.snapshot.engine.populationAuthority,
    "external-roster",
  );
  assert.equal(
    saved.payload.snapshot.passengerEnvironmentalExposures.length,
    48 * 5,
  );
  assert.equal(saved.payload.snapshot.rotation.snapshotVersion, 1);
  assert.equal(
    saved.payload.snapshot.engine.clock.elapsedMicroseconds,
    saved.payload.snapshot.passengers.nowMicroseconds,
  );
  assert.equal(
    saved.payload.snapshot.engine.clock.elapsedMicroseconds,
    saved.payload.snapshot.compartments.elapsedMicroseconds,
  );
  assert.equal(
    saved.payload.snapshot.engine.clock.elapsedMicroseconds,
    saved.payload.snapshot.cooling.elapsedMicroseconds,
  );
  assert.equal(
    saved.payload.snapshot.engine.clock.elapsedMicroseconds,
    saved.payload.snapshot.electrical.elapsedMicroseconds,
  );
  assert.equal(
    saved.payload.snapshot.engine.clock.elapsedMicroseconds,
    saved.payload.snapshot.navigation.elapsedMicroseconds,
  );
  assert.equal(
    saved.payload.snapshot.engine.clock.elapsedMicroseconds,
    saved.payload.snapshot.rotation.elapsedMicroseconds,
  );
  assert.equal(
    saved.payload.snapshot.engine.clock.elapsedMicroseconds,
    saved.payload.snapshot.water.elapsedMicroseconds,
  );
  assert.equal(
    saved.payload.snapshot.engine.clock.elapsedMicroseconds,
    saved.payload.snapshot.maintenance.elapsedMicroseconds,
  );
  assert.equal(
    saved.payload.snapshot.commandBus.revision,
    stepped.payload.commandBus.revision,
  );
  assert.ok(
    saved.payload.snapshot.cooling.ledger.externalEnergyJ > 0,
    "metabolic sensible heat must enter the authoritative cooling ledger",
  );
});

test("one long command and repeated minute-aligned commands reach the same nine-domain state", () => {
  initialize("init-common-clock-equivalence");
  const initial = dispatch({
    type: "snapshot",
    requestId: "common-clock-initial",
  }).payload.snapshot;

  const longStep = dispatch({
    type: "step",
    requestId: "common-clock-long-step",
    realSeconds: 6,
    timeScale: 3_600,
  });
  assert.equal(longStep.type, "stepped", longStep.message);
  const afterLong = dispatch({
    type: "snapshot",
    requestId: "common-clock-after-long",
  }).payload.snapshot;

  const restored = dispatch({
    type: "restore",
    requestId: "common-clock-restore",
    snapshot: initial,
  });
  assert.equal(restored.type, "ready", restored.message);
  for (let hour = 0; hour < 6; hour += 1) {
    const stepped = dispatch({
      type: "step",
      requestId: `common-clock-hour-${hour + 1}`,
      realSeconds: 1,
      timeScale: 3_600,
    });
    assert.equal(stepped.type, "stepped", stepped.message);
  }
  const afterRepeated = dispatch({
    type: "snapshot",
    requestId: "common-clock-after-repeated",
  }).payload.snapshot;

  assert.deepEqual(afterRepeated, afterLong);
});

test("a split-step one-leg voyage closes both energy ledgers and reaches its final report", () => {
  const ready = dispatch({
    type: "initialize",
    requestId: "init-split-long-voyage-ledger",
    mission: {
      origin: "巴纳德星",
      destination: "沃尔夫 359",
      directive: "保证乘员存续并安全抵达。",
      seed: "split-long-voyage-ledger",
      totalDistanceLightYears: 1.9,
      totalLegs: 1,
      timeScale: 60,
    },
  });
  assert.equal(ready.type, "ready", ready.message);
  const firstMinute = dispatch({
    type: "step",
    requestId: "split-ledger-first-minute",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(firstMinute.type, "stepped", firstMinute.message);

  let current = firstMinute;
  for (let interval = 1; interval <= 3; interval += 1) {
    const stepped = dispatch({
      type: "step",
      requestId: `split-ledger-six-hours-${interval}`,
      realSeconds: 1,
      timeScale: 21_600,
    });
    assert.equal(stepped.type, "stepped", stepped.message);
    current = stepped;
  }

  const snapshot = dispatch({
    type: "snapshot",
    requestId: "split-ledger-snapshot",
  }).payload.snapshot;
  const classifiedExternalEnergyJ = Object.values(
    snapshot.cooling.ledger.externalEnergyBySourceJ,
  ).reduce((total, energyJ) => total + energyJ, 0);
  assert.equal(
    snapshot.cooling.ledger.externalEnergyJ,
    classifiedExternalEnergyJ,
  );
  assert.equal(snapshot.engine.clock.elapsedMicroseconds, 64_860_000_000);
  assert.equal(snapshot.engine.state.journey.status, "ready");
  assert.ok(
    Math.abs(
      snapshot.electrical.batteries.reduce(
        (total, battery) => total + battery.storedEnergyKWh,
        0,
      ) -
        (snapshot.electrical.ledger.initialStoredEnergyKWh +
          snapshot.electrical.ledger.reactorGenerationKWh -
          snapshot.electrical.ledger.servedLoadKWh -
          snapshot.electrical.ledger.curtailedGenerationKWh -
          snapshot.electrical.ledger.batteryConversionLossKWh +
          snapshot.electrical.ledger.externalEnergyKWh +
          snapshot.electrical.ledger.numericalResidualKWh),
    ) < 1e-9,
  );

  const jump = dispatch({
    type: "ship-command",
    requestId: "split-ledger-jump",
    commandId: "captain:split-ledger-jump",
    idempotencyKey: "captain:split-ledger-jump",
    issuedAtMicroseconds: Math.round(
      current.payload.elapsedSeconds * 1_000_000,
    ),
    expectedRevision: current.payload.commandBus.revision,
    expectedStateRevision: current.payload.state.revision,
    command: {
      kind: "execute-jump",
      actorAgentId: "captain",
      distanceLightYears: 1.9,
    },
  });
  assert.equal(jump.type, "ship-command", jump.message);
  assert.equal(jump.payload.result.journeyStatus, "arrived");

  const finalReport = dispatch({
    type: "final-report",
    requestId: "split-ledger-final-report",
  });
  assert.equal(finalReport.type, "final-report", finalReport.message);
  assert.equal(finalReport.payload.report.outcome, "arrived");
  assert.equal(finalReport.payload.report.evaluationCount, 2_120);
  assert.equal(
    finalReport.payload.report.representativeEvaluations.length,
    6,
  );
});

test("a micrometeoroid creates a real zone breach and activates fidelity limiting", () => {
  initialize("init-breach");
  const intervention = dispatch({
    type: "intervene",
    requestId: "breach",
    request: micrometeoroidRequest,
  });
  assert.equal(intervention.type, "intervention");
  assert.equal(intervention.payload.compartments.activeBreaches, 1);
  const interventionZone =
    intervention.payload.compartments.zones.find(
      (zone) => zone.zoneId === "A-18",
    );
  assert.equal(interventionZone.hasBreach, true);
  assert.equal(
    interventionZone.condition,
    "offline",
    "world truth must not bypass the initial sensor delay",
  );
  const impactedSnapshot = dispatch({
    type: "snapshot",
    requestId: "impact-roster",
  }).payload.snapshot;
  const impactedPassengers =
    impactedSnapshot.passengers.passengers.filter((person) =>
      person.memories.some(
        (memory) =>
          memory.incident?.eventId ===
          `${intervention.payload.record.id}:A-18-impact`,
      ),
    );
  assert.ok(
    impactedPassengers.length > 0,
    "a populated struck zone must affect persistent individual records",
  );
  assert.notDeepEqual(
    impactedSnapshot.navigation.body.velocityMPerS,
    { x: 0, y: 0, z: 0 },
    "declared impact momentum must reach the authoritative rigid body",
  );
  assert.ok(
    impactedSnapshot.navigation.body.angularVelocityBodyRadPerS.y >
      0,
    "declared angular momentum must reach the authoritative rigid body",
  );

  const stepped = dispatch({
    type: "step",
    requestId: "breach-step",
    realSeconds: 1,
    timeScale: 21_600,
  });
  assert.equal(stepped.type, "stepped");
  assert.equal(stepped.payload.elapsedSeconds, 60);
  assert.equal(stepped.payload.compartments.requestedTimeScale, 21_600);
  assert.equal(stepped.payload.compartments.effectiveTimeScale, 60);
  assert.equal(stepped.payload.compartments.fidelityLimited, true);
  assert.equal(
    stepped.payload.compartments.fidelityMode,
    "transient-fine",
  );
  assert.ok(stepped.payload.compartments.totalVentedGasKg > 0);
  const observedZone = stepped.payload.compartments.zones.find(
    (zone) => zone.zoneId === "A-18",
  );
  assert.notEqual(observedZone.observed.pressurePa, null);
  const expectedPressureCondition =
    observedZone.observed.pressurePa < 75_000
      ? "critical"
      : observedZone.observed.pressurePa < 90_000
        ? "watch"
        : "nominal";
  assert.equal(observedZone.condition, expectedPressureCondition);

  const isolateEnvelope = {
    type: "ship-command",
    requestId: "isolate-a18",
    commandId: "life-support:isolate-a18",
    idempotencyKey: "life-support:isolate-a18",
    issuedAtMicroseconds: 60_000_000,
    expectedRevision: stepped.payload.commandBus.revision,
    expectedStateRevision: stepped.payload.state.revision,
    command: {
      kind: "isolate-pressure-zone",
      actorAgentId: "life-support",
      zoneId: "A-18",
    },
  };
  const isolated = dispatch(isolateEnvelope);
  assert.equal(isolated.type, "ship-command");
  assert.ok(isolated.payload.result.actuatedConnections > 0);
  assert.equal(isolated.payload.commandBus.revision, 1);
  const isolatedSnapshot = dispatch({
    type: "snapshot",
    requestId: "isolated-snapshot",
  }).payload.snapshot;
  const incidentConnections =
    isolatedSnapshot.compartments.connections.filter(
      (connection) =>
        connection.zoneAId === "A-18" ||
        connection.zoneBId === "A-18",
    );
  assert.ok(incidentConnections.length > 0);
  assert.ok(
    incidentConnections.every(
      (connection) => connection.commandedOpenFraction === 0,
    ),
  );

  const replayed = dispatch({
    ...isolateEnvelope,
    requestId: "isolate-a18-transport-retry",
  });
  assert.equal(replayed.type, "ship-command");
  assert.equal(replayed.payload.commandBus.revision, 1);

  const forbidden = dispatch({
    type: "ship-command",
    requestId: "navigation-medical-forbidden",
    commandId: "navigation:medical-forbidden",
    idempotencyKey: "navigation:medical-forbidden",
    issuedAtMicroseconds: 60_000_000,
    expectedRevision: 1,
    expectedStateRevision: replayed.payload.state.revision,
    command: {
      kind: "set-awake-target",
      actorAgentId: "navigation",
      targetAwake: 220,
    },
  });
  assert.equal(forbidden.type, "error");
  assert.match(forbidden.message, /FORBIDDEN/);
  const audited = dispatch({
    type: "snapshot",
    requestId: "command-audit-snapshot",
  }).payload.snapshot.commandBus;
  assert.equal(audited.revision, 1);
  assert.equal(audited.auditHistory.at(-1).status, "rejected");
  assert.equal(
    audited.auditHistory.at(-1).rejection.code,
    "FORBIDDEN",
  );

  const beforeFutureCommand = dispatch({
    type: "snapshot",
    requestId: "before-future-command",
  }).payload.snapshot;
  const futureCommand = dispatch({
    type: "ship-command",
    requestId: "future-command",
    commandId: "life-support:future-isolation",
    idempotencyKey: "life-support:future-isolation",
    issuedAtMicroseconds: 60_000_001,
    expectedRevision: 1,
    expectedStateRevision: replayed.payload.state.revision,
    command: {
      kind: "isolate-pressure-zone",
      actorAgentId: "life-support",
      zoneId: "A-17",
    },
  });
  assert.equal(futureCommand.type, "error");
  assert.match(futureCommand.message, /EXECUTOR_ERROR.+in the future/);
  const afterFutureCommand = dispatch({
    type: "snapshot",
    requestId: "after-future-command",
  }).payload.snapshot;
  assert.deepEqual(afterFutureCommand.engine, beforeFutureCommand.engine);
  assert.deepEqual(
    afterFutureCommand.passengers,
    beforeFutureCommand.passengers,
  );
  assert.deepEqual(
    afterFutureCommand.compartments,
    beforeFutureCommand.compartments,
  );
  assert.deepEqual(afterFutureCommand.cooling, beforeFutureCommand.cooling);
  assert.deepEqual(
    afterFutureCommand.electrical,
    beforeFutureCommand.electrical,
  );
  assert.deepEqual(
    afterFutureCommand.navigation,
    beforeFutureCommand.navigation,
  );
  assert.equal(afterFutureCommand.commandBus.revision, 1);
  assert.equal(
    afterFutureCommand.commandBus.auditHistory.at(-1).rejection.code,
    "EXECUTOR_ERROR",
  );
});

test("direct oxygen Force reaches every compartment and is restored exactly", () => {
  initialize("init-force");
  const targetOxygenKg = 100_000;
  const intervention = dispatch({
    type: "intervene",
    requestId: "force-oxygen",
    request: {
      actor: "player:god-mode",
      reason: "test direct oxygen override",
      operations: [
        {
          operation: "set",
          path: "atmosphere.gasesKg.oxygen",
          value: targetOxygenKg,
        },
      ],
      declaredBalance: {
        massKg: -24_258.64606395348,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "test direct mass override",
      },
      metadata: {
        mode: "direct-force",
        fieldId: "oxygen-mass",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(intervention.type, "intervention");
  assert.ok(
    Math.abs(
      intervention.payload.state.atmosphere.gasesKg.oxygen -
        targetOxygenKg
    ) < 1e-7,
  );
  const expectedSensibleEnergy =
    (targetOxygenKg - 124_258.64606395348) * 1_005 * 295.15;
  assert.ok(
    Math.abs(
      intervention.payload.record.declaredBalance.energyJ -
        expectedSensibleEnergy
    ) < 1e-3,
  );

  const saved = dispatch({
    type: "snapshot",
    requestId: "force-save",
  }).payload.snapshot;
  const totalZoneOxygen = saved.compartments.zones.reduce(
    (total, zone) => total + zone.gasesKg.oxygen,
    0,
  );
  assert.ok(Math.abs(totalZoneOxygen - targetOxygenKg) < 1e-7);

  const restored = dispatch({
    type: "restore",
    requestId: "force-restore",
    snapshot: saved,
  });
  assert.equal(restored.type, "ready");
  assert.ok(
    Math.abs(
      restored.payload.state.atmosphere.gasesKg.oxygen -
        targetOxygenKg
    ) < 1e-7,
  );
});

test("cooling faults and thermal Force act on physical loop entities", () => {
  initialize("init-cooling-domain");
  const seized = dispatch({
    type: "intervene",
    requestId: "seize-pump-a",
    request: {
      actor: "player:god-mode",
      reason: "test physical pump seizure",
      operations: [],
      declaredBalance: {
        massKg: 0,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "mechanical topology fault",
      },
      metadata: {
        mode: "causal-event",
        eventType: "coolant-pump-seizure",
        targetPumpId: "pump-a",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(seized.type, "intervention");
  assert.equal(
    seized.payload.cooling.truth.pumps.find(
      (pump) => pump.id === "pump-a",
    ).condition,
    "stuck-off",
  );
  assert.equal(seized.payload.cooling.truth.activeLoopCount, 1);

  const observed = dispatch({
    type: "step",
    requestId: "cooling-observation-delay",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(observed.type, "stepped");
  assert.ok(
    observed.payload.cooling.observed.totalMassFlowKgPerSecond >
      350,
  );
  assert.ok(
    observed.payload.cooling.observed.totalMassFlowKgPerSecond <
      450,
  );

  const ready = initialize("init-thermal-force");
  const targetTemperatureK = 340;
  const forced = dispatch({
    type: "intervene",
    requestId: "force-coolant-temperature",
    request: {
      actor: "player:god-mode",
      reason: "test thermal state override",
      operations: [
        {
          operation: "set",
          path: "thermal.coolantTemperatureK",
          value: targetTemperatureK,
        },
      ],
      declaredBalance: {
        massKg: 0,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "runtime recomputes exact node energy",
      },
      metadata: {
        mode: "direct-force",
        fieldId: "coolant-temperature",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(forced.type, "intervention");
  assert.equal(
    forced.payload.state.thermal.coolantTemperatureK,
    targetTemperatureK,
  );
  assert.equal(
    forced.payload.cooling.truth.averageCoolantTemperatureK,
    targetTemperatureK,
  );
  const expectedEnergyJ =
    (targetTemperatureK -
      ready.payload.cooling.truth.averageCoolantTemperatureK) *
    4_000_000_000;
  assert.ok(
    Math.abs(
      forced.payload.record.declaredBalance.energyJ -
        expectedEnergyJ
    ) < 1e-3,
  );
  const forcedSnapshot = dispatch({
    type: "snapshot",
    requestId: "forced-cooling-snapshot",
  }).payload.snapshot;
  assert.ok(
    Math.abs(
      forcedSnapshot.cooling.ledger.externalEnergyJ -
        expectedEnergyJ
    ) < 1e-3,
  );
});

test("maintenance consumes parts, blocks without workshop power, and repairs a real pump", () => {
  initialize("init-maintenance-repair");
  const faulted = dispatch({
    type: "intervene",
    requestId: "maintenance-fault-pump-a",
    request: {
      actor: "player:god-mode",
      reason: "test maintenance causal repair",
      operations: [],
      declaredBalance: {
        massKg: 0,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "mechanical fault only",
      },
      metadata: {
        mode: "causal-event",
        eventType: "coolant-pump-seizure",
        targetPumpId: "pump-a",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(faulted.type, "intervention", faulted.message);

  const scheduled = dispatch({
    type: "ship-command",
    requestId: "schedule-pump-a-maintenance",
    commandId: "maintenance-command-1",
    idempotencyKey: "maintenance-command-1",
    issuedAtMicroseconds: 0,
    expectedRevision: faulted.payload.commandBus.revision,
    expectedStateRevision: faulted.payload.state.revision,
    command: {
      kind: "schedule-maintenance",
      actorAgentId: "engineering",
      assetId: "pump-a",
    },
  });
  assert.equal(scheduled.type, "ship-command", scheduled.message);
  assert.equal(scheduled.payload.result.maintenanceAssetId, "pump-a");
  assert.equal(scheduled.payload.maintenance.activeTasks.length, 1);
  assert.equal(
    scheduled.payload.maintenance.inventory["pump-service-kit"],
    3,
  );

  const disabledWorkshop = dispatch({
    type: "ship-command",
    requestId: "disable-maintenance-workshop-a",
    commandId: "maintenance-command-2",
    idempotencyKey: "maintenance-command-2",
    issuedAtMicroseconds: 0,
    expectedRevision: scheduled.payload.commandBus.revision,
    expectedStateRevision: scheduled.payload.state.revision,
    command: {
      kind: "set-electrical-load-enabled",
      actorAgentId: "engineering",
      loadId: "habitat-a",
      enabled: false,
    },
  });
  assert.equal(disabledWorkshop.type, "ship-command", disabledWorkshop.message);
  const blocked = dispatch({
    type: "step",
    requestId: "maintenance-blocked-one-hour",
    realSeconds: 1,
    timeScale: 3_600,
  });
  assert.equal(blocked.type, "stepped", blocked.message);
  assert.equal(
    blocked.payload.maintenance.activeTasks[0].completedWorkSeconds,
    0,
  );
  assert.equal(
    blocked.payload.maintenance.activeTasks[0].blockedReason,
    "workshop-unpowered",
  );
  assert.equal(
    blocked.payload.cooling.truth.pumps.find((pump) => pump.id === "pump-a")
      .condition,
    "stuck-off",
  );

  const enabledWorkshop = dispatch({
    type: "ship-command",
    requestId: "enable-maintenance-workshop-a",
    commandId: "maintenance-command-3",
    idempotencyKey: "maintenance-command-3",
    issuedAtMicroseconds:
      Math.round(blocked.payload.elapsedSeconds * 1_000_000),
    expectedRevision: blocked.payload.commandBus.revision,
    expectedStateRevision: blocked.payload.state.revision,
    command: {
      kind: "set-electrical-load-enabled",
      actorAgentId: "engineering",
      loadId: "habitat-a",
      enabled: true,
    },
  });
  assert.equal(enabledWorkshop.type, "ship-command", enabledWorkshop.message);
  const repaired = dispatch({
    type: "step",
    requestId: "maintenance-powered-completion",
    realSeconds: 1,
    timeScale: 21_600,
  });
  assert.equal(repaired.type, "stepped", repaired.message);
  assert.equal(repaired.payload.maintenance.activeTasks.length, 0);
  assert.equal(repaired.payload.maintenance.recentCompletedTasks.length, 1);
  assert.equal(
    repaired.payload.cooling.truth.pumps.find((pump) => pump.id === "pump-a")
      .condition,
    "nominal",
  );
  assert.equal(
    repaired.payload.maintenance.inventory["pump-service-kit"],
    3,
    "a completed repair must not refund its installed spare",
  );

  const snapshot = dispatch({
    type: "snapshot",
    requestId: "maintenance-snapshot",
  }).payload.snapshot;
  const restored = dispatch({
    type: "restore",
    requestId: "maintenance-restore",
    snapshot,
  });
  assert.equal(restored.type, "ready", restored.message);
  assert.deepEqual(restored.payload.maintenance, repaired.payload.maintenance);
});

test("electrical Force and reactor trips act on the physical six-reactor network", () => {
  const ready = initialize("init-electrical-authority");
  assert.equal(ready.payload.state.power.generationKw, 842_000);
  const forced = dispatch({
    type: "intervene",
    requestId: "force-generation",
    request: {
      actor: "player:god-mode",
      reason: "test electrical generation override",
      operations: [
        {
          operation: "set",
          path: "power.generationKw",
          value: 650_000,
        },
      ],
      declaredBalance: {
        massKg: 0,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "external boundary control",
      },
      metadata: {
        mode: "direct-force",
        fieldId: "generation",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(forced.type, "intervention");
  assert.equal(forced.payload.state.power.generationKw, 650_000);
  assert.equal(
    forced.payload.electrical.truth.generationPowerKw,
    650_000,
  );
  const forcedSnapshot = dispatch({
    type: "snapshot",
    requestId: "forced-electrical-snapshot",
  }).payload.snapshot;
  assert.equal(
    forcedSnapshot.electrical.controlLog.at(-1).type,
    "external-generation-force",
  );

  const tripped = dispatch({
    type: "intervene",
    requestId: "trip-fusion-1",
    request: {
      actor: "player:god-mode",
      reason: "test causal reactor protection trip",
      operations: [],
      declaredBalance: {
        massKg: 0,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "protection topology fault",
      },
      metadata: {
        mode: "causal-event",
        eventType: "fusion-reactor-trip",
        targetReactorId: "fusion-1",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(tripped.type, "intervention");
  assert.equal(
    tripped.payload.electrical.truth.reactors.find(
      (reactor) => reactor.id === "fusion-1",
    ).condition,
    "tripped",
  );
  assert.ok(
    tripped.payload.state.power.generationKw < 650_000,
  );
});

test("per-load electrical service drives jump charging, scrubbers, and cooling pumps", () => {
  const ready = initialize("init-load-coupling");
  let current = ready.payload;
  let sequence = 0;
  const setLoadEnabled = (loadId, enabled) => {
    sequence += 1;
    const commandId = `engineering:load-coupling-${sequence}`;
    const event = dispatch({
      type: "ship-command",
      requestId: `load-coupling-${sequence}`,
      commandId,
      idempotencyKey: commandId,
      issuedAtMicroseconds: 0,
      expectedRevision: current.commandBus.revision,
      expectedStateRevision: current.state.revision,
      command: {
        kind: "set-electrical-load-enabled",
        actorAgentId: "engineering",
        loadId,
        enabled,
      },
    });
    assert.equal(event.type, "ship-command");
    current = event.payload;
  };
  for (const loadId of [
    "jump-drive-a",
    "jump-drive-b",
    "cooling-a",
    "cooling-b",
    "life-support-a",
    "life-support-b",
  ]) {
    setLoadEnabled(loadId, false);
  }

  const chargeBefore =
    current.state.journey.jumpDriveChargeKWh;
  const capturedBefore =
    current.state.atmosphere.capturedCarbonDioxideKg;
  const carbonDioxideBefore =
    current.state.atmosphere.gasesKg.carbonDioxide;
  const habitatTemperatureBefore =
    current.state.thermal.habitatTemperatureK;
  const stepped = dispatch({
    type: "step",
    requestId: "step-with-domain-loads-offline",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(stepped.type, "stepped");
  assert.equal(
    stepped.payload.state.journey.jumpDriveChargeKWh,
    chargeBefore,
    "disconnected jump feeders cannot charge field storage",
  );
  assert.equal(
    stepped.payload.state.atmosphere.capturedCarbonDioxideKg,
    capturedBefore,
    "disconnected life-support loads cannot run the scrubber",
  );
  assert.ok(
    stepped.payload.state.atmosphere.gasesKg.carbonDioxide >
      carbonDioxideBefore,
  );
  assert.ok(
    stepped.payload.state.thermal.habitatTemperatureK >
      habitatTemperatureBefore,
    "without powered coolant flow, metabolic heat must remain in the cabins",
  );
  assert.equal(stepped.payload.cooling.truth.activeLoopCount, 0);
  assert.ok(
    stepped.payload.cooling.truth.pumps.every(
      (pump) =>
        pump.electricalSupplyFraction === 0 &&
        pump.massFlowKgPerSecond === 0,
      ),
  );
  const thermalSnapshot = dispatch({
    type: "snapshot",
    requestId: "served-load-thermal-source",
  }).payload.snapshot;
  assert.equal(
    thermalSnapshot.cooling.heatSources.find(
      (source) =>
        source.id === "ship-service-thermal-load",
    ).thermalPowerW,
    33_200_000,
    "service heat must fall with the actual powered load mix instead of remaining a fixed 57.2 MW",
  );
});

test("air-handler commands, independent feeders, and God-mode trips remain causal and atomic", () => {
  let current = initialize("init-air-handler-runtime").payload;
  const enriched = dispatch({
    type: "intervene",
    requestId: "enrich-cabin-carbon-dioxide",
    request: {
      actor: "player:god-mode",
      reason: "raise cabin carbon dioxide for causal air-handler verification",
      operations: [
        {
          operation: "add",
          path: "atmosphere.gasesKg.carbonDioxide",
          value: 500,
        },
      ],
      declaredBalance: {
        massKg: 0,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "worker recomputes direct-force mass and sensible energy",
      },
      metadata: { mode: "direct-force", sourceKnownToAi: false },
    },
  });
  assert.equal(enriched.type, "intervention", enriched.message);
  current = enriched.payload;

  const commandId = "life-support:air-handler-b-half";
  const configured = dispatch({
    type: "ship-command",
    requestId: commandId,
    commandId,
    idempotencyKey: commandId,
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-air-handler-control",
      actorAgentId: "life-support",
      airHandlerId: "air-handler-b",
      commandedFlowFraction: 0.5,
      scrubberEnabled: true,
    },
  });
  assert.equal(configured.type, "ship-command", configured.message);
  assert.equal(configured.payload.result.commandedFlowFraction, 0.5);
  current = configured.payload;

  const loadCommandId = "engineering:disable-life-support-a";
  const disabledA = dispatch({
    type: "ship-command",
    requestId: loadCommandId,
    commandId: loadCommandId,
    idempotencyKey: loadCommandId,
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-electrical-load-enabled",
      actorAgentId: "engineering",
      loadId: "life-support-a",
      enabled: false,
    },
  });
  assert.equal(disabledA.type, "ship-command", disabledA.message);
  current = disabledA.payload;

  const stepped = dispatch({
    type: "step",
    requestId: "step-independent-air-handlers",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(stepped.type, "stepped", stepped.message);
  const handlerA = stepped.payload.compartments.airHandlers.truth.find(
    (handler) => handler.id === "air-handler-a",
  );
  const handlerB = stepped.payload.compartments.airHandlers.truth.find(
    (handler) => handler.id === "air-handler-b",
  );
  assert.equal(handlerA.actualFlowFraction, 0);
  assert.equal(handlerA.cumulativeCapturedCarbonDioxideKg, 0);
  assert.equal(handlerB.actualFlowFraction, 0.5);
  assert.ok(Math.abs(handlerB.cumulativeCapturedCarbonDioxideKg - 2.7) < 1e-8);
  assert.ok(
    Math.abs(
      stepped.payload.state.atmosphere.capturedCarbonDioxideKg -
        handlerB.cumulativeCapturedCarbonDioxideKg
    ) < 1e-10,
  );

  current = stepped.payload;
  const forbidden = dispatch({
    type: "ship-command",
    requestId: "medical-air-handler-forbidden",
    commandId: "medical:air-handler-forbidden",
    idempotencyKey: "medical:air-handler-forbidden",
    issuedAtMicroseconds: 60_000_000,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-air-handler-control",
      actorAgentId: "medical",
      airHandlerId: "air-handler-a",
      commandedFlowFraction: 1,
      scrubberEnabled: true,
    },
  });
  assert.equal(forbidden.type, "error");
  assert.match(forbidden.message, /FORBIDDEN/);

  const tripped = dispatch({
    type: "intervene",
    requestId: "god-trip-air-handler-b",
    request: {
      actor: "player:god-mode",
      reason: "test physical air-handler trip",
      operations: [],
      declaredBalance: {
        massKg: 999,
        energyJ: 999,
        linearMomentumKgMPerSecond: [1, 2, 3],
        angularMomentumKgM2PerSecond: [4, 5, 6],
        note: "intentionally forged and normalized by runtime",
      },
      metadata: {
        mode: "causal-event",
        eventType: "air-handler-trip",
        targetAirHandlerId: "air-handler-b",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(tripped.type, "intervention", tripped.message);
  assert.deepEqual(tripped.payload.record.declaredBalance, {
    massKg: 0,
    energyJ: 0,
    linearMomentumKgMPerSecond: [0, 0, 0],
    angularMomentumKgM2PerSecond: [0, 0, 0],
    note: "Device-condition fault only; subsequent circulation and carbon-dioxide evolution remain inside the coupled atmosphere system",
  });
  assert.equal(
    tripped.payload.compartments.airHandlers.truth.find(
      (handler) => handler.id === "air-handler-b",
    ).condition,
    "stuck-off",
  );
});

test("A/B water recovery obeys commands, feeder service, God faults, and snapshot validation", () => {
  let current = initialize("init-water-recovery-coupling").payload;
  const configure = dispatch({
    type: "ship-command",
    requestId: "configure-water-processor-a",
    commandId: "life-support:configure-water-processor-a",
    idempotencyKey: "life-support:configure-water-processor-a",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-water-processor-control",
      actorAgentId: "life-support",
      processorId: "water-processor-a",
      commandedThroughputFraction: 0.5,
    },
  });
  assert.equal(configure.type, "ship-command", configure.message);
  assert.equal(
    configure.payload.result.waterProcessorCommandedThroughputFraction,
    0.5,
  );
  assert.equal(
    configure.payload.state.water.recyclerCapacityKgPerDay,
    4_500,
  );
  current = configure.payload;

  const disableAFeeder = dispatch({
    type: "ship-command",
    requestId: "disable-water-a-feeder",
    commandId: "engineering:disable-water-a-feeder",
    idempotencyKey: "engineering:disable-water-a-feeder",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-electrical-load-enabled",
      actorAgentId: "engineering",
      loadId: "life-support-a",
      enabled: false,
    },
  });
  assert.equal(disableAFeeder.type, "ship-command", disableAFeeder.message);
  const stepped = dispatch({
    type: "step",
    requestId: "water-asymmetric-feeder-step",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(stepped.type, "stepped", stepped.message);
  const processorA = stepped.payload.waterRecovery.truth.processors.find(
    (processor) => processor.id === "water-processor-a",
  );
  const processorB = stepped.payload.waterRecovery.truth.processors.find(
    (processor) => processor.id === "water-processor-b",
  );
  assert.equal(processorA.electricalServiceFraction, 0);
  assert.equal(processorA.actualThroughputKgPerSecond, 0);
  assert.equal(processorA.lastProcessedKg, 0);
  assert.ok(processorB.actualThroughputKgPerSecond > 0);
  assert.ok(processorB.lastProcessedKg > 0);
  assert.ok(Math.abs(stepped.payload.waterRecovery.truth.summary.massClosureErrorKg) < 1e-6);

  const tripped = dispatch({
    type: "intervene",
    requestId: "god-trip-water-processor-b",
    request: {
      actor: "player:god-mode",
      reason: "Trip B water processor for a causal integration test",
      operations: [],
      declaredBalance: {
        massKg: 999,
        energyJ: 999,
        linearMomentumKgMPerSecond: [1, 2, 3],
        angularMomentumKgM2PerSecond: [4, 5, 6],
        note: "must be normalized",
      },
      metadata: {
        mode: "causal-event",
        eventType: "water-processor-trip",
        targetProcessorId: "water-processor-b",
      },
    },
  });
  assert.equal(tripped.type, "intervention", tripped.message);
  assert.equal(
    tripped.payload.waterRecovery.truth.processors.find(
      (processor) => processor.id === "water-processor-b",
    ).condition,
    "stuck-off",
  );
  assert.equal(tripped.payload.record.declaredBalance.massKg, 0);
  assert.equal(tripped.payload.record.declaredBalance.energyJ, 0);

  const saved = dispatch({
    type: "snapshot",
    requestId: "snapshot-water-network",
  }).payload.snapshot;
  const restored = dispatch({
    type: "restore",
    requestId: "restore-water-network",
    snapshot: saved,
  });
  assert.equal(restored.type, "ready", restored.message);
  assert.deepEqual(restored.payload.waterRecovery.truth, tripped.payload.waterRecovery.truth);

  const potableBefore = restored.payload.state.water.potableKg;
  const forced = dispatch({
    type: "intervene",
    requestId: "force-potable-water-inventory",
    request: {
      actor: "player:god-mode",
      reason: "Replace total potable inventory for a direct-force test",
      operations: [
        {
          operation: "set",
          path: "water.potableKg",
          value: 3_200_000,
        },
      ],
      declaredBalance: {
        massKg: 0,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "must be normalized from the authoritative inventory",
      },
      metadata: { mode: "direct-force" },
    },
  });
  assert.equal(forced.type, "intervention", forced.message);
  assert.equal(forced.payload.state.water.potableKg, 3_200_000);
  assert.deepEqual(
    forced.payload.waterRecovery.truth.loops.map((loop) => loop.potableKg),
    [1_600_000, 1_600_000],
  );
  assert.ok(
    Math.abs(
      forced.payload.record.declaredBalance.massKg -
        (3_200_000 - potableBefore),
    ) < 1e-6,
  );
  assert.ok(
    Math.abs(forced.payload.waterRecovery.truth.summary.massClosureErrorKg) <
      1e-6,
  );

  const forged = structuredClone(saved);
  forged.water.processors[0].actualThroughputKgPerSecond += 0.001;
  const rejected = dispatch({
    type: "restore",
    requestId: "reject-forged-water-throughput",
    snapshot: forged,
  });
  assert.equal(rejected.type, "error");
  assert.match(rejected.message, /not causally derived/);
});

test("powered feeders cannot remove cabin heat through commanded-off pumps", () => {
  const ready = initialize("init-commanded-off-pumps");
  let current = ready.payload;
  for (const [index, pumpId] of ["pump-a", "pump-b"].entries()) {
    const commandId = `engineering:stop-${pumpId}`;
    const event = dispatch({
      type: "ship-command",
      requestId: `stop-pump-${index}`,
      commandId,
      idempotencyKey: commandId,
      issuedAtMicroseconds: 0,
      expectedRevision: current.commandBus.revision,
      expectedStateRevision: current.state.revision,
      command: {
        kind: "set-cooling-pump-speed",
        actorAgentId: "engineering",
        pumpId,
        commandedSpeedFraction: 0,
      },
    });
    assert.equal(event.type, "ship-command");
    current = event.payload;
  }
  const temperatureBefore =
    current.state.thermal.habitatTemperatureK;
  const stepped = dispatch({
    type: "step",
    requestId: "step-commanded-off-pumps",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(stepped.type, "stepped");
  assert.equal(stepped.payload.cooling.truth.activeLoopCount, 0);
  assert.ok(
    stepped.payload.cooling.truth.pumps.every(
      (pump) =>
        pump.electricalSupplyFraction === 1 &&
        pump.massFlowKgPerSecond === 0,
    ),
    "feeders remain powered but stopped pumps cannot move coolant",
  );
  assert.ok(
    stepped.payload.state.thermal.habitatTemperatureK >
      temperatureBefore,
  );
});

test("cabin heat pumps obey Qhot equals Qcold plus served compressor work", () => {
  const ready = initialize("init-cabin-heat-pump-ledger");
  let current = ready.payload;
  let sequence = 0;
  const issue = (command) => {
    sequence += 1;
    const commandId = `engineering:heat-pump-${sequence}`;
    const event = dispatch({
      type: "ship-command",
      requestId: commandId,
      commandId,
      idempotencyKey: commandId,
      issuedAtMicroseconds: 0,
      expectedRevision: current.commandBus.revision,
      expectedStateRevision: current.state.revision,
      command: {
        actorAgentId: "engineering",
        ...command,
      },
    });
    assert.equal(event.type, "ship-command", event.message);
    current = event.payload;
  };
  issue({
    kind: "set-electrical-load-enabled",
    loadId: "jump-drive-a",
    enabled: false,
  });
  issue({
    kind: "set-electrical-load-enabled",
    loadId: "jump-drive-b",
    enabled: false,
  });
  issue({
    kind: "set-battery-mode",
    batteryId: "battery-a",
    mode: "standby",
  });
  issue({
    kind: "set-battery-mode",
    batteryId: "battery-b",
    mode: "standby",
  });

  const before = dispatch({
    type: "snapshot",
    requestId: "before-cabin-heat-pump",
  }).payload.snapshot;
  const zoneVolume = before.compartments.zones.reduce(
    (total, zone) => total + zone.volumeCubicMeters,
    0,
  );
  const cabinTemperatureK =
    before.compartments.zones.reduce(
      (total, zone) =>
        total +
        zone.temperatureK * zone.volumeCubicMeters,
      0,
    ) / zoneVolume;
  const thermalBusTemperatureK = before.cooling.nodes.find(
    (node) => node.id === "thermal-bus",
  ).temperatureK;
  const expectedCop = Math.min(
    6,
    Math.max(
      1.1,
      0.45 *
        (cabinTemperatureK /
          (thermalBusTemperatureK - cabinTemperatureK)),
    ),
  );

  const stepped = dispatch({
    type: "step",
    requestId: "step-cabin-heat-pump",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(stepped.type, "stepped", stepped.message);
  const after = dispatch({
    type: "snapshot",
    requestId: "after-cabin-heat-pump",
  }).payload.snapshot;
  const coldSideHeatJ =
    after.compartments.metabolism.sensibleHeatAddedJ -
    before.compartments.metabolism.sensibleHeatAddedJ;
  const hotSideEnergyJ =
    after.cooling.ledger.externalEnergyBySourceJ.metabolic -
    before.cooling.ledger.externalEnergyBySourceJ.metabolic;
  assert.ok(coldSideHeatJ > 0);
  assert.ok(
    Math.abs(
      hotSideEnergyJ -
        (coldSideHeatJ + coldSideHeatJ / expectedCop)
    ) < 1e-5,
    "reverse-temperature transfer must include compressor work in the hot sink",
  );
});

test("hibernation transitions consume service from their fixed A/B pod feeder", () => {
  const ready = initialize("init-hibernation-feed-coupling");
  const openedA = dispatch({
    type: "ship-command",
    requestId: "open-hibernation-a",
    commandId: "engineering:open-hibernation-a",
    idempotencyKey: "engineering:open-hibernation-a",
    issuedAtMicroseconds: 0,
    expectedRevision: ready.payload.commandBus.revision,
    expectedStateRevision: ready.payload.state.revision,
    command: {
      kind: "set-electrical-breaker",
      actorAgentId: "engineering",
      breakerId: "breaker:hibernation-a",
      commandedClosed: false,
    },
  });
  assert.equal(openedA.type, "ship-command");

  const scheduled = dispatch({
    type: "ship-command",
    requestId: "schedule-two-powered-wakes",
    commandId: "medical:schedule-two-powered-wakes",
    idempotencyKey: "medical:schedule-two-powered-wakes",
    issuedAtMicroseconds: 0,
    expectedRevision: openedA.payload.commandBus.revision,
    expectedStateRevision: openedA.payload.state.revision,
    command: {
      kind: "set-awake-target",
      actorAgentId: "medical",
      targetAwake: ready.payload.passengers.awake + 2,
    },
  });
  assert.equal(scheduled.type, "ship-command");
  assert.equal(scheduled.payload.result.scheduledPeople, 2);

  const scheduledSnapshot = dispatch({
    type: "snapshot",
    requestId: "scheduled-pod-feeders",
  }).payload.snapshot;
  const transitions =
    scheduledSnapshot.passengers.activeTransitions;
  assert.equal(transitions.length, 2);
  const aTransition = transitions.find((transition) => {
    const podIndex = Number(transition.podId.slice(4));
    return podIndex % 2 === 1;
  });
  const bTransition = transitions.find((transition) => {
    const podIndex = Number(transition.podId.slice(4));
    return podIndex % 2 === 0;
  });
  assert.ok(aTransition);
  assert.ok(bTransition);

  const stepped = dispatch({
    type: "step",
    requestId: "six-hour-asymmetric-hibernation-service",
    realSeconds: 1,
    timeScale: 21_600,
  });
  assert.equal(stepped.type, "stepped", stepped.message);
  assert.equal(
    stepped.payload.passengers.awake,
    ready.payload.passengers.awake + 1,
    "only the passenger on the powered B feeder may finish waking",
  );
  const after = dispatch({
    type: "snapshot",
    requestId: "after-asymmetric-hibernation-service",
  }).payload.snapshot;
  assert.equal(
    after.passengers.passengers.find(
      (person) => person.id === aTransition.passengerId,
    ).lifeState,
    "hibernating",
  );
  assert.equal(
    after.passengers.passengers.find(
      (person) => person.id === bTransition.passengerId,
    ).lifeState,
    "awake",
  );
  const paused = after.passengers.activeTransitions.find(
    (transition) => transition.id === aTransition.id,
  );
  assert.ok(paused);
  assert.ok(
    paused.phaseEndsAtMicroseconds >
      after.passengers.nowMicroseconds,
    "unpowered medical work must remain outstanding in the save",
  );
  const bankA = after.passengers.hibernationPowerBanks.find(
    (bank) => bank.bankId === "a",
  );
  const bankB = after.passengers.hibernationPowerBanks.find(
    (bank) => bank.bankId === "b",
  );
  assert.equal(bankA.reserveSeconds, 0);
  assert.equal(bankA.unprotectedDoseSeconds, 20_700);
  assert.equal(bankA.highestIncidentLevel, 2);
  assert.equal(bankB.reserveSeconds, 900);
  assert.equal(bankB.unprotectedDoseSeconds, 0);
  const affectedA = after.passengers.passengers.find(
    (person) => person.id === aTransition.passengerId,
  );
  assert.equal(
    affectedA.memories.filter(
      (memory) =>
        memory.eventType ===
        "hibernation-power-undervoltage",
    ).length,
    2,
    "the persistent passenger record must retain both crossed medical thresholds",
  );
});

test("jump execution requires thermal, electrical, and rigid-body interlocks", () => {
  const ready = initialize("init-jump-interlocks");
  const requiredChargeKWh =
    ready.payload.state.journey.requiredChargePerJumpKWh;
  const charged = dispatch({
    type: "intervene",
    requestId: "force-ready-jump-field",
    request: {
      actor: "player:god-mode",
      reason: "prepare deterministic jump interlock test",
      operations: [
        {
          operation: "set",
          path: "journey.jumpDriveChargeKWh",
          value: requiredChargeKWh,
        },
        {
          operation: "set",
          path: "journey.status",
          value: "ready",
        },
      ],
      declaredBalance: {
        massKg: 0,
        energyJ:
          (requiredChargeKWh -
            ready.payload.state.journey.jumpDriveChargeKWh) *
          3_600_000,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "explicit God-mode field-energy injection",
      },
      metadata: {
        mode: "direct-force",
        fieldId: "jump-field-storage",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(charged.type, "intervention", charged.message);

  const jumped = dispatch({
    type: "ship-command",
    requestId: "interlocked-jump-success",
    commandId: "captain:interlocked-jump-success",
    idempotencyKey: "captain:interlocked-jump-success",
    issuedAtMicroseconds: 0,
    expectedRevision: charged.payload.commandBus.revision,
    expectedStateRevision: charged.payload.state.revision,
    command: {
      kind: "execute-jump",
      actorAgentId: "captain",
      distanceLightYears: 1,
    },
  });
  assert.equal(jumped.type, "ship-command", jumped.message);
  assert.equal(jumped.payload.result.distanceLightYears, 1);
  assert.equal(
    jumped.payload.state.journey.completedDistanceLightYears,
    1,
  );
  assert.equal(jumped.payload.navigation.truth.frameEpoch, 1);
  assert.equal(
    jumped.payload.navigation.truth
      .anchorCompletedDistanceLightYears,
    1,
  );
  assert.ok(
    jumped.payload.navigation.sensors.every(
      (sensor) =>
        sensor.frameEpoch === null ||
        sensor.frameEpoch === 1,
    ),
    "pre-jump delayed navigation samples must not cross the frame epoch",
  );

  const reset = initialize("init-jump-interlock-rejection");
  const resetChargeKWh =
    reset.payload.state.journey.requiredChargePerJumpKWh;
  let current = dispatch({
    type: "intervene",
    requestId: "force-ready-rejected-jump",
    request: {
      actor: "player:god-mode",
      reason: "prepare rejected jump",
      operations: [
        {
          operation: "set",
          path: "journey.jumpDriveChargeKWh",
          value: resetChargeKWh,
        },
        {
          operation: "set",
          path: "journey.status",
          value: "ready",
        },
      ],
      declaredBalance: {
        massKg: 0,
        energyJ:
          (resetChargeKWh -
            reset.payload.state.journey.jumpDriveChargeKWh) *
          3_600_000,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "explicit God-mode field-energy injection",
      },
      metadata: {
        mode: "direct-force",
        fieldId: "jump-field-storage",
        sourceKnownToAi: false,
      },
    },
  }).payload;
  const breaker = dispatch({
    type: "ship-command",
    requestId: "open-jump-a-interlock",
    commandId: "engineering:open-jump-a-interlock",
    idempotencyKey: "engineering:open-jump-a-interlock",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-electrical-breaker",
      actorAgentId: "engineering",
      breakerId: "breaker:jump-drive-a",
      commandedClosed: false,
    },
  });
  assert.equal(breaker.type, "ship-command", breaker.message);
  current = breaker.payload;
  const pulse = dispatch({
    type: "ship-command",
    requestId: "active-thrust-before-jump",
    commandId: "navigation:active-thrust-before-jump",
    idempotencyKey: "navigation:active-thrust-before-jump",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "schedule-thruster-pulse",
      actorAgentId: "navigation",
      thrusterId: "main-a",
      throttleFraction: 0.1,
      durationSeconds: 120,
      startDelaySeconds: 0,
    },
  });
  assert.equal(pulse.type, "ship-command", pulse.message);
  current = pulse.payload;

  const rejected = dispatch({
    type: "ship-command",
    requestId: "reject-unsafe-jump",
    commandId: "captain:reject-unsafe-jump",
    idempotencyKey: "captain:reject-unsafe-jump",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "execute-jump",
      actorAgentId: "captain",
      distanceLightYears: 1,
    },
  });
  assert.equal(rejected.type, "error");
  assert.match(rejected.message, /jump-drive-a/);
  assert.match(rejected.message, /推进器/);
  const afterRejected = dispatch({
    type: "snapshot",
    requestId: "after-rejected-unsafe-jump",
  }).payload.snapshot;
  assert.equal(
    afterRejected.engine.state.journey.completedDistanceLightYears,
    0,
  );
  assert.equal(
    afterRejected.engine.state.journey.jumpDriveChargeKWh,
    resetChargeKWh,
  );
  assert.equal(
    afterRejected.commandBus.revision,
    current.commandBus.revision,
  );
});

test("fixed AI roles issue causal navigation, electrical, and cooling controls", () => {
  const ready = initialize("init-ai-control-surface");
  let current = ready.payload;
  let sequence = 0;

  const issue = (actorAgentId, command) => {
    sequence += 1;
    const commandId = `${actorAgentId}:control-${sequence}`;
    const event = dispatch({
      type: "ship-command",
      requestId: `control-${sequence}`,
      commandId,
      idempotencyKey: commandId,
      issuedAtMicroseconds: Math.round(
        current.elapsedSeconds * 1_000_000,
      ),
      expectedRevision: current.commandBus.revision,
      expectedStateRevision: current.state.revision,
      command: { ...command, actorAgentId },
    });
    assert.equal(event.type, "ship-command");
    current = event.payload;
    return event.payload.result;
  };

  const pulse = issue("navigation", {
    kind: "schedule-thruster-pulse",
    thrusterId: "main-a",
    throttleFraction: 0.25,
    durationSeconds: 2,
    startDelaySeconds: 0,
  });
  assert.equal(pulse.scheduledCommandId, "navigation:control-1");

  issue("engineering", {
    kind: "set-reactor-target",
    reactorId: "fusion-1",
    targetOutputKw: 180_000,
  });
  issue("engineering", {
    kind: "set-cooling-pump-speed",
    pumpId: "pump-a",
    commandedSpeedFraction: 0.62,
  });
  issue("engineering", {
    kind: "set-electrical-load-enabled",
    loadId: "habitat-b",
    enabled: false,
  });
  issue("engineering", {
    kind: "set-electrical-breaker",
    breakerId: "breaker:bus-tie",
    commandedClosed: false,
  });
  issue("engineering", {
    kind: "set-battery-mode",
    batteryId: "battery-b",
    mode: "standby",
  });
  issue("engineering", {
    kind: "set-reactor-mode",
    reactorId: "fusion-5",
    mode: "online",
  });
  const maneuver = issue("navigation", {
    kind: "schedule-thruster-maneuver",
    pulses: ["main-b", "main-c", "main-d"].map((thrusterId) => ({
      thrusterId,
      throttleFraction: 0.25,
      durationSeconds: 2,
      startDelaySeconds: 0,
    })),
  });
  assert.deepEqual(maneuver.scheduledCommandIds, [
    "navigation:control-8:pulse-1",
    "navigation:control-8:pulse-2",
    "navigation:control-8:pulse-3",
  ]);
  assert.equal(current.commandBus.revision, 8);

  const configured = dispatch({
    type: "snapshot",
    requestId: "configured-control-surface",
  }).payload.snapshot;
  assert.deepEqual(
    configured.commandBus.actors.map(({ id, role }) => ({ id, role })),
    [
      { id: "captain", role: "captain" },
      { id: "engineering", role: "engineering" },
      { id: "life-support", role: "life-support" },
      { id: "medical", role: "medical" },
      { id: "navigation", role: "navigation" },
      {
        id: "passenger-affairs",
        role: "passenger-affairs",
      },
      {
        id: "passenger-service",
        role: "passenger-service",
      },
      { id: "security", role: "security" },
    ],
  );
  assert.equal(
    configured.navigation.commands.find(
      (command) => command.id === "navigation:control-1",
    ).thrusterId,
    "main-a",
  );
  assert.equal(
    configured.electrical.reactors.find(
      (reactor) => reactor.id === "fusion-1",
    ).targetOutputKw,
    180_000,
  );
  assert.equal(
    configured.electrical.reactors.find(
      (reactor) => reactor.id === "fusion-5",
    ).mode,
    "online",
  );
  assert.equal(
    configured.cooling.pumps.find(
      (pump) => pump.id === "pump-a",
    ).commandedSpeedFraction,
    0.62,
  );
  assert.equal(
    configured.electrical.loads.find(
      (load) => load.id === "habitat-b",
    ).enabled,
    false,
  );
  assert.equal(
    configured.electrical.breakers.find(
      (breaker) => breaker.id === "breaker:bus-tie",
    ).commandedClosed,
    false,
  );
  assert.equal(
    configured.electrical.batteries.find(
      (battery) => battery.id === "battery-b",
    ).controlMode,
    "standby",
  );
  assert.equal(configured.navigation.commands.length, 4);

  const invalidManeuver = dispatch({
    type: "ship-command",
    requestId: "invalid-maneuver-rollback",
    commandId: "navigation:invalid-maneuver",
    idempotencyKey: "navigation:invalid-maneuver",
    issuedAtMicroseconds: 0,
    expectedRevision: 8,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "schedule-thruster-maneuver",
      actorAgentId: "navigation",
      pulses: [
        {
          thrusterId: "reverse-a",
          throttleFraction: 0.5,
          durationSeconds: 1,
          startDelaySeconds: 0,
        },
        {
          thrusterId: "reverse-b",
          throttleFraction: 0.5,
          durationSeconds: 0,
          startDelaySeconds: 0,
        },
      ],
    },
  });
  assert.equal(invalidManeuver.type, "error");
  assert.match(invalidManeuver.message, /duration/);
  const afterInvalidManeuver = dispatch({
    type: "snapshot",
    requestId: "after-invalid-maneuver-rollback",
  }).payload.snapshot;
  assert.deepEqual(
    afterInvalidManeuver.navigation,
    configured.navigation,
  );
  assert.equal(afterInvalidManeuver.commandBus.revision, 8);

  const propellantBefore =
    configured.navigation.body.propellantMassKg;
  const fusionFuelBefore =
    configured.navigation.propulsion.fusionFuelMassKg;
  const retainedHeatBefore =
    configured.navigation.propulsion.energyLedger
      .retainedWasteHeatJ;
  const coolingExternalEnergyBefore =
    configured.cooling.ledger.externalEnergyJ;
  const stepped = dispatch({
    type: "step",
    requestId: "execute-real-thruster-pulse",
    realSeconds: 1,
    timeScale: 2,
  });
  assert.equal(stepped.type, "stepped");
  const afterBurn = dispatch({
    type: "snapshot",
    requestId: "after-real-thruster-pulse",
  }).payload.snapshot;
  assert.ok(
    afterBurn.navigation.body.propellantMassKg < propellantBefore,
  );
  assert.ok(
    afterBurn.navigation.propulsion.fusionFuelMassKg <
      fusionFuelBefore,
  );
  assert.ok(afterBurn.navigation.body.velocityMPerS.x > 0);
  const retainedPropulsionHeatJ =
    afterBurn.navigation.propulsion.energyLedger
      .retainedWasteHeatJ - retainedHeatBefore;
  assert.ok(retainedPropulsionHeatJ > 0);
  assert.ok(
    afterBurn.cooling.ledger.externalEnergyJ -
      coolingExternalEnergyBefore >=
      retainedPropulsionHeatJ - 1e-3,
    "retained fusion loss must enter the authoritative cooling ledger",
  );

  const forbidden = dispatch({
    type: "ship-command",
    requestId: "medical-thruster-forbidden",
    commandId: "medical:thruster-forbidden",
    idempotencyKey: "medical:thruster-forbidden",
    issuedAtMicroseconds: 2_000_000,
    expectedRevision: stepped.payload.commandBus.revision,
    expectedStateRevision: stepped.payload.state.revision,
    command: {
      kind: "schedule-thruster-pulse",
      actorAgentId: "medical",
      thrusterId: "main-b",
      throttleFraction: 0.25,
      durationSeconds: 2,
      startDelaySeconds: 0,
    },
  });
  assert.equal(forbidden.type, "error");
  assert.match(forbidden.message, /FORBIDDEN/);
  const afterForbidden = dispatch({
    type: "snapshot",
    requestId: "after-medical-thruster-forbidden",
  }).payload.snapshot;
  assert.equal(afterForbidden.navigation.commands.length, 4);
  assert.equal(afterForbidden.commandBus.revision, 8);
});

test("independent propulsion control feeders reject only the unpowered torch train", () => {
  let current = initialize("init-propulsion-control-feed").payload;
  const issue = (
    actorAgentId,
    commandId,
    command,
  ) => {
    const response = dispatch({
      type: "ship-command",
      requestId: commandId,
      commandId,
      idempotencyKey: commandId,
      issuedAtMicroseconds: Math.round(
        current.elapsedSeconds * 1_000_000,
      ),
      expectedRevision: current.commandBus.revision,
      expectedStateRevision: current.state.revision,
      command: { ...command, actorAgentId },
    });
    assert.equal(response.type, "ship-command");
    current = response.payload;
  };

  issue("engineering", "propulsion-feed-a-open", {
    kind: "set-electrical-breaker",
    breakerId: "breaker:propulsion-control-a",
    commandedClosed: false,
  });
  issue("navigation", "dual-train-ignition", {
    kind: "schedule-thruster-maneuver",
    pulses: [
      {
        thrusterId: "main-a",
        throttleFraction: 0.25,
        durationSeconds: 1,
        startDelaySeconds: 0,
      },
      {
        thrusterId: "main-b",
        throttleFraction: 0.25,
        durationSeconds: 1,
        startDelaySeconds: 0,
      },
    ],
  });
  const before = dispatch({
    type: "snapshot",
    requestId: "before-dual-train-ignition",
  }).payload.snapshot;
  const stepped = dispatch({
    type: "step",
    requestId: "step-dual-train-ignition",
    realSeconds: 1,
    timeScale: 1,
  });
  assert.equal(stepped.type, "stepped");
  const after = dispatch({
    type: "snapshot",
    requestId: "after-dual-train-ignition",
  }).payload.snapshot;
  const commandA = after.navigation.commands.find(
    (command) => command.thrusterId === "main-a",
  );
  const commandB = after.navigation.commands.find(
    (command) => command.thrusterId === "main-b",
  );

  assert.equal(commandA.canceledAtMicroseconds, 0);
  assert.equal(commandB.canceledAtMicroseconds, null);
  assert.equal(
    after.navigation.propulsion.energyLedger
      .controlEnergyRequestedJ -
      before.navigation.propulsion.energyLedger
        .controlEnergyRequestedJ,
    42_000_000,
  );
  assert.equal(
    after.navigation.propulsion.energyLedger
      .controlEnergyServedJ -
      before.navigation.propulsion.energyLedger
        .controlEnergyServedJ,
    21_000_000,
  );
  assert.ok(
    after.navigation.body.propellantMassKg <
      before.navigation.body.propellantMassKg,
    "the independently powered B train must still produce thrust",
  );
  assert.ok(
    after.navigation.propulsion.fusionFuelMassKg <
      before.navigation.propulsion.fusionFuelMassKg,
  );
  assert.ok(
    after.cooling.ledger.externalEnergyBySourceJ.propulsion -
      before.cooling.ledger.externalEnergyBySourceJ.propulsion >
      21_000_000,
    "served controls and retained torch loss must both enter propulsion heat",
  );
});

test("A/B habitat-ring drives close their electrical and thermal ledgers", () => {
  let current = initialize("init-rotation-energy-coupling").payload;
  const balanced = dispatch({
    type: "step",
    requestId: "step-balanced-rotation-drives",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(balanced.type, "stepped", balanced.message);
  current = balanced.payload;
  const balancedSnapshot = dispatch({
    type: "snapshot",
    requestId: "balanced-rotation-ledgers",
  }).payload.snapshot;
  const electricalLedger = balancedSnapshot.electrical.ledger;
  const demandedA =
    electricalLedger.demandedLoadEnergyKWhById[
      "rotation-drive-a"
    ];
  const demandedB =
    electricalLedger.demandedLoadEnergyKWhById[
      "rotation-drive-b"
    ];
  const servedA =
    electricalLedger.servedLoadEnergyKWhById[
      "rotation-drive-a"
    ];
  const servedB =
    electricalLedger.servedLoadEnergyKWhById[
      "rotation-drive-b"
    ];
  assert.ok(demandedA > 0 && demandedB > 0);
  assert.ok(Math.abs(demandedA - demandedB) < 1e-9);
  assert.ok(Math.abs(servedA - demandedA) < 1e-9);
  assert.ok(Math.abs(servedB - demandedB) < 1e-9);
  assert.ok(
    Math.abs(
      balancedSnapshot.rotation.energyLedger
        .requestedElectricalEnergyJ -
        (demandedA + demandedB) * 3_600_000,
    ) < 1e-3,
  );
  assert.ok(
    Math.abs(
      balancedSnapshot.rotation.energyLedger
        .servedElectricalEnergyJ -
        (servedA + servedB) * 3_600_000,
    ) < 1e-3,
  );

  const openA = dispatch({
    type: "ship-command",
    requestId: "open-rotation-drive-a",
    commandId: "engineering:open-rotation-drive-a",
    idempotencyKey: "engineering:open-rotation-drive-a",
    issuedAtMicroseconds: 60_000_000,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-electrical-breaker",
      actorAgentId: "engineering",
      breakerId: "breaker:rotation-drive-a",
      commandedClosed: false,
    },
  });
  assert.equal(openA.type, "ship-command", openA.message);
  current = openA.payload;
  const beforeUnpowered = dispatch({
    type: "snapshot",
    requestId: "before-unpowered-ring-a",
  }).payload.snapshot;
  const unpowered = dispatch({
    type: "step",
    requestId: "step-unpowered-ring-a",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(unpowered.type, "stepped", unpowered.message);
  const afterUnpowered = dispatch({
    type: "snapshot",
    requestId: "after-unpowered-ring-a",
  }).payload.snapshot;
  const demandedDelta = (loadId) =>
    afterUnpowered.electrical.ledger
      .demandedLoadEnergyKWhById[loadId] -
    beforeUnpowered.electrical.ledger
      .demandedLoadEnergyKWhById[loadId];
  const servedDelta = (loadId) =>
    afterUnpowered.electrical.ledger
      .servedLoadEnergyKWhById[loadId] -
    beforeUnpowered.electrical.ledger
      .servedLoadEnergyKWhById[loadId];
  const demandedRotationDeltaKWh =
    demandedDelta("rotation-drive-a") +
    demandedDelta("rotation-drive-b");
  const servedRotationDeltaKWh =
    servedDelta("rotation-drive-a") +
    servedDelta("rotation-drive-b");
  assert.ok(demandedDelta("rotation-drive-a") > 0);
  assert.equal(servedDelta("rotation-drive-a"), 0);
  assert.ok(servedDelta("rotation-drive-b") > 0);
  assert.ok(
    Math.abs(
      afterUnpowered.rotation.energyLedger
        .requestedElectricalEnergyJ -
        beforeUnpowered.rotation.energyLedger
          .requestedElectricalEnergyJ -
        demandedRotationDeltaKWh * 3_600_000,
    ) < 1e-3,
  );
  assert.ok(
    Math.abs(
      afterUnpowered.rotation.energyLedger
        .servedElectricalEnergyJ -
        beforeUnpowered.rotation.energyLedger
          .servedElectricalEnergyJ -
        servedRotationDeltaKWh * 3_600_000,
    ) < 1e-3,
  );
  const rotationHeat =
    afterUnpowered.rotation.energyLedger.heatJ;
  const heatComponents = [
    "controlElectricalHeatJ",
    "driveElectricalLossHeatJ",
    "bearingFrictionHeatJ",
    "mechanicalBrakeHeatJ",
    "activeBrakingHeatJ",
  ].reduce(
    (total, key) =>
      total + afterUnpowered.rotation.energyLedger[key],
    0,
  );
  assert.ok(Math.abs(rotationHeat - heatComponents) < 1e-3);
  assert.ok(
    Math.abs(
      afterUnpowered.cooling.ledger
        .externalEnergyBySourceJ["rotation-drive"] -
        rotationHeat,
    ) < 1e-3,
    "all ring control, drive-loss, bearing, and braking heat must enter cooling",
  );
  assert.ok(
    Math.abs(
      afterUnpowered.rotation.energyLedger
        .servedElectricalEnergyJ -
        rotationHeat -
        afterUnpowered.rotation.energyLedger
          .mechanicalEnergyChangeJ,
    ) < 1e-3,
    "served ring electrical energy must close against heat and coupled mechanical energy",
  );
});

test("captain and engineering ring commands are authorized, causal, and atomic", () => {
  let current = initialize("init-rotation-command-surface").payload;
  const initial = dispatch({
    type: "snapshot",
    requestId: "initial-ring-command-state",
  }).payload.snapshot;
  const initialRpm =
    (initial.rotation.rings[0].relativeAngularVelocityRadPerS *
      60) /
    (2 * Math.PI);

  const engineering = dispatch({
    type: "ship-command",
    requestId: "engineering-ring-coast",
    commandId: "engineering:ring-coast",
    idempotencyKey: "engineering:ring-coast",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-habitat-ring-control",
      actorAgentId: "engineering",
      ringId: "ring-a",
      controlMode: "coast",
      targetRelativeRpm: 1.5,
    },
  });
  assert.equal(engineering.type, "ship-command", engineering.message);
  assert.equal(engineering.payload.result.ringControlMode, "coast");
  current = engineering.payload;
  const afterEngineering = dispatch({
    type: "snapshot",
    requestId: "after-engineering-ring-coast",
  }).payload.snapshot;
  assert.equal(afterEngineering.rotation.rings[0].controlMode, "coast");
  assert.equal(afterEngineering.rotation.rings[0].targetRelativeRpm, 1.5);
  assert.equal(
    (afterEngineering.rotation.rings[0]
      .relativeAngularVelocityRadPerS *
      60) /
      (2 * Math.PI),
    initialRpm,
    "a control command changes actuators, not the ring's physical rpm instantaneously",
  );

  const captain = dispatch({
    type: "ship-command",
    requestId: "captain-ring-speed-hold",
    commandId: "captain:ring-speed-hold",
    idempotencyKey: "captain:ring-speed-hold",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-habitat-ring-control",
      actorAgentId: "captain",
      ringId: "ring-b",
      controlMode: "speed-hold",
      targetRelativeRpm: -1.8,
    },
  });
  assert.equal(captain.type, "ship-command", captain.message);
  current = captain.payload;
  const beforeRejected = dispatch({
    type: "snapshot",
    requestId: "before-rejected-ring-commands",
  }).payload.snapshot;

  const forbidden = dispatch({
    type: "ship-command",
    requestId: "medical-ring-command-forbidden",
    commandId: "medical:ring-command-forbidden",
    idempotencyKey: "medical:ring-command-forbidden",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-habitat-ring-control",
      actorAgentId: "medical",
      ringId: "ring-a",
      controlMode: "brake",
      targetRelativeRpm: 0,
    },
  });
  assert.equal(forbidden.type, "error");
  assert.match(forbidden.message, /FORBIDDEN/);
  const afterForbidden = dispatch({
    type: "snapshot",
    requestId: "after-forbidden-ring-command",
  }).payload.snapshot;
  assert.deepEqual(afterForbidden.rotation, beforeRejected.rotation);
  assert.deepEqual(afterForbidden.electrical, beforeRejected.electrical);
  assert.deepEqual(afterForbidden.navigation, beforeRejected.navigation);
  assert.equal(afterForbidden.commandBus.revision, 2);
  assert.equal(
    afterForbidden.commandBus.auditHistory.at(-1).rejection.code,
    "FORBIDDEN",
  );

  const invalid = dispatch({
    type: "ship-command",
    requestId: "invalid-ring-target-rollback",
    commandId: "engineering:invalid-ring-target",
    idempotencyKey: "engineering:invalid-ring-target",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-habitat-ring-control",
      actorAgentId: "engineering",
      ringId: "ring-a",
      controlMode: "speed-hold",
      targetRelativeRpm: 13,
    },
  });
  assert.equal(invalid.type, "error");
  assert.match(invalid.message, /EXECUTOR_ERROR.+between -12 and 12 rpm/);
  const afterInvalid = dispatch({
    type: "snapshot",
    requestId: "after-invalid-ring-target",
  }).payload.snapshot;
  for (const domain of [
    "engine",
    "passengers",
    "compartments",
    "cooling",
    "electrical",
    "navigation",
    "rotation",
  ]) {
    assert.deepEqual(
      afterInvalid[domain],
      beforeRejected[domain],
      `${domain} must roll back after a ring executor failure`,
    );
  }
  assert.equal(afterInvalid.commandBus.revision, 2);
  assert.equal(
    afterInvalid.commandBus.auditHistory.at(-1).rejection.code,
    "EXECUTOR_ERROR",
  );
});

test("single-ring coast, braking, and feeder loss exchange real carrier momentum", () => {
  let current = initialize("init-single-ring-reaction").payload;
  const issue = (commandId, actorAgentId, command) => {
    const event = dispatch({
      type: "ship-command",
      requestId: commandId,
      commandId,
      idempotencyKey: commandId,
      issuedAtMicroseconds: Math.round(
        current.elapsedSeconds * 1_000_000,
      ),
      expectedRevision: current.commandBus.revision,
      expectedStateRevision: current.state.revision,
      command: { ...command, actorAgentId },
    });
    assert.equal(event.type, "ship-command", event.message);
    current = event.payload;
  };
  const ringRpm = (snapshot, ringId) =>
    (snapshot.rotation.rings.find((ring) => ring.id === ringId)
      .relativeAngularVelocityRadPerS *
      60) /
    (2 * Math.PI);

  issue("engineering:ring-a-coast", "engineering", {
    kind: "set-habitat-ring-control",
    ringId: "ring-a",
    controlMode: "coast",
    targetRelativeRpm: 0,
  });
  issue("engineering:ring-a-feeder-open", "engineering", {
    kind: "set-electrical-breaker",
    breakerId: "breaker:rotation-drive-a",
    commandedClosed: false,
  });
  const beforeCoast = dispatch({
    type: "snapshot",
    requestId: "before-ring-a-coast",
  }).payload.snapshot;
  const coast = dispatch({
    type: "step",
    requestId: "step-ring-a-coast",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(coast.type, "stepped", coast.message);
  current = coast.payload;
  const afterCoast = dispatch({
    type: "snapshot",
    requestId: "after-ring-a-coast",
  }).payload.snapshot;
  const coastRpmDrop =
    ringRpm(beforeCoast, "ring-a") -
    ringRpm(afterCoast, "ring-a");
  assert.ok(coastRpmDrop > 0);
  assert.ok(ringRpm(afterCoast, "ring-a") > 1.9);
  assert.equal(
    afterCoast.electrical.ledger.servedLoadEnergyKWhById[
      "rotation-drive-a"
    ] -
      beforeCoast.electrical.ledger.servedLoadEnergyKWhById[
        "rotation-drive-a"
      ],
    0,
  );
  assert.ok(
    afterCoast.navigation.body.angularVelocityBodyRadPerS.x > 0,
    "bearing drag on one ring must spin the carrier in reaction",
  );
  assert.ok(
    Math.abs(
      afterCoast.navigation.momentumLedger
        .internalAngularImpulseBodyNms.x -
        afterCoast.rotation.carrierAngularImpulseXSinceFrame,
    ) < 1e-3,
  );
  assert.deepEqual(
    afterCoast.navigation.momentumLedger.torqueImpulseBodyNms,
    { x: 0, y: 0, z: 0 },
    "the ring reaction must be internal rather than a fabricated thruster torque",
  );
  assert.ok(
    Math.abs(
      afterCoast.rotation.rings.reduce(
        (total, ring) =>
          total +
          ring.inertiaKgM2 *
            ring.relativeAngularVelocityRadPerS,
        0,
      ) +
        afterCoast.rotation.lastCarrierState.inertiaXKgM2 *
          afterCoast.navigation.body.angularVelocityBodyRadPerS.x,
    ) < 1e-2,
    "ring plus carrier angular momentum must remain closed without external torque",
  );

  issue("engineering:ring-a-feeder-close", "engineering", {
    kind: "set-electrical-breaker",
    breakerId: "breaker:rotation-drive-a",
    commandedClosed: true,
  });
  issue("captain:ring-a-brake", "captain", {
    kind: "set-habitat-ring-control",
    ringId: "ring-a",
    controlMode: "brake",
    targetRelativeRpm: 0,
  });
  const beforeBrake = dispatch({
    type: "snapshot",
    requestId: "before-powered-ring-a-brake",
  }).payload.snapshot;
  assert.equal(
    ringRpm(beforeBrake, "ring-a"),
    ringRpm(afterCoast, "ring-a"),
    "the brake command itself must not teleport the ring to its target rpm",
  );
  const braking = dispatch({
    type: "step",
    requestId: "step-powered-ring-a-brake",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(braking.type, "stepped", braking.message);
  const afterBrake = dispatch({
    type: "snapshot",
    requestId: "after-powered-ring-a-brake",
  }).payload.snapshot;
  const brakeRpmDrop =
    ringRpm(beforeBrake, "ring-a") -
    ringRpm(afterBrake, "ring-a");
  assert.ok(brakeRpmDrop > coastRpmDrop * 20);
  const ringAAfterBrake = afterBrake.rotation.rings.find(
    (ring) => ring.id === "ring-a",
  );
  assert.ok(ringAAfterBrake.lastBrakeTorqueNm < 0);
  assert.ok(
    afterBrake.rotation.energyLedger.activeBrakingHeatJ >
      beforeBrake.rotation.energyLedger.activeBrakingHeatJ,
  );
  assert.ok(
    afterBrake.electrical.ledger.servedLoadEnergyKWhById[
      "rotation-drive-a"
    ] >
      beforeBrake.electrical.ledger.servedLoadEnergyKWhById[
        "rotation-drive-a"
      ],
  );
  assert.ok(
    afterBrake.navigation.body.angularVelocityBodyRadPerS.x >
      beforeBrake.navigation.body.angularVelocityBodyRadPerS.x,
  );
});

test("jump frame rebasing clears only frame ledgers and restores atomically", () => {
  let current = initialize("init-rotation-jump-rebase").payload;
  const issue = (commandId, command) => {
    const event = dispatch({
      type: "ship-command",
      requestId: commandId,
      commandId,
      idempotencyKey: commandId,
      issuedAtMicroseconds: Math.round(
        current.elapsedSeconds * 1_000_000,
      ),
      expectedRevision: current.commandBus.revision,
      expectedStateRevision: current.state.revision,
      command,
    });
    assert.equal(event.type, "ship-command", event.message);
    current = event.payload;
    return event;
  };
  issue("engineering:jump-rebase-coast", {
    kind: "set-habitat-ring-control",
    actorAgentId: "engineering",
    ringId: "ring-a",
    controlMode: "coast",
    targetRelativeRpm: 0,
  });
  issue("engineering:jump-rebase-open-feed", {
    kind: "set-electrical-breaker",
    actorAgentId: "engineering",
    breakerId: "breaker:rotation-drive-a",
    commandedClosed: false,
  });
  const stepped = dispatch({
    type: "step",
    requestId: "step-before-jump-rebase",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(stepped.type, "stepped", stepped.message);
  current = stepped.payload;
  const beforeJump = dispatch({
    type: "snapshot",
    requestId: "before-rotation-jump-rebase",
  }).payload.snapshot;
  assert.notEqual(
    beforeJump.rotation.carrierAngularImpulseXSinceFrame,
    0,
  );
  assert.ok(
    Math.abs(beforeJump.navigation.body.angularVelocityBodyRadPerS.x) <
      1e-5,
  );
  const ringStateBeforeJump = structuredClone(
    beforeJump.rotation.rings,
  );
  const lifetimeEnergyBeforeJump = structuredClone(
    beforeJump.rotation.energyLedger,
  );
  const requiredChargeKWh =
    current.state.journey.requiredChargePerJumpKWh;
  const charged = dispatch({
    type: "intervene",
    requestId: "charge-field-for-rotation-rebase",
    request: {
      actor: "player:god-mode",
      reason: "prepare rotation frame-rebase restore test",
      operations: [
        {
          operation: "set",
          path: "journey.jumpDriveChargeKWh",
          value: requiredChargeKWh,
        },
        {
          operation: "set",
          path: "journey.status",
          value: "ready",
        },
      ],
      declaredBalance: {
        massKg: 0,
        energyJ:
          (requiredChargeKWh -
            current.state.journey.jumpDriveChargeKWh) *
          3_600_000,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "explicit God-mode field-energy injection",
      },
      metadata: {
        mode: "direct-force",
        fieldId: "jump-field-storage",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(charged.type, "intervention", charged.message);
  current = charged.payload;
  const jumped = issue("captain:rotation-frame-rebase-jump", {
    kind: "execute-jump",
    actorAgentId: "captain",
    distanceLightYears: 1,
  });
  assert.equal(jumped.payload.navigation.truth.frameEpoch, 1);
  const rebased = dispatch({
    type: "snapshot",
    requestId: "rebased-rotation-frame",
  }).payload.snapshot;
  assert.deepEqual(rebased.rotation.rings, ringStateBeforeJump);
  assert.deepEqual(
    rebased.rotation.energyLedger,
    lifetimeEnergyBeforeJump,
    "jump rebasing must retain physical ring state and lifetime energy",
  );
  assert.equal(rebased.rotation.carrierAngularImpulseXSinceFrame, 0);
  assert.equal(
    rebased.rotation.carrierKineticEnergyChangeJSinceFrame,
    0,
  );
  assert.deepEqual(
    rebased.navigation.momentumLedger.internalAngularImpulseBodyNms,
    { x: 0, y: 0, z: 0 },
  );
  assert.deepEqual(
    rebased.navigation.momentumLedger
      .internalAngularMomentumExchangeInertialKgM2PerS,
    { x: 0, y: 0, z: 0 },
  );
  assert.equal(
    rebased.navigation.energyLedger
      .internalMechanicalEnergyTransferJ,
    0,
  );

  const restored = dispatch({
    type: "restore",
    requestId: "restore-rebased-rotation-frame",
    snapshot: rebased,
  });
  assert.equal(restored.type, "ready", restored.message);
  const afterRestore = dispatch({
    type: "snapshot",
    requestId: "after-restored-rotation-frame",
  }).payload.snapshot;
  assert.deepEqual(afterRestore, rebased);
});

test("high-speed wake transitions change compartment metabolism at exact boundaries", () => {
  const ready = initialize("init-transition-segmentation");
  const scheduled = dispatch({
    type: "ship-command",
    requestId: "schedule-wakes",
    commandId: "medical:schedule-wakes",
    idempotencyKey: "medical:schedule-wakes",
    issuedAtMicroseconds: 0,
    expectedRevision: ready.payload.commandBus.revision,
    expectedStateRevision: ready.payload.state.revision,
    command: {
      kind: "set-awake-target",
      actorAgentId: "medical",
      targetAwake: 242,
    },
  });
  assert.equal(scheduled.type, "ship-command");
  assert.equal(scheduled.payload.commandBus.revision, 1);
  assert.equal(scheduled.payload.result.scheduledPeople, 24);

  const stepped = dispatch({
    type: "step",
    requestId: "six-hour-wake-window",
    realSeconds: 1,
    timeScale: 21_600,
  });
  assert.equal(stepped.type, "stepped");
  assert.equal(stepped.payload.passengers.awake, 225);
  const zoneAwake = dispatch({
    type: "snapshot",
    requestId: "wake-segment-snapshot",
  }).payload.snapshot.compartments.zones.reduce(
    (total, zone) => total + zone.awakeOccupants,
    0,
  );
  assert.equal(zoneAwake, 225);
  assert.ok(
    stepped.payload.state.consumables.foodConsumedKgCumulative > 0,
  );
});

test("cross-domain intervention failure rolls every physical authority back", () => {
  initialize("init-cross-domain-rollback");
  const before = dispatch({
    type: "snapshot",
    requestId: "before-cross-domain-failure",
  }).payload.snapshot;
  const rejected = dispatch({
    type: "intervene",
    requestId: "oversized-stellar-heating",
    request: {
      actor: "player:god-mode",
      reason: "force cooling-domain validation failure",
      operations: [
        {
          operation: "set",
          path: "environment.stellarIrradianceWattsPerSquareMeter",
          value: 1_000_000_000_000,
        },
      ],
      declaredBalance: {
        massKg: 0,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "invalid test boundary",
      },
      metadata: {
        mode: "causal-event",
        eventType: "stellar-flare",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(rejected.type, "error");
  assert.match(rejected.message, /thermalPowerW/);
  const after = dispatch({
    type: "snapshot",
    requestId: "after-cross-domain-failure",
  }).payload.snapshot;
  assert.deepEqual(after, before);
});

test("malformed nine-clock, cross-ledger, and command-bus restores are rejected atomically", () => {
  initialize("init-atomic-restore");
  dispatch({
    type: "step",
    requestId: "advance-before-invalid",
    realSeconds: 1,
    timeScale: 60,
  });
  const snapshot = dispatch({
    type: "snapshot",
    requestId: "valid-before-invalid",
  }).payload.snapshot;

  const inconsistentProjection = structuredClone(snapshot);
  inconsistentProjection.engine.state.atmosphere.gasesKg.oxygen *= 0.5;
  const projectionRejected = dispatch({
    type: "restore",
    requestId: "invalid-projection",
    snapshot: inconsistentProjection,
  });
  assert.equal(projectionRejected.type, "error");
  assert.match(projectionRejected.message, /oxygen mass/);

  const inconsistentThermalProjection = structuredClone(snapshot);
  inconsistentThermalProjection.engine.state.thermal.coolantTemperatureK +=
    10;
  const thermalRejected = dispatch({
    type: "restore",
    requestId: "invalid-thermal-projection",
    snapshot: inconsistentThermalProjection,
  });
  assert.equal(thermalRejected.type, "error");
  assert.match(thermalRejected.message, /thermal.coolantTemperatureK/);

  const inconsistentPowerProjection = structuredClone(snapshot);
  inconsistentPowerProjection.engine.state.power.generationKw += 1;
  const powerRejected = dispatch({
    type: "restore",
    requestId: "invalid-power-projection",
    snapshot: inconsistentPowerProjection,
  });
  assert.equal(powerRejected.type, "error");
  assert.match(powerRejected.message, /power.generationKw/);

  const inconsistentWaterClock = structuredClone(snapshot);
  inconsistentWaterClock.water.elapsedMicroseconds += 1_000_000;
  const waterClockRejected = dispatch({
    type: "restore",
    requestId: "invalid-water-clock",
    snapshot: inconsistentWaterClock,
  });
  assert.equal(waterClockRejected.type, "error");
  assert.match(waterClockRejected.message, /water.*maintenance clocks/);

  const inconsistentMaintenanceClock = structuredClone(snapshot);
  inconsistentMaintenanceClock.maintenance.elapsedMicroseconds += 1_000_000;
  const maintenanceClockRejected = dispatch({
    type: "restore",
    requestId: "invalid-maintenance-clock",
    snapshot: inconsistentMaintenanceClock,
  });
  assert.equal(maintenanceClockRejected.type, "error");
  assert.match(maintenanceClockRejected.message, /maintenance clocks/);

  const forgedMaintenanceInventory = structuredClone(snapshot);
  forgedMaintenanceInventory.maintenance.inventory["pump-service-kit"] += 1;
  const maintenanceInventoryRejected = dispatch({
    type: "restore",
    requestId: "invalid-maintenance-inventory",
    snapshot: forgedMaintenanceInventory,
  });
  assert.equal(maintenanceInventoryRejected.type, "error");
  assert.match(
    maintenanceInventoryRejected.message,
    /exceeds initial stock|does not reconcile/,
  );

  const inconsistentWaterProjection = structuredClone(snapshot);
  inconsistentWaterProjection.engine.state.water.potableKg += 1;
  const waterProjectionRejected = dispatch({
    type: "restore",
    requestId: "invalid-water-projection",
    snapshot: inconsistentWaterProjection,
  });
  assert.equal(waterProjectionRejected.type, "error");
  assert.match(waterProjectionRejected.message, /water.potableKg/);

  const forgedPropulsionControl = structuredClone(snapshot);
  forgedPropulsionControl.navigation.propulsion.energyLedger
    .controlEnergyRequestedJ += 3_600;
  forgedPropulsionControl.navigation.propulsion.energyLedger
    .controlEnergyServedJ += 3_600;
  const forgedControlRejected = dispatch({
    type: "restore",
    requestId: "invalid-propulsion-control-ledger",
    snapshot: forgedPropulsionControl,
  });
  assert.equal(forgedControlRejected.type, "error");
  assert.match(
    forgedControlRejected.message,
    /propulsion requested control energy/,
  );

  const forgedPropulsionHeat = structuredClone(snapshot);
  forgedPropulsionHeat.cooling.ledger
    .externalEnergyBySourceJ.propulsion += 1_000;
  forgedPropulsionHeat.cooling.ledger
    .externalEnergyBySourceJ.metabolic -= 1_000;
  const forgedHeatRejected = dispatch({
    type: "restore",
    requestId: "invalid-propulsion-heat-ledger",
    snapshot: forgedPropulsionHeat,
  });
  assert.equal(forgedHeatRejected.type, "error");
  assert.match(
    forgedHeatRejected.message,
    /propulsion thermal energy/,
  );

  const forgedRotationDemand = structuredClone(snapshot);
  forgedRotationDemand.electrical.ledger
    .demandedLoadEnergyKWhById["rotation-drive-a"] += 0.001;
  const forgedRotationDemandRejected = dispatch({
    type: "restore",
    requestId: "invalid-rotation-demand-cross-ledger",
    snapshot: forgedRotationDemand,
  });
  assert.equal(forgedRotationDemandRejected.type, "error");
  assert.match(
    forgedRotationDemandRejected.message,
    /rotation requested electrical energy/,
  );

  const forgedRotationService = structuredClone(snapshot);
  forgedRotationService.electrical.ledger
    .demandedLoadEnergyKWhById["rotation-drive-b"] += 0.001;
  forgedRotationService.electrical.ledger
    .servedLoadEnergyKWhById["rotation-drive-b"] += 0.001;
  forgedRotationService.electrical.ledger
    .servedLoadEnergyKWhById["habitat-b"] -= 0.001;
  forgedRotationService.rotation.energyLedger
    .requestedElectricalEnergyJ += 3_600;
  const forgedRotationServiceRejected = dispatch({
    type: "restore",
    requestId: "invalid-rotation-service-cross-ledger",
    snapshot: forgedRotationService,
  });
  assert.equal(forgedRotationServiceRejected.type, "error");
  assert.match(
    forgedRotationServiceRejected.message,
    /rotation served electrical energy/,
  );

  const forgedRotationHeat = structuredClone(snapshot);
  forgedRotationHeat.cooling.ledger
    .externalEnergyBySourceJ["rotation-drive"] += 1_000;
  forgedRotationHeat.cooling.ledger
    .externalEnergyBySourceJ.metabolic -= 1_000;
  const forgedRotationHeatRejected = dispatch({
    type: "restore",
    requestId: "invalid-rotation-heat-cross-ledger",
    snapshot: forgedRotationHeat,
  });
  assert.equal(forgedRotationHeatRejected.type, "error");
  assert.match(
    forgedRotationHeatRejected.message,
    /rotation thermal energy/,
  );

  const forgedInternalImpulse = structuredClone(snapshot);
  forgedInternalImpulse.navigation.momentumLedger
    .internalAngularImpulseBodyNms.x += 1_000;
  const forgedInternalImpulseRejected = dispatch({
    type: "restore",
    requestId: "invalid-rotation-navigation-impulse",
    snapshot: forgedInternalImpulse,
  });
  assert.equal(forgedInternalImpulseRejected.type, "error");
  assert.match(
    forgedInternalImpulseRejected.message,
    /rotation carrier angular impulse/,
  );

  const forgedAirHandlerCapture = structuredClone(snapshot);
  forgedAirHandlerCapture.compartments.airHandlers[0]
    .cumulativeCapturedCarbonDioxideKg += 1;
  const forgedAirHandlerCaptureRejected = dispatch({
    type: "restore",
    requestId: "invalid-air-handler-capture-ledger",
    snapshot: forgedAirHandlerCapture,
  });
  assert.equal(forgedAirHandlerCaptureRejected.type, "error");
  assert.match(
    forgedAirHandlerCaptureRejected.message,
    /captured carbon dioxide/,
  );

  const malformed = structuredClone(snapshot);
  malformed.cooling.elapsedMicroseconds += 1_000_000;

  const rejected = dispatch({
    type: "restore",
    requestId: "invalid-restore",
    snapshot: malformed,
  });
  assert.equal(rejected.type, "error");
  assert.match(rejected.message, /clocks do not match/);

  const malformedNavigationClock = structuredClone(snapshot);
  malformedNavigationClock.navigation.elapsedMicroseconds +=
    1_000_000;
  const navigationRejected = dispatch({
    type: "restore",
    requestId: "invalid-navigation-clock",
    snapshot: malformedNavigationClock,
  });
  assert.equal(navigationRejected.type, "error");
  assert.match(navigationRejected.message, /clocks do not match/);

  const malformedRotationClock = structuredClone(snapshot);
  malformedRotationClock.rotation.elapsedMicroseconds +=
    1_000_000;
  const rotationRejected = dispatch({
    type: "restore",
    requestId: "invalid-rotation-clock",
    snapshot: malformedRotationClock,
  });
  assert.equal(rotationRejected.type, "error");
  assert.match(rotationRejected.message, /clocks do not match/);

  const malformedBus = structuredClone(snapshot);
  malformedBus.commandBus.actors[0].role = "unauthorized-role";
  const busRejected = dispatch({
    type: "restore",
    requestId: "invalid-command-bus",
    snapshot: malformedBus,
  });
  assert.equal(busRejected.type, "error");
  assert.match(busRejected.message, /topology|whitelist/);

  const inspected = dispatch({
    type: "inspect",
    requestId: "inspect-after-invalid",
  });
  assert.equal(
    inspected.payload.elapsedSeconds,
    snapshot.engine.clock.elapsedMicroseconds / 1_000_000,
  );
  const afterAllRejectedRestores = dispatch({
    type: "snapshot",
    requestId: "snapshot-after-all-rejected-restores",
  }).payload.snapshot;
  assert.deepEqual(
    afterAllRejectedRestores,
    snapshot,
    "every malformed nine-domain restore must leave the live runtime untouched",
  );
});
