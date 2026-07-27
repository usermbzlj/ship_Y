import assert from "node:assert/strict";
import test from "node:test";

import { BASELINE_ZONE_IDS } from "../../lib/sim/compartments.ts";
import { ELECTRICAL_LOAD_IDS } from "../../lib/sim/electrical.ts";
import {
  CAPTAIN_OPERATIONS_SNAPSHOT_VERSION,
  CaptainOperations,
} from "../../lib/sim/captain-operations.ts";
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

function initialize(requestId = "grievance-init") {
  const ready = dispatch({
    type: "initialize",
    requestId,
    mission: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      directive: "保证乘员存续并安全抵达。",
      seed: "passenger-grievance-filing",
      totalDistanceLightYears: 11.9,
      totalLegs: 3,
      timeScale: 3_600,
    },
  });
  assert.equal(ready.type, "ready");
  const released = dispatch({
    type: "set-time-control",
    requestId: `${requestId}:release-ui`,
    releasePauseTokens: ["ui"],
  });
  assert.equal(released.type, "ready", released.message);
  return released;
}

function createOperations() {
  return new CaptainOperations({
    origin: "太阳系",
    destination: "鲸鱼座 τ",
    objective: "保证乘员存续并安全抵达。",
    zoneIds: BASELINE_ZONE_IDS,
    electricalLoadIds: ELECTRICAL_LOAD_IDS,
  });
}

test("key passenger files a grievance into operations ledger with filedByPassengerId", () => {
  let current = initialize("file-grievance").payload;
  const passengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[0];
  assert.equal(passengerId, "crew-0001");

  const seedCount = current.operations.grievances.length;
  const event = dispatch({
    type: "ship-command",
    requestId: "file-grievance:cmd",
    commandId: "crew-0001:file-water",
    idempotencyKey: "crew-0001:file-water",
    issuedAtMicroseconds: Math.round(current.elapsedSeconds * 1_000_000),
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "file-passenger-grievance",
      actorAgentId: passengerId,
      passengerId,
      category: "water-shortage",
      summary: "  B 环供水不足，请求说明配给。  ",
    },
  });
  assert.equal(event.type, "ship-command", event.message);
  current = event.payload;

  const filed = current.operations.grievances.filter(
    (item) => item.filedByPassengerId === passengerId,
  );
  assert.equal(filed.length, 1);
  assert.equal(current.operations.grievances.length, seedCount + 1);
  assert.equal(filed[0].category, "water-shortage");
  assert.equal(filed[0].summary, "B 环供水不足，请求说明配给。");
  assert.equal(filed[0].status, "open");
  assert.equal(filed[0].responseCommunicationId, null);
  assert.equal(filed[0].filedByPassengerId, passengerId);
  assert.match(filed[0].id, /^grievance:\d{6}$/);
  assert.equal(filed[0].filedAtMicroseconds, 0);
  assert.match(event.payload.result.summary, /已登记/);
});

test("same passenger same category is idempotent while open", () => {
  const operations = createOperations();
  const first = operations.fileGrievance({
    passengerId: "crew-0001",
    category: "water-shortage",
    summary: "第一次申诉",
  });
  const revisionAfterFirst = operations.revision;
  const second = operations.fileGrievance({
    passengerId: "crew-0001",
    category: "water-shortage",
    summary: "重复申诉应被合并",
  });
  assert.equal(second.id, first.id);
  assert.equal(second.summary, first.summary);
  assert.equal(operations.revision, revisionAfterFirst);
  assert.equal(
    operations.snapshot().grievances.filter(
      (item) =>
        item.filedByPassengerId === "crew-0001" &&
        item.category === "water-shortage",
    ).length,
    1,
  );
});

test("different passengers with the same category each get their own grievance", () => {
  const operations = createOperations();
  const a = operations.fileGrievance({
    passengerId: "crew-0001",
    category: "water-shortage",
    summary: "船员申诉缺水",
  });
  const b = operations.fileGrievance({
    passengerId: "passenger-0001",
    category: "water-shortage",
    summary: "乘客申诉缺水",
  });
  assert.notEqual(a.id, b.id);
  assert.equal(a.filedByPassengerId, "crew-0001");
  assert.equal(b.filedByPassengerId, "passenger-0001");
});

