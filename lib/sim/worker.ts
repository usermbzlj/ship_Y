import {
  createBaselineShipState,
  SimulationEngine,
} from "./index.ts";
import {
  AIR_HANDLER_IDS,
  BASELINE_ZONE_IDS,
  COMPARTMENT_COUNT,
  CompartmentAtmosphereNetwork,
} from "./compartments.ts";
import {
  hibernationPowerBankForPodId,
  PassengerSimulation,
} from "./passengers.ts";
import {
  CoolingThermalNetwork,
} from "./cooling.ts";
import {
  DeterministicCommandBus,
} from "./command-bus.ts";
import { ShipElectricalNetwork } from "./electrical.ts";
import { RigidBodyNavigation } from "./navigation.ts";
import { CounterRotatingHabitat } from "./rotation.ts";
import {
  WATER_PROCESSOR_IDS,
  WaterRecoveryNetwork,
} from "./water.ts";
import {
  MAINTENANCE_ASSET_IDS,
  MAINTENANCE_ASSET_SPECS,
  MaintenanceNetwork,
} from "./maintenance.ts";
import type {
  AirHandlerId,
  CompartmentStepResult,
  GasSpecies,
  SensorQuality,
  ZoneId,
  ZoneTruth,
} from "./compartments";
import type {
  CoolingNetworkSnapshot,
} from "./cooling";
import type {
  ElectricalLoadId,
  ElectricalNetworkSnapshot,
  ElectricalSensorQuantity,
  ElectricalStepResult,
  FusionReactorId,
} from "./electrical";
import type {
  NavigationSensorQuantity,
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
  MaintenanceAssetId,
  MaintenanceConditionRecord,
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
  CompartmentZoneCondition,
  CompartmentZoneTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  FinalJourneyReport,
  NavigationTelemetry,
  PassengerEnvironmentalExposureState,
  PassengerEnvironmentalHazardFamily,
  PassengerEnvironmentalHazardTier,
  RotationTelemetry,
  RuntimeSimulationSnapshot,
  ShipOperationalCommand,
  ShipOperationalCommandResult,
  SimulationWorkerCommand,
  SimulationWorkerEvent,
  SimulationWorkerState,
} from "./protocol";

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

type ShipCommandActorId =
  | "captain"
  | "navigation"
  | "engineering"
  | "life-support"
  | "medical"
  | "passenger-affairs"
  | "security"
  | "passenger-service";
type ShipCommandRole =
  | "captain"
  | "navigation"
  | "engineering"
  | "medical"
  | "life-support"
  | "passenger-affairs"
  | "security"
  | "passenger-service";
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
          "schedule-maintenance",
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
          "schedule-maintenance",
        ],
      },
      { role: "medical", kinds: ["set-awake-target"] },
      {
        role: "life-support",
        kinds: [
          "isolate-pressure-zone",
          "set-air-handler-control",
          "set-water-processor-control",
        ],
      },
      {
        role: "passenger-affairs",
        kinds: [],
      },
      {
        role: "security",
        kinds: ["isolate-pressure-zone"],
      },
      {
        role: "passenger-service",
        kinds: [],
      },
    ],
    historyCapacity: 512,
  });
}

let commandBus = createCommandBus();
let highestDirective = "";
const MEDICAL_BATCH_LIMIT = 24;
const GAS_SENSIBLE_HEAT_J_PER_KG_K = 1_005;
const ELECTRICAL_COUPLING_INTERVAL_SECONDS = 60;
const CABIN_SENSIBLE_HEAT_W_PER_AWAKE_PERSON = 80;
const CABIN_HEAT_PUMP_LIFE_SUPPORT_POWER_SHARE = 0.05;
const CABIN_HEAT_PUMP_CARNOT_EFFICIENCY = 0.45;
const CABIN_HEAT_PUMP_MINIMUM_COP = 1.1;
const CABIN_HEAT_PUMP_MAXIMUM_COP = 6;
const JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K = 375;
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

let passengerEnvironmentalExposures =
  createPassengerEnvironmentalExposureStates();

const SENSOR_QUANTITIES = [
  "pressurePa",
  "temperatureK",
  "oxygenPartialPressurePa",
  "carbonDioxidePartialPressurePa",
] as const;

function sensorQualityOrOffline(
  quality: SensorQuality | undefined,
): SensorQuality {
  return quality ?? "offline";
}

function zoneCondition(
  observed: CompartmentZoneTelemetry["observed"],
  qualities: readonly SensorQuality[],
): CompartmentZoneCondition {
  const {
    pressurePa,
    temperatureK,
    oxygenPartialPressurePa,
    carbonDioxidePartialPressurePa,
  } = observed;
  if (
    pressurePa === null ||
    temperatureK === null ||
    oxygenPartialPressurePa === null ||
    carbonDioxidePartialPressurePa === null
  ) {
    return "offline";
  }
  if (
    pressurePa < 75_000 ||
    pressurePa > 120_000 ||
    temperatureK < 278.15 ||
    temperatureK > 313.15 ||
    oxygenPartialPressurePa < 16_000 ||
    carbonDioxidePartialPressurePa > 1_500
  ) {
    return "critical";
  }
  if (
    pressurePa < 90_000 ||
    pressurePa > 110_000 ||
    temperatureK < 285.15 ||
    temperatureK > 303.15 ||
    oxygenPartialPressurePa < 18_000 ||
    carbonDioxidePartialPressurePa > 400 ||
    qualities.some((quality) => quality !== "nominal")
  ) {
    return "watch";
  }
  return "nominal";
}

