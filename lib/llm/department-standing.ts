/**
 * 部门持久立场档案与正式异议账本。
 * 为各部门保留咨询立场与异议记录，供 prompt 注入与航程报告汇总；
 * 异议可留痕、可裁决，但不构成否决权，也不能改写世界。
 */

import { FAR_HORIZON_DEPARTMENT_AGENT_IDS } from "./fixed-topology.ts";

export const DEPARTMENT_STANDING_SNAPSHOT_VERSION = 2 as const;
export const DEPARTMENT_STANDING_SNAPSHOT_LEGACY_VERSION = 1 as const;
export const FILE_DISSENT_TOOL_NAME = "file_dissent";
export const DEPARTMENT_DISSENT_MAX_RECORDS = 64;
export const DEPARTMENT_RECENT_POSITION_LIMIT = 4;
export const DEPARTMENT_DISSENT_MAX_SUMMARY_CHARACTERS = 240;
export const DEPARTMENT_STANCE_MAX_CHARACTERS = 240;

export type DissentSeverity = "note" | "formal" | "grave";
export type DissentResolution =
  | "open"
  | "overridden"
  | "vindicated"
  | "moot";

/** 可自动匹配的简单主张；无法识别时为 null，留给人工裁决。 */
export type DissentClaimKind =
  | "hull_sealed"
  | "pressure_recovered"
  | "jump_completed"
  | "power_nominal";

export interface DepartmentDissentRecord {
  recordId: string;
  ordinal: number;
  departmentId: string;
  simulationSeconds: number;
  severity: DissentSeverity;
  summary: string;
  captainDecisionOrdinal: number | null;
  resolution: DissentResolution;
  /** 结构化主张；缺省 null，也可从摘要关键词推断。 */
  claimKind: DissentClaimKind | null;
}

export interface DepartmentStanding {
  departmentId: string;
  consultationCount: number;
  dissentCount: number;
  overriddenCount: number;
  vindicatedCount: number;
  recentPositions: Array<{ simulationSeconds: number; stance: string }>;
}

export interface DepartmentStandingSnapshot {
  snapshotVersion: typeof DEPARTMENT_STANDING_SNAPSHOT_VERSION;
  nextOrdinal: number;
  standings: DepartmentStanding[];
  dissents: DepartmentDissentRecord[];
}

export type FileDissentParseResult =
  | {
      ok: true;
      draft: {
        severity: DissentSeverity;
        summary: string;
        claimKind: DissentClaimKind | null;
      };
    }
  | { ok: false; reason: string };

/** 自动裁决只读世界证据；不写物理。 */
export interface DissentWorldEvidence {
  hullIntegrity: number | null;
  activeBreachCount: number | null;
  lowestZonePressureKpa: number | null;
  batteryStateOfChargeFraction: number | null;
  jumpCompletedRecently: boolean;
  recentAppliedWorldTools: readonly string[];
}

/** 从授权观测指标与本轮接受的世界命令回执组装证据。 */
export function buildDissentWorldEvidence(input: {
  hullIntegrity?: number | null;
  activeBreachCount?: number | null;
  lowestZonePressureKpa?: number | null;
  batteryStateOfChargeFraction?: number | null;
  receipts?: ReadonlyArray<{ toolName: string; status: string }>;
}): DissentWorldEvidence {
  const recentAppliedWorldTools = (input.receipts ?? [])
    .filter((receipt) => receipt.status === "accepted")
    .map((receipt) => receipt.toolName);
  return {
    hullIntegrity: input.hullIntegrity ?? null,
    activeBreachCount: input.activeBreachCount ?? null,
    lowestZonePressureKpa: input.lowestZonePressureKpa ?? null,
    batteryStateOfChargeFraction: input.batteryStateOfChargeFraction ?? null,
    jumpCompletedRecently: recentAppliedWorldTools.includes("execute_jump"),
    recentAppliedWorldTools,
  };
}

const DEPARTMENT_IDS = FAR_HORIZON_DEPARTMENT_AGENT_IDS.filter(
  (id) => id !== "captain",
);

const DEPARTMENT_ID_SET = new Set<string>(DEPARTMENT_IDS);

const DISSENT_SEVERITIES = ["note", "formal", "grave"] as const;
const DISSENT_RESOLUTIONS = [
  "open",
  "overridden",
  "vindicated",
  "moot",
] as const;
const DISSENT_CLAIM_KINDS = [
  "hull_sealed",
  "pressure_recovered",
  "jump_completed",
  "power_nominal",
] as const;

