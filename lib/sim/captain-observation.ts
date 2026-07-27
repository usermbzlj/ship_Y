/**
 * Pure projection helpers for captain authorizedObservation.
 * Keeps hull / breach / jump-interlock fields wired so prompts that mention
 * hullIntegrity / jumpBlocked / schedule_hull_repair stay truthful.
 */

/** Ledger honesty: electrolyzer O₂ credits reserve only until supply command. */
export const ATMOSPHERE_RESERVE_LEDGER_SEMANTICS =
  "atmosphereReserveKg 是舰载气体储备库存；电解制氧只入账至此，不会自动进入舱区。舱压/氧分压传感器反映舱区气体；须 set-atmosphere-supply 从储备转入指定压力区。";

import type { ZoneId } from "./compartments";
import type { HullCascadeStage } from "./hull-consequence";
import type {
  CompartmentTelemetry,
  CompartmentZoneTelemetry,
  HullConsequenceTelemetry,
} from "./protocol";
import {
  estimateJumpThermalProjection,
  type JumpThermalProjection,
} from "./jump-interlock.ts";

export type CaptainPressureZoneAlert = {
  zoneId: ZoneId;
  condition: CompartmentZoneTelemetry["condition"];
  hasBreach: boolean;
  breachIds: string[];
  pressureSensorPa: number | null;
  oxygenSensorPa: number | null;
  carbonDioxideSensorPa: number | null;
  pressureSensorQuality: CompartmentZoneTelemetry["quality"]["pressure"];
  sampleAgeSeconds: number | null;
};

export type CaptainHullThreatObservation = {
  availability: "available" | "unavailable";
  source: string;
  hullIntegrity: number | null;
  activeBreachCount: number;
  totalBreachAreaSquareMeters: number | null;
  jumpBlocked: boolean;
  jumpBlockReason: string | null;
  thrustPerformanceByRing: { a: number; b: number } | null;
  activeBreaches: Array<{
    breachId: string;
    zoneId: ZoneId;
    ring: "a" | "b";
    cascadeStage: HullCascadeStage;
    unrepairedSeconds: number;
    nextCascadeSeconds: number | null;
  }>;
  repairGuidance: string;
};

export function projectCaptainHullThreatObservation(
  hullConsequence: HullConsequenceTelemetry | null | undefined,
): CaptainHullThreatObservation {
  if (!hullConsequence) {
    return {
      availability: "unavailable",
      source: "壳体威胁权威投影尚未到达本决策窗口",
      hullIntegrity: null,
      activeBreachCount: 0,
      totalBreachAreaSquareMeters: null,
      jumpBlocked: false,
      jumpBlockReason: null,
      thrustPerformanceByRing: null,
      activeBreaches: [],
      repairGuidance:
        "无壳体投影时不得假定无破口；也不得发明 breachId 去 schedule_hull_repair",
    };
  }
  return {
    availability: "available",
    source:
      "壳体威胁权威投影（与设备跃迁联锁同源）；活动破口时禁止 execute_jump",
    hullIntegrity: hullConsequence.hullIntegrity,
    activeBreachCount: hullConsequence.activeBreachCount,
    totalBreachAreaSquareMeters:
      hullConsequence.totalBreachAreaSquareMeters,
    jumpBlocked: hullConsequence.jumpBlocked,
    jumpBlockReason: hullConsequence.jumpBlockReason,
    thrustPerformanceByRing: hullConsequence.thrustPerformanceByRing,
    activeBreaches: hullConsequence.events.map((event) => ({
      breachId: event.id,
      zoneId: event.zoneId,
      ring: event.ring,
      cascadeStage: event.cascadeStage,
      unrepairedSeconds: event.unrepairedSeconds,
      nextCascadeSeconds: event.nextCascadeSeconds,
    })),
    repairGuidance: hullConsequence.jumpBlocked
      ? "优先 isolate_pressure_zone，再用观测中的 breachId 调用 schedule_hull_repair；禁止带破口跃迁"
      : "当前无壳体跃迁联锁；仍须核对跃迁热投影与其它设备联锁",
  };
}

export function projectCaptainPressureZoneAlerts(
  compartments: CompartmentTelemetry | null | undefined,
  hullConsequence: HullConsequenceTelemetry | null | undefined,
  limit = 8,
): CaptainPressureZoneAlert[] {
  const breachIdsByZone = new Map<string, string[]>();
  for (const event of hullConsequence?.events ?? []) {
    const existing = breachIdsByZone.get(event.zoneId) ?? [];
    existing.push(event.id);
    breachIdsByZone.set(event.zoneId, existing);
  }
  const zones = compartments?.zones ?? [];
  return zones
    .filter(
      (zone) => zone.condition !== "nominal" || zone.hasBreach,
    )
    .slice(0, limit)
    .map((zone) => ({
      zoneId: zone.zoneId,
      condition: zone.condition,
      hasBreach: zone.hasBreach,
      breachIds: breachIdsByZone.get(zone.zoneId) ?? [],
      pressureSensorPa: zone.observed.pressurePa,
      oxygenSensorPa: zone.observed.oxygenPartialPressurePa,
      carbonDioxideSensorPa:
        zone.observed.carbonDioxidePartialPressurePa,
      pressureSensorQuality: zone.quality.pressure,
      sampleAgeSeconds: zone.newestSampleAgeSeconds,
    }));
}

export function projectCaptainJumpThermalEstimate(input: {
  thermalBusSensorK: number | null | undefined;
  requiredChargePerJumpKWh: number;
  remainingDistanceLightYears: number;
  candidateDistanceLightYears?: number;
}): (JumpThermalProjection & { semantics: string }) | null {
  const remaining = Math.max(0, input.remainingDistanceLightYears);
  const candidate = Math.min(
    input.candidateDistanceLightYears ?? Math.min(5, Math.max(0.1, remaining || 0.1)),
    5,
    Math.max(remaining, 0.1),
  );
  const estimate = estimateJumpThermalProjection({
    thermalBusTemperatureK: input.thermalBusSensorK,
    requiredChargePerJumpKWh: input.requiredChargePerJumpKWh,
    distanceLightYears: candidate,
  });
  if (!estimate) {
    return null;
  }
  return {
    ...estimate,
    semantics:
      "跃迁废热投影（与 execute_jump 设备联锁同公式）；当前热汇流排温度正常仍可能因投影超限被拒",
  };
}

export function captainHullThreatBlocksJump(input: {
  hullConsequence: HullConsequenceTelemetry | null | undefined;
  compartments: CompartmentTelemetry | null | undefined;
}): boolean {
  if (input.hullConsequence?.jumpBlocked) {
    return true;
  }
  if ((input.hullConsequence?.activeBreachCount ?? 0) > 0) {
    return true;
  }
  if ((input.compartments?.activeBreaches ?? 0) > 0) {
    return true;
  }
  return false;
}
