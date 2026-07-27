/**
 * Types for the table-driven ship operational command handler registry.
 */

import type { SimulationEngine } from "../index.ts";
import type { PassengerSimulation } from "../passengers.ts";
import type {
  AirHandlerId,
  CompartmentAtmosphereNetwork,
  ZoneId,
} from "../compartments.ts";
import type { CoolingThermalNetwork } from "../cooling.ts";
import type {
  ElectricalLoadId,
  ShipElectricalNetwork,
} from "../electrical.ts";
import type { RigidBodyNavigation } from "../navigation.ts";
import type {
  CounterRotatingHabitat,
  RotationCarrierState,
} from "../rotation.ts";
import type {
  WaterProcessorId,
  WaterRecoveryNetwork,
} from "../water.ts";
import type {
  MaintenanceConditionRecord,
  MaintenanceNetwork,
} from "../maintenance.ts";
import type { HullConsequenceNetwork } from "../hull-consequence.ts";
import type {
  CaptainOperations,
  CaptainOperationsSnapshot,
} from "../captain-operations.ts";
import type {
  ShipOperationalCommand,
  ShipOperationalCommandResult,
} from "../protocol.ts";

export type ShipCommandKind = ShipOperationalCommand["kind"];

export type CommandHandler<K extends ShipCommandKind> = (
  command: Extract<ShipOperationalCommand, { kind: K }>,
  context: CommandHandlerContext,
  executionId: string,
) => ShipOperationalCommandResult;

/**
 * Per-dispatch execution context. Domain network fields must be read from a
 * context constructed (or getter-backed) at dispatch time — worker module
 * `let` bindings are replaced wholesale on initialize/restore.
 */
export interface CommandHandlerContext {
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

  synchronizeJumpDriveControllerDemand: (intervalSeconds: number) => void;
  synchronizeElectricalAggregate: () => void;
  synchronizeThermalAggregate: () => void;
  synchronizeWaterAggregate: () => void;
  synchronizeAtmosphereAggregate: (capturedCarbonDioxideKg: number) => void;
  synchronizeCompartmentOccupants: () => void;
  currentRotationCarrierState: () => RotationCarrierState;
  currentMaintenanceConditions: () => MaintenanceConditionRecord;
  currentZoneForPerson: (person: { id: string; cabinId: string }) => ZoneId;
  findPersonnelRoute: (
    fromZoneId: ZoneId,
    toZoneId: ZoneId,
    operationsSnapshot: CaptainOperationsSnapshot,
  ) => string[];
  capturedCarbonDioxideTotal: (
    network?: CompartmentAtmosphereNetwork,
  ) => number;

  /** Shared with the electrical coupling tick path in worker.ts. */
  airHandlerLoadById: Readonly<Record<AirHandlerId, ElectricalLoadId>>;
  waterProcessorLoadById: Readonly<
    Record<WaterProcessorId, ElectricalLoadId>
  >;
  jumpDriveLoadIds: readonly ElectricalLoadId[];
}