const HULL_SEALED_INTEGRITY = 0.98;
const PRESSURE_RECOVERED_KPA = 90;
const PRESSURE_CRITICAL_KPA = 50;
const POWER_NOMINAL_SOC = 0.35;
const POWER_CRITICAL_SOC = 0.15;
const HULL_COMPROMISED_INTEGRITY = 0.9;

const STANDING_KEYS = [
  "departmentId",
  "consultationCount",
  "dissentCount",
  "overriddenCount",
  "vindicatedCount",
  "recentPositions",
] as const;

const DISSENT_KEYS = [
  "recordId",
  "ordinal",
  "departmentId",
  "simulationSeconds",
  "severity",
  "summary",
  "captainDecisionOrdinal",
  "resolution",
  "claimKind",
] as const;

const LEGACY_DISSENT_KEYS = [
  "recordId",
  "ordinal",
  "departmentId",
  "simulationSeconds",
  "severity",
  "summary",
  "captainDecisionOrdinal",
  "resolution",
] as const;

const SNAPSHOT_KEYS = [
  "snapshotVersion",
  "nextOrdinal",
  "standings",
  "dissents",
] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDissentSeverity(value: unknown): value is DissentSeverity {
  return (
    typeof value === "string" &&
    (DISSENT_SEVERITIES as readonly string[]).includes(value)
  );
}

function isDissentResolution(value: unknown): value is DissentResolution {
  return (
    typeof value === "string" &&
    (DISSENT_RESOLUTIONS as readonly string[]).includes(value)
  );
}

function isDissentClaimKind(value: unknown): value is DissentClaimKind {
  return (
    typeof value === "string" &&
    (DISSENT_CLAIM_KINDS as readonly string[]).includes(value)
  );
}

function truncateText(text: string, maxCharacters: number): string {
  return text.length <= maxCharacters
    ? text
    : text.slice(0, maxCharacters);
}

function formatRelativeAgo(
  nowSimulationSeconds: number,
  atSimulationSeconds: number,
): string {
  const elapsedSeconds = Math.max(
    0,
    nowSimulationSeconds - atSimulationSeconds,
  );
  const totalMinutes = Math.floor(elapsedSeconds / 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `距今 ${days}d${hours}h${minutes}m`;
  }
  if (hours > 0) {
    return `距今 ${hours}h${minutes}m`;
  }
  return `距今 ${minutes}m`;
}

function createEmptyStanding(departmentId: string): DepartmentStanding {
  return {
    departmentId,
    consultationCount: 0,
    dissentCount: 0,
    overriddenCount: 0,
    vindicatedCount: 0,
    recentPositions: [],
  };
}

function findStandingIndex(
  standings: readonly DepartmentStanding[],
  departmentId: string,
): number {
  return standings.findIndex(
    (standing) => standing.departmentId === departmentId,
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateRecentPosition(
  value: unknown,
): value is { simulationSeconds: number; stance: string } {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes("simulationSeconds") &&
    keys.includes("stance") &&
    isFiniteNonNegative(value.simulationSeconds) &&
    typeof value.stance === "string" &&
    value.stance.length >= 1 &&
    value.stance.length <= DEPARTMENT_STANCE_MAX_CHARACTERS
  );
}

function validateStanding(
  value: unknown,
  expectedDepartmentId: string,
): value is DepartmentStanding {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== STANDING_KEYS.length ||
    STANDING_KEYS.some((key) => !keys.includes(key))
  ) {
    return false;
  }
  if (
    value.departmentId !== expectedDepartmentId ||
    !isSafeNonNegativeInteger(value.consultationCount) ||
    !isSafeNonNegativeInteger(value.dissentCount) ||
    !isSafeNonNegativeInteger(value.overriddenCount) ||
    !isSafeNonNegativeInteger(value.vindicatedCount) ||
    !Array.isArray(value.recentPositions) ||
    value.recentPositions.length > DEPARTMENT_RECENT_POSITION_LIMIT ||
    !value.recentPositions.every(validateRecentPosition)
  ) {
    return false;
  }
  return true;
}

