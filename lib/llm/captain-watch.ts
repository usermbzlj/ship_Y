/**
 * 舰长观察哨：让舰长在授权观测边界内自行设定「到某阈值再叫醒我」的条件。
 * 只允许监视本目录列出的量——这些是舰长本来就能通过授权观测看到的量，
 * 不给它凭空监视上帝真值的能力。原有硬编码安全网阈值仍由上层保留。
 */

export const CAPTAIN_WATCH_SNAPSHOT_VERSION = 1 as const;
export const SET_WATCH_CONDITION_TOOL_NAME = "set_watch_condition";
export const CAPTAIN_WATCH_MAX_ACTIVE = 6;
export const CAPTAIN_WATCH_MAX_NOTE_CHARACTERS = 160;

export type WatchComparator = "above" | "below";

export interface WatchMetricDefinition {
  id: string;
  label: string;
  unit: string;
  minimum: number;
  maximum: number;
}

export const WATCH_METRICS: readonly WatchMetricDefinition[] = [
  {
    id: "hullIntegrity",
    label: "舰体完整度",
    unit: "fraction",
    minimum: 0,
    maximum: 1,
  },
  {
    id: "lowestZonePressureKpa",
    label: "最低区带总压",
    unit: "kPa",
    minimum: 0,
    maximum: 200,
  },
  {
    id: "highestZoneCarbonDioxideKpa",
    label: "最高区带 CO₂ 分压",
    unit: "kPa",
    minimum: 0,
    maximum: 20,
  },
  {
    id: "coolantBusTemperatureK",
    label: "冷却母线温度",
    unit: "K",
    minimum: 0,
    maximum: 1000,
  },
  {
    id: "batteryStateOfChargeFraction",
    label: "电池荷电状态",
    unit: "fraction",
    minimum: 0,
    maximum: 1,
  },
  {
    id: "jumpDriveChargeFraction",
    label: "跃迁储能充能度",
    unit: "fraction",
    minimum: 0,
    maximum: 1,
  },
  {
    id: "potableWaterKg",
    label: "净水存量",
    unit: "kg",
    minimum: 0,
    maximum: 1e8,
  },
  {
    id: "dryFoodKg",
    label: "干粮存量",
    unit: "kg",
    minimum: 0,
    maximum: 1e8,
  },
  {
    id: "atmosphereReserveKg",
    label: "舰载大气储备",
    unit: "kg",
    minimum: 0,
    maximum: 1e7,
  },
  {
    id: "awakePopulation",
    label: "清醒人数",
    unit: "人",
    minimum: 0,
    maximum: 2120,
  },
  {
    id: "meanPassengerStress",
    label: "平均乘员应激",
    unit: "fraction",
    minimum: 0,
    maximum: 1,
  },
  {
    id: "openMaintenanceTaskCount",
    label: "未完成维修任务数",
    unit: "项",
    minimum: 0,
    maximum: 500,
  },
];

export type WatchMetricId = (typeof WATCH_METRICS)[number]["id"];
export type WatchMetricSample = Readonly<
  Partial<Record<string, number | null>>
>;

export interface CaptainWatchCondition {
  watchId: string;
  ordinal: number;
  metric: string;
  comparator: WatchComparator;
  threshold: number;
  note: string;
  createdAtSimulationSeconds: number;
  expiresAtSimulationSeconds: number | null;
  triggeredAtSimulationSeconds: number | null;
  armed: boolean;
}

export interface CaptainWatchSnapshot {
  snapshotVersion: typeof CAPTAIN_WATCH_SNAPSHOT_VERSION;
  nextOrdinal: number;
  conditions: CaptainWatchCondition[];
}

export interface CaptainWatchDraft {
  metric: string;
  comparator: WatchComparator;
  threshold: number;
  note: string;
  expiresAfterSeconds: number | null;
}

export type SetWatchConditionParseResult =
  | { ok: true; draft: CaptainWatchDraft }
  | { ok: false; reason: string };

export interface FiredWatch {
  watchId: string;
  metric: string;
  label: string;
  comparator: WatchComparator;
  threshold: number;
  observedValue: number;
  note: string;
}

const SNAPSHOT_KEYS = [
  "snapshotVersion",
  "nextOrdinal",
  "conditions",
] as const;

const CONDITION_KEYS = [
  "watchId",
  "ordinal",
  "metric",
  "comparator",
  "threshold",
  "note",
  "createdAtSimulationSeconds",
  "expiresAtSimulationSeconds",
  "triggeredAtSimulationSeconds",
  "armed",
] as const;

const WATCH_COMPARATORS: readonly WatchComparator[] = [
  "above",
  "below",
];

const WATCH_METRIC_IDS = WATCH_METRICS.map((metric) => metric.id);

