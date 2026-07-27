/**
 * Command-execution helpers for the ship operational command registry.
 *
 * Pure relative to worker module state: all domain networks and sync callbacks
 * arrive through CommandHandlerContext so initialize/restore replacements stay live.
 */

import {
  JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K,
  jumpEnergyConsumedKWh,
  projectJumpThermalBusTemperatureK,
} from "../jump-interlock.ts";
import {
  MAINTENANCE_ASSET_SPECS,
  type MaintenanceAssetId,
} from "../maintenance.ts";
import type { CaptainOperations } from "../captain-operations.ts";
import type { CommandHandlerContext } from "./types.ts";

export const MEDICAL_BATCH_LIMIT = 24;
export const JUMP_MAXIMUM_ANGULAR_SPEED_RAD_PER_SECOND = 1e-5;

export function jumpInterlockFailures(
  requestedDistanceLightYears: number,
  context: CommandHandlerContext,
): string[] {
  const {
    engine,
    compartments,
    cooling,
    electrical,
    navigation,
    hullConsequence,
    jumpDriveLoadIds: JUMP_DRIVE_LOAD_IDS,
  } = context;
  const failures: string[] = [];
  if (
    !Number.isFinite(requestedDistanceLightYears) ||
    requestedDistanceLightYears < 0.1 ||
    requestedDistanceLightYears > 5
  ) {
    failures.push("单次跃迁距离必须在 0.1–5 光年之间");
    return failures;
  }

  const state = engine.getState();
  const remainingDistanceLightYears = Math.max(
    0,
    state.journey.totalDistanceLightYears -
      state.journey.completedDistanceLightYears,
  );
  const actualDistanceLightYears = Math.min(
    requestedDistanceLightYears,
    remainingDistanceLightYears,
  );
  const energyConsumedKWh = jumpEnergyConsumedKWh({
    requiredChargePerJumpKWh: state.journey.requiredChargePerJumpKWh,
    distanceLightYears: actualDistanceLightYears,
  });
  if (state.journey.status !== "ready") {
    failures.push("跃迁场储能状态不是 ready");
  }
  if (remainingDistanceLightYears <= 0) {
    failures.push("航程已经没有剩余距离");
  }
  if (
    state.journey.jumpDriveChargeKWh + 1e-9 <
    energyConsumedKWh
  ) {
    failures.push("跃迁场储能不足");
  }

  const hullBreaches = compartments.listBreaches();
  const hullJump = hullConsequence.getTelemetry(
    engine.elapsedMicroseconds,
    hullBreaches,
  );
  if (hullJump.jumpBlocked && hullJump.jumpBlockReason) {
    failures.push(hullJump.jumpBlockReason);
  }

  const thermalBus = cooling
    .listNodes()
    .find((node) => node.id === "thermal-bus");
  if (!thermalBus) {
    failures.push("主热汇流排不可用");
  } else {
    const projectedTemperatureK = projectJumpThermalBusTemperatureK({
      thermalBusTemperatureK: thermalBus.temperatureK,
      energyConsumedKWh,
      heatCapacityJPerK: thermalBus.heatCapacityJPerK,
    });
    if (
      projectedTemperatureK >
      JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K
    ) {
      failures.push(
        "推进热预测超过主热汇流排安全联锁上限",
      );
    }
  }
  if (cooling.getSummary().activeLoopCount < 1) {
    failures.push("没有可用的主动冷却回路");
  }

  const breakerById = new Map(
    electrical
      .listBreakers()
      .map((breaker) => [breaker.id, breaker]),
  );
  const busById = new Map(
    electrical.listBuses().map((bus) => [bus.id, bus]),
  );
  for (const loadId of JUMP_DRIVE_LOAD_IDS) {
    const load = electrical
      .listLoads()
      .find((candidate) => candidate.id === loadId);
    if (!load) {
      failures.push(`缺少跃迁馈线 ${loadId}`);
      continue;
    }
    const breaker = breakerById.get(load.breakerId);
    const bus = busById.get(load.busId);
    if (
      !load.enabled ||
      breaker?.commandedClosed !== true ||
      breaker.condition !== "nominal" ||
      bus?.energized !== true
    ) {
      failures.push(`${loadId} 控制馈线未安全带电`);
    }
  }

  const navigationSummary = navigation.getSummary();
  if (
    navigationSummary.angularSpeedRadPerS >
    JUMP_MAXIMUM_ANGULAR_SPEED_RAD_PER_SECOND
  ) {
    failures.push(
      "舰体角速度超过跃迁姿态安全联锁上限",
    );
  }
  const nowMicroseconds = navigation.elapsedMicroseconds;
  const liveCommands = navigation
    .listCommands()
    .filter(
      (command) =>
        command.canceledAtMicroseconds === null &&
        (command.endsAtMicroseconds === null ||
          command.endsAtMicroseconds > nowMicroseconds),
    );
  if (
    navigationSummary.activeThrusterCount > 0 ||
    liveCommands.some(
      (command) =>
        command.startsAtMicroseconds <= nowMicroseconds,
    )
  ) {
    failures.push("常规推进器仍在产生推力");
  }
  if (
    liveCommands.some(
      (command) =>
        command.startsAtMicroseconds > nowMicroseconds,
    )
  ) {
    failures.push("仍有待执行的常规推进指令");
  }
  return failures;
}

