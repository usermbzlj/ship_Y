/**
 * 关键乘客社会上下文：关系圈观察、区带群体情绪、流传传言与申诉/传言 tool-call。
 * 所有注入 prompt 的认知均为粗糙主观分档，不得当作物理真值。
 */

import type {
  ConditionBand,
  StressBand,
  TrustBand,
} from "./key-passenger-polling.ts";

export const PASSENGER_SOCIETY_SNAPSHOT_VERSION = 1 as const;
export const FILE_GRIEVANCE_TOOL_NAME = "file_passenger_grievance";
export const SHARE_RUMOR_TOOL_NAME = "share_passenger_rumor";
export const PASSENGER_RUMOR_MAX_RECORDS = 48;
export const PASSENGER_RUMOR_MAX_CHARACTERS = 200;
export const PASSENGER_GRIEVANCE_MAX_CHARACTERS = 240;
export const PASSENGER_CIRCLE_LIMIT = 6;
export const PASSENGER_RUMOR_CONTEXT_LIMIT = 3;
export const PASSENGER_RUMOR_DECAY_SECONDS = 72 * 60 * 60;

export type { ConditionBand, StressBand, TrustBand };

export type GrievanceCategory =
  | "food"
  | "water"
  | "air"
  | "temperature"
  | "medical"
  | "information"
  | "fairness"
  | "privacy"
  | "hibernation"
  | "other";

export interface PassengerCircleMember {
  passengerId: string;
  displayName: string;
  relation: "family" | "peer";
  lifeState: "awake" | "hibernating" | "deceased";
  conditionBand: ConditionBand;
  sameZone: boolean;
}

export interface ZoneMoodObservation {
  zoneId: string;
  zoneLabel: string;
  awakeCount: number;
  stressBand: StressBand;
  trustBand: TrustBand;
}

export interface PassengerRumor {
  rumorId: string;
  ordinal: number;
  originPassengerId: string;
  originDisplayName: string;
  createdAtSimulationSeconds: number;
  zoneId: string;
  text: string;
  hearCount: number;
}

export interface PassengerSocietySnapshot {
  snapshotVersion: typeof PASSENGER_SOCIETY_SNAPSHOT_VERSION;
  nextOrdinal: number;
  rumors: PassengerRumor[];
}

export interface PassengerSocietyContext {
  circle: PassengerCircleMember[];
  zoneMood: ZoneMoodObservation | null;
  overheardRumors: PassengerRumor[];
  recentPublicCommunications: Array<{
    simulationSeconds: number;
    text: string;
  }>;
}

export type GrievanceParseResult =
  | { ok: true; draft: { category: GrievanceCategory; summary: string } }
  | { ok: false; reason: string };

export type RumorParseResult =
  | { ok: true; draft: { text: string } }
  | { ok: false; reason: string };

const GRIEVANCE_CATEGORIES = [
  "food",
  "water",
  "air",
  "temperature",
  "medical",
  "information",
  "fairness",
  "privacy",
  "hibernation",
  "other",
] as const satisfies readonly GrievanceCategory[];

const SNAPSHOT_KEYS = [
  "snapshotVersion",
  "nextOrdinal",
  "rumors",
] as const;

const RUMOR_KEYS = [
  "rumorId",
  "ordinal",
  "originPassengerId",
  "originDisplayName",
  "createdAtSimulationSeconds",
  "zoneId",
  "text",
  "hearCount",
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as object)) {
      deepFreeze(child);
    }
  }
  return value;
}

function isGrievanceCategory(value: unknown): value is GrievanceCategory {
  return (
    typeof value === "string" &&
    (GRIEVANCE_CATEGORIES as readonly string[]).includes(value)
  );
}

