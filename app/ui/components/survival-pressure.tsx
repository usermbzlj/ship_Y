"use client";

import type { SimulationWorkerSurvivalTelemetry } from "@/lib/sim/protocol";

type SurvivalTone = "nominal" | "watch" | "critical";

type SurvivalStatus = {
  label: string;
  tone: SurvivalTone;
  note: string;
};

function formatMass(kg: number): string {
  const safe = Math.max(0, kg);
  if (safe >= 1_000) {
    const tons = safe / 1_000;
    return tons >= 100
      ? `${tons.toFixed(0)} 吨`
      : `${tons.toFixed(1)} 吨`;
  }
  if (safe >= 10) return `${safe.toFixed(0)} kg`;
  return `${safe.toFixed(1)} kg`;
}

function formatExposure(personSeconds: number): string {
  const safe = Math.max(0, personSeconds);
  if (safe < 1) return "无";
  if (safe < 3_600) return `${Math.round(safe)} 人·秒`;
  if (safe < 86_400) {
    return `${(safe / 3_600).toFixed(1)} 人·时`;
  }
  return `${(safe / 86_400).toFixed(2)} 人·日`;
}

function resolveStatus(
  foodDryKg: number,
  starvationExposurePersonSeconds: number,
): SurvivalStatus {
  if (foodDryKg <= 0) {
    return {
      label: "断粮",
      tone: "critical",
      note: "干粮耗尽，清醒人口正在承受饥饿折损",
    };
  }
  if (starvationExposurePersonSeconds > 0) {
    return {
      label: "吃紧",
      tone: "critical",
      note: "口粮曾出现缺口，饥饿暴露已计入账本",
    };
  }
  // ~10% of default launch stores (1,200 t) — visible pressure before empty.
  if (foodDryKg < 120_000) {
    return {
      label: "吃紧",
      tone: "watch",
      note: "干粮余量偏低，航程口粮压力上升",
    };
  }
  return {
    label: "充足",
    tone: "nominal",
    note: "干粮与口粮消耗仍在可控范围",
  };
}

export function SurvivalPressure({
  survival,
}: {
  survival: SimulationWorkerSurvivalTelemetry | null;
}) {
  const foodDryKg = survival?.foodDryKg ?? null;
  const rationConsumed = survival?.rationFoodConsumedKg ?? null;
  const starvation = survival?.starvationExposurePersonSeconds ?? null;
  const status =
    foodDryKg === null || starvation === null
      ? null
      : resolveStatus(foodDryKg, starvation);

  return (
    <section
      className={`survival-pressure${status ? ` tone-${status.tone}` : ""}`}
      aria-label="生存压力"
    >
      <div className="survival-pressure-head">
        <h3>生存压力</h3>
        {status ? (
          <span className={`survival-status tone-${status.tone}`}>
            {status.label}
          </span>
        ) : (
          <span className="survival-status tone-watch">待同步</span>
        )}
      </div>

      <div className="survival-metrics">
        <div>
          <span>干粮余量</span>
          <strong>{foodDryKg === null ? "—" : formatMass(foodDryKg)}</strong>
        </div>
        <div>
          <span>已耗口粮</span>
          <strong>
            {rationConsumed === null ? "—" : formatMass(rationConsumed)}
          </strong>
        </div>
        <div>
          <span>饥饿暴露</span>
          <strong>
            {starvation === null ? "—" : formatExposure(starvation)}
          </strong>
        </div>
      </div>

      <p className="survival-note">
        {status?.note ?? "等待仿真遥测同步生存账本"}
      </p>
    </section>
  );
}
