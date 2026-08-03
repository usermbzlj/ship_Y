/**
 * Pure builder for the captain full authorized observation payload.
 * Delay constants mirror app/ui/constants (lib avoids importing app/ui).
 */

import {
  ATMOSPHERE_RESERVE_LEDGER_SEMANTICS,
  projectCaptainHullThreatObservation,
  projectCaptainJumpThermalEstimate,
  projectCaptainPressureZoneAlerts,
} from "./captain-observation.ts";
import type { CaptainOperationsSnapshot } from "./captain-operations.ts";
import { evaluateMaintenanceSchedulingFeasibility } from "./maintenance.ts";
import type { ShipState } from "./index.ts";
import type {
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  HullConsequenceTelemetry,
  MaintenanceTelemetry,
  NavigationTelemetry,
  RotationTelemetry,
  SimulationWorkerSurvivalTelemetry,
  WaterRecoveryTelemetry,
  ZoneMoodTelemetry,
} from "./protocol.ts";
import { isFiniteNumber } from "../llm/captain-watch-metrics.ts";

/** Same values as AUTHORIZED_* in app/ui/constants. */
export const AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS = 60;
export const AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS = 300;

export type AuthorizedControllerRecord = {
  worldEpoch: number;
  stateRevision: number;
  sampledAtSimulationSeconds: number;
  availableAtSimulationSeconds: number;
  remainingDistanceEstimateLightYears: number;
  jumpControllerState: ShipState["journey"]["status"];
  completedJumpLogCount: number;
  jumpDriveChargeEstimateKWh: number;
  jumpDriveCapacityKWh: number;
};

export type AuthorizedManifestRecord = {
  worldEpoch: number;
  stateRevision: number;
  sampledAtSimulationSeconds: number;
  availableAtSimulationSeconds: number;
  awakeRegistered: number;
  hibernatingRegistered: number;
  deceasedRegistered: number;
};

export type BuildFullAuthorizedObservationInput = {
  simulationSeconds: number;
  engineState: ShipState;
  electricalState: ElectricalTelemetry;
  navigationState: NavigationTelemetry;
  rotationState: RotationTelemetry;
  compartmentState: CompartmentTelemetry | null;
  hullConsequenceState: HullConsequenceTelemetry | null;
  coolingState: CoolingTelemetry | null;
  waterRecoveryState: WaterRecoveryTelemetry | null;
  maintenanceState: MaintenanceTelemetry | null;
  operationsState: CaptainOperationsSnapshot | null;
  survival: SimulationWorkerSurvivalTelemetry | null;
  zoneMood: ReadonlyArray<ZoneMoodTelemetry>;
  controllerRecord: AuthorizedControllerRecord | null;
  manifestRecord: AuthorizedManifestRecord | null;
  observedPowerAlarm: boolean;
};

