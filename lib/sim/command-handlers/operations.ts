/**
 * Captain operations, crew, maintenance, and sensor ship-command handlers.
 */

import {
  estimateMinLegs,
  findStarCatalogEntry,
  routeDistanceLy,
} from "../../astro/star-catalog.ts";
import {
  MAINTENANCE_ASSET_SPECS,
  MAINTENANCE_ROBOT_IDS,
  type MaintenanceRobotId,
} from "../maintenance.ts";
import type { CommandHandler } from "./types.ts";
import {
  MEDICAL_BATCH_LIMIT,
  selectMaintenanceCrew,
  selectMaintenanceCrewById,
  scheduleIndividualHibernation,
  configureSensorPackageFrequency,
} from "./helpers.ts";

export const handleScheduleMaintenance: CommandHandler<"schedule-maintenance"> = (
  command,
  context,
  executionId,
) => {
  const {
    maintenance,
    captainOperations,
    currentMaintenanceConditions,
  } = context;
  void executionId;
  const actualCondition =
    currentMaintenanceConditions()[command.assetId];
  if (actualCondition === "nominal") {
    throw new Error(
      `${MAINTENANCE_ASSET_SPECS[command.assetId].label} 当前没有可维修故障`,
    );
  }
  const substitution = captainOperations.getSpareSubstitution(
    command.assetId,
  );
  const task = maintenance.scheduleTask({
    assetId: command.assetId,
    detectedCondition: actualCondition,
    crew: selectMaintenanceCrew(command.assetId, context),
    ...(substitution
      ? {
          requiredPartId: substitution.substitutePartId,
          repairDeratingFraction: substitution.deratingFraction,
        }
      : {}),
  });
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary:
      `维修任务 ${task.id} 已创建：${MAINTENANCE_ASSET_SPECS[task.assetId].label}，` +
      `备件 ${task.requiredPartId}${task.requiredPartId === task.nominalRequiredPartId ? "" : `（替代件，完工后降额 ${(task.repairDeratingFraction * 100).toFixed(1)}%）`} 已锁定并消耗，${task.assignedRobotId} 与 ${task.assignedCrewId} 开始累计 ` +
      `${task.requiredWorkSeconds.toFixed(0)} 秒额定工时；进度仍受乘员清醒状态和本环工业馈线约束。`,
    maintenanceAssetId: task.assetId,
    maintenanceTaskId: task.id,
    maintenanceCrewId: task.assignedCrewId,
    maintenanceRobotId: task.assignedRobotId,
  };
};

export const handleReviseMission: CommandHandler<"revise-mission"> = (
  command,
  context,
  executionId,
) => {
  const {
    engine,
    captainOperations,
  } = context;
  void executionId;
  const currentMission = captainOperations.getMission();
  const destination =
    command.disposition === "return"
      ? currentMission.originalOrigin
      : command.destination;
  const mission = captainOperations.reviseMission({
    disposition: command.disposition,
    destination,
    objective: command.objective,
    route: command.route,
  });
  
  // A09修复:return/divert必须从当前位置计算距离,不能用契约字段
  // 起点/终点命中星表时,航距以星表欧氏距离为权威事实,覆盖 LLM 自报值。
  let totalDistanceLightYears = command.totalDistanceLightYears;
  let totalLegs = command.totalLegs;
  if (command.disposition !== "abandon") {
    // 计算当前位置:从journey的origin和destination按完成比例插值
    const currentJourney = context.engine.getState().journey;
    const currentOriginEntry = findStarCatalogEntry(currentJourney.origin);
    const currentDestEntry = findStarCatalogEntry(currentJourney.destination);
    
    let fromEntry = currentOriginEntry;
    // 如果已经有跃迁进度,尝试插值当前位置
    // 简化实现:完成度>0时用当前destination作为from,否则用origin
    if (currentJourney.completedDistanceLightYears > 0 && currentJourney.totalDistanceLightYears > 0) {
      // 已经在途中,使用当前航段的destination作为粗略当前位置
      // 完整实现需要日心坐标插值,这里用已完成航段的终点近似
      fromEntry = currentDestEntry;
    }
    
    const toEntry = findStarCatalogEntry(destination);
    if (fromEntry && toEntry) {
      if (fromEntry.id === toEntry.id) {
        // 零距离:已经在目的地或return到当前位置
        totalDistanceLightYears = 0;
        totalLegs = 0;
      } else {
        totalDistanceLightYears = routeDistanceLy(fromEntry.id, toEntry.id);
        totalLegs = Math.max(totalLegs, estimateMinLegs(totalDistanceLightYears));
      }
    }
  }
  const journey = context.engine.reviseJourneyPlan({
    destination,
    totalDistanceLightYears,
    totalLegs,
    abandoned: command.disposition === "abandon",
  });
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `任务方案已修订为 ${mission.disposition}：目的地 ${journey.destination}，目标“${mission.objective}”，${mission.route.length} 个航路点。`,
    journeyStatus: journey.status,
  };
};

