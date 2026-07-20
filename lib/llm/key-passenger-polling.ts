import { DEFAULT_KEY_LLM_PASSENGER_IDS } from "../sim/passengers.ts";
import type { PassengerHighlightTelemetry } from "../sim/protocol.ts";

export const KEY_PASSENGER_POLLING_SNAPSHOT_VERSION = 2 as const;
export const KEY_PASSENGER_OBSERVATION_DELAY_SECONDS = 300;
export const KEY_PASSENGER_MINIMUM_ROUTINE_SECONDS = 6 * 60 * 60;
export const KEY_PASSENGER_DEFAULT_ROUTINE_SECONDS = 12 * 60 * 60;
export const KEY_PASSENGER_GLOBAL_GAP_SIM_SECONDS = 15 * 60;
export const KEY_PASSENGER_GLOBAL_GAP_WALL_MS = 15_000;
export const KEY_PASSENGER_DAILY_ATTEMPT_LIMIT = 64;
export const KEY_PASSENGER_FAILURE_RETRY_BASE_SECONDS = 30 * 60;
export const KEY_PASSENGER_FAILURE_RETRY_MAX_SECONDS = 6 * 60 * 60;

type ConditionBand = "stable" | "watch" | "critical";
type StressBand = "low" | "moderate" | "high";
type TrustBand = "low" | "mixed" | "high";
type ObservedPressureBand =
  | "unknown"
  | "low"
  | "nominal"
  | "high";

export interface KeyPassengerSelfObservation {
  passengerId: string;
  sampledAtSimulationSeconds: number;
  displayName: string;
  occupation: string;
  cabinId: string;
  assignedZoneId: PassengerHighlightTelemetry["zoneId"];
  assignedZoneCondition: PassengerHighlightTelemetry["zoneCondition"];
  observedPressureBand: ObservedPressureBand;
  lifeState: PassengerHighlightTelemetry["lifeState"];
  physicalHealthBand: ConditionBand;
  medicalStabilityBand: ConditionBand;
  psychologicalStabilityBand: ConditionBand;
  stressBand: StressBand;
  trustBand: TrustBand;
}

interface KeyPassengerObservationSlot {
  passengerId: string;
  published: KeyPassengerSelfObservation | null;
  pending: KeyPassengerSelfObservation | null;
}

interface KeyPassengerAgentSchedule {
  passengerId: string;
  lastSuccessSimulationSeconds: number | null;
  lastAttemptSimulationSeconds: number | null;
  nextRetrySimulationSeconds: number;
  consecutiveFailures: number;
  previousOwnNote: string | null;
}

export interface KeyPassengerPollingSnapshot {
  snapshotVersion: typeof KEY_PASSENGER_POLLING_SNAPSHOT_VERSION;
  roundRobinCursor: number;
  nextGlobalEligibleSimulationSeconds: number;
  budgetDayIndex: number;
  attemptsInBudgetDay: number;
  observations: KeyPassengerObservationSlot[];
  schedules: KeyPassengerAgentSchedule[];
}

export interface KeyPassengerPollCandidate {
  passengerId: string;
  observation: KeyPassengerSelfObservation;
  sampleAgeSeconds: number;
  previousOwnNote: string | null;
}

export interface KeyPassengerPrivateNote {
  passengerId: string;
  createdAtSimulationSeconds: number;
  text: string;
}

const KEY_PASSENGER_ID_SET = new Set(
  DEFAULT_KEY_LLM_PASSENGER_IDS,
);
const MAX_PREVIOUS_OWN_NOTE_CHARACTERS = 512;
const OBSERVATION_KEYS = [
  "passengerId",
  "sampledAtSimulationSeconds",
  "displayName",
  "occupation",
  "cabinId",
  "assignedZoneId",
  "assignedZoneCondition",
  "observedPressureBand",
  "lifeState",
  "physicalHealthBand",
  "medicalStabilityBand",
  "psychologicalStabilityBand",
  "stressBand",
  "trustBand",
] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function conditionBand(value: number): ConditionBand {
  if (value >= 0.75) return "stable";
  if (value >= 0.45) return "watch";
  return "critical";
}

function stressBand(value: number): StressBand {
  if (value <= 0.35) return "low";
  if (value <= 0.7) return "moderate";
  return "high";
}