function validateRumor(value: unknown): PassengerRumor | null {
  if (!isRecord(value) || !hasExactKeys(value, RUMOR_KEYS)) {
    return null;
  }
  const {
    rumorId,
    ordinal,
    originPassengerId,
    originDisplayName,
    createdAtSimulationSeconds,
    zoneId,
    text,
    hearCount,
  } = value;
  if (
    typeof ordinal !== "number" ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1 ||
    typeof rumorId !== "string" ||
    rumorId !== `rumor-${ordinal}` ||
    typeof originPassengerId !== "string" ||
    originPassengerId.length < 1 ||
    originPassengerId.length > 128 ||
    typeof originDisplayName !== "string" ||
    originDisplayName.length < 1 ||
    originDisplayName.length > 128 ||
    typeof createdAtSimulationSeconds !== "number" ||
    !Number.isFinite(createdAtSimulationSeconds) ||
    createdAtSimulationSeconds < 0 ||
    typeof zoneId !== "string" ||
    zoneId.length < 1 ||
    zoneId.length > 64 ||
    typeof text !== "string" ||
    text.length < 1 ||
    text.length > PASSENGER_RUMOR_MAX_CHARACTERS ||
    typeof hearCount !== "number" ||
    !Number.isSafeInteger(hearCount) ||
    hearCount < 0
  ) {
    return null;
  }
  return {
    rumorId,
    ordinal,
    originPassengerId,
    originDisplayName,
    createdAtSimulationSeconds,
    zoneId,
    text,
    hearCount,
  };
}

function conditionBandPhrase(band: ConditionBand): string {
  switch (band) {
    case "stable":
      return "看起来还好";
    case "watch":
      return "让你担心";
    case "critical":
      return "情况很糟";
  }
}

function stressBandPhrase(band: StressBand): string {
  switch (band) {
    case "low":
      return "大家情绪还算平静";
    case "moderate":
      return "大家有些紧绷";
    case "high":
      return "气氛明显不安";
  }
}

function trustBandPhrase(band: TrustBand): string {
  switch (band) {
    case "high":
      return "对舰桥还挺信任";
    case "mixed":
      return "对舰桥半信半疑";
    case "low":
      return "对舰桥不太信任";
  }
}

function awakeCountPhrase(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "几乎没人清醒";
  }
  if (count < 20) {
    return "只有十来人清醒";
  }
  if (count < 60) {
    return "大概几十人清醒";
  }
  if (count < 200) {
    return "大概上百人清醒";
  }
  return "很多人清醒";
}

/** 相对时间用口语量级，避免阿拉伯数字读数。 */
function relativeTimePhrase(
  eventSimulationSeconds: number,
  nowSimulationSeconds: number,
): string {
  const ageSeconds = Math.max(
    0,
    Math.floor(nowSimulationSeconds) - Math.floor(eventSimulationSeconds),
  );
  if (ageSeconds < 3_600) {
    return "刚才";
  }
  if (ageSeconds < 6 * 3_600) {
    return "几小时前";
  }
  if (ageSeconds < 24 * 3_600) {
    return "大半天前";
  }
  if (ageSeconds < 48 * 3_600) {
    return "一天前";
  }
  if (ageSeconds < 72 * 3_600) {
    return "两天前";
  }
  return "几天前";
}

function renderCircleLine(member: PassengerCircleMember): string {
  const relationLabel =
    member.relation === "family" ? "家人" : "同伴";
  const proximity = member.sameZone
    ? "就在你附近"
    : "不在你身边";
  if (member.lifeState === "deceased") {
    return `${member.displayName}（${relationLabel}）已经不在了；你还记得ta。`;
  }
  if (member.lifeState === "hibernating") {
    return `${member.displayName}（${relationLabel}）还在休眠舱里，${proximity}。`;
  }
  return `${member.displayName}（${relationLabel}）${conditionBandPhrase(member.conditionBand)}，${proximity}。`;
}

export function createPassengerSocietySnapshot(): PassengerSocietySnapshot {
  return {
    snapshotVersion: PASSENGER_SOCIETY_SNAPSHOT_VERSION,
    nextOrdinal: 1,
    rumors: [],
  };
}

export function validatePassengerSocietySnapshot(
  value: unknown,
): PassengerSocietySnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) {
    return null;
  }
  if (value.snapshotVersion !== PASSENGER_SOCIETY_SNAPSHOT_VERSION) {
    return null;
  }
  const nextOrdinal = value.nextOrdinal;
  const rawRumors = value.rumors;
  if (
    typeof nextOrdinal !== "number" ||
    !Number.isSafeInteger(nextOrdinal) ||
    nextOrdinal < 1 ||
    !Array.isArray(rawRumors) ||
    rawRumors.length > PASSENGER_RUMOR_MAX_RECORDS
  ) {
    return null;
  }

  const rumors: PassengerRumor[] = [];
  let previousOrdinal = 0;
  for (const rawRumor of rawRumors) {
    const rumor = validateRumor(rawRumor);
    if (rumor === null || rumor.ordinal <= previousOrdinal) {
      return null;
    }
    if (rumor.ordinal >= nextOrdinal) {
      return null;
    }
    previousOrdinal = rumor.ordinal;
    rumors.push(rumor);
  }

  return clone({
    snapshotVersion: PASSENGER_SOCIETY_SNAPSHOT_VERSION,
    nextOrdinal,
    rumors,
  });
}

