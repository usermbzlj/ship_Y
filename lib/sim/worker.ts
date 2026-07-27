import {
  createBaselineShipState,
  SimulationEngine,
} from "./index.ts";
import {
  AIR_HANDLER_IDS,
  BASELINE_ZONE_IDS,
  CompartmentAtmosphereNetwork,
  resolveZoneIdForCabin,
  zoneCatalogEntry,
  zoneIdsForRole,
} from "./compartments.ts";
import {
  hibernationPowerBankForPodId,
  PassengerSimulation,
  DEFAULT_KEY_LLM_PASSENGER_IDS,
} from "./passengers.ts";
import {
  CoolingThermalNetwork,
  effectiveHabitatThermalDeliveryFraction,
  HABITAT_THERMAL_DELIVERY_SPUR_IDS,
} from "./cooling.ts";
import {
  DeterministicCommandBus,
} from "./command-bus.ts";
import {
  ELECTRICAL_LOAD_IDS,
  ShipElectricalNetwork,
} from "./electrical.ts";
import { RigidBodyNavigation } from "./navigation.ts";
import { CounterRotatingHabitat } from "./rotation.ts";
import {
  WATER_PROCESSOR_IDS,
  WaterRecoveryNetwork,
} from "./water.ts";
import {
  MaintenanceNetwork,
} from "./maintenance.ts";
import {
  HullConsequenceNetwork,
  type HullCascadeAction,
  type HullRingId,
} from "./hull-consequence.ts";
import { SimulationTimeDirector } from "./director.ts";
import {
  agricultureCo2YieldFactor,
  CaptainOperations,
  type CaptainOperationsSnapshot,
  type OperationsTask,
  type ShipDepartmentId,
} from "./captain-operations.ts";
import type { TimeDirectorSnapshot } from "./director.ts";
import {
  ProceduralWorldScheduler,
  type ProceduralWorldEvent,
  type ProceduralWorldSnapshot,
} from "./procedural-world.ts";
import {
  createEmptySurvivalLedger,
  medicalTreatmentEffectMultiplier,
  restoreSurvival,
  snapshotSurvival,
  type SurvivalLedger,
  type ZoneHazardDose,
} from "./survival.ts";
import type {
  AirHandlerId,
  CompartmentStepResult,
  ZoneId,
  ZoneRole,
} from "./compartments";
import type {
  CoolingNetworkSnapshot,
} from "./cooling";
import type {
  ElectricalLoadId,
  ElectricalNetworkSnapshot,
  ElectricalStepResult,
} from "./electrical";
import type {
  NavigationSnapshot,
  PropulsionControlPreview,
  PropulsionControlTrainId,
} from "./navigation";
import type {
  RotationCarrierState,
  RotationControlPreview,
  RotationRingId,
  RotationSnapshot,
  RingTruthSummary,
} from "./rotation";
import type {
  WaterProcessorId,
  WaterRecoverySnapshot,
  WaterRing,
} from "./water";
import type {
  MaintenanceConditionRecord,
  MaintenanceSnapshot,
} from "./maintenance";
import type {
  StructuredCommandResult,
} from "./command-bus";
import type {
  ApplyPassengerIncidentInput,
  HibernationPowerIncidentThreshold,
} from "./passengers";
import type {
  ExternalInterventionRecord,
  ExternalInterventionRequest,
  SimulationSnapshot,
} from "./index";
import type {
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  FinalJourneyReport,
  NavigationTelemetry,
  PassengerEnvironmentalExposureState,
  RuntimeSimulationSnapshot,
  ShipOperationalCommand,
  ShipOperationalCommandResult,
  SimulationWorkerCommand,
  SimulationWorkerEvent,
  SimulationWorkerState,
} from "./protocol";
import {
  assertProjectionAtMost,
  assertProjectionClose,
  compartmentTelemetry as projectCompartmentTelemetry,
  coolingTelemetry as projectCoolingTelemetry,
  currentRotationCarrierState as projectRotationCarrierState,
  electricalTelemetry as projectElectricalTelemetry,
  navigationTelemetry as projectNavigationTelemetry,
  projectWorkerState,
  projectedElectricalPowerState as projectElectricalPowerState,
  projectedThermalNetworkState as projectThermalNetworkState,
} from "./projection.ts";
import {
  applyContinuousRosterDeltas as habitabilityApplyContinuousRosterDeltas,
  applyIncidentToRoster as habitabilityApplyIncidentToRoster,
  applyRotationHabitabilityThresholdCrossings as habitabilityApplyRotationHabitabilityThresholdCrossings,
  applySurvivalRationAndStarvation as habitabilityApplySurvivalRationAndStarvation,
  awakePassengersInRing as habitabilityAwakePassengersInRing,
  awakePassengersInZone as habitabilityAwakePassengersInZone,
  createPassengerEnvironmentalExposureStates,
  createSurvivalZoneDoses,
  updatePassengerEnvironmentalExposures as habitabilityUpdatePassengerEnvironmentalExposures,
  validatePassengerEnvironmentalExposureStates,
} from "./habitability.ts";
import {
  applyCompartmentInterventionEffects as interventionsApplyCompartmentInterventionEffects,
  applyCoolingInterventionEffects as interventionsApplyCoolingInterventionEffects,
  applyElectricalInterventionEffects as interventionsApplyElectricalInterventionEffects,
  applyNavigationInterventionEffects as interventionsApplyNavigationInterventionEffects,
  applyRotationInterventionEffects as interventionsApplyRotationInterventionEffects,
  applyWaterInterventionEffects as interventionsApplyWaterInterventionEffects,
  buildProceduralInterventionRequest as interventionsBuildProceduralInterventionRequest,
  normalizeAirHandlerTrip as interventionsNormalizeAirHandlerTrip,
  normalizeCoolingSpurFault as interventionsNormalizeCoolingSpurFault,
  normalizeDirectForceBalance as interventionsNormalizeDirectForceBalance,
  normalizeRingBearingDegradation as interventionsNormalizeRingBearingDegradation,
  normalizeWaterProcessorTrip as interventionsNormalizeWaterProcessorTrip,
  normalizeWaterSpurFault as interventionsNormalizeWaterSpurFault,
  replaceEquivalentBreachArea as interventionsReplaceEquivalentBreachArea,
} from "./interventions.ts";
import {
  executeShipCommand as executeRegisteredShipCommand,
  type CommandHandlerContext,
} from "./command-handlers/index.ts";

let engine = new SimulationEngine({
  seed: "far-horizon-preview",
  powerAuthority: "external-network",
  atmosphereAuthority: "external-network",
  thermalAuthority: "external-network",
  populationAuthority: "external-roster",
  waterAuthority: "external-network",
});
let passengers = new PassengerSimulation("far-horizon-preview:population");
let compartments = new CompartmentAtmosphereNetwork({
  seed: "far-horizon-preview:compartments",
  metabolicHeatAuthority: "external-network",
});
let cooling = new CoolingThermalNetwork({
  seed: "far-horizon-preview:cooling",
});
let electrical = new ShipElectricalNetwork({
  seed: "far-horizon-preview:electrical",
});
let navigation = new RigidBodyNavigation({
  seed: "far-horizon-preview:navigation",
});
let rotation = new CounterRotatingHabitat({
  seed: "far-horizon-preview:rotation",
  initialCarrierState: {
    angularVelocityXRadPerS:
      navigation.getBodyState().angularVelocityBodyRadPerS.x,
    inertiaXKgM2:
      navigation.getCurrentInertiaDiagonal().x,
    revision: navigation.revision,
  },
});
let water = new WaterRecoveryNetwork();
let maintenance = new MaintenanceNetwork();
let hullConsequence = HullConsequenceNetwork.create();
let hullDeratedThrusterIds = new Set<string>();
let captainOperations = new CaptainOperations({
  origin: engine.getState().journey.origin,
  destination: engine.getState().journey.destination,
  objective: "保证乘员存续并安全抵达。",
  zoneIds: BASELINE_ZONE_IDS,
  electricalLoadIds: ELECTRICAL_LOAD_IDS,
});

type ShipCommandActorId =
  | "captain"
  | "navigation"
  | "engineering"
  | "life-support"
  | "medical"
  | "passenger-affairs"
  | "security"
  | "passenger-service"
  | (typeof DEFAULT_KEY_LLM_PASSENGER_IDS)[number];
type ShipCommandRole =
  | "captain"
  | "navigation"
  | "engineering"
  | "medical"
  | "life-support"
  | "passenger-affairs"
  | "security"
  | "passenger-service"
  | "key-passenger";
type ShipCommandKind = ShipOperationalCommand["kind"];

const SHIP_COMMAND_ACTORS: ReadonlyArray<{
  id: ShipCommandActorId;
  role: ShipCommandRole;
}> = [
  { id: "captain", role: "captain" },
  { id: "navigation", role: "navigation" },
  { id: "engineering", role: "engineering" },
  { id: "medical", role: "medical" },
  { id: "life-support", role: "life-support" },
  {
    id: "passenger-affairs",
    role: "passenger-affairs",
  },
  { id: "security", role: "security" },
  {
    id: "passenger-service",
    role: "passenger-service",
  },
  ...DEFAULT_KEY_LLM_PASSENGER_IDS.map((id) => ({
    id: id as ShipCommandActorId,
    role: "key-passenger" as const,
  })),
];

function createCommandBus(): DeterministicCommandBus<
  ShipCommandActorId,
  ShipCommandRole,
  ShipCommandKind
> {
  return new DeterministicCommandBus({
    actors: SHIP_COMMAND_ACTORS,
    permissions: [
      {
        role: "captain",
        kinds: [
          "execute-jump",
          "set-awake-target",
          "isolate-pressure-zone",
          "schedule-thruster-pulse",
          "schedule-thruster-maneuver",
          "set-reactor-target",
          "set-reactor-mode",
          "set-cooling-pump-speed",
          "set-electrical-load-enabled",
          "set-electrical-breaker",
          "set-battery-mode",
          "set-habitat-ring-control",
          "set-air-handler-control",
          "set-water-processor-control",
          "configure-water-distribution-spur",
          "configure-habitat-thermal-delivery-spur",
          "schedule-maintenance",
          "revise-mission",
          "manage-department-order",
          "publish-communication",
          "manage-crew-assignment",
          "manage-person",
          "manage-security",
          "manage-logistics",
          "set-compartment-connection",
          "schedule-hull-repair",
          "set-thermal-control",
          "set-atmosphere-supply",
          "set-oxygen-production",
          "distribute-water",
          "reset-protection",
          "manage-maintenance-task",
          "manage-sensor-operation",
          "manage-remote-asset",
          "set-power-allocation",
        ],
      },
      {
        role: "navigation",
        kinds: [
          "execute-jump",
          "schedule-thruster-pulse",
          "schedule-thruster-maneuver",
        ],
      },
      {
        role: "engineering",
        kinds: [
          "set-reactor-target",
          "set-reactor-mode",
          "set-cooling-pump-speed",
          "set-electrical-load-enabled",
          "set-electrical-breaker",
          "set-battery-mode",
          "set-habitat-ring-control",
          "set-air-handler-control",
          "set-water-processor-control",
          "configure-habitat-thermal-delivery-spur",
          "schedule-maintenance",
          "manage-logistics",
          "set-compartment-connection",
          "schedule-hull-repair",
          "set-thermal-control",
          "distribute-water",
          "reset-protection",
          "manage-maintenance-task",
          "manage-sensor-operation",
          "manage-remote-asset",
          "set-power-allocation",
        ],
      },
      { role: "medical", kinds: ["set-awake-target", "manage-person"] },
      {
        role: "life-support",
        kinds: [
          "isolate-pressure-zone",
          "set-air-handler-control",
          "set-water-processor-control",
          "configure-water-distribution-spur",
          "manage-logistics",
          "set-compartment-connection",
          "set-atmosphere-supply",
          "set-oxygen-production",
          "distribute-water",
          "manage-sensor-operation",
        ],
      },
      {
        role: "passenger-affairs",
        kinds: ["publish-communication", "manage-logistics"],
      },
      {
        role: "security",
        kinds: [
          "isolate-pressure-zone",
          "manage-person",
          "manage-security",
          "set-compartment-connection",
          "manage-remote-asset",
        ],
      },
      {
        role: "passenger-service",
        kinds: ["publish-communication"],
      },
      {
        role: "key-passenger",
        kinds: ["file-passenger-grievance"],
      },
    ],
    historyCapacity: 512,
  });
}

let commandBus = createCommandBus();
let highestDirective = "";
let timeDirector = new SimulationTimeDirector(1_800);
let proceduralWorld = new ProceduralWorldScheduler("far-horizon-preview");
let survivalLedger: SurvivalLedger = createEmptySurvivalLedger();
let survivalZoneDoses: ZoneHazardDose[] = [];
let lastReachedBlockingBoundary: {
  id: string;
  atSimulationSeconds: number;
} | null = null;
let lastProceduralEvents: ProceduralWorldEvent[] = [];
const ELECTRICAL_COUPLING_INTERVAL_SECONDS = 60;
const CABIN_SENSIBLE_HEAT_W_PER_AWAKE_PERSON = 80;
const CABIN_HEAT_PUMP_LIFE_SUPPORT_POWER_SHARE = 0.05;
const CABIN_HEAT_PUMP_CARNOT_EFFICIENCY = 0.45;
const CABIN_HEAT_PUMP_MINIMUM_COP = 1.1;
const CABIN_HEAT_PUMP_MAXIMUM_COP = 6;
/** Habitat-comfort roles weigh cold-side T; cargo/industrial/access lightly. */
const CABIN_HEAT_PUMP_COLD_SIDE_ROLE_WEIGHT: Record<ZoneRole, number> = {
  living: 1,
  public: 1,
  medical: 1,
  galley: 1,
  agriculture: 0.5,
  cargo: 0.25,
  industrial: 0.25,
  access: 0.25,
};
const ELECTRICAL_LOAD_THERMALIZATION_FRACTION = {
  "life-support-a": 0.08,
  "life-support-b": 0.08,
  "hibernation-a": 0.12,
  "hibernation-b": 0.12,
  "cooling-a": 0.06,
  "cooling-b": 0.06,
  "habitat-a": 0.14,
  "habitat-b": 0.14,
  "jump-drive-a": 0,
  "jump-drive-b": 0,
  "propulsion-control-a": 0,
  "propulsion-control-b": 0,
  "rotation-drive-a": 0,
  "rotation-drive-b": 0,
} as const satisfies Readonly<
  Record<ElectricalLoadId, number>
>;
const JUMP_DRIVE_LOAD_IDS = [
  "jump-drive-a",
  "jump-drive-b",
] as const satisfies readonly ElectricalLoadId[];
const PROPULSION_CONTROL_LOAD_IDS = [
  "propulsion-control-a",
  "propulsion-control-b",
] as const satisfies readonly PropulsionControlTrainId[];
const ROTATION_DRIVE_LOAD_BY_RING = {
  "ring-a": "rotation-drive-a",
  "ring-b": "rotation-drive-b",
} as const satisfies Readonly<
  Record<RotationRingId, ElectricalLoadId>
>;
const LIFE_SUPPORT_LOAD_IDS = [
  "life-support-a",
  "life-support-b",
] as const satisfies readonly ElectricalLoadId[];
const AIR_HANDLER_LOAD_BY_ID = {
  "air-handler-a": "life-support-a",
  "air-handler-b": "life-support-b",
} as const satisfies Readonly<Record<AirHandlerId, ElectricalLoadId>>;
const WATER_PROCESSOR_LOAD_BY_ID = {
  "water-processor-a": "life-support-a",
  "water-processor-b": "life-support-b",
} as const satisfies Readonly<Record<WaterProcessorId, ElectricalLoadId>>;
const MAINTENANCE_WORKSHOP_LOAD_BY_RING = {
  a: "habitat-a",
  b: "habitat-b",
} as const satisfies Readonly<Record<WaterRing, ElectricalLoadId>>;
let lastCompartmentStep: Pick<
  CompartmentStepResult,
  "fidelityMode" | "fineSubsteps" | "equilibriumIntervals"