export function selectMaintenanceCrew(
  assetId: MaintenanceAssetId,
  context: CommandHandlerContext,
) {
  const {
    passengers,
  } = context;
  const spec = MAINTENANCE_ASSET_SPECS[assetId];
  const candidates = passengers
    .getAllPassengers()
    .filter((person) => person.lifeState === "awake")
    .flatMap((person) =>
      person.skills
        .filter((skill) =>
          spec.preferredSkillIds.includes(skill.id),
        )
        .map((skill) => ({
          passengerId: person.id,
          skillId: skill.id,
          proficiency: skill.proficiency,
        })),
    )
    .sort(
      (left, right) =>
        right.proficiency - left.proficiency ||
        left.passengerId.localeCompare(right.passengerId) ||
        left.skillId.localeCompare(right.skillId),
    );
  const selected = candidates[0];
  if (!selected) {
    throw new Error(
      `${spec.label} 没有清醒且具备 ${spec.preferredSkillIds.join("/")} 技能的乘员`,
    );
  }
  return selected;
}

export function selectMaintenanceCrewById(
  assetId: MaintenanceAssetId,
  passengerId: string,
  context: CommandHandlerContext,
) {
  const {
    passengers,
  } = context;
  const spec = MAINTENANCE_ASSET_SPECS[assetId];
  const person = passengers.getPassenger(passengerId);
  if (person.lifeState !== "awake") {
    throw new Error(`${passengerId} is not awake for maintenance duty`);
  }
  const skill = person.skills
    .filter((candidate) => spec.preferredSkillIds.includes(candidate.id))
    .sort((left, right) => right.proficiency - left.proficiency)[0];
  if (!skill) {
    throw new Error(`${passengerId} lacks a qualified skill for ${assetId}`);
  }
  return {
    passengerId,
    skillId: skill.id,
    proficiency: skill.proficiency,
  };
}

export function scheduleIndividualHibernation(
  personId: string,
  action: "wake" | "hibernate",
  context: CommandHandlerContext,
): void {
  const {
    passengers,
  } = context;
  const person = passengers.getPassenger(personId);
  const podId =
    action === "hibernate"
      ? passengers.getAvailablePodIds(1)[0]
      : undefined;
  if (action === "hibernate" && !podId) {
    throw new Error("no hibernation pod is available");
  }
  passengers.scheduleHibernationTransition({
    passengerId: person.id,
    action,
    startAtMicroseconds: passengers.nowMicroseconds,
    ...(podId ? { podId } : {}),
  });
}

export function configureSensorPackageFrequency(
  packageId: Parameters<CaptainOperations["setSensorSampleInterval"]>[0],
  sampleIntervalSeconds: number,
  context: CommandHandlerContext,
): number {
  const {
    compartments,
    cooling,
    electrical,
    navigation,
    rotation,
    captainOperations,
  } = context;
  const sampleIntervalMicroseconds = Math.round(sampleIntervalSeconds * 1_000_000);
  if (packageId === "navigation-array" || packageId === "external-radar") {
    for (const sensor of navigation.listSensors()) {
      navigation.configureSensor(sensor.id, { sampleIntervalMicroseconds });
    }
    if (packageId === "navigation-array") {
      for (const sensor of rotation.listSensors()) {
        rotation.configureSensor(sensor.id, { sampleIntervalMicroseconds });
      }
    }
  } else if (packageId === "thermal-diagnostic-array") {
    for (const sensor of cooling.listSensors()) {
      cooling.configureSensor(sensor.id, { sampleIntervalMicroseconds });
    }
  } else if (
    packageId === "atmosphere-diagnostic-array" ||
    packageId === "hull-inspection-array"
  ) {
    for (const sensor of compartments.listSensors()) {
      compartments.configureSensor(sensor.id, { sampleIntervalMicroseconds });
    }
  } else {
    for (const sensor of electrical.listSensors()) {
      electrical.configureSensor(sensor.id, { sampleIntervalMicroseconds });
    }
  }
  return captainOperations.setSensorSampleInterval(packageId, sampleIntervalSeconds);
}
