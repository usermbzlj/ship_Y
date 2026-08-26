// Match the Worker's boundary-reached tolerance (its clock is integer
// microseconds); a tighter epsilon here let a boundary the Worker treats as
// reached read as not-yet-due, so the routine schedule was never advanced.
const DEADLINE_EPSILON_SECONDS = 1e-6;

export type CaptainDecisionCompletion = {
  simulationSeconds: number;
  status: string;
};

export function isCaptainRoutineDue(
  simulationSeconds: number,
  deadlineSimulationSeconds: number | null,
): boolean {
  return (
    deadlineSimulationSeconds !== null &&
    simulationSeconds + DEADLINE_EPSILON_SECONDS >=
      deadlineSimulationSeconds
  );
}

/**
 * A captain cycle performed at an already-due routine boundary satisfies that
 * boundary even when a simultaneous alert supplied the human-readable reason.
 */
export function captainDecisionAdvancesRoutineSchedule(input: {
  triggerKey: string;
  simulationSeconds: number;
  deadlineSimulationSeconds: number | null;
}): boolean {
  return (
    input.triggerKey === "mission-start" ||
    input.triggerKey.startsWith("routine:") ||
    // The Worker issues routine triggers as "captain-routine:<deadline>".
    input.triggerKey.startsWith("captain-routine:") ||
    isCaptainRoutineDue(
      input.simulationSeconds,
      input.deadlineSimulationSeconds,
    )
  );
}

export function computeNextCaptainRoutineDeadline(
  completedAtSimulationSeconds: number,
  routineIntervalSimulationSeconds: number,
): number {
  if (
    !Number.isFinite(completedAtSimulationSeconds) ||
    completedAtSimulationSeconds < 0
  ) {
    throw new Error("captain decision completion time must be finite and non-negative");
  }
  if (
    !Number.isFinite(routineIntervalSimulationSeconds) ||
    routineIntervalSimulationSeconds <= 0
  ) {
    throw new Error("captain routine interval must be finite and positive");
  }
  return completedAtSimulationSeconds + routineIntervalSimulationSeconds;
}

export function completedCaptainDecisionCoversDeadline(
  deadlineSimulationSeconds: number | null,
  decisions: readonly CaptainDecisionCompletion[],
): boolean {
  if (deadlineSimulationSeconds === null) {
    return false;
  }
  return decisions.some(
    (decision) =>
      decision.status === "done" &&
      decision.simulationSeconds + DEADLINE_EPSILON_SECONDS >=
        deadlineSimulationSeconds,
  );
}
