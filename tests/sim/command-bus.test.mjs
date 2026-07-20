import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMAND_BUS_SNAPSHOT_VERSION,
  DeterministicCommandBus,
  fingerprintCommand,
} from "../../lib/sim/command-bus.ts";

function createBus(options = {}) {
  return new DeterministicCommandBus({
    actors: [
      { id: "captain-ai", role: "captain" },
      { id: "engineering-ai", role: "engineering" },
      { id: "observer-ui", role: "observer" },
    ],
    permissions: [
      {
        role: "captain",
        kinds: ["journey.execute-jump", "population.set-awake-target"],
      },
      {
        role: "engineering",
        kinds: ["power.set-reactor-target"],
      },
      { role: "observer", kinds: [] },
    ],
    ...options,
  });
}

function command(overrides = {}) {
  return {
    commandId: "cmd-0001",
    idempotencyKey: "voyage-17:cmd-0001",
    actor: "captain-ai",
    kind: "journey.execute-jump",
    payload: { distanceLightYears: 3.2 },
    issuedAt: 42_000_000,
    expectedRevision: 0,
    ...overrides,
  };
}

test("fixed actors resolve roles and the role whitelist gates execution", () => {
  const bus = createBus();
  let calls = 0;

  assert.equal(bus.canExecute("captain-ai", "journey.execute-jump"), true);
  assert.equal(
    bus.canExecute("engineering-ai", "journey.execute-jump"),
    false,
  );
  assert.equal(bus.canExecute("not-registered", "journey.execute-jump"), false);

  const accepted = bus.dispatch(command(), ({ actor, command: received, revision }) => {
    calls += 1;
    assert.deepEqual(actor, { id: "captain-ai", role: "captain" });
    assert.equal(received.actor, "captain-ai");
    assert.equal(revision, 0);
    return {
      distanceLightYears: received.payload.distanceLightYears,
      jumpNumber: 1,
    };
  });
  assert.equal(accepted.status, "succeeded");
  assert.equal(accepted.revisionBefore, 0);
  assert.equal(accepted.revisionAfter, 1);
  assert.deepEqual(accepted.result, {
    distanceLightYears: 3.2,
    jumpNumber: 1,
  });
  assert.equal(bus.revision, 1);

  const forbidden = bus.dispatch(
    command({
      commandId: "cmd-0002",
      idempotencyKey: "voyage-17:cmd-0002",
      actor: "engineering-ai",
      expectedRevision: 1,
    }),
    () => {
      calls += 1;
      return { shouldNotRun: true };
    },
  );
  assert.equal(forbidden.status, "rejected");
  assert.equal(forbidden.rejection.code, "FORBIDDEN");
  assert.equal(forbidden.revisionAfter, 1);

  const unknown = bus.dispatch(
    command({
      commandId: "cmd-0003",
      idempotencyKey: "voyage-17:cmd-0003",
      actor: "invented-agent",
      expectedRevision: 1,
    }),
    () => {
      calls += 1;
      return { shouldNotRun: true };
    },
  );
  assert.equal(unknown.status, "rejected");
  assert.equal(unknown.rejection.code, "UNKNOWN_ACTOR");
  assert.equal(calls, 1);

  assert.deepEqual(
    bus.getAuditHistory().map((entry) => entry.status),
    ["succeeded", "rejected", "rejected"],
  );
  assert.deepEqual(
    bus.getAuditHistory().map((entry) => entry.sequence),
    [1, 2, 3],
  );
});

test("idempotent retry returns the original result before revision checks", () => {
  const bus = createBus();
  let calls = 0;
  const firstEnvelope = command({
    payload: { b: 2, a: 1 },
  });
  const first = bus.dispatch(firstEnvelope, () => {
    calls += 1;
    return { accepted: true, authorization: { source: "captain" } };
  });

  first.result.accepted = false;
  const retry = bus.dispatch(
    command({
      payload: { a: 1, b: 2 },
    }),
    () => {
      calls += 1;
      return { accepted: false };
    },
  );
  assert.equal(calls, 1);
  assert.equal(bus.revision, 1);
  assert.equal(retry.status, "succeeded");
  assert.deepEqual(retry.result, {
    accepted: true,
    authorization: { source: "captain" },
  });
  assert.equal(bus.getAuditHistory().length, 1);
  assert.equal(fingerprintCommand(firstEnvelope), retry.fingerprint);

  const idempotencyConflict = bus.dispatch(
    command({
      payload: { a: 1, b: 3 },
    }),
    () => {
      calls += 1;
      return { shouldNotRun: true };
    },
  );
  assert.equal(idempotencyConflict.status, "rejected");
  assert.equal(
    idempotencyConflict.rejection.code,
    "IDEMPOTENCY_CONFLICT",
  );

  const commandIdConflict = bus.dispatch(
    command({
      idempotencyKey: "voyage-17:a-new-key",
      expectedRevision: 1,
    }),
    () => {
      calls += 1;
      return { shouldNotRun: true };
    },
  );
  assert.equal(commandIdConflict.status, "rejected");
  assert.equal(commandIdConflict.rejection.code, "COMMAND_ID_CONFLICT");
  assert.equal(calls, 1);
});

