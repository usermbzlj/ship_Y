/**
 * Thermal, habitat, atmosphere, and water ship-command handlers.
 */

import { effectiveHabitatThermalDeliveryFraction } from "../cooling.ts";
import { effectiveDeliveryFraction } from "../water.ts";
import type { CommandHandler } from "./types.ts";

export const handleIsolatePressureZone: CommandHandler<"isolate-pressure-zone"> = (
  command,
  context,
  executionId,
) => {
  const {
    compartments,
  } = context;
  void executionId;
  compartments.getZone(command.zoneId);
  const affectedConnections = compartments
    .listConnections()
    .filter(
      (connection) =>
        connection.zoneAId === command.zoneId ||
        connection.zoneBId === command.zoneId,
    );
  for (const connection of affectedConnections) {
    compartments.configureConnection(connection.id, {
      commandedOpenFraction: 0,
    });
  }
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `压力区 ${command.zoneId} 的 ${affectedConnections.length} 条舱门、风管与隔离连接已收到关闭命令；局部破口仍需后续维修。`,
    zoneId: command.zoneId,
    actuatedConnections: affectedConnections.length,
  };
};

export const handleSetCoolingPumpSpeed: CommandHandler<"set-cooling-pump-speed"> = (
  command,
  context,
  executionId,
) => {
  const {
    cooling,
    maintenance,
    synchronizeThermalAggregate,
  } = context;
  void executionId;
  const serviceLimit = maintenance.getAssetServiceLimitFraction(
    command.pumpId,
  );
  const commandedSpeedFraction = Math.min(
    command.commandedSpeedFraction,
    serviceLimit,
  );
  cooling.configurePump(command.pumpId, {
    commandedSpeedFraction,
  });
  synchronizeThermalAggregate();
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `冷却泵 ${command.pumpId} 的转速指令已设为 ${(commandedSpeedFraction * 100).toFixed(1)}%${commandedSpeedFraction < command.commandedSpeedFraction ? `（替代维修降额上限 ${(serviceLimit * 100).toFixed(1)}%）` : ""}；实际流量仍受泵体故障与回路状态限制。`,
    pumpId: command.pumpId,
    commandedSpeedFraction,
  };
};

export const handleSetHabitatRingControl: CommandHandler<"set-habitat-ring-control"> = (
  command,
  context,
  executionId,
) => {
  const {
    rotation,
  } = context;
  void executionId;
  if (
    !Number.isFinite(command.targetRelativeRpm) ||
    command.targetRelativeRpm < -12 ||
    command.targetRelativeRpm > 12
  ) {
    throw new RangeError(
      "habitat ring target must be a finite value between -12 and 12 rpm",
    );
  }
  rotation.configureRing(command.ringId, {
    controlMode: command.controlMode,
    targetRelativeRpm: command.targetRelativeRpm,
  });
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `居住环 ${command.ringId} 已切换为 ${command.controlMode}，相对转速目标为 ${command.targetRelativeRpm.toFixed(3)} rpm；实际转速由馈线供电、驱动扭矩、轴承和舰体反作用共同决定。`,
    ringId: command.ringId,
    ringControlMode: command.controlMode,
    targetRelativeRpm: command.targetRelativeRpm,
  };
};

export const handleSetAirHandlerControl: CommandHandler<"set-air-handler-control"> = (
  command,
  context,
  executionId,
) => {
  const {
    compartments,
    maintenance,
    airHandlerLoadById: AIR_HANDLER_LOAD_BY_ID,
  } = context;
  void executionId;
  if (
    !Number.isFinite(command.commandedFlowFraction) ||
    command.commandedFlowFraction < 0 ||
    command.commandedFlowFraction > 1
  ) {
    throw new RangeError(
      "air-handler flow command must be a finite fraction between 0 and 1",
    );
  }
  const serviceLimit = maintenance.getAssetServiceLimitFraction(
    command.airHandlerId,
  );
  const handler = compartments.configureAirHandler(
    command.airHandlerId,
    {
      commandedFlowFraction: Math.min(
        command.commandedFlowFraction,
        serviceLimit,
      ),
      scrubberEnabled: command.scrubberEnabled,
    },
  );
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `空气处理机 ${handler.id} 的循环风量指令已设为 ${(handler.commandedFlowFraction * 100).toFixed(1)}%，CO₂ 吸附器已${handler.scrubberEnabled ? "投入" : "旁路"}；实际风量和捕集能力仍受本机状态与 ${AIR_HANDLER_LOAD_BY_ID[handler.id]} 供电影响。`,
    airHandlerId: handler.id,
    commandedFlowFraction: handler.commandedFlowFraction,
    scrubberEnabled: handler.scrubberEnabled,
  };
};