> = {
  fidelityMode: "equilibrium-fast",
  fineSubsteps: 0,
  equilibriumIntervals: 0,
};
let requestedTimeScale = 1;
let effectiveTimeScale = 1;

function applyContinuousRosterDeltas(
  targetPassengerIds: readonly string[],
  deltas: {
    physical?: number;
    stress?: number;
  },
): void {
  habitabilityApplyContinuousRosterDeltas(
    passengers,
    targetPassengerIds,
    deltas,
    (next) => {
      passengers = next;
      synchronizePopulationAggregate();
      synchronizeCompartmentOccupants();
    },
  );
}

let passengerEnvironmentalExposures =
  createPassengerEnvironmentalExposureStates();
survivalZoneDoses = createSurvivalZoneDoses();

function compartmentTelemetry(): CompartmentTelemetry {
  return projectCompartmentTelemetry({
    compartments,
    lastCompartmentStep,
    requestedTimeScale,
    effectiveTimeScale,
  });
}

function coolingTelemetry(): CoolingTelemetry {
  return projectCoolingTelemetry(cooling);
}

function electricalTelemetry(): ElectricalTelemetry {
  return projectElectricalTelemetry(electrical);
}

function navigationTelemetry(): NavigationTelemetry {
  return projectNavigationTelemetry(navigation);
}

function currentRotationCarrierState(): RotationCarrierState {
  return projectRotationCarrierState(navigation);
}

function projectedElectricalPowerState(
  network = electrical,
) {
  return projectElectricalPowerState(network);
}

function projectedThermalNetworkState(
  coolingNetwork = cooling,
  compartmentNetwork = compartments,
) {
  return projectThermalNetworkState(
    coolingNetwork,
    compartmentNetwork,
  );
}

function currentState(): SimulationWorkerState {
  return projectWorkerState({
    engine,
    passengers,
    compartments,
    cooling,
    electrical,
    navigation,
    rotation,
    water,
    maintenance,
    hullConsequence,
    captainOperations,
    commandBus,
    timeDirector,
    lastReachedBlockingBoundary,
    lastProceduralEvents,
    survivalLedger,
    lastCompartmentStep,
    requestedTimeScale,
    effectiveTimeScale,
    currentZoneForPerson,
    maintenanceConditions: currentMaintenanceConditions(),
  });
}

function synchronizeElectricalAggregate(): void {
  engine.synchronizePowerNetwork(
    projectedElectricalPowerState(),
  );
}

function electricalInstantaneousFingerprint(
  snapshot: ElectricalNetworkSnapshot,
): string {
  return JSON.stringify({
    buses: snapshot.buses.map((bus) => [
      bus.generationPowerKw,
      bus.batteryPowerKw,
      bus.demandedPowerKw,
      bus.servedPowerKw,
      bus.unservedPowerKw,
      bus.curtailedPowerKw,
      bus.netTransferPowerKw,
    ]),
    loads: snapshot.loads.map((load) => [
      load.servedPowerKw,
      load.unservedPowerKw,
    ]),
    batteries: snapshot.batteries.map((battery) => battery.lastPowerKw),
    breakers: snapshot.breakers.map((breaker) => breaker.currentPowerKw),
  });
}

interface ElectricalCouplingResult {
  demandedLoadEnergyKWhById: Record<ElectricalLoadId, number>;
  servedLoadEnergyKWhById: Record<ElectricalLoadId, number>;
}

function emptyElectricalLoadEnergyRecord(): Record<
  ElectricalLoadId,
  number
> {
  return Object.fromEntries(
    electrical.listLoads().map((load) => [load.id, 0]),
  ) as Record<ElectricalLoadId, number>;
}

function synchronizeJumpDriveControllerDemand(
  intervalSeconds: number,
): void {
  const journey = engine.getState().journey;
  let demandFraction = 0;
  if (journey.status === "charging") {
    const requiredInputEnergyKWh =
      Math.max(
        0,
        journey.requiredChargePerJumpKWh -
          journey.jumpDriveChargeKWh,
      ) / journey.jumpDriveChargeEfficiency;
    const connectedBreakers = new Map(
      electrical
        .listBreakers()
        .map((breaker) => [breaker.id, breaker]),
    );
    const potentialPowerKw = electrical
      .listLoads()
      .filter((load) =>
        JUMP_DRIVE_LOAD_IDS.some((loadId) => loadId === load.id),
      )
      .filter((load) => {
        const breaker = connectedBreakers.get(load.breakerId);
        return (
          load.enabled &&
          breaker?.commandedClosed === true &&
          breaker.condition === "nominal"
        );
      })
      .reduce(
        (total, load) => total + load.demandedPowerKw,
        0,
      );
    const potentialEnergyKWh =
      potentialPowerKw * (intervalSeconds / 3_600);
    demandFraction =
      potentialEnergyKWh > 0
        ? Math.min(
            1,
            requiredInputEnergyKWh / potentialEnergyKWh,
          )
        : 1;
  }
  for (const loadId of JUMP_DRIVE_LOAD_IDS) {
    electrical.synchronizeLoadControllerDemandFraction(
      loadId,
      Math.min(demandFraction, captainOperations.getPowerAllocationLimit(loadId)),
    );
  }
}

function synchronizePropulsionControlDemand(
  preview: PropulsionControlPreview,
  intervalSeconds: number,
): void {
  for (const loadId of PROPULSION_CONTROL_LOAD_IDS) {
    const load = electrical.getLoad(loadId);
    const availableEnergyJ =
      load.demandedPowerKw * 1_000 * intervalSeconds;
    const requestedEnergyJ =
      preview.requestedEnergyJByTrain[loadId];
    if (
      availableEnergyJ === 0 &&
      requestedEnergyJ > 0
    ) {
      throw new Error(
        `${loadId} cannot represent a non-zero propulsion control request over a zero interval`,
      );
    }
    const demandFraction =
      availableEnergyJ > 0
        ? requestedEnergyJ / availableEnergyJ
        : 0;
    if (demandFraction > 1 + 1e-12) {
      throw new Error(
        `${loadId} propulsion control request exceeds its fixed electrical rating`,
      );
    }
    electrical.synchronizeLoadControllerDemandFraction(
      loadId,
      Math.min(
        captainOperations.getPowerAllocationLimit(loadId),
        Math.max(0, demandFraction),
      ),
    );
  }
}

function synchronizeRotationDriveDemand(
  preview: RotationControlPreview,
  intervalSeconds: number,
): void {
  for (const ringId of [
    "ring-a",
    "ring-b",
  ] as const satisfies readonly RotationRingId[]) {
    const loadId = ROTATION_DRIVE_LOAD_BY_RING[ringId];
    const load = electrical.getLoad(loadId);
    const availableEnergyJ =
      load.demandedPowerKw * 1_000 * intervalSeconds;
    const requestedEnergyJ =
      preview.requestedEnergyJByRing[ringId];
    if (
      availableEnergyJ === 0 &&
      requestedEnergyJ > 0
    ) {
      throw new Error(
        `${loadId} cannot represent a non-zero rotation drive request over a zero interval`,
      );
    }
    const demandFraction =
      availableEnergyJ > 0
        ? requestedEnergyJ / availableEnergyJ
        : 0;
    electrical.synchronizeLoadControllerDemandFraction(
      loadId,
      Math.min(
        captainOperations.getPowerAllocationLimit(loadId),
        Math.max(0, demandFraction),
      ),
    );
  }
}

function advanceElectricalCoupling(
  simulatedSeconds: number,
  propulsionPreview: PropulsionControlPreview,
  rotationPreview: RotationControlPreview,
): ElectricalCouplingResult {
  const demandedLoadEnergyKWhById =
    emptyElectricalLoadEnergyRecord();
  const servedLoadEnergyKWhById =
    emptyElectricalLoadEnergyRecord();
  let jumpDriveDissipatedHeatEnergyKWh = 0;
  let electricalConversionLossKWh = 0;
  let remainingMicroseconds = Math.round(
    simulatedSeconds * 1_000_000,
  );
  // The rotation preview covers the whole outer coupling interval. Apply its
  // average demand once; treating the full requested energy as a fresh demand
  // in every internal 60-second electrical slice multiplies it incorrectly.
  synchronizeRotationDriveDemand(rotationPreview, simulatedSeconds);
  while (remainingMicroseconds > 0) {
    const intervalMicroseconds = Math.min(
      ELECTRICAL_COUPLING_INTERVAL_SECONDS * 1_000_000,
      remainingMicroseconds,
    );
    const intervalSeconds = intervalMicroseconds / 1_000_000;
    synchronizeJumpDriveControllerDemand(intervalSeconds);
    synchronizePropulsionControlDemand(
      propulsionPreview,
      intervalSeconds,
    );
    const result: ElectricalStepResult =
      electrical.step(intervalSeconds);
    for (const load of electrical.listLoads()) {
      demandedLoadEnergyKWhById[load.id] +=
        result.demandedLoadEnergyKWhById[load.id];
      servedLoadEnergyKWhById[load.id] +=
        result.servedLoadEnergyKWhById[load.id];
    }
    const servedJumpEnergyKWh = JUMP_DRIVE_LOAD_IDS.reduce(
      (total, loadId) =>
        total + result.servedLoadEnergyKWhById[loadId],
      0,
    );
    const charge =
      engine.acceptExternallySuppliedJumpDriveEnergy(
        servedJumpEnergyKWh,
      );
    jumpDriveDissipatedHeatEnergyKWh +=
      charge.dissipatedHeatEnergyKWh;
    electricalConversionLossKWh +=
      result.batteryConversionLossKWh;
    remainingMicroseconds -= intervalMicroseconds;
  }
  if (jumpDriveDissipatedHeatEnergyKWh > 0) {
    cooling.applyExternalEnergy(
      "thermal-bus",
      jumpDriveDissipatedHeatEnergyKWh * 3_600_000,
      "jump-drive",
    );
  }
  if (electricalConversionLossKWh > 0) {
    cooling.applyExternalEnergy(
      "thermal-bus",
      electricalConversionLossKWh * 3_600_000,
      "electrical-loss",
    );
  }
  if (engine.getState().journey.status !== "charging") {
    synchronizeJumpDriveControllerDemand(0);
  }
  return {
    demandedLoadEnergyKWhById,
    servedLoadEnergyKWhById,
  };
}

function loadServiceFractionOverInterval(
  coupling: ElectricalCouplingResult,
  loadIds: readonly ElectricalLoadId[],
  simulatedSeconds: number,
): number {
  if (simulatedSeconds === 0) return 1;
  const loadById = new Map(
    electrical.listLoads().map((load) => [load.id, load]),
  );
  const nominalDemandEnergyKWh = loadIds.reduce(
    (total, loadId) =>
      total +
      (loadById.get(loadId)?.demandedPowerKw ?? 0) *
        (simulatedSeconds / 3_600),
    0,
  );
  if (nominalDemandEnergyKWh === 0) return 1;
  const servedEnergyKWh = loadIds.reduce(
    (total, loadId) =>
      total + coupling.servedLoadEnergyKWhById[loadId],
    0,
  );
  return Math.min(
    1,
    Math.max(0, servedEnergyKWh / nominalDemandEnergyKWh),
  );
}

/** Volume-weighted ag-zone CO₂ → plant yield factor [0, 1] per habitat ring. */
function agricultureCo2AvailabilityByRing(): Record<"a" | "b", number> {
  const forRing = (ring: "A" | "B"): number => {
    const zoneIds = zoneIdsForRole("agriculture", ring);
    let pressureVolumeSum = 0;
    let volumeCubicMeters = 0;
    for (const zoneId of zoneIds) {
      const zone = compartments.getZone(zoneId);
      const truth = compartments.getZoneTruth(zoneId);
      pressureVolumeSum +=
        truth.partialPressuresPa.carbonDioxide * zone.volumeCubicMeters;
      volumeCubicMeters += zone.volumeCubicMeters;
    }
    if (volumeCubicMeters <= 0) return 0;
    return agricultureCo2YieldFactor(pressureVolumeSum / volumeCubicMeters);
  };
  return { a: forRing("A"), b: forRing("B") };
}

function synchronizeCoolingElectricalSupply(
  coupling: ElectricalCouplingResult,
  simulatedSeconds: number,
): void {
  cooling.synchronizePumpElectricalSupplyFraction(
    "pump-a",
    loadServiceFractionOverInterval(
      coupling,
      ["cooling-a"],
      simulatedSeconds,
    ),
  );
  cooling.synchronizePumpElectricalSupplyFraction(
    "pump-b",
    loadServiceFractionOverInterval(
      coupling,
      ["cooling-b"],
      simulatedSeconds,
    ),
  );
}

function synchronizeServedLoadHeatSource(
  coupling: ElectricalCouplingResult,
  simulatedSeconds: number,
): void {
  if (simulatedSeconds <= 0) return;
  const thermalEnergyJ = (
    Object.entries(
      ELECTRICAL_LOAD_THERMALIZATION_FRACTION,
    ) as Array<[ElectricalLoadId, number]>
  ).reduce(
    (total, [loadId, thermalizationFraction]) =>
      total +
      coupling.servedLoadEnergyKWhById[loadId] *
        3_600_000 *
        thermalizationFraction,
    0,
  );
  const thermalPowerW = thermalEnergyJ / simulatedSeconds;
  const current = cooling
    .listHeatSources()
    .find(
      (source) =>
        source.id === "ship-service-thermal-load",
    );
  if (!current) {
    throw new Error(
      "cooling network is missing the ship service heat source",
    );
  }
  const enabled = thermalPowerW > 0;
  if (
    current.enabled === enabled &&
    Math.abs(current.thermalPowerW - thermalPowerW) < 1e-6
  ) {
    return;
  }
  cooling.configureHeatSource(
    "ship-service-thermal-load",
    {
      thermalPowerW,
      enabled,
    },
  );
}

function cabinCoolingFlowFraction(): number {
  const exchangerByLoop = new Map(
    cooling
      .listHeatExchangers()
      .map((exchanger) => [exchanger.loopId, exchanger]),
  );
  return Math.min(
    1,
    cooling.listPumps().reduce((total, pump) => {
      const exchanger = exchangerByLoop.get(pump.loopId);
      const flowFraction =
        pump.nominalMassFlowKgPerSecond === 0
          ? 0
          : Math.min(
              1,
              pump.lastMassFlowKgPerSecond /
                pump.nominalMassFlowKgPerSecond,
            );
      const conditionFraction =
        exchanger?.condition === "nominal"
          ? 1
          : exchanger?.condition === "degraded"
            ? 0.2
            : 0;
      return (
        total +
        flowFraction *
          (exchanger?.conductanceFraction ?? 0) *
          conditionFraction
      );
    }, 0),
  );
}

