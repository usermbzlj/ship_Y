/**
 * 关键乘客社会上下文：关系圈观察、区带群体情绪、流传传言与申诉/传言 tool-call。
 * 所有注入 prompt 的认知均为粗糙主观分档，不得当作物理真值。
 *
 * v2：区带邻接扩散 + 确定性士气/压力耦合（不发明舰控）。
 */

import type {
  ConditionBand,
  StressBand,
  TrustBand,
} from "./key-passenger-polling.ts";

export const PASSENGER_SOCIETY_SNAPSHOT_VERSION = 2 as const;
export const FILE_GRIEVANCE_TOOL_NAME = "file_passenger_grievance";
export const SHARE_RUMOR_TOOL_NAME = "share_passenger_rumor";
export const PASSENGER_RUMOR_MAX_RECORDS = 48;
export const PASSENGER_RUMOR_MAX_CHARACTERS = 200;
export const PASSENGER_GRIEVANCE_MAX_CHARACTERS = 240;
export const PASSENGER_CIRCLE_LIMIT = 6;
export const PASSENGER_RUMOR_CONTEXT_LIMIT = 3;
export const PASSENGER_RUMOR_DECAY_SECONDS = 72 * 60 * 60;
/** 传言邻接扩散的仿真时间节拍（秒）。 */
export const PASSENGER_RUMOR_SPREAD_INTERVAL_SECONDS = 3_600;
/** 单条传言最大扩散代数（0=源头）。 */
export const PASSENGER_RUMOR_MAX_SPREAD_GENERATION = 2;
/** 每个节拍每个源头最多 hop 出的邻区副本数。 */
export const PASSENGER_RUMOR_MAX_HOPS_PER_TICK = 1;
/**
 * 邻区 hop 判定阈值：hash%1000 < rate → hop（约 2.5% / 邻区 / 节拍）。
 */
export const PASSENGER_RUMOR_HOP_RATE_PER_MILLE = 25;
/** 单区单节拍压力增量上限（心理学 0..1）。 */
export const PASSENGER_RUMOR_MORALE_STRESS_CAP = 0.015;
export const PASSENGER_RUMOR_MORALE_HEAR_WEIGHT = 0.001;
export const PASSENGER_RUMOR_MORALE_HOSTILE_BONUS = 0.005;

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

export type PassengerRumorTag = "hostile";

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
  /** 0 = 源头区带；每次 hop +1。 */
  spreadGeneration: number;
  /** 最近一次进入当前区带的仿真秒（源头为创建时刻）。 */
  lastZoneHopSimSeconds: number;
  tags: PassengerRumorTag[];
}