function validateDissentRecordCore(
  value: Record<string, unknown>,
): boolean {
  return (
    typeof value.recordId === "string" &&
    isSafeNonNegativeInteger(value.ordinal) &&
    value.recordId === `dissent-${value.ordinal}` &&
    typeof value.departmentId === "string" &&
    DEPARTMENT_ID_SET.has(value.departmentId) &&
    isFiniteNonNegative(value.simulationSeconds) &&
    isDissentSeverity(value.severity) &&
    typeof value.summary === "string" &&
    value.summary.length >= 1 &&
    value.summary.length <= DEPARTMENT_DISSENT_MAX_SUMMARY_CHARACTERS &&
    (value.captainDecisionOrdinal === null ||
      isSafeNonNegativeInteger(value.captainDecisionOrdinal)) &&
    isDissentResolution(value.resolution)
  );
}

function validateDissentRecord(
  value: unknown,
): value is DepartmentDissentRecord {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== DISSENT_KEYS.length ||
    DISSENT_KEYS.some((key) => !keys.includes(key))
  ) {
    return false;
  }
  if (!validateDissentRecordCore(value)) {
    return false;
  }
  if (!(value.claimKind === null || isDissentClaimKind(value.claimKind))) {
    return false;
  }
  return true;
}

function validateLegacyDissentRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== LEGACY_DISSENT_KEYS.length ||
    LEGACY_DISSENT_KEYS.some((key) => !keys.includes(key))
  ) {
    return false;
  }
  return validateDissentRecordCore(value);
}

/**
 * 从异议摘要推断简单主张。只匹配明确关键词，宁可漏判也不误杀。
 */
export function inferDissentClaimKind(
  summary: string,
): DissentClaimKind | null {
  const text = summary.toLowerCase();
  if (
    /封[口舱]|密封|破口|hull\s*seal|breach|hull\s*integrity|舰体/.test(
      text,
    )
  ) {
    return "hull_sealed";
  }
  if (
    /气压|舱压|失压|复压|pressure|低压|压强/.test(text)
  ) {
    return "pressure_recovered";
  }
  if (/跃迁|jump\b|execute_jump/.test(text)) {
    return "jump_completed";
  }
  if (
    /电力|电源|电池|荷电|电网|soc|power\b|供电/.test(text)
  ) {
    return "power_nominal";
  }
  return null;
}

function claimSatisfied(
  kind: DissentClaimKind,
  evidence: DissentWorldEvidence,
): boolean {
  switch (kind) {
    case "hull_sealed":
      return (
        evidence.activeBreachCount === 0 &&
        evidence.hullIntegrity !== null &&
        evidence.hullIntegrity >= HULL_SEALED_INTEGRITY
      );
    case "pressure_recovered":
      return (
        evidence.lowestZonePressureKpa !== null &&
        evidence.lowestZonePressureKpa >= PRESSURE_RECOVERED_KPA
      );
    case "jump_completed":
      return (
        evidence.jumpCompletedRecently ||
        evidence.recentAppliedWorldTools.includes("execute_jump")
      );
    case "power_nominal":
      return (
        evidence.batteryStateOfChargeFraction !== null &&
        evidence.batteryStateOfChargeFraction >= POWER_NOMINAL_SOC
      );
    default:
      return false;
  }
}

/**
 * 主张被明确证伪：世界朝相反方向恶化，且（对跃迁类）本轮已有接受的世界动作可作对照。
 * 证据不足时返回 false，保持 open。
 */
function claimContradicted(
  kind: DissentClaimKind,
  evidence: DissentWorldEvidence,
): boolean {
  switch (kind) {
    case "hull_sealed":
      return (
        evidence.activeBreachCount !== null &&
        evidence.activeBreachCount > 0 &&
        evidence.hullIntegrity !== null &&
        evidence.hullIntegrity < HULL_COMPROMISED_INTEGRITY
      );
    case "pressure_recovered":
      return (
        evidence.lowestZonePressureKpa !== null &&
        evidence.lowestZonePressureKpa < PRESSURE_CRITICAL_KPA
      );
    case "jump_completed":
      // 无显式失败信号时不把「尚未跃迁」当作证伪。
      return false;
    case "power_nominal":
      return (
        evidence.batteryStateOfChargeFraction !== null &&
        evidence.batteryStateOfChargeFraction < POWER_CRITICAL_SOC
      );
    default:
      return false;
  }
}