export const handleManageDepartmentOrder: CommandHandler<"manage-department-order"> = (
  command,
  context,
  executionId,
) => {
  const {
    captainOperations,
  } = context;
  void executionId;
  if (command.action === "create") {
    if (!command.departmentId || !command.title || !command.instruction) {
      throw new Error("creating a department order requires department, title, and instruction");
    }
    const order = captainOperations.createDepartmentOrder({
      departmentId: command.departmentId,
      title: command.title,
      instruction: command.instruction,
      priority: command.priority ?? "priority",
      deadlineSeconds: command.deadlineSeconds ?? 3_600,
      estimatedWorkSeconds: command.estimatedWorkSeconds ?? 1_800,
      reportingIntervalSeconds: command.reportingIntervalSeconds ?? 600,
    });
    return {
      kind: command.kind,
      actorAgentId: command.actorAgentId,
      summary: `部门命令 ${order.id} 已下达给 ${order.departmentId}，期限和定期回报均进入世界时钟。`,
    };
  }
  if (!command.orderId) throw new Error("department order action requires orderId");
  if (command.action === "change") {
    const order = captainOperations.changeDepartmentOrder({
      orderId: command.orderId,
      instruction: command.instruction,
      priority: command.priority,
      deadlineSeconds: command.deadlineSeconds,
      reportingIntervalSeconds: command.reportingIntervalSeconds,
    });
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `部门命令 ${order.id} 已变更。` };
  }
  if (command.action === "cancel") {
    const order = captainOperations.cancelDepartmentOrder(
      command.orderId,
      command.reason ?? "舰长取消",
    );
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `部门命令 ${order.id} 已取消：${order.cancelledReason}` };
  }
  const report = captainOperations.reportDepartmentOrder(command.orderId);
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: report.summary };
};

export const handlePublishCommunication: CommandHandler<"publish-communication"> = (
  command,
  context,
  executionId,
) => {
  const {
    captainOperations,
  } = context;
  void executionId;
  const record = captainOperations.recordCommunication({
    kind: command.communicationKind,
    audienceOrTarget: command.audienceOrTarget,
    subject: command.subject,
    message: command.message,
    deliveryDelaySeconds: command.deliveryDelaySeconds,
    relatedGrievanceId: command.relatedGrievanceId,
  });
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `${record.kind} ${record.id} 已${record.deliveredAtMicroseconds === null ? "排程" : "送达"}至 ${record.audienceOrTarget}。`,
  };
};

export const handleFilePassengerGrievance: CommandHandler<"file-passenger-grievance"> = (
  command,
  context,
  executionId,
) => {
  const {
    passengers,
    captainOperations,
  } = context;
  void executionId;
  if (command.actorAgentId !== command.passengerId) {
    throw new Error(
      `file-passenger-grievance actor ${command.actorAgentId} cannot file for ${command.passengerId}`,
    );
  }
  passengers.getPassenger(command.passengerId);
  const grievance = captainOperations.fileGrievance({
    passengerId: command.passengerId,
    category: command.category,
    summary: command.summary,
  });
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `乘客申诉 ${grievance.id} 已登记（${grievance.category}）。`,
  };
};

export const handleManageCrewAssignment: CommandHandler<"manage-crew-assignment"> = (
  command,
  context,
  executionId,
) => {
  const {
    passengers,
    captainOperations,
  } = context;
  void executionId;
  const person = passengers.getPassenger(command.personId);
  if (person.lifeState === "deceased") throw new Error(`${person.id} is deceased`);
  const assignment = captainOperations.assignCrew({
    personId: command.personId,
    departmentId: command.departmentId,
    role: command.role,
    shiftId: command.shiftId,
    dutyZoneId: command.dutyZoneId,
    departmentHead: command.departmentHead,
  });
  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary: `${person.name} 已调任 ${assignment.departmentId}/${assignment.role}，班次 ${assignment.shiftId}${assignment.isDepartmentHead ? "，并接任部门负责人" : ""}。`,
  };
};