export interface PassengerSocietySnapshot {
  snapshotVersion: typeof PASSENGER_SOCIETY_SNAPSHOT_VERSION;
  nextOrdinal: number;
  rumors: PassengerRumor[];
  /** 上次成功执行扩散节拍的仿真秒地板；未执行过为 0。 */
  lastSpreadSimSeconds: number;
  /** 上次成功结算士气耦合的仿真秒地板；未执行过为 0。 */
  lastMoraleSimSeconds: number;
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

export interface ZoneStressDelta {
  zoneId: string;
  stressDelta: number;
}

export interface PassengerSocietyTickResult {
  snapshot: PassengerSocietySnapshot;
  zoneStressDeltas: ZoneStressDelta[];
}

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

const HOSTILE_TEXT_PATTERN =
  /叛变|造反|哗变|恐慌|死亡|死人|饿死|缺粮|断粮|缺氧|窒息|泄漏|溃败|mutiny|revolt|panic|starve|starvation|kill|dead|leak|suffocat/iu;

const SNAPSHOT_KEYS_V2 = [
  "snapshotVersion",
  "nextOrdinal",
  "rumors",
  "lastSpreadSimSeconds",
  "lastMoraleSimSeconds",
] as const;

const SNAPSHOT_KEYS_V1 = [
  "snapshotVersion",
  "nextOrdinal",
  "rumors",
] as const;

const RUMOR_KEYS_V2 = [
  "rumorId",
  "ordinal",
  "originPassengerId",
  "originDisplayName",
  "createdAtSimulationSeconds",
  "zoneId",
  "text",
  "hearCount",
  "spreadGeneration",
  "lastZoneHopSimSeconds",
  "tags",
] as const;

const RUMOR_KEYS_V1 = [
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

/** 确定性粗检：文本含敌意/灾难关键词则打 hostile 标签。 */
export function detectHostileRumorTags(text: string): PassengerRumorTag[] {
  return HOSTILE_TEXT_PATTERN.test(text) ? ["hostile"] : [];
}

export function isHostileRumor(rumor: Pick<PassengerRumor, "tags">): boolean {
  return rumor.tags.includes("hostile");
}

/** djb2；用于 hop 判定，保证同输入同结果。 */
export function deterministicStringHash(input: string): number {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

/**
 * 环向邻接启发式：同环前后舱 + 对环同号（A-01↔B-01）。
 * 当拓扑连接表不可用时使用。
 */
export function ringAdjacentZoneIds(zoneId: string): string[] {
  const match = /^([AB])-(\d{2})$/.exec(zoneId);
  if (!match) {
    return [];
  }
  const ring = match[1] as "A" | "B";
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index) || index < 1 || index > 24) {
    return [];
  }
  const prev = index === 1 ? 24 : index - 1;
  const next = index === 24 ? 1 : index + 1;
  const pad = (value: number) => String(value).padStart(2, "0");
  const otherRing = ring === "A" ? "B" : "A";
  return [
    `${ring}-${pad(prev)}`,
    `${ring}-${pad(next)}`,
    `${otherRing}-${pad(index)}`,
  ];
}

export function adjacentZoneIdsFromConnections(
  connections: ReadonlyArray<{ zoneAId: string; zoneBId: string }>,
  zoneId: string,
): string[] {
  const neighbors = new Set<string>();
  for (const connection of connections) {
    if (connection.zoneAId === zoneId) {
      neighbors.add(connection.zoneBId);
    } else if (connection.zoneBId === zoneId) {
      neighbors.add(connection.zoneAId);
    }
  }
  return [...neighbors].sort((left, right) => left.localeCompare(right));
}

export function resolveAdjacentZoneIds(
  zoneId: string,
  connections?: ReadonlyArray<{ zoneAId: string; zoneBId: string }>,
): string[] {
  if (connections && connections.length > 0) {
    const fromTopology = adjacentZoneIdsFromConnections(connections, zoneId);
    if (fromTopology.length > 0) {
      return fromTopology;
    }
  }
  return ringAdjacentZoneIds(zoneId);
}

function validateTags(value: unknown): PassengerRumorTag[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const tags: PassengerRumorTag[] = [];
  for (const entry of value) {
    if (entry !== "hostile") {
      return null;
    }
    if (!tags.includes(entry)) {
      tags.push(entry);
    }
  }
  return tags;
}

function validateRumorV2(value: unknown): PassengerRumor | null {
  if (!isRecord(value) || !hasExactKeys(value, RUMOR_KEYS_V2)) {
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
    spreadGeneration,
    lastZoneHopSimSeconds,
    tags: rawTags,
  } = value;
  const tags = validateTags(rawTags);
  if (
    tags === null ||
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
    hearCount < 0 ||
    typeof spreadGeneration !== "number" ||
    !Number.isSafeInteger(spreadGeneration) ||
    spreadGeneration < 0 ||
    spreadGeneration > PASSENGER_RUMOR_MAX_SPREAD_GENERATION ||
    typeof lastZoneHopSimSeconds !== "number" ||
    !Number.isFinite(lastZoneHopSimSeconds) ||
    lastZoneHopSimSeconds < 0
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
    spreadGeneration,
    lastZoneHopSimSeconds,
    tags,
  };
}

function validateRumorV1(value: unknown): PassengerRumor | null {
  if (!isRecord(value) || !hasExactKeys(value, RUMOR_KEYS_V1)) {
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
    spreadGeneration: 0,
    lastZoneHopSimSeconds: createdAtSimulationSeconds,
    tags: detectHostileRumorTags(text),
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

function floorSpreadTick(simulationSeconds: number): number {
  return (
    Math.floor(simulationSeconds / PASSENGER_RUMOR_SPREAD_INTERVAL_SECONDS) *
    PASSENGER_RUMOR_SPREAD_INTERVAL_SECONDS
  );
}

function shouldHopToZone(
  rumor: PassengerRumor,
  targetZoneId: string,
  tickFloor: number,
): boolean {
  const hash = deterministicStringHash(
    `${rumor.rumorId}|${targetZoneId}|${tickFloor}`,
  );
  return hash % 1_000 < PASSENGER_RUMOR_HOP_RATE_PER_MILLE;
}

function rumorStressContribution(rumor: PassengerRumor): number {
  const hearPart = rumor.hearCount * PASSENGER_RUMOR_MORALE_HEAR_WEIGHT;
  const hostilePart = isHostileRumor(rumor)
    ? PASSENGER_RUMOR_MORALE_HOSTILE_BONUS
    : 0;
  return Math.min(
    PASSENGER_RUMOR_MORALE_STRESS_CAP,
    hearPart + hostilePart,
  );
}

export function createPassengerSocietySnapshot(): PassengerSocietySnapshot {
  return {
    snapshotVersion: PASSENGER_SOCIETY_SNAPSHOT_VERSION,
    nextOrdinal: 1,
    rumors: [],
    lastSpreadSimSeconds: 0,
    lastMoraleSimSeconds: 0,
  };
}

export function validatePassengerSocietySnapshot(
  value: unknown,
): PassengerSocietySnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const version = value.snapshotVersion;
  if (version !== 1 && version !== 2) {
    return null;
  }

  if (version === 1) {
    if (!hasExactKeys(value, SNAPSHOT_KEYS_V1)) {
      return null;
    }
  } else if (!hasExactKeys(value, SNAPSHOT_KEYS_V2)) {
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
    const rumor =
      version === 1 ? validateRumorV1(rawRumor) : validateRumorV2(rawRumor);
    if (rumor === null || rumor.ordinal <= previousOrdinal) {
      return null;
    }
    if (rumor.ordinal >= nextOrdinal) {
      return null;
    }
    previousOrdinal = rumor.ordinal;
    rumors.push(rumor);
  }

  const lastSpreadSimSeconds =
    version === 2 ? value.lastSpreadSimSeconds : 0;
  const lastMoraleSimSeconds =
    version === 2 ? value.lastMoraleSimSeconds : 0;
  if (
    typeof lastSpreadSimSeconds !== "number" ||
    !Number.isFinite(lastSpreadSimSeconds) ||
    lastSpreadSimSeconds < 0 ||
    typeof lastMoraleSimSeconds !== "number" ||
    !Number.isFinite(lastMoraleSimSeconds) ||
    lastMoraleSimSeconds < 0
  ) {
    return null;
  }

  return clone({
    snapshotVersion: PASSENGER_SOCIETY_SNAPSHOT_VERSION,
    nextOrdinal,
    rumors,
    lastSpreadSimSeconds,
    lastMoraleSimSeconds,
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
  const text = truncate(trimmed, PASSENGER_RUMOR_MAX_CHARACTERS);
  const rumor: PassengerRumor = {
    rumorId: `rumor-${ordinal}`,
    ordinal,
    originPassengerId: input.originPassengerId,
    originDisplayName: input.originDisplayName,
    createdAtSimulationSeconds: input.simulationSeconds,
    zoneId: input.zoneId,
    text,
    hearCount: 0,
    spreadGeneration: 0,
    lastZoneHopSimSeconds: input.simulationSeconds,
    tags: detectHostileRumorTags(text),
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
      lastSpreadSimSeconds: snapshot.lastSpreadSimSeconds,
      lastMoraleSimSeconds: snapshot.lastMoraleSimSeconds,
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
    lastSpreadSimSeconds: snapshot.lastSpreadSimSeconds,
    lastMoraleSimSeconds: snapshot.lastMoraleSimSeconds,
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
    lastSpreadSimSeconds: snapshot.lastSpreadSimSeconds,
    lastMoraleSimSeconds: snapshot.lastMoraleSimSeconds,
  };
}

/**
 * 在扩散节拍上尝试向邻区泄漏传言副本（仍标 未经证实，由 prompt 渲染）。
 * 低概率、有代数/每拍上限；可重复调用（同 tickFloor 幂等）。
 */
export function spreadRumorsToAdjacentZones(
  snapshot: PassengerSocietySnapshot,
  context: {
    simulationSeconds: number;
    adjacentZones: (zoneId: string) => readonly string[];
  },
): PassengerSocietySnapshot {
  const tickFloor = floorSpreadTick(context.simulationSeconds);
  if (tickFloor <= 0 || tickFloor <= snapshot.lastSpreadSimSeconds) {
    return clone(snapshot);
  }

  let nextOrdinal = snapshot.nextOrdinal;
  const rumors = [...snapshot.rumors];
  const existingKeys = new Set(
    rumors.map((rumor) => `${rumor.text}\0${rumor.zoneId}`),
  );

  // 稳定顺序：按 ordinal 升序处理源头。
  const sources = [...rumors]
    .filter(
      (rumor) =>
        rumor.spreadGeneration < PASSENGER_RUMOR_MAX_SPREAD_GENERATION &&
        context.simulationSeconds - rumor.createdAtSimulationSeconds <=
          PASSENGER_RUMOR_DECAY_SECONDS,
    )
    .sort((left, right) => left.ordinal - right.ordinal);

  for (const source of sources) {
    if (rumors.length >= PASSENGER_RUMOR_MAX_RECORDS) {
      break;
    }
    const neighbors = [...context.adjacentZones(source.zoneId)].sort(
      (left, right) => left.localeCompare(right),
    );
    let hops = 0;
    for (const neighbor of neighbors) {
      if (hops >= PASSENGER_RUMOR_MAX_HOPS_PER_TICK) {
        break;
      }
      if (rumors.length >= PASSENGER_RUMOR_MAX_RECORDS) {
        break;
      }
      const key = `${source.text}\0${neighbor}`;
      if (existingKeys.has(key)) {
        continue;
      }
      if (!shouldHopToZone(source, neighbor, tickFloor)) {
        continue;
      }
      const ordinal = nextOrdinal;
      nextOrdinal += 1;
      const copy: PassengerRumor = {
        rumorId: `rumor-${ordinal}`,
        ordinal,
        originPassengerId: source.originPassengerId,
        originDisplayName: source.originDisplayName,
        createdAtSimulationSeconds: source.createdAtSimulationSeconds,
        zoneId: neighbor,
        text: source.text,
        hearCount: 0,
        spreadGeneration: source.spreadGeneration + 1,
        lastZoneHopSimSeconds: tickFloor,
        tags: [...source.tags],
      };
      rumors.push(copy);
      existingKeys.add(key);
      hops += 1;
    }
  }

  while (rumors.length > PASSENGER_RUMOR_MAX_RECORDS) {
    rumors.shift();
  }

  return {
    snapshotVersion: PASSENGER_SOCIETY_SNAPSHOT_VERSION,
    nextOrdinal,
    rumors,
    lastSpreadSimSeconds: tickFloor,
    lastMoraleSimSeconds: snapshot.lastMoraleSimSeconds,
  };
}

/**
 * 按区汇总谣言压力增量；有界、确定性。高 hearCount / hostile 抬升。
 * 与扩散共用节拍地板；同 tick 已结算则返回空。
 */
export function computeRumorMoraleStressDeltas(
  snapshot: PassengerSocietySnapshot,
  context: { simulationSeconds: number },
): { snapshot: PassengerSocietySnapshot; zoneStressDeltas: ZoneStressDelta[] } {
  const tickFloor = floorSpreadTick(context.simulationSeconds);
  if (tickFloor <= 0 || tickFloor <= snapshot.lastMoraleSimSeconds) {
    return { snapshot: clone(snapshot), zoneStressDeltas: [] };
  }

  const byZone = new Map<string, number>();
  for (const rumor of snapshot.rumors) {
    const age =
      context.simulationSeconds - rumor.createdAtSimulationSeconds;
    if (age > PASSENGER_RUMOR_DECAY_SECONDS) {
      continue;
    }
    // 未传播、低听见且非敌意：不扰动。
    const contribution = rumorStressContribution(rumor);
    if (contribution <= 0) {
      continue;
    }
    // 至少要有听见或敌意标签才耦合压力。
    if (rumor.hearCount < 1 && !isHostileRumor(rumor)) {
      continue;
    }
    const previous = byZone.get(rumor.zoneId) ?? 0;
    byZone.set(
      rumor.zoneId,
      Math.min(PASSENGER_RUMOR_MORALE_STRESS_CAP, previous + contribution),
    );
  }

  const zoneStressDeltas = [...byZone.entries()]
    .filter(([, stressDelta]) => stressDelta > 0)
    .map(([zoneId, stressDelta]) => ({ zoneId, stressDelta }))
    .sort((left, right) => left.zoneId.localeCompare(right.zoneId));

  return {
    snapshot: {
      snapshotVersion: PASSENGER_SOCIETY_SNAPSHOT_VERSION,
      nextOrdinal: snapshot.nextOrdinal,
      rumors: snapshot.rumors.map((rumor) => clone(rumor)),
      lastSpreadSimSeconds: snapshot.lastSpreadSimSeconds,
      lastMoraleSimSeconds: tickFloor,
    },
    zoneStressDeltas,
  };
}

/**
 * prune → spread → morale 一拍；供 prune tick / worker step 边界复用。
 */
export function tickPassengerSociety(
  snapshot: PassengerSocietySnapshot,
  context: {
    simulationSeconds: number;
    adjacentZones: (zoneId: string) => readonly string[];
  },
): PassengerSocietyTickResult {
  const pruned = pruneStaleRumors(snapshot, context);
  const spread = spreadRumorsToAdjacentZones(pruned, context);
  const morale = computeRumorMoraleStressDeltas(spread, context);
  return {
    snapshot: morale.snapshot,
    zoneStressDeltas: morale.zoneStressDeltas,
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
