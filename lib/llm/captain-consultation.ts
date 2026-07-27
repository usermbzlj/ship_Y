import {
  SHIP_DEPARTMENT_IDS,
  type ShipDepartmentId,
} from "../sim/captain-operations.ts";

export const CAPTAIN_CONSULTATION_PARTIAL_FAILURE_MESSAGE =
  "部门咨询部分失败，已以降级简报继续";

export interface CaptainConsultationRequest {
  departmentIds: ShipDepartmentId[];
  question: string;
  rounds: 1 | 2 | 3;
}

export interface CaptainConsultationTurn {
  round: 1 | 2 | 3;
  departmentId: ShipDepartmentId;
}

export type CaptainConsultationAttempt<T> =
  | { ok: true; value: T }
  | { ok: false; departmentId: string; error: unknown };

export function parseCaptainConsultationRequest(
  value: unknown,
): CaptainConsultationRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("舰长部门会议参数无效");
  }
  const input = value as Record<string, unknown>;
  const rawDepartmentIds = input.departmentIds;
  const rawQuestion = input.question;
  const rawRounds = input.rounds;
  if (
    !Array.isArray(rawDepartmentIds) ||
    rawDepartmentIds.length === 0 ||
    rawDepartmentIds.length > SHIP_DEPARTMENT_IDS.length ||
    !rawDepartmentIds.every(
      (departmentId) =>
        typeof departmentId === "string" &&
        (SHIP_DEPARTMENT_IDS as readonly string[]).includes(departmentId),
    ) ||
    typeof rawQuestion !== "string" ||
    !rawQuestion.trim() ||
    typeof rawRounds !== "number" ||
    !Number.isSafeInteger(rawRounds) ||
    rawRounds < 1 ||
    rawRounds > 3
  ) {
    throw new Error("舰长部门会议参数无效");
  }
  return {
    departmentIds: [
      ...new Set(rawDepartmentIds as ShipDepartmentId[]),
    ],
    question: rawQuestion.trim(),
    rounds: rawRounds as 1 | 2 | 3,
  };
}

export function buildCaptainConsultationTurns(
  request: CaptainConsultationRequest,
): CaptainConsultationTurn[] {
  return Array.from({ length: request.rounds }, (_, index) =>
    request.departmentIds.map((departmentId) => ({
      round: (index + 1) as 1 | 2 | 3,
      departmentId,
    })),
  ).flat();
}

/** Abort / mission-cancel / superseded decision — must not soft-degrade. */
export function isCaptainConsultationHardFailure(
  error: unknown,
  hardErrors: readonly unknown[] = [],
): boolean {
  if (hardErrors.includes(error)) {
    return true;
  }
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: string }).name;
    if (name === "AbortError") {
      return true;
    }
  }
  return false;
}

export function partitionCaptainConsultationAttempts<T>(
  attempts: ReadonlyArray<CaptainConsultationAttempt<T>>,
): {
  results: T[];
  failures: Array<{ departmentId: string; message: string }>;
} {
  const results: T[] = [];
  const failures: Array<{ departmentId: string; message: string }> = [];
  for (const attempt of attempts) {
    if (attempt.ok) {
      results.push(attempt.value);
      continue;
    }
    failures.push({
      departmentId: attempt.departmentId,
      message:
        attempt.error instanceof Error
          ? attempt.error.message
          : String(attempt.error),
    });
  }
  return { results, failures };
}