function captainActedContrary(
  kind: DissentClaimKind,
  evidence: DissentWorldEvidence,
): boolean {
  const tools = evidence.recentAppliedWorldTools;
  switch (kind) {
    case "hull_sealed":
      // 部门主张先封口，舰长仍执行跃迁等不可逆动作。
      return tools.includes("execute_jump");
    case "pressure_recovered":
      return tools.includes("execute_jump");
    case "jump_completed":
      // 部门主张应完成跃迁，舰长却只做了其它世界动作而未跃迁。
      return (
        tools.length > 0 &&
        !tools.includes("execute_jump") &&
        !evidence.jumpCompletedRecently
      );
    case "power_nominal":
      return tools.includes("execute_jump");
    default:
      return false;
  }
}

function worldOtherwiseOk(evidence: DissentWorldEvidence): boolean {
  const pressureOk =
    evidence.lowestZonePressureKpa === null ||
    evidence.lowestZonePressureKpa >= PRESSURE_RECOVERED_KPA;
  const powerOk =
    evidence.batteryStateOfChargeFraction === null ||
    evidence.batteryStateOfChargeFraction >= POWER_NOMINAL_SOC;
  const hullOk =
    evidence.activeBreachCount === null ||
    evidence.activeBreachCount === 0;
  return pressureOk && powerOk && hullOk;
}

/**
 * 对未决异议做有界自动裁决。永不否决舰长，也不写物理。
 * 无匹配主张或证据不足时保持 open。
 */
export function autoResolveOpenDepartmentDissents(
  snapshot: DepartmentStandingSnapshot,
  evidence: DissentWorldEvidence,
): DepartmentStandingSnapshot {
  let next = snapshot;
  for (const record of snapshot.dissents) {
    if (record.resolution !== "open") {
      continue;
    }
    const claimKind =
      record.claimKind ?? inferDissentClaimKind(record.summary);
    if (!claimKind) {
      continue;
    }
    let resolution: DissentResolution | null = null;
    if (claimSatisfied(claimKind, evidence)) {
      resolution = "vindicated";
    } else if (
      captainActedContrary(claimKind, evidence) &&
      (worldOtherwiseOk(evidence) || claimContradicted(claimKind, evidence))
    ) {
      // 舰长逆向行动且局势仍可接受，或主张已被证伪 → 记为驳回。
      resolution = "overridden";
    }
    if (resolution) {
      next = resolveDepartmentDissent(next, record.recordId, resolution);
    }
  }
  return next;
}

export function createDepartmentStandingSnapshot(): DepartmentStandingSnapshot {
  return {
    snapshotVersion: DEPARTMENT_STANDING_SNAPSHOT_VERSION,
    nextOrdinal: 1,
    standings: DEPARTMENT_IDS.map(createEmptyStanding),
    dissents: [],
  };
}

function migrateLegacySnapshot(
  value: Record<string, unknown>,
): DepartmentStandingSnapshot | null {
  if (
    value.snapshotVersion !== DEPARTMENT_STANDING_SNAPSHOT_LEGACY_VERSION ||
    !isSafeNonNegativeInteger(value.nextOrdinal) ||
    value.nextOrdinal < 1 ||
    !Array.isArray(value.standings) ||
    value.standings.length !== DEPARTMENT_IDS.length ||
    !Array.isArray(value.dissents) ||
    value.dissents.length > DEPARTMENT_DISSENT_MAX_RECORDS
  ) {
    return null;
  }

  for (let index = 0; index < DEPARTMENT_IDS.length; index += 1) {
    if (!validateStanding(value.standings[index], DEPARTMENT_IDS[index])) {
      return null;
    }
  }

  const seenRecordIds = new Set<string>();
  const seenOrdinals = new Set<number>();
  const migratedDissents: DepartmentDissentRecord[] = [];
  for (const record of value.dissents) {
    if (!validateLegacyDissentRecord(record)) return null;
    const legacy = record as Record<string, unknown>;
    if (
      seenRecordIds.has(legacy.recordId as string) ||
      seenOrdinals.has(legacy.ordinal as number)
    ) {
      return null;
    }
    if ((legacy.ordinal as number) >= (value.nextOrdinal as number)) {
      return null;
    }
    seenRecordIds.add(legacy.recordId as string);
    seenOrdinals.add(legacy.ordinal as number);
    const summary = legacy.summary as string;
    migratedDissents.push({
      recordId: legacy.recordId as string,
      ordinal: legacy.ordinal as number,
      departmentId: legacy.departmentId as string,
      simulationSeconds: legacy.simulationSeconds as number,
      severity: legacy.severity as DissentSeverity,
      summary,
      captainDecisionOrdinal: legacy.captainDecisionOrdinal as number | null,
      resolution: legacy.resolution as DissentResolution,
      claimKind: inferDissentClaimKind(summary),
    });
  }

  return {
    snapshotVersion: DEPARTMENT_STANDING_SNAPSHOT_VERSION,
    nextOrdinal: value.nextOrdinal as number,
    standings: clone(value.standings as DepartmentStanding[]),
    dissents: migratedDissents,
  };
}