function compartmentTelemetry(): CompartmentTelemetry {
  const breaches = compartments.listBreaches();
  const breachedZones = new Set(breaches.map((breach) => breach.zoneId));
  const sensors = new Map(
    compartments
      .listSensors()
      .map((sensor) => [sensor.id, sensor.latest] as const),
  );
  const zones: CompartmentZoneTelemetry[] = compartments
    .listZones()
    .map((zone) => {
      const readings = Object.fromEntries(
        SENSOR_QUANTITIES.map((quantity) => [
          quantity,
          sensors.get(`sensor:${zone.id}:${quantity}`) ?? null,
        ]),
      ) as Record<
        (typeof SENSOR_QUANTITIES)[number],
        ReturnType<CompartmentAtmosphereNetwork["getSensorReading"]>
      >;
      const observed = {
        pressurePa: readings.pressurePa?.value ?? null,
        temperatureK: readings.temperatureK?.value ?? null,
        oxygenPartialPressurePa:
          readings.oxygenPartialPressurePa?.value ?? null,
        carbonDioxidePartialPressurePa:
          readings.carbonDioxidePartialPressurePa?.value ?? null,
      };
      const qualities = [
        sensorQualityOrOffline(readings.pressurePa?.quality),
        sensorQualityOrOffline(readings.temperatureK?.quality),
        sensorQualityOrOffline(
          readings.oxygenPartialPressurePa?.quality,
        ),
        sensorQualityOrOffline(
          readings.carbonDioxidePartialPressurePa?.quality,
        ),
      ] as const;
      const sampledAt = Object.values(readings)
        .filter((reading) => reading !== null)
        .map((reading) => reading.sampledAtMicroseconds);
      const newestSampleAgeSeconds =
        sampledAt.length === 0
          ? null
          : Math.max(
              0,
              (compartments.elapsedMicroseconds -
                Math.max(...sampledAt)) /
                1_000_000,
            );
      const hasBreach = breachedZones.has(zone.id);
      return {
        zoneId: zone.id,
        condition: zoneCondition(observed, qualities),
        hasBreach,
        observed,
        quality: {
          pressure: qualities[0],
          temperature: qualities[1],
          oxygen: qualities[2],
          carbonDioxide: qualities[3],
        },
        newestSampleAgeSeconds,
      };
    });
  const observedPressures = zones
    .map((zone) => zone.observed.pressurePa)
    .filter((pressure): pressure is number => pressure !== null);
  const airHandlerTruth = compartments.listAirHandlers();
  return {
    zoneCount: COMPARTMENT_COUNT,
    ...lastCompartmentStep,
    requestedTimeScale,
    effectiveTimeScale,
    fidelityLimited: effectiveTimeScale < requestedTimeScale,
    activeBreaches: breaches.length,
    totalVentedGasKg: compartments.getAggregateState().ventedGasKg,
    observedPressureMinPa:
      observedPressures.length === 0
        ? null
        : Math.min(...observedPressures),
    observedPressureAveragePa:
      observedPressures.length === 0
        ? null
        : observedPressures.reduce(
            (total, pressure) => total + pressure,
            0,
          ) / observedPressures.length,
    observedPressureMaxPa:
      observedPressures.length === 0
        ? null
        : Math.max(...observedPressures),
    airHandlers: {
      controllers: airHandlerTruth.map(
        ({
          id,
          ring,
          commandedFlowFraction,
          scrubberEnabled,
          carbonDioxideSetpointPa,
        }) => ({
          id,
          ring,
          commandedFlowFraction,
          scrubberEnabled,
          carbonDioxideSetpointPa,
        }),
      ),
      truth: airHandlerTruth,
    },
    zones,
  };
}

function averageObserved(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) {
    return null;
  }
  const available = values.filter(
    (value): value is number => value !== null,
  );
  return available.length === 0
    ? null
    : available.reduce((total, value) => total + value, 0) /
        available.length;
}

function sumObserved(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) {
    return null;
  }
  const available = values.filter(
    (value): value is number => value !== null,
  );
  return available.length === 0
    ? null
    : available.reduce((total, value) => total + value, 0);
}

