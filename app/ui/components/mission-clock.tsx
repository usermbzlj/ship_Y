"use client";

import { useMemo } from "react";
import {
  TIME_SCALE_LABELS,
  isTimeScalePreset,
  nearestTimeScalePreset,
} from "@/lib/sim/director";

function splitElapsed(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return {
    days: Math.floor(safe / 86_400),
    hours: Math.floor((safe % 86_400) / 3_600),
    minutes: Math.floor((safe % 3_600) / 60),
    seconds: safe % 60,
  };
}

function formatRate(scale: number): string {
  if (isTimeScalePreset(scale)) return TIME_SCALE_LABELS[scale];
  if (scale >= 86_400 && scale % 86_400 === 0) {
    return `${scale / 86_400}D/s`;
  }
  if (scale >= 3_600 && scale % 3_600 === 0) {
    return `${scale / 3_600}h/s`;
  }
  if (scale >= 60 && scale % 60 === 0) {
    return `${scale / 60}m/s`;
  }
  return `${scale.toLocaleString("zh-CN")}×`;
}

function DigitGroup({
  value,
  unit,
  digits,
}: {
  value: number;
  unit: string;
  digits: number;
}) {
  const text = String(value).padStart(digits, "0");
  return (
    <span className="clock-group">
      <span className="clock-digits" aria-hidden="true">
        {text.split("").map((ch, i) => (
          <span className="clock-digit" key={`${unit}-${i}-${ch}`}>
            {ch}
          </span>
        ))}
      </span>
      <span className="clock-unit">{unit}</span>
    </span>
  );
}

export function MissionClock({
  simulationSeconds,
  timeScale,
  effectiveTimeScale,
  paused,
  progressLabel,
}: {
  simulationSeconds: number;
  timeScale: number;
  effectiveTimeScale?: number;
  paused?: boolean;
  progressLabel?: string | null;
}) {
  const parts = useMemo(
    () => splitElapsed(simulationSeconds),
    [simulationSeconds],
  );
  const effective =
    effectiveTimeScale !== undefined && Number.isFinite(effectiveTimeScale)
      ? effectiveTimeScale
      : timeScale;
  const rateText = paused ? "已暂停" : formatRate(effective);
  const requestedHint =
    !paused &&
    Math.abs(effective - timeScale) > 0.5
      ? `请求 ${formatRate(nearestTimeScalePreset(timeScale))}`
      : null;

  return (
    <div
      className={`mission-clock${paused ? " is-paused" : ""}`}
      role="timer"
      aria-live="polite"
      aria-label={`任务历时 ${parts.days} 天 ${parts.hours} 时 ${parts.minutes} 分 ${parts.seconds} 秒，有效倍率 ${rateText}`}
    >
      <div className="mission-clock-head">
        <span>任务历时</span>
        <span className="mission-clock-rate" title={requestedHint ?? undefined}>
          {rateText}
        </span>
      </div>
      <div className="mission-clock-face">
        <DigitGroup value={parts.days} unit="D" digits={3} />
        <DigitGroup value={parts.hours} unit="H" digits={2} />
        <DigitGroup value={parts.minutes} unit="M" digits={2} />
        <DigitGroup value={parts.seconds} unit="S" digits={2} />
      </div>
      {progressLabel ? (
        <small className="mission-progress">{progressLabel}</small>
      ) : null}
    </div>
  );
}
