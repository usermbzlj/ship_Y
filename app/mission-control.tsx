"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ExternalInterventionRequest,
  ShipState,
} from "@/lib/sim";
import {
  AIR_HANDLER_IDS,
  type AirHandlerId,
  type ZoneId,
} from "@/lib/sim/compartments";
import {
  COOLANT_PUMP_IDS,
  type CoolantPumpId,
} from "@/lib/sim/cooling";
import {
  ELECTRICAL_BATTERY_IDS,
  ELECTRICAL_BREAKER_IDS,
  ELECTRICAL_LOAD_IDS,
  FUSION_REACTOR_IDS,
  type BatteryControlMode,
  type ElectricalBatteryId,
  type ElectricalBreakerId,
  type ElectricalLoadId,
  type FusionReactorId,
  type ReactorMode,
} from "@/lib/sim/electrical";
import {
  THRUSTER_IDS,
  type ThrusterId,
} from "@/lib/sim/navigation";
import {
  ROTATION_RING_IDS,
  type RingControlMode,
  type RotationRingId,
} from "@/lib/sim/rotation";
import {
  WATER_PROCESSOR_IDS,
  type WaterProcessorId,
} from "@/lib/sim/water";
import {
  MAINTENANCE_ASSET_IDS,
  type MaintenanceAssetId,
} from "@/lib/sim/maintenance";
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

type ViewId = "voyage" | "ship" | "people" | "ai" | "god";
type SystemTone = "nominal" | "watch" | "critical";
type ShipWorldCommand = Extract<
  SimulationWorkerCommand,
  { type: "ship-command" }
>["command"];

type TimelineEvent = {
  id: number;
  at: string;
  source: string;
  text: string;
  tone: SystemTone;
};

type SystemCard = {
  name: string;
  value: string;
  detail: string;
  load: number;
  tone: SystemTone;
};

const STAR_SYSTEMS = [
  {
    id: "sol",
    name: "太阳系",
    port: "拉格朗日港",
    x: 14,
    y: 68,
    distanceFromSolLy: 0,
  },
  {
    id: "barnard",
    name: "巴纳德星",
    port: "赫尔墨斯中继站",
    x: 29,
    y: 45,
    distanceFromSolLy: 5.96,
  },
  {
    id: "wolf359",
    name: "沃尔夫 359",
    port: "远望补给环",
    x: 43,
    y: 72,
    distanceFromSolLy: 7.86,
  },
  {
    id: "sirius",
    name: "天狼星",
    port: "晨星自治领",
    x: 55,
    y: 34,
    distanceFromSolLy: 8.6,
  },
  {
    id: "epsilon",
    name: "波江座 ε",
    port: "阿斯特拉殖民地",
    x: 72,
    y: 57,
    distanceFromSolLy: 10.47,
  },
  {
    id: "tau-ceti",
    name: "鲸鱼座 τ",
    port: "新海岸",
    x: 86,
    y: 29,
    distanceFromSolLy: 11.9,
  },
] as const;

const NAV_ITEMS: Array<{ id: ViewId; label: string; mark: string }> = [
  { id: "voyage", label: "航程", mark: "01" },
  { id: "ship", label: "舰体", mark: "02" },
  { id: "people", label: "乘员", mark: "03" },
  { id: "ai", label: "AI 观察", mark: "04" },
  { id: "god", label: "人工干预", mark: "05" },
];

const THRUSTER_ID_SET = new Set<string>(THRUSTER_IDS);
const FUSION_REACTOR_ID_SET = new Set<string>(FUSION_REACTOR_IDS);
const COOLANT_PUMP_ID_SET = new Set<string>(COOLANT_PUMP_IDS);
const ELECTRICAL_LOAD_ID_SET = new Set<string>(ELECTRICAL_LOAD_IDS);
const ELECTRICAL_BREAKER_ID_SET = new Set<string>(
  ELECTRICAL_BREAKER_IDS,
);
const ELECTRICAL_BATTERY_ID_SET = new Set<string>(
  ELECTRICAL_BATTERY_IDS,
);
const ROTATION_RING_ID_SET = new Set<string>(ROTATION_RING_IDS);
const AIR_HANDLER_ID_SET = new Set<string>(AIR_HANDLER_IDS);
const WATER_PROCESSOR_ID_SET = new Set<string>(WATER_PROCESSOR_IDS);
const MAINTENANCE_ASSET_ID_SET = new Set<string>(MAINTENANCE_ASSET_IDS);
const RING_CONTROL_MODES = [
  "speed-hold",
  "coast",
  "brake",
] as const satisfies readonly RingControlMode[];
const RING_CONTROL_MODE_SET = new Set<string>(RING_CONTROL_MODES);
const BATTERY_CONTROL_MODES = [
  "automatic",
  "charge-only",
  "discharge-only",
  "standby",
] as const satisfies readonly BatteryControlMode[];
const BATTERY_CONTROL_MODE_SET = new Set<string>(
  BATTERY_CONTROL_MODES,
);
const REACTOR_MODES = [
  "online",
  "hot-standby",
  "offline",
] as const satisfies readonly ReactorMode[];
const REACTOR_MODE_SET = new Set<string>(REACTOR_MODES);
const MAX_TIMELINE_EVENTS = 500;

const INITIAL_EVENTS: TimelineEvent[] = [
  {
    id: 1,
    at: "T−03:40",
    source: "跃迁工程部",
    text: "三组场线圈通过冷态自检，误差低于 0.018%。",
    tone: "nominal",
  },
  {
    id: 2,
    at: "T−02:15",
    source: "乘客事务部",
    text: "首批轮值清醒名单已完成医疗复核。",
    tone: "nominal",
  },
  {
    id: 3,
    at: "T−00:42",
    source: "舰长 AI",
    text: "等待最高指令签发。所有执行权限保持冻结。",
    tone: "watch",
  },
];

const INITIAL_SYSTEMS: SystemCard[] = [
  {
    name: "聚变电网",
    value: "842 MW",
    detail: "4 在线 / 2 热备",
    load: 62,
    tone: "nominal",
  },
  {
    name: "热管理",
    value: "311 K",
    detail: "散热余量 38%",
    load: 58,
    tone: "nominal",
  },
  {
    name: "生命保障",
    value: "98.1%",
    detail: "四机组交叉供给",
    load: 74,
    tone: "nominal",
  },
  {
    name: "火炬推进",
    value: "24.00 t",
    detail: "推进剂 36.00 kt",
    load: 100,
    tone: "nominal",
  },
  {
    name: "旋转居住环",
    value: "1.002 g",
    detail: "A +2.000 · B −2.000 rpm",
    load: 100,
    tone: "nominal",
  },
  {
    name: "跃迁储能",
    value: "33.3%",
    detail: "充能中 · 联锁保持",
    load: 33,
    tone: "watch",
  },
];

const FORCE_FIELDS = [
  {
    id: "coolant-temperature",
    label: "冷却母线温度",
    path: "thermal.coolantTemperatureK",
    unit: "K",
    defaultValue: "342.0",
  },
  {
    id: "generation",
    label: "聚变电网总发电",
    path: "power.generationKw",
    unit: "kW",
    defaultValue: "650000",
  },
  {
    id: "oxygen-mass",
    label: "居住区氧气总质量",
    path: "atmosphere.gasesKg.oxygen",
    unit: "kg",
    defaultValue: "118000",
  },
  {
    id: "leak-area",
    label: "等效舰体破口面积",
    path: "atmosphere.leakAreaSquareMeters",
    unit: "m²",
    defaultValue: "0.00008",
  },
  {
    id: "radiation-rate",
    label: "外部辐射剂量率",
    path: "environment.radiationDoseRateMilliSievertsPerHour",
    unit: "mSv/h",
    defaultValue: "2.5",
  },
  {
    id: "potable-water",
    label: "可饮用水库存",
    path: "water.potableKg",
    unit: "kg",
    defaultValue: "3200000",
  },
] as const;