export const handleManagePerson: CommandHandler<"manage-person"> = (
  command,
  context,
  executionId,
) => {
  const {
    passengers,
    captainOperations,
    currentZoneForPerson,
    findPersonnelRoute,
  } = context;
  void executionId;
  const person = passengers.getPassenger(command.personId);
  if (command.action === "wake" || command.action === "hibernate") {
    scheduleIndividualHibernation(person.id, command.action, context);
    return {
      kind: command.kind,
      actorAgentId: command.actorAgentId,
      summary: `${person.name} 的${command.action === "wake" ? "唤醒" : "休眠"}流程已进入医疗设备时序。`,
    };
  }
  if (command.action === "triage") {
    if (!command.triageLevel) throw new Error("triage requires triageLevel");
    captainOperations.setPersonDisposition({
      personId: person.id,
      triageLevel: command.triageLevel,
    });
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${person.name} 已标记为 ${command.triageLevel} 分诊等级。` };
  }
  if (command.action === "treat") {
    if (!command.treatmentPlan) throw new Error("treatment requires a treatmentPlan");
    captainOperations.setPersonDisposition({
      personId: person.id,
      treatmentPlan: command.treatmentPlan,
      treatmentStatus: "scheduled",
    });
    const task = captainOperations.scheduleTask({
      kind: "medical-treatment",
      targetId: person.id,
      description: `治疗 ${person.name}：${command.treatmentPlan}`,
      deadlineSeconds: 14_400,
      requiredWorkSeconds: 1_800,
      priority: command.priority ?? "priority",
      assignedDepartmentId: "medical",
      effect: { personId: person.id },
    });
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `医疗任务 ${task.id} 已为 ${person.name} 建立，治疗效果将在工时完成后写入个体状态。` };
  }
  if (!command.zoneId) throw new Error(`${command.action} requires a destination zone`);
  const fromZoneId = currentZoneForPerson(person);
  const routeConnectionIds = findPersonnelRoute(
    fromZoneId,
    command.zoneId,
    captainOperations.snapshot(),
  );
  const task = captainOperations.scheduleTask({
    kind: "relocation",
    targetId: person.id,
    description: `${command.action === "evacuate" ? "疏散" : "转移"} ${person.name} 至 ${command.zoneId}`,
    deadlineSeconds: 3_600,
    requiredWorkSeconds:
      (command.action === "evacuate" ? 60 : 120) +
      routeConnectionIds.length * (command.action === "evacuate" ? 20 : 45),
    priority: command.priority ?? (command.action === "evacuate" ? "emergency" : "priority"),
    assignedDepartmentId: command.action === "evacuate" ? "security" : "medical",
    effect: {
      personId: person.id,
      fromZoneId,
      zoneId: command.zoneId,
      evacuation: command.action === "evacuate",
      routeConnectionIds: routeConnectionIds.join(","),
    },
  });
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `人员行动 ${task.id} 已开始：${fromZoneId} → ${command.zoneId}，经过 ${routeConnectionIds.length} 个舱门/连接；任一路段关闭、密封、受限或卡死都会暂停进度，抵达后个体位置才会变更。` };
};

export const handleManageSecurity: CommandHandler<"manage-security"> = (
  command,
  context,
  executionId,
) => {
  const {
    passengers,
    compartments,
    captainOperations,
  } = context;
  void executionId;
  if (command.action === "set-access") {
    if (!command.connectionId || !command.accessMode) throw new Error("access control requires connectionId and accessMode");
    const access = captainOperations.setAccessControl({
      connectionId: command.connectionId,
      accessMode: command.accessMode,
      reason: command.reason,
    });
    if (access.accessMode === "open" || access.accessMode === "sealed") {
      compartments.configureConnection(access.connectionId, {
        commandedOpenFraction: access.accessMode === "open" ? 1 : 0,
      });
    } else {
      compartments.configureConnection(access.connectionId, {
        commandedOpenFraction: 0,
      });
    }
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${access.connectionId} 门禁已设为 ${access.accessMode}。` };
  }
  if (command.action === "detain" || command.action === "release") {
    if (!command.personId) throw new Error(`${command.action} requires personId`);
    const person = passengers.getPassenger(command.personId);
    captainOperations.setPersonDisposition({
      personId: person.id,
      detained: command.action === "detain",
      detentionReason: command.action === "detain" ? command.reason : null,
    });
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${person.name} 已${command.action === "detain" ? "依法拘留" : "解除拘留"}。` };
  }
  let caseId = command.caseId;
  if (command.action === "investigate" && !caseId) {
    caseId = captainOperations.openSecurityCase({
      subjectPersonId: command.personId,
      zoneId: command.zoneId,
      allegation: command.reason,
    }).id;
  }
  if (!command.teamId) throw new Error(`${command.action} requires teamId`);
  const team = captainOperations.deploySecurityTeam({
    teamId: command.teamId,
    zoneId: command.zoneId ?? null,
    posture:
      command.action === "investigate"
        ? "investigate"
        : command.action === "protect"
          ? "protect"
          : "patrol",
    caseId,
  });
  if (command.action === "investigate") {
    if (!caseId) throw new Error("investigation requires a security case");
    captainOperations.markSecurityCaseInvestigating(caseId);
    const task = captainOperations.scheduleTask({
      kind: "security-investigation",
      targetId: caseId,
      description: `${team.id} 调查 ${caseId}：${command.reason}`,
      deadlineSeconds: 7_200,
      requiredWorkSeconds: 1_800,
      priority: "priority",
      assignedDepartmentId: "security",
      effect: { caseId, teamId: team.id, zoneId: command.zoneId ?? null },
    });
    return {
      kind: command.kind,
      actorAgentId: command.actorAgentId,
      summary: `${team.id} 已接管 ${caseId}，调查任务 ${task.id} 将按值班与舰内供电累计工时；结案前不会凭空生成结论。`,
    };
  }
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${team.id} 已部署至 ${team.assignedZoneId ?? "机动待命区"}，姿态 ${team.posture}${caseId ? `，案件 ${caseId}` : ""}。` };
};

