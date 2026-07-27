import {
  createBaselineShipState,
  SimulationEngine,
} from "./index.ts";
import {
  estimateMinLegs,
  findStarCatalogEntry,
  routeDistanceLy,
} from "../astro/star-catalog.ts";
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
  type HabitatThermalDeliverySpurId,
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
  effectiveDeliveryFraction,
} from "./water.ts";
import {
  MAINTENANCE_ASSET_SPECS,
  MAINTENANCE_ROBOT_IDS,
  MaintenanceNetwork,
} from "./maintenance.ts";
import {
  HullConsequenceNetwork,
  type HullCascadeAction,
  type HullRingId,
} from "./hull-consequence.ts";
import {
  JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K,
  jumpEnergyConsumedKWh,
  projectJumpThermalBusTemperatureK,
} from "./jump-interlock.ts";
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
  applyRationAndStarvation,
  createEmptySurvivalLedger,
  integrateHazardDose,
  medicalTreatmentEffectMultiplier,
  MEDICAL_ZONE_SURVIVAL_DOSE_MULTIPLIER,
  restoreSurvival,
  snapshotSurvival,
  type SurvivalHazardFamily,
  type SurvivalLedger,
  type ZoneHazardDose,
} from "./survival.ts";
import type {
  AirHandlerId,
  CompartmentStepResult,
  GasSpecies,
  ZoneId,
  ZoneRole,
  ZoneTruth,
} from "./compartments";
import type {
  CoolingNetworkSnapshot,
} from "./cooling";
import type {
  ElectricalBatteryId,
  ElectricalLoadId,
  ElectricalNetworkSnapshot,
  ElectricalStepResult,
  FusionReactorId,
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
  WaterDistributionSpurId,
  WaterProcessorId,
  WaterRecoverySnapshot,
  WaterRing,
} from "./water";
import type {
  MaintenanceAssetId,
  MaintenanceConditionRecord,
  MaintenanceRobotId,
  MaintenanceSnapshot,
} from "./maintenance";
import type {
  StructuredCommandResult,
} from "./command-bus";
import type {
  ApplyPassengerIncidentInput,
  HibernationPowerIncidentThreshold,
  Passenger,
} from "./passengers";
import type {
  ExternalInterventionRecord,
  ExternalInterventionRequest,
  InterventionOperation,
  SimulationSnapshot,
} from "./index";
import type {
  CompartmentTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  FinalJourneyReport,
  NavigationTelemetry,
  PassengerEnvironmentalExposureState,
  PassengerEnvironmentalHazardFamily,
  PassengerEnvironmentalHazardTier,
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
const MEDICAL_BATCH_LIMIT = 24;
const GAS_SENSIBLE_HEAT_J_PER_KG_K = 1_005;
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
const JUMP_MAXIMUM_ANGULAR_SPEED_RAD_PER_SECOND = 1e-5;
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

const PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES = [
  "low-pressure",
  "hypoxia",
  "high-carbon-dioxide",
  "cold",
  "heat",
] as const satisfies readonly PassengerEnvironmentalHazardFamily[];

function createPassengerEnvironmentalExposureStates():
  PassengerEnvironmentalExposureState[] {
  return BASELINE_ZONE_IDS.flatMap((zoneId) =>
    PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES.map((family) => ({
      zoneId,
      family,
      currentTier: 0 as const,
      episode: 0,
    })),
  );
}

function createSurvivalZoneDoses(): ZoneHazardDose[] {
  return BASELINE_ZONE_IDS.flatMap((zoneId) =>
    PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES.map((family) => ({
      zoneId,
      family: family as SurvivalHazardFamily,
      accumulatedDoseSeconds: 0,
      currentTier: 0 as const,
      episode: 0,
    })),
  );
}

function syncExposuresFromSurvivalDoses(): void {
  passengerEnvironmentalExposures = survivalZoneDoses.map((dose) => ({
    zoneId: dose.zoneId as ZoneId,
    family: dose.family as PassengerEnvironmentalHazardFamily,
    currentTier: dose.currentTier,
    episode: dose.episode,
  }));
}

function clampIncidentDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

function applyContinuousRosterDeltas(
  targetPassengerIds: readonly string[],
  deltas: {
    physical?: number;
    stress?: number;
  },
): void {
  const physical = clampIncidentDelta(deltas.physical ?? 0);
  const stress = clampIncidentDelta(deltas.stress ?? 0);
  if (
    targetPassengerIds.length === 0 ||
    (physical === 0 && stress === 0)
  ) {
    return;
  }
  const targets = new Set(targetPassengerIds);
  const snapshot = passengers.snapshot();
  for (const person of snapshot.passengers) {
    if (!targets.has(person.id) || person.lifeState === "deceased") {
      continue;
    }
    if (physical !== 0) {
      person.health.physical = Math.min(
        1,
        Math.max(0, person.health.physical + physical),
      );
    }
    if (stress !== 0 && person.lifeState === "awake") {
      person.psychology.stress = Math.min(
        1,
        Math.max(0, person.psychology.stress + stress),
      );
    }
    if (person.health.physical === 0) {
      snapshot.activeTransitions = snapshot.activeTransitions.filter(
        (transition) => transition.passengerId !== person.id,
      );
      person.lifeState = "deceased";
      person.hibernationPodId = null;
    }
  }
  passengers = PassengerSimulation.restore(snapshot);
  synchronizePopulationAggregate();
  synchronizeCompartmentOccupants();
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

type RotationHabitabilityHazard = {
  code:
    | "low-gravity"
    | "near-weightlessness"
    | "high-gravity"
    | "extreme-high-gravity"
    | "structural-vibration"
    | "severe-structural-vibration";
  family: "low-gravity" | "high-gravity" | "vibration";
  rank: 1 | 2;
  summary: string;
  healthImpact?: ApplyPassengerIncidentInput["healthImpact"];
  psychologyImpact: NonNullable<
    ApplyPassengerIncidentInput["psychologyImpact"]
  >;
  experienceImpact: NonNullable<
    ApplyPassengerIncidentInput["experienceImpact"]
  >;
  valence: number;
  salience: number;
};

function gravityHabitabilityHazard(
  ring: RingTruthSummary,
): RotationHabitabilityHazard | null {
  if (ring.artificialGravityG < 0.45) {
    return {
      code: "near-weightlessness",
      family: "low-gravity",
      rank: 2,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环有效重力降至近失重区间；` +
        "清醒乘员出现明显定向困难，舱内活动转入扶手与约束带程序。",
      psychologyImpact: { stability: -0.05, stress: 0.1 },
      experienceImpact: { comfort: -0.15, safety: -0.1 },
      valence: -0.78,
      salience: 0.9,
    };
  }
  if (ring.artificialGravityG < 0.8) {
    return {
      code: "low-gravity",
      family: "low-gravity",
      rank: 1,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环有效重力偏离居住带；` +
        "清醒乘员感到步态、物品固定和日常活动方式发生变化。",
      psychologyImpact: { stability: -0.015, stress: 0.035 },
      experienceImpact: { comfort: -0.055, safety: -0.025 },
      valence: -0.42,
      salience: 0.62,
    };
  }
  if (ring.artificialGravityG > 2) {
    return {
      code: "extreme-high-gravity",
      family: "high-gravity",
      rank: 2,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环进入危险高重力区间；` +
        "清醒乘员承受显著循环负荷并发生跌倒、挤压等急性伤害风险。",
      healthImpact: {
        physical: -0.06,
        resilience: -0.04,
        chronicRisk: 0.015,
      },
      psychologyImpact: { stability: -0.08, stress: 0.18 },
      experienceImpact: {
        comfort: -0.2,
        safety: -0.2,
        trust: -0.03,
      },
      valence: -0.9,
      salience: 0.97,
    };
  }
  if (ring.artificialGravityG > 1.2) {
    return {
      code: "high-gravity",
      family: "high-gravity",
      rank: 1,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环有效重力高于长期居住带；` +
        "清醒乘员感到动作负担增加，休息与工作程序受到限制。",
      psychologyImpact: { stability: -0.02, stress: 0.045 },
      experienceImpact: { comfort: -0.07, safety: -0.035 },
      valence: -0.5,
      salience: 0.68,
    };
  }
  return null;
}

function vibrationHabitabilityHazard(
  ring: RingTruthSummary,
): RotationHabitabilityHazard | null {
  if (ring.vibrationMmPerS > 6) {
    return {
      code: "severe-structural-vibration",
      family: "vibration",
      rank: 2,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环持续结构振动进入严重区间；` +
        "清醒乘员的睡眠、精细操作和安全感受到明显影响。",
      psychologyImpact: { stability: -0.045, stress: 0.09 },
      experienceImpact: { comfort: -0.13, safety: -0.075 },
      valence: -0.72,
      salience: 0.86,
    };
  }
  if (ring.vibrationMmPerS > 2.5) {
    return {
      code: "structural-vibration",
      family: "vibration",
      rank: 1,
      summary:
        `${ring.id === "ring-a" ? "A" : "B"} 环可感结构振动升高；` +
        "清醒乘员报告休息质量和精细操作舒适度下降。",
      psychologyImpact: { stability: -0.012, stress: 0.025 },
      experienceImpact: { comfort: -0.045, safety: -0.015 },
      valence: -0.36,
      salience: 0.56,
    };
  }
  return null;
}

function awakePassengersInRing(ringId: RotationRingId) {
  const zonePrefix = ringId === "ring-a" ? "A-" : "B-";
  return passengers
    .getAllPassengers()
    .filter(
      (person) =>
        person.lifeState === "awake" &&
        currentZoneForPerson(person).startsWith(zonePrefix),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function applyRotationHabitabilityThresholdCrossings(
  beforeRings: readonly RingTruthSummary[],
  afterRings: readonly RingTruthSummary[],
): void {
  const beforeById = new Map(
    beforeRings.map((ring) => [ring.id, ring]),
  );
  for (const ring of afterRings) {
    const before = beforeById.get(ring.id);
    if (!before) {
      throw new Error(`rotation habitability lost ${ring.id}`);
    }
    const hazardPairs = [
      [
        gravityHabitabilityHazard(before),
        gravityHabitabilityHazard(ring),
      ],
      [
        vibrationHabitabilityHazard(before),
        vibrationHabitabilityHazard(ring),
      ],
    ] as const;
    const newlyCrossed = hazardPairs
      .map(([previous, current]) => {
        if (
          current === null ||
          (previous !== null &&
            previous.family === current.family &&
            previous.rank >= current.rank)
        ) {
          return null;
        }
        return current;
      })
      .filter(
        (
          hazard,
        ): hazard is RotationHabitabilityHazard =>
          hazard !== null,
      );
    if (newlyCrossed.length === 0) continue;
    const targetPassengerIds = awakePassengersInRing(ring.id).map(
      (person) => person.id,
    );
    if (targetPassengerIds.length === 0) continue;
    for (const hazard of newlyCrossed) {
      applyIncidentToRoster({
        eventId:
          `rotation-habitability:${ring.id}:${hazard.code}`,
        eventType: `rotation-${hazard.code}`,
        summary: hazard.summary,
        targetPassengerIds,
        healthImpact: hazard.healthImpact,
        psychologyImpact: hazard.psychologyImpact,
        experienceImpact: hazard.experienceImpact,
        valence: hazard.valence,
        salience: hazard.salience,
        confidence: 0.98,
      });
    }
  }
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
  for (const breach of compartments.listBreaches()) {
    compartments.removeBreach(breach.id);
    hullConsequence.clear(breach.id);
  }
  if (areaSquareMeters > 0) {
    compartments.upsertBreach({
      id: "breach:force-equivalent",
      zoneId: "A-18",
      areaSquareMeters,
      dischargeCoefficient: 0.72,
    });
    registerHullBreachConsequence({
      breachId: "breach:force-equivalent",
      zoneId: "A-18",
      areaSquareMeters,
    });
  }
  syncHullThrustDerates();
}

function projectedNumericValue(
  before: number,
  operation: InterventionOperation,
): number | null {
  if (typeof operation.value !== "number") return null;
  switch (operation.operation) {
    case "set":
      return operation.value;
    case "add":
      return before + operation.value;
    case "multiply":
      return before * operation.value;
  }
}

function normalizeDirectForceBalance(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  if (request.metadata?.mode !== "direct-force") {
    return request;
  }
  const state = engine.getState();
  const atmosphere = compartments.getAggregateState();
  let massKg = 0;
  let energyJ = 0;
  let recalculated = false;

  for (const operation of request.operations) {
    if (
      operation.path === "thermal.coolantTemperatureK"
    ) {
      const after = projectedNumericValue(
        state.thermal.coolantTemperatureK,
        operation,
      );
      if (after !== null) {
        energyJ += cooling
          .listNodes()
          .filter(
            (node) =>
              node.id === "coolant-a" ||
              node.id === "coolant-b",
          )
          .reduce(
            (total, node) =>
              total +
              (after - node.temperatureK) *
                node.heatCapacityJPerK,
            0,
          );
        recalculated = true;
      }
    } else if (
      operation.path.startsWith("atmosphere.gasesKg.")
    ) {
      const gas = operation.path.slice(
        "atmosphere.gasesKg.".length,
      ) as GasSpecies;
      const before = atmosphere.gasesKg[gas];
      const after =
        before === undefined
          ? null
          : projectedNumericValue(before, operation);
      if (after !== null) {
        const deltaMassKg = after - before;
        massKg += deltaMassKg;
        energyJ +=
          deltaMassKg *
          GAS_SENSIBLE_HEAT_J_PER_KG_K *
          atmosphere.averageTemperatureK;
        recalculated = true;
      }
    } else if (operation.path === "water.potableKg") {
      const after = projectedNumericValue(
        state.water.potableKg,
        operation,
      );
      if (after !== null) {
        massKg += after - state.water.potableKg;
        recalculated = true;
      }
    }
  }
  if (!recalculated) return request;

  return {
    ...request,
    declaredBalance: {
      ...request.declaredBalance,
      massKg,
      energyJ,
      note:
        "Authoritative runtime recomputation for direct stored-state override",
    },
  };
}

function applyWaterInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
): void {
  if (record.status !== "applied") return;
  const trippedProcessorId = waterProcessorTripTarget(request);
  if (trippedProcessorId !== null) {
    water.configureProcessor(trippedProcessorId, {
      condition: "stuck-off",
    });
    synchronizeWaterAggregate();
    return;
  }
  const faultedSpurId = waterSpurFaultTarget(request);
  if (faultedSpurId !== null) {
    const condition = request.metadata?.spurCondition;
    water.configureDistributionSpur(faultedSpurId, {
      condition:
        condition === "degraded" || condition === "stuck-closed"
          ? condition
          : "stuck-closed",
    });
    synchronizeWaterAggregate();
    return;
  }
  if (!request.operations.some((operation) => operation.path === "water.potableKg")) {
    return;
  }
  water.setTotalPotableInventoryKg(engine.getState().water.potableKg);
  synchronizeWaterAggregate();
}

function ringBearingDegradationTarget(
  request: ExternalInterventionRequest,
): RotationRingId | null {
  if (request.metadata?.eventType !== "ring-bearing-degradation") {
    return null;
  }
  if (request.metadata.mode !== "causal-event") {
    throw new Error(
      "ring-bearing-degradation must use causal-event mode",
    );
  }
  if (request.operations.length !== 0) {
    throw new Error(
      "ring-bearing-degradation cannot directly override stored state",
    );
  }
  const targetRingId = request.metadata.targetRingId;
  if (targetRingId !== "ring-a" && targetRingId !== "ring-b") {
    throw new Error(
      "ring-bearing-degradation requires targetRingId ring-a or ring-b",
    );
  }
  return targetRingId;
}

function normalizeRingBearingDegradation(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  const targetRingId = ringBearingDegradationTarget(request);
  if (targetRingId === null) return request;
  const ringLabel = targetRingId === "ring-a" ? "A 环" : "B 环";
  return {
    ...request,
    declaredBalance: {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        "Device-condition fault only; subsequent friction and heat remain inside the coupled ship system",
    },
    metadata: {
      ...request.metadata,
      targetRingId,
      effectSummary: `${ringLabel}机械轴承已进入退化工况；实际转速、振动、耗电与发热将由后续物理步进决定。`,
    },
  };
}

function airHandlerTripTarget(
  request: ExternalInterventionRequest,
): AirHandlerId | null {
  if (request.metadata?.eventType !== "air-handler-trip") {
    return null;
  }
  if (request.metadata.mode !== "causal-event") {
    throw new Error("air-handler-trip must use causal-event mode");
  }
  if (request.operations.length !== 0) {
    throw new Error(
      "air-handler-trip cannot directly override stored state",
    );
  }
  const targetAirHandlerId = request.metadata.targetAirHandlerId;
  if (
    targetAirHandlerId !== "air-handler-a" &&
    targetAirHandlerId !== "air-handler-b"
  ) {
    throw new Error(
      "air-handler-trip requires targetAirHandlerId air-handler-a or air-handler-b",
    );
  }
  return targetAirHandlerId;
}

function normalizeAirHandlerTrip(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  const targetAirHandlerId = airHandlerTripTarget(request);
  if (targetAirHandlerId === null) return request;
  const ringLabel =
    targetAirHandlerId === "air-handler-a" ? "A 环" : "B 环";
  return {
    ...request,
    declaredBalance: {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        "Device-condition fault only; subsequent circulation and carbon-dioxide evolution remain inside the coupled atmosphere system",
    },
    metadata: {
      ...request.metadata,
      targetAirHandlerId,
      effectSummary: `${ringLabel}空气处理机已跳停；实际风量归零，后续 CO₂ 与舱区混合变化由分舱物理继续演化。`,
    },
  };
}

function waterProcessorTripTarget(
  request: ExternalInterventionRequest,
): WaterProcessorId | null {
  if (request.metadata?.eventType !== "water-processor-trip") return null;
  if (request.metadata.mode !== "causal-event") {
    throw new Error("water-processor-trip must use causal-event mode");
  }
  if (request.operations.length !== 0) {
    throw new Error(
      "water-processor-trip cannot directly override stored state",
    );
  }
  const targetProcessorId = request.metadata.targetProcessorId;
  if (
    targetProcessorId !== "water-processor-a" &&
    targetProcessorId !== "water-processor-b"
  ) {
    throw new Error(
      "water-processor-trip requires targetProcessorId water-processor-a or water-processor-b",
    );
  }
  return targetProcessorId;
}

function waterSpurFaultTarget(
  request: ExternalInterventionRequest,
): WaterDistributionSpurId | null {
  if (request.metadata?.eventType !== "water-spur-fault") return null;
  if (request.metadata.mode !== "causal-event") {
    throw new Error("water-spur-fault must use causal-event mode");
  }
  if (request.operations.length !== 0) {
    throw new Error(
      "water-spur-fault cannot directly override stored state",
    );
  }
  const targetSpurId = request.metadata.targetSpurId;
  if (targetSpurId !== "water-spur-a" && targetSpurId !== "water-spur-b") {
    throw new Error(
      "water-spur-fault requires targetSpurId water-spur-a or water-spur-b",
    );
  }
  return targetSpurId;
}

function coolingSpurFaultTarget(
  request: ExternalInterventionRequest,
): HabitatThermalDeliverySpurId | null {
  if (request.metadata?.eventType !== "cooling-spur-fault") return null;
  if (request.metadata.mode !== "causal-event") {
    throw new Error("cooling-spur-fault must use causal-event mode");
  }
  if (request.operations.length !== 0) {
    throw new Error(
      "cooling-spur-fault cannot directly override stored state",
    );
  }
  const targetSpurId = request.metadata.targetSpurId;
  if (
    targetSpurId !== "cooling-spur-a" &&
    targetSpurId !== "cooling-spur-b"
  ) {
    throw new Error(
      "cooling-spur-fault requires targetSpurId cooling-spur-a or cooling-spur-b",
    );
  }
  return targetSpurId;
}

function normalizeWaterProcessorTrip(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  const targetProcessorId = waterProcessorTripTarget(request);
  if (targetProcessorId === null) return request;
  const ringLabel =
    targetProcessorId === "water-processor-a" ? "A 环" : "B 环";
  return {
    ...request,
    declaredBalance: {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        "Device-condition fault only; later wastewater throughput and inventories remain inside the coupled water network",
    },
    metadata: {
      ...request.metadata,
      targetProcessorId,
      effectSummary: `${ringLabel}水回收机已跳停；后续废水积累、净水消耗与浓盐水产物由水网络继续演化。`,
    },
  };
}

function normalizeWaterSpurFault(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  const targetSpurId = waterSpurFaultTarget(request);
  if (targetSpurId === null) return request;
  const ringLabel = targetSpurId === "water-spur-a" ? "A 环" : "B 环";
  const condition =
    request.metadata?.spurCondition === "degraded"
      ? "degraded"
      : "stuck-closed";
  const conditionLabel =
    condition === "degraded" ? "降级（约半开）" : "卡死关闭";
  return {
    ...request,
    declaredBalance: {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        "Distribution-spur condition only; undelivered demand is ledgered without inventing phantom mass",
    },
    metadata: {
      ...request.metadata,
      targetSpurId,
      spurCondition: condition,
      effectSummary: `${ringLabel}配水支路已${conditionLabel}；净水罐库存不变，未送达需求记入 undeliveredPotableKg。`,
    },
  };
}

function normalizeCoolingSpurFault(
  request: ExternalInterventionRequest,
): ExternalInterventionRequest {
  const targetSpurId = coolingSpurFaultTarget(request);
  if (targetSpurId === null) return request;
  const ringLabel = targetSpurId === "cooling-spur-a" ? "A 环" : "B 环";
  const condition =
    request.metadata?.spurCondition === "degraded"
      ? "degraded"
      : "stuck-closed";
  const conditionLabel =
    condition === "degraded" ? "降级（约半开）" : "卡死关闭";
  return {
    ...request,
    declaredBalance: {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note:
        "Habitat-thermal-delivery spur condition only; undelivered cooling demand is ledgered without inventing phantom heat",
    },
    metadata: {
      ...request.metadata,
      targetSpurId,
      spurCondition: condition,
      effectSummary: `${ringLabel}热送达支路已${conditionLabel}；舱热泵能力不变，未送达冷却需求记入 undeliveredHabitatCoolingJ。`,
    },
  };
}

function applyIncidentToRoster(
  input: ApplyPassengerIncidentInput,
): void {
  passengers.applyPassengerIncident(input);
  synchronizePopulationAggregate();
  synchronizeCompartmentOccupants();
}

function awakePassengersInZone(zoneId: ZoneId) {
  return passengers
    .getAllPassengers()
    .filter(
      (person) =>
        person.lifeState === "awake" &&
        currentZoneForPerson(person) === zoneId,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

interface CompartmentHabitabilityIncident
  extends Omit<
    ApplyPassengerIncidentInput,
    "eventId" | "targetPassengerIds"
  > {
  family: PassengerEnvironmentalHazardFamily;
  tier: Exclude<PassengerEnvironmentalHazardTier, 0>;
}

function passengerEnvironmentalHazardTier(
  truth: ZoneTruth,
  family: PassengerEnvironmentalHazardFamily,
): PassengerEnvironmentalHazardTier {
  switch (family) {
    case "low-pressure":
      return truth.pressurePa < 50_000
        ? 2
        : truth.pressurePa < 75_000
          ? 1
          : 0;
    case "hypoxia": {
      const oxygenPartialPressurePa =
        truth.partialPressuresPa.oxygen;
      return oxygenPartialPressurePa < 14_000
        ? 2
        : oxygenPartialPressurePa < 18_000
          ? 1
          : 0;
    }
    case "high-carbon-dioxide": {
      const carbonDioxidePartialPressurePa =
        truth.partialPressuresPa.carbonDioxide;
      return carbonDioxidePartialPressurePa > 3_000
        ? 2
        : carbonDioxidePartialPressurePa > 1_500
          ? 1
          : 0;
    }
    case "cold":
      return truth.temperatureK < 273.15
        ? 2
        : truth.temperatureK < 283.15
          ? 1
          : 0;
    case "heat":
      return truth.temperatureK > 313.15
        ? 2
        : truth.temperatureK > 303.15
          ? 1
          : 0;
  }
}

function compartmentHabitabilityIncident(
  zoneId: ZoneId,
  family: PassengerEnvironmentalHazardFamily,
  tier: Exclude<PassengerEnvironmentalHazardTier, 0>,
): CompartmentHabitabilityIncident {
  const common = {
    family,
    tier,
    confidence: 0.99,
  } as const;
  if (family === "low-pressure") {
    return tier === 1
      ? {
          ...common,
          eventType: "compartment-low-pressure-exposure",
          summary:
            `${zoneId} 压力区进入低压暴露带；耳压、呼吸负荷与应急行动限制已被乘员直接感知。`,
          healthImpact: {
            physical: -0.004,
            resilience: -0.002,
          },
          psychologyImpact: {
            stability: -0.015,
            stress: 0.03,
          },
          experienceImpact: {
            safety: -0.04,
            comfort: -0.025,
          },
          valence: -0.46,
          salience: 0.7,
        }
      : {
          ...common,
          eventType: "compartment-severe-low-pressure-exposure",
          summary:
            `${zoneId} 压力区进一步降至严重低压带；乘员承受急性缺压伤害风险并执行紧急自救程序。`,
          healthImpact: {
            physical: -0.055,
            resilience: -0.025,
            chronicRisk: 0.008,
          },
          psychologyImpact: {
            stability: -0.055,
            stress: 0.12,
          },
          experienceImpact: {
            safety: -0.13,
            comfort: -0.08,
            trust: -0.01,
          },
          valence: -0.88,
          salience: 0.96,
        };
  }
  if (family === "hypoxia") {
    return tier === 1
      ? {
          ...common,
          eventType: "compartment-hypoxia-exposure",
          summary:
            `${zoneId} 氧分压跌入低氧暴露带；清醒乘员出现呼吸急促、注意力下降等早期症状。`,
          healthImpact: {
            physical: -0.006,
            resilience: -0.003,
          },
          psychologyImpact: {
            stability: -0.012,
            stress: 0.025,
          },
          experienceImpact: {
            safety: -0.035,
            comfort: -0.02,
          },
          valence: -0.5,
          salience: 0.72,
        }
      : {
          ...common,
          eventType: "compartment-severe-hypoxia-exposure",
          summary:
            `${zoneId} 氧分压进一步跌入严重低氧带；意识与运动能力面临急性损伤风险。`,
          healthImpact: {
            physical: -0.07,
            resilience: -0.035,
            chronicRisk: 0.012,
          },
          psychologyImpact: {
            stability: -0.065,
            stress: 0.14,
          },
          experienceImpact: {
            safety: -0.15,
            comfort: -0.08,
            trust: -0.01,
          },
          valence: -0.92,
          salience: 0.98,
        };
  }
  if (family === "high-carbon-dioxide") {
    return tier === 1
      ? {
          ...common,
          eventType: "compartment-carbon-dioxide-exposure",
          summary:
            `${zoneId} 二氧化碳分压进入高暴露带；乘员出现头痛、困倦和空气质量不适。`,
          healthImpact: { physical: -0.003 },
          psychologyImpact: {
            stability: -0.01,
            stress: 0.025,
          },
          experienceImpact: {
            safety: -0.02,
            comfort: -0.03,
          },
          valence: -0.4,
          salience: 0.62,
        }
      : {
          ...common,
          eventType: "compartment-severe-carbon-dioxide-exposure",
          summary:
            `${zoneId} 二氧化碳分压升至严重暴露带；呼吸性酸中毒与认知失能风险显著上升。`,
          healthImpact: {
            physical: -0.04,
            resilience: -0.02,
            chronicRisk: 0.005,
          },
          psychologyImpact: {
            stability: -0.05,
            stress: 0.11,
          },
          experienceImpact: {
            safety: -0.09,
            comfort: -0.1,
          },
          valence: -0.82,
          salience: 0.92,
        };
  }
  if (family === "cold") {
    return tier === 1
      ? {
          ...common,
          eventType: "compartment-cold-exposure",
          summary:
            `${zoneId} 温度跌入寒冷暴露带；清醒乘员的活动舒适度和精细操作能力下降。`,
          healthImpact: {
            physical: -0.002,
            resilience: -0.004,
          },
          psychologyImpact: {
            stability: -0.008,
            stress: 0.015,
          },
          experienceImpact: {
            safety: -0.015,
            comfort: -0.04,
          },
          valence: -0.36,
          salience: 0.58,
        }
      : {
          ...common,
          eventType: "compartment-severe-cold-exposure",
          summary:
            `${zoneId} 温度进一步跌入严重寒冷带；失温与冻伤风险迫使乘员执行紧急保温程序。`,
          healthImpact: {
            physical: -0.035,
            resilience: -0.025,
            chronicRisk: 0.006,
          },
          psychologyImpact: {
            stability: -0.04,
            stress: 0.08,
          },
          experienceImpact: {
            safety: -0.07,
            comfort: -0.12,
          },
          valence: -0.78,
          salience: 0.9,
        };
  }
  return tier === 1
    ? {
        ...common,
        eventType: "compartment-heat-exposure",
        summary:
          `${zoneId} 温度升入高温暴露带；清醒乘员出现热不适、疲劳与工作效率下降。`,
        healthImpact: {
          physical: -0.003,
          resilience: -0.003,
        },
        psychologyImpact: {
          stability: -0.01,
          stress: 0.02,
        },
        experienceImpact: {
          safety: -0.015,
          comfort: -0.05,
        },
        valence: -0.4,
        salience: 0.6,
      }
    : {
        ...common,
        eventType: "compartment-severe-heat-exposure",
        summary:
          `${zoneId} 温度进一步升入严重高温带；热衰竭与器官损伤风险迫使乘员紧急避险。`,
        healthImpact: {
          physical: -0.045,
          resilience: -0.025,
          chronicRisk: 0.007,
        },
        psychologyImpact: {
          stability: -0.045,
          stress: 0.095,
        },
        experienceImpact: {
          safety: -0.08,
          comfort: -0.13,
        },
        valence: -0.82,
        salience: 0.92,
      };
}

function validatePassengerEnvironmentalExposureStates(
  states: readonly PassengerEnvironmentalExposureState[],
  network: CompartmentAtmosphereNetwork,
): void {
  const expectedCount =
    BASELINE_ZONE_IDS.length *
    PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES.length;
  if (states.length !== expectedCount) {
    throw new Error(
      `passenger environmental exposure state must contain exactly ${expectedCount} entries`,
    );
  }
  let index = 0;
  for (const zoneId of BASELINE_ZONE_IDS) {
    const truth = network.getZoneTruth(zoneId);
    for (const family of PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES) {
      const state = states[index];
      const keys =
        state && typeof state === "object"
          ? Object.keys(state).sort()
          : [];
      if (
        !state ||
        keys.join(",") !==
          "currentTier,episode,family,zoneId" ||
        state.zoneId !== zoneId ||
        state.family !== family ||
        !Number.isSafeInteger(state.currentTier) ||
        state.currentTier < 0 ||
        state.currentTier > 2 ||
        !Number.isSafeInteger(state.episode) ||
        state.episode < 0 ||
        (state.currentTier > 0 && state.episode === 0)
      ) {
        throw new Error(
          `passenger environmental exposure entry ${index} is malformed or out of fixed order`,
        );
      }
      const expectedTier = passengerEnvironmentalHazardTier(
        truth,
        family,
      );
      if (state.currentTier !== expectedTier) {
        throw new Error(
          `passenger environmental exposure ${zoneId}/${family} does not match compartment truth`,
        );
      }
      index += 1;
    }
  }
}

function updatePassengerEnvironmentalExposures(
  deltaSeconds = 0,
): void {
  const doseByKey = new Map(
    survivalZoneDoses.map((dose) => [
      `${dose.zoneId}/${dose.family}`,
      dose,
    ]),
  );
  const nextDoses: ZoneHazardDose[] = [];
  const activeExposures: Array<{
    zoneId: ZoneId;
    family: PassengerEnvironmentalHazardFamily;
    tier: Exclude<PassengerEnvironmentalHazardTier, 0>;
    episode: number;
  }> = [];
  const continuousDoseHits: Array<{
    zoneId: ZoneId;
    family: PassengerEnvironmentalHazardFamily;
    physicalDelta: number;
    stressDelta: number;
  }> = [];

  for (const zoneId of BASELINE_ZONE_IDS) {
    const truth = compartments.getZoneTruth(zoneId);
    for (const family of PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES) {
      const previous = doseByKey.get(`${zoneId}/${family}`);
      if (!previous) {
        throw new Error(
          `survival zone dose state lost ${zoneId}/${family}`,
        );
      }
      const nextTier = passengerEnvironmentalHazardTier(
        truth,
        family,
      );
      const integrated = integrateHazardDose({
        previous,
        nextTier,
        deltaSeconds,
      });
      nextDoses.push(integrated.dose);
      if (nextTier > 0) {
        activeExposures.push({
          zoneId,
          family,
          tier: nextTier as Exclude<
            PassengerEnvironmentalHazardTier,
            0
          >,
          episode: integrated.dose.episode,
        });
      }
      if (
        deltaSeconds > 0 &&
        (integrated.physicalDelta !== 0 ||
          integrated.stressDelta !== 0)
      ) {
        continuousDoseHits.push({
          zoneId,
          family,
          physicalDelta: integrated.physicalDelta,
          stressDelta: integrated.stressDelta,
        });
      }
    }
  }

  survivalZoneDoses = nextDoses;
  syncExposuresFromSurvivalDoses();

  const awakePassengersByZone = new Map<ZoneId, Passenger[]>(
    BASELINE_ZONE_IDS.map((zoneId) => [zoneId, []]),
  );
  for (const person of passengers.getAllPassengers()) {
    if (person.lifeState !== "awake") continue;
    awakePassengersByZone.get(currentZoneForPerson(person))!.push(person);
  }

  if (activeExposures.length > 0) {
    for (const exposure of activeExposures) {
      const awakeInZone =
        awakePassengersByZone.get(exposure.zoneId)!;
      if (awakeInZone.length === 0) continue;
      // Episode memory remains for logging; continuous dose owns health drain.
      for (let tier = 1; tier <= exposure.tier; tier += 1) {
        const eventId =
          `compartment-exposure:${exposure.zoneId}:${exposure.family}:` +
          `episode-${exposure.episode}:tier-${tier}`;
        const targetPassengerIds = awakeInZone
          .filter(
            (person) =>
              !person.memories.some(
                (memory) =>
                  memory.incident?.eventId === eventId,
              ),
          )
          .map((person) => person.id);
        if (targetPassengerIds.length === 0) continue;
        const incident = compartmentHabitabilityIncident(
          exposure.zoneId,
          exposure.family,
          tier as Exclude<PassengerEnvironmentalHazardTier, 0>,
        );
        applyIncidentToRoster({
          ...incident,
          // Keep psychology / experience from the episode crossing; physical
          // damage is applied continuously via survival dose below.
          healthImpact: {},
          eventId,
          targetPassengerIds,
        });
      }
    }
  }

  if (continuousDoseHits.length > 0 && deltaSeconds > 0) {
    for (const hit of continuousDoseHits) {
      const targets = awakePassengersByZone
        .get(hit.zoneId)!
        .map((person) => person.id);
      if (targets.length === 0) continue;
      // Medical zones: first-aid / monitoring buffer, not healing magic.
      const doseMultiplier =
        zoneCatalogEntry(hit.zoneId).role === "medical"
          ? MEDICAL_ZONE_SURVIVAL_DOSE_MULTIPLIER
          : 1;
      applyContinuousRosterDeltas(targets, {
        physical: hit.physicalDelta * doseMultiplier,
        stress: hit.stressDelta * doseMultiplier,
      });
    }
  }

  validatePassengerEnvironmentalExposureStates(
    passengerEnvironmentalExposures,
    compartments,
  );
}

function applySurvivalRationAndStarvation(deltaSeconds: number): void {
  const awake = passengers
    .getAllPassengers()
    .filter((person) => person.lifeState === "awake");
  const awakeCount = awake.length;
  const foodBefore = engine.getState().consumables.foodDryKg;
  const rationed = applyRationAndStarvation({
    foodDryKg: foodBefore,
    awakeCount,
    deltaSeconds,
    kgPerAwakePersonDay:
      captainOperations.getRationKgPerAwakePersonDay(),
    ledger: survivalLedger,
  });
  survivalLedger = rationed.ledger;
  const demanded = foodBefore - rationed.foodDryKg;
  if (demanded > 0) {
    const consumed = engine.consumeFoodRationKg(demanded);
    if (Math.abs(consumed - demanded) > 1e-9) {
      throw new Error(
        "survival ration food debit diverged from ledger demand",
      );
    }
  }
  const starvationDelta = rationed.starvationPhysicalDelta;
  if (starvationDelta !== 0 && awakeCount > 0) {
    applyContinuousRosterDeltas(
      awake.map((person) => person.id),
      { physical: starvationDelta },
    );
  }
}

function buildProceduralInterventionRequest(
  event: ProceduralWorldEvent,
): ExternalInterventionRequest | null {
  const eventType = event.interventionEventType;
  if (!eventType) return null;
  const common = {
    id: `procedural:${event.id}`,
    actor: "environment:procedural",
    reason: event.message,
    metadata: {
      mode: "causal-event" as const,
      eventType,
      sourceKnownToAi: false,
      proceduralEventId: event.id,
      proceduralEventType: event.type,
    },
  };
  switch (eventType) {
    case "micrometeoroid":
      // ~φ7.6 mm inner puncture; ~few-mm grain @ ~20 km/s caught mostly by Whipple bumper.
      return {
        ...common,
        metadata: {
          ...common.metadata,
          targetZoneId: "A-05",
        },
        operations: [
          {
            operation: "add",
            path: "atmosphere.leakAreaSquareMeters",
            value: 0.000045,
          },
        ],
        declaredBalance: {
          massKg: -0.025,
          energyJ: 25_000,
          linearMomentumKgMPerSecond: [12, -2.4, 0.9],
          angularMomentumKgM2PerSecond: [0, 280, -740],
          note: "~φ7.6 mm inner puncture (4.5e-5 m²); ~25 g bumper ejecta + minor pressure-wall punch-out; ~25 kJ few-mm grain @ ~20 km/s mostly caught by Whipple shield",
        },
      };
    case "coolant-pump-seizure": {
      const breachRings = new Set(
        compartments
          .listBreaches()
          .map((breach) =>
            breach.zoneId.startsWith("B-") ? "b" : "a",
          ),
      );
      const messagePrefersB = /[Bb]\s*泵|回路\s*[Bb]/.test(event.message);
      const targetPumpId =
        breachRings.has("b") && !breachRings.has("a")
          ? "pump-b"
          : breachRings.has("a") && !breachRings.has("b")
            ? "pump-a"
            : messagePrefersB
              ? "pump-b"
              : "pump-a";
      return {
        ...common,
        metadata: {
          ...common.metadata,
          targetPumpId,
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Topology fault; subsequent waste heat remains in the closed ship system",
        },
      };
    }
    case "sensor-drift":
      return {
        ...common,
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Atmosphere sensor condition fault; readings degrade without changing zone truth",
        },
      };
    case "stellar-flare":
      return {
        ...common,
        operations: [
          {
            operation: "multiply",
            path: "environment.radiationDoseRateMilliSievertsPerHour",
            value: 180,
          },
          {
            operation: "multiply",
            path: "environment.chargedParticleFluxPerSquareMeterSecond",
            value: 2_400,
          },
          {
            operation: "add",
            path: "environment.stellarIrradianceWattsPerSquareMeter",
            value: 160,
          },
        ],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Changes explicit external radiation and particle-flux boundaries; future deposited energy is integrated by downstream solvers",
        },
      };
    case "power-fluctuation": {
      const targets = resolvePowerFluctuationTargets(event.message);
      return {
        ...common,
        metadata: {
          ...common.metadata,
          ...targets,
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Electrical topology / sensor fault; lasting derate or trip remains until maintenance reset",
        },
      };
    }
    case "hibernation-complication": {
      const targetLoadId = /hibernation-b|[Bb]\s*路休眠|馈线\s*B/.test(
        event.message,
      )
        ? "hibernation-b"
        : "hibernation-a";
      return {
        ...common,
        metadata: {
          ...common.metadata,
          targetLoadId,
        },
        operations: [],
        declaredBalance: {
          massKg: 0,
          energyJ: 0,
          linearMomentumKgMPerSecond: [0, 0, 0],
          angularMomentumKgM2PerSecond: [0, 0, 0],
          note: "Hibernation feeder protection trip; local ride-through reserve covers until restored",
        },
      };
    }
    default:
      return null;
  }
}

function resolvePowerFluctuationTargets(message: string): {
  targetSensorId?: string;
  targetBatteryId?: ElectricalBatteryId;
  targetReactorId?: FusionReactorId;
  powerAction: "battery-degrade" | "reactor-derate" | "reactor-trip";
} {
  if (/电池组\s*A|battery-a|荷电状态/.test(message)) {
    return {
      targetSensorId: "sensor:battery-a:batteryStateOfChargeFraction",
      targetBatteryId: "battery-a",
      powerAction: "battery-degrade",
    };
  }
  if (/聚变模块\s*2|fusion-2|保护已切除/.test(message)) {
    return {
      targetSensorId: "sensor:fusion-2:reactorOutputKw",
      targetReactorId: "fusion-2",
      powerAction: "reactor-trip",
    };
  }
  // Default / B-bus voltage disturbance → degrade bus-b voltage sensor + derate fusion-3.
  return {
    targetSensorId: "sensor:bus-b:voltageV",
    targetReactorId: "fusion-3",
    powerAction: "reactor-derate",
  };
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
  const eventType = request.metadata?.eventType;
  if (eventType === "air-handler-trip") {
    const targetAirHandlerId = airHandlerTripTarget(request);
    if (targetAirHandlerId === null) {
      throw new Error("air-handler-trip lost its validated target");
    }
    compartments.configureAirHandler(targetAirHandlerId, {
      condition: "stuck-off",
    });
  }
  if (eventType === "sensor-drift") {
    const candidates = compartments
      .listSensors()
      .filter((sensor) => sensor.condition === "nominal");
    let digest = 0;
    for (let index = 0; index < record.id.length; index += 1) {
      digest = (digest + record.id.charCodeAt(index) * (index + 1)) >>> 0;
    }
    const count = Math.min(3, Math.max(1, 1 + (digest % 3)));
    for (const sensor of candidates.slice(0, count)) {
      compartments.configureSensor(sensor.id, {
        condition: "degraded",
        noiseStandardDeviation: Math.max(
          sensor.noiseStandardDeviation * 4,
          0.05,
        ),
        driftPerSecond: Math.max(
          Math.abs(sensor.driftPerSecond) * 8,
          0.002,
        ),
      });
    }
  }
  if (eventType === "micrometeoroid") {
    const metadataTarget = request.metadata?.targetZoneId;
    const targetZoneId: ZoneId =
      typeof metadataTarget === "string" &&
      (BASELINE_ZONE_IDS as readonly string[]).includes(metadataTarget)
        ? (metadataTarget as ZoneId)
        : ("A-05" as ZoneId);
    const areaOperation = record.operations.find(
      (operation) =>
        operation.path === "atmosphere.leakAreaSquareMeters",
    );
    const previousArea =
      typeof areaOperation?.before === "number"
        ? areaOperation.before
        : compartments.getAggregateState().leakAreaSquareMeters;
    const nextArea =
      typeof areaOperation?.after === "number"
        ? areaOperation.after
        : previousArea;
    const newBreachArea = Math.max(0, nextArea - previousArea);
    if (newBreachArea > 0) {
      const breachId = `breach:micrometeoroid:${record.sequence}`;
      compartments.upsertBreach({
        id: breachId,
        zoneId: targetZoneId,
        areaSquareMeters: newBreachArea,
        dischargeCoefficient: 0.72,
      });
      registerHullBreachConsequence({
        breachId,
        zoneId: targetZoneId,
        areaSquareMeters: newBreachArea,
      });
      syncHullThrustDerates();
      const exposedPassengers = awakePassengersInZone(targetZoneId).slice(
        0,
        3,
      );
      if (exposedPassengers.length > 0) {
        applyIncidentToRoster({
          eventId: `${record.id}:${targetZoneId}-impact`,
          eventType: "micrometeoroid-compartment-impact",
          summary:
            `${targetZoneId} 压力区遭受微流星体贯穿冲击、瞬态压降与碎屑暴露。`,
          targetPassengerIds: exposedPassengers.map(
            (person) => person.id,
          ),
          healthImpact: {
            physical: -0.04,
            resilience: -0.015,
          },
          psychologyImpact: {
            stability: -0.05,
            stress: 0.12,
          },
          experienceImpact: {
            safety: -0.14,
            comfort: -0.05,
            trust: -0.02,
          },
          valence: -0.85,
          salience: 0.94,
          confidence: 0.96,
        });
      }
    }
  }

  if (eventType === "passenger-emergency") {
    const requestedPassengerId =
      typeof request.metadata?.targetPassengerId === "string"
        ? request.metadata.targetPassengerId
        : null;
    const requestedPassenger = requestedPassengerId
      ? passengers
          .getAllPassengers()
          .find(
            (person) =>
              person.id === requestedPassengerId &&
              person.lifeState === "awake",
          )
      : undefined;
    const target =
      requestedPassenger ??
      passengers
        .getKeyLlmPassengers()
        .find((person) => person.lifeState === "awake") ??
      passengers
        .getAllPassengers()
        .find((person) => person.lifeState === "awake");
    if (!target) {
      throw new Error(
        "passenger emergency requires at least one awake person",
      );
    }
    applyIncidentToRoster({
      eventId: `${record.id}:medical-emergency`,
      eventType: "passenger-medical-emergency",
      summary:
        "乘员出现突发循环系统急症，医疗舱已接收真实个体病例。",
      targetPassengerIds: [target.id],
      healthImpact: {
        physical: -0.18,
        resilience: -0.05,
        chronicRisk: 0.08,
      },
      psychologyImpact: {
        stability: -0.08,
        stress: 0.22,
      },
      experienceImpact: {
        safety: -0.09,
        comfort: -0.14,
        trust: -0.03,
      },
      valence: -0.8,
      salience: 0.9,
      confidence: 1,
    });
  }

  const directForce = request.metadata?.mode === "direct-force";
  for (const operation of record.operations) {
    if (
      operation.path.startsWith("atmosphere.gasesKg.") &&
      typeof operation.after === "number"
    ) {
      const gas = operation.path.slice(
        "atmosphere.gasesKg.".length,
      ) as GasSpecies;
      compartments.setTotalGasMass(gas, operation.after);
    } else if (
      directForce &&
      operation.path === "atmosphere.leakAreaSquareMeters" &&
      typeof operation.after === "number"
    ) {
      replaceEquivalentBreachArea(operation.after);
    }
  }
  synchronizeAtmosphereAggregate(capturedCarbonDioxideTotal());
}

function applyCoolingInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
): void {
  const eventType = request.metadata?.eventType;
  if (eventType === "coolant-pump-seizure") {
    const requestedPumpId =
      request.metadata?.targetPumpId === "pump-b"
        ? "pump-b"
        : "pump-a";
    cooling.configurePump(requestedPumpId, {
      condition: "stuck-off",
      commandedSpeedFraction: 0,
    });
  }

  const faultedCoolingSpurId = coolingSpurFaultTarget(request);
  if (faultedCoolingSpurId !== null) {
    const condition = request.metadata?.spurCondition;
    cooling.configureHabitatThermalDeliverySpur(faultedCoolingSpurId, {
      condition:
        condition === "degraded" || condition === "stuck-closed"
          ? condition
          : "stuck-closed",
    });
  }

  if (eventType === "stellar-flare") {
    const irradianceOperation = record.operations.find(
      (operation) =>
        operation.path ===
        "environment.stellarIrradianceWattsPerSquareMeter",
    );
    if (
      typeof irradianceOperation?.before === "number" &&
      typeof irradianceOperation.after === "number"
    ) {
      const absorbedPowerDeltaW =
        (irradianceOperation.after -
          irradianceOperation.before) *
        28;
      const source = cooling.listHeatSources()[0];
      cooling.configureHeatSource(source.id, {
        thermalPowerW: Math.max(
          0,
          source.thermalPowerW + absorbedPowerDeltaW,
        ),
      });
    }
  }

  if (request.metadata?.mode === "direct-force") {
    const temperatureOperation = record.operations.find(
      (operation) =>
        operation.path === "thermal.coolantTemperatureK",
    );
    if (typeof temperatureOperation?.after === "number") {
      cooling.setNodeTemperatures([
        {
          nodeId: "coolant-a",
          temperatureK: temperatureOperation.after,
        },
        {
          nodeId: "coolant-b",
          temperatureK: temperatureOperation.after,
        },
      ]);
    }
  }
  synchronizeThermalAggregate();
}

function applyElectricalInterventionEffects(
  request: ExternalInterventionRequest,
  record: ExternalInterventionRecord,
): void {
  const eventType = request.metadata?.eventType;
  if (eventType === "fusion-reactor-trip") {
    const requestedReactorId =
      typeof request.metadata?.targetReactorId === "string"
        ? request.metadata.targetReactorId
        : "fusion-1";
    const reactor = electrical
      .listReactors()
      .find(
        (candidate) => candidate.id === requestedReactorId,
      );
    if (!reactor) {
      throw new Error(
        `unknown fusion reactor ${requestedReactorId}`,
      );
    }
    electrical.tripReactor(
      reactor.id as FusionReactorId,
      request.reason,
    );
  }

  if (eventType === "power-fluctuation") {
    const targetSensorId =
      typeof request.metadata?.targetSensorId === "string"
        ? request.metadata.targetSensorId
        : null;
    if (targetSensorId) {
      const sensor = electrical
        .listSensors()
        .find((candidate) => candidate.id === targetSensorId);
      if (sensor && sensor.condition === "nominal") {
        electrical.configureSensor(sensor.id, {
          condition: "degraded",
          noiseStandardDeviation: Math.max(
            sensor.noiseStandardDeviation * 4,
            0.05,
          ),
          driftPerSecond: Math.max(
            Math.abs(sensor.driftPerSecond) * 8,
            0.002,
          ),
        });
      }
    }

    const powerAction =
      typeof request.metadata?.powerAction === "string"
        ? request.metadata.powerAction
        : "reactor-derate";
    if (powerAction === "battery-degrade") {
      const batteryId =
        typeof request.metadata?.targetBatteryId === "string"
          ? (request.metadata.targetBatteryId as ElectricalBatteryId)
          : "battery-a";
      electrical.setBatteryFault(batteryId, "degraded", request.reason);
    } else if (powerAction === "reactor-trip") {
      const reactorId =
        typeof request.metadata?.targetReactorId === "string"
          ? (request.metadata.targetReactorId as FusionReactorId)
          : "fusion-2";
      const reactor = electrical
        .listReactors()
        .find((candidate) => candidate.id === reactorId);
      if (reactor && reactor.condition === "nominal") {
        electrical.tripReactor(reactorId, request.reason);
      }
    } else {
      const reactorId =
        typeof request.metadata?.targetReactorId === "string"
          ? (request.metadata.targetReactorId as FusionReactorId)
          : "fusion-3";
      const reactor = electrical
        .listReactors()
        .find((candidate) => candidate.id === reactorId);
      if (
        reactor &&
        reactor.condition === "nominal" &&
        reactor.mode === "online"
      ) {
        const deratedTargetKw = Math.max(
          0,
          Math.min(reactor.ratedOutputKw, reactor.targetOutputKw * 0.85),
        );
        electrical.executeControlCommand({
          type: "set-reactor-target",
          reactorId,
          targetOutputKw: deratedTargetKw,
        });
      }
    }
  }

  if (eventType === "hibernation-complication") {
    const targetLoadId =
      request.metadata?.targetLoadId === "hibernation-b"
        ? "hibernation-b"
        : "hibernation-a";
    const load = electrical.getLoad(targetLoadId);
    const breaker = electrical
      .listBreakers()
      .find((candidate) => candidate.id === load.breakerId);
    if (breaker && breaker.condition === "nominal") {
      electrical.tripBreaker(load.breakerId, request.reason);
    }
  }

  if (request.metadata?.mode === "direct-force") {
    const generationOperation = record.operations.find(
      (operation) => operation.path === "power.generationKw",
    );
    if (typeof generationOperation?.after === "number") {
      electrical.applyExternalGenerationPower(
        generationOperation.after,
        request.reason,
      );
    }
  }
  synchronizeElectricalAggregate();
}

function applyRotationInterventionEffects(
  request: ExternalInterventionRequest,
): void {
  const targetRingId = ringBearingDegradationTarget(request);
  if (targetRingId === null) return;
  rotation.configureRing(targetRingId, {
    bearing: { condition: "degraded" },
  });
}

function applyNavigationInterventionEffects(
  record: ExternalInterventionRecord,
): void {
  const linear =
    record.declaredBalance.linearMomentumKgMPerSecond;
  const angular =
    record.declaredBalance.angularMomentumKgM2PerSecond;
  if (
    linear.some((component) => component !== 0) ||
    angular.some((component) => component !== 0)
  ) {
    navigation.applyExternalMomentumImpulse(
      { x: linear[0], y: linear[1], z: linear[2] },
      { x: angular[0], y: angular[1], z: angular[2] },
    );
  }
}

function jumpInterlockFailures(
  requestedDistanceLightYears: number,
): string[] {
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

function selectMaintenanceCrew(assetId: MaintenanceAssetId) {
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

function selectMaintenanceCrewById(
  assetId: MaintenanceAssetId,
  passengerId: string,
) {
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

function scheduleIndividualHibernation(
  personId: string,
  action: "wake" | "hibernate",
): void {
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

function configureSensorPackageFrequency(
  packageId: Parameters<CaptainOperations["setSensorSampleInterval"]>[0],
  sampleIntervalSeconds: number,
): number {
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

function executeShipCommand(
  command: ShipOperationalCommand,
  executionId: string,
): ShipOperationalCommandResult {
  if (command.kind === "execute-jump") {
    const interlockFailures = jumpInterlockFailures(
      command.distanceLightYears,
    );
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
  }

  if (command.kind === "isolate-pressure-zone") {
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
  }

  if (command.kind === "schedule-thruster-pulse") {
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
  }

  if (command.kind === "schedule-thruster-maneuver") {
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
  }

  if (command.kind === "set-reactor-target") {
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
  }

  if (command.kind === "set-reactor-mode") {
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
  }

  if (command.kind === "set-cooling-pump-speed") {
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
  }

  if (command.kind === "set-electrical-load-enabled") {
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
  }

  if (command.kind === "set-electrical-breaker") {
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
  }

  if (command.kind === "set-battery-mode") {
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
  }

  if (command.kind === "set-habitat-ring-control") {
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
  }

  if (command.kind === "set-air-handler-control") {
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
  }

  if (command.kind === "set-water-processor-control") {
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
  }

  if (command.kind === "configure-water-distribution-spur") {
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
  }

  if (command.kind === "configure-habitat-thermal-delivery-spur") {
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
  }

  if (command.kind === "schedule-maintenance") {
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
      crew: selectMaintenanceCrew(command.assetId),
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
  }

  if (command.kind === "revise-mission") {
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
    // 目的地/起点命中星表时轻触校验：若 LLM 航距像 |dSol| 差，改用欧氏；自由文本仍放行。
    let totalDistanceLightYears = command.totalDistanceLightYears;
    let totalLegs = command.totalLegs;
    if (command.disposition !== "abandon") {
      const fromLabel =
        command.disposition === "return"
          ? currentMission.destination
          : currentMission.originalOrigin;
      const fromEntry = findStarCatalogEntry(fromLabel);
      const toEntry = findStarCatalogEntry(destination);
      if (fromEntry && toEntry && fromEntry.id !== toEntry.id) {
        const catalogDistanceLy = routeDistanceLy(fromEntry.id, toEntry.id);
        const naiveSolDelta = Math.abs(
          toEntry.distanceFromSolLy - fromEntry.distanceFromSolLy,
        );
        if (Math.abs(totalDistanceLightYears - naiveSolDelta) < 0.2) {
          totalDistanceLightYears = catalogDistanceLy;
        }
        totalLegs = Math.max(
          totalLegs,
          estimateMinLegs(totalDistanceLightYears),
        );
      }
    }
    const journey = engine.reviseJourneyPlan({
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
  }

  if (command.kind === "manage-department-order") {
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
  }

  if (command.kind === "publish-communication") {
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
  }

  if (command.kind === "file-passenger-grievance") {
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
  }

  if (command.kind === "manage-crew-assignment") {
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
  }

  if (command.kind === "manage-person") {
    const person = passengers.getPassenger(command.personId);
    if (command.action === "wake" || command.action === "hibernate") {
      scheduleIndividualHibernation(person.id, command.action);
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
  }

  if (command.kind === "manage-security") {
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
  }

  if (command.kind === "manage-logistics") {
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
  }

  if (command.kind === "set-compartment-connection") {
    const connection = compartments.configureConnection(command.connectionId, { commandedOpenFraction: command.commandedOpenFraction });
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${connection.id} 开度指令已设为 ${(connection.commandedOpenFraction * 100).toFixed(1)}%；实际开度仍受卡滞状态约束。` };
  }

  if (command.kind === "schedule-hull-repair") {
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
  }

  if (command.kind === "set-thermal-control") {
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
  }

  if (command.kind === "set-atmosphere-supply") {
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
  }

  if (command.kind === "set-oxygen-production") {
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
  }

  if (command.kind === "distribute-water") {
    if (command.action === "set-zone-allocation") {
      if (!command.zoneId) throw new Error("zone water allocation requires zoneId");
      const value = captainOperations.setWaterAllocation(command.zoneId, command.kgPerAwakePersonDay ?? NaN);
      return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${command.zoneId} 饮水额度已设为每名清醒人员每日 ${value.toFixed(2)} kg。` };
    }
    if (!command.fromRing || !command.toRing || command.massKg === undefined) throw new Error("water transfer requires both rings and massKg");
    water.transferPotableWater(command.fromRing, command.toRing, command.massKg);
    synchronizeWaterAggregate();
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${command.massKg.toFixed(2)} kg 净水已从 ${command.fromRing.toUpperCase()} 环转入 ${command.toRing.toUpperCase()} 环。` };
  }

  if (command.kind === "reset-protection") {
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
  }

  if (command.kind === "manage-maintenance-task") {
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
      ? selectMaintenanceCrewById(current.assetId, command.crewId)
      : selectMaintenanceCrewById(current.assetId, current.assignedCrewId);
    let robotId: MaintenanceRobotId | undefined;
    if (command.robotId !== undefined) {
      if (!(MAINTENANCE_ROBOT_IDS as readonly string[]).includes(command.robotId)) throw new Error(`unknown maintenance robot ${command.robotId}`);
      robotId = command.robotId as MaintenanceRobotId;
    }
    const task = maintenance.reassignTask({ taskId: command.taskId, crew, robotId });
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `维修任务 ${task.id} 已改派给 ${task.assignedCrewId}/${task.assignedRobotId}。` };
  }

  if (command.kind === "manage-sensor-operation") {
    if (command.action === "set-frequency") {
      const interval = configureSensorPackageFrequency(command.packageId, command.sampleIntervalSeconds ?? NaN);
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
  }

  if (command.kind === "manage-remote-asset") {
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
  }

  if (command.kind === "set-power-allocation") {
    const limit = captainOperations.setPowerAllocation(command.loadId, command.maximumDemandFraction);
    const load = electrical.getLoad(command.loadId);
    electrical.synchronizeLoadControllerDemandFraction(
      command.loadId,
      Math.min(load.controllerDemandFraction, limit),
    );
    synchronizeElectricalAggregate();
    return { kind: command.kind, actorAgentId: command.actorAgentId, summary: `${command.loadId} 最大需求份额已设为 ${(limit * 100).toFixed(1)}%；后续控制请求不会越过该上限。`, loadId: command.loadId };
  }

  if (command.kind !== "set-awake-target") {
    throw new Error(`unsupported ship command ${(command as ShipOperationalCommand).kind}`);
  }

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
