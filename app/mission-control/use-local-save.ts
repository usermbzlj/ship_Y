"use client";

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ShipState } from "@/lib/sim";
import { normalizeLoadedLocalSave } from "@/lib/persist/local-save-normalize";
import {
  getLatestAutoSave,
  getManualSave,
  hasManualSave,
  isQuotaExceededError,
  migrateLocalStorageSaveOnce,
  putManualSave,
  putManualSaveToLocalStorageFallback,
  putRotatedAutoSave,
} from "@/lib/persist/local-save-idb";
import {
  KeyPassengerPollScheduler,
  type KeyPassengerPrivateNote,
} from "@/lib/llm/key-passenger-polling";
import type { CaptainJournalSnapshot } from "@/lib/llm/captain-journal";
import type { CaptainWatchSnapshot } from "@/lib/llm/captain-watch";
import type { DepartmentStandingSnapshot } from "@/lib/llm/department-standing";
import type { DepartmentInboxSnapshot } from "@/lib/llm/department-inbox";
import type { PassengerSocietySnapshot } from "@/lib/llm/passenger-society";
import type {
  CaptainDeviceReceiptSummary,
  CaptainDecisionEntry,
  LlmCallPhase,
  LocalSave,
  TimelineEvent,
  ViewId,
} from "@/app/ui/types";
import type { LoadConfirmSource } from "@/app/ui/components/load-confirm-dialog";
import type {
  CommandBusTelemetry,
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  FinalJourneyReport,
  HullConsequenceTelemetry,
  MaintenanceTelemetry,
  NavigationTelemetry,
  PassengerCircleTelemetry,
  PassengerHighlightTelemetry,
  RotationTelemetry,
  SimulationWorkerCommand,
  SimulationWorkerSurvivalTelemetry,
  SimulationWorkerTimeControlTelemetry,
  WaterRecoveryTelemetry,
  ZoneMoodTelemetry,
} from "@/lib/sim/protocol";
import type { ActiveAlert } from "@/app/ui/components/alert-banner";
import type { CaptainWorldCommandQueue } from "@/app/mission-control/captain-world-command-queue";
import type { CaptainDecisionCycle } from "@/app/mission-control/captain-decision-coordinator";
import { useAutosave } from "@/app/mission-control/use-autosave";
import { formatDuration } from "@/app/ui/utils";
import { createLogger } from "@/lib/observability/logger";

const missionLog = createLogger("mission-control");

export type LocalSaveToast = (
  message: string,
  options?: { persistent?: boolean },
) => void;

export type PendingSaveEntry = {
  metadata: Omit<LocalSave, "runtimeSnapshot">;
  target: "manual" | "auto";
  quiet?: boolean;
};

export type PendingLoadEntry = {
  requestId: string;
  save: LocalSave;
  keyPassengerScheduler: KeyPassengerPollScheduler;
};

