import assert from "node:assert/strict";
import test from "node:test";

const emitted = [];
globalThis.postMessage = (event) => emitted.push(event);
await import("../../lib/sim/worker.ts");

const BOUNDARY_AT = 60;

function dispatchAll(command) {
  emitted.length = 0;
  globalThis.onmessage({ data: command });
  return [...emitted];
}

function dispatch(command) {
  const events = dispatchAll(command);
  assert.equal(events.length, 1, JSON.stringify(events.map((e) => e.type)));
  return events[0];
}

function initialize() {
  return dispatch({
    type: "initialize",
    requestId: "llm-orch:init",
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: "llm-orchestration-worker",
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: 60,
    },
  });
}

function releaseUi() {
  return dispatch({
    type: "set-time-control",
    requestId: "llm-orch:release-ui",
    releasePauseTokens: ["ui"],
  });
}

function stepToBoundary(requestId = "llm-orch:step-boundary") {
  return dispatchAll({
    type: "step",
    requestId,
    realSeconds: 1,
    timeScale: 60,
    blockingBoundary: {
      id: `captain-routine:${BOUNDARY_AT}`,
      atSimulationSeconds: BOUNDARY_AT,
      pauseToken: "llm-waiting",
    },
  });
}

test("step to boundary opens pending and emits llm-effect-request", () => {
  initialize();
  releaseUi();
  const events = stepToBoundary();
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "stepped");
  assert.equal(events[1].type, "llm-effect-request");
  const stepped = events[0];
  const request = events[1];
  assert.equal(stepped.payload.elapsedSeconds, BOUNDARY_AT);
  assert.ok(stepped.payload.llmOrchestration?.pending);
  assert.equal(stepped.payload.llmOrchestration.pending.phase, "awaiting-http");
  assert.equal(request.payload.kind, "captain-blocking");
  assert.equal(request.payload.agentId, "captain");
  assert.equal(request.payload.triggerKey, `captain-routine:${BOUNDARY_AT}`);
  assert.equal(
    request.payload.callId,
    stepped.payload.llmOrchestration.pending.callId,
  );
  assert.deepEqual(stepped.payload.timeControl.pauseTokens, ["llm-waiting"]);
});

test("snapshot version 21 round-trip preserves pending", () => {
  initialize();
  releaseUi();
  const events = stepToBoundary("llm-orch:snap-boundary");
  const pendingBefore = events[0].payload.llmOrchestration.pending;
  assert.ok(pendingBefore);

  const saved = dispatch({
    type: "snapshot",
    requestId: "llm-orch:snapshot",
  });
  assert.equal(saved.payload.snapshot.snapshotVersion, 21);
  assert.equal(
    saved.payload.snapshot.llmOrchestration.pending.callId,
    pendingBefore.callId,
  );

  const restoredEvents = dispatchAll({
    type: "restore",
    requestId: "llm-orch:restore",
    snapshot: saved.payload.snapshot,
  });
  assert.ok(restoredEvents.length >= 1);
  assert.equal(restoredEvents[0].type, "ready");
  assert.ok(restoredEvents[0].payload.llmOrchestration?.pending);
  assert.equal(
    restoredEvents[0].payload.llmOrchestration.pending.callId,
    pendingBefore.callId,
  );
  assert.deepEqual(restoredEvents[0].payload.timeControl.pauseTokens, [
    "llm-waiting",
  ]);
  assert.equal(restoredEvents[1]?.type, "llm-effect-request");
  assert.equal(restoredEvents[1]?.payload.callId, pendingBefore.callId);
});

test("duplicate accept ignored and stale revision rejected", () => {
  initialize();
  releaseUi();
  const events = stepToBoundary("llm-orch:accept-boundary");
  const pending = events[0].payload.llmOrchestration.pending;
  assert.ok(pending);

  const first = dispatch({
    type: "llm-effect-accept",
    requestId: "llm-orch:accept-1",
    callId: pending.callId,
    observationRevision: pending.observationRevision,
    result: { toolCalls: [{ id: "t1", name: "noop" }] },
  });
  assert.equal(first.type, "ready");
  assert.equal(first.payload.llmOrchestration.pending.phase, "applying-tools");

  const dup = dispatch({
    type: "llm-effect-accept",
    requestId: "llm-orch:accept-dup",
    callId: pending.callId,
    observationRevision: pending.observationRevision,
    result: { toolCalls: [{ id: "t2", name: "noop" }] },
  });
  assert.equal(dup.type, "ready");
  assert.equal(dup.payload.llmOrchestration.pending.phase, "applying-tools");

  const stale = dispatchAll({
    type: "llm-effect-accept",
    requestId: "llm-orch:accept-stale",
    callId: pending.callId,
    observationRevision: pending.observationRevision + 1,
    result: { toolCalls: [] },
  });
  assert.equal(stale[0].type, "error");
  assert.match(stale[0].message, /stale|unknown/i);
});