const WATCH_METRICS_BY_ID = new Map(
  WATCH_METRICS.map((metric) => [metric.id, metric]),
);

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

function isWatchComparator(value: unknown): value is WatchComparator {
  return (
    typeof value === "string" &&
    (WATCH_COMPARATORS as readonly string[]).includes(value)
  );
}

function metricDefinition(
  metricId: string,
): WatchMetricDefinition | undefined {
  return WATCH_METRICS_BY_ID.get(metricId);
}

function comparatorLabel(comparator: WatchComparator): string {
  return comparator === "above" ? "高于" : "低于";
}

/** 相对历时：`6h12m`（不得为负）。 */
function formatRelativeDuration(elapsedSeconds: number): string {
  const safe = Math.max(0, Math.floor(elapsedSeconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  return `${hours}h${String(minutes).padStart(2, "0")}m`;
}

function validateCondition(
  value: unknown,
): CaptainWatchCondition | null {
  if (!isRecord(value) || !hasExactKeys(value, CONDITION_KEYS)) {
    return null;
  }
  const {
    watchId,
    ordinal,
    metric,
    comparator,
    threshold,
    note,
    createdAtSimulationSeconds,
    expiresAtSimulationSeconds,
    triggeredAtSimulationSeconds,
    armed,
  } = value;
  const definition =
    typeof metric === "string" ? metricDefinition(metric) : undefined;
  if (
    typeof watchId !== "string" ||
    typeof ordinal !== "number" ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1 ||
    watchId !== `watch-${ordinal}` ||
    typeof metric !== "string" ||
    definition === undefined ||
    !isWatchComparator(comparator) ||
    typeof threshold !== "number" ||
    !Number.isFinite(threshold) ||
    threshold < definition.minimum ||
    threshold > definition.maximum ||
    typeof note !== "string" ||
    note.length < 1 ||
    note.length > CAPTAIN_WATCH_MAX_NOTE_CHARACTERS ||
    typeof createdAtSimulationSeconds !== "number" ||
    !Number.isFinite(createdAtSimulationSeconds) ||
    createdAtSimulationSeconds < 0 ||
    !(
      expiresAtSimulationSeconds === null ||
      (typeof expiresAtSimulationSeconds === "number" &&
        Number.isFinite(expiresAtSimulationSeconds) &&
        expiresAtSimulationSeconds >= 0)
    ) ||
    !(
      triggeredAtSimulationSeconds === null ||
      (typeof triggeredAtSimulationSeconds === "number" &&
        Number.isFinite(triggeredAtSimulationSeconds) &&
        triggeredAtSimulationSeconds >= 0)
    ) ||
    typeof armed !== "boolean"
  ) {
    return null;
  }
  return {
    watchId,
    ordinal,
    metric,
    comparator,
    threshold,
    note,
    createdAtSimulationSeconds,
    expiresAtSimulationSeconds,
    triggeredAtSimulationSeconds,
    armed,
  };
}

export function createCaptainWatchSnapshot(): CaptainWatchSnapshot {
  return {
    snapshotVersion: CAPTAIN_WATCH_SNAPSHOT_VERSION,
    nextOrdinal: 1,
    conditions: [],
  };
}

export function validateCaptainWatchSnapshot(
  value: unknown,
): CaptainWatchSnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) {
    return null;
  }
  if (value.snapshotVersion !== CAPTAIN_WATCH_SNAPSHOT_VERSION) {
    return null;
  }
  const nextOrdinal = value.nextOrdinal;
  const rawConditions = value.conditions;
  if (
    typeof nextOrdinal !== "number" ||
    !Number.isSafeInteger(nextOrdinal) ||
    nextOrdinal < 1 ||
    !Array.isArray(rawConditions) ||
    rawConditions.length > CAPTAIN_WATCH_MAX_ACTIVE
  ) {
    return null;
  }

  const conditions: CaptainWatchCondition[] = [];
  let previousOrdinal = 0;
  for (const rawCondition of rawConditions) {
    const condition = validateCondition(rawCondition);
    if (condition === null || condition.ordinal <= previousOrdinal) {
      return null;
    }
    if (condition.ordinal >= nextOrdinal) {
      return null;
    }
    previousOrdinal = condition.ordinal;
    conditions.push(condition);
  }

  return clone({
    snapshotVersion: CAPTAIN_WATCH_SNAPSHOT_VERSION,
    nextOrdinal,
    conditions,
  });
}

