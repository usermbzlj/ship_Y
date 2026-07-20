import type {
  ExternalInterventionRecord,
  ExternalInterventionRequest,
  ShipState,
  SimulationSnapshot,
} from "./index";
import type {
  PassengerPopulationSummary,
  PassengerSimulationSnapshot,
} from "./passengers";
import type {
  AirHandler,
  AirHandlerId,
  AtmosphereFidelityMode,
  CompartmentNetworkSnapshot,
  SensorQuality,
  ZoneId,
} from "./compartments";
import type {
  CoolingNetworkSnapshot,
  CoolantPumpId,
  PumpCondition,
  ThermalSensorQuality,
  ThermalSensorQuantity,
} from "./cooling";
import type {
  CommandAuditEntry,
  CommandBusSnapshot,
} from "./command-bus";
import type {
  BatteryCondition,
  BatteryControlMode,
  ElectricalBatteryId,
  ElectricalBreakerId,
  ElectricalLoadId,
  ElectricalNetworkSnapshot,
  ElectricalSensorQuality,
  ElectricalSensorQuantity,
  FusionReactorId,
  ReactorCondition,
  ReactorMode,
} from "./electrical";
import type {
  NavigationSensorQuality,
  NavigationSensorQuantity,
  NavigationSnapshot,
  Quaternion,
  ThrusterCondition,
  ThrusterId,
  Vector3,
} from "./navigation";
import type {
  RingControlMode,
  RotationRingId,
  RotationSensorCondition,
  RotationSensorQuantity,
  RotationSnapshot,
  RotationSummary,
} from "./rotation";
import type {
  WaterLoop,
  WaterObservationFrame,
  WaterProcessor,
  WaterProcessorId,
  WaterRecoverySnapshot,
  WaterRecoverySummary,
} from "./water";
import type {
  MaintenanceAssetCondition,
  MaintenanceAssetId,
  MaintenanceDiagnosticFrame,
  MaintenancePartId,
  MaintenanceRobot,
  MaintenanceSnapshot,
  MaintenanceTask,
} from "./maintenance";

export interface MissionInitialization {
  origin: string;
  destination: string;
  directive: string;
  seed: string;
  totalDistanceLightYears: number;
  totalLegs: number;
  timeScale: number;
}

export interface ThrusterPulsePlan {
  thrusterId: ThrusterId;
  throttleFraction: number;
  durationSeconds: number;
  startDelaySeconds: number;
}

export type ShipOperationalCommand =
  | {
      kind: "execute-jump";
      actorAgentId: "captain" | "navigation";
      distanceLightYears: number;
    }
  | {
      kind: "set-awake-target";
      actorAgentId: "captain" | "medical";
      targetAwake: number;
    }
  | {
      kind: "isolate-pressure-zone";
      actorAgentId: "captain" | "life-support" | "security";
      zoneId: ZoneId;
    }
  | {
      kind: "schedule-thruster-pulse";
      actorAgentId: "captain" | "navigation";
      thrusterId: ThrusterId;
      throttleFraction: number;
      durationSeconds: number;
      startDelaySeconds: number;
    }
  | {
      kind: "schedule-thruster-maneuver";
      actorAgentId: "captain" | "navigation";
      pulses: ThrusterPulsePlan[];
    }
  | {
      kind: "set-reactor-target";
      actorAgentId: "captain" | "engineering";
      reactorId: FusionReactorId;
      targetOutputKw: number;
    }
  | {
      kind: "set-reactor-mode";
      actorAgentId: "captain" | "engineering";
      reactorId: FusionReactorId;
      mode: ReactorMode;
    }
  | {
      kind: "set-cooling-pump-speed";
      actorAgentId: "captain" | "engineering";
      pumpId: CoolantPumpId;
      commandedSpeedFraction: number;
    }
  | {
      kind: "set-electrical-load-enabled";
      actorAgentId: "captain" | "engineering";
      loadId: ElectricalLoadId;
      enabled: boolean;
    }
  | {
      kind: "set-electrical-breaker";
      actorAgentId: "captain" | "engineering";
      breakerId: ElectricalBreakerId;
      commandedClosed: boolean;
    }
  | {
      kind: "set-battery-mode";
      actorAgentId: "captain" | "engineering";
      batteryId: ElectricalBatteryId;
      mode: BatteryControlMode;
    }
  | {
      kind: "set-habitat-ring-control";
      actorAgentId: "captain" | "engineering";
      ringId: RotationRingId;
      controlMode: RingControlMode;
      targetRelativeRpm: number;
    }
  | {
      kind: "set-air-handler-control";
      actorAgentId: "captain" | "engineering" | "life-support";
      airHandlerId: AirHandlerId;
      commandedFlowFraction: number;
      scrubberEnabled: boolean;
    }
  | {
      kind: "set-water-processor-control";
      actorAgentId: "captain" | "engineering" | "life-support";
      processorId: WaterProcessorId;
      commandedThroughputFraction: number;
    }
  | {
      kind: "schedule-maintenance";
      actorAgentId: "captain" | "engineering";
      assetId: MaintenanceAssetId;
    };