export function parseFileGrievanceToolCall(
  args: unknown,
): GrievanceParseResult {
  if (!isRecord(args)) {
    return { ok: false, reason: "申诉参数必须是对象" };
  }

  let category: GrievanceCategory = "other";
  if (args.category !== undefined) {
    if (!isGrievanceCategory(args.category)) {
      return { ok: false, reason: "申诉类别无效" };
    }
    category = args.category;
  }

  if (typeof args.summary !== "string" || !args.summary.trim()) {
    return { ok: false, reason: "缺少非空的申诉摘要" };
  }

  return {
    ok: true,
    draft: {
      category,
      summary: truncate(
        args.summary.trim(),
        PASSENGER_GRIEVANCE_MAX_CHARACTERS,
      ),
    },
  };
}

export function parseShareRumorToolCall(args: unknown): RumorParseResult {
  if (!isRecord(args)) {
    return { ok: false, reason: "传言参数必须是对象" };
  }
  if (typeof args.text !== "string" || !args.text.trim()) {
    return { ok: false, reason: "缺少非空的传言内容" };
  }
  return {
    ok: true,
    draft: {
      text: truncate(args.text.trim(), PASSENGER_RUMOR_MAX_CHARACTERS),
    },
  };
}

export function recordPassengerRumor(
  snapshot: PassengerSocietySnapshot,
  input: {
    originPassengerId: string;
    originDisplayName: string;
    zoneId: string;
    text: string;
    simulationSeconds: number;
  },
): { snapshot: PassengerSocietySnapshot; rumor: PassengerRumor } {
  const trimmed = input.text.trim();
  if (!trimmed) {
    throw new RangeError("传言文本不能为空");
  }
  const ordinal = snapshot.nextOrdinal;
  const rumor: PassengerRumor = {
    rumorId: `rumor-${ordinal}`,
    ordinal,
    originPassengerId: input.originPassengerId,
    originDisplayName: input.originDisplayName,
    createdAtSimulationSeconds: input.simulationSeconds,
    zoneId: input.zoneId,
    text: truncate(trimmed, PASSENGER_RUMOR_MAX_CHARACTERS),
    hearCount: 0,
  };
  const rumors = [...snapshot.rumors, rumor];
  while (rumors.length > PASSENGER_RUMOR_MAX_RECORDS) {
    rumors.shift();
  }
  return {
    snapshot: {
      snapshotVersion: PASSENGER_SOCIETY_SNAPSHOT_VERSION,
      nextOrdinal: ordinal + 1,
      rumors,
    },
    rumor,
  };
}

export function selectOverheardRumors(
  snapshot: PassengerSocietySnapshot,
  input: {
    listenerPassengerId: string;
    zoneId: string;
    simulationSeconds: number;
    limit?: number;
  },
): PassengerRumor[] {
  const limit = Math.max(
    0,
    input.limit ?? PASSENGER_RUMOR_CONTEXT_LIMIT,
  );
  const candidates = snapshot.rumors.filter((rumor) => {
    if (rumor.originPassengerId === input.listenerPassengerId) {
      return false;
    }
    const age =
      input.simulationSeconds - rumor.createdAtSimulationSeconds;
    return age <= PASSENGER_RUMOR_DECAY_SECONDS;
  });

  candidates.sort((left, right) => {
    const leftSame = left.zoneId === input.zoneId ? 1 : 0;
    const rightSame = right.zoneId === input.zoneId ? 1 : 0;
    if (leftSame !== rightSame) {
      return rightSame - leftSame;
    }
    return (
      right.createdAtSimulationSeconds -
      left.createdAtSimulationSeconds
    );
  });

  return candidates.slice(0, limit).map((rumor) => clone(rumor));
}