function trustBand(value: number): TrustBand {
  if (value >= 0.7) return "high";
  if (value >= 0.4) return "mixed";
  return "low";
}

function observedPressureBand(
  observedPressurePa: number | null,
): ObservedPressureBand {
  if (
    observedPressurePa === null ||
    !Number.isFinite(observedPressurePa)
  ) {
    return "unknown";
  }
  if (observedPressurePa < 90_000) return "low";
  if (observedPressurePa > 110_000) return "high";
  return "nominal";
}

function toObservation(
  sampledAtSimulationSeconds: number,
  telemetry: PassengerHighlightTelemetry,
): KeyPassengerSelfObservation {
  return {
    passengerId: telemetry.passengerId,
    sampledAtSimulationSeconds,
    displayName: telemetry.name,
    occupation: telemetry.occupation,
    cabinId: telemetry.cabinId,
    assignedZoneId: telemetry.zoneId,
    assignedZoneCondition: telemetry.zoneCondition,
    observedPressureBand: observedPressureBand(
      telemetry.zoneObservedPressurePa,
    ),
    lifeState: telemetry.lifeState,
    physicalHealthBand: conditionBand(telemetry.physicalHealth),
    medicalStabilityBand: conditionBand(
      telemetry.medicalStability,
    ),
    psychologicalStabilityBand: conditionBand(
      telemetry.psychologicalStability,
    ),
    stressBand: stressBand(telemetry.stress),
    trustBand: trustBand(telemetry.trust),
  };
}

function initialObservationSlots(): KeyPassengerObservationSlot[] {
  return DEFAULT_KEY_LLM_PASSENGER_IDS.map((passengerId) => ({
    passengerId,
    published: null,
    pending: null,
  }));
}

function initialSchedules(): KeyPassengerAgentSchedule[] {
  return DEFAULT_KEY_LLM_PASSENGER_IDS.map((passengerId) => ({
    passengerId,
    lastSuccessSimulationSeconds: null,
    lastAttemptSimulationSeconds: null,
    nextRetrySimulationSeconds: 0,
    consecutiveFailures: 0,
    previousOwnNote: null,
  }));
}

