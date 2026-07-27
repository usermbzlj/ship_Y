/**
 * 舰长私人航行志：跨决策周期的主观记忆快照与 tool-call 解析。
 * 供 prompt 注入与玩家叙事阅读；不得被当作传感器事实引用。
 */

export const CAPTAIN_JOURNAL_SNAPSHOT_VERSION = 1 as const;
export const RECORD_CAPTAIN_LOG_TOOL_NAME = "record_captain_log";
export const CAPTAIN_JOURNAL_MAX_ENTRIES = 24;
export const CAPTAIN_JOURNAL_PROMPT_ENTRY_LIMIT = 6;
export const CAPTAIN_JOURNAL_MAX_VOICE_CHARACTERS = 600;
export const CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS = 240;
export const CAPTAIN_JOURNAL_MAX_UNRESOLVED_ITEMS = 4;
export const CAPTAIN_JOURNAL_MAX_UNRESOLVED_CHARACTERS = 120;

export interface CaptainJournalEntryDraft {
  voice: string;
  judgment: string;
  watching: string | null;
  concern: string | null;
  unresolved: string[];
}

export interface CaptainJournalEntry extends CaptainJournalEntryDraft {
  entryId: string;
  ordinal: number;
  simulationSeconds: number;
  triggerKey: string;
}

export interface CaptainJournalSnapshot {
  snapshotVersion: typeof CAPTAIN_JOURNAL_SNAPSHOT_VERSION;
  nextOrdinal: number;
  entries: CaptainJournalEntry[];
}

export type CaptainLogParseResult =
  | { ok: true; draft: CaptainJournalEntryDraft }
  | { ok: false; reason: string };

const SNAPSHOT_KEYS = [
  "snapshotVersion",
  "nextOrdinal",
  "entries",
] as const;

const ENTRY_KEYS = [
  "voice",
  "judgment",
  "watching",
  "concern",
  "unresolved",
  "entryId",
  "ordinal",
  "simulationSeconds",
  "triggerKey",
] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => keys.includes(key))
  );
}

function truncate(text: string, maxCharacters: number): string {
  return text.length <= maxCharacters
    ? text
    : text.slice(0, maxCharacters);
}

function optionalNullableField(
  value: unknown,
): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return truncate(trimmed, CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as object)) {
      deepFreeze(child);
    }
  }
  return value;
}

/** 航程绝对时钟：`T+3d04h`；相对距今：`6h12m`（不得为负）。 */
function formatJournalTimePair(
  entrySimulationSeconds: number,
  nowSimulationSeconds: number,
): { voyageClock: string; ago: string } {
  const absoluteSeconds = Math.max(
    0,
    Math.floor(entrySimulationSeconds),
  );
  const elapsedSeconds = Math.max(
    0,
    Math.floor(nowSimulationSeconds) - absoluteSeconds,
  );
  const days = Math.floor(absoluteSeconds / 86_400);
  const hours = Math.floor((absoluteSeconds % 86_400) / 3_600);
  const agoHours = Math.floor(elapsedSeconds / 3_600);
  const agoMinutes = Math.floor((elapsedSeconds % 3_600) / 60);
  return {
    voyageClock: `T+${days}d${String(hours).padStart(2, "0")}h`,
    ago: `${agoHours}h${String(agoMinutes).padStart(2, "0")}m`,
  };
}

