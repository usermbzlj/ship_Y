/**
 * 共享 UI 类型定义
 * 从 mission-control.tsx 提取的跨组件类型
 */

import type { ShipState } from "@/lib/sim";
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
  WaterRecoveryTelemetry,
} from "@/lib/sim/protocol";
import type {
  KeyPassengerPollingSnapshot,
  KeyPassengerPrivateNote,
} from "@/lib/llm/key-passenger-polling";

// ─── 视图与状态 ───────────────────────────────────────────────

export type ViewId = "voyage" | "ship" | "people" | "ai" | "god";
export type SystemTone = "nominal" | "watch" | "critical";
export type LlmCallPhase = "idle" | "waiting" | "error";

// ─── 时间线事件 ───────────────────────────────────────────────

export type TimelineEvent = {
  id: number;
  at: string;
  source: string;
  text: string;
  tone: SystemTone;
};

// ─── 系统卡片 ─────────────────────────────────────────────────

export type SystemCard = {
  name: string;
  value: string;
  detail: string;
  load: number;
  tone: SystemTone;
};

// ─── LLM 运行时状态 ──────────────────────────────────────────

export type LlmRuntimeStatus = {
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

// ─── LLM 调用结果 ─────────────────────────────────────────────

export type RoutineTicketReference = {
  callId: string;
  toolCallId: string;
  expiresAtEpochMs: number;
};

export type LlmInvokeResult = {
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

export type LlmInvokeRoutePayload = {
  result?: LlmInvokeResult;
  error?: { message?: string };
};

// ─── 上帝助手会话 ─────────────────────────────────────────────

export type GodAssistSessionHandle = {
  active: boolean;
  retried: boolean;
  onPhysicsRejection: ((message: string) => void) | null;
};

// ─── 舰长命令队列 ─────────────────────────────────────────────

export type CaptainDeviceReceiptStatus =
  | "accepted"
  | "rejected"
  | "invalid"
  | "limit"
  | "skipped";

export type CaptainDeviceReceiptSummary = {
  ordinal: number;
  toolCallId: string;
  toolName: string;
  commandKind: string | null;
  status: CaptainDeviceReceiptStatus;
  summary: string;
};

// ─── 舰长决策日志（可观察性） ─────────────────────────────────

export type DepartmentConsultation = {
  agentId: string;
  role: string;
  text: string;
};

export type CaptainDecisionEntry = {
  id: number;
  triggerKey: string;
  triggerReason: string;
  simulationSeconds: number;
  status: "thinking" | "decided" | "executing" | "done" | "error";
  captainText: string;
  consultations: DepartmentConsultation[];
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    arguments: unknown;
  }>;
  receipts: CaptainDeviceReceiptSummary[];
  errorMessage?: string;
};

// ─── 本地存档 ─────────────────────────────────────────────────

export type RuntimeSimulationSnapshot =
  import("@/lib/sim/protocol").RuntimeSimulationSnapshot;

export interface LocalSave {
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

// ─── 上帝模式 ─────────────────────────────────────────────────

export interface ForceField {
  id: string;
  label: string;
  path: string;
  unit: string;
  defaultValue: string;
}

// ─── 遥测聚合 Props ───────────────────────────────────────────

export interface SimTelemetry {
  state: ShipState | null;
  compartments: CompartmentTelemetry | null;
  cooling: CoolingTelemetry | null;
  electrical: ElectricalTelemetry | null;
  navigation: NavigationTelemetry | null;
  rotation: RotationTelemetry | null;
  waterRecovery: WaterRecoveryTelemetry | null;
  maintenance: MaintenanceTelemetry | null;
  commandBus: CommandBusTelemetry | null;
  passengerHighlights: PassengerHighlightTelemetry[];
  keyPassengerPrivateNotes: KeyPassengerPrivateNote[];
  finalReport: FinalJourneyReport | null;
}

// ─── Re-exports for convenience ───────────────────────────────

export type {
  ShipState,
  CommandBusTelemetry,
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  FinalJourneyReport,
  MaintenanceTelemetry,
  NavigationTelemetry,
  PassengerHighlightTelemetry,
  RotationTelemetry,
  WaterRecoveryTelemetry,
  KeyPassengerPrivateNote,
};