export interface ShipOperationalCommandResult {
  kind: ShipOperationalCommand["kind"];
  actorAgentId: string;
  summary: string;
  scheduledPeople?: number;
  targetAwake?: number;
  distanceLightYears?: number;
  energyConsumedKWh?: number;
  journeyStatus?: string;
  zoneId?: ZoneId;
  actuatedConnections?: number;
  thrusterId?: ThrusterId;
  scheduledCommandId?: string;
  scheduledCommandIds?: string[];
  throttleFraction?: number;
  durationSeconds?: number;
  startDelaySeconds?: number;
  reactorId?: FusionReactorId;
  targetOutputKw?: number;
  reactorMode?: ReactorMode;
  pumpId?: CoolantPumpId;
  commandedSpeedFraction?: number;
  loadId?: ElectricalLoadId;
  enabled?: boolean;
  breakerId?: ElectricalBreakerId;
  commandedClosed?: boolean;
  batteryId?: ElectricalBatteryId;
  batteryMode?: BatteryControlMode;
  ringId?: RotationRingId;
  ringControlMode?: RingControlMode;
  targetRelativeRpm?: number;
  airHandlerId?: AirHandlerId;
  commandedFlowFraction?: number;
  scrubberEnabled?: boolean;
  waterProcessorId?: WaterProcessorId;
  waterProcessorCommandedThroughputFraction?: number;
  maintenanceAssetId?: MaintenanceAssetId;
  maintenanceTaskId?: string;
  maintenanceCrewId?: string;
  maintenanceRobotId?: string;
}

export interface FinalJourneyReport {
  outcome: "arrived";
  elapsedSeconds: number;
  origin: string;
  destination: string;
  jumpsCompleted: number;
  survivors: number;
  deceased: number;
  evaluationCount: number;
  representativeEvaluations: Array<{
    passengerId: string;
    passengerName: string;
    text: string;
  }>;
}

export type SimulationWorkerCommand =
  | {
      type: "initialize";
      requestId: string;
      mission: MissionInitialization;
    }
  | {
      type: "step";
      requestId: string;
      realSeconds: number;
      timeScale: number;
    }
  | {
      type: "intervene";
      requestId: string;
      request: ExternalInterventionRequest;
    }
  | {
      type: "restore";
      requestId: string;
      snapshot: RuntimeSimulationSnapshot;
    }
  | {
      type: "snapshot";
      requestId: string;
    }
  | {
      type: "ship-command";
      requestId: string;
      commandId: string;
      idempotencyKey: string;
      issuedAtMicroseconds: number;
      expectedRevision: number;
      expectedStateRevision: number;
      command: ShipOperationalCommand;
    }
  | {
      type: "final-report";
      requestId: string;
    }
  | {
      type: "inspect";
      requestId: string;
    };

export interface SimulationWorkerState {
  elapsedSeconds: number;
  state: ShipState;
  passengers: PassengerPopulationSummary;
  passengerHighlights: PassengerHighlightTelemetry[];
  compartments: CompartmentTelemetry;
  cooling: CoolingTelemetry;
  electrical: ElectricalTelemetry;
  navigation: NavigationTelemetry;
  rotation: RotationTelemetry;
  waterRecovery: WaterRecoveryTelemetry;
  maintenance: MaintenanceTelemetry;
  commandBus: CommandBusTelemetry;
}

export interface MaintenanceTelemetry {
  observedAssets: Array<{
    assetId: MaintenanceAssetId;
    label: string;
    condition: MaintenanceAssetCondition | null;
    sampledAtMicroseconds: number | null;
    sampleAgeSeconds: number | null;
  }>;
  activeTasks: MaintenanceTask[];
  recentCompletedTasks: MaintenanceTask[];
  inventory: Record<MaintenancePartId, number>;
  robots: MaintenanceRobot[];
  diagnosticFrame: MaintenanceDiagnosticFrame | null;
  truth: {
    conditions: Record<MaintenanceAssetId, MaintenanceAssetCondition>;
  };
}

export interface WaterRecoveryTelemetry {
  controllers: Array<
    Pick<
      WaterProcessor,
      "id" | "ring" | "commandedThroughputFraction"
    >
  >;
  observed: WaterObservationFrame | null;
  truth: {
    loops: WaterLoop[];
    processors: WaterProcessor[];
    summary: WaterRecoverySummary;
  };
}

