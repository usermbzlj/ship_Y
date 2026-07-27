/**
 * Stateless God-intervention target resolution, normalization, and side-effect
 * application for the simulation worker.
 *
 * Pure functions only: no module-level mutable state. Domain networks and worker
 * sync helpers are passed explicitly so the worker can keep bit-level determinism
 * while this layer stays independently testable.
 */

import {
  BASELINE_ZONE_IDS,
  type AirHandlerId,
  type CompartmentAtmosphereNetwork,
  type GasSpecies,
  type ZoneId,
} from "./compartments.ts";
import type { CoolingThermalNetwork, HabitatThermalDeliverySpurId } from "./cooling.ts";
import type {
  ElectricalBatteryId,
  FusionReactorId,
  ShipElectricalNetwork,
} from "./electrical.ts";
import type { RigidBodyNavigation } from "./navigation.ts";
import type {
  CounterRotatingHabitat,
  RotationRingId,
} from "./rotation.ts";
import type {
  WaterDistributionSpurId,
  WaterProcessorId,
  WaterRecoveryNetwork,
} from "./water.ts";
import type { HullConsequenceNetwork } from "./hull-consequence.ts";
import type {
  ExternalInterventionRecord,
  ExternalInterventionRequest,
  InterventionOperation,
  SimulationEngine,
} from "./index.ts";
import type { ProceduralWorldEvent } from "./procedural-world.ts";
import type {
  ApplyPassengerIncidentInput,
  Passenger,
  PassengerSimulation,
} from "./passengers.ts";

/** Matches worker historical constant; keep value identical for determinism. */
export const GAS_SENSIBLE_HEAT_J_PER_KG_K = 1_005;


export function projectedNumericValue(
  before: number,
  operation: InterventionOperation,
): number | null {
  if (typeof operation.value !== "number") return null;
  switch (operation.operation) {
    case "set":
      return operation.value;
    case "add":
      return before + operation.value;
    case "multiply":
      return before * operation.value;
  }
}

export function replaceEquivalentBreachArea(
  compartments: CompartmentAtmosphereNetwork,
  hullConsequence: HullConsequenceNetwork,
  areaSquareMeters: number,
  registerHullBreachConsequence: (input: {
    breachId: string;
    zoneId: ZoneId;
    areaSquareMeters: number;
  }) => void,
  syncHullThrustDerates: () => void,
): void {
  for (const breach of compartments.listBreaches()) {
    compartments.removeBreach(breach.id);
    hullConsequence.clear(breach.id);
  }
  if (areaSquareMeters > 0) {
    compartments.upsertBreach({
      id: "breach:force-equivalent",
      zoneId: "A-18",
      areaSquareMeters,
      dischargeCoefficient: 0.72,
    });
    registerHullBreachConsequence({
      breachId: "breach:force-equivalent",
      zoneId: "A-18",
      areaSquareMeters,
    });
  }
  syncHullThrustDerates();
}

export function normalizeDirectForceBalance(
  request: ExternalInterventionRequest,
  engine: SimulationEngine,
  compartments: CompartmentAtmosphereNetwork,
  cooling: CoolingThermalNetwork,
): ExternalInterventionRequest {
  if (request.metadata?.mode !== "direct-force") {
    return request;
  }
  const state = engine.getState();
  const atmosphere = compartments.getAggregateState();
  let massKg = 0;
  let energyJ = 0;
  let recalculated = false;

  for (const operation of request.operations) {
    if (
      operation.path === "thermal.coolantTemperatureK"
    ) {
      const after = projectedNumericValue(
        state.thermal.coolantTemperatureK,
        operation,
      );
      if (after !== null) {
        energyJ += cooling
          .listNodes()
          .filter(
            (node) =>
              node.id === "coolant-a" ||
              node.id === "coolant-b",
          )
          .reduce(
            (total, node) =>
              total +
              (after - node.temperatureK) *
                node.heatCapacityJPerK,
            0,
          );
        recalculated = true;
      }
    } else if (
      operation.path.startsWith("atmosphere.gasesKg.")
    ) {
      const gas = operation.path.slice(
        "atmosphere.gasesKg.".length,
      ) as GasSpecies;
      const before = atmosphere.gasesKg[gas];
      const after =
        before === undefined
          ? null
          : projectedNumericValue(before, operation);
      if (after !== null) {
        const deltaMassKg = after - before;
        massKg += deltaMassKg;
        energyJ +=
          deltaMassKg *
          GAS_SENSIBLE_HEAT_J_PER_KG_K *
          atmosphere.averageTemperatureK;
        recalculated = true;
      }
    } else if (operation.path === "water.potableKg") {
      const after = projectedNumericValue(
        state.water.potableKg,
        operation,
      );
      if (after !== null) {
        massKg += after - state.water.potableKg;
        recalculated = true;
      }
    }
  }
  if (!recalculated) return request;

  return {
    ...request,
    declaredBalance: {
      ...request.declaredBalance,
      massKg,
      energyJ,
      note:
        "Authoritative runtime recomputation for direct stored-state override",
    },
  };
}

