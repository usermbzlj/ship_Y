"use client";

import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  SimulationWorkerCommand,
  SimulationWorkerEvent,
} from "@/lib/sim/protocol";
import type { LlmCallPhase } from "@/app/ui/types";
import type { CaptainJournalSnapshot } from "@/lib/llm/captain-journal";
import type { CaptainWatchSnapshot } from "@/lib/llm/captain-watch";
import type { DepartmentStandingSnapshot } from "@/lib/llm/department-standing";
import type { DepartmentInboxSnapshot } from "@/lib/llm/department-inbox";
import type { PassengerSocietySnapshot } from "@/lib/llm/passenger-society";

export type PendingWorkerLlmEffect = {
  callId: string;
  observationRevision: number;
  triggerKey: string;
  frozenAtSimulationSeconds: number;
};

export type LlmEffectBridgeToast = (
  message: string,
  options?: { persistent?: boolean },
) => void;

export type UseLlmEffectBridgeDeps = {
  workerRef: MutableRefObject<Worker | null>;
  requestSequence: MutableRefObject<number>;
  captainJournalSnapshotRef: MutableRefObject<CaptainJournalSnapshot>;
  captainWatchSnapshotRef: MutableRefObject<CaptainWatchSnapshot>;
  departmentStandingSnapshotRef: MutableRefObject<DepartmentStandingSnapshot>;
  passengerSocietySnapshotRef: MutableRefObject<PassengerSocietySnapshot>;
  departmentInboxSnapshotRef: MutableRefObject<DepartmentInboxSnapshot>;
  setLlmCallPhase: Dispatch<SetStateAction<LlmCallPhase>>;
  showToast: LlmEffectBridgeToast;
  updateNextCaptainRoutineDeadline: (value: number | null) => void;
};

/**
 * Worker-owned LLM effect accept/fail/finish posts + onmessage handlers for
 * llm-effect-request / llm-effect-aborted. Behavior-preserving extraction.
 */
export function useLlmEffectBridge(deps: UseLlmEffectBridgeDeps) {
  const {
    workerRef,
    requestSequence,
    captainJournalSnapshotRef,
    captainWatchSnapshotRef,
    departmentStandingSnapshotRef,
    passengerSocietySnapshotRef,
    departmentInboxSnapshotRef,
    setLlmCallPhase,
    showToast,
    updateNextCaptainRoutineDeadline,
  } = deps;

  const pendingWorkerLlmEffect = useRef<PendingWorkerLlmEffect | null>(null);

  const postLlmEffectAccept = useCallback(
    (args: {
      callId: string;
      observationRevision: number;
      result: { toolCalls?: unknown[]; [key: string]: unknown };
    }) => {
      const worker = workerRef.current;
      if (!worker) return;
      requestSequence.current += 1;
      const command: SimulationWorkerCommand = {
        type: "llm-effect-accept",
        requestId: `llm-accept-${requestSequence.current}`,
        callId: args.callId,
        observationRevision: args.observationRevision,
        result: args.result,
      };
      worker.postMessage(command);
    },
    [requestSequence, workerRef],
  );

  const postLlmEffectFail = useCallback(
    (args: {
      callId: string;
      observationRevision: number;
      reason: string;
      retryable: boolean;
    }) => {
      const worker = workerRef.current;
      if (!worker) return;
      requestSequence.current += 1;
      const command: SimulationWorkerCommand = {
        type: "llm-effect-fail",
        requestId: `llm-fail-${requestSequence.current}`,
        callId: args.callId,
        observationRevision: args.observationRevision,
        reason: args.reason,
        retryable: args.retryable,
      };
      worker.postMessage(command);
      pendingWorkerLlmEffect.current = null;
    },
    [requestSequence, workerRef],
  );

  const postLlmEffectFinish = useCallback(
    (args: {
      callId: string;
      advancesRoutineSchedule: boolean;
      nextCaptainRoutineAtSimulationSeconds?: number | null;
    }) => {
      const worker = workerRef.current;
      if (!worker) return;
      requestSequence.current += 1;
      const command: SimulationWorkerCommand = {
        type: "llm-effect-finish",
        requestId: `llm-finish-${requestSequence.current}`,
        callId: args.callId,
        advancesRoutineSchedule: args.advancesRoutineSchedule,
        nextCaptainRoutineAtSimulationSeconds:
          args.nextCaptainRoutineAtSimulationSeconds,
        captainJournal: captainJournalSnapshotRef.current,
        captainWatch: captainWatchSnapshotRef.current,
        departmentStanding: departmentStandingSnapshotRef.current,
        passengerSociety: passengerSocietySnapshotRef.current,
        departmentInbox: departmentInboxSnapshotRef.current,
      };
      worker.postMessage(command);
      pendingWorkerLlmEffect.current = null;
    },
    [
      captainJournalSnapshotRef,
      captainWatchSnapshotRef,
      departmentStandingSnapshotRef,
      passengerSocietySnapshotRef,
      departmentInboxSnapshotRef,
      requestSequence,
      workerRef,
    ],
  );

  const handleLlmEffectWorkerEvent = useCallback(
    (
      event: Extract<
        SimulationWorkerEvent,
        { type: "llm-effect-request" | "llm-effect-aborted" }
      >,
    ): void => {
      if (event.type === "llm-effect-request") {
        pendingWorkerLlmEffect.current = {
          callId: event.payload.callId,
          observationRevision: event.payload.observationRevision,
          triggerKey: event.payload.triggerKey,
          frozenAtSimulationSeconds:
            event.payload.frozenAtSimulationSeconds,
        };
        setLlmCallPhase("waiting");
        return;
      }
      pendingWorkerLlmEffect.current = null;
      // Worker already cleared pending and did not hold llm-waiting.
      // Re-arm routine deadline for captain-routine so the cycle can retry.
      if (event.payload.triggerKey.startsWith("captain-routine:")) {
        updateNextCaptainRoutineDeadline(
          event.payload.frozenAtSimulationSeconds,
        );
      }
      setLlmCallPhase((phase) =>
        phase === "waiting" ? "idle" : phase,
      );
      showToast(
        "读档时中断了未完成的舰长工具应用，世界已解冻；例行周期可按原截止点重试。",
      );
    },
    [setLlmCallPhase, showToast, updateNextCaptainRoutineDeadline],
  );

  /** Keep React pending mirror in sync with stepped/ready orchestration. */
  const syncPendingFromOrchestration = useCallback(
    (
      orchestration:
        | {
            pending: PendingWorkerLlmEffect | null;
          }
        | null
        | undefined,
    ) => {
      if (!orchestration) return;
      const orchestrationPending = orchestration.pending ?? null;
      if (orchestrationPending) {
        pendingWorkerLlmEffect.current = {
          callId: orchestrationPending.callId,
          observationRevision: orchestrationPending.observationRevision,
          triggerKey: orchestrationPending.triggerKey,
          frozenAtSimulationSeconds:
            orchestrationPending.frozenAtSimulationSeconds,
        };
      } else if (pendingWorkerLlmEffect.current !== null) {
        // Worker cleared pending (accept/fail/finish completed).
        pendingWorkerLlmEffect.current = null;
      }
    },
    [],
  );

  return {
    pendingWorkerLlmEffect,
    postLlmEffectAccept,
    postLlmEffectFail,
    postLlmEffectFinish,
    handleLlmEffectWorkerEvent,
    syncPendingFromOrchestration,
  };
}
