/**
 * Stateless telemetry degradation and UI state projection for the simulation worker.
 *
 * Pure functions only: no module-level mutable state. Domain networks and worker
 * mutable fields are passed explicitly so the worker can keep bit-level determinism
 * while this layer stays independently testable.
 */

import {
  COMPARTMENT_COUNT,
  zoneCatalogEntry,
  type CompartmentAtmosphereNetwork,
  type CompartmentStepResult,
  type SensorQuality,
  type ZoneId,
} from "./compartments.ts";
import {
  effectiveHabitatThermalDeliveryFraction,
  type CoolingThermalNetwork,
} from "./cooling.ts";
import type {
  ElectricalSensorQuantity,
  ShipElectricalNetwork,
} from "./electrical.ts";
import type {
  NavigationSensorQuantity,
  RigidBodyNavigation,
} from "./navigation.ts";
import type {
  CounterRotatingHabitat,
  RotationCarrierState,
  RotationRingId,
} from "./rotation.ts";
import {
  effectiveDeliveryFraction,
  type WaterRecoveryNetwork,
} from "./water.ts";
import {
  MAINTENANCE_ASSET_IDS,
  MAINTENANCE_ASSET_SPECS,
  type MaintenanceConditionRecord,
  type MaintenanceNetwork,
} from "./maintenance.ts";
import type { HullConsequenceNetwork } from "./hull-consequence.ts";
import type { SimulationEngine } from "./index.ts";
import type { Passenger, PassengerSimulation } from "./passengers.ts";
import type { CaptainOperations } from "./captain-operations.ts";
import type { DeterministicCommandBus } from "./command-bus.ts";
import type { SimulationTimeDirector } from "./director.ts";
import type { SurvivalLedger } from "./survival.ts";
import type { ProceduralWorldEvent } from "./procedural-world.ts";
import type {
  CompartmentTelemetry,
  CompartmentZoneCondition,
  CompartmentZoneTelemetry,
  CoolingTelemetry,
  ElectricalTelemetry,
  MaintenanceTelemetry,
  NavigationTelemetry,
  RotationTelemetry,
  SimulationWorkerState,
  WaterRecoveryTelemetry,
} from "./protocol";

export type CompartmentTelemetryInput = {
  compartments: CompartmentAtmosphereNetwork;
  lastCompartmentStep: Pick<
    CompartmentStepResult,
    "fidelityMode" | "fineSubsteps" | "equilibriumIntervals"
  >;
  requestedTimeScale: number;
  effectiveTimeScale: number;
};

export interface WorkerStateProjectionInput {
  engine: SimulationEngine;
  passengers: PassengerSimulation;
  compartments: CompartmentAtmosphereNetwork;
  cooling: CoolingThermalNetwork;
  electrical: ShipElectricalNetwork;
  navigation: RigidBodyNavigation;
  rotation: CounterRotatingHabitat;
  water: WaterRecoveryNetwork;
  maintenance: MaintenanceNetwork;
  hullConsequence: HullConsequenceNetwork;
  captainOperations: CaptainOperations;
  commandBus: DeterministicCommandBus;
  timeDirector: SimulationTimeDirector;
  lastReachedBlockingBoundary: {
    id: string;
    atSimulationSeconds: number;
  } | null;
  lastProceduralEvents: readonly ProceduralWorldEvent[];
  survivalLedger: SurvivalLedger;
  lastCompartmentStep: CompartmentTelemetryInput["lastCompartmentStep"];
  requestedTimeScale: number;
  effectiveTimeScale: number;
  currentZoneForPerson: (person: {
    id: string;
    cabinId: string;
  }) => ZoneId;
  maintenanceConditions: MaintenanceConditionRecord;
  llmOrchestration?: SimulationWorkerState["llmOrchestration"];
  passengerSociety?: SimulationWorkerState["passengerSociety"];
  departmentInbox?: SimulationWorkerState["departmentInbox"];
};

export const SENSOR_QUANTITIES = [
  "pressurePa",
  "temperatureK",
  "oxygenPartialPressurePa",
  "carbonDioxidePartialPressurePa",
] as const;

export function sensorQualityOrOffline(
  quality: SensorQuality | undefined,
): SensorQuality {
  return quality ?? "offline";
}