export function ringBearingDegradationTarget(
  request: ExternalInterventionRequest,
): RotationRingId | null {
  if (request.metadata?.eventType !== "ring-bearing-degradation") {
    return null;
  }
  if (request.metadata.mode !== "causal-event") {
    throw new Error(
      "ring-bearing-degradation must use causal-event mode",
    );
  }
  if (request.operations.length !== 0) {
    throw new Error(
      "ring-bearing-degradation cannot directly override stored state",
    );
  }
  const targetRingId = request.metadata.targetRingId;
  if (targetRingId !== "ring-a" && targetRingId !== "ring-b") {
    throw new Error(
      "ring-bearing-degradation requires targetRingId ring-a or ring-b",
    );
  }
  return targetRingId;
}

export function normalizeRingBearingDegradation(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  const targetRingId = ringBearingDegradationTarget(request);
  if (targetRingId === null) return request;
  const ringLabel = targetRingId === "ring-a" ? "A 环" : "B 环";
  return {
    ...request,
    declaredBalance: {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        "Device-condition fault only; subsequent friction and heat remain inside the coupled ship system",
    },
    metadata: {
      ...request.metadata,
      targetRingId,
      effectSummary: `${ringLabel}机械轴承已进入退化工况；实际转速、振动、耗电与发热将由后续物理步进决定。`,
    },
  };
}

export function airHandlerTripTarget(
  request: ExternalInterventionRequest,
): AirHandlerId | null {
  if (request.metadata?.eventType !== "air-handler-trip") {
    return null;
  }
  if (request.metadata.mode !== "causal-event") {
    throw new Error("air-handler-trip must use causal-event mode");
  }
  if (request.operations.length !== 0) {
    throw new Error(
      "air-handler-trip cannot directly override stored state",
    );
  }
  const targetAirHandlerId = request.metadata.targetAirHandlerId;
  if (
    targetAirHandlerId !== "air-handler-a" &&
    targetAirHandlerId !== "air-handler-b"
  ) {
    throw new Error(
      "air-handler-trip requires targetAirHandlerId air-handler-a or air-handler-b",
    );
  }
  return targetAirHandlerId;
}

export function normalizeAirHandlerTrip(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  const targetAirHandlerId = airHandlerTripTarget(request);
  if (targetAirHandlerId === null) return request;
  const ringLabel =
    targetAirHandlerId === "air-handler-a" ? "A 环" : "B 环";
  return {
    ...request,
    declaredBalance: {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        "Device-condition fault only; subsequent circulation and carbon-dioxide evolution remain inside the coupled atmosphere system",
    },
    metadata: {
      ...request.metadata,
      targetAirHandlerId,
      effectSummary: `${ringLabel}空气处理机已跳停；实际风量归零，后续 CO₂ 与舱区混合变化由分舱物理继续演化。`,
    },
  };
}

export function waterProcessorTripTarget(
  request: ExternalInterventionRequest,
): WaterProcessorId | null {
  if (request.metadata?.eventType !== "water-processor-trip") return null;
  if (request.metadata.mode !== "causal-event") {
    throw new Error("water-processor-trip must use causal-event mode");
  }
  if (request.operations.length !== 0) {
    throw new Error(
      "water-processor-trip cannot directly override stored state",
    );
  }
  const targetProcessorId = request.metadata.targetProcessorId;
  if (
    targetProcessorId !== "water-processor-a" &&
    targetProcessorId !== "water-processor-b"
  ) {
    throw new Error(
      "water-processor-trip requires targetProcessorId water-processor-a or water-processor-b",
    );
  }
  return targetProcessorId;
}