function applyHibernationPowerIncidents(
  thresholds: readonly HibernationPowerIncidentThreshold[],
): void {
  const impactByLevel: Readonly<
    Record<
      number,
      Pick<
        ApplyPassengerIncidentInput,
        | "healthImpact"
        | "psychologyImpact"
        | "experienceImpact"
        | "valence"
        | "salience"
      >
    >
  > = {
    1: {
      healthImpact: {
        physical: -0.005,
        resilience: -0.01,
        chronicRisk: 0.005,
      },
      psychologyImpact: { stability: -0.005, stress: 0.01 },
      experienceImpact: { safety: -0.01, hibernation: -0.02 },
      valence: -0.25,
      salience: 0.45,
    },
    2: {
      healthImpact: {
        physical: -0.025,
        resilience: -0.04,
        chronicRisk: 0.03,
      },
      psychologyImpact: { stability: -0.02, stress: 0.04 },
      experienceImpact: { safety: -0.05, hibernation: -0.08 },
      valence: -0.55,
      salience: 0.72,
    },
    3: {
      healthImpact: {
        physical: -0.08,
        resilience: -0.12,
        chronicRisk: 0.1,
      },
      psychologyImpact: { stability: -0.05, stress: 0.1 },
      experienceImpact: { safety: -0.15, hibernation: -0.2 },
      valence: -0.78,
      salience: 0.9,
    },
    4: {
      healthImpact: {
        physical: -0.25,
        resilience: -0.3,
        chronicRisk: 0.25,
      },
      psychologyImpact: { stability: -0.12, stress: 0.2 },
      experienceImpact: { safety: -0.3, hibernation: -0.35 },
      valence: -0.92,
      salience: 0.98,
    },
  };
  for (const threshold of thresholds) {
    const targetPassengerIds =
      passengers.getHibernatingPassengerIdsForPowerBank(
        threshold.bankId,
      );
    if (targetPassengerIds.length === 0) continue;
    const impact = impactByLevel[threshold.level];
    if (!impact) {
      throw new Error(
        `unsupported hibernation power incident level ${threshold.level}`,
      );
    }
    passengers.applyPassengerIncident({
      eventId:
        `hibernation-power-${threshold.bankId}` +
        `-outage-${threshold.outageSequence}` +
        `-level-${threshold.level}`,
      eventType: "hibernation-power-undervoltage",
      summary:
        `${threshold.bankId.toUpperCase()} 路休眠舱本地储备耗尽，` +
        `未保护低温维持剂量累计 ${Math.round(threshold.unprotectedDoseSeconds)} 秒；` +
        `医学系统记录第 ${threshold.level} 级生理影响。`,
      targetPassengerIds,
      ...impact,
      confidence: 1,
    });
  }
}

function awakePassengersInRing(ringId: RotationRingId) {
  return habitabilityAwakePassengersInRing(
    passengers,
    currentZoneForPerson,
    ringId,
  );
}

function applyRotationHabitabilityThresholdCrossings(
  beforeRings: readonly RingTruthSummary[],
  afterRings: readonly RingTruthSummary[],
): void {
  habitabilityApplyRotationHabitabilityThresholdCrossings(
    beforeRings,
    afterRings,
    awakePassengersInRing,
    applyIncidentToRoster,
  );
}

interface CabinHeatPumpCoupling {
  metabolicHeatRemovalFraction: number;
  metabolicHeatRemovalFractionByRing: { A: number; B: number };
  habitatThermalDeliveryFractionByRing: { A: number; B: number };
  baseMetabolicHeatRemovalFraction: number;
  coefficientOfPerformance: number | null;
  availableWorkEnergyJ: number;
}

/**
 * Reduced-order cabin heat pump: one evaporator vs thermal-bus, not 48 nodes.
 * Cold-side T is volume×ZoneRole-weighted so living/public/medical/galley
 * dominate COP; agriculture medium; cargo/industrial/access light.
 * Pump/COP capacity is ship-wide; per-ring habitat thermal delivery spurs
 * scale cooling delivered into that ring's zones.
 */
function cabinHeatPumpColdSideTemperatureK(): number {
  let weightedTemperatureSum = 0;
  let weightSum = 0;
  for (const zone of compartments.listZones()) {
    const weight =
      zone.volumeCubicMeters *
      CABIN_HEAT_PUMP_COLD_SIDE_ROLE_WEIGHT[
        zoneCatalogEntry(zone.id).role
      ];
    weightedTemperatureSum += zone.temperatureK * weight;
    weightSum += weight;
  }
  return weightSum > 0
    ? weightedTemperatureSum / weightSum
    : compartments.getAggregateState().averageTemperatureK;
}

function cabinHeatPumpCoupling(
  electricalCoupling: ElectricalCouplingResult,
  simulatedSeconds: number,
  lifeSupportServiceRatio: number,
): CabinHeatPumpCoupling {
  const coldTemperatureK = cabinHeatPumpColdSideTemperatureK();
  const hotTemperatureK =
    cooling
      .listNodes()
      .find((node) => node.id === "thermal-bus")
      ?.temperatureK ?? coldTemperatureK;
  const temperatureLiftK =
    hotTemperatureK - coldTemperatureK;
  const coefficientOfPerformance =
    temperatureLiftK > 0
      ? Math.min(
          CABIN_HEAT_PUMP_MAXIMUM_COP,
          Math.max(
            CABIN_HEAT_PUMP_MINIMUM_COP,
            CABIN_HEAT_PUMP_CARNOT_EFFICIENCY *
              (coldTemperatureK / temperatureLiftK),
          ),
        )
      : null;
  const servedLifeSupportEnergyKWh =
    LIFE_SUPPORT_LOAD_IDS.reduce(
      (total, loadId) =>
        total +
        electricalCoupling.servedLoadEnergyKWhById[loadId],
      0,
    );
  const availableWorkEnergyJ =
    servedLifeSupportEnergyKWh *
    3_600_000 *
    CABIN_HEAT_PUMP_LIFE_SUPPORT_POWER_SHARE;
  const awakeOccupants =
    compartments.getAggregateState().awakeOccupants;
  const fullMetabolicHeatEnergyJ =
    awakeOccupants *
    CABIN_SENSIBLE_HEAT_W_PER_AWAKE_PERSON *
    simulatedSeconds;
  const energyCapacityFraction =
    coefficientOfPerformance === null ||
    fullMetabolicHeatEnergyJ === 0
      ? 1
      : Math.min(
          1,
          (availableWorkEnergyJ *
            coefficientOfPerformance) /
            fullMetabolicHeatEnergyJ,
        );
  const baseMetabolicHeatRemovalFraction = Math.min(
    cabinCoolingFlowFraction(),
    lifeSupportServiceRatio,
    energyCapacityFraction,
  );
  const habitatThermalDeliveryFractionByRing = { A: 1, B: 1 };
  for (const loop of cooling.listLoops()) {
    const ring = loop.id === "loop-a" ? "A" : "B";
    habitatThermalDeliveryFractionByRing[ring] =
      effectiveHabitatThermalDeliveryFraction(
        loop.habitatThermalDeliverySpur,
      );
  }
  const metabolicHeatRemovalFractionByRing = {
    A:
      baseMetabolicHeatRemovalFraction *
      habitatThermalDeliveryFractionByRing.A,
    B:
      baseMetabolicHeatRemovalFraction *
      habitatThermalDeliveryFractionByRing.B,
  };
  return {
    metabolicHeatRemovalFraction: Math.min(
      metabolicHeatRemovalFractionByRing.A,
      metabolicHeatRemovalFractionByRing.B,
    ),
    metabolicHeatRemovalFractionByRing,
    habitatThermalDeliveryFractionByRing,
    baseMetabolicHeatRemovalFraction,
    coefficientOfPerformance,
    availableWorkEnergyJ,
  };
}

function capturedCarbonDioxideTotal(
  network: CompartmentAtmosphereNetwork = compartments,
): number {
  return network
    .listAirHandlers()
    .reduce(
      (total, handler) =>
        total + handler.cumulativeCapturedCarbonDioxideKg,
      0,
    );
}

function synchronizeAtmosphereAggregate(
  capturedCarbonDioxideKg: number,
): void {
  const aggregate = compartments.getAggregateState();
  engine.synchronizeAtmosphereNetwork({
    volumeCubicMeters: aggregate.volumeCubicMeters,
    gasesKg: aggregate.gasesKg,
    pressurePa: aggregate.pressurePa,
    oxygenPartialPressurePa: aggregate.oxygenPartialPressurePa,
    carbonDioxidePartialPressurePa:
      aggregate.carbonDioxidePartialPressurePa,
    capturedCarbonDioxideKg,
    ventedGasKg: aggregate.ventedGasKg,
    leakAreaSquareMeters: aggregate.leakAreaSquareMeters,
  });
}
function synchronizeThermalAggregate(): void {
  engine.synchronizeThermalNetwork(
    projectedThermalNetworkState(),
  );
}

function stableZoneForCabin(cabinId: string): ZoneId {
  return resolveZoneIdForCabin(cabinId);
}

/** Live person location: transfer/evacuate override, else cabin home zone. */
function currentZoneForPerson(person: {
  id: string;
  cabinId: string;
}): ZoneId {
  return (
    captainOperations.locationOverrideFor(person.id) ??
    stableZoneForCabin(person.cabinId)
  );
}

function compartmentOccupantsFor(
  population: PassengerSimulation,
): Record<ZoneId, number> {
  const occupants = Object.fromEntries(
    BASELINE_ZONE_IDS.map((zoneId) => [zoneId, 0]),
  ) as Record<ZoneId, number>;
  for (const person of population.getAllPassengers()) {
    if (person.lifeState !== "awake") continue;
    occupants[currentZoneForPerson(person)] += 1;
  }
  return occupants;
}

function synchronizeCompartmentOccupants(): void {
  const occupants = compartmentOccupantsFor(passengers);
  compartments.setAwakeOccupantsByZone(occupants);
}

function awakeOccupantsByWaterRing(): Record<WaterRing, number> {
  const occupants = compartmentOccupantsFor(passengers);
  return BASELINE_ZONE_IDS.reduce(
    (counts, zoneId) => {
      counts[zoneId.startsWith("A-") ? "a" : "b"] += occupants[zoneId];
      return counts;
    },
    { a: 0, b: 0 } as Record<WaterRing, number>,
  );
}

function synchronizeWaterOccupants(): Record<WaterRing, number> {
  // Ring demand = person-weighted ZoneRole allocations (reduced-order, not pipes).
  const occupantsByZone = compartmentOccupantsFor(passengers);
  const occupants = awakeOccupantsByWaterRing();
  water.synchronizeAwakeOccupants(occupants);
  const weightedAllocation = { a: 0, b: 0 } as Record<WaterRing, number>;
  for (const zoneId of BASELINE_ZONE_IDS) {
    const ring = zoneId.startsWith("A-") ? "a" : "b";
    weightedAllocation[ring] +=
      occupantsByZone[zoneId] *
      captainOperations.getWaterAllocationKgPerDay(zoneId);
  }
  water.setConsumptionKgPerAwakePersonDayByRing({
    a: occupants.a === 0 ? 0 : weightedAllocation.a / occupants.a,
    b: occupants.b === 0 ? 0 : weightedAllocation.b / occupants.b,
  });
  return occupants;
}

function synchronizeWaterAggregate(): void {
  const summary = water.getSummary();
  const loops = water.listLoops();
  const awakeTotal = loops.reduce((total, loop) => total + loop.awakeOccupants, 0);
  const weightedConsumption = loops.reduce(
    (total, loop) =>
      total + loop.awakeOccupants * loop.consumptionKgPerAwakePersonDay,
    0,
  );
  engine.synchronizeWaterNetwork({
    potableKg: summary.potableKg,
    wastewaterKg: summary.wastewaterKg,
    reserveIceKg: summary.reserveIceKg,
    brineWasteKg: summary.brineWasteKg,
    consumptionKgPerAwakePersonDay:
      awakeTotal === 0 ? 0 : weightedConsumption / awakeTotal,
    recyclerCapacityKgPerDay: summary.recyclerCapacityKgPerDay,
    recyclerEfficiency: summary.recyclerEfficiency,
    recycledKgCumulative: summary.recycledKgCumulative,
  });
}

function applyCompletedMaintenance(
  task: ReturnType<MaintenanceNetwork["listTasks"]>[number],
): void {
  const assetId = task.assetId;
  const repairedCondition =
    task.repairDeratingFraction > 0 ? "degraded" : "nominal";
  if (assetId === "pump-a" || assetId === "pump-b") {
    cooling.configurePump(assetId, { condition: repairedCondition });
    synchronizeThermalAggregate();
    return;
  }
  if (assetId === "air-handler-a" || assetId === "air-handler-b") {
    compartments.configureAirHandler(assetId, { condition: repairedCondition });
    return;
  }
  if (
    assetId === "water-processor-a" ||
    assetId === "water-processor-b"
  ) {
    water.configureProcessor(assetId, { condition: repairedCondition });
    synchronizeWaterAggregate();
    return;
  }
  const ringId = assetId === "ring-a-bearing" ? "ring-a" : "ring-b";
  rotation.completeBearingMaintenance(ringId);
  if (task.repairDeratingFraction > 0) {
    rotation.configureRing(ringId, {
      bearing: { condition: "degraded" },
    });
  }
}

function advanceMaintenance(
  simulatedSeconds: number,
  electricalCoupling: ElectricalCouplingResult,
): void {
  const result = maintenance.advance(simulatedSeconds, {
    currentConditions: currentMaintenanceConditions(),
    workshopServiceFractionByRing: {
      a: loadServiceFractionOverInterval(
        electricalCoupling,
        [MAINTENANCE_WORKSHOP_LOAD_BY_RING.a],
        simulatedSeconds,
      ),
      b: loadServiceFractionOverInterval(
        electricalCoupling,
        [MAINTENANCE_WORKSHOP_LOAD_BY_RING.b],
        simulatedSeconds,
      ),
    },
    awakeCrewIds: new Set(
      passengers
        .getAllPassengers()
        .filter((person) => person.lifeState === "awake")
        .map((person) => person.id),
    ),
  });
  for (const task of result.completedTasks) {
    applyCompletedMaintenance(task);
  }
}

function metabolicWaterByRing(
  totalKg: number,
  occupants: Readonly<Record<WaterRing, number>>,
): Record<WaterRing, number> {
  const totalOccupants = occupants.a + occupants.b;
  if (totalKg === 0) return { a: 0, b: 0 };
  if (totalOccupants <= 0) {
    throw new Error("metabolic water was produced without awake occupants");
  }
  const a = totalKg * (occupants.a / totalOccupants);
  return { a, b: totalKg - a };
}
function operationsDepartmentServiceFractions(
  simulatedSeconds: number,
  electricalCoupling: ElectricalCouplingResult,
  operationsSnapshot: CaptainOperationsSnapshot,
): Record<ShipDepartmentId, number> {
  const awakeIds = new Set(
    passengers
      .getAllPassengers()
      .filter((person) => person.lifeState === "awake")
      .map((person) => person.id),
  );
  const staffingFraction = (departmentId: ShipDepartmentId): number => {
    const assigned = operationsSnapshot.crewAssignments.filter(
      (assignment) =>
        assignment.departmentId === departmentId && assignment.shiftId !== "off",
    );
    if (assigned.length === 0) return 1;
    return (
      assigned.filter((assignment) => awakeIds.has(assignment.personId)).length /
      assigned.length
    );
  };
  const served = (loadIds: readonly ElectricalLoadId[]): number =>
    loadServiceFractionOverInterval(
      electricalCoupling,
      loadIds,
      simulatedSeconds,
    );
  const electricalByDepartment: Record<ShipDepartmentId, number> = {
    navigation: served(["habitat-a", "habitat-b"]),
    engineering: served(["habitat-a", "habitat-b"]),
    "life-support": served(["life-support-a", "life-support-b"]),
    medical: served(["life-support-a", "life-support-b"]),
    "passenger-affairs": served(["habitat-a", "habitat-b"]),
    security: served(["habitat-a", "habitat-b"]),
    "passenger-service": served(["habitat-a", "habitat-b"]),
  };
  return Object.fromEntries(
    Object.entries(electricalByDepartment).map(([departmentId, fraction]) => [
      departmentId,
      fraction * staffingFraction(departmentId as ShipDepartmentId),
    ]),
  ) as Record<ShipDepartmentId, number>;
}

function connectionAllowsPersonnelPassage(
  connection: ReturnType<CompartmentAtmosphereNetwork["listConnections"]>[number],
  operationsSnapshot: CaptainOperationsSnapshot,
): boolean {
  const access = operationsSnapshot.accessControls.find(
    (candidate) => candidate.connectionId === connection.id,
  );
  if (access && access.accessMode !== "open") return false;
  if (connection.condition === "stuck-closed") return false;
  return (
    connection.condition === "stuck-open" ||
    connection.commandedOpenFraction > 0
  );
}