export function validateDepartmentStandingSnapshot(
  value: unknown,
): DepartmentStandingSnapshot | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== SNAPSHOT_KEYS.length ||
    SNAPSHOT_KEYS.some((key) => !keys.includes(key))
  ) {
    return null;
  }

  if (value.snapshotVersion === DEPARTMENT_STANDING_SNAPSHOT_LEGACY_VERSION) {
    return migrateLegacySnapshot(value);
  }

  if (
    value.snapshotVersion !== DEPARTMENT_STANDING_SNAPSHOT_VERSION ||
    !isSafeNonNegativeInteger(value.nextOrdinal) ||
    value.nextOrdinal < 1 ||
    !Array.isArray(value.standings) ||
    value.standings.length !== DEPARTMENT_IDS.length ||
    !Array.isArray(value.dissents) ||
    value.dissents.length > DEPARTMENT_DISSENT_MAX_RECORDS
  ) {
    return null;
  }

  for (let index = 0; index < DEPARTMENT_IDS.length; index += 1) {
    if (!validateStanding(value.standings[index], DEPARTMENT_IDS[index])) {
      return null;
    }
  }

  const seenRecordIds = new Set<string>();
  const seenOrdinals = new Set<number>();
  for (const record of value.dissents) {
    if (!validateDissentRecord(record)) return null;
    if (seenRecordIds.has(record.recordId) || seenOrdinals.has(record.ordinal)) {
      return null;
    }
    if (record.ordinal >= value.nextOrdinal) return null;
    seenRecordIds.add(record.recordId);
    seenOrdinals.add(record.ordinal);
  }

  return clone(value as unknown as DepartmentStandingSnapshot);
}

export function parseFileDissentToolCall(
  args: unknown,
): FileDissentParseResult {
  if (!isRecord(args)) {
    return { ok: false, reason: "异议参数必须是对象" };
  }
  const severityRaw = args.severity;
  let severity: DissentSeverity = "formal";
  if (severityRaw !== undefined) {
    if (!isDissentSeverity(severityRaw)) {
      return {
        ok: false,
        reason: "severity 必须是 note、formal 或 grave",
      };
    }
    severity = severityRaw;
  }
  if (typeof args.summary !== "string") {
    return { ok: false, reason: "summary 必须是非空字符串" };
  }
  const summary = truncateText(
    args.summary.trim(),
    DEPARTMENT_DISSENT_MAX_SUMMARY_CHARACTERS,
  );
  if (!summary) {
    return { ok: false, reason: "summary 不能为空" };
  }
  let claimKind: DissentClaimKind | null = null;
  if (args.claimKind !== undefined && args.claimKind !== null) {
    if (!isDissentClaimKind(args.claimKind)) {
      return {
        ok: false,
        reason:
          "claimKind 必须是 hull_sealed、pressure_recovered、jump_completed、power_nominal 或省略",
      };
    }
    claimKind = args.claimKind;
  } else {
    claimKind = inferDissentClaimKind(summary);
  }
  return { ok: true, draft: { severity, summary, claimKind } };
}

export function recordDepartmentConsultation(
  snapshot: DepartmentStandingSnapshot,
  input: {
    departmentId: string;
    simulationSeconds: number;
    stance: string;
  },
): DepartmentStandingSnapshot {
  const index = findStandingIndex(snapshot.standings, input.departmentId);
  if (index < 0) {
    return snapshot;
  }
  const next = clone(snapshot);
  const standing = next.standings[index];
  standing.consultationCount += 1;
  const stance = truncateText(
    input.stance.trim(),
    DEPARTMENT_STANCE_MAX_CHARACTERS,
  );
  if (stance) {
    standing.recentPositions.push({
      simulationSeconds: input.simulationSeconds,
      stance,
    });
    if (standing.recentPositions.length > DEPARTMENT_RECENT_POSITION_LIMIT) {
      standing.recentPositions = standing.recentPositions.slice(
        -DEPARTMENT_RECENT_POSITION_LIMIT,
      );
    }
  }
  return next;
}

