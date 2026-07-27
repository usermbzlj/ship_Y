/**
 * Regression: environmental survival dose / exposure targeting must follow
 * captain location overrides (transfer/evacuate), not cabin home zone alone.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resolveZoneIdForCabin } from "../../lib/sim/compartments.ts";

const emitted = [];
globalThis.postMessage = (event) => {
  emitted.push(event);
};
await import("../../lib/sim/worker.ts");

const TEST_ZONE_ID = "A-05";
const SAFE_ZONE_ID = "A-01";
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
      seed: "location-override-environmental-dose",
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: 60,
    },
  });
  assert.equal(ready.type, "ready", ready.message);
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

function issueShipCommand(current, command, label) {
  const response = dispatch({
    type: "ship-command",
    requestId: label,
    commandId: `captain:${label}`,
    idempotencyKey: `captain:${label}`,
    issuedAtMicroseconds: Math.round(current.elapsedSeconds * 1_000_000),
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: { ...command, actorAgentId: "captain" },
  });
  assert.equal(response.type, "ship-command", response.message);
  return response.payload;
}

function stepSimulation(requestId, simulatedSeconds) {
  const response = dispatch({
    type: "step",
    requestId,
    realSeconds: 1,
    timeScale: simulatedSeconds,
  });
  assert.equal(response.type, "stepped", response.message);
  return response.payload;
}

function personDisposition(runtimeSnapshot, personId) {
  return runtimeSnapshot.operations.personDispositions.find(
    (disposition) => disposition.personId === personId,
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

test("environmental dose follows location override, not cabin zone", () => {
  let current = initialize("init-location-override-dose").payload;
  const before = snapshot("before-transfers");
  const roster = before.passengers.passengers;

  const inbound = roster.find(
    (person) =>
      person.lifeState === "awake" &&
      resolveZoneIdForCabin(person.cabinId) !== TEST_ZONE_ID,
  );
  const outbound = roster.find(
    (person) =>
      person.lifeState === "awake" &&
      resolveZoneIdForCabin(person.cabinId) === TEST_ZONE_ID,
  );
  assert.ok(inbound, "need an awake person whose cabin is outside A-05");
  assert.ok(outbound, "need an awake person whose cabin is inside A-05");
  assert.notEqual(inbound.id, outbound.id);

  const inboundCabinZone = resolveZoneIdForCabin(inbound.cabinId);
  const outboundCabinZone = resolveZoneIdForCabin(outbound.cabinId);
  assert.notEqual(inboundCabinZone, TEST_ZONE_ID);
  assert.equal(outboundCabinZone, TEST_ZONE_ID);

  current = issueShipCommand(
    current,
    {
      kind: "manage-person",
      action: "transfer",
      personId: inbound.id,
      zoneId: TEST_ZONE_ID,
      priority: "urgent",
    },
    "transfer-inbound-to-a-05",
  );
  current = issueShipCommand(
    current,
    {
      kind: "manage-person",
      action: "evacuate",
      personId: outbound.id,
      zoneId: SAFE_ZONE_ID,
      priority: "emergency",
    },
    "evacuate-outbound-from-a-05",
  );

  // Relocation tasks finish within a few minutes; step enough wall for both.
  current = stepSimulation("complete-relocations", 3_600);
  const afterMove = snapshot("after-relocations");

  const inboundDisposition = personDisposition(afterMove, inbound.id);
  const outboundDisposition = personDisposition(afterMove, outbound.id);
  assert.equal(inboundDisposition?.currentZoneId, TEST_ZONE_ID);
  assert.equal(outboundDisposition?.currentZoneId, SAFE_ZONE_ID);

  const inboundAfterMove = afterMove.passengers.passengers.find(
    (person) => person.id === inbound.id,
  );
  const outboundAfterMove = afterMove.passengers.passengers.find(
    (person) => person.id === outbound.id,
  );
  assert.equal(inboundAfterMove.cabinId, inbound.cabinId);
  assert.equal(outboundAfterMove.cabinId, outbound.cabinId);
  assert.equal(
    resolveZoneIdForCabin(inboundAfterMove.cabinId),
    inboundCabinZone,
  );
  assert.equal(
    resolveZoneIdForCabin(outboundAfterMove.cabinId),
    outboundCabinZone,
  );

  issueShipCommand(
    current,
    {
      kind: "isolate-pressure-zone",
      zoneId: TEST_ZONE_ID,
    },
    "isolate-a-05-for-override-dose",
  );

  const breach = dispatch({
    type: "intervene",
    requestId: "breach-a-05-for-override-dose",
    request: {
      actor: "player:god-mode",
      reason: "location-override environmental dose regression",
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
        note: "0.2 square meter override-dose breach",
      },
      metadata: {
        mode: "causal-event",
        eventType: "micrometeoroid",
        targetZoneId: TEST_ZONE_ID,
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(breach.type, "intervention", breach.message);
  assert.equal(breach.payload.compartments.activeBreaches, 1);

  stepSimulation("cross-a-05-thresholds-with-overrides", 60);
  const afterExposure = snapshot("after-override-environmental-exposure");

  const lowPressure = exposureState(afterExposure, "low-pressure");
  const hypoxia = exposureState(afterExposure, "hypoxia");
  assert.ok(lowPressure.currentTier > 0);
  assert.ok(hypoxia.currentTier > 0);
  const expectedMemoryCount =
    lowPressure.currentTier + hypoxia.currentTier;

  const inboundExposed = afterExposure.passengers.passengers.find(
    (person) => person.id === inbound.id,
  );
  const outboundExposed = afterExposure.passengers.passengers.find(
    (person) => person.id === outbound.id,
  );

  assert.equal(
    matchingExposureMemories(inboundExposed).length,
    expectedMemoryCount,
    `${inbound.id} transferred into A-05 must receive A-05 exposure dose`,
  );
  assert.equal(
    matchingExposureMemories(outboundExposed).length,
    0,
    `${outbound.id} evacuated from A-05 must not receive A-05 exposure dose`,
  );

  // Cabin-native A-05 occupants who never moved still take the dose.
  const remainingCabinNative = afterExposure.passengers.passengers.find(
    (person) =>
      person.id !== outbound.id &&
      person.lifeState === "awake" &&
      resolveZoneIdForCabin(person.cabinId) === TEST_ZONE_ID &&
      personDisposition(afterExposure, person.id)?.currentZoneId == null,
  );
  assert.ok(
    remainingCabinNative,
    "need a remaining awake A-05 cabin occupant without override",
  );
  assert.equal(
    matchingExposureMemories(remainingCabinNative).length,
    expectedMemoryCount,
    `${remainingCabinNative.id} still in cabin A-05 must receive exposure`,
  );
});
