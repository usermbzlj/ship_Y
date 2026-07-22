"use client";

export type ConsoleStatusTone = "live" | "waiting" | "blocked" | "paused";

const TONE_LABEL: Record<ConsoleStatusTone, string> = {
  live: "运行中",
  waiting: "等待中",
  blocked: "已阻断",
  paused: "已暂停",
};

export function ConsoleStatusStrip({
  tone,
  title,
  detail,
}: {
  tone: ConsoleStatusTone;
  title: string;
  detail?: string;
}) {
  return (
    <div
      className={`console-status-strip tone-${tone}`}
      role="status"
      aria-live="polite"
    >
      <span className="signal-dot" aria-hidden="true" />
      <div className="console-status-copy">
        <span className="console-status-tone">{TONE_LABEL[tone]}</span>
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}