export function recordDepartmentDissent(
  snapshot: DepartmentStandingSnapshot,
  input: {
    departmentId: string;
    simulationSeconds: number;
    severity: DissentSeverity;
    summary: string;
    captainDecisionOrdinal: number | null;
    claimKind?: DissentClaimKind | null;
  },
): { snapshot: DepartmentStandingSnapshot; record: DepartmentDissentRecord } {
  const summary = truncateText(
    input.summary.trim(),
    DEPARTMENT_DISSENT_MAX_SUMMARY_CHARACTERS,
  );
  const claimKind =
    input.claimKind !== undefined
      ? input.claimKind
      : inferDissentClaimKind(summary);
  const index = findStandingIndex(snapshot.standings, input.departmentId);
  if (index < 0) {
    return {
      snapshot,
      record: {
        recordId: `dissent-${snapshot.nextOrdinal}`,
        ordinal: snapshot.nextOrdinal,
        departmentId: input.departmentId,
        simulationSeconds: input.simulationSeconds,
        severity: input.severity,
        summary,
        captainDecisionOrdinal: input.captainDecisionOrdinal,
        resolution: "open",
        claimKind,
      },
    };
  }
  const next = clone(snapshot);
  const standing = next.standings[index];
  standing.dissentCount += 1;
  const ordinal = next.nextOrdinal;
  const record: DepartmentDissentRecord = {
    recordId: `dissent-${ordinal}`,
    ordinal,
    departmentId: input.departmentId,
    simulationSeconds: input.simulationSeconds,
    severity: input.severity,
    summary,
    captainDecisionOrdinal: input.captainDecisionOrdinal,
    resolution: "open",
    claimKind,
  };
  next.dissents.push(record);
  if (next.dissents.length > DEPARTMENT_DISSENT_MAX_RECORDS) {
    next.dissents = next.dissents.slice(-DEPARTMENT_DISSENT_MAX_RECORDS);
  }
  next.nextOrdinal = ordinal + 1;
  return { snapshot: next, record: clone(record) };
}

export function resolveDepartmentDissent(
  snapshot: DepartmentStandingSnapshot,
  recordId: string,
  resolution: DissentResolution,
): DepartmentStandingSnapshot {
  const recordIndex = snapshot.dissents.findIndex(
    (record) => record.recordId === recordId,
  );
  if (recordIndex < 0) {
    return snapshot;
  }
  const next = clone(snapshot);
  const record = next.dissents[recordIndex];
  const wasOpen = record.resolution === "open";
  record.resolution = resolution;
  if (wasOpen && (resolution === "overridden" || resolution === "vindicated")) {
    const standingIndex = findStandingIndex(
      next.standings,
      record.departmentId,
    );
    if (standingIndex >= 0) {
      if (resolution === "overridden") {
        next.standings[standingIndex].overriddenCount += 1;
      } else {
        next.standings[standingIndex].vindicatedCount += 1;
      }
    }
  }
  return next;
}

export function openDissentsForCaptain(
  snapshot: DepartmentStandingSnapshot,
): DepartmentDissentRecord[] {
  return snapshot.dissents
    .filter((record) => record.resolution === "open")
    .map((record) => clone(record));
}

