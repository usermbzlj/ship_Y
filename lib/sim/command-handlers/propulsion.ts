/**
 * Propulsion and jump ship-command handlers.
 */

import type { CommandHandler } from "./types.ts";
import { jumpInterlockFailures } from "./helpers.ts";

export const handleExecuteJump: CommandHandler<"execute-jump"> = (
  command,
  context,
  executionId,
) => {
  const {
    engine,
    cooling,
    navigation,
    rotation,
    synchronizeJumpDriveControllerDemand,
    synchronizeElectricalAggregate,
    synchronizeThermalAggregate,
    currentRotationCarrierState,
  } = context;
  void executionId;
  const interlockFailures = jumpInterlockFailures(
    command.distanceLightYears, context);
  if (interlockFailures.length > 0) {
    throw new Error(
      `跃迁联锁拒绝：${interlockFailures.join("；")}`,
    );
  }
  const result = engine.executeJump(command.distanceLightYears);
  navigation.rebaseLocalFrameAfterJump(
    result.completedDistanceLightYears,
  );
  rotation.rebaseCarrierExchangeLedger(
    currentRotationCarrierState(),
  );
  synchronizeJumpDriveControllerDemand(60);
  synchronizeElectricalAggregate();
  cooling.applyExternalEnergy(
    "thermal-bus",
    result.wasteHeatJoules,
    "jump-drive",
  );
  synchronizeThermalAggregate();
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `跃迁设备完成 ${result.distanceLightYears.toFixed(2)} 光年空间跨越，并将废热交给冷却回路。`,
    distanceLightYears: result.distanceLightYears,
    energyConsumedKWh: result.energyConsumedKWh,
    journeyStatus: result.status,
  };
};

export const handleScheduleThrusterPulse: CommandHandler<"schedule-thruster-pulse"> = (
  command,
  context,
  executionId,
) => {
  const {
    navigation,
  } = context;
  if (
    !Number.isFinite(command.durationSeconds) ||
    command.durationSeconds <= 0 ||
    command.durationSeconds > 600
  ) {
    throw new RangeError(
      "thruster pulse duration must be greater than 0 and no more than 600 seconds",
    );
  }
  if (
    !Number.isFinite(command.startDelaySeconds) ||
    command.startDelaySeconds < 0 ||
    command.startDelaySeconds > 3_600
  ) {
    throw new RangeError(
      "thruster pulse delay must be between 0 and 3600 seconds",
    );
  }
  const scheduled = navigation.schedulePulse(
    command.thrusterId,
    command.throttleFraction,
    command.durationSeconds,
    {
      commandId: executionId,
      startDelaySeconds: command.startDelaySeconds,
    },
  );
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `推进器 ${command.thrusterId} 已排程在 ${command.startDelaySeconds.toFixed(1)} 秒后以 ${(command.throttleFraction * 100).toFixed(1)}% 节流工作 ${command.durationSeconds.toFixed(1)} 秒；实际冲量取决于推进剂、设备状态和联锁。`,
    thrusterId: command.thrusterId,
    scheduledCommandId: scheduled.id,
    throttleFraction: command.throttleFraction,
    durationSeconds: command.durationSeconds,
    startDelaySeconds: command.startDelaySeconds,
  };
};

export const handleScheduleThrusterManeuver: CommandHandler<"schedule-thruster-maneuver"> = (
  command,
  context,
  executionId,
) => {
  const {
    navigation,
  } = context;
  void executionId;
  if (
    !Array.isArray(command.pulses) ||
    command.pulses.length === 0 ||
    command.pulses.length > 18
  ) {
    throw new RangeError(
      "thruster maneuver must contain between 1 and 18 pulse plans",
    );
  }
  const scheduled = command.pulses.map((pulse, index) => {
    if (
      !Number.isFinite(pulse.durationSeconds) ||
      pulse.durationSeconds <= 0 ||
      pulse.durationSeconds > 600
    ) {
      throw new RangeError(
        `thruster pulse ${index + 1} duration must be greater than 0 and no more than 600 seconds`,
      );
    }
    if (
      !Number.isFinite(pulse.startDelaySeconds) ||
      pulse.startDelaySeconds < 0 ||
      pulse.startDelaySeconds > 3_600
    ) {
      throw new RangeError(
        `thruster pulse ${index + 1} delay must be between 0 and 3600 seconds`,
      );
    }
    return navigation.schedulePulse(
      pulse.thrusterId,
      pulse.throttleFraction,
      pulse.durationSeconds,
      {
        commandId: `${executionId}:pulse-${index + 1}`,
        startDelaySeconds: pulse.startDelaySeconds,
      },
    );
  });
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `已将 ${scheduled.length} 个推进器脉冲作为同一机动事务排入六自由度导航控制器；任一脉冲无效时整组不会提交。`,
    scheduledCommandIds: scheduled.map(
      (scheduledCommand) => scheduledCommand.id,
    ),
  };
};