test("fail clears pending and releases pause", () => {
  initialize();
  releaseUi();
  const events = stepToBoundary("llm-orch:fail-boundary");
  const pending = events[0].payload.llmOrchestration.pending;
  assert.ok(pending);

  const failed = dispatch({
    type: "llm-effect-fail",
    requestId: "llm-orch:fail",
    callId: pending.callId,
    observationRevision: pending.observationRevision,
    reason: "gateway timeout",
    retryable: true,
  });
  assert.equal(failed.type, "ready");
  assert.equal(failed.payload.llmOrchestration.pending, null);
  assert.deepEqual(failed.payload.timeControl.pauseTokens, []);

  const advanced = dispatch({
    type: "step",
    requestId: "llm-orch:after-fail",
    realSeconds: 1,
    timeScale: 1,
  });
  assert.equal(advanced.payload.elapsedSeconds, BOUNDARY_AT + 1);
});

test("finish releases pause after accept", () => {
  initialize();
  releaseUi();
  const events = stepToBoundary("llm-orch:finish-boundary");
  const pending = events[0].payload.llmOrchestration.pending;
  assert.ok(pending);

  dispatch({
    type: "llm-effect-accept",
    requestId: "llm-orch:finish-accept",
    callId: pending.callId,
    observationRevision: pending.observationRevision,
    result: { toolCalls: [{ id: "t1", name: "noop" }] },
  });

  const ignored = dispatch({
    type: "set-time-control",
    requestId: "llm-orch:ignore-release",
    releasePauseTokens: ["llm-waiting"],
  });
  assert.deepEqual(ignored.payload.timeControl.pauseTokens, ["llm-waiting"]);

  const finished = dispatch({
    type: "llm-effect-finish",
    requestId: "llm-orch:finish",
    callId: pending.callId,
    advancesRoutineSchedule: true,
    nextCaptainRoutineAtSimulationSeconds: 120,
  });
  assert.equal(finished.type, "ready");
  assert.equal(finished.payload.llmOrchestration.pending, null);
  assert.deepEqual(finished.payload.timeControl.pauseTokens, []);

  const snap = dispatch({
    type: "snapshot",
    requestId: "llm-orch:after-finish-snap",
  });
  assert.equal(
    snap.payload.snapshot.nextCaptainRoutineAtSimulationSeconds,
    120,
  );
});

test("restore applying-tools safe-fails without freezing the world", () => {
  initialize();
  releaseUi();
  const events = stepToBoundary("llm-orch:apply-boundary");
  const pending = events[0].payload.llmOrchestration.pending;
  assert.ok(pending);

  const accepted = dispatch({
    type: "llm-effect-accept",
    requestId: "llm-orch:apply-accept",
    callId: pending.callId,
    observationRevision: pending.observationRevision,
    result: { toolCalls: [{ id: "t1", name: "noop" }] },
  });
  assert.equal(accepted.payload.llmOrchestration.pending.phase, "applying-tools");

  const saved = dispatch({
    type: "snapshot",
    requestId: "llm-orch:apply-snapshot",
  });
  assert.equal(
    saved.payload.snapshot.llmOrchestration.pending.phase,
    "applying-tools",
  );
  assert.equal(
    "toolQueueProgress" in saved.payload.snapshot.llmOrchestration.pending,
    false,
  );

  const restoredEvents = dispatchAll({
    type: "restore",
    requestId: "llm-orch:apply-restore",
    snapshot: saved.payload.snapshot,
  });
  assert.equal(restoredEvents[0].type, "ready");
  assert.equal(restoredEvents[0].payload.llmOrchestration.pending, null);
  assert.deepEqual(restoredEvents[0].payload.timeControl.pauseTokens, []);
  assert.equal(restoredEvents[1]?.type, "llm-effect-aborted");
  assert.equal(
    restoredEvents[1]?.payload.reason,
    "restored-during-tool-apply",
  );
  assert.equal(restoredEvents[1]?.payload.callId, pending.callId);

  // Routine deadline re-armed to frozen boundary so the cycle can retry.
  const afterAbortSnap = dispatch({
    type: "snapshot",
    requestId: "llm-orch:after-abort-snap",
  });
  assert.equal(
    afterAbortSnap.payload.snapshot.nextCaptainRoutineAtSimulationSeconds,
    BOUNDARY_AT,
  );
  assert.equal(afterAbortSnap.payload.snapshot.llmOrchestration.pending, null);

  const advanced = dispatch({
    type: "step",
    requestId: "llm-orch:after-apply-abort",
    realSeconds: 1,
    timeScale: 1,
  });
  assert.equal(advanced.payload.elapsedSeconds, BOUNDARY_AT + 1);
  assert.deepEqual(advanced.payload.timeControl.pauseTokens, []);
});