export function waterSpurFaultTarget(
  request: ExternalInterventionRequest,
): WaterDistributionSpurId | null {
  if (request.metadata?.eventType !== "water-spur-fault") return null;
  if (request.metadata.mode !== "causal-event") {
    throw new Error("water-spur-fault must use causal-event mode");
  }
  if (request.operations.length !== 0) {
    throw new Error(
      "water-spur-fault cannot directly override stored state",
    );
  }
  const targetSpurId = request.metadata.targetSpurId;
  if (targetSpurId !== "water-spur-a" && targetSpurId !== "water-spur-b") {
    throw new Error(
      "water-spur-fault requires targetSpurId water-spur-a or water-spur-b",
    );
  }
  return targetSpurId;
}

export function coolingSpurFaultTarget(
  request: ExternalInterventionRequest,
): HabitatThermalDeliverySpurId | null {
  if (request.metadata?.eventType !== "cooling-spur-fault") return null;
  if (request.metadata.mode !== "causal-event") {
    throw new Error("cooling-spur-fault must use causal-event mode");
  }
  if (request.operations.length !== 0) {
    throw new Error(
      "cooling-spur-fault cannot directly override stored state",
    );
  }
  const targetSpurId = request.metadata.targetSpurId;
  if (
    targetSpurId !== "cooling-spur-a" &&
    targetSpurId !== "cooling-spur-b"
  ) {
    throw new Error(
      "cooling-spur-fault requires targetSpurId cooling-spur-a or cooling-spur-b",
    );
  }
  return targetSpurId;
}

export function normalizeWaterProcessorTrip(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  const targetProcessorId = waterProcessorTripTarget(request);
  if (targetProcessorId === null) return request;
  const ringLabel =
    targetProcessorId === "water-processor-a" ? "A 环" : "B 环";
  return {
    ...request,
    declaredBalance: {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        "Device-condition fault only; later wastewater throughput and inventories remain inside the coupled water network",
    },
    metadata: {
      ...request.metadata,
      targetProcessorId,
      effectSummary: `${ringLabel}水回收机已跳停；后续废水积累、净水消耗与浓盐水产物由水网络继续演化。`,
    },
  };
}

export function normalizeWaterSpurFault(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  const targetSpurId = waterSpurFaultTarget(request);
  if (targetSpurId === null) return request;
  const ringLabel = targetSpurId === "water-spur-a" ? "A 环" : "B 环";
  const condition =
    request.metadata?.spurCondition === "degraded"
      ? "degraded"
      : "stuck-closed";
  const conditionLabel =
    condition === "degraded" ? "降级（约半开）" : "卡死关闭";
  return {
    ...request,
    declaredBalance: {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        "Distribution-spur condition only; undelivered demand is ledgered without inventing phantom mass",
    },
    metadata: {
      ...request.metadata,
      targetSpurId,
      spurCondition: condition,
      effectSummary: `${ringLabel}配水支路已${conditionLabel}；净水罐库存不变，未送达需求记入 undeliveredPotableKg。`,
    },
  };
}

export function normalizeCoolingSpurFault(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  const targetSpurId = coolingSpurFaultTarget(request);
  if (targetSpurId === null) return request;
  const ringLabel = targetSpurId === "cooling-spur-a" ? "A 环" : "B 环";
  const condition =
    request.metadata?.spurCondition === "degraded"
      ? "degraded"
      : "stuck-closed";
  const conditionLabel =
    condition === "degraded" ? "降级（约半开）" : "卡死关闭";
  return {
    ...request,
    declaredBalance: {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        "Habitat-thermal-delivery spur condition only; undelivered cooling demand is ledgered without inventing phantom heat",
    },
    metadata: {
      ...request.metadata,
      targetSpurId,
      spurCondition: condition,
      effectSummary: `${ringLabel}热送达支路已${conditionLabel}；舱热泵能力不变，未送达冷却需求记入 undeliveredHabitatCoolingJ。`,
    },
  };
}

export function applyWaterInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
  water: WaterRecoveryNetwork,
  engine: SimulationEngine,
  synchronizeWaterAggregate: () => void,
): void {
  if (record.status !== "applied") return;
  const trippedProcessorId = waterProcessorTripTarget(request);
  if (trippedProcessorId !== null) {
    water.configureProcessor(trippedProcessorId, {
      condition: "stuck-off",
    });
    synchronizeWaterAggregate();
    return;
  }
  const faultedSpurId = waterSpurFaultTarget(request);
  if (faultedSpurId !== null) {
    const condition = request.metadata?.spurCondition;
    water.configureDistributionSpur(faultedSpurId, {
      condition:
        condition === "degraded" || condition === "stuck-closed"
          ? condition
          : "stuck-closed",
    });
    synchronizeWaterAggregate();
    return;
  }
  if (!request.operations.some((operation) => operation.path === "water.potableKg")) {
    return;
  }
  water.setTotalPotableInventoryKg(engine.getState().water.potableKg);
  synchronizeWaterAggregate();
}

