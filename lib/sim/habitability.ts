/**
 * Stateless passenger environmental exposure, habitability hazards, and dose logic
 * for the simulation worker.
 *
 * Pure functions only: no module-level mutable state. Domain networks and worker
 * mutable fields are passed explicitly so the worker can keep bit-level determinism
 * while this layer stays independently testable.
 */

import {
  BASELINE_ZONE_IDS,
  zoneCatalogEntry,
  type CompartmentAtmosphereNetwork,
  type ZoneId,
  type ZoneTruth,
} from "./compartments.ts";
import {
  PassengerSimulation,
  type ApplyPassengerIncidentInput,
  type Passenger,
} from "./passengers.ts";
import {
  applyRationAndStarvation,
  integrateHazardDose,
  MEDICAL_ZONE_SURVIVAL_DOSE_MULTIPLIER,
  type SurvivalHazardFamily,
  type SurvivalLedger,
  type ZoneHazardDose,
} from "./survival.ts";
import type {
  RotationRingId,
  RingTruthSummary,
} from "./rotation.ts";
import type {
  PassengerEnvironmentalExposureState,
  PassengerEnvironmentalHazardFamily,
  PassengerEnvironmentalHazardTier,
} from "./protocol.ts";

export const PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES = [
  "low-pressure",
  "hypoxia",
  "high-carbon-dioxide",
  "cold",
  "heat",
] as const satisfies readonly PassengerEnvironmentalHazardFamily[];

export function createPassengerEnvironmentalExposureStates():
  PassengerEnvironmentalExposureState[] {
  return BASELINE_ZONE_IDS.flatMap((zoneId) =>
    PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES.map((family) => ({
      zoneId,
      family,
      currentTier: 0 as const,
      episode: 0,
    })),
  );
}

export function createSurvivalZoneDoses(): ZoneHazardDose[] {
  return BASELINE_ZONE_IDS.flatMap((zoneId) =>
    PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES.map((family) => ({
      zoneId,
      family: family as SurvivalHazardFamily,
      accumulatedDoseSeconds: 0,
      currentTier: 0 as const,
      episode: 0,
    })),
  );
}

export function syncExposuresFromSurvivalDoses(
  survivalZoneDoses: readonly ZoneHazardDose[],
): PassengerEnvironmentalExposureState[] {
  return survivalZoneDoses.map((dose) => ({
    zoneId: dose.zoneId as ZoneId,
    family: dose.family as PassengerEnvironmentalHazardFamily,
    currentTier: dose.currentTier,
    episode: dose.episode,
  }));
}

export function clampIncidentDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

export function applyContinuousRosterDeltas(
  passengers: PassengerSimulation,
  targetPassengerIds: readonly string[],
  deltas: {
    physical?: number;
    stress?: number;
  },
  afterRestore: (next: PassengerSimulation) => void,
): void {
  const physical = clampIncidentDelta(deltas.physical ?? 0);
  const stress = clampIncidentDelta(deltas.stress ?? 0);
  if (
    targetPassengerIds.length === 0 ||
    (physical === 0 && stress === 0)
  ) {
    return;
  }
  const targets = new Set(targetPassengerIds);
  const snapshot = passengers.snapshot();
  for (const person of snapshot.passengers) {
    if (!targets.has(person.id) || person.lifeState === "deceased") {
      continue;
    }
    if (physical !== 0) {
      person.health.physical = Math.min(
        1,
        Math.max(0, person.health.physical + physical),
      );
    }
    if (stress !== 0 && person.lifeState === "awake") {
      person.psychology.stress = Math.min(
        1,
        Math.max(0, person.psychology.stress + stress),
      );
    }
    if (person.health.physical === 0) {
      snapshot.activeTransitions = snapshot.activeTransitions.filter(
        (transition) => transition.passengerId !== person.id,
      );
      person.lifeState = "deceased";
      person.hibernationPodId = null;
    }
  }
  afterRestore(PassengerSimulation.restore(snapshot));
}

