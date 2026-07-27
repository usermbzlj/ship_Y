/**
 * Survival pressure — dose-integrated environmental harm + ration accounting.
 * Designed to replace one-shot threshold slapstick with continuous stakes.
 */

export const SURVIVAL_SNAPSHOT_VERSION = 1 as const;

export type SurvivalHazardFamily =
  | "low-pressure"
  | "hypoxia"
  | "high-carbon-dioxide"
  | "cold"
  | "heat";

/** Per-second physical health drain while occupying a hazard tier. */
export const HAZARD_DOSE_RATE_PER_SECOND: Record<
  SurvivalHazardFamily,
  { tier1: number; tier2: number }
> = {
  "low-pressure": { tier1: 0.00002, tier2: 0.00012 },
  hypoxia: { tier1: 0.00003, tier2: 0.00018 },
  "high-carbon-dioxide": { tier1: 0.000025, tier2: 0.00014 },
  cold: { tier1: 0.000015, tier2: 0.00008 },
  heat: { tier1: 0.000018, tier2: 0.0001 },
};

/** Dry food kilograms consumed per awake person per Earth day. */
export const FOOD_KG_PER_AWAKE_PER_DAY = 0.62;

/** Psychological stress rise per second of active hazard (any family). */
export const HAZARD_STRESS_RATE_PER_SECOND = 0.00004;

/**
 * Medical-zone first-aid / monitoring capacity blunts applied dose+stress;
 * not full healing magic.
 */
export const MEDICAL_ZONE_SURVIVAL_DOSE_MULTIPLIER = 0.6;

/**
 * Operations `medical-treatment` completion benefit by patient ZoneRole.
 * Full effect only in medical zones; field care elsewhere is reduced — not beds.
 */
export const MEDICAL_ZONE_TREATMENT_EFFECT_MULTIPLIER = 1;
export const NON_MEDICAL_ZONE_TREATMENT_EFFECT_MULTIPLIER = 0.4;

/** Scale treat/stabilize deltas: 1.0 in medical ZoneRole, 0.4 elsewhere. */
export function medicalTreatmentEffectMultiplier(
  patientZoneIsMedical: boolean,
): number {
  return patientZoneIsMedical
    ? MEDICAL_ZONE_TREATMENT_EFFECT_MULTIPLIER
    : NON_MEDICAL_ZONE_TREATMENT_EFFECT_MULTIPLIER;
}

/** When food stores hit zero, physical drain per awake-person-second. */
export const STARVATION_DRAIN_PER_SECOND = 0.0005;

export interface ZoneHazardDose {
  zoneId: string;
  family: SurvivalHazardFamily;
  /** Accumulated dose-seconds at current episode (for telemetry). */
  accumulatedDoseSeconds: number;
  currentTier: 0 | 1 | 2;
  episode: number;
}

export interface SurvivalLedger {
  /** Cumulative dry food consumed by the ration model (kg). */
  rationFoodConsumedKg: number;
  /** Cumulative starvation exposure seconds across awake population. */
  starvationExposurePersonSeconds: number;
  /** Last simulation day index for which daily ration was settled. */
  lastSettledDayIndex: number;
}

export interface SurvivalSnapshot {
  snapshotVersion: typeof SURVIVAL_SNAPSHOT_VERSION;
  ledger: SurvivalLedger;
  zoneDoses: ZoneHazardDose[];
}

export function createEmptySurvivalLedger(): SurvivalLedger {
  return {
    rationFoodConsumedKg: 0,
    starvationExposurePersonSeconds: 0,
    lastSettledDayIndex: -1,
  };
}

export function doseRateForTier(
  family: SurvivalHazardFamily,
  tier: 0 | 1 | 2,
): number {
  if (tier <= 0) return 0;
  const rates = HAZARD_DOSE_RATE_PER_SECOND[family];
  return tier >= 2 ? rates.tier2 : rates.tier1;
}