test("answered grievance can be filed again for the same passenger and category", () => {
  let current = initialize("answer-then-refile").payload;
  const passengerId = "passenger-0002";

  const filed = dispatch({
    type: "ship-command",
    requestId: "answer-then-refile:file",
    commandId: "passenger-0002:file-ration",
    idempotencyKey: "passenger-0002:file-ration",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "file-passenger-grievance",
      actorAgentId: passengerId,
      passengerId,
      category: "rationing",
      summary: "口粮分配不透明",
    },
  });
  assert.equal(filed.type, "ship-command", filed.message);
  current = filed.payload;
  const grievanceId = current.operations.grievances.find(
    (item) =>
      item.filedByPassengerId === passengerId && item.category === "rationing",
  ).id;

  const answered = dispatch({
    type: "ship-command",
    requestId: "answer-then-refile:reply",
    commandId: "captain:reply-ration",
    idempotencyKey: "captain:reply-ration",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "publish-communication",
      actorAgentId: "captain",
      communicationKind: "grievance-response",
      audienceOrTarget: passengerId,
      subject: "口粮说明",
      message: "配给规则已张贴于公共区。",
      relatedGrievanceId: grievanceId,
    },
  });
  assert.equal(answered.type, "ship-command", answered.message);
  current = answered.payload;
  const answeredGrievance = current.operations.grievances.find(
    (item) => item.id === grievanceId,
  );
  assert.equal(answeredGrievance.status, "answered");
  assert.ok(answeredGrievance.responseCommunicationId);

  const refiled = dispatch({
    type: "ship-command",
    requestId: "answer-then-refile:again",
    commandId: "passenger-0002:file-ration-2",
    idempotencyKey: "passenger-0002:file-ration-2",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "file-passenger-grievance",
      actorAgentId: passengerId,
      passengerId,
      category: "rationing",
      summary: "仍未见公开细则",
    },
  });
  assert.equal(refiled.type, "ship-command", refiled.message);
  current = refiled.payload;
  const openAgain = current.operations.grievances.filter(
    (item) =>
      item.filedByPassengerId === passengerId &&
      item.category === "rationing" &&
      item.status === "open",
  );
  assert.equal(openAgain.length, 1);
  assert.notEqual(openAgain[0].id, grievanceId);
});

test("illegal actors are rejected by the command bus", () => {
  let current = initialize("illegal-actor").payload;

  const captainForbidden = dispatch({
    type: "ship-command",
    requestId: "illegal-actor:captain",
    commandId: "captain:file-forbidden",
    idempotencyKey: "captain:file-forbidden",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "file-passenger-grievance",
      actorAgentId: "captain",
      passengerId: "crew-0001",
      category: "water-shortage",
      summary: "舰长不应直接登记乘客申诉",
    },
  });
  assert.equal(captainForbidden.type, "error");
  assert.match(captainForbidden.message, /FORBIDDEN|UNKNOWN_ACTOR/);

  const unknown = dispatch({
    type: "ship-command",
    requestId: "illegal-actor:unknown",
    commandId: "ghost:file-forbidden",
    idempotencyKey: "ghost:file-forbidden",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "file-passenger-grievance",
      actorAgentId: "passenger-9999",
      passengerId: "passenger-9999",
      category: "water-shortage",
      summary: "非关键乘客不可登记",
    },
  });
  assert.equal(unknown.type, "error");
  assert.match(unknown.message, /UNKNOWN_ACTOR/);

  const engineering = dispatch({
    type: "ship-command",
    requestId: "illegal-actor:engineering",
    commandId: "engineering:file-forbidden",
    idempotencyKey: "engineering:file-forbidden",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "file-passenger-grievance",
      actorAgentId: "engineering",
      passengerId: "crew-0001",
      category: "water-shortage",
      summary: "工程部门不可登记乘客申诉",
    },
  });
  assert.equal(engineering.type, "error");
  assert.match(engineering.message, /FORBIDDEN/);
});

