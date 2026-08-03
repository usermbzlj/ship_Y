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
  ZoneRole,
} from "./compartments";
import type {
  CoolingNetworkSnapshot,
  CoolantPumpId,
  CoolingHabitatRing,
  HabitatThermalDeliverySpurCondition,
  HabitatThermalDeliverySpurId,
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
  WaterDistributionSpurCondition,
  WaterDistributionSpurId,
  WaterLoop,
  WaterObservationFrame,
  WaterProcessor,
  WaterProcessorId,
  WaterRecoverySnapshot,
  WaterRecoverySummary,
  WaterRing,
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
import type { TimeDirectorSnapshot } from "./director";
import type {
  ProceduralWorldEvent,
  ProceduralWorldSnapshot,
} from "./procedural-world";
import type { SurvivalSnapshot } from "./survival";
import type { HullConsequenceSnapshot } from "./hull-consequence";
import type {
  ActiveSensorPackageId,
  AgricultureBayId,
  CaptainOperationsSnapshot,
  CommunicationKind,
  DutyShiftId,
  FabricatorId,
  MissionDisposition,
  MissionWaypoint,
  OxygenGeneratorId,
  OrderPriority,
  RemoteAssetId,
  SecurityTeamId,
  ShipDepartmentId,
  TriageLevel,
} from "./captain-operations";
import type {
  HeatExchangerId,
  RadiatorId,
} from "./cooling";
import type { CaptainJournalSnapshot } from "../llm/captain-journal";
import type { CaptainWatchSnapshot } from "../llm/captain-watch";
import type { DepartmentInboxSnapshot } from "../llm/department-inbox";
import type { DepartmentStandingSnapshot } from "../llm/department-standing";
import type { PassengerSocietySnapshot } from "../llm/passenger-society";

export type LlmOrchestrationPending = {
  kind: "captain-blocking";
  phase: "awaiting-http" | "applying-tools" | "done";
  callId: string;
  triggerKey: string;
  observationRevision: number;
  frozenAtSimulationSeconds: number;
};

export type LlmOrchestrationState = {
  pending: null | LlmOrchestrationPending;
  acceptedCallIds: string[]; // ring max 32
};

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
      kind: "configure-water-distribution-spur";
      actorAgentId: "captain" | "life-support";
      spurId: WaterDistributionSpurId;
      /** Valve open command; effective delivery also scales by spur condition. */
      commandedOpenFraction?: number;
      /**
       * Crew may only repair to `nominal`. Faults (`degraded` / `stuck-closed`)
       * remain god / environment interventions.
       */
      condition?: "nominal";
    }
  | {
      kind: "configure-habitat-thermal-delivery-spur";
      actorAgentId: "captain" | "engineering";
      spurId: HabitatThermalDeliverySpurId;
      /** Valve open command; effective delivery also scales by spur condition. */
      commandedOpenFraction?: number;
      /**
       * Crew may only repair to `nominal`. Faults (`degraded` / `stuck-closed`)
       * remain god / environment interventions.
       */
      condition?: "nominal";
    }
  | {
      kind: "schedule-maintenance";
      actorAgentId: "captain" | "engineering";
      assetId: MaintenanceAssetId;
    }
  | {
      kind: "revise-mission";
      actorAgentId: "captain";
      disposition: MissionDisposition;
      destination: string;
      objective: string;
      route: MissionWaypoint[];
      totalDistanceLightYears: number;
      totalLegs: number;
    }
  | {
      kind: "manage-department-order";
      actorAgentId: "captain";
      action: "create" | "change" | "cancel" | "request-report";
      orderId?: string;
      departmentId?: ShipDepartmentId;
      title?: string;
      instruction?: string;
      priority?: OrderPriority;
      deadlineSeconds?: number;
      estimatedWorkSeconds?: number;
      reportingIntervalSeconds?: number;
      reason?: string;
    }
  | {
      kind: "publish-communication";
      actorAgentId: "captain" | "passenger-affairs" | "passenger-service";
      communicationKind: CommunicationKind;
      audienceOrTarget: string;
      subject: string;
      message: string;
      deliveryDelaySeconds?: number;
      relatedGrievanceId?: string;
    }
  | {
      /** 关键乘客向世界申诉队列提交一条申诉；actor 须为关键乘客本人。 */
      kind: "file-passenger-grievance";
      actorAgentId: string;
      passengerId: string;
      category: string;
      summary: string;
    }
  | {
      kind: "manage-crew-assignment";
      actorAgentId: "captain";
      personId: string;
      departmentId: ShipDepartmentId;
      role: string;
      shiftId: DutyShiftId;
      dutyZoneId: ZoneId | null;
      departmentHead: boolean;
    }
  | {
      kind: "manage-person";
      actorAgentId: "captain" | "medical" | "security";
      action:
        | "wake"
        | "hibernate"
        | "triage"
        | "treat"
        | "transfer"
        | "evacuate";
      personId: string;
      zoneId?: ZoneId;
      triageLevel?: TriageLevel;
      treatmentPlan?: string;
      priority?: OrderPriority;
    }
  | {
      kind: "manage-security";
      actorAgentId: "captain" | "security";
      action: "deploy" | "set-access" | "detain" | "release" | "investigate" | "protect";
      teamId?: SecurityTeamId;
      zoneId?: ZoneId;
      connectionId?: string;
      accessMode?: "open" | "restricted" | "sealed";
      personId?: string;
      caseId?: string;
      reason: string;
    }
  | {
      kind: "manage-logistics";
      actorAgentId: "captain" | "engineering" | "life-support" | "passenger-affairs";
      action:
        | "set-ration"
        | "configure-agriculture"
        | "move-cargo"
        | "allocate-cabin"
        | "manufacture-part"
        | "approve-substitution";
      rationKgPerPersonDay?: number;
      agricultureBayId?: AgricultureBayId;
      crop?: string;
      intensityFraction?: number;
      cargoId?: string;
      quantity?: number;
      destinationZoneId?: ZoneId;
      personId?: string;
      cabinId?: string;
      fabricatorId?: FabricatorId;
      partId?: MaintenancePartId;
      assetId?: MaintenanceAssetId;
      deratingFraction?: number;
      reason?: string;
    }
  | {
      kind: "set-compartment-connection";
      actorAgentId: "captain" | "engineering" | "life-support" | "security";
      connectionId: string;
      commandedOpenFraction: number;
    }
  | {
      kind: "schedule-hull-repair";
      actorAgentId: "captain" | "engineering";
      breachId: string;
      priority: OrderPriority;
    }
  | {
      kind: "set-thermal-control";
      actorAgentId: "captain" | "engineering";
      targetType: "radiator" | "heat-exchanger";
      radiatorId?: RadiatorId;
      heatExchangerId?: HeatExchangerId;
      controlFraction: number;
    }
  | {
      kind: "set-atmosphere-supply";
      actorAgentId: "captain" | "life-support";
      zoneId: ZoneId;
      gas: "oxygen" | "nitrogen" | "carbonDioxide" | "waterVapor";
      massKg: number;
      operation: "add" | "remove";
    }
  | {
      kind: "set-oxygen-production";
      actorAgentId: "captain" | "life-support";
      generatorId: OxygenGeneratorId;
      enabled: boolean;
      targetProductionKgPerHour: number;
    }
  | {
      kind: "distribute-water";
      actorAgentId: "captain" | "engineering" | "life-support";
      action: "set-zone-allocation" | "transfer-between-rings";
      zoneId?: ZoneId;
      kgPerAwakePersonDay?: number;
      fromRing?: "a" | "b";
      toRing?: "a" | "b";
      massKg?: number;
    }
  | {
      kind: "reset-protection";
      actorAgentId: "captain" | "engineering";
      targetType: "reactor" | "breaker";
      reactorId?: FusionReactorId;
      breakerId?: ElectricalBreakerId;
    }
  | {
      kind: "manage-maintenance-task";
      actorAgentId: "captain" | "engineering";
      action: "cancel" | "set-priority" | "reassign";
      taskId: string;
      priority?: OrderPriority;
      crewId?: string;
      robotId?: string;
      reason?: string;
    }
  | {
      kind: "manage-sensor-operation";
      actorAgentId: "captain" | "navigation" | "engineering" | "life-support";
      action: "set-frequency" | "active-scan";
      packageId: ActiveSensorPackageId;
      sampleIntervalSeconds?: number;
      target?: string;
      durationSeconds?: number;
      priority?: OrderPriority;
    }
  | {
      kind: "manage-remote-asset";
      actorAgentId: "captain" | "navigation" | "engineering" | "security";
      assetId: RemoteAssetId;
      action: "deploy" | "recover" | "retask";
      mission: string;
      target: string;
    }
  | {
      kind: "set-power-allocation";
      actorAgentId: "captain" | "engineering";
      loadId: ElectricalLoadId;
      maximumDemandFraction: number;
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
  waterDistributionSpurId?: WaterDistributionSpurId;
  waterDistributionSpurCommandedOpenFraction?: number;
  waterDistributionSpurCondition?: WaterDistributionSpurCondition;
  waterDistributionSpurEffectiveDeliveryFraction?: number;
  habitatThermalDeliverySpurId?: HabitatThermalDeliverySpurId;
  habitatThermalDeliverySpurCommandedOpenFraction?: number;
  habitatThermalDeliverySpurCondition?: HabitatThermalDeliverySpurCondition;
  habitatThermalDeliverySpurEffectiveDeliveryFraction?: number;
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
      /**
       * Optional world-time boundary that this step must not cross.
       *
       * The Worker acquires the supplied pause token atomically when the
       * boundary is reached, before publishing the stepped state. This keeps
       * deadline-driven decisions from being discovered after an oversized
       * accelerated-time step.
       */
      blockingBoundary?: {
        id: string;
        atSimulationSeconds: number;
        pauseToken: string;
      };
    }
  | {
      type: "set-time-control";
      requestId: string;
      timeScale?: number;
      acquirePauseTokens?: string[];
      releasePauseTokens?: string[];
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
    }
  | {
      type: "llm-effect-accept";
      requestId: string;
      callId: string;
      observationRevision: number;
      result: {
        toolCalls?: unknown[];
        [key: string]: unknown;
      };
    }
  | {
      type: "llm-effect-fail";
      requestId: string;
      callId: string;
      observationRevision: number;
      reason: string;
      retryable: boolean;
    }
  | {
      type: "llm-effect-finish";
      requestId: string;
      callId: string;
      advancesRoutineSchedule: boolean;
      nextCaptainRoutineAtSimulationSeconds?: number | null;
      captainJournal?: CaptainJournalSnapshot;
      captainWatch?: CaptainWatchSnapshot;
      departmentStanding?: DepartmentStandingSnapshot;
      passengerSociety?: PassengerSocietySnapshot;
      departmentInbox?: DepartmentInboxSnapshot;
    }
  | {
      type: "set-runtime-sidecars";
      requestId: string;
      captainJournal?: CaptainJournalSnapshot;
      captainWatch?: CaptainWatchSnapshot;
      departmentStanding?: DepartmentStandingSnapshot;
      passengerSociety?: PassengerSocietySnapshot;
      departmentInbox?: DepartmentInboxSnapshot;
      /** Bounded awake-passenger stress nudges from rumor morale (0..cap). */
      zoneStressDeltas?: Array<{ zoneId: string; stressDelta: number }>;
    };

