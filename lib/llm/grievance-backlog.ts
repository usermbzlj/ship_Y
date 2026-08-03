/**
 * C5：开放申诉积压 → 区带压力轻推 + 乘客事务部 prompt 旗标。
 * 只读 operations.grievances；不新增乘客写世界工具，不 bump 运营 schema。
 * 已回应/关闭的申诉自动退出罚分集合。
 */

export const GRIEVANCE_BACKLOG_AGE_SECONDS = 8 * 60 * 60;
/** 与传言士气耦合同量级的单区单节拍上限。 */
export const GRIEVANCE_BACKLOG_STRESS_CAP = 0.015;
export const GRIEVANCE_BACKLOG_STRESS_PER = 0.004;
export const GRIEVANCE_BACKLOG_PROMPT_LIMIT = 6;
export const AFFAIRS_DEPARTMENT_ID = "passenger-affairs" as const;

export type GrievanceBacklogStatus =
  | "open"
  | "accepted"
  | "answered"
  | "closed";

export interface GrievanceBacklogEntry {
  id: string;
  category: string;
  summary: string;
  filedAtMicroseconds: number;
  status: GrievanceBacklogStatus;
  filedByPassengerId: string | null;
}

export interface GrievanceBacklogAged {
  id: string;
  category: string;
  summary: string;
  ageSeconds: number;
  filedByPassengerId: string | null;
}

export interface ZoneStressDelta {
  zoneId: string;
  stressDelta: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isOpenStatus(status: string): boolean {
  return status === "open" || status === "accepted";
}

/**
 * 仍开放且超过年龄阈值的申诉；answered/closed 不计入（罚分清除）。
 */
export function listAgedOpenGrievances(
  grievances: readonly GrievanceBacklogEntry[],
  simulationSeconds: number,
  ageThresholdSeconds: number = GRIEVANCE_BACKLOG_AGE_SECONDS,
): GrievanceBacklogAged[] {
  const aged: GrievanceBacklogAged[] = [];
  for (const grievance of grievances) {
    if (!isOpenStatus(grievance.status)) {
      continue;
    }
    const filedAtSeconds = grievance.filedAtMicroseconds / 1_000_000;
    const ageSeconds = Math.max(0, simulationSeconds - filedAtSeconds);
    if (ageSeconds < ageThresholdSeconds) {
      continue;
    }
    aged.push({
      id: grievance.id,
      category: grievance.category,
      summary: grievance.summary,
      ageSeconds,
      filedByPassengerId: grievance.filedByPassengerId,
    });
  }
  aged.sort((left, right) => {
    if (right.ageSeconds !== left.ageSeconds) {
      return right.ageSeconds - left.ageSeconds;
    }
    return left.id.localeCompare(right.id);
  });
  return aged;
}

/**
 * 按立案乘客当前区带汇总压力增量；无乘客 id 的种子申诉只进 prompt，不推区带。
 * 同区有多条时累加并封顶；确定性排序。
 */
export function computeGrievanceBacklogStressDeltas(
  grievances: readonly GrievanceBacklogEntry[],
  context: {
    simulationSeconds: number;
    resolvePassengerZone: (passengerId: string) => string | null;
    ageThresholdSeconds?: number;
  },
): ZoneStressDelta[] {
  const aged = listAgedOpenGrievances(
    grievances,
    context.simulationSeconds,
    context.ageThresholdSeconds ?? GRIEVANCE_BACKLOG_AGE_SECONDS,
  );
  const byZone = new Map<string, number>();
  for (const entry of aged) {
    if (!entry.filedByPassengerId) {
      continue;
    }
    const zoneId = context.resolvePassengerZone(entry.filedByPassengerId);
    if (!zoneId) {
      continue;
    }
    const previous = byZone.get(zoneId) ?? 0;
    byZone.set(
      zoneId,
      Math.min(
        GRIEVANCE_BACKLOG_STRESS_CAP,
        previous + GRIEVANCE_BACKLOG_STRESS_PER,
      ),
    );
  }
  return [...byZone.entries()]
    .filter(([, stressDelta]) => stressDelta > 0)
    .map(([zoneId, stressDelta]) => ({ zoneId, stressDelta }))
    .sort((left, right) => left.zoneId.localeCompare(right.zoneId));
}

function formatAgeHours(ageSeconds: number): string {
  const hours = Math.floor(ageSeconds / 3600);
  const minutes = Math.floor((ageSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * 仅乘客事务部注入；无积压时返回 null（诚实空态由调用方不塞标签）。
 */
export function renderGrievanceBacklogPromptBlock(
  grievances: readonly GrievanceBacklogEntry[],
  context: {
    simulationSeconds: number;
    departmentId: string;
    ageThresholdSeconds?: number;
  },
): string | null {
  if (context.departmentId !== AFFAIRS_DEPARTMENT_ID) {
    return null;
  }
  const aged = listAgedOpenGrievances(
    grievances,
    context.simulationSeconds,
    context.ageThresholdSeconds ?? GRIEVANCE_BACKLOG_AGE_SECONDS,
  );
  if (aged.length === 0) {
    return null;
  }
  const thresholdHours = Math.round(
    (context.ageThresholdSeconds ?? GRIEVANCE_BACKLOG_AGE_SECONDS) / 3600,
  );
  const lines: string[] = [
    "<grievance_backlog>",
    `积压开放申诉 ${aged.length} 条（超过 ${thresholdHours} 仿真小时未回应）：`,
  ];
  for (const entry of aged.slice(0, GRIEVANCE_BACKLOG_PROMPT_LIMIT)) {
    const summary =
      entry.summary.length > 120
        ? `${entry.summary.slice(0, 120)}…`
        : entry.summary;
    lines.push(
      `- [${entry.category}] 已积压 ${formatAgeHours(entry.ageSeconds)}：${summary}`,
    );
  }
  if (aged.length > GRIEVANCE_BACKLOG_PROMPT_LIMIT) {
    lines.push(
      `…另有 ${aged.length - GRIEVANCE_BACKLOG_PROMPT_LIMIT} 条未列出`,
    );
  }
  lines.push(
    "提醒：这是舰务申诉队列的积压旗标，不是否决权。回应或关闭后罚分自动解除；你仍无世界改写工具。",
  );
  lines.push("</grievance_backlog>");
  return lines.join("\n");
}

export function cloneGrievanceBacklogEntries(
  grievances: readonly GrievanceBacklogEntry[],
): GrievanceBacklogEntry[] {
  return grievances.map((entry) => clone(entry));
}