export function integrateHazardDose(input: {
  previous: ZoneHazardDose;
  nextTier: 0 | 1 | 2;
  deltaSeconds: number;
}): { dose: ZoneHazardDose; physicalDelta: number; stressDelta: number } {
  const { previous, nextTier, deltaSeconds } = input;
  let episode = previous.episode;
  if (previous.currentTier === 0 && nextTier > 0) {
    episode += 1;
  }
  const rate = doseRateForTier(previous.family, nextTier);
  const physicalDelta = -(rate * deltaSeconds);
  const stressDelta =
    nextTier > 0 ? HAZARD_STRESS_RATE_PER_SECOND * deltaSeconds : 0;
  const accumulatedDoseSeconds =
    nextTier > 0
      ? previous.accumulatedDoseSeconds + deltaSeconds
      : previous.currentTier > 0
        ? previous.accumulatedDoseSeconds
        : 0;

  return {
    dose: {
      zoneId: previous.zoneId,
      family: previous.family,
      accumulatedDoseSeconds,
      currentTier: nextTier,
      episode,
    },
    physicalDelta,
    stressDelta,
  };
}

export function rationFoodDemandKg(
  awakeCount: number,
  deltaSeconds: number,
  kgPerAwakePersonDay = FOOD_KG_PER_AWAKE_PER_DAY,
): number {
  if (awakeCount <= 0 || deltaSeconds <= 0) return 0;
  if (!Number.isFinite(kgPerAwakePersonDay) || kgPerAwakePersonDay < 0) {
    throw new RangeError("ration kg per awake person day must be non-negative");
  }
  return (awakeCount * kgPerAwakePersonDay * deltaSeconds) / 86_400;
}

export function applyRationAndStarvation(input: {
  foodDryKg: number;
  awakeCount: number;
  deltaSeconds: number;
  kgPerAwakePersonDay?: number;
  ledger: SurvivalLedger;
}): {
  foodDryKg: number;
  ledger: SurvivalLedger;
  starvationPhysicalDelta: number;
} {
  const demand = rationFoodDemandKg(
    input.awakeCount,
    input.deltaSeconds,
    input.kgPerAwakePersonDay,
  );
  const available = Math.max(0, input.foodDryKg);
  const consumed = Math.min(available, demand);
  const shortfall = demand - consumed;
  const starvationPersonSeconds =
    input.awakeCount > 0 && demand > 0
      ? (shortfall / demand) * input.awakeCount * input.deltaSeconds
      : 0;
  const starvationPhysicalDelta =
    input.awakeCount > 0
      ? -(STARVATION_DRAIN_PER_SECOND * starvationPersonSeconds) /
        input.awakeCount
      : 0;

  return {
    foodDryKg: available - consumed,
    ledger: {
      rationFoodConsumedKg: input.ledger.rationFoodConsumedKg + consumed,
      starvationExposurePersonSeconds:
        input.ledger.starvationExposurePersonSeconds + starvationPersonSeconds,
      lastSettledDayIndex: input.ledger.lastSettledDayIndex,
    },
    starvationPhysicalDelta,
  };
}

export function snapshotSurvival(
  ledger: SurvivalLedger,
  zoneDoses: ZoneHazardDose[],
): SurvivalSnapshot {
  return {
    snapshotVersion: SURVIVAL_SNAPSHOT_VERSION,
    ledger: { ...ledger },
    zoneDoses: zoneDoses.map((z) => ({ ...z })),
  };
}

export function restoreSurvival(snapshot: SurvivalSnapshot): {
  ledger: SurvivalLedger;
  zoneDoses: ZoneHazardDose[];
} {
  if (snapshot.snapshotVersion !== SURVIVAL_SNAPSHOT_VERSION) {
    throw new Error(
      `unsupported survival snapshot version ${String(snapshot.snapshotVersion)}`,
    );
  }
  return {
    ledger: { ...snapshot.ledger },
    zoneDoses: snapshot.zoneDoses.map((z) => ({ ...z })),
  };
}
