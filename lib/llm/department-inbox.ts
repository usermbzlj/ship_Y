/**
 * B2-lite：舰长 → 部门单向收件箱（环形缓冲）。
 * 部门无世界改写工具；仅作咨询 prompt 注入与 AI 视图展示。
 */

import { SHIP_DEPARTMENT_IDS, type ShipDepartmentId } from "../sim/captain-operations.ts";

export const DEPARTMENT_INBOX_SNAPSHOT_VERSION = 1 as const;
export const DEPARTMENT_INBOX_MAX_MESSAGES_PER_DEPT = 16;
export const DEPARTMENT_INBOX_MAX_BODY_CHARACTERS = 240;
export const DEPARTMENT_INBOX_UI_LINES = 4;

export interface DepartmentInboxMessage {
  messageId: string;
  ordinal: number;
  departmentId: ShipDepartmentId;
  simulationSeconds: number;
  body: string;
  read: boolean;
}

export interface DepartmentInboxChannel {
  departmentId: ShipDepartmentId;
  messages: DepartmentInboxMessage[];
}

export interface DepartmentInboxSnapshot {
  snapshotVersion: typeof DEPARTMENT_INBOX_SNAPSHOT_VERSION;
  nextOrdinal: number;
  channels: DepartmentInboxChannel[];
}

const DEPARTMENT_IDS = [...SHIP_DEPARTMENT_IDS] as ShipDepartmentId[];
const DEPARTMENT_ID_SET = new Set<string>(DEPARTMENT_IDS);

const SNAPSHOT_KEYS = ["snapshotVersion", "nextOrdinal", "channels"] as const;
const CHANNEL_KEYS = ["departmentId", "messages"] as const;
const MESSAGE_KEYS = [
  "messageId",
  "ordinal",
  "departmentId",
  "simulationSeconds",
  "body",
  "read",
] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function truncateText(text: string, maxCharacters: number): string {
  return text.length <= maxCharacters ? text : text.slice(0, maxCharacters);
}

function createEmptyChannel(departmentId: ShipDepartmentId): DepartmentInboxChannel {
  return { departmentId, messages: [] };
}

export function createDepartmentInboxSnapshot(): DepartmentInboxSnapshot {
  return {
    snapshotVersion: DEPARTMENT_INBOX_SNAPSHOT_VERSION,
    nextOrdinal: 1,
    channels: DEPARTMENT_IDS.map(createEmptyChannel),
  };
}

function validateMessage(
  value: unknown,
  expectedDepartmentId: string,
): value is DepartmentInboxMessage {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== MESSAGE_KEYS.length ||
    MESSAGE_KEYS.some((key) => !keys.includes(key))
  ) {
    return false;
  }
  return (
    typeof value.messageId === "string" &&
    isSafeNonNegativeInteger(value.ordinal) &&
    value.messageId === `inbox-${value.ordinal}` &&
    value.departmentId === expectedDepartmentId &&
    DEPARTMENT_ID_SET.has(value.departmentId as string) &&
    isFiniteNonNegative(value.simulationSeconds) &&
    typeof value.body === "string" &&
    value.body.length >= 1 &&
    value.body.length <= DEPARTMENT_INBOX_MAX_BODY_CHARACTERS &&
    typeof value.read === "boolean"
  );
}

function validateChannel(
  value: unknown,
  expectedDepartmentId: ShipDepartmentId,
): value is DepartmentInboxChannel {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== CHANNEL_KEYS.length ||
    CHANNEL_KEYS.some((key) => !keys.includes(key))
  ) {
    return false;
  }
  if (
    value.departmentId !== expectedDepartmentId ||
    !Array.isArray(value.messages) ||
    value.messages.length > DEPARTMENT_INBOX_MAX_MESSAGES_PER_DEPT
  ) {
    return false;
  }
  return value.messages.every((message) =>
    validateMessage(message, expectedDepartmentId),
  );
}

export function validateDepartmentInboxSnapshot(
  value: unknown,
): DepartmentInboxSnapshot | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== SNAPSHOT_KEYS.length ||
    SNAPSHOT_KEYS.some((key) => !keys.includes(key))
  ) {
    return null;
  }
  if (
    value.snapshotVersion !== DEPARTMENT_INBOX_SNAPSHOT_VERSION ||
    !isSafeNonNegativeInteger(value.nextOrdinal) ||
    value.nextOrdinal < 1 ||
    !Array.isArray(value.channels) ||
    value.channels.length !== DEPARTMENT_IDS.length
  ) {
    return null;
  }

  const seenOrdinals = new Set<number>();
  for (let index = 0; index < DEPARTMENT_IDS.length; index += 1) {
    const channel = value.channels[index];
    if (!validateChannel(channel, DEPARTMENT_IDS[index])) {
      return null;
    }
    for (const message of channel.messages) {
      if (seenOrdinals.has(message.ordinal) || message.ordinal >= value.nextOrdinal) {
        return null;
      }
      seenOrdinals.add(message.ordinal);
    }
  }

  return clone(value as unknown as DepartmentInboxSnapshot);
}

