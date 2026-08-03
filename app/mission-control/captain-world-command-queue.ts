/**
 * Captain world-command queue: types + pure helpers.
 * React still owns Worker postMessage dispatch via injected callbacks.
 */

import type { ShipState } from "@/lib/sim";
import type { SimulationWorkerCommand } from "@/lib/sim/protocol";
import type { CaptainDeviceReceiptSummary, SystemTone } from "@/app/ui/types";
import { MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE } from "@/app/ui/constants";
import {
  parseCaptainWorldToolCall,
  type ShipWorldCommand,
} from "@/lib/llm/captain-world-tools";

export type QueuedCaptainWorldCommand = {
  ordinal: number;
  toolCallId: string;
  toolName: string;
  stableCommandId: string;
  command: ShipWorldCommand;
};

export type CaptainWorldCommandQueue = {
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

export const CAPTAIN_WORLD_COMMAND_HARD_STOP_HINT =
  "可解除暂停后继续观察；本轮后续命令已跳过";

export type CaptainWorldToolCallLike = {
  id: string;
  name: string;
  arguments: unknown;
};

export type JumpGuardObservation = {
  jumpBlocked: boolean;
  jumpBlockReason: string | null;
  jumpThermalClears: boolean | null;
  jumpThermalBlockReason: string | null;
};

export type CaptainWorldCommandQueueEvent = {
  text: string;
  tone: SystemTone;
};

export type EnqueueCaptainWorldCommandsResult = {
  queued: QueuedCaptainWorldCommand[];
  preliminaryReceipts: CaptainDeviceReceiptSummary[];
  overflowCount: number;
  events: CaptainWorldCommandQueueEvent[];
};

/** Soft reject → continue; hard reject → stop remaining. */
export function isSoftCaptainWorldCommandRejectContinuation(
  softReject: boolean,
): "continue" | "stop" {
  return softReject ? "continue" : "stop";
}

export function createCaptainWorldCommandQueue(input: {
  cycleToken: number;
  worldEpoch: number;
  triggerKey: string;
  callId: string;
  commands: QueuedCaptainWorldCommand[];
  receipts?: CaptainDeviceReceiptSummary[];
  advancesRoutineSchedule: boolean;
  resumeAfterCompletion?: boolean;
}): CaptainWorldCommandQueue {
  return {
    cycleToken: input.cycleToken,
    worldEpoch: input.worldEpoch,
    triggerKey: input.triggerKey,
    callId: input.callId,
    commands: input.commands,
    nextIndex: 0,
    activeRequestId: null,
    receipts: input.receipts ? [...input.receipts] : [],
    advancesRoutineSchedule: input.advancesRoutineSchedule,
    resumeAfterCompletion: input.resumeAfterCompletion ?? false,
  };
}

/**
 * Parse LLM world tool calls into a bounded serial queue (+ invalid/limit receipts).
 */
export function enqueueCaptainWorldCommandsFromToolCalls(input: {
  allToolCalls: readonly CaptainWorldToolCallLike[];
  worldToolCalls: readonly CaptainWorldToolCallLike[];
  captainCallId: string;
  journeyStatus: ShipState["journey"]["status"];
  trueRemainingDistance: number;
  jumpGuards: JumpGuardObservation;
  maxCommands?: number;
}): EnqueueCaptainWorldCommandsResult {
  const maxCommands =
    input.maxCommands ?? MAX_CAPTAIN_WORLD_COMMANDS_PER_CYCLE;
  const boundedWorldToolCalls = input.worldToolCalls.slice(0, maxCommands);
  const queued: QueuedCaptainWorldCommand[] = [];
  const preliminaryReceipts: CaptainDeviceReceiptSummary[] = [];
  const events: CaptainWorldCommandQueueEvent[] = [];

  for (const toolCall of boundedWorldToolCalls) {
    const ordinal =
      input.allToolCalls.findIndex(
        (candidate) => candidate.id === toolCall.id,
      ) + 1;
    const parsed = parseCaptainWorldToolCall(
      toolCall,
      input.journeyStatus,
      input.trueRemainingDistance,
      {
        jumpBlocked: input.jumpGuards.jumpBlocked,
        jumpBlockReason: input.jumpGuards.jumpBlockReason,
        jumpThermalClears: input.jumpGuards.jumpThermalClears,
        jumpThermalBlockReason: input.jumpGuards.jumpThermalBlockReason,
      },
    );
    if (!parsed.ok) {
      preliminaryReceipts.push({
        ordinal,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        commandKind: null,
        status: "invalid",
        summary: parsed.reason,
      });
      events.push({
        text: `${toolCall.name} 未进入执行队列：${parsed.reason}。`,
        tone: "watch",
      });
      continue;
    }
    queued.push({
      ordinal,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      stableCommandId: `${input.captainCallId}:${toolCall.id}:${ordinal}`,
      command: parsed.command,
    });
  }

  const overflowCount = Math.max(
    0,
    input.worldToolCalls.length - maxCommands,
  );
  if (overflowCount > 0) {
    preliminaryReceipts.push({
      ordinal: maxCommands + 1,
      toolCallId: "queue-limit",
      toolName: "world-command-overflow",
      commandKind: null,
      status: "limit",
      summary: `${overflowCount} 条世界工具调用超过每轮 ${maxCommands} 条上限`,
    });
    events.push({
      text: `${overflowCount} 条世界工具调用超过每轮 ${maxCommands} 条上限，均未进入执行队列。`,
      tone: "watch",
    });
  }

  return { queued, preliminaryReceipts, overflowCount, events };
}

export function recordAcceptedCaptainWorldCommand(
  queue: CaptainWorldCommandQueue,
  summary: string,
): QueuedCaptainWorldCommand {
  const item = queue.commands[queue.nextIndex];
  queue.receipts.push({
    ordinal: item.ordinal,
    toolCallId: item.toolCallId,
    toolName: item.toolName,
    commandKind: item.command.kind,
    status: "accepted",
    summary,
  });
  queue.nextIndex += 1;
  queue.activeRequestId = null;
  return item;
}

export function applyCaptainWorldCommandSoftReject(
  queue: CaptainWorldCommandQueue,
  message: string,
): QueuedCaptainWorldCommand {
  const failed = queue.commands[queue.nextIndex];
  queue.receipts.push({
    ordinal: failed.ordinal,
    toolCallId: failed.toolCallId,
    toolName: failed.toolName,
    commandKind: failed.command.kind,
    status: "rejected",
    summary: message,
  });
  queue.nextIndex += 1;
  queue.activeRequestId = null;
  return failed;
}

export function applyCaptainWorldCommandHardReject(
  queue: CaptainWorldCommandQueue,
  message: string,
  hardStopHint: string = CAPTAIN_WORLD_COMMAND_HARD_STOP_HINT,
): {
  failed: QueuedCaptainWorldCommand;
  skipped: QueuedCaptainWorldCommand[];
} {
  const failed = queue.commands[queue.nextIndex];
  queue.receipts.push({
    ordinal: failed.ordinal,
    toolCallId: failed.toolCallId,
    toolName: failed.toolName,
    commandKind: failed.command.kind,
    status: "rejected",
    summary: message,
  });
  const skipped = queue.commands.slice(queue.nextIndex + 1);
  for (const item of skipped) {
    queue.receipts.push({
      ordinal: item.ordinal,
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      commandKind: item.command.kind,
      status: "skipped",
      summary: `前序命令硬失败，队列已停止（${hardStopHint}）`,
    });
  }
  return { failed, skipped };
}

export function skipRemainingCaptainWorldCommands(
  queue: CaptainWorldCommandQueue,
  summary: string,
): QueuedCaptainWorldCommand[] {
  const skipped = queue.commands.slice(queue.nextIndex);
  for (const item of skipped) {
    queue.receipts.push({
      ordinal: item.ordinal,
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      commandKind: item.command.kind,
      status: "skipped",
      summary,
    });
  }
  queue.nextIndex = queue.commands.length;
  return skipped;
}

export function markCaptainWorldCommandDispatchUnavailable(
  queue: CaptainWorldCommandQueue,
): {
  failed: QueuedCaptainWorldCommand;
  skipped: QueuedCaptainWorldCommand[];
} {
  const failed = queue.commands[queue.nextIndex];
  queue.receipts.push({
    ordinal: failed.ordinal,
    toolCallId: failed.toolCallId,
    toolName: failed.toolName,
    commandKind: failed.command.kind,
    status: "rejected",
    summary: "物理引擎或状态修订尚不可用，命令队列停止",
  });
  const skipped = queue.commands.slice(queue.nextIndex + 1);
  for (const item of skipped) {
    queue.receipts.push({
      ordinal: item.ordinal,
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      commandKind: item.command.kind,
      status: "skipped",
      summary: "前序命令未能派发，队列按顺序停止",
    });
  }
  return { failed, skipped };
}

export function canDispatchNextCaptainWorldCommand(
  queue: CaptainWorldCommandQueue | null,
  opts: {
    worldEpoch: number;
    activePhysicsRequestId: string | null;
  },
): queue is CaptainWorldCommandQueue {
  return (
    queue !== null &&
    queue.activeRequestId === null &&
    queue.worldEpoch === opts.worldEpoch &&
    opts.activePhysicsRequestId === null
  );
}

export function isCaptainWorldCommandQueueExhausted(
  queue: CaptainWorldCommandQueue,
): boolean {
  return queue.nextIndex >= queue.commands.length;
}

export type DispatchCaptainWorldCommandDeps = {
  allocateRequestId: () => string;
  expectedRevision: number;
  expectedStateRevision: number;
  issuedAtMicroseconds: number;
  postShipCommand: (command: SimulationWorkerCommand) => void;
  setActivePhysicsRequestId: (requestId: string) => void;
};

/** Build + post the next ship-command via injected Worker callback. */
export function dispatchNextCaptainWorldCommandItem(
  queue: CaptainWorldCommandQueue,
  item: QueuedCaptainWorldCommand,
  deps: DispatchCaptainWorldCommandDeps,
): string {
  const requestId = deps.allocateRequestId();
  queue.activeRequestId = requestId;
  const command: SimulationWorkerCommand = {
    type: "ship-command",
    requestId,
    commandId: item.stableCommandId,
    idempotencyKey: item.stableCommandId,
    issuedAtMicroseconds: deps.issuedAtMicroseconds,
    expectedRevision: deps.expectedRevision,
    expectedStateRevision: deps.expectedStateRevision,
    command: item.command,
  };
  deps.setActivePhysicsRequestId(requestId);
  deps.postShipCommand(command);
  return requestId;
}
