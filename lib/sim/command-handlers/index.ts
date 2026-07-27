/**
 * Table-driven ship operational command handler registry.
 *
 * Mapped-type exhaustiveness: omitting any ShipCommandKind from
 * SHIP_COMMAND_HANDLERS is a compile error.
 */

import type {
  ShipOperationalCommand,
  ShipOperationalCommandResult,
} from "../protocol.ts";
import type {
  CommandHandler,
  CommandHandlerContext,
  ShipCommandKind,
} from "./types.ts";
import {
  handleExecuteJump,
  handleScheduleThrusterPulse,
  handleScheduleThrusterManeuver,
} from "./propulsion.ts";
import {
  handleSetReactorTarget,
  handleSetReactorMode,
  handleSetElectricalLoadEnabled,
  handleSetElectricalBreaker,
  handleSetBatteryMode,
  handleResetProtection,
  handleSetPowerAllocation,
} from "./electrical.ts";
import {
  handleIsolatePressureZone,
  handleSetCoolingPumpSpeed,
  handleSetHabitatRingControl,
  handleSetAirHandlerControl,
  handleSetWaterProcessorControl,
  handleConfigureWaterDistributionSpur,
  handleConfigureHabitatThermalDeliverySpur,
  handleSetCompartmentConnection,
  handleSetThermalControl,
  handleSetAtmosphereSupply,
  handleSetOxygenProduction,
  handleDistributeWater,
} from "./thermal-life-support.ts";
import {
  handleScheduleMaintenance,
  handleReviseMission,
  handleManageDepartmentOrder,
  handlePublishCommunication,
  handleFilePassengerGrievance,
  handleManageCrewAssignment,
  handleManagePerson,
  handleManageSecurity,
  handleManageLogistics,
  handleScheduleHullRepair,
  handleManageMaintenanceTask,
  handleManageSensorOperation,
  handleManageRemoteAsset,
  handleSetAwakeTarget,
} from "./operations.ts";

export type {
  CommandHandler,
  CommandHandlerContext,
  ShipCommandKind,
} from "./types.ts";

export const SHIP_COMMAND_HANDLERS: {
  [K in ShipCommandKind]: CommandHandler<K>;
} = {
  "execute-jump": handleExecuteJump,
  "isolate-pressure-zone": handleIsolatePressureZone,
  "schedule-thruster-pulse": handleScheduleThrusterPulse,
  "schedule-thruster-maneuver": handleScheduleThrusterManeuver,
  "set-reactor-target": handleSetReactorTarget,
  "set-reactor-mode": handleSetReactorMode,
  "set-cooling-pump-speed": handleSetCoolingPumpSpeed,
  "set-electrical-load-enabled": handleSetElectricalLoadEnabled,
  "set-electrical-breaker": handleSetElectricalBreaker,
  "set-battery-mode": handleSetBatteryMode,
  "set-habitat-ring-control": handleSetHabitatRingControl,
  "set-air-handler-control": handleSetAirHandlerControl,
  "set-water-processor-control": handleSetWaterProcessorControl,
  "configure-water-distribution-spur": handleConfigureWaterDistributionSpur,
  "configure-habitat-thermal-delivery-spur": handleConfigureHabitatThermalDeliverySpur,
  "schedule-maintenance": handleScheduleMaintenance,
  "revise-mission": handleReviseMission,
  "manage-department-order": handleManageDepartmentOrder,
  "publish-communication": handlePublishCommunication,
  "file-passenger-grievance": handleFilePassengerGrievance,
  "manage-crew-assignment": handleManageCrewAssignment,
  "manage-person": handleManagePerson,
  "manage-security": handleManageSecurity,
  "manage-logistics": handleManageLogistics,
  "set-compartment-connection": handleSetCompartmentConnection,
  "schedule-hull-repair": handleScheduleHullRepair,
  "set-thermal-control": handleSetThermalControl,
  "set-atmosphere-supply": handleSetAtmosphereSupply,
  "set-oxygen-production": handleSetOxygenProduction,
  "distribute-water": handleDistributeWater,
  "reset-protection": handleResetProtection,
  "manage-maintenance-task": handleManageMaintenanceTask,
  "manage-sensor-operation": handleManageSensorOperation,
  "manage-remote-asset": handleManageRemoteAsset,
  "set-power-allocation": handleSetPowerAllocation,
  "set-awake-target": handleSetAwakeTarget,
};

export function executeShipCommand(
  command: ShipOperationalCommand,
  context: CommandHandlerContext,
  executionId: string,
): ShipOperationalCommandResult {
  const handler = SHIP_COMMAND_HANDLERS[command.kind] as CommandHandler<
    typeof command.kind
  >;
  return handler(
    command as Extract<ShipOperationalCommand, { kind: typeof command.kind }>,
    context,
    executionId,
  );
}