function coolingTelemetry(): CoolingTelemetry {
  const sensors = cooling.listSensors().map((sensor) => {
    const reading = sensor.latest;
    return {
      sensorId: sensor.id,
      targetId: sensor.targetId,
      quantity: sensor.quantity,
      value: reading?.value ?? null,
      quality: reading?.quality ?? "offline",
      sampledAtMicroseconds:
        reading?.sampledAtMicroseconds ?? null,
      sampleAgeSeconds:
        reading == null
          ? null
          : Math.max(
              0,
              (cooling.elapsedMicroseconds -
                reading.sampledAtMicroseconds) /
                1_000_000,
            ),
    };
  });
  const observedValue = (
    targetId: string,
    quantity: CoolingTelemetry["sensors"][number]["quantity"],
  ): number | null =>
    sensors.find(
      (sensor) =>
        sensor.targetId === targetId &&
        sensor.quantity === quantity,
    )?.value ?? null;
  const summary = cooling.getSummary();
  return {
    observed: {
      thermalBusTemperatureK: observedValue(
        "thermal-bus",
        "temperatureK",
      ),
      averageCoolantTemperatureK: averageObserved([
        observedValue("coolant-a", "temperatureK"),
        observedValue("coolant-b", "temperatureK"),
      ]),
      totalMassFlowKgPerSecond: sumObserved([
        observedValue("pump-a", "massFlowKgPerSecond"),
        observedValue("pump-b", "massFlowKgPerSecond"),
      ]),
      totalRadiatedPowerW: sumObserved([
        observedValue("radiator-wing-a", "radiatedPowerW"),
        observedValue("radiator-wing-b", "radiatedPowerW"),
      ]),
    },
    sensors,
    truth: {
      ...summary,
      pumps: cooling.listPumps().map((pump) => ({
        id: pump.id,
        condition: pump.condition,
        commandedSpeedFraction: pump.commandedSpeedFraction,
        electricalSupplyFraction: pump.electricalSupplyFraction,
        massFlowKgPerSecond: pump.lastMassFlowKgPerSecond,
      })),
    },
  };
}

function electricalTelemetry(): ElectricalTelemetry {
  const sensors = electrical.listSensors().map((sensor) => {
    const reading = sensor.latest;
    return {
      sensorId: sensor.id,
      targetId: sensor.targetId,
      quantity: sensor.quantity,
      value: reading?.value ?? null,
      quality: reading?.quality ?? "offline",
      sampledAtMicroseconds:
        reading?.sampledAtMicroseconds ?? null,
      sampleAgeSeconds:
        reading == null
          ? null
          : Math.max(
              0,
              (electrical.elapsedMicroseconds -
                reading.sampledAtMicroseconds) /
                1_000_000,
            ),
    };
  });
  const observedValue = (
    targetId: string,
    quantity: ElectricalSensorQuantity,
  ): number | null =>
    sensors.find(
      (sensor) =>
        sensor.targetId === targetId &&
        sensor.quantity === quantity,
    )?.value ?? null;
  const summary = electrical.getSummary();
  return {
    observed: {
      averageBusVoltageV: averageObserved([
        observedValue("bus-a", "voltageV"),
        observedValue("bus-b", "voltageV"),
      ]),
      averageBusFrequencyHz: averageObserved([
        observedValue("bus-a", "frequencyHz"),
        observedValue("bus-b", "frequencyHz"),
      ]),
      totalServedPowerKw: sumObserved([
        observedValue("bus-a", "servedPowerKw"),
        observedValue("bus-b", "servedPowerKw"),
      ]),
      totalReactorOutputKw: sumObserved(
        electrical
          .listReactors()
          .map((reactor) =>
            observedValue(reactor.id, "reactorOutputKw"),
          ),
      ),
      averageBatteryStateOfChargeFraction: averageObserved(
        electrical
          .listBatteries()
          .map((battery) =>
            observedValue(
              battery.id,
              "batteryStateOfChargeFraction",
            ),
          ),
      ),
    },
    sensors,
    truth: {
      ...summary,
      reactors: electrical.listReactors().map((reactor) => ({
        id: reactor.id,
        mode: reactor.mode,
        condition: reactor.condition,
        outputKw: reactor.outputKw,
        targetOutputKw: reactor.targetOutputKw,
      })),
      buses: electrical.listBuses().map((bus) => ({
        id: bus.id,
        energized: bus.energized,
        voltageV: bus.voltageV,
        frequencyHz: bus.frequencyHz,
        servedPowerKw: bus.servedPowerKw,
        unservedPowerKw: bus.unservedPowerKw,
      })),
      batteries: electrical.listBatteries().map((battery) => ({
        id: battery.id,
        condition: battery.condition,
        storedEnergyKWh: battery.storedEnergyKWh,
        capacityKWh: battery.capacityKWh,
        lastPowerKw: battery.lastPowerKw,
      })),
    },
  };
}

