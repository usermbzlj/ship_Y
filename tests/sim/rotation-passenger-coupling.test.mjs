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

function initialize() {
  return dispatch({
    type: "initialize",
    requestId: "init-rotation-passenger-coupling",
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: "rotation-passenger-coupling",
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: 3_600,
    },
  });
}

function stableZoneForCabin(cabinId) {
  let hash = 2_166_136_261;
  for (let index = 0; index < cabinId.length; index += 1) {
    hash ^= cabinId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const ring = (hash >>> 0) % 48 < 24 ? "A" : "B";
  return ring;
}

test("god-mode bearing degradation changes a real bearing and normalizes the audit balance", () => {
  initialize();
  const degraded = dispatch({
    type: "intervene",
    requestId: "degrade-ring-a-bearing",
    request: {
      actor: "player:god-mode",
      reason: "test ring bearing degradation",
      operations: [],
      declaredBalance: {
        massKg: 99,
        energyJ: 123,
        linearMomentumKgMPerSecond: [4, 5, 6],
        angularMomentumKgM2PerSecond: [7, 8, 9],
        note: "caller values must not survive normalization",
      },
      metadata: {
        mode: "causal-event",
        eventType: "ring-bearing-degradation",
        targetRingId: "ring-a",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(degraded.type, "intervention", degraded.message);
  assert.equal(
    degraded.payload.rotation.truth.rings.find(
      (ring) => ring.id === "ring-a",
    ).bearingCondition,
    "degraded",
  );
  assert.deepEqual(degraded.payload.record.declaredBalance, {
    massKg: 0,
    energyJ: 0,
    linearMomentumKgMPerSecond: [0, 0, 0],
    angularMomentumKgM2PerSecond: [0, 0, 0],
    note:
      "Device-condition fault only; subsequent friction and heat remain inside the coupled ship system",
  });
  assert.match(
    degraded.payload.record.metadata.effectSummary,
    /A 环机械轴承已进入退化工况/,
  );

  const beforeInvalid = dispatch({
    type: "snapshot",
    requestId: "before-invalid-ring-bearing-event",
  }).payload.snapshot;
  const invalid = dispatch({
    type: "intervene",
    requestId: "invalid-ring-bearing-event",
    request: {
      actor: "player:god-mode",
      reason: "invalid ring target",
      operations: [],
      declaredBalance: {
        massKg: 0,
        energyJ: 0,
        linearMomentumKgMPerSecond: [0, 0, 0],
        angularMomentumKgM2PerSecond: [0, 0, 0],
        note: "must fail",
      },
      metadata: {
        mode: "causal-event",
        eventType: "ring-bearing-degradation",
        targetRingId: "ring-c",
        sourceKnownToAi: false,
      },
    },
  });
  assert.equal(invalid.type, "error");
  assert.match(invalid.message, /targetRingId/);
  const afterInvalid = dispatch({
    type: "snapshot",
    requestId: "after-invalid-ring-bearing-event",
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
    assert.deepEqual(afterInvalid[domain], beforeInvalid[domain]);
  }
});

test("a real ring-gravity threshold changes only awake occupants of that ring", () => {
  let current = initialize().payload;
  const before = dispatch({
    type: "snapshot",
    requestId: "before-ring-gravity-exposure",
  }).payload.snapshot;
  const awakeA = before.passengers.passengers.find(
    (person) =>
      person.lifeState === "awake" &&
      stableZoneForCabin(person.cabinId) === "A",
  );
  const awakeB = before.passengers.passengers.find(
    (person) =>
      person.lifeState === "awake" &&
      stableZoneForCabin(person.cabinId) === "B",
  );
  assert.ok(awakeA);
  assert.ok(awakeB);

  const command = dispatch({
    type: "ship-command",
    requestId: "accelerate-ring-a",
    commandId: "engineering:accelerate-ring-a",
    idempotencyKey: "engineering:accelerate-ring-a",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "set-habitat-ring-control",
      actorAgentId: "engineering",
      ringId: "ring-a",
      controlMode: "speed-hold",
      targetRelativeRpm: 3,
    },
  });
  assert.equal(command.type, "ship-command", command.message);
  current = command.payload;

  const stepped = dispatch({
    type: "step",
    requestId: "cross-high-gravity-threshold",
    realSeconds: 1,
    timeScale: 3_600,
  });
  assert.equal(stepped.type, "stepped", stepped.message);
  assert.ok(
    stepped.payload.rotation.truth.rings.find(
      (ring) => ring.id === "ring-a",
    ).artificialGravityG > 1.2,
  );
  assert.ok(
    stepped.payload.rotation.truth.rings.find(
      (ring) => ring.id === "ring-b",
    ).artificialGravityG < 1.2,
  );

  const after = dispatch({
    type: "snapshot",
    requestId: "after-ring-gravity-exposure",
  }).payload.snapshot;
  const afterA = after.passengers.passengers.find(
    (person) => person.id === awakeA.id,
  );
  const afterB = after.passengers.passengers.find(
    (person) => person.id === awakeB.id,
  );
  const aMemories = afterA.memories.filter(
    (memory) => memory.eventType === "rotation-high-gravity",
  );
  const bMemories = afterB.memories.filter(
    (memory) => memory.eventType === "rotation-high-gravity",
  );
  assert.equal(aMemories.length, 1);
  assert.equal(bMemories.length, 0);
  assert.ok(afterA.experience.comfort < awakeA.experience.comfort);
  assert.ok(afterA.experience.safety < awakeA.experience.safety);
  assert.ok(afterA.psychology.stress > awakeA.psychology.stress);
  assert.equal(afterB.experience.comfort, awakeB.experience.comfort);
  assert.equal(afterB.psychology.stress, awakeB.psychology.stress);

  const repeated = dispatch({
    type: "step",
    requestId: "remain-above-high-gravity-threshold",
    realSeconds: 1,
    timeScale: 60,
  });
  assert.equal(repeated.type, "stepped", repeated.message);
  const repeatedSnapshot = dispatch({
    type: "snapshot",
    requestId: "after-repeated-high-gravity-step",
  }).payload.snapshot;
  assert.equal(
    repeatedSnapshot.passengers.passengers
      .find((person) => person.id === awakeA.id)
      .memories.filter(
        (memory) => memory.eventType === "rotation-high-gravity",
      ).length,
    1,
    "remaining in the same hazard band must not duplicate the incident",
  );
});
