/**
 * Electrical ship-command handlers.
 */

import type { CommandHandler } from "./types.ts";

export const handleSetReactorTarget: CommandHandler<"set-reactor-target"> = (
  command,
  context,
  executionId,
) => {
  const {
    electrical,
    synchronizeElectricalAggregate,
  } = context;
  void executionId;
  electrical.executeControlCommand({
    type: "set-reactor-target",
    reactorId: command.reactorId,
    targetOutputKw: command.targetOutputKw,
  });
  synchronizeElectricalAggregate();
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `聚变模块 ${command.reactorId} 的目标功率已设为 ${command.targetOutputKw.toFixed(0)} kW；输出将按真实爬坡率变化。`,
    reactorId: command.reactorId,
    targetOutputKw: command.targetOutputKw,
  };
};

export const handleSetReactorMode: CommandHandler<"set-reactor-mode"> = (
  command,
  context,
  executionId,
) => {
  const {
    electrical,
    synchronizeElectricalAggregate,
  } = context;
  void executionId;
  electrical.executeControlCommand({
    type: "set-reactor-mode",
    reactorId: command.reactorId,
    mode: command.mode,
  });
  synchronizeElectricalAggregate();
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `聚变模块 ${command.reactorId} 已切换为 ${command.mode}；并网输出仍受断路器、保护状态和真实爬坡率约束。`,
    reactorId: command.reactorId,
    reactorMode: command.mode,
  };
};

export const handleSetElectricalLoadEnabled: CommandHandler<"set-electrical-load-enabled"> = (
  command,
  context,
  executionId,
) => {
  const {
    electrical,
    synchronizeElectricalAggregate,
  } = context;
  void executionId;
  electrical.executeControlCommand({
    type: "set-load-enabled",
    loadId: command.loadId,
    enabled: command.enabled,
  });
  synchronizeElectricalAggregate();
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `电力负载 ${command.loadId} 已${command.enabled ? "投入" : "退出"}配电；供电结果由母线拓扑和功率分配决定。`,
    loadId: command.loadId,
    enabled: command.enabled,
  };
};

export const handleSetElectricalBreaker: CommandHandler<"set-electrical-breaker"> = (
  command,
  context,
  executionId,
) => {
  const {
    electrical,
    synchronizeElectricalAggregate,
  } = context;
  void executionId;
  electrical.executeControlCommand({
    type: "set-breaker",
    breakerId: command.breakerId,
    commandedClosed: command.commandedClosed,
  });
  synchronizeElectricalAggregate();
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `断路器 ${command.breakerId} 已收到${command.commandedClosed ? "合闸" : "分闸"}指令；保护跳闸锁存不会被该命令绕过。`,
    breakerId: command.breakerId,
    commandedClosed: command.commandedClosed,
  };
};

export const handleSetBatteryMode: CommandHandler<"set-battery-mode"> = (
  command,
  context,
  executionId,
) => {
  const {
    electrical,
    synchronizeElectricalAggregate,
  } = context;
  void executionId;
  electrical.executeControlCommand({
    type: "set-battery-mode",
    batteryId: command.batteryId,
    mode: command.mode,
  });
  synchronizeElectricalAggregate();
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `储能组 ${command.batteryId} 已切换为 ${command.mode} 控制模式；功率仍由荷电状态、额定功率和母线需求约束。`,
    batteryId: command.batteryId,
    batteryMode: command.mode,
  };
};

export const handleResetProtection: CommandHandler<"reset-protection"> = (
  command,
  context,
  executionId,
) => {
  const {
    electrical,
    synchronizeElectricalAggregate,
  } = context;
  void executionId;
  if (command.targetType === "reactor") {
    if (!command.reactorId) throw new Error("reactor reset requires reactorId");
    electrical.executeControlCommand({ type: "reset-reactor-trip", reactorId: command.reactorId });
    synchronizeElectricalAggregate();
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${command.reactorId} 保护锁存已复位至热备，仍需另行并网和升载。` };
  }
  if (!command.breakerId) throw new Error("breaker reset requires breakerId");
  electrical.executeControlCommand({ type: "reset-breaker-trip", breakerId: command.breakerId });
  synchronizeElectricalAggregate();
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${command.breakerId} 跳闸锁存已复位且保持分闸。` };
};

export const handleSetPowerAllocation: CommandHandler<"set-power-allocation"> = (
  command,
  context,
  executionId,
) => {
  const {
    electrical,
    captainOperations,
    synchronizeElectricalAggregate,
  } = context;
  void executionId;
  const limit = captainOperations.setPowerAllocation(command.loadId, command.maximumDemandFraction);
  const load = electrical.getLoad(command.loadId);
  electrical.synchronizeLoadControllerDemandFraction(
    command.loadId,
    Math.min(load.controllerDemandFraction, limit),
  );
  synchronizeElectricalAggregate();
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${command.loadId} 最大需求份额已设为 ${(limit * 100).toFixed(1)}%；后续控制请求不会越过该上限。`, loadId: command.loadId };
};