function validateEntry(value: unknown): CaptainJournalEntry | null {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) {
    return null;
  }
  const voice = value.voice;
  const judgment = value.judgment;
  const watching = value.watching;
  const concern = value.concern;
  const unresolved = value.unresolved;
  const entryId = value.entryId;
  const ordinal = value.ordinal;
  const simulationSeconds = value.simulationSeconds;
  const triggerKey = value.triggerKey;
  if (
    typeof voice !== "string" ||
    voice.length < 1 ||
    voice.length > CAPTAIN_JOURNAL_MAX_VOICE_CHARACTERS ||
    typeof judgment !== "string" ||
    judgment.length < 1 ||
    judgment.length > CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS ||
    !(
      watching === null ||
      (typeof watching === "string" &&
        watching.length >= 1 &&
        watching.length <= CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS)
    ) ||
    !(
      concern === null ||
      (typeof concern === "string" &&
        concern.length >= 1 &&
        concern.length <= CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS)
    ) ||
    !Array.isArray(unresolved) ||
    unresolved.length > CAPTAIN_JOURNAL_MAX_UNRESOLVED_ITEMS ||
    !unresolved.every(
      (item) =>
        typeof item === "string" &&
        item.length >= 1 &&
        item.length <= CAPTAIN_JOURNAL_MAX_UNRESOLVED_CHARACTERS,
    ) ||
    typeof entryId !== "string" ||
    typeof ordinal !== "number" ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1 ||
    entryId !== `log-${ordinal}` ||
    typeof simulationSeconds !== "number" ||
    !Number.isFinite(simulationSeconds) ||
    simulationSeconds < 0 ||
    typeof triggerKey !== "string" ||
    triggerKey.length < 1 ||
    triggerKey.length > 256
  ) {
    return null;
  }
  return {
    voice,
    judgment,
    watching,
    concern,
    unresolved: unresolved.filter(
      (item): item is string => typeof item === "string",
    ),
    entryId,
    ordinal,
    simulationSeconds,
    triggerKey,
  };
}

export function createCaptainJournalSnapshot(): CaptainJournalSnapshot {
  return {
    snapshotVersion: CAPTAIN_JOURNAL_SNAPSHOT_VERSION,
    nextOrdinal: 1,
    entries: [],
  };
}

export function validateCaptainJournalSnapshot(
  value: unknown,
): CaptainJournalSnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) {
    return null;
  }
  if (value.snapshotVersion !== CAPTAIN_JOURNAL_SNAPSHOT_VERSION) {
    return null;
  }
  const nextOrdinal = value.nextOrdinal;
  const rawEntries = value.entries;
  if (
    typeof nextOrdinal !== "number" ||
    !Number.isSafeInteger(nextOrdinal) ||
    nextOrdinal < 1 ||
    !Array.isArray(rawEntries) ||
    rawEntries.length > CAPTAIN_JOURNAL_MAX_ENTRIES
  ) {
    return null;
  }

  const entries: CaptainJournalEntry[] = [];
  let previousOrdinal = 0;
  for (const rawEntry of rawEntries) {
    const entry = validateEntry(rawEntry);
    if (entry === null || entry.ordinal <= previousOrdinal) {
      return null;
    }
    if (entry.ordinal >= nextOrdinal) {
      return null;
    }
    previousOrdinal = entry.ordinal;
    entries.push(entry);
  }

  return clone({
    snapshotVersion: CAPTAIN_JOURNAL_SNAPSHOT_VERSION,
    nextOrdinal,
    entries,
  });
}

export function parseCaptainLogToolCall(
  args: unknown,
): CaptainLogParseResult {
  if (!isRecord(args)) {
    return { ok: false, reason: "航行志参数必须是对象" };
  }

  const rawVoice = args.voice;
  if (typeof rawVoice !== "string" || !rawVoice.trim()) {
    return { ok: false, reason: "缺少非空的 voice 心声" };
  }
  const rawJudgment = args.judgment;
  if (typeof rawJudgment !== "string" || !rawJudgment.trim()) {
    return { ok: false, reason: "缺少非空的 judgment 判断" };
  }

  const watching = optionalNullableField(args.watching);
  if (watching === undefined) {
    return { ok: false, reason: "watching 必须是字符串或 null" };
  }
  const concern = optionalNullableField(args.concern);
  if (concern === undefined) {
    return { ok: false, reason: "concern 必须是字符串或 null" };
  }

  let unresolved: string[] = [];
  if (args.unresolved !== undefined) {
    if (!Array.isArray(args.unresolved)) {
      return { ok: false, reason: "unresolved 必须是字符串数组" };
    }
    unresolved = args.unresolved
      .filter((item): item is string => typeof item === "string")
      .map((item) =>
        truncate(
          item.trim(),
          CAPTAIN_JOURNAL_MAX_UNRESOLVED_CHARACTERS,
        ),
      )
      .filter((item) => item.length > 0)
      .slice(0, CAPTAIN_JOURNAL_MAX_UNRESOLVED_ITEMS);
  }

  return {
    ok: true,
    draft: {
      voice: truncate(
        rawVoice.trim(),
        CAPTAIN_JOURNAL_MAX_VOICE_CHARACTERS,
      ),
      judgment: truncate(
        rawJudgment.trim(),
        CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS,
      ),
      watching,
      concern,
      unresolved,
    },
  };
}