type ForceFieldId = (typeof FORCE_FIELDS)[number]["id"];

interface LocalSave {
  version: 18;
  activeView: ViewId;
  missionStarted: boolean;
  paused: boolean;
  timeScale: number;
  simulationSeconds: number;
  origin: string;
  destination: string;
  directive: string;
  events: TimelineEvent[];
  keyPassengerLlm: KeyPassengerPollingSnapshot;
  runtimeSnapshot: RuntimeSimulationSnapshot | null;
}

const PASSENGERS = [
  {
    name: "周弦",
    role: "材料工程师",
    cabin: "A-17-042",
    state: "清醒",
    trust: 74,
    note: "对舰长 AI 保持谨慎信任",
  },
  {
    name: "沈绫",
    role: "儿科医生",
    cabin: "B-04-116",
    state: "休眠",
    trust: 91,
    note: "医疗应急唤醒序列 07",
  },
  {
    name: "罗德里格斯",
    role: "生态农艺师",
    cabin: "A-21-008",
    state: "清醒",
    trust: 63,
    note: "要求扩大农业环供电配额",
  },
  {
    name: "韩祁",
    role: "独立记者",
    cabin: "B-11-033",
    state: "清醒",
    trust: 41,
    note: "持续申请访问舰内事故记录",
  },
];

const AI_ROSTER = [
  {
    id: "captain",
    role: "舰长",
    name: "乾枢",
    model: "主推理模型",
    state: "等待最高指令",
    cadence: "自主",
  },
  {
    id: "navigation",
    role: "导航与跃迁",
    name: "北辰",
    model: "推理模型",
    state: "航路预计算",
    cadence: "28 分钟",
  },
  {
    id: "engineering",
    role: "工程与能源",
    name: "炉心",
    model: "推理模型",
    state: "全系统监测",
    cadence: "11 分钟",
  },
  {
    id: "life-support",
    role: "生命保障",
    name: "青穹",
    model: "推理模型",
    state: "大气与水循环监测",
    cadence: "1 小时",
  },
  {
    id: "medical",
    role: "医疗与休眠",
    name: "白塔",
    model: "医疗模型",
    state: "待命",
    cadence: "47 分钟",
  },
  {
    id: "passenger-affairs",
    role: "乘客事务",
    name: "栖居",
    model: "轻量模型",
    state: "处理 14 项请求",
    cadence: "19 分钟",
  },
  {
    id: "security",
    role: "安保与应急",
    name: "界碑",
    model: "推理模型",
    state: "全舰通行态势监测",
    cadence: "2 小时",
  },
  {
    id: "passenger-service",
    role: "乘客服务",
    name: "归栖",
    model: "轻量模型",
    state: "处理生活服务队列",
    cadence: "12 小时",
  },
];

