/**
 * 舰长决策「演出」阶段机：只记录已真实发生的事件，禁止预测性推进。
 * 世界冻结语义由 mission-control 的 llm-waiting 令牌负责；本模块不触碰时间控制。
 */

export const DECISION_THEATER_STAGE_ORDER = [
  "world_frozen",
  "reading_observation",
  "captain_deliberating",
  "consulting_departments",
  "captain_final",
  "dispatching_commands",
  "world_resumed",
] as const;

export type DecisionTheaterTrackStage =
  (typeof DECISION_THEATER_STAGE_ORDER)[number];

export type DecisionTheaterStageId =
  | "idle"
  | DecisionTheaterTrackStage
  | "aborted"
  | "failed";

export type DecisionTheaterUtterance = {
  sequence: number;
  round: number;
  departmentId: string;
  role: string;
  text: string;
  wallClockAtMs: number;
};

export type DecisionTheaterCommandReceipt = {
  ordinal: number;
  toolName: string;
  status: string;
  summary: string;
  wallClockAtMs: number;
};

export type DecisionTheaterState = {
  active: boolean;
  cycleToken: number | null;
  freezeSimulationSeconds: number | null;
  wallClockStartedAtMs: number | null;
  triggerReason: string;
  stage: DecisionTheaterStageId;
  plannedDepartmentIds: readonly string[];
  plannedRounds: number;
  consultationQuestion: string | null;
  utterances: readonly DecisionTheaterUtterance[];
  captainPass: "initial" | "final" | null;
  captainText: string;
  worldCommandTotal: number;
  dispatchedOrdinal: number | null;
  dispatchedToolName: string | null;
  receipts: readonly DecisionTheaterCommandReceipt[];
  errorMessage: string | null;
};

export type DecisionTheaterEvent =
  | {
      type: "start";
      cycleToken: number;
      freezeSimulationSeconds: number;
      triggerReason: string;
      wallClockStartedAtMs: number;
    }
  | { type: "reading_observation"; cycleToken: number }
  | {
      type: "captain_deliberating";
      cycleToken: number;
      pass: "initial" | "final";
    }
  | {
      type: "consultation_planned";
      cycleToken: number;
      departmentIds: readonly string[];
      question: string;
      rounds: number;
    }
  | {
      type: "department_spoke";
      cycleToken: number;
      round: number;
      departmentId: string;
      role: string;
      text: string;
      wallClockAtMs: number;
    }
  | {
      type: "captain_decided";
      cycleToken: number;
      text: string;
      worldCommandTotal: number;
    }
  | {
      type: "command_dispatched";
      cycleToken: number;
      ordinal: number;
      toolName: string;
      total: number;
    }
  | {
      type: "command_receipt";
      cycleToken: number;
      ordinal: number;
      toolName: string;
      status: string;
      summary: string;
      wallClockAtMs: number;
    }
  | { type: "world_resumed"; cycleToken: number }
  | { type: "abort"; cycleToken?: number | null }
  | { type: "fail"; cycleToken: number; message: string }
  | { type: "clear" };

export const IDLE_DECISION_THEATER_STATE: DecisionTheaterState = Object.freeze({
  active: false,
  cycleToken: null,
  freezeSimulationSeconds: null,
  wallClockStartedAtMs: null,
  triggerReason: "",
  stage: "idle",
  plannedDepartmentIds: Object.freeze([]),
  plannedRounds: 0,
  consultationQuestion: null,
  utterances: Object.freeze([]),
  captainPass: null,
  captainText: "",
  worldCommandTotal: 0,
  dispatchedOrdinal: null,
  dispatchedToolName: null,
  receipts: Object.freeze([]),
  errorMessage: null,
});

const STAGE_RANK: Readonly<Record<DecisionTheaterTrackStage, number>> = {
  world_frozen: 0,
  reading_observation: 1,
  captain_deliberating: 2,
  consulting_departments: 3,
  captain_final: 4,
  dispatching_commands: 5,
  world_resumed: 6,
};