export function parseSetWatchConditionToolCall(
  args: unknown,
): SetWatchConditionParseResult {
  if (!isRecord(args)) {
    return { ok: false, reason: "观察哨参数必须是对象" };
  }

  const rawMetric = args.metric;
  if (typeof rawMetric !== "string" || !metricDefinition(rawMetric)) {
    return { ok: false, reason: "metric 必须是目录内的监视量" };
  }
  const definition = metricDefinition(rawMetric)!;

  const rawComparator = args.comparator;
  if (!isWatchComparator(rawComparator)) {
    return { ok: false, reason: "comparator 必须是 above 或 below" };
  }

  const rawThreshold = args.threshold;
  if (
    typeof rawThreshold !== "number" ||
    !Number.isFinite(rawThreshold)
  ) {
    return { ok: false, reason: "threshold 必须是有限数" };
  }
  if (
    rawThreshold < definition.minimum ||
    rawThreshold > definition.maximum
  ) {
    return {
      ok: false,
      reason: `threshold 须在 [${definition.minimum}, ${definition.maximum}] 内`,
    };
  }

  const rawNote = args.note;
  if (typeof rawNote !== "string" || !rawNote.trim()) {
    return { ok: false, reason: "note 必须是非空字符串" };
  }

  let expiresAfterSeconds: number | null = null;
  if (
    args.expiresAfterSeconds !== undefined &&
    args.expiresAfterSeconds !== null
  ) {
    const rawExpires = args.expiresAfterSeconds;
    if (
      typeof rawExpires !== "number" ||
      !Number.isFinite(rawExpires) ||
      rawExpires <= 0
    ) {
      return {
        ok: false,
        reason: "expiresAfterSeconds 必须是大于 0 的有限数",
      };
    }
    expiresAfterSeconds = rawExpires;
  }

  return {
    ok: true,
    draft: {
      metric: rawMetric,
      comparator: rawComparator,
      threshold: rawThreshold,
      note: truncate(
        rawNote.trim(),
        CAPTAIN_WATCH_MAX_NOTE_CHARACTERS,
      ),
      expiresAfterSeconds,
    },
  };
}

export function applyCaptainWatchCondition(
  snapshot: CaptainWatchSnapshot,
  draft: CaptainWatchDraft,
  context: { simulationSeconds: number },
): { snapshot: CaptainWatchSnapshot; condition: CaptainWatchCondition } {
  const ordinal = snapshot.nextOrdinal;
  const condition: CaptainWatchCondition = {
    watchId: `watch-${ordinal}`,
    ordinal,
    metric: draft.metric,
    comparator: draft.comparator,
    threshold: draft.threshold,
    note: draft.note,
    createdAtSimulationSeconds: context.simulationSeconds,
    expiresAtSimulationSeconds:
      draft.expiresAfterSeconds === null
        ? null
        : context.simulationSeconds + draft.expiresAfterSeconds,
    triggeredAtSimulationSeconds: null,
    armed: true,
  };

  const conditions = snapshot.conditions.filter(
    (existing) =>
      !(
        existing.metric === draft.metric &&
        existing.comparator === draft.comparator
      ),
  );
  conditions.push(condition);

  while (conditions.length > CAPTAIN_WATCH_MAX_ACTIVE) {
    let oldestIndex = 0;
    for (let index = 1; index < conditions.length; index += 1) {
      if (conditions[index].ordinal < conditions[oldestIndex].ordinal) {
        oldestIndex = index;
      }
    }
    conditions.splice(oldestIndex, 1);
  }

  return {
    snapshot: {
      snapshotVersion: CAPTAIN_WATCH_SNAPSHOT_VERSION,
      nextOrdinal: ordinal + 1,
      conditions,
    },
    condition,
  };
}

export function evaluateCaptainWatches(
  snapshot: CaptainWatchSnapshot,
  sample: WatchMetricSample,
  context: { simulationSeconds: number },
): { snapshot: CaptainWatchSnapshot; fired: FiredWatch[] } {
  const simulationSeconds = context.simulationSeconds;
  const retained = snapshot.conditions.filter(
    (condition) =>
      condition.expiresAtSimulationSeconds === null ||
      condition.expiresAtSimulationSeconds > simulationSeconds,
  );

  const nextConditions: CaptainWatchCondition[] = [];
  const firedWithOrdinal: Array<{
    ordinal: number;
    fired: FiredWatch;
  }> = [];

  for (const condition of retained) {
    if (!condition.armed) {
      nextConditions.push(condition);
      continue;
    }

    const observed = sample[condition.metric];
    if (
      observed === undefined ||
      observed === null ||
      !Number.isFinite(observed)
    ) {
      nextConditions.push(condition);
      continue;
    }

    const shouldFire =
      condition.comparator === "above"
        ? observed > condition.threshold
        : observed < condition.threshold;
    if (!shouldFire) {
      nextConditions.push(condition);
      continue;
    }

    const definition = metricDefinition(condition.metric);
    nextConditions.push({
      ...condition,
      armed: false,
      triggeredAtSimulationSeconds: simulationSeconds,
    });
    firedWithOrdinal.push({
      ordinal: condition.ordinal,
      fired: {
        watchId: condition.watchId,
        metric: condition.metric,
        label: definition?.label ?? condition.metric,
        comparator: condition.comparator,
        threshold: condition.threshold,
        observedValue: observed,
        note: condition.note,
      },
    });
  }

  firedWithOrdinal.sort((left, right) => left.ordinal - right.ordinal);

  return {
    snapshot: {
      snapshotVersion: CAPTAIN_WATCH_SNAPSHOT_VERSION,
      nextOrdinal: snapshot.nextOrdinal,
      conditions: nextConditions,
    },
    fired: firedWithOrdinal.map((item) => item.fired),
  };
}