type LlmRuntimeStatus = {
  ready: boolean;
  fixedAgentCount: number;
  pendingRoutineTickets: number;
  agents: Array<{
    id: string;
    role: string;
    state: "ready" | "retrying" | "missing-secret";
    routine: {
      systemInfoIntervalSimSeconds: number;
      discussionDepth: number;
      discussionRounds: number;
    };
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

type LlmCallPhase = "idle" | "waiting" | "error";

const AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS = 60;
const AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS = 300;
const AUTHORIZED_RECORD_HISTORY_LIMIT = 1_024;

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

type RoutineTicketReference = {
  callId: string;
  toolCallId: string;
  expiresAtEpochMs: number;
};

type LlmInvokeResult = {
  callId: string;
  agentId: string;
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: unknown;
  }>;
  routineTickets: RoutineTicketReference[];
};

type LlmInvokeRoutePayload = {
  result?: LlmInvokeResult;
  error?: { message?: string };
};

const MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE = 8;

type CaptainDeviceReceiptStatus =
  | "accepted"
  | "rejected"
  | "invalid"
  | "limit"
  | "skipped";

type CaptainDeviceReceiptSummary = {
  ordinal: number;
  toolCallId: string;
  toolName: string;
  commandKind: ShipWorldCommand["kind"] | null;
  status: CaptainDeviceReceiptStatus;
  summary: string;
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

function formatDuration(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return `${String(days).padStart(3, "0")}D ${String(hours).padStart(2, "0")}H ${String(minutes).padStart(2, "0")}M`;
}

function formatCadence(seconds: number) {
  if (seconds >= 86_400 && seconds % 86_400 === 0) {
    return `${seconds / 86_400} 天`;
  }
  if (seconds >= 3_600 && seconds % 3_600 === 0) {
    return `${seconds / 3_600} 小时`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60} 分钟`;
  }
  return `${seconds} 秒`;
}

function prependTimelineEvent(
  current: TimelineEvent[],
  event: TimelineEvent,
): TimelineEvent[] {
  return [event, ...current].slice(0, MAX_TIMELINE_EVENTS);
}

function compactLlmTimelineText(
  value: string,
  maximumLength: number,
  fallback: string,
): string {
  const plainText = value
    .trim()
    .replace(/```[A-Za-z0-9_-]*\s*/g, "")
    .replace(/```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\|\s*:?-{3,}:?\s*(?=\|)/g, "")
    .replace(/\|/g, " · ")
    .replace(/[\*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plainText) return fallback;
  if (plainText.length <= maximumLength) return plainText;
  return `${plainText.slice(0, Math.max(1, maximumLength - 1)).trimEnd()}…`;
}

function StarMap({
  originId,
  destinationId,
  running,
}: {
  originId: string;
  destinationId: string;
  running: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);

      const gradient = context.createRadialGradient(
        bounds.width * 0.56,
        bounds.height * 0.46,
        10,
        bounds.width * 0.56,
        bounds.height * 0.46,
        bounds.width * 0.72,
      );
      gradient.addColorStop(0, "rgba(27, 47, 54, 0.34)");
      gradient.addColorStop(1, "rgba(4, 9, 12, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, bounds.width, bounds.height);

      for (let index = 0; index < 92; index += 1) {
        const x = ((index * 79) % 997) / 997;
        const y = ((index * 131 + 17) % 991) / 991;
        const alpha = 0.18 + ((index * 17) % 48) / 100;
        context.fillStyle = `rgba(205, 224, 221, ${alpha})`;
        context.fillRect(
          x * bounds.width,
          y * bounds.height,
          index % 11 === 0 ? 1.6 : 0.8,
          index % 11 === 0 ? 1.6 : 0.8,
        );
      }

      const originIndex = STAR_SYSTEMS.findIndex(
        (system) => system.id === originId,
      );
      const destinationIndex = STAR_SYSTEMS.findIndex(
        (system) => system.id === destinationId,
      );
      const start = Math.min(originIndex, destinationIndex);
      const end = Math.max(originIndex, destinationIndex);
      const route = STAR_SYSTEMS.slice(start, end + 1);

      context.lineWidth = 1;
      context.setLineDash([6, 9]);
      context.strokeStyle = running
        ? "rgba(235, 177, 77, 0.72)"
        : "rgba(121, 182, 183, 0.42)";
      context.beginPath();
      route.forEach((system, index) => {
        const x = (system.x / 100) * bounds.width;
        const y = (system.y / 100) * bounds.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      context.setLineDash([]);

      STAR_SYSTEMS.forEach((system) => {
        const x = (system.x / 100) * bounds.width;
        const y = (system.y / 100) * bounds.height;
        const selected =
          system.id === originId || system.id === destinationId;
        context.beginPath();
        context.arc(x, y, selected ? 4.5 : 2.5, 0, Math.PI * 2);
        context.fillStyle = selected ? "#eab34f" : "#9cc3c2";
        context.fill();
        if (selected) {
          context.beginPath();
          context.arc(x, y, 10, 0, Math.PI * 2);
          context.strokeStyle = "rgba(234, 179, 79, 0.4)";
          context.stroke();
        }
        context.font =
          selected
            ? '600 11px "Microsoft YaHei", sans-serif'
            : '400 10px "Microsoft YaHei", sans-serif';
        context.fillStyle = selected
          ? "rgba(244, 224, 181, 0.92)"
          : "rgba(160, 184, 182, 0.7)";
        context.fillText(system.name, x + 10, y - 8);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [destinationId, originId, running]);

  return (
    <canvas
      ref={canvasRef}
      className="star-map"
      aria-label="星际航路图"
    />
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: SystemTone;
  children: ReactNode;
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

function VoyageView({
  origin,
  destination,
  missionStarted,
  directive,
  state,
  cooling,
  electrical,
  compartments,
  navigation,
  rotation,
}: {
  origin: string;
  destination: string;
  missionStarted: boolean;
  directive: string;
  state: ShipState | null;
  cooling: CoolingTelemetry | null;
  electrical: ElectricalTelemetry | null;
  compartments: CompartmentTelemetry | null;
  navigation: NavigationTelemetry | null;
  rotation: RotationTelemetry["observed"] | null;
}) {
  const originSystem = STAR_SYSTEMS.find((system) => system.id === origin)!;
  const destinationSystem = STAR_SYSTEMS.find(
    (system) => system.id === destination,
  )!;
  const distanceLightYears = Math.max(
    0.1,
    Math.abs(
      destinationSystem.distanceFromSolLy - originSystem.distanceFromSolLy,
    ),
  );
  const routeLegs = Math.max(1, Math.ceil(distanceLightYears / 2.5));
  const observedCoolantTemperatureK =
    cooling?.observed.averageCoolantTemperatureK ?? null;
  const observedRadiatedPowerW =
    cooling?.observed.totalRadiatedPowerW ?? null;
  const observedPressurePa =
    compartments?.observedPressureAveragePa ?? null;
  const observedOxygenReadings =
    compartments?.zones
      .map((zone) => zone.observed.oxygenPartialPressurePa)
      .filter((value): value is number => value !== null) ?? [];
  const observedOxygenPartialPressurePa =
    observedOxygenReadings.length === 0
      ? null
      : observedOxygenReadings.reduce(
          (total, value) => total + value,
          0,
        ) / observedOxygenReadings.length;
  const observedGenerationKw =
    electrical?.observed.totalReactorOutputKw ?? null;
  const observedServedPowerKw =
    electrical?.observed.totalServedPowerKw ?? null;
  const observedBusVoltageV =
    electrical?.observed.averageBusVoltageV ?? null;
  const observedBusFrequencyHz =
    electrical?.observed.averageBusFrequencyHz ?? null;
  const observedFusionFuelMassKg =
    navigation?.observed.fusionFuelMassKg ?? null;
  const observedRingA =
    rotation?.rings.find((ring) => ring.id === "ring-a") ?? null;
  const observedRingB =
    rotation?.rings.find((ring) => ring.id === "ring-b") ?? null;
  const observedRingGravityReadings = [
    observedRingA?.artificialGravityG,
    observedRingB?.artificialGravityG,
  ].filter((value): value is number => value !== null && value !== undefined);
  const observedAverageRingGravityG =
    observedRingGravityReadings.length === 0
      ? null
      : observedRingGravityReadings.reduce(
          (total, value) => total + value,
          0,
        ) / observedRingGravityReadings.length;
  const observedPeakRingVibrationMmPerS = Math.max(
    observedRingA?.vibrationMmPerS ?? 0,
    observedRingB?.vibrationMmPerS ?? 0,
  );
  const ringTone: SystemTone =
    observedAverageRingGravityG === null
      ? "watch"
      : observedAverageRingGravityG < 0.8 ||
          observedAverageRingGravityG > 1.15 ||
          observedPeakRingVibrationMmPerS > 7.1
        ? "critical"
        : observedAverageRingGravityG < 0.92 ||
            observedAverageRingGravityG > 1.08 ||
            observedPeakRingVibrationMmPerS > 3.5
          ? "watch"
          : "nominal";
  const electricalTone: SystemTone =
    observedBusVoltageV === null ||
    observedBusFrequencyHz === null
      ? "watch"
      : observedBusVoltageV < 10_450 ||
          observedBusFrequencyHz < 49.5
        ? "critical"
        : "nominal";
  const systems: SystemCard[] = state
    ? [
        {
          name: "聚变电网",
          value:
            observedGenerationKw === null
              ? "读数建立中"
              : `${(observedGenerationKw / 1_000).toFixed(0)} MW`,
          detail:
            observedServedPowerKw === null
              ? "电网传感器延迟"
              : `观测供给 ${(observedServedPowerKw / 1_000).toFixed(0)} MW`,
          load:
            observedGenerationKw === null ||
            observedServedPowerKw === null
              ? 0
              : Math.min(
                  100,
                  (observedServedPowerKw /
                    Math.max(observedGenerationKw, 1)) *
                    100,
                ),
          tone: electricalTone,
        },
        {
          name: "热管理",
          value:
            observedCoolantTemperatureK === null
              ? "读数建立中"
              : `${observedCoolantTemperatureK.toFixed(1)} K`,
          detail:
            observedRadiatedPowerW === null
              ? "双回路传感器延迟"
              : `观测散热 ${(observedRadiatedPowerW / 1_000_000).toFixed(1)} MW`,
          load: Math.min(
            100,
            (state.thermal.internalHeatKw /
              Math.max(
                (observedRadiatedPowerW ?? 0) / 1_000,
                1,
              )) *
              100,
          ),
          tone:
            observedCoolantTemperatureK === null
              ? "watch"
              : observedCoolantTemperatureK > 360
                ? "critical"
                : "nominal",
        },
        {
          name: "生命保障",
          value:
            observedPressurePa === null
              ? "读数建立中"
              : `${(observedPressurePa / 1_000).toFixed(1)} kPa`,
          detail:
            observedOxygenPartialPressurePa === null
              ? "氧分压传感器延迟"
              : `O₂ 观测 ${(observedOxygenPartialPressurePa / 1_000).toFixed(1)} kPa`,
          load: Math.min(
            100,
            (state.population.awake /
              Math.max(state.population.total, 1)) *
              100 +
              55,
          ),
          tone:
            observedPressurePa === null
              ? "watch"
              : observedPressurePa < 75_000
                ? "critical"
                : "nominal",
        },
        {
          name: "火炬推进",
          value:
            observedFusionFuelMassKg === null
              ? "读数建立中"
              : `${(observedFusionFuelMassKg / 1_000).toFixed(2)} t`,
          detail:
            observedFusionFuelMassKg === null
              ? "聚变燃料计量延迟"
              : `推进剂观测 ${
                  navigation?.observed.propellantMassKg === null ||
                  navigation?.observed.propellantMassKg === undefined
                    ? "建立中"
                    : `${(
                        navigation.observed.propellantMassKg /
                        1_000_000
                      ).toFixed(2)} kt`
                }`,
          load:
            observedFusionFuelMassKg === null
              ? 0
              : Math.min(
                  100,
                  Math.max(
                    0,
                    (observedFusionFuelMassKg / 24_000) * 100,
                  ),
                ),
          tone:
            observedFusionFuelMassKg === null
              ? "watch"
              : observedFusionFuelMassKg < 2_400
                ? "critical"
                : "nominal",
        },
        {
          name: "旋转居住环",
          value:
            observedAverageRingGravityG === null
              ? "读数建立中"
              : `${observedAverageRingGravityG.toFixed(3)} g`,
          detail:
            observedRingA?.relativeRpm === null ||
            observedRingA?.relativeRpm === undefined ||
            observedRingB?.relativeRpm === null ||
            observedRingB?.relativeRpm === undefined
              ? "双环转速传感器延迟"
              : `A ${observedRingA.relativeRpm >= 0 ? "+" : ""}${observedRingA.relativeRpm.toFixed(3)} · B ${observedRingB.relativeRpm >= 0 ? "+" : ""}${observedRingB.relativeRpm.toFixed(3)} rpm`,
          load:
            observedAverageRingGravityG === null
              ? 0
              : Math.min(100, observedAverageRingGravityG * 100),
          tone: ringTone,
        },
        {
          name: "跃迁储能",
          value: `${((state.journey.jumpDriveChargeKWh / state.journey.jumpDriveCapacityKWh) * 100).toFixed(1)}%`,
          detail:
            state.journey.status === "ready"
              ? "储能完成 · 等待舰长"
              : state.journey.status === "arrived"
                ? "任务结束 · 联锁"
                : "充能中 · 联锁保持",
          load:
            (state.journey.jumpDriveChargeKWh /
              state.journey.jumpDriveCapacityKWh) *
            100,
          tone:
            state.journey.status === "ready" ||
            state.journey.status === "arrived"
              ? "nominal"
              : "watch",
        },
      ]
    : INITIAL_SYSTEMS;

  return (
    <section className="view-grid voyage-view" aria-label="航程总览">
      <div className="panel map-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">NAVIGATION / 跃迁航路</span>
            <h2>
              {originSystem.name} <i>→</i> {destinationSystem.name}
            </h2>
          </div>
          <StatusPill tone={missionStarted ? "nominal" : "watch"}>
            {missionStarted ? "航路执行中" : "等待签发"}
          </StatusPill>
        </div>
        <div className="map-stage">
          <StarMap
            originId={origin}
            destinationId={destination}
            running={missionStarted}
          />
          <div className="map-readout map-readout-left">
            <span>直线距离</span>
            <strong>{distanceLightYears.toFixed(2)} LY</strong>
          </div>
          <div className="map-readout map-readout-right">
            <span>预计节点</span>
            <strong>{String(routeLegs + 1).padStart(2, "0")}</strong>
          </div>
          {missionStarted && (
            <div
              className="vessel-marker"
              aria-label="远穹号当前位置"
              style={{
                left: `${18 + Math.min(1, (state?.journey.completedDistanceLightYears ?? 0) / Math.max(state?.journey.totalDistanceLightYears ?? 1, 0.1)) * 64}%`,
              }}
            >
              <span />
              Y-01
            </div>
          )}
        </div>
        <div className="directive-strip">
          <span className="directive-seal">最高指令</span>
          <p>{directive}</p>
        </div>
      </div>

      <div className="panel ship-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">VESSEL / Y-01</span>
            <h2>远穹级移民舰</h2>
          </div>
          <span className="micro-code">820M · 2,120 SOULS</span>
        </div>
        <div className="ship-schematic" aria-label="远穹号舰体示意">
          <div className="ship-shield" />
          <div className="ship-spine" />
          <div className="ship-ring ring-alpha">
            <span>A</span>
          </div>
          <div className="ship-ring ring-beta">
            <span>B</span>
          </div>
          <div className="ship-core" />
          <div className="ship-engine engine-one" />
          <div className="ship-engine engine-two" />
          <div className="ship-engine engine-three" />
          <div className="ship-axis" />
        </div>
        <div className="ship-facts">
          <div>
            <span>双环平均重力</span>
            <strong>
              {observedAverageRingGravityG === null
                ? "建立中"
                : `${observedAverageRingGravityG.toFixed(3)} g`}
            </strong>
          </div>
          <div>
            <span>压力分区</span>
            <strong>48</strong>
          </div>
          <div>
            <span>应急自持</span>
            <strong>5 年</strong>
          </div>
        </div>
      </div>

      <div className="systems-row">
        {systems.map((system) => (
          <article className="system-card" key={system.name}>
            <div className="system-card-top">
              <span>{system.name}</span>
              <StatusPill tone={system.tone}>
                {system.tone === "critical"
                  ? "告警"
                  : system.tone === "watch"
                    ? "进行"
                    : "正常"}
              </StatusPill>
            </div>
            <strong>{system.value}</strong>
            <p>{system.detail}</p>
            <div className="meter">
              <i style={{ width: `${system.load}%` }} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ShipView({
  state,
  compartments,
  cooling,
  electrical,
  rotation,
  waterRecovery,
  maintenance,
}: {
  state: ShipState | null;
  compartments: CompartmentTelemetry | null;
  cooling: CoolingTelemetry | null;
  electrical: ElectricalTelemetry | null;
  rotation: RotationTelemetry["observed"] | null;
  waterRecovery: WaterRecoveryTelemetry | null;
  maintenance: MaintenanceTelemetry | null;
}) {
  const criticalZones =
    compartments?.zones.filter(
      (zone) => zone.condition === "critical",
    ).length ?? 0;
  const watchZones =
    compartments?.zones.filter(
      (zone) => zone.condition === "watch",
    ).length ?? 0;
  const offlineZones =
    compartments?.zones.filter(
      (zone) => zone.condition === "offline",
    ).length ?? 0;
  const overallTone: SystemTone =
    criticalZones > 0
      ? "critical"
      : watchZones > 0 || offlineZones > 0
        ? "watch"
        : "nominal";
  const electricalReading = (
    targetId: string,
    quantity: ElectricalTelemetry["sensors"][number]["quantity"],
  ) =>
    electrical?.sensors.find(
      (sensor) =>
        sensor.targetId === targetId &&
        sensor.quantity === quantity,
    )?.value ?? null;
  const busAServedPowerKw = electricalReading(
    "bus-a",
    "servedPowerKw",
  );
  const busBServedPowerKw = electricalReading(
    "bus-b",
    "servedPowerKw",
  );
  const busAVoltageV = electricalReading("bus-a", "voltageV");
  const busBVoltageV = electricalReading("bus-b", "voltageV");
  const observedRingA =
    rotation?.rings.find((ring) => ring.id === "ring-a") ?? null;
  const observedRingB =
    rotation?.rings.find((ring) => ring.id === "ring-b") ?? null;
  const ringNetwork = (
    label: string,
    ring: RotationTelemetry["observed"]["rings"][number] | null,
  ): readonly [string, string, number] => [
    ring?.relativeRpm === null || ring?.relativeRpm === undefined
      ? `${label} · 转速建立中`
      : `${label} · ${ring.relativeRpm >= 0 ? "+" : ""}${ring.relativeRpm.toFixed(2)} rpm`,
    ring?.artificialGravityG === null ||
    ring?.artificialGravityG === undefined
      ? "读数建立中"
      : `${ring.artificialGravityG.toFixed(3)} g`,
    ring?.artificialGravityG === null ||
    ring?.artificialGravityG === undefined
      ? 0
      : Math.min(100, ring.artificialGravityG * 100),
  ];
  const airHandlerNetwork = (
    ring: "A" | "B",
  ): readonly [string, string, number] => {
    const controller = compartments?.airHandlers.controllers.find(
      (handler) => handler.ring === ring,
    );
    const carbonDioxideReadings =
      compartments?.zones
        .filter((zone) => zone.zoneId.startsWith(`${ring}-`))
        .map(
          (zone) => zone.observed.carbonDioxidePartialPressurePa,
        )
        .filter((value): value is number => value !== null) ?? [];
    const observedCarbonDioxidePa =
      carbonDioxideReadings.length === 0
        ? null
        : carbonDioxideReadings.reduce(
            (total, value) => total + value,
            0,
          ) / carbonDioxideReadings.length;
    return [
      `空气处理 ${ring}`,
      controller
        ? `${controller.scrubberEnabled ? "吸附" : "旁路"} · ${observedCarbonDioxidePa === null ? "CO₂ —" : `CO₂ ${observedCarbonDioxidePa.toFixed(0)} Pa`}`
        : "控制器建立中",
      (controller?.commandedFlowFraction ?? 0) * 100,
    ];
  };
  const waterProcessorNetwork = (
    ring: "a" | "b",
  ): readonly [string, string, number] => {
    const controller = waterRecovery?.controllers.find(
      (processor) => processor.ring === ring,
    );
    const processorId: WaterProcessorId =
      ring === "a" ? "water-processor-a" : "water-processor-b";
    const observed = waterRecovery?.observed;
    return [
      `水回收 ${ring.toUpperCase()}`,
      controller && observed
        ? `${(observed.processorThroughputKgPerDay[processorId] / 1_000).toFixed(1)}t/d · ${(observed.potableKgByRing[ring] / 1_000_000).toFixed(2)}kt`
        : controller
          ? `${(controller.commandedThroughputFraction * 100).toFixed(0)}% · 水量 —`
          : "控制器建立中",
      (controller?.commandedThroughputFraction ?? 0) * 100,
    ];
  };
  const maintenanceProgressPercent = maintenance?.activeTasks.length
    ? Math.min(
        100,
        (maintenance.activeTasks.reduce(
          (total, task) =>
            total +
            task.completedWorkSeconds / task.requiredWorkSeconds,
          0,
        ) /
          maintenance.activeTasks.length) *
          100,
      )
    : 0;
  const networks: ReadonlyArray<readonly [string, string, number]> = [
    [
      "主电网 A",
      busAServedPowerKw === null
        ? "读数建立中"
        : `${(busAServedPowerKw / 1_000).toFixed(0)} MW`,
      busAVoltageV === null
        ? 0
        : Math.min(100, (busAVoltageV / 11_000) * 100),
    ],
    [
      "主电网 B",
      busBServedPowerKw === null
        ? "读数建立中"
        : `${(busBServedPowerKw / 1_000).toFixed(0)} MW`,
      busBVoltageV === null
        ? 0
        : Math.min(100, (busBVoltageV / 11_000) * 100),
    ],
    [
      "冷却母线",
      cooling?.observed.averageCoolantTemperatureK === null ||
      cooling?.observed.averageCoolantTemperatureK === undefined
        ? "读数建立中"
        : `${cooling.observed.averageCoolantTemperatureK.toFixed(1)} K`,
      state &&
      cooling?.observed.totalRadiatedPowerW !== null &&
      cooling?.observed.totalRadiatedPowerW !== undefined
        ? Math.min(
            100,
            (state.thermal.internalHeatKw /
              Math.max(
                cooling.observed.totalRadiatedPowerW / 1_000,
                1,
              )) *
              100,
          )
        : 0,
    ],
    ringNetwork("A 环", observedRingA),
    ringNetwork("B 环", observedRingB),
    airHandlerNetwork("A"),
    airHandlerNetwork("B"),
    waterProcessorNetwork("a"),
    waterProcessorNetwork("b"),
    [
      "大气总压",
      compartments?.observedPressureAveragePa === null ||
      compartments?.observedPressureAveragePa === undefined
        ? "读数建立中"
        : `${(compartments.observedPressureAveragePa / 1_000).toFixed(1)} kPa`,
      compartments?.observedPressureAveragePa === null ||
      compartments?.observedPressureAveragePa === undefined
        ? 0
        : Math.min(
            100,
            (compartments.observedPressureAveragePa / 101_325) * 100,
          ),
    ],
    [
      "净水回收",
      state ? `${(state.water.recyclerEfficiency * 100).toFixed(1)}%` : "98.1%",
      state ? state.water.recyclerEfficiency * 100 : 81,
    ],
    [
      "维修与备件",
      maintenance
        ? maintenance.activeTasks.length > 0
          ? `${maintenance.activeTasks.length} 项进行中 · ${Math.round(maintenanceProgressPercent)}%`
          : `待命 · ${Object.values(maintenance.inventory).reduce((total, quantity) => total + quantity, 0)} 件备件`
        : "诊断总线建立中",
      maintenanceProgressPercent,
    ],
    [
      "外部辐射",
      state
        ? `${state.environment.radiationDoseRateMilliSievertsPerHour.toFixed(3)} mSv/h`
        : "0.012 mSv/h",
      state
        ? Math.min(
            100,
            state.environment.radiationDoseRateMilliSievertsPerHour * 20,
          )
        : 24,
    ],
  ];
  return (
    <section className="view-grid detail-view" aria-label="舰体系统">
      <div className="panel topology-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SYSTEM TOPOLOGY / 舰体网络</span>
            <h2>能量与生命保障拓扑</h2>
          </div>
          <StatusPill tone={overallTone}>
            {criticalZones > 0
              ? `${criticalZones} 区告警`
              : watchZones > 0
                ? `${watchZones} 区关注`
                : offlineZones > 0
                  ? "传感器建立中"
                  : "全域稳定"}
          </StatusPill>
        </div>
        <div className="topology-grid">
          <div className="topology-core">
            <span>聚变母线</span>
            <strong>
              {electrical?.observed.totalReactorOutputKw === null ||
              electrical?.observed.totalReactorOutputKw === undefined
                ? "读数建立中"
                : `${(electrical.observed.totalReactorOutputKw / 1_000).toFixed(0)} MW`}
            </strong>
          </div>
          {["A 环", "B 环", "工程脊柱", "休眠舱群"].map((label, index) => (
            <div
              className={`topology-node topology-node-${index + 1}`}
              key={label}
            >
              <span>{label}</span>
              <i />
            </div>
          ))}
        </div>
      </div>
      <div className="panel network-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">LIVE NETWORKS</span>
            <h2>实时负载</h2>
          </div>
        </div>
        <div className="network-list">
          {networks.map(([name, value, load]) => (
            <div className="network-row" key={name}>
              <span>{name}</span>
              <div className="meter">
                <i style={{ width: `${load}%` }} />
              </div>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <p className="panel-note">
          {maintenance?.activeTasks[0]
            ? `${maintenance.activeTasks[0].id} · ${maintenance.activeTasks[0].assetId} · ${maintenance.activeTasks[0].assignedRobotId} / ${maintenance.activeTasks[0].assignedCrewId}${maintenance.activeTasks[0].blockedReason ? ` · 阻塞：${maintenance.activeTasks[0].blockedReason}` : ""}`
            : maintenance
              ? "维修机器人待命；备件只会在任务创建时锁定并消耗。"
              : "正在连接维修诊断与备件账本。"}
        </p>
      </div>
      <div className="panel sector-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">PRESSURE SECTORS</span>
            <h2>48 个主要压力区</h2>
          </div>
        </div>
        <div className="sector-matrix">
          {(compartments?.zones ??
            Array.from({ length: 48 }, (_, index) => ({
              zoneId: `${index < 24 ? "A" : "B"}-${String(
                (index % 24) + 1,
              ).padStart(2, "0")}`,
              condition: "offline" as const,
              hasBreach: false,
              observed: { pressurePa: null },
            }))).map((zone) => (
            <span
              key={zone.zoneId}
              className={`sector-${zone.condition}`}
              role="img"
              tabIndex={0}
              aria-label={`${zone.zoneId}，${
                zone.observed.pressurePa === null
                  ? "压力遥测等待中"
                  : `压力 ${(zone.observed.pressurePa / 1_000).toFixed(2)} 千帕，状态 ${zone.condition}`
              }`}
              title={`${zone.zoneId} · ${
                zone.observed.pressurePa === null
                  ? "压力遥测等待中"
                  : `${(zone.observed.pressurePa / 1_000).toFixed(2)} kPa`
              }`}
            />
          ))}
        </div>
        <p className="panel-note">
          {compartments
            ? compartments.fidelityLimited
              ? `局部瞬态求解已接管：时间倍率由 ${compartments.requestedTimeScale.toLocaleString("zh-CN")}× 自动限至 ${compartments.effectiveTimeScale.toLocaleString("zh-CN")}×；外逸气体 ${compartments.totalVentedGasKg.toFixed(2)} kg。`
              : `传感压力 ${
                  compartments.observedPressureMinPa === null
                    ? "等待首批延迟读数"
                    : `${(compartments.observedPressureMinPa / 1_000).toFixed(2)}–${((compartments.observedPressureMaxPa ?? 0) / 1_000).toFixed(2)} kPa`
                }；当前采用 ${compartments.fidelityMode === "equilibrium-fast" ? "平衡态快速求解" : "瞬态细分求解"}。`
            : "正在连接 48 区压力遥测总线。"}
        </p>
      </div>
    </section>
  );
}

function PeopleView({
  state,
  highlights,
  privateNotes,
}: {
  state: ShipState | null;
  highlights: PassengerHighlightTelemetry[];
  privateNotes: KeyPassengerPrivateNote[];
}) {
  const total = state?.population.total ?? 2_120;
  const awake = state?.population.awake ?? 218;
  const hibernating = state?.population.hibernating ?? 1_902;
  const health = (state?.population.averageHealth ?? 0.985) * 100;
  const morale = state?.population.averageMorale ?? 0.82;
  const privateNoteByPassengerId = new Map(
    privateNotes.map((note) => [note.passengerId, note]),
  );
  const displayedPassengers =
    highlights.length > 0
      ? highlights.map((person) => {
          const privateNote = privateNoteByPassengerId.get(
            person.passengerId,
          );
          return {
          id: person.passengerId,
          name: person.name,
          role: person.occupation,
          cabin: person.cabinId,
          zoneId: person.zoneId,
          zoneCondition: person.zoneCondition,
          zoneObservation:
            person.lifeState === "hibernating"
              ? "休眠舱内 · 分配区非实时位置"
              : person.lifeState === "deceased"
                ? "个人区域记录已封存"
                : person.zoneObservedPressurePa === null
                  ? "区域遥测等待中"
                  : `${(person.zoneObservedPressurePa / 1_000).toFixed(1)} kPa · ${person.zoneObservationAgeSeconds?.toFixed(0) ?? "?"}s`,
          state:
            person.lifeState === "awake"
              ? "清醒"
              : person.lifeState === "hibernating"
                ? "休眠"
                : "死亡",
          trust: Math.round(person.trust * 100),
          note:
            person.lifeState === "deceased"
              ? "个人记录已封存"
              : privateNote
                ? `私人终端 · ${formatDuration(privateNote.createdAtSimulationSeconds)}：${privateNote.text.slice(0, 220)}`
                : `身体 ${(person.physicalHealth * 100).toFixed(0)}% · 压力 ${(person.stress * 100).toFixed(0)}% · 等待私人终端轮询`,
          };
        })
      : PASSENGERS.map((person) => ({
          ...person,
          id: `preview:${person.cabin}`,
          zoneId: "待映射",
          zoneCondition: "offline" as const,
          zoneObservation: "区域遥测等待中",
        }));
  return (
    <section className="view-grid people-view" aria-label="乘员状态">
      <div className="panel population-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">POPULATION / 个体持续模拟</span>
            <h2>{total.toLocaleString("zh-CN")} 名乘员</h2>
          </div>
          <StatusPill
            tone={
              health < 70
                ? "critical"
                : health < 90
                  ? "watch"
                  : "nominal"
            }
          >
            {health < 70 ? "医疗告警" : health < 90 ? "需要关注" : "医疗稳定"}
          </StatusPill>
        </div>
        <div className="population-orbit">
          <div className="population-core">
            <strong>{awake.toLocaleString("zh-CN")}</strong>
            <span>当前清醒</span>
          </div>
          <div className="orbit-ring orbit-one" />
          <div className="orbit-ring orbit-two" />
          <span className="population-tag tag-awake">
            {((awake / total) * 100).toFixed(1)}% 清醒
          </span>
          <span className="population-tag tag-sleep">
            {hibernating.toLocaleString("zh-CN")} 休眠
          </span>
          <span className="population-tag tag-care">
            {(state?.population.deceased ?? 0).toLocaleString("zh-CN")} 死亡
          </span>
        </div>
        <div className="population-metrics">
          <div>
            <span>群体健康</span>
            <strong>{health.toFixed(1)}%</strong>
          </div>
          <div>
            <span>社会压力</span>
            <strong>{morale > 0.75 ? "中低" : morale > 0.5 ? "偏高" : "危险"}</strong>
          </div>
          <div>
            <span>休眠舱占用</span>
            <strong>
              {(state?.hibernation.occupiedPods ?? 1_902).toLocaleString("zh-CN")}
            </strong>
          </div>
        </div>
      </div>
      <div className="panel passenger-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">KEY PASSENGERS / 固定关键槽位 32</span>
            <h2>关键乘客观察</h2>
          </div>
        </div>
        <div className="passenger-list">
          {displayedPassengers.map((passenger) => (
            <article className="passenger-row" key={passenger.id}>
              <div className="avatar">{passenger.name.slice(0, 1)}</div>
              <div>
                <strong>{passenger.name}</strong>
                <span>
                  {passenger.role} · {passenger.cabin} ·{" "}
                  {passenger.zoneId}
                </span>
                <p>{passenger.note}</p>
              </div>
              <div className="passenger-state">
                <StatusPill
                  tone={
                    passenger.state === "死亡" ||
                    (passenger.state === "清醒" &&
                      passenger.zoneCondition === "critical")
                      ? "critical"
                      : passenger.state === "清醒" &&
                          passenger.zoneCondition === "nominal"
                        ? "nominal"
                        : "watch"
                  }
                >
                  {passenger.state === "清醒" &&
                  passenger.zoneCondition === "critical"
                    ? "清醒 · 区域危险"
                    : passenger.state === "清醒" &&
                        passenger.zoneCondition === "watch"
                      ? "清醒 · 区域关注"
                      : passenger.state}
                </StatusPill>
                <span>信任 {passenger.trust}</span>
                <span>
                  {passenger.state === "休眠"
                    ? "休眠舱生命保障"
                    : passenger.state === "死亡"
                      ? "区域记录封存"
                      : `区域 ${
                          passenger.zoneCondition === "nominal"
                            ? "正常"
                            : passenger.zoneCondition === "watch"
                              ? "关注"
                              : passenger.zoneCondition === "critical"
                                ? "危险"
                                : "离线"
                        }`}
                </span>
                <span>{passenger.zoneObservation}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function AiView({
  status,
  callPhase,
  commandBus,
}: {
  status: LlmRuntimeStatus | null;
  callPhase: LlmCallPhase;
  commandBus: CommandBusTelemetry | null;
}) {
  const configuredSlotCount =
    status?.agents.filter((agent) => agent.state !== "missing-secret")
      .length ?? 0;
  const configuredDepartmentCount =
    status?.agents.filter(
      (agent) =>
        AI_ROSTER.some((department) => department.id === agent.id) &&
        agent.state !== "missing-secret",
    ).length ?? 0;
  return (
    <section className="view-grid ai-view" aria-label="固定多模型观察">
      <div className="panel ai-roster-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">FIXED INTELLIGENCE / 固定拓扑</span>
            <h2>舰载智能组织</h2>
          </div>
          <StatusPill tone={status?.ready ? "nominal" : "watch"}>
            8 部门 + 32 关键乘客
          </StatusPill>
        </div>
        <div className="ai-roster">
          {AI_ROSTER.map((agent, index) => {
            const runtime = status?.agents.find(
              (candidate) => candidate.id === agent.id,
            );
            const runtimeLabel =
              runtime?.state === "ready"
                ? "端点就绪"
                : runtime?.state === "retrying"
                  ? "持续重试中"
                  : runtime?.state === "missing-secret"
                    ? "缺少服务端密钥"
                    : "检测配置";
            return (
              <article
                className={`ai-agent ${index === 0 ? "ai-captain" : ""} agent-${runtime?.state ?? "checking"}`}
                key={agent.id}
              >
                <div className="ai-glyph">
                  {index === 0 ? "C" : `D${index}`}
                </div>
                <div>
                  <span>{agent.role}</span>
                  <strong>{agent.name}</strong>
                  <p>{runtimeLabel}</p>
                </div>
                <div className="ai-agent-meta">
                  <span>{agent.model}</span>
                  <small>
                    系统信息：
                    {runtime
                      ? formatCadence(
                          runtime.routine.systemInfoIntervalSimSeconds,
                        )
                      : agent.cadence}
                  </small>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="panel thought-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">OBSERVER LOG / 不可篡改</span>
            <h2>模型调用观察</h2>
          </div>
          <span className="live-mark">
            {callPhase === "waiting"
              ? "CALLING"
              : callPhase === "error"
                ? "BLOCKED"
                : status?.ready
                  ? "READY"
                  : "LOCAL"}
          </span>
        </div>
        <div className="thought-stream">
          <div className="thought-line">
            <span>PRECHECK</span>
            <p>
              固定组织拓扑已锁定；运行期间不存在创建、复制或提升新
              LLM 的接口。
            </p>
          </div>
          <div className="thought-line">
            <span>CONFIG</span>
            <p>
              {status
                ? `${configuredSlotCount} / ${status.fixedAgentCount} 个固定模型槽位已具备服务端密钥。`
                : "正在读取本机服务器的模型配置状态。"}
            </p>
          </div>
          <div className="thought-line accent">
            <span>POLICY</span>
            <p>
              {status?.ready
                ? callPhase === "waiting"
                  ? "关键模型调用进行中，仿真时间已冻结；界面与重试状态继续响应。"
                  : "所有固定部门可调用；每个角色仍只能读取自身获授权的观测。"
                : "模型不可用时关键决策保持暂停，确定性安全控制器继续维持最后策略。"}
            </p>
          </div>
        </div>
        <div className="usage-grid">
          <div>
            <span>固定槽位</span>
            <strong>{status?.fixedAgentCount ?? 8}</strong>
          </div>
          <div>
            <span>已配置部门</span>
            <strong>{configuredDepartmentCount} / 8</strong>
          </div>
          <div>
            <span>累计 Token</span>
            <strong>
              {status?.usage.totalTokens.toLocaleString("zh-CN") ?? "0"}
            </strong>
          </div>
        </div>
        <div className="command-audit">
          <div>
            <span>COMMAND BUS / REVISION</span>
            <strong>{commandBus?.revision ?? 0}</strong>
          </div>
          {(commandBus?.recentAudit ?? [])
            .slice()
            .reverse()
            .slice(0, 4)
            .map((entry) => (
              <article key={entry.sequence}>
                <span>
                  #{entry.sequence} · {entry.actor}
                </span>
                <strong>{entry.kind}</strong>
                <small
                  className={
                    entry.status === "succeeded"
                      ? "audit-success"
                      : "audit-rejected"
                  }
                >
                  {entry.status === "succeeded"
                    ? `接受 · r${entry.revisionAfter}`
                    : `拒绝 · r${entry.revisionBefore}`}
                </small>
              </article>
            ))}
          {(commandBus?.recentAudit.length ?? 0) === 0 && (
            <p>尚无世界内设备命令。</p>
          )}
        </div>
      </div>
    </section>
  );
}

function GodView({
  state,
  compartments,
  cooling,
  electrical,
  navigation,
  rotation,
  waterRecovery,
  maintenance,
  onCausalEvent,
  onOverride,
}: {
  state: ShipState | null;
  compartments: CompartmentTelemetry | null;
  cooling: CoolingTelemetry | null;
  electrical: ElectricalTelemetry | null;
  navigation: NavigationTelemetry | null;
  rotation: RotationTelemetry | null;
  waterRecovery: WaterRecoveryTelemetry | null;
  maintenance: MaintenanceTelemetry | null;
  onCausalEvent: (eventId: string, label: string) => void;
  onOverride: (
    field: (typeof FORCE_FIELDS)[number],
    value: number,
  ) => void;
}) {
  const [fieldId, setFieldId] = useState<ForceFieldId>(
    FORCE_FIELDS[0].id,
  );
  const selectedField =
    FORCE_FIELDS.find((field) => field.id === fieldId) ?? FORCE_FIELDS[0];
  const [value, setValue] = useState<string>(
    selectedField.defaultValue,
  );
  const parsedValue = Number(value);
  const valueIsValid = Number.isFinite(parsedValue) && parsedValue >= 0;

  const changeField = (nextId: ForceFieldId) => {
    const next =
      FORCE_FIELDS.find((field) => field.id === nextId) ?? FORCE_FIELDS[0];
    setFieldId(next.id);
    setValue(next.defaultValue);
  };

  return (
    <section className="view-grid god-view" aria-label="人工干预模式">
      <div className="panel god-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow danger">EXTERNAL AUTHORITY / 世界之外</span>
            <h2>人工干预模式</h2>
          </div>
          <StatusPill tone="critical">上帝权限</StatusPill>
        </div>
        <p className="god-intro">
          这里的操作不属于舰长可用能力。所有变化将登记为外部质量、能量或状态注入，
          随后的演化重新交还给物理引擎。
        </p>
        <div className="observer-truth-strip">
          <div>
            <span>世界真值 / 平均舱压</span>
            <strong>
              {state
                ? `${(state.atmosphere.pressurePa / 1_000).toFixed(3)} kPa`
                : "—"}
            </strong>
          </div>
          <div>
            <span>舰载观测 / 延迟均值</span>
            <strong>
              {compartments?.observedPressureAveragePa === null ||
              compartments?.observedPressureAveragePa === undefined
                ? "等待读数"
                : `${(compartments.observedPressureAveragePa / 1_000).toFixed(3)} kPa`}
            </strong>
          </div>
          <div>
            <span>物理实体 / 活动破口</span>
            <strong>{compartments?.activeBreaches ?? 0}</strong>
          </div>
          <div>
            <span>空气处理真值 / A·B 实际风量</span>
            <strong>
              {compartments
                ? compartments.airHandlers.truth
                    .map(
                      (handler) =>
                        `${handler.ring} ${(handler.actualFlowFraction * 100).toFixed(0)}% · ${handler.condition}`,
                    )
                    .join(" / ")
                : "—"}
            </strong>
          </div>
          <div>
            <span>水回收真值 / A·B 实际处理量</span>
            <strong>
              {waterRecovery
                ? waterRecovery.truth.processors
                    .map(
                      (processor) =>
                        `${processor.ring.toUpperCase()} ${(processor.actualThroughputKgPerSecond * 86_400).toFixed(0)} kg/d · ${processor.condition}`,
                    )
                    .join(" / ")
                : "—"}
            </strong>
          </div>
          <div>
            <span>维修真值 / 活动任务与剩余备件</span>
            <strong>
              {maintenance
                ? `${maintenance.activeTasks.length} 项 / ${Object.values(
                    maintenance.inventory,
                  ).reduce(
                    (total, quantity) => total + quantity,
                    0,
                  )} 件`
                : "—"}
            </strong>
          </div>
          <div>
            <span>热网络真值 / 最热点</span>
            <strong>
              {cooling
                ? `${cooling.truth.hottestNodeTemperatureK.toFixed(2)} K`
                : "—"}
            </strong>
          </div>
          <div>
            <span>电网真值 / 发电与缺供</span>
            <strong>
              {electrical
                ? `${(electrical.truth.generationPowerKw / 1_000).toFixed(1)} / ${(electrical.truth.unservedPowerKw / 1_000).toFixed(1)} MW`
                : "—"}
            </strong>
          </div>
          <div>
            <span>导航真值 / 动量闭合误差</span>
            <strong>
              {navigation
                ? `${navigation.truth.linearMomentumClosureErrorKgMPerS.toExponential(2)} kg·m/s`
                : "—"}
            </strong>
          </div>
          <div>
            <span>旋转真值 / A·B 居住重力</span>
            <strong>
              {rotation
                ? rotation.truth.rings
                    .map(
                      (ring) =>
                        `${ring.id === "ring-a" ? "A" : "B"} ${ring.artificialGravityG.toFixed(4)} g`,
                    )
                    .join(" · ")
                : "—"}
            </strong>
          </div>
          <div>
            <span>旋转真值 / 净相对角动量</span>
            <strong>
              {rotation
                ? `${rotation.truth.netRelativeRingAngularMomentumKgM2PerS.toExponential(2)} kg·m²/s`
                : "—"}
            </strong>
          </div>
          <div>
            <span>旋转真值 / 轴承与结构振动</span>
            <strong>
              {rotation
                ? rotation.truth.rings
                    .map(
                      (ring) =>
                        `${ring.id === "ring-a" ? "A" : "B"} ${ring.bearingCondition} · ${ring.vibrationMmPerS.toFixed(2)} mm/s`,
                    )
                    .join(" / ")
                : "—"}
            </strong>
          </div>
        </div>
        <div className="intervention-grid">
          {[
            [
              "micrometeoroid",
              "微流星体撞击",
              "向外壳注入动量并形成等效微破口",
            ],
            [
              "coolant-pump-seizure",
              "冷却泵卡死",
              "将真实泵转子锁为停转并由回路重新计算流量",
            ],
            [
              "stellar-flare",
              "恒星耀斑",
              "注入外部辐射与粒子沉积产生的热负荷",
            ],
            [
              "fusion-reactor-trip",
              "聚变堆保护跳闸",
              "触发真实堆保护与发电机断路器断开",
            ],
            [
              "ring-bearing-degradation",
              "居住环轴承劣化",
              "令A环真实轴承进入劣化状态，后续振动、摩擦与废热由物理链路演化",
            ],
            [
              "air-handler-trip",
              "空气处理机跳停",
              "令A环处理机实体跳停，后续环路混合与CO₂积累由分舱物理演化",
            ],
            [
              "water-processor-trip",
              "水回收机跳停",
              "令A环水回收机实体跳停，后续净水消耗、废水积累与浓盐水产物由水网络演化",
            ],
            [
              "passenger-emergency",
              "乘客急症",
              "从持久化乘员名册选择清醒个体并写入病例",
            ],
          ].map(([eventId, label, detail]) => (
            <button
              className="event-button"
              key={label}
              onClick={() => onCausalEvent(eventId, label)}
              type="button"
            >
              <span>触发事件</span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="panel override-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">DIRECT OVERRIDE</span>
            <h2>原力覆写</h2>
          </div>
        </div>
        <label>
          目标字段
          <select
            value={fieldId}
            onChange={(event) =>
              changeField(event.target.value as ForceFieldId)
            }
          >
            {FORCE_FIELDS.map((field) => (
              <option value={field.id} key={field.id}>
                {field.label} / {field.unit}
              </option>
            ))}
          </select>
        </label>
        <label>
          新数值
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
          />
        </label>
        {!valueIsValid && (
          <small className="field-error">仅接受有限的非负数值</small>
        )}
        <button
          className="override-button"
          onClick={() => onOverride(selectedField, parsedValue)}
          type="button"
          disabled={!valueIsValid}
        >
          写入外部状态
        </button>
        <div className="observer-lock">
          <span>LLM 内部状态</span>
          <strong>仅观测 · 禁止覆写</strong>
        </div>
      </div>
    </section>
  );
}

export function MissionControl() {
  const [activeView, setActiveView] = useState<ViewId>("voyage");
  const [missionStarted, setMissionStarted] = useState(false);
  const [paused, setPaused] = useState(true);
  const [timeScale, setTimeScale] = useState(60);
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
  const [toast, setToast] = useState("");
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
    <main className="game-shell">
      <div className="noise-layer" />
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
            {[1, 60, 3_600, 21_600].map((scale) => (
              <button
                className={timeScale === scale ? "active" : ""}
                aria-pressed={timeScale === scale}
                key={scale}
                onClick={() => setTimeScale(scale)}
                type="button"
              >
                {scale === 1
                  ? "1×"
                  : scale === 60
                    ? "60×"
                    : scale === 3_600
                      ? "1H/s"
                      : "6H/s"}
              </button>
            ))}
            <button
              className="pause-button"
              onClick={() => setPaused((value) => !value)}
              type="button"
              disabled={
                !missionStarted ||
                missionEnded ||
                llmCallPhase === "waiting"
              }
            >
              {missionEnded
                ? "已抵达"
                : llmCallPhase === "waiting"
                  ? "AI 决策"
                  : paused
                    ? "继续"
                    : "暂停"}
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
        <div className="event-list">
          {events.slice(0, 8).map((event) => (
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
            {missionStarted
              ? "正在根据最高指令调整系统信息周期与首段跃迁决策。"
              : "已完成全舰态势建模，等待人类签发唯一最高指令。"}
          </p>
          <div>
            <span>下次系统信息</span>
            <strong>由 AI 自主设置</strong>
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
