import assert from "node:assert/strict";
import test from "node:test";

import { resolveZoneIdForCabin } from "../../lib/sim/compartments.ts";

const emitted = [];
globalThis.postMessage = (event) => {
  emitted.push(event);
};
await import("../../lib/sim/worker.ts");

const TEST_ZONE_ID = "A-05";
const NEIGHBOR_ZONE_IDS = new Set(["A-04", "A-06"]);
const TEST_EXPOSURE_FAMILIES = ["low-pressure", "hypoxia"];

function dispatch(command) {
  emitted.length = 0;
  globalThis.onmessage({ data: command });
  assert.equal(emitted.length, 1);
  return emitted[0];
}

function initialize(requestId) {
  const ready = dispatch({
    type: "initialize",
    requestId,
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: "environment-passenger-coupling",
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: 60,
    },
  });
  assert.equal(ready.type, "ready", ready.message);
  // initialize acquires a default `ui` pause token; release it so steps advance.
  const released = dispatch({
    type: "set-time-control",
    requestId: `${requestId}:release-ui`,
    releasePauseTokens: ["ui"],
  });
  assert.equal(released.type, "ready", released.message);
  assert.equal(released.payload.timeControl.paused, false);
  return released;
}

function snapshot(requestId) {
  const response = dispatch({ type: "snapshot", requestId });
  assert.equal(response.type, "snapshot", response.message);
  return response.payload.snapshot;
}

function stableZoneForCabin(cabinId) {
  return resolveZoneIdForCabin(cabinId);
}

function derivedLivingAverages(passengers) {
  let livingCount = 0;
  let averageHealth = 0;
  let averageMorale = 0;
  for (const person of passengers) {
    if (person.lifeState === "deceased") continue;
    livingCount += 1;
    averageHealth += person.health.physical;
    averageMorale += person.psychology.stability;
  }
  return {
    averageHealth: livingCount === 0 ? 0 : averageHealth / livingCount,
    averageMorale: livingCount === 0 ? 0 : averageMorale / livingCount,
  };
}

function assertEnginePopulationIsDerived(runtimeSnapshot) {
  const derived = derivedLivingAverages(
    runtimeSnapshot.passengers.passengers,
  );
  assert.equal(
    runtimeSnapshot.engine.state.population.averageHealth,
    derived.averageHealth,
  );
  assert.equal(
    runtimeSnapshot.engine.state.population.averageMorale,
    derived.averageMorale,
  );
}

function matchingExposureMemories(person) {
  return person.memories.filter((memory) =>
    TEST_EXPOSURE_FAMILIES.some((family) =>
      memory.incident?.eventId.startsWith(
        `compartment-exposure:${TEST_ZONE_ID}:${family}:`,
      ),
    ),
  );
}

function exposureState(runtimeSnapshot, family) {
  return runtimeSnapshot.passengerEnvironmentalExposures.find(
    (state) =>
      state.zoneId === TEST_ZONE_ID && state.family === family,
  );
}

function isolateTestZone(current) {
  const response = dispatch({
    type: "ship-command",
    requestId: "isolate-a-05-before-breach",
    commandId: "life-support:isolate-a-05-before-breach",
    idempotencyKey: "life-support:isolate-a-05-before-breach",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "isolate-pressure-zone",
      actorAgentId: "life-support",
      zoneId: TEST_ZONE_ID,
    },
  });
  assert.equal(response.type, "ship-command", response.message);
  assert.ok(response.payload.result.actuatedConnections > 0);
  return response.payload;
}