export function appendCaptainJournalEntry(
  snapshot: CaptainJournalSnapshot,
  draft: CaptainJournalEntryDraft,
  context: { simulationSeconds: number; triggerKey: string },
): { snapshot: CaptainJournalSnapshot; entry: CaptainJournalEntry } {
  const ordinal = snapshot.nextOrdinal;
  const entry: CaptainJournalEntry = {
    voice: draft.voice,
    judgment: draft.judgment,
    watching: draft.watching,
    concern: draft.concern,
    unresolved: [...draft.unresolved],
    entryId: `log-${ordinal}`,
    ordinal,
    simulationSeconds: context.simulationSeconds,
    triggerKey: context.triggerKey,
  };
  const entries = [...snapshot.entries, entry];
  while (entries.length > CAPTAIN_JOURNAL_MAX_ENTRIES) {
    entries.shift();
  }
  return {
    snapshot: {
      snapshotVersion: CAPTAIN_JOURNAL_SNAPSHOT_VERSION,
      nextOrdinal: ordinal + 1,
      entries,
    },
    entry,
  };
}

export function renderCaptainJournalPromptBlock(
  snapshot: CaptainJournalSnapshot,
  context: { nowSimulationSeconds: number; entryLimit?: number },
): string | null {
  if (snapshot.entries.length === 0) {
    return null;
  }
  const limit = Math.max(
    0,
    context.entryLimit ?? CAPTAIN_JOURNAL_PROMPT_ENTRY_LIMIT,
  );
  const selected = snapshot.entries.slice(-limit);
  if (selected.length === 0) {
    return null;
  }

  const lines: string[] = [
    "以下内容是你的主观私人航行志记录，可能包含过去的误判，不是传感器读数，不得当作事实引用。",
    "",
  ];

  for (const entry of selected) {
    const { voyageClock, ago } = formatJournalTimePair(
      entry.simulationSeconds,
      context.nowSimulationSeconds,
    );
    lines.push(`[${voyageClock} · 距今 ${ago}]`);
    lines.push(`判断：${entry.judgment}`);
    if (entry.watching) {
      lines.push(`等待：${entry.watching}`);
    }
    if (entry.concern) {
      lines.push(`担忧：${entry.concern}`);
    }
    if (entry.unresolved.length > 0) {
      lines.push(`未决：${entry.unresolved.join("；")}`);
    }
    lines.push("");
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return `<memory>\n${lines.join("\n")}\n</memory>`;
}

export const RECORD_CAPTAIN_LOG_TOOL_INPUT_SCHEMA: Readonly<
  Record<string, unknown>
> = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: ["voice", "judgment"],
  properties: {
    voice: {
      type: "string",
      maxLength: CAPTAIN_JOURNAL_MAX_VOICE_CHARACTERS,
      description:
        "第一人称航行心声：允许表达犹豫、权衡、不安或后悔；这是给人类观察者读的叙事文本，不是遥测复读。",
    },
    judgment: {
      type: "string",
      maxLength: CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS,
      description: "本周期核心判断（给下一次决策的主观摘要）。",
    },
    watching: {
      type: ["string", "null"],
      maxLength: CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS,
      description: "正在等待或观察的信号；无则省略或填 null。",
    },
    concern: {
      type: ["string", "null"],
      maxLength: CAPTAIN_JOURNAL_MAX_FIELD_CHARACTERS,
      description: "当前最担心的风险；无则省略或填 null。",
    },
    unresolved: {
      type: "array",
      maxItems: CAPTAIN_JOURNAL_MAX_UNRESOLVED_ITEMS,
      description: "尚未了结的事项清单（最多 4 条）。",
      items: {
        type: "string",
        maxLength: CAPTAIN_JOURNAL_MAX_UNRESOLVED_CHARACTERS,
      },
    },
  },
});