test("empty summary soft-rejects and overlong summary is truncated", () => {
  let current = initialize("summary-validation").payload;
  const passengerId = "crew-0003";

  const empty = dispatch({
    type: "ship-command",
    requestId: "summary-validation:empty",
    commandId: "crew-0003:empty-summary",
    idempotencyKey: "crew-0003:empty-summary",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "file-passenger-grievance",
      actorAgentId: passengerId,
      passengerId,
      category: "medical",
      summary: "   ",
    },
  });
  assert.equal(empty.type, "error");
  assert.match(empty.message, /EXECUTOR_ERROR|summary/);

  const longSummary = "缺水".repeat(200);
  assert.ok(longSummary.length > 240);
  const filed = dispatch({
    type: "ship-command",
    requestId: "summary-validation:long",
    commandId: "crew-0003:long-summary",
    idempotencyKey: "crew-0003:long-summary",
    issuedAtMicroseconds: 0,
    expectedRevision: current.commandBus.revision,
    expectedStateRevision: current.state.revision,
    command: {
      kind: "file-passenger-grievance",
      actorAgentId: passengerId,
      passengerId,
      category: "medical",
      summary: longSummary,
    },
  });
  assert.equal(filed.type, "ship-command", filed.message);
  const grievance = filed.payload.operations.grievances.find(
    (item) =>
      item.filedByPassengerId === passengerId && item.category === "medical",
  );
  assert.equal(grievance.summary.length, 240);
  assert.equal(grievance.summary, longSummary.slice(0, 240));
});

test("grievance queue prefers dropping oldest closed entries at the 256 cap", () => {
  const operations = createOperations();

  for (let index = 0; index < 10; index += 1) {
    const grievance = operations.fileGrievance({
      passengerId: "crew-0001",
      category: `closed-${index}`,
      summary: `将关闭的申诉 ${index}`,
    });
    operations.recordCommunication({
      kind: "grievance-response",
      audienceOrTarget: "crew-0001",
      subject: `答复 ${index}`,
      message: `已处理 ${index}`,
      relatedGrievanceId: grievance.id,
    });
  }

  // 3 seeds + 10 answered + 243 open fillers = 256
  for (let index = 0; index < 243; index += 1) {
    operations.fileGrievance({
      passengerId: `filler-${String(index).padStart(4, "0")}`,
      category: "crowd",
      summary: `填充 ${index}`,
    });
  }

  const before = operations.snapshot().grievances;
  assert.equal(before.length, 256);
  const closedBefore = before.filter((item) => item.status === "answered");
  assert.equal(closedBefore.length, 10);
  const oldestClosedId = closedBefore[0].id;

  operations.fileGrievance({
    passengerId: "passenger-0020",
    category: "overflow",
    summary: "触发上限淘汰",
  });

  const after = operations.snapshot().grievances;
  assert.equal(after.length, 256);
  assert.equal(
    after.some((item) => item.id === oldestClosedId),
    false,
  );
  assert.ok(
    after.some(
      (item) =>
        item.filedByPassengerId === "passenger-0020" &&
        item.category === "overflow",
    ),
  );
  assert.equal(
    after.filter((item) => item.status === "answered").length,
    9,
  );
});

test("legacy snapshot version 2 migrates filedByPassengerId to null", () => {
  const fresh = createOperations().snapshot();
  const legacy = structuredClone(fresh);
  legacy.snapshotVersion = 2;
  for (const grievance of legacy.grievances) {
    delete grievance.filedByPassengerId;
  }

  const restored = CaptainOperations.restore({
    snapshot: legacy,
    zoneIds: BASELINE_ZONE_IDS,
    electricalLoadIds: ELECTRICAL_LOAD_IDS,
  });
  const snapshot = restored.snapshot();
  assert.equal(snapshot.snapshotVersion, CAPTAIN_OPERATIONS_SNAPSHOT_VERSION);
  assert.equal(CAPTAIN_OPERATIONS_SNAPSHOT_VERSION, 3);
  assert.ok(snapshot.grievances.length >= 3);
  for (const grievance of snapshot.grievances) {
    assert.equal(grievance.filedByPassengerId, null);
  }
});