function findPersonnelRoute(
  fromZoneId: ZoneId,
  toZoneId: ZoneId,
  operationsSnapshot: CaptainOperationsSnapshot,
): string[] {
  if (fromZoneId === toZoneId) return [];
  const connections = compartments
    .listConnections()
    .filter((connection) =>
      connectionAllowsPersonnelPassage(connection, operationsSnapshot),
    );
  const queue: Array<{ zoneId: ZoneId; route: string[] }> = [
    { zoneId: fromZoneId, route: [] },
  ];
  const visited = new Set<ZoneId>([fromZoneId]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const connection of connections) {
      const nextZoneId =
        connection.zoneAId === current.zoneId
          ? connection.zoneBId
          : connection.zoneBId === current.zoneId
            ? connection.zoneAId
            : null;
      if (nextZoneId === null || visited.has(nextZoneId)) continue;
      const route = [...current.route, connection.id];
      if (nextZoneId === toZoneId) return route;
      visited.add(nextZoneId);
      queue.push({ zoneId: nextZoneId, route });
    }
  }
  throw new Error(
    `no traversable compartment route from ${fromZoneId} to ${toZoneId}; open or reauthorize the blocking doors first`,
  );
}

function operationsTaskServiceFractions(
  simulatedSeconds: number,
  electricalCoupling: ElectricalCouplingResult,
  operationsSnapshot: CaptainOperationsSnapshot,
  departmentServiceFractionById: Readonly<Record<ShipDepartmentId, number>>,
): Record<string, number> {
  const served = (loadIds: readonly ElectricalLoadId[]): number =>
    loadServiceFractionOverInterval(
      electricalCoupling,
      loadIds,
      simulatedSeconds,
    );
  return Object.fromEntries(
    operationsSnapshot.tasks
      .filter((task) => task.status === "active")
      .map((task) => {
        let equipmentService = 1;
        if (task.kind === "manufacturing") {
          equipmentService = served([
            task.effect.fabricatorId === "fabricator-b"
              ? "habitat-b"
              : "habitat-a",
          ]);
        } else if (task.kind === "hull-repair") {
          const breach = compartments
            .listBreaches()
            .find((item) => item.id === task.targetId);
          equipmentService = served([
            breach?.zoneId.startsWith("B-") ? "habitat-b" : "habitat-a",
          ]);
        } else if (task.kind === "medical-treatment") {
          equipmentService = served(["life-support-a", "life-support-b"]);
        } else if (task.kind === "relocation") {
          const routeConnectionIds =
            typeof task.effect.routeConnectionIds === "string" &&
            task.effect.routeConnectionIds.length > 0
              ? task.effect.routeConnectionIds.split(",")
              : [];
          const connections = new Map(
            compartments
              .listConnections()
              .map((connection) => [connection.id, connection]),
          );
          const routeOpen = routeConnectionIds.every((connectionId) => {
            const connection = connections.get(connectionId);
            return (
              connection !== undefined &&
              connectionAllowsPersonnelPassage(
                connection,
                operationsSnapshot,
              )
            );
          });
          equipmentService = routeOpen
            ? served(["habitat-a", "habitat-b"])
            : 0;
        } else if (task.kind === "active-scan") {
          const packageId = task.effect.packageId;
          equipmentService =
            packageId === "atmosphere-diagnostic-array"
              ? served(["life-support-a", "life-support-b"])
              : packageId === "thermal-diagnostic-array"
                ? served(["cooling-a", "cooling-b"])
                : packageId === "hull-inspection-array"
                  ? served(["habitat-a", "habitat-b"])
                  : served(["habitat-a", "habitat-b"]);
        } else if (task.kind === "remote-deployment") {
          equipmentService = served(["habitat-a", "habitat-b"]);
        }
        return [
          task.id,
          Math.min(
            equipmentService,
            departmentServiceFractionById[task.assignedDepartmentId],
          ),
        ];
      }),
  );
}
function validateRestoredProjection(
  restoredEngine: SimulationEngine,
  restoredPassengers: PassengerSimulation,
  restoredCompartments: CompartmentAtmosphereNetwork,
  restoredCooling: CoolingThermalNetwork,
  restoredElectrical: ShipElectricalNetwork,
  restoredNavigation: RigidBodyNavigation,
  restoredRotation: CounterRotatingHabitat,
  restoredWater: WaterRecoveryNetwork,
): void {
  const state = restoredEngine.getState();
  const population = restoredPassengers.getPopulationSummary();
  for (const key of [
    "total",
    "passengers",
    "crew",
    "awake",
    "hibernating",
    "deceased",
  ] as const) {
    if (state.population[key] !== population[key]) {
      throw new Error(
        `engine population.${key} does not match the individual roster`,
      );
    }
  }
  assertProjectionClose(
    state.population.averageHealth,
    population.averageHealth,
    "population.averageHealth",
  );
  assertProjectionClose(
    state.population.averageMorale,
    population.averageMorale,
    "population.averageMorale",
  );
  if (state.hibernation.occupiedPods !== population.hibernating) {
    throw new Error(
      "occupied hibernation pods do not match the individual roster",
    );
  }

  const aggregate = restoredCompartments.getAggregateState();
  const atmosphere = state.atmosphere;
  assertProjectionClose(
    atmosphere.volumeCubicMeters,
    aggregate.volumeCubicMeters,
    "atmosphere volume",
  );
  assertProjectionClose(
    atmosphere.pressurePa,
    aggregate.pressurePa,
    "atmosphere pressure",
  );
  assertProjectionClose(
    atmosphere.oxygenPartialPressurePa,
    aggregate.oxygenPartialPressurePa,
    "oxygen partial pressure",
  );
  assertProjectionClose(
    atmosphere.carbonDioxidePartialPressurePa,
    aggregate.carbonDioxidePartialPressurePa,
    "carbon dioxide partial pressure",
  );
  assertProjectionClose(
    atmosphere.ventedGasKg,
    aggregate.ventedGasKg,
    "vented gas",
  );
  assertProjectionClose(
    atmosphere.leakAreaSquareMeters,
    aggregate.leakAreaSquareMeters,
    "leak area",
  );
  assertProjectionClose(
    atmosphere.capturedCarbonDioxideKg,
    capturedCarbonDioxideTotal(restoredCompartments),
    "captured carbon dioxide",
  );
  for (const gas of [
    "oxygen",
    "nitrogen",
    "carbonDioxide",
    "waterVapor",
  ] as const) {
    assertProjectionClose(
      atmosphere.gasesKg[gas],
      aggregate.gasesKg[gas],
      `${gas} mass`,
    );
  }

  const expectedOccupants =
    compartmentOccupantsFor(restoredPassengers);
  for (const zone of restoredCompartments.listZones()) {
    if (
      zone.awakeOccupants !== expectedOccupants[zone.id]
    ) {
      throw new Error(
        `compartment ${zone.id} occupants do not match cabin assignments`,
      );
    }
  }
  const expectedWaterOccupants = BASELINE_ZONE_IDS.reduce(
    (counts, zoneId) => {
      counts[zoneId.startsWith("A-") ? "a" : "b"] +=
        expectedOccupants[zoneId];
      return counts;
    },
    { a: 0, b: 0 } as Record<WaterRing, number>,
  );
  for (const loop of restoredWater.listLoops()) {
    if (loop.awakeOccupants !== expectedWaterOccupants[loop.ring]) {
      throw new Error(
        `${loop.id} occupants do not match cabin assignments`,
      );
    }
  }
  const waterSummary = restoredWater.getSummary();
  for (const key of [
    "potableKg",
    "wastewaterKg",
    "reserveIceKg",
    "brineWasteKg",
    "recyclerCapacityKgPerDay",
    "recyclerEfficiency",
    "recycledKgCumulative",
  ] as const) {
    assertProjectionClose(
      state.water[key],
      waterSummary[key],
      `water.${key}`,
    );
  }
  const waterLoops = restoredWater.listLoops();
  const waterAwakeTotal = waterLoops.reduce(
    (total, loop) => total + loop.awakeOccupants,
    0,
  );
  const waterWeightedConsumption = waterLoops.reduce(
    (total, loop) =>
      total + loop.awakeOccupants * loop.consumptionKgPerAwakePersonDay,
    0,
  );
  assertProjectionClose(
    state.water.consumptionKgPerAwakePersonDay,
    waterAwakeTotal === 0
      ? 0
      : waterWeightedConsumption / waterAwakeTotal,
    "water.consumptionKgPerAwakePersonDay",
  );

  const projectedThermal = projectedThermalNetworkState(
    restoredCooling,
    restoredCompartments,
  );
  for (const key of [
    "habitatTemperatureK",
    "coolantTemperatureK",
    "radiatorTemperatureK",
    "spaceSinkTemperatureK",
    "internalHeatKw",
    "radiatedHeatKw",
    "radiatorConductanceKwPerK",
    "coolantHeatCapacityKJPerK",
  ] as const) {
    assertProjectionClose(
      state.thermal[key],
      projectedThermal[key],
      `thermal.${key}`,
    );
  }

  const projectedPower =
    projectedElectricalPowerState(restoredElectrical);
  for (const key of [
    "generationKw",
    "essentialDemandKw",
    "discretionaryDemandKw",
    "jumpDriveDemandKw",
    "servedDemandKw",
    "unservedDemandKw",
    "curtailedGenerationKw",
    "batteryCapacityKWh",
    "batteryChargeKWh",
    "batteryThroughputKWh",
  ] as const) {
    assertProjectionClose(
      state.power[key],
      projectedPower[key],
      `power.${key}`,
    );
  }

  const electricalLedger =
    restoredElectrical.snapshot().ledger;
  const navigationPropulsion =
    restoredNavigation.snapshot().propulsion;
  const propulsionControlRequestedJ =
    PROPULSION_CONTROL_LOAD_IDS.reduce(
      (total, loadId) =>
        total +
        electricalLedger.demandedLoadEnergyKWhById[
          loadId
        ] *
          3_600_000,
      0,
    );
  const propulsionControlServedJ =
    PROPULSION_CONTROL_LOAD_IDS.reduce(
      (total, loadId) =>
        total +
        electricalLedger.servedLoadEnergyKWhById[
          loadId
        ] *
          3_600_000,
      0,
    );
  assertProjectionClose(
    navigationPropulsion.energyLedger
      .controlEnergyRequestedJ,
    propulsionControlRequestedJ,
    "propulsion requested control energy",
  );
  assertProjectionClose(
    navigationPropulsion.energyLedger.controlEnergyServedJ,
    propulsionControlServedJ,
    "propulsion served control energy",
  );
  const propulsionThermalEnergyJ =
    restoredCooling.snapshot().ledger
      .externalEnergyBySourceJ.propulsion;
  assertProjectionClose(
    propulsionThermalEnergyJ,
    navigationPropulsion.energyLedger.retainedWasteHeatJ +
      navigationPropulsion.energyLedger.controlEnergyServedJ,
    "propulsion thermal energy",
  );

  const rotationSnapshot = restoredRotation.snapshot();
  const rotationRequestedEnergyJ = (
    Object.values(
      ROTATION_DRIVE_LOAD_BY_RING,
    ) as ElectricalLoadId[]
  ).reduce(
    (total, loadId) =>
      total +
      electricalLedger.demandedLoadEnergyKWhById[loadId] *
        3_600_000,
    0,
  );
  const rotationServedEnergyJ = (
    Object.values(
      ROTATION_DRIVE_LOAD_BY_RING,
    ) as ElectricalLoadId[]
  ).reduce(
    (total, loadId) =>
      total +
      electricalLedger.servedLoadEnergyKWhById[loadId] *
        3_600_000,
    0,
  );
  // Rotation records the actuator's raw request before the fixed feeder can
  // cap it. Electrical demanded energy is the portion accepted by that feeder,
  // so it may be lower but can never be higher. Actual served energy below is
  // still required to match exactly across both physical domains.
  assertProjectionAtMost(
    rotationRequestedEnergyJ,
    rotationSnapshot.energyLedger.requestedElectricalEnergyJ,
    "electrical rotation-drive demand",
  );
  assertProjectionClose(
    rotationSnapshot.energyLedger.servedElectricalEnergyJ,
    rotationServedEnergyJ,
    "rotation served electrical energy",
  );
  assertProjectionClose(
    restoredCooling.snapshot().ledger
      .externalEnergyBySourceJ["rotation-drive"],
    rotationSnapshot.energyLedger.heatJ,
    "rotation thermal energy",
  );
  const navigationSnapshot = restoredNavigation.snapshot();
  assertProjectionClose(
    navigationSnapshot.momentumLedger
      .internalAngularImpulseBodyNms.x,
    rotationSnapshot.carrierAngularImpulseXSinceFrame,
    "rotation carrier angular impulse",
  );
  assertProjectionClose(
    navigationSnapshot.energyLedger
      .internalMechanicalEnergyTransferJ,
    rotationSnapshot
      .carrierKineticEnergyChangeJSinceFrame,
    "rotation carrier mechanical energy",
  );
}

function maintenanceConditionsFor(
  coolingNetwork = cooling,
  compartmentNetwork = compartments,
  waterNetwork = water,
  rotationNetwork = rotation,
): MaintenanceConditionRecord {
  const pumps = new Map(
    coolingNetwork.listPumps().map((pump) => [pump.id, pump.condition]),
  );
  const airHandlers = new Map(
    compartmentNetwork
      .listAirHandlers()
      .map((handler) => [handler.id, handler.condition]),
  );
  const waterProcessors = new Map(
    waterNetwork
      .listProcessors()
      .map((processor) => [processor.id, processor.condition]),
  );
  const rings = new Map(
    rotationNetwork
      .listRings()
      .map((ring) => [ring.id, ring.bearing.condition]),
  );
  const required = <T>(value: T | undefined, label: string): T => {
    if (value === undefined) throw new Error(`maintenance lost ${label}`);
    return value;
  };
  return {
    "pump-a": required(pumps.get("pump-a"), "pump-a"),
    "pump-b": required(pumps.get("pump-b"), "pump-b"),
    "air-handler-a": required(
      airHandlers.get("air-handler-a"),
      "air-handler-a",
    ),
    "air-handler-b": required(
      airHandlers.get("air-handler-b"),
      "air-handler-b",
    ),
    "water-processor-a": required(
      waterProcessors.get("water-processor-a"),
      "water-processor-a",
    ),
    "water-processor-b": required(
      waterProcessors.get("water-processor-b"),
      "water-processor-b",
    ),
    "ring-a-bearing": required(
      rings.get("ring-a"),
      "ring-a bearing",
    ),
    "ring-b-bearing": required(
      rings.get("ring-b"),
      "ring-b bearing",
    ),
  };
}

function currentMaintenanceConditions(): MaintenanceConditionRecord {
  return maintenanceConditionsFor();
}

function validateMaintenanceProjection(
  maintenanceNetwork: MaintenanceNetwork,
  passengerNetwork: PassengerSimulation,
  coolingNetwork = cooling,
  compartmentNetwork = compartments,
  waterNetwork = water,
  rotationNetwork = rotation,
): void {
  const conditions = maintenanceConditionsFor(
    coolingNetwork,
    compartmentNetwork,
    waterNetwork,
    rotationNetwork,
  );
  const passengerIds = new Set(
    passengerNetwork
      .getAllPassengers()
      .map((person) => person.id),
  );
  for (const task of maintenanceNetwork.listTasks()) {
    if (!passengerIds.has(task.assignedCrewId)) {
      throw new Error(
        `maintenance task ${task.id} references an unknown crew member`,
      );
    }
    if (
      task.status === "active" &&
      conditions[task.assetId] === "nominal"
    ) {
      throw new Error(
        `maintenance task ${task.id} targets an already nominal asset`,
      );
    }
  }
}
function registerHullBreachConsequence(input: {
  breachId: string;
  zoneId: ZoneId;
  areaSquareMeters: number;
}): void {
  hullConsequence.register({
    ...input,
    nowMicroseconds: engine.elapsedMicroseconds,
  });
}