export const handleManageLogistics: CommandHandler<"manage-logistics"> = (
  command,
  context,
  executionId,
) => {
  const {
    passengers,
    captainOperations,
    synchronizeCompartmentOccupants,
  } = context;
  void executionId;
  if (command.action === "set-ration") {
    const value = captainOperations.setRation(command.rationKgPerPersonDay ?? NaN);
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `食品配给已设为每名清醒人员每日 ${value.toFixed(3)} kg。` };
  }
  if (command.action === "configure-agriculture") {
    if (!command.agricultureBayId || !command.crop) throw new Error("agriculture configuration is incomplete");
    const bay = captainOperations.configureAgriculture({
      bayId: command.agricultureBayId,
      crop: command.crop,
      intensityFraction: command.intensityFraction ?? NaN,
    });
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${bay.id} 已种植 ${bay.crop}，运行强度 ${(bay.intensityFraction * 100).toFixed(1)}%。` };
  }
  if (command.action === "move-cargo") {
    if (!command.cargoId || !command.destinationZoneId) throw new Error("cargo move is incomplete");
    captainOperations.moveCargo({ cargoId: command.cargoId, quantity: command.quantity ?? NaN, destinationZoneId: command.destinationZoneId });
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `货物 ${command.cargoId} 的 ${command.quantity} 单位已调往 ${command.destinationZoneId}。` };
  }
  if (command.action === "allocate-cabin") {
    if (!command.personId || !command.cabinId || !command.destinationZoneId) throw new Error("cabin allocation is incomplete");
    passengers.getPassenger(command.personId);
    const allocation = captainOperations.allocateCabin({ personId: command.personId, cabinId: command.cabinId, zoneId: command.destinationZoneId, reason: command.reason ?? "舰务调配" });
    synchronizeCompartmentOccupants();
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${allocation.personId} 已分配 ${allocation.cabinId}/${allocation.zoneId}。` };
  }
  if (command.action === "manufacture-part") {
    if (!command.fabricatorId || !command.partId) throw new Error("manufacturing request is incomplete");
    const quantity = command.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 32) {
      throw new RangeError("manufacturing quantity must be an integer from 1 to 32");
    }
    const feedstockKg = quantity * 8;
    captainOperations.consumeCargo("cargo:fabricator-feedstock", feedstockKg);
    const task = captainOperations.scheduleTask({
      kind: "manufacturing",
      targetId: command.partId,
      description: `${command.fabricatorId} 制造 ${command.partId}`,
      deadlineSeconds: 28_800,
      requiredWorkSeconds: 7_200 * quantity,
      priority: "priority",
      assignedDepartmentId: "engineering",
      effect: { partId: command.partId, quantity, fabricatorId: command.fabricatorId },
    });
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `制造任务 ${task.id} 已开始，${feedstockKg} kg 原料已投入；在 ${command.fabricatorId} 获得工业供电并完成 ${task.requiredWorkSeconds.toFixed(0)} 秒工时后，备件库存增加 ${quantity}。` };
  }
  if (!command.assetId || !command.partId) throw new Error("spare substitution request is incomplete");
  if (MAINTENANCE_ASSET_SPECS[command.assetId].requiredPartId === command.partId) {
    throw new Error("substitution part must differ from the nominal repair part");
  }
  const rule = captainOperations.approveSpareSubstitution({ assetId: command.assetId, substitutePartId: command.partId, approved: true, deratingFraction: command.deratingFraction ?? 0.25 });
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${rule.assetId} 已批准使用 ${rule.substitutePartId}，降额 ${(rule.deratingFraction * 100).toFixed(1)}%。` };
};

export const handleScheduleHullRepair: CommandHandler<"schedule-hull-repair"> = (
  command,
  context,
  executionId,
) => {
  const {
    compartments,
    captainOperations,
  } = context;
  void executionId;
  const breach = compartments.listBreaches().find((item) => item.id === command.breachId);
  if (!breach) throw new Error(`unknown hull breach ${command.breachId}`);
  captainOperations.consumeCargo("cargo:hull-sealant", 1);
  const task = captainOperations.scheduleTask({
    kind: "hull-repair",
    targetId: breach.id,
    description: `封堵 ${breach.id}（${breach.areaSquareMeters.toExponential(2)} m²）`,
    deadlineSeconds: 21_600,
    requiredWorkSeconds: Math.max(900, Math.min(14_400, breach.areaSquareMeters * 4_000_000)),
    priority: command.priority,
    assignedDepartmentId: "engineering",
    effect: { breachId: breach.id },
  });
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `船体修复任务 ${task.id} 已开始，密封材料已消耗；破口将在实际工时完成后移除。` };
};

export const handleManageMaintenanceTask: CommandHandler<"manage-maintenance-task"> = (
  command,
  context,
  executionId,
) => {
  const {
    maintenance,
  } = context;
  void executionId;
  if (command.action === "cancel") {
    const task = maintenance.cancelTask(command.taskId, command.reason ?? "舰长取消维修");
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `维修任务 ${task.id} 已取消；已投入备件不自动回库。` };
  }
  if (command.action === "set-priority") {
    if (!command.priority) throw new Error("maintenance priority change requires priority");
    const task = maintenance.setTaskPriority(command.taskId, command.priority);
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `维修任务 ${task.id} 优先级已设为 ${task.priority}。` };
  }
  const current = maintenance.listTasks().find((item) => item.id === command.taskId);
  if (!current) throw new Error(`unknown maintenance task ${command.taskId}`);
  const crew = command.crewId
    ? selectMaintenanceCrewById(current.assetId, command.crewId, context)
    : selectMaintenanceCrewById(current.assetId, current.assignedCrewId, context);
  let robotId: MaintenanceRobotId | undefined;
  if (command.robotId !== undefined) {
    if (!(MAINTENANCE_ROBOT_IDS as readonly string[]).includes(command.robotId)) throw new Error(`unknown maintenance robot ${command.robotId}`);
    robotId = command.robotId as MaintenanceRobotId;
  }
  const task = maintenance.reassignTask({ taskId: command.taskId, crew, robotId });
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `维修任务 ${task.id} 已改派给 ${task.assignedCrewId}/${task.assignedRobotId}。` };
};

export const handleManageSensorOperation: CommandHandler<"manage-sensor-operation"> = (
  command,
  context,
  executionId,
) => {
  const {
    captainOperations,
  } = context;
  void executionId;
  if (command.action === "set-frequency") {
    const interval = configureSensorPackageFrequency(command.packageId, command.sampleIntervalSeconds ?? NaN, context);
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${command.packageId} 采样周期已设为 ${interval.toFixed(1)} 秒，并写入对应实体传感器。` };
  }
  if (!command.target) throw new Error("active scan requires target");
  const task = captainOperations.scheduleTask({
    kind: "active-scan",
    targetId: command.packageId,
    description: `${command.packageId} 主动扫描 ${command.target}`,
    deadlineSeconds: Math.max(60, (command.durationSeconds ?? 600) * 2),
    requiredWorkSeconds: command.durationSeconds ?? 600,
    priority: command.priority ?? "priority",
    assignedDepartmentId: "navigation",
    effect: { packageId: command.packageId, target: command.target },
  });
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `主动扫描 ${task.id} 已开始，报告将在真实扫描工时完成后生成。` };
};