function findChannelIndex(
  channels: readonly DepartmentInboxChannel[],
  departmentId: string,
): number {
  return channels.findIndex((channel) => channel.departmentId === departmentId);
}

/**
 * 舰长咨询时写入各部门 briefing 摘录；每部门环形上限 16。
 */
export function appendCaptainBriefingToDepartments(
  snapshot: DepartmentInboxSnapshot,
  input: {
    departmentIds: readonly string[];
    body: string;
    simulationSeconds: number;
  },
): DepartmentInboxSnapshot {
  const body = truncateText(input.body.trim(), DEPARTMENT_INBOX_MAX_BODY_CHARACTERS);
  if (!body || input.departmentIds.length === 0) {
    return snapshot;
  }
  const next = clone(snapshot);
  const uniqueDeptIds = [...new Set(input.departmentIds)].filter((id) =>
    DEPARTMENT_ID_SET.has(id),
  ) as ShipDepartmentId[];
  for (const departmentId of uniqueDeptIds) {
    const index = findChannelIndex(next.channels, departmentId);
    if (index < 0) continue;
    const ordinal = next.nextOrdinal;
    next.nextOrdinal = ordinal + 1;
    const message: DepartmentInboxMessage = {
      messageId: `inbox-${ordinal}`,
      ordinal,
      departmentId,
      simulationSeconds: input.simulationSeconds,
      body,
      read: false,
    };
    next.channels[index].messages.push(message);
    if (
      next.channels[index].messages.length > DEPARTMENT_INBOX_MAX_MESSAGES_PER_DEPT
    ) {
      next.channels[index].messages = next.channels[index].messages.slice(
        -DEPARTMENT_INBOX_MAX_MESSAGES_PER_DEPT,
      );
    }
  }
  return next;
}

export function markDepartmentInboxRead(
  snapshot: DepartmentInboxSnapshot,
  departmentId: string,
): DepartmentInboxSnapshot {
  const index = findChannelIndex(snapshot.channels, departmentId);
  if (index < 0) return snapshot;
  const channel = snapshot.channels[index];
  if (!channel.messages.some((message) => !message.read)) {
    return snapshot;
  }
  const next = clone(snapshot);
  for (const message of next.channels[index].messages) {
    message.read = true;
  }
  return next;
}

export function unreadCountForDepartment(
  snapshot: DepartmentInboxSnapshot,
  departmentId: string,
): number {
  const channel = snapshot.channels.find(
    (entry) => entry.departmentId === departmentId,
  );
  if (!channel) return 0;
  return channel.messages.filter((message) => !message.read).length;
}

export function totalUnreadCount(snapshot: DepartmentInboxSnapshot): number {
  return snapshot.channels.reduce(
    (sum, channel) =>
      sum + channel.messages.filter((message) => !message.read).length,
    0,
  );
}

export function recentMessagesForDepartment(
  snapshot: DepartmentInboxSnapshot,
  departmentId: string,
  limit: number = DEPARTMENT_INBOX_UI_LINES,
): DepartmentInboxMessage[] {
  const channel = snapshot.channels.find(
    (entry) => entry.departmentId === departmentId,
  );
  if (!channel || channel.messages.length === 0) {
    return [];
  }
  return channel.messages.slice(-Math.max(1, limit)).map((message) => clone(message));
}

function formatRelativeAgo(
  nowSimulationSeconds: number,
  atSimulationSeconds: number,
): string {
  const elapsedSeconds = Math.max(0, nowSimulationSeconds - atSimulationSeconds);
  const totalMinutes = Math.floor(elapsedSeconds / 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `距今 ${days}d${hours}h${minutes}m`;
  if (hours > 0) return `距今 ${hours}h${minutes}m`;
  return `距今 ${minutes}m`;
}

/**
 * 注入部门咨询 prompt；调用方应在注入后 markDepartmentInboxRead。
 */
export function renderDepartmentInboxPromptBlock(
  snapshot: DepartmentInboxSnapshot,
  departmentId: string,
  context: { nowSimulationSeconds: number },
): string | null {
  const channel = snapshot.channels.find(
    (entry) => entry.departmentId === departmentId,
  );
  if (!channel || channel.messages.length === 0) {
    return null;
  }
  const unread = channel.messages.filter((message) => !message.read);
  const lines: string[] = ["<inbox>", "舰长单向简报（部门收件箱，不可回写世界）："];
  const shown =
    unread.length > 0
      ? unread.slice(-DEPARTMENT_INBOX_UI_LINES)
      : channel.messages.slice(-Math.min(2, DEPARTMENT_INBOX_UI_LINES));
  for (const message of shown) {
    const flag = message.read ? "已读" : "未读";
    lines.push(
      `- [${flag}] ${formatRelativeAgo(context.nowSimulationSeconds, message.simulationSeconds)}：${message.body}`,
    );
  }
  lines.push(
    "说明：这是舰长留给本部门的简报摘录，不是观测真值，也不是世界命令。",
  );
  lines.push("</inbox>");
  return lines.join("\n");
}