export function resolvePowerFluctuationTargets(message: string): {
  targetSensorId?: string;
  targetBatteryId?: ElectricalBatteryId;
  targetReactorId?: FusionReactorId;
  powerAction: "battery-degrade" | "reactor-derate" | "reactor-trip";
} {
  if (/电池组\s*A|battery-a|荷电状态/.test(message)) {
    return {
      targetSensorId: "sensor:battery-a:batteryStateOfChargeFraction",
      targetBatteryId: "battery-a",
      powerAction: "battery-degrade",
    };
  }
  if (/聚变模块\s*2|fusion-2|保护已切除/.test(message)) {
    return {
      targetSensorId: "sensor:fusion-2:reactorOutputKw",
      targetReactorId: "fusion-2",
      powerAction: "reactor-trip",
    };
  }
  // Default / B-bus voltage disturbance → degrade bus-b voltage sensor + derate fusion-3.
  return {
    targetSensorId: "sensor:bus-b:voltageV",
    targetReactorId: "fusion-3",
    powerAction: "reactor-derate",
  };
}

export function buildProceduralInterventionRequest(
  event: ProceduralWorldEvent,
  compartments: CompartmentAtmosphereNetwork,
): ExternalInterventionRequest | null {
  const eventType = event.interventionEventType;
  if (!eventType) return null;
  const common = {
    id: `procedural:${event.id}`,
    actor: "environment:procedural",
    reason: event.message,
    metadata: {
      mode: "causal-event" as const,
      eventType,
      sourceKnownToAi: false,
      proceduralEventId: event.id,
      proceduralEventType: event.type,
    },
  };
  switch (eventType) {
    case "micrometeoroid":
      // ~φ7.6 mm inner puncture; ~few-mm grain @ ~20 km/s caught mostly by Whipple bumper.
      return {
        ...common,
        metadata: {
          ...common.metadata,
          targetZoneId: "A-05",
        },
        operations: [
          {
            operation: "add",
            path: "atmosphere.leakAreaSquareMeters",
            value: 0.000045,
          },
        ],
        declaredBalance: {
          massKg: -0.025,
          energyJ: 25_000,
          linearMomentumKgMPerSecond: [12, -2.4, 0.9],
          angularMomentumKgM2PerSecond: [0, 280, -740],
          note: "~φ7.6 mm inner puncture (4.5e-5 m²); ~25 g bumper ejecta + minor pressure-wall punch-out; ~25 kJ few-mm grain @ ~20 km/s mostly caught by Whipple shield",
        },
      };
    case "coolant-pump-seizure": {
      const breachRings = new Set(
        compartments
          .listBreaches()
          .map((breach) =>
            breach.zoneId.startsWith("B-") ? "b" : "a",
          ),
      );
      const messagePrefersB = /[Bb]\s*泵|回路\s*[Bb]/.test(event.message);
      const targetPumpId =
        breachRings.has("b") && !breachRings.has("a")
          ? "pump-b"
          : breachRings.has("a") && !breachRings.has("b")
            ? "pump-a"
            : messagePrefersB
              ? "pump-b"
              : "pump-a";
      return {
        ...common,
        metadata: {
          ...common.metadata,
          targetPumpId,
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
    }
    case "sensor-drift":
      return {
        ...common,
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Atmosphere sensor condition fault; readings degrade without changing zone truth",
        },
      };
    case "stellar-flare":
      return {
        ...common,
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
    case "power-fluctuation": {
      const targets = resolvePowerFluctuationTargets(event.message);
      return {
        ...common,
        metadata: {
          ...common.metadata,
          ...targets,
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Electrical topology / sensor fault; lasting derate or trip remains until maintenance reset",
        },
      };
    }
    case "hibernation-complication": {
      const targetLoadId = /hibernation-b|[Bb]\s*路休眠|馈线\s*B/.test(
        event.message,
      )
        ? "hibernation-b"
        : "hibernation-a";
      return {
        ...common,
        metadata: {
          ...common.metadata,
          targetLoadId,
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Hibernation feeder protection trip; local ride-through reserve covers until restored",
        },
      };
    }
    default:
      return null;
  }
}

export function applyCompartmentInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
  compartments: CompartmentAtmosphereNetwork,
  passengers: PassengerSimulation,
  awakePassengersInZone: (zoneId: ZoneId) => Passenger[],
  applyIncidentToRoster: (input: ApplyPassengerIncidentInput) => void,
  replaceEquivalentBreachAreaFn: (areaSquareMeters: number) => void,
  registerHullBreachConsequence: (input: {
    breachId: string;
    zoneId: ZoneId;
    areaSquareMeters: number;
  }) => void,
  syncHullThrustDerates: () => void,
  synchronizeAtmosphereAggregate: (capturedCarbonDioxideKg: number) => void,
  capturedCarbonDioxideTotal: () => number,
): void {
  const eventType = request.metadata?.eventType;
  if (eventType === "air-handler-trip") {
    const targetAirHandlerId = airHandlerTripTarget(request);
    if (targetAirHandlerId === null) {
      throw new Error("air-handler-trip lost its validated target");
    }
    compartments.configureAirHandler(targetAirHandlerId, {
      condition: "stuck-off",
    });
  }
  if (eventType === "sensor-drift") {
    const candidates = compartments
      .listSensors()
      .filter((sensor) => sensor.condition === "nominal");
    let digest = 0;
    for (let index = 0; index < record.id.length; index += 1) {
      digest = (digest + record.id.charCodeAt(index) * (index + 1)) >>> 0;
    }
    const count = Math.min(3, Math.max(1, 1 + (digest % 3)));
    for (const sensor of candidates.slice(0, count)) {
      compartments.configureSensor(sensor.id, {
        condition: "degraded",
        noiseStandardDeviation: Math.max(
          sensor.noiseStandardDeviation * 4,
          0.05,
        ),
        driftPerSecond: Math.max(
          Math.abs(sensor.driftPerSecond) * 8,
          0.002,
        ),
      });
    }
  }
  if (eventType === "micrometeoroid") {
    const metadataTarget = request.metadata?.targetZoneId;
    const targetZoneId: ZoneId =
      typeof metadataTarget === "string" &&
      (BASELINE_ZONE_IDS as readonly string[]).includes(metadataTarget)
        ? (metadataTarget as ZoneId)
        : ("A-05" as ZoneId);
    const areaOperation = record.operations.find(
      (operation) =>
        operation.path === "atmosphere.leakAreaSquareMeters",
    );
    const previousArea =
      typeof areaOperation?.before === "number"
        ? areaOperation.before
        : compartments.getAggregateState().leakAreaSquareMeters;
    const nextArea =
      typeof areaOperation?.after === "number"
        ? areaOperation.after
        : previousArea;
    const newBreachArea = Math.max(0, nextArea - previousArea);
    if (newBreachArea > 0) {
      const breachId = `breach:micrometeoroid:${record.sequence}`;
      compartments.upsertBreach({
        id: breachId,
        zoneId: targetZoneId,
        areaSquareMeters: newBreachArea,
        dischargeCoefficient: 0.72,
      });
      registerHullBreachConsequence({
        breachId,
        zoneId: targetZoneId,
        areaSquareMeters: newBreachArea,
      });
      syncHullThrustDerates();
      const exposedPassengers = awakePassengersInZone(targetZoneId).slice(
        0,
        3,
      );
      if (exposedPassengers.length > 0) {
        applyIncidentToRoster({
          eventId: `${record.id}:${targetZoneId}-impact`,
          eventType: "micrometeoroid-compartment-impact",
          summary:
            `${targetZoneId} 压力区遭受微流星体贯穿冲击、瞬态压降与碎屑暴露。`,
          targetPassengerIds: exposedPassengers.map(
            (person) => person.id,
          ),
          healthImpact: {
            physical: -0.04,
            resilience: -0.015,
          },
          psychologyImpact: {
            stability: -0.05,
            stress: 0.12,
          },
          experienceImpact: {
            safety: -0.14,
            comfort: -0.05,
            trust: -0.02,
          },
          valence: -0.85,
          salience: 0.94,
          confidence: 0.96,
        });
      }
    }
  }

  if (eventType === "passenger-emergency") {
    const requestedPassengerId =
      typeof request.metadata?.targetPassengerId === "string"
        ? request.metadata.targetPassengerId
        : null;
    const requestedPassenger = requestedPassengerId
      ? passengers
          .getAllPassengers()
          .find(
            (person) =>
              person.id === requestedPassengerId &&
              person.lifeState === "awake",
          )
      : undefined;
    const target =
      requestedPassenger ??
      passengers
        .getKeyLlmPassengers()
        .find((person) => person.lifeState === "awake") ??
      passengers
        .getAllPassengers()
        .find((person) => person.lifeState === "awake");
    if (!target) {
      throw new Error(
        "passenger emergency requires at least one awake person",
      );
    }
    applyIncidentToRoster({
      eventId: `${record.id}:medical-emergency`,
      eventType: "passenger-medical-emergency",
      summary:
        "乘员出现突发循环系统急症，医疗舱已接收真实个体病例。",
      targetPassengerIds: [target.id],
      healthImpact: {
        physical: -0.18,
        resilience: -0.05,
        chronicRisk: 0.08,
      },
      psychologyImpact: {
        stability: -0.08,
        stress: 0.22,
      },
      experienceImpact: {
        safety: -0.09,
        comfort: -0.14,
        trust: -0.03,
      },
      valence: -0.8,
      salience: 0.9,
      confidence: 1,
    });
  }

  const directForce = request.metadata?.mode === "direct-force";
  for (const operation of record.operations) {
    if (
      operation.path.startsWith("atmosphere.gasesKg.") &&
      typeof operation.after === "number"
    ) {
      const gas = operation.path.slice(
        "atmosphere.gasesKg.".length,
      ) as GasSpecies;
      compartments.setTotalGasMass(gas, operation.after);
    } else if (
      directForce &&
      operation.path === "atmosphere.leakAreaSquareMeters" &&
      typeof operation.after === "number"
    ) {
      replaceEquivalentBreachAreaFn(operation.after);
    }
  }
  synchronizeAtmosphereAggregate(capturedCarbonDioxideTotal());
}

export function applyCoolingInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
  cooling: CoolingThermalNetwork,
  synchronizeThermalAggregate: () => void,
): void {
  const eventType = request.metadata?.eventType;
  if (eventType === "coolant-pump-seizure") {
    const requestedPumpId =
      request.metadata?.targetPumpId === "pump-b"
        ? "pump-b"
        : "pump-a";
    cooling.configurePump(requestedPumpId, {
      condition: "stuck-off",
      commandedSpeedFraction: 0,
    });
  }

  const faultedCoolingSpurId = coolingSpurFaultTarget(request);
  if (faultedCoolingSpurId !== null) {
    const condition = request.metadata?.spurCondition;
    cooling.configureHabitatThermalDeliverySpur(faultedCoolingSpurId, {
      condition:
        condition === "degraded" || condition === "stuck-closed"
          ? condition
          : "stuck-closed",
    });
  }

  if (eventType === "stellar-flare") {
    const irradianceOperation = record.operations.find(
      (operation) =>
        operation.path ===
        "environment.stellarIrradianceWattsPerSquareMeter",
    );
    if (
      typeof irradianceOperation?.before === "number" &&
      typeof irradianceOperation.after === "number"
    ) {
      const absorbedPowerDeltaW =
        (irradianceOperation.after -
          irradianceOperation.before) *
        28;
      const source = cooling.listHeatSources()[0];
      cooling.configureHeatSource(source.id, {
        thermalPowerW: Math.max(
          0,
          source.thermalPowerW + absorbedPowerDeltaW,
        ),
      });
    }
  }

  if (request.metadata?.mode === "direct-force") {
    const temperatureOperation = record.operations.find(
      (operation) =>
        operation.path === "thermal.coolantTemperatureK",
    );
    if (typeof temperatureOperation?.after === "number") {
      cooling.setNodeTemperatures([
        {
          nodeId: "coolant-a",
          temperatureK: temperatureOperation.after,
        },
        {
          nodeId: "coolant-b",
          temperatureK: temperatureOperation.after,
        },
      ]);
    }
  }
  synchronizeThermalAggregate();
}

