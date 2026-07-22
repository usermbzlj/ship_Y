"use client";

import type {
  ShipState,
  SystemTone,
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  WaterRecoveryTelemetry,
  MaintenanceTelemetry,
} from "../types";
import type { RotationTelemetry } from "@/lib/sim/protocol";
import { StatusPill } from "../components/status-pill";

export function ShipView({
  state,
  compartments,
  cooling,
  electrical,
  rotation,
  waterRecovery,
  maintenance,
}: {
  state: ShipState | null;
  compartments: CompartmentTelemetry | null;
  cooling: CoolingTelemetry | null;
  electrical: ElectricalTelemetry | null;
  rotation: RotationTelemetry["observed"] | null;
  waterRecovery: WaterRecoveryTelemetry | null;
  maintenance: MaintenanceTelemetry | null;
}) {
  const criticalZones =
    compartments?.zones.filter(
      (zone) => zone.condition === "critical",
    ).length ?? 0;
  const watchZones =
    compartments?.zones.filter(
      (zone) => zone.condition === "watch",
    ).length ?? 0;
  const offlineZones =
    compartments?.zones.filter(
      (zone) => zone.condition === "offline",
    ).length ?? 0;
  const overallTone: SystemTone =
    criticalZones > 0
      ? "critical"
      : watchZones > 0 || offlineZones > 0
        ? "watch"
        : "nominal";
  const electricalReading = (
    targetId: string,
    quantity: ElectricalTelemetry["sensors"][number]["quantity"],
  ) =>
    electrical?.sensors.find(
      (sensor) =>
        sensor.targetId === targetId &&
        sensor.quantity === quantity,
    )?.value ?? null;
  const busAServedPowerKw = electricalReading("bus-a", "servedPowerKw");
  const busBServedPowerKw = electricalReading("bus-b", "servedPowerKw");
  const networks: Array<[string, string, number]> = state
    ? [
        [
          "聚变发电",
          electrical?.observed.totalReactorOutputKw != null
            ? `${(electrical.observed.totalReactorOutputKw / 1_000).toFixed(0)} MW`
            : "建立中",
          electrical?.observed.totalReactorOutputKw != null
            ? Math.min(100, (electrical.observed.totalReactorOutputKw / 1_350_000) * 100)
            : 0,
        ],
        [
          "A 母线供给",
          busAServedPowerKw != null
            ? `${(busAServedPowerKw / 1_000).toFixed(0)} MW`
            : "建立中",
          busAServedPowerKw != null
            ? Math.min(100, (busAServedPowerKw / 675_000) * 100)
            : 0,
        ],
        [
          "B 母线供给",
          busBServedPowerKw != null
            ? `${(busBServedPowerKw / 1_000).toFixed(0)} MW`
            : "建立中",
          busBServedPowerKw != null
            ? Math.min(100, (busBServedPowerKw / 675_000) * 100)
            : 0,
        ],
        [
          "冷却散热",
          cooling?.observed.totalRadiatedPowerW != null
            ? `${(cooling.observed.totalRadiatedPowerW / 1_000_000).toFixed(1)} MW`
            : "建立中",
          cooling?.observed.totalRadiatedPowerW != null
            ? Math.min(100, (cooling.observed.totalRadiatedPowerW / 800_000_000) * 100)
            : 0,
        ],
        [
          "冷却母线",
          cooling?.observed.averageCoolantTemperatureK != null
            ? `${cooling.observed.averageCoolantTemperatureK.toFixed(1)} K`
            : "建立中",
          cooling?.observed.averageCoolantTemperatureK != null
            ? Math.min(100, ((cooling.observed.averageCoolantTemperatureK - 280) / 120) * 100)
            : 0,
        ],
        [
          "水回收 A",
          waterRecovery?.observed?.potableKgByRing?.a != null
            ? `${(waterRecovery.observed.potableKgByRing.a / 1_000).toFixed(0)} t`
            : "建立中",
          waterRecovery?.observed?.potableKgByRing?.a != null
            ? Math.min(100, (waterRecovery.observed.potableKgByRing.a / 2_000_000) * 100)
            : 0,
        ],
        [
          "水回收 B",
          waterRecovery?.observed?.potableKgByRing?.b != null
            ? `${(waterRecovery.observed.potableKgByRing.b / 1_000).toFixed(0)} t`
            : "建立中",
          waterRecovery?.observed?.potableKgByRing?.b != null
            ? Math.min(100, (waterRecovery.observed.potableKgByRing.b / 2_000_000) * 100)
            : 0,
        ],
      ]
    : [];

  return (
    <section className="view-grid ship-view" aria-label="舰体系统">
      <div className="panel hull-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">HULL INTEGRITY / 结构</span>
            <h2>舰体与压力区</h2>
          </div>
          <StatusPill tone={overallTone}>
            {criticalZones > 0
              ? `${criticalZones} 区危险`
              : watchZones > 0
                ? `${watchZones} 区关注`
                : offlineZones > 0
                  ? `${offlineZones} 区离线`
                  : "48 区正常"}
          </StatusPill>
        </div>
        <div className="hull-topology">
          <div className="topology-node topology-node-generator">
            <span>聚变发电</span>
            <strong>
              {electrical?.observed.totalReactorOutputKw != null
                ? `${(electrical.observed.totalReactorOutputKw / 1_000).toFixed(0)} MW`
                : "—"}
            </strong>
          </div>
          {["A 环", "B 环", "工程脊柱", "休眠舱群"].map((label, index) => (
            <div
              className={`topology-node topology-node-${index + 1}`}
              key={label}
            >
              <span>{label}</span>
              <i />
            </div>
          ))}
        </div>
      </div>
      <div className="panel network-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">LIVE NETWORKS</span>
            <h2>实时负载</h2>
          </div>
        </div>
        <div className="network-list">
          {networks.map(([name, value, load]) => (
            <div className="network-row" key={name}>
              <span>{name}</span>
              <div className="meter">
                <i style={{ width: `${load}%` }} />
              </div>
              <strong>{value}</strong>
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
            <h2>48 个主要压力区</h2>
          </div>
        </div>
        <div className="sector-matrix">
          {(compartments?.zones ??
            Array.from({ length: 48 }, (_, index) => ({
              zoneId: `${index < 24 ? "A" : "B"}-${String(
                (index % 24) + 1,
              ).padStart(2, "0")}`,
              condition: "offline" as const,
              hasBreach: false,
              observed: { pressurePa: null },
            }))).map((zone) => (
            <span
              key={zone.zoneId}
              className={`sector-${zone.condition}`}
              role="img"
              tabIndex={0}
              aria-label={`${zone.zoneId}，${
                zone.observed.pressurePa === null
                  ? "压力遥测等待中"
                  : `压力 ${(zone.observed.pressurePa / 1_000).toFixed(2)} 千帕，状态 ${zone.condition}`
              }`}
              title={`${zone.zoneId} · ${
                zone.observed.pressurePa === null
                  ? "压力遥测等待中"
                  : `${(zone.observed.pressurePa / 1_000).toFixed(2)} kPa`
              }`}
            />
          ))}
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
    </section>
  );
}
