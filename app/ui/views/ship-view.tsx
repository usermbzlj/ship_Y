"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ShipState,
  SystemTone,
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  WaterRecoveryTelemetry,
  MaintenanceTelemetry,
} from "../types";
import type {
  CompartmentZoneCondition,
  CompartmentZoneTelemetry,
  RotationTelemetry,
} from "@/lib/sim/protocol";
import {
  ZONE_CATALOG,
  ZONE_ROLE_LABELS_ZH,
  type ZoneRole,
} from "@/lib/sim/compartments";
import { StatusPill } from "../components/status-pill";
import { HullSection, HullZonePicker } from "../components/hull-section";

type ZoneTelemetry = CompartmentZoneTelemetry;

function zoneLabel(zone: ZoneTelemetry): string {
  return zone.labelZh || zone.zoneId;
}

function zoneRoleLabel(zone: ZoneTelemetry): string {
  const role = zone.role as ZoneRole | undefined;
  if (role && role in ZONE_ROLE_LABELS_ZH) {
    return ZONE_ROLE_LABELS_ZH[role];
  }
  return zone.role || "—";
}

function formatPa(value: number | null, digits = 1): string {
  return value === null ? "—" : `${(value / 1_000).toFixed(digits)} kPa`;
}

function formatTemp(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} K`;
}

function bearingHint(vibrationMmPerS: number | null | undefined): string {
  if (vibrationMmPerS === null || vibrationMmPerS === undefined) {
    return "轴承振感建立中";
  }
  if (vibrationMmPerS > 7.1) {
    return `轴承振感 ${vibrationMmPerS.toFixed(1)} mm/s · 危险`;
  }
  if (vibrationMmPerS > 3.5) {
    return `轴承振感 ${vibrationMmPerS.toFixed(1)} mm/s · 关注`;
  }
  return `轴承振感 ${vibrationMmPerS.toFixed(1)} mm/s`;
}

function causalSentence(zone: ZoneTelemetry): string {
  const ring = zone.ring;
  const roleText = zoneRoleLabel(zone);
  const purpose = zone.purposeZh;
  const roleClause = purpose
    ? `本区为「${roleText}」：${purpose.replace(/。$/, "")}`
    : `本区属 ${ring} 环「${roleText}」`;

  if (zone.hasBreach) {
    return `${roleClause}。活动破口会泄压并触发壳体威胁联锁（禁跃迁、该环推进降额）；未及时封堵会随时间撕大并级联同环 AHU/冷却泵/轴承/休眠馈线。`;
  }
  if (zone.condition === "critical") {
    return `${roleClause}。当前读数已越界：相邻区经门/风管会继续耦合交换；${ring} 环空气处理机仍按整环均分捕集 CO₂。`;
  }
  if (zone.condition === "watch") {
    return `${roleClause}。关注态下仍与相邻区经门/风管耦合；该环空气处理机按整环均分捕集 CO₂。`;
  }
  if (zone.condition === "offline") {
    return `${roleClause}。遥测尚未就绪；联机后本区将与相邻区经门/风管耦合，并由 ${ring} 环空气处理机均分捕集 CO₂。`;
  }
  return `${roleClause}。破口会使本区与相邻区经门/风管耦合泄压；该环空气处理机按整环均分捕集 CO₂。`;
}

function pickDefaultZoneId(zones: ZoneTelemetry[]): string {
  const priority =
    zones.find((zone) => zone.hasBreach) ??
    zones.find((zone) => zone.condition === "critical") ??
    zones.find((zone) => zone.condition === "watch") ??
    zones.find((zone) => zone.zoneId === "A-01") ??
    zones[0];
  return priority?.zoneId ?? "A-01";
}

function conditionLabel(condition: CompartmentZoneCondition): string {
  switch (condition) {
    case "critical":
      return "危险";
    case "watch":
      return "关注";
    case "offline":
      return "离线";
    default:
      return "名义";
  }
}

function spurConditionLabel(
  condition: "nominal" | "degraded" | "stuck-closed" | undefined,
): string {
  switch (condition) {
    case "degraded":
      return "降级";
    case "stuck-closed":
      return "关死";
    case "nominal":
    default:
      return "名义";
  }
}

/**
 * 右列系统概览的一行。
 *
 * `detail` 是可选的次级说明行，承载转速 / 轴承、送风分环流量、累计未送达等
 * 单靠一个读数说不清的量；`highlight` 供告警定位时闪烁对应的居住环。
 */
interface SystemRow {
  name: string;
  value: string;
  /** 0–100 的表征占比，仅用于条形长度，不是权威量纲。 */
  load: number;
  detail?: string;
  highlight?: boolean;
}

function offlineZones(): ZoneTelemetry[] {
  return ZONE_CATALOG.map((entry) => ({
    zoneId: entry.id,
    role: entry.role,
    labelZh: entry.labelZh,
    purposeZh: entry.purposeZh,
    ring: entry.ring,
    condition: "offline" as const,
    hasBreach: false,
    observed: {
      pressurePa: null,
      temperatureK: null,
      oxygenPartialPressurePa: null,
      carbonDioxidePartialPressurePa: null,
    },
    quality: {
      pressure: "offline" as const,
      temperature: "offline" as const,
      oxygen: "offline" as const,
      carbonDioxide: "offline" as const,
    },
    newestSampleAgeSeconds: null,
  }));
}

export function ShipView({
  state,
  compartments,
  cooling,
  electrical,
  rotation,
  waterRecovery,
  maintenance,
  hullConsequence = null,
  focusZoneId = null,
  focusRingId = null,
  focusToken = 0,
}: {
  state: ShipState | null;
  compartments: CompartmentTelemetry | null;
  cooling: CoolingTelemetry | null;
  electrical: ElectricalTelemetry | null;
  rotation: RotationTelemetry["observed"] | null;
  waterRecovery: WaterRecoveryTelemetry | null;
  maintenance: MaintenanceTelemetry | null;
  hullConsequence?: import("@/lib/sim/protocol").HullConsequenceTelemetry | null;
  /** 警报深链：选中并高亮该压力区 */
  focusZoneId?: string | null;
  /** 警报深链：高亮拓扑环卡片，并选中该环首区（无 zoneId 时） */
  focusRingId?: "A" | "B" | null;
  /** 递增以在同一目标上重复触发脉冲 */
  focusToken?: number;
}) {
  const zones = compartments?.zones ?? offlineZones();
  const [selectedZoneId, setSelectedZoneId] = useState(() =>
    pickDefaultZoneId(zones),
  );
  const [prevFocusToken, setPrevFocusToken] = useState(focusToken);
  const [focusPulse, setFocusPulse] = useState(false);
  const [highlightedRingId, setHighlightedRingId] = useState<"A" | "B" | null>(
    null,
  );

  // Adjust selection during render when the selected zone leaves the list.
  if (!zones.some((zone) => zone.zoneId === selectedZoneId)) {
    setSelectedZoneId(pickDefaultZoneId(zones));
  }

  // Adjust selection / pulse during render when deep-link focusToken changes.
  if (focusToken !== prevFocusToken) {
    setPrevFocusToken(focusToken);

    let targetZoneId = focusZoneId;
    if (
      (!targetZoneId || !zones.some((zone) => zone.zoneId === targetZoneId)) &&
      focusRingId
    ) {
      targetZoneId =
        zones.find((zone) => zone.ring === focusRingId)?.zoneId ?? null;
    }

    if (targetZoneId && zones.some((zone) => zone.zoneId === targetZoneId)) {
      setSelectedZoneId(targetZoneId);
    }

    const ringFromZone = targetZoneId
      ? (zones.find((zone) => zone.zoneId === targetZoneId)?.ring ?? null)
      : null;
    setHighlightedRingId(focusRingId ?? ringFromZone);
    setFocusPulse(true);
  }

  // Timer-only effect: clear the focus pulse after a short highlight window.
  useEffect(() => {
    if (!focusPulse) return;
    const timer = window.setTimeout(() => {
      setFocusPulse(false);
      setHighlightedRingId(null);
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [focusPulse, focusToken]);

  const criticalZones = zones.filter(
    (zone) => zone.condition === "critical",
  ).length;
  const watchZones = zones.filter((zone) => zone.condition === "watch").length;
  const offlineZoneCount = zones.filter(
    (zone) => zone.condition === "offline",
  ).length;
  const breachZones = zones.filter((zone) => zone.hasBreach).length;
  const overallTone: SystemTone =
    criticalZones > 0 || breachZones > 0
      ? "critical"
      : watchZones > 0 || offlineZoneCount > 0
        ? "watch"
        : "nominal";

  const electricalReading = (
    targetId: string,
    quantity: ElectricalTelemetry["sensors"][number]["quantity"],
  ) =>
    electrical?.sensors.find(
      (sensor) =>
        sensor.targetId === targetId && sensor.quantity === quantity,
    )?.value ?? null;
  const busAServedPowerKw = electricalReading("bus-a", "servedPowerKw");
  const busBServedPowerKw = electricalReading("bus-b", "servedPowerKw");
  const ringA = rotation?.rings.find((ring) => ring.id === "ring-a") ?? null;
  const ringB = rotation?.rings.find((ring) => ring.id === "ring-b") ?? null;

  const airHandlers = compartments?.airHandlers.controllers ?? [];
  const airHandlerA = airHandlers.find((handler) => handler.ring === "A");
  const airHandlerB = airHandlers.find((handler) => handler.ring === "B");
  const airHandlerSummary =
    airHandlers.length === 0
      ? "建立中"
      : `${airHandlers.filter((h) => h.scrubberEnabled).length}/${airHandlers.length} 吸附在线 · 均流 ${(
          (airHandlers.reduce((t, h) => t + h.commandedFlowFraction, 0) /
            airHandlers.length) *
          100
        ).toFixed(0)}%`;
  const spurA = waterRecovery?.distributionSpurs.find(
    (spur) => spur.ring === "a",
  );
  const spurB = waterRecovery?.distributionSpurs.find(
    (spur) => spur.ring === "b",
  );
  const undeliveredPotableKg = waterRecovery?.undeliveredPotableKg ?? 0;
  const coolingSpurA = cooling?.habitatThermalDeliverySpurs.find(
    (spur) => spur.ring === "a",
  );
  const coolingSpurB = cooling?.habitatThermalDeliverySpurs.find(
    (spur) => spur.ring === "b",
  );
  const undeliveredHabitatCoolingJ =
    cooling?.undeliveredHabitatCoolingJ ?? 0;

  const selectedZone =
    zones.find((zone) => zone.zoneId === selectedZoneId) ?? zones[0] ?? null;

  const roleLegend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const zone of zones) {
      const label = zoneRoleLabel(zone);
      if (!label || label === "—") continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .slice(0, 8);
  }, [zones]);

  const networks: SystemRow[] = state
    ? [
        {
          name: "聚变发电",
          value:
            electrical?.observed.totalReactorOutputKw != null
              ? `${(electrical.observed.totalReactorOutputKw / 1_000).toFixed(0)} MW`
              : "建立中",
          load:
            electrical?.observed.totalReactorOutputKw != null
              ? Math.min(
                  100,
                  (electrical.observed.totalReactorOutputKw / 1_350_000) * 100,
                )
              : 0,
        },
        {
          name: "A 母线供给",
          value:
            busAServedPowerKw != null
              ? `${(busAServedPowerKw / 1_000).toFixed(0)} MW`
              : "建立中",
          load:
            busAServedPowerKw != null
              ? Math.min(100, (busAServedPowerKw / 675_000) * 100)
              : 0,
        },
        {
          name: "B 母线供给",
          value:
            busBServedPowerKw != null
              ? `${(busBServedPowerKw / 1_000).toFixed(0)} MW`
              : "建立中",
          load:
            busBServedPowerKw != null
              ? Math.min(100, (busBServedPowerKw / 675_000) * 100)
              : 0,
        },
        {
          name: "冷却散热",
          value:
            cooling?.observed.totalRadiatedPowerW != null
              ? `${(cooling.observed.totalRadiatedPowerW / 1_000_000).toFixed(1)} MW`
              : "建立中",
          load:
            cooling?.observed.totalRadiatedPowerW != null
              ? Math.min(
                  100,
                  (cooling.observed.totalRadiatedPowerW / 800_000_000) * 100,
                )
              : 0,
          detail:
            undeliveredHabitatCoolingJ > 0
              ? `居住热累计未送达 ${(undeliveredHabitatCoolingJ / 1_000_000).toFixed(1)} MJ`
              : undefined,
        },
        {
          name: "冷却母线",
          value:
            cooling?.observed.averageCoolantTemperatureK != null
              ? `${cooling.observed.averageCoolantTemperatureK.toFixed(1)} K`
              : "建立中",
          load:
            cooling?.observed.averageCoolantTemperatureK != null
              ? Math.min(
                  100,
                  ((cooling.observed.averageCoolantTemperatureK - 280) / 120) *
                    100,
                )
              : 0,
        },
        {
          name: "热支路 A",
          value: coolingSpurA
            ? `${spurConditionLabel(coolingSpurA.condition)}${
                coolingSpurA.lastDeliveryShortfallJ > 0
                  ? ` · 短欠 ${(coolingSpurA.lastDeliveryShortfallJ / 1_000).toFixed(1)} kJ`
                  : ""
              }`
            : "建立中",
          load: coolingSpurA
            ? Math.min(100, coolingSpurA.effectiveDeliveryFraction * 100)
            : 0,
        },
        {
          name: "热支路 B",
          value: coolingSpurB
            ? `${spurConditionLabel(coolingSpurB.condition)}${
                coolingSpurB.lastDeliveryShortfallJ > 0
                  ? ` · 短欠 ${(coolingSpurB.lastDeliveryShortfallJ / 1_000).toFixed(1)} kJ`
                  : ""
              }`
            : "建立中",
          load: coolingSpurB
            ? Math.min(100, coolingSpurB.effectiveDeliveryFraction * 100)
            : 0,
        },
        {
          name: "水回收 A",
          value:
            waterRecovery?.observed?.potableKgByRing?.a != null
              ? `${(waterRecovery.observed.potableKgByRing.a / 1_000).toFixed(0)} t`
              : "建立中",
          load:
            waterRecovery?.observed?.potableKgByRing?.a != null
              ? Math.min(
                  100,
                  (waterRecovery.observed.potableKgByRing.a / 2_000_000) * 100,
                )
              : 0,
          detail:
            undeliveredPotableKg > 0
              ? `全舰饮用水累计未送达 ${undeliveredPotableKg.toFixed(0)} kg`
              : undefined,
        },
        {
          name: "水回收 B",
          value:
            waterRecovery?.observed?.potableKgByRing?.b != null
              ? `${(waterRecovery.observed.potableKgByRing.b / 1_000).toFixed(0)} t`
              : "建立中",
          load:
            waterRecovery?.observed?.potableKgByRing?.b != null
              ? Math.min(
                  100,
                  (waterRecovery.observed.potableKgByRing.b / 2_000_000) * 100,
                )
              : 0,
        },
        {
          name: "水支路 A",
          value: spurA
            ? `${spurConditionLabel(spurA.condition)}${
                spurA.lastDeliveryShortfallKg > 0
                  ? ` · 短欠 ${spurA.lastDeliveryShortfallKg.toFixed(1)} kg`
                  : ""
              }`
            : "建立中",
          load: spurA ? Math.min(100, spurA.effectiveDeliveryFraction * 100) : 0,
        },
        {
          name: "水支路 B",
          value: spurB
            ? `${spurConditionLabel(spurB.condition)}${
                spurB.lastDeliveryShortfallKg > 0
                  ? ` · 短欠 ${spurB.lastDeliveryShortfallKg.toFixed(1)} kg`
                  : ""
              }`
            : "建立中",
          load: spurB ? Math.min(100, spurB.effectiveDeliveryFraction * 100) : 0,
        },
        {
          name: "空气处理",
          value: airHandlerSummary,
          load:
            airHandlers.length > 0
              ? Math.min(
                  100,
                  (airHandlers.reduce(
                    (total, handler) => total + handler.commandedFlowFraction,
                    0,
                  ) /
                    airHandlers.length) *
                    100,
                )
              : 0,
          detail:
            airHandlerA || airHandlerB
              ? `A 流 ${((airHandlerA?.commandedFlowFraction ?? 0) * 100).toFixed(0)}% · B 流 ${((airHandlerB?.commandedFlowFraction ?? 0) * 100).toFixed(0)}%`
              : compartments
                ? `舱压均 ${formatPa(compartments.observedPressureAveragePa)}`
                : "等待舱室总线",
        },
        {
          name: "居住环 A",
          value:
            ringA?.artificialGravityG != null
              ? `${ringA.artificialGravityG.toFixed(3)} g`
              : "建立中",
          load:
            ringA?.artificialGravityG != null
              ? Math.min(100, Math.max(0, ringA.artificialGravityG * 100))
              : 0,
          detail:
            ringA?.relativeRpm != null
              ? `${ringA.relativeRpm >= 0 ? "+" : ""}${ringA.relativeRpm.toFixed(3)} rpm · ${bearingHint(ringA.vibrationMmPerS)}`
              : bearingHint(ringA?.vibrationMmPerS),
          highlight: highlightedRingId === "A" && focusPulse,
        },
        {
          name: "居住环 B",
          value:
            ringB?.artificialGravityG != null
              ? `${ringB.artificialGravityG.toFixed(3)} g`
              : "建立中",
          load:
            ringB?.artificialGravityG != null
              ? Math.min(100, Math.max(0, ringB.artificialGravityG * 100))
              : 0,
          detail:
            ringB?.relativeRpm != null
              ? `${ringB.relativeRpm >= 0 ? "+" : ""}${ringB.relativeRpm.toFixed(3)} rpm · ${bearingHint(ringB.vibrationMmPerS)}`
              : bearingHint(ringB?.vibrationMmPerS),
          highlight: highlightedRingId === "B" && focusPulse,
        },
      ]
    : [];

  return (
    <section className="view-grid detail-view" aria-label="舰体系统">
      <div className="panel hull-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">HULL SECTION</span>
            <h2>舰体剖视与破口</h2>
          </div>
          <StatusPill
            tone={
              hullConsequence && hullConsequence.hullIntegrity < 0.92
                ? "critical"
                : overallTone
            }
          >
            {hullConsequence
              ? `完整度 ${(hullConsequence.hullIntegrity * 100).toFixed(0)}% · 破口 ${hullConsequence.activeBreachCount}`
              : criticalZones > 0
              ? `${criticalZones} 区危险`
              : breachZones > 0
                ? `${breachZones} 区破口`
                : watchZones > 0
                  ? `${watchZones} 区关注`
                  : offlineZoneCount > 0
                    ? `${offlineZoneCount} 区离线`
                    : "48 区正常"}
          </StatusPill>
        </div>
        <HullSection
          zones={zones}
          selectedZoneId={selectedZoneId}
          onSelectZone={setSelectedZoneId}
          focusPulse={focusPulse}
        />
        <p className="panel-note">
          工程脊柱与休眠舱群不在本 48 区大气网内；休眠为环级供电负载。
        </p>
      </div>
      <div className="panel network-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">LIVE NETWORKS</span>
            <h2>实时负载</h2>
          </div>
        </div>
        <div className="network-list">
          {networks.map((row) => (
            <div
              className={`network-row${row.highlight ? " network-row-focus" : ""}`}
              key={row.name}
            >
              <span>{row.name}</span>
              <div className="meter">
                <i style={{ width: `${row.load}%` }} />
              </div>
              <strong>{row.value}</strong>
              {row.detail && <small>{row.detail}</small>}
            </div>
          ))}
        </div>
        <p className="panel-note">
          {maintenance?.activeTasks[0]
            ? `${maintenance.activeTasks[0].id} · ${maintenance.activeTasks[0].assetId} · ${maintenance.activeTasks[0].assignedRobotId} / ${maintenance.activeTasks[0].assignedCrewId}${maintenance.activeTasks[0].blockedReason ? ` · 阻塞：${maintenance.activeTasks[0].blockedReason}` : ""}`
            : maintenance
              ? "维修机器人待命；备件只会在任务创建时锁定并消耗。"
              : "正在连接维修诊断与备件账本。"}
        </p>
      </div>
      <div className="panel sector-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">PRESSURE SECTORS</span>
            <h2>48 个环段压力区（按功能区带命名）</h2>
          </div>
        </div>
        <div className="sector-body">
          {roleLegend.length > 0 && (
            <div className="sector-role-legend" aria-label="区带角色图例">
              {roleLegend.map(([role, count]) => (
                <span key={role}>
                  {role}
                  <i>{count}</i>
                </span>
              ))}
            </div>
          )}
          <HullZonePicker
            zones={zones}
            selectedZoneId={selectedZoneId}
            onSelectZone={setSelectedZoneId}
          />
        </div>
        <p className="panel-note">
          {compartments
            ? compartments.fidelityLimited
              ? `局部瞬态求解已接管：时间倍率由 ${compartments.requestedTimeScale.toLocaleString("zh-CN")}× 自动限至 ${compartments.effectiveTimeScale.toLocaleString("zh-CN")}×；外逸气体 ${compartments.totalVentedGasKg.toFixed(2)} kg。`
              : `传感压力 ${
                  compartments.observedPressureMinPa === null
                    ? "等待首批延迟读数"
                    : `${(compartments.observedPressureMinPa / 1_000).toFixed(2)}–${((compartments.observedPressureMaxPa ?? 0) / 1_000).toFixed(2)} kPa`
                }；当前采用 ${compartments.fidelityMode === "equilibrium-fast" ? "平衡态快速求解" : "瞬态细分求解"}。`
            : "正在连接 48 区压力遥测总线。"}
        </p>
      </div>
      <div
        className={`panel inspector-panel${focusPulse ? " zone-inspector-focus" : ""}`}
      >
        {selectedZone && (
          <>
            <div className="panel-heading compact">
              <div>
                <span className="eyebrow">ZONE INSPECTOR</span>
                <h2>
                  {zoneLabel(selectedZone)}
                  <small>{selectedZone.zoneId}</small>
                </h2>
              </div>
              <StatusPill
                tone={
                  selectedZone.condition === "critical" || selectedZone.hasBreach
                    ? "critical"
                    : selectedZone.condition === "nominal"
                      ? "nominal"
                      : "watch"
                }
              >
                {selectedZone.hasBreach
                  ? "破口"
                  : conditionLabel(selectedZone.condition)}
              </StatusPill>
            </div>
            <div className="zone-inspector" aria-live="polite">
            <dl className="zone-inspector-meta">
              <div>
                <dt>环</dt>
                <dd>{selectedZone.ring}</dd>
              </div>
              <div>
                <dt>角色</dt>
                <dd>{zoneRoleLabel(selectedZone)}</dd>
              </div>
              <div>
                <dt>用途</dt>
                <dd title={selectedZone.purposeZh}>
                  {selectedZone.purposeZh || "—"}
                </dd>
              </div>
              <div>
                <dt>破口</dt>
                <dd>{selectedZone.hasBreach ? "有" : "无"}</dd>
              </div>
            </dl>
            <div className="zone-inspector-readings">
              <div>
                <span>压力</span>
                <strong>{formatPa(selectedZone.observed.pressurePa, 2)}</strong>
              </div>
              <div>
                <span>O₂</span>
                <strong>
                  {formatPa(selectedZone.observed.oxygenPartialPressurePa, 2)}
                </strong>
              </div>
              <div>
                <span>CO₂</span>
                <strong>
                  {formatPa(
                    selectedZone.observed.carbonDioxidePartialPressurePa,
                    2,
                  )}
                </strong>
              </div>
              <div>
                <span>温度</span>
                <strong>{formatTemp(selectedZone.observed.temperatureK)}</strong>
              </div>
            </div>
            <p className="zone-inspector-causal">
              {causalSentence(selectedZone)}
            </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