export const handleSetWaterProcessorControl: CommandHandler<"set-water-processor-control"> = (
  command,
  context,
  executionId,
) => {
  const {
    water,
    maintenance,
    synchronizeWaterAggregate,
    waterProcessorLoadById: WATER_PROCESSOR_LOAD_BY_ID,
  } = context;
  void executionId;
  if (
    !Number.isFinite(command.commandedThroughputFraction) ||
    command.commandedThroughputFraction < 0 ||
    command.commandedThroughputFraction > 1
  ) {
    throw new RangeError(
      "water-processor throughput command must be a finite fraction between 0 and 1",
    );
  }
  const serviceLimit = maintenance.getAssetServiceLimitFraction(
    command.processorId,
  );
  water.configureProcessor(command.processorId, {
    commandedThroughputFraction:
      Math.min(command.commandedThroughputFraction, serviceLimit),
  });
  synchronizeWaterAggregate();
  const processor = water.getProcessor(command.processorId);
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `水回收机 ${processor.id} 的处理量指令已设为 ${(processor.commandedThroughputFraction * 100).toFixed(1)}%；真实处理量仍受本机状态、${WATER_PROCESSOR_LOAD_BY_ID[processor.id]} 馈线服务、废水库存和净水罐余量共同限制。`,
    waterProcessorId: processor.id,
    waterProcessorCommandedThroughputFraction:
      processor.commandedThroughputFraction,
  };
};

export const handleConfigureWaterDistributionSpur: CommandHandler<"configure-water-distribution-spur"> = (
  command,
  context,
  executionId,
) => {
  const {
    water,
    synchronizeWaterAggregate,
  } = context;
  void executionId;
  const hasOpenFraction = command.commandedOpenFraction !== undefined;
  const hasCondition = command.condition !== undefined;
  if (!hasOpenFraction && !hasCondition) {
    throw new Error(
      "configure-water-distribution-spur requires commandedOpenFraction and/or condition",
    );
  }
  if (hasOpenFraction) {
    if (
      !Number.isFinite(command.commandedOpenFraction) ||
      command.commandedOpenFraction! < 0 ||
      command.commandedOpenFraction! > 1
    ) {
      throw new RangeError(
        "water-distribution-spur open fraction must be a finite fraction between 0 and 1",
      );
    }
  }
  if (hasCondition && command.condition !== "nominal") {
    throw new Error(
      "crew may only repair water distribution spur condition to nominal; fault injection requires god intervention",
    );
  }
  water.configureDistributionSpur(command.spurId, {
    ...(hasOpenFraction
      ? { commandedOpenFraction: command.commandedOpenFraction }
      : {}),
    ...(hasCondition ? { condition: "nominal" } : {}),
  });
  synchronizeWaterAggregate();
  const spur = water.getDistributionSpur(command.spurId);
  const effective = effectiveDeliveryFraction(spur);
  const parts: string[] = [];
  if (hasOpenFraction) {
    parts.push(
      `开度指令 ${(spur.commandedOpenFraction * 100).toFixed(1)}%`,
    );
  }
  if (hasCondition) {
    parts.push(`工况已修复为 nominal`);
  }
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `配水支路 ${spur.id} 已更新（${parts.join("；")}）；有效送达分数现为 ${(effective * 100).toFixed(1)}%（开度×工况倍率）。`,
    waterDistributionSpurId: spur.id,
    waterDistributionSpurCommandedOpenFraction: spur.commandedOpenFraction,
    waterDistributionSpurCondition: spur.condition,
    waterDistributionSpurEffectiveDeliveryFraction: effective,
  };
};

export const handleConfigureHabitatThermalDeliverySpur: CommandHandler<"configure-habitat-thermal-delivery-spur"> = (
  command,
  context,
  executionId,
) => {
  const {
    cooling,
  } = context;
  void executionId;
  const hasOpenFraction = command.commandedOpenFraction !== undefined;
  const hasCondition = command.condition !== undefined;
  if (!hasOpenFraction && !hasCondition) {
    throw new Error(
      "configure-habitat-thermal-delivery-spur requires commandedOpenFraction and/or condition",
    );
  }
  if (hasOpenFraction) {
    if (
      !Number.isFinite(command.commandedOpenFraction) ||
      command.commandedOpenFraction! < 0 ||
      command.commandedOpenFraction! > 1
    ) {
      throw new RangeError(
        "habitat-thermal-delivery-spur open fraction must be a finite fraction between 0 and 1",
      );
    }
  }
  if (hasCondition && command.condition !== "nominal") {
    throw new Error(
      "crew may only repair habitat thermal delivery spur condition to nominal; fault injection requires god intervention",
    );
  }
  cooling.configureHabitatThermalDeliverySpur(command.spurId, {
    ...(hasOpenFraction
      ? { commandedOpenFraction: command.commandedOpenFraction }
      : {}),
    ...(hasCondition ? { condition: "nominal" } : {}),
  });
  const spur = cooling.getHabitatThermalDeliverySpur(command.spurId);
  const effective = effectiveHabitatThermalDeliveryFraction(spur);
  const parts: string[] = [];
  if (hasOpenFraction) {
    parts.push(
      `开度指令 ${(spur.commandedOpenFraction * 100).toFixed(1)}%`,
    );
  }
  if (hasCondition) {
    parts.push(`工况已修复为 nominal`);
  }
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `热送达支路 ${spur.id} 已更新（${parts.join("；")}）；有效送达分数现为 ${(effective * 100).toFixed(1)}%（开度×工况倍率）。`,
    habitatThermalDeliverySpurId: spur.id,
    habitatThermalDeliverySpurCommandedOpenFraction:
      spur.commandedOpenFraction,
    habitatThermalDeliverySpurCondition: spur.condition,
    habitatThermalDeliverySpurEffectiveDeliveryFraction: effective,
  };
};