export const handleManageRemoteAsset: CommandHandler<"manage-remote-asset"> = (
  command,
  context,
  executionId,
) => {
  const {
    captainOperations,
  } = context;
  void executionId;
  const asset = captainOperations.configureRemoteAsset({ assetId: command.assetId, action: command.action, mission: command.mission, target: command.target });
  if (command.action === "retask") {
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${asset.id} 已在部署状态下改派至 ${asset.target}。` };
  }
  const task = captainOperations.scheduleTask({
    kind: "remote-deployment",
    targetId: asset.id,
    description: `${command.action === "deploy" ? "部署" : "回收"} ${asset.id}`,
    deadlineSeconds: 7_200,
    requiredWorkSeconds: asset.kind === "probe" ? 1_200 : 600,
    priority: "priority",
    assignedDepartmentId: "navigation",
    effect: { action: command.action, assetId: asset.id },
  });
  return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${asset.id} ${command.action} 序列 ${task.id} 已开始，状态将在工时完成后切换。` };
};

export const handleSetAwakeTarget: CommandHandler<"set-awake-target"> = (
  command,
  context,
  executionId,
) => {
  const {
    passengers,
  } = context;
  void executionId;
  if (
    !Number.isSafeInteger(command.targetAwake) ||
    command.targetAwake < 0 ||
    command.targetAwake > passengers.personCount
  ) {
    throw new RangeError(
      "awake target must be an integer within the fixed population",
    );
  }
  const summary = passengers.getPopulationSummary();
  const activeTransitions = passengers.getActiveTransitions();
  const projectedAwake =
    summary.awake +
    activeTransitions.filter((transition) => transition.action === "wake")
      .length -
    activeTransitions.filter(
      (transition) => transition.action === "hibernate",
    ).length;
  const delta = command.targetAwake - projectedAwake;
  if (delta === 0) {
    return {
      kind: command.kind,
      actorAgentId: command.actorAgentId,
      summary: "当前清醒人数已经满足目标，无需启动休眠医疗流程。",
      scheduledPeople: 0,
      targetAwake: command.targetAwake,
    };
  }

  const action = delta > 0 ? "wake" : "hibernate";
  const transitioningPassengerIds = new Set(
    activeTransitions.map((transition) => transition.passengerId),
  );
  const candidates = passengers
    .getAllPassengers()
    .filter((person) =>
      !transitioningPassengerIds.has(person.id) &&
      (action === "wake"
        ? person.lifeState === "hibernating"
        : person.lifeState === "awake"),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, Math.min(Math.abs(delta), MEDICAL_BATCH_LIMIT));
  const availablePods =
    action === "hibernate"
      ? passengers.getAvailablePodIds(candidates.length)
      : [];
  const startAt = passengers.nowMicroseconds;

  candidates.forEach((person, index) => {
    passengers.scheduleHibernationTransition({
      passengerId: person.id,
      action,
      startAtMicroseconds:
        startAt + index * 5 * 60 * 1_000_000,
      ...(action === "hibernate"
        ? { podId: availablePods[index] }
        : {}),
    });
  });

  return {
    kind: command.kind,
    actorAgentId: command.actorAgentId,
    summary:
      action === "wake"
        ? `医疗系统已排程 ${candidates.length} 人复温与恢复观察。`
        : `医疗系统已排程 ${candidates.length} 人休眠诱导。`,
    scheduledPeople: candidates.length,
    targetAwake: command.targetAwake,
  };
};