export function applyElectricalInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
  electrical: ShipElectricalNetwork,
  synchronizeElectricalAggregate: () => void,
): void {
  const eventType = request.metadata?.eventType;
  if (eventType === "fusion-reactor-trip") {
    const requestedReactorId =
      typeof request.metadata?.targetReactorId === "string"
        ? request.metadata.targetReactorId
        : "fusion-1";
    const reactor = electrical
      .listReactors()
      .find(
        (candidate) => candidate.id === requestedReactorId,
      );
    if (!reactor) {
      throw new Error(
        `unknown fusion reactor ${requestedReactorId}`,
      );
    }
    electrical.tripReactor(
      reactor.id as FusionReactorId,
      request.reason,
    );
  }

  if (eventType === "power-fluctuation") {
    const targetSensorId =
      typeof request.metadata?.targetSensorId === "string"
        ? request.metadata.targetSensorId
        : null;
    if (targetSensorId) {
      const sensor = electrical
        .listSensors()
        .find((candidate) => candidate.id === targetSensorId);
      if (sensor && sensor.condition === "nominal") {
        electrical.configureSensor(sensor.id, {
          condition: "degraded",
          noiseStandardDeviation: Math.max(
            sensor.noiseStandardDeviation * 4,
            0.05,
          ),
          driftPerSecond: Math.max(
            Math.abs(sensor.driftPerSecond) * 8,
            0.002,
          ),
        });
      }
    }

    const powerAction =
      typeof request.metadata?.powerAction === "string"
        ? request.metadata.powerAction
        : "reactor-derate";
    if (powerAction === "battery-degrade") {
      const batteryId =
        typeof request.metadata?.targetBatteryId === "string"
          ? (request.metadata.targetBatteryId as ElectricalBatteryId)
          : "battery-a";
      electrical.setBatteryFault(batteryId, "degraded", request.reason);
    } else if (powerAction === "reactor-trip") {
      const reactorId =
        typeof request.metadata?.targetReactorId === "string"
          ? (request.metadata.targetReactorId as FusionReactorId)
          : "fusion-2";
      const reactor = electrical
        .listReactors()
        .find((candidate) => candidate.id === reactorId);
      if (reactor && reactor.condition === "nominal") {
        electrical.tripReactor(reactorId, request.reason);
      }
    } else {
      const reactorId =
        typeof request.metadata?.targetReactorId === "string"
          ? (request.metadata.targetReactorId as FusionReactorId)
          : "fusion-3";
      const reactor = electrical
        .listReactors()
        .find((candidate) => candidate.id === reactorId);
      if (
        reactor &&
        reactor.condition === "nominal" &&
        reactor.mode === "online"
      ) {
        const deratedTargetKw = Math.max(
          0,
          Math.min(reactor.ratedOutputKw, reactor.targetOutputKw * 0.85),
        );
        electrical.executeControlCommand({
          type: "set-reactor-target",
          reactorId,
          targetOutputKw: deratedTargetKw,
        });
      }
    }
  }

  if (eventType === "hibernation-complication") {
    const targetLoadId =
      request.metadata?.targetLoadId === "hibernation-b"
        ? "hibernation-b"
        : "hibernation-a";
    const load = electrical.getLoad(targetLoadId);
    const breaker = electrical
      .listBreakers()
      .find((candidate) => candidate.id === load.breakerId);
    if (breaker && breaker.condition === "nominal") {
      electrical.tripBreaker(load.breakerId, request.reason);
    }
  }

  if (request.metadata?.mode === "direct-force") {
    const generationOperation = record.operations.find(
      (operation) => operation.path === "power.generationKw",
    );
    if (typeof generationOperation?.after === "number") {
      electrical.applyExternalGenerationPower(
        generationOperation.after,
        request.reason,
      );
    }
  }
  synchronizeElectricalAggregate();
}

export function applyRotationInterventionEffects(
  request: ExternalInterventionRequest,
  rotation: CounterRotatingHabitat,
): void {
  const targetRingId = ringBearingDegradationTarget(request);
  if (targetRingId === null) return;
  rotation.configureRing(targetRingId, {
    bearing: { condition: "degraded" },
  });
}

export function applyNavigationInterventionEffects(
  record: ExternalInterventionRecord,
  navigation: RigidBodyNavigation,
): void {
  const linear =
    record.declaredBalance.linearMomentumKgMPerSecond;
  const angular =
    record.declaredBalance.angularMomentumKgM2PerSecond;
  if (
    linear.some((component) => component !== 0) ||
    angular.some((component) => component !== 0)
  ) {
    navigation.applyExternalMomentumImpulse(
      { x: linear[0], y: linear[1], z: linear[2] },
      { x: angular[0], y: angular[1], z: angular[2] },
    );
  }
}
