"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ExternalInterventionRequest, ShipState } from "@/lib/sim";
import type { RingControlMode } from "@/lib/sim/rotation";
import type { ReactorMode } from "@/lib/sim/electrical";
import type { BatteryControlMode } from "@/lib/sim/electrical";
import type { ZoneId } from "@/lib/sim/compartments";
import type { AirHandlerId } from "@/lib/sim/compartments";
import type { CoolantPumpId } from "@/lib/sim/cooling";
import type {
  ElectricalBatteryId,
  ElectricalBreakerId,
  ElectricalLoadId,
  FusionReactorId,
} from "@/lib/sim/electrical";
import type { ThrusterId } from "@/lib/sim/navigation";
import type { RotationRingId } from "@/lib/sim/rotation";
import type { WaterProcessorId } from "@/lib/sim/water";
import type { MaintenanceAssetId } from "@/lib/sim/maintenance";
import {
  KeyPassengerPollScheduler,
  type KeyPassengerPollingSnapshot,
  type KeyPassengerPrivateNote,
} from "@/lib/llm/key-passenger-polling";
import type {
  CommandBusTelemetry,
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  FinalJourneyReport,
  MaintenanceTelemetry,
  NavigationTelemetry,
  PassengerHighlightTelemetry,
  RotationTelemetry,
  RuntimeSimulationSnapshot,
  SimulationWorkerCommand,
  SimulationWorkerEvent,
  WaterRecoveryTelemetry,
} from "@/lib/sim/protocol";

