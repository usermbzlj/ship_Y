/**
 * Shared jump-interlock math used by the worker executor and captain
 * authorized-observation projection. Keep formulas identical so the captain
 * sees the same thermal prediction the device layer will enforce.
 */

/** Matches cooling baseline `thermal-bus.heatCapacityJPerK`. */
export const JUMP_THERMAL_BUS_HEAT_CAPACITY_J_PER_K = 30_000_000_000;

/** Device-layer ceiling used by execute-jump thermal projection. */
export const JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K = 375;

/** Fraction of jump electrical energy dumped as waste heat onto the thermal bus. */
export const JUMP_WASTE_HEAT_FRACTION = 0.008;

export function jumpEnergyConsumedKWh(input: {
  requiredChargePerJumpKWh: number;
  distanceLightYears: number;
}): number {
  const distance = Math.max(0, input.distanceLightYears);
  return (
    input.requiredChargePerJumpKWh *
    (0.35 + 0.65 * (distance / 5) ** 2)
  );
}

export function projectJumpThermalBusTemperatureK(input: {
  thermalBusTemperatureK: number;
  energyConsumedKWh: number;
  heatCapacityJPerK?: number;
}): number {
  const heatCapacityJPerK =
    input.heatCapacityJPerK ?? JUMP_THERMAL_BUS_HEAT_CAPACITY_J_PER_K;
  const projectedWasteHeatJ =
    input.energyConsumedKWh * 3_600_000 * JUMP_WASTE_HEAT_FRACTION;
  return input.thermalBusTemperatureK + projectedWasteHeatJ / heatCapacityJPerK;
}

export type JumpThermalProjection = {
  assumedDistanceLightYears: number;
  energyConsumedKWh: number;
  thermalBusSensorK: number;
  projectedTemperatureK: number;
  maximumSafeTemperatureK: number;
  clearsInterlock: boolean;
  blockReason: string | null;
};

/**
 * Estimate whether a candidate jump distance would trip the thermal-bus
 * projection interlock. Uses the same formula as the worker executor.
 */
export function estimateJumpThermalProjection(input: {
  thermalBusTemperatureK: number | null | undefined;
  requiredChargePerJumpKWh: number;
  distanceLightYears: number;
  heatCapacityJPerK?: number;
}): JumpThermalProjection | null {
  if (
    input.thermalBusTemperatureK === null ||
    input.thermalBusTemperatureK === undefined ||
    !Number.isFinite(input.thermalBusTemperatureK) ||
    !Number.isFinite(input.requiredChargePerJumpKWh) ||
    !Number.isFinite(input.distanceLightYears)
  ) {
    return null;
  }
  const energyConsumedKWh = jumpEnergyConsumedKWh({
    requiredChargePerJumpKWh: input.requiredChargePerJumpKWh,
    distanceLightYears: input.distanceLightYears,
  });
  const projectedTemperatureK = projectJumpThermalBusTemperatureK({
    thermalBusTemperatureK: input.thermalBusTemperatureK,
    energyConsumedKWh,
    heatCapacityJPerK: input.heatCapacityJPerK,
  });
  const clearsInterlock =
    projectedTemperatureK <= JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K;
  return {
    assumedDistanceLightYears: input.distanceLightYears,
    energyConsumedKWh,
    thermalBusSensorK: input.thermalBusTemperatureK,
    projectedTemperatureK,
    maximumSafeTemperatureK: JUMP_MAXIMUM_THERMAL_BUS_TEMPERATURE_K,
    clearsInterlock,
    blockReason: clearsInterlock
      ? null
      : "推进热预测超过主热汇流排安全联锁上限",
  };
}