export function decisionTheaterStageLabel(
  stage: DecisionTheaterStageId,
): string {
  switch (stage) {
    case "world_frozen":
      return "世界冻结";
    case "reading_observation":
      return "读取观测";
    case "captain_deliberating":
      return "舰长研判";
    case "consulting_departments":
      return "部门会议";
    case "captain_final":
      return "舰长终裁";
    case "dispatching_commands":
      return "下发命令";
    case "world_resumed":
      return "世界解冻";
    case "aborted":
      return "已中止";
    case "failed":
      return "决策失败";
    default:
      return "待命";
  }
}

export function decisionTheaterHeadline(
  state: DecisionTheaterState,
): string {
  if (!state.active && state.stage === "idle") {
    return "无进行中的舰长决策";
  }
  switch (state.stage) {
    case "world_frozen":
      return "世界已冻结 · 等待舰长读取授权观测";
    case "reading_observation":
      return "舰长正在读取冻结时刻的授权观测";
    case "captain_deliberating":
      return state.captainPass === "final"
        ? "舰长正在形成终裁"
        : "舰长正在研判局势";
    case "consulting_departments": {
      const count = state.plannedDepartmentIds.length;
      const spoken = state.utterances.length;
      if (spoken === 0) {
        return count > 0
          ? `召集 ${count} 个部门开会（共 ${state.plannedRounds} 轮）`
          : "部门会议进行中";
      }
      const latest = state.utterances[state.utterances.length - 1];
      return `第 ${latest.round} 轮 · ${latest.role} 已发言（${spoken}）`;
    }
    case "captain_final":
      return "部门会议结束 · 舰长终裁中";
    case "dispatching_commands": {
      if (state.dispatchedOrdinal === null) {
        return state.worldCommandTotal > 0
          ? `准备下发 ${state.worldCommandTotal} 条世界命令`
          : "无世界命令 · 准备解冻";
      }
      const done = state.receipts.length;
      return `命令 ${state.dispatchedOrdinal}/${state.worldCommandTotal} · ${state.dispatchedToolName ?? "执行"} · 回执 ${done}`;
    }
    case "world_resumed":
      return "世界命令队列完成 · 仿真恢复流动";
    case "aborted":
      return "本轮决策已中止 · 演出收场";
    case "failed":
      return state.errorMessage
        ? `决策失败：${state.errorMessage}`
        : "决策失败";
    default:
      return "待命";
  }
}

export function isDecisionTheaterTrackStage(
  stage: DecisionTheaterStageId,
): stage is DecisionTheaterTrackStage {
  return (DECISION_THEATER_STAGE_ORDER as readonly string[]).includes(stage);
}

function acceptsCycle(
  state: DecisionTheaterState,
  cycleToken: number,
): boolean {
  return state.active && state.cycleToken === cycleToken;
}

function advanceStage(
  state: DecisionTheaterState,
  next: DecisionTheaterTrackStage,
): DecisionTheaterStageId {
  if (!isDecisionTheaterTrackStage(state.stage)) {
    return next;
  }
  return STAGE_RANK[next] >= STAGE_RANK[state.stage] ? next : state.stage;
}