export function buildFullAuthorizedObservation(
  input: BuildFullAuthorizedObservationInput,
) {
  const {
    simulationSeconds,
    engineState,
    electricalState,
    navigationState,
    rotationState,
    compartmentState,
    hullConsequenceState,
    coolingState,
    waterRecoveryState,
    maintenanceState,
    operationsState,
    survival,
    zoneMood,
    controllerRecord,
    manifestRecord,
    observedPowerAlarm,
  } = input;

  const atmospherePressureObservation =
    compartmentState?.observedPressureAveragePa ?? null;
  const atmosphereZoneAlerts = projectCaptainPressureZoneAlerts(
    compartmentState,
    hullConsequenceState,
  );
  const trueRemainingDistance = Math.max(
    0,
    engineState.journey.totalDistanceLightYears -
      engineState.journey.completedDistanceLightYears,
  );
  const hullThreatObservation =
    projectCaptainHullThreatObservation(hullConsequenceState);
  const jumpThermalProjection = projectCaptainJumpThermalEstimate({
    thermalBusSensorK:
      coolingState?.observed.thermalBusTemperatureK ?? null,
    requiredChargePerJumpKWh: engineState.journey.requiredChargePerJumpKWh,
    remainingDistanceLightYears: trueRemainingDistance,
    candidateDistanceLightYears: Math.min(
      5,
      Math.max(0.1, trueRemainingDistance || 0.1),
    ),
  });
  const authorizedJumpControllerRecord = controllerRecord
    ? {
        availability: "available",
        source:
          "跃迁控制器授权记录；延迟发布并经过量化，不是即时物理真值",
        sampledAtSimulationSeconds:
          controllerRecord.sampledAtSimulationSeconds,
        sampleAgeSeconds: Math.max(
          0,
          simulationSeconds - controllerRecord.sampledAtSimulationSeconds,
        ),
        nominalPublicationDelaySeconds:
          AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS,
        remainingDistanceEstimateLightYears:
          controllerRecord.remainingDistanceEstimateLightYears,
        jumpControllerState: controllerRecord.jumpControllerState,
        completedJumpLogCount: controllerRecord.completedJumpLogCount,
        jumpDriveChargeEstimateKWh:
          controllerRecord.jumpDriveChargeEstimateKWh,
        jumpDriveCapacityKWh: controllerRecord.jumpDriveCapacityKWh,
        routeProgressSemantics:
          "剩余航程与完成次数只在 execute_jump 被设备接受并成功后更新；首次跃迁前零次记录与完整剩余航程正常，不要求先有历史跃迁或亚光速航段",
        localFrameSemantics:
          "位置/速度传感器属于常规推进的局部六自由度坐标，不是光年级航程进度，也不能据此判定仍在出发星系",
        jumpEnergySemantics:
          "jumpDriveChargeEstimateKWh 是跃迁专用储能；普通 A/B 电池 SOC 不是跃迁联锁门槛，最终可执行性由 execute_jump 的确定性设备联锁裁决",
      }
    : {
        availability: "unavailable",
        source: "跃迁控制器授权记录尚未达到发布延迟；不得用世界真值补齐",
        nominalPublicationDelaySeconds:
          AUTHORIZED_CONTROLLER_RECORD_DELAY_SECONDS,
      };
  const authorizedCrewManifestRecord = manifestRecord
    ? {
        availability: "available",
        source: "人员舱单授权记录；延迟发布，不代表即时生命体征",
        sampledAtSimulationSeconds:
          manifestRecord.sampledAtSimulationSeconds,
        sampleAgeSeconds: Math.max(
          0,
          simulationSeconds - manifestRecord.sampledAtSimulationSeconds,
        ),
        nominalPublicationDelaySeconds:
          AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS,
        awakeRegistered: manifestRecord.awakeRegistered,
        hibernatingRegistered: manifestRecord.hibernatingRegistered,
        deceasedRegistered: manifestRecord.deceasedRegistered,
      }
    : {
        availability: "unavailable",
        source: "人员舱单授权记录尚未达到发布延迟；不得用世界真值补齐",
        nominalPublicationDelaySeconds:
          AUTHORIZED_MANIFEST_RECORD_DELAY_SECONDS,
      };
  const averageSensorReading = (readings: number[]): number | null =>
    readings.length === 0
      ? null
      : readings.reduce((total, value) => total + value, 0) /
        readings.length;
  const observedRingAtmosphere = (["A", "B"] as const).map((ring) => {
    const ringZones =
      compartmentState?.zones.filter((zone) =>
        zone.zoneId.startsWith(`${ring}-`),
      ) ?? [];
    const carbonDioxideReadings = ringZones
      .map((zone) => zone.observed.carbonDioxidePartialPressurePa)
      .filter((value): value is number => value !== null);
    const pressureReadings = ringZones
      .map((zone) => zone.observed.pressurePa)
      .filter((value): value is number => value !== null);
    const oxygenReadings = ringZones
      .map((zone) => zone.observed.oxygenPartialPressurePa)
      .filter((value): value is number => value !== null);
    return {
      ring,
      observedOxygenPartialPressurePa:
        averageSensorReading(oxygenReadings),
      observedCarbonDioxidePartialPressurePa:
        averageSensorReading(carbonDioxideReadings),
      observedPressurePa: averageSensorReading(pressureReadings),
      reportingZoneCount: Math.min(
        oxygenReadings.length,
        carbonDioxideReadings.length,
        pressureReadings.length,
      ),
      oxygenReportingZoneCount: oxygenReadings.length,
    };
  });
  const oxygenPartialPressureSensorPaByRing = {
    a:
      observedRingAtmosphere.find((entry) => entry.ring === "A")
        ?.observedOxygenPartialPressurePa ?? null,
    b:
      observedRingAtmosphere.find((entry) => entry.ring === "B")
        ?.observedOxygenPartialPressurePa ?? null,
  };
  const shipOxygenSensorReadings =
    compartmentState?.zones
      .map((zone) => zone.observed.oxygenPartialPressurePa)
      .filter((value): value is number => value !== null) ?? [];
  const oxygenPartialPressureSensorPaAverage = averageSensorReading(
    shipOxygenSensorReadings,
  );
  // 与 pressureZoneAlerts / ringAtmosphereSensors 同源：compartmentState.zones[].observed（含降级/漂移）
  const zoneAtmosphereSensorZones = compartmentState?.zones ?? [];
  const zonePressureSensorReadings = zoneAtmosphereSensorZones
    .map((zone) => zone.observed.pressurePa)
    .filter((value): value is number => value !== null);
  const zoneCarbonDioxideSensorReadings = zoneAtmosphereSensorZones
    .map((zone) => zone.observed.carbonDioxidePartialPressurePa)
    .filter((value): value is number => value !== null);
  const lowestZonePressureSensorPa =
    zonePressureSensorReadings.length === 0
      ? null
      : Math.min(...zonePressureSensorReadings);
  const highestZoneCarbonDioxideSensorPa =
    zoneCarbonDioxideSensorReadings.length === 0
      ? null
      : Math.max(...zoneCarbonDioxideSensorReadings);
  // 全船平均应激：各区带 meanStress 按 awakeCount 加权，非简单平均
  let meanPassengerStressWeightedSum = 0;
  let meanPassengerStressAwakeTotal = 0;
  for (const zone of zoneMood) {
    if (
      !isFiniteNumber(zone.awakeCount) ||
      !isFiniteNumber(zone.meanStress) ||
      zone.awakeCount <= 0
    ) {
      continue;
    }
    meanPassengerStressWeightedSum += zone.meanStress * zone.awakeCount;
    meanPassengerStressAwakeTotal += zone.awakeCount;
  }
  const meanPassengerStress =
    meanPassengerStressAwakeTotal > 0
      ? meanPassengerStressWeightedSum / meanPassengerStressAwakeTotal
      : null;
  const operationsLedger = operationsState
    ? {
        disclaimer: "舰务运营账本投影；比传感器更完整，不是纯传感通道",
        mission: operationsState.mission,
        departmentOrders: operationsState.departmentOrders.slice(-32),
        grievances: operationsState.grievances,
        recentCommunications: operationsState.communications.slice(-24),
        crewAssignments: operationsState.crewAssignments,
        personDispositions: operationsState.personDispositions,
        securityTeams: operationsState.securityTeams,
        securityCases: operationsState.securityCases.slice(-24),
        accessControls: operationsState.accessControls,
        rationKgPerAwakePersonDay: operationsState.rationKgPerAwakePersonDay,
        waterKgPerAwakePersonDayByZone:
          operationsState.waterKgPerAwakePersonDayByZone,
        agricultureBays: operationsState.agricultureBays,
        cargo: operationsState.cargo,
        cabinAllocations: operationsState.cabinAllocations,
        spareSubstitutions: operationsState.spareSubstitutions,
        activeTasks: operationsState.tasks.filter(
          (task) => task.status === "active",
        ),
        remoteAssets: operationsState.remoteAssets,
        sensors: operationsState.sensors,
        powerAllocationLimitByLoad:
          operationsState.powerAllocationLimitByLoad,
        atmosphereReserveKg: operationsState.atmosphereReserveKg,
        atmosphereReserveSemantics: ATMOSPHERE_RESERVE_LEDGER_SEMANTICS,
        oxygenGenerators: operationsState.oxygenGenerators,
        hydrogenReserveKg: operationsState.hydrogenReserveKg,
        foodDryKg: survival?.foodDryKg ?? null,
        meanPassengerStress,
      }
    : {
        disclaimer: "舰务运营账本投影；比传感器更完整，不是纯传感通道",
        availability: "unavailable" as const,
      };

  return {
    source:
      "混合通道：sensorView 为延迟传感；controllerCommandState 为指令态；operationsLedger 为授权舰务账本；均非上帝真值覆写通道",
    sensorView: {
      powerControllerAlarm:
        electricalState.observed.averageBusVoltageV === null ||
        electricalState.observed.averageBusFrequencyHz === null
          ? "sensor-unavailable"
          : observedPowerAlarm
            ? "voltage-or-frequency-deviation"
            : "nominal",
      averageBusVoltageSensorV: electricalState.observed.averageBusVoltageV,
      averageBusFrequencySensorHz:
        electricalState.observed.averageBusFrequencyHz,
      servedPowerSensorKw: electricalState.observed.totalServedPowerKw,
      reactorOutputSensorKw: electricalState.observed.totalReactorOutputKw,
      batteryStateOfChargeSensorFraction:
        electricalState.observed.averageBatteryStateOfChargeFraction,
      coolantSensorK:
        coolingState?.observed.averageCoolantTemperatureK ?? null,
      thermalBusSensorK:
        coolingState?.observed.thermalBusTemperatureK ?? null,
      coolantMassFlowSensorKgPerSecond:
        coolingState?.observed.totalMassFlowKgPerSecond ?? null,
      habitatPressureSensorPa: atmospherePressureObservation,
      oxygenPartialPressureSensorPaByRing,
      oxygenPartialPressureSensorPaAverage,
      oxygenPartialPressureSensorPaA01Detail:
        compartmentState?.zones.find((zone) => zone.zoneId === "A-01")
          ?.observed.oxygenPartialPressurePa ?? null,
      pressureZoneAlerts: atmosphereZoneAlerts,
      lowestZonePressureSensorPa,
      highestZoneCarbonDioxideSensorPa,
      hullThreat: hullThreatObservation,
      jumpThermalProjection,
      waterRecoverySensors: waterRecoveryState?.observed
        ? {
            availability: "available",
            sampledAtSimulationSeconds:
              waterRecoveryState.observed.sampledAtMicroseconds / 1_000_000,
            sampleAgeSeconds: Math.max(
              0,
              simulationSeconds -
                waterRecoveryState.observed.sampledAtMicroseconds /
                  1_000_000,
            ),
            potableKgByRing: waterRecoveryState.observed.potableKgByRing,
            wastewaterKgByRing:
              waterRecoveryState.observed.wastewaterKgByRing,
            processorThroughputKgPerDay:
              waterRecoveryState.observed.processorThroughputKgPerDay,
            distributionSpurs: waterRecoveryState.distributionSpurs,
            undeliveredPotableKg: waterRecoveryState.undeliveredPotableKg,
          }
        : {
            availability: "sensor-unavailable",
          },
      habitatThermalDeliverySpurs:
        coolingState?.habitatThermalDeliverySpurs ?? [],
      undeliveredHabitatCoolingJ:
        coolingState?.undeliveredHabitatCoolingJ ?? null,
      maintenanceDiagnostics: maintenanceState
        ? {
            assets: maintenanceState.observedAssets.map(
              ({ assetId, label, condition, sampleAgeSeconds }) => {
                const truthCondition =
                  maintenanceState.truth.conditions[assetId] ?? null;
                const recentlyCompleted =
                  maintenanceState.recentCompletedTasks.some(
                    (task) => task.assetId === assetId,
                  );
                const scheduleFeasibility =
                  truthCondition === "nominal" || recentlyCompleted
                    ? {
                        schedulable: false as const,
                        blockReason: "nominal-or-unknown" as const,
                      }
                    : evaluateMaintenanceSchedulingFeasibility({
                        assetId,
                        condition,
                        activeAssetIds: maintenanceState.activeTasks,
                        robots: maintenanceState.robots,
                        inventory: maintenanceState.inventory,
                      });
                return {
                  assetId,
                  label,
                  condition,
                  sampleAgeSeconds,
                  truthCondition,
                  recentlyCompleted,
                  scheduleFeasibility,
                };
              },
            ),
            activeTasks: maintenanceState.activeTasks.map((task) => ({
              taskId: task.id,
              assetId: task.assetId,
              status: task.status,
              blockedReason: task.blockedReason,
              progressFraction:
                task.completedWorkSeconds / task.requiredWorkSeconds,
              assignedCrewId: task.assignedCrewId,
              assignedRobotId: task.assignedRobotId,
            })),
            recentCompletedTasks: maintenanceState.recentCompletedTasks.map(
              (task) => ({
                taskId: task.id,
                assetId: task.assetId,
                status: task.status,
              }),
            ),
            diagnosticLagSemantics:
              "observed 诊断有发布延迟；若 truthCondition=nominal 或 recentlyCompleted=true，禁止再 schedule_maintenance",
            inventory: maintenanceState.inventory,
            robots: maintenanceState.robots,
          }
        : { availability: "diagnostic-unavailable" },
      ringAtmosphereSensors: observedRingAtmosphere,
      navigationPositionSensorM: navigationState.observed.positionM,
      navigationVelocitySensorMPerS: navigationState.observed.velocityMPerS,
      navigationAttitudeSensor:
        navigationState.observed.orientationBodyToInertial,
      navigationAngularVelocitySensorRadPerS:
        navigationState.observed.angularVelocityBodyRadPerS,
      propellantMassSensorKg: navigationState.observed.propellantMassKg,
      rotationRingSensors: rotationState.observed.rings.map(
        ({ id, relativeRpm, artificialGravityG, vibrationMmPerS }) => ({
          ringId: id,
          relativeRpm,
          artificialGravityG,
          vibrationMmPerS,
        }),
      ),
      rotationSensorDiagnostics: rotationState.sensors.map(
        ({ ringId, quantity, value, quality, sampleAgeSeconds }) => ({
          ringId,
          quantity,
          value,
          quality,
          sampleAgeSeconds,
        }),
      ),
    },
    delayedAuthorizedRecords: {
      jumpControllerRecord: authorizedJumpControllerRecord,
      crewManifestRecord: authorizedCrewManifestRecord,
    },
    controllerCommandState: {
      disclaimer: "指令态/控制器设定，非延迟传感器；可能与现场真值不同步",
      airHandlers: compartmentState?.airHandlers.controllers ?? [],
      waterProcessors: waterRecoveryState?.controllers ?? [],
      waterDistributionSpurs: (
        waterRecoveryState?.distributionSpurs ?? []
      ).map(({ spurId, ring, commandedOpenFraction, condition }) => ({
        spurId,
        ring,
        commandedOpenFraction,
        condition,
      })),
      habitatThermalDeliverySpurs: (
        coolingState?.habitatThermalDeliverySpurs ?? []
      ).map(({ spurId, ring, commandedOpenFraction, condition }) => ({
        spurId,
        ring,
        commandedOpenFraction,
        condition,
      })),
    },
    operationsLedger,
  };
}
