"use client";

import { useState } from "react";

export type AlertLevel = "watch" | "warning" | "critical";

export type AlertRingId = "A" | "B";

export interface ActiveAlert {
  id: string;
  level: AlertLevel;
  source: string;
  message: string;
  simulationSeconds: number;
  acknowledged: boolean;
  /** 可定位到舰务压力区检查器 */
  zoneId?: string;
  /** 可定位到舰务拓扑环卡片 / 该环首区 */
  ringId?: AlertRingId;
}

function isLocatable(alert: ActiveAlert): boolean {
  return Boolean(alert.zoneId || alert.ringId);
}

/**
 * 警报横幅 — 在顶栏下方显示当前活动警报，
 * 支持分级（注意/警告/紧急）、确认操作和自动消失。
 */
export function AlertBanner({
  alerts,
  onAcknowledge,
  onLocate,
}: {
  alerts: ActiveAlert[];
  onAcknowledge: (id: string) => void;
  onLocate?: (alert: ActiveAlert) => void;
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
              {onLocate && isLocatable(alert) && (
                <button
                  className="alert-locate"
                  onClick={() => onLocate(alert)}
                  type="button"
                  aria-label={`定位到舰务：${alert.message}`}
                >
                  定位
                </button>
              )}
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

type DetectZone = {
  zoneId: string;
  ring: AlertRingId;
  condition: string;
  hasBreach: boolean;
  observed: { pressurePa: number | null };
};

type DetectRotationRing = {
  id: string;
  artificialGravityG: number | null;
  vibrationMmPerS: number | null;
};

/**
 * 从遥测数据中检测警报条件。
 * 在协调器中每步调用，返回新触发的警报列表。
 */
export function detectAlerts(
  state: {
    atmosphere?: { pressurePa: number };
    thermal?: { coolantTemperatureK: number };
    journey?: {
      status: string;
      jumpDriveChargeKWh: number;
      jumpDriveCapacityKWh: number;
      jumpsCompleted?: number;
    };
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
    zones?: DetectZone[];
  } | null,
  simulationSeconds: number,
  existingAlertIds: Set<string>,
  rotation?: {
    rings: DetectRotationRing[];
  } | null,
  hullConsequence?: {
    hullIntegrity: number;
    jumpBlocked: boolean;
    jumpBlockReason: string | null;
    events: Array<{ cascadeStage: number }>;
  } | null,
): ActiveAlert[] {
  const newAlerts: ActiveAlert[] = [];
  const push = (
    id: string,
    level: AlertLevel,
    source: string,
    message: string,
    target?: { zoneId?: string; ringId?: AlertRingId },
  ) => {
    if (!existingAlertIds.has(id)) {
      newAlerts.push({
        id,
        level,
        source,
        message,
        simulationSeconds,
        acknowledged: false,
        ...(target?.zoneId ? { zoneId: target.zoneId } : {}),
        ...(target?.ringId ? { ringId: target.ringId } : {}),
      });
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

  // 舱压 / 破口警报（带 zoneId 以便定位到舰务）
  const zones = compartments?.zones ?? [];
  const breachedZones = zones.filter((zone) => zone.hasBreach);
  if (breachedZones.length > 0) {
    for (const zone of breachedZones.slice(0, 3)) {
      push(
        `breach-${zone.zoneId}`,
        "critical",
        "船体破口",
        `${zone.zoneId} 活动破口：禁跃迁；未修将级联同环生保/冷却`,
        { zoneId: zone.zoneId, ringId: zone.ring },
      );
    }
    if (breachedZones.length > 3) {
      const extra = breachedZones[3];
      push(
        "breach-active-more",
        "critical",
        "壳体威胁",
        `另有 ${breachedZones.length - 3} 处活动破口`,
        { zoneId: extra.zoneId, ringId: extra.ring },
      );
    }
  } else if (compartments?.activeBreaches != null && compartments.activeBreaches > 0) {
    push(
      "breach-active",
      "critical",
      "壳体威胁",
      `检测到 ${compartments.activeBreaches} 处活动破口；跃迁联锁已生效`,
    );
  }

  if (hullConsequence?.jumpBlocked) {
    push(
      "hull-jump-interlock",
      "critical",
      "壳体威胁联锁",
      hullConsequence.jumpBlockReason ??
        `壳体完整度 ${(hullConsequence.hullIntegrity * 100).toFixed(0)}%，禁止跃迁`,
    );
  }
  if (
    hullConsequence &&
    hullConsequence.events.some((event) => event.cascadeStage >= 1)
  ) {
    push(
      "hull-cascade-active",
      "warning",
      "壳体级联",
      "未修破口已触发同环设备级联故障，需封堵并检修 AHU/泵/轴承/休眠馈线",
    );
  }

  const lowPressureZones = zones
    .filter(
      (zone) =>
        zone.observed.pressurePa !== null &&
        zone.observed.pressurePa < 75_000,
    )
    .sort(
      (left, right) =>
        (left.observed.pressurePa ?? 0) - (right.observed.pressurePa ?? 0),
    );
  if (lowPressureZones.length > 0) {
    const worst = lowPressureZones[0];
    const kPa = ((worst.observed.pressurePa ?? 0) / 1_000).toFixed(1);
    push(
      `pressure-low-${worst.zoneId}`,
      "warning",
      "生命保障",
      `${worst.zoneId} 压力 ${kPa} kPa，低于 75 kPa 安全下限`,
      { zoneId: worst.zoneId, ringId: worst.ring },
    );
  } else if (
    compartments?.observedPressureMinPa != null &&
    compartments.observedPressureMinPa < 75_000
  ) {
    push(
      "pressure-low",
      "warning",
      "生命保障",
      "至少一个压力区低于 75 kPa 安全下限",
    );
  }

  // 旋转环重力 / 振感异常
  for (const ring of rotation?.rings ?? []) {
    const ringId: AlertRingId | null =
      ring.id === "ring-a" ? "A" : ring.id === "ring-b" ? "B" : null;
    if (!ringId) continue;
    const label = `${ringId} 环`;
    const vib = ring.vibrationMmPerS;
    if (vib != null && vib > 7.1) {
      push(
        `ring-vibration-critical-${ringId}`,
        "critical",
        "旋转结构",
        `${label} 轴承振感 ${vib.toFixed(1)} mm/s，危险`,
        { ringId },
      );
    } else if (vib != null && vib > 3.5) {
      push(
        `ring-vibration-watch-${ringId}`,
        "watch",
        "旋转结构",
        `${label} 轴承振感 ${vib.toFixed(1)} mm/s，需关注`,
        { ringId },
      );
    }
    const gravity = ring.artificialGravityG;
    if (gravity != null && (gravity < 0.8 || gravity > 1.15)) {
      push(
        `ring-gravity-critical-${ringId}`,
        "critical",
        "旋转结构",
        `${label} 人工重力 ${gravity.toFixed(3)} g，严重偏离标称`,
        { ringId },
      );
    } else if (gravity != null && (gravity < 0.92 || gravity > 1.08)) {
      push(
        `ring-gravity-watch-${ringId}`,
        "watch",
        "旋转结构",
        `${label} 人工重力 ${gravity.toFixed(3)} g，偏离标称`,
        { ringId },
      );
    }
  }

  // 跃迁就绪通知（ID 含已完成跃迁次数，便于下一充电周期再次触发）
  if (state?.journey?.status === "ready") {
    const jumpCycle = state.journey.jumpsCompleted ?? 0;
    push(
      `jump-ready:${jumpCycle}`,
      "watch",
      "跃迁控制",
      "跃迁储能完成，等待舰长决策",
    );
  }

  return newAlerts;
}