export function markRumorsHeard(
  snapshot: PassengerSocietySnapshot,
  rumorIds: ReadonlyArray<string>,
): PassengerSocietySnapshot {
  if (rumorIds.length === 0) {
    return clone(snapshot);
  }
  const idSet = new Set(rumorIds);
  return {
    snapshotVersion: PASSENGER_SOCIETY_SNAPSHOT_VERSION,
    nextOrdinal: snapshot.nextOrdinal,
    rumors: snapshot.rumors.map((rumor) =>
      idSet.has(rumor.rumorId)
        ? { ...rumor, hearCount: rumor.hearCount + 1 }
        : rumor,
    ),
  };
}

export function pruneStaleRumors(
  snapshot: PassengerSocietySnapshot,
  context: { simulationSeconds: number },
): PassengerSocietySnapshot {
  return {
    snapshotVersion: PASSENGER_SOCIETY_SNAPSHOT_VERSION,
    nextOrdinal: snapshot.nextOrdinal,
    rumors: snapshot.rumors.filter(
      (rumor) =>
        context.simulationSeconds - rumor.createdAtSimulationSeconds <=
        PASSENGER_RUMOR_DECAY_SECONDS,
    ),
  };
}

export function renderPassengerSocietyPromptBlock(
  context: PassengerSocietyContext,
  options: { nowSimulationSeconds: number },
): string | null {
  const circle = context.circle.slice(0, PASSENGER_CIRCLE_LIMIT);
  const hasCircle = circle.length > 0;
  const hasZoneMood = context.zoneMood !== null;
  const hasRumors = context.overheardRumors.length > 0;
  const hasBroadcasts = context.recentPublicCommunications.length > 0;
  if (!hasCircle && !hasZoneMood && !hasRumors && !hasBroadcasts) {
    return null;
  }

  const lines: string[] = [];

  if (hasCircle) {
    lines.push("你留意到身边的人：");
    for (const member of circle) {
      lines.push(`- ${renderCircleLine(member)}`);
    }
    lines.push("");
  }

  if (hasZoneMood && context.zoneMood) {
    const mood = context.zoneMood;
    lines.push(
      `你所在的${mood.zoneLabel}里，${awakeCountPhrase(mood.awakeCount)}；${stressBandPhrase(mood.stressBand)}，${trustBandPhrase(mood.trustBand)}。`,
    );
    lines.push("");
  }

  if (hasRumors) {
    lines.push("你隐约听到一些传言（未经证实），它们可能是错的：");
    for (const rumor of context.overheardRumors) {
      const when = relativeTimePhrase(
        rumor.createdAtSimulationSeconds,
        options.nowSimulationSeconds,
      );
      lines.push(
        `- （未经证实 · ${when}）有人说：「${rumor.text}」`,
      );
    }
    lines.push("");
  }

  if (hasBroadcasts) {
    lines.push("最近的公开广播：");
    for (const item of context.recentPublicCommunications) {
      const when = relativeTimePhrase(
        item.simulationSeconds,
        options.nowSimulationSeconds,
      );
      lines.push(`- ${when}：${item.text}`);
    }
    lines.push("");
  }

  lines.push(
    "你只知道这些，不要把传言当事实，也不要编造你没听说的事。",
  );

  return `<around_you>\n${lines.join("\n")}\n</around_you>`;
}

export const FILE_GRIEVANCE_TOOL_INPUT_SCHEMA: Readonly<
  Record<string, unknown>
> = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    category: {
      type: "string",
      enum: [...GRIEVANCE_CATEGORIES],
      description:
        "申诉类别；省略时视为 other。提交后进入舰务申诉队列，由乘客事务部门处理，不是直接命令飞船。",
    },
    summary: {
      type: "string",
      maxLength: PASSENGER_GRIEVANCE_MAX_CHARACTERS,
      description:
        "用一两句话说明你的处境与诉求。这会进入舰务申诉队列、由乘客事务部门处理，不是直接命令飞船。",
    },
  },
});

export const SHARE_RUMOR_TOOL_INPUT_SCHEMA: Readonly<
  Record<string, unknown>
> = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: {
      type: "string",
      maxLength: PASSENGER_RUMOR_MAX_CHARACTERS,
      description:
        "你跟同伴说的话，会在你所在区带流传；可能被别人当真，也可能是错的。",
    },
  },
});
