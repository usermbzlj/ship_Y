import assert from "node:assert/strict";
import test from "node:test";

import { FAR_HORIZON_DEPARTMENT_AGENT_IDS } from "../../lib/llm/fixed-topology.ts";
import {
  DEPARTMENT_DISSENT_MAX_RECORDS,
  DEPARTMENT_DISSENT_MAX_SUMMARY_CHARACTERS,
  DEPARTMENT_RECENT_POSITION_LIMIT,
  DEPARTMENT_STANCE_MAX_CHARACTERS,
  DEPARTMENT_STANDING_SNAPSHOT_VERSION,
  FILE_DISSENT_TOOL_INPUT_SCHEMA,
  FILE_DISSENT_TOOL_NAME,
  createDepartmentStandingSnapshot,
  openDissentsForCaptain,
  parseFileDissentToolCall,
  recordDepartmentConsultation,
  recordDepartmentDissent,
  renderCaptainDissentLedgerPromptBlock,
  renderDepartmentStandingPromptBlock,
  renderPeerPositionsPromptBlock,
  resolveDepartmentDissent,
  summarizeDissentLedger,
  validateDepartmentStandingSnapshot,
} from "../../lib/llm/department-standing.ts";

const EXPECTED_DEPARTMENTS = FAR_HORIZON_DEPARTMENT_AGENT_IDS.filter(
  (id) => id !== "captain",
);

