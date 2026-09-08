"use client";

import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ExternalInterventionRequest, ShipState } from "@/lib/sim";
import {
  buildCausalInterventionRequest,
  buildForceOverrideRequest,
} from "@/lib/sim/causal-event-catalog";
import type { SimulationWorkerCommand } from "@/lib/sim/protocol";
import type {
  CaptainDeviceReceiptSummary,
  ForceField,
  GodAssistSessionHandle,
  LlmCallPhase,
  LocalSave,
} from "@/app/ui/types";
import type { KeyPassengerPollScheduler } from "@/lib/llm/key-passenger-polling";
import {
  createCaptainJournalSnapshot,
  type CaptainJournalSnapshot,
} from "@/lib/llm/captain-journal";
import {
  createCaptainWatchSnapshot,
  type CaptainWatchSnapshot,
} from "@/lib/llm/captain-watch";
import {
  createDepartmentStandingSnapshot,
  type DepartmentStandingSnapshot,
} from "@/lib/llm/department-standing";
import {
  createPassengerSocietySnapshot,
  type PassengerSocietySnapshot,
} from "@/lib/llm/passenger-society";
import {
  createDepartmentInboxSnapshot,
  type DepartmentInboxSnapshot,
} from "@/lib/llm/department-inbox";

export type GodInterventionToast = (
  message: string,
  options?: { persistent?: boolean },
) => void;

export type UseGodInterventionsDeps = {
  pendingSaveBarrier: MutableRefObject<{
    metadata: Omit<LocalSave, "runtimeSnapshot">;
    target?: "manual" | "auto";
    quiet?: boolean;
  } | null>;
  pendingSaves: MutableRefObject<
    Map<
      string,
      {
        metadata: Omit<LocalSave, "runtimeSnapshot">;
        target?: "manual" | "auto";
        quiet?: boolean;
      }
    >
  >;
  missionStarted: boolean;
  workerRef: MutableRefObject<Worker | null>;
  showToast: GodInterventionToast;
  cancelCaptainDecision: () => void;
  cancelKeyPassengerCall: () => void;
  keyPassengerScheduler: MutableRefObject<KeyPassengerPollScheduler>;
  latestCaptainDeviceReceipts: MutableRefObject<CaptainDeviceReceiptSummary[]>;
  updateCaptainJournalSnapshot: (value: CaptainJournalSnapshot) => void;
  updateCaptainWatchSnapshot: (value: CaptainWatchSnapshot) => void;
  updateDepartmentStandingSnapshot: (value: DepartmentStandingSnapshot) => void;
  updatePassengerSocietySnapshot: (value: PassengerSocietySnapshot) => void;
  updateDepartmentInboxSnapshot: (value: DepartmentInboxSnapshot) => void;
  setLlmCallPhase: Dispatch<SetStateAction<LlmCallPhase>>;
  worldEpoch: MutableRefObject<number>;
  pendingInterventions: MutableRefObject<
    Map<string, { resolve: () => void; reject: (error: Error) => void }>
  >;
  godAssistSessionRef: MutableRefObject<GodAssistSessionHandle | null>;
  nextRequestId: (prefix: string) => string;
  injectCausalEventRef: MutableRefObject<
    (
      eventType: string,
      label: string,
      options?: { actor?: string },
    ) => Promise<void>
  >;
  engineState: ShipState | null;
};

/**
 * 上帝模式干预：因果事件注入与原力覆写。
 * 编排依赖由调用方注入；本 hook 不引入新逻辑。
 */
export function useGodInterventions(deps: UseGodInterventionsDeps) {
  const {
    pendingSaveBarrier,
    pendingSaves,
    missionStarted,
    workerRef,
    showToast,
    cancelCaptainDecision,
    cancelKeyPassengerCall,
    keyPassengerScheduler,
    latestCaptainDeviceReceipts,
    updateCaptainJournalSnapshot,
    updateCaptainWatchSnapshot,
    updateDepartmentStandingSnapshot,
    updatePassengerSocietySnapshot,
    updateDepartmentInboxSnapshot,
    setLlmCallPhase,
    worldEpoch,
    pendingInterventions,
    godAssistSessionRef,
    nextRequestId,
    injectCausalEventRef,
    engineState,
  } = deps;

  const submitIntervention = (
    request: ExternalInterventionRequest,
    eventText: string,
  ): Promise<void> => {
    if (
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0
    ) {
      const message = "一致性存档期间暂不接受新的外部干预。";
      showToast(message, {
        persistent: true,
      });
      return Promise.reject(new Error(message));
    }
    if (!missionStarted || !workerRef.current) {
      const message = "必须先签发最高指令，才能干预正在运行的世界。";
      showToast(message);
      return Promise.reject(new Error(message));
    }
    const requestId = nextRequestId("god");
    const command: SimulationWorkerCommand = {
      type: "intervene",
      requestId,
      request,
    };
    // A07修复:事故应使在途观察失效并触发新观察,但不清空长期记忆
    // 航行志/观察哨/部门立场/乘客社会/收件箱应保留
    // 只清除在途决策状态和临时观测
    cancelCaptainDecision();
    cancelKeyPassengerCall();
    keyPassengerScheduler.current.resetObservations();
    latestCaptainDeviceReceipts.current = [];
    // 不调用 updateCaptainJournalSnapshot / updateCaptainWatchSnapshot 等
    // 长期记忆保持不变,只更新决策phase
    setLlmCallPhase("idle");
    worldEpoch.current += 1;
    const settled = new Promise<void>((resolve, reject) => {
      pendingInterventions.current.set(requestId, { resolve, reject });
    });
    const godAssistSession = godAssistSessionRef.current;
    if (godAssistSession?.active) {
      godAssistSessionRef.current = {
        ...godAssistSession,
        pendingRequestId: requestId,
      };
    }
    workerRef.current.postMessage(command);
    showToast(`正在执行并校验：${eventText}`);
    return settled;
  };

  const injectCausalEvent = (
    eventType: string,
    label: string,
    options?: { actor?: string },
  ): Promise<void> => {
    let request: ExternalInterventionRequest;
    try {
      request = buildCausalInterventionRequest(eventType, options);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `unsupported causal event type: ${eventType}`;
      showToast(`不支持的因果事件类型：${eventType}`, {
        persistent: true,
      });
      return Promise.reject(new Error(message));
    }
    return submitIntervention(request, `已触发因果事件：${label}`);
  };

  useEffect(() => {
    injectCausalEventRef.current = injectCausalEvent;
  });

  const forceOverride = (
    field: ForceField,
    value: number,
  ): Promise<void> => {
    if (!engineState) {
      const message = "尚无可覆写的物理快照。";
      showToast(message);
      return Promise.reject(new Error(message));
    }

    return submitIntervention(
      buildForceOverrideRequest(field, value, engineState),
      `原力覆写：${field.label} ← ${value} ${field.unit}`,
    );
  };

  return { submitIntervention, injectCausalEvent, forceOverride };
}
