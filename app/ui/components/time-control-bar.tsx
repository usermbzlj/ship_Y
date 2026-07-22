"use client";

import {
  TIME_SCALE_LABELS,
  TIME_SCALE_PRESETS,
  type TimeScalePreset,
  nearestTimeScalePreset,
} from "@/lib/sim/director";

const SCALE_SHORT: Record<TimeScalePreset, string> = {
  1: "1×",
  60: "1m",
  1_800: "30m",
  3_600: "1h",
  7_200: "2h",
  21_600: "6h",
  86_400: "1D",
};

function formatOwed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

export function TimeControlBar({
  timeScale,
  paused,
  effectiveTimeScale,
  fidelityLocked,
  owedSimSeconds,
  pauseTokens,
  onSetTimeScale,
  onTogglePause,
  disabled,
  pauseDisabled: pauseDisabledProp,
}: {
  timeScale: number;
  paused: boolean;
  effectiveTimeScale?: number;
  fidelityLocked?: boolean;
  owedSimSeconds?: number;
  pauseTokens?: string[];
  onSetTimeScale: (scale: number) => void;
  onTogglePause: () => void;
  disabled?: boolean;
  pauseDisabled?: boolean;
}) {
  const activePreset = nearestTimeScalePreset(timeScale);
  const effective =
    effectiveTimeScale !== undefined && Number.isFinite(effectiveTimeScale)
      ? effectiveTimeScale
      : timeScale;
  const showEffective =
    fidelityLocked || Math.abs(effective - timeScale) > 0.5;
  const owed = owedSimSeconds ?? 0;
  const tokens = pauseTokens ?? [];
  const pauseLabel = tokens.includes("llm-waiting")
    ? "决策中"
    : tokens.includes("mission-ended")
      ? "已抵达"
      : paused
        ? "继续"
        : "暂停";
  const pauseDisabled =
    Boolean(pauseDisabledProp) ||
    Boolean(disabled) ||
    tokens.includes("llm-waiting") ||
    tokens.includes("mission-ended");

  return (
    <div
      className={`time-control-bar${paused ? " is-paused" : ""}${disabled ? " is-disabled" : ""}`}
      role="group"
      aria-label="仿真时间控制"
    >
      <div className="time-control-meta">
        <span className="time-control-eyebrow">时间倍率</span>
        {showEffective && (
          <span
            className="fidelity-chip"
            role="status"
            title="保真度锁定：物理引擎正在限制有效推进倍率"
          >
            实际 {effective.toLocaleString("zh-CN")}×
          </span>
        )}
        {owed > 1 && (
          <span
            className="owed-chip"
            role="status"
            title="欠账追赶：尚未结算的仿真时间"
          >
            追赶 {formatOwed(owed)}
          </span>
        )}
      </div>

      <div className="scale-ladder" role="toolbar" aria-label="倍速阶梯">
        {TIME_SCALE_PRESETS.map((scale, index) => {
          const pressed = activePreset === scale && !paused;
          return (
            <button
              key={scale}
              type="button"
              className={pressed ? "active" : undefined}
              aria-pressed={pressed}
              aria-label={`${TIME_SCALE_LABELS[scale]}（快捷键 ${index + 1}）`}
              title={`${TIME_SCALE_LABELS[scale]} · ${index + 1}`}
              disabled={disabled}
              onClick={() => onSetTimeScale(scale)}
            >
              {SCALE_SHORT[scale]}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={`pause-button${paused ? " is-paused" : ""}${tokens.includes("llm-waiting") ? " thinking" : ""}`}
        aria-pressed={paused}
        aria-label={paused ? "继续模拟（Space）" : "暂停模拟（Space）"}
        title="快捷键 Space"
        disabled={pauseDisabled}
        onClick={onTogglePause}
      >
        <span className="pause-glyph" aria-hidden="true">
          {paused ? "▶" : "Ⅱ"}
        </span>
        {pauseLabel}
      </button>
    </div>
  );
}