function navigationTelemetry(): NavigationTelemetry {
  const sensors = navigation.listSensors().map((sensor) => {
    const reading = sensor.latest;
    return {
      sensorId: sensor.id,
      quantity: sensor.quantity,
      frameEpoch: reading?.frameEpoch ?? null,
      value: reading?.value ?? null,
      quality: reading?.quality ?? "offline",
      sampledAtMicroseconds:
        reading?.sampledAtMicroseconds ?? null,
      sampleAgeSeconds:
        reading == null
          ? null
          : Math.max(
              0,
              (navigation.elapsedMicroseconds -
                reading.sampledAtMicroseconds) /
                1_000_000,
            ),
    };
  });
  const observedValue = (
    quantity: NavigationSensorQuantity,
  ): number | null =>
    sensors.find((sensor) => sensor.quantity === quantity)
      ?.value ?? null;
  const summary = navigation.getSummary();
  return {
    observed: {
      positionM: {
        x: observedValue("positionX"),
        y: observedValue("positionY"),
        z: observedValue("positionZ"),
      },
      velocityMPerS: {
        x: observedValue("velocityX"),
        y: observedValue("velocityY"),
        z: observedValue("velocityZ"),
      },
      orientationBodyToInertial: {
        w: observedValue("attitudeW"),
        x: observedValue("attitudeX"),
        y: observedValue("attitudeY"),
        z: observedValue("attitudeZ"),
      },
      angularVelocityBodyRadPerS: {
        x: observedValue("angularVelocityX"),
        y: observedValue("angularVelocityY"),
        z: observedValue("angularVelocityZ"),
      },
      propellantMassKg: observedValue("propellantMass"),
      fusionFuelMassKg: observedValue("fusionFuelMass"),
    },
    sensors,
    truth: {
      ...summary,
      thrusters: navigation.listThrusters().map((thruster) => ({
        id: thruster.id,
        condition: thruster.condition,
        lastActualThrottleFraction:
          thruster.lastActualThrottleFraction,
        lastThrustN: thruster.lastThrustN,
        lastMassFlowKgPerS: thruster.lastMassFlowKgPerS,
      })),
    },
  };
}

function currentRotationCarrierState(): RotationCarrierState {
  const body = navigation.getBodyState();
  return {
    angularVelocityXRadPerS:
      body.angularVelocityBodyRadPerS.x,
    inertiaXKgM2:
      navigation.getCurrentInertiaDiagonal().x,
    revision: navigation.revision,
  };
}

function rotationTelemetry(): RotationTelemetry {
  const sensors = rotation.listSensors().map((sensor) => {
    const reading = rotation.getSensorReading(sensor.id);
    return {
      sensorId: sensor.id,
      ringId: sensor.ringId,
      quantity: sensor.quantity,
      value: reading?.value ?? null,
      quality: reading?.quality ?? sensor.condition,
      sampledAtMicroseconds:
        reading?.sampledAtMicroseconds ?? null,
      sampleAgeSeconds:
        reading === null
          ? null
          : Math.max(
              0,
              (rotation.elapsedMicroseconds -
                reading.sampledAtMicroseconds) /
                1_000_000,
            ),
    };
  });
  const observedValue = (
    ringId: RotationRingId,
    quantity:
      | "relativeRpm"
      | "artificialGravityG"
      | "vibrationMmPerS",
  ): number | null =>
    sensors.find(
      (sensor) =>
        sensor.ringId === ringId &&
        sensor.quantity === quantity,
    )?.value ?? null;
  return {
    observed: {
      rings: (["ring-a", "ring-b"] as const).map(
        (ringId) => ({
          id: ringId,
          relativeRpm: observedValue(
            ringId,
            "relativeRpm",
          ),
          artificialGravityG: observedValue(
            ringId,
            "artificialGravityG",
          ),
          vibrationMmPerS: observedValue(
            ringId,
            "vibrationMmPerS",
          ),
        }),
      ),
    },
    sensors,
    truth: rotation.getSummary(),
  };
}

function projectedElectricalPowerState(
  network = electrical,
) {
  const summary = network.getSummary();
  const loads = network.listLoads();
  const demandedForTiers = (
    tiers: ReadonlySet<(typeof loads)[number]["tier"]>,
  ): number =>
    loads
      .filter((load) => tiers.has(load.tier))
      .reduce(
        (total, load) =>
          total + load.servedPowerKw + load.unservedPowerKw,
        0,
      );
  return {
    generationKw: summary.generationPowerKw,
    essentialDemandKw: demandedForTiers(
      new Set(["critical", "essential"]),
    ),
    discretionaryDemandKw: demandedForTiers(
      new Set(["discretionary"]),
    ),
    jumpDriveDemandKw: demandedForTiers(new Set(["jump"])),
    servedDemandKw: summary.servedPowerKw,
    unservedDemandKw: summary.unservedPowerKw,
    curtailedGenerationKw: summary.curtailedGenerationKw,
    batteryCapacityKWh: summary.batteryCapacityKWh,
    batteryChargeKWh: summary.batteryStoredEnergyKWh,
    batteryThroughputKWh: network
      .listBatteries()
      .reduce(
        (total, battery) => total + battery.throughputKWh,
        0,
      ),
  };
}