test("optimistic concurrency rejects stale commands without invoking executors", () => {
  const bus = createBus({ initialRevision: 7 });
  let calls = 0;
  const stale = bus.dispatch(
    command({
      commandId: "cmd-stale",
      idempotencyKey: "voyage-17:cmd-stale",
      expectedRevision: 6,
    }),
    () => {
      calls += 1;
      return { shouldNotRun: true };
    },
  );

  assert.equal(stale.status, "rejected");
  assert.equal(stale.rejection.code, "REVISION_CONFLICT");
  assert.match(stale.rejection.message, /expected revision 6/);
  assert.equal(stale.revisionBefore, 7);
  assert.equal(stale.revisionAfter, 7);
  assert.equal(bus.revision, 7);
  assert.equal(calls, 0);

  const retry = bus.dispatch(
    command({
      commandId: "cmd-stale",
      idempotencyKey: "voyage-17:cmd-stale",
      expectedRevision: 6,
    }),
    () => {
      calls += 1;
      return { shouldNotRun: true };
    },
  );
  assert.deepEqual(retry, stale);
  assert.equal(calls, 0);
  assert.equal(bus.getAuditHistory().length, 1);
});

test("executor failures and non-object returns become structured rejections", () => {
  const bus = createBus();

  const thrown = bus.dispatch(command(), () => {
    throw new Error("coolant loop interlock is open");
  });
  assert.equal(thrown.status, "rejected");
  assert.equal(thrown.rejection.code, "EXECUTOR_ERROR");
  assert.match(thrown.rejection.message, /coolant loop interlock/);
  assert.equal(bus.revision, 0);

  const invalid = bus.dispatch(
    command({
      commandId: "cmd-invalid-result",
      idempotencyKey: "voyage-17:cmd-invalid-result",
    }),
    // Runtime validation protects JavaScript and decoded external input too.
    () => "not a structured result",
  );
  assert.equal(invalid.status, "rejected");
  assert.equal(invalid.rejection.code, "INVALID_EXECUTOR_RESULT");
  assert.equal(bus.revision, 0);
  assert.deepEqual(
    bus.getAuditHistory().map((entry) => entry.status),
    ["rejected", "rejected"],
  );
});

test("snapshot restore preserves bounded audit and idempotency history", () => {
  const bus = createBus({ historyCapacity: 3 });
  for (let index = 0; index < 5; index += 1) {
    const receipt = bus.dispatch(
      command({
        commandId: `cmd-${index + 1}`,
        idempotencyKey: `voyage-17:cmd-${index + 1}`,
        payload: { distanceLightYears: 0.5 + index / 10 },
        issuedAt: 1_000 + index,
        expectedRevision: index,
      }),
      () => ({ appliedIndex: index }),
    );
    assert.equal(receipt.status, "succeeded");
  }

  const snapshot = bus.snapshot();
  assert.equal(snapshot.snapshotVersion, COMMAND_BUS_SNAPSHOT_VERSION);
  assert.equal(snapshot.revision, 5);
  assert.equal(snapshot.auditHistory.length, 3);
  assert.equal(snapshot.processedHistory.length, 3);
  assert.equal(snapshot.auditHistory[0].commandId, "cmd-3");
  assert.equal(snapshot.processedHistory[0].envelope.commandId, "cmd-3");

  const restored = DeterministicCommandBus.restore(bus.serialize());
  assert.deepEqual(restored.snapshot(), snapshot);
  let calls = 0;
  const retainedRetry = restored.dispatch(
    command({
      commandId: "cmd-5",
      idempotencyKey: "voyage-17:cmd-5",
      payload: { distanceLightYears: 0.9 },
      issuedAt: 1_004,
      expectedRevision: 4,
    }),
    () => {
      calls += 1;
      return { shouldNotRun: true };
    },
  );
  assert.equal(retainedRetry.status, "succeeded");
  assert.deepEqual(retainedRetry.result, { appliedIndex: 4 });
  assert.equal(calls, 0);
  assert.deepEqual(restored.snapshot(), snapshot);

  const evictedRetry = restored.dispatch(
    command({
      commandId: "cmd-1",
      idempotencyKey: "voyage-17:cmd-1",
      payload: { distanceLightYears: 0.5 },
      issuedAt: 1_000,
      expectedRevision: 0,
    }),
    () => {
      calls += 1;
      return { shouldNotRun: true };
    },
  );
  assert.equal(evictedRetry.status, "rejected");
  assert.equal(evictedRetry.rejection.code, "REVISION_CONFLICT");
  assert.equal(calls, 0);
  assert.equal(restored.getAuditHistory().length, 3);
  assert.equal(restored.getProcessedHistory().length, 3);

  const wrongVersion = structuredClone(snapshot);
  wrongVersion.snapshotVersion = 999;
  assert.throws(
    () => DeterministicCommandBus.restore(wrongVersion),
    /unsupported or malformed/,
  );

  const wrongFingerprint = structuredClone(snapshot);
  wrongFingerprint.processedHistory[0].fingerprint = "cmd-v1-tampered";
  assert.throws(
    () => DeterministicCommandBus.restore(wrongFingerprint),
    /fingerprint does not match/,
  );
});