export function renderCaptainWatchPromptBlock(
  snapshot: CaptainWatchSnapshot,
  context: { nowSimulationSeconds: number },
): string | null {
  if (snapshot.conditions.length === 0) {
    return null;
  }

  const now = context.nowSimulationSeconds;
  const active: CaptainWatchCondition[] = [];
  const triggered: CaptainWatchCondition[] = [];

  for (const condition of snapshot.conditions) {
    const expired =
      condition.expiresAtSimulationSeconds !== null &&
      condition.expiresAtSimulationSeconds <= now;
    if (expired) {
      continue;
    }
    if (condition.armed) {
      active.push(condition);
    } else if (condition.triggeredAtSimulationSeconds !== null) {
      triggered.push(condition);
    }
  }

  if (active.length === 0 && triggered.length === 0) {
    return null;
  }

  const lines: string[] = [
    "这些是你自己设的观察哨，触发后会自动失效一次，若仍要继续监视需重新设置。",
    "",
    "【生效中】",
  ];

  if (active.length === 0) {
    lines.push("（无）");
  } else {
    for (const condition of active) {
      lines.push(formatWatchLine(condition, now));
    }
  }

  lines.push("");
  lines.push("【已触发（待你复核或重设）】");
  if (triggered.length === 0) {
    lines.push("（无）");
  } else {
    for (const condition of triggered) {
      lines.push(formatWatchLine(condition, now));
    }
  }

  return `<watch>\n${lines.join("\n")}\n</watch>`;
}

function formatWatchLine(
  condition: CaptainWatchCondition,
  nowSimulationSeconds: number,
): string {
  const definition = metricDefinition(condition.metric);
  const label = definition?.label ?? condition.metric;
  const unit = definition?.unit ?? "";
  const createdAgo = formatRelativeDuration(
    nowSimulationSeconds - condition.createdAtSimulationSeconds,
  );
  const parts = [
    `${label} ${comparatorLabel(condition.comparator)} ${condition.threshold}${unit ? ` ${unit}` : ""}`,
    condition.note,
    `创建于距今 ${createdAgo}`,
  ];
  if (condition.expiresAtSimulationSeconds !== null) {
    parts.push(
      `将在 ${formatRelativeDuration(
        condition.expiresAtSimulationSeconds - nowSimulationSeconds,
      )} 后过期`,
    );
  }
  if (condition.triggeredAtSimulationSeconds !== null) {
    parts.push(
      `触发于距今 ${formatRelativeDuration(
        nowSimulationSeconds - condition.triggeredAtSimulationSeconds,
      )}`,
    );
  }
  return `- ${parts.join(" · ")}`;
}

export function captainWatchTriggerKey(
  fired: ReadonlyArray<FiredWatch>,
): string | null {
  if (fired.length === 0) {
    return null;
  }
  const watchIds = fired.map((item) => item.watchId).sort();
  return `watch:${watchIds.join(",")}`;
}

export const SET_WATCH_CONDITION_TOOL_INPUT_SCHEMA: Readonly<
  Record<string, unknown>
> = deepFreeze({
  type: "object",
  additionalProperties: false,
  required: ["metric", "comparator", "threshold", "note"],
  properties: {
    metric: {
      type: "string",
      enum: [...WATCH_METRIC_IDS],
      description:
        "要监视的量。只能监视本表列出的、你在授权观测中本来就能看到的量，不可监视上帝真值。",
    },
    comparator: {
      type: "string",
      enum: [...WATCH_COMPARATORS],
      description:
        "比较关系：above 表示观测值严格高于阈值时触发；below 表示严格低于阈值时触发。触发一次后自动失效。",
    },
    threshold: {
      type: "number",
      description:
        "触发阈值，必须落在该监视量的合法闭区间内。触发一次后该哨位自动失效。",
    },
    note: {
      type: "string",
      maxLength: CAPTAIN_WATCH_MAX_NOTE_CHARACTERS,
      description:
        "你设置该哨位的主观理由（给下次醒来的自己看）；触发后会随简报一并呈现。",
    },
    expiresAfterSeconds: {
      type: ["number", "null"],
      description:
        "可选：自设置起多少模拟秒后自动作废；缺省或 null 表示不过期。必须大于 0。",
    },
  },
});