export interface PassengerHighlightTelemetry {
  passengerId: string;
  name: string;
  occupation: string;
  cabinId: string;
  zoneId: ZoneId;
  zoneCondition: CompartmentZoneCondition;
  zoneObservedPressurePa: number | null;
  zoneObservationAgeSeconds: number | null;
  lifeState: "awake" | "hibernating" | "deceased";
  physicalHealth: number;
  medicalStability: number;
  psychologicalStability: number;
  stress: number;
  trust: number;
  isKeyLlm: boolean;
}

export type PassengerEnvironmentalHazardFamily =
  | "low-pressure"
  | "hypoxia"
  | "high-carbon-dioxide"
  | "cold"
  | "heat";

export type PassengerEnvironmentalHazardTier = 0 | 1 | 2;

export interface PassengerEnvironmentalExposureState {
  zoneId: ZoneId;
  family: PassengerEnvironmentalHazardFamily;
  currentTier: PassengerEnvironmentalHazardTier;
  episode: number;
}

export interface RuntimeSimulationSnapshot {
  snapshotVersion: 15;
  highestDirective: string;
  engine: SimulationSnapshot;
  passengers: PassengerSimulationSnapshot;
  compartments: CompartmentNetworkSnapshot;
  cooling: CoolingNetworkSnapshot;
  electrical: ElectricalNetworkSnapshot;
  navigation: NavigationSnapshot;
  rotation: RotationSnapshot;
  water: WaterRecoverySnapshot;
  maintenance: MaintenanceSnapshot;
  commandBus: CommandBusSnapshot;
  passengerEnvironmentalExposures:
    PassengerEnvironmentalExposureState[];
}

export interface RotationSensorTelemetry {
  sensorId: string;
  ringId: RotationRingId;
  quantity: RotationSensorQuantity;
  value: number | null;
  quality: RotationSensorCondition;
  sampledAtMicroseconds: number | null;
  sampleAgeSeconds: number | null;
}

export interface RotationTelemetry {
  observed: {
    rings: Array<{
      id: RotationRingId;
      relativeRpm: number | null;
      artificialGravityG: number | null;
      vibrationMmPerS: number | null;
    }>;
  };
  sensors: RotationSensorTelemetry[];
  truth: RotationSummary;
}

export interface ElectricalSensorTelemetry {
  sensorId: string;
  targetId: string;
  quantity: ElectricalSensorQuantity;
  value: number | null;
  quality: ElectricalSensorQuality;
  sampledAtMicroseconds: number | null;
  sampleAgeSeconds: number | null;
}

export interface ElectricalTelemetry {
  observed: {
    averageBusVoltageV: number | null;
    averageBusFrequencyHz: number | null;
    totalServedPowerKw: number | null;
    totalReactorOutputKw: number | null;
    averageBatteryStateOfChargeFraction: number | null;
  };
  sensors: ElectricalSensorTelemetry[];
  truth: {
    generationPowerKw: number;
    demandedPowerKw: number;
    servedPowerKw: number;
    unservedPowerKw: number;
    curtailedGenerationKw: number;
    batteryNetPowerKw: number;
    batteryStoredEnergyKWh: number;
    batteryCapacityKWh: number;
    criticalServiceFraction: number;
    essentialServiceFraction: number;
    onlineReactorCount: number;
    hotStandbyReactorCount: number;
    energizedBusCount: number;
    powerBalanceErrorKw: number;
    energyClosureErrorKWh: number;
    reactors: Array<{
      id: string;
      mode: ReactorMode;
      condition: ReactorCondition;
      outputKw: number;
      targetOutputKw: number;
    }>;
    buses: Array<{
      id: string;
      energized: boolean;
      voltageV: number;
      frequencyHz: number;
      servedPowerKw: number;
      unservedPowerKw: number;
    }>;
    batteries: Array<{
      id: string;
      condition: BatteryCondition;
      storedEnergyKWh: number;
      capacityKWh: number;
      lastPowerKw: number;
    }>;
  };
}

export interface NavigationSensorTelemetry {
  sensorId: string;
  quantity: NavigationSensorQuantity;
  frameEpoch: number | null;
  value: number | null;
  quality: NavigationSensorQuality;
  sampledAtMicroseconds: number | null;
  sampleAgeSeconds: number | null;
}