export type RotationHabitabilityHazard = {
  code:
    | "low-gravity"
    | "near-weightlessness"
    | "high-gravity"
    | "extreme-high-gravity"
    | "structural-vibration"
    | "severe-structural-vibration";
  family: "low-gravity" | "high-gravity" | "vibration";
  rank: 1 | 2;
  summary: string;
  healthImpact?: ApplyPassengerIncidentInput["healthImpact"];
  psychologyImpact: NonNullable<
    ApplyPassengerIncidentInput["psychologyImpact"]
  >;
  experienceImpact: NonNullable<
    ApplyPassengerIncidentInput["experienceImpact"]
  >;
  valence: number;
  salience: number;
};

export function gravityHabitabilityHazard(
  ring: RingTruthSummary,
): RotationHabitabilityHazard | null {
  if (ring.artificialGravityG < 0.45) {
    return {
      code: "near-weightlessness",
      family: "low-gravity",
      rank: 2,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环有效重力降至近失重区间；` +
        "清醒乘员出现明显定向困难，舱内活动转入扶手与约束带程序。",
      psychologyImpact: { stability: -0.05, stress: 0.1 },
      experienceImpact: { comfort: -0.15, safety: -0.1 },
      valence: -0.78,
      salience: 0.9,
    };
  }
  if (ring.artificialGravityG < 0.8) {
    return {
      code: "low-gravity",
      family: "low-gravity",
      rank: 1,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环有效重力偏离居住带；` +
        "清醒乘员感到步态、物品固定和日常活动方式发生变化。",
      psychologyImpact: { stability: -0.015, stress: 0.035 },
      experienceImpact: { comfort: -0.055, safety: -0.025 },
      valence: -0.42,
      salience: 0.62,
    };
  }
  if (ring.artificialGravityG > 2) {
    return {
      code: "extreme-high-gravity",
      family: "high-gravity",
      rank: 2,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环进入危险高重力区间；` +
        "清醒乘员承受显著循环负荷并发生跌倒、挤压等急性伤害风险。",
      healthImpact: {
        physical: -0.06,
        resilience: -0.04,
        chronicRisk: 0.015,
      },
      psychologyImpact: { stability: -0.08, stress: 0.18 },
      experienceImpact: {
        comfort: -0.2,
        safety: -0.2,
        trust: -0.03,
      },
      valence: -0.9,
      salience: 0.97,
    };
  }
  if (ring.artificialGravityG > 1.2) {
    return {
      code: "high-gravity",
      family: "high-gravity",
      rank: 1,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环有效重力高于长期居住带；` +
        "清醒乘员感到动作负担增加，休息与工作程序受到限制。",
      psychologyImpact: { stability: -0.02, stress: 0.045 },
      experienceImpact: { comfort: -0.07, safety: -0.035 },
      valence: -0.5,
      salience: 0.68,
    };
  }
  return null;
}

export function vibrationHabitabilityHazard(
  ring: RingTruthSummary,
): RotationHabitabilityHazard | null {
  if (ring.vibrationMmPerS > 6) {
    return {
      code: "severe-structural-vibration",
      family: "vibration",
      rank: 2,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环持续结构振动进入严重区间；` +
        "清醒乘员的睡眠、精细操作和安全感受到明显影响。",
      psychologyImpact: { stability: -0.045, stress: 0.09 },
      experienceImpact: { comfort: -0.13, safety: -0.075 },
      valence: -0.72,
      salience: 0.86,
    };
  }
  if (ring.vibrationMmPerS > 2.5) {
    return {
      code: "structural-vibration",
      family: "vibration",
      rank: 1,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环可感结构振动升高；` +
        "清醒乘员报告休息质量和精细操作舒适度下降。",
      psychologyImpact: { stability: -0.012, stress: 0.025 },
      experienceImpact: { comfort: -0.045, safety: -0.015 },
      valence: -0.36,
      salience: 0.56,
    };
  }
  return null;
}

