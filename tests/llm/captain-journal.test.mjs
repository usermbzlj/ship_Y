import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTAIN_JOURNAL_MAX_ENTRIES,
  CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS,
  CAPTAIN_JOURNAL_MAX_UNRESOLVED_CHARACTERS,
  CAPTAIN_JOURNAL_MAX_UNRESOLVED_ITEMS,
  CAPTAIN_JOURNAL_MAX_VOICE_CHARACTERS,
  CAPTAIN_JOURNAL_PROMPT_ENTRY_LIMIT,
  CAPTAIN_JOURNAL_SNAPSHOT_VERSION,
  RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA,
  appendCaptainJournalEntry,
  createCaptainJournalSnapshot,
  parseCaptainLogToolCall,
  renderCaptainJournalPromptBlock,
  validateCaptainJournalSnapshot,
} from "../../lib/llm/captain-journal.ts";

function draft(overrides = {}) {
  return {
    voice: "我仍在权衡冷却余量与跃迁窗口。",
    judgment: "暂缓跃迁，先压住热总线。",
    watching: "冷却回路回温斜率",
    concern: "热积累可能再次触发联锁",
    unresolved: ["确认电解制氧是否仍暂停"],
    ...overrides,
  };
}

function appendMany(count, startSeconds = 0) {
  let snapshot = createCaptainJournalSnapshot();
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const result = appendCaptainJournalEntry(
      snapshot,
      draft({
        judgment: `判断-${index + 1}`,
        voice: `心声-${index + 1}`,
      }),
      {
        simulationSeconds: startSeconds + index * 3600,
        triggerKey: `trigger-${index + 1}`,
      },
    );
    snapshot = result.snapshot;
    entries.push(result.entry);
  }
  return { snapshot, entries };
}

test("空快照渲染返回 null", () => {
  const snapshot = createCaptainJournalSnapshot();
  assert.equal(
    renderCaptainJournalPromptBlock(snapshot, {
      nowSimulationSeconds: 0,
    }),
    null,
  );
});

test("追加后 ordinal / entryId 递增且 nextOrdinal 正确", () => {
  let snapshot = createCaptainJournalSnapshot();
  assert.equal(snapshot.nextOrdinal, 1);
  assert.equal(snapshot.snapshotVersion, CAPTAIN_JOURNAL_SNAPSHOT_VERSION);

  const first = appendCaptainJournalEntry(snapshot, draft(), {
    simulationSeconds: 7200,
    triggerKey: "routine-1",
  });
  assert.equal(first.entry.ordinal, 1);
  assert.equal(first.entry.entryId, "log-1");
  assert.equal(first.snapshot.nextOrdinal, 2);
  assert.equal(first.snapshot.entries.length, 1);
  assert.notEqual(first.snapshot, snapshot);
  assert.equal(snapshot.entries.length, 0);

  const second = appendCaptainJournalEntry(
    first.snapshot,
    draft({ judgment: "第二次判断" }),
    {
      simulationSeconds: 14_400,
      triggerKey: "routine-2",
    },
  );
  assert.equal(second.entry.ordinal, 2);
  assert.equal(second.entry.entryId, "log-2");
  assert.equal(second.snapshot.nextOrdinal, 3);
  assert.deepEqual(
    second.snapshot.entries.map((entry) => entry.entryId),
    ["log-1", "log-2"],
  );
});

test("超过 24 条时丢最旧、保留最新、nextOrdinal 不回绕", () => {
  const { snapshot, entries } = appendMany(CAPTAIN_JOURNAL_MAX_ENTRIES + 3);
  assert.equal(snapshot.entries.length, CAPTAIN_JOURNAL_MAX_ENTRIES);
  assert.equal(snapshot.entries[0].ordinal, 4);
  assert.equal(snapshot.entries[0].entryId, "log-4");
  assert.equal(
    snapshot.entries[snapshot.entries.length - 1].ordinal,
    CAPTAIN_JOURNAL_MAX_ENTRIES + 3,
  );
  assert.equal(
    snapshot.nextOrdinal,
    CAPTAIN_JOURNAL_MAX_ENTRIES + 4,
  );
  assert.equal(entries[0].ordinal, 1);
  assert.ok(
    !snapshot.entries.some((entry) => entry.ordinal === 1),
  );
});

test("解析：缺 voice / 缺 judgment / 非对象失败", () => {
  assert.equal(parseCaptainLogToolCall(null).ok, false);
  assert.equal(parseCaptainLogToolCall("x").ok, false);
  assert.equal(parseCaptainLogToolCall([]).ok, false);

  const missingVoice = parseCaptainLogToolCall({
    judgment: "只有判断",
  });
  assert.equal(missingVoice.ok, false);
  if (!missingVoice.ok) {
    assert.match(missingVoice.reason, /voice/);
  }

  const emptyVoice = parseCaptainLogToolCall({
    voice: "   ",
    judgment: "判断",
  });
  assert.equal(emptyVoice.ok, false);

  const missingJudgment = parseCaptainLogToolCall({
    voice: "心声",
  });
  assert.equal(missingJudgment.ok, false);
  if (!missingJudgment.ok) {
    assert.match(missingJudgment.reason, /judgment/);
  }
});

