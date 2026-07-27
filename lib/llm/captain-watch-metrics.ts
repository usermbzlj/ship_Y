import type {
  ConditionBand,
  StressBand,
  TrustBand,
} from "./passenger-society.ts";

/** 与 key-passenger-polling 分档阈值保持一致（该模块未导出分档函数）。 */
export function passengerConditionBand(value: number): ConditionBand {
  if (value >= 0.75) return "stable";
  if (value >= 0.45) return "watch";
  return "critical";
}

export function passengerStressBand(value: number): StressBand {
  if (value <= 0.35) return "low";
  if (value <= 0.7) return "moderate";
  return "high";
}

export function passengerTrustBand(value: number): TrustBand {
  if (value >= 0.7) return "high";
  if (value >= 0.4) return "mixed";
  return "low";
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function sumFiniteRecordValues(
  value: unknown,
): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const values = Object.values(value).filter(isFiniteNumber);
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, entry) => total + entry, 0);
}

/** 只从授权观测取可监视量；缺席字段给 null，不读 Worker 真值旁路。 */
export function extractCaptainWatchMetricSample(
  observation: {
    sensorView: {
      hullThreat: { hullIntegrity: number | null };
      coolantSensorK: number | null;
      batteryStateOfChargeSensorFraction: number | null;
      waterRecoverySensors: Record<string, unknown>;
      maintenanceDiagnostics: Record<string, unknown>;
      lowestZonePressureSensorPa: number | null;
      highestZoneCarbonDioxideSensorPa: number | null;
    };
    delayedAuthorizedRecords: {
      jumpControllerRecord: Record<string, unknown>;
      crewManifestRecord: Record<string, unknown>;
    };
    operationsLedger: Record<string, unknown>;
  },
): Record<string, number | null> {
  const waterSensors = observation.sensorView.waterRecoverySensors;
  const potableWaterKg =
    waterSensors.availability === "available"
      ? sumFiniteRecordValues(waterSensors.potableKgByRing)
      : null;

  const diagnostics = observation.sensorView.maintenanceDiagnostics;
  const openMaintenanceTaskCount = Array.isArray(diagnostics.activeTasks)
    ? diagnostics.activeTasks.length
    : null;

  const manifest = observation.delayedAuthorizedRecords.crewManifestRecord;
  const awakePopulation =
    manifest.availability === "available" &&
    isFiniteNumber(manifest.awakeRegistered)
      ? manifest.awakeRegistered
      : null;

  const ledgerUnavailable =
    observation.operationsLedger.availability === "unavailable";
  const atmosphereReserveKg = ledgerUnavailable
    ? null
    : sumFiniteRecordValues(
        observation.operationsLedger.atmosphereReserveKg,
      );
  const dryFoodKg =
    ledgerUnavailable ||
    !isFiniteNumber(observation.operationsLedger.foodDryKg)
      ? null
      : observation.operationsLedger.foodDryKg;
  const meanPassengerStress =
    ledgerUnavailable ||
    !isFiniteNumber(observation.operationsLedger.meanPassengerStress)
      ? null
      : observation.operationsLedger.meanPassengerStress;

  // 舱区大气传感器投影为 Pa；观察哨目录要求 kPa。
  const lowestZonePressureKpa = isFiniteNumber(
    observation.sensorView.lowestZonePressureSensorPa,
  )
    ? observation.sensorView.lowestZonePressureSensorPa / 1_000
    : null;
  const highestZoneCarbonDioxideKpa = isFiniteNumber(
    observation.sensorView.highestZoneCarbonDioxideSensorPa,
  )
    ? observation.sensorView.highestZoneCarbonDioxideSensorPa / 1_000
    : null;

  const jumpRecord =
    observation.delayedAuthorizedRecords.jumpControllerRecord;
  const jumpDriveChargeFraction =
    jumpRecord.availability === "available" &&
    isFiniteNumber(jumpRecord.jumpDriveChargeEstimateKWh) &&
    isFiniteNumber(jumpRecord.jumpDriveCapacityKWh) &&
    jumpRecord.jumpDriveCapacityKWh > 0
      ? jumpRecord.jumpDriveChargeEstimateKWh /
        jumpRecord.jumpDriveCapacityKWh
      : null;

  return {
    hullIntegrity: observation.sensorView.hullThreat.hullIntegrity,
    lowestZonePressureKpa,
    highestZoneCarbonDioxideKpa,
    coolantBusTemperatureK: observation.sensorView.coolantSensorK,
    batteryStateOfChargeFraction:
      observation.sensorView.batteryStateOfChargeSensorFraction,
    jumpDriveChargeFraction,
    potableWaterKg,
    dryFoodKg,
    atmosphereReserveKg,
    awakePopulation,
    meanPassengerStress,
    openMaintenanceTaskCount,
  };
}
