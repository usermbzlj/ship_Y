import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaptainConsultationTurns,
  CAPTAIN_CONSULTATION_PARTIAL_FAILURE_MESSAGE,
  isCaptainConsultationHardFailure,
  parseCaptainConsultationRequest,
  partitionCaptainConsultationAttempts,
} from "../../lib/llm/captain-consultation.ts";

test("captain chooses unique departments and receives every requested meeting round", () => {
  const request = parseCaptainConsultationRequest({
    departmentIds: ["engineering", "life-support", "engineering"],
    question: "  制氧与热控如何协同？  ",
    rounds: 3,
  });
  assert.deepEqual(request.departmentIds, ["engineering", "life-support"]);
  assert.equal(request.question, "制氧与热控如何协同？");
  assert.deepEqual(buildCaptainConsultationTurns(request), [
    { round: 1, departmentId: "engineering" },
    { round: 1, departmentId: "life-support" },
    { round: 2, departmentId: "engineering" },
    { round: 2, departmentId: "life-support" },
    { round: 3, departmentId: "engineering" },
    { round: 3, departmentId: "life-support" },
  ]);
});

test("captain consultation rejects empty, unknown, or excessive meetings", () => {
  assert.throws(
    () =>
      parseCaptainConsultationRequest({
        departmentIds: [],
        question: "谁负责？",
        rounds: 1,
      }),
    /会议参数无效/,
  );
  assert.throws(
    () =>
      parseCaptainConsultationRequest({
        departmentIds: ["save-control"],
        question: "能否读档？",
        rounds: 1,
      }),
    /会议参数无效/,
  );
  assert.throws(
    () =>
      parseCaptainConsultationRequest({
        departmentIds: ["engineering"],
        question: "继续讨论",
        rounds: 4,
      }),
    /会议参数无效/,
  );
});

test("partial department failures keep successful briefings and surface degrade copy", () => {
  const superseded = new Error("舰长决策周期已由新的世界状态取代");
  assert.equal(
    isCaptainConsultationHardFailure(superseded, [superseded]),
    true,
  );
  assert.equal(
    isCaptainConsultationHardFailure(new Error("timeout"), [superseded]),
    false,
  );
  assert.equal(
    isCaptainConsultationHardFailure(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    ),
    true,
  );

  const { results, failures } = partitionCaptainConsultationAttempts([
    { ok: true, value: { agentId: "engineering", text: "热控正常" } },
    {
      ok: false,
      departmentId: "life-support",
      error: new Error("部门超时"),
    },
    { ok: false, departmentId: "navigation", error: "网关拒绝" },
  ]);
  assert.deepEqual(results, [
    { agentId: "engineering", text: "热控正常" },
  ]);
  assert.deepEqual(failures, [
    { departmentId: "life-support", message: "部门超时" },
    { departmentId: "navigation", message: "网关拒绝" },
  ]);
  assert.equal(
    CAPTAIN_CONSULTATION_PARTIAL_FAILURE_MESSAGE,
    "部门咨询部分失败，已以降级简报继续",
  );
});

test("all-failed consultation batch still partitions to empty results", () => {
  const { results, failures } = partitionCaptainConsultationAttempts([
    {
      ok: false,
      departmentId: "engineering",
      error: new Error("HTTP 504"),
    },
    {
      ok: false,
      departmentId: "life-support",
      error: new Error("timeout"),
    },
  ]);
  assert.deepEqual(results, []);
  assert.equal(failures.length, 2);
});