test("解析：超长截断；unresolved 超量与超长截断", () => {
  const parsed = parseCaptainLogToolCall({
    voice: "V".repeat(CAPTAIN_JOURNAL_MAX_VOICE_CHARACTERS + 40),
    judgment: "J".repeat(CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS + 20),
    watching: `  ${"W".repeat(CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS + 5)}  `,
    concern: null,
    unresolved: [
      "A".repeat(CAPTAIN_JOURNAL_MAX_UNRESOLVED_CHARACTERS + 10),
      "  keep  ",
      "",
      "   ",
      "third",
      "fourth",
      "fifth-should-drop",
      12,
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    throw new Error("expected ok");
  }
  assert.equal(
    parsed.draft.voice.length,
    CAPTAIN_JOURNAL_MAX_VOICE_CHARACTERS,
  );
  assert.equal(
    parsed.draft.judgment.length,
    CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS,
  );
  assert.equal(
    parsed.draft.watching?.length,
    CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS,
  );
  assert.equal(parsed.draft.concern, null);
  assert.equal(
    parsed.draft.unresolved.length,
    CAPTAIN_JOURNAL_MAX_UNRESOLVED_ITEMS,
  );
  assert.equal(
    parsed.draft.unresolved[0].length,
    CAPTAIN_JOURNAL_MAX_UNRESOLVED_CHARACTERS,
  );
  assert.deepEqual(parsed.draft.unresolved.slice(1), [
    "keep",
    "third",
    "fourth",
  ]);

  const defaults = parseCaptainLogToolCall({
    voice: " 心声 ",
    judgment: " 判断 ",
  });
  assert.equal(defaults.ok, true);
  if (defaults.ok) {
    assert.equal(defaults.draft.watching, null);
    assert.equal(defaults.draft.concern, null);
    assert.deepEqual(defaults.draft.unresolved, []);
  }
});

test("渲染块含免责声明、最旧到最新、遵守 entryLimit、无负相对时间", () => {
  const { snapshot } = appendMany(8, 86_400 * 3 + 4 * 3600);
  const block = renderCaptainJournalPromptBlock(snapshot, {
    nowSimulationSeconds: 86_400 * 3 + 10 * 3600 + 12 * 60,
    entryLimit: 3,
  });
  assert.ok(block);
  assert.match(block, /<memory>/);
  assert.match(block, /<\/memory>/);
  assert.match(block, /主观私人/);
  assert.match(block, /误判/);
  assert.match(block, /不是传感器读数/);
  assert.match(block, /不得当作事实引用/);

  const judgmentOrder = [...block.matchAll(/判断：判断-(\d+)/g)].map(
    (match) => Number(match[1]),
  );
  assert.deepEqual(judgmentOrder, [6, 7, 8]);
  assert.equal(judgmentOrder.length, 3);
  assert.ok(judgmentOrder.length <= CAPTAIN_JOURNAL_PROMPT_ENTRY_LIMIT);

  assert.match(block, /T\+\d+d\d{2}h/);
  assert.match(block, /距今 \d+h\d{2}m/);
  assert.doesNotMatch(block, /距今 -/);
  assert.doesNotMatch(block, /T\+-/);

  const earlyNow = renderCaptainJournalPromptBlock(snapshot, {
    nowSimulationSeconds: 0,
    entryLimit: 1,
  });
  assert.ok(earlyNow);
  assert.match(earlyNow, /距今 0h00m/);
  assert.doesNotMatch(earlyNow, /距今 -/);

  const withNulls = appendCaptainJournalEntry(
    createCaptainJournalSnapshot(),
    draft({
      watching: null,
      concern: null,
      unresolved: [],
    }),
    { simulationSeconds: 3600, triggerKey: "t" },
  );
  const sparse = renderCaptainJournalPromptBlock(withNulls.snapshot, {
    nowSimulationSeconds: 7200,
  });
  assert.ok(sparse);
  assert.match(sparse, /判断：/);
  assert.doesNotMatch(sparse, /等待：/);
  assert.doesNotMatch(sparse, /担忧：/);
  assert.doesNotMatch(sparse, /未决：/);
});

test("validateCaptainJournalSnapshot 严格校验并深拷贝", () => {
  assert.equal(validateCaptainJournalSnapshot(null), null);
  assert.equal(validateCaptainJournalSnapshot([]), null);
  assert.equal(validateCaptainJournalSnapshot({}), null);
  assert.equal(
    validateCaptainJournalSnapshot({
      snapshotVersion: 999,
      nextOrdinal: 1,
      entries: [],
    }),
    null,
  );
  assert.equal(
    validateCaptainJournalSnapshot({
      snapshotVersion: CAPTAIN_JOURNAL_SNAPSHOT_VERSION,
      nextOrdinal: 1,
    }),
    null,
  );

  const { snapshot } = appendMany(2, 1000);
  const validated = validateCaptainJournalSnapshot(snapshot);
  assert.ok(validated);
  assert.notEqual(validated, snapshot);
  assert.notEqual(validated.entries, snapshot.entries);
  validated.entries[0].judgment = "被污染";
  assert.notEqual(snapshot.entries[0].judgment, "被污染");

  const emptyValidated = validateCaptainJournalSnapshot(
    createCaptainJournalSnapshot(),
  );
  assert.deepEqual(emptyValidated, createCaptainJournalSnapshot());

  const badEntry = validateCaptainJournalSnapshot({
    snapshotVersion: CAPTAIN_JOURNAL_SNAPSHOT_VERSION,
    nextOrdinal: 2,
    entries: [
      {
        ...snapshot.entries[0],
        entryId: "wrong-id",
      },
    ],
  });
  assert.equal(badEntry, null);
});

test("schema 被冻结且 required 正确", () => {
  assert.equal(Object.isFrozen(RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA), true);
  assert.equal(
    Object.isFrozen(RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA.properties),
    true,
  );
  assert.deepEqual(RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA.required, [
    "voice",
    "judgment",
  ]);
  assert.equal(RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA.type, "object");
  assert.equal(
    RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA.additionalProperties,
    false,
  );
  assert.equal(
    RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA.properties.unresolved.maxItems,
    4,
  );
  assert.throws(() => {
    RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA.required.push("watching");
  });
});
