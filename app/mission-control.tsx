"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ExternalInterventionRequest, ShipState } from "@/lib/sim";
import {
  listActionableUnattendedMaintenanceFaults,
  evaluateMaintenanceSchedulingFeasibility,
  isCaptainWorldCommandSoftRejectMessage,
} from "@/lib/sim/maintenance";
import {
  ATMOSPHERE_RESERVE_LEDGER_SEMANTICS,
  captainHullThreatBlocksJump,
  projectCaptainHullThreatObservation,
  projectCaptainJumpThermalEstimate,
  projectCaptainPressureZoneAlerts,
} from "@/lib/sim/captain-observation";
import {
  type CaptainOperationsSnapshot,
} from "@/lib/sim/captain-operations";
import {
  KeyPassengerPollScheduler,
  type KeyPassengerPrivateNote,
} from "@/lib/llm/key-passenger-polling";
import type {
  CommandBusTelemetry,
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  FinalJourneyReport,
  HullConsequenceTelemetry,
  MaintenanceTelemetry,
  NavigationTelemetry,
  PassengerHighlightTelemetry,
  RotationTelemetry,
  SimulationWorkerCommand,
  SimulationWorkerEvent,
  SimulationWorkerSurvivalTelemetry,
  SimulationWorkerTimeControlTelemetry,
  WaterRecoveryTelemetry,
  ZoneMoodTelemetry,
  PassengerCircleTelemetry,
} from "@/lib/sim/protocol";

// ─── 从拆分模块导入 ───────────────────────────────────────────
import type {
  ViewId,
  SystemTone,
  LlmCallPhase,
  TimelineEvent,
  LlmRuntimeStatus,
  LlmInvokeRoutePayload,
  CaptainDeviceReceiptSummary,
  LocalSave,
  GodAssistSessionHandle,
} from "@/app/ui/types";
import {
  getManualSave,
  hasManualSave,
  isQuotaExceededError,
  migrateLocalStorageSaveOnce,
  putManualSave,
  putManualSaveToLocalStorageFallback,
} from "@/lib/persist/local-save-idb";
import {
  estimateMinLegs,
  MAX_JUMP_LEG_LY,
  routeDistanceLy,
} from "@/lib/astro/star-catalog";
import {
  STAR_SYSTEMS,
  NAV_ITEMS,
  FORCE_FIELDS,
  MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE,
  AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS,
  AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS,
  AUTHORIZED_RECORD_HISTORY_LIMIT,
} from "@/app/ui/constants";
import {
  formatDuration,
  formatCadence,
  prependTimelineEvent,
  compactLlmTimelineText,
} from "@/app/ui/utils";
import {
  CAPTAIN_DECISION_INSTRUCTION,
  DEPARTMENT_CONSULTATION_REQUEST,
} from "@/app/ui/llm-readable-output";
import { VoyageView } from "@/app/ui/views/voyage-view";
import { ShipView } from "@/app/ui/views/ship-view";
import { PeopleView } from "@/app/ui/views/people-view";
import { AiView } from "@/app/ui/views/ai-view";
import { GodView } from "@/app/ui/views/god-view";
import {
  AlertBanner,
  detectAlerts,
  type ActiveAlert,
} from "@/app/ui/components/alert-banner";
import { DecisionTheater } from "@/app/ui/components/decision-theater";
import { EventRail } from "@/app/ui/components/event-rail";
import { TimeControlBar } from "@/app/ui/components/time-control-bar";
import { MissionClock } from "@/app/ui/components/mission-clock";
import { ConsoleStatusStrip } from "@/app/ui/components/console-status-strip";
import { useAudio } from "@/app/ui/use-audio";
import { TIME_SCALE_PRESETS } from "@/lib/sim/director";
import {
  CAPTAIN_CONSULTATION_PARTIAL_FAILURE_MESSAGE,
  isCaptainConsultationHardFailure,
  parseCaptainConsultationRequest,
  partitionCaptainConsultationAttempts,
  type CaptainConsultationAttempt,
} from "@/lib/llm/captain-consultation";
import {
  IDLE_DECISION_THEATER_STATE,
  decisionTheaterHeadline,
  reduceDecisionTheater,
  type DecisionTheaterEvent,
  type DecisionTheaterState,
} from "@/lib/llm/decision-theater";
import {
  RECORD_CAPTAIN_LOG_TOOL_NAME,
  appendCaptainJournalEntry,
  createCaptainJournalSnapshot,
  parseCaptainLogToolCall,
  renderCaptainJournalPromptBlock,
  validateCaptainJournalSnapshot,
  type CaptainJournalSnapshot,
} from "@/lib/llm/captain-journal";
import {
  SET_WATCH_CONDITION_TOOL_NAME,
  applyCaptainWatchCondition,
  captainWatchTriggerKey,
  createCaptainWatchSnapshot,
  evaluateCaptainWatches,
  parseSetWatchConditionToolCall,
  renderCaptainWatchPromptBlock,
  validateCaptainWatchSnapshot,
  type CaptainWatchSnapshot,
} from "@/lib/llm/captain-watch";
import {
  FILE_DISSENT_TOOL_NAME,
  createDepartmentStandingSnapshot,
  parseFileDissentToolCall,
  recordDepartmentConsultation,
  recordDepartmentDissent,
  renderCaptainDissentLedgerPromptBlock,
  renderDepartmentStandingPromptBlock,
  renderPeerPositionsPromptBlock,
  validateDepartmentStandingSnapshot,
  type DepartmentStandingSnapshot,
} from "@/lib/llm/department-standing";
import {
  FILE_GRIEVANCE_TOOL_NAME,
  PASSENGER_CIRCLE_LIMIT,
  SHARE_RUMOR_TOOL_NAME,
  createPassengerSocietySnapshot,
  markRumorsHeard,
  parseFileGrievanceToolCall,
  parseShareRumorToolCall,
  pruneStaleRumors,
  recordPassengerRumor,
  renderPassengerSocietyPromptBlock,
  selectOverheardRumors,
  validatePassengerSocietySnapshot,
  type PassengerSocietySnapshot,
} from "@/lib/llm/passenger-society";
import type { ShipWorldCommand } from "@/lib/llm/captain-world-tools";
import {
  CAPTAIN_WORLD_TOOLS,
  CAPTAIN_CONSULTATION_TOOL,
  RECORD_CAPTAIN_LOG_TOOL,
  SET_WATCH_CONDITION_TOOL,
  FILE_DISSENT_TOOL,
  FILE_PASSENGER_GRIEVANCE_TOOL,
  SHARE_PASSENGER_RUMOR_TOOL,
  parseCaptainWorldToolCall,
} from "@/lib/llm/captain-world-tools";
import {
  passengerConditionBand,
  passengerStressBand,
  passengerTrustBand,
  isFiniteNumber,
  extractCaptainWatchMetricSample,
} from "@/lib/llm/captain-watch-metrics";
import {
  captainDecisionAdvancesRoutineSchedule,
  completedCaptainDecisionCoversDeadline,
  computeNextCaptainRoutineDeadline,
  isCaptainRoutineDue,
} from "@/lib/sim/captain-schedule";


type AuthorizedControllerRecord = {
  worldEpoch: number;
  stateRevision: number;
  sampledAtSimulationSeconds: number;
  availableAtSimulationSeconds: number;
  remainingDistanceEstimateLightYears: number;
  jumpControllerState: ShipState["journey"]["status"];
  completedJumpLogCount: number;
  jumpDriveChargeEstimateKWh: number;
  jumpDriveCapacityKWh: number;
};

type AuthorizedManifestRecord = {
  worldEpoch: number;
  stateRevision: number;
  sampledAtSimulationSeconds: number;
  availableAtSimulationSeconds: number;
  awakeRegistered: number;
  hibernatingRegistered: number;
  deceasedRegistered: number;
};

type CaptainDecisionCycle = {
  token: number;
  worldEpoch: number;
  triggerKey: string;
  controller: AbortController;
};

type KeyPassengerCallCycle = {
  token: number;
  worldEpoch: number;
  pollId: string;
  passengerId: string;
  controller: AbortController;
};

type QueuedCaptainWorldCommand = {
  ordinal: number;
  toolCallId: string;
  toolName: string;
  stableCommandId: string;
  command: ShipWorldCommand;
};

type CaptainWorldCommandQueue = {
  cycleToken: number;
  worldEpoch: number;
  triggerKey: string;
  callId: string;
  commands: QueuedCaptainWorldCommand[];
  nextIndex: number;
  activeRequestId: string | null;
  receipts: CaptainDeviceReceiptSummary[];
  advancesRoutineSchedule: boolean;
  resumeAfterCompletion: boolean;
};


