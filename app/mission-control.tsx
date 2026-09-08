"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ShipState } from "@/lib/sim";
import {
  listActionableUnattendedMaintenanceFaults,
  isCaptainWorldCommandSoftRejectMessage,
} from "@/lib/sim/maintenance";
import {
  type CaptainOperationsSnapshot,
} from "@/lib/sim/captain-operations";
import {
  AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS,
  AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS,
  buildFullAuthorizedObservation,
  type AuthorizedControllerRecord,
  type AuthorizedManifestRecord,
} from "@/lib/sim/captain-authorized-observation";
import {
  applyCaptainWatchTriggerFallback,
  resolveCaptainDecisionTrigger,
} from "@/lib/llm/captain-decision-trigger";
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
import { useLocalSave } from "@/app/mission-control/use-local-save";
import { useLlmEffectBridge } from "@/app/mission-control/use-llm-effect-bridge";
import {
  STAR_SYSTEMS,
  NAV_ITEMS,
  AUTHORIZED_RECORD_HISTORY_LIMIT,
} from "@/app/ui/constants";
import {
  estimateMinLegs,
  routeDistanceLy,
} from "@/lib/astro/star-catalog";
import {
  formatDuration,
  prependTimelineEvent,
} from "@/app/ui/utils";
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
import { MissionLaunchCard } from "@/app/ui/components/mission-launch-card";
import { LoadConfirmDialog } from "@/app/ui/components/load-confirm-dialog";
import { MissionEndReport } from "@/app/ui/components/mission-end-report";
import { useAudio } from "@/app/ui/use-audio";
import { useGodInterventions } from "@/app/mission-control/use-god-interventions";
import {
  useKeyPassengerPoll,
  type KeyPassengerCallCycle,
} from "@/app/mission-control/use-key-passenger-poll";
import {
  applyCaptainWorldCommandHardReject,
  applyCaptainWorldCommandSoftReject,
  canDispatchNextCaptainWorldCommand,
  CAPTAIN_WORLD_COMMAND_HARD_STOP_HINT,
  dispatchNextCaptainWorldCommandItem,
  isCaptainWorldCommandQueueExhausted,
  markCaptainWorldCommandDispatchUnavailable,
  recordAcceptedCaptainWorldCommand,
  skipRemainingCaptainWorldCommands,
  type CaptainWorldCommandQueue,
} from "@/app/mission-control/captain-world-command-queue";
import {
  runCaptainDecisionCycle,
  type CaptainDecisionCycle,
  type CaptainDecisionCoordinatorContext,
} from "@/app/mission-control/captain-decision-coordinator";
import { TIME_SCALE_PRESETS } from "@/lib/sim/director";
import {
  IDLE_DECISION_THEATER_STATE,
  decisionTheaterHeadline,
  reduceDecisionTheater,
  type DecisionTheaterEvent,
  type DecisionTheaterState,
} from "@/lib/llm/decision-theater";
import {
  createCaptainJournalSnapshot,
  type CaptainJournalSnapshot,
} from "@/lib/llm/captain-journal";
import {
  createCaptainWatchSnapshot,
  evaluateCaptainWatches,
  type CaptainWatchSnapshot,
} from "@/lib/llm/captain-watch";
import {
  autoResolveOpenDepartmentDissents,
  buildDissentWorldEvidence,
  createDepartmentStandingSnapshot,
  resolveDepartmentDissent,
  type DepartmentStandingSnapshot,
  type DissentResolution,
} from "@/lib/llm/department-standing";
import {
  createPassengerSocietySnapshot,
  type PassengerSocietySnapshot,
} from "@/lib/llm/passenger-society";
import {
  createDepartmentInboxSnapshot,
  type DepartmentInboxSnapshot,
} from "@/lib/llm/department-inbox";
import { extractCaptainWatchMetricSample } from "@/lib/llm/captain-watch-metrics";
import {
  captainDecisionAdvancesRoutineSchedule,
  completedCaptainDecisionCoversDeadline,
  computeNextCaptainRoutineDeadline,
  isCaptainRoutineDue,
} from "@/lib/sim/captain-schedule";
import { createLogger } from "@/lib/observability/logger";
import { observedFetch } from "@/lib/observability/observed-fetch";