export type UseLocalSaveDeps = {
  showToast: LocalSaveToast;
  // World snapshot fields for metadata
  activeView: ViewId;
  missionStarted: boolean;
  missionEnded: boolean;
  paused: boolean;
  timeScale: number;
  simulationSeconds: number;
  origin: string;
  destination: string;
  directive: string;
  events: TimelineEvent[];
  llmCallPhase: LlmCallPhase;
  llmStatusReady: boolean | undefined;
  engineState: ShipState | null;
  captainJournalSnapshot: CaptainJournalSnapshot;
  captainWatchSnapshot: CaptainWatchSnapshot;
  departmentStandingSnapshot: DepartmentStandingSnapshot;
  passengerSocietySnapshot: PassengerSocietySnapshot;
  departmentInboxSnapshot: DepartmentInboxSnapshot;
  // Refs
  nextCaptainRoutineAtSimulationSeconds: MutableRefObject<number | null>;
  captainRoutineSeconds: MutableRefObject<number>;
  keyPassengerScheduler: MutableRefObject<KeyPassengerPollScheduler>;
  captainJournalSnapshotRef: MutableRefObject<CaptainJournalSnapshot>;
  captainWatchSnapshotRef: MutableRefObject<CaptainWatchSnapshot>;
  departmentStandingSnapshotRef: MutableRefObject<DepartmentStandingSnapshot>;
  departmentInboxSnapshotRef: MutableRefObject<DepartmentInboxSnapshot>;
  pendingSaveBarrier: MutableRefObject<PendingSaveEntry | null>;
  pendingSaves: MutableRefObject<Map<string, PendingSaveEntry>>;
  pendingLoad: MutableRefObject<PendingLoadEntry | null>;
  workerRef: MutableRefObject<Worker | null>;
  activePhysicsRequestId: MutableRefObject<string | null>;
  activeCaptainWorldCommandQueue: MutableRefObject<CaptainWorldCommandQueue | null>;
  activeCaptainDecision: MutableRefObject<CaptainDecisionCycle | null>;
  captainCallInFlight: MutableRefObject<boolean>;
  latestCaptainDeviceReceipts: MutableRefObject<CaptainDeviceReceiptSummary[]>;
  latestMissionEnded: MutableRefObject<boolean>;
  worldEpoch: MutableRefObject<number>;
  latestStateRevision: MutableRefObject<number | null>;
  knownMaintenanceCompletionIds: MutableRefObject<Set<string>>;
  knownProceduralEventIds: MutableRefObject<Set<string>>;
  knownAlertIds: MutableRefObject<Set<string>>;
  eventId: MutableRefObject<number>;
  commandRevision: MutableRefObject<number>;
  finalReportRequested: MutableRefObject<boolean>;
  timeControl: SimulationWorkerTimeControlTelemetry | null;
  // Actions
  cancelCaptainDecision: () => void;
  cancelKeyPassengerCall: () => void;
  requestSaveSnapshotWhenQuiescent: () => void;
  sendTimeControl: (options: {
    timeScale?: number;
    acquirePauseTokens?: string[];
    releasePauseTokens?: string[];
  }) => boolean;
  nextRequestId: (prefix: string) => string;
  updateNextCaptainRoutineDeadline: (value: number | null) => void;
  updateCaptainJournalSnapshot: (value: CaptainJournalSnapshot) => void;
  updateCaptainWatchSnapshot: (value: CaptainWatchSnapshot) => void;
  updateDepartmentStandingSnapshot: (
    value: DepartmentStandingSnapshot,
  ) => void;
  updatePassengerSocietySnapshot: (value: PassengerSocietySnapshot) => void;
  updateDepartmentInboxSnapshot: (value: DepartmentInboxSnapshot) => void;
  // Setters for load restore
  setLlmCallPhase: Dispatch<SetStateAction<LlmCallPhase>>;
  setLoadConfirmOpen: Dispatch<SetStateAction<boolean>>;
  setActiveAlerts: Dispatch<SetStateAction<ActiveAlert[]>>;
  setCaptainDecisionLog: Dispatch<SetStateAction<CaptainDecisionEntry[]>>;
  setKeyPassengerPrivateNotes: Dispatch<
    SetStateAction<KeyPassengerPrivateNote[]>
  >;
  setActiveView: Dispatch<SetStateAction<ViewId>>;
  setMissionStarted: Dispatch<SetStateAction<boolean>>;
  setPaused: Dispatch<SetStateAction<boolean>>;
  setTimeScale: Dispatch<SetStateAction<number>>;
  setSimulationSeconds: Dispatch<SetStateAction<number>>;
  setOrigin: Dispatch<SetStateAction<string>>;
  setDestination: Dispatch<SetStateAction<string>>;
  setDirective: Dispatch<SetStateAction<string>>;
  setEvents: Dispatch<SetStateAction<TimelineEvent[]>>;
  setEngineState: Dispatch<SetStateAction<ShipState | null>>;
  setCompartmentState: Dispatch<SetStateAction<CompartmentTelemetry | null>>;
  setCoolingState: Dispatch<SetStateAction<CoolingTelemetry | null>>;
  setElectricalState: Dispatch<SetStateAction<ElectricalTelemetry | null>>;
  setNavigationState: Dispatch<SetStateAction<NavigationTelemetry | null>>;
  setRotationState: Dispatch<SetStateAction<RotationTelemetry | null>>;
  setWaterRecoveryState: Dispatch<
    SetStateAction<WaterRecoveryTelemetry | null>
  >;
  setMaintenanceState: Dispatch<SetStateAction<MaintenanceTelemetry | null>>;
  setHullConsequenceState: Dispatch<
    SetStateAction<HullConsequenceTelemetry | null>
  >;
  setCommandBusState: Dispatch<SetStateAction<CommandBusTelemetry | null>>;
  setTimeControl: Dispatch<
    SetStateAction<SimulationWorkerTimeControlTelemetry | null>
  >;
  setSurvival: Dispatch<
    SetStateAction<SimulationWorkerSurvivalTelemetry | null>
  >;
  setZoneMood: Dispatch<SetStateAction<ZoneMoodTelemetry[]>>;
  setPassengerCircles: Dispatch<SetStateAction<PassengerCircleTelemetry[]>>;
  setPassengerHighlights: Dispatch<
    SetStateAction<PassengerHighlightTelemetry[]>
  >;
  setMissionEnded: Dispatch<SetStateAction<boolean>>;
  setFinalReport: Dispatch<SetStateAction<FinalJourneyReport | null>>;
  setEndReportDismissed: Dispatch<SetStateAction<boolean>>;
};