function openLargeMicrometeoroidBreach() {
  const response = dispatch({
    type: "intervene",
    requestId: "open-a-05-0.2-square-meter-breach",
    request: {
      actor: "player:god-mode",
      reason: "test isolated A-05 environmental exposure",
      operations: [
        {
          operation: "add",
          path: "atmosphere.leakAreaSquareMeters",
          value: 0.2,
        },
      ],
      declaredBalance: {
        massKg: -0.025,
        energyJ: 25_000,
        linearMomentumKgMPerSecond: [12, -2.4, 0.9],
        angularMomentumKgM2PerSecond: [0, 280, -740],
        note: "0.2 square meter exposure-test breach (balance mirrors procedural mm-scale grain story)",
      },
      metadata: {
        mode: "causal-event",
        eventType: "micrometeoroid",
        targetZoneId: TEST_ZONE_ID,
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(response.type, "intervention", response.message);
  assert.equal(response.payload.compartments.activeBreaches, 1);
}

function stepSimulation(requestId, simulatedSeconds) {
  const response = dispatch({
    type: "step",
    requestId,
    realSeconds: 1,
    timeScale: simulatedSeconds,
  });
  assert.equal(response.type, "stepped", response.message);
  assert.equal(
    response.payload.compartments.effectiveTimeScale,
    simulatedSeconds,
  );
}

test("the fixed roster is the exact population authority from initialization", () => {
  const ready = initialize("init-derived-population-authority");
  assert.equal(ready.type, "ready", ready.message);

  const initial = snapshot("initial-derived-population-snapshot");
  assert.equal(initial.engine.populationAuthority, "external-roster");
  assertEnginePopulationIsDerived(initial);
});

test("an isolated local breach exposes only awake A-05 occupants and restores idempotently", () => {
  const current = initialize("init-local-environmental-exposure").payload;
  isolateTestZone(current);

  const beforeBreach = snapshot("before-local-environmental-exposure");
  const occupants = beforeBreach.passengers.passengers;
  const awakeInTestZone = occupants.filter(
    (person) =>
      person.lifeState === "awake" &&
      stableZoneForCabin(person.cabinId) === TEST_ZONE_ID,
  );
  const hibernatingInTestZone = occupants.filter(
    (person) =>
      person.lifeState === "hibernating" &&
      stableZoneForCabin(person.cabinId) === TEST_ZONE_ID,
  );
  const awakeInNeighborZones = occupants.filter(
    (person) =>
      person.lifeState === "awake" &&
      NEIGHBOR_ZONE_IDS.has(stableZoneForCabin(person.cabinId)),
  );
  const hibernatingInNeighborZones = occupants.filter(
    (person) =>
      person.lifeState === "hibernating" &&
      NEIGHBOR_ZONE_IDS.has(stableZoneForCabin(person.cabinId)),
  );
  assert.ok(awakeInTestZone.length > 0);
  assert.ok(hibernatingInTestZone.length > 0);
  assert.ok(awakeInNeighborZones.length > 0);
  assert.ok(hibernatingInNeighborZones.length > 0);

  openLargeMicrometeoroidBreach();
  stepSimulation("cross-a-05-pressure-and-oxygen-thresholds", 60);
  const afterExposure = snapshot("after-local-environmental-exposure");

  const lowPressure = exposureState(afterExposure, "low-pressure");
  const hypoxia = exposureState(afterExposure, "hypoxia");
  assert.ok(lowPressure.currentTier > 0);
  assert.equal(lowPressure.episode, 1);
  assert.ok(hypoxia.currentTier > 0);
  assert.equal(hypoxia.episode, 1);

  const expectedMemoryCount =
    lowPressure.currentTier + hypoxia.currentTier;
  const awakeInTestZoneIds = new Set(
    awakeInTestZone.map((person) => person.id),
  );
  for (const person of afterExposure.passengers.passengers) {
    const memories = matchingExposureMemories(person);
    if (awakeInTestZoneIds.has(person.id)) {
      assert.equal(
        memories.length,
        expectedMemoryCount,
        `${person.id} must receive each reached A-05 exposure tier once`,
      );
    } else {
      assert.equal(
        memories.length,
        0,
        `${person.id} must not receive another zone's awake-only exposure`,
      );
    }
  }
  for (const person of [
    ...hibernatingInTestZone,
    ...awakeInNeighborZones,
    ...hibernatingInNeighborZones,
  ]) {
    const after = afterExposure.passengers.passengers.find(
      (candidate) => candidate.id === person.id,
    );
    assert.equal(matchingExposureMemories(after).length, 0);
  }
  assertEnginePopulationIsDerived(afterExposure);

  stepSimulation("remain-in-the-same-environmental-hazard-band", 1);
  const afterRepeatedStep = snapshot(
    "after-repeated-environmental-hazard-step",
  );
  assert.equal(
    exposureState(afterRepeatedStep, "low-pressure").currentTier,
    lowPressure.currentTier,
  );
  assert.equal(
    exposureState(afterRepeatedStep, "hypoxia").currentTier,
    hypoxia.currentTier,
  );
  for (const passengerId of awakeInTestZoneIds) {
    const person = afterRepeatedStep.passengers.passengers.find(
      (candidate) => candidate.id === passengerId,
    );
    assert.equal(
      matchingExposureMemories(person).length,
      expectedMemoryCount,
      "remaining in one episode must not duplicate exposure memories",
    );
  }
  assert.equal(exposureState(afterRepeatedStep, "low-pressure").episode, 1);
  assert.equal(exposureState(afterRepeatedStep, "hypoxia").episode, 1);
  assertEnginePopulationIsDerived(afterRepeatedStep);

  const restored = dispatch({
    type: "restore",
    requestId: "restore-active-a-05-exposure",
    snapshot: afterExposure,
  });
  assert.equal(restored.type, "ready", restored.message);
  stepSimulation("continue-active-exposure-after-restore", 1);
  const afterRestoreContinuation = snapshot(
    "after-restored-environmental-hazard-step",
  );
  for (const passengerId of awakeInTestZoneIds) {
    const person = afterRestoreContinuation.passengers.passengers.find(
      (candidate) => candidate.id === passengerId,
    );
    assert.equal(
      matchingExposureMemories(person).length,
      expectedMemoryCount,
      "restore must preserve exposure idempotency history",
    );
  }
  assert.equal(
    exposureState(afterRestoreContinuation, "low-pressure").episode,
    1,
  );
  assert.equal(
    exposureState(afterRestoreContinuation, "hypoxia").episode,
    1,
  );
  assertEnginePopulationIsDerived(afterRestoreContinuation);

  const canonical = afterRestoreContinuation;
  const forgedPopulation = structuredClone(canonical);
  forgedPopulation.engine.state.population.averageHealth += 0.01;
  const rejectedPopulation = dispatch({
    type: "restore",
    requestId: "reject-forged-population-average",
    snapshot: forgedPopulation,
  });
  assert.equal(rejectedPopulation.type, "error");
  assert.match(rejectedPopulation.message, /population\.averageHealth/);
  assert.deepEqual(
    snapshot("after-rejected-population-restore"),
    canonical,
    "a rejected population projection must leave every domain unchanged",
  );

  const forgedExposure = structuredClone(canonical);
  const forgedLowPressure = exposureState(
    forgedExposure,
    "low-pressure",
  );
  forgedLowPressure.currentTier = 0;
  const rejectedExposure = dispatch({
    type: "restore",
    requestId: "reject-forged-exposure-tier",
    snapshot: forgedExposure,
  });
  assert.equal(rejectedExposure.type, "error");
  assert.match(
    rejectedExposure.message,
    /environmental exposure A-05\/low-pressure does not match compartment truth/,
  );
  assert.deepEqual(
    snapshot("after-rejected-exposure-restore"),
    canonical,
    "a rejected exposure tier must leave every domain unchanged",
  );
});