export function MissionControl() {
  const [activeView, setActiveView] = useState<ViewId>("voyage");
  const [missionStarted, setMissionStarted] = useState(false);
  const [paused, setPaused] = useState(true);
  const [timeScale, setTimeScale] = useState(1_800);
  const [simulationSeconds, setSimulationSeconds] = useState(0);
  const [engineState, setEngineState] = useState<ShipState | null>(null);
  const [compartmentState, setCompartmentState] =
    useState<CompartmentTelemetry | null>(null);
  const [coolingState, setCoolingState] =
    useState<CoolingTelemetry | null>(null);
  const [electricalState, setElectricalState] =
    useState<ElectricalTelemetry | null>(null);
  const [navigationState, setNavigationState] =
    useState<NavigationTelemetry | null>(null);
  const [rotationState, setRotationState] =
    useState<RotationTelemetry | null>(null);
  const [waterRecoveryState, setWaterRecoveryState] =
    useState<WaterRecoveryTelemetry | null>(null);
  const [maintenanceState, setMaintenanceState] =
    useState<MaintenanceTelemetry | null>(null);
  const [hullConsequenceState, setHullConsequenceState] =
    useState<HullConsequenceTelemetry | null>(null);
  const [operationsState, setOperationsState] =
    useState<CaptainOperationsSnapshot | null>(null);
  const [commandBusState, setCommandBusState] =
    useState<CommandBusTelemetry | null>(null);
  const [timeControl, setTimeControl] =
    useState<SimulationWorkerTimeControlTelemetry | null>(null);
  const [survival, setSurvival] =
    useState<SimulationWorkerSurvivalTelemetry | null>(null);
  const [zoneMood, setZoneMood] = useState<ZoneMoodTelemetry[]>([]);
  const [passengerCircles, setPassengerCircles] = useState<
    PassengerCircleTelemetry[]
  >([]);
  const [passengerHighlights, setPassengerHighlights] = useState<
    PassengerHighlightTelemetry[]
  >([]);
  const [keyPassengerPrivateNotes, setKeyPassengerPrivateNotes] =
    useState<KeyPassengerPrivateNote[]>([]);
  const [llmStatus, setLlmStatus] =
    useState<LlmRuntimeStatus | null>(null);
  const [llmCallPhase, setLlmCallPhase] =
    useState<LlmCallPhase>("idle");
  const [decisionTheater, setDecisionTheater] =
    useState<DecisionTheaterState>(IDLE_DECISION_THEATER_STATE);
  const decisionTheaterRef = useRef<DecisionTheaterState>(
    IDLE_DECISION_THEATER_STATE,
  );
  const [captainDecisionLog, setCaptainDecisionLog] = useState<
    import("@/app/ui/types").CaptainDecisionEntry[]
  >([]);
  const [missionEnded, setMissionEnded] = useState(false);
  const [finalReport, setFinalReport] =
    useState<FinalJourneyReport | null>(null);
  const [endReportDismissed, setEndReportDismissed] = useState(false);
  const [origin, setOrigin] = useState("sol");
  const [destination, setDestination] = useState("tau-ceti");
  const [directive, setDirective] = useState(
    "以乘员存续为最高原则，将远穹号安全送达目标星系；允许舰长根据实际风险自主规划航路与清醒比例。",
  );
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [eventFilter, setEventFilter] = useState<"all" | SystemTone>("all");
  const [eventRailOpen, setEventRailOpen] = useState(false);
  const [loadConfirmOpen, setLoadConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    persistent?: boolean;
  } | null>(null);
  const showToast = useCallback(
    (message: string, options?: { persistent?: boolean }) => {
      setToast({ message, persistent: options?.persistent });
    },
    [],
  );
  const [hasLocalSave, setHasLocalSave] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<string | null>(null);
  const markSaveWritten = useCallback(() => {
    setLastSaveTime(
      new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    setHasLocalSave(true);
  }, []);
  const persistManualSave = useCallback(
    async (
      save: LocalSave,
      options?: { successToast?: string },
    ): Promise<boolean> => {
      try {
        await putManualSave(save);
        markSaveWritten();
        if (options?.successToast) {
          showToast(options.successToast);
        }
        return true;
      } catch (error) {
        try {
          await putManualSaveToLocalStorageFallback(save);
          markSaveWritten();
          showToast("IndexedDB 不可用，已回退 localStorage");
          return true;
        } catch (fallbackError) {
          const quota =
            isQuotaExceededError(error) ||
            isQuotaExceededError(fallbackError);
          showToast(
            quota
              ? "存档空间不足，无法写入本机。"
              : "本机存档写入失败（IndexedDB 不可用）。",
            { persistent: true },
          );
          return false;
        }
      }
    },
    [markSaveWritten, showToast],
  );
  const [activeAlerts, setActiveAlerts] = useState<ActiveAlert[]>([]);
  const [shipFocus, setShipFocus] = useState<{
    zoneId: string | null;
    ringId: "A" | "B" | null;
    token: number;
  }>({ zoneId: null, ringId: null, token: 0 });
  const knownAlertIds = useRef(new Set<string>());
  const audio = useAudio();
  const {
    playAlertCritical,
    playAlertWarning,
    playAlertWatch,
  } = audio;
  const knownProceduralEventIds = useRef(new Set<string>());
  const eventId = useRef(10);
  const llmWaitingEventLoggedRef = useRef(false);
  const fidelityLimitedEventLoggedRef = useRef(false);
  const knownMaintenanceCompletionIds = useRef(new Set<string>());
  const workerRef = useRef<Worker | null>(null);
  const pendingSaves = useRef(
    new Map<
      string,
      { metadata: Omit<LocalSave, "runtimeSnapshot"> }
    >(),
  );
  const pendingInterventions = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const pendingSaveBarrier = useRef<{
    metadata: Omit<LocalSave, "runtimeSnapshot">;
  } | null>(null);
  const pendingLoad = useRef<{
    requestId: string;
    save: LocalSave;
    keyPassengerScheduler: KeyPassengerPollScheduler;
  } | null>(null);
  const requestSequence = useRef(0);
  const commandRevision = useRef(0);
  const latestStateRevision = useRef<number | null>(null);
  const latestSimulationSeconds = useRef(0);
  const latestMissionEnded = useRef(false);
  const captainRoutineSeconds = useRef(21_600);
  const nextCaptainRoutineAtSimulationSeconds = useRef<number | null>(
    null,
  );
  const [
    nextCaptainRoutineDeadline,
    setNextCaptainRoutineDeadline,
  ] = useState<number | null>(null);
  const updateNextCaptainRoutineDeadline = useCallback(
    (value: number | null) => {
      nextCaptainRoutineAtSimulationSeconds.current = value;
      setNextCaptainRoutineDeadline(value);
    },
    [],
  );
  const captainJournalSnapshotRef = useRef<CaptainJournalSnapshot>(
    createCaptainJournalSnapshot(),
  );
  const [captainJournalSnapshot, setCaptainJournalSnapshot] =
    useState<CaptainJournalSnapshot>(() => createCaptainJournalSnapshot());
  const updateCaptainJournalSnapshot = useCallback(
    (value: CaptainJournalSnapshot) => {
      captainJournalSnapshotRef.current = value;
      setCaptainJournalSnapshot(value);
    },
    [],
  );
  const captainWatchSnapshotRef = useRef<CaptainWatchSnapshot>(
    createCaptainWatchSnapshot(),
  );
  const [captainWatchSnapshot, setCaptainWatchSnapshot] =
    useState<CaptainWatchSnapshot>(() => createCaptainWatchSnapshot());
  const updateCaptainWatchSnapshot = useCallback(
    (value: CaptainWatchSnapshot) => {
      captainWatchSnapshotRef.current = value;
      setCaptainWatchSnapshot(value);
    },
    [],
  );
  const departmentStandingSnapshotRef = useRef<DepartmentStandingSnapshot>(
    createDepartmentStandingSnapshot(),
  );
  const [departmentStandingSnapshot, setDepartmentStandingSnapshot] =
    useState<DepartmentStandingSnapshot>(() =>
      createDepartmentStandingSnapshot(),
    );
  const updateDepartmentStandingSnapshot = useCallback(
    (value: DepartmentStandingSnapshot) => {
      departmentStandingSnapshotRef.current = value;
      setDepartmentStandingSnapshot(value);
    },
    [],
  );
  const passengerSocietySnapshotRef = useRef<PassengerSocietySnapshot>(
    createPassengerSocietySnapshot(),
  );
  const [passengerSocietySnapshot, setPassengerSocietySnapshot] =
    useState<PassengerSocietySnapshot>(() =>
      createPassengerSocietySnapshot(),
    );
  const updatePassengerSocietySnapshot = useCallback(
    (value: PassengerSocietySnapshot) => {
      passengerSocietySnapshotRef.current = value;
      setPassengerSocietySnapshot(value);
    },
    [],
  );
  const worldEpoch = useRef(0);
  const keyPassengerScheduler = useRef(
    new KeyPassengerPollScheduler(),
  );
  const authorizedControllerRecordHistory = useRef<
    AuthorizedControllerRecord[]
  >([]);
  const authorizedManifestRecordHistory = useRef<
    AuthorizedManifestRecord[]
  >([]);
  const activePhysicsRequestId = useRef<string | null>(null);
  const lastHeartbeatWallMs = useRef<number | null>(null);
  const captainCallInFlight = useRef(false);
  const keyPassengerCallInFlight = useRef(false);
  const captainDecisionSequence = useRef(0);
  const keyPassengerCallSequence = useRef(0);
  const activeCaptainDecision = useRef<CaptainDecisionCycle | null>(
    null,
  );
  const activeKeyPassengerCall =
    useRef<KeyPassengerCallCycle | null>(null);
  const captainInvocationKeys = useRef(new Set<string>());
  const activeCaptainWorldCommandQueue =
    useRef<CaptainWorldCommandQueue | null>(null);
  const latestCaptainDeviceReceipts = useRef<
    CaptainDeviceReceiptSummary[]
  >([]);
  const discardedCaptainCommandRequests = useRef(new Set<string>());
  const finalReportRequested = useRef(false);
  const injectCausalEventRef = useRef<
    (
      eventType: string,
      label: string,
      options?: { actor?: string },
    ) => Promise<void>
  >(async () => {});
  const godAssistSessionRef = useRef<GodAssistSessionHandle | null>(null);
  const handleGodAssistSessionChange = useCallback(
    (session: GodAssistSessionHandle | null) => {
      godAssistSessionRef.current = session;
    },
    [],
  );
  const appendCaptainCommandEvent = useCallback(
    (
      elapsedSeconds: number,
      text: string,
      tone: SystemTone,
      source = "舰长命令队列",
    ) => {
      const timelineEventId = ++eventId.current;
      setEvents((current) =>
        prependTimelineEvent(current, {
          id: timelineEventId,
          at: formatDuration(elapsedSeconds),
          source,
          text,
          tone,
        }),
      );
    },
    [],
  );
  const sendTimeControl = useCallback(
    (options: {
      timeScale?: number;
      acquirePauseTokens?: string[];
      releasePauseTokens?: string[];
    }) => {
      const worker = workerRef.current;
      if (!worker) {
        return false;
      }
      requestSequence.current += 1;
      const command: SimulationWorkerCommand = {
        type: "set-time-control",
        requestId: `time-${requestSequence.current}`,
        ...options,
      };
      worker.postMessage(command);
      return true;
    },
    [],
  );
  const releaseCaptainDecisionPause = useCallback(
    (phase: Exclude<LlmCallPhase, "waiting"> = "idle") => {
      sendTimeControl({ releasePauseTokens: ["llm-waiting"] });
      setLlmCallPhase(phase);
    },
    [sendTimeControl],
  );
  const emitDecisionTheater = useCallback(
    (event: DecisionTheaterEvent) => {
      setDecisionTheater((previous) => {
        const next = reduceDecisionTheater(previous, event);
        decisionTheaterRef.current = next;
        return next;
      });
    },
    [],
  );
  const finishCaptainWorldCommandQueue = useCallback(
    (queue: CaptainWorldCommandQueue) => {
      if (activeCaptainWorldCommandQueue.current !== queue) {
        return;
      }
      latestCaptainDeviceReceipts.current = [...queue.receipts].sort(
        (left, right) => left.ordinal - right.ordinal,
      );
      activeCaptainWorldCommandQueue.current = null;
      if (queue.advancesRoutineSchedule) {
        updateNextCaptainRoutineDeadline(
          computeNextCaptainRoutineDeadline(
            latestSimulationSeconds.current,
            captainRoutineSeconds.current,
          ),
        );
      }
      emitDecisionTheater({
        type: "world_resumed",
        cycleToken: queue.cycleToken,
      });
      releaseCaptainDecisionPause();
      // ─── 决策日志：记录执行回执 ─────────────────────────
      setCaptainDecisionLog((prev) =>
        prev.map((entry) =>
          entry.triggerKey === queue.triggerKey &&
          (entry.status === "decided" || entry.status === "executing")
            ? { ...entry, status: "done" as const, receipts: [...queue.receipts].sort((l, r) => l.ordinal - r.ordinal) }
            : entry,
        ),
      );
      if (
        queue.resumeAfterCompletion &&
        !latestMissionEnded.current
      ) {
        setPaused(false);
      }
    },
    [
      emitDecisionTheater,
      releaseCaptainDecisionPause,
      updateNextCaptainRoutineDeadline,
    ],
  );
  const dispatchNextCaptainWorldCommand = useCallback(() => {
    const queue = activeCaptainWorldCommandQueue.current;
    if (
      !queue ||
      queue.activeRequestId !== null ||
      queue.worldEpoch !== worldEpoch.current ||
      activePhysicsRequestId.current !== null
    ) {
      return;
    }
    if (queue.nextIndex >= queue.commands.length) {
      finishCaptainWorldCommandQueue(queue);
      return;
    }

    const worker = workerRef.current;
    const expectedStateRevision = latestStateRevision.current;
    const item = queue.commands[queue.nextIndex];
    if (!worker || expectedStateRevision === null) {
      queue.receipts.push({
        ordinal: item.ordinal,
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        commandKind: item.command.kind,
        status: "rejected",
        summary: "物理引擎或状态修订尚不可用，命令队列停止",
      });
      appendCaptainCommandEvent(
        latestSimulationSeconds.current,
        `${item.toolName} 未派发：物理引擎或状态修订尚不可用。`,
        "critical",
      );
      for (const skipped of queue.commands.slice(queue.nextIndex + 1)) {
        queue.receipts.push({
          ordinal: skipped.ordinal,
          toolCallId: skipped.toolCallId,
          toolName: skipped.toolName,
          commandKind: skipped.command.kind,
          status: "skipped",
          summary: "前序命令未能派发，队列按顺序停止",
        });
        appendCaptainCommandEvent(
          latestSimulationSeconds.current,
          `${skipped.toolName} 未执行：前序命令未能派发，确定性队列已停止。`,
          "watch",
        );
      }
      finishCaptainWorldCommandQueue(queue);
      setPaused(true);
      showToast("舰长命令队列停止：物理引擎状态不可用。");
      return;
    }

    requestSequence.current += 1;
    const requestId = `captain-queue-${requestSequence.current}`;
    queue.activeRequestId = requestId;
    emitDecisionTheater({
      type: "command_dispatched",
      cycleToken: queue.cycleToken,
      ordinal: item.ordinal,
      toolName: item.toolName,
      total: queue.commands.length,
    });
    const command: SimulationWorkerCommand = {
      type: "ship-command",
      requestId,
      commandId: item.stableCommandId,
      idempotencyKey: item.stableCommandId,
      issuedAtMicroseconds: Math.round(
        latestSimulationSeconds.current * 1_000_000,
      ),
      expectedRevision: commandRevision.current,
      expectedStateRevision,
      command: item.command,
    };
    activePhysicsRequestId.current = requestId;
    worker.postMessage(command);
  }, [
    appendCaptainCommandEvent,
    emitDecisionTheater,
    finishCaptainWorldCommandQueue,
    showToast,
  ]);
  const clearCaptainWorldCommandQueue = useCallback(() => {
    const queue = activeCaptainWorldCommandQueue.current;
    if (queue?.activeRequestId) {
      discardedCaptainCommandRequests.current.add(
        queue.activeRequestId,
      );
    }
    if (queue) {
      captainInvocationKeys.current.delete(queue.triggerKey);
    }
    activeCaptainWorldCommandQueue.current = null;
  }, []);
  const cancelCaptainDecision = useCallback(() => {
    const active = activeCaptainDecision.current;
    const theaterToken =
      active?.token ?? decisionTheaterRef.current.cycleToken;
    active?.controller.abort();
    if (active) {
      captainInvocationKeys.current.delete(active.triggerKey);
    }
    activeCaptainDecision.current = null;
    captainCallInFlight.current = false;
    clearCaptainWorldCommandQueue();
    // 取消必须立刻清场，不能留下悬挂的演出阶段。
    emitDecisionTheater({ type: "abort", cycleToken: theaterToken });
    releaseCaptainDecisionPause();
  }, [
    clearCaptainWorldCommandQueue,
    emitDecisionTheater,
    releaseCaptainDecisionPause,
  ]);
  const cancelKeyPassengerCall = useCallback(() => {
    const active = activeKeyPassengerCall.current;
    active?.controller.abort();
    activeKeyPassengerCall.current = null;
    keyPassengerCallInFlight.current = false;
  }, []);

  const requestSaveSnapshotWhenQuiescent = useCallback(() => {
    const barrier = pendingSaveBarrier.current;
    const worker = workerRef.current;
    if (
      !barrier ||
      !worker ||
      activePhysicsRequestId.current !== null ||
      captainCallInFlight.current ||
      keyPassengerCallInFlight.current ||
      activeCaptainWorldCommandQueue.current !== null ||
      pendingSaves.current.size > 0
    ) {
      return;
    }
    requestSequence.current += 1;
    const requestId = `save-${requestSequence.current}`;
    pendingSaveBarrier.current = null;
    pendingSaves.current.set(requestId, barrier);
    const command: SimulationWorkerCommand = {
      type: "snapshot",
      requestId,
    };
    worker.postMessage(command);
    showToast("物理事务已静止，正在封装一致性快照……");
  }, [showToast]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../lib/sim/worker.ts", import.meta.url),
      {
        type: "module",
        name: "far-horizon-simulation",
      },
    );
    workerRef.current = worker;

    worker.onmessage = (message: MessageEvent<SimulationWorkerEvent>) => {
      const event = message.data;
      if (activePhysicsRequestId.current === event.requestId) {
        activePhysicsRequestId.current = null;
      }
      if (
        discardedCaptainCommandRequests.current.delete(
          event.requestId,
        )
      ) {
        return;
      }
      if (event.type === "error") {
        const queue = activeCaptainWorldCommandQueue.current;
        if (queue?.activeRequestId === event.requestId) {
          const failed = queue.commands[queue.nextIndex];
          queue.receipts.push({
            ordinal: failed.ordinal,
            toolCallId: failed.toolCallId,
            toolName: failed.toolName,
            commandKind: failed.command.kind,
            status: "rejected",
            summary: event.message,
          });
          emitDecisionTheater({
            type: "command_receipt",
            cycleToken: queue.cycleToken,
            ordinal: failed.ordinal,
            toolName: failed.toolName,
            status: "rejected",
            summary: event.message,
            wallClockAtMs: Date.now(),
          });
          if (isCaptainWorldCommandSoftRejectMessage(event.message)) {
            appendCaptainCommandEvent(
              latestSimulationSeconds.current,
              `${failed.toolName} 被设备执行层拒绝：${event.message}（本条拒绝后队列继续）`,
              "watch",
            );
            queue.nextIndex += 1;
            queue.activeRequestId = null;
            showToast(`舰长命令被拒绝，队列继续：${event.message}`);
            dispatchNextCaptainWorldCommand();
            requestSaveSnapshotWhenQuiescent();
            return;
          }
          const hardStopHint =
            "可解除暂停后继续观察；本轮后续命令已跳过";
          appendCaptainCommandEvent(
            latestSimulationSeconds.current,
            `${failed.toolName} 被设备执行层拒绝：${event.message}。${hardStopHint}`,
            "critical",
          );
          for (const skipped of queue.commands.slice(
            queue.nextIndex + 1,
          )) {
            queue.receipts.push({
              ordinal: skipped.ordinal,
              toolCallId: skipped.toolCallId,
              toolName: skipped.toolName,
              commandKind: skipped.command.kind,
              status: "skipped",
              summary: `前序命令硬失败，队列已停止（${hardStopHint}）`,
            });
            appendCaptainCommandEvent(
              latestSimulationSeconds.current,
              `${skipped.toolName} 未执行：前序命令硬失败，确定性队列已停止。`,
              "watch",
            );
          }
          finishCaptainWorldCommandQueue(queue);
          setPaused(true);
          showToast(
            `舰长命令队列硬停止：${event.message}。${hardStopHint}`,
          );
          requestSaveSnapshotWhenQuiescent();
          return;
        }
        const failedSave = pendingSaves.current.get(event.requestId);
        pendingSaves.current.delete(event.requestId);
        if (failedSave) {
          sendTimeControl({ releasePauseTokens: ["save-barrier"] });
          if (
            !failedSave.metadata.paused &&
            !latestMissionEnded.current
          ) {
            setPaused(false);
          }
          showToast(`一致性存档失败：${event.message}`, { persistent: true });
          return;
        }
        if (pendingLoad.current?.requestId === event.requestId) {
          pendingLoad.current = null;
          sendTimeControl({ releasePauseTokens: ["save-barrier"] });
          showToast(
            `存档恢复被拒绝，当前世界保持不变：${event.message}`,
            { persistent: true },
          );
          return;
        }
        const pendingIntervention = pendingInterventions.current.get(
          event.requestId,
        );
        if (pendingIntervention) {
          pendingInterventions.current.delete(event.requestId);
        }
        const godAssistSession = godAssistSessionRef.current;
        if (
          godAssistSession?.active &&
          godAssistSession.onPhysicsRejection &&
          godAssistSession.pendingRequestId === event.requestId
        ) {
          const onPhysicsRejection = godAssistSession.onPhysicsRejection;
          godAssistSessionRef.current = {
            active: false,
            retried: true,
            pendingRequestId: null,
            onPhysicsRejection: null,
          };
          onPhysicsRejection(event.message);
        }
        if (pendingIntervention) {
          pendingIntervention.reject(new Error(event.message));
        }
        setPaused(true);
        showToast(`物理引擎拒绝操作：${event.message}`);
        return;
      }
      if (event.type === "snapshot") {
        const pendingSave = pendingSaves.current.get(
          event.requestId,
        );
        pendingSaves.current.delete(event.requestId);
        if (!pendingSave) {
          return;
        }
        const save: LocalSave = {
          ...pendingSave.metadata,
          simulationSeconds:
            event.payload.snapshot.engine.clock.elapsedMicroseconds /
            1_000_000,
          runtimeSnapshot: event.payload.snapshot,
        };
        void (async () => {
          await persistManualSave(save, {
            successToast: "完整本地存档已写入。",
          });
          sendTimeControl({ releasePauseTokens: ["save-barrier"] });
          if (
            !pendingSave.metadata.paused &&
            !latestMissionEnded.current
          ) {
            setPaused(false);
          }
        })();
        return;
      }
      if (event.type === "final-report") {
        setFinalReport(event.payload.report);
        return;
      }
      if (
        event.type === "ready" &&
        pendingLoad.current?.requestId === event.requestId
      ) {
        const {
          save,
          keyPassengerScheduler: restoredScheduler,
        } = pendingLoad.current;
        pendingLoad.current = null;
        sendTimeControl({ releasePauseTokens: ["save-barrier"] });
        knownMaintenanceCompletionIds.current = new Set(
          save.runtimeSnapshot?.maintenance.tasks
            .filter((task) => task.status === "completed")
            .map((task) => task.id) ?? [],
        );
        knownProceduralEventIds.current.clear();
        knownAlertIds.current.clear();
        setActiveAlerts([]);
        setCaptainDecisionLog([]);
        keyPassengerScheduler.current = restoredScheduler;
        setKeyPassengerPrivateNotes(
          restoredScheduler.listPrivateNotes(),
        );
        setActiveView(save.activeView);
        setMissionStarted(save.missionStarted);
        setPaused(save.paused);
        setTimeScale(save.timeScale);
        setOrigin(save.origin);
        setDestination(save.destination);
        setDirective(save.directive);
        setEvents(save.events);
        eventId.current = save.events.reduce(
          (maximum, entry) => Math.max(maximum, entry.id),
          0,
        );
        captainInvocationKeys.current.clear();
        cancelCaptainDecision();
        setMissionEnded(false);
        setFinalReport(null);
        setEndReportDismissed(false);
        finalReportRequested.current = false;
        showToast("物理、人员与命令审计状态已原子恢复。");
      }
      setSimulationSeconds(event.payload.elapsedSeconds);
      latestSimulationSeconds.current = event.payload.elapsedSeconds;
      setEngineState(event.payload.state);
      latestMissionEnded.current =
        event.payload.state.journey.status === "arrived";
      latestStateRevision.current =
        event.payload.state.revision;
      setCompartmentState(event.payload.compartments);
      setCoolingState(event.payload.cooling);
      setElectricalState(event.payload.electrical);
      setNavigationState(event.payload.navigation);
      setRotationState(event.payload.rotation);
      setWaterRecoveryState(event.payload.waterRecovery);
      setMaintenanceState(event.payload.maintenance);
      setHullConsequenceState(event.payload.hullConsequence);
      setOperationsState(event.payload.operations);

      // ─── 警报检测 ─────────────────────────────────────────
      const newAlerts = detectAlerts(
        event.payload.state,
        event.payload.electrical,
        event.payload.cooling,
        event.payload.compartments,
        event.payload.elapsedSeconds,
        knownAlertIds.current,
        event.payload.rotation?.observed ?? null,
        event.payload.hullConsequence ?? null,
      );
      if (newAlerts.length > 0) {
        for (const alert of newAlerts) {
          knownAlertIds.current.add(alert.id);
        }
        setActiveAlerts((prev) => [...newAlerts, ...prev].slice(0, 20));
        const highest = newAlerts.some((a) => a.level === "critical")
          ? "critical"
          : newAlerts.some((a) => a.level === "warning")
            ? "warning"
            : "watch";
        if (highest === "critical") playAlertCritical();
        else if (highest === "warning") playAlertWarning();
        else playAlertWatch();
      }

      for (const task of event.payload.maintenance.recentCompletedTasks) {
        if (knownMaintenanceCompletionIds.current.has(task.id)) {
          continue;
        }
        knownMaintenanceCompletionIds.current.add(task.id);
        const timelineEventId = ++eventId.current;
        setEvents((current) =>
          prependTimelineEvent(current, {
            id: timelineEventId,
            at: formatDuration(event.payload.elapsedSeconds),
            source: "维修执行回执",
            text: `${task.id} 已完成 ${task.assetId} 检修；备件 ${task.requiredPartId} 已安装，维修机器人与乘员已释放。`,
            tone: "nominal",
          }),
        );
      }
      setCommandBusState(event.payload.commandBus);
      commandRevision.current =
        event.payload.commandBus.revision;
      setPassengerHighlights(event.payload.passengerHighlights);
      setZoneMood(event.payload.zoneMood);
      setPassengerCircles(event.payload.passengerCircles);
      setTimeControl(event.payload.timeControl);
      setSurvival(event.payload.survival);

      // ─── 程序化事件（Worker 权威载荷；物理已在 Worker 注入）──
      if (
        (event.type === "stepped" ||
          event.type === "ready" ||
          event.type === "intervention") &&
        event.payload.proceduralEvents?.length
      ) {
        for (const procEvent of event.payload.proceduralEvents) {
          if (knownProceduralEventIds.current.has(procEvent.id)) {
            continue;
          }
          knownProceduralEventIds.current.add(procEvent.id);
          const timelineEventId = ++eventId.current;
          setEvents((current) =>
            prependTimelineEvent(current, {
              id: timelineEventId,
              at: formatDuration(event.payload.elapsedSeconds),
              source: procEvent.source,
              text: procEvent.message,
              tone:
                procEvent.severity === "critical"
                  ? "critical"
                  : procEvent.severity === "warning"
                    ? "watch"
                    : "nominal",
            }),
          );
          if (
            procEvent.severity === "warning" ||
            procEvent.severity === "critical"
          ) {
            playAlertWatch();
          }
        }
      }

      if (event.payload.state.journey.status === "arrived") {
        setPaused(true);
        setMissionEnded(true);
        setEndReportDismissed(false);
        if (!finalReportRequested.current) {
          finalReportRequested.current = true;
          requestSequence.current += 1;
          const command: SimulationWorkerCommand = {
            type: "final-report",
            requestId: `report-${requestSequence.current}`,
          };
          worker.postMessage(command);
        }
      }
      if (event.type === "intervention") {
        const pendingIntervention = pendingInterventions.current.get(
          event.requestId,
        );
        if (pendingIntervention) {
          pendingInterventions.current.delete(event.requestId);
          pendingIntervention.resolve();
        }
        const godAssistSession = godAssistSessionRef.current;
        if (
          godAssistSession?.active &&
          godAssistSession.pendingRequestId === event.requestId
        ) {
          godAssistSessionRef.current = {
            ...godAssistSession,
            pendingRequestId: null,
          };
        }
        const timelineEventId = ++eventId.current;
        const actor = event.payload.record.actor;
        const source = actor.startsWith("environment")
          ? "外部异常 / 因果链"
          : "玩家 / 上帝模式";
        setEvents((current) =>
          prependTimelineEvent(current, {
            id: timelineEventId,
            at: formatDuration(event.payload.elapsedSeconds),
            source,
            text: `外部干预已提交物理账本：${event.payload.record.reason}`,
            tone: "critical",
          }),
        );
        showToast(`外部注入已记账：${event.payload.record.id}`);
      }
      if (event.type === "ship-command") {
        const queue = activeCaptainWorldCommandQueue.current;
        const queuedItem =
          queue?.activeRequestId === event.requestId
            ? queue.commands[queue.nextIndex]
            : null;
        if (queue && queuedItem) {
          queue.receipts.push({
            ordinal: queuedItem.ordinal,
            toolCallId: queuedItem.toolCallId,
            toolName: queuedItem.toolName,
            commandKind: queuedItem.command.kind,
            status: "accepted",
            summary: event.payload.result.summary,
          });
          queue.nextIndex += 1;
          queue.activeRequestId = null;
          emitDecisionTheater({
            type: "command_receipt",
            cycleToken: queue.cycleToken,
            ordinal: queuedItem.ordinal,
            toolName: queuedItem.toolName,
            status: "accepted",
            summary: event.payload.result.summary,
            wallClockAtMs: Date.now(),
          });
        }
        const timelineEventId = ++eventId.current;
        setEvents((current) =>
          prependTimelineEvent(current, {
            id: timelineEventId,
            at: formatDuration(event.payload.elapsedSeconds),
            source: "设备执行回执",
            text: event.payload.result.summary,
            tone: "nominal",
          }),
        );
        showToast(event.payload.result.summary);
        if (event.payload.result.journeyStatus === "arrived") {
          setPaused(true);
          setMissionEnded(true);
          setEndReportDismissed(false);
        }
        if (queue && queuedItem) {
          if (
            event.payload.result.journeyStatus === "arrived" &&
            queue.nextIndex < queue.commands.length
          ) {
            for (const skipped of queue.commands.slice(
              queue.nextIndex,
            )) {
              queue.receipts.push({
                ordinal: skipped.ordinal,
                toolCallId: skipped.toolCallId,
                toolName: skipped.toolName,
                commandKind: skipped.command.kind,
                status: "skipped",
                summary: "航程已经安全抵达，后续世界命令停止",
              });
              appendCaptainCommandEvent(
                event.payload.elapsedSeconds,
                `${skipped.toolName} 未执行：航程已经安全抵达。`,
                "watch",
              );
            }
            queue.nextIndex = queue.commands.length;
          }
          if (event.payload.result.journeyStatus === "arrived") {
            queue.resumeAfterCompletion = false;
          }
          dispatchNextCaptainWorldCommand();
        }
      }
      if (
        activeCaptainWorldCommandQueue.current?.activeRequestId ===
        null
      ) {
        dispatchNextCaptainWorldCommand();
      }
      requestSaveSnapshotWhenQuiescent();
    };

    worker.onerror = (event) => {
      activePhysicsRequestId.current = null;
      const queue = activeCaptainWorldCommandQueue.current;
      const failed = queue?.commands[queue.nextIndex];
      const hardStopHint =
        "可解除暂停后继续观察；本轮后续命令已跳过";
      if (queue && failed) {
        const failureSummary = `仿真线程异常：${event.message}`;
        queue.receipts.push({
          ordinal: failed.ordinal,
          toolCallId: failed.toolCallId,
          toolName: failed.toolName,
          commandKind: failed.command.kind,
          status: "rejected",
          summary: `${failureSummary}（${hardStopHint}）`,
        });
        appendCaptainCommandEvent(
          latestSimulationSeconds.current,
          `${failed.toolName} 未完成：${failureSummary}。${hardStopHint}`,
          "critical",
        );
        for (const skipped of queue.commands.slice(
          queue.nextIndex + 1,
        )) {
          queue.receipts.push({
            ordinal: skipped.ordinal,
            toolCallId: skipped.toolCallId,
            toolName: skipped.toolName,
            commandKind: skipped.command.kind,
            status: "skipped",
            summary: `仿真线程异常，队列已停止（${hardStopHint}）`,
          });
          appendCaptainCommandEvent(
            latestSimulationSeconds.current,
            `${skipped.toolName} 未执行：仿真线程异常，确定性队列已停止。`,
            "watch",
          );
        }
        latestCaptainDeviceReceipts.current = [
          ...queue.receipts,
        ].sort((left, right) => left.ordinal - right.ordinal);
        activeCaptainWorldCommandQueue.current = null;
        captainInvocationKeys.current.delete(queue.triggerKey);
        emitDecisionTheater({
          type: "fail",
          cycleToken: queue.cycleToken,
          message: failureSummary,
        });
      }
      releaseCaptainDecisionPause("error");
      setPaused(true);
      showToast(`仿真线程异常：${event.message}。${hardStopHint}`);
    };

    return () => {
      cancelCaptainDecision();
      cancelKeyPassengerCall();
      worker.terminate();
      workerRef.current = null;
      activePhysicsRequestId.current = null;
    };
  }, [
    appendCaptainCommandEvent,
    cancelCaptainDecision,
    cancelKeyPassengerCall,
    dispatchNextCaptainWorldCommand,
    emitDecisionTheater,
    finishCaptainWorldCommandQueue,
    playAlertCritical,
    playAlertWarning,
    playAlertWatch,
    persistManualSave,
    requestSaveSnapshotWhenQuiescent,
    releaseCaptainDecisionPause,
    sendTimeControl,
    showToast,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await migrateLocalStorageSaveOnce();
        const present = await hasManualSave();
        if (!cancelled) {
          setHasLocalSave(present);
        }
      } catch {
        if (!cancelled) {
          setHasLocalSave(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refreshStatus = async () => {
      try {
        const response = await fetch("/api/llm/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          llm?: LlmRuntimeStatus;
        };
        if (payload.llm) {
          setLlmStatus({
            ...payload.llm,
            recentCalls: payload.llm.recentCalls ?? [],
          });
        }
      } catch {
        // Local server status may be temporarily unavailable during HMR.
      }
    };
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 10_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const configuredSeconds = llmStatus?.agents.find(
      (agent) => agent.id === "captain",
    )?.routine.systemInfoIntervalSimSeconds;
    if (
      configuredSeconds !== undefined &&
      Number.isFinite(configuredSeconds)
    ) {
      captainRoutineSeconds.current = Math.max(30, configuredSeconds);
    }
  }, [llmStatus]);

  const workerHasCaptainDecisionPause = Boolean(
    timeControl?.pauseTokens.includes("llm-waiting"),
  );

  // ─── 事件轨：AI 研判暂停 / 保真度限制（每 episode 一次）──
  useEffect(() => {
    if (llmCallPhase === "waiting") {
      if (llmWaitingEventLoggedRef.current) {
        return;
      }
      llmWaitingEventLoggedRef.current = true;
      const timelineEventId = ++eventId.current;
      setEvents((current) =>
        prependTimelineEvent(current, {
          id: timelineEventId,
          at: formatDuration(latestSimulationSeconds.current),
          source: "时间控制",
          text: "仿真已暂停 · 等待 AI 舰长研判",
          tone: "watch",
        }),
      );
      return;
    }
    llmWaitingEventLoggedRef.current = false;
  }, [llmCallPhase]);

  // 终态演出在解冻后保留片刻，再清场；不得在决策进行中提前清空。
  useEffect(() => {
    if (
      llmCallPhase === "waiting" ||
      decisionTheater.active ||
      (decisionTheater.stage !== "world_resumed" &&
        decisionTheater.stage !== "failed")
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      emitDecisionTheater({ type: "clear" });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [
    decisionTheater.active,
    decisionTheater.stage,
    emitDecisionTheater,
    llmCallPhase,
  ]);

  useEffect(() => {
    const limited =
      Boolean(timeControl?.fidelityLocked) ||
      Boolean(compartmentState?.fidelityLimited);
    if (!missionStarted || !limited) {
      if (!limited) {
        fidelityLimitedEventLoggedRef.current = false;
      }
      return;
    }
    if (fidelityLimitedEventLoggedRef.current) {
      return;
    }
    fidelityLimitedEventLoggedRef.current = true;
    const timelineEventId = ++eventId.current;
    setEvents((current) =>
      prependTimelineEvent(current, {
        id: timelineEventId,
        at: formatDuration(latestSimulationSeconds.current),
        source: "物理引擎",
        text: "保真度锁定 · 有效推进倍率已受限",
        tone: "watch",
      }),
    );
  }, [
    compartmentState?.fidelityLimited,
    missionStarted,
    timeControl?.fidelityLocked,
  ]);

  // ─── 时间权威：向 Worker 同步 pause tokens / timeScale ─────
  useEffect(() => {
    if (!missionStarted || !workerRef.current) {
      return;
    }
    const acquirePauseTokens: string[] = [];
    const releasePauseTokens: string[] = [];
    if (paused) {
      acquirePauseTokens.push("ui");
    } else {
      releasePauseTokens.push("ui");
    }
    if (llmCallPhase === "waiting") {
      acquirePauseTokens.push("llm-waiting");
    } else {
      releasePauseTokens.push("llm-waiting");
    }
    if (missionEnded) {
      acquirePauseTokens.push("mission-ended");
    }
    sendTimeControl({
      timeScale,
      acquirePauseTokens,
      releasePauseTokens,
    });
  }, [
    llmCallPhase,
    missionEnded,
    missionStarted,
    paused,
    sendTimeControl,
    timeScale,
    workerHasCaptainDecisionPause,
  ]);

  // A completed decision can share a timestamp with a routine boundary while
  // carrying a more specific alert trigger. Recover old/stale runtime state by
  // consuming that covered deadline before releasing an orphan decision token.
  useEffect(() => {
    if (
      !missionStarted ||
      missionEnded ||
      llmCallPhase === "waiting" ||
      !workerHasCaptainDecisionPause ||
      captainCallInFlight.current ||
      activeCaptainWorldCommandQueue.current !== null
    ) {
      return;
    }
    const deadline = nextCaptainRoutineAtSimulationSeconds.current;
    if (
      !isCaptainRoutineDue(simulationSeconds, deadline) ||
      !completedCaptainDecisionCoversDeadline(
        deadline,
        captainDecisionLog,
      )
    ) {
      return;
    }
    updateNextCaptainRoutineDeadline(
      computeNextCaptainRoutineDeadline(
        simulationSeconds,
        captainRoutineSeconds.current,
      ),
    );
  }, [
    captainDecisionLog,
    llmCallPhase,
    missionEnded,
    missionStarted,
    simulationSeconds,
    updateNextCaptainRoutineDeadline,
    workerHasCaptainDecisionPause,
  ]);

  useEffect(() => {
    if (
      !missionStarted ||
      missionEnded ||
      paused ||
      llmCallPhase === "waiting" ||
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0 ||
      !workerRef.current
    ) {
      lastHeartbeatWallMs.current = null;
      return;
    }
    lastHeartbeatWallMs.current = performance.now();
    const timer = window.setInterval(() => {
      if (!workerRef.current) return;
      const now = performance.now();
      const last = lastHeartbeatWallMs.current ?? now;
      lastHeartbeatWallMs.current = now;
      const elapsedSeconds = Math.max(0, (now - last) / 1000);

      if (activePhysicsRequestId.current !== null) return;
      if (elapsedSeconds < 0.05) return;

      const realSeconds = Math.min(
        1.0,
        Math.max(0.05, elapsedSeconds),
      );

      requestSequence.current += 1;
      const command: SimulationWorkerCommand = {
        type: "step",
        requestId: `step-${requestSequence.current}`,
        realSeconds,
        timeScale,
        blockingBoundary:
          nextCaptainRoutineAtSimulationSeconds.current === null
            ? undefined
            : {
                id: `captain-routine:${nextCaptainRoutineAtSimulationSeconds.current}`,
                atSimulationSeconds:
                  nextCaptainRoutineAtSimulationSeconds.current,
                pauseToken: "llm-waiting",
              },
      };
      activePhysicsRequestId.current = command.requestId;
      workerRef.current.postMessage(command);
    }, 250);
    return () => {
      window.clearInterval(timer);
      lastHeartbeatWallMs.current = null;
    };
  }, [
    llmCallPhase,
    missionEnded,
    missionStarted,
    paused,
    timeScale,
  ]);

  useEffect(() => {
    if (!toast || toast.persistent) return;
    const timer = window.setTimeout(() => setToast(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // ─── 键盘快捷键 ─────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (missionStarted && !missionEnded && llmCallPhase !== "waiting") {
          setPaused((v) => !v);
          audio.playClick();
        }
      } else if (e.key >= "1" && e.key <= "7") {
        const index = Number(e.key) - 1;
        if (index < TIME_SCALE_PRESETS.length) {
          setTimeScale(TIME_SCALE_PRESETS[index]);
          audio.playClick();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [missionStarted, missionEnded, llmCallPhase, audio]);

  useEffect(() => {
    if (!missionStarted || !engineState) {
      return;
    }
    const recordWorldEpoch = worldEpoch.current;
    const existingControllerRecord =
      authorizedControllerRecordHistory.current.at(-1);
    if (
      existingControllerRecord?.worldEpoch === recordWorldEpoch &&
      existingControllerRecord.stateRevision === engineState.revision
    ) {
      return;
    }

    const remainingDistanceLightYears = Math.max(
      0,
      engineState.journey.totalDistanceLightYears -
        engineState.journey.completedDistanceLightYears,
    );
    const controllerRecord: AuthorizedControllerRecord = {
      worldEpoch: recordWorldEpoch,
      stateRevision: engineState.revision,
      sampledAtSimulationSeconds: simulationSeconds,
      availableAtSimulationSeconds:
        simulationSeconds +
        AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS,
      remainingDistanceEstimateLightYears:
        Math.round(remainingDistanceLightYears * 100) / 100,
      jumpControllerState: engineState.journey.status,
      completedJumpLogCount: engineState.journey.jumpsCompleted,
      jumpDriveChargeEstimateKWh:
        Math.round(engineState.journey.jumpDriveChargeKWh / 1_000) *
        1_000,
      jumpDriveCapacityKWh: engineState.journey.jumpDriveCapacityKWh,
    };
    const manifestRecord: AuthorizedManifestRecord = {
      worldEpoch: recordWorldEpoch,
      stateRevision: engineState.revision,
      sampledAtSimulationSeconds: simulationSeconds,
      availableAtSimulationSeconds:
        simulationSeconds +
        AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS,
      awakeRegistered: engineState.population.awake,
      hibernatingRegistered: engineState.population.hibernating,
      deceasedRegistered: engineState.population.deceased,
    };
    authorizedControllerRecordHistory.current = [
      ...authorizedControllerRecordHistory.current.filter(
        (record) => record.worldEpoch === recordWorldEpoch,
      ),
      controllerRecord,
    ].slice(-AUTHORIZED_RECORD_HISTORY_LIMIT);
    authorizedManifestRecordHistory.current = [
      ...authorizedManifestRecordHistory.current.filter(
        (record) => record.worldEpoch === recordWorldEpoch,
      ),
      manifestRecord,
    ].slice(-AUTHORIZED_RECORD_HISTORY_LIMIT);
  }, [engineState, missionStarted, simulationSeconds]);

  useEffect(() => {
    if (
      !missionStarted ||
      !engineState ||
      passengerHighlights.length === 0
    ) {
      return;
    }
    keyPassengerScheduler.current.observe(
      simulationSeconds,
      passengerHighlights,
    );
  }, [
    engineState,
    missionStarted,
    passengerHighlights,
    simulationSeconds,
  ]);

  const originSystem = useMemo(
    () => STAR_SYSTEMS.find((system) => system.id === origin)!,
    [origin],
  );
  const destinationSystem = useMemo(
    () => STAR_SYSTEMS.find((system) => system.id === destination)!,
    [destination],
  );
  const missionDistanceLightYears = routeDistanceLy(origin, destination);
  const estimatedRouteLegs = estimateMinLegs(missionDistanceLightYears);

  const nextRequestId = (prefix: string) => {
    requestSequence.current += 1;
    return `${prefix}-${requestSequence.current}`;
  };

  useEffect(() => {
    if (
      !missionStarted ||
      missionEnded ||
      !engineState ||
      !electricalState ||
      !navigationState ||
      !rotationState ||
      !maintenanceState ||
      latestStateRevision.current !== engineState.revision ||
      pendingLoad.current !== null ||
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0 ||
      activePhysicsRequestId.current !== null ||
      activeCaptainWorldCommandQueue.current !== null ||
      captainCallInFlight.current
    ) {
      return;
    }
    if (!llmStatus?.ready) {
      return;
    }

    const routineSeconds = captainRoutineSeconds.current;
    const urgentWindowSeconds = Math.min(routineSeconds, 900);
    const currentWorldEpoch = worldEpoch.current;
    const controllerRecord =
      authorizedControllerRecordHistory.current.findLast(
        (record) =>
          record.worldEpoch === currentWorldEpoch &&
          record.availableAtSimulationSeconds <= simulationSeconds,
      ) ?? null;
    const manifestRecord =
      authorizedManifestRecordHistory.current.findLast(
        (record) =>
          record.worldEpoch === currentWorldEpoch &&
          record.availableAtSimulationSeconds <= simulationSeconds,
      ) ?? null;
    const observedPowerAlarm =
      electricalState.observed.averageBusVoltageV !== null &&
      electricalState.observed.averageBusFrequencyHz !== null &&
      (electricalState.observed.averageBusVoltageV < 10_450 ||
        electricalState.observed.averageBusFrequencyHz < 49.5);
    const unattendedMaintenanceFaults =
      listActionableUnattendedMaintenanceFaults({
        observedAssets: maintenanceState.observedAssets,
        activeTasks: maintenanceState.activeTasks,
        robots: maintenanceState.robots,
        inventory: maintenanceState.inventory,
        truthConditions: maintenanceState.truth.conditions,
        recentlyCompletedAssetIds:
          maintenanceState.recentCompletedTasks.map(
            (task) => task.assetId,
          ),
      });
    let triggerKey = "";
    let triggerReason = "";

    if (!captainInvocationKeys.current.has("mission-start")) {
      triggerKey = "mission-start";
      triggerReason = "最高指令刚刚生效，需要建立首段航程与清醒计划";
    } else if (
      isCaptainRoutineDue(
        simulationSeconds,
        nextCaptainRoutineAtSimulationSeconds.current,
      )
    ) {
      triggerKey = `routine:${nextCaptainRoutineAtSimulationSeconds.current}`;
      triggerReason = "到达舰长自行设定的例行系统信息周期";
    } else if (
      captainHullThreatBlocksJump({
        hullConsequence: hullConsequenceState,
        compartments: compartmentState,
      })
    ) {
      const decisionWindow = Math.floor(
        simulationSeconds / urgentWindowSeconds,
      );
      const breachCount =
        hullConsequenceState?.activeBreachCount ??
        compartmentState?.activeBreaches ??
        0;
      triggerKey = `hull-threat:${breachCount}:${decisionWindow}`;
      triggerReason =
        hullConsequenceState?.jumpBlockReason ??
        `壳体威胁：活动破口 ${breachCount} 处，跃迁联锁生效；优先隔离并 schedule_hull_repair，禁止 execute_jump`;
    } else if (controllerRecord?.jumpControllerState === "ready") {
      const pendingJumpThermal = projectCaptainJumpThermalEstimate({
        thermalBusSensorK:
          coolingState?.observed.thermalBusTemperatureK ?? null,
        requiredChargePerJumpKWh:
          engineState.journey.requiredChargePerJumpKWh,
        remainingDistanceLightYears: Math.max(
          0,
          engineState.journey.totalDistanceLightYears -
            engineState.journey.completedDistanceLightYears,
        ),
      });
      if (pendingJumpThermal && !pendingJumpThermal.clearsInterlock) {
        const decisionWindow = Math.floor(
          simulationSeconds / urgentWindowSeconds,
        );
        triggerKey = `jump-thermal-block:${decisionWindow}`;
        triggerReason =
          "跃迁储能已就绪，但推进热预测超过主热汇流排安全联锁上限；需先降温/确认冷却，禁止立即 execute_jump";
      } else {
        const decisionWindow = Math.floor(
          simulationSeconds / routineSeconds,
        );
        triggerKey = `jump-ready:${controllerRecord.completedJumpLogCount}:${decisionWindow}`;
        triggerReason =
          controllerRecord.completedJumpLogCount === 0
            ? "延迟跃迁控制器记录显示储能达到执行阈值，需要决定是否提交首次跃迁；零次完成记录与完整剩余航程是首次跃迁前的正常状态"
            : "延迟跃迁控制器记录显示储能达到执行阈值，需要决定是否提交下一段跃迁命令";
      }
    } else if (observedPowerAlarm) {
      triggerKey = `power-deficit:${Math.floor(simulationSeconds / urgentWindowSeconds)}`;
      triggerReason = "电网出现未满足负载，需要舰长处置";
    } else if (unattendedMaintenanceFaults.length > 0) {
      triggerKey = `maintenance-fault:${unattendedMaintenanceFaults
        .map((asset) => asset.assetId)
        .join(",")}:${Math.floor(simulationSeconds / urgentWindowSeconds)}`;
      triggerReason = `维修诊断总线报告 ${unattendedMaintenanceFaults
        .map((asset) => `${asset.label}:${asset.condition}`)
        .join("、")}，均尚无活动维修任务，且同环维修机器人与对应备件当前均可用（可排程）`;
    } else if (
      compartmentState?.observedPressureMinPa !== null &&
      compartmentState?.observedPressureMinPa !== undefined &&
      compartmentState.observedPressureMinPa < 90_000
    ) {
      triggerKey = `pressure-low:${Math.floor(simulationSeconds / urgentWindowSeconds)}`;
      triggerReason = "至少一个居住压力区的延迟传感读数低于警戒值";
    } else if (
      coolingState?.observed.averageCoolantTemperatureK !==
        null &&
      coolingState?.observed.averageCoolantTemperatureK !==
        undefined &&
      coolingState.observed.averageCoolantTemperatureK > 355
    ) {
      triggerKey = `thermal-high:${Math.floor(simulationSeconds / urgentWindowSeconds)}`;
      triggerReason = "冷却母线温度高于警戒值";
    }

    const atmospherePressureObservation =
      compartmentState?.observedPressureAveragePa ?? null;
    const atmosphereZoneAlerts = projectCaptainPressureZoneAlerts(
      compartmentState,
      hullConsequenceState,
    );
    const trueRemainingDistance = Math.max(
      0,
      engineState.journey.totalDistanceLightYears -
        engineState.journey.completedDistanceLightYears,
    );
    const hullThreatObservation =
      projectCaptainHullThreatObservation(hullConsequenceState);
    const jumpThermalProjection = projectCaptainJumpThermalEstimate({
      thermalBusSensorK:
        coolingState?.observed.thermalBusTemperatureK ?? null,
      requiredChargePerJumpKWh:
        engineState.journey.requiredChargePerJumpKWh,
      remainingDistanceLightYears: trueRemainingDistance,
      candidateDistanceLightYears: Math.min(
        5,
        Math.max(0.1, trueRemainingDistance || 0.1),
      ),
    });
    const authorizedJumpControllerRecord = controllerRecord
      ? {
          availability: "available",
          source:
            "跃迁控制器授权记录；延迟发布并经过量化，不是即时物理真值",
          sampledAtSimulationSeconds:
            controllerRecord.sampledAtSimulationSeconds,
          sampleAgeSeconds: Math.max(
            0,
            simulationSeconds -
              controllerRecord.sampledAtSimulationSeconds,
          ),
          nominalPublicationDelaySeconds:
            AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS,
          remainingDistanceEstimateLightYears:
            controllerRecord.remainingDistanceEstimateLightYears,
          jumpControllerState:
            controllerRecord.jumpControllerState,
          completedJumpLogCount:
            controllerRecord.completedJumpLogCount,
          jumpDriveChargeEstimateKWh:
            controllerRecord.jumpDriveChargeEstimateKWh,
          jumpDriveCapacityKWh:
            controllerRecord.jumpDriveCapacityKWh,
          routeProgressSemantics:
            "剩余航程与完成次数只在 execute_jump 被设备接受并成功后更新；首次跃迁前零次记录与完整剩余航程正常，不要求先有历史跃迁或亚光速航段",
          localFrameSemantics:
            "位置/速度传感器属于常规推进的局部六自由度坐标，不是光年级航程进度，也不能据此判定仍在出发星系",
          jumpEnergySemantics:
            "jumpDriveChargeEstimateKWh 是跃迁专用储能；普通 A/B 电池 SOC 不是跃迁联锁门槛，最终可执行性由 execute_jump 的确定性设备联锁裁决",
        }
      : {
          availability: "unavailable",
          source:
            "跃迁控制器授权记录尚未达到发布延迟；不得用世界真值补齐",
          nominalPublicationDelaySeconds:
            AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS,
        };
    const authorizedCrewManifestRecord = manifestRecord
      ? {
          availability: "available",
          source:
            "人员舱单授权记录；延迟发布，不代表即时生命体征",
          sampledAtSimulationSeconds:
            manifestRecord.sampledAtSimulationSeconds,
          sampleAgeSeconds: Math.max(
            0,
            simulationSeconds -
              manifestRecord.sampledAtSimulationSeconds,
          ),
          nominalPublicationDelaySeconds:
            AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS,
          awakeRegistered: manifestRecord.awakeRegistered,
          hibernatingRegistered:
            manifestRecord.hibernatingRegistered,
          deceasedRegistered: manifestRecord.deceasedRegistered,
        }
      : {
          availability: "unavailable",
          source:
            "人员舱单授权记录尚未达到发布延迟；不得用世界真值补齐",
          nominalPublicationDelaySeconds:
            AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS,
        };
    const averageSensorReading = (
      readings: number[],
    ): number | null =>
      readings.length === 0
        ? null
        : readings.reduce((total, value) => total + value, 0) /
          readings.length;
    const observedRingAtmosphere = (["A", "B"] as const).map(
      (ring) => {
        const ringZones =
          compartmentState?.zones.filter((zone) =>
            zone.zoneId.startsWith(`${ring}-`),
          ) ?? [];
        const carbonDioxideReadings = ringZones
          .map(
            (zone) =>
              zone.observed.carbonDioxidePartialPressurePa,
          )
          .filter((value): value is number => value !== null);
        const pressureReadings = ringZones
          .map((zone) => zone.observed.pressurePa)
          .filter((value): value is number => value !== null);
        const oxygenReadings = ringZones
          .map((zone) => zone.observed.oxygenPartialPressurePa)
          .filter((value): value is number => value !== null);
        return {
          ring,
          observedOxygenPartialPressurePa:
            averageSensorReading(oxygenReadings),
          observedCarbonDioxidePartialPressurePa:
            averageSensorReading(carbonDioxideReadings),
          observedPressurePa:
            averageSensorReading(pressureReadings),
          reportingZoneCount: Math.min(
            oxygenReadings.length,
            carbonDioxideReadings.length,
            pressureReadings.length,
          ),
          oxygenReportingZoneCount: oxygenReadings.length,
        };
      },
    );
    const oxygenPartialPressureSensorPaByRing = {
      a:
        observedRingAtmosphere.find((entry) => entry.ring === "A")
          ?.observedOxygenPartialPressurePa ?? null,
      b:
        observedRingAtmosphere.find((entry) => entry.ring === "B")
          ?.observedOxygenPartialPressurePa ?? null,
    };
    const shipOxygenSensorReadings =
      compartmentState?.zones
        .map((zone) => zone.observed.oxygenPartialPressurePa)
        .filter((value): value is number => value !== null) ??
      [];
    const oxygenPartialPressureSensorPaAverage =
      averageSensorReading(shipOxygenSensorReadings);
    // 与 pressureZoneAlerts / ringAtmosphereSensors 同源：compartmentState.zones[].observed（含降级/漂移）
    const zoneAtmosphereSensorZones = compartmentState?.zones ?? [];
    const zonePressureSensorReadings = zoneAtmosphereSensorZones
      .map((zone) => zone.observed.pressurePa)
      .filter((value): value is number => value !== null);
    const zoneCarbonDioxideSensorReadings = zoneAtmosphereSensorZones
      .map((zone) => zone.observed.carbonDioxidePartialPressurePa)
      .filter((value): value is number => value !== null);
    const lowestZonePressureSensorPa =
      zonePressureSensorReadings.length === 0
        ? null
        : Math.min(...zonePressureSensorReadings);
    const highestZoneCarbonDioxideSensorPa =
      zoneCarbonDioxideSensorReadings.length === 0
        ? null
        : Math.max(...zoneCarbonDioxideSensorReadings);
    // 全船平均应激：各区带 meanStress 按 awakeCount 加权，非简单平均
    let meanPassengerStressWeightedSum = 0;
    let meanPassengerStressAwakeTotal = 0;
    for (const zone of zoneMood) {
      if (
        !isFiniteNumber(zone.awakeCount) ||
        !isFiniteNumber(zone.meanStress) ||
        zone.awakeCount <= 0
      ) {
        continue;
      }
      meanPassengerStressWeightedSum +=
        zone.meanStress * zone.awakeCount;
      meanPassengerStressAwakeTotal += zone.awakeCount;
    }
    const meanPassengerStress =
      meanPassengerStressAwakeTotal > 0
        ? meanPassengerStressWeightedSum /
          meanPassengerStressAwakeTotal
        : null;
    const operationsLedger = operationsState
      ? {
          disclaimer:
            "舰务运营账本投影；比传感器更完整，不是纯传感通道",
          mission: operationsState.mission,
          departmentOrders:
            operationsState.departmentOrders.slice(-32),
          grievances: operationsState.grievances,
          recentCommunications:
            operationsState.communications.slice(-24),
          crewAssignments: operationsState.crewAssignments,
          personDispositions: operationsState.personDispositions,
          securityTeams: operationsState.securityTeams,
          securityCases: operationsState.securityCases.slice(-24),
          accessControls: operationsState.accessControls,
          rationKgPerAwakePersonDay:
            operationsState.rationKgPerAwakePersonDay,
          waterKgPerAwakePersonDayByZone:
            operationsState.waterKgPerAwakePersonDayByZone,
          agricultureBays: operationsState.agricultureBays,
          cargo: operationsState.cargo,
          cabinAllocations: operationsState.cabinAllocations,
          spareSubstitutions: operationsState.spareSubstitutions,
          activeTasks: operationsState.tasks.filter(
            (task) => task.status === "active",
          ),
          remoteAssets: operationsState.remoteAssets,
          sensors: operationsState.sensors,
          powerAllocationLimitByLoad:
            operationsState.powerAllocationLimitByLoad,
          atmosphereReserveKg: operationsState.atmosphereReserveKg,
          atmosphereReserveSemantics: ATMOSPHERE_RESERVE_LEDGER_SEMANTICS,
          oxygenGenerators: operationsState.oxygenGenerators,
          hydrogenReserveKg: operationsState.hydrogenReserveKg,
          foodDryKg: survival?.foodDryKg ?? null,
          meanPassengerStress,
        }
      : {
          disclaimer:
            "舰务运营账本投影；比传感器更完整，不是纯传感通道",
          availability: "unavailable" as const,
        };
    const fullAuthorizedObservation = {
      source:
        "混合通道：sensorView 为延迟传感；controllerCommandState 为指令态；operationsLedger 为授权舰务账本；均非上帝真值覆写通道",
      sensorView: {
        powerControllerAlarm:
          electricalState.observed.averageBusVoltageV === null ||
          electricalState.observed.averageBusFrequencyHz === null
            ? "sensor-unavailable"
            : observedPowerAlarm
              ? "voltage-or-frequency-deviation"
              : "nominal",
        averageBusVoltageSensorV:
          electricalState.observed.averageBusVoltageV,
        averageBusFrequencySensorHz:
          electricalState.observed.averageBusFrequencyHz,
        servedPowerSensorKw:
          electricalState.observed.totalServedPowerKw,
        reactorOutputSensorKw:
          electricalState.observed.totalReactorOutputKw,
        batteryStateOfChargeSensorFraction:
          electricalState.observed
            .averageBatteryStateOfChargeFraction,
        coolantSensorK:
          coolingState?.observed.averageCoolantTemperatureK ??
          null,
        thermalBusSensorK:
          coolingState?.observed.thermalBusTemperatureK ?? null,
        coolantMassFlowSensorKgPerSecond:
          coolingState?.observed.totalMassFlowKgPerSecond ??
          null,
        habitatPressureSensorPa: atmospherePressureObservation,
        oxygenPartialPressureSensorPaByRing,
        oxygenPartialPressureSensorPaAverage,
        oxygenPartialPressureSensorPaA01Detail:
          compartmentState?.zones.find(
            (zone) => zone.zoneId === "A-01",
          )?.observed.oxygenPartialPressurePa ?? null,
        pressureZoneAlerts: atmosphereZoneAlerts,
        lowestZonePressureSensorPa,
        highestZoneCarbonDioxideSensorPa,
        hullThreat: hullThreatObservation,
        jumpThermalProjection,
        waterRecoverySensors: waterRecoveryState?.observed
          ? {
              availability: "available",
              sampledAtSimulationSeconds:
                waterRecoveryState.observed
                  .sampledAtMicroseconds / 1_000_000,
              sampleAgeSeconds: Math.max(
                0,
                simulationSeconds -
                  waterRecoveryState.observed
                    .sampledAtMicroseconds /
                    1_000_000,
              ),
              potableKgByRing:
                waterRecoveryState.observed.potableKgByRing,
              wastewaterKgByRing:
                waterRecoveryState.observed.wastewaterKgByRing,
              processorThroughputKgPerDay:
                waterRecoveryState.observed
                  .processorThroughputKgPerDay,
              distributionSpurs:
                waterRecoveryState.distributionSpurs,
              undeliveredPotableKg:
                waterRecoveryState.undeliveredPotableKg,
            }
          : {
              availability: "sensor-unavailable",
            },
        habitatThermalDeliverySpurs:
          coolingState?.habitatThermalDeliverySpurs ?? [],
        undeliveredHabitatCoolingJ:
          coolingState?.undeliveredHabitatCoolingJ ?? null,
        maintenanceDiagnostics: maintenanceState
          ? {
              assets: maintenanceState.observedAssets.map(
                ({
                  assetId,
                  label,
                  condition,
                  sampleAgeSeconds,
                }) => {
                  const truthCondition =
                    maintenanceState.truth.conditions[assetId] ??
                    null;
                  const recentlyCompleted =
                    maintenanceState.recentCompletedTasks.some(
                      (task) => task.assetId === assetId,
                    );
                  const scheduleFeasibility =
                    truthCondition === "nominal" || recentlyCompleted
                      ? {
                          schedulable: false as const,
                          blockReason: "nominal-or-unknown" as const,
                        }
                      : evaluateMaintenanceSchedulingFeasibility({
                          assetId,
                          condition,
                          activeAssetIds:
                            maintenanceState.activeTasks,
                          robots: maintenanceState.robots,
                          inventory: maintenanceState.inventory,
                        });
                  return {
                    assetId,
                    label,
                    condition,
                    sampleAgeSeconds,
                    truthCondition,
                    recentlyCompleted,
                    scheduleFeasibility,
                  };
                },
              ),
              activeTasks: maintenanceState.activeTasks.map(
                (task) => ({
                  taskId: task.id,
                  assetId: task.assetId,
                  status: task.status,
                  blockedReason: task.blockedReason,
                  progressFraction:
                    task.completedWorkSeconds /
                    task.requiredWorkSeconds,
                  assignedCrewId: task.assignedCrewId,
                  assignedRobotId: task.assignedRobotId,
                }),
              ),
              recentCompletedTasks:
                maintenanceState.recentCompletedTasks.map(
                  (task) => ({
                    taskId: task.id,
                    assetId: task.assetId,
                    status: task.status,
                  }),
                ),
              diagnosticLagSemantics:
                "observed 诊断有发布延迟；若 truthCondition=nominal 或 recentlyCompleted=true，禁止再 schedule_maintenance",
              inventory: maintenanceState.inventory,
              robots: maintenanceState.robots,
            }
          : { availability: "diagnostic-unavailable" },
        ringAtmosphereSensors: observedRingAtmosphere,
        navigationPositionSensorM:
          navigationState.observed.positionM,
        navigationVelocitySensorMPerS:
          navigationState.observed.velocityMPerS,
        navigationAttitudeSensor:
          navigationState.observed.orientationBodyToInertial,
        navigationAngularVelocitySensorRadPerS:
          navigationState.observed.angularVelocityBodyRadPerS,
        propellantMassSensorKg:
          navigationState.observed.propellantMassKg,
        rotationRingSensors: rotationState.observed.rings.map(
          ({
            id,
            relativeRpm,
            artificialGravityG,
            vibrationMmPerS,
          }) => ({
            ringId: id,
            relativeRpm,
            artificialGravityG,
            vibrationMmPerS,
          }),
        ),
        rotationSensorDiagnostics: rotationState.sensors.map(
          ({
            ringId,
            quantity,
            value,
            quality,
            sampleAgeSeconds,
          }) => ({
            ringId,
            quantity,
            value,
            quality,
            sampleAgeSeconds,
          }),
        ),
      },
      delayedAuthorizedRecords: {
        jumpControllerRecord: authorizedJumpControllerRecord,
        crewManifestRecord: authorizedCrewManifestRecord,
      },
      controllerCommandState: {
        disclaimer:
          "指令态/控制器设定，非延迟传感器；可能与现场真值不同步",
        airHandlers:
          compartmentState?.airHandlers.controllers ?? [],
        waterProcessors: waterRecoveryState?.controllers ?? [],
        waterDistributionSpurs: (
          waterRecoveryState?.distributionSpurs ?? []
        ).map(
          ({
            spurId,
            ring,
            commandedOpenFraction,
            condition,
          }) => ({
            spurId,
            ring,
            commandedOpenFraction,
            condition,
          }),
        ),
        habitatThermalDeliverySpurs: (
          coolingState?.habitatThermalDeliverySpurs ?? []
        ).map(
          ({
            spurId,
            ring,
            commandedOpenFraction,
            condition,
          }) => ({
            spurId,
            ring,
            commandedOpenFraction,
            condition,
          }),
        ),
      },
      operationsLedger,
    };

    const watchEvaluation = evaluateCaptainWatches(
      captainWatchSnapshotRef.current,
      extractCaptainWatchMetricSample(fullAuthorizedObservation),
      { simulationSeconds },
    );
    updateCaptainWatchSnapshot(watchEvaluation.snapshot);
    if (!triggerKey && watchEvaluation.fired.length > 0) {
      const watchKey = captainWatchTriggerKey(watchEvaluation.fired);
      if (watchKey) {
        triggerKey = watchKey;
        triggerReason = `舰长自设观察哨触发：${watchEvaluation.fired
          .map(
            (item) =>
              `${item.label}${item.comparator === "above" ? "高于" : "低于"}${item.threshold}（观测 ${item.observedValue}）；${item.note}`,
          )
          .join("；")}`;
      }
    }

    if (!triggerKey || captainInvocationKeys.current.has(triggerKey)) {
      return;
    }

    // The world is already frozen at this exact scheduler boundary. Build the
    // decision input from that same committed state; do not insert another
    // simulated delivery delay between "due" and "decide".
    const authorizedObservation = fullAuthorizedObservation;

    cancelCaptainDecision();
    captainDecisionSequence.current += 1;
    const captainDecisionToken = captainDecisionSequence.current;
    const invocationWorldEpoch = worldEpoch.current;
    const observedStateRevision = engineState.revision;
    const recentDeviceReceipts =
      latestCaptainDeviceReceipts.current.map((receipt) => ({
        ordinal: receipt.ordinal,
        toolCallId: receipt.toolCallId,
        toolName: receipt.toolName,
        commandKind: receipt.commandKind,
        status: receipt.status,
        summary: receipt.summary,
      }));
    const decisionController = new AbortController();
    activeCaptainDecision.current = {
      token: captainDecisionToken,
      worldEpoch: invocationWorldEpoch,
      triggerKey,
      controller: decisionController,
    };
    const isCurrentCaptainDecision = () => {
      const active = activeCaptainDecision.current;
      return (
        active?.token === captainDecisionToken &&
        active.worldEpoch === invocationWorldEpoch &&
        worldEpoch.current === invocationWorldEpoch &&
        !decisionController.signal.aborted
      );
    };
    const supersededDecisionError = new Error(
      "舰长决策周期已由新的世界状态取代",
    );
    const staleObservationError = new Error(
      "AI 研判期间世界状态发生变化；本轮命令已被联锁作废",
    );
    const assertCurrentCaptainDecision = () => {
      if (!isCurrentCaptainDecision()) {
        throw supersededDecisionError;
      }
      if (latestStateRevision.current !== observedStateRevision) {
        throw staleObservationError;
      }
    };
    const advancesRoutineSchedule =
      captainDecisionAdvancesRoutineSchedule({
        triggerKey,
        simulationSeconds,
        deadlineSimulationSeconds:
          nextCaptainRoutineAtSimulationSeconds.current,
      });
    const routineDeadlineBeforeClear =
      nextCaptainRoutineAtSimulationSeconds.current;
    if (advancesRoutineSchedule) {
      updateNextCaptainRoutineDeadline(null);
    }
    captainInvocationKeys.current.add(triggerKey);
    captainCallInFlight.current = true;
    sendTimeControl({ acquirePauseTokens: ["llm-waiting"] });
    setLlmCallPhase("waiting");
    emitDecisionTheater({
      type: "start",
      cycleToken: captainDecisionToken,
      freezeSimulationSeconds: simulationSeconds,
      triggerReason,
      wallClockStartedAtMs: Date.now(),
    });

    // ─── 决策日志：记录触发 ─────────────────────────────────
    captainDecisionSequence.current += 1;
    const decisionLogId = captainDecisionSequence.current;
    setCaptainDecisionLog((prev) => [
      {
        id: decisionLogId,
        triggerKey,
        triggerReason,
        simulationSeconds,
        status: "thinking" as const,
        captainText: "",
        consultations: [],
        toolCalls: [],
        receipts: [],
      },
      ...prev,
    ].slice(0, 30));

    emitDecisionTheater({
      type: "reading_observation",
      cycleToken: captainDecisionToken,
    });

    const authorizedObservationForAgent = (agentId: string) => {
      const {
        source,
        sensorView,
        delayedAuthorizedRecords,
        controllerCommandState,
        operationsLedger,
      } = authorizedObservation;
      switch (agentId) {
        case "navigation":
          return {
            source,
            sensorView: {
              powerControllerAlarm: sensorView.powerControllerAlarm,
              rotationRingSensors: sensorView.rotationRingSensors,
              rotationSensorDiagnostics:
                sensorView.rotationSensorDiagnostics,
              positionSensorM: sensorView.navigationPositionSensorM,
              velocitySensorMPerS:
                sensorView.navigationVelocitySensorMPerS,
              attitudeSensor: sensorView.navigationAttitudeSensor,
              angularVelocitySensorRadPerS:
                sensorView.navigationAngularVelocitySensorRadPerS,
              propellantMassSensorKg:
                sensorView.propellantMassSensorKg,
              hullThreat: sensorView.hullThreat,
              jumpThermalProjection:
                sensorView.jumpThermalProjection,
            },
            delayedAuthorizedRecords: {
              jumpControllerRecord:
                delayedAuthorizedRecords.jumpControllerRecord,
            },
            operationsLedger,
          };
        case "medical":
          return {
            source,
            sensorView: {
              habitatPressureSensorPa:
                sensorView.habitatPressureSensorPa,
              oxygenPartialPressureSensorPaByRing:
                sensorView.oxygenPartialPressureSensorPaByRing,
              oxygenPartialPressureSensorPaAverage:
                sensorView.oxygenPartialPressureSensorPaAverage,
              oxygenPartialPressureSensorPaA01Detail:
                sensorView.oxygenPartialPressureSensorPaA01Detail,
              pressureZoneAlerts: sensorView.pressureZoneAlerts,
            },
            delayedAuthorizedRecords: {
              crewManifestRecord:
                delayedAuthorizedRecords.crewManifestRecord,
            },
            operationsLedger,
          };
        case "life-support":
          return {
            source,
            sensorView: {
              habitatPressureSensorPa:
                sensorView.habitatPressureSensorPa,
              oxygenPartialPressureSensorPaByRing:
                sensorView.oxygenPartialPressureSensorPaByRing,
              oxygenPartialPressureSensorPaAverage:
                sensorView.oxygenPartialPressureSensorPaAverage,
              oxygenPartialPressureSensorPaA01Detail:
                sensorView.oxygenPartialPressureSensorPaA01Detail,
              pressureZoneAlerts: sensorView.pressureZoneAlerts,
              hullThreat: sensorView.hullThreat,
              waterRecoverySensors:
                sensorView.waterRecoverySensors,
              habitatThermalDeliverySpurs:
                sensorView.habitatThermalDeliverySpurs,
              undeliveredHabitatCoolingJ:
                sensorView.undeliveredHabitatCoolingJ,
              ringAtmosphereSensors:
                sensorView.ringAtmosphereSensors,
              powerControllerAlarm: sensorView.powerControllerAlarm,
            },
            controllerCommandState,
            operationsLedger,
          };
        case "engineering":
          return {
            source,
            sensorView: {
              powerControllerAlarm: sensorView.powerControllerAlarm,
              averageBusVoltageSensorV:
                sensorView.averageBusVoltageSensorV,
              averageBusFrequencySensorHz:
                sensorView.averageBusFrequencySensorHz,
              servedPowerSensorKw: sensorView.servedPowerSensorKw,
              reactorOutputSensorKw:
                sensorView.reactorOutputSensorKw,
              batteryStateOfChargeSensorFraction:
                sensorView.batteryStateOfChargeSensorFraction,
              coolantSensorK: sensorView.coolantSensorK,
              thermalBusSensorK: sensorView.thermalBusSensorK,
              coolantMassFlowSensorKgPerSecond:
                sensorView.coolantMassFlowSensorKgPerSecond,
              pressureZoneAlerts: sensorView.pressureZoneAlerts,
              hullThreat: sensorView.hullThreat,
              jumpThermalProjection:
                sensorView.jumpThermalProjection,
              waterRecoverySensors:
                sensorView.waterRecoverySensors,
              habitatThermalDeliverySpurs:
                sensorView.habitatThermalDeliverySpurs,
              undeliveredHabitatCoolingJ:
                sensorView.undeliveredHabitatCoolingJ,
              ringAtmosphereSensors:
                sensorView.ringAtmosphereSensors,
              oxygenPartialPressureSensorPaByRing:
                sensorView.oxygenPartialPressureSensorPaByRing,
              oxygenPartialPressureSensorPaAverage:
                sensorView.oxygenPartialPressureSensorPaAverage,
              rotationRingSensors: sensorView.rotationRingSensors,
              rotationSensorDiagnostics:
                sensorView.rotationSensorDiagnostics,
              maintenanceDiagnostics:
                sensorView.maintenanceDiagnostics,
            },
            delayedAuthorizedRecords: {
              jumpControllerRecord:
                delayedAuthorizedRecords.jumpControllerRecord,
            },
            controllerCommandState,
            operationsLedger,
          };
        default:
          return {
            source,
            sensorView: {
              powerControllerAlarm: sensorView.powerControllerAlarm,
            },
            operationsLedger,
          };
      }
    };
    // Consultation is a captain decision, never a trigger-based system default.
    // Departments are invoked only after consult_departments names them.
    const consultantIds: string[] = [];
    const missionProvenance = {
      origin: originSystem.name,
      destination: destinationSystem.name,
      plannedRouteDistanceLightYears: missionDistanceLightYears,
      estimatedRouteLegs,
      distanceProvenance:
        "日心三维欧氏航距（lib/astro/star-catalog）；方位为赤道近似，非精密星历",
      routeProgressModel:
        "光年级航程只由成功的 execute_jump 推进；首次跃迁不要求先有常规推进或已完成跃迁记录",
      elapsedSimSeconds: simulationSeconds,
    };
    void (async () => {
      let consultationDegradedAnnounced = false;
      const announceConsultationDegradation = (
        failures: Array<{ departmentId: string; message: string }>,
        sourcePrefix: string,
      ) => {
        if (failures.length === 0) {
          return;
        }
        for (const failure of failures) {
          const agent = llmStatus.agents.find(
            (candidate) => candidate.id === failure.departmentId,
          );
          const softEventId = ++eventId.current;
          setEvents((current) =>
            prependTimelineEvent(current, {
              id: softEventId,
              at: formatDuration(simulationSeconds),
              source: `${sourcePrefix} / ${agent?.role ?? failure.departmentId}`,
              text: `咨询失败（已跳过）：${failure.message}`,
              tone: "watch",
            }),
          );
        }
        if (consultationDegradedAnnounced) {
          return;
        }
        consultationDegradedAnnounced = true;
        const degradeEventId = ++eventId.current;
        setEvents((current) =>
          prependTimelineEvent(current, {
            id: degradeEventId,
            at: formatDuration(simulationSeconds),
            source: "舰长 AI / 乾枢",
            text: CAPTAIN_CONSULTATION_PARTIAL_FAILURE_MESSAGE,
            tone: "watch",
          }),
        );
        setCaptainDecisionLog((previous) =>
          previous.map((entry) =>
            entry.id === decisionLogId
              ? {
                  ...entry,
                  consultationNote:
                    CAPTAIN_CONSULTATION_PARTIAL_FAILURE_MESSAGE,
                }
              : entry,
          ),
        );
      };
      try {
        const initialAttempts = await Promise.all(
          consultantIds.map(
            async (
              agentId,
            ): Promise<
              CaptainConsultationAttempt<
                NonNullable<LlmInvokeRoutePayload["result"]>
              >
            > => {
              try {
                assertCurrentCaptainDecision();
                const configuredDiscussionDepth =
                  llmStatus.agents.find(
                    (agent) => agent.id === agentId,
                  )?.routine.discussionDepth ?? 1;
                const discussionDepth = Number.isSafeInteger(
                  configuredDiscussionDepth,
                )
                  ? Math.max(
                      1,
                      Math.min(2, configuredDiscussionDepth),
                    )
                  : 1;
                const departmentStandingPrompt =
                  renderDepartmentStandingPromptBlock(
                    departmentStandingSnapshotRef.current,
                    agentId,
                    { nowSimulationSeconds: simulationSeconds },
                  );
                const response = await fetch("/api/llm/invoke", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  signal: decisionController.signal,
                  body: JSON.stringify({
                    intent: "captain-consultation",
                    consultantId: agentId,
                    invocation: {
                      messages: [
                        {
                          role: "user",
                          content: {
                          request: DEPARTMENT_CONSULTATION_REQUEST,
                          event: triggerReason,
                          highestDirective: directive,
                          mission: missionProvenance,
                          authorizedObservation:
                            authorizedObservationForAgent(agentId),
                          ...(departmentStandingPrompt
                            ? { standing: departmentStandingPrompt }
                            : {}),
                          },
                        },
                      ],
                      tools: [FILE_DISSENT_TOOL],
                      metadata: {
                        triggerKey,
                        consultationFor: "captain",
                      },
                      discussion: {
                        depth: discussionDepth,
                        round: 1,
                      },
                    },
                  }),
                });
                assertCurrentCaptainDecision();
                const payload =
                  (await response.json()) as LlmInvokeRoutePayload;
                assertCurrentCaptainDecision();
                if (!response.ok || !payload.result) {
                  throw new Error(
                    payload.error?.message ??
                      `${agentId} 部门端点返回 HTTP ${response.status}`,
                  );
                }
                const agentRole =
                  llmStatus.agents.find(
                    (candidate) => candidate.id === agentId,
                  )?.role ?? agentId;
                emitDecisionTheater({
                  type: "department_spoke",
                  cycleToken: captainDecisionToken,
                  round: 0,
                  departmentId: agentId,
                  role: agentRole,
                  text: compactLlmTimelineText(
                    payload.result.text,
                    320,
                    "部门返回了空白建议。",
                  ),
                  wallClockAtMs: Date.now(),
                });
                return { ok: true, value: payload.result };
              } catch (error) {
                if (
                  !isCurrentCaptainDecision() ||
                  isCaptainConsultationHardFailure(error, [
                    supersededDecisionError,
                    staleObservationError,
                  ])
                ) {
                  throw error;
                }
                return { ok: false, departmentId: agentId, error };
              }
            },
          ),
        );
        const initialPartition =
          partitionCaptainConsultationAttempts(initialAttempts);
        announceConsultationDegradation(
          initialPartition.failures,
          "部门 AI",
        );
        let departmentResults = initialPartition.results;
        assertCurrentCaptainDecision();
        const applyDepartmentStandingFromResult = (
          result: NonNullable<LlmInvokeRoutePayload["result"]>,
          sourceLabel: string,
        ) => {
          updateDepartmentStandingSnapshot(
            recordDepartmentConsultation(
              departmentStandingSnapshotRef.current,
              {
                departmentId: result.agentId,
                simulationSeconds,
                stance: result.text,
              },
            ),
          );
          for (const toolCall of result.toolCalls.filter(
            (candidate) => candidate.name === FILE_DISSENT_TOOL_NAME,
          )) {
            const parsed = parseFileDissentToolCall(toolCall.arguments);
            if (!parsed.ok) {
              const dissentEventId = ++eventId.current;
              setEvents((current) =>
                prependTimelineEvent(current, {
                  id: dissentEventId,
                  at: formatDuration(simulationSeconds),
                  source: `${sourceLabel} / 异议`,
                  text: `file_dissent 未写入：${parsed.reason}`,
                  tone: "watch",
                }),
              );
              continue;
            }
            const recorded = recordDepartmentDissent(
              departmentStandingSnapshotRef.current,
              {
                departmentId: result.agentId,
                simulationSeconds,
                severity: parsed.draft.severity,
                summary: parsed.draft.summary,
                captainDecisionOrdinal:
                  captainJournalSnapshotRef.current.nextOrdinal,
              },
            );
            updateDepartmentStandingSnapshot(recorded.snapshot);
          }
        };
        for (const result of departmentResults) {
          assertCurrentCaptainDecision();
          applyDepartmentStandingFromResult(result, "部门 AI");
          const agent = llmStatus.agents.find(
            (candidate) => candidate.id === result.agentId,
          );
          const timelineEventId = ++eventId.current;
          setEvents((current) =>
            prependTimelineEvent(current, {
              id: timelineEventId,
              at: formatDuration(simulationSeconds),
              source: `部门 AI / ${agent?.role ?? result.agentId ?? "未知岗位"}`,
              text: compactLlmTimelineText(
                result.text,
                220,
                "部门返回了空白建议，舰长将按缺失报告处理。",
              ),
              tone: "nominal",
            }),
          );
        }

        // ─── 决策日志：记录部门咨询结果 ─────────────────────
        setCaptainDecisionLog((prev) =>
          prev.map((entry) =>
            entry.id === decisionLogId
              ? {
                  ...entry,
                  consultations: departmentResults.map((r) => ({
                    agentId: r.agentId,
                    role:
                      llmStatus.agents.find((a) => a.id === r.agentId)
                        ?.role ?? r.agentId,
                    text: compactLlmTimelineText(
                      r.text,
                      320,
                      "部门返回了空白建议。",
                    ),
                  })),
                }
              : entry,
          ),
        );

        assertCurrentCaptainDecision();
        let captainDecisionTools: Array<{
          name: string;
          description?: string;
          inputSchema?: unknown;
        }> = [];
        const captainJournalPrompt = renderCaptainJournalPromptBlock(
          captainJournalSnapshotRef.current,
          { nowSimulationSeconds: simulationSeconds },
        );
        const captainWatchPrompt = renderCaptainWatchPromptBlock(
          captainWatchSnapshotRef.current,
          { nowSimulationSeconds: simulationSeconds },
        );
        const captainDissentLedgerPrompt =
          renderCaptainDissentLedgerPromptBlock(
            departmentStandingSnapshotRef.current,
            { nowSimulationSeconds: simulationSeconds },
          );
        emitDecisionTheater({
          type: "captain_deliberating",
          cycleToken: captainDecisionToken,
          pass: "initial",
        });
        const response = await fetch("/api/llm/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: decisionController.signal,
          body: JSON.stringify({
            intent: "captain-decision",
            invocation: {
              messages: [
                {
                  role: "user",
                  content: {
                  event: triggerReason,
                  highestDirective: directive,
                  mission: missionProvenance,
                  authorizedObservation,
                  recentDeviceReceipts: {
                    source: "上一轮舰长工具调用的设备执行层回执",
                    entries: recentDeviceReceipts,
                  },
                  departmentReports: departmentResults.map(
                    (result) => ({
                      agentId: result.agentId,
                      text: result.text,
                      provenance:
                        "固定部门模型报告；未经设备执行确认",
                    }),
                  ),
                  ...(captainJournalPrompt
                    ? { memory: captainJournalPrompt }
                    : {}),
                  ...(captainWatchPrompt
                    ? { watch: captainWatchPrompt }
                    : {}),
                  ...(captainDissentLedgerPrompt
                    ? { dissentLedger: captainDissentLedgerPrompt }
                    : {}),
                  instruction: CAPTAIN_DECISION_INSTRUCTION,
                  },
                },
              ],
              tools: (captainDecisionTools = [
                ...CAPTAIN_WORLD_TOOLS,
                CAPTAIN_CONSULTATION_TOOL,
                RECORD_CAPTAIN_LOG_TOOL,
                SET_WATCH_CONDITION_TOOL,
              ]),
              metadata: {
                triggerKey,
              },
              discussion: { depth: 1, round: 1 },
            },
          }),
        });
        assertCurrentCaptainDecision();
        let payload =
          (await response.json()) as LlmInvokeRoutePayload;
        assertCurrentCaptainDecision();
        if (!response.ok || !payload.result) {
          throw new Error(
            payload.error?.message ??
              `舰长端点返回 HTTP ${response.status}`,
          );
        }
        const consultationCalls = payload.result.toolCalls.filter(
          (toolCall) => toolCall.name === "consult_departments",
        );
        if (consultationCalls.length > 0) {
          const preliminaryCaptainText = payload.result.text;
          const consultationCall = consultationCalls[0];
          const { departmentIds, question, rounds } =
            parseCaptainConsultationRequest(consultationCall.arguments);
          emitDecisionTheater({
            type: "consultation_planned",
            cycleToken: captainDecisionToken,
            departmentIds,
            question,
            rounds,
          });
          let meetingTranscript = departmentResults.map((result) => ({
            round: 0,
            agentId: result.agentId,
            text: result.text,
          }));
          let previousRoundPeerPositions: Array<{
            departmentId: string;
            text: string;
          }> = [];
          for (let round = 1; round <= rounds; round += 1) {
            const roundAttempts = await Promise.all(
              departmentIds.map(
                async (
                  agentId,
                ): Promise<
                  CaptainConsultationAttempt<
                    NonNullable<LlmInvokeRoutePayload["result"]>
                  >
                > => {
                  try {
                    assertCurrentCaptainDecision();
                    const departmentStandingPrompt =
                      renderDepartmentStandingPromptBlock(
                        departmentStandingSnapshotRef.current,
                        agentId,
                        { nowSimulationSeconds: simulationSeconds },
                      );
                    const peerPositionsPrompt =
                      round >= 2
                        ? renderPeerPositionsPromptBlock(
                            previousRoundPeerPositions,
                            { excludeDepartmentId: agentId },
                          )
                        : null;
                    const meetingResponse = await fetch("/api/llm/invoke", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      signal: decisionController.signal,
                      body: JSON.stringify({
                        intent: "captain-consultation",
                        consultantId: agentId,
                        invocation: {
                          messages: [
                            {
                              role: "user",
                              content: {
                                request: `${DEPARTMENT_CONSULTATION_REQUEST} 舰长主动召集部门会议（第${round}轮）。请回答问题，并针对既有发言指出同意、分歧、风险与可执行建议。`,
                                question,
                                round,
                                highestDirective: directive,
                                authorizedObservation:
                                  authorizedObservationForAgent(agentId),
                                priorMeetingTranscript: meetingTranscript,
                                ...(departmentStandingPrompt
                                  ? { standing: departmentStandingPrompt }
                                  : {}),
                                ...(peerPositionsPrompt
                                  ? { peerPositions: peerPositionsPrompt }
                                  : {}),
                              },
                            },
                          ],
                          tools: [FILE_DISSENT_TOOL],
                          metadata: {
                            triggerKey,
                            consultationFor: "captain",
                            meetingRound: round,
                          },
                          discussion: { depth: 2, round },
                        },
                      }),
                    });
                    assertCurrentCaptainDecision();
                    const meetingPayload =
                      (await meetingResponse.json()) as LlmInvokeRoutePayload;
                    if (!meetingResponse.ok || !meetingPayload.result) {
                      throw new Error(
                        meetingPayload.error?.message ??
                          `${agentId} 部门会议返回 HTTP ${meetingResponse.status}`,
                      );
                    }
                    const agentRole =
                      llmStatus.agents.find(
                        (candidate) => candidate.id === agentId,
                      )?.role ?? agentId;
                    emitDecisionTheater({
                      type: "department_spoke",
                      cycleToken: captainDecisionToken,
                      round,
                      departmentId: agentId,
                      role: agentRole,
                      text: compactLlmTimelineText(
                        meetingPayload.result.text,
                        320,
                        "部门返回了空白建议。",
                      ),
                      wallClockAtMs: Date.now(),
                    });
                    return { ok: true, value: meetingPayload.result };
                  } catch (error) {
                    if (
                      !isCurrentCaptainDecision() ||
                      isCaptainConsultationHardFailure(error, [
                        supersededDecisionError,
                        staleObservationError,
                      ])
                    ) {
                      throw error;
                    }
                    return { ok: false, departmentId: agentId, error };
                  }
                },
              ),
            );
            const roundPartition =
              partitionCaptainConsultationAttempts(roundAttempts);
            announceConsultationDegradation(
              roundPartition.failures,
              `部门会议 R${round}`,
            );
            const roundResults = roundPartition.results;
            departmentResults = [...departmentResults, ...roundResults];
            for (const result of roundResults) {
              applyDepartmentStandingFromResult(
                result,
                `部门会议 R${round}`,
              );
              const agent = llmStatus.agents.find(
                (candidate) => candidate.id === result.agentId,
              );
              const timelineEventId = ++eventId.current;
              setEvents((current) =>
                prependTimelineEvent(current, {
                  id: timelineEventId,
                  at: formatDuration(simulationSeconds),
                  source: `部门会议 R${round} / ${agent?.role ?? result.agentId ?? "未知岗位"}`,
                  text: compactLlmTimelineText(
                    result.text,
                    260,
                    "部门在本轮会议中未返回有效发言。",
                  ),
                  tone: "nominal",
                }),
              );
            }
            previousRoundPeerPositions = roundResults.map((result) => ({
              departmentId: result.agentId,
              text: result.text,
            }));
            meetingTranscript = [
              ...meetingTranscript,
              ...roundResults.map((result) => ({
                round,
                agentId: result.agentId,
                text: result.text,
              })),
            ];
          }
          setCaptainDecisionLog((previous) =>
            previous.map((entry) =>
              entry.id === decisionLogId
                ? {
                    ...entry,
                    consultations: departmentResults.map((result) => ({
                      agentId: result.agentId,
                      role:
                        llmStatus.agents.find(
                          (agent) => agent.id === result.agentId,
                        )?.role ?? result.agentId,
                      text: compactLlmTimelineText(
                        result.text,
                        320,
                        "部门在会议中未返回有效发言。",
                      ),
                    })),
                  }
                : entry,
            ),
          );
          assertCurrentCaptainDecision();
          const finalCaptainJournalPrompt =
            renderCaptainJournalPromptBlock(
              captainJournalSnapshotRef.current,
              { nowSimulationSeconds: simulationSeconds },
            );
          const finalCaptainWatchPrompt = renderCaptainWatchPromptBlock(
            captainWatchSnapshotRef.current,
            { nowSimulationSeconds: simulationSeconds },
          );
          const finalCaptainDissentLedgerPrompt =
            renderCaptainDissentLedgerPromptBlock(
              departmentStandingSnapshotRef.current,
              { nowSimulationSeconds: simulationSeconds },
            );
          emitDecisionTheater({
            type: "captain_deliberating",
            cycleToken: captainDecisionToken,
            pass: "final",
          });
          const finalResponse = await fetch("/api/llm/invoke", {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: decisionController.signal,
            body: JSON.stringify({
              intent: "captain-decision",
              invocation: {
                messages: [
                  {
                    role: "user",
                    content: {
                      event: triggerReason,
                      highestDirective: directive,
                      mission: missionProvenance,
                      authorizedObservation,
                      preliminaryCaptainResponse: preliminaryCaptainText,
                      departmentMeetingReports: departmentResults.map(
                        (result) => ({
                          agentId: result.agentId,
                          text: result.text,
                        }),
                      ),
                      ...(finalCaptainJournalPrompt
                        ? { memory: finalCaptainJournalPrompt }
                        : {}),
                      ...(finalCaptainWatchPrompt
                        ? { watch: finalCaptainWatchPrompt }
                        : {}),
                      ...(finalCaptainDissentLedgerPrompt
                        ? {
                            dissentLedger:
                              finalCaptainDissentLedgerPrompt,
                          }
                        : {}),
                      instruction:
                        `${CAPTAIN_DECISION_INSTRUCTION}\n部门会议已经完成。现在必须作最终决策；不要再次调用 consult_departments。`,
                    },
                  },
                ],
                tools: captainDecisionTools.filter(
                  (tool) => tool.name !== "consult_departments",
                ),
                metadata: { triggerKey, afterDepartmentMeeting: true },
                discussion: { depth: 2, round: 1 },
              },
            }),
          });
          assertCurrentCaptainDecision();
          const finalPayload =
            (await finalResponse.json()) as LlmInvokeRoutePayload;
          if (!finalResponse.ok || !finalPayload.result) {
            throw new Error(
              finalPayload.error?.message ??
                `舰长会议后决策返回 HTTP ${finalResponse.status}`,
            );
          }
          payload = finalPayload;
          setCaptainDecisionLog((previous) =>
            previous.map((entry) =>
              entry.id === decisionLogId
                ? {
                    ...entry,
                    consultations: departmentResults.map((result) => ({
                      agentId: result.agentId,
                      role:
                        llmStatus.agents.find(
                          (agent) => agent.id === result.agentId,
                        )?.role ?? result.agentId,
                      text: compactLlmTimelineText(
                        result.text,
                        320,
                        "部门返回了空白建议。",
                      ),
                    })),
                  }
                : entry,
            ),
          );
        }
        if (!payload.result) {
          throw new Error("舰长会议后没有可执行决策");
        }
        assertCurrentCaptainDecision();
        const timelineEventId = ++eventId.current;
        setEvents((current) =>
          prependTimelineEvent(current, {
            id: timelineEventId,
            at: formatDuration(simulationSeconds),
            source: "舰长 AI / 乾枢",
            text: compactLlmTimelineText(
              payload.result?.text ?? "",
              260,
              "舰长返回了设备命令。",
            ),
            tone: "nominal",
          }),
        );

        const captainCallId = payload.result.callId;

        // ─── 决策日志：记录舰长响应与工具调用 ───────────────
        setCaptainDecisionLog((prev) =>
          prev.map((entry) =>
            entry.id === decisionLogId
              ? {
                  ...entry,
                  status: "decided" as const,
                  captainText: compactLlmTimelineText(
                    payload.result?.text ?? "",
                    512,
                    "舰长返回了设备命令。",
                  ),
                  toolCalls: (payload.result?.toolCalls ?? []).map(
                    (tc) => ({
                      toolCallId: tc.id,
                      toolName: tc.name,
                      arguments: tc.arguments,
                    }),
                  ),
                }
              : entry,
          ),
        );

        const preliminaryReceipts: CaptainDeviceReceiptSummary[] = [];
        const captainLogCall = payload.result.toolCalls.find(
          (toolCall) => toolCall.name === RECORD_CAPTAIN_LOG_TOOL_NAME,
        );
        if (!captainLogCall) {
          appendCaptainCommandEvent(
            simulationSeconds,
            "舰长本轮未调用 record_captain_log，航行志未更新。",
            "watch",
          );
        } else {
          const parsedLog = parseCaptainLogToolCall(
            captainLogCall.arguments,
          );
          if (!parsedLog.ok) {
            appendCaptainCommandEvent(
              simulationSeconds,
              `record_captain_log 未写入：${parsedLog.reason}`,
              "watch",
            );
          } else {
            const appended = appendCaptainJournalEntry(
              captainJournalSnapshotRef.current,
              parsedLog.draft,
              { simulationSeconds, triggerKey },
            );
            updateCaptainJournalSnapshot(appended.snapshot);
          }
        }
        for (const watchCall of payload.result.toolCalls.filter(
          (toolCall) => toolCall.name === SET_WATCH_CONDITION_TOOL_NAME,
        )) {
          const parsedWatch = parseSetWatchConditionToolCall(
            watchCall.arguments,
          );
          if (!parsedWatch.ok) {
            appendCaptainCommandEvent(
              simulationSeconds,
              `set_watch_condition 未生效：${parsedWatch.reason}`,
              "watch",
            );
            continue;
          }
          const applied = applyCaptainWatchCondition(
            captainWatchSnapshotRef.current,
            parsedWatch.draft,
            { simulationSeconds },
          );
          updateCaptainWatchSnapshot(applied.snapshot);
        }
        const worldToolCalls = payload.result.toolCalls.filter(
          (toolCall) =>
            toolCall.name !== "configure_self_routine" &&
            toolCall.name !== "consult_departments" &&
            toolCall.name !== RECORD_CAPTAIN_LOG_TOOL_NAME &&
            toolCall.name !== SET_WATCH_CONDITION_TOOL_NAME,
        );
        const boundedWorldToolCalls = worldToolCalls.slice(
          0,
          MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE,
        );
        const queuedWorldCommands: QueuedCaptainWorldCommand[] = [];
        boundedWorldToolCalls.forEach((toolCall) => {
          assertCurrentCaptainDecision();
          const ordinal =
            payload.result!.toolCalls.findIndex(
              (candidate) => candidate.id === toolCall.id,
            ) + 1;
          const parsed = parseCaptainWorldToolCall(
            toolCall,
            engineState.journey.status,
            trueRemainingDistance,
            {
              jumpBlocked:
                hullThreatObservation.jumpBlocked ||
                hullThreatObservation.activeBreachCount > 0,
              jumpBlockReason:
                hullThreatObservation.jumpBlockReason,
              jumpThermalClears:
                jumpThermalProjection?.clearsInterlock ?? null,
              jumpThermalBlockReason:
                jumpThermalProjection?.blockReason ?? null,
            },
          );
          if (!parsed.ok) {
            const receipt: CaptainDeviceReceiptSummary = {
              ordinal,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              commandKind: null,
              status: "invalid",
              summary: parsed.reason,
            };
            preliminaryReceipts.push(receipt);
            appendCaptainCommandEvent(
              simulationSeconds,
              `${toolCall.name} 未进入执行队列：${parsed.reason}。`,
              "watch",
            );
            return;
          }
          queuedWorldCommands.push({
            ordinal,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            stableCommandId: `${captainCallId}:${toolCall.id}:${ordinal}`,
            command: parsed.command,
          });
        });
        if (
          worldToolCalls.length >
          MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE
        ) {
          assertCurrentCaptainDecision();
          const overflow =
            worldToolCalls.length -
            MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE;
          preliminaryReceipts.push({
            ordinal: MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE + 1,
            toolCallId: "queue-limit",
            toolName: "world-command-overflow",
            commandKind: null,
            status: "limit",
            summary: `${overflow} 条世界工具调用超过每轮 ${MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE} 条上限`,
          });
          appendCaptainCommandEvent(
            simulationSeconds,
            `${overflow} 条世界工具调用超过每轮 ${MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE} 条上限，均未进入执行队列。`,
            "watch",
          );
        }

        const routineTickets = [
          ...departmentResults.flatMap(
            (result) => result.routineTickets ?? [],
          ),
          ...(payload.result.routineTickets ?? []),
        ];
        for (const ticket of routineTickets) {
          assertCurrentCaptainDecision();
          const routineResponse = await fetch(
            "/api/llm/routine/consume",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: decisionController.signal,
              body: JSON.stringify({
                callId: ticket.callId,
                toolCallId: ticket.toolCallId,
              }),
            },
          );
          assertCurrentCaptainDecision();
          if (!routineResponse.ok) {
            continue;
          }
          const routinePayload = (await routineResponse.json()) as {
            routineChange?: {
              routine: {
                systemInfoIntervalSimSeconds: number;
                discussionDepth: number;
                discussionRounds: number;
              };
            };
          };
          assertCurrentCaptainDecision();
          if (routinePayload.routineChange) {
            const routine =
              routinePayload.routineChange.routine;
            const routineAgentId =
              departmentResults.find(
                (result) => result.callId === ticket.callId,
              )?.agentId ?? "captain";
            const routineAgent = llmStatus.agents.find(
              (agent) => agent.id === routineAgentId,
            );
            if (routineAgentId === "captain") {
              captainRoutineSeconds.current = Math.max(
                30,
                routine.systemInfoIntervalSimSeconds,
              );
            }
            assertCurrentCaptainDecision();
            const timelineEventId = ++eventId.current;
            setEvents((current) =>
              prependTimelineEvent(current, {
                id: timelineEventId,
                at: formatDuration(simulationSeconds),
                source: `${routineAgent?.role ?? routineAgentId} / 自主管理`,
                text:
                  routineAgentId === "captain"
                    ? `舰长决策周期调整为 ${formatCadence(routine.systemInfoIntervalSimSeconds)}；下一个截止点将从本轮完成时重新计算。固定讨论上限为深度 ${routine.discussionDepth}、${routine.discussionRounds} 轮。`
                    : `按需咨询参数已更新；该部门不会独立冻结或推进世界。咨询间隔偏好为 ${formatCadence(routine.systemInfoIntervalSimSeconds)}，讨论上限为深度 ${routine.discussionDepth}、${routine.discussionRounds} 轮。`,
                tone: "nominal",
              }),
            );
          }
        }

        assertCurrentCaptainDecision();
        const refreshedStatus = await fetch("/api/llm/status", {
          cache: "no-store",
          signal: decisionController.signal,
        });
        assertCurrentCaptainDecision();
        if (refreshedStatus.ok) {
          const statusPayload = (await refreshedStatus.json()) as {
            llm?: LlmRuntimeStatus;
          };
          assertCurrentCaptainDecision();
          if (statusPayload.llm) {
            setLlmStatus({
              ...statusPayload.llm,
              recentCalls: statusPayload.llm.recentCalls ?? [],
            });
          }
        }

        assertCurrentCaptainDecision();
        emitDecisionTheater({
          type: "captain_decided",
          cycleToken: captainDecisionToken,
          text: compactLlmTimelineText(
            payload.result.text ?? "",
            512,
            "舰长返回了设备命令。",
          ),
          worldCommandTotal: queuedWorldCommands.length,
        });
        if (queuedWorldCommands.length > 0) {
          const queue: CaptainWorldCommandQueue = {
            cycleToken: captainDecisionToken,
            worldEpoch: invocationWorldEpoch,
            triggerKey,
            callId: captainCallId,
            commands: queuedWorldCommands,
            nextIndex: 0,
            activeRequestId: null,
            receipts: preliminaryReceipts,
            advancesRoutineSchedule,
            resumeAfterCompletion: false,
          };
          activeCaptainWorldCommandQueue.current = queue;
          dispatchNextCaptainWorldCommand();
        } else {
          latestCaptainDeviceReceipts.current = [
            ...preliminaryReceipts,
          ].sort((left, right) => left.ordinal - right.ordinal);
          setCaptainDecisionLog((prev) =>
            prev.map((entry) =>
              entry.id === decisionLogId
                ? {
                    ...entry,
                    status: "done" as const,
                    receipts: [
                      ...preliminaryReceipts,
                    ].sort((left, right) => left.ordinal - right.ordinal),
                  }
                : entry,
            ),
          );
          if (advancesRoutineSchedule) {
            updateNextCaptainRoutineDeadline(
              computeNextCaptainRoutineDeadline(
                latestSimulationSeconds.current,
                captainRoutineSeconds.current,
              ),
            );
          }
          emitDecisionTheater({
            type: "world_resumed",
            cycleToken: captainDecisionToken,
          });
          releaseCaptainDecisionPause();
        }
        assertCurrentCaptainDecision();
      } catch (error) {
        if (!isCurrentCaptainDecision()) {
          return;
        }
        captainInvocationKeys.current.delete(triggerKey);
        const message =
          error instanceof Error ? error.message : String(error);
        const scheduleNote = advancesRoutineSchedule
          ? "本轮决策作废，日程未推进，解冻后将重试。"
          : null;
        const timelineEventId = ++eventId.current;
        setEvents((current) =>
          prependTimelineEvent(current, {
            id: timelineEventId,
            at: formatDuration(simulationSeconds),
            source: "LLM 网关",
            text: scheduleNote
              ? `舰长关键决策未完成：${message}。${scheduleNote}`
              : `舰长关键决策未完成：${message}`,
            tone: "critical",
          }),
        );
        setCaptainDecisionLog((prev) =>
          prev.map((entry) =>
            entry.id === decisionLogId
              ? {
                  ...entry,
                  status: "error" as const,
                  errorMessage: message,
                }
              : entry,
          ),
        );
        emitDecisionTheater({
          type: "fail",
          cycleToken: captainDecisionToken,
          message,
        });
        showToast(
          scheduleNote
            ? `舰长调用失败：${message}。${scheduleNote}`
            : `舰长调用失败：${message}`,
        );
        if (advancesRoutineSchedule) {
          // Do not advance past the failed cycle — restore the due deadline
          // (or current sim time) so the routine retries after unpause.
          updateNextCaptainRoutineDeadline(
            routineDeadlineBeforeClear ??
              latestSimulationSeconds.current,
          );
        }
        releaseCaptainDecisionPause("error");
      } finally {
        if (
          activeCaptainDecision.current?.token ===
          captainDecisionToken
        ) {
          activeCaptainDecision.current = null;
          captainCallInFlight.current = false;
        }
      }
    })();
  }, [
    appendCaptainCommandEvent,
    cancelCaptainDecision,
    destinationSystem.name,
    directive,
    dispatchNextCaptainWorldCommand,
    emitDecisionTheater,
    engineState,
    estimatedRouteLegs,
    compartmentState,
    hullConsequenceState,
    coolingState,
    electricalState,
    navigationState,
    operationsState,
    survival,
    zoneMood,
    rotationState,
    waterRecoveryState,
    maintenanceState,
    llmStatus,
    missionEnded,
    missionDistanceLightYears,
    releaseCaptainDecisionPause,
    missionStarted,
    originSystem.name,
    paused,
    sendTimeControl,
    showToast,
    simulationSeconds,
    updateCaptainJournalSnapshot,
    updateCaptainWatchSnapshot,
    updateDepartmentStandingSnapshot,
    updateNextCaptainRoutineDeadline,
  ]);

  useEffect(() => {
    if (
      !missionStarted ||
      missionEnded ||
      paused ||
      !engineState ||
      !llmStatus?.ready ||
      latestStateRevision.current !== engineState.revision ||
      pendingLoad.current !== null ||
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0 ||
      activeCaptainWorldCommandQueue.current !== null ||
      captainCallInFlight.current ||
      keyPassengerCallInFlight.current
    ) {
      return;
    }

    const routineSecondsByPassenger = new Map(
      llmStatus.agents.map((agent) => [
        agent.id,
        agent.routine.systemInfoIntervalSimSeconds,
      ]),
    );
    const wallEpochMs = Date.now();
    const candidate =
      keyPassengerScheduler.current.selectNextDue(
        simulationSeconds,
        wallEpochMs,
        routineSecondsByPassenger,
      );
    if (!candidate) {
      return;
    }

    keyPassengerCallSequence.current += 1;
    const callToken = keyPassengerCallSequence.current;
    const callWorldEpoch = worldEpoch.current;
    const pollId = `passenger-poll:${callWorldEpoch}:${callToken}:${candidate.passengerId}`;
    const controller = new AbortController();
    const cycle: KeyPassengerCallCycle = {
      token: callToken,
      worldEpoch: callWorldEpoch,
      pollId,
      passengerId: candidate.passengerId,
      controller,
    };
    activeKeyPassengerCall.current = cycle;
    keyPassengerCallInFlight.current = true;
    keyPassengerScheduler.current.markDispatched(
      candidate.passengerId,
      simulationSeconds,
      wallEpochMs,
    );

    const isSamePassengerCycle = () => {
      const active = activeKeyPassengerCall.current;
      return (
        active?.token === callToken &&
        active.worldEpoch === callWorldEpoch &&
        active.pollId === pollId &&
        active.passengerId === candidate.passengerId &&
        worldEpoch.current === callWorldEpoch
      );
    };
    const timeout = window.setTimeout(() => {
      if (isSamePassengerCycle()) {
        controller.abort(
          new Error("关键乘客轻量调用超过 30 秒上限"),
        );
      }
    }, 30_000);

    void (async () => {
      try {
        updatePassengerSocietySnapshot(
          pruneStaleRumors(passengerSocietySnapshotRef.current, {
            simulationSeconds,
          }),
        );
        const passengerZoneId = candidate.observation.assignedZoneId;
        const circleTelemetry = passengerCircles.find(
          (circle) => circle.passengerId === candidate.passengerId,
        );
        const circle = (circleTelemetry?.members ?? [])
          .slice(0, PASSENGER_CIRCLE_LIMIT)
          .map((member) => ({
            passengerId: member.passengerId,
            displayName: member.displayName,
            relation: member.relation,
            lifeState: member.lifeState,
            conditionBand: passengerConditionBand(member.physicalHealth),
            sameZone: member.zoneId === passengerZoneId,
          }));
        const zoneMoodTelemetry = zoneMood.find(
          (zone) => zone.zoneId === passengerZoneId,
        );
        const zoneLabel =
          compartmentState?.zones.find(
            (zone) => zone.zoneId === passengerZoneId,
          )?.labelZh ?? passengerZoneId;
        const zoneMoodObservation = zoneMoodTelemetry
          ? {
              zoneId: zoneMoodTelemetry.zoneId,
              zoneLabel,
              awakeCount: zoneMoodTelemetry.awakeCount,
              stressBand: passengerStressBand(zoneMoodTelemetry.meanStress),
              trustBand: passengerTrustBand(zoneMoodTelemetry.meanTrust),
            }
          : null;
        const overheardRumors = selectOverheardRumors(
          passengerSocietySnapshotRef.current,
          {
            listenerPassengerId: candidate.passengerId,
            zoneId: passengerZoneId,
            simulationSeconds,
          },
        );
        if (overheardRumors.length > 0) {
          updatePassengerSocietySnapshot(
            markRumorsHeard(
              passengerSocietySnapshotRef.current,
              overheardRumors.map((rumor) => rumor.rumorId),
            ),
          );
        }
        const recentPublicCommunications = (
          operationsState?.communications ?? []
        )
          .filter(
            (entry) =>
              entry.deliveredAtMicroseconds !== null &&
              (entry.kind === "announcement" ||
                entry.kind === "policy-explanation" ||
                entry.kind === "grievance-response"),
          )
          .slice(-3)
          .map((entry) => ({
            simulationSeconds:
              (entry.deliveredAtMicroseconds ??
                entry.createdAtMicroseconds) / 1_000_000,
            text: `${entry.subject}：${entry.message}`,
          }));
        const societyPrompt = renderPassengerSocietyPromptBlock(
          {
            circle,
            zoneMood: zoneMoodObservation,
            overheardRumors,
            recentPublicCommunications,
          },
          { nowSimulationSeconds: simulationSeconds },
        );
        const response = await fetch("/api/llm/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            intent: "passenger-self",
            passengerId: candidate.passengerId,
            pollId,
            selfObservation: {
              ...candidate.observation,
              sampleAgeSeconds: candidate.sampleAgeSeconds,
            },
            publicContext: {
              origin: originSystem.name,
              destination: destinationSystem.name,
              elapsedSimulationSeconds: simulationSeconds,
            },
            previousOwnNote: candidate.previousOwnNote,
            ...(societyPrompt ? { society: societyPrompt } : {}),
            tools: [
              FILE_PASSENGER_GRIEVANCE_TOOL,
              SHARE_PASSENGER_RUMOR_TOOL,
            ],
          }),
        });
        if (!isSamePassengerCycle() || controller.signal.aborted) {
          return;
        }
        const payload =
          (await response.json()) as LlmInvokeRoutePayload;
        if (!isSamePassengerCycle() || controller.signal.aborted) {
          return;
        }
        if (!response.ok || !payload.result) {
          throw new Error(
            payload.error?.message ??
              `关键乘客端点返回 HTTP ${response.status}`,
          );
        }
        if (payload.result.agentId !== candidate.passengerId) {
          throw new Error("关键乘客端点返回了不匹配的固定身份");
        }

        const privateText = compactLlmTimelineText(
          payload.result.text,
          512,
          "本轮没有提交新的个人需求。",
        );
        keyPassengerScheduler.current.markSucceeded(
          candidate.passengerId,
          latestSimulationSeconds.current,
          privateText,
        );
        setKeyPassengerPrivateNotes(
          keyPassengerScheduler.current.listPrivateNotes(),
        );

        for (const toolCall of payload.result.toolCalls) {
          if (!isSamePassengerCycle() || controller.signal.aborted) {
            return;
          }
          if (toolCall.name === SHARE_RUMOR_TOOL_NAME) {
            const parsed = parseShareRumorToolCall(toolCall.arguments);
            if (!parsed.ok) {
              const rumorEventId = ++eventId.current;
              setEvents((current) =>
                prependTimelineEvent(current, {
                  id: rumorEventId,
                  at: formatDuration(latestSimulationSeconds.current),
                  source: `关键乘客 / ${candidate.observation.displayName}`,
                  text: `share_passenger_rumor 未写入：${parsed.reason}`,
                  tone: "watch",
                }),
              );
              continue;
            }
            try {
              const recorded = recordPassengerRumor(
                passengerSocietySnapshotRef.current,
                {
                  originPassengerId: candidate.passengerId,
                  originDisplayName: candidate.observation.displayName,
                  zoneId: passengerZoneId,
                  text: parsed.draft.text,
                  simulationSeconds: latestSimulationSeconds.current,
                },
              );
              updatePassengerSocietySnapshot(recorded.snapshot);
            } catch (error) {
              const rumorEventId = ++eventId.current;
              setEvents((current) =>
                prependTimelineEvent(current, {
                  id: rumorEventId,
                  at: formatDuration(latestSimulationSeconds.current),
                  source: `关键乘客 / ${candidate.observation.displayName}`,
                  text: `share_passenger_rumor 未写入：${
                    error instanceof Error ? error.message : String(error)
                  }`,
                  tone: "watch",
                }),
              );
            }
            continue;
          }
          if (toolCall.name === FILE_GRIEVANCE_TOOL_NAME) {
            const parsed = parseFileGrievanceToolCall(toolCall.arguments);
            if (!parsed.ok) {
              const grievanceEventId = ++eventId.current;
              setEvents((current) =>
                prependTimelineEvent(current, {
                  id: grievanceEventId,
                  at: formatDuration(latestSimulationSeconds.current),
                  source: `关键乘客 / ${candidate.observation.displayName}`,
                  text: `file_passenger_grievance 未提交：${parsed.reason}`,
                  tone: "watch",
                }),
              );
              continue;
            }
            const worker = workerRef.current;
            const expectedStateRevision = latestStateRevision.current;
            if (!worker || expectedStateRevision === null) {
              const grievanceEventId = ++eventId.current;
              setEvents((current) =>
                prependTimelineEvent(current, {
                  id: grievanceEventId,
                  at: formatDuration(latestSimulationSeconds.current),
                  source: `关键乘客 / ${candidate.observation.displayName}`,
                  text: "file_passenger_grievance 未提交：世界状态尚不可用。",
                  tone: "watch",
                }),
              );
              continue;
            }
            // 关键乘客申诉不申请暂停令牌、不阻塞轮询；世界继续推进。
            requestSequence.current += 1;
            const grievanceRequestId = `passenger-grievance-${requestSequence.current}`;
            const commandId = grievanceRequestId;
            const command: SimulationWorkerCommand = {
              type: "ship-command",
              requestId: grievanceRequestId,
              commandId,
              idempotencyKey: commandId,
              issuedAtMicroseconds: Math.round(
                latestSimulationSeconds.current * 1_000_000,
              ),
              expectedRevision: commandRevision.current,
              expectedStateRevision,
              command: {
                kind: "file-passenger-grievance",
                actorAgentId: candidate.passengerId,
                passengerId: candidate.passengerId,
                category: parsed.draft.category,
                summary: parsed.draft.summary,
              },
            };
            worker.postMessage(command);
          }
        }

        for (const ticket of payload.result.routineTickets ?? []) {
          if (!isSamePassengerCycle() || controller.signal.aborted) {
            return;
          }
          await fetch("/api/llm/routine/consume", {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              callId: ticket.callId,
              toolCallId: ticket.toolCallId,
            }),
          });
        }
        if (!isSamePassengerCycle() || controller.signal.aborted) {
          return;
        }
        const refreshedStatus = await fetch("/api/llm/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (
          isSamePassengerCycle() &&
          !controller.signal.aborted &&
          refreshedStatus.ok
        ) {
          const statusPayload = (await refreshedStatus.json()) as {
            llm?: LlmRuntimeStatus;
          };
          if (statusPayload.llm) {
            setLlmStatus({
              ...statusPayload.llm,
              recentCalls: statusPayload.llm.recentCalls ?? [],
            });
          }
        }
        showToast(
          `${candidate.observation.displayName} 的私人终端记录已更新。`,
        );
      } catch (error) {
        if (!isSamePassengerCycle()) {
          return;
        }
        keyPassengerScheduler.current.markFailed(
          candidate.passengerId,
          latestSimulationSeconds.current,
        );
        const message =
          error instanceof Error ? error.message : String(error);
        showToast(
          `关键乘客 ${candidate.observation.displayName} 调用延后重试：${message}`,
        );
      } finally {
        window.clearTimeout(timeout);
        if (
          activeKeyPassengerCall.current?.token === callToken &&
          activeKeyPassengerCall.current.worldEpoch ===
            callWorldEpoch
        ) {
          activeKeyPassengerCall.current = null;
          keyPassengerCallInFlight.current = false;
        }
      }
    })();
  }, [
    compartmentState,
    destinationSystem.name,
    engineState,
    llmStatus,
    missionEnded,
    missionStarted,
    operationsState,
    originSystem.name,
    passengerCircles,
    paused,
    showToast,
    simulationSeconds,
    updatePassengerSocietySnapshot,
    zoneMood,
  ]);

  const addEvent = (text: string, tone: SystemTone, source = "外部干预") => {
    const timelineEventId = ++eventId.current;
    setEvents((current) =>
      prependTimelineEvent(current, {
        id: timelineEventId,
        at: formatDuration(simulationSeconds),
        source,
        text,
        tone,
      }),
    );
    showToast(`${source}：${text}`);
  };

  const startMission = () => {
    if (
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0
    ) {
      showToast("请等待当前一致性存档完成后再签发新任务。", {
        persistent: true,
      });
      return;
    }
    if (origin === destination) {
      showToast("出发地与目的地不能相同。");
      return;
    }
    if (!directive.trim()) {
      showToast("最高指令不能为空。");
      return;
    }
    if (!workerRef.current) {
      showToast("物理引擎尚未完成装载，请稍后重试。");
      return;
    }
    const command: SimulationWorkerCommand = {
      type: "initialize",
      requestId: nextRequestId("mission"),
      mission: {
        origin: originSystem.name,
        destination: destinationSystem.name,
        directive: directive.trim(),
        seed: `${origin}:${destination}:${directive.trim()}`,
        totalDistanceLightYears: missionDistanceLightYears,
        totalLegs: estimatedRouteLegs,
        timeScale,
      },
    };
    cancelCaptainDecision();
    cancelKeyPassengerCall();
    keyPassengerScheduler.current =
      new KeyPassengerPollScheduler();
    setKeyPassengerPrivateNotes([]);
    latestCaptainDeviceReceipts.current = [];
    latestMissionEnded.current = false;
    updateNextCaptainRoutineDeadline(null);
    updateCaptainJournalSnapshot(createCaptainJournalSnapshot());
    updateCaptainWatchSnapshot(createCaptainWatchSnapshot());
    updateDepartmentStandingSnapshot(createDepartmentStandingSnapshot());
    updatePassengerSocietySnapshot(createPassengerSocietySnapshot());
    worldEpoch.current += 1;
    latestStateRevision.current = null;
    commandRevision.current = 0;
    knownMaintenanceCompletionIds.current.clear();
    knownProceduralEventIds.current.clear();
    knownAlertIds.current.clear();
    setActiveAlerts([]);
    setCaptainDecisionLog([]);
    workerRef.current.postMessage(command);
    captainInvocationKeys.current.clear();
    finalReportRequested.current = false;
    setLlmCallPhase(llmStatus?.ready ? "idle" : "error");
    setMissionEnded(false);
    setFinalReport(null);
    setEndReportDismissed(false);
    setMissionStarted(true);
    setPaused(!llmStatus?.ready);
    audio.playConfirm();
    audio.startAmbient();
    addEvent(
      `最高指令已签发：${originSystem.name} → ${destinationSystem.name}`,
      "nominal",
      "任务控制",
    );
  };

  const saveGame = () => {
    if (
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0
    ) {
      showToast("一致性存档已在进行，请等待完成。", { persistent: true });
      return;
    }
    cancelKeyPassengerCall();
    setLlmCallPhase(llmStatus?.ready ? "idle" : "error");
    const saveMetadata: Omit<LocalSave, "runtimeSnapshot"> = {
      version: 22,
      activeView,
      missionStarted,
      paused,
      timeScale,
      simulationSeconds,
      nextCaptainRoutineAtSimulationSeconds:
        nextCaptainRoutineAtSimulationSeconds.current,
      origin,
      destination,
      directive,
      events,
      keyPassengerLlm:
        keyPassengerScheduler.current.snapshot(),
      captainJournal: captainJournalSnapshot,
      captainWatch: captainWatchSnapshot,
      departmentStanding: departmentStandingSnapshot,
      passengerSociety: passengerSocietySnapshot,
    };
    if (!missionStarted) {
      const save: LocalSave = {
        ...saveMetadata,
        runtimeSnapshot: null,
      };
      void persistManualSave(save, {
        successToast: "任务配置已保存到本机。",
      });
      return;
    }
    if (!engineState || !workerRef.current) {
      showToast("物理引擎仍在建立一致性状态，请稍后存档。");
      return;
    }
    const queue = activeCaptainWorldCommandQueue.current;
    if (queue) {
      queue.resumeAfterCompletion = false;
      const active = activeCaptainDecision.current;
      active?.controller.abort();
      activeCaptainDecision.current = null;
      captainCallInFlight.current = false;
    } else {
      cancelCaptainDecision();
    }
    pendingSaveBarrier.current = { metadata: saveMetadata };
    setPaused(true);
    sendTimeControl({ acquirePauseTokens: ["save-barrier"] });
    requestSaveSnapshotWhenQuiescent();
    showToast(
      activePhysicsRequestId.current !== null ||
        activeCaptainWorldCommandQueue.current !== null
        ? "正在等待在途物理事务完成后建立存档屏障……"
        : "正在封装物理、乘员、随机数与事件队列……",
    );
  };

  const requestLoadGame = () => {
    if (
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0
    ) {
      showToast("请等待当前一致性存档完成后再加载。", { persistent: true });
      return;
    }
    void (async () => {
      const save = await getManualSave();
      if (!save) {
        showToast("尚未找到本地存档。", { persistent: true });
        return;
      }
      setLoadConfirmOpen(true);
    })();
  };

  const confirmLoadGame = () => {
    setLoadConfirmOpen(false);
    if (
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0
    ) {
      showToast("请等待当前一致性存档完成后再加载。", { persistent: true });
      return;
    }
    void (async () => {
      const loaded = await getManualSave();
      if (!loaded) {
        showToast("尚未找到本地存档。", { persistent: true });
        return;
      }
      try {
        const save = loaded as Omit<
          LocalSave,
          | "version"
          | "nextCaptainRoutineAtSimulationSeconds"
          | "captainJournal"
          | "captainWatch"
          | "departmentStanding"
          | "passengerSociety"
        > & {
          version: number;
          nextCaptainRoutineAtSimulationSeconds?: number | null;
          captainJournal?: unknown;
          captainWatch?: unknown;
          departmentStanding?: unknown;
          passengerSociety?: unknown;
          agentObservation?: unknown;
        };
        const knownViews = new Set<ViewId>(
          NAV_ITEMS.map((item) => item.id),
        );
        const knownSystems = new Set<string>(
          STAR_SYSTEMS.map((system) => system.id),
        );
        if (save.version === 18) {
          showToast(
            "此外层存档格式为 LocalSave v18，已不再支持；请重新签发任务后再存档。",
            { persistent: true },
          );
          return;
        }
        if (
          ![19, 20, 21, 22].includes(save.version) ||
          !knownViews.has(save.activeView) ||
          !knownSystems.has(save.origin) ||
          !knownSystems.has(save.destination) ||
          typeof save.directive !== "string" ||
          !Array.isArray(save.events) ||
          !Number.isFinite(save.simulationSeconds) ||
          !Number.isFinite(save.timeScale) ||
          ("nextCaptainRoutineAtSimulationSeconds" in save &&
            save.nextCaptainRoutineAtSimulationSeconds !== null &&
            !Number.isFinite(
              save.nextCaptainRoutineAtSimulationSeconds,
            )) ||
          (save.missionStarted && !save.runtimeSnapshot)
        ) {
          throw new Error("unsupported save schema");
        }
        const compatibleSave: LocalSave = {
          ...save,
          version: 22,
          nextCaptainRoutineAtSimulationSeconds:
            "nextCaptainRoutineAtSimulationSeconds" in save &&
            typeof save.nextCaptainRoutineAtSimulationSeconds === "number"
              ? Math.max(
                  save.simulationSeconds,
                  save.nextCaptainRoutineAtSimulationSeconds,
                )
              : save.missionStarted
                ? save.simulationSeconds + captainRoutineSeconds.current
                : null,
          captainJournal:
            validateCaptainJournalSnapshot(save.captainJournal) ??
            createCaptainJournalSnapshot(),
          captainWatch:
            validateCaptainWatchSnapshot(save.captainWatch) ??
            createCaptainWatchSnapshot(),
          departmentStanding:
            validateDepartmentStandingSnapshot(save.departmentStanding) ??
            createDepartmentStandingSnapshot(),
          passengerSociety:
            validatePassengerSocietySnapshot(save.passengerSociety) ??
            createPassengerSocietySnapshot(),
        };
        const restoredKeyPassengerScheduler =
          KeyPassengerPollScheduler.restore(compatibleSave.keyPassengerLlm);
        cancelCaptainDecision();
        cancelKeyPassengerCall();
        latestCaptainDeviceReceipts.current = [];
        latestMissionEnded.current = false;
        updateNextCaptainRoutineDeadline(
          compatibleSave.nextCaptainRoutineAtSimulationSeconds,
        );
        updateCaptainJournalSnapshot(compatibleSave.captainJournal);
        updateCaptainWatchSnapshot(compatibleSave.captainWatch);
        updateDepartmentStandingSnapshot(compatibleSave.departmentStanding);
        updatePassengerSocietySnapshot(compatibleSave.passengerSociety);
        setLlmCallPhase(llmStatus?.ready ? "idle" : "error");
        worldEpoch.current += 1;
        latestStateRevision.current = null;
        if (compatibleSave.runtimeSnapshot) {
          if (!workerRef.current) {
            throw new Error("simulation worker is unavailable");
          }
          const requestId = nextRequestId("restore");
          pendingLoad.current = {
            requestId,
            save: compatibleSave,
            keyPassengerScheduler:
              restoredKeyPassengerScheduler,
          };
          setPaused(true);
          sendTimeControl({ acquirePauseTokens: ["save-barrier"] });
          const command: SimulationWorkerCommand = {
            type: "restore",
            requestId,
            snapshot: compatibleSave.runtimeSnapshot,
          };
          workerRef.current.postMessage(command);
          showToast("正在原子校验并恢复完整运行时……");
          return;
        } else {
          knownMaintenanceCompletionIds.current.clear();
          knownProceduralEventIds.current.clear();
          knownAlertIds.current.clear();
          setActiveAlerts([]);
          setCaptainDecisionLog([]);
          keyPassengerScheduler.current =
            restoredKeyPassengerScheduler;
          setKeyPassengerPrivateNotes(
            restoredKeyPassengerScheduler.listPrivateNotes(),
          );
          setActiveView(compatibleSave.activeView);
          setMissionStarted(false);
          setPaused(true);
          setTimeScale(compatibleSave.timeScale);
          setSimulationSeconds(compatibleSave.simulationSeconds);
          setOrigin(compatibleSave.origin);
          setDestination(compatibleSave.destination);
          setDirective(compatibleSave.directive);
          setEvents(compatibleSave.events);
          eventId.current = compatibleSave.events.reduce(
            (maximum, entry) => Math.max(maximum, entry.id),
            0,
          );
          setEngineState(null);
          setCompartmentState(null);
          setCoolingState(null);
          setElectricalState(null);
          setNavigationState(null);
          setRotationState(null);
          setWaterRecoveryState(null);
          setMaintenanceState(null);
          setHullConsequenceState(null);
          setCommandBusState(null);
          setTimeControl(null);
          setSurvival(null);
          setZoneMood([]);
          setPassengerCircles([]);
          setPassengerHighlights([]);
          commandRevision.current = 0;
          setMissionEnded(false);
          setFinalReport(null);
          setEndReportDismissed(false);
          finalReportRequested.current = false;
        }
        showToast("任务配置已恢复。");
      } catch {
        showToast("存档格式损坏或版本过旧，未执行加载。", { persistent: true });
      }
    })();
  };

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
    cancelCaptainDecision();
    cancelKeyPassengerCall();
    keyPassengerScheduler.current.resetObservations();
    latestCaptainDeviceReceipts.current = [];
    updateCaptainJournalSnapshot(createCaptainJournalSnapshot());
    updateCaptainWatchSnapshot(createCaptainWatchSnapshot());
    updateDepartmentStandingSnapshot(createDepartmentStandingSnapshot());
    updatePassengerSocietySnapshot(createPassengerSocietySnapshot());
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
    const common = {
      actor: options?.actor ?? "player:god-mode",
      metadata: {
        mode: "causal-event",
        eventType,
        sourceKnownToAi: false,
      },
    } satisfies Pick<
      ExternalInterventionRequest,
      "actor" | "metadata"
    >;

    let request: ExternalInterventionRequest;
    switch (eventType) {
      case "micrometeoroid":
        request = {
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
        break;
      case "coolant-pump-seizure":
        request = {
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
        break;
      case "fusion-reactor-trip":
        request = {
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
        break;
      case "ring-bearing-degradation":
        request = {
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
        break;
      case "air-handler-trip":
        request = {
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
        break;
      case "water-processor-trip":
        request = {
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
        break;
      case "water-spur-fault":
      case "water-spur-fault-a-closed":
        request = {
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
        break;
      case "water-spur-fault-b-degraded":
        request = {
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
        break;
      case "cooling-spur-fault":
      case "cooling-spur-fault-a-closed":
        request = {
          ...common,
          reason: "A环居住热送达支路卡死关闭，舱热泵冷却无法送达该环区带",
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
        break;
      case "cooling-spur-fault-b-degraded":
        request = {
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
        break;
      case "stellar-flare":
        request = {
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
        break;
      case "passenger-emergency":
        request = {
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
        break;
      default:
        showToast(`不支持的因果事件类型：${eventType}`, {
          persistent: true,
        });
        return Promise.reject(
          new Error(`unsupported causal event type: ${eventType}`),
        );
    }
    return submitIntervention(request, `已触发因果事件：${label}`);
  };

  useEffect(() => {
    injectCausalEventRef.current = injectCausalEvent;
  });

  const forceOverride = (
    field: (typeof FORCE_FIELDS)[number],
    value: number,
  ): Promise<void> => {
    if (!engineState) {
      const message = "尚无可覆写的物理快照。";
      showToast(message);
      return Promise.reject(new Error(message));
    }

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
          massKg *
          1_005 *
          engineState.thermal.habitatTemperatureK;
        break;
      case "potable-water":
        massKg = value - engineState.water.potableKg;
        break;
    }

    return submitIntervention(
      {
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
      },
      `原力覆写：${field.label} ← ${value} ${field.unit}`,
    );
  };

  const simStatus = missionEnded
    ? { tone: "paused" as const, text: "航程已结束 · 控制台只读", detail: "等待人类接管" }
    : llmCallPhase === "waiting"
      ? {
          tone: "waiting" as const,
          text: "模拟暂停 · AI 正在研判",
          detail: decisionTheaterHeadline(decisionTheater),
        }
      : missionStarted && !llmStatus?.ready
        ? {
            tone: "blocked" as const,
            text: "物理可继续 · 关键 AI 决策等待本机 LLM 密钥",
            detail: "缺少本机密钥",
          }
        : paused && missionStarted
          ? { tone: "paused" as const, text: "模拟已暂停 · Space 继续", detail: "按 Space 继续" }
          : missionStarted
            ? { tone: "live" as const, text: "模拟推进中", detail: "舰长拥有全舰指挥权" }
            : { tone: "paused" as const, text: "等待签发最高指令", detail: "执行权限已冻结" };

  // 次级状态条：未启动 / 正常推进 / AI 研判时与顶栏·时间控制重复，仅保留异常提示
  const showSecondarySimStatus =
    missionStarted &&
    simStatus.tone !== "live" &&
    llmCallPhase !== "waiting";

  const journeyProgressLabel =
    missionStarted && engineState
      ? `${((engineState.journey.completedDistanceLightYears / Math.max(engineState.journey.totalDistanceLightYears, 0.01)) * 100).toFixed(1)}% · ${engineState.journey.jumpsCompleted}/${engineState.journey.totalLegs} 跃迁`
      : null;

  const timeControlsDisabled = missionEnded;

  return (
    <main className={`game-shell${activeAlerts.some((a) => !a.acknowledged && a.level === "critical") ? " alert-active" : ""}`}>
      <div className="noise-layer" />
      <AlertBanner
        alerts={activeAlerts}
        onAcknowledge={(id) =>
          setActiveAlerts((prev) =>
            prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)),
          )
        }
        onLocate={(alert) => {
          setActiveView("ship");
          setShipFocus((prev) => ({
            zoneId: alert.zoneId ?? null,
            ringId: alert.ringId ?? null,
            token: prev.token + 1,
          }));
        }}
      />
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">Y</span>
          <div>
            <strong>远穹</strong>
            <span className="brand-en">FAR HORIZON</span>
            <small>CIVILIAN ARK Y-01</small>
          </div>
        </div>
        <MissionClock
          simulationSeconds={simulationSeconds}
          timeScale={timeScale}
          effectiveTimeScale={
            timeControl?.effectiveTimeScale ??
            compartmentState?.effectiveTimeScale
          }
          paused={Boolean(timeControl?.paused || paused || missionEnded)}
          maxLiveSimulationSeconds={nextCaptainRoutineDeadline}
          progressLabel={journeyProgressLabel}
        />
        <TimeControlBar
          timeScale={timeScale}
          paused={paused}
          effectiveTimeScale={
            timeControl?.effectiveTimeScale ??
            compartmentState?.effectiveTimeScale
          }
          fidelityLocked={
            Boolean(timeControl?.fidelityLocked) ||
            Boolean(compartmentState?.fidelityLimited)
          }
          pauseTokens={
            timeControl?.pauseTokens ??
            (missionEnded ? ["mission-ended"] : undefined)
          }
          onSetTimeScale={(scale) => {
            setTimeScale(scale);
            audio.playClick();
          }}
          onTogglePause={() => {
            setPaused((value) => !value);
            audio.playClick();
          }}
          disabled={timeControlsDisabled}
          pauseDisabled={!missionStarted || missionEnded}
        />
        <ConsoleStatusStrip
          tone={simStatus.tone}
          title={
            missionEnded
              ? "目标安全区已确认"
              : llmCallPhase === "waiting"
                ? "AI 研判中 · 仿真已暂停"
                : missionStarted && !llmStatus?.ready
                  ? "缺少 LLM 密钥"
                  : missionStarted
                    ? paused
                      ? "模拟已暂停"
                      : "最高指令生效"
                    : "任务尚未签发"
          }
          detail={!missionStarted ? undefined : simStatus.detail}
        />
        <div className="save-actions">
          <button type="button" onClick={saveGame}>
            存档
          </button>
          <button type="button" onClick={requestLoadGame}>
            读取
          </button>
          <button
            type="button"
            className={`audio-mute-btn${audio.enabled ? "" : " is-muted"}`}
            onClick={() => {
              if (audio.enabled) {
                audio.playClick();
                audio.setEnabled(false);
              } else {
                audio.setEnabled(true);
                audio.playClick();
              }
            }}
            title="静音开关"
          >
            {audio.enabled ? "声" : "静音"}
          </button>
          {lastSaveTime && (
            <span className="last-save-time" title="上次存档时间">
              {lastSaveTime}
            </span>
          )}
        </div>
      </header>

      {decisionTheater.active ? (
        <DecisionTheater
          key={decisionTheater.cycleToken ?? "active"}
          state={decisionTheater}
          compact
        />
      ) : null}

      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar-index">Y-01</div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <button
              className={activeView === item.id ? "active" : ""}
              aria-current={
                activeView === item.id ? "page" : undefined
              }
              aria-disabled={!missionStarted}
              disabled={!missionStarted}
              key={item.id}
              onClick={() => setActiveView(item.id)}
              type="button"
              data-testid={`nav-${item.id}`}
            >
              <span>{item.mark}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>船体时钟</span>
          <strong>UTC+00</strong>
          <small>SIM CORE / DETERMINISTIC</small>
        </div>
      </aside>

      <section className="workspace">
        <div className="workspace-header">
          <div>
            <span className="section-code">
              {NAV_ITEMS.find((item) => item.id === activeView)?.mark}
            </span>
            <div>
              <span className="eyebrow">MISSION CONTROL</span>
              <h1>{NAV_ITEMS.find((item) => item.id === activeView)?.label}</h1>
            </div>
          </div>
          <div className="workspace-tools">
            <span className="hotkey-hint">1–7 倍率 · Space 暂停</span>
            {showSecondarySimStatus ? (
              <span
                className={`console-inline-status tone-${simStatus.tone} is-compact`}
              >
                {simStatus.text}
              </span>
            ) : null}
          </div>
        </div>

        {showSecondarySimStatus ? (
          <div
            className="sim-status-strip is-compact"
            data-tone={simStatus.tone}
            role="status"
          >
            {simStatus.text}
          </div>
        ) : null}

        <div className="view-stage">
          {activeView === "voyage" && (
            <VoyageView
              origin={origin}
              destination={destination}
              missionStarted={missionStarted}
              directive={directive}
              state={engineState}
              cooling={coolingState}
              electrical={electricalState}
              compartments={compartmentState}
              navigation={navigationState}
              rotation={rotationState?.observed ?? null}
              survival={survival}
            />
          )}
          {activeView === "ship" && (
            <ShipView
              state={engineState}
              compartments={compartmentState}
              cooling={coolingState}
              electrical={electricalState}
              rotation={rotationState?.observed ?? null}
              waterRecovery={waterRecoveryState}
              maintenance={maintenanceState}
              hullConsequence={hullConsequenceState}
              focusZoneId={shipFocus.zoneId}
              focusRingId={shipFocus.ringId}
              focusToken={shipFocus.token}
            />
          )}
          {activeView === "people" && (
            <PeopleView
              state={engineState}
              highlights={passengerHighlights}
              privateNotes={keyPassengerPrivateNotes}
              compartments={compartmentState}
              passengerSociety={passengerSocietySnapshot}
              simulationSeconds={simulationSeconds}
            />
          )}
          {activeView === "ai" && (
            <AiView
              status={llmStatus}
              callPhase={llmCallPhase}
              commandBus={commandBusState}
              decisionLog={captainDecisionLog}
              decisionTheater={decisionTheater}
              captainJournal={captainJournalSnapshot}
              departmentStanding={departmentStandingSnapshot}
              captainWatch={captainWatchSnapshot}
            />
          )}
          {activeView === "god" && (
            <GodView
              state={engineState}
              compartments={compartmentState}
              cooling={coolingState}
              electrical={electricalState}
              navigation={navigationState}
              rotation={rotationState}
              waterRecovery={waterRecoveryState}
              maintenance={maintenanceState}
              simulationSeconds={simulationSeconds}
              missionReady={missionStarted}
              onCausalEvent={injectCausalEvent}
              onOverride={forceOverride}
              onGodAssistSessionChange={handleGodAssistSessionChange}
            />
          )}
        </div>
      </section>

      <EventRail
        events={events}
        open={eventRailOpen}
        filter={eventFilter}
        onOpenChange={setEventRailOpen}
        onFilterChange={setEventFilter}
        missionStarted={missionStarted}
        llmCallPhase={llmCallPhase}
        decisionCount={captainDecisionLog.length}
        doneDecisionCount={
          captainDecisionLog.filter((d) => d.status === "done").length
        }
      />

      <footer className="bottom-bar">
        <div>
          <span className="bottom-status" />
          <strong>SHIP CORE</strong>
          <span>因果闭合</span>
        </div>
        <div>
          <strong>CAPTAIN MESH</strong>
          <span>
            {llmStatus?.ready
              ? missionStarted
                ? "40 节点 / 在岗"
                : "40 节点 / 预检通过"
              : "需要本机配置"}
          </span>
        </div>
        <div>
          <strong>SOULS ABOARD</strong>
          <span>2,120 / 持续存在</span>
        </div>
        <div className="bottom-warning">
          世界外干预已隔离 · 舰长不可知
        </div>
      </footer>

      {!missionStarted && (
        <div
          className="launch-layer mission-launch-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="launch-dialog-title"
        >
          <div className="launch-card mission-launch-card">
            <aside className="launch-briefing" aria-label="远穹号任务说明">
              <div className="launch-briefing-brand">
                <span className="launch-briefing-code">CIVILIAN ARK / Y-01</span>
                <strong>远穹计划</strong>
                <small>FAR HORIZON</small>
              </div>
              <div className="launch-briefing-statement">
                <span>你不亲自驾驶这艘船。</span>
                <h2>你决定它为何出发。</h2>
                <p>
                  签发任务后，固定编制的 AI 舰长体系接管全舰。你将站在舰桥之外，观察每一次判断如何穿过权限、设备与物理世界。
                </p>
              </div>
              <div className="launch-briefing-specs">
                <div>
                  <span>权威物理域</span>
                  <strong>09</strong>
                </div>
                <div>
                  <span>固定智能节点</span>
                  <strong>40</strong>
                </div>
                <div>
                  <span>持续个体</span>
                  <strong>2,120</strong>
                </div>
              </div>
              <div className="launch-briefing-footer">
                <span>COMMAND DECK / AUTHORITY 00</span>
                <i aria-hidden="true" />
                <span>HUMAN ORIGIN</span>
              </div>
            </aside>

            <div className="launch-console">
              <div className="launch-card-heading">
                <span className="launch-number">00</span>
                <div>
                  <span className="eyebrow">MISSION AUTHORITY / 人类签发</span>
                  <h2 id="launch-dialog-title">建立最高指令</h2>
                  <p>这是航程开始后唯一不可忽略的人类任务契约。</p>
                </div>
              </div>
              <div className="route-form">
                <label>
                  出发地
                  <select value={origin} onChange={(event) => setOrigin(event.target.value)}>
                    {STAR_SYSTEMS.map((system) => (
                      <option value={system.id} key={system.id}>
                        {system.name} · {system.port}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="route-arrow">→</span>
                <label>
                  目的地
                  <select
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                  >
                    {STAR_SYSTEMS.map((system) => (
                      <option value={system.id} key={system.id}>
                        {system.name} · {system.port}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="launch-route-meta">
                航路 {missionDistanceLightYears.toFixed(2)} ly · 单段跃迁上限{" "}
                {MAX_JUMP_LEG_LY} ly · 至少 {estimatedRouteLegs} 段
              </p>
              <label className="directive-field">
                最高指令
                <textarea
                  value={directive}
                  onChange={(event) => setDirective(event.target.value)}
                  rows={4}
                />
              </label>
              <div className="launch-summary">
                <div>
                  <span>载员</span>
                  <strong>2,120</strong>
                </div>
                <div>
                  <span>航路节点</span>
                  <strong>
                    {String(estimatedRouteLegs + 1).padStart(2, "0")}
                  </strong>
                </div>
                <div>
                  <span>压力分区</span>
                  <strong>48</strong>
                </div>
                <div>
                  <span>舰长权限</span>
                  <strong>最高</strong>
                </div>
              </div>
              <div
                className={`llm-preflight ${llmStatus?.ready ? "ready" : "warning"}`}
              >
                <span>CAPTAIN MESH</span>
                <strong>
                  {llmStatus?.ready
                    ? "8 个固定部门端点已就绪"
                    : "关键 AI 尚未接通；物理引擎可启动，但航程将暂停等待"}
                </strong>
                {!llmStatus?.ready && (
                  <div className="llm-guidance">
                    配置云端密钥后重启开发服务。DeepSeek 快捷启动：
                    <code>npm run dev:deepseek</code>
                    ；或复制 <code>.env.example</code> 为 <code>.env.local</code>{" "}
                    填写 <code>SHIP_*_LLM_API_KEY</code>。详见 README「配置云端 LLM」。
                  </div>
                )}
              </div>
              {hasLocalSave && (
                <button
                  className="launch-load-button"
                  onClick={requestLoadGame}
                  type="button"
                >
                  读取本机存档
                </button>
              )}
              <button
                className="launch-button"
                onClick={startMission}
                type="button"
                data-testid="launch-mission"
              >
                <span>签发并移交全舰指挥权</span>
                <strong>EXECUTE DIRECTIVE</strong>
              </button>
            </div>
          </div>
        </div>
      )}

      {loadConfirmOpen && (
        <div
          className="launch-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="load-confirm-title"
        >
          <div className="launch-card">
            <div className="launch-card-heading">
              <span className="launch-number">↺</span>
              <div>
                <span className="eyebrow">LOCAL SAVE / 本地存档</span>
                <h2 id="load-confirm-title">读取本地存档</h2>
                <p>
                  将覆盖当前会话中的航程进度、事件与 AI 状态。此操作不可撤销。
                </p>
              </div>
            </div>
            <div className="end-actions">
              <button type="button" onClick={() => setLoadConfirmOpen(false)}>
                取消
              </button>
              <button type="button" onClick={confirmLoadGame}>
                确认读取
              </button>
            </div>
          </div>
        </div>
      )}

      {missionEnded && !endReportDismissed && (
        <div
          className="end-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-report-title"
        >
          <section className="end-report" aria-label="航程结束报告">
            <div className="end-report-heading">
              <span className="end-seal">ARRIVAL</span>
              <div>
                <span className="eyebrow">
                  MISSION COMPLETE / 人类接管边界
                </span>
                <h2 id="end-report-title">目标安全区已确认</h2>
                <p>
                  最后一段跃迁完成，远穹号具备移交后续驾驶的基本条件。
                  按最高指令，本次游戏航程在此结束。
                </p>
              </div>
            </div>

            <div className="end-metrics">
              <div>
                <span>实际航程</span>
                <strong>{formatDuration(simulationSeconds)}</strong>
              </div>
              <div>
                <span>完成跃迁</span>
                <strong>
                  {finalReport?.jumpsCompleted ??
                    engineState?.journey.jumpsCompleted ??
                    0}
                </strong>
              </div>
              <div>
                <span>幸存乘员</span>
                <strong>
                  {(finalReport?.survivors ?? 2_120).toLocaleString(
                    "zh-CN",
                  )}
                </strong>
              </div>
              <div>
                <span>个人评价</span>
                <strong>
                  {(finalReport?.evaluationCount ?? 2_120).toLocaleString(
                    "zh-CN",
                  )}
                </strong>
              </div>
            </div>

            <div className="end-evaluations">
              <div className="end-section-title">
                <span className="eyebrow">
                  SUBJECTIVE EXPERIENCE / 无统一评分
                </span>
                <h3>代表性乘坐体验</h3>
              </div>
              {finalReport ? (
                <div className="evaluation-list">
                  {finalReport.representativeEvaluations.map(
                    (evaluation) => (
                      <article key={evaluation.passengerId}>
                        <div>
                          <strong>{evaluation.passengerName}</strong>
                          <span>{evaluation.passengerId}</span>
                        </div>
                        <p>{evaluation.text}</p>
                      </article>
                    ),
                  )}
                </div>
              ) : (
                <div className="report-loading">
                  正在从 2,120 份独立经历生成主观叙述……
                </div>
              )}
            </div>

            <div className="end-actions">
              <button type="button" onClick={saveGame}>
                保存最终航程
              </button>
              <button
                type="button"
                onClick={() => setEndReportDismissed(true)}
              >
                返回只读控制台
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div
          className={`toast${toast.persistent ? " is-persistent" : ""}`}
          role="status"
        >
          {toast.message}
          <button
            type="button"
            className="toast-dismiss"
            aria-label="关闭提示"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}