const missionLog = createLogger("mission-control");

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
  // hasLocalSave / persist* / saveGame / load — see useLocalSave below
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
      {
        metadata: Omit<LocalSave, "runtimeSnapshot">;
        target: "manual" | "auto";
        quiet?: boolean;
      }
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
    target: "manual" | "auto";
    quiet?: boolean;
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
  /** 最近一次步进/决策窗口的异议裁决用指标（不含本轮回执）。 */
  const latestDissentMetricRef = useRef<{
    hullIntegrity: number | null;
    activeBreachCount: number | null;
    lowestZonePressureKpa: number | null;
    batteryStateOfChargeFraction: number | null;
  }>({
    hullIntegrity: null,
    activeBreachCount: null,
    lowestZonePressureKpa: null,
    batteryStateOfChargeFraction: null,
  });
  const resolveDepartmentDissentManually = useCallback(
    (recordId: string, resolution: DissentResolution) => {
      if (resolution === "open") {
        return;
      }
      updateDepartmentStandingSnapshot(
        resolveDepartmentDissent(
          departmentStandingSnapshotRef.current,
          recordId,
          resolution,
        ),
      );
    },
    [updateDepartmentStandingSnapshot],
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
  const departmentInboxSnapshotRef = useRef<DepartmentInboxSnapshot>(
    createDepartmentInboxSnapshot(),
  );
  const [departmentInboxSnapshot, setDepartmentInboxSnapshot] =
    useState<DepartmentInboxSnapshot>(() => createDepartmentInboxSnapshot());
  const updateDepartmentInboxSnapshot = useCallback(
    (value: DepartmentInboxSnapshot) => {
      departmentInboxSnapshotRef.current = value;
      setDepartmentInboxSnapshot(value);
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
  const missionStartRequestedRef = useRef(false);
  const audioRef = useRef(audio);
  audioRef.current = audio;
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
  const {
    pendingWorkerLlmEffect,
    postLlmEffectAccept,
    postLlmEffectFail,
    postLlmEffectFinish,
    handleLlmEffectWorkerEvent,
    syncPendingFromOrchestration,
  } = useLlmEffectBridge({
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
  });

  const releaseCaptainDecisionPause = useCallback(
    (phase: Exclude<LlmCallPhase, "waiting"> = "idle") => {
      // When Worker owns a pending LLM effect, do not ask it to release
      // llm-waiting here — finish/fail commands own that transition.
      if (pendingWorkerLlmEffect.current === null) {
        sendTimeControl({ releasePauseTokens: ["llm-waiting"] });
      }
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
      // 世界命令收尾：用最新观测 + 本轮回执自动裁决未决异议，再推 Worker sidecar。
      updateDepartmentStandingSnapshot(
        autoResolveOpenDepartmentDissents(
          departmentStandingSnapshotRef.current,
          buildDissentWorldEvidence({
            ...latestDissentMetricRef.current,
            receipts: queue.receipts,
          }),
        ),
      );
      let nextDeadline: number | null = null;
      if (queue.advancesRoutineSchedule) {
        nextDeadline = computeNextCaptainRoutineDeadline(
          latestSimulationSeconds.current,
          captainRoutineSeconds.current,
        );
        updateNextCaptainRoutineDeadline(nextDeadline);
      }
      emitDecisionTheater({
        type: "world_resumed",
        cycleToken: queue.cycleToken,
      });
      const workerEffect = pendingWorkerLlmEffect.current;
      if (workerEffect) {
        postLlmEffectFinish({
          callId: workerEffect.callId,
          advancesRoutineSchedule: queue.advancesRoutineSchedule,
          nextCaptainRoutineAtSimulationSeconds:
            queue.advancesRoutineSchedule ? nextDeadline : undefined,
        });
      }
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
      postLlmEffectFinish,
      releaseCaptainDecisionPause,
      updateDepartmentStandingSnapshot,
      updateNextCaptainRoutineDeadline,
    ],
  );
  const dispatchNextCaptainWorldCommand = useCallback(() => {
    const queue = activeCaptainWorldCommandQueue.current;
    if (
      !canDispatchNextCaptainWorldCommand(queue, {
        worldEpoch: worldEpoch.current,
        activePhysicsRequestId: activePhysicsRequestId.current,
      })
    ) {
      return;
    }
    if (isCaptainWorldCommandQueueExhausted(queue)) {
      finishCaptainWorldCommandQueue(queue);
      return;
    }

    const worker = workerRef.current;
    const expectedStateRevision = latestStateRevision.current;
    const item = queue.commands[queue.nextIndex];
    if (!worker || expectedStateRevision === null) {
      const { failed, skipped } =
        markCaptainWorldCommandDispatchUnavailable(queue);
      appendCaptainCommandEvent(
        latestSimulationSeconds.current,
        `${failed.toolName} 未派发：物理引擎或状态修订尚不可用。`,
        "critical",
      );
      for (const skippedItem of skipped) {
        appendCaptainCommandEvent(
          latestSimulationSeconds.current,
          `${skippedItem.toolName} 未执行：前序命令未能派发，确定性队列已停止。`,
          "watch",
        );
      }
      finishCaptainWorldCommandQueue(queue);
      setPaused(true);
      showToast("舰长命令队列停止：物理引擎状态不可用。");
      return;
    }

    emitDecisionTheater({
      type: "command_dispatched",
      cycleToken: queue.cycleToken,
      ordinal: item.ordinal,
      toolName: item.toolName,
      total: queue.commands.length,
    });
    dispatchNextCaptainWorldCommandItem(queue, item, {
      allocateRequestId: () => {
        requestSequence.current += 1;
        return `captain-queue-${requestSequence.current}`;
      },
      expectedRevision: commandRevision.current,
      expectedStateRevision,
      issuedAtMicroseconds: Math.round(
        latestSimulationSeconds.current * 1_000_000,
      ),
      postShipCommand: (command) => {
        worker.postMessage(command);
      },
      setActivePhysicsRequestId: (requestId) => {
        activePhysicsRequestId.current = requestId;
      },
    });
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
    // If the Worker still owns a pending LLM effect, releasing only the local
    // pause leaves llm-waiting acquired in the Worker (it ignores UI releases
    // while pending is set), which silently freezes the sim while the UI shows
    // idle. Fail the pending effect so the Worker clears pending and releases
    // llm-waiting; postLlmEffectFail also clears the local pending mirror.
    const workerEffect = pendingWorkerLlmEffect.current;
    if (workerEffect) {
      postLlmEffectFail({
        callId: workerEffect.callId,
        observationRevision: workerEffect.observationRevision,
        reason: "captain decision cancelled",
        retryable: true,
      });
    }
    // 取消必须立刻清场，不能留下悬挂的演出阶段。
    emitDecisionTheater({ type: "abort", cycleToken: theaterToken });
    releaseCaptainDecisionPause();
  }, [
    clearCaptainWorldCommandQueue,
    emitDecisionTheater,
    postLlmEffectFail,
    pendingWorkerLlmEffect,
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
    if (!barrier.quiet) {
      showToast("物理事务已静止，正在封装一致性快照……");
    }
  }, [showToast]);

  const nextRequestId = (prefix: string) => {
    requestSequence.current += 1;
    return `${prefix}-${requestSequence.current}`;
  };

  const {
    hasLocalSave,
    hasAutosave,
    latestAutosaveLabel,
    lastSaveTime,
    persistManualSave,
    persistAutoSave,
    saveGame,
    requestLoadGame,
    confirmLoadGame,
  } = useLocalSave({
    showToast,
    activeView,
    missionStarted,
    missionEnded,
    paused,
    timeScale,
    simulationSeconds,
    origin,
    destination,
    directive,
    events,
    llmCallPhase,
    llmStatusReady: llmStatus?.ready,
    engineState,
    captainJournalSnapshot,
    captainWatchSnapshot,
    departmentStandingSnapshot,
    passengerSocietySnapshot,
    departmentInboxSnapshot,
    nextCaptainRoutineAtSimulationSeconds,
    captainRoutineSeconds,
    keyPassengerScheduler,
    captainJournalSnapshotRef,
    captainWatchSnapshotRef,
    departmentStandingSnapshotRef,
    departmentInboxSnapshotRef,
    pendingSaveBarrier,
    pendingSaves,
    pendingLoad,
    workerRef,
    activePhysicsRequestId,
    activeCaptainWorldCommandQueue,
    activeCaptainDecision,
    captainCallInFlight,
    latestCaptainDeviceReceipts,
    latestMissionEnded,
    worldEpoch,
    latestStateRevision,
    knownMaintenanceCompletionIds,
    knownProceduralEventIds,
    knownAlertIds,
    eventId,
    commandRevision,
    finalReportRequested,
    timeControl,
    missionStartRequestedRef,
    cancelCaptainDecision,
    cancelKeyPassengerCall,
    requestSaveSnapshotWhenQuiescent,
    sendTimeControl,
    nextRequestId,
    updateNextCaptainRoutineDeadline,
    updateCaptainJournalSnapshot,
    updateCaptainWatchSnapshot,
    updateDepartmentStandingSnapshot,
    updatePassengerSocietySnapshot,
    updateDepartmentInboxSnapshot,
    setLlmCallPhase,
    setLoadConfirmOpen,
    setActiveAlerts,
    setCaptainDecisionLog,
    setKeyPassengerPrivateNotes,
    setActiveView,
    setMissionStarted,
    setPaused,
    setTimeScale,
    setSimulationSeconds,
    setOrigin,
    setDestination,
    setDirective,
    setEvents,
    setEngineState,
    setCompartmentState,
    setCoolingState,
    setElectricalState,
    setNavigationState,
    setRotationState,
    setWaterRecoveryState,
    setMaintenanceState,
    setHullConsequenceState,
    setCommandBusState,
    setTimeControl,
    setSurvival,
    setZoneMood,
    setPassengerCircles,
    setPassengerHighlights,
    setMissionEnded,
    setFinalReport,
    setEndReportDismissed,
  });

  useEffect(() => {
    const worker = new Worker(
      new URL("../lib/sim/worker.ts", import.meta.url),
      {
        type: "module",
        name: "far-horizon-simulation",
      },
    );
    workerRef.current = worker;
    missionLog.info("simulation.worker.started", {
      name: "far-horizon-simulation",
    });

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
        missionLog.error("simulation.command.failed", {
          requestId: event.requestId,
          message: event.message,
        });
        const queue = activeCaptainWorldCommandQueue.current;
        if (queue?.activeRequestId === event.requestId) {
          const failed = queue.commands[queue.nextIndex];
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
            const softFailed = applyCaptainWorldCommandSoftReject(
              queue,
              event.message,
            );
            appendCaptainCommandEvent(
              latestSimulationSeconds.current,
              `${softFailed.toolName} 被设备执行层拒绝：${event.message}（本条拒绝后队列继续）`,
              "watch",
            );
            showToast(`舰长命令被拒绝，队列继续：${event.message}`);
            dispatchNextCaptainWorldCommand();
            requestSaveSnapshotWhenQuiescent();
            return;
          }
          const hardStopHint = CAPTAIN_WORLD_COMMAND_HARD_STOP_HINT;
          const { failed: hardFailed, skipped } =
            applyCaptainWorldCommandHardReject(
              queue,
              event.message,
              hardStopHint,
            );
          appendCaptainCommandEvent(
            latestSimulationSeconds.current,
            `${hardFailed.toolName} 被设备执行层拒绝：${event.message}。${hardStopHint}`,
            "critical",
          );
          for (const skippedItem of skipped) {
            appendCaptainCommandEvent(
              latestSimulationSeconds.current,
              `${skippedItem.toolName} 未执行：前序命令硬失败，确定性队列已停止。`,
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
          if (failedSave.quiet || failedSave.target === "auto") {
            missionLog.warn("save.autosave.snapshot-failed", {
              message: event.message,
            });
          } else {
            showToast(`一致性存档失败：${event.message}`, {
              persistent: true,
            });
          }
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
      if (
        event.type === "llm-effect-request" ||
        event.type === "llm-effect-aborted"
      ) {
        handleLlmEffectWorkerEvent(event);
        return;
      }
      if (event.type === "snapshot") {
        const pendingSave = pendingSaves.current.get(
          event.requestId,
        );
        if (!pendingSave) {
          pendingSaves.current.delete(event.requestId);
          return;
        }
        const save: LocalSave = {
          ...pendingSave.metadata,
          simulationSeconds:
            event.payload.snapshot.engine.clock.elapsedMicroseconds /
            1_000_000,
          // React 拥有航行志/观察哨/部门立场/乘客社会；存档时盖写 Worker sidecar，避免手工裁决丢失。
          runtimeSnapshot: {
            ...event.payload.snapshot,
            captainJournal: pendingSave.metadata.captainJournal,
            captainWatch: pendingSave.metadata.captainWatch,
            departmentStanding: pendingSave.metadata.departmentStanding,
            passengerSociety: pendingSave.metadata.passengerSociety,
          },
        };
        void (async () => {
          try {
            if (pendingSave.target === "auto") {
              await persistAutoSave(save);
            } else {
              await persistManualSave(save, {
                successToast: "完整本地存档已写入。",
              });
            }
          } finally {
            // Only now, after the write is durable, drop the pending entry and
            // release the save-barrier. Autosave, manual save, and load all gate
            // on pendingSaves.size / the barrier, so holding both until here
            // prevents a concurrent op from racing (or hybridizing) the write.
            pendingSaves.current.delete(event.requestId);
            sendTimeControl({ releasePauseTokens: ["save-barrier"] });
            if (
              !pendingSave.metadata.paused &&
              !latestMissionEnded.current
            ) {
              setPaused(false);
            }
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
        
        // A02修复:只在Worker成功确认后才提交AI状态
        // 此前use-local-save已经停在准备阶段,未修改活动世界
        latestCaptainDeviceReceipts.current = [];
        latestMissionEnded.current = false;
        updateNextCaptainRoutineDeadline(
          save.nextCaptainRoutineAtSimulationSeconds,
        );
        updateCaptainJournalSnapshot(save.captainJournal);
        updateCaptainWatchSnapshot(save.captainWatch);
        updateDepartmentStandingSnapshot(save.departmentStanding);
        updatePassengerSocietySnapshot(save.passengerSociety);
        updateDepartmentInboxSnapshot(save.departmentInbox);
        setLlmCallPhase(llmStatus?.ready ? "idle" : "error");
        worldEpoch.current += 1;
        latestStateRevision.current = null;
        
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

      {
        const hull = event.payload.hullConsequence;
        const electrical = event.payload.electrical;
        const compartments = event.payload.compartments;
        latestDissentMetricRef.current = {
          hullIntegrity: hull?.hullIntegrity ?? null,
          activeBreachCount: hull?.activeBreachCount ?? null,
          lowestZonePressureKpa:
            typeof compartments?.observedPressureMinPa === "number" &&
            Number.isFinite(compartments.observedPressureMinPa)
              ? compartments.observedPressureMinPa / 1_000
              : null,
          batteryStateOfChargeFraction:
            electrical?.observed.averageBatteryStateOfChargeFraction ?? null,
        };
      }

      // ─── A01修复:告警对账 - 区分实例vs规则,支持解除和复发 ─────────────────────
      const currentConditions = detectAlerts(
        event.payload.state,
        event.payload.electrical,
        event.payload.cooling,
        event.payload.compartments,
        event.payload.elapsedSeconds,
        event.payload.rotation?.observed ?? null,
        event.payload.hullConsequence ?? null,
      );
      
      // 对账当前活动规则集
      const currentRuleIds = new Set(currentConditions.map((c) => c.ruleId));
      const openAlertsByRule = new Map<string, ActiveAlert>();
      
      // 检查现有活动告警,解除已消失的条件
      for (const alert of activeAlerts) {
        if (currentRuleIds.has(alert.ruleId)) {
          // 条件仍在,检查是否等级变化
          const condition = currentConditions.find((c) => c.ruleId === alert.ruleId);
          if (condition && condition.level !== alert.level) {
            // 等级变化,升级同一实例
            openAlertsByRule.set(alert.ruleId, {
              ...alert,
              level: condition.level,
              source: condition.source,
              message: condition.message,
            });
          } else {
            // 保持现有实例
            openAlertsByRule.set(alert.ruleId, alert);
          }
        }
        // 条件消失的不再放入openAlertsByRule,即被解除
      }
      
      // 添加新出现的条件作为新实例
      const newInstances: ActiveAlert[] = [];
      for (const condition of currentConditions) {
        if (!openAlertsByRule.has(condition.ruleId)) {
          const instanceId = `${condition.ruleId}:${event.payload.elapsedSeconds}`;
          const instance: ActiveAlert = {
            id: instanceId,
            ruleId: condition.ruleId,
            level: condition.level,
            source: condition.source,
            message: condition.message,
            simulationSeconds: event.payload.elapsedSeconds,
            acknowledged: false,
            ...(condition.zoneId ? { zoneId: condition.zoneId } : {}),
            ...(condition.ringId ? { ringId: condition.ringId } : {}),
          };
          newInstances.push(instance);
          openAlertsByRule.set(condition.ruleId, instance);
        }
      }
      
      // 更新activeAlerts为当前打开集
      const updatedAlerts = Array.from(openAlertsByRule.values());
      setActiveAlerts(updatedAlerts);
      
      // 播报新实例
      if (newInstances.length > 0) {
        const highest = newInstances.some((a) => a.level === "critical")
          ? "critical"
          : newInstances.some((a) => a.level === "warning")
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
      if (event.payload.passengerSociety) {
        updatePassengerSocietySnapshot(event.payload.passengerSociety);
      }
      if (event.payload.departmentInbox) {
        updateDepartmentInboxSnapshot(event.payload.departmentInbox);
      }
      setTimeControl(event.payload.timeControl);
      setSurvival(event.payload.survival);
      syncPendingFromOrchestration(event.payload.llmOrchestration);

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
          recordAcceptedCaptainWorldCommand(
            queue,
            event.payload.result.summary,
          );
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
            const skipped = skipRemainingCaptainWorldCommands(
              queue,
              "航程已经安全抵达，后续世界命令停止",
            );
            for (const skippedItem of skipped) {
              appendCaptainCommandEvent(
                event.payload.elapsedSeconds,
                `${skippedItem.toolName} 未执行：航程已经安全抵达。`,
                "watch",
              );
            }
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
      missionLog.error("simulation.worker.crashed", {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      });
      activePhysicsRequestId.current = null;
      const queue = activeCaptainWorldCommandQueue.current;
      const failed = queue?.commands[queue.nextIndex];
        const hardStopHint = CAPTAIN_WORLD_COMMAND_HARD_STOP_HINT;
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
      missionLog.debug("simulation.worker.stopped");
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
    handleLlmEffectWorkerEvent,
    syncPendingFromOrchestration,
    persistManualSave,
    persistAutoSave,
    requestSaveSnapshotWhenQuiescent,
    releaseCaptainDecisionPause,
    sendTimeControl,
    showToast,
    updateNextCaptainRoutineDeadline,
  ]);


  useEffect(() => {
    const controller = new AbortController();
    const refreshStatus = async () => {
      try {
        const response = await observedFetch(
          "/api/llm/status",
          {
            cache: "no-store",
            signal: controller.signal,
          },
          { operation: "llm.status.poll" },
        );
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
    } else if (pendingWorkerLlmEffect.current === null) {
      releasePauseTokens.push("llm-waiting");
    }
    if (missionEnded) {
      acquirePauseTokens.push("mission-ended");
    } else {
      // Explicitly release on restart/load paths that reuse the director
      // instead of rebuilding it, so a prior end does not leave the sim paused.
      releasePauseTokens.push("mission-ended");
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
      // A04修复:不抢占按钮/链接/已处理事件/重复按键
      if (e.defaultPrevented || e.repeat) return;
      
      const target = e.target as HTMLElement;
      
      // 排除交互控件
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.tagName === "BUTTON" ||
        target.tagName === "A" ||
        target.isContentEditable
      ) {
        return;
      }
      
      // 排除role为交互控件的元素
      const role = target.getAttribute("role");
      if (
        role === "button" ||
        role === "link" ||
        role === "checkbox" ||
        role === "radio" ||
        role === "menuitem"
      ) {
        return;
      }
      
      // 排除模态对话框打开时
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }
      
      if (e.code === "Space") {
        e.preventDefault();
        if (missionStarted && !missionEnded && llmCallPhase !== "waiting") {
          setPaused((v) => !v);
          audio.playClick();
        }
      } else if (e.key >= "1" && e.key <= "7") {
        // Match the Space gate and the disabled TimeControlBar: time-scale keys
        // do nothing before launch or after the mission has ended.
        if (!missionStarted || missionEnded) return;
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

  // Ambient drone is started on launch but was never stopped: silence it when
  // the mission ends and on unmount so the module-level oscillator does not hum
  // forever. audioRef keeps the latest (non-memoized) audio handle.
  useEffect(() => {
    if (missionEnded) {
      audioRef.current.stopAmbient();
    }
  }, [missionEnded]);
  useEffect(() => () => audioRef.current.stopAmbient(), []);

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
    let { triggerKey, triggerReason } = resolveCaptainDecisionTrigger({
      missionStartAlreadyInvoked:
        captainInvocationKeys.current.has("mission-start"),
      simulationSeconds,
      nextCaptainRoutineAtSimulationSeconds:
        nextCaptainRoutineAtSimulationSeconds.current,
      routineSeconds,
      urgentWindowSeconds,
      hullConsequence: hullConsequenceState,
      compartments: compartmentState,
      cooling: coolingState,
      controllerRecord,
      observedPowerAlarm,
      unattendedMaintenanceFaults,
      requiredChargePerJumpKWh:
        engineState.journey.requiredChargePerJumpKWh,
      totalDistanceLightYears:
        engineState.journey.totalDistanceLightYears,
      completedDistanceLightYears:
        engineState.journey.completedDistanceLightYears,
    });

    const fullAuthorizedObservation = buildFullAuthorizedObservation({
      simulationSeconds,
      engineState,
      electricalState,
      navigationState,
      rotationState,
      compartmentState,
      hullConsequenceState,
      coolingState,
      waterRecoveryState,
      maintenanceState,
      operationsState,
      survival,
      zoneMood,
      controllerRecord,
      manifestRecord,
      observedPowerAlarm,
    });
    const trueRemainingDistance = Math.max(
      0,
      engineState.journey.totalDistanceLightYears -
        engineState.journey.completedDistanceLightYears,
    );
    const hullThreatObservation =
      fullAuthorizedObservation.sensorView.hullThreat;
    const jumpThermalProjection =
      fullAuthorizedObservation.sensorView.jumpThermalProjection;

    const watchEvaluation = evaluateCaptainWatches(
      captainWatchSnapshotRef.current,
      extractCaptainWatchMetricSample(fullAuthorizedObservation),
      { simulationSeconds },
    );
    updateCaptainWatchSnapshot(watchEvaluation.snapshot);
    {
      const metricSample = extractCaptainWatchMetricSample(
        fullAuthorizedObservation,
      );
      const hullThreat = fullAuthorizedObservation.sensorView.hullThreat;
      latestDissentMetricRef.current = {
        hullIntegrity: metricSample.hullIntegrity,
        activeBreachCount:
          hullThreat.availability === "available"
            ? hullThreat.activeBreachCount
            : null,
        lowestZonePressureKpa: metricSample.lowestZonePressureKpa,
        batteryStateOfChargeFraction:
          metricSample.batteryStateOfChargeFraction,
      };
    }
    ({ triggerKey, triggerReason } = applyCaptainWatchTriggerFallback(
      { triggerKey, triggerReason },
      watchEvaluation.fired,
    ));

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
    const workerOwnedEffect = pendingWorkerLlmEffect.current;
    // Worker already holds llm-waiting when it opened the pending effect.
    if (!workerOwnedEffect) {
      sendTimeControl({ acquirePauseTokens: ["llm-waiting"] });
    }
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
    const coordinatorCtx: CaptainDecisionCoordinatorContext = {
      eventId,
      setEvents,
      setCaptainDecisionLog,
      setLlmStatus,
      emitDecisionTheater,
      appendCaptainCommandEvent,
      dispatchNextCaptainWorldCommand,
      releaseCaptainDecisionPause,
      postLlmEffectAccept,
      postLlmEffectFail,
      postLlmEffectFinish,
      updateNextCaptainRoutineDeadline,
    updateDepartmentStandingSnapshot,
    updateCaptainJournalSnapshot,
    updateCaptainWatchSnapshot,
    updateDepartmentInboxSnapshot,
    showToast,
      departmentStandingSnapshotRef,
      captainJournalSnapshotRef,
      captainWatchSnapshotRef,
      departmentInboxSnapshotRef,
      activeCaptainWorldCommandQueue,
      latestCaptainDeviceReceipts,
      captainInvocationKeys,
      captainRoutineSeconds,
      activeCaptainDecision,
      captainCallInFlight,
      latestSimulationSeconds,
      worldEpoch,
      latestStateRevision,
    };
    void runCaptainDecisionCycle(coordinatorCtx, {
      triggerKey,
      triggerReason,
      simulationSeconds,
      directive,
      missionProvenance,
      authorizedObservation,
      recentDeviceReceipts,
      captainDecisionToken,
      invocationWorldEpoch,
      observedStateRevision,
      decisionController,
      decisionLogId,
      advancesRoutineSchedule,
      routineDeadlineBeforeClear,
      workerOwnedEffect: workerOwnedEffect
        ? {
            callId: workerOwnedEffect.callId,
            observationRevision: workerOwnedEffect.observationRevision,
          }
        : null,
      engineJourneyStatus: engineState.journey.status,
      trueRemainingDistance,
      hullThreatObservation,
      jumpThermalProjection,
      llmStatus,
    });
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
    postLlmEffectAccept,
    postLlmEffectFail,
    postLlmEffectFinish,
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

  useKeyPassengerPoll({
    missionStarted,
    missionEnded,
    paused,
    engineState,
    llmStatus,
    simulationSeconds,
    originSystemName: originSystem.name,
    destinationSystemName: destinationSystem.name,
    compartmentState,
    operationsState,
    passengerCircles,
    zoneMood,
    showToast,
    updatePassengerSocietySnapshot,
    setKeyPassengerPrivateNotes,
    setEvents,
    setLlmStatus,
    latestStateRevision,
    activePhysicsRequestId,
    pendingLoad,
    pendingSaveBarrier,
    pendingSaves,
    activeCaptainWorldCommandQueue,
    captainCallInFlight,
    keyPassengerCallInFlight,
    keyPassengerScheduler,
    keyPassengerCallSequence,
    worldEpoch,
    activeKeyPassengerCall,
    passengerSocietySnapshotRef,
    latestSimulationSeconds,
    eventId,
    workerRef,
    requestSequence,
    commandRevision,
  });

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
    // A rapid double-click could post two initialize commands before the launch
    // card unmounts, spawning two worlds that fight over UI state. This latch is
    // set once we actually dispatch and never needs resetting: the launch card
    // is gone for the rest of the session after the first successful start.
    if (missionStartRequestedRef.current) return;
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
    updateDepartmentInboxSnapshot(createDepartmentInboxSnapshot());
    worldEpoch.current += 1;
    latestStateRevision.current = null;
    commandRevision.current = 0;
    knownMaintenanceCompletionIds.current.clear();
    knownProceduralEventIds.current.clear();
    knownAlertIds.current.clear();
    setActiveAlerts([]);
    setCaptainDecisionLog([]);
    missionStartRequestedRef.current = true;
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

  const { injectCausalEvent, forceOverride } = useGodInterventions({
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
  });

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

      {/* 顶栏下方的浮层堆叠：绝对定位，不参与 game-shell 网格流。 */}
      <div className="hud-dock">
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
        {decisionTheater.active ? (
          <DecisionTheater
            key={decisionTheater.cycleToken ?? "active"}
            state={decisionTheater}
            compact
          />
        ) : null}
      </div>

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
              missionStarted={missionStarted}
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
              departmentInbox={departmentInboxSnapshot}
              onResolveDepartmentDissent={resolveDepartmentDissentManually}
              captainWatch={captainWatchSnapshot}
              missionStarted={missionStarted}
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
        <MissionLaunchCard
          origin={origin}
          destination={destination}
          directive={directive}
          onOriginChange={setOrigin}
          onDestinationChange={setDestination}
          onDirectiveChange={setDirective}
          starSystems={STAR_SYSTEMS}
          missionDistanceLightYears={missionDistanceLightYears}
          estimatedRouteLegs={estimatedRouteLegs}
          llmStatus={llmStatus}
          hasManualSave={hasLocalSave}
          hasAutosave={hasAutosave}
          onStart={startMission}
          onRequestLoad={requestLoadGame}
        />
      )}

      {loadConfirmOpen && (
        <LoadConfirmDialog
          hasManual={hasLocalSave}
          hasLatestAuto={hasAutosave}
          latestAutoLabel={latestAutosaveLabel}
          onCancel={() => setLoadConfirmOpen(false)}
          onConfirm={confirmLoadGame}
        />
      )}

      {missionEnded && !endReportDismissed && (
        <MissionEndReport
          simulationSeconds={simulationSeconds}
          finalReport={finalReport}
          engineState={engineState}
          onSave={saveGame}
          onDismiss={() => setEndReportDismissed(true)}
        />
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
