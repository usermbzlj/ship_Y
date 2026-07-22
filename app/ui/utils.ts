/**
 * 共享 UI 工具函数
 */

import type { TimelineEvent } from "./types";
import { MAX_TIMELINE_EVENTS } from "./constants";

/** 把仿真秒数格式化为 DDDd HHh MMm */
export function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return `${String(days).padStart(3, "0")}D ${String(hours).padStart(2, "0")}H ${String(minutes).padStart(2, "0")}M`;
}

/** 把秒数格式化为人类可读的周期描述 */
export function formatCadence(seconds: number): string {
  if (seconds >= 86_400 && seconds % 86_400 === 0) {
    return `${seconds / 86_400} 天`;
  }
  if (seconds >= 3_600 && seconds % 3_600 === 0) {
    return `${seconds / 3_600} 小时`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60} 分钟`;
  }
  return `${seconds} 秒`;
}

/** 在时间线前端插入事件并截断到上限 */
export function prependTimelineEvent(
  current: TimelineEvent[],
  event: TimelineEvent,
): TimelineEvent[] {
  return [event, ...current].slice(0, MAX_TIMELINE_EVENTS);
}

/** 把 LLM 返回的 Markdown 文本压缩为纯文本摘要 */
export function compactLlmTimelineText(
  value: string,
  maximumLength: number,
  fallback: string,
): string {
  const plainText = value
    .trim()
    .replace(/```[A-Za-z0-9_-]*\s*/g, "")
    .replace(/```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\|\s*:?-{3,}:?\s*(?=\|)/g, "")
    .replace(/\|/g, " · ")
    .replace(/[\*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plainText) return fallback;
  if (plainText.length <= maximumLength) return plainText;
  return `${plainText.slice(0, Math.max(1, maximumLength - 1)).trimEnd()}…`;
}