function applyHullCascadeActions(actions: readonly HullCascadeAction[]): void {
  for (const action of actions) {
    if (action.type === "grow-breach") {
      const existing = compartments
        .listBreaches()
        .find((breach) => breach.id === action.breachId);
      if (!existing) continue;
      compartments.upsertBreach({
        ...existing,
        areaSquareMeters: action.areaSquareMeters,
      });
      synchronizeAtmosphereAggregate(capturedCarbonDioxideTotal());
      continue;
    }
    if (action.type === "fault-ahu") {
      const airHandlerId =
        action.ring === "a" ? "air-handler-a" : "air-handler-b";
      compartments.configureAirHandler(airHandlerId, {
        condition: action.condition,
      });
      continue;
    }
    if (action.type === "fault-pump") {
      const pumpId = action.ring === "a" ? "pump-a" : "pump-b";
      cooling.configurePump(pumpId, {
        condition: action.condition,
        commandedSpeedFraction: 0,
      });
      continue;
    }
    if (action.type === "fault-bearing") {
      const ringId = action.ring === "a" ? "ring-a" : "ring-b";
      rotation.configureRing(ringId, {
        bearing: { condition: "degraded" },
      });
      continue;
    }
    if (action.type === "trip-hibernation") {
      const loadId =
        action.ring === "a" ? "hibernation-a" : "hibernation-b";
      const load = electrical.getLoad(loadId);
      const breaker = electrical
        .listBreakers()
        .find((candidate) => candidate.id === load.breakerId);
      if (breaker && breaker.condition === "nominal") {
        electrical.tripBreaker(
          load.breakerId,
          `hull cascade: unrepaired breach on ring ${action.ring}`,
        );
      }
    }
  }
}

function syncHullThrustDerates(): void {
  const breaches = compartments.listBreaches();
  const performanceByRing = {
    a: hullConsequence.getTelemetry(engine.elapsedMicroseconds, breaches)
      .thrustPerformanceByRing.a,
    b: hullConsequence.getTelemetry(engine.elapsedMicroseconds, breaches)
      .thrustPerformanceByRing.b,
  } as const;
  const nextDerated = new Set<string>();
  for (const thruster of navigation.listThrusters()) {
    const ring: HullRingId =
      thruster.controlTrainId === "propulsion-control-a" ? "a" : "b";
    const fraction = performanceByRing[ring];
    if (fraction < 1 - 1e-12) {
      navigation.configureThruster(thruster.id, {
        condition: "degraded",
        performanceFraction: fraction,
      });
      nextDerated.add(thruster.id);
    } else if (hullDeratedThrusterIds.has(thruster.id)) {
      navigation.configureThruster(thruster.id, {
        condition: "nominal",
        performanceFraction: 1,
      });
    }
  }
  hullDeratedThrusterIds = nextDerated;
}

function applyHullConsequenceCoupling(): void {
  const breaches = compartments.listBreaches();
  const activeIds = new Set(breaches.map((breach) => breach.id));
  hullConsequence.reconcile(activeIds);
  for (const breach of breaches) {
    hullConsequence.register({
      breachId: breach.id,
      zoneId: breach.zoneId,
      areaSquareMeters: breach.areaSquareMeters,
      nowMicroseconds: engine.elapsedMicroseconds,
    });
  }
  const actions = hullConsequence.advance({
    nowMicroseconds: engine.elapsedMicroseconds,
    breaches: compartments.listBreaches(),
  });
  applyHullCascadeActions(actions);
  syncHullThrustDerates();
}

function post(event: SimulationWorkerEvent): void {
  globalThis.postMessage(event);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function initialize(
  command: Extract<SimulationWorkerCommand, { type: "initialize" }>,
): void {
  const state = createBaselineShipState();
  state.journey.origin = command.mission.origin;
  state.journey.destination = command.mission.destination;
  state.journey.totalDistanceLightYears =
    command.mission.totalDistanceLightYears;
  state.journey.totalLegs = command.mission.totalLegs;
  state.journey.currentLeg = 1;
  state.journey.status = "charging";

  engine = new SimulationEngine({
    seed: command.mission.seed,
    timeScale: command.mission.timeScale,
    state,
    powerAuthority: "external-network",
    atmosphereAuthority: "external-network",
    thermalAuthority: "external-network",
    populationAuthority: "external-roster",
    waterAuthority: "external-network",
  });
  passengers = new PassengerSimulation(
    `${command.mission.seed}:population`,
  );
  compartments = new CompartmentAtmosphereNetwork({
    seed: `${command.mission.seed}:compartments`,
    metabolicHeatAuthority: "external-network",
  });
  cooling = new CoolingThermalNetwork({
    seed: `${command.mission.seed}:cooling`,
  });
  electrical = new ShipElectricalNetwork({
    seed: `${command.mission.seed}:electrical`,
  });
  navigation = new RigidBodyNavigation({
    seed: `${command.mission.seed}:navigation`,
  });
  rotation = new CounterRotatingHabitat({
    seed: `${command.mission.seed}:rotation`,
    initialCarrierState: currentRotationCarrierState(),
  });
  water = new WaterRecoveryNetwork();
  maintenance = new MaintenanceNetwork();
  hullConsequence = HullConsequenceNetwork.create();
  hullDeratedThrusterIds = new Set();
  captainOperations = new CaptainOperations({
    origin: command.mission.origin,
    destination: command.mission.destination,
    objective: command.mission.directive,
    zoneIds: BASELINE_ZONE_IDS,
    electricalLoadIds: ELECTRICAL_LOAD_IDS,
  });
  maintenance.advance(0, {
    currentConditions: currentMaintenanceConditions(),
    workshopServiceFractionByRing: { a: 1, b: 1 },
    awakeCrewIds: new Set(
      passengers
        .getAllPassengers()
        .filter((person) => person.lifeState === "awake")
        .map((person) => person.id),
    ),
  });
  commandBus = createCommandBus();
  passengerEnvironmentalExposures =
    createPassengerEnvironmentalExposureStates();
  survivalZoneDoses = createSurvivalZoneDoses();
  survivalLedger = createEmptySurvivalLedger();
  timeDirector = new SimulationTimeDirector(command.mission.timeScale);
  timeDirector.acquirePauseToken("ui");
  lastReachedBlockingBoundary = null;
  proceduralWorld = new ProceduralWorldScheduler(command.mission.seed);
  lastProceduralEvents = [];
  synchronizeCompartmentOccupants();
  synchronizeWaterOccupants();
  requestedTimeScale = command.mission.timeScale;
  effectiveTimeScale = command.mission.timeScale;
  lastCompartmentStep = {
    fidelityMode: "equilibrium-fast",
    fineSubsteps: 0,
    equilibriumIntervals: 0,
  };
  synchronizeElectricalAggregate();
  synchronizeAtmosphereAggregate(capturedCarbonDioxideTotal());
  synchronizeThermalAggregate();
  synchronizePopulationAggregate();
  synchronizeWaterAggregate();
  highestDirective = command.mission.directive;
  post({
    type: "ready",
    requestId: command.requestId,
    payload: currentState(),
  });
}

function restore(
  command: Extract<SimulationWorkerCommand, { type: "restore" }>,
): void {
  if (
    (command.snapshot.snapshotVersion !== 16 &&
      command.snapshot.snapshotVersion !== 17 &&
      command.snapshot.snapshotVersion !== 18) ||
    !command.snapshot.highestDirective.trim() ||
    command.snapshot.engine.powerAuthority !== "external-network" ||
    command.snapshot.engine.atmosphereAuthority !== "external-network" ||
    command.snapshot.engine.thermalAuthority !== "external-network" ||
    command.snapshot.engine.populationAuthority !== "external-roster" ||
    command.snapshot.engine.waterAuthority !== "external-network" ||
    command.snapshot.compartments.metabolicHeatAuthority !==
      "external-network"
  ) {
    throw new Error("unsupported or malformed runtime snapshot");
  }
  const restoredEngine = SimulationEngine.restore(
    command.snapshot.engine,
  );
  const restoredPassengers = PassengerSimulation.restore(
    command.snapshot.passengers,
  );
  const restoredCompartments = CompartmentAtmosphereNetwork.restore(
    command.snapshot.compartments,
  );
  const restoredCooling = CoolingThermalNetwork.restore(
    command.snapshot.cooling,
  );
  const restoredElectrical = ShipElectricalNetwork.restore(
    command.snapshot.electrical,
  );
  const restoredNavigation = RigidBodyNavigation.restore(
    command.snapshot.navigation,
  );
  const restoredRotation = CounterRotatingHabitat.restore(
    command.snapshot.rotation,
  );
  const restoredWater = WaterRecoveryNetwork.restore(
    command.snapshot.water,
  );
  const restoredMaintenance = MaintenanceNetwork.restore(
    command.snapshot.maintenance,
  );
  const restoredOperations = command.snapshot.operations
    ? CaptainOperations.restore({
        snapshot: command.snapshot.operations,
        zoneIds: BASELINE_ZONE_IDS,
        electricalLoadIds: ELECTRICAL_LOAD_IDS,
      })
    : new CaptainOperations({
        origin: restoredEngine.getState().journey.origin,
        destination: restoredEngine.getState().journey.destination,
        objective: command.snapshot.highestDirective,
        zoneIds: BASELINE_ZONE_IDS,
        electricalLoadIds: ELECTRICAL_LOAD_IDS,
        elapsedMicroseconds: restoredEngine.elapsedMicroseconds,
      });
  const restoredCommandBus = DeterministicCommandBus.restore<
    ShipCommandActorId,
    ShipCommandRole,
    ShipCommandKind
  >(command.snapshot.commandBus);
  const expectedCommandBus = createCommandBus();
  if (
    restoredCommandBus.topologyFingerprint !==
      expectedCommandBus.topologyFingerprint ||
    restoredCommandBus.historyCapacity !==
      expectedCommandBus.historyCapacity
  ) {
    throw new Error(
      "command bus topology does not match the fixed runtime topology",
    );
  }
  if (
    restoredPassengers.nowMicroseconds !==
      restoredEngine.elapsedMicroseconds ||
    restoredCompartments.elapsedMicroseconds !==
      restoredEngine.elapsedMicroseconds ||
    restoredCooling.elapsedMicroseconds !==
      restoredEngine.elapsedMicroseconds ||
    restoredElectrical.elapsedMicroseconds !==
      restoredEngine.elapsedMicroseconds ||
    restoredNavigation.elapsedMicroseconds !==
      restoredEngine.elapsedMicroseconds ||
    restoredRotation.elapsedMicroseconds !==
      restoredEngine.elapsedMicroseconds ||
    restoredWater.elapsedMicroseconds !==
      restoredEngine.elapsedMicroseconds ||
    restoredMaintenance.elapsedMicroseconds !==
      restoredEngine.elapsedMicroseconds ||
    restoredOperations.elapsedMicroseconds !==
      restoredEngine.elapsedMicroseconds
  ) {
    throw new Error(
      "engine, passenger, compartment, cooling, electrical, navigation, rotation, water, maintenance, and operations clocks do not match",
    );
  }
  if (
    restoredCommandBus
      .getAuditHistory()
      .some(
        (entry) =>
          entry.issuedAt > restoredEngine.elapsedMicroseconds,
      )
  ) {
    throw new Error(
      "command audit contains an issue time beyond the simulation clock",
    );
  }
  validatePassengerEnvironmentalExposureStates(
    command.snapshot.passengerEnvironmentalExposures,
    restoredCompartments,
  );
  const restoredSurvival = restoreSurvival(command.snapshot.survival);
  if (
    restoredSurvival.zoneDoses.length !==
    command.snapshot.passengerEnvironmentalExposures.length
  ) {
    throw new Error(
      "survival zone doses must match passenger environmental exposure cardinality",
    );
  }
  for (
    let index = 0;
    index < restoredSurvival.zoneDoses.length;
    index += 1
  ) {
    const dose = restoredSurvival.zoneDoses[index]!;
    const exposure = command.snapshot.passengerEnvironmentalExposures[index]!;
    if (
      dose.zoneId !== exposure.zoneId ||
      dose.family !== exposure.family ||
      dose.currentTier !== exposure.currentTier ||
      dose.episode !== exposure.episode
    ) {
      throw new Error(
        `survival zone dose ${dose.zoneId}/${dose.family} does not match environmental exposure`,
      );
    }
  }
  const restoredTimeDirector = SimulationTimeDirector.restore(
    command.snapshot.timeDirector,
  );
  const restoredProceduralWorld = ProceduralWorldScheduler.restore(
    command.snapshot.proceduralWorld,
  );
  const restoredHullConsequence = command.snapshot.hullConsequence
    ? HullConsequenceNetwork.restore(command.snapshot.hullConsequence)
    : HullConsequenceNetwork.create();
  // Only realign the aggregate when electrical restore healed derived
  // instantaneous fields; never overwrite an intentionally inconsistent
  // engine.power projection before validation.
  if (
    electricalInstantaneousFingerprint(command.snapshot.electrical) !==
    electricalInstantaneousFingerprint(restoredElectrical.snapshot())
  ) {
    restoredEngine.synchronizePowerNetwork(
      projectedElectricalPowerState(restoredElectrical),
    );
  }
  validateRestoredProjection(
    restoredEngine,
    restoredPassengers,
    restoredCompartments,
    restoredCooling,
    restoredElectrical,
    restoredNavigation,
    restoredRotation,
    restoredWater,
  );
  validateMaintenanceProjection(
    restoredMaintenance,
    restoredPassengers,
    restoredCooling,
    restoredCompartments,
    restoredWater,
    restoredRotation,
  );
  engine = restoredEngine;
  passengers = restoredPassengers;
  compartments = restoredCompartments;
  cooling = restoredCooling;
  electrical = restoredElectrical;
  navigation = restoredNavigation;
  rotation = restoredRotation;
  water = restoredWater;
  maintenance = restoredMaintenance;
  hullConsequence = restoredHullConsequence;
  hullDeratedThrusterIds = new Set();
  captainOperations = restoredOperations;
  passengerEnvironmentalExposures = structuredClone(
    command.snapshot.passengerEnvironmentalExposures,
  );
  survivalLedger = restoredSurvival.ledger;
  survivalZoneDoses = restoredSurvival.zoneDoses;
  timeDirector = restoredTimeDirector;
  lastReachedBlockingBoundary = null;
  proceduralWorld = restoredProceduralWorld;
  lastProceduralEvents = [];
  commandBus = restoredCommandBus;
  requestedTimeScale = timeDirector.timeScale;
  effectiveTimeScale = timeDirector.isPaused
    ? 0
    : timeDirector.lastEffectiveTimeScale || engine.timeScale;
  lastCompartmentStep = {
    fidelityMode: "equilibrium-fast",
    fineSubsteps: 0,
    equilibriumIntervals: 0,
  };
  highestDirective = command.snapshot.highestDirective;
  // Reconcile registry with live breaches (v16/v17 saves lack hullConsequence).
  applyHullConsequenceCoupling();
  post({
    type: "ready",
    requestId: command.requestId,
    payload: currentState(),
  });
}

function runtimeSnapshot(): RuntimeSimulationSnapshot {
  return {
    snapshotVersion: 18,
    highestDirective,
    engine: engine.snapshot(),
    passengers: passengers.snapshot(),
    compartments: compartments.snapshot(),
    cooling: cooling.snapshot(),
    electrical: electrical.snapshot(),
    navigation: navigation.snapshot(),
    rotation: rotation.snapshot(),
    water: water.snapshot(),
    maintenance: maintenance.snapshot(),
    operations: captainOperations.snapshot(),
    commandBus: commandBus.snapshot(),
    passengerEnvironmentalExposures: structuredClone(
      passengerEnvironmentalExposures,
    ),
    timeDirector: timeDirector.snapshot(),
    proceduralWorld: proceduralWorld.snapshot(),
    survival: snapshotSurvival(survivalLedger, survivalZoneDoses),
    hullConsequence: hullConsequence.snapshot(),
  };
}

interface RuntimeDomainCheckpoint {
  engine: SimulationSnapshot;
  passengers: ReturnType<PassengerSimulation["snapshot"]>;
  compartments: ReturnType<
    CompartmentAtmosphereNetwork["snapshot"]
  >;
  cooling: CoolingNetworkSnapshot;
  electrical: ElectricalNetworkSnapshot;
  navigation: NavigationSnapshot;
  rotation: RotationSnapshot;
  water: WaterRecoverySnapshot;
  maintenance: MaintenanceSnapshot;
  operations: CaptainOperationsSnapshot;
  hullConsequence: ReturnType<HullConsequenceNetwork["snapshot"]>;
  passengerEnvironmentalExposures:
    PassengerEnvironmentalExposureState[];
  survivalLedger: SurvivalLedger;
  survivalZoneDoses: ZoneHazardDose[];
  timeDirector: TimeDirectorSnapshot;
  proceduralWorld: ProceduralWorldSnapshot;
  requestedTimeScale: number;
  effectiveTimeScale: number;
  lastCompartmentStep: typeof lastCompartmentStep;
  hullDeratedThrusterIds: string[];
}

function captureDomainCheckpoint(): RuntimeDomainCheckpoint {
  return {
    engine: engine.snapshot(),
    passengers: passengers.snapshot(),
    compartments: compartments.snapshot(),
    cooling: cooling.snapshot(),
    electrical: electrical.snapshot(),
    navigation: navigation.snapshot(),
    rotation: rotation.snapshot(),
    water: water.snapshot(),
    maintenance: maintenance.snapshot(),
    operations: captainOperations.snapshot(),
    hullConsequence: hullConsequence.snapshot(),
    passengerEnvironmentalExposures: structuredClone(
      passengerEnvironmentalExposures,
    ),
    survivalLedger: { ...survivalLedger },
    survivalZoneDoses: survivalZoneDoses.map((dose) => ({ ...dose })),
    timeDirector: timeDirector.snapshot(),
    proceduralWorld: proceduralWorld.snapshot(),
    requestedTimeScale,
    effectiveTimeScale,
    lastCompartmentStep: structuredClone(lastCompartmentStep),
    hullDeratedThrusterIds: [...hullDeratedThrusterIds],
  };
}

function restoreDomainCheckpoint(
  checkpoint: RuntimeDomainCheckpoint,
): void {
  engine = SimulationEngine.restore(checkpoint.engine);
  passengers = PassengerSimulation.restore(checkpoint.passengers);
  compartments = CompartmentAtmosphereNetwork.restore(
    checkpoint.compartments,
  );
  cooling = CoolingThermalNetwork.restore(checkpoint.cooling);
  electrical = ShipElectricalNetwork.restore(
    checkpoint.electrical,
  );
  navigation = RigidBodyNavigation.restore(
    checkpoint.navigation,
  );
  rotation = CounterRotatingHabitat.restore(
    checkpoint.rotation,
  );
  water = WaterRecoveryNetwork.restore(checkpoint.water);
  maintenance = MaintenanceNetwork.restore(
    checkpoint.maintenance,
  );
  hullConsequence = HullConsequenceNetwork.restore(
    checkpoint.hullConsequence,
  );
  hullDeratedThrusterIds = new Set(checkpoint.hullDeratedThrusterIds);
  captainOperations = CaptainOperations.restore({
    snapshot: checkpoint.operations,
    zoneIds: BASELINE_ZONE_IDS,
    electricalLoadIds: ELECTRICAL_LOAD_IDS,
  });
  passengerEnvironmentalExposures = structuredClone(
    checkpoint.passengerEnvironmentalExposures,
  );
  survivalLedger = { ...checkpoint.survivalLedger };
  survivalZoneDoses = checkpoint.survivalZoneDoses.map((dose) => ({
    ...dose,
  }));
  timeDirector = SimulationTimeDirector.restore(checkpoint.timeDirector);
  proceduralWorld = ProceduralWorldScheduler.restore(
    checkpoint.proceduralWorld,
  );
  requestedTimeScale = checkpoint.requestedTimeScale;
  effectiveTimeScale = checkpoint.effectiveTimeScale;
  lastCompartmentStep = structuredClone(
    checkpoint.lastCompartmentStep,
  );
  if (
    electricalInstantaneousFingerprint(checkpoint.electrical) !==
    electricalInstantaneousFingerprint(electrical.snapshot())
  ) {
    synchronizeElectricalAggregate();
  }
}

function restoreDomainCheckpointOrThrow(
  checkpoint: RuntimeDomainCheckpoint,
  originalError: unknown,
): void {
  try {
    restoreDomainCheckpoint(checkpoint);
  } catch (restoreError) {
    throw new Error(
      `${errorMessage(originalError)}; checkpoint restore also failed: ${errorMessage(restoreError)}`,
    );
  }
}

function synchronizePopulationAggregate(): void {
  const summary = passengers.getPopulationSummary();
  let aggregate = engine.getState().population;
  if (
    summary.awake !== aggregate.awake ||
    summary.hibernating !== aggregate.hibernating ||
    summary.deceased !== aggregate.deceased
  ) {
    engine.synchronizePopulationCounts({
      awake: summary.awake,
      hibernating: summary.hibernating,
      deceased: summary.deceased,
    });
    aggregate = engine.getState().population;
  }
  if (
    aggregate.averageHealth !== summary.averageHealth ||
    aggregate.averageMorale !== summary.averageMorale
  ) {
    engine.synchronizePopulationAverages({
      averageHealth: summary.averageHealth,
      averageMorale: summary.averageMorale,
    });
  }
}

function rotationRequiresFineCoupling(): boolean {
  const summary = rotation.getSummary();
  if (
    Math.abs(
      summary.netRelativeRingAngularMomentumKgM2PerS,
    ) > 1e6
  ) {
    return true;
  }
  const breakers = new Map(
    electrical
      .listBreakers()
      .map((breaker) => [breaker.id, breaker]),
  );
  for (const ring of rotation.listRings()) {
    const loadId = ROTATION_DRIVE_LOAD_BY_RING[ring.id];
    const load = electrical.getLoad(loadId);
    const breaker = breakers.get(load.breakerId);
    const relativeRpm =
      (ring.relativeAngularVelocityRadPerS * 60) /
      (Math.PI * 2);
    if (
      ring.controlMode !== "speed-hold" ||
      ring.drive.condition !== "nominal" ||
      ring.bearing.condition !== "nominal" ||
      Math.abs(relativeRpm - ring.targetRelativeRpm) >
        0.001 ||
      !load.enabled ||
      breaker?.commandedClosed !== true ||
      breaker.condition !== "nominal"
    ) {
      return true;
    }
  }
  return false;
}

function runCoupledStep(realSeconds: number, timeScale: number): void {
  const checkpoint = captureDomainCheckpoint();
  try {
    runCoupledStepUnchecked(realSeconds, timeScale);
  } catch (error) {
    restoreDomainCheckpoint(checkpoint);
    throw error;
  }
}

function runCoupledStepUnchecked(
  realSeconds: number,
  timeScale: number,
): void {
  requestedTimeScale = timeScale;
  synchronizeCompartmentOccupants();
  const fidelityRequirement =
    compartments.getFidelityRequirement();
  const requestedSimulatedSeconds = realSeconds * timeScale;
  const couplingIntervalSeconds = fidelityRequirement.reasons.includes(
    "active-breach",
  )
    ? 3_600
    : ELECTRICAL_COUPLING_INTERVAL_SECONDS;
  const maximumSimulatedSeconds =
    fidelityRequirement.maximumSimulatedSecondsPerStep;
  effectiveTimeScale =
    maximumSimulatedSeconds === null ||
    requestedSimulatedSeconds <= maximumSimulatedSeconds ||
    realSeconds === 0
      ? timeScale
      : maximumSimulatedSeconds / realSeconds;
  engine.setTimeScale(effectiveTimeScale);
  let fineSubsteps = 0;
  let equilibriumIntervals = 0;
  engine.stepSliced(
    realSeconds,
    ({ fromMicroseconds }) => {
      if (
        navigation
          .listThrusters()
          .some((thruster) => thruster.lastThrustN > 0)
      ) {
        return 1;
      }
      if (rotationRequiresFineCoupling()) {
        // Keep transient rotation tightly coupled without reducing the
        // player-selected world-time rate. During an active breach the
        // accelerated atmosphere solve also permits hour-scale coupling;
        // propulsion remains on the stricter one-second path above.
        return couplingIntervalSeconds;
      }
      const nextBoundary = [
        navigation.getNextPropulsionBoundaryMicroseconds(),
        captainOperations.getNextScheduledBoundaryMicroseconds(),
      ]
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right)[0];
      if (nextBoundary !== undefined) {
        const secondsUntilBoundary =
          (nextBoundary - fromMicroseconds) / 1_000_000;
        if (
          secondsUntilBoundary > 0 &&
          secondsUntilBoundary <
            couplingIntervalSeconds
        ) {
          return secondsUntilBoundary;
        }
      }
      return couplingIntervalSeconds;
    },
    ({ fromMicroseconds, toMicroseconds, simulatedSeconds }) => {
      if (
        passengers.nowMicroseconds !== fromMicroseconds ||
        compartments.elapsedMicroseconds !== fromMicroseconds ||
        cooling.elapsedMicroseconds !== fromMicroseconds ||
        electrical.elapsedMicroseconds !== fromMicroseconds ||
        navigation.elapsedMicroseconds !== fromMicroseconds ||
        rotation.elapsedMicroseconds !== fromMicroseconds ||
        water.elapsedMicroseconds !== fromMicroseconds ||
        maintenance.elapsedMicroseconds !== fromMicroseconds ||
        captainOperations.elapsedMicroseconds !== fromMicroseconds
      ) {
        throw new Error(
          "coupled physical domains diverged before a common-clock slice",
        );
      }
      const intervalResult =
        advanceCoupledPhysicalDomains(simulatedSeconds);
      fineSubsteps += intervalResult.fineSubsteps;
      equilibriumIntervals +=
        intervalResult.equilibriumIntervals;
      if (
        passengers.nowMicroseconds !== toMicroseconds ||
        compartments.elapsedMicroseconds !== toMicroseconds ||
        cooling.elapsedMicroseconds !== toMicroseconds ||
        electrical.elapsedMicroseconds !== toMicroseconds ||
        navigation.elapsedMicroseconds !== toMicroseconds ||
        rotation.elapsedMicroseconds !== toMicroseconds ||
        water.elapsedMicroseconds !== toMicroseconds ||
        maintenance.elapsedMicroseconds !== toMicroseconds ||
        captainOperations.elapsedMicroseconds !== toMicroseconds
      ) {
        throw new Error(
          "coupled physical domains did not reach the common-clock slice boundary",
        );
      }
    },
  );
  lastCompartmentStep = {
    fidelityMode:
      fineSubsteps > 0
        ? equilibriumIntervals > 0
          ? "mixed"
          : "transient-fine"
        : "equilibrium-fast",
    fineSubsteps,
    equilibriumIntervals,
  };
  updatePassengerEnvironmentalExposures(
    realSeconds * effectiveTimeScale,
  );
  if (
    passengers.nowMicroseconds !== engine.elapsedMicroseconds ||
    compartments.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    cooling.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    electrical.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    navigation.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    rotation.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    water.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    maintenance.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    captainOperations.elapsedMicroseconds !== engine.elapsedMicroseconds
  ) {
    throw new Error(
      "coupled engine, passenger, compartment, cooling, electrical, navigation, rotation, water, maintenance, and captain operations clocks diverged after the simulation step",
    );
  }
  passengers.validateState();
}

