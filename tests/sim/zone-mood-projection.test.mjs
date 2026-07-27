/**
 * Worker projections: zoneMood + passengerCircles for key-LLM social context.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resolveZoneIdForCabin } from "../../lib/sim/compartments.ts";
import { DEFAULT_KEY_LLM_PASSENGER_IDS } from "../../lib/sim/passengers.ts";

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
  const ready = dispatch({
    type: "initialize",
    requestId,
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: "zone-mood-projection-test",
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: 21_600,
    },
  });
  assert.equal(ready.type, "ready", ready.message);
  assert.equal(ready.payload.timeControl.paused, true);
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

function restore(requestId, runtimeSnapshot) {
  const response = dispatch({
    type: "restore",
    requestId,
    snapshot: runtimeSnapshot,
  });
  assert.equal(response.type, "ready", response.message);
  return response;
}

function inspect(requestId) {
  const response = dispatch({ type: "inspect", requestId });
  assert.equal(response.type, "ready", response.message);
  return response.payload;
}

function byId(roster) {
  return new Map(roster.map((person) => [person.id, person]));
}

function unlinkRelationships(roster, personId) {
  const person = roster.find((entry) => entry.id === personId);
  assert.ok(person, personId);
  for (const relatedId of person.relationshipIds) {
    const related = roster.find((entry) => entry.id === relatedId);
    assert.ok(related, relatedId);
    related.relationshipIds = related.relationshipIds.filter(
      (id) => id !== personId,
    );
  }
  person.relationshipIds = [];
}

function syncEnginePopulationAverages(runtimeSnapshot) {
  let livingCount = 0;
  let averageHealth = 0;
  let averageMorale = 0;
  for (const person of runtimeSnapshot.passengers.passengers) {
    if (person.lifeState === "deceased") continue;
    livingCount += 1;
    averageHealth += person.health.physical;
    averageMorale += person.psychology.stability;
  }
  runtimeSnapshot.engine.state.population.averageHealth =
    livingCount === 0 ? 0 : averageHealth / livingCount;
  runtimeSnapshot.engine.state.population.averageMorale =
    livingCount === 0 ? 0 : averageMorale / livingCount;
}

function expectedZoneMood(roster) {
  const accum = new Map();
  for (const person of roster) {
    if (person.lifeState !== "awake") continue;
    const zoneId = resolveZoneIdForCabin(person.cabinId);
    const bucket = accum.get(zoneId) ?? {
      awakeCount: 0,
      stressSum: 0,
      trustSum: 0,
      physicalSum: 0,
    };
    bucket.awakeCount += 1;
    bucket.stressSum += person.psychology.stress;
    bucket.trustSum += person.experience.trust;
    bucket.physicalSum += person.health.physical;
    accum.set(zoneId, bucket);
  }
  return [...accum.entries()]
    .map(([zoneId, bucket]) => ({
      zoneId,
      awakeCount: bucket.awakeCount,
      meanStress: bucket.stressSum / bucket.awakeCount,
      meanTrust: bucket.trustSum / bucket.awakeCount,
      meanPhysicalHealth: bucket.physicalSum / bucket.awakeCount,
    }))
    .sort((left, right) => left.zoneId.localeCompare(right.zoneId));
}

test("zoneMood aggregates awake-only means, sorted by zoneId", () => {
  initialize("init-zone-mood");
  const runtime = structuredClone(snapshot("zone-mood-baseline"));
  const roster = runtime.passengers.passengers;
  const targetZone = "A-05";

  const awakeInZone = roster.filter(
    (person) =>
      person.lifeState === "awake" &&
      resolveZoneIdForCabin(person.cabinId) === targetZone,
  );
  assert.ok(awakeInZone.length >= 2, "need awake occupants in A-05");
  const [awakeA, awakeB, ...restAwake] = awakeInZone;

  // Crisp mean: A/B average to (0.3, 0.6, 0.8); remaining awake share midpoint.
  awakeA.psychology.stress = 0.2;
  awakeA.experience.trust = 0.4;
  awakeA.health.physical = 0.6;
  awakeB.psychology.stress = 0.4;
  awakeB.experience.trust = 0.8;
  awakeB.health.physical = 1.0;
  for (const person of restAwake) {
    person.psychology.stress = 0.3;
    person.experience.trust = 0.6;
    person.health.physical = 0.8;
  }

  const sleeper = roster.find(
    (person) =>
      person.lifeState === "hibernating" &&
      resolveZoneIdForCabin(person.cabinId) === targetZone,
  );
  if (sleeper) {
    sleeper.psychology.stress = 0.99;
    sleeper.experience.trust = 0.01;
    sleeper.health.physical = 0.01;
  }

  syncEnginePopulationAverages(runtime);
  restore("restore-zone-mood", runtime);
  const state = inspect("inspect-zone-mood");

  const zoneIds = state.zoneMood.map((entry) => entry.zoneId);
  assert.deepEqual(zoneIds, [...zoneIds].sort((a, b) => a.localeCompare(b)));
  assert.ok(state.zoneMood.every((entry) => entry.awakeCount > 0));
  assert.deepEqual(state.zoneMood, expectedZoneMood(roster));

  const target = state.zoneMood.find((entry) => entry.zoneId === targetZone);
  assert.ok(target);
  assert.equal(target.awakeCount, awakeInZone.length);
  assert.ok(Math.abs(target.meanStress - 0.3) < 1e-12);
  assert.ok(Math.abs(target.meanTrust - 0.6) < 1e-12);
  assert.ok(Math.abs(target.meanPhysicalHealth - 0.8) < 1e-12);
});

test("hibernating people are excluded from zoneMood awakeCount and means", () => {
  initialize("init-zone-mood-sleepers");
  const runtime = structuredClone(snapshot("zone-mood-sleepers-baseline"));
  const roster = runtime.passengers.passengers;
  const targetZone = "B-03";
  const awake = roster.filter(
    (person) =>
      person.lifeState === "awake" &&
      resolveZoneIdForCabin(person.cabinId) === targetZone,
  );
  const sleepers = roster.filter(
    (person) =>
      person.lifeState === "hibernating" &&
      resolveZoneIdForCabin(person.cabinId) === targetZone,
  );
  assert.ok(awake.length >= 1, "need at least one awake in B-03");
  assert.ok(sleepers.length >= 1, "need at least one hibernating in B-03");

  for (const person of awake) {
    person.psychology.stress = 0.5;
    person.experience.trust = 0.5;
    person.health.physical = 0.5;
  }
  for (const person of sleepers) {
    person.psychology.stress = 1;
    person.experience.trust = 0;
    person.health.physical = 0;
  }

  syncEnginePopulationAverages(runtime);
  restore("restore-zone-mood-sleepers", runtime);
  const state = inspect("inspect-zone-mood-sleepers");
  const target = state.zoneMood.find((entry) => entry.zoneId === targetZone);
  assert.ok(target);
  assert.equal(target.awakeCount, awake.length);
  assert.equal(target.meanStress, 0.5);
  assert.equal(target.meanTrust, 0.5);
  assert.equal(target.meanPhysicalHealth, 0.5);

  // If sleepers were wrongly included, means would leave 0.5.
  const pollutedStress =
    (0.5 * awake.length + 1 * sleepers.length) /
    (awake.length + sleepers.length);
  assert.notEqual(target.meanStress, pollutedStress);
});

test("passengerCircles covers every key passenger with bounded unique members", () => {
  const ready = initialize("init-circles-shape").payload;
  assert.equal(ready.passengerCircles.length, DEFAULT_KEY_LLM_PASSENGER_IDS.length);
  assert.equal(ready.passengerCircles.length, ready.passengerHighlights.length);

  const circleIds = ready.passengerCircles.map((circle) => circle.passengerId);
  assert.deepEqual(
    circleIds,
    [...circleIds].sort((a, b) => a.localeCompare(b)),
  );

  for (const circle of ready.passengerCircles) {
    assert.ok(circle.members.length <= 6);
    const memberIds = circle.members.map((member) => member.passengerId);
    assert.equal(new Set(memberIds).size, memberIds.length);
    assert.equal(memberIds.includes(circle.passengerId), false);
  }
});

test("passengerCircles truncates with family before peer order", () => {
  initialize("init-circles-truncation");
  const runtime = structuredClone(snapshot("circles-truncation-baseline"));
  const roster = runtime.passengers.passengers;
  const index = byId(roster);
  const keyId = DEFAULT_KEY_LLM_PASSENGER_IDS[0];
  const key = index.get(keyId);
  assert.ok(key);

  unlinkRelationships(roster, keyId);
  const familyId = "family-circle-truncation";
  key.familyId = familyId;

  // Late-sorting family-only relatives (familyId source only).
  const familyOnly = [
    "passenger-1500",
    "passenger-1501",
    "passenger-1502",
    "passenger-1503",
  ].map((id) => index.get(id));
  for (const relative of familyOnly) {
    assert.ok(relative);
    unlinkRelationships(roster, relative.id);
    relative.familyId = familyId;
  }

  // Early-sorting dual-source relatives: same familyId (required by roster
  // validation) AND relationshipIds. Labeled family once; early ids fill the
  // truncated circle ahead of late family-only ids.
  const dualSource = [
    "crew-0100",
    "crew-0101",
    "crew-0102",
    "crew-0103",
  ].map((id) => index.get(id));
  for (const related of dualSource) {
    assert.ok(related);
    unlinkRelationships(roster, related.id);
    related.familyId = familyId;
    related.relationshipIds = [keyId];
  }
  key.relationshipIds = dualSource.map((person) => person.id);

  restore("restore-circles-truncation", runtime);
  const state = inspect("inspect-circles-truncation");
  const circle = state.passengerCircles.find(
    (entry) => entry.passengerId === keyId,
  );
  assert.ok(circle);
  assert.equal(circle.members.length, 6);
  assert.ok(circle.members.every((member) => member.relation === "family"));
  assert.deepEqual(
    circle.members.map((member) => member.passengerId),
    [
      "crew-0100",
      "crew-0101",
      "crew-0102",
      "crew-0103",
      "passenger-1500",
      "passenger-1501",
    ],
  );
  assert.equal(
    circle.members.filter((member) => member.passengerId === "crew-0100")
      .length,
    1,
  );
});

test("key passenger with no relations still appears with empty members", () => {
  initialize("init-circles-empty");
  const runtime = structuredClone(snapshot("circles-empty-baseline"));
  const roster = runtime.passengers.passengers;
  const keyId = DEFAULT_KEY_LLM_PASSENGER_IDS[1];
  unlinkRelationships(roster, keyId);
  const key = roster.find((person) => person.id === keyId);
  assert.ok(key);
  key.familyId = "family-solo-empty-circle";

  restore("restore-circles-empty", runtime);
  const state = inspect("inspect-circles-empty");
  const circle = state.passengerCircles.find(
    (entry) => entry.passengerId === keyId,
  );
  assert.ok(circle);
  assert.deepEqual(circle.members, []);
});

test("zoneMood and passengerCircles are stable across consecutive inspects", () => {
  initialize("init-projection-stability");
  const first = inspect("inspect-projection-a");
  const second = inspect("inspect-projection-b");
  assert.deepEqual(second.zoneMood, first.zoneMood);
  assert.deepEqual(second.passengerCircles, first.passengerCircles);
});