function synchronizeElectricalAggregate(): void {
  engine.synchronizePowerNetwork(
    projectedElectricalPowerState(),
  );
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
      demandFraction,
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
      Math.min(1, Math.max(0, demandFraction)),
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
    if (demandFraction > 1 + 1e-12) {
      throw new Error(
        `${loadId} rotation drive request exceeds its fixed electrical rating`,
      );
    }
    electrical.synchronizeLoadControllerDemandFraction(
      loadId,
      Math.min(1, Math.max(0, demandFraction)),
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
    synchronizeRotationDriveDemand(
      rotationPreview,
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
        stableZoneForCabin(person.cabinId).startsWith(zonePrefix),
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
  coefficientOfPerformance: number | null;
  availableWorkEnergyJ: number;
}

function cabinHeatPumpCoupling(
  electricalCoupling: ElectricalCouplingResult,
  simulatedSeconds: number,
  lifeSupportServiceRatio: number,
): CabinHeatPumpCoupling {
  const coldTemperatureK =
    compartments.getAggregateState().averageTemperatureK;
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
  return {
    metabolicHeatRemovalFraction: Math.min(
      cabinCoolingFlowFraction(),
      lifeSupportServiceRatio,
      energyCapacityFraction,
    ),
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

function projectedThermalNetworkState(
  coolingNetwork = cooling,
  compartmentNetwork = compartments,
) {
  const snapshot = coolingNetwork.snapshot();
  const aggregate = compartmentNetwork.getAggregateState();
  const summary = coolingNetwork.getSummary();
  const radiatorNodes = snapshot.nodes.filter(
    (node) =>
      node.id === "radiator-a" || node.id === "radiator-b",
  );
  const coolantNodes = snapshot.nodes.filter(
    (node) =>
      node.id === "coolant-a" || node.id === "coolant-b",
  );
  const averageRadiatorTemperatureK =
    radiatorNodes.reduce(
      (total, node) => total + node.temperatureK,
      0,
    ) / radiatorNodes.length;
  const effectiveRadiatorConductanceKwPerK =
    summary.totalRadiatedPowerW /
    1_000 /
    Math.max(
      1e-9,
      averageRadiatorTemperatureK -
        snapshot.externalSpaceTemperatureK,
    );
  return {
    habitatTemperatureK: aggregate.averageTemperatureK,
    coolantTemperatureK: summary.averageCoolantTemperatureK,
    radiatorTemperatureK: averageRadiatorTemperatureK,
    spaceSinkTemperatureK: snapshot.externalSpaceTemperatureK,
    internalHeatKw:
      snapshot.heatSources.reduce(
        (total, source) =>
          total +
          (source.enabled ? source.thermalPowerW : 0),
        0,
      ) / 1_000,
    radiatedHeatKw: summary.totalRadiatedPowerW / 1_000,
    radiatorConductanceKwPerK:
      effectiveRadiatorConductanceKwPerK,
    coolantHeatCapacityKJPerK:
      coolantNodes.reduce(
        (total, node) => total + node.heatCapacityJPerK,
        0,
      ) / 1_000,
  };
}

function synchronizeThermalAggregate(): void {
  engine.synchronizeThermalNetwork(
    projectedThermalNetworkState(),
  );
}

function stableZoneForCabin(cabinId: string): ZoneId {
  let hash = 2_166_136_261;
  for (let index = 0; index < cabinId.length; index += 1) {
    hash ^= cabinId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return BASELINE_ZONE_IDS[(hash >>> 0) % BASELINE_ZONE_IDS.length];
}

function compartmentOccupantsFor(
  population: PassengerSimulation,
): Record<ZoneId, number> {
  const occupants = Object.fromEntries(
    BASELINE_ZONE_IDS.map((zoneId) => [zoneId, 0]),
  ) as Record<ZoneId, number>;
  for (const cabinId of population.getAwakeCabinIds()) {
    occupants[stableZoneForCabin(cabinId)] += 1;
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
  const occupants = awakeOccupantsByWaterRing();
  water.synchronizeAwakeOccupants(occupants);
  return occupants;
}

function synchronizeWaterAggregate(): void {
  const summary = water.getSummary();
  engine.synchronizeWaterNetwork({
    potableKg: summary.potableKg,
    wastewaterKg: summary.wastewaterKg,
    reserveIceKg: summary.reserveIceKg,
    brineWasteKg: summary.brineWasteKg,
    consumptionKgPerAwakePersonDay: 3,
    recyclerCapacityKgPerDay: summary.recyclerCapacityKgPerDay,
    recyclerEfficiency: summary.recyclerEfficiency,
    recycledKgCumulative: summary.recycledKgCumulative,
  });
}

function applyCompletedMaintenance(assetId: MaintenanceAssetId): void {
  if (assetId === "pump-a" || assetId === "pump-b") {
    cooling.configurePump(assetId, { condition: "nominal" });
    synchronizeThermalAggregate();
    return;
  }
  if (assetId === "air-handler-a" || assetId === "air-handler-b") {
    compartments.configureAirHandler(assetId, { condition: "nominal" });
    return;
  }
  if (
    assetId === "water-processor-a" ||
    assetId === "water-processor-b"
  ) {
    water.configureProcessor(assetId, { condition: "nominal" });
    synchronizeWaterAggregate();
    return;
  }
  rotation.completeBearingMaintenance(
    assetId === "ring-a-bearing" ? "ring-a" : "ring-b",
  );
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
    applyCompletedMaintenance(task.assetId);
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

function assertProjectionClose(
  actual: number,
  expected: number,
  label: string,
): void {
  const tolerance = Math.max(1e-7, Math.abs(expected) * 1e-10);
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label} does not match the authoritative compartment projection`,
    );
  }
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
  assertProjectionClose(
    state.water.consumptionKgPerAwakePersonDay,
    3,
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
  assertProjectionClose(
    rotationSnapshot.energyLedger
      .requestedElectricalEnergyJ,
    rotationRequestedEnergyJ,
    "rotation requested electrical energy",
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

function maintenanceTelemetry() {
  const published = maintenance.getPublishedDiagnostic();
  const tasks = maintenance.listTasks();
  return {
    observedAssets: MAINTENANCE_ASSET_IDS.map((assetId) => ({
      assetId,
      label: MAINTENANCE_ASSET_SPECS[assetId].label,
      condition: published?.conditions[assetId] ?? null,
      sampledAtMicroseconds:
        published?.sampledAtMicroseconds ?? null,
      sampleAgeSeconds:
        published === null
          ? null
          : Math.max(
              0,
              (maintenance.elapsedMicroseconds -
                published.sampledAtMicroseconds) /
                1_000_000,
            ),
    })),
    activeTasks: tasks.filter((task) => task.status === "active"),
    recentCompletedTasks: tasks
      .filter((task) => task.status === "completed")
      .slice(-8),
    inventory: maintenance.getInventory(),
    robots: maintenance.listRobots(),
    diagnosticFrame: published,
    truth: { conditions: currentMaintenanceConditions() },
  };
}

function currentState(): SimulationWorkerState {
  const compartmentState = compartmentTelemetry();
  const compartmentByZoneId = new Map(
    compartmentState.zones.map((zone) => [zone.zoneId, zone]),
  );
  return {
    elapsedSeconds: engine.elapsedSeconds,
    state: engine.getState(),
    passengers: passengers.getPopulationSummary(),
    passengerHighlights: passengers
      .getKeyLlmPassengers()
      .map((person) => {
        const zoneId = stableZoneForCabin(person.cabinId);
        const zone = compartmentByZoneId.get(zoneId);
        if (!zone) {
          throw new Error(
            `passenger telemetry lost observed compartment ${zoneId}`,
          );
        }
        return {
          passengerId: person.id,
          name: person.name,
          occupation: person.occupation,
          cabinId: person.cabinId,
          zoneId,
          zoneCondition: zone.condition,
          zoneObservedPressurePa: zone.observed.pressurePa,
          zoneObservationAgeSeconds:
            zone.newestSampleAgeSeconds,
          lifeState: person.lifeState,
          physicalHealth: person.health.physical,
          medicalStability: person.health.resilience,
          psychologicalStability:
            person.psychology.stability,
          stress: person.psychology.stress,
          trust: person.experience.trust,
          isKeyLlm: person.isKeyLlm,
        };
      }),
    compartments: compartmentState,
    cooling: coolingTelemetry(),
    electrical: electricalTelemetry(),
    navigation: navigationTelemetry(),
    rotation: rotationTelemetry(),
    waterRecovery: {
      controllers: water.listProcessors().map((processor) => ({
        id: processor.id,
        ring: processor.ring,
        commandedThroughputFraction:
          processor.commandedThroughputFraction,
      })),
      observed: water.getObservation(),
      truth: {
        loops: water.listLoops(),
        processors: water.listProcessors(),
        summary: water.getSummary(),
      },
    },
    maintenance: maintenanceTelemetry(),
    commandBus: {
      revision: commandBus.revision,
      recentAudit: commandBus
        .getAuditHistory()
        .slice(-8)
        .map((entry) => ({
          sequence: entry.sequence,
          actor: entry.actor,
          role: entry.role,
          kind: entry.kind,
          issuedAt: entry.issuedAt,
          status: entry.status,
          revisionBefore: entry.revisionBefore,
          revisionAfter: entry.revisionAfter,
        })),
    },
  };
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
    command.snapshot.snapshotVersion !== 15 ||
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
      restoredEngine.elapsedMicroseconds
  ) {
    throw new Error(
      "engine, passenger, compartment, cooling, electrical, navigation, rotation, water, and maintenance clocks do not match",
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
  passengerEnvironmentalExposures = structuredClone(
    command.snapshot.passengerEnvironmentalExposures,
  );
  commandBus = restoredCommandBus;
  requestedTimeScale = engine.timeScale;
  effectiveTimeScale = engine.timeScale;
  lastCompartmentStep = {
    fidelityMode: "equilibrium-fast",
    fineSubsteps: 0,
    equilibriumIntervals: 0,
  };
  highestDirective = command.snapshot.highestDirective;
  post({
    type: "ready",
    requestId: command.requestId,
    payload: currentState(),
  });
}

function runtimeSnapshot(): RuntimeSimulationSnapshot {
  return {
    snapshotVersion: 15,
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
    commandBus: commandBus.snapshot(),
    passengerEnvironmentalExposures: structuredClone(
      passengerEnvironmentalExposures,
    ),
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
  passengerEnvironmentalExposures:
    PassengerEnvironmentalExposureState[];
  requestedTimeScale: number;
  effectiveTimeScale: number;
  lastCompartmentStep: typeof lastCompartmentStep;
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
    passengerEnvironmentalExposures: structuredClone(
      passengerEnvironmentalExposures,
    ),
    requestedTimeScale,
    effectiveTimeScale,
    lastCompartmentStep: structuredClone(lastCompartmentStep),
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
  passengerEnvironmentalExposures = structuredClone(
    checkpoint.passengerEnvironmentalExposures,
  );
  requestedTimeScale = checkpoint.requestedTimeScale;
  effectiveTimeScale = checkpoint.effectiveTimeScale;
  lastCompartmentStep = structuredClone(
    checkpoint.lastCompartmentStep,
  );
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
      if (rotationRequiresFineCoupling()) {
        return 1;
      }
      if (
        navigation
          .listThrusters()
          .some((thruster) => thruster.lastThrustN > 0)
      ) {
        return 1;
      }
      const nextBoundary =
        navigation.getNextPropulsionBoundaryMicroseconds();
      if (nextBoundary !== undefined) {
        const secondsUntilBoundary =
          (nextBoundary - fromMicroseconds) / 1_000_000;
        if (
          secondsUntilBoundary > 0 &&
          secondsUntilBoundary <
            ELECTRICAL_COUPLING_INTERVAL_SECONDS
        ) {
          return secondsUntilBoundary;
        }
      }
      return ELECTRICAL_COUPLING_INTERVAL_SECONDS;
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
        maintenance.elapsedMicroseconds !== fromMicroseconds
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
        maintenance.elapsedMicroseconds !== toMicroseconds
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
  if (
    passengers.nowMicroseconds !== engine.elapsedMicroseconds ||
    compartments.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    cooling.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    electrical.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    navigation.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    rotation.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    water.elapsedMicroseconds !== engine.elapsedMicroseconds ||
    maintenance.elapsedMicroseconds !== engine.elapsedMicroseconds
  ) {
    throw new Error(
      "coupled engine, passenger, compartment, cooling, electrical, navigation, rotation, water, and maintenance clocks diverged after the simulation step",
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
        electricalCoupling.servedLoadEnergyKWhById[
          ROTATION_DRIVE_LOAD_BY_RING["ring-a"]
        ] * 3_600_000,
      "ring-b":
        electricalCoupling.servedLoadEnergyKWhById[
          ROTATION_DRIVE_LOAD_BY_RING["ring-b"]
        ] * 3_600_000,
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
          externalMetabolicHeatRemovalFraction:
            cabinHeatPump.metabolicHeatRemovalFraction,
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
  engine.applyMetabolicMassExchange(metabolicExchange);
  synchronizeAtmosphereAggregate(
    capturedCarbonDioxideTotal(),
  );
  updatePassengerEnvironmentalExposures();
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
  return { fineSubsteps, equilibriumIntervals };
}

function replaceEquivalentBreachArea(areaSquareMeters: number): void {
  for (const breach of compartments.listBreaches()) {
    compartments.removeBreach(breach.id);
  }
  if (areaSquareMeters > 0) {
    compartments.upsertBreach({
      id: "breach:force-equivalent",
      zoneId: "A-18",
      areaSquareMeters,
      dischargeCoefficient: 0.72,
    });
  }
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
        stableZoneForCabin(person.cabinId) === zoneId,
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

function updatePassengerEnvironmentalExposures(): void {
  const byKey = new Map(
    passengerEnvironmentalExposures.map((state) => [
      `${state.zoneId}/${state.family}`,
      state,
    ]),
  );
  const activeExposures: Array<{
    zoneId: ZoneId;
    family: PassengerEnvironmentalHazardFamily;
    tier: Exclude<PassengerEnvironmentalHazardTier, 0>;
    episode: number;
  }> = [];
  for (const zoneId of BASELINE_ZONE_IDS) {
    const truth = compartments.getZoneTruth(zoneId);
    for (const family of PASSENGER_ENVIRONMENTAL_HAZARD_FAMILIES) {
      const state = byKey.get(`${zoneId}/${family}`);
      if (!state) {
        throw new Error(
          `passenger environmental exposure state lost ${zoneId}/${family}`,
        );
      }
      const previousTier = state.currentTier;
      const currentTier = passengerEnvironmentalHazardTier(
        truth,
        family,
      );
      if (previousTier === 0 && currentTier > 0) {
        state.episode += 1;
      }
      state.currentTier = currentTier;
      if (currentTier > 0) {
        activeExposures.push({
          zoneId,
          family,
          tier: currentTier as Exclude<
            PassengerEnvironmentalHazardTier,
            0
          >,
          episode: state.episode,
        });
      }
    }
  }
  if (activeExposures.length > 0) {
    const awakePassengersByZone = new Map<
      ZoneId,
      Passenger[]
    >(
      BASELINE_ZONE_IDS.map((zoneId) => [zoneId, []]),
    );
    for (const person of passengers.getAllPassengers()) {
      if (person.lifeState !== "awake") continue;
      awakePassengersByZone
        .get(stableZoneForCabin(person.cabinId))!
        .push(person);
    }
    for (const exposure of activeExposures) {
      const awakePassengers =
        awakePassengersByZone.get(exposure.zoneId)!;
      if (awakePassengers.length === 0) continue;
      // Apply every tier reached in the current episode. Re-evaluation is
      // intentional: applyPassengerIncident is idempotent for people already
      // exposed, while newly awakened occupants receive the active exposure.
      for (let tier = 1; tier <= exposure.tier; tier += 1) {
        const eventId =
          `compartment-exposure:${exposure.zoneId}:${exposure.family}:` +
          `episode-${exposure.episode}:tier-${tier}`;
        const targetPassengerIds = awakePassengers
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
          eventId,
          targetPassengerIds,
        });
      }
    }
  }
  validatePassengerEnvironmentalExposureStates(
    passengerEnvironmentalExposures,
    compartments,
  );
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
  if (eventType === "micrometeoroid") {
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
      compartments.upsertBreach({
        id: `breach:micrometeoroid:${record.sequence}`,
        zoneId: "A-18",
        areaSquareMeters: newBreachArea,
        dischargeCoefficient: 0.72,
      });
      const exposedPassengers = awakePassengersInZone("A-18").slice(
        0,
        3,
      );
      if (exposedPassengers.length > 0) {
        applyIncidentToRoster({
          eventId: `${record.id}:A-18-impact`,
          eventType: "micrometeoroid-compartment-impact",
          summary:
            "A-18 压力区遭受微流星体贯穿冲击、瞬态压降与碎屑暴露。",
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
  const energyConsumedKWh =
    state.journey.requiredChargePerJumpKWh *
    (0.35 +
      0.65 * (actualDistanceLightYears / 5) ** 2);
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

  const thermalBus = cooling
    .listNodes()
    .find((node) => node.id === "thermal-bus");
  if (!thermalBus) {
    failures.push("主热汇流排不可用");
  } else {
    const projectedWasteHeatJ =
      energyConsumedKWh * 3_600_000 * 0.008;
    const projectedTemperatureK =
      thermalBus.temperatureK +
      projectedWasteHeatJ / thermalBus.heatCapacityJPerK;
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
    cooling.configurePump(command.pumpId, {
      commandedSpeedFraction: command.commandedSpeedFraction,
    });
    synchronizeThermalAggregate();
    return {
      kind: command.kind,
      actorAgentId: command.actorAgentId,
      summary: `冷却泵 ${command.pumpId} 的转速指令已设为 ${(command.commandedSpeedFraction * 100).toFixed(1)}%；实际流量仍受泵体故障与回路状态限制。`,
      pumpId: command.pumpId,
      commandedSpeedFraction: command.commandedSpeedFraction,
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
    const handler = compartments.configureAirHandler(
      command.airHandlerId,
      {
        commandedFlowFraction: command.commandedFlowFraction,
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
    water.configureProcessor(command.processorId, {
      commandedThroughputFraction:
        command.commandedThroughputFraction,
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

  if (command.kind === "schedule-maintenance") {
    const actualCondition =
      currentMaintenanceConditions()[command.assetId];
    if (actualCondition === "nominal") {
      throw new Error(
        `${MAINTENANCE_ASSET_SPECS[command.assetId].label} 当前没有可维修故障`,
      );
    }
    const task = maintenance.scheduleTask({
      assetId: command.assetId,
      detectedCondition: actualCondition,
      crew: selectMaintenanceCrew(command.assetId),
    });
    return {
      kind: command.kind,
      actorAgentId: command.actorAgentId,
      summary:
        `维修任务 ${task.id} 已创建：${MAINTENANCE_ASSET_SPECS[task.assetId].label}，` +
        `备件 ${task.requiredPartId} 已锁定并消耗，${task.assignedRobotId} 与 ${task.assignedCrewId} 开始累计 ` +
        `${task.requiredWorkSeconds.toFixed(0)} 秒额定工时；进度仍受乘员清醒状态和本环工业馈线约束。`,
      maintenanceAssetId: task.assetId,
      maintenanceTaskId: task.id,
      maintenanceCrewId: task.assignedCrewId,
      maintenanceRobotId: task.assignedRobotId,
    };
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
        restoreDomainCheckpoint(checkpoint);
        throw error;
      }
    },
  );
  if (receipt.status === "rejected") {
    if (receipt.rejection.code === "INVALID_EXECUTOR_RESULT") {
      restoreDomainCheckpoint(checkpoint);
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
      case "step":
        runCoupledStep(command.realSeconds, command.timeScale);
        post({
          type: "stepped",
          requestId: command.requestId,
          payload: currentState(),
        });
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
        const checkpoint = captureDomainCheckpoint();
        let normalizedRequest: ExternalInterventionRequest;
        let record: ExternalInterventionRecord;
        try {
          normalizedRequest = normalizeWaterProcessorTrip(
            normalizeAirHandlerTrip(
              normalizeRingBearingDegradation(
                normalizeDirectForceBalance(command.request),
              ),
            ),
          );
          record = engine.applyExternalIntervention(
            normalizedRequest,
          );
          applyCompartmentInterventionEffects(
            normalizedRequest,
            record,
          );
          applyCoolingInterventionEffects(
            normalizedRequest,
            record,
          );
          applyElectricalInterventionEffects(
            normalizedRequest,
            record,
          );
          applyWaterInterventionEffects(normalizedRequest, record);
          applyRotationInterventionEffects(normalizedRequest);
          applyNavigationInterventionEffects(record);
          updatePassengerEnvironmentalExposures();
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
        } catch (error) {
          restoreDomainCheckpoint(checkpoint);
          throw error;
        }
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