export function reduceDecisionTheater(
  state: DecisionTheaterState,
  event: DecisionTheaterEvent,
): DecisionTheaterState {
  switch (event.type) {
    case "clear":
      return IDLE_DECISION_THEATER_STATE;

    case "abort": {
      if (
        event.cycleToken != null &&
        state.cycleToken !== null &&
        state.cycleToken !== event.cycleToken
      ) {
        return state;
      }
      if (!state.active && state.stage === "idle") {
        return state;
      }
      return {
        ...IDLE_DECISION_THEATER_STATE,
      };
    }

    case "start":
      return {
        active: true,
        cycleToken: event.cycleToken,
        freezeSimulationSeconds: event.freezeSimulationSeconds,
        wallClockStartedAtMs: event.wallClockStartedAtMs,
        triggerReason: event.triggerReason,
        stage: "world_frozen",
        plannedDepartmentIds: [],
        plannedRounds: 0,
        consultationQuestion: null,
        utterances: [],
        captainPass: null,
        captainText: "",
        worldCommandTotal: 0,
        dispatchedOrdinal: null,
        dispatchedToolName: null,
        receipts: [],
        errorMessage: null,
      };

    case "reading_observation": {
      if (!acceptsCycle(state, event.cycleToken)) return state;
      return {
        ...state,
        stage: advanceStage(state, "reading_observation"),
      };
    }

    case "captain_deliberating": {
      if (!acceptsCycle(state, event.cycleToken)) return state;
      const stage =
        event.pass === "final"
          ? advanceStage(state, "captain_final")
          : advanceStage(state, "captain_deliberating");
      return {
        ...state,
        stage,
        captainPass: event.pass,
      };
    }

    case "consultation_planned": {
      if (!acceptsCycle(state, event.cycleToken)) return state;
      return {
        ...state,
        stage: advanceStage(state, "consulting_departments"),
        plannedDepartmentIds: [...event.departmentIds],
        plannedRounds: event.rounds,
        consultationQuestion: event.question,
      };
    }

    case "department_spoke": {
      if (!acceptsCycle(state, event.cycleToken)) return state;
      const utterance: DecisionTheaterUtterance = {
        sequence: state.utterances.length + 1,
        round: event.round,
        departmentId: event.departmentId,
        role: event.role,
        text: event.text,
        wallClockAtMs: event.wallClockAtMs,
      };
      return {
        ...state,
        stage: advanceStage(state, "consulting_departments"),
        utterances: [...state.utterances, utterance],
      };
    }

    case "captain_decided": {
      if (!acceptsCycle(state, event.cycleToken)) return state;
      return {
        ...state,
        captainText: event.text,
        worldCommandTotal: event.worldCommandTotal,
        stage:
          event.worldCommandTotal > 0
            ? advanceStage(state, "dispatching_commands")
            : advanceStage(state, "captain_final"),
      };
    }

    case "command_dispatched": {
      if (!acceptsCycle(state, event.cycleToken)) return state;
      return {
        ...state,
        stage: advanceStage(state, "dispatching_commands"),
        worldCommandTotal: event.total,
        dispatchedOrdinal: event.ordinal,
        dispatchedToolName: event.toolName,
      };
    }

    case "command_receipt": {
      if (!acceptsCycle(state, event.cycleToken)) return state;
      if (state.receipts.some((item) => item.ordinal === event.ordinal)) {
        return state;
      }
      const receipt: DecisionTheaterCommandReceipt = {
        ordinal: event.ordinal,
        toolName: event.toolName,
        status: event.status,
        summary: event.summary,
        wallClockAtMs: event.wallClockAtMs,
      };
      return {
        ...state,
        stage: advanceStage(state, "dispatching_commands"),
        receipts: [...state.receipts, receipt].sort(
          (left, right) => left.ordinal - right.ordinal,
        ),
      };
    }

    case "world_resumed": {
      if (!acceptsCycle(state, event.cycleToken)) return state;
      return {
        ...state,
        stage: "world_resumed",
        active: false,
      };
    }

    case "fail": {
      if (!acceptsCycle(state, event.cycleToken)) return state;
      return {
        ...state,
        active: false,
        stage: "failed",
        errorMessage: event.message,
      };
    }

    default:
      return state;
  }
}

export function formatFrozenSimulationClock(
  simulationSeconds: number | null,
): string {
  if (simulationSeconds === null || !Number.isFinite(simulationSeconds)) {
    return "—";
  }
  const total = Math.max(0, Math.floor(simulationSeconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) {
    return `T+${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `T+${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatFreezeWallDuration(
  startedAtMs: number | null,
  nowMs: number,
): string {
  if (startedAtMs === null || !Number.isFinite(startedAtMs)) {
    return "0s";
  }
  const elapsedMs = Math.max(0, Math.floor(nowMs - startedAtMs));
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}
