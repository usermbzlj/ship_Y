"use client";

import { useState } from "react";

export type AlertLevel = "watch" | "warning" | "critical";

export interface ActiveAlert {
  id: string;
  level: AlertLevel;
  source: string;
  message: string;
  simulationSeconds: number;
  acknowledged: boolean;
}

/**
 * 警报横幅 — 在顶栏下方显示当前活动警报，
 * 支持分级（注意/警告/紧急）、确认操作和自动消失。
 */
export function AlertBanner({
  alerts,
  onAcknowledge,
}: {
  alerts: ActiveAlert[];
  onAcknowledge: (id: string) => void;
}) {
  const activeAlerts = alerts.filter((a) => !a.acknowledged);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visibleAlerts = activeAlerts.filter((a) => !dismissed.has(a.id));

  if (visibleAlerts.length === 0) return null;

  const highestLevel: AlertLevel = visibleAlerts.some(
    (a) => a.level === "critical",
  )
    ? "critical"
    : visibleAlerts.some((a) => a.level === "warning")
      ? "warning"
      : "watch";

  return (
    <div
      className={`alert-banner alert-banner-${highestLevel}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="alert-banner-content">
        <span className="alert-banner-icon">
          {highestLevel === "critical" ? "⚠" : highestLevel === "warning" ? "△" : "○"}
        </span>
        <div className="alert-banner-messages">
          {visibleAlerts.slice(0, 3).map((alert) => (
            <div className="alert-banner-item" key={alert.id}>
              <span className="alert-source">{alert.source}</span>
              <span className="alert-message">{alert.message}</span>
              <button
                className="alert-ack"
                onClick={() => {
                  onAcknowledge(alert.id);
                  setDismissed((prev) => new Set(prev).add(alert.id));
                }}
                type="button"
                aria-label={`确认警报：${alert.message}`}
              >
                确认
              </button>
            </div>
          ))}
          {visibleAlerts.length > 3 && (
            <span className="alert-overflow">
              +{visibleAlerts.length - 3} 条更多警报
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 从遥测数据中检测警报条件。
 * 在协调器中每步调用，返回新触发的警报列表。
 */
export function detectAlerts(
  state: {
    atmosphere?: { pressurePa: number };
    thermal?: { coolantTemperatureK: number };
    journey?: { status: string; jumpDriveChargeKWh: number; jumpDriveCapacityKWh: number };
    population?: { deceased: number };
  } | null,
  electrical: {
    observed: {
      averageBusVoltageV: number | null;
      averageBusFrequencyHz: number | null;
    };
    truth: {
      unservedPowerKw: number;
    };
  } | null,
  cooling: {
    observed: { averageCoolantTemperatureK: number | null };
  } | null,
  compartments: {
    observedPressureMinPa: number | null;
    activeBreaches: number;
  } | null,
  simulationSeconds: number,
  existingAlertIds: Set<string>,
): ActiveAlert[] {
  const newAlerts: ActiveAlert[] = [];
  const push = (id: string, level: AlertLevel, source: string, message: string) => {
    if (!existingAlertIds.has(id)) {
      newAlerts.push({ id, level, source, message, simulationSeconds, acknowledged: false });
    }
  };

  // 电力警报
  if (electrical?.observed.averageBusVoltageV !== null && electrical?.observed.averageBusVoltageV !== undefined) {
    if (electrical.observed.averageBusVoltageV < 10_000) {
      push("power-voltage-critical", "critical", "电网保护", "母线电压严重偏低，负载切除可能已触发");
    } else if (electrical.observed.averageBusVoltageV < 10_450) {
      push("power-voltage-watch", "watch", "电网监测", "母线电压低于标称范围");
    }
  }
  if (electrical?.truth.unservedPowerKw != null && electrical.truth.unservedPowerKw > 1000) {
    push("power-unserved", "warning", "配电系统", `存在 ${(electrical.truth.unservedPowerKw / 1000).toFixed(0)} MW 未服务负载`);
  }

  // 热管理警报
  if (cooling?.observed.averageCoolantTemperatureK != null) {
    if (cooling.observed.averageCoolantTemperatureK > 380) {
      push("thermal-critical", "critical", "热管理", "冷却母线温度超过安全阈值，设备过热风险");
    } else if (cooling.observed.averageCoolantTemperatureK > 355) {
      push("thermal-watch", "watch", "热管理", "冷却母线温度偏高");
    }
  }

  // 舱压警报
  if (compartments?.activeBreaches != null && compartments.activeBreaches > 0) {
    push("breach-active", "critical", "结构完整性", `检测到 ${compartments.activeBreaches} 处活动破口`);
  }
  if (compartments?.observedPressureMinPa != null && compartments.observedPressureMinPa < 75_000) {
    push("pressure-low", "warning", "生命保障", "至少一个压力区低于 75 kPa 安全下限");
  }

  // 跃迁就绪通知
  if (state?.journey?.status === "ready") {
    push("jump-ready", "watch", "跃迁控制", "跃迁储能完成，等待舰长决策");
  }

  return newAlerts;
}