function assertFiniteNonNegative(
  value: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and non-negative`);
  }
}

function assertNullableFiniteNonNegative(
  value: number | null,
  label: string,
): void {
  if (value !== null) {
    assertFiniteNonNegative(value, label);
  }
}

function validateObservation(
  observation: KeyPassengerSelfObservation,
  passengerId: string,
  label: string,
): void {
  if (
    typeof observation !== "object" ||
    observation === null ||
    Array.isArray(observation) ||
    Object.keys(observation).length !== OBSERVATION_KEYS.length ||
    Object.keys(observation).some(
      (key) => !OBSERVATION_KEYS.includes(
        key as (typeof OBSERVATION_KEYS)[number],
      ),
    ) ||
    observation.passengerId !== passengerId ||
    typeof observation.displayName !== "string" ||
    observation.displayName.length < 1 ||
    observation.displayName.length > 128 ||
    typeof observation.occupation !== "string" ||
    observation.occupation.length < 1 ||
    observation.occupation.length > 128 ||
    typeof observation.cabinId !== "string" ||
    observation.cabinId.length < 1 ||
    observation.cabinId.length > 64 ||
    !/^[AB]-(?:0[1-9]|1\d|2[0-4])$/.test(
      observation.assignedZoneId,
    ) ||
    !["nominal", "watch", "critical", "offline"].includes(
      observation.assignedZoneCondition,
    ) ||
    !["unknown", "low", "nominal", "high"].includes(
      observation.observedPressureBand,
    ) ||
    !["awake", "hibernating", "deceased"].includes(
      observation.lifeState,
    ) ||
    !["stable", "watch", "critical"].includes(
      observation.physicalHealthBand,
    ) ||
    !["stable", "watch", "critical"].includes(
      observation.medicalStabilityBand,
    ) ||
    !["stable", "watch", "critical"].includes(
      observation.psychologicalStabilityBand,
    ) ||
    !["low", "moderate", "high"].includes(
      observation.stressBand,
    ) ||
    !["low", "mixed", "high"].includes(
      observation.trustBand,
    )
  ) {
    throw new Error(`${label} is invalid`);
  }
  assertFiniteNonNegative(
    observation.sampledAtSimulationSeconds,
    `${label}.sampledAtSimulationSeconds`,
  );
}

export function validateKeyPassengerPollingSnapshot(
  snapshot: KeyPassengerPollingSnapshot,
): void {
  if (
    snapshot.snapshotVersion !==
    KEY_PASSENGER_POLLING_SNAPSHOT_VERSION
  ) {
    throw new Error("unsupported key-passenger polling snapshot");
  }
  if (
    !Number.isSafeInteger(snapshot.roundRobinCursor) ||
    snapshot.roundRobinCursor < 0 ||
    snapshot.roundRobinCursor >=
      DEFAULT_KEY_LLM_PASSENGER_IDS.length
  ) {
    throw new Error("invalid key-passenger round-robin cursor");
  }
  assertFiniteNonNegative(
    snapshot.nextGlobalEligibleSimulationSeconds,
    "nextGlobalEligibleSimulationSeconds",
  );
  if (
    !Number.isSafeInteger(snapshot.budgetDayIndex) ||
    snapshot.budgetDayIndex < 0 ||
    !Number.isSafeInteger(snapshot.attemptsInBudgetDay) ||
    snapshot.attemptsInBudgetDay < 0 ||
    snapshot.attemptsInBudgetDay >
      KEY_PASSENGER_DAILY_ATTEMPT_LIMIT
  ) {
    throw new Error("invalid key-passenger daily budget");
  }
  if (
    snapshot.observations.length !==
      DEFAULT_KEY_LLM_PASSENGER_IDS.length ||
    snapshot.schedules.length !==
      DEFAULT_KEY_LLM_PASSENGER_IDS.length
  ) {
    throw new Error(
      "key-passenger scheduler must preserve all 32 fixed slots",
    );
  }

  for (
    let index = 0;
    index < DEFAULT_KEY_LLM_PASSENGER_IDS.length;
    index += 1
  ) {
    const passengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[index];
    const observation = snapshot.observations[index];
    const schedule = snapshot.schedules[index];
    if (
      observation.passengerId !== passengerId ||
      schedule.passengerId !== passengerId
    ) {
      throw new Error(
        "key-passenger polling slots must remain in fixed roster order",
      );
    }
    if (observation.published) {
      validateObservation(
        observation.published,
        passengerId,
        `observations[${index}].published`,
      );
    }
    if (observation.pending) {
      validateObservation(
        observation.pending,
        passengerId,
        `observations[${index}].pending`,
      );
    }
    if (
      observation.published &&
      observation.pending &&
      observation.pending.sampledAtSimulationSeconds <=
        observation.published.sampledAtSimulationSeconds
    ) {
      throw new Error(
        "pending key-passenger observation must be newer than published observation",
      );
    }
    assertNullableFiniteNonNegative(
      schedule.lastSuccessSimulationSeconds,
      `schedules[${index}].lastSuccessSimulationSeconds`,
    );
    assertNullableFiniteNonNegative(
      schedule.lastAttemptSimulationSeconds,
      `schedules[${index}].lastAttemptSimulationSeconds`,
    );
    assertFiniteNonNegative(
      schedule.nextRetrySimulationSeconds,
      `schedules[${index}].nextRetrySimulationSeconds`,
    );
    if (
      !Number.isSafeInteger(schedule.consecutiveFailures) ||
      schedule.consecutiveFailures < 0 ||
      schedule.consecutiveFailures > 32 ||
      (schedule.previousOwnNote !== null &&
        (typeof schedule.previousOwnNote !== "string" ||
          schedule.previousOwnNote.length >
            MAX_PREVIOUS_OWN_NOTE_CHARACTERS))
    ) {
      throw new Error(
        `schedules[${index}] has invalid retained state`,
      );
    }
  }
}

export class KeyPassengerPollScheduler {
  private observationsValue = initialObservationSlots();
  private schedulesValue = initialSchedules();
  private roundRobinCursorValue = 0;
  private nextGlobalEligibleSimulationSecondsValue = 0;
  private budgetDayIndexValue = 0;
  private attemptsInBudgetDayValue = 0;
  private lastWallDispatchEpochMsValue = Number.NEGATIVE_INFINITY;

  static restore(input: unknown): KeyPassengerPollScheduler {
    if (typeof input !== "object" || input === null) {
      throw new Error("key-passenger polling snapshot must be an object");
    }
    const snapshot = clone(input) as KeyPassengerPollingSnapshot;
    validateKeyPassengerPollingSnapshot(snapshot);
    const scheduler = new KeyPassengerPollScheduler();
    scheduler.observationsValue = snapshot.observations;
    scheduler.schedulesValue = snapshot.schedules;
    scheduler.roundRobinCursorValue = snapshot.roundRobinCursor;
    scheduler.nextGlobalEligibleSimulationSecondsValue =
      snapshot.nextGlobalEligibleSimulationSeconds;
    scheduler.budgetDayIndexValue = snapshot.budgetDayIndex;
    scheduler.attemptsInBudgetDayValue =
      snapshot.attemptsInBudgetDay;
    return scheduler;
  }

  observe(
    simulationSeconds: number,
    highlights: readonly PassengerHighlightTelemetry[],
  ): void {
    assertFiniteNonNegative(simulationSeconds, "simulationSeconds");
    const byId = new Map(
      highlights.map((highlight) => [
        highlight.passengerId,
        highlight,
      ]),
    );
    for (const slot of this.observationsValue) {
      if (
        slot.pending &&
        simulationSeconds -
          slot.pending.sampledAtSimulationSeconds >=
          KEY_PASSENGER_OBSERVATION_DELAY_SECONDS
      ) {
        slot.published = slot.pending;
        slot.pending = null;
      }
      if (slot.pending) continue;
      const telemetry = byId.get(slot.passengerId);
      if (!telemetry || !telemetry.isKeyLlm) continue;
      slot.pending = toObservation(simulationSeconds, telemetry);
    }
  }

  selectNextDue(
    simulationSeconds: number,
    wallEpochMs: number,
    routineSecondsByPassenger: ReadonlyMap<string, number>,
  ): KeyPassengerPollCandidate | null {
    assertFiniteNonNegative(simulationSeconds, "simulationSeconds");
    assertFiniteNonNegative(wallEpochMs, "wallEpochMs");
    this.refreshDailyBudget(simulationSeconds);
    if (
      simulationSeconds <
        this.nextGlobalEligibleSimulationSecondsValue ||
      wallEpochMs - this.lastWallDispatchEpochMsValue <
        KEY_PASSENGER_GLOBAL_GAP_WALL_MS ||
      this.attemptsInBudgetDayValue >=
        KEY_PASSENGER_DAILY_ATTEMPT_LIMIT
    ) {
      return null;
    }

    for (
      let offset = 0;
      offset < DEFAULT_KEY_LLM_PASSENGER_IDS.length;
      offset += 1
    ) {
      const index =
        (this.roundRobinCursorValue + offset) %
        DEFAULT_KEY_LLM_PASSENGER_IDS.length;
      const slot = this.observationsValue[index];
      const schedule = this.schedulesValue[index];
      const observation = slot.published;
      if (!observation || observation.lifeState !== "awake") {
        continue;
      }
      const configuredRoutine =
        routineSecondsByPassenger.get(slot.passengerId) ??
        KEY_PASSENGER_DEFAULT_ROUTINE_SECONDS;
      const effectiveRoutine = Math.max(
        KEY_PASSENGER_MINIMUM_ROUTINE_SECONDS,
        Number.isFinite(configuredRoutine)
          ? configuredRoutine
          : KEY_PASSENGER_DEFAULT_ROUTINE_SECONDS,
      );
      if (
        simulationSeconds < schedule.nextRetrySimulationSeconds ||
        (schedule.lastSuccessSimulationSeconds !== null &&
          simulationSeconds -
            schedule.lastSuccessSimulationSeconds <
            effectiveRoutine)
      ) {
        continue;
      }
      return {
        passengerId: slot.passengerId,
        observation: clone(observation),
        sampleAgeSeconds: Math.max(
          0,
          simulationSeconds -
            observation.sampledAtSimulationSeconds,
        ),
        previousOwnNote: schedule.previousOwnNote,
      };
    }
    return null;
  }

  markDispatched(
    passengerId: string,
    simulationSeconds: number,
    wallEpochMs: number,
  ): void {
    const index = this.requirePassengerIndex(passengerId);
    assertFiniteNonNegative(simulationSeconds, "simulationSeconds");
    assertFiniteNonNegative(wallEpochMs, "wallEpochMs");
    this.refreshDailyBudget(simulationSeconds);
    if (
      this.attemptsInBudgetDayValue >=
      KEY_PASSENGER_DAILY_ATTEMPT_LIMIT
    ) {
      throw new Error("key-passenger daily attempt budget exhausted");
    }
    const schedule = this.schedulesValue[index];
    schedule.lastAttemptSimulationSeconds = simulationSeconds;
    schedule.nextRetrySimulationSeconds =
      simulationSeconds +
      KEY_PASSENGER_FAILURE_RETRY_BASE_SECONDS;
    this.roundRobinCursorValue =
      (index + 1) % DEFAULT_KEY_LLM_PASSENGER_IDS.length;
    this.nextGlobalEligibleSimulationSecondsValue =
      simulationSeconds + KEY_PASSENGER_GLOBAL_GAP_SIM_SECONDS;
    this.lastWallDispatchEpochMsValue = wallEpochMs;
    this.attemptsInBudgetDayValue += 1;
  }

  markSucceeded(
    passengerId: string,
    simulationSeconds: number,
    ownNote: string,
  ): void {
    const schedule =
      this.schedulesValue[this.requirePassengerIndex(passengerId)];
    assertFiniteNonNegative(simulationSeconds, "simulationSeconds");
    schedule.lastSuccessSimulationSeconds = simulationSeconds;
    schedule.nextRetrySimulationSeconds = simulationSeconds;
    schedule.consecutiveFailures = 0;
    const normalizedNote = ownNote.trim();
    schedule.previousOwnNote = normalizedNote
      ? normalizedNote.slice(0, MAX_PREVIOUS_OWN_NOTE_CHARACTERS)
      : null;
  }

  markFailed(
    passengerId: string,
    simulationSeconds: number,
  ): void {
    const schedule =
      this.schedulesValue[this.requirePassengerIndex(passengerId)];
    assertFiniteNonNegative(simulationSeconds, "simulationSeconds");
    schedule.consecutiveFailures = Math.min(
      32,
      schedule.consecutiveFailures + 1,
    );
    const retrySeconds = Math.min(
      KEY_PASSENGER_FAILURE_RETRY_MAX_SECONDS,
      KEY_PASSENGER_FAILURE_RETRY_BASE_SECONDS *
        2 ** (schedule.consecutiveFailures - 1),
    );
    schedule.nextRetrySimulationSeconds =
      simulationSeconds + retrySeconds;
  }

  resetObservations(): void {
    this.observationsValue = initialObservationSlots();
  }

  listPrivateNotes(): KeyPassengerPrivateNote[] {
    return this.schedulesValue.flatMap((schedule) =>
      schedule.previousOwnNote !== null &&
      schedule.lastSuccessSimulationSeconds !== null
        ? [
            {
              passengerId: schedule.passengerId,
              createdAtSimulationSeconds:
                schedule.lastSuccessSimulationSeconds,
              text: schedule.previousOwnNote,
            },
          ]
        : [],
    );
  }

  snapshot(): KeyPassengerPollingSnapshot {
    const snapshot: KeyPassengerPollingSnapshot = {
      snapshotVersion: KEY_PASSENGER_POLLING_SNAPSHOT_VERSION,
      roundRobinCursor: this.roundRobinCursorValue,
      nextGlobalEligibleSimulationSeconds:
        this.nextGlobalEligibleSimulationSecondsValue,
      budgetDayIndex: this.budgetDayIndexValue,
      attemptsInBudgetDay: this.attemptsInBudgetDayValue,
      observations: clone(this.observationsValue),
      schedules: clone(this.schedulesValue),
    };
    validateKeyPassengerPollingSnapshot(snapshot);
    return snapshot;
  }

  private refreshDailyBudget(simulationSeconds: number): void {
    const dayIndex = Math.floor(simulationSeconds / 86_400);
    if (dayIndex !== this.budgetDayIndexValue) {
      this.budgetDayIndexValue = dayIndex;
      this.attemptsInBudgetDayValue = 0;
    }
  }

  private requirePassengerIndex(passengerId: string): number {
    if (!KEY_PASSENGER_ID_SET.has(passengerId)) {
      throw new Error(`unknown fixed key passenger: ${passengerId}`);
    }
    return DEFAULT_KEY_LLM_PASSENGER_IDS.indexOf(passengerId);
  }
}