export const handleSetCompartmentConnection: CommandHandler<"set-compartment-connection"> = (
  command,
  context,
  executionId,
) => {
  const {
    compartments,
  } = context;
  void executionId;
  const connection = compartments.configureConnection(command.connectionId, { commandedOpenFraction: command.commandedOpenFraction });
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${connection.id} 开度指令已设为 ${(connection.commandedOpenFraction * 100).toFixed(1)}%；实际开度仍受卡滞状态约束。` };
};

export const handleSetThermalControl: CommandHandler<"set-thermal-control"> = (
  command,
  context,
  executionId,
) => {
  const {
    cooling,
    synchronizeThermalAggregate,
  } = context;
  void executionId;
  if (command.targetType === "radiator") {
    if (!command.radiatorId) throw new Error("radiator control requires radiatorId");
    const radiator = cooling.configureRadiator(command.radiatorId, { deployedFraction: command.controlFraction, coolantConductanceFraction: command.controlFraction });
    synchronizeThermalAggregate();
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${radiator.id} 展开与热阀指令设为 ${(command.controlFraction * 100).toFixed(1)}%。` };
  }
  if (!command.heatExchangerId) throw new Error("heat-exchanger control requires heatExchangerId");
  const exchanger = cooling.configureHeatExchanger(command.heatExchangerId, { conductanceFraction: command.controlFraction });
  synchronizeThermalAggregate();
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${exchanger.id} 热阀导通率设为 ${(command.controlFraction * 100).toFixed(1)}%。` };
};

export const handleSetAtmosphereSupply: CommandHandler<"set-atmosphere-supply"> = (
  command,
  context,
  executionId,
) => {
  const {
    compartments,
    captainOperations,
    synchronizeAtmosphereAggregate,
    capturedCarbonDioxideTotal,
  } = context;
  void executionId;
  const requestedDelta = command.operation === "add" ? command.massKg : -command.massKg;
  if (!Number.isFinite(command.massKg) || command.massKg <= 0) throw new RangeError("atmosphere transfer mass must be positive");
  captainOperations.transferAtmosphereReserve(
    command.gas,
    command.massKg,
    command.operation === "add" ? "to-compartment" : "from-compartment",
  );
  const applied = compartments.adjustZoneGasMass(command.zoneId, command.gas, requestedDelta);
  if (Math.abs(applied - requestedDelta) > 1e-9) throw new Error(`${command.zoneId} does not contain enough ${command.gas}`);
  synchronizeAtmosphereAggregate(capturedCarbonDioxideTotal());
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${command.zoneId} 已${command.operation === "add" ? "补充" : "回收"} ${command.massKg.toFixed(3)} kg ${command.gas}；atmosphereReserveKg 储备与舱区质量账同步更新（制氧产物须经本路径才进入舱区）。` };
};

export const handleSetOxygenProduction: CommandHandler<"set-oxygen-production"> = (
  command,
  context,
  executionId,
) => {
  const {
    captainOperations,
  } = context;
  void executionId;
  const generator = captainOperations.configureOxygenGenerator({
    generatorId: command.generatorId,
    enabled: command.enabled,
    targetProductionKgPerHour: command.targetProductionKgPerHour,
  });
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `${generator.id} 已${generator.enabled ? "投入" : "停机"}，目标产氧 ${generator.targetProductionKgPerHour.toFixed(2)} kg/h；实际产量受本环生命保障馈线和净水库存约束。产出氧气只入 atmosphereReserveKg 舰载储备，不会自动进入舱区；须另发 set-atmosphere-supply 转入指定压力区。`,
  };
};

export const handleDistributeWater: CommandHandler<"distribute-water"> = (
  command,
  context,
  executionId,
) => {
  const {
    water,
    captainOperations,
    synchronizeWaterAggregate,
  } = context;
  void executionId;
  if (command.action === "set-zone-allocation") {
    if (!command.zoneId) throw new Error("zone water allocation requires zoneId");
    const value = captainOperations.setWaterAllocation(command.zoneId, command.kgPerAwakePersonDay ?? NaN);
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${command.zoneId} 饮水额度已设为每名清醒人员每日 ${value.toFixed(2)} kg。` };
  }
  if (!command.fromRing || !command.toRing || command.massKg === undefined) throw new Error("water transfer requires both rings and massKg");
  water.transferPotableWater(command.fromRing, command.toRing, command.massKg);
  synchronizeWaterAggregate();
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${command.massKg.toFixed(2)} kg 净水已从 ${command.fromRing.toUpperCase()} 环转入 ${command.toRing.toUpperCase()} 环。` };
};