export interface NavigationTelemetry {
  observed: {
    positionM: {
      x: number | null;
      y: number | null;
      z: number | null;
    };
    velocityMPerS: {
      x: number | null;
      y: number | null;
      z: number | null;
    };
    orientationBodyToInertial: {
      w: number | null;
      x: number | null;
      y: number | null;
      z: number | null;
    };
    angularVelocityBodyRadPerS: {
      x: number | null;
      y: number | null;
      z: number | null;
    };
    propellantMassKg: number | null;
    fusionFuelMassKg: number | null;
  };
  sensors: NavigationSensorTelemetry[];
  truth: {
    frameEpoch: number;
    anchorCompletedDistanceLightYears: number;
    elapsedSeconds: number;
    totalMassKg: number;
    propellantMassKg: number;
    fusionFuelMassKg: number;
    fusionEnergyReleasedJ: number;
    retainedWasteHeatJ: number;
    directExportEnergyJ: number;
    controlEnergyRequestedJ: number;
    controlEnergyServedJ: number;
    positionM: Vector3;
    velocityMPerS: Vector3;
    speedMPerS: number;
    orientationBodyToInertial: Quaternion;
    angularVelocityBodyRadPerS: Vector3;
    angularSpeedRadPerS: number;
    currentInertiaDiagonalKgM2: {
      x: number;
      y: number;
      z: number;
    };
    activeThrusterCount: number;
    totalThrustN: number;
    instantaneousAccelerationMPerS2: number;
    linearMomentumClosureErrorKgMPerS: number;
    angularMomentumClosureErrorKgM2PerS: number;
    energyClosureErrorJ: number;
    thrusters: Array<{
      id: string;
      condition: ThrusterCondition;
      lastActualThrottleFraction: number;
      lastThrustN: number;
      lastMassFlowKgPerS: number;
    }>;
  };
}

export interface CoolingSensorTelemetry {
  sensorId: string;
  targetId: string;
  quantity: ThermalSensorQuantity;
  value: number | null;
  quality: ThermalSensorQuality;
  sampledAtMicroseconds: number | null;
  sampleAgeSeconds: number | null;
}

export interface CoolingTelemetry {
  observed: {
    thermalBusTemperatureK: number | null;
    averageCoolantTemperatureK: number | null;
    totalMassFlowKgPerSecond: number | null;
    totalRadiatedPowerW: number | null;
  };
  sensors: CoolingSensorTelemetry[];
  truth: {
    thermalBusTemperatureK: number;
    averageCoolantTemperatureK: number;
    hottestNodeTemperatureK: number;
    totalMassFlowKgPerSecond: number;
    totalRadiatedPowerW: number;
    activeLoopCount: number;
    energyClosureErrorJ: number;
    pumps: Array<{
      id: string;
      condition: PumpCondition;
      commandedSpeedFraction: number;
      electricalSupplyFraction: number;
      massFlowKgPerSecond: number;
    }>;
  };
}

export interface CommandBusTelemetry {
  revision: number;
  recentAudit: Array<
    Pick<
      CommandAuditEntry,
      | "sequence"
      | "actor"
      | "role"
      | "kind"
      | "issuedAt"
      | "status"
      | "revisionBefore"
      | "revisionAfter"
    >
  >;
}

export type CompartmentZoneCondition =
  | "nominal"
  | "watch"
  | "critical"
  | "offline";

export interface CompartmentZoneTelemetry {
  zoneId: ZoneId;
  condition: CompartmentZoneCondition;
  hasBreach: boolean;
  observed: {
    pressurePa: number | null;
    temperatureK: number | null;
    oxygenPartialPressurePa: number | null;
    carbonDioxidePartialPressurePa: number | null;
  };
  quality: {
    pressure: SensorQuality;
    temperature: SensorQuality;
    oxygen: SensorQuality;
    carbonDioxide: SensorQuality;
  };
  newestSampleAgeSeconds: number | null;
}

export interface CompartmentTelemetry {
  zoneCount: 48;
  fidelityMode: AtmosphereFidelityMode;
  fineSubsteps: number;
  equilibriumIntervals: number;
  requestedTimeScale: number;
  effectiveTimeScale: number;
  fidelityLimited: boolean;
  activeBreaches: number;
  totalVentedGasKg: number;
  observedPressureMinPa: number | null;
  observedPressureAveragePa: number | null;
  observedPressureMaxPa: number | null;
  airHandlers: {
    controllers: Array<
      Pick<
        AirHandler,
        | "id"
        | "ring"
        | "commandedFlowFraction"
        | "scrubberEnabled"
        | "carbonDioxideSetpointPa"
      >
    >;
    truth: AirHandler[];
  };
  zones: CompartmentZoneTelemetry[];
}

export type SimulationWorkerEvent =
  | {
      type: "ready";
      requestId: string;
      payload: SimulationWorkerState;
    }
  | {
      type: "stepped";
      requestId: string;
      payload: SimulationWorkerState;
    }
  | {
      type: "intervention";
      requestId: string;
      payload: SimulationWorkerState & {
        record: ExternalInterventionRecord;
      };
    }
  | {
      type: "snapshot";
      requestId: string;
      payload: {
        snapshot: RuntimeSimulationSnapshot;
      };
    }
  | {
      type: "ship-command";
      requestId: string;
      payload: SimulationWorkerState & {
        result: ShipOperationalCommandResult;
      };
    }
  | {
      type: "final-report";
      requestId: string;
      payload: {
        report: FinalJourneyReport;
      };
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    };