// ─── 从拆分模块导入 ───────────────────────────────────────────
import type {
  ViewId,
  SystemTone,
  LlmCallPhase,
  TimelineEvent,
  SystemCard,
  LlmRuntimeStatus,
  LlmInvokeResult,
  LlmInvokeRoutePayload,
  CaptainDeviceReceiptStatus,
  CaptainDeviceReceiptSummary,
  LocalSave,
  ForceField,
} from "@/app/ui/types";
import {
  STAR_SYSTEMS,
  NAV_ITEMS,
  THRUSTER_ID_SET,
  FUSION_REACTOR_ID_SET,
  COOLANT_PUMP_ID_SET,
  ELECTRICAL_LOAD_ID_SET,
  ELECTRICAL_BREAKER_ID_SET,
  ELECTRICAL_BATTERY_ID_SET,
  ROTATION_RING_ID_SET,
  AIR_HANDLER_ID_SET,
  WATER_PROCESSOR_ID_SET,
  MAINTENANCE_ASSET_ID_SET,
  RING_CONTROL_MODES,
  RING_CONTROL_MODE_SET,
  BATTERY_CONTROL_MODES,
  BATTERY_CONTROL_MODE_SET,
  REACTOR_MODES,
  REACTOR_MODE_SET,
  MAX_TIMELINE_EVENTS,
  INITIAL_EVENTS,
  INITIAL_SYSTEMS,
  FORCE_FIELDS,
  AI_ROSTER,
  PASSENGERS,
  MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE,
  AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS,
  AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS,
  AUTHORIZED_RECORD_HISTORY_LIMIT,
  AIR_HANDLER_IDS,
  COOLANT_PUMP_IDS,
  ELECTRICAL_BATTERY_IDS,
  ELECTRICAL_BREAKER_IDS,
  ELECTRICAL_LOAD_IDS,
  FUSION_REACTOR_IDS,
  THRUSTER_IDS,
  ROTATION_RING_IDS,
  WATER_PROCESSOR_IDS,
  MAINTENANCE_ASSET_IDS,
} from "@/app/ui/constants";
import {
  formatDuration,
  formatCadence,
  prependTimelineEvent,
  compactLlmTimelineText,
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
import { useAudio } from "@/app/ui/use-audio";
import { ProceduralEventScheduler } from "@/app/ui/procedural-events";

type ShipWorldCommand = Extract<
  SimulationWorkerCommand,
  { type: "ship-command" }
>["command"];



type AuthorizedControllerRecord = {
  worldEpoch: number;
  stateRevision: number;
  sampledAtSimulationSeconds: number;
  availableAtSimulationSeconds: number;
  remainingDistanceEstimateLightYears: number;
  jumpControllerState: ShipState["journey"]["status"];
  completedJumpLogCount: number;
  jumpDriveChargeEstimateKWh: number;
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
  resumeAfterCompletion: boolean;
};

type CaptainWorldToolParseResult =
  | { ok: true; command: ShipWorldCommand }
  | { ok: false; reason: string };

function parseCaptainWorldToolCall(
  toolCall: LlmInvokeResult["toolCalls"][number],
  journeyStatus: ShipState["journey"]["status"],
  remainingDistance: number,
): CaptainWorldToolParseResult {
  const argumentsObject =
    typeof toolCall.arguments === "object" &&
    toolCall.arguments !== null
      ? (toolCall.arguments as Record<string, unknown>)
      : {};

  if (toolCall.name === "execute_jump") {
    if (journeyStatus !== "ready") {
      return {
        ok: false,
        reason: "跃迁控制器尚未进入 ready 状态",
      };
    }
    const requested = argumentsObject.distanceLightYears;
    if (
      typeof requested !== "number" ||
      !Number.isFinite(requested) ||
      requested < 0.1 ||
      requested > 5 ||
      remainingDistance < 0.1
    ) {
      return {
        ok: false,
        reason: "distanceLightYears 必须在 0.1 至 5 光年范围内",
      };
    }
    return {
      ok: true,
      command: {
        kind: "execute-jump",
        actorAgentId: "captain",
        distanceLightYears: Math.min(requested, remainingDistance),
      },
    };
  }

  if (toolCall.name === "set_awake_target") {
    const targetAwake = argumentsObject.targetAwake;
    if (
      typeof targetAwake !== "number" ||
      !Number.isSafeInteger(targetAwake) ||
      targetAwake < 0 ||
      targetAwake > 2_120
    ) {
      return {
        ok: false,
        reason: "targetAwake 必须是 0 至 2120 的整数",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-awake-target",
        actorAgentId: "captain",
        targetAwake,
      },
    };
  }

  if (toolCall.name === "isolate_pressure_zone") {
    const zoneId = argumentsObject.zoneId;
    if (
      typeof zoneId !== "string" ||
      !/^[AB]-(0[1-9]|1[0-9]|2[0-4])$/.test(zoneId)
    ) {
      return {
        ok: false,
        reason: "zoneId 必须是 A-01 至 B-24 的固定压力区",
      };
    }
    return {
      ok: true,
      command: {
        kind: "isolate-pressure-zone",
        actorAgentId: "captain",
        zoneId: zoneId as ZoneId,
      },
    };
  }

  if (toolCall.name === "set_air_handler_control") {
    const airHandlerId = argumentsObject.airHandlerId;
    const commandedFlowFraction =
      argumentsObject.commandedFlowFraction;
    const scrubberEnabled = argumentsObject.scrubberEnabled;
    if (
      typeof airHandlerId !== "string" ||
      !AIR_HANDLER_ID_SET.has(airHandlerId) ||
      typeof commandedFlowFraction !== "number" ||
      !Number.isFinite(commandedFlowFraction) ||
      commandedFlowFraction < 0 ||
      commandedFlowFraction > 1 ||
      typeof scrubberEnabled !== "boolean"
    ) {
      return {
        ok: false,
        reason: "空气处理机 ID、循环风量或吸附器开关无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-air-handler-control",
        actorAgentId: "captain",
        airHandlerId: airHandlerId as AirHandlerId,
        commandedFlowFraction,
        scrubberEnabled,
      },
    };
  }

  if (toolCall.name === "set_water_processor_control") {
    const processorId = argumentsObject.processorId;
    const commandedThroughputFraction =
      argumentsObject.commandedThroughputFraction;
    if (
      typeof processorId !== "string" ||
      !WATER_PROCESSOR_ID_SET.has(processorId) ||
      typeof commandedThroughputFraction !== "number" ||
      !Number.isFinite(commandedThroughputFraction) ||
      commandedThroughputFraction < 0 ||
      commandedThroughputFraction > 1
    ) {
      return {
        ok: false,
        reason: "水回收机 ID 或处理量指令无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-water-processor-control",
        actorAgentId: "captain",
        processorId: processorId as WaterProcessorId,
        commandedThroughputFraction,
      },
    };
  }

  if (toolCall.name === "schedule_maintenance") {
    const assetId = argumentsObject.assetId;
    if (
      typeof assetId !== "string" ||
      !MAINTENANCE_ASSET_ID_SET.has(assetId)
    ) {
      return {
        ok: false,
        reason: "assetId 必须是固定维修资产 ID",
      };
    }
    return {
      ok: true,
      command: {
        kind: "schedule-maintenance",
        actorAgentId: "captain",
        assetId: assetId as MaintenanceAssetId,
      },
    };
  }

  if (toolCall.name === "schedule_thruster_pulse") {
    const thrusterId = argumentsObject.thrusterId;
    const throttleFraction = argumentsObject.throttleFraction;
    const durationSeconds = argumentsObject.durationSeconds;
    const startDelaySeconds = argumentsObject.startDelaySeconds;
    if (
      typeof thrusterId !== "string" ||
      !THRUSTER_ID_SET.has(thrusterId) ||
      typeof throttleFraction !== "number" ||
      !Number.isFinite(throttleFraction) ||
      throttleFraction < 0 ||
      throttleFraction > 1 ||
      typeof durationSeconds !== "number" ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > 600 ||
      typeof startDelaySeconds !== "number" ||
      !Number.isFinite(startDelaySeconds) ||
      startDelaySeconds < 0 ||
      startDelaySeconds > 3_600
    ) {
      return {
        ok: false,
        reason: "推进器、节流、持续时间或启动延迟超出控制器边界",
      };
    }
    return {
      ok: true,
      command: {
        kind: "schedule-thruster-pulse",
        actorAgentId: "captain",
        thrusterId: thrusterId as ThrusterId,
        throttleFraction,
        durationSeconds,
        startDelaySeconds,
      },
    };
  }

  if (toolCall.name === "schedule_thruster_maneuver") {
    const rawPulses = argumentsObject.pulses;
    if (
      !Array.isArray(rawPulses) ||
      rawPulses.length === 0 ||
      rawPulses.length > 18
    ) {
      return {
        ok: false,
        reason: "pulses 必须包含 1 至 18 个推进器脉冲",
      };
    }
    const pulses = rawPulses.flatMap((rawPulse) => {
      if (typeof rawPulse !== "object" || rawPulse === null) {
        return [];
      }
      const pulse = rawPulse as Record<string, unknown>;
      const thrusterId = pulse.thrusterId;
      const throttleFraction = pulse.throttleFraction;
      const durationSeconds = pulse.durationSeconds;
      const startDelaySeconds = pulse.startDelaySeconds;
      if (
        typeof thrusterId !== "string" ||
        !THRUSTER_ID_SET.has(thrusterId) ||
        typeof throttleFraction !== "number" ||
        !Number.isFinite(throttleFraction) ||
        throttleFraction < 0 ||
        throttleFraction > 1 ||
        typeof durationSeconds !== "number" ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        durationSeconds > 600 ||
        typeof startDelaySeconds !== "number" ||
        !Number.isFinite(startDelaySeconds) ||
        startDelaySeconds < 0 ||
        startDelaySeconds > 3_600
      ) {
        return [];
      }
      return [
        {
          thrusterId: thrusterId as ThrusterId,
          throttleFraction,
          durationSeconds,
          startDelaySeconds,
        },
      ];
    });
    if (pulses.length !== rawPulses.length) {
      return {
        ok: false,
        reason: "机动计划中至少一个推进器脉冲参数无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "schedule-thruster-maneuver",
        actorAgentId: "captain",
        pulses,
      },
    };
  }

  if (toolCall.name === "set_reactor_target") {
    const reactorId = argumentsObject.reactorId;
    const targetOutputKw = argumentsObject.targetOutputKw;
    if (
      typeof reactorId !== "string" ||
      !FUSION_REACTOR_ID_SET.has(reactorId) ||
      typeof targetOutputKw !== "number" ||
      !Number.isFinite(targetOutputKw) ||
      targetOutputKw < 0 ||
      targetOutputKw > 225_000
    ) {
      return {
        ok: false,
        reason: "反应堆 ID 或目标功率超出设备边界",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-reactor-target",
        actorAgentId: "captain",
        reactorId: reactorId as FusionReactorId,
        targetOutputKw,
      },
    };
  }

  if (toolCall.name === "set_reactor_mode") {
    const reactorId = argumentsObject.reactorId;
    const mode = argumentsObject.mode;
    if (
      typeof reactorId !== "string" ||
      !FUSION_REACTOR_ID_SET.has(reactorId) ||
      typeof mode !== "string" ||
      !REACTOR_MODE_SET.has(mode)
    ) {
      return {
        ok: false,
        reason: "反应堆 ID 或运行模式无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-reactor-mode",
        actorAgentId: "captain",
        reactorId: reactorId as FusionReactorId,
        mode: mode as ReactorMode,
      },
    };
  }

  if (toolCall.name === "set_cooling_pump_speed") {
    const pumpId = argumentsObject.pumpId;
    const commandedSpeedFraction =
      argumentsObject.commandedSpeedFraction;
    if (
      typeof pumpId !== "string" ||
      !COOLANT_PUMP_ID_SET.has(pumpId) ||
      typeof commandedSpeedFraction !== "number" ||
      !Number.isFinite(commandedSpeedFraction) ||
      commandedSpeedFraction < 0 ||
      commandedSpeedFraction > 1
    ) {
      return {
        ok: false,
        reason: "冷却泵 ID 或转速指令无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-cooling-pump-speed",
        actorAgentId: "captain",
        pumpId: pumpId as CoolantPumpId,
        commandedSpeedFraction,
      },
    };
  }

  if (toolCall.name === "set_electrical_load_enabled") {
    const loadId = argumentsObject.loadId;
    const enabled = argumentsObject.enabled;
    if (
      typeof loadId !== "string" ||
      !ELECTRICAL_LOAD_ID_SET.has(loadId) ||
      typeof enabled !== "boolean"
    ) {
      return {
        ok: false,
        reason: "配电负载 ID 或 enabled 参数无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-electrical-load-enabled",
        actorAgentId: "captain",
        loadId: loadId as ElectricalLoadId,
        enabled,
      },
    };
  }

  if (toolCall.name === "set_electrical_breaker") {
    const breakerId = argumentsObject.breakerId;
    const commandedClosed = argumentsObject.commandedClosed;
    if (
      typeof breakerId !== "string" ||
      !ELECTRICAL_BREAKER_ID_SET.has(breakerId) ||
      typeof commandedClosed !== "boolean"
    ) {
      return {
        ok: false,
        reason: "断路器 ID 或 commandedClosed 参数无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-electrical-breaker",
        actorAgentId: "captain",
        breakerId: breakerId as ElectricalBreakerId,
        commandedClosed,
      },
    };
  }

  if (toolCall.name === "set_battery_mode") {
    const batteryId = argumentsObject.batteryId;
    const mode = argumentsObject.mode;
    if (
      typeof batteryId !== "string" ||
      !ELECTRICAL_BATTERY_ID_SET.has(batteryId) ||
      typeof mode !== "string" ||
      !BATTERY_CONTROL_MODE_SET.has(mode)
    ) {
      return {
        ok: false,
        reason: "储能组 ID 或控制模式无效",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-battery-mode",
        actorAgentId: "captain",
        batteryId: batteryId as ElectricalBatteryId,
        mode: mode as BatteryControlMode,
      },
    };
  }

  if (toolCall.name === "set_habitat_ring_control") {
    const ringId = argumentsObject.ringId;
    const controlMode = argumentsObject.controlMode;
    const targetRelativeRpm = argumentsObject.targetRelativeRpm;
    if (
      typeof ringId !== "string" ||
      !ROTATION_RING_ID_SET.has(ringId) ||
      typeof controlMode !== "string" ||
      !RING_CONTROL_MODE_SET.has(controlMode) ||
      typeof targetRelativeRpm !== "number" ||
      !Number.isFinite(targetRelativeRpm) ||
      targetRelativeRpm < -12 ||
      targetRelativeRpm > 12
    ) {
      return {
        ok: false,
        reason: "居住环 ID、控制模式或相对转速目标超出设备边界",
      };
    }
    return {
      ok: true,
      command: {
        kind: "set-habitat-ring-control",
        actorAgentId: "captain",
        ringId: ringId as RotationRingId,
        controlMode: controlMode as RingControlMode,
        targetRelativeRpm,
      },
    };
  }

  return {
    ok: false,
    reason: "工具不在舰长世界命令白名单中",
  };
}




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
  const [commandBusState, setCommandBusState] =
    useState<CommandBusTelemetry | null>(null);
  const [passengerHighlights, setPassengerHighlights] = useState<
    PassengerHighlightTelemetry[]
  >([]);
  const [keyPassengerPrivateNotes, setKeyPassengerPrivateNotes] =
    useState<KeyPassengerPrivateNote[]>([]);
  const [llmStatus, setLlmStatus] =
    useState<LlmRuntimeStatus | null>(null);
  const [llmCallPhase, setLlmCallPhase] =
    useState<LlmCallPhase>("idle");
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
  const [events, setEvents] = useState<TimelineEvent[]>(INITIAL_EVENTS);
  const [eventFilter, setEventFilter] = useState<"all" | SystemTone>("all");
  const [toast, setToast] = useState("");
  const [lastSaveTime, setLastSaveTime] = useState<string | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<ActiveAlert[]>([]);
  const knownAlertIds = useRef(new Set<string>());
  const audio = useAudio();
  const proceduralScheduler = useRef(
    new ProceduralEventScheduler(Date.now() & 0xffffffff),
  );
  const eventId = useRef(10);
  const knownMaintenanceCompletionIds = useRef(new Set<string>());
  const workerRef = useRef<Worker | null>(null);
  const pendingSaves = useRef(
    new Map<
      string,
      { metadata: Omit<LocalSave, "runtimeSnapshot"> }
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
  const stepInFlight = useRef(false);
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
  const finishCaptainWorldCommandQueue = useCallback(
    (queue: CaptainWorldCommandQueue) => {
      if (activeCaptainWorldCommandQueue.current !== queue) {
        return;
      }
      latestCaptainDeviceReceipts.current = [...queue.receipts].sort(
        (left, right) => left.ordinal - right.ordinal,
      );
      activeCaptainWorldCommandQueue.current = null;
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
    [],
  );
  const dispatchNextCaptainWorldCommand = useCallback(() => {
    const queue = activeCaptainWorldCommandQueue.current;
    if (
      !queue ||
      queue.activeRequestId !== null ||
      queue.worldEpoch !== worldEpoch.current
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
      latestCaptainDeviceReceipts.current = [...queue.receipts].sort(
        (left, right) => left.ordinal - right.ordinal,
      );
      activeCaptainWorldCommandQueue.current = null;
      setPaused(true);
      setToast("舰长命令队列停止：物理引擎状态不可用。");
      return;
    }

    requestSequence.current += 1;
    const requestId = `captain-queue-${requestSequence.current}`;
    queue.activeRequestId = requestId;
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
    worker.postMessage(command);
  }, [
    appendCaptainCommandEvent,
    finishCaptainWorldCommandQueue,
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
    active?.controller.abort();
    if (active) {
      captainInvocationKeys.current.delete(active.triggerKey);
    }
    activeCaptainDecision.current = null;
    captainCallInFlight.current = false;
    clearCaptainWorldCommandQueue();
  }, [clearCaptainWorldCommandQueue]);
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
      stepInFlight.current ||
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
    setToast("物理事务已静止，正在封装一致性快照……");
  }, []);

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
      stepInFlight.current = false;
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
          appendCaptainCommandEvent(
            latestSimulationSeconds.current,
            `${failed.toolName} 被设备执行层拒绝：${event.message}`,
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
              summary: "前序命令失败，队列按顺序停止",
            });
            appendCaptainCommandEvent(
              latestSimulationSeconds.current,
              `${skipped.toolName} 未执行：前序命令失败，确定性队列已停止。`,
              "watch",
            );
          }
          latestCaptainDeviceReceipts.current = [
            ...queue.receipts,
          ].sort((left, right) => left.ordinal - right.ordinal);
          activeCaptainWorldCommandQueue.current = null;
          captainInvocationKeys.current.delete(queue.triggerKey);
          setPaused(true);
          setToast(`舰长命令队列停止：${event.message}`);
          requestSaveSnapshotWhenQuiescent();
          return;
        }
        const failedSave = pendingSaves.current.get(event.requestId);
        pendingSaves.current.delete(event.requestId);
        if (failedSave) {
          if (
            !failedSave.metadata.paused &&
            !latestMissionEnded.current
          ) {
            setPaused(false);
          }
          setToast(`一致性存档失败：${event.message}`);
          return;
        }
        if (pendingLoad.current?.requestId === event.requestId) {
          pendingLoad.current = null;
          setToast(
            `存档恢复被拒绝，当前世界保持不变：${event.message}`,
          );
          return;
        }
        setPaused(true);
        setToast(`物理引擎拒绝操作：${event.message}`);
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
        window.localStorage.setItem(
          "farhorizon-save",
          JSON.stringify(save),
        );
        setLastSaveTime(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
        if (
          !pendingSave.metadata.paused &&
          !latestMissionEnded.current
        ) {
          setPaused(false);
        }
        setToast("完整本地存档已写入。");
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
        const { save, keyPassengerScheduler: restoredScheduler } =
          pendingLoad.current;
        pendingLoad.current = null;
        knownMaintenanceCompletionIds.current = new Set(
          save.runtimeSnapshot?.maintenance.tasks
            .filter((task) => task.status === "completed")
            .map((task) => task.id) ?? [],
        );
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
        setToast("物理、人员与命令审计状态已原子恢复。");
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

      // ─── 警报检测 ─────────────────────────────────────────
      const newAlerts = detectAlerts(
        event.payload.state,
        event.payload.electrical,
        event.payload.cooling,
        event.payload.compartments,
        event.payload.elapsedSeconds,
        knownAlertIds.current,
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
        if (highest === "critical") audio.playAlertCritical();
        else if (highest === "warning") audio.playAlertWarning();
        else audio.playAlertWatch();
      }

      // ─── 程序化事件检测 ─────────────────────────────────────
      if (missionStarted && !latestMissionEnded.current) {
        const procEvents = proceduralScheduler.current.check(
          event.payload.elapsedSeconds,
        );
        for (const procEvent of procEvents) {
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
          if (procEvent.severity === "warning" || procEvent.severity === "critical") {
            audio.playAlertWatch();
          }
        }
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
        const timelineEventId = ++eventId.current;
        setEvents((current) =>
          prependTimelineEvent(current, {
            id: timelineEventId,
            at: formatDuration(event.payload.elapsedSeconds),
            source: "玩家 / 上帝模式",
            text: `外部干预已提交物理账本：${event.payload.record.reason}`,
            tone: "critical",
          }),
        );
        setToast(`外部注入已记账：${event.payload.record.id}`);
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
        setToast(event.payload.result.summary);
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
      requestSaveSnapshotWhenQuiescent();
    };

    worker.onerror = (event) => {
      stepInFlight.current = false;
      const queue = activeCaptainWorldCommandQueue.current;
      const failed = queue?.commands[queue.nextIndex];
      if (queue && failed) {
        const failureSummary = `仿真线程异常：${event.message}`;
        queue.receipts.push({
          ordinal: failed.ordinal,
          toolCallId: failed.toolCallId,
          toolName: failed.toolName,
          commandKind: failed.command.kind,
          status: "rejected",
          summary: failureSummary,
        });
        appendCaptainCommandEvent(
          latestSimulationSeconds.current,
          `${failed.toolName} 未完成：${failureSummary}`,
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
            summary: "仿真线程异常，队列按顺序停止",
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
      }
      setPaused(true);
      setToast(`仿真线程异常：${event.message}`);
    };

    return () => {
      cancelCaptainDecision();
      cancelKeyPassengerCall();
      worker.terminate();
      workerRef.current = null;
    };
  }, [
    appendCaptainCommandEvent,
    cancelCaptainDecision,
    cancelKeyPassengerCall,
    dispatchNextCaptainWorldCommand,
    requestSaveSnapshotWhenQuiescent,
  ]);

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
          setLlmStatus(payload.llm);
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
    if (
      !missionStarted ||
      missionEnded ||
      paused ||
      llmCallPhase === "waiting" ||
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0 ||
      !workerRef.current
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!workerRef.current || stepInFlight.current) return;
      requestSequence.current += 1;
      stepInFlight.current = true;
      const command: SimulationWorkerCommand = {
        type: "step",
        requestId: `step-${requestSequence.current}`,
        realSeconds: 1,
        timeScale,
      };
      workerRef.current.postMessage(command);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [
    llmCallPhase,
    missionEnded,
    missionStarted,
    paused,
    timeScale,
  ]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2_400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // ─── 键盘快捷键 ─────────────────────────────────────────────
  const TIME_SCALE_OPTIONS = [1_800, 3_600, 7_200, 21_600, 86_400];
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
      } else if (e.key >= "1" && e.key <= "5") {
        const index = Number(e.key) - 1;
        if (index < TIME_SCALE_OPTIONS.length) {
          setTimeScale(TIME_SCALE_OPTIONS[index]);
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
  const missionDistanceLightYears = Math.max(
    0.1,
    Math.abs(
      destinationSystem.distanceFromSolLy - originSystem.distanceFromSolLy,
    ),
  );
  const estimatedRouteLegs = Math.max(
    1,
    Math.ceil(missionDistanceLightYears / 2.5),
  );

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
      activeCaptainWorldCommandQueue.current !== null ||
      captainCallInFlight.current ||
      keyPassengerCallInFlight.current
    ) {
      return;
    }
    if (!llmStatus?.ready) {
      return;
    }

    const captainRuntime = llmStatus.agents.find(
      (agent) => agent.id === "captain",
    );
    const routineSeconds = Math.max(
      30,
      captainRuntime?.routine.systemInfoIntervalSimSeconds ?? 21_600,
    );
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
    const activeMaintenanceAssets = new Set(
      maintenanceState.activeTasks.map((task) => task.assetId),
    );
    const unattendedMaintenanceFaults =
      maintenanceState.observedAssets.filter(
        (asset) =>
          asset.condition !== null &&
          asset.condition !== "nominal" &&
          !activeMaintenanceAssets.has(asset.assetId),
      );
    let triggerKey = "";
    let triggerReason = "";

    if (!captainInvocationKeys.current.has("mission-start")) {
      triggerKey = "mission-start";
      triggerReason = "最高指令刚刚生效，需要建立首段航程与清醒计划";
    } else if (controllerRecord?.jumpControllerState === "ready") {
      const decisionWindow = Math.floor(
        simulationSeconds / routineSeconds,
      );
      triggerKey = `jump-ready:${controllerRecord.completedJumpLogCount}:${decisionWindow}`;
      triggerReason =
        "延迟跃迁控制器记录显示储能达到执行阈值，需要决定是否提交下一段跃迁命令";
    } else if (observedPowerAlarm) {
      triggerKey = `power-deficit:${Math.floor(simulationSeconds / urgentWindowSeconds)}`;
      triggerReason = "电网出现未满足负载，需要舰长处置";
    } else if (unattendedMaintenanceFaults.length > 0) {
      triggerKey = `maintenance-fault:${unattendedMaintenanceFaults
        .map((asset) => asset.assetId)
        .join(",")}:${Math.floor(simulationSeconds / urgentWindowSeconds)}`;
      triggerReason = `维修诊断总线报告 ${unattendedMaintenanceFaults
        .map((asset) => `${asset.label}:${asset.condition}`)
        .join("、")}，且尚无活动维修任务`;
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
    } else if (simulationSeconds >= routineSeconds) {
      const routineWindow = Math.floor(
        simulationSeconds / routineSeconds,
      );
      triggerKey = `routine:${routineWindow}`;
      triggerReason = "到达舰长自行设定的例行系统信息周期";
    }

    if (
      !triggerKey ||
      captainInvocationKeys.current.has(triggerKey)
    ) {
      return;
    }

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
      "模型返回前世界状态已经变化；旧观测上的命令已被联锁作废",
    );
    const assertCurrentCaptainDecision = () => {
      if (!isCurrentCaptainDecision()) {
        throw supersededDecisionError;
      }
      if (latestStateRevision.current !== observedStateRevision) {
        throw staleObservationError;
      }
    };
    captainInvocationKeys.current.add(triggerKey);
    captainCallInFlight.current = true;
    const resumeAfterCall = !paused;
    setPaused(true);
    setLlmCallPhase("waiting");

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

    const atmospherePressureObservation =
      compartmentState?.observedPressureAveragePa ?? null;
    const atmosphereZoneAlerts =
      compartmentState?.zones
        .filter((zone) => zone.condition !== "nominal")
        .slice(0, 8)
        .map((zone) => ({
          zoneId: zone.zoneId,
          condition: zone.condition,
          pressureSensorPa: zone.observed.pressurePa,
          oxygenSensorPa:
            zone.observed.oxygenPartialPressurePa,
          carbonDioxideSensorPa:
            zone.observed.carbonDioxidePartialPressurePa,
          pressureSensorQuality: zone.quality.pressure,
          sampleAgeSeconds: zone.newestSampleAgeSeconds,
        })) ?? [];
    const trueRemainingDistance = Math.max(
      0,
      engineState.journey.totalDistanceLightYears -
        engineState.journey.completedDistanceLightYears,
    );
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
        return {
          ring,
          observedCarbonDioxidePartialPressurePa:
            carbonDioxideReadings.length === 0
              ? null
              : carbonDioxideReadings.reduce(
                  (total, value) => total + value,
                  0,
                ) / carbonDioxideReadings.length,
          observedPressurePa:
            pressureReadings.length === 0
              ? null
              : pressureReadings.reduce(
                  (total, value) => total + value,
                  0,
                ) / pressureReadings.length,
          reportingZoneCount: Math.min(
            carbonDioxideReadings.length,
            pressureReadings.length,
          ),
        };
      },
    );
    const authorizedObservation = {
      source:
        "仅含舰载传感器与延迟授权记录；不是世界真值，上帝模式账本不在此通道",
      jumpControllerRecord: authorizedJumpControllerRecord,
      crewManifestRecord: authorizedCrewManifestRecord,
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
      oxygenPartialPressureSensorPa:
        compartmentState?.zones.find(
          (zone) => zone.zoneId === "A-01",
        )?.observed.oxygenPartialPressurePa ?? null,
      pressureZoneAlerts: atmosphereZoneAlerts,
      airHandlerControllers:
        compartmentState?.airHandlers.controllers ?? [],
      waterProcessorControllers:
        waterRecoveryState?.controllers ?? [],
      waterRecoverySensors: waterRecoveryState?.observed
        ? {
            availability: "available",
            sampledAtSimulationSeconds:
              waterRecoveryState.observed.sampledAtMicroseconds /
              1_000_000,
            sampleAgeSeconds: Math.max(
              0,
              simulationSeconds -
                waterRecoveryState.observed.sampledAtMicroseconds /
                  1_000_000,
            ),
            potableKgByRing:
              waterRecoveryState.observed.potableKgByRing,
            wastewaterKgByRing:
              waterRecoveryState.observed.wastewaterKgByRing,
            processorThroughputKgPerDay:
              waterRecoveryState.observed
                .processorThroughputKgPerDay,
          }
        : {
            availability: "sensor-unavailable",
          },
      maintenanceDiagnostics: maintenanceState
        ? {
            assets: maintenanceState.observedAssets.map(
              ({
                assetId,
                label,
                condition,
                sampleAgeSeconds,
              }) => ({
                assetId,
                label,
                condition,
                sampleAgeSeconds,
              }),
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
        navigationState.observed
          .orientationBodyToInertial,
      navigationAngularVelocitySensorRadPerS:
        navigationState.observed
          .angularVelocityBodyRadPerS,
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
    };
    const authorizedObservationForAgent = (agentId: string) => {
      switch (agentId) {
        case "navigation":
          return {
            source: authorizedObservation.source,
            powerControllerAlarm:
              authorizedObservation.powerControllerAlarm,
            jumpControllerRecord:
              authorizedObservation.jumpControllerRecord,
            rotationRingSensors:
              authorizedObservation.rotationRingSensors,
            rotationSensorDiagnostics:
              authorizedObservation.rotationSensorDiagnostics,
            positionSensorM:
              authorizedObservation.navigationPositionSensorM,
            velocitySensorMPerS:
              authorizedObservation.navigationVelocitySensorMPerS,
            attitudeSensor:
              authorizedObservation.navigationAttitudeSensor,
            angularVelocitySensorRadPerS:
              authorizedObservation
                .navigationAngularVelocitySensorRadPerS,
            propellantMassSensorKg:
              authorizedObservation.propellantMassSensorKg,
          };
        case "medical":
          return {
            source: authorizedObservation.source,
            habitatPressureSensorPa:
              authorizedObservation.habitatPressureSensorPa,
            oxygenPartialPressureSensorPa:
              authorizedObservation.oxygenPartialPressureSensorPa,
            pressureZoneAlerts:
              authorizedObservation.pressureZoneAlerts,
            crewManifestRecord:
              authorizedObservation.crewManifestRecord,
          };
        case "life-support":
          return {
            source: authorizedObservation.source,
            habitatPressureSensorPa:
              authorizedObservation.habitatPressureSensorPa,
            oxygenPartialPressureSensorPa:
              authorizedObservation.oxygenPartialPressureSensorPa,
            pressureZoneAlerts:
              authorizedObservation.pressureZoneAlerts,
            airHandlerControllers:
              authorizedObservation.airHandlerControllers,
            waterProcessorControllers:
              authorizedObservation.waterProcessorControllers,
            waterRecoverySensors:
              authorizedObservation.waterRecoverySensors,
            ringAtmosphereSensors:
              authorizedObservation.ringAtmosphereSensors,
            powerControllerAlarm:
              authorizedObservation.powerControllerAlarm,
          };
        case "engineering":
          return {
            source: authorizedObservation.source,
            powerControllerAlarm:
              authorizedObservation.powerControllerAlarm,
            averageBusVoltageSensorV:
              authorizedObservation.averageBusVoltageSensorV,
            averageBusFrequencySensorHz:
              authorizedObservation
                .averageBusFrequencySensorHz,
            servedPowerSensorKw:
              authorizedObservation.servedPowerSensorKw,
            reactorOutputSensorKw:
              authorizedObservation.reactorOutputSensorKw,
            batteryStateOfChargeSensorFraction:
              authorizedObservation
                .batteryStateOfChargeSensorFraction,
            coolantSensorK:
              authorizedObservation.coolantSensorK,
            thermalBusSensorK:
              authorizedObservation.thermalBusSensorK,
            coolantMassFlowSensorKgPerSecond:
              authorizedObservation.coolantMassFlowSensorKgPerSecond,
            pressureZoneAlerts:
              authorizedObservation.pressureZoneAlerts,
            airHandlerControllers:
              authorizedObservation.airHandlerControllers,
            waterProcessorControllers:
              authorizedObservation.waterProcessorControllers,
            waterRecoverySensors:
              authorizedObservation.waterRecoverySensors,
            ringAtmosphereSensors:
              authorizedObservation.ringAtmosphereSensors,
            jumpControllerRecord:
              authorizedObservation.jumpControllerRecord,
            rotationRingSensors:
              authorizedObservation.rotationRingSensors,
            rotationSensorDiagnostics:
              authorizedObservation.rotationSensorDiagnostics,
            maintenanceDiagnostics:
              authorizedObservation.maintenanceDiagnostics,
          };
        default:
          return {
            source: authorizedObservation.source,
            powerControllerAlarm:
              authorizedObservation.powerControllerAlarm,
          };
      }
    };
    const consultantIds = triggerKey.startsWith("jump-ready")
      ? ["navigation", "engineering"]
      : triggerKey.startsWith("maintenance-fault")
        ? ["engineering"]
      : triggerKey.startsWith("pressure-low")
        ? ["life-support", "engineering"]
        : triggerKey.startsWith("power-deficit") ||
            triggerKey.startsWith("thermal-high")
          ? ["engineering"]
          : triggerKey === "mission-start"
            ? ["navigation", "medical"]
            : [];
    void (async () => {
      try {
        const departmentResults = await Promise.all(
          consultantIds.map(async (agentId) => {
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
                      request:
                        "舰长要求你基于本岗位职责提供一份简短、可核查的建议。不得假定命令已经执行，不得要求直接修改世界真值。",
                      event: triggerReason,
                      highestDirective: directive,
                      mission: {
                        origin: originSystem.name,
                        destination: destinationSystem.name,
                        plannedRouteDistanceLightYears:
                          missionDistanceLightYears,
                        estimatedRouteLegs,
                        distanceProvenance:
                          "玩家选定的轻量场景航距；当前版本不是真实星历解算",
                        elapsedSimSeconds: simulationSeconds,
                      },
                      authorizedObservation:
                        authorizedObservationForAgent(agentId),
                      },
                    },
                  ],
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
            return payload.result;
          }),
        );
        assertCurrentCaptainDecision();
        for (const result of departmentResults) {
          assertCurrentCaptainDecision();
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
                  mission: {
                    origin: originSystem.name,
                    destination: destinationSystem.name,
                    plannedRouteDistanceLightYears:
                      missionDistanceLightYears,
                    estimatedRouteLegs,
                    distanceProvenance:
                      "玩家选定的轻量场景航距；当前版本不是真实星历解算",
                    elapsedSimSeconds: simulationSeconds,
                  },
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
                  instruction:
                    "只可选择提供的世界内工具。若无需动作，请明确说明等待条件；不要假定工具调用已经成功。",
                  },
                },
              ],
              tools: [
              {
                name: "execute_jump",
                description:
                  "向真实跃迁控制器提交一次0.1至5光年的启动命令。仅当储能与联锁就绪时设备才会执行，并会消耗储能、产生废热。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["distanceLightYears"],
                  properties: {
                    distanceLightYears: {
                      type: "number",
                      minimum: 0.1,
                      maximum: 5,
                    },
                  },
                },
              },
              {
                name: "set_awake_target",
                description:
                  "向医疗与休眠系统提交清醒人数目标；系统只会按舱位、人员和小时级医疗流程分批排程，不会直接改写人员状态。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["targetAwake"],
                  properties: {
                    targetAwake: {
                      type: "integer",
                      minimum: 0,
                      maximum: 2120,
                    },
                  },
                },
              },
              {
                name: "isolate_pressure_zone",
                description:
                  "关闭指定压力区相连的真实舱门、风管和隔离阀，限制泄漏传播。该命令不会修复破口，且错误隔离会切断通行与通风。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["zoneId"],
                  properties: {
                    zoneId: {
                      type: "string",
                      pattern: "^[AB]-(0[1-9]|1[0-9]|2[0-4])$",
                    },
                  },
                },
              },
              {
                name: "set_air_handler_control",
                description:
                  "设置A或B空气处理机的循环风量指令并投入或旁路CO₂吸附器。真实风量由本机状态和对应生命保障馈线供电决定；吸附器只会从所属环路的实体舱室气体中移除高于控制设定点的CO₂。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "airHandlerId",
                    "commandedFlowFraction",
                    "scrubberEnabled",
                  ],
                  properties: {
                    airHandlerId: {
                      type: "string",
                      enum: AIR_HANDLER_IDS,
                    },
                    commandedFlowFraction: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                    },
                    scrubberEnabled: { type: "boolean" },
                  },
                },
              },
              {
                name: "set_water_processor_control",
                description:
                  "设置A或B水回收机的处理量指令。废水先经过主处理，再经过浓盐水二级回收；真实处理量受本机状态、对应生命保障馈线、废水库存和净水罐余量约束，不能直接生成净水。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "processorId",
                    "commandedThroughputFraction",
                  ],
                  properties: {
                    processorId: {
                      type: "string",
                      enum: WATER_PROCESSOR_IDS,
                    },
                    commandedThroughputFraction: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                    },
                  },
                },
              },
              {
                name: "schedule_maintenance",
                description:
                  "为诊断为非 nominal 的固定设备创建真实维修任务。系统会锁定并消耗对应备件，分配同环维修机器人和一名清醒合格乘员；只有工业馈线有服务且乘员保持清醒时才累计工时，完成后物理设备才会被检修，不能直接改写设备状态。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["assetId"],
                  properties: {
                    assetId: {
                      type: "string",
                      enum: MAINTENANCE_ASSET_IDS,
                    },
                  },
                },
              },
              {
                name: "schedule_thruster_pulse",
                description:
                  "向固定安装的真实推进器排程一次脉冲。系统会依据推力方向、安装力臂、比冲、推进剂余量和故障状态积分六自由度运动；不可直接指定速度、位置或姿态。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "thrusterId",
                    "throttleFraction",
                    "durationSeconds",
                    "startDelaySeconds",
                  ],
                  properties: {
                    thrusterId: {
                      type: "string",
                      enum: THRUSTER_IDS,
                    },
                    throttleFraction: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                    },
                    durationSeconds: {
                      type: "number",
                      exclusiveMinimum: 0,
                      maximum: 600,
                    },
                    startDelaySeconds: {
                      type: "number",
                      minimum: 0,
                      maximum: 3_600,
                    },
                  },
                },
              },
              {
                name: "schedule_thruster_maneuver",
                description:
                  "以单一原子事务排程1至18个推进器脉冲，适合用成对或成组推进器实现近似纯平移、俯仰、偏航或滚转。所有脉冲仍由固定安装位置、方向、推力、比冲和推进剂积分；任一项无效则整组拒绝。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["pulses"],
                  properties: {
                    pulses: {
                      type: "array",
                      minItems: 1,
                      maxItems: 18,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: [
                          "thrusterId",
                          "throttleFraction",
                          "durationSeconds",
                          "startDelaySeconds",
                        ],
                        properties: {
                          thrusterId: {
                            type: "string",
                            enum: THRUSTER_IDS,
                          },
                          throttleFraction: {
                            type: "number",
                            minimum: 0,
                            maximum: 1,
                          },
                          durationSeconds: {
                            type: "number",
                            exclusiveMinimum: 0,
                            maximum: 600,
                          },
                          startDelaySeconds: {
                            type: "number",
                            minimum: 0,
                            maximum: 3_600,
                          },
                        },
                      },
                    },
                  },
                },
              },
              {
                name: "set_reactor_target",
                description:
                  "设置一个聚变发电模块的目标电功率（每台额定225000 kW）。在线模块将按爬坡率接近目标；保护跳闸或未在线的模块不会凭空输出。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["reactorId", "targetOutputKw"],
                  properties: {
                    reactorId: {
                      type: "string",
                      enum: FUSION_REACTOR_IDS,
                    },
                    targetOutputKw: {
                      type: "number",
                      minimum: 0,
                      maximum: 225_000,
                    },
                  },
                },
              },
              {
                name: "set_reactor_mode",
                description:
                  "把一个未跳闸的聚变模块切换为在线、热备或离线。切为在线不会瞬间产生额定功率，输出仍按目标值和爬坡率变化；跳闸模块不能用此命令复位。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["reactorId", "mode"],
                  properties: {
                    reactorId: {
                      type: "string",
                      enum: FUSION_REACTOR_IDS,
                    },
                    mode: {
                      type: "string",
                      enum: REACTOR_MODES,
                    },
                  },
                },
              },
              {
                name: "set_cooling_pump_speed",
                description:
                  "设置A或B冷却回路泵的转速指令。真实流量和耗电仍受泵体状况与回路物理约束；停泵会因热量持续积累而产生后果。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "pumpId",
                    "commandedSpeedFraction",
                  ],
                  properties: {
                    pumpId: {
                      type: "string",
                      enum: COOLANT_PUMP_IDS,
                    },
                    commandedSpeedFraction: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                    },
                  },
                },
              },
              {
                name: "set_electrical_load_enabled",
                description:
                  "投入或退出一个真实配电负载。退出生命保障、休眠、冷却或居住负载会产生物理后果；投入也不保证母线有足够功率。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["loadId", "enabled"],
                  properties: {
                    loadId: {
                      type: "string",
                      enum: ELECTRICAL_LOAD_IDS,
                    },
                    enabled: { type: "boolean" },
                  },
                },
              },
              {
                name: "set_electrical_breaker",
                description:
                  "向实体断路器发出合闸或分闸指令，以改变双母线、发电、储能和负载拓扑。保护跳闸锁存不会被普通合闸指令绕过。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["breakerId", "commandedClosed"],
                  properties: {
                    breakerId: {
                      type: "string",
                      enum: ELECTRICAL_BREAKER_IDS,
                    },
                    commandedClosed: { type: "boolean" },
                  },
                },
              },
              {
                name: "set_battery_mode",
                description:
                  "设置A或B储能组为自动、仅充电、仅放电或待机。实际功率受荷电量、额定功率、故障与母线平衡限制。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["batteryId", "mode"],
                  properties: {
                    batteryId: {
                      type: "string",
                      enum: ELECTRICAL_BATTERY_IDS,
                    },
                    mode: {
                      type: "string",
                      enum: BATTERY_CONTROL_MODES,
                    },
                  },
                },
              },
              {
                name: "set_habitat_ring_control",
                description:
                  "操作A或B反向旋转居住环的真实驱动器。可设闭环转速保持、自由滑行或机械制动；实际转速、人工重力、舰体反作用、耗电和废热均由电机、轴承与角动量守恒计算，不可直接指定重力。",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "ringId",
                    "controlMode",
                    "targetRelativeRpm",
                  ],
                  properties: {
                    ringId: {
                      type: "string",
                      enum: ROTATION_RING_IDS,
                    },
                    controlMode: {
                      type: "string",
                      enum: RING_CONTROL_MODES,
                    },
                    targetRelativeRpm: {
                      type: "number",
                      minimum: -12,
                      maximum: 12,
                    },
                  },
                },
              },
              ],
              metadata: {
                triggerKey,
              },
              discussion: { depth: 1, round: 1 },
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
              `舰长端点返回 HTTP ${response.status}`,
          );
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

        const worldToolCalls = payload.result.toolCalls.filter(
          (toolCall) =>
            toolCall.name !== "configure_self_routine",
        );
        const boundedWorldToolCalls = worldToolCalls.slice(
          0,
          MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE,
        );
        const preliminaryReceipts: CaptainDeviceReceiptSummary[] = [];
        const queuedWorldCommands: QueuedCaptainWorldCommand[] = [];
        boundedWorldToolCalls.forEach((toolCall, index) => {
          assertCurrentCaptainDecision();
          const ordinal = index + 1;
          const parsed = parseCaptainWorldToolCall(
            toolCall,
            engineState.journey.status,
            trueRemainingDistance,
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
            assertCurrentCaptainDecision();
            const timelineEventId = ++eventId.current;
            setEvents((current) =>
              prependTimelineEvent(current, {
                id: timelineEventId,
                at: formatDuration(simulationSeconds),
                source: `${routineAgent?.role ?? routineAgentId} / 自主管理`,
                text: `系统信息周期调整为 ${formatCadence(routine.systemInfoIntervalSimSeconds)}，固定讨论上限为深度 ${routine.discussionDepth}、${routine.discussionRounds} 轮。`,
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
            setLlmStatus(statusPayload.llm);
          }
        }

        assertCurrentCaptainDecision();
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
            resumeAfterCompletion: resumeAfterCall,
          };
          activeCaptainWorldCommandQueue.current = queue;
          dispatchNextCaptainWorldCommand();
        } else {
          latestCaptainDeviceReceipts.current = [
            ...preliminaryReceipts,
          ].sort((left, right) => left.ordinal - right.ordinal);
        }
        assertCurrentCaptainDecision();
        setLlmCallPhase("idle");
        const queueStillActive =
          activeCaptainWorldCommandQueue.current?.cycleToken ===
          captainDecisionToken;
        const queueRejected =
          latestCaptainDeviceReceipts.current.some(
            (receipt) => receipt.status === "rejected",
          );
        if (
          resumeAfterCall &&
          !queueStillActive &&
          !queueRejected &&
          !latestMissionEnded.current
        ) {
          setPaused(false);
        }
      } catch (error) {
        if (!isCurrentCaptainDecision()) {
          return;
        }
        captainInvocationKeys.current.delete(triggerKey);
        const message =
          error instanceof Error ? error.message : String(error);
        const timelineEventId = ++eventId.current;
        setEvents((current) =>
          prependTimelineEvent(current, {
            id: timelineEventId,
            at: formatDuration(simulationSeconds),
            source: "LLM 网关",
            text: `舰长关键决策未完成：${message}`,
            tone: "critical",
          }),
        );
        setToast(`舰长调用暂停：${message}`);
        setLlmCallPhase("error");
        setPaused(true);
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
    engineState,
    estimatedRouteLegs,
    compartmentState,
    coolingState,
    electricalState,
    navigationState,
    rotationState,
    waterRecoveryState,
    maintenanceState,
    llmStatus,
    missionEnded,
    missionDistanceLightYears,
    missionStarted,
    originSystem.name,
    paused,
    simulationSeconds,
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
    const resumeAfterCall = !paused;
    setPaused(true);
    setLlmCallPhase("waiting");

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
          simulationSeconds,
          privateText,
        );
        setKeyPassengerPrivateNotes(
          keyPassengerScheduler.current.listPrivateNotes(),
        );

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
            setLlmStatus(statusPayload.llm);
          }
        }
        setToast(
          `${candidate.observation.displayName} 的私人终端记录已更新。`,
        );
      } catch (error) {
        if (!isSamePassengerCycle()) {
          return;
        }
        keyPassengerScheduler.current.markFailed(
          candidate.passengerId,
          simulationSeconds,
        );
        const message =
          error instanceof Error ? error.message : String(error);
        setToast(
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
          setLlmCallPhase("idle");
          if (
            resumeAfterCall &&
            !latestMissionEnded.current &&
            !captainCallInFlight.current &&
            activeCaptainWorldCommandQueue.current === null
          ) {
            setPaused(false);
          }
        }
      }
    })();
  }, [
    destinationSystem.name,
    engineState,
    llmStatus,
    missionEnded,
    missionStarted,
    originSystem.name,
    paused,
    simulationSeconds,
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
    setToast(`${source}：${text}`);
  };

  const startMission = () => {
    if (
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0
    ) {
      setToast("请等待当前一致性存档完成后再签发新任务。");
      return;
    }
    if (origin === destination) {
      setToast("出发地与目的地不能相同。");
      return;
    }
    if (!directive.trim()) {
      setToast("最高指令不能为空。");
      return;
    }
    if (!workerRef.current) {
      setToast("物理引擎尚未完成装载，请稍后重试。");
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
    worldEpoch.current += 1;
    latestStateRevision.current = null;
    commandRevision.current = 0;
    knownMaintenanceCompletionIds.current.clear();
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
      setToast("一致性存档已在进行，请等待完成。");
      return;
    }
    cancelKeyPassengerCall();
    setLlmCallPhase(llmStatus?.ready ? "idle" : "error");
    const saveMetadata: Omit<LocalSave, "runtimeSnapshot"> = {
      version: 18,
      activeView,
      missionStarted,
      paused,
      timeScale,
      simulationSeconds,
      origin,
      destination,
      directive,
      events,
      keyPassengerLlm:
        keyPassengerScheduler.current.snapshot(),
    };
    if (!missionStarted) {
      const save: LocalSave = {
        ...saveMetadata,
        runtimeSnapshot: null,
      };
      window.localStorage.setItem(
        "farhorizon-save",
        JSON.stringify(save),
      );
      setLastSaveTime(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
      setToast("任务配置已保存到本机。");
      return;
    }
    if (!engineState || !workerRef.current) {
      setToast("物理引擎仍在建立一致性状态，请稍后存档。");
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
    requestSaveSnapshotWhenQuiescent();
    setToast(
      stepInFlight.current ||
        activeCaptainWorldCommandQueue.current !== null
        ? "正在等待在途物理事务完成后建立存档屏障……"
        : "正在封装物理、乘员、随机数与事件队列……",
    );
  };

  const loadGame = () => {
    if (
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0
    ) {
      setToast("请等待当前一致性存档完成后再加载。");
      return;
    }
    const raw = window.localStorage.getItem("farhorizon-save");
    if (!raw) {
      setToast("尚未找到本地存档。");
      return;
    }
    try {
      const save = JSON.parse(raw) as LocalSave;
      const knownViews = new Set<ViewId>(
        NAV_ITEMS.map((item) => item.id),
      );
      const knownSystems = new Set<string>(
        STAR_SYSTEMS.map((system) => system.id),
      );
      if (
        save.version !== 18 ||
        !knownViews.has(save.activeView) ||
        !knownSystems.has(save.origin) ||
        !knownSystems.has(save.destination) ||
        typeof save.directive !== "string" ||
        !Array.isArray(save.events) ||
        !Number.isFinite(save.simulationSeconds) ||
        !Number.isFinite(save.timeScale) ||
        (save.missionStarted && !save.runtimeSnapshot)
      ) {
        throw new Error("unsupported save schema");
      }
      const restoredKeyPassengerScheduler =
        KeyPassengerPollScheduler.restore(save.keyPassengerLlm);
      cancelCaptainDecision();
      cancelKeyPassengerCall();
      latestCaptainDeviceReceipts.current = [];
      latestMissionEnded.current = false;
      setLlmCallPhase(llmStatus?.ready ? "idle" : "error");
      worldEpoch.current += 1;
      latestStateRevision.current = null;
      if (save.runtimeSnapshot) {
        if (!workerRef.current) {
          throw new Error("simulation worker is unavailable");
        }
        const requestId = nextRequestId("restore");
        pendingLoad.current = {
          requestId,
          save,
          keyPassengerScheduler:
            restoredKeyPassengerScheduler,
        };
        setPaused(true);
        const command: SimulationWorkerCommand = {
          type: "restore",
          requestId,
          snapshot: save.runtimeSnapshot,
        };
        workerRef.current.postMessage(command);
        setToast("正在原子校验并恢复完整运行时……");
        return;
      } else {
        knownMaintenanceCompletionIds.current.clear();
        keyPassengerScheduler.current =
          restoredKeyPassengerScheduler;
        setKeyPassengerPrivateNotes(
          restoredKeyPassengerScheduler.listPrivateNotes(),
        );
        setActiveView(save.activeView);
        setMissionStarted(false);
        setPaused(true);
        setTimeScale(save.timeScale);
        setSimulationSeconds(save.simulationSeconds);
        setOrigin(save.origin);
        setDestination(save.destination);
        setDirective(save.directive);
        setEvents(save.events);
        eventId.current = save.events.reduce(
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
        setCommandBusState(null);
        setPassengerHighlights([]);
        commandRevision.current = 0;
        setMissionEnded(false);
        setFinalReport(null);
        setEndReportDismissed(false);
        finalReportRequested.current = false;
      }
      setToast("任务配置已恢复。");
    } catch {
      setToast("存档格式损坏或版本过旧，未执行加载。");
    }
  };

  const submitIntervention = (
    request: ExternalInterventionRequest,
    eventText: string,
  ) => {
    if (
      pendingSaveBarrier.current !== null ||
      pendingSaves.current.size > 0
    ) {
      setToast("一致性存档期间暂不接受新的外部干预。");
      return;
    }
    if (!missionStarted || !workerRef.current) {
      setToast("必须先签发最高指令，才能干预正在运行的世界。");
      return;
    }
    const command: SimulationWorkerCommand = {
      type: "intervene",
      requestId: nextRequestId("god"),
      request,
    };
    cancelCaptainDecision();
    cancelKeyPassengerCall();
    keyPassengerScheduler.current.resetObservations();
    latestCaptainDeviceReceipts.current = [];
    setLlmCallPhase("idle");
    worldEpoch.current += 1;
    workerRef.current.postMessage(command);
    setToast(`正在执行并校验：${eventText}`);
  };

  const injectCausalEvent = (eventType: string, label: string) => {
    const common = {
      actor: "player:god-mode",
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
              value: 8_500_000,
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
      default:
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
    }
    submitIntervention(request, `已触发因果事件：${label}`);
  };

  const forceOverride = (
    field: (typeof FORCE_FIELDS)[number],
    value: number,
  ) => {
    if (!engineState) {
      setToast("尚无可覆写的物理快照。");
      return;
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

    submitIntervention(
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
      />
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">Y</span>
          <div>
            <strong>远穹计划</strong>
            <small>FAR HORIZON / CIVILIAN ARK Y-01</small>
          </div>
        </div>
        <div className="mission-clock">
          <span>MISSION ELAPSED</span>
          <strong>{formatDuration(simulationSeconds)}</strong>
          {missionStarted && engineState && (
            <small className="mission-progress">
              {((engineState.journey.completedDistanceLightYears / Math.max(engineState.journey.totalDistanceLightYears, 0.01)) * 100).toFixed(1)}% · {engineState.journey.jumpsCompleted}/{engineState.journey.totalLegs} 跃迁
            </small>
          )}
        </div>
        <div className="topbar-status">
          <span className="signal-dot" />
          <div>
            <strong>
              {missionEnded
                ? "目标安全区已确认"
                : llmCallPhase === "waiting"
                  ? "等待舰长关键决策"
                  : missionStarted
                    ? "最高指令生效"
                    : "任务尚未签发"}
            </strong>
            <small>
              {missionEnded
                ? "航程结束 · 等待人类接管"
                : missionStarted
                  ? "舰长拥有全舰指挥权"
                  : "执行权限已冻结"}
            </small>
          </div>
        </div>
        <div className="save-actions">
          <button type="button" onClick={saveGame}>
            存档
          </button>
          <button type="button" onClick={loadGame}>
            读取
          </button>
          {lastSaveTime && (
            <span className="last-save-time" title="上次存档时间">
              {lastSaveTime}
            </span>
          )}
        </div>
      </header>

      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar-index">Y-01</div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <button
              className={activeView === item.id ? "active" : ""}
              aria-current={
                activeView === item.id ? "page" : undefined
              }
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
            <span>模拟倍率</span>
            {compartmentState?.fidelityLimited && (
              <span
                className="effective-rate"
                role="status"
                title="局部事故要求瞬态细分，物理引擎正在自动限制推进速度"
              >
                实际{" "}
                {compartmentState.effectiveTimeScale.toLocaleString(
                  "zh-CN",
                )}
                ×
              </span>
            )}
            {TIME_SCALE_OPTIONS.map((scale, index) => (
              <button
                className={timeScale === scale ? "active" : ""}
                aria-pressed={timeScale === scale}
                key={scale}
                title={`快捷键 ${index + 1}`}
                onClick={() => { setTimeScale(scale); audio.playClick(); }}
                type="button"
              >
                {scale === 1_800
                  ? "30m/s"
                  : scale === 3_600
                    ? "1H/s"
                    : scale === 7_200
                      ? "2H/s"
                      : scale === 21_600
                        ? "6H/s"
                        : "1D/s"}
              </button>
            ))}
            <button
              className={`pause-button${llmCallPhase === "waiting" ? " thinking" : ""}`}
              onClick={() => { setPaused((value) => !value); audio.playClick(); }}
              type="button"
              title="快捷键 Space"
              disabled={
                !missionStarted ||
                missionEnded ||
                llmCallPhase === "waiting"
              }
            >
              {missionEnded
                ? "已抵达"
                : llmCallPhase === "waiting"
                  ? "⚡ AI 决策中…"
                  : paused
                    ? "▶ 继续"
                    : "⏸ 暂停"}
            </button>
          </div>
        </div>

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
            />
          )}
          {activeView === "people" && (
            <PeopleView
              state={engineState}
              highlights={passengerHighlights}
              privateNotes={keyPassengerPrivateNotes}
            />
          )}
          {activeView === "ai" && (
            <AiView
              status={llmStatus}
              callPhase={llmCallPhase}
              commandBus={commandBusState}
              decisionLog={captainDecisionLog}
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
              onCausalEvent={injectCausalEvent}
              onOverride={forceOverride}
            />
          )}
        </div>
      </section>

      <aside className="event-rail" aria-label="事件时间线">
        <div className="event-rail-heading">
          <div>
            <span className="eyebrow">EVENT STREAM</span>
            <h2>全舰事件</h2>
          </div>
          <span className="event-count">{events.length}</span>
        </div>
        <div className="event-filter-bar">
          {(["all", "nominal", "watch", "critical"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className={`event-filter-btn${eventFilter === filter ? " active" : ""}`}
              onClick={() => setEventFilter(filter)}
            >
              {filter === "all" ? "全部" : filter === "nominal" ? "正常" : filter === "watch" ? "关注" : "告警"}
            </button>
          ))}
        </div>
        <div className="event-list">
          {events
            .filter((event) => eventFilter === "all" || event.tone === eventFilter)
            .slice(0, 50)
            .map((event) => (
            <article className={`event-item event-${event.tone}`} key={event.id}>
              <div>
                <time>{event.at}</time>
                <span>{event.source}</span>
              </div>
              <p>{event.text}</p>
            </article>
          ))}
        </div>
        <div className="captain-glance">
          <span className="eyebrow">CAPTAIN / 乾枢</span>
          <p>
            {!missionStarted
              ? "已完成全舰态势建模，等待人类签发唯一最高指令。"
              : llmCallPhase === "waiting"
                ? "舰长正在召开部门会议，形成关键决策……"
                : captainDecisionLog.length > 0
                  ? `已完成 ${captainDecisionLog.filter((d) => d.status === "done").length} 项决策，持续监控全舰系统。`
                  : "正在根据最高指令调整系统信息周期与首段跃迁决策。"}
          </p>
          <div>
            <span>累计决策</span>
            <strong>{captainDecisionLog.length} 项</strong>
          </div>
        </div>
      </aside>

      <footer className="bottom-bar">
        <div>
          <span className="bottom-status" />
          <strong>PHYSICS LOOP</strong>
          <span>确定性</span>
        </div>
        <div>
          <strong>LLM GATEWAY</strong>
          <span>
            {llmStatus?.ready
              ? missionStarted
                ? "就绪 / 等待任务"
                : "预检通过"
              : "需要本机配置"}
          </span>
        </div>
        <div>
          <strong>PASSENGERS</strong>
          <span>2,120 / 持续模拟</span>
        </div>
        <div className="bottom-warning">
          上帝模式的外部注入不会向舰长解释来源
        </div>
      </footer>

      {!missionStarted && (
        <div
          className="launch-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="launch-dialog-title"
        >
          <div className="launch-card">
            <div className="launch-card-heading">
              <span className="launch-number">00</span>
              <div>
                <span className="eyebrow">MISSION AUTHORITY / 人类签发</span>
                <h2 id="launch-dialog-title">建立最高指令</h2>
                <p>
                  开航后，玩家只能观察舰载智能；任何后续干预都发生在物理世界。
                </p>
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
                <span>标准跃迁节点</span>
                <strong>
                  {String(estimatedRouteLegs + 1).padStart(2, "0")}
                </strong>
              </div>
              <div>
                <span>应急自持</span>
                <strong>5 年</strong>
              </div>
              <div>
                <span>舰长权限</span>
                <strong>最高</strong>
              </div>
            </div>
            <div
              className={`llm-preflight ${llmStatus?.ready ? "ready" : "warning"}`}
            >
              <span>LLM PRE-FLIGHT</span>
              <strong>
                {llmStatus?.ready
                  ? "8 个固定部门端点已就绪"
                  : "尚未配置全部云端密钥；可启动物理纵切，但关键 AI 决策将等待"}
              </strong>
            </div>
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
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