export function zoneCondition(
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

export function compartmentTelemetry({
  compartments,
  lastCompartmentStep,
  requestedTimeScale,
  effectiveTimeScale,
}: CompartmentTelemetryInput): CompartmentTelemetry {
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
      const catalog = zoneCatalogEntry(zone.id);
      return {
        zoneId: zone.id,
        role: catalog.role,
        labelZh: catalog.labelZh,
        purposeZh: catalog.purposeZh,
        ring: catalog.ring,
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

export function averageObserved(values: Array<number | null>): number | null {
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

export function sumObserved(values: Array<number | null>): number | null {
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

export function coolingTelemetry(
  cooling: CoolingThermalNetwork,
): CoolingTelemetry {
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
    habitatThermalDeliverySpurs: cooling.listLoops().map((loop) => {
      const spur = loop.habitatThermalDeliverySpur;
      return {
        spurId: spur.id,
        ring: cooling.habitatRingForSpur(spur.id),
        condition: spur.condition,
        commandedOpenFraction: spur.commandedOpenFraction,
        effectiveDeliveryFraction:
          effectiveHabitatThermalDeliveryFraction(spur),
        lastDeliveryShortfallJ: loop.lastHabitatThermalDeliveryShortfallJ,
      };
    }),
    undeliveredHabitatCoolingJ:
      cooling.snapshot().ledger.undeliveredHabitatCoolingJ,
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

export function waterTelemetry(
  water: WaterRecoveryNetwork,
): WaterRecoveryTelemetry {
  const summary = water.getSummary();
  return {
    controllers: water.listProcessors().map((processor) => ({
      id: processor.id,
      ring: processor.ring,
      commandedThroughputFraction:
        processor.commandedThroughputFraction,
    })),
    distributionSpurs: water.listLoops().map((loop) => {
      const spur = loop.distributionSpur;
      return {
        spurId: spur.id,
        ring: loop.ring,
        condition: spur.condition,
        commandedOpenFraction: spur.commandedOpenFraction,
        effectiveDeliveryFraction: effectiveDeliveryFraction(spur),
        lastDeliveryShortfallKg: loop.lastDeliveryShortfallKg,
      };
    }),
    undeliveredPotableKg: summary.undeliveredPotableKg,
    observed: water.getObservation(),
    truth: {
      loops: water.listLoops(),
      processors: water.listProcessors(),
      summary,
    },
  };
}

export function electricalTelemetry(
  electrical: ShipElectricalNetwork,
): ElectricalTelemetry {
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

export function navigationTelemetry(
  navigation: RigidBodyNavigation,
): NavigationTelemetry {
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

export function currentRotationCarrierState(
  navigation: RigidBodyNavigation,
): RotationCarrierState {
  const body = navigation.getBodyState();
  return {
    angularVelocityXRadPerS:
      body.angularVelocityBodyRadPerS.x,
    inertiaXKgM2:
      navigation.getCurrentInertiaDiagonal().x,
    revision: navigation.revision,
  };
}

export function rotationTelemetry(
  rotation: CounterRotatingHabitat,
): RotationTelemetry {
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

export function projectedElectricalPowerState(
  network: ShipElectricalNetwork,
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

export function projectedThermalNetworkState(
  coolingNetwork: CoolingThermalNetwork,
  compartmentNetwork: CompartmentAtmosphereNetwork,
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

export function assertProjectionClose(
  actual: number,
  expected: number,
  label: string,
): void {
  const tolerance = Math.max(1e-7, Math.abs(expected) * 1e-10);
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label} does not match the authoritative cross-domain projection (${actual} versus ${expected})`,
    );
  }
}

export function assertProjectionAtMost(
  actual: number,
  maximum: number,
  label: string,
): void {
  const tolerance = Math.max(1e-7, Math.abs(maximum) * 1e-10);
  if (actual > maximum + tolerance) {
    throw new Error(
      `${label} exceeds its authoritative upstream request (${actual} versus ${maximum})`,
    );
  }
}

export function maintenanceTelemetry(
  maintenance: MaintenanceNetwork,
  conditions: MaintenanceConditionRecord,
): MaintenanceTelemetry {
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
    truth: { conditions },
  };
}

export function projectWorkerState(
  input: WorkerStateProjectionInput,
): SimulationWorkerState {
  const {
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
    maintenanceConditions,
    llmOrchestration,
    passengerSociety,
    departmentInbox,
  } = input;
  const compartmentState = compartmentTelemetry({
    compartments,
    lastCompartmentStep,
    requestedTimeScale,
    effectiveTimeScale,
  });
  const compartmentByZoneId = new Map(
    compartmentState.zones.map((zone) => [zone.zoneId, zone]),
  );
  const roster = passengers.getAllPassengers();
  // One-pass indexes: avoid O(key×roster) circle assembly each tick.
  const passengerById = new Map<string, Passenger>();
  const familyMembersById = new Map<string, Passenger[]>();
  const zoneMoodAccum = new Map<
    string,
    {
      awakeCount: number;
      stressSum: number;
      trustSum: number;
      physicalSum: number;
    }
  >();
  for (const person of roster) {
    passengerById.set(person.id, person);
    const familyBucket = familyMembersById.get(person.familyId);
    if (familyBucket) {
      familyBucket.push(person);
    } else {
      familyMembersById.set(person.familyId, [person]);
    }
    if (person.lifeState !== "awake") continue;
    const zoneId = currentZoneForPerson(person);
    const mood = zoneMoodAccum.get(zoneId);
    if (mood) {
      mood.awakeCount += 1;
      mood.stressSum += person.psychology.stress;
      mood.trustSum += person.experience.trust;
      mood.physicalSum += person.health.physical;
    } else {
      zoneMoodAccum.set(zoneId, {
        awakeCount: 1,
        stressSum: person.psychology.stress,
        trustSum: person.experience.trust,
        physicalSum: person.health.physical,
      });
    }
  }
  const zoneMood = [...zoneMoodAccum.entries()]
    .map(([zoneId, mood]) => ({
      zoneId,
      awakeCount: mood.awakeCount,
      meanStress: mood.stressSum / mood.awakeCount,
      meanTrust: mood.trustSum / mood.awakeCount,
      meanPhysicalHealth: mood.physicalSum / mood.awakeCount,
    }))
    .sort((left, right) => left.zoneId.localeCompare(right.zoneId));
  const keyPassengers = roster
    .filter((person) => person.isKeyLlm)
    .sort(
      (left, right) => (left.keyLlmSlot ?? 0) - (right.keyLlmSlot ?? 0),
    );
  // Deterministic circle order: family before peer, then passengerId ascending.
  const passengerCircles = keyPassengers
    .map((person) => {
      const claimed = new Set<string>([person.id]);
      const familyMembers: Array<{
        passengerId: string;
        displayName: string;
        relation: "family";
        lifeState: Passenger["lifeState"];
        physicalHealth: number;
        zoneId: string;
      }> = [];
      const relatives = (familyMembersById.get(person.familyId) ?? [])
        .filter((relative) => relative.id !== person.id)
        .sort((left, right) => left.id.localeCompare(right.id));
      for (const relative of relatives) {
        claimed.add(relative.id);
        familyMembers.push({
          passengerId: relative.id,
          displayName: relative.name,
          relation: "family",
          lifeState: relative.lifeState,
          physicalHealth: relative.health.physical,
          zoneId: currentZoneForPerson(relative),
        });
      }
      const peerMembers: Array<{
        passengerId: string;
        displayName: string;
        relation: "peer";
        lifeState: Passenger["lifeState"];
        physicalHealth: number;
        zoneId: string;
      }> = [];
      const peerIds = [...person.relationshipIds].sort((left, right) =>
        left.localeCompare(right),
      );
      for (const relatedId of peerIds) {
        if (claimed.has(relatedId)) continue;
        const related = passengerById.get(relatedId);
        if (!related) continue;
        claimed.add(relatedId);
        peerMembers.push({
          passengerId: related.id,
          displayName: related.name,
          relation: "peer",
          lifeState: related.lifeState,
          physicalHealth: related.health.physical,
          zoneId: currentZoneForPerson(related),
        });
      }
      return {
        passengerId: person.id,
        members: [...familyMembers, ...peerMembers].slice(0, 6),
      };
    })
    .sort((left, right) =>
      left.passengerId.localeCompare(right.passengerId),
    );
  return {
    elapsedSeconds: engine.elapsedSeconds,
    state: engine.getState(),
    passengers: passengers.getPopulationSummary(),
    passengerHighlights: keyPassengers.map((person) => {
      const zoneId = currentZoneForPerson(person);
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
        zoneObservationAgeSeconds: zone.newestSampleAgeSeconds,
        lifeState: person.lifeState,
        physicalHealth: person.health.physical,
        medicalStability: person.health.resilience,
        psychologicalStability: person.psychology.stability,
        stress: person.psychology.stress,
        trust: person.experience.trust,
        isKeyLlm: person.isKeyLlm,
      };
    }),
    zoneMood,
    passengerCircles,
    compartments: compartmentState,
    cooling: coolingTelemetry(cooling),
    electrical: electricalTelemetry(electrical),
    navigation: navigationTelemetry(navigation),
    rotation: rotationTelemetry(rotation),
    waterRecovery: waterTelemetry(water),
    maintenance: maintenanceTelemetry(
      maintenance,
      maintenanceConditions,
    ),
    operations: captainOperations.snapshot(),
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
    timeControl: {
      timeScale: timeDirector.timeScale,
      effectiveTimeScale: timeDirector.isPaused
        ? 0
        : timeDirector.lastEffectiveTimeScale,
      paused: timeDirector.isPaused,
      pauseTokens: [...timeDirector.pauseTokens],
      reachedBlockingBoundary: lastReachedBlockingBoundary
        ? { ...lastReachedBlockingBoundary }
        : null,
      owedSimSeconds: timeDirector.owedSimSeconds,
      fidelityLocked: timeDirector.fidelityLocked,
      droppedSimSecondsCumulative: timeDirector.droppedSimSecondsCumulative,
    },
    proceduralEvents: lastProceduralEvents.map((event) => ({ ...event })),
    survival: {
      rationFoodConsumedKg: survivalLedger.rationFoodConsumedKg,
      starvationExposurePersonSeconds:
        survivalLedger.starvationExposurePersonSeconds,
      foodDryKg: engine.getState().consumables.foodDryKg,
    },
    hullConsequence: hullConsequence.getTelemetry(
      engine.elapsedMicroseconds,
      compartments.listBreaches(),
    ),
    ...(llmOrchestration !== undefined
      ? { llmOrchestration }
      : {}),
    ...(passengerSociety !== undefined
      ? { passengerSociety }
      : {}),
    ...(departmentInbox !== undefined
      ? { departmentInbox }
      : {}),
  };
}