function advanceCoupledPhysicalDomains(
  simulatedSeconds: number,
): Pick<
  CompartmentStepResult,
  "fineSubsteps" | "equilibriumIntervals"
> {
  applyHullConsequenceCoupling();
  const propulsionPreview =
    navigation.previewPropulsionControlInterval(
      simulatedSeconds,
    );
  const rotationRingsBefore = rotation.getSummary().rings;
  const rotationCarrier = currentRotationCarrierState();
  const rotationPreview =
    rotation.previewControlInterval(
      simulatedSeconds,
      rotationCarrier,
    );
  const electricalCoupling =
    advanceElectricalCoupling(
      simulatedSeconds,
      propulsionPreview,
      rotationPreview,
    );
  for (const airHandlerId of AIR_HANDLER_IDS) {
    compartments.synchronizeAirHandlerElectricalServiceFraction(
      airHandlerId,
      loadServiceFractionOverInterval(
        electricalCoupling,
        [AIR_HANDLER_LOAD_BY_ID[airHandlerId]],
        simulatedSeconds,
      ),
    );
  }
  for (const processorId of WATER_PROCESSOR_IDS) {
    water.synchronizeProcessorElectricalServiceFraction(
      processorId,
      loadServiceFractionOverInterval(
        electricalCoupling,
        [WATER_PROCESSOR_LOAD_BY_ID[processorId]],
        simulatedSeconds,
      ),
    );
  }
  const propulsionControl =
    navigation.applyPropulsionControlReceipt(
      propulsionPreview,
      Object.fromEntries(
        PROPULSION_CONTROL_LOAD_IDS.map((loadId) => [
          loadId,
          electricalCoupling.servedLoadEnergyKWhById[
            loadId
          ] * 3_600_000,
        ]),
      ) as Record<PropulsionControlTrainId, number>,
    );
  const rotationResult = rotation.step(
    rotationPreview,
    rotationCarrier,
    {
      "ring-a":
        Math.min(
          rotationPreview.requestedEnergyJByRing["ring-a"],
          electricalCoupling.servedLoadEnergyKWhById[
            ROTATION_DRIVE_LOAD_BY_RING["ring-a"]
          ] * 3_600_000,
        ),
      "ring-b":
        Math.min(
          rotationPreview.requestedEnergyJByRing["ring-b"],
          electricalCoupling.servedLoadEnergyKWhById[
            ROTATION_DRIVE_LOAD_BY_RING["ring-b"]
          ] * 3_600_000,
        ),
    },
  );
  const carrierBeforeExchange =
    navigation.getBodyState().angularVelocityBodyRadPerS.x;
  const carrierInertiaBeforeExchange =
    navigation.getCurrentInertiaDiagonal().x;
  assertProjectionClose(
    carrierBeforeExchange,
    rotationCarrier.angularVelocityXRadPerS,
    "rotation carrier angular velocity before internal exchange",
  );
  assertProjectionClose(
    carrierInertiaBeforeExchange,
    rotationCarrier.inertiaXKgM2,
    "rotation carrier inertia before internal exchange",
  );
  const carrierExchange =
    navigation.applyInternalAngularMomentumExchangeBody({
      x: rotationResult.carrierBodyAngularImpulseX,
      y: 0,
      z: 0,
    });
  assertProjectionClose(
    navigation.getBodyState().angularVelocityBodyRadPerS.x,
    rotationResult.predictedCarrierAngularVelocityXRadPerS,
    "rotation carrier reaction angular velocity",
  );
  const predictedCarrierEnergyChangeJ =
    0.5 *
    rotationCarrier.inertiaXKgM2 *
    (rotationResult
      .predictedCarrierAngularVelocityXRadPerS ** 2 -
      rotationCarrier.angularVelocityXRadPerS ** 2);
  assertProjectionClose(
    carrierExchange.bodyMechanicalEnergyChangeJ,
    predictedCarrierEnergyChangeJ,
    "rotation carrier reaction energy",
  );
  synchronizeElectricalAggregate();
  synchronizeCoolingElectricalSupply(
    electricalCoupling,
    simulatedSeconds,
  );
  synchronizeServedLoadHeatSource(
    electricalCoupling,
    simulatedSeconds,
  );
  const lifeSupportServiceRatio =
    loadServiceFractionOverInterval(
      electricalCoupling,
      LIFE_SUPPORT_LOAD_IDS,
      simulatedSeconds,
    );
  const cabinHeatPump = cabinHeatPumpCoupling(
    electricalCoupling,
    simulatedSeconds,
    lifeSupportServiceRatio,
  );
  const hibernationPower = passengers.advanceHibernationPower(
    simulatedSeconds,
    {
      a: loadServiceFractionOverInterval(
        electricalCoupling,
        ["hibernation-a"],
        simulatedSeconds,
      ),
      b: loadServiceFractionOverInterval(
        electricalCoupling,
        ["hibernation-b"],
        simulatedSeconds,
      ),
    },
    false,
  );

  const targetMicroseconds =
    compartments.elapsedMicroseconds +
    Math.round(simulatedSeconds * 1_000_000);
  const metabolicExchange = {
    oxygenConsumedKg: 0,
    carbonDioxideProducedKg: 0,
    waterVaporProducedKg: 0,
    sensibleHeatAddedJ: 0,
  };
  let metabolicHeatTransferredToCoolingJ = 0;
  let fineSubsteps = 0;
  let equilibriumIntervals = 0;
  passengers.advanceTo(targetMicroseconds, {
    validateAfterAdvance: false,
    hibernationServiceFraction: (transition) =>
      hibernationPower.effectiveServiceFractionByBank[
        hibernationPowerBankForPodId(transition.podId)
      ],
    beforeAdvance: ({ fromMicroseconds, toMicroseconds }) => {
      if (compartments.elapsedMicroseconds !== fromMicroseconds) {
        throw new Error(
          "passenger and compartment interval boundaries diverged",
        );
      }
      synchronizeCompartmentOccupants();
      const waterOccupants = synchronizeWaterOccupants();
      const segment = compartments.step(
        (toMicroseconds - fromMicroseconds) / 1_000_000,
        {
          externalMetabolicHeatRemovalFractionByRing:
            cabinHeatPump.metabolicHeatRemovalFractionByRing,
        },
      );
      fineSubsteps += segment.fineSubsteps;
      equilibriumIntervals += segment.equilibriumIntervals;
      metabolicExchange.oxygenConsumedKg +=
        segment.metabolicExchange.oxygenConsumedKg;
      metabolicExchange.carbonDioxideProducedKg +=
        segment.metabolicExchange.carbonDioxideProducedKg;
      metabolicExchange.waterVaporProducedKg +=
        segment.metabolicExchange.waterVaporProducedKg;
      metabolicExchange.sensibleHeatAddedJ +=
        segment.metabolicExchange.sensibleHeatAddedJ;
      metabolicHeatTransferredToCoolingJ +=
        segment.metabolicHeatTransferredToExternalJ;
      water.withdrawMetabolicWater(
        metabolicWaterByRing(
          segment.metabolicExchange.waterVaporProducedKg,
          waterOccupants,
        ),
      );
      water.step((toMicroseconds - fromMicroseconds) / 1_000_000);
    },
  });
  applyRotationHabitabilityThresholdCrossings(
    rotationRingsBefore,
    rotation.getSummary().rings,
  );
  applyHibernationPowerIncidents(
    hibernationPower.crossedIncidentThresholds,
  );
  // Atmosphere chemistry still applies; feedstock=0 so foodDryKg is not dual-debited.
  // Survival ration is the sole authoritative food inventory sink.
  engine.applyMetabolicMassExchange({
    oxygenConsumedKg: metabolicExchange.oxygenConsumedKg,
    carbonDioxideProducedKg: metabolicExchange.oxygenConsumedKg,
    waterVaporProducedKg: metabolicExchange.waterVaporProducedKg,
  });
  synchronizeAtmosphereAggregate(
    capturedCarbonDioxideTotal(),
  );
  // Per-slice ration keeps long-step vs repeated-step food/revision equivalent.
  applySurvivalRationAndStarvation(simulatedSeconds);
  // Tier/episode sync only inside slices; continuous dose runs once per step.
  updatePassengerEnvironmentalExposures(0);
  synchronizePopulationAggregate();
  synchronizeCompartmentOccupants();
  synchronizeWaterOccupants();
  synchronizeWaterAggregate();
  if (metabolicHeatTransferredToCoolingJ > 0) {
    const heatPumpWorkJ =
      cabinHeatPump.coefficientOfPerformance === null
        ? 0
        : metabolicHeatTransferredToCoolingJ /
          cabinHeatPump.coefficientOfPerformance;
    if (
      heatPumpWorkJ >
      cabinHeatPump.availableWorkEnergyJ + 1e-6
    ) {
      throw new Error(
        "cabin heat-pump work exceeded electrically supplied energy",
      );
    }
    cooling.applyExternalEnergy(
      "thermal-bus",
      metabolicHeatTransferredToCoolingJ + heatPumpWorkJ,
      "metabolic",
    );
  }
  {
    const awakeByRing = { A: 0, B: 0 };
    for (const zone of compartments.listZones()) {
      awakeByRing[zoneCatalogEntry(zone.id).ring] += zone.awakeOccupants;
    }
    for (const spurId of HABITAT_THERMAL_DELIVERY_SPUR_IDS) {
      const ring =
        spurId === "cooling-spur-a" ? ("A" as const) : ("B" as const);
      const demandedJ =
        awakeByRing[ring] *
        CABIN_SENSIBLE_HEAT_W_PER_AWAKE_PERSON *
        simulatedSeconds *
        cabinHeatPump.baseMetabolicHeatRemovalFraction;
      const deliveredJ =
        demandedJ *
        cabinHeatPump.habitatThermalDeliveryFractionByRing[ring];
      cooling.recordHabitatThermalDeliveryShortfall(
        spurId,
        Math.max(0, demandedJ - deliveredJ),
      );
    }
  }
  const navigationResult = navigation.step(
    simulatedSeconds,
    {
      x:
        rotation.getSummary()
          .netRelativeRingAngularMomentumKgM2PerS,
      y: 0,
      z: 0,
    },
  );
  if (
    !navigation
      .listThrusters()
      .some(
        (thruster) =>
          thruster.lastThrustN > 0 &&
          thruster.condition !== "stuck-on",
      )
  ) {
    for (const loadId of PROPULSION_CONTROL_LOAD_IDS) {
      electrical.synchronizeLoadControllerDemandFraction(
        loadId,
        0,
      );
    }
    synchronizeElectricalAggregate();
  }
  const propulsionHeatJ =
    propulsionControl.retainedControlHeatJ +
    navigationResult.retainedWasteHeatJ;
  if (propulsionHeatJ > 0) {
    cooling.applyExternalEnergy(
      "thermal-bus",
      propulsionHeatJ,
      "propulsion",
    );
  }
  if (rotationResult.heatJ > 0) {
    cooling.applyExternalEnergy(
      "thermal-bus",
      rotationResult.heatJ,
      "rotation-drive",
    );
  }
  cooling.step(simulatedSeconds);
  synchronizeThermalAggregate();
  advanceMaintenance(simulatedSeconds, electricalCoupling);
  const operationsSnapshot = captainOperations.snapshot();
  const departmentServiceFractionById =
    operationsDepartmentServiceFractions(
      simulatedSeconds,
      electricalCoupling,
      operationsSnapshot,
    );
  const waterLoops = water.listLoops();
  const operationsAdvance = captainOperations.advance(simulatedSeconds, {
    departmentServiceFractionById,
    taskServiceFractionById: operationsTaskServiceFractions(
      simulatedSeconds,
      electricalCoupling,
      operationsSnapshot,
      departmentServiceFractionById,
    ),
    agricultureServiceFractionByRing: {
      a: loadServiceFractionOverInterval(
        electricalCoupling,
        ["life-support-a"],
        simulatedSeconds,
      ),
      b: loadServiceFractionOverInterval(
        electricalCoupling,
        ["life-support-b"],
        simulatedSeconds,
      ),
    },
    agricultureCo2AvailabilityByRing: agricultureCo2AvailabilityByRing(),
    oxygenProductionServiceFractionByRing: {
      a: loadServiceFractionOverInterval(
        electricalCoupling,
        ["life-support-a"],
        simulatedSeconds,
      ),
      b: loadServiceFractionOverInterval(
        electricalCoupling,
        ["life-support-b"],
        simulatedSeconds,
      ),
    },
    remoteAssetServiceFraction: loadServiceFractionOverInterval(
      electricalCoupling,
      [
        "habitat-a",
        "habitat-b",
        "propulsion-control-a",
        "propulsion-control-b",
      ],
      simulatedSeconds,
    ),
    availablePotableWaterKgByRing: {
      a:
        waterLoops.find((loop) => loop.id === "water-loop-a")?.potableKg ??
        0,
      b:
        waterLoops.find((loop) => loop.id === "water-loop-b")?.potableKg ??
        0,
    },
  });
  for (const effect of operationsAdvance.effects) {
    if (effect.type === "oxygen-produced") {
      water.withdrawPotableForOperations(effect.waterConsumedKgByRing);
      continue;
    }
    if (effect.type === "food-produced") {
      water.withdrawPotableForOperations(effect.waterConsumedKgByRing);
      engine.addFoodInventoryKg(effect.foodKg);
      continue;
    }
    applyCompletedOperationsTask(effect.task);
  }
  synchronizeWaterAggregate();
  return { fineSubsteps, equilibriumIntervals };
}

