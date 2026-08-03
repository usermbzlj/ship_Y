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
  HullConsequenceTelemetry,
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
import type { CaptainJournalSnapshot } from "@/lib/llm/captain-journal";
import type { CaptainWatchSnapshot } from "@/lib/llm/captain-watch";
import type { DepartmentStandingSnapshot } from "@/lib/llm/department-standing";
import type { DepartmentInboxSnapshot } from "@/lib/llm/department-inbox";
import type { PassengerSocietySnapshot } from "@/lib/llm/passenger-society";

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

export type LlmObservationOutcome = "ok" | "error" | "aborted";

export type LlmObservationCall = {
  callId: string;
  agentId: string;
  fromAgentId?: string;
  outcome: LlmObservationOutcome;
  attempts: number;
  startedAtEpochMs: number;
  completedAtEpochMs: number;
  promptSummary: string;
  responseSummary?: string;
  errorSummary?: string;
  finishReason?: string | null;
  toolNames?: readonly string[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  discussion?: {
    depth: number;
    round: number;
  };
  metadataIntent?: string;
};

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
  recentCalls: LlmObservationCall[];
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
  /** In-flight intervene requestId; rejection only attaches while this matches. */
  pendingRequestId: string | null;
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
  /** Soft note when some department advisors failed but the cycle continued. */
  consultationNote?: string;
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
  version: 24;
  activeView: ViewId;
  missionStarted: boolean;
  paused: boolean;
  timeScale: number;
  simulationSeconds: number;
  nextCaptainRoutineAtSimulationSeconds: number | null;
  origin: string;
  destination: string;
  directive: string;
  events: TimelineEvent[];
  keyPassengerLlm: KeyPassengerPollingSnapshot;
  captainJournal: CaptainJournalSnapshot;
  captainWatch: CaptainWatchSnapshot;
  departmentStanding: DepartmentStandingSnapshot;
  passengerSociety: PassengerSocietySnapshot;
  departmentInbox: DepartmentInboxSnapshot;
  runtimeSnapshot: RuntimeSimulationSnapshot | null;
  /** SHA-256 hex of canonical JSON excluding this field; sealed on write. */
  checksum?: string;
  /** IndexedDB slot id when persisted (`manual` / `auto-0`…). */
  slotId?: string;
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
  hullConsequence: HullConsequenceTelemetry | null;
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
  HullConsequenceTelemetry,
  MaintenanceTelemetry,
  NavigationTelemetry,
  PassengerHighlightTelemetry,
  RotationTelemetry,
  WaterRecoveryTelemetry,
  KeyPassengerPrivateNote,
  CaptainJournalSnapshot,
  CaptainWatchSnapshot,
  DepartmentStandingSnapshot,
  PassengerSocietySnapshot,
};
