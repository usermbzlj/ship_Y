/**
 * Pure builders for God-mode causal events and force overrides.
 * Behavior must stay aligned with the former mission-control switch bodies.
 */

import type { ExternalInterventionRequest, ShipState } from "./index.ts";

/** Minimal force-field shape; avoids coupling to app/ui ForceField. */
export type ForceOverrideField = {
  id: string;
  label: string;
  path: string;
  unit: string;
};

export function buildCausalInterventionRequest(
  eventType: string,
  options?: { actor?: string },
): ExternalInterventionRequest {
  const common = {
    actor: options?.actor ?? "player:god-mode",
    metadata: {
      mode: "causal-event",
      eventType,
      sourceKnownToAi: false,
    },
  } satisfies Pick<ExternalInterventionRequest, "actor" | "metadata">;

  switch (eventType) {
    case "micrometeoroid":
      return {
        ...common,
        reason: "微流星体撞击外壳并形成等效微破口",
        metadata: {
          ...common.metadata,
          targetZoneId: "A-18",
        },
        operations: [
          {
            operation: "add",
            path: "atmosphere.leakAreaSquareMeters",
            value: 0.000045,
          },
        ],
        declaredBalance: {
          massKg: -0.34,
          energyJ: 280_000_000,
          linearMomentumKgMPerSecond: [1_180, -240, 90],
          angularMomentumKgM2PerSecond: [0, 28_000, -74_000],
          note: "Projectile impact, ablated hull mass and transferred momentum",
        },
      };
    case "coolant-pump-seizure":
      return {
        ...common,
        reason: "在线冷却泵转子机械卡死",
        metadata: {
          ...common.metadata,
          targetPumpId: "pump-a",
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Topology fault; subsequent waste heat remains in the closed ship system",
        },
      };
    case "fusion-reactor-trip":
      return {
        ...common,
        reason: "一号聚变模块保护系统检测异常并执行紧急跳闸",
        metadata: {
          ...common.metadata,
          targetReactorId: "fusion-1",
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Protection topology fault; future generation and storage dispatch are integrated by the electrical network",
        },
      };
    case "ring-bearing-degradation":
      return {
        ...common,
        reason: "A环主轴承材料出现渐进性点蚀与摩擦劣化",
        metadata: {
          ...common.metadata,
          targetRingId: "ring-a",
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Bearing-condition fault; subsequent friction, vibration, drive work and heat remain integrated by the rotation and thermal solvers",
        },
      };
    case "air-handler-trip":
      return {
        ...common,
        reason: "A环空气处理机保护跳闸并停止循环与吸附",
        metadata: {
          ...common.metadata,
          targetAirHandlerId: "air-handler-a",
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Air-handler condition fault; subsequent gas transport and carbon-dioxide accumulation remain integrated by the compartment solver",
        },
      };
    case "water-processor-trip":
      return {
        ...common,
        reason: "A环水回收机保护跳闸并停止两级废水处理",
        metadata: {
          ...common.metadata,
          targetProcessorId: "water-processor-a",
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Water-processor condition fault; subsequent potable use, wastewater accumulation, and brine production remain integrated by the water network",
        },
      };
    case "water-spur-fault":
    case "water-spur-fault-a-closed":
      return {
        ...common,
        reason: "A环配水支路卡死关闭，净水无法送达用户",
        metadata: {
          ...common.metadata,
          eventType: "water-spur-fault",
          targetSpurId: "water-spur-a",
          spurCondition: "stuck-closed",
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Distribution-spur condition fault; undelivered demand is ledgered without inventing phantom mass",
        },
      };
    case "water-spur-fault-b-degraded":
      return {
        ...common,
        reason: "B环配水支路进入半开降级工况",
        metadata: {
          ...common.metadata,
          eventType: "water-spur-fault",
          targetSpurId: "water-spur-b",
          spurCondition: "degraded",
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Distribution-spur condition fault; undelivered demand is ledgered without inventing phantom mass",
        },
      };
    case "cooling-spur-fault":
    case "cooling-spur-fault-a-closed":
      return {
        ...common,
        reason:
          "A环居住热送达支路卡死关闭，舱热泵冷却无法送达该环区带",
        metadata: {
          ...common.metadata,
          eventType: "cooling-spur-fault",
          targetSpurId: "cooling-spur-a",
          spurCondition: "stuck-closed",
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Habitat-thermal-delivery spur condition fault; undelivered cooling demand is ledgered without inventing phantom heat",
        },
      };
    case "cooling-spur-fault-b-degraded":
      return {
        ...common,
        reason: "B环居住热送达支路进入半开降级工况",
        metadata: {
          ...common.metadata,
          eventType: "cooling-spur-fault",
          targetSpurId: "cooling-spur-b",
          spurCondition: "degraded",
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Habitat-thermal-delivery spur condition fault; undelivered cooling demand is ledgered without inventing phantom heat",
        },
      };
    case "stellar-flare":
      return {
        ...common,
        reason: "恒星耀斑提高外部粒子沉积与舰体热负荷",
        operations: [
          {
            operation: "multiply",
            path: "environment.radiationDoseRateMilliSievertsPerHour",
            value: 180,
          },
          {
            operation: "multiply",
            path: "environment.chargedParticleFluxPerSquareMeterSecond",
            value: 2_400,
          },
          {
            operation: "add",
            path: "environment.stellarIrradianceWattsPerSquareMeter",
            value: 160,
          },
        ],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Changes explicit external radiation and particle-flux boundaries; future deposited energy is integrated by downstream solvers",
        },
      };
    case "passenger-emergency":
      return {
        ...common,
        reason: "生成突发医疗负荷与一名急症乘客",
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Biological incident initialized without bulk ship mass exchange",
        },
      };
    default:
      throw new Error(`unsupported causal event type: ${eventType}`);
  }
}

export function buildForceOverrideRequest(
  field: ForceOverrideField,
  value: number,
  engineState: ShipState,
): ExternalInterventionRequest {
  let massKg = 0;
  let energyJ = 0;
  switch (field.id) {
    case "coolant-temperature":
      energyJ =
        (value - engineState.thermal.coolantTemperatureK) *
        engineState.thermal.coolantHeatCapacityKJPerK *
        1_000;
      break;
    case "oxygen-mass":
      massKg = value - engineState.atmosphere.gasesKg.oxygen;
      energyJ =
        massKg * 1_005 * engineState.thermal.habitatTemperatureK;
      break;
    case "potable-water":
      massKg = value - engineState.water.potableKg;
      break;
  }

  return {
    actor: "player:god-mode",
    reason: `直接覆写 ${field.label}`,
    operations: [
      {
        operation: "set",
        path: field.path,
        value,
      },
    ],
    declaredBalance: {
      massKg,
      energyJ,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        massKg !== 0 || energyJ !== 0
          ? "Direct override balance derived from the changed stored state"
          : "Direct boundary/topology override with no instantaneous stored mass or energy delta",
    },
    metadata: {
      mode: "direct-force",
      sourceKnownToAi: false,
      fieldId: field.id,
      unit: field.unit,
    },
  };
}