/**
 * Local save presence, persist backends, consistency save/load, and autosave
 * wiring. Behavior-preserving extraction from mission-control.
 */
export function useLocalSave(deps: UseLocalSaveDeps) {
  const {
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
    llmStatusReady,
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
  } = deps;

  const [hasLocalSave, setHasLocalSave] = useState(false);
  const [hasAutosave, setHasAutosave] = useState(false);
  const [latestAutosaveLabel, setLatestAutosaveLabel] = useState<
    string | null
  >(null);
  const [lastSaveTime, setLastSaveTime] = useState<string | null>(null);

  const refreshSavePresence = useCallback(async () => {
    const [manualPresent, latestAuto] = await Promise.all([
      hasManualSave(),
      getLatestAutoSave(),
    ]);
    setHasLocalSave(manualPresent);
    if (latestAuto) {
      setHasAutosave(true);
      setLatestAutosaveLabel(
        `${latestAuto.slotId} · ${formatDuration(latestAuto.save.simulationSeconds ?? 0)}`,
      );
    } else {
      setHasAutosave(false);
      setLatestAutosaveLabel(null);
    }
  }, []);

  const markSaveWritten = useCallback(
    (kind: "manual" | "auto" = "manual") => {
      setLastSaveTime(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      if (kind === "manual") {
        setHasLocalSave(true);
      } else {
        setHasAutosave(true);
      }
      void refreshSavePresence();
    },
    [refreshSavePresence],
  );

  const persistManualSave = useCallback(
    async (
      save: LocalSave,
      options?: { successToast?: string },
    ): Promise<boolean> => {
      try {
        await putManualSave(save);
        markSaveWritten("manual");
        if (options?.successToast) {
          showToast(options.successToast);
        }
        return true;
      } catch (error) {
        missionLog.warn("save.indexeddb.failed", { error });
        try {
          await putManualSaveToLocalStorageFallback(save);
          markSaveWritten("manual");
          showToast("IndexedDB 不可用，已回退 localStorage");
          return true;
        } catch (fallbackError) {
          missionLog.error("save.all-backends.failed", {
            indexedDbError: error,
            localStorageError: fallbackError,
          });
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

  const persistAutoSave = useCallback(
    async (save: LocalSave): Promise<boolean> => {
      try {
        const slot = await putRotatedAutoSave(save);
        markSaveWritten("auto");
        missionLog.info("save.autosave.written", { slot });
        return true;
      } catch (error) {
        missionLog.warn("save.autosave.failed", { error });
        return false;
      }
    },
    [markSaveWritten],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await migrateLocalStorageSaveOnce();
        if (!cancelled) {
          await refreshSavePresence();
        }
      } catch {
        if (!cancelled) {
          setHasLocalSave(false);
          setHasAutosave(false);
          setLatestAutosaveLabel(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSavePresence]);

  const buildSaveMetadata = useCallback((): Omit<
    LocalSave,
    "runtimeSnapshot"
  > => {
    return {
      version: 24,
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
      keyPassengerLlm: keyPassengerScheduler.current.snapshot(),
      captainJournal: captainJournalSnapshotRef.current,
      captainWatch: captainWatchSnapshotRef.current,
      departmentStanding: departmentStandingSnapshotRef.current,
      passengerSociety: passengerSocietySnapshot,
      departmentInbox: departmentInboxSnapshot,
    };
  }, [
    activeView,
    missionStarted,
    paused,
    timeScale,
    simulationSeconds,
    origin,
    destination,
    directive,
    events,
    captainJournalSnapshot,
    captainWatchSnapshot,
    departmentStandingSnapshot,
    passengerSocietySnapshot,
    departmentInboxSnapshot,
    nextCaptainRoutineAtSimulationSeconds,
    keyPassengerScheduler,
    captainJournalSnapshotRef,
    captainWatchSnapshotRef,
    departmentStandingSnapshotRef,
  ]);

  const beginConsistencySave = useCallback(
    (options: {
      target: "manual" | "auto";
      quiet?: boolean;
      busyToast?: string;
    }) => {
      if (
        pendingSaveBarrier.current !== null ||
        pendingSaves.current.size > 0
      ) {
        if (!options.quiet) {
          showToast("一致性存档已在进行，请等待完成。", {
            persistent: true,
          });
        }
        return false;
      }
      cancelKeyPassengerCall();
      if (options.target === "manual") {
        setLlmCallPhase(llmStatusReady ? "idle" : "error");
      }
      const saveMetadata = buildSaveMetadata();
      if (!missionStarted) {
        if (options.target !== "manual") {
          return false;
        }
        const save: LocalSave = {
          ...saveMetadata,
          runtimeSnapshot: null,
        };
        void persistManualSave(save, {
          successToast: "任务配置已保存到本机。",
        });
        return true;
      }
      if (!engineState || !workerRef.current) {
        if (!options.quiet) {
          showToast("物理引擎仍在建立一致性状态，请稍后存档。");
        }
        return false;
      }
      const queue = activeCaptainWorldCommandQueue.current;
      if (queue) {
        queue.resumeAfterCompletion = false;
        const active = activeCaptainDecision.current;
        active?.controller.abort();
        activeCaptainDecision.current = null;
        captainCallInFlight.current = false;
      } else if (options.target === "manual") {
        cancelCaptainDecision();
      }
      pendingSaveBarrier.current = {
        metadata: saveMetadata,
        target: options.target,
        quiet: options.quiet,
      };
      setPaused(true);
      sendTimeControl({ acquirePauseTokens: ["save-barrier"] });
      requestSaveSnapshotWhenQuiescent();
      if (!options.quiet) {
        showToast(
          options.busyToast ??
            (activePhysicsRequestId.current !== null ||
            activeCaptainWorldCommandQueue.current !== null
              ? "正在等待在途物理事务完成后建立存档屏障……"
              : "正在封装物理、乘员、随机数与事件队列……"),
        );
      }
      return true;
    },
    [
      activeCaptainDecision,
      activeCaptainWorldCommandQueue,
      activePhysicsRequestId,
      buildSaveMetadata,
      cancelCaptainDecision,
      cancelKeyPassengerCall,
      captainCallInFlight,
      engineState,
      llmStatusReady,
      missionStarted,
      pendingSaveBarrier,
      pendingSaves,
      persistManualSave,
      requestSaveSnapshotWhenQuiescent,
      sendTimeControl,
      setLlmCallPhase,
      setPaused,
      showToast,
      workerRef,
    ],
  );

  const saveGame = () => {
    beginConsistencySave({ target: "manual" });
  };

  const requestAutosave = useCallback(() => {
    beginConsistencySave({ target: "auto", quiet: true });
  }, [beginConsistencySave]);

  const isAutosaveBlocked = useCallback(() => {
    return (
      Boolean(timeControl?.pauseTokens.includes("llm-waiting")) ||
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0 ||
      llmCallPhase === "waiting" ||
      captainCallInFlight.current
    );
  }, [captainCallInFlight, llmCallPhase, pendingSaveBarrier, pendingSaves, timeControl?.pauseTokens]);

  useAutosave({
    missionStarted,
    missionEnded,
    engineReady: engineState != null,
    simulationSeconds,
    isBlocked: isAutosaveBlocked,
    onRequestAutosave: requestAutosave,
    worldGeneration: worldEpoch.current,
  });

  const requestLoadGame = () => {
    if (
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0
    ) {
      showToast("请等待当前一致性存档完成后再加载。", { persistent: true });
      return;
    }
    void (async () => {
      await refreshSavePresence();
      const [manual, latestAuto] = await Promise.all([
        getManualSave(),
        getLatestAutoSave(),
      ]);
      if (!manual && !latestAuto) {
        showToast("尚未找到本地存档。", { persistent: true });
        return;
      }
      setLoadConfirmOpen(true);
    })();
  };

  const applyLoadedSave = useCallback(
    async (loaded: LocalSave) => {
      try {
        const normalized = await normalizeLoadedLocalSave(loaded, {
          captainRoutineSeconds: captainRoutineSeconds.current,
        });
        if (!normalized.ok) {
          if (normalized.code === "v18-unsupported") {
            showToast(
              "此外层存档格式为 LocalSave v18，已不再支持；请重新签发任务后再存档。",
              { persistent: true },
            );
            return;
          }
          if (normalized.code === "checksum-mismatch") {
            showToast(
              "存档校验和失败（数据可能已损坏），已拒绝加载。",
              { persistent: true },
            );
            return;
          }
          showToast("存档格式损坏或版本过旧，未执行加载。", {
            persistent: true,
          });
          return;
        }
        const compatibleSave = normalized.save as LocalSave;
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
        updateDepartmentInboxSnapshot(compatibleSave.departmentInbox);
        setLlmCallPhase(llmStatusReady ? "idle" : "error");
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
            keyPassengerScheduler: restoredKeyPassengerScheduler,
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
        }
        knownMaintenanceCompletionIds.current.clear();
        knownProceduralEventIds.current.clear();
        knownAlertIds.current.clear();
        setActiveAlerts([]);
        setCaptainDecisionLog([]);
        keyPassengerScheduler.current = restoredKeyPassengerScheduler;
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
        showToast("任务配置已从本机恢复。");
      } catch (error) {
        missionLog.error("save.load.failed", { error });
        showToast("读取存档失败。", { persistent: true });
      }
    },
    [
      cancelCaptainDecision,
      cancelKeyPassengerCall,
      captainRoutineSeconds,
      commandRevision,
      eventId,
      finalReportRequested,
      keyPassengerScheduler,
      knownAlertIds,
      knownMaintenanceCompletionIds,
      knownProceduralEventIds,
      latestCaptainDeviceReceipts,
      latestMissionEnded,
      latestStateRevision,
      llmStatusReady,
      nextRequestId,
      pendingLoad,
      sendTimeControl,
      setActiveAlerts,
      setActiveView,
      setCaptainDecisionLog,
      setCommandBusState,
      setCompartmentState,
      setCoolingState,
      setDestination,
      setDirective,
      setElectricalState,
      setEndReportDismissed,
      setEngineState,
      setEvents,
      setFinalReport,
      setHullConsequenceState,
      setKeyPassengerPrivateNotes,
      setLlmCallPhase,
      setMaintenanceState,
      setMissionEnded,
      setMissionStarted,
      setNavigationState,
      setOrigin,
      setPassengerCircles,
      setPassengerHighlights,
      setPaused,
      setRotationState,
      setSimulationSeconds,
      setSurvival,
      setTimeControl,
      setTimeScale,
      setWaterRecoveryState,
      setZoneMood,
      showToast,
      updateCaptainJournalSnapshot,
      updateCaptainWatchSnapshot,
      updateDepartmentStandingSnapshot,
      updateNextCaptainRoutineDeadline,
      updatePassengerSocietySnapshot,
      updateDepartmentInboxSnapshot,
      workerRef,
      worldEpoch,
    ],
  );

  const confirmLoadGame = (source: LoadConfirmSource = "manual") => {
    setLoadConfirmOpen(false);
    if (
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0
    ) {
      showToast("请等待当前一致性存档完成后再加载。", { persistent: true });
      return;
    }
    void (async () => {
      const loaded =
        source === "auto"
          ? ((await getLatestAutoSave())?.save ?? null)
          : await getManualSave();
      if (!loaded) {
        showToast(
          source === "auto"
            ? "尚未找到自动存档。"
            : "尚未找到本地存档。",
          { persistent: true },
        );
        return;
      }
      await applyLoadedSave(loaded as LocalSave);
    })();
  };

  return {
    hasLocalSave,
    hasAutosave,
    latestAutosaveLabel,
    lastSaveTime,
    refreshSavePresence,
    persistManualSave,
    persistAutoSave,
    saveGame,
    requestLoadGame,
    confirmLoadGame,
    beginConsistencySave,
  };
}
