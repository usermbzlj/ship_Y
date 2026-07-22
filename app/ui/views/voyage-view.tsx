"use client";

import type {
  ShipState,
  SystemTone,
  SystemCard,
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  NavigationTelemetry,
} from "../types";
import type { RotationTelemetry } from "@/lib/sim/protocol";
import { STAR_SYSTEMS, INITIAL_SYSTEMS } from "../constants";
import { StarMap } from "../components/star-map";
import { StatusPill } from "../components/status-pill";

export function VoyageView({
  origin,
  destination,
  missionStarted,
  directive,
  state,
  cooling,
  electrical,
  compartments,
  navigation,
  rotation,
}: {
  origin: string;
  destination: string;
  missionStarted: boolean;
  directive: string;
  state: ShipState | null;
  cooling: CoolingTelemetry | null;
  electrical: ElectricalTelemetry | null;
  compartments: CompartmentTelemetry | null;
  navigation: NavigationTelemetry | null;
  rotation: RotationTelemetry["observed"] | null;
}) {
  const originSystem = STAR_SYSTEMS.find((system) => system.id === origin)!;
  const destinationSystem = STAR_SYSTEMS.find(
    (system) => system.id === destination,
  )!;
  const distanceLightYears = Math.max(
    0.1,
    Math.abs(
      destinationSystem.distanceFromSolLy - originSystem.distanceFromSolLy,
    ),
  );
  const routeLegs = Math.max(1, Math.ceil(distanceLightYears / 2.5));
  const observedCoolantTemperatureK =
    cooling?.observed.averageCoolantTemperatureK ?? null;
  const observedRadiatedPowerW =
    cooling?.observed.totalRadiatedPowerW ?? null;
  const observedPressurePa =
    compartments?.observedPressureAveragePa ?? null;
  const observedOxygenReadings =
    compartments?.zones
      .map((zone) => zone.observed.oxygenPartialPressurePa)
      .filter((value): value is number => value !== null) ?? [];
  const observedOxygenPartialPressurePa =
    observedOxygenReadings.length === 0
      ? null
      : observedOxygenReadings.reduce(
          (total, value) => total + value,
          0,
        ) / observedOxygenReadings.length;
  const observedGenerationKw =
    electrical?.observed.totalReactorOutputKw ?? null;
  const observedServedPowerKw =
    electrical?.observed.totalServedPowerKw ?? null;
  const observedBusVoltageV =
    electrical?.observed.averageBusVoltageV ?? null;
  const observedBusFrequencyHz =
    electrical?.observed.averageBusFrequencyHz ?? null;
  const observedFusionFuelMassKg =
    navigation?.observed.fusionFuelMassKg ?? null;
  const observedRingA =
    rotation?.rings.find((ring) => ring.id === "ring-a") ?? null;
  const observedRingB =
    rotation?.rings.find((ring) => ring.id === "ring-b") ?? null;
  const observedRingGravityReadings = [
    observedRingA?.artificialGravityG,
    observedRingB?.artificialGravityG,
  ].filter((value): value is number => value !== null && value !== undefined);
  const observedAverageRingGravityG =
    observedRingGravityReadings.length === 0
      ? null
      : observedRingGravityReadings.reduce(
          (total, value) => total + value,
          0,
        ) / observedRingGravityReadings.length;
  const observedPeakRingVibrationMmPerS = Math.max(
    observedRingA?.vibrationMmPerS ?? 0,
    observedRingB?.vibrationMmPerS ?? 0,
  );
  const ringTone: SystemTone =
    observedAverageRingGravityG === null
      ? "watch"
      : observedAverageRingGravityG < 0.8 ||
          observedAverageRingGravityG > 1.15 ||
          observedPeakRingVibrationMmPerS > 7.1
        ? "critical"
        : observedAverageRingGravityG < 0.92 ||
            observedAverageRingGravityG > 1.08 ||
            observedPeakRingVibrationMmPerS > 3.5
          ? "watch"
          : "nominal";
  const electricalTone: SystemTone =
    observedBusVoltageV === null ||
    observedBusFrequencyHz === null
      ? "watch"
      : observedBusVoltageV < 10_450 ||
          observedBusFrequencyHz < 49.5
        ? "critical"
        : "nominal";
  const systems: SystemCard[] = state
    ? [
        {
          name: "聚变电网",
          value:
            observedGenerationKw === null
              ? "读数建立中"
              : `${(observedGenerationKw / 1_000).toFixed(0)} MW`,
          detail:
            observedServedPowerKw === null
              ? "电网传感器延迟"
              : `观测供给 ${(observedServedPowerKw / 1_000).toFixed(0)} MW`,
          load:
            observedGenerationKw === null ||
            observedServedPowerKw === null
              ? 0
              : Math.min(
                  100,
                  (observedServedPowerKw /
                    Math.max(observedGenerationKw, 1)) *
                    100,
                ),
          tone: electricalTone,
        },
        {
          name: "热管理",
          value:
            observedCoolantTemperatureK === null
              ? "读数建立中"
              : `${observedCoolantTemperatureK.toFixed(1)} K`,
          detail:
            observedRadiatedPowerW === null
              ? "双回路传感器延迟"
              : `观测散热 ${(observedRadiatedPowerW / 1_000_000).toFixed(1)} MW`,
          load: Math.min(
            100,
            (state.thermal.internalHeatKw /
              Math.max(
                (observedRadiatedPowerW ?? 0) / 1_000,
                1,
              )) *
              100,
          ),
          tone:
            observedCoolantTemperatureK === null
              ? "watch"
              : observedCoolantTemperatureK > 360
                ? "critical"
                : "nominal",
        },
        {
          name: "生命保障",
          value:
            observedPressurePa === null
              ? "读数建立中"
              : `${(observedPressurePa / 1_000).toFixed(1)} kPa`,
          detail:
            observedOxygenPartialPressurePa === null
              ? "氧分压传感器延迟"
              : `O₂ 观测 ${(observedOxygenPartialPressurePa / 1_000).toFixed(1)} kPa`,
          load: Math.min(
            100,
            (state.population.awake /
              Math.max(state.population.total, 1)) *
              100 +
              55,
          ),
          tone:
            observedPressurePa === null
              ? "watch"
              : observedPressurePa < 75_000
                ? "critical"
                : "nominal",
        },
        {
          name: "火炬推进",
          value:
            observedFusionFuelMassKg === null
              ? "读数建立中"
              : `${(observedFusionFuelMassKg / 1_000).toFixed(2)} t`,
          detail:
            observedFusionFuelMassKg === null
              ? "聚变燃料计量延迟"
              : `推进剂观测 ${
                  navigation?.observed.propellantMassKg === null ||
                  navigation?.observed.propellantMassKg === undefined
                    ? "建立中"
                    : `${(
                        navigation.observed.propellantMassKg /
                        1_000_000
                      ).toFixed(2)} kt`
                }`,
          load:
            observedFusionFuelMassKg === null
              ? 0
              : Math.min(
                  100,
                  Math.max(
                    0,
                    (observedFusionFuelMassKg / 24_000) * 100,
                  ),
                ),
          tone:
            observedFusionFuelMassKg === null
              ? "watch"
              : observedFusionFuelMassKg < 2_400
                ? "critical"
                : "nominal",
        },
        {
          name: "旋转居住环",
          value:
            observedAverageRingGravityG === null
              ? "读数建立中"
              : `${observedAverageRingGravityG.toFixed(3)} g`,
          detail:
            observedRingA?.relativeRpm === null ||
            observedRingA?.relativeRpm === undefined ||
            observedRingB?.relativeRpm === null ||
            observedRingB?.relativeRpm === undefined
              ? "双环转速传感器延迟"
              : `A ${observedRingA.relativeRpm >= 0 ? "+" : ""}${observedRingA.relativeRpm.toFixed(3)} · B ${observedRingB.relativeRpm >= 0 ? "+" : ""}${observedRingB.relativeRpm.toFixed(3)} rpm`,
          load:
            observedAverageRingGravityG === null
              ? 0
              : Math.min(100, observedAverageRingGravityG * 100),
          tone: ringTone,
        },
        {
          name: "跃迁储能",
          value: `${((state.journey.jumpDriveChargeKWh / state.journey.jumpDriveCapacityKWh) * 100).toFixed(1)}%`,
          detail:
            state.journey.status === "ready"
              ? "储能完成 · 等待舰长"
              : state.journey.status === "arrived"
                ? "任务结束 · 联锁"
                : "充能中 · 联锁保持",
          load:
            (state.journey.jumpDriveChargeKWh /
              state.journey.jumpDriveCapacityKWh) *
            100,
          tone:
            state.journey.status === "ready" ||
            state.journey.status === "arrived"
              ? "nominal"
              : "watch",
        },
      ]
    : INITIAL_SYSTEMS;

  return (
    <section className="view-grid voyage-view" aria-label="航程总览">
      <div className="panel map-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">NAVIGATION / 跃迁航路</span>
            <h2>
              {originSystem.name} <i>→</i> {destinationSystem.name}
            </h2>
          </div>
          <StatusPill tone={missionStarted ? "nominal" : "watch"}>
            {missionStarted ? "航路执行中" : "等待签发"}
          </StatusPill>
        </div>
        <div className="map-stage">
          <StarMap
            originId={origin}
            destinationId={destination}
            running={missionStarted}
          />
          <div className="map-readout map-readout-left">
            <span>直线距离</span>
            <strong>{distanceLightYears.toFixed(2)} LY</strong>
          </div>
          <div className="map-readout map-readout-right">
            <span>预计节点</span>
            <strong>{String(routeLegs + 1).padStart(2, "0")}</strong>
          </div>
          {missionStarted && (
            <div
              className="vessel-marker"
              aria-label="远穹号当前位置"
              style={{
                left: `${18 + Math.min(1, (state?.journey.completedDistanceLightYears ?? 0) / Math.max(state?.journey.totalDistanceLightYears ?? 1, 0.1)) * 64}%`,
              }}
            >
              <span />
              Y-01
            </div>
          )}
        </div>
        <div className="directive-strip">
          <span className="directive-seal">最高指令</span>
          <p>{directive}</p>
        </div>
      </div>

      <div className="panel ship-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">VESSEL / Y-01</span>
            <h2>远穹级移民舰</h2>
          </div>
          <span className="micro-code">820M · 2,120 SOULS</span>
        </div>
        <div className="ship-schematic" aria-label="远穹号舰体示意">
          <div className="ship-shield" />
          <div className="ship-spine" />
          <div className="ship-ring ring-alpha">
            <span>A</span>
          </div>
          <div className="ship-ring ring-beta">
            <span>B</span>
          </div>
          <div className="ship-core" />
          <div className="ship-engine engine-one" />
          <div className="ship-engine engine-two" />
          <div className="ship-engine engine-three" />
          <div className="ship-axis" />
        </div>
        <div className="ship-facts">
          <div>
            <span>双环平均重力</span>
            <strong>
              {observedAverageRingGravityG === null
                ? "建立中"
                : `${observedAverageRingGravityG.toFixed(3)} g`}
            </strong>
          </div>
          <div>
            <span>压力分区</span>
            <strong>48</strong>
          </div>
          <div>
            <span>应急自持</span>
            <strong>5 年</strong>
          </div>
        </div>
      </div>

      <div className="systems-row">
        {systems.map((system) => (
          <article className="system-card" key={system.name}>
            <div className="system-card-top">
              <span>{system.name}</span>
              <StatusPill tone={system.tone}>
                {system.tone === "critical"
                  ? "告警"
                  : system.tone === "watch"
                    ? "进行"
                    : "正常"}
              </StatusPill>
            </div>
            <strong>{system.value}</strong>
            <p>{system.detail}</p>
            <div className="meter">
              <i style={{ width: `${system.load}%` }} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