const ACTIVE_SCAN_REPORT_PREFIX =
  "高权限主动扫描摘要（完成时刻采样，含噪声/延迟模型；非上帝覆写通道）";

function formatSensorScalar(
  value: number | null,
  digits: number,
): string {
  return value == null ? "不可用" : value.toFixed(digits);
}

function formatPressureKPa(pressurePa: number | null): string {
  if (pressurePa == null) return "不可用";
  return `${(Math.round(pressurePa / 100) / 10).toFixed(1)} kPa`;
}

function activeScanCompletionSummary(task: OperationsTask): string {
  const packageId = task.effect.packageId;
  const target = task.effect.target;
  if (typeof packageId !== "string" || typeof target !== "string") {
    throw new Error(`${task.id} active scan effect is malformed`);
  }
  if (packageId === "hull-inspection-array") {
    const telemetry = compartmentTelemetry();
    const abnormal = telemetry.zones.filter(
      (zone) => zone.condition !== "nominal",
    );
    return `${ACTIVE_SCAN_REPORT_PREFIX}：主动船体扫描 ${target} 完成：传感器判读 ${abnormal.length} 个舱区非名义状态，观测最低压力 ${formatPressureKPa(telemetry.observedPressureMinPa)}；未导出破口上帝真值清单。`;
  }
  if (packageId === "thermal-diagnostic-array") {
    const thermal = coolingTelemetry().observed;
    return `${ACTIVE_SCAN_REPORT_PREFIX}：主动热诊断 ${target} 完成：热总线 ${formatSensorScalar(thermal.thermalBusTemperatureK, 2)} K，散热功率 ${formatSensorScalar(thermal.totalRadiatedPowerW, 0)} W，冷却流量 ${formatSensorScalar(thermal.totalMassFlowKgPerSecond, 3)} kg/s。`;
  }
  if (packageId === "atmosphere-diagnostic-array") {
    const telemetry = compartmentTelemetry();
    const abnormal = telemetry.zones.filter(
      (zone) => zone.condition !== "nominal",
    );
    return `${ACTIVE_SCAN_REPORT_PREFIX}：主动大气扫描 ${target} 完成：48 个压力区中 ${abnormal.length} 个异常，观测压力 ${formatPressureKPa(telemetry.observedPressureMinPa)}–${formatPressureKPa(telemetry.observedPressureMaxPa)}；${abnormal.slice(0, 6).map((zone) => `${zone.zoneId}:${zone.condition}`).join("，") || "全部区域名义正常"}。`;
  }
  if (
    packageId === "navigation-array" ||
    packageId === "external-radar"
  ) {
    const observed = navigationTelemetry().observed;
    const velocity = observed.velocityMPerS;
    const position = observed.positionM;
    const speed =
      velocity.x == null || velocity.y == null || velocity.z == null
        ? null
        : Math.hypot(velocity.x, velocity.y, velocity.z);
    const positionText =
      position.x == null || position.y == null || position.z == null
        ? "不可用"
        : `(${position.x.toExponential(3)}, ${position.y.toExponential(3)}, ${position.z.toExponential(3)}) m`;
    return `${ACTIVE_SCAN_REPORT_PREFIX}：${packageId} 对 ${target} 的主动扫描完成：舰体惯性速度 ${formatSensorScalar(speed, 3)} m/s，位置 ${positionText}。`;
  }
  const electricalObserved = electricalTelemetry().observed;
  return `${ACTIVE_SCAN_REPORT_PREFIX}：通信阵列对 ${target} 的主动探测完成：传感器观测总反应堆输出 ${formatSensorScalar(electricalObserved.totalReactorOutputKw, 0)} kW、负载服务 ${formatSensorScalar(electricalObserved.totalServedPowerKw, 0)} kW。`;
}

function applyCompletedOperationsTask(task: OperationsTask): void {
  if (task.kind === "medical-treatment") {
    const personId = task.effect.personId;
    if (typeof personId !== "string") {
      throw new Error(`${task.id} medical effect has no personId`);
    }
    const person = passengers.getPassenger(personId);
    const zoneId = currentZoneForPerson(person);
    const inMedicalZone = zoneCatalogEntry(zoneId).role === "medical";
    const effectMul = medicalTreatmentEffectMultiplier(inMedicalZone);
    passengers.applyPassengerIncident({
      eventId: `operations:${task.id}`,
      eventType: "medical-treatment-complete",
      summary: `${task.description}，治疗后生命体征获得改善${
        inMedicalZone ? "（医疗区全效）" : "（非医疗区减效）"
      }。`,
      targetPassengerIds: [personId],
      healthImpact: {
        physical: 0.08 * effectMul,
        resilience: 0.04 * effectMul,
      },
      psychologyImpact: {
        stability: 0.025 * effectMul,
        stress: -0.04 * effectMul,
      },
      experienceImpact: {
        safety: 0.03 * effectMul,
        trust: 0.04 * effectMul,
      },
      fatal: false,
      valence: 0.55,
      salience: 0.65,
      confidence: 1,
    });
    synchronizePopulationAggregate();
  } else if (task.kind === "hull-repair") {
    compartments.removeBreach(task.targetId);
    hullConsequence.clear(task.targetId);
    synchronizeAtmosphereAggregate(capturedCarbonDioxideTotal());
    syncHullThrustDerates();
  } else if (task.kind === "manufacturing") {
    const partId = task.effect.partId;
    const quantity = task.effect.quantity;
    if (typeof partId !== "string" || typeof quantity !== "number") {
      throw new Error(`${task.id} manufacturing effect is malformed`);
    }
    maintenance.addManufacturedPart(
      partId as Parameters<MaintenanceNetwork["addManufacturedPart"]>[0],
      quantity,
    );
  }
  const completionSummary =
    task.kind === "active-scan"
      ? activeScanCompletionSummary(task)
      : task.kind === "remote-deployment"
        ? `${task.description} 已在 ${(task.completedAtMicroseconds ?? captainOperations.elapsedMicroseconds) / 1_000_000}s 完成；资产状态、任务目标和电池账已同步。`
        : task.kind === "security-investigation"
          ? `${task.description} 已完成；现场与人员记录中未发现足以支持指控的实体证据，案件按无罪推定结案。`
        : task.completionSummary ?? `${task.description} 已完成`;
  captainOperations.applyCompletedTask(task.id, completionSummary);
}

function replaceEquivalentBreachArea(areaSquareMeters: number): void {
  interventionsReplaceEquivalentBreachArea(
    compartments,
    hullConsequence,
    areaSquareMeters,
    registerHullBreachConsequence,
    syncHullThrustDerates,
  );
}

function normalizeDirectForceBalance(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  return interventionsNormalizeDirectForceBalance(
    request,
    engine,
    compartments,
    cooling,
  );
}

function applyWaterInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
): void {
  interventionsApplyWaterInterventionEffects(
    request,
    record,
    water,
    engine,
    synchronizeWaterAggregate,
  );
}

function normalizeRingBearingDegradation(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  return interventionsNormalizeRingBearingDegradation(request);
}

function normalizeAirHandlerTrip(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  return interventionsNormalizeAirHandlerTrip(request);
}

function normalizeWaterProcessorTrip(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  return interventionsNormalizeWaterProcessorTrip(request);
}

function normalizeWaterSpurFault(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  return interventionsNormalizeWaterSpurFault(request);
}

function normalizeCoolingSpurFault(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  return interventionsNormalizeCoolingSpurFault(request);
}

function applyIncidentToRoster(
  input: ApplyPassengerIncidentInput,
): void {
  habitabilityApplyIncidentToRoster(
    passengers,
    input,
    synchronizePopulationAggregate,
    synchronizeCompartmentOccupants,
  );
}

function awakePassengersInZone(zoneId: ZoneId) {
  return habitabilityAwakePassengersInZone(
    passengers,
    currentZoneForPerson,
    zoneId,
  );
}

function updatePassengerEnvironmentalExposures(
  deltaSeconds = 0,
): void {
  const result = habitabilityUpdatePassengerEnvironmentalExposures({
    survivalZoneDoses,
    compartments,
    passengers,
    currentZoneForPerson,
    deltaSeconds,
    applyIncidentToRoster,
    applyContinuousRosterDeltas,
  });
  survivalZoneDoses = result.survivalZoneDoses;
  passengerEnvironmentalExposures = result.passengerEnvironmentalExposures;
}

function applySurvivalRationAndStarvation(deltaSeconds: number): void {
  survivalLedger = habitabilityApplySurvivalRationAndStarvation({
    passengers,
    foodDryKg: engine.getState().consumables.foodDryKg,
    rationKgPerAwakePersonDay:
      captainOperations.getRationKgPerAwakePersonDay(),
    survivalLedger,
    deltaSeconds,
    consumeFoodRationKg: (demanded) => engine.consumeFoodRationKg(demanded),
    applyContinuousRosterDeltas,
  });
}

function buildProceduralInterventionRequest(
  event: ProceduralWorldEvent,
): ExternalInterventionRequest | null {
  return interventionsBuildProceduralInterventionRequest(
    event,
    compartments,
  );
}


function applyWorkerIntervention(
  request: ExternalInterventionRequest,
): ExternalInterventionRecord {
  const checkpoint = captureDomainCheckpoint();
  try {
    const normalizedRequest = normalizeCoolingSpurFault(
      normalizeWaterSpurFault(
        normalizeWaterProcessorTrip(
          normalizeAirHandlerTrip(
            normalizeRingBearingDegradation(
              normalizeDirectForceBalance(request),
            ),
          ),
        ),
      ),
    );
    const record = engine.applyExternalIntervention(normalizedRequest);
    applyCompartmentInterventionEffects(normalizedRequest, record);
    applyCoolingInterventionEffects(normalizedRequest, record);
    applyElectricalInterventionEffects(normalizedRequest, record);
    applyWaterInterventionEffects(normalizedRequest, record);
    applyRotationInterventionEffects(normalizedRequest);
    applyNavigationInterventionEffects(record);
    updatePassengerEnvironmentalExposures(0);
    validateRestoredProjection(
      engine,
      passengers,
      compartments,
      cooling,
      electrical,
      navigation,
      rotation,
      water,
    );
    return record;
  } catch (error) {
    restoreDomainCheckpointOrThrow(checkpoint, error);
    throw error;
  }
}

function applyProceduralWorldEvents(
  simulationSeconds: number,
): ProceduralWorldEvent[] {
  const triggered = proceduralWorld.check(simulationSeconds);
  for (const event of triggered) {
    if (event.narrativeOnly || !event.interventionEventType) {
      continue;
    }
    const request = buildProceduralInterventionRequest(event);
    if (request === null) continue;
    applyWorkerIntervention(request);
  }
  return triggered;
}

function applyTimeControl(
  command: Extract<SimulationWorkerCommand, { type: "set-time-control" }>,
): void {
  lastReachedBlockingBoundary = null;
  if (command.timeScale !== undefined) {
    timeDirector.setTimeScale(command.timeScale);
    requestedTimeScale = command.timeScale;
  }
  for (const token of command.acquirePauseTokens ?? []) {
    timeDirector.acquirePauseToken(token);
  }
  for (const token of command.releasePauseTokens ?? []) {
    timeDirector.releasePauseToken(token);
  }
  post({
    type: "ready",
    requestId: command.requestId,
    payload: currentState(),
  });
}

function advanceSimulationStep(
  command: Extract<SimulationWorkerCommand, { type: "step" }>,
): void {
  lastProceduralEvents = [];
  lastReachedBlockingBoundary = null;
  if (Number.isFinite(command.timeScale) && command.timeScale > 0) {
    timeDirector.setTimeScale(command.timeScale);
  }
  const boundary = command.blockingBoundary;
  if (boundary) {
    if (
      typeof boundary.id !== "string" ||
      !boundary.id.trim() ||
      !Number.isFinite(boundary.atSimulationSeconds) ||
      boundary.atSimulationSeconds < 0 ||
      typeof boundary.pauseToken !== "string" ||
      !boundary.pauseToken.trim()
    ) {
      throw new Error("blockingBoundary is malformed");
    }
    if (engine.elapsedSeconds + 1e-9 >= boundary.atSimulationSeconds) {
      timeDirector.acquirePauseToken(boundary.pauseToken);
      requestedTimeScale = timeDirector.timeScale;
      effectiveTimeScale = 0;
      lastReachedBlockingBoundary = {
        id: boundary.id,
        atSimulationSeconds: boundary.atSimulationSeconds,
      };
      post({
        type: "stepped",
        requestId: command.requestId,
        payload: currentState(),
      });
      return;
    }
  }
  const plan = timeDirector.planHeartbeat(command.realSeconds);
  if (plan.paused || plan.wallSecondsToRun === 0) {
    timeDirector.commitHeartbeat({
      wallSecondsElapsed: command.realSeconds,
      wallSecondsRequested: 0,
      requestedTimeScale: plan.requestedTimeScale,
      effectiveTimeScale: 0,
    });
    requestedTimeScale = plan.requestedTimeScale;
    effectiveTimeScale = 0;
    lastProceduralEvents = [];
    post({
      type: "stepped",
      requestId: command.requestId,
      payload: currentState(),
    });
    return;
  }

  const secondsUntilBoundary = boundary
    ? Math.max(
        0,
        boundary.atSimulationSeconds - engine.elapsedSeconds,
      )
    : Number.POSITIVE_INFINITY;
  const boundaryWallSeconds = Number.isFinite(secondsUntilBoundary)
    ? secondsUntilBoundary / plan.requestedTimeScale
    : Number.POSITIVE_INFINITY;
  const wallSecondsToRun = Math.min(
    plan.wallSecondsToRun,
    boundaryWallSeconds,
  );
  let remainingWallSeconds = wallSecondsToRun;
  while (remainingWallSeconds > 1e-12) {
    const nextProceduralEventAt =
      proceduralWorld.nextEventSimulationSeconds();
    if (
      nextProceduralEventAt !== null &&
      engine.elapsedSeconds + 1e-6 >= nextProceduralEventAt
    ) {
      lastProceduralEvents.push(
        ...applyProceduralWorldEvents(engine.elapsedSeconds),
      );
      continue;
    }
    const wallSecondsUntilProceduralEvent =
      nextProceduralEventAt === null
        ? Number.POSITIVE_INFINITY
        : Math.max(
            0,
            nextProceduralEventAt - engine.elapsedSeconds,
          ) / plan.requestedTimeScale;
    const segmentWallSeconds = Math.min(
      remainingWallSeconds,
      wallSecondsUntilProceduralEvent,
    );
    runCoupledStep(segmentWallSeconds, plan.requestedTimeScale);
    remainingWallSeconds = Math.max(
      0,
      remainingWallSeconds - segmentWallSeconds,
    );
    if (
      nextProceduralEventAt !== null &&
      engine.elapsedSeconds + 1e-6 >= nextProceduralEventAt
    ) {
      lastProceduralEvents.push(
        ...applyProceduralWorldEvents(engine.elapsedSeconds),
      );
    }
  }
  const reachedBoundary =
    boundary !== undefined &&
    engine.elapsedSeconds + 1e-6 >= boundary.atSimulationSeconds;
  timeDirector.commitHeartbeat({
    // Once a blocking deadline is reached, the unused part of this wall-clock
    // heartbeat happened while the world was frozen. It must not become catch-
    // up debt when the decision completes.
    wallSecondsElapsed: reachedBoundary
      ? Math.min(command.realSeconds, wallSecondsToRun)
      : command.realSeconds,
    wallSecondsRequested: wallSecondsToRun,
    requestedTimeScale: plan.requestedTimeScale,
    effectiveTimeScale,
  });
  if (reachedBoundary) {
    timeDirector.acquirePauseToken(boundary.pauseToken);
    lastReachedBlockingBoundary = {
      id: boundary.id,
      atSimulationSeconds: boundary.atSimulationSeconds,
    };
  }
  post({
    type: "stepped",
    requestId: command.requestId,
    payload: currentState(),
  });
}

function applyCompartmentInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
): void {
  interventionsApplyCompartmentInterventionEffects(
    request,
    record,
    compartments,
    passengers,
    awakePassengersInZone,
    applyIncidentToRoster,
    replaceEquivalentBreachArea,
    registerHullBreachConsequence,
    syncHullThrustDerates,
    synchronizeAtmosphereAggregate,
    capturedCarbonDioxideTotal,
  );
}

function applyCoolingInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
): void {
  interventionsApplyCoolingInterventionEffects(
    request,
    record,
    cooling,
    synchronizeThermalAggregate,
  );
}

function applyElectricalInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
): void {
  interventionsApplyElectricalInterventionEffects(
    request,
    record,
    electrical,
    synchronizeElectricalAggregate,
  );
}

function applyRotationInterventionEffects(
  request: ExternalInterventionRequest,
): void {
  interventionsApplyRotationInterventionEffects(request, rotation);
}

function applyNavigationInterventionEffects(
  record: ExternalInterventionRecord,
): void {
  interventionsApplyNavigationInterventionEffects(record, navigation);
}


function createCommandHandlerContext(): CommandHandlerContext {
  return {
    get engine() {
      return engine;
    },
    get passengers() {
      return passengers;
    },
    get compartments() {
      return compartments;
    },
    get cooling() {
      return cooling;
    },
    get electrical() {
      return electrical;
    },
    get navigation() {
      return navigation;
    },
    get rotation() {
      return rotation;
    },
    get water() {
      return water;
    },
    get maintenance() {
      return maintenance;
    },
    get hullConsequence() {
      return hullConsequence;
    },
    get captainOperations() {
      return captainOperations;
    },
    synchronizeJumpDriveControllerDemand,
    synchronizeElectricalAggregate,
    synchronizeThermalAggregate,
    synchronizeWaterAggregate,
    synchronizeAtmosphereAggregate,
    synchronizeCompartmentOccupants,
    currentRotationCarrierState,
    currentMaintenanceConditions,
    currentZoneForPerson,
    findPersonnelRoute,
    capturedCarbonDioxideTotal,
    airHandlerLoadById: AIR_HANDLER_LOAD_BY_ID,
    waterProcessorLoadById: WATER_PROCESSOR_LOAD_BY_ID,
    jumpDriveLoadIds: JUMP_DRIVE_LOAD_IDS,
  };
}

function executeShipCommand(
  command: ShipOperationalCommand,
  executionId: string,
) {
  return executeRegisteredShipCommand(
    command,
    createCommandHandlerContext(),
    executionId,
  );
}

function dispatchShipCommand(
  command: Extract<
    SimulationWorkerCommand,
    { type: "ship-command" }
  >,
): ShipOperationalCommandResult {
  const checkpoint = captureDomainCheckpoint();
  const receipt = commandBus.dispatch(
    {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      actor: command.command.actorAgentId,
      kind: command.command.kind,
      payload:
        command.command as unknown as StructuredCommandResult,
      issuedAt: command.issuedAtMicroseconds,
      expectedRevision: command.expectedRevision,
    },
    () => {
      try {
        if (command.issuedAtMicroseconds > engine.elapsedMicroseconds) {
          throw new Error(
            `command issue time ${command.issuedAtMicroseconds} is in the future; simulation clock is ${engine.elapsedMicroseconds}`,
          );
        }
        if (
          engine.getState().revision !==
          command.expectedStateRevision
        ) {
          throw new Error(
            `observed state revision ${command.expectedStateRevision} is stale; current revision is ${engine.getState().revision}`,
          );
        }
        const result = executeShipCommand(
          command.command,
          command.commandId,
        );
        validateRestoredProjection(
          engine,
          passengers,
          compartments,
          cooling,
          electrical,
          navigation,
          rotation,
          water,
        );
        validateMaintenanceProjection(
          maintenance,
          passengers,
        );
        return result as unknown as StructuredCommandResult;
      } catch (error) {
        restoreDomainCheckpointOrThrow(checkpoint, error);
        throw error;
      }
    },
  );
  if (receipt.status === "rejected") {
    if (receipt.rejection.code === "INVALID_EXECUTOR_RESULT") {
      restoreDomainCheckpointOrThrow(
        checkpoint,
        new Error(
          `command ${receipt.rejection.code}: ${receipt.rejection.message}`,
        ),
      );
    }
    throw new Error(
      `command ${receipt.rejection.code}: ${receipt.rejection.message}`,
    );
  }
  return receipt.result as unknown as ShipOperationalCommandResult;
}

function createFinalReport(): FinalJourneyReport {
  const state = engine.getState();
  if (state.journey.status !== "arrived") {
    throw new Error("final report is only available after safe arrival");
  }
  const summary = passengers.getPopulationSummary();
  const representatives = passengers
    .getJourneyRepresentativePassengers(6)
    .map((person) => ({
      passengerId: person.id,
      passengerName: person.name,
      text: passengers.getJourneyEvaluation(person.id),
    }));
  return {
    outcome: "arrived",
    elapsedSeconds: engine.elapsedSeconds,
    origin: state.journey.origin,
    destination: state.journey.destination,
    jumpsCompleted: state.journey.jumpsCompleted,
    survivors: summary.total - summary.deceased,
    deceased: summary.deceased,
    evaluationCount: summary.total,
    representativeEvaluations: representatives,
  };
}

globalThis.onmessage = (message: MessageEvent<SimulationWorkerCommand>) => {
  const command = message.data;
  try {
    switch (command.type) {
      case "initialize":
        initialize(command);
        return;
      case "restore":
        restore(command);
        return;
      case "set-time-control":
        applyTimeControl(command);
        return;
      case "step":
        advanceSimulationStep(command);
        return;
      case "snapshot":
        post({
          type: "snapshot",
          requestId: command.requestId,
          payload: { snapshot: runtimeSnapshot() },
        });
        return;
      case "ship-command": {
        const result = dispatchShipCommand(command);
        post({
          type: "ship-command",
          requestId: command.requestId,
          payload: { ...currentState(), result },
        });
        return;
      }
      case "final-report":
        post({
          type: "final-report",
          requestId: command.requestId,
          payload: { report: createFinalReport() },
        });
        return;
      case "intervene": {
        const record = applyWorkerIntervention(command.request);
        post({
          type: "intervention",
          requestId: command.requestId,
          payload: { ...currentState(), record },
        });
        return;
      }
      case "inspect":
        post({
          type: "ready",
          requestId: command.requestId,
          payload: currentState(),
        });
        return;
    }
  } catch (error) {
    post({
      type: "error",
      requestId: command.requestId,
      message: errorMessage(error),
    });
  }
};
