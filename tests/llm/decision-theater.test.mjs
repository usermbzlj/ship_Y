import assert from "node:assert/strict";
import test from "node:test";

import {
  IDLE_DECISION_THEATER_STATE,
  decisionTheaterHeadline,
  decisionTheaterStageLabel,
  formatFreezeWallDuration,
  formatFrozenSimulationClock,
  reduceDecisionTheater,
} from "../../lib/llm/decision-theater.ts";

test("decision theater starts only after freeze event and stays world_frozen", () => {
  const started = reduceDecisionTheater(IDLE_DECISION_THEATER_STATE, {
    type: "start",
    cycleToken: 7,
    freezeSimulationSeconds: 3600,
    triggerReason: "例行研判",
    wallClockStartedAtMs: 1_000,
  });
  assert.equal(started.active, true);
  assert.equal(started.stage, "world_frozen");
  assert.equal(started.freezeSimulationSeconds, 3600);
  assert.equal(started.cycleToken, 7);
  assert.match(decisionTheaterHeadline(started), /世界已冻结/);
});

test("decision theater never advances on mismatched cycle tokens", () => {
  const started = reduceDecisionTheater(IDLE_DECISION_THEATER_STATE, {
    type: "start",
    cycleToken: 3,
    freezeSimulationSeconds: 10,
    triggerReason: "告警",
    wallClockStartedAtMs: 0,
  });
  const ignored = reduceDecisionTheater(started, {
    type: "reading_observation",
    cycleToken: 99,
  });
  assert.equal(ignored.stage, "world_frozen");
  assert.deepEqual(ignored.utterances, []);
});

test("decision theater reveals departments only after spoke events", () => {
  let state = reduceDecisionTheater(IDLE_DECISION_THEATER_STATE, {
    type: "start",
    cycleToken: 1,
    freezeSimulationSeconds: 120,
    triggerReason: "跃迁就绪",
    wallClockStartedAtMs: 50,
  });
  state = reduceDecisionTheater(state, {
    type: "reading_observation",
    cycleToken: 1,
  });
  state = reduceDecisionTheater(state, {
    type: "captain_deliberating",
    cycleToken: 1,
    pass: "initial",
  });
  state = reduceDecisionTheater(state, {
    type: "consultation_planned",
    cycleToken: 1,
    departmentIds: ["engineering", "life-support"],
    question: "热控与制氧如何协同？",
    rounds: 2,
  });
  assert.equal(state.stage, "consulting_departments");
  assert.equal(state.utterances.length, 0);
  assert.match(decisionTheaterHeadline(state), /召集 2 个部门/);

  state = reduceDecisionTheater(state, {
    type: "department_spoke",
    cycleToken: 1,
    round: 1,
    departmentId: "engineering",
    role: "工程",
    text: "冷却裕度不足。",
    wallClockAtMs: 80,
  });
  assert.equal(state.utterances.length, 1);
  assert.equal(state.utterances[0].role, "工程");
  assert.match(decisionTheaterHeadline(state), /第 1 轮 · 工程/);

  state = reduceDecisionTheater(state, {
    type: "department_spoke",
    cycleToken: 1,
    round: 1,
    departmentId: "life-support",
    role: "生命保障",
    text: "制氧稳定。",
    wallClockAtMs: 90,
  });
  assert.equal(state.utterances.length, 2);
});