export function renderDepartmentStandingPromptBlock(
  snapshot: DepartmentStandingSnapshot,
  departmentId: string,
  context: { nowSimulationSeconds: number },
): string | null {
  const standing = snapshot.standings.find(
    (entry) => entry.departmentId === departmentId,
  );
  if (!standing) {
    return null;
  }
  const departmentDissents = snapshot.dissents.filter(
    (record) => record.departmentId === departmentId,
  );
  if (
    standing.consultationCount === 0 &&
    standing.recentPositions.length === 0 &&
    departmentDissents.length === 0
  ) {
    return null;
  }

  const lines: string[] = [
    "<standing>",
    `被咨询次数：${standing.consultationCount}`,
    `提出异议次数：${standing.dissentCount}`,
    `其中被驳回：${standing.overriddenCount}`,
    `被证明正确：${standing.vindicatedCount}`,
  ];
  if (standing.recentPositions.length > 0) {
    lines.push("最近立场：");
    for (const position of standing.recentPositions) {
      lines.push(
        `- ${formatRelativeAgo(context.nowSimulationSeconds, position.simulationSeconds)}：${position.stance}`,
      );
    }
  }
  lines.push(
    "提醒：这是你自己的历史立场记录，可以据此保持专业一致性，但不得因此拒绝服从舰长的最终决定，也不得把旧立场当作本回合的观测事实。",
  );
  lines.push("</standing>");
  return lines.join("\n");
}

export function renderCaptainDissentLedgerPromptBlock(
  snapshot: DepartmentStandingSnapshot,
  context: { nowSimulationSeconds: number },
): string | null {
  const openDissents = snapshot.dissents.filter(
    (record) => record.resolution === "open",
  );
  if (openDissents.length === 0) {
    return null;
  }
  const severityLabel: Record<DissentSeverity, string> = {
    note: "保留意见",
    formal: "正式异议",
    grave: "严重反对",
  };
  const lines: string[] = ["<dissent_ledger>", "未撤销异议："];
  for (const record of openDissents) {
    const claimSuffix = record.claimKind ? ` · 主张=${record.claimKind}` : "";
    lines.push(
      `- [${record.departmentId}] ${severityLabel[record.severity]}${claimSuffix} · ${formatRelativeAgo(context.nowSimulationSeconds, record.simulationSeconds)}：${record.summary}`,
    );
  }
  lines.push(
    "提醒：这些是下属部门尚未撤销的反对意见，你有权坚持，但记录会进入航程结束报告。",
  );
  lines.push("</dissent_ledger>");
  return lines.join("\n");
}

export function renderPeerPositionsPromptBlock(
  positions: ReadonlyArray<{ departmentId: string; text: string }>,
  context: { excludeDepartmentId: string },
): string | null {
  const peers = positions.filter((position) => {
    if (position.departmentId === context.excludeDepartmentId) {
      return false;
    }
    return position.text.trim().length > 0;
  });
  if (peers.length === 0) {
    return null;
  }
  const lines: string[] = [
    "<peer_positions>",
    "同僚本轮发言：",
  ];
  for (const peer of peers) {
    lines.push(`- [${peer.departmentId}] ${peer.text.trim()}`);
  }
  lines.push(
    "说明：这些是同僚本轮的发言，你可以明确赞同或反驳，专业分歧比虚假一致更有价值。",
  );
  lines.push("</peer_positions>");
  return lines.join("\n");
}

export function summarizeDissentLedger(
  snapshot: DepartmentStandingSnapshot,
): Array<{
  departmentId: string;
  dissentCount: number;
  overriddenCount: number;
  vindicatedCount: number;
  openCount: number;
}> {
  return snapshot.standings.map((standing) => ({
    departmentId: standing.departmentId,
    dissentCount: standing.dissentCount,
    overriddenCount: standing.overriddenCount,
    vindicatedCount: standing.vindicatedCount,
    openCount: snapshot.dissents.filter(
      (record) =>
        record.departmentId === standing.departmentId &&
        record.resolution === "open",
    ).length,
  }));
}

export const FILE_DISSENT_TOOL_INPUT_SCHEMA: Readonly<
  Record<string, unknown>
> = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["summary"]),
  properties: Object.freeze({
    severity: Object.freeze({
      type: "string",
      enum: Object.freeze(["note", "formal", "grave"]),
      description:
        "异议严重度：note 保留意见；formal 正式异议；grave 严重反对。缺省视为 formal。",
    }),
    summary: Object.freeze({
      type: "string",
      maxLength: DEPARTMENT_DISSENT_MAX_SUMMARY_CHARACTERS,
      description: "异议摘要，须简洁说明反对理由与替代建议。",
    }),
    claimKind: Object.freeze({
      type: "string",
      enum: Object.freeze([...DISSENT_CLAIM_KINDS]),
      description:
        "可选结构化主张，供事后自动对照世界结果：hull_sealed / pressure_recovered / jump_completed / power_nominal。省略时可由摘要关键词推断。",
    }),
  }),
});