export function awakePassengersInRing(
  passengers: PassengerSimulation,
  currentZoneForPerson: (person: {
    id: string;
    cabinId: string;
  }) => ZoneId,
  ringId: RotationRingId,
) {
  const zonePrefix = ringId === "ring-a" ? "A-" : "B-";
  return passengers
    .getAllPassengers()
    .filter(
      (person) =>
        person.lifeState === "awake" &&
        currentZoneForPerson(person).startsWith(zonePrefix),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function applyRotationHabitabilityThresholdCrossings(
  beforeRings: readonly RingTruthSummary[],
  afterRings: readonly RingTruthSummary[],
  awakePassengersInRingFn: (ringId: RotationRingId) => Passenger[],
  applyIncidentToRosterFn: (input: ApplyPassengerIncidentInput) => void,
): void {
  const beforeById = new Map(
    beforeRings.map((ring) => [ring.id, ring]),
  );
  for (const ring of afterRings) {
    const before = beforeById.get(ring.id);
    if (!before) {
      throw new Error(`rotation habitability lost ${ring.id}`);
    }
    const hazardPairs = [
      [
        gravityHabitabilityHazard(before),
        gravityHabitabilityHazard(ring),
      ],
      [
        vibrationHabitabilityHazard(before),
        vibrationHabitabilityHazard(ring),
      ],
    ] as const;
    const newlyCrossed = hazardPairs
      .map(([previous, current]) => {
        if (
          current === null ||
          (previous !== null &&
            previous.family === current.family &&
            previous.rank >= current.rank)
        ) {
          return null;
        }
        return current;
      })
      .filter(
        (
          hazard,
        ): hazard is RotationHabitabilityHazard =>
          hazard !== null,
      );
    if (newlyCrossed.length === 0) continue;
    const targetPassengerIds = awakePassengersInRingFn(ring.id).map(
      (person) => person.id,
    );
    if (targetPassengerIds.length === 0) continue;
    for (const hazard of newlyCrossed) {
      applyIncidentToRosterFn({
        eventId:
          `rotation-habitability:${ring.id}:${hazard.code}`,
        eventType: `rotation-${hazard.code}`,
        summary: hazard.summary,
        targetPassengerIds,
        healthImpact: hazard.healthImpact,
        psychologyImpact: hazard.psychologyImpact,
        experienceImpact: hazard.experienceImpact,
        valence: hazard.valence,
        salience: hazard.salience,
        confidence: 0.98,
      });
    }
  }
}

export function applyIncidentToRoster(
  passengers: PassengerSimulation,
  input: ApplyPassengerIncidentInput,
  synchronizePopulationAggregate: () => void,
  synchronizeCompartmentOccupants: () => void,
): void {
  passengers.applyPassengerIncident(input);
  synchronizePopulationAggregate();
  synchronizeCompartmentOccupants();
}

export function awakePassengersInZone(
  passengers: PassengerSimulation,
  currentZoneForPerson: (person: {
    id: string;
    cabinId: string;
  }) => ZoneId,
  zoneId: ZoneId,
) {
  return passengers
    .getAllPassengers()
    .filter(
      (person) =>
        person.lifeState === "awake" &&
        currentZoneForPerson(person) === zoneId,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

export interface CompartmentHabitabilityIncident
  extends Omit<
    ApplyPassengerIncidentInput,
    "eventId" | "targetPassengerIds"
  > {
  family: PassengerEnvironmentalHazardFamily;
  tier: Exclude<PassengerEnvironmentalHazardTier, 0>;
}

export function passengerEnvironmentalHazardTier(
  truth: ZoneTruth,
  family: PassengerEnvironmentalHazardFamily,
): PassengerEnvironmentalHazardTier {
  switch (family) {
    case "low-pressure":
      return truth.pressurePa < 50_000
        ? 2
        : truth.pressurePa < 75_000
          ? 1
          : 0;
    case "hypoxia": {
      const oxygenPartialPressurePa =
        truth.partialPressuresPa.oxygen;
      return oxygenPartialPressurePa < 14_000
        ? 2
        : oxygenPartialPressurePa < 18_000
          ? 1
          : 0;
    }
    case "high-carbon-dioxide": {
      const carbonDioxidePartialPressurePa =
        truth.partialPressuresPa.carbonDioxide;
      return carbonDioxidePartialPressurePa > 3_000
        ? 2
        : carbonDioxidePartialPressurePa > 1_500
          ? 1
          : 0;
    }
    case "cold":
      return truth.temperatureK < 273.15
        ? 2
        : truth.temperatureK < 283.15
          ? 1
          : 0;
    case "heat":
      return truth.temperatureK > 313.15
        ? 2
        : truth.temperatureK > 303.15
          ? 1
          : 0;
  }
}

export function compartmentHabitabilityIncident(
  zoneId: ZoneId,
  family: PassengerEnvironmentalHazardFamily,
  tier: Exclude<PassengerEnvironmentalHazardTier, 0>,
): CompartmentHabitabilityIncident {
  const common = {
    family,
    tier,
    confidence: 0.99,
  } as const;
  if (family === "low-pressure") {
    return tier === 1
      ? {
          ...common,
          eventType: "compartment-low-pressure-exposure",
          summary:
            `${zoneId} 压力区进入低压暴露带；耳压、呼吸负荷与应急行动限制已被乘员直接感知。`,
          healthImpact: {
            physical: -0.004,
            resilience: -0.002,
          },
          psychologyImpact: {
            stability: -0.015,
            stress: 0.03,
          },
          experienceImpact: {
            safety: -0.04,
            comfort: -0.025,
          },
          valence: -0.46,
          salience: 0.7,
        }
      : {
          ...common,
          eventType: "compartment-severe-low-pressure-exposure",
          summary:
            `${zoneId} 压力区进一步降至严重低压带；乘员承受急性缺压伤害风险并执行紧急自救程序。`,
          healthImpact: {
            physical: -0.055,
            resilience: -0.025,
            chronicRisk: 0.008,
          },
          psychologyImpact: {
            stability: -0.055,
            stress: 0.12,
          },
          experienceImpact: {
            safety: -0.13,
            comfort: -0.08,
            trust: -0.01,
          },
          valence: -0.88,
          salience: 0.96,
        };
  }
  if (family === "hypoxia") {
    return tier === 1
      ? {
          ...common,
          eventType: "compartment-hypoxia-exposure",
          summary:
            `${zoneId} 氧分压跌入低氧暴露带；清醒乘员出现呼吸急促、注意力下降等早期症状。`,
          healthImpact: {
            physical: -0.006,
            resilience: -0.003,
          },
          psychologyImpact: {
            stability: -0.012,
            stress: 0.025,
          },
          experienceImpact: {
            safety: -0.035,
            comfort: -0.02,
          },
          valence: -0.5,
          salience: 0.72,
        }
      : {
          ...common,
          eventType: "compartment-severe-hypoxia-exposure",
          summary:
            `${zoneId} 氧分压进一步跌入严重低氧带；意识与运动能力面临急性损伤风险。`,
          healthImpact: {
            physical: -0.07,
            resilience: -0.035,
            chronicRisk: 0.012,
          },
          psychologyImpact: {
            stability: -0.065,
            stress: 0.14,
          },
          experienceImpact: {
            safety: -0.15,
            comfort: -0.08,
            trust: -0.01,
          },
          valence: -0.92,
          salience: 0.98,
        };
  }
  if (family === "high-carbon-dioxide") {
    return tier === 1
      ? {
          ...common,
          eventType: "compartment-carbon-dioxide-exposure",
          summary:
            `${zoneId} 二氧化碳分压进入高暴露带；乘员出现头痛、困倦和空气质量不适。`,
          healthImpact: { physical: -0.003 },
          psychologyImpact: {
            stability: -0.01,
            stress: 0.025,
          },
          experienceImpact: {
            safety: -0.02,
            comfort: -0.03,
          },
          valence: -0.4,
          salience: 0.62,
        }
      : {
          ...common,
          eventType: "compartment-severe-carbon-dioxide-exposure",
          summary:
            `${zoneId} 二氧化碳分压升至严重暴露带；呼吸性酸中毒与认知失能风险显著上升。`,
          healthImpact: {
            physical: -0.04,
            resilience: -0.02,
            chronicRisk: 0.005,
          },
          psychologyImpact: {
            stability: -0.05,
            stress: 0.11,
          },
          experienceImpact: {
            safety: -0.09,
            comfort: -0.1,
          },
          valence: -0.82,
          salience: 0.92,
        };
  }
  if (family === "cold") {
    return tier === 1
      ? {
          ...common,
          eventType: "compartment-cold-exposure",
          summary:
            `${zoneId} 温度跌入寒冷暴露带；清醒乘员的活动舒适度和精细操作能力下降。`,
          healthImpact: {
            physical: -0.002,
            resilience: -0.004,
          },
          psychologyImpact: {
            stability: -0.008,
            stress: 0.015,
          },
          experienceImpact: {
            safety: -0.015,
            comfort: -0.04,
          },
          valence: -0.36,
          salience: 0.58,
        }
      : {
          ...common,
          eventType: "compartment-severe-cold-exposure",
          summary:
            `${zoneId} 温度进一步跌入严重寒冷带；失温与冻伤风险迫使乘员执行紧急保温程序。`,
          healthImpact: {
            physical: -0.035,
            resilience: -0.025,
            chronicRisk: 0.006,
          },
          psychologyImpact: {
            stability: -0.04,
            stress: 0.08,
          },
          experienceImpact: {
            safety: -0.07,
            comfort: -0.12,
          },
          valence: -0.78,
          salience: 0.9,
        };
  }
  return tier === 1
    ? {
        ...common,
        eventType: "compartment-heat-exposure",
        summary:
          `${zoneId} 温度升入高温暴露带；清醒乘员出现热不适、疲劳与工作效率下降。`,
        healthImpact: {
          physical: -0.003,
          resilience: -0.003,
        },
        psychologyImpact: {
          stability: -0.01,
          stress: 0.02,
        },
        experienceImpact: {
          safety: -0.015,
          comfort: -0.05,
        },
        valence: -0.4,
        salience: 0.6,
      }
    : {
        ...common,
        eventType: "compartment-severe-heat-exposure",
        summary:
          `${zoneId} 温度进一步升入严重高温带；热衰竭与器官损伤风险迫使乘员紧急避险。`,
        healthImpact: {
          physical: -0.045,
          resilience: -0.025,
          chronicRisk: 0.007,
        },
        psychologyImpact: {
          stability: -0.045,
          stress: 0.095,
        },
        experienceImpact: {
          safety: -0.08,
          comfort: -0.13,
        },
        valence: -0.82,
        salience: 0.92,
      };
}

export function validatePassengerEnvironmentalExposureStates(
  states: readonly PassengerEnvironmentalExposureState[],
  network: CompartmentAtmosphereNetwork,
): void {
  const expectedCount =
    BASELINE_ZONE_IDS.length *
    PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES.length;
  if (states.length !== expectedCount) {
    throw new Error(
      `passenger environmental exposure state must contain exactly ${expectedCount} entries`,
    );
  }
  let index = 0;
  for (const zoneId of BASELINE_ZONE_IDS) {
    const truth = network.getZoneTruth(zoneId);
    for (const family of PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES) {
      const state = states[index];
      const keys =
        state && typeof state === "object"
          ? Object.keys(state).sort()
          : [];
      if (
        !state ||
        keys.join(",") !==
          "currentTier,episode,family,zoneId" ||
        state.zoneId !== zoneId ||
        state.family !== family ||
        !Number.isSafeInteger(state.currentTier) ||
        state.currentTier < 0 ||
        state.currentTier > 2 ||
        !Number.isSafeInteger(state.episode) ||
        state.episode < 0 ||
        (state.currentTier > 0 && state.episode === 0)
      ) {
        throw new Error(
          `passenger environmental exposure entry ${index} is malformed or out of fixed order`,
        );
      }
      const expectedTier = passengerEnvironmentalHazardTier(
        truth,
        family,
      );
      if (state.currentTier !== expectedTier) {
        throw new Error(
          `passenger environmental exposure ${zoneId}/${family} does not match compartment truth`,
        );
      }
      index += 1;
    }
  }
}

export type UpdatePassengerEnvironmentalExposuresInput = {
  survivalZoneDoses: readonly ZoneHazardDose[];
  compartments: CompartmentAtmosphereNetwork;
  passengers: PassengerSimulation;
  currentZoneForPerson: (person: {
    id: string;
    cabinId: string;
  }) => ZoneId;
  deltaSeconds?: number;
  applyIncidentToRoster: (input: ApplyPassengerIncidentInput) => void;
  applyContinuousRosterDeltas: (
    targetPassengerIds: readonly string[],
    deltas: {
      physical?: number;
      stress?: number;
    },
  ) => void;
};

export type UpdatePassengerEnvironmentalExposuresResult = {
  survivalZoneDoses: ZoneHazardDose[];
  passengerEnvironmentalExposures: PassengerEnvironmentalExposureState[];
};

export function updatePassengerEnvironmentalExposures(
  input: UpdatePassengerEnvironmentalExposuresInput,
): UpdatePassengerEnvironmentalExposuresResult {
  const {
    survivalZoneDoses: previousDoses,
    compartments,
    passengers,
    currentZoneForPerson,
    deltaSeconds = 0,
    applyIncidentToRoster: applyIncident,
    applyContinuousRosterDeltas: applyContinuous,
  } = input;
  const doseByKey = new Map(
    previousDoses.map((dose) => [
      `${dose.zoneId}/${dose.family}`,
      dose,
    ]),
  );
  const nextDoses: ZoneHazardDose[] = [];
  const activeExposures: Array<{
    zoneId: ZoneId;
    family: PassengerEnvironmentalHazardFamily;
    tier: Exclude<PassengerEnvironmentalHazardTier, 0>;
    episode: number;
  }> = [];
  const continuousDoseHits: Array<{
    zoneId: ZoneId;
    family: PassengerEnvironmentalHazardFamily;
    physicalDelta: number;
    stressDelta: number;
  }> = [];

  for (const zoneId of BASELINE_ZONE_IDS) {
    const truth = compartments.getZoneTruth(zoneId);
    for (const family of PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES) {
      const previous = doseByKey.get(`${zoneId}/${family}`);
      if (!previous) {
        throw new Error(
          `survival zone dose state lost ${zoneId}/${family}`,
        );
      }
      const nextTier = passengerEnvironmentalHazardTier(
        truth,
        family,
      );
      const integrated = integrateHazardDose({
        previous,
        nextTier,
        deltaSeconds,
      });
      nextDoses.push(integrated.dose);
      if (nextTier > 0) {
        activeExposures.push({
          zoneId,
          family,
          tier: nextTier as Exclude<
            PassengerEnvironmentalHazardTier,
            0
          >,
          episode: integrated.dose.episode,
        });
      }
      if (
        deltaSeconds > 0 &&
        (integrated.physicalDelta !== 0 ||
          integrated.stressDelta !== 0)
      ) {
        continuousDoseHits.push({
          zoneId,
          family,
          physicalDelta: integrated.physicalDelta,
          stressDelta: integrated.stressDelta,
        });
      }
    }
  }

  const survivalZoneDoses = nextDoses;
  const passengerEnvironmentalExposures =
    syncExposuresFromSurvivalDoses(survivalZoneDoses);

  const awakePassengersByZone = new Map<ZoneId, Passenger[]>(
    BASELINE_ZONE_IDS.map((zoneId) => [zoneId, []]),
  );
  for (const person of passengers.getAllPassengers()) {
    if (person.lifeState !== "awake") continue;
    awakePassengersByZone.get(currentZoneForPerson(person))!.push(person);
  }

  if (activeExposures.length > 0) {
    for (const exposure of activeExposures) {
      const awakeInZone =
        awakePassengersByZone.get(exposure.zoneId)!;
      if (awakeInZone.length === 0) continue;
      // Episode memory remains for logging; continuous dose owns health drain.
      for (let tier = 1; tier <= exposure.tier; tier += 1) {
        const eventId =
          `compartment-exposure:${exposure.zoneId}:${exposure.family}:` +
          `episode-${exposure.episode}:tier-${tier}`;
        const targetPassengerIds = awakeInZone
          .filter(
            (person) =>
              !person.memories.some(
                (memory) =>
                  memory.incident?.eventId === eventId,
              ),
          )
          .map((person) => person.id);
        if (targetPassengerIds.length === 0) continue;
        const incident = compartmentHabitabilityIncident(
          exposure.zoneId,
          exposure.family,
          tier as Exclude<PassengerEnvironmentalHazardTier, 0>,
        );
        applyIncident({
          ...incident,
          // Keep psychology / experience from the episode crossing; physical
          // damage is applied continuously via survival dose below.
          healthImpact: {},
          eventId,
          targetPassengerIds,
        });
      }
    }
  }

  if (continuousDoseHits.length > 0 && deltaSeconds > 0) {
    for (const hit of continuousDoseHits) {
      const targets = awakePassengersByZone
        .get(hit.zoneId)!
        .map((person) => person.id);
      if (targets.length === 0) continue;
      // Medical zones: first-aid / monitoring buffer, not healing magic.
      const doseMultiplier =
        zoneCatalogEntry(hit.zoneId).role === "medical"
          ? MEDICAL_ZONE_SURVIVAL_DOSE_MULTIPLIER
          : 1;
      applyContinuous(targets, {
        physical: hit.physicalDelta * doseMultiplier,
        stress: hit.stressDelta * doseMultiplier,
      });
    }
  }

  validatePassengerEnvironmentalExposureStates(
    passengerEnvironmentalExposures,
    compartments,
  );

  return {
    survivalZoneDoses,
    passengerEnvironmentalExposures,
  };
}

export type ApplySurvivalRationAndStarvationInput = {
  passengers: PassengerSimulation;
  foodDryKg: number;
  rationKgPerAwakePersonDay: number;
  survivalLedger: SurvivalLedger;
  deltaSeconds: number;
  consumeFoodRationKg: (demanded: number) => number;
  applyContinuousRosterDeltas: (
    targetPassengerIds: readonly string[],
    deltas: {
      physical?: number;
      stress?: number;
    },
  ) => void;
};

export function applySurvivalRationAndStarvation(
  input: ApplySurvivalRationAndStarvationInput,
): SurvivalLedger {
  const {
    passengers,
    foodDryKg: foodBefore,
    rationKgPerAwakePersonDay,
    survivalLedger,
    deltaSeconds,
    consumeFoodRationKg,
    applyContinuousRosterDeltas: applyContinuous,
  } = input;
  const awake = passengers
    .getAllPassengers()
    .filter((person) => person.lifeState === "awake");
  const awakeCount = awake.length;
  const rationed = applyRationAndStarvation({
    foodDryKg: foodBefore,
    awakeCount,
    deltaSeconds,
    kgPerAwakePersonDay: rationKgPerAwakePersonDay,
    ledger: survivalLedger,
  });
  const demanded = foodBefore - rationed.foodDryKg;
  if (demanded > 0) {
    const consumed = consumeFoodRationKg(demanded);
    if (Math.abs(consumed - demanded) > 1e-9) {
      throw new Error(
        "survival ration food debit diverged from ledger demand",
      );
    }
  }
  const starvationDelta = rationed.starvationPhysicalDelta;
  if (starvationDelta !== 0 && awakeCount > 0) {
    applyContinuous(
      awake.map((person) => person.id),
      { physical: starvationDelta },
    );
  }
  return rationed.ledger;
}

