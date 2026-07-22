"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LlmCallPhase, SystemTone, TimelineEvent } from "../types";

export type EventRailFilter = "all" | SystemTone;

export type EventRailProps = {
  events: TimelineEvent[];
  open: boolean;
  filter: EventRailFilter;
  onOpenChange: (open: boolean) => void;
  onFilterChange: (filter: EventRailFilter) => void;
  missionStarted: boolean;
  llmCallPhase: LlmCallPhase;
  decisionCount: number;
  doneDecisionCount: number;
};

const FILTERS: EventRailFilter[] = ["all", "nominal", "watch", "critical"];

const FILTER_LABEL: Record<EventRailFilter, string> = {
  all: "全部",
  nominal: "正常",
  watch: "关注",
  critical: "告警",
};

const TONE_LABEL: Record<SystemTone, string> = {
  nominal: "正常",
  watch: "关注",
  critical: "告警",
};

const PHASE_LABEL: Record<LlmCallPhase, string> = {
  idle: "空闲",
  waiting: "会议中",
  error: "异常",
};

function statusPhrase(
  missionStarted: boolean,
  llmCallPhase: LlmCallPhase,
  decisionCount: number,
): string {
  if (!missionStarted) return "待命签发";
  if (llmCallPhase === "waiting") return "部门会议中";
  if (llmCallPhase === "error") return "链路异常";
  if (decisionCount > 0) return "持续监控";
  return "调整决策中";
}

function EventItem({
  event,
  expanded,
  onToggle,
}: {
  event: TimelineEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (expanded) return;
    const el = textRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [event.text, expanded]);

  return (
    <article className={`event-item event-${event.tone}`}>
      <div className="event-item-meta">
        <time dateTime={event.at}>{event.at}</time>
        <span className={`event-tone-badge tone-${event.tone}`}>
          {TONE_LABEL[event.tone]}
        </span>
        <span className={`event-source tone-${event.tone}`}>{event.source}</span>
      </div>
      <p
        ref={textRef}
        className={`event-text${expanded ? " is-expanded" : ""}`}
      >
        {event.text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          className="event-expand-btn"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </article>
  );
}

/**
 * 全舰事件流侧栏 — 可折叠条目、按 tone 过滤，底部舰长摘要。
 */
export function EventRail({
  events,
  open,
  filter,
  onOpenChange,
  onFilterChange,
  missionStarted,
  llmCallPhase,
  decisionCount,
  doneDecisionCount,
}: EventRailProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const toneCounts = useMemo(() => {
    let nominal = 0;
    let watch = 0;
    let critical = 0;
    for (const event of events) {
      if (event.tone === "nominal") nominal += 1;
      else if (event.tone === "watch") watch += 1;
      else critical += 1;
    }
    return {
      all: events.length,
      nominal,
      watch,
      critical,
    } as const;
  }, [events]);

  const visibleEvents = useMemo(
    () =>
      events
        .filter((event) => filter === "all" || event.tone === filter)
        .slice(0, 50),
    [events, filter],
  );

  return (
    <>
      <button
        type="button"
        className="event-rail-toggle"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        事件 {events.length}
      </button>
      <button
        type="button"
        className={`event-rail-backdrop${open ? " is-open" : ""}`}
        aria-label="关闭事件时间线"
        onClick={() => onOpenChange(false)}
      />
      <aside
        className={`event-rail${open ? " is-open" : ""}`}
        aria-label="事件时间线"
      >
        <div className="event-rail-heading">
          <div>
            <span className="eyebrow">EVENT STREAM</span>
            <h2>全舰事件</h2>
          </div>
          <span className="event-count">{events.length}</span>
        </div>

        <div className="event-filter-bar">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              className={`event-filter-btn${filter === key ? " active" : ""}`}
              onClick={() => onFilterChange(key)}
            >
              {FILTER_LABEL[key]}
              <span className="event-filter-count">{toneCounts[key]}</span>
            </button>
          ))}
        </div>

        <div className="event-list">
          {visibleEvents.map((event) => (
            <EventItem
              key={event.id}
              event={event}
              expanded={expandedId === event.id}
              onToggle={() =>
                setExpandedId((current) =>
                  current === event.id ? null : event.id,
                )
              }
            />
          ))}
        </div>

        <div className="captain-glance">
          <span className="eyebrow">CAPTAIN / 乾枢</span>
          <div className="captain-glance-grid">
            <div>
              <span>态势</span>
              <strong>
                {statusPhrase(missionStarted, llmCallPhase, decisionCount)}
              </strong>
            </div>
            <div>
              <span>决策</span>
              <strong>
                {doneDecisionCount}/{decisionCount}
              </strong>
            </div>
            <div>
              <span>相位</span>
              <strong>{PHASE_LABEL[llmCallPhase]}</strong>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