export interface SimulationWorkerTimeControlTelemetry {
  timeScale: number;
  effectiveTimeScale: number;
  paused: boolean;
  pauseTokens: string[];
  reachedBlockingBoundary: {
    id: string;
    atSimulationSeconds: number;
  } | null;
  owedSimSeconds: number;
  fidelityLocked: boolean;
  droppedSimSecondsCumulative: number;
}

export interface SimulationWorkerSurvivalTelemetry {
  rationFoodConsumedKg: number;
  starvationExposurePersonSeconds: number;
  foodDryKg: number;
}

export interface HullConsequenceTelemetry {
  hullIntegrity: number;
  activeBreachCount: number;
  totalBreachAreaSquareMeters: number;
  jumpBlocked: boolean;
  jumpBlockReason: string | null;
  thrustPerformanceByRing: { a: number; b: number };
  events: Array<{
    id: string;
    zoneId: ZoneId;
    ring: "a" | "b";
    cascadeStage: 0 | 1 | 2 | 3;
    unrepairedSeconds: number;
    nextCascadeSeconds: number | null;
    appliedFaultKeys: string[];
  }>;
}

export interface SimulationWorkerState {
  elapsedSeconds: number;
  state: ShipState;
  passengers: PassengerPopulationSummary;
  passengerHighlights: PassengerHighlightTelemetry[];
  zoneMood: ZoneMoodTelemetry[];
  passengerCircles: PassengerCircleTelemetry[];
  compartments: CompartmentTelemetry;
  cooling: CoolingTelemetry;
  electrical: ElectricalTelemetry;
  navigation: NavigationTelemetry;
  rotation: RotationTelemetry;
  waterRecovery: WaterRecoveryTelemetry;
  maintenance: MaintenanceTelemetry;
  operations: CaptainOperationsSnapshot;
  commandBus: CommandBusTelemetry;
  timeControl: SimulationWorkerTimeControlTelemetry;
  proceduralEvents: ProceduralWorldEvent[];
  survival: SimulationWorkerSurvivalTelemetry;
  hullConsequence: HullConsequenceTelemetry;
  /** UI waiting-tone summary; null pending means no Worker-owned LLM freeze. */
  llmOrchestration?: {
    pending: null | Pick<
      LlmOrchestrationPending,
      | "kind"
      | "phase"
      | "callId"
      | "triggerKey"
      | "observationRevision"
      | "frozenAtSimulationSeconds"
    >;
  };
  /** Runtime-owned passenger society mirror (v20+); UI may also keep a React copy. */
  passengerSociety?: PassengerSocietySnapshot;
  /** Captain→department inbox mirror (v21+); UI may also keep a React copy. */
  departmentInbox?: DepartmentInboxSnapshot;
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

export interface WaterDistributionSpurTelemetry {
  spurId: WaterDistributionSpurId;
  ring: WaterRing;
  condition: WaterDistributionSpurCondition;
  commandedOpenFraction: number;
  effectiveDeliveryFraction: number;
  lastDeliveryShortfallKg: number;
}

export interface WaterRecoveryTelemetry {
  controllers: Array<
    Pick<
      WaterProcessor,
      "id" | "ring" | "commandedThroughputFraction"
    >
  >;
  /** Per-ring potable distribution spurs (tank → users). */
  distributionSpurs: WaterDistributionSpurTelemetry[];
  /** Cumulative requested potable the spurs did not deliver. */
  undeliveredPotableKg: number;
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

/** 区带级群体情绪聚合：让关键乘客能代表周围人群发声，而不是只知道自己 */
export interface ZoneMoodTelemetry {
  zoneId: string;
  awakeCount: number;
  meanStress: number; // 0..1
  meanTrust: number; // 0..1
  meanPhysicalHealth: number; // 0..1
}

/** 关键乘客的关系圈成员真值投影；分档转换由消费方负责，Worker 不做认知降级 */
export interface PassengerCircleMemberTelemetry {
  passengerId: string;
  displayName: string;
  relation: "family" | "peer";
  lifeState: "awake" | "hibernating" | "deceased";
  physicalHealth: number; // 0..1
  zoneId: string;
}

export interface PassengerCircleTelemetry {
  passengerId: string;
  members: PassengerCircleMemberTelemetry[];
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
  snapshotVersion: 16 | 17 | 18 | 19 | 20 | 21;
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
  operations?: CaptainOperationsSnapshot;
  commandBus: CommandBusSnapshot;
  passengerEnvironmentalExposures:
    PassengerEnvironmentalExposureState[];
  timeDirector: TimeDirectorSnapshot;
  proceduralWorld: ProceduralWorldSnapshot;
  survival: SurvivalSnapshot;
  /** Present on snapshotVersion >= 18; older saves restore as empty registry. */
  hullConsequence?: HullConsequenceSnapshot;
  /** Present on snapshotVersion >= 19; older saves restore empty defaults. */
  llmOrchestration?: LlmOrchestrationState;
  nextCaptainRoutineAtSimulationSeconds?: number | null;
  captainJournal?: CaptainJournalSnapshot;
  captainWatch?: CaptainWatchSnapshot;
  departmentStanding?: DepartmentStandingSnapshot;
  /** Present on snapshotVersion >= 20; older saves restore empty society. */
  passengerSociety?: PassengerSocietySnapshot;
  /** Present on snapshotVersion >= 21; older saves restore empty inbox. */
  departmentInbox?: DepartmentInboxSnapshot;
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

export interface HabitatThermalDeliverySpurTelemetry {
  spurId: HabitatThermalDeliverySpurId;
  ring: CoolingHabitatRing;
  condition: HabitatThermalDeliverySpurCondition;
  commandedOpenFraction: number;
  effectiveDeliveryFraction: number;
  lastDeliveryShortfallJ: number;
}

export interface CoolingTelemetry {
  observed: {
    thermalBusTemperatureK: number | null;
    averageCoolantTemperatureK: number | null;
    totalMassFlowKgPerSecond: number | null;
    totalRadiatedPowerW: number | null;
  };
  sensors: CoolingSensorTelemetry[];
  /** Per-ring habitat thermal delivery spurs (heat pump → cabin zones). */
  habitatThermalDeliverySpurs: HabitatThermalDeliverySpurTelemetry[];
  /** Cumulative requested habitat cooling the spurs did not deliver (J). */
  undeliveredHabitatCoolingJ: number;
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
  role: ZoneRole;
  labelZh: string;
  purposeZh: string;
  ring: "A" | "B";
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
    }
  | {
      type: "llm-effect-request";
      requestId: string;
      payload: {
        callId: string;
        kind: "captain-blocking";
        triggerKey: string;
        observationRevision: number;
        frozenAtSimulationSeconds: number;
        agentId: "captain";
      };
    }
  | {
      type: "llm-effect-aborted";
      requestId: string;
      payload: {
        callId: string;
        kind: "captain-blocking";
        triggerKey: string;
        observationRevision: number;
        frozenAtSimulationSeconds: number;
        reason: "restored-during-tool-apply";
      };
    };