test("decision theater tracks serial command dispatch and receipts without inventing ahead", () => {
  let state = reduceDecisionTheater(IDLE_DECISION_THEATER_STATE, {
    type: "start",
    cycleToken: 2,
    freezeSimulationSeconds: 5,
    triggerReason: "电网告警",
    wallClockStartedAtMs: 0,
  });
  state = reduceDecisionTheater(state, {
    type: "captain_decided",
    cycleToken: 2,
    text: "降低负载并延后跃迁。",
    worldCommandTotal: 2,
  });
  assert.equal(state.stage, "dispatching_commands");
  assert.equal(state.dispatchedOrdinal, null);
  assert.equal(state.receipts.length, 0);

  state = reduceDecisionTheater(state, {
    type: "command_dispatched",
    cycleToken: 2,
    ordinal: 1,
    toolName: "set_power_priority",
    total: 2,
  });
  assert.equal(state.dispatchedOrdinal, 1);
  assert.equal(state.receipts.length, 0);

  state = reduceDecisionTheater(state, {
    type: "command_receipt",
    cycleToken: 2,
    ordinal: 1,
    toolName: "set_power_priority",
    status: "accepted",
    summary: "优先级已更新",
    wallClockAtMs: 20,
  });
  assert.equal(state.receipts.length, 1);

  state = reduceDecisionTheater(state, {
    type: "command_receipt",
    cycleToken: 2,
    ordinal: 1,
    toolName: "set_power_priority",
    status: "accepted",
    summary: "重复回执应忽略",
    wallClockAtMs: 21,
  });
  assert.equal(state.receipts.length, 1);
  assert.equal(state.receipts[0].summary, "优先级已更新");
});

test("decision theater abort clears hanging state for any matching cycle", () => {
  const started = reduceDecisionTheater(IDLE_DECISION_THEATER_STATE, {
    type: "start",
    cycleToken: 8,
    freezeSimulationSeconds: 1,
    triggerReason: "中止测试",
    wallClockStartedAtMs: 0,
  });
  const aborted = reduceDecisionTheater(started, {
    type: "abort",
    cycleToken: 8,
  });
  assert.deepEqual(aborted, IDLE_DECISION_THEATER_STATE);

  const restarted = reduceDecisionTheater(IDLE_DECISION_THEATER_STATE, {
    type: "start",
    cycleToken: 9,
    freezeSimulationSeconds: 2,
    triggerReason: "再次",
    wallClockStartedAtMs: 1,
  });
  const clearedByBlankAbort = reduceDecisionTheater(restarted, {
    type: "abort",
  });
  assert.deepEqual(clearedByBlankAbort, IDLE_DECISION_THEATER_STATE);
});

test("decision theater fail and resume are terminal and labeled", () => {
  let state = reduceDecisionTheater(IDLE_DECISION_THEATER_STATE, {
    type: "start",
    cycleToken: 4,
    freezeSimulationSeconds: 9,
    triggerReason: "例行",
    wallClockStartedAtMs: 0,
  });
  state = reduceDecisionTheater(state, {
    type: "fail",
    cycleToken: 4,
    message: "端点超时",
  });
  assert.equal(state.active, false);
  assert.equal(state.stage, "failed");
  assert.match(decisionTheaterHeadline(state), /端点超时/);
  assert.equal(decisionTheaterStageLabel("failed"), "决策失败");

  state = reduceDecisionTheater(IDLE_DECISION_THEATER_STATE, {
    type: "start",
    cycleToken: 5,
    freezeSimulationSeconds: 11,
    triggerReason: "例行",
    wallClockStartedAtMs: 0,
  });
  state = reduceDecisionTheater(state, {
    type: "world_resumed",
    cycleToken: 5,
  });
  assert.equal(state.active, false);
  assert.equal(state.stage, "world_resumed");
  assert.match(decisionTheaterHeadline(state), /恢复流动/);
});

test("freeze clocks format simulation and wall durations without fabricating values", () => {
  assert.equal(formatFrozenSimulationClock(null), "—");
  assert.equal(formatFrozenSimulationClock(3661), "T+01:01:01");
  assert.equal(formatFrozenSimulationClock(90_061), "T+1d 01:01:01");
  assert.equal(formatFreezeWallDuration(null, 1000), "0s");
  assert.equal(formatFreezeWallDuration(1000, 4500), "3s");
  assert.equal(formatFreezeWallDuration(0, 65_000), "1m 05s");
});