test("initial snapshot covers every department except captain", () => {
  const snapshot = createDepartmentStandingSnapshot();
  assert.equal(snapshot.snapshotVersion, DEPARTMENT_STANDING_SNAPSHOT_VERSION);
  assert.equal(snapshot.nextOrdinal, 1);
  assert.equal(snapshot.dissents.length, 0);
  assert.deepEqual(
    snapshot.standings.map((standing) => standing.departmentId),
    [...EXPECTED_DEPARTMENTS],
  );
  assert.equal(
    snapshot.standings.some((standing) => standing.departmentId === "captain"),
    false,
  );
  for (const standing of snapshot.standings) {
    assert.equal(standing.consultationCount, 0);
    assert.equal(standing.dissentCount, 0);
    assert.equal(standing.overriddenCount, 0);
    assert.equal(standing.vindicatedCount, 0);
    assert.deepEqual(standing.recentPositions, []);
  }
  assert.equal(FILE_DISSENT_TOOL_NAME, "file_dissent");
  assert.equal(FILE_DISSENT_TOOL_INPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual(FILE_DISSENT_TOOL_INPUT_SCHEMA.required, ["summary"]);
});

test("consultation increments count and trims recentPositions", () => {
  let snapshot = createDepartmentStandingSnapshot();
  snapshot = recordDepartmentConsultation(snapshot, {
    departmentId: "engineering",
    simulationSeconds: 100,
    stance: "  反应堆裕度不足  ",
  });
  snapshot = recordDepartmentConsultation(snapshot, {
    departmentId: "engineering",
    simulationSeconds: 200,
    stance: "   ",
  });
  for (let index = 0; index < DEPARTMENT_RECENT_POSITION_LIMIT + 2; index += 1) {
    snapshot = recordDepartmentConsultation(snapshot, {
      departmentId: "engineering",
      simulationSeconds: 300 + index,
      stance: `立场 ${index}`,
    });
  }
  const standing = snapshot.standings.find(
    (entry) => entry.departmentId === "engineering",
  );
  assert.ok(standing);
  assert.equal(
    standing.consultationCount,
    2 + DEPARTMENT_RECENT_POSITION_LIMIT + 2,
  );
  assert.equal(standing.recentPositions.length, DEPARTMENT_RECENT_POSITION_LIMIT);
  assert.equal(standing.recentPositions[0].stance, "立场 2");
  assert.equal(
    standing.recentPositions.at(-1)?.stance,
    `立场 ${DEPARTMENT_RECENT_POSITION_LIMIT + 1}`,
  );
  assert.equal(
    standing.recentPositions.some((position) => position.stance === "反应堆裕度不足"),
    false,
  );
});

test("dissent ring buffer drops oldest while ordinal never wraps", () => {
  let snapshot = createDepartmentStandingSnapshot();
  let lastRecord = null;
  for (let index = 0; index < DEPARTMENT_DISSENT_MAX_RECORDS + 5; index += 1) {
    const result = recordDepartmentDissent(snapshot, {
      departmentId: "navigation",
      simulationSeconds: index * 10,
      severity: "formal",
      summary: `航路异议 ${index}`,
      captainDecisionOrdinal: index,
    });
    snapshot = result.snapshot;
    lastRecord = result.record;
  }
  assert.equal(snapshot.dissents.length, DEPARTMENT_DISSENT_MAX_RECORDS);
  assert.equal(snapshot.dissents[0].ordinal, 6);
  assert.equal(snapshot.dissents[0].summary, "航路异议 5");
  assert.equal(lastRecord?.ordinal, DEPARTMENT_DISSENT_MAX_RECORDS + 5);
  assert.equal(snapshot.nextOrdinal, DEPARTMENT_DISSENT_MAX_RECORDS + 6);
  const standing = snapshot.standings.find(
    (entry) => entry.departmentId === "navigation",
  );
  assert.equal(standing?.dissentCount, DEPARTMENT_DISSENT_MAX_RECORDS + 5);
});

test("resolveDepartmentDissent counts overridden/vindicated once and is idempotent", () => {
  let snapshot = createDepartmentStandingSnapshot();
  const filed = recordDepartmentDissent(snapshot, {
    departmentId: "medical",
    simulationSeconds: 500,
    severity: "grave",
    summary: "不宜唤醒关键乘客",
    captainDecisionOrdinal: 3,
  });
  snapshot = filed.snapshot;
  const recordId = filed.record.recordId;

  snapshot = resolveDepartmentDissent(snapshot, recordId, "overridden");
  let standing = snapshot.standings.find(
    (entry) => entry.departmentId === "medical",
  );
  assert.equal(standing?.overriddenCount, 1);
  assert.equal(standing?.vindicatedCount, 0);
  assert.equal(
    snapshot.dissents.find((record) => record.recordId === recordId)?.resolution,
    "overridden",
  );

  const again = resolveDepartmentDissent(snapshot, recordId, "overridden");
  standing = again.standings.find(
    (entry) => entry.departmentId === "medical",
  );
  assert.equal(standing?.overriddenCount, 1);

  const flipped = resolveDepartmentDissent(again, recordId, "vindicated");
  standing = flipped.standings.find(
    (entry) => entry.departmentId === "medical",
  );
  assert.equal(standing?.overriddenCount, 1);
  assert.equal(standing?.vindicatedCount, 0);
  assert.equal(
    flipped.dissents.find((record) => record.recordId === recordId)?.resolution,
    "vindicated",
  );

  let vindicatedSnap = createDepartmentStandingSnapshot();
  const second = recordDepartmentDissent(vindicatedSnap, {
    departmentId: "life-support",
    simulationSeconds: 10,
    severity: "note",
    summary: "舱压趋势异常",
    captainDecisionOrdinal: null,
  });
  vindicatedSnap = resolveDepartmentDissent(
    second.snapshot,
    second.record.recordId,
    "vindicated",
  );
  assert.equal(
    vindicatedSnap.standings.find(
      (entry) => entry.departmentId === "life-support",
    )?.vindicatedCount,
    1,
  );
  vindicatedSnap = resolveDepartmentDissent(
    vindicatedSnap,
    second.record.recordId,
    "vindicated",
  );
  assert.equal(
    vindicatedSnap.standings.find(
      (entry) => entry.departmentId === "life-support",
    )?.vindicatedCount,
    1,
  );
});

test("unknown departmentId returns the same snapshot reference", () => {
  const snapshot = createDepartmentStandingSnapshot();
  const consulted = recordDepartmentConsultation(snapshot, {
    departmentId: "captain",
    simulationSeconds: 1,
    stance: "不应写入",
  });
  assert.equal(consulted, snapshot);

  const dissented = recordDepartmentDissent(snapshot, {
    departmentId: "unknown-dept",
    simulationSeconds: 2,
    severity: "formal",
    summary: "不应写入",
    captainDecisionOrdinal: null,
  });
  assert.equal(dissented.snapshot, snapshot);
  assert.equal(snapshot.dissents.length, 0);

  const resolved = resolveDepartmentDissent(
    snapshot,
    "dissent-missing",
    "moot",
  );
  assert.equal(resolved, snapshot);
});

test("render helpers return null when empty and include reminder copy when present", () => {
  const empty = createDepartmentStandingSnapshot();
  assert.equal(
    renderDepartmentStandingPromptBlock(empty, "engineering", {
      nowSimulationSeconds: 1000,
    }),
    null,
  );
  assert.equal(
    renderCaptainDissentLedgerPromptBlock(empty, {
      nowSimulationSeconds: 1000,
    }),
    null,
  );
  assert.equal(
    renderPeerPositionsPromptBlock([], { excludeDepartmentId: "engineering" }),
    null,
  );

  const eventAt = 1_000;
  const nowAt = eventAt + 6 * 3600 + 12 * 60;
  let snapshot = recordDepartmentConsultation(empty, {
    departmentId: "engineering",
    simulationSeconds: eventAt,
    stance: "冷却回路需降载",
  });
  const filed = recordDepartmentDissent(snapshot, {
    departmentId: "engineering",
    simulationSeconds: eventAt,
    severity: "formal",
    summary: "反对满功率维持",
    captainDecisionOrdinal: 1,
  });
  snapshot = filed.snapshot;

  const standingBlock = renderDepartmentStandingPromptBlock(
    snapshot,
    "engineering",
    { nowSimulationSeconds: nowAt },
  );
  assert.ok(standingBlock);
  assert.match(standingBlock, /<standing>/);
  assert.match(standingBlock, /被咨询次数：1/);
  assert.match(standingBlock, /提出异议次数：1/);
  assert.match(standingBlock, /距今 6h12m：冷却回路需降载/);
  assert.match(
    standingBlock,
    /这是你自己的历史立场记录，可以据此保持专业一致性，但不得因此拒绝服从舰长的最终决定，也不得把旧立场当作本回合的观测事实/,
  );

  const ledgerBlock = renderCaptainDissentLedgerPromptBlock(snapshot, {
    nowSimulationSeconds: nowAt,
  });
  assert.ok(ledgerBlock);
  assert.match(ledgerBlock, /<dissent_ledger>/);
  assert.match(ledgerBlock, /\[engineering\]/);
  assert.match(ledgerBlock, /正式异议/);
  assert.match(ledgerBlock, /反对满功率维持/);
  assert.match(ledgerBlock, /距今 6h12m/);
  assert.match(
    ledgerBlock,
    /这些是下属部门尚未撤销的反对意见，你有权坚持，但记录会进入航程结束报告/,
  );

  const peerBlock = renderPeerPositionsPromptBlock(
    [
      { departmentId: "engineering", text: "自己的发言应被排除" },
      { departmentId: "medical", text: "  建议推迟唤醒  " },
      { departmentId: "security", text: "   " },
      { departmentId: "navigation", text: "航路窗口仍开放" },
    ],
    { excludeDepartmentId: "engineering" },
  );
  assert.ok(peerBlock);
  assert.match(peerBlock, /<peer_positions>/);
  assert.match(peerBlock, /\[medical\] 建议推迟唤醒/);
  assert.match(peerBlock, /\[navigation\] 航路窗口仍开放/);
  assert.equal(peerBlock.includes("自己的发言应被排除"), false);
  assert.match(
    peerBlock,
    /这些是同僚本轮的发言，你可以明确赞同或反驳，专业分歧比虚假一致更有价值/,
  );
});

test("renderPeerPositionsPromptBlock excludes self and returns null when nothing remains", () => {
  assert.equal(
    renderPeerPositionsPromptBlock(
      [
        { departmentId: "engineering", text: "仅自己" },
        { departmentId: "medical", text: "   " },
      ],
      { excludeDepartmentId: "engineering" },
    ),
    null,
  );
});

test("parseFileDissentToolCall validates, defaults severity, and truncates", () => {
  assert.deepEqual(parseFileDissentToolCall(null), {
    ok: false,
    reason: "异议参数必须是对象",
  });
  assert.equal(parseFileDissentToolCall({ summary: 12 }).ok, false);
  assert.equal(parseFileDissentToolCall({ summary: "   " }).ok, false);
  assert.equal(
    parseFileDissentToolCall({
      severity: "critical",
      summary: "非法严重度",
    }).ok,
    false,
  );

  const defaulted = parseFileDissentToolCall({
    summary: "  保留冷却冗余  ",
  });
  assert.deepEqual(defaulted, {
    ok: true,
    draft: { severity: "formal", summary: "保留冷却冗余" },
  });

  const longSummary = "异".repeat(DEPARTMENT_DISSENT_MAX_SUMMARY_CHARACTERS + 20);
  const truncated = parseFileDissentToolCall({
    severity: "grave",
    summary: longSummary,
  });
  assert.equal(truncated.ok, true);
  if (truncated.ok) {
    assert.equal(truncated.draft.severity, "grave");
    assert.equal(
      truncated.draft.summary.length,
      DEPARTMENT_DISSENT_MAX_SUMMARY_CHARACTERS,
    );
  }

  const longStance = "立".repeat(DEPARTMENT_STANCE_MAX_CHARACTERS + 8);
  let snapshot = createDepartmentStandingSnapshot();
  snapshot = recordDepartmentConsultation(snapshot, {
    departmentId: "security",
    simulationSeconds: 9,
    stance: longStance,
  });
  assert.equal(
    snapshot.standings.find((entry) => entry.departmentId === "security")
      ?.recentPositions[0]?.stance.length,
    DEPARTMENT_STANCE_MAX_CHARACTERS,
  );
});

test("summarizeDissentLedger openCount matches unresolved records", () => {
  let snapshot = createDepartmentStandingSnapshot();
  const first = recordDepartmentDissent(snapshot, {
    departmentId: "passenger-affairs",
    simulationSeconds: 1,
    severity: "note",
    summary: "班次不公",
    captainDecisionOrdinal: null,
  });
  snapshot = first.snapshot;
  const second = recordDepartmentDissent(snapshot, {
    departmentId: "passenger-affairs",
    simulationSeconds: 2,
    severity: "formal",
    summary: "信任下滑",
    captainDecisionOrdinal: 4,
  });
  snapshot = second.snapshot;
  const third = recordDepartmentDissent(snapshot, {
    departmentId: "security",
    simulationSeconds: 3,
    severity: "grave",
    summary: "封锁范围过大",
    captainDecisionOrdinal: 4,
  });
  snapshot = third.snapshot;
  snapshot = resolveDepartmentDissent(
    snapshot,
    first.record.recordId,
    "overridden",
  );

  const summary = summarizeDissentLedger(snapshot);
  const affairs = summary.find(
    (entry) => entry.departmentId === "passenger-affairs",
  );
  const security = summary.find(
    (entry) => entry.departmentId === "security",
  );
  assert.equal(affairs?.dissentCount, 2);
  assert.equal(affairs?.overriddenCount, 1);
  assert.equal(affairs?.openCount, 1);
  assert.equal(security?.dissentCount, 1);
  assert.equal(security?.openCount, 1);
  assert.equal(openDissentsForCaptain(snapshot).length, 2);
});

test("validateDepartmentStandingSnapshot is strict and deep-clones", () => {
  const snapshot = createDepartmentStandingSnapshot();
  const validated = validateDepartmentStandingSnapshot(snapshot);
  assert.ok(validated);
  assert.notEqual(validated, snapshot);
  assert.notEqual(validated.standings, snapshot.standings);
  validated.standings[0].consultationCount = 99;
  assert.equal(snapshot.standings[0].consultationCount, 0);

  assert.equal(validateDepartmentStandingSnapshot(null), null);
  assert.equal(validateDepartmentStandingSnapshot({}), null);
  assert.equal(
    validateDepartmentStandingSnapshot({
      ...snapshot,
      snapshotVersion: 2,
    }),
    null,
  );
  assert.equal(
    validateDepartmentStandingSnapshot({
      ...snapshot,
      standings: snapshot.standings.slice(1),
    }),
    null,
  );
  assert.equal(
    validateDepartmentStandingSnapshot({
      ...snapshot,
      nextOrdinal: 0,
    }),
    null,
  );

  const withDissent = recordDepartmentDissent(snapshot, {
    departmentId: "navigation",
    simulationSeconds: 12,
    severity: "note",
    summary: "跃迁窗口过窄",
    captainDecisionOrdinal: null,
  }).snapshot;
  const badDissent = structuredClone(withDissent);
  badDissent.dissents[0].summary = "";
  assert.equal(validateDepartmentStandingSnapshot(badDissent), null);
});

test("relative time formatting never goes negative", () => {
  let snapshot = createDepartmentStandingSnapshot();
  snapshot = recordDepartmentConsultation(snapshot, {
    departmentId: "passenger-service",
    simulationSeconds: 10_000,
    stance: "食堂排队过长",
  });
  const filed = recordDepartmentDissent(snapshot, {
    departmentId: "passenger-service",
    simulationSeconds: 10_000,
    severity: "note",
    summary: "公告语气生硬",
    captainDecisionOrdinal: null,
  });
  snapshot = filed.snapshot;

  const standingBlock = renderDepartmentStandingPromptBlock(
    snapshot,
    "passenger-service",
    { nowSimulationSeconds: 100 },
  );
  const ledgerBlock = renderCaptainDissentLedgerPromptBlock(snapshot, {
    nowSimulationSeconds: 100,
  });
  assert.ok(standingBlock);
  assert.ok(ledgerBlock);
  assert.match(standingBlock, /距今 0m/);
  assert.match(ledgerBlock, /距今 0m/);
  assert.equal(standingBlock.includes("距今 -"), false);
  assert.equal(ledgerBlock.includes("距今 -"), false);
});
