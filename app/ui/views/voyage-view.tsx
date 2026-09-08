"use client";

import { useState, type CSSProperties } from "react";
import type {
  ShipState,
  SystemTone,
  SystemCard,
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  NavigationTelemetry,
} from "../types";
import type {
  RotationTelemetry,
  SimulationWorkerSurvivalTelemetry,
} from "@/lib/sim/protocol";
import {
  estimateMinLegs,
  routeDistanceLy,
} from "@/lib/astro/star-catalog";
import { STAR_SYSTEMS, OFFLINE_SYSTEMS, SHIP_DESIGN_LENGTH_M } from "../constants";
import { StarMap } from "../components/star-map";
import { StatusPill } from "../components/status-pill";
import { SurvivalPressure } from "../components/survival-pressure";

function ringSpinPeriodSeconds(relativeRpm: number | null | undefined): number | null {
  if (relativeRpm === null || relativeRpm === undefined) return null;
  const abs = Math.abs(relativeRpm);
  if (abs < 0.05) return null;
  // 示意周期：|rpm| 越大转得越快，钳制在可读范围
  return Math.min(48, Math.max(6, 24 / abs));
}

export function VoyageView({
  origin: contractOrigin,
  destination: contractDestination,
  missionStarted: missionStartedProp,
  directive,
  state,
  cooling,
  electrical,
  compartments,
  navigation,
  rotation,
  survival,
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
  survival: SimulationWorkerSurvivalTelemetry | null;
}) {
  // A10修复:活动路线 vs 契约路线
  const missionStarted = state != null;
  const activeOrigin = missionStarted ? state.journey.origin : contractOrigin;
  const activeDestination = missionStarted ? state.journey.destination : contractDestination;
  
  const [directiveExpanded, setDirectiveExpanded] = useState(false);
  const directiveIsLong = directive.length > 48;
  const originSystem = STAR_SYSTEMS.find((system) => system.id === activeOrigin)!;
  const destinationSystem = STAR_SYSTEMS.find(
    (system) => system.id === activeDestination,
  )!;
  const distanceLightYears = routeDistanceLy(activeOrigin, activeDestination);
  const routeLegs = estimateMinLegs(distanceLightYears);
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
  const airHandlerFlowFractions =
    compartments?.airHandlers.controllers.map(
      (handler) => handler.commandedFlowFraction,
    ) ?? [];
  const lifeSupportLoad =
    airHandlerFlowFractions.length === 0
      ? null
      : Math.min(
          100,
          (airHandlerFlowFractions.reduce((total, value) => total + value, 0) /
            airHandlerFlowFractions.length) *
            100,
        );
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
  const ringASpinPeriod = ringSpinPeriodSeconds(observedRingA?.relativeRpm);
  const ringBSpinPeriod = ringSpinPeriodSeconds(observedRingB?.relativeRpm);
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
  const completedDistanceLightYears =
    state?.journey.completedDistanceLightYears ?? 0;
  const totalDistanceLightYears =
    state?.journey.totalDistanceLightYears ?? distanceLightYears;
  const journeyProgress = Math.min(
    100,
    Math.max(
      0,
      (completedDistanceLightYears /
        Math.max(totalDistanceLightYears, 0.01)) *
        100,
    ),
  );
  const remainingDistanceLightYears = Math.max(
    0,
    totalDistanceLightYears - completedDistanceLightYears,
  );
  const journeyPhase = !missionStarted
    ? {
        code: "AUTHORITY HOLD",
        title: "等待人类签发",
        detail: "航路已装订，舰长权限保持冻结",
      }
    : state?.journey.status === "arrived"
      ? {
          code: "SAFE ARRIVAL",
          title: "目标安全区已确认",
          detail: "航程控制权等待移交",
        }
      : state?.journey.status === "ready"
        ? {
            code: "JUMP WINDOW",
            title: "跃迁条件已满足",
            detail: "舰长正在执行最终航路判断",
          }
        : {
            code: "DEEP CRUISE",
            title: "深空航路执行中",
            detail: "全舰系统服从最高指令",
          };
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
          load: lifeSupportLoad ?? 0,
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
    : OFFLINE_SYSTEMS;

  return (
    <section className="view-grid voyage-view" aria-label="航程总览">
      <div className="panel map-panel bridge-viewport">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">FORWARD OBSERVATION</span>
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
            originId={activeOrigin}
            destinationId={activeDestination}
            running={missionStarted}
            completedDistanceLightYears={completedDistanceLightYears}
            totalDistanceLightYears={totalDistanceLightYears}
          />
          <div className="viewport-glass" aria-hidden="true" />
          <div className="bridge-phase-readout">
            <span>{journeyPhase.code}</span>
            <strong>{journeyPhase.title}</strong>
            <small>{journeyPhase.detail}</small>
          </div>
          <div className="map-readout map-readout-left">
            <span>航程完成</span>
            <strong>{journeyProgress.toFixed(1)}%</strong>
          </div>
          <div className="map-readout map-readout-right">
            <span>剩余航程</span>
            <strong>{remainingDistanceLightYears.toFixed(2)} LY</strong>
          </div>
        </div>
        <div className="bridge-progress" aria-label={`航程完成 ${journeyProgress.toFixed(1)}%`}>
          <i style={{ width: `${journeyProgress}%` }} />
          <span>ORIGIN / {originSystem.name}</span>
          <strong>{state?.journey.jumpsCompleted ?? 0} / {state?.journey.totalLegs ?? routeLegs} JUMPS</strong>
          <span>DESTINATION / {destinationSystem.name}</span>
        </div>
        <div
          className={`directive-strip${directiveExpanded ? " expanded" : ""}`}
          onClick={
            directiveIsLong
              ? () => setDirectiveExpanded((value) => !value)
              : undefined
          }
          onKeyDown={
            directiveIsLong
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setDirectiveExpanded((value) => !value);
                  }
                }
              : undefined
          }
          role={directiveIsLong ? "button" : undefined}
          tabIndex={directiveIsLong ? 0 : undefined}
          aria-expanded={directiveIsLong ? directiveExpanded : undefined}
        >
          <span className="directive-seal">最高指令</span>
          <p>{directive}</p>
        </div>
      </div>

      <div className="panel ship-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">STARBOARD TACTICAL</span>
            <h2>远穹号 · 居住环转速</h2>
          </div>
          <span className="micro-code">
            船长 {SHIP_DESIGN_LENGTH_M} m · 规格说明（非实时账本） · 2,120 人
          </span>
        </div>
        <div className="ship-schematic" aria-label="居住环对转转速指示">
          <div
            className={`ship-ring ring-alpha${ringASpinPeriod ? " ring-spinning" : ""}${
              observedRingA?.relativeRpm != null && observedRingA.relativeRpm < 0
                ? " ring-spin-reverse"
                : ""
            }`}
            style={
              ringASpinPeriod
                ? ({
                    "--ring-period": `${ringASpinPeriod}s`,
                  } as CSSProperties)
                : undefined
            }
          >
            <i className="ring-spin-marker" aria-hidden="true" />
            <span>A</span>
          </div>
          <div
            className={`ship-ring ring-beta${ringBSpinPeriod ? " ring-spinning" : ""}${
              observedRingB?.relativeRpm != null && observedRingB.relativeRpm < 0
                ? " ring-spin-reverse"
                : ""
            }`}
            style={
              ringBSpinPeriod
                ? ({
                    "--ring-period": `${ringBSpinPeriod}s`,
                  } as CSSProperties)
                : undefined
            }
          >
            <i className="ring-spin-marker" aria-hidden="true" />
            <span>B</span>
          </div>
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
            <span>聚变燃料</span>
            <strong>
              {observedFusionFuelMassKg === null
                ? "建立中"
                : `${(observedFusionFuelMassKg / 1_000).toFixed(1)} t`}
            </strong>
          </div>
        </div>
        <p className="panel-note ship-schematic-note">
          {observedRingA?.relativeRpm != null && observedRingB?.relativeRpm != null
            ? `观测转速 A ${observedRingA.relativeRpm >= 0 ? "+" : ""}${observedRingA.relativeRpm.toFixed(3)} · B ${observedRingB.relativeRpm >= 0 ? "+" : ""}${observedRingB.relativeRpm.toFixed(3)} rpm · 延迟降级观测值，非真值`
            : "双环转速为延迟降级观测值；尚未建立读数"}
        </p>
      </div>

      <SurvivalPressure survival={survival} />

      <div className="ship-status-strip" aria-label="舰况摘要">
        <div className="ship-status-label">舰况</div>
        <div className="ship-status-items">
          {systems.map((system) => (
            <article
              className={`ship-status-item tone-${system.tone}`}
              key={system.name}
              title={system.detail}
            >
              <span className="ship-status-name">{system.name}</span>
              <strong>{system.value}</strong>
              <small>{system.detail}</small>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
