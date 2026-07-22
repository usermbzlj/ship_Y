/**
 * Deterministic reduced-order shipboard electrical network.
 *
 * This module is intentionally self-contained. It is designed to become the
 * sole electrical authority when integrated with the aggregate simulation:
 * consumers should project getSummary() into aggregate state, never run a
 * second battery or load-allocation solver in parallel.
 *
 * The model resolves steady power flow on two switchable buses. It does not
 * attempt high-frequency electromagnetic transients, but every reactor,
 * breaker, load and battery is an explicit causal entity. Energy entering and
 * leaving storage is accounted for in a cumulative conservation ledger.
 */

export const ELECTRICAL_SNAPSHOT_VERSION = 4 as const;
export const ELECTRICAL_MICROSECONDS_PER_SECOND = 1_000_000;

export const ELECTRICAL_BUS_IDS = ["bus-a", "bus-b"] as const;
export type ElectricalBusId = (typeof ELECTRICAL_BUS_IDS)[number];

export const FUSION_REACTOR_IDS = [
  "fusion-1",
  "fusion-2",
  "fusion-3",
  "fusion-4",
  "fusion-5",
  "fusion-6",
] as const;
export type FusionReactorId = (typeof FUSION_REACTOR_IDS)[number];

export const ELECTRICAL_BATTERY_IDS = ["battery-a", "battery-b"] as const;
export type ElectricalBatteryId = (typeof ELECTRICAL_BATTERY_IDS)[number];

export const ELECTRICAL_LOAD_IDS = [
  "life-support-a",
  "life-support-b",
  "hibernation-a",
  "hibernation-b",
  "cooling-a",
  "cooling-b",
  "habitat-a",
  "habitat-b",
  "jump-drive-a",
  "jump-drive-b",
  "propulsion-control-a",
  "propulsion-control-b",
  "rotation-drive-a",
  "rotation-drive-b",
] as const;
export type ElectricalLoadId = (typeof ELECTRICAL_LOAD_IDS)[number];

export const ELECTRICAL_BREAKER_IDS = [
  "breaker:fusion-1",
  "breaker:fusion-2",
  "breaker:fusion-3",
  "breaker:fusion-4",
  "breaker:fusion-5",
  "breaker:fusion-6",
  "breaker:battery-a",
  "breaker:battery-b",
  "breaker:life-support-a",
  "breaker:life-support-b",
  "breaker:hibernation-a",
  "breaker:hibernation-b",
  "breaker:cooling-a",
  "breaker:cooling-b",
  "breaker:habitat-a",
  "breaker:habitat-b",
  "breaker:jump-drive-a",
  "breaker:jump-drive-b",
  "breaker:propulsion-control-a",
  "breaker:propulsion-control-b",
  "breaker:rotation-drive-a",
  "breaker:rotation-drive-b",
  "breaker:bus-tie",
] as const;
export type ElectricalBreakerId = (typeof ELECTRICAL_BREAKER_IDS)[number];

export type ReactorMode = "online" | "hot-standby" | "offline";
export type ReactorCondition = "nominal" | "tripped";
export type BreakerCondition = "nominal" | "tripped";
export type BreakerKind = "generator" | "storage" | "load" | "bus-tie";
export type LoadTier = "critical" | "essential" | "discretionary" | "jump";
export type BatteryCondition =
  | "nominal"
  | "degraded"
  | "thermal-lockout"
  | "failed";
export type BatteryControlMode =
  | "automatic"
  | "charge-only"
  | "discharge-only"
  | "standby";
export type ElectricalSensorCondition =
  | "nominal"
  | "degraded"
  | "stuck"
  | "offline";
export type ElectricalSensorQuality = ElectricalSensorCondition;
export type ElectricalSensorQuantity =
  | "voltageV"
  | "frequencyHz"
  | "generationPowerKw"
  | "servedPowerKw"
  | "unservedPowerKw"
  | "reactorOutputKw"
  | "batteryStateOfChargeFraction"
  | "batteryPowerKw";

export interface FusionReactor {
  id: FusionReactorId;
  label: string;
  busId: ElectricalBusId;
  breakerId: ElectricalBreakerId;
  ratedOutputKw: number;
  rampRateKwPerSecond: number;
  mode: ReactorMode;
  condition: ReactorCondition;
  targetOutputKw: number;
  outputKw: number;
  tripReason: string | null;
}

export interface ElectricalBus {
  id: ElectricalBusId;
  label: string;
  nominalVoltageV: number;
  nominalFrequencyHz: number;
  voltageV: number;
  frequencyHz: number;
  energized: boolean;
  generationPowerKw: number;
  batteryPowerKw: number;
  demandedPowerKw: number;
  servedPowerKw: number;
  unservedPowerKw: number;
  curtailedPowerKw: number;
  netTransferPowerKw: number;
}

export interface ElectricalBreaker {
  id: ElectricalBreakerId;
  label: string;
  kind: BreakerKind;
  fromId: string;
  toId: string;
  ratedPowerKw: number;
  commandedClosed: boolean;
  condition: BreakerCondition;
  tripReason: string | null;
  currentPowerKw: number;
}

export interface ElectricalLoad {
  id: ElectricalLoadId;
  label: string;
  busId: ElectricalBusId;
  breakerId: ElectricalBreakerId;
  tier: LoadTier;
  demandedPowerKw: number;
  controllerDemandFraction: number;
  enabled: boolean;
  servedPowerKw: number;
  unservedPowerKw: number;
}

export interface ElectricalBattery {
  id: ElectricalBatteryId;
  label: string;
  busId: ElectricalBusId;
  breakerId: ElectricalBreakerId;
  capacityKWh: number;
  storedEnergyKWh: number;
  maximumChargePowerKw: number;
  maximumDischargePowerKw: number;
  chargeEfficiency: number;
  dischargeEfficiency: number;
  condition: BatteryCondition;
  controlMode: BatteryControlMode;
  lastPowerKw: number;
  throughputKWh: number;
  conversionLossKWh: number;
  faultReason: string | null;
}

export interface ElectricalSensorReading {
  sensorId: string;
  targetId: string;
  quantity: ElectricalSensorQuantity;
  sampledAtMicroseconds: number;
  availableAtMicroseconds: number;
  value: number | null;
  quality: ElectricalSensorQuality;
}

export interface ElectricalSensor {
  id: string;
  targetId: string;
  quantity: ElectricalSensorQuantity;
  sampleIntervalMicroseconds: number;
  delayMicroseconds: number;
  noiseStandardDeviation: number;
  bias: number;
  driftPerSecond: number;
  condition: ElectricalSensorCondition;
  stuckValue: number | null;
  nextSampleMicroseconds: number;
  randomState: number;
  spareNormal: number | null;
  pending: ElectricalSensorReading[];
  latest: ElectricalSensorReading | null;
}

export interface ElectricalEnergyLedger {
  initialStoredEnergyKWh: number;
  reactorGenerationKWh: number;
  servedLoadKWh: number;
  demandedLoadEnergyKWhById: Record<ElectricalLoadId, number>;
  servedLoadEnergyKWhById: Record<ElectricalLoadId, number>;
  curtailedGenerationKWh: number;
  batteryConversionLossKWh: number;
  externalEnergyKWh: number;
  numericalResidualKWh: number;
}

export type ElectricalControlRecordType =
  | "set-reactor-target"
  | "set-reactor-mode"
  | "reset-reactor-trip"
  | "set-breaker"
  | "reset-breaker-trip"
  | "set-load-enabled"
  | "set-battery-mode"
  | "reactor-trip"
  | "breaker-trip"
  | "battery-fault"
  | "battery-energy-injection"
  | "external-generation-force";

export interface ElectricalControlRecord {
  sequence: number;
  simulatedAtMicroseconds: number;
  type: ElectricalControlRecordType;
  targetId: string;
  summary: string;
  reason: string | null;
}

export interface ElectricalNetworkSnapshot {
  snapshotVersion: typeof ELECTRICAL_SNAPSHOT_VERSION;
  elapsedMicroseconds: number;
  revision: number;
  reactors: FusionReactor[];
  buses: ElectricalBus[];
  breakers: ElectricalBreaker[];
  loads: ElectricalLoad[];
  batteries: ElectricalBattery[];
  sensors: ElectricalSensor[];
  ledger: ElectricalEnergyLedger;
  nextControlSequence: number;
  controlLog: ElectricalControlRecord[];
}

export interface ElectricalNetworkOptions {
  seed?: number | string;
}

export interface ElectricalStepResult {
  fromMicroseconds: number;
  toMicroseconds: number;
  simulatedSeconds: number;
  substeps: number;
  reactorGenerationKWh: number;
  servedLoadKWh: number;
  demandedLoadEnergyKWhById: Record<ElectricalLoadId, number>;
  servedLoadEnergyKWhById: Record<ElectricalLoadId, number>;
  curtailedGenerationKWh: number;
  batteryChargeInputKWh: number;
  batteryDischargeOutputKWh: number;
  batteryConversionLossKWh: number;
  storedEnergyChangeKWh: number;
  energyClosureErrorKWh: number;
  minimumCriticalServiceFraction: number;
  revision: number;
}

export interface ElectricalEnergyBalance {
  storedEnergyKWh: number;
  ledgerExpectedStoredEnergyKWh: number;
  closureErrorKWh: number;
  reactorGenerationKWh: number;
  servedLoadKWh: number;
  curtailedGenerationKWh: number;
  batteryConversionLossKWh: number;
  externalEnergyKWh: number;
  numericalResidualKWh: number;
}

export interface ElectricalNetworkSummary {
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
}

export interface ElectricalTierServiceFractions {
  physicalServiceFraction: number;
  controllerRequestedServiceFraction: number;
}

export type ElectricalControlCommand =
  | {
      type: "set-reactor-target";
      reactorId: FusionReactorId;
      targetOutputKw: number;
    }
  | {
      type: "set-reactor-mode";
      reactorId: FusionReactorId;
      mode: ReactorMode;
    }
  | {
      type: "reset-reactor-trip";
      reactorId: FusionReactorId;
    }
  | {
      type: "set-breaker";
      breakerId: ElectricalBreakerId;
      commandedClosed: boolean;
    }
  | {
      type: "reset-breaker-trip";
      breakerId: ElectricalBreakerId;
    }
  | {
      type: "set-load-enabled";
      loadId: ElectricalLoadId;
      enabled: boolean;
    }
  | {
      type: "set-battery-mode";
      batteryId: ElectricalBatteryId;
      mode: BatteryControlMode;
    };

export interface ElectricalControlResult {
  record: ElectricalControlRecord;
  revision: number;
  summary: ElectricalNetworkSummary;
}

export type ElectricalSensorPatch = Partial<
  Pick<
    ElectricalSensor,
    | "sampleIntervalMicroseconds"
    | "delayMicroseconds"
    | "noiseStandardDeviation"
    | "bias"
    | "driftPerSecond"
    | "condition"
    | "stuckValue"
  >
>;

export interface ExternalBatteryEnergyResult {
  batteryId: ElectricalBatteryId;
  appliedEnergyKWh: number;
  revision: number;
}

const MAX_PHYSICS_SUBSTEP_MICROSECONDS =
  60 * ELECTRICAL_MICROSECONDS_PER_SECOND;
const MIN_SENSOR_INTERVAL_MICROSECONDS = 100_000;
const MAX_SENSOR_DELAY_MICROSECONDS =
  3_600 * ELECTRICAL_MICROSECONDS_PER_SECOND;
const MAX_ENERGY_KWH = 10_000_000_000_000;
const DEFAULT_SENSOR_INTERVAL_MICROSECONDS =
  10 * ELECTRICAL_MICROSECONDS_PER_SECOND;
const DEFAULT_SENSOR_DELAY_MICROSECONDS =
  20 * ELECTRICAL_MICROSECONDS_PER_SECOND;

const TIER_ORDER: Readonly<Record<LoadTier, number>> = Object.freeze({
  critical: 0,
  essential: 1,
  discretionary: 2,
  jump: 3,
});

interface BreakerTopology {
  id: ElectricalBreakerId;
  label: string;
  kind: BreakerKind;
  fromId: string;
  toId: string;
  ratedPowerKw: number;
  commandedClosed: boolean;
}

const BASELINE_BREAKER_TOPOLOGY: readonly Readonly<BreakerTopology>[] =
  Object.freeze([
    {
      id: "breaker:fusion-1",
      label: "聚变模块 1 发电断路器",
      kind: "generator",
      fromId: "fusion-1",
      toId: "bus-a",
      ratedPowerKw: 240_000,
      commandedClosed: true,
    },
    {
      id: "breaker:fusion-2",
      label: "聚变模块 2 发电断路器",
      kind: "generator",
      fromId: "fusion-2",
      toId: "bus-a",
      ratedPowerKw: 240_000,
      commandedClosed: true,
    },
    {
      id: "breaker:fusion-3",
      label: "聚变模块 3 发电断路器",
      kind: "generator",
      fromId: "fusion-3",
      toId: "bus-b",
      ratedPowerKw: 240_000,
      commandedClosed: true,
    },
    {
      id: "breaker:fusion-4",
      label: "聚变模块 4 发电断路器",
      kind: "generator",
      fromId: "fusion-4",
      toId: "bus-b",
      ratedPowerKw: 240_000,
      commandedClosed: true,
    },
    {
      id: "breaker:fusion-5",
      label: "聚变模块 5 发电断路器",
      kind: "generator",
      fromId: "fusion-5",
      toId: "bus-a",
      ratedPowerKw: 240_000,
      commandedClosed: false,
    },
    {
      id: "breaker:fusion-6",
      label: "聚变模块 6 发电断路器",
      kind: "generator",
      fromId: "fusion-6",
      toId: "bus-b",
      ratedPowerKw: 240_000,
      commandedClosed: false,
    },
    {
      id: "breaker:battery-a",
      label: "A 组储能断路器",
      kind: "storage",
      fromId: "battery-a",
      toId: "bus-a",
      ratedPowerKw: 200_000,
      commandedClosed: true,
    },
    {
      id: "breaker:battery-b",
      label: "B 组储能断路器",
      kind: "storage",
      fromId: "battery-b",
      toId: "bus-b",
      ratedPowerKw: 200_000,
      commandedClosed: true,
    },
    ...ELECTRICAL_LOAD_IDS.map((loadId) => {
      const busId: ElectricalBusId = loadId.endsWith("-a") ? "bus-a" : "bus-b";
      return {
        id: `breaker:${loadId}` as ElectricalBreakerId,
        label: `${loadId} 负载断路器`,
        kind: "load" as const,
        fromId: busId,
        toId: loadId,
        ratedPowerKw: loadId.startsWith("jump-drive")
          ? 140_000
          : loadId.startsWith("propulsion-control")
            ? 60_000
            : loadId.startsWith("rotation-drive")
              ? 8_000
            : 125_000,
        commandedClosed: true,
      };
    }),
    {
      id: "breaker:bus-tie",
      label: "A/B 主母线联络断路器",
      kind: "bus-tie",
      fromId: "bus-a",
      toId: "bus-b",
      ratedPowerKw: 500_000,
      commandedClosed: true,
    },
  ]);

interface LoadSpecification {
  id: ElectricalLoadId;
  label: string;
  busId: ElectricalBusId;
  tier: LoadTier;
  demandedPowerKw: number;
}

const BASELINE_LOAD_SPECS: readonly Readonly<LoadSpecification>[] =
  Object.freeze([
    {
      id: "life-support-a",
      label: "A 区生命保障",
      busId: "bus-a",
      tier: "critical",
      demandedPowerKw: 105_000,
    },
    {
      id: "life-support-b",
      label: "B 区生命保障",
      busId: "bus-b",
      tier: "critical",
      demandedPowerKw: 105_000,
    },
    {
      id: "hibernation-a",
      label: "A 区休眠维持",
      busId: "bus-a",
      tier: "critical",
      demandedPowerKw: 45_000,
    },
    {
      id: "hibernation-b",
      label: "B 区休眠维持",
      busId: "bus-b",
      tier: "critical",
      demandedPowerKw: 45_000,
    },
    {
      id: "cooling-a",
      label: "A 冷却回路",
      busId: "bus-a",
      tier: "essential",
      demandedPowerKw: 60_000,
    },
    {
      id: "cooling-b",
      label: "B 冷却回路",
      busId: "bus-b",
      tier: "essential",
      demandedPowerKw: 60_000,
    },
    {
      id: "habitat-a",
      label: "A 居住与工业服务",
      busId: "bus-a",
      tier: "discretionary",
      demandedPowerKw: 80_000,
    },
    {
      id: "habitat-b",
      label: "B 居住与工业服务",
      busId: "bus-b",
      tier: "discretionary",
      demandedPowerKw: 80_000,
    },
    {
      id: "jump-drive-a",
      label: "跃迁储能 A 馈线",
      busId: "bus-a",
      tier: "jump",
      demandedPowerKw: 120_000,
    },
    {
      id: "jump-drive-b",
      label: "跃迁储能 B 馈线",
      busId: "bus-b",
      tier: "jump",
      demandedPowerKw: 120_000,
    },
    {
      id: "propulsion-control-a",
      label: "A 路聚变火炬控制辅机",
      busId: "bus-a",
      tier: "essential",
      demandedPowerKw: 60_000,
    },
    {
      id: "propulsion-control-b",
      label: "B 路聚变火炬控制辅机",
      busId: "bus-b",
      tier: "essential",
      demandedPowerKw: 60_000,
    },
    {
      id: "rotation-drive-a",
      label: "A 居住环驱动与制动",
      busId: "bus-a",
      tier: "essential",
      demandedPowerKw: 7_500,
    },
    {
      id: "rotation-drive-b",
      label: "B 居住环驱动与制动",
      busId: "bus-b",
      tier: "essential",
      demandedPowerKw: 7_500,
    },
  ]);

interface SensorSpecification {
  id: string;
  targetId: string;
  quantity: ElectricalSensorQuantity;
  noiseStandardDeviation: number;
}

const BASELINE_SENSOR_SPECS: readonly Readonly<SensorSpecification>[] =
  Object.freeze([
    ...ELECTRICAL_BUS_IDS.flatMap((busId) => [
      {
        id: `sensor:${busId}:voltageV`,
        targetId: busId,
        quantity: "voltageV" as const,
        noiseStandardDeviation: 3,
      },
      {
        id: `sensor:${busId}:frequencyHz`,
        targetId: busId,
        quantity: "frequencyHz" as const,
        noiseStandardDeviation: 0.005,
      },
      {
        id: `sensor:${busId}:servedPowerKw`,
        targetId: busId,
        quantity: "servedPowerKw" as const,
        noiseStandardDeviation: 80,
      },
    ]),
    ...FUSION_REACTOR_IDS.map((reactorId) => ({
      id: `sensor:${reactorId}:reactorOutputKw`,
      targetId: reactorId,
      quantity: "reactorOutputKw" as const,
      noiseStandardDeviation: 60,
    })),
    ...ELECTRICAL_BATTERY_IDS.flatMap((batteryId) => [
      {
        id: `sensor:${batteryId}:batteryStateOfChargeFraction`,
        targetId: batteryId,
        quantity: "batteryStateOfChargeFraction" as const,
        noiseStandardDeviation: 0.0001,
      },
      {
        id: `sensor:${batteryId}:batteryPowerKw`,
        targetId: batteryId,
        quantity: "batteryPowerKw" as const,
        noiseStandardDeviation: 40,
      },
    ]),
  ]);

const BASELINE_SENSOR_IDS = Object.freeze(
  BASELINE_SENSOR_SPECS.map((specification) => specification.id),
);

interface IntervalEnergy {
  reactorGenerationKWh: number;
  servedLoadKWh: number;
  demandedLoadEnergyKWhById: Record<ElectricalLoadId, number>;
  servedLoadEnergyKWhById: Record<ElectricalLoadId, number>;
  curtailedGenerationKWh: number;
  batteryChargeInputKWh: number;
  batteryDischargeOutputKWh: number;
  batteryConversionLossKWh: number;
  storedEnergyChangeKWh: number;
  numericalResidualKWh: number;
  criticalServiceFraction: number;
}

function cloneData<T>(value: T): T {
  return structuredClone(value);
}

function emptyLoadEnergyRecord(): Record<ElectricalLoadId, number> {
  return Object.fromEntries(
    ELECTRICAL_LOAD_IDS.map((loadId) => [loadId, 0]),
  ) as Record<ElectricalLoadId, number>;
}

function effectiveLoadDemandPowerKw(load: ElectricalLoad): number {
  return load.demandedPowerKw * load.controllerDemandFraction;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const expected = [...expectedKeys].sort();
  const actual = Object.keys(value).sort();
  if (
    expected.length !== actual.length ||
    expected.some((key, index) => key !== actual[index])
  ) {
    throw new Error(
      `${label} has unexpected keys; expected ${expected.join(", ")}, received ${actual.join(", ")}`,
    );
  }
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

function assertNonNegative(value: unknown, label: string): asserts value is number {
  assertFinite(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative`);
  }
}

function assertPositive(value: unknown, label: string): asserts value is number {
  assertFinite(value, label);
  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero`);
  }
}

function assertFraction(value: unknown, label: string): asserts value is number {
  assertFinite(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be between zero and one`);
  }
}

function assertSafeInteger(
  value: unknown,
  label: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function assertBoolean(
  value: unknown,
  label: string,
): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
}

function assertNullableString(
  value: unknown,
  label: string,
): asserts value is string | null {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null`);
  }
}

function assertEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): asserts value is T {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw new RangeError(`${label} must be one of ${values.join(", ")}`);
  }
}

function assertSafeMicroseconds(value: unknown, label: string): void {
  assertSafeInteger(value, label);
}

function findById<T extends { id: string }>(
  entities: readonly T[],
  id: string,
  label: string,
): T {
  const entity = entities.find((candidate) => candidate.id === id);
  if (!entity) {
    throw new RangeError(`unknown ${label}: ${id}`);
  }
  return entity;
}

function breakerIsClosed(breaker: ElectricalBreaker): boolean {
  return breaker.condition === "nominal" && breaker.commandedClosed;
}

function hashSeed(seed: number | string): number {
  const text = String(seed);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function nextUniform(sensor: ElectricalSensor): number {
  let state = (sensor.randomState + 0x6d2b79f5) >>> 0;
  sensor.randomState = state;
  state = Math.imul(state ^ (state >>> 15), state | 1);
  state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
  return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
}

function nextNormal(sensor: ElectricalSensor): number {
  if (sensor.spareNormal !== null) {
    const spare = sensor.spareNormal;
    sensor.spareNormal = null;
    return spare;
  }
  const first = Math.max(Number.MIN_VALUE, nextUniform(sensor));
  const second = nextUniform(sensor);
  const magnitude = Math.sqrt(-2 * Math.log(first));
  const angle = 2 * Math.PI * second;
  sensor.spareNormal = magnitude * Math.sin(angle);
  return magnitude * Math.cos(angle);
}

function totalStoredEnergy(snapshot: ElectricalNetworkSnapshot): number {
  return snapshot.batteries.reduce(
    (total, battery) => total + battery.storedEnergyKWh,
    0,
  );
}

function expectedStoredEnergyBeforeNumericalResidualKWh(
  ledger: ElectricalEnergyLedger,
): number {
  return (
    ledger.initialStoredEnergyKWh +
    ledger.reactorGenerationKWh -
    ledger.servedLoadKWh -
    ledger.curtailedGenerationKWh -
    ledger.batteryConversionLossKWh +
    ledger.externalEnergyKWh
  );
}

function reconcileNumericalEnergyResidual(
  snapshot: ElectricalNetworkSnapshot,
): void {
  snapshot.ledger.numericalResidualKWh =
    totalStoredEnergy(snapshot) -
    expectedStoredEnergyBeforeNumericalResidualKWh(snapshot.ledger);
}

function conditionPowerFraction(condition: BatteryCondition): number {
  switch (condition) {
    case "nominal":
      return 1;
    case "degraded":
      return 0.5;
    case "thermal-lockout":
    case "failed":
      return 0;
  }
}

function canBatteryCharge(battery: ElectricalBattery): boolean {
  return (
    conditionPowerFraction(battery.condition) > 0 &&
    (battery.controlMode === "automatic" ||
      battery.controlMode === "charge-only")
  );
}

function canBatteryDischarge(battery: ElectricalBattery): boolean {
  return (
    conditionPowerFraction(battery.condition) > 0 &&
    (battery.controlMode === "automatic" ||
      battery.controlMode === "discharge-only")
  );
}

function physicalServiceFractionForTier(
  loads: readonly ElectricalLoad[],
  tier: LoadTier,
): number {
  const selected = loads.filter((load) => load.tier === tier);
  const demanded = selected.reduce(
    (total, load) =>
      total +
      (load.id.startsWith("propulsion-control")
        ? effectiveLoadDemandPowerKw(load)
        : load.demandedPowerKw),
    0,
  );
  if (demanded === 0) return 1;
  return (
    selected.reduce((total, load) => total + load.servedPowerKw, 0) / demanded
  );
}

function controllerRequestedServiceFractionForTier(
  loads: readonly ElectricalLoad[],
  tier: LoadTier,
): number {
  const selected = loads.filter(
    (load) => load.tier === tier && load.enabled,
  );
  const requested = selected.reduce(
    (total, load) => total + effectiveLoadDemandPowerKw(load),
    0,
  );
  if (requested === 0) return 1;
  return (
    selected.reduce((total, load) => total + load.servedPowerKw, 0) /
    requested
  );
}

function connectedIslands(
  snapshot: ElectricalNetworkSnapshot,
): ElectricalBusId[][] {
  const tie = findById(snapshot.breakers, "breaker:bus-tie", "breaker");
  return breakerIsClosed(tie)
    ? [["bus-a", "bus-b"]]
    : [["bus-a"], ["bus-b"]];
}

function advanceReactorOutputs(
  snapshot: ElectricalNetworkSnapshot,
  deltaSeconds: number,
): void {
  for (const reactor of snapshot.reactors) {
    if (reactor.condition === "tripped") {
      reactor.outputKw = 0;
      continue;
    }
    const effectiveTarget =
      reactor.mode === "online" ? reactor.targetOutputKw : 0;
    const maximumChange = reactor.rampRateKwPerSecond * deltaSeconds;
    if (reactor.outputKw < effectiveTarget) {
      reactor.outputKw = Math.min(
        effectiveTarget,
        reactor.outputKw + maximumChange,
      );
    } else if (reactor.outputKw > effectiveTarget) {
      reactor.outputKw = Math.max(
        effectiveTarget,
        reactor.outputKw - maximumChange,
      );
    }
  }
}

function assignTwoBusNetTransferPowerKw(
  first: ElectricalBus,
  second: ElectricalBus,
): void {
  first.netTransferPowerKw =
    first.servedPowerKw +
    first.curtailedPowerKw -
    first.generationPowerKw -
    first.batteryPowerKw;
  second.netTransferPowerKw =
    second.servedPowerKw +
    second.curtailedPowerKw -
    second.generationPowerKw -
    second.batteryPowerKw;
}

function dispatchPower(
  snapshot: ElectricalNetworkSnapshot,
  deltaHours: number,
): Omit<IntervalEnergy, "storedEnergyChangeKWh" | "numericalResidualKWh"> {
  for (const load of snapshot.loads) {
    load.servedPowerKw = 0;
    load.unservedPowerKw =
      load.enabled &&
      breakerIsClosed(
        findById(snapshot.breakers, load.breakerId, "load breaker"),
      )
        ? effectiveLoadDemandPowerKw(load)
        : 0;
  }
  for (const battery of snapshot.batteries) {
    battery.lastPowerKw = 0;
  }
  for (const bus of snapshot.buses) {
    bus.generationPowerKw = 0;
    bus.batteryPowerKw = 0;
    bus.demandedPowerKw = 0;
    bus.servedPowerKw = 0;
    bus.unservedPowerKw = 0;
    bus.curtailedPowerKw = 0;
    bus.netTransferPowerKw = 0;
  }

  let batteryChargeInputKWh = 0;
  let batteryDischargeOutputKWh = 0;
  let batteryConversionLossKWh = 0;
  let totalCurtailedPowerKw = 0;

  for (const island of connectedIslands(snapshot)) {
    const islandSet = new Set<ElectricalBusId>(island);
    const reactors = snapshot.reactors.filter((reactor) => {
      const breaker = findById(
        snapshot.breakers,
        reactor.breakerId,
        "reactor breaker",
      );
      return (
        islandSet.has(reactor.busId) &&
        reactor.condition !== "tripped" &&
        breakerIsClosed(breaker)
      );
    });
    const loads = snapshot.loads
      .filter((load) => {
        const breaker = findById(
          snapshot.breakers,
          load.breakerId,
          "load breaker",
        );
        return (
          islandSet.has(load.busId) &&
          load.enabled &&
          breakerIsClosed(breaker)
        );
      })
      .sort(
        (left, right) =>
          TIER_ORDER[left.tier] - TIER_ORDER[right.tier] ||
          left.id.localeCompare(right.id),
      );
    const batteries = snapshot.batteries.filter((battery) => {
      const breaker = findById(
        snapshot.breakers,
        battery.breakerId,
        "battery breaker",
      );
      return islandSet.has(battery.busId) && breakerIsClosed(breaker);
    });

    const generationPowerKw = reactors.reduce(
      (total, reactor) => total + reactor.outputKw,
      0,
    );
    const demandedPowerKw = loads.reduce(
      (total, load) => total + effectiveLoadDemandPowerKw(load),
      0,
    );

    let dischargePowerKw = 0;
    if (generationPowerKw < demandedPowerKw) {
      let deficitPowerKw = demandedPowerKw - generationPowerKw;
      for (const battery of batteries) {
        if (
          !canBatteryDischarge(battery) ||
          battery.storedEnergyKWh <= 0 ||
          deficitPowerKw <= 0
        ) {
          continue;
        }
        const powerFraction = conditionPowerFraction(battery.condition);
        const maximumByEnergyKw =
          deltaHours > 0
            ? (battery.storedEnergyKWh * battery.dischargeEfficiency) /
              deltaHours
            : Number.POSITIVE_INFINITY;
        const deliveredPowerKw = Math.min(
          deficitPowerKw,
          battery.maximumDischargePowerKw * powerFraction,
          maximumByEnergyKw,
        );
        battery.lastPowerKw = deliveredPowerKw;
        if (deltaHours > 0) {
          const outputEnergyKWh = deliveredPowerKw * deltaHours;
          const withdrawnEnergyKWh =
            outputEnergyKWh / battery.dischargeEfficiency;
          const conversionLossKWh =
            withdrawnEnergyKWh - outputEnergyKWh;
          battery.storedEnergyKWh = Math.max(
            0,
            battery.storedEnergyKWh - withdrawnEnergyKWh,
          );
          battery.throughputKWh += withdrawnEnergyKWh;
          battery.conversionLossKWh += conversionLossKWh;
          batteryDischargeOutputKWh += outputEnergyKWh;
          batteryConversionLossKWh += conversionLossKWh;
        }
        dischargePowerKw += deliveredPowerKw;
        deficitPowerKw -= deliveredPowerKw;
      }
    }

    let availablePowerKw = generationPowerKw + dischargePowerKw;
    for (const load of loads) {
      const effectiveDemandPowerKw =
        effectiveLoadDemandPowerKw(load);
      const servedPowerKw = Math.min(
        effectiveDemandPowerKw,
        availablePowerKw,
      );
      load.servedPowerKw = servedPowerKw;
      load.unservedPowerKw =
        effectiveDemandPowerKw - servedPowerKw;
      availablePowerKw -= servedPowerKw;
    }

    if (availablePowerKw > 0 && deltaHours > 0) {
      for (const battery of batteries) {
        if (!canBatteryCharge(battery) || availablePowerKw <= 0) continue;
        const powerFraction = conditionPowerFraction(battery.condition);
        const headroomKWh = battery.capacityKWh - battery.storedEnergyKWh;
        const maximumByCapacityKw =
          headroomKWh / (battery.chargeEfficiency * deltaHours);
        const inputPowerKw = Math.min(
          availablePowerKw,
          battery.maximumChargePowerKw * powerFraction,
          maximumByCapacityKw,
        );
        const inputEnergyKWh = inputPowerKw * deltaHours;
        const storedEnergyKWh = inputEnergyKWh * battery.chargeEfficiency;
        const conversionLossKWh = inputEnergyKWh - storedEnergyKWh;
        battery.storedEnergyKWh = Math.min(
          battery.capacityKWh,
          battery.storedEnergyKWh + storedEnergyKWh,
        );
        battery.lastPowerKw = -inputPowerKw;
        battery.throughputKWh += inputEnergyKWh;
        battery.conversionLossKWh += conversionLossKWh;
        batteryChargeInputKWh += inputEnergyKWh;
        batteryConversionLossKWh += conversionLossKWh;
        availablePowerKw -= inputPowerKw;
      }
    }

    const curtailedPowerKw = Math.max(0, availablePowerKw);
    totalCurtailedPowerKw += curtailedPowerKw;

    for (const busId of island) {
      const bus = findById(snapshot.buses, busId, "electrical bus");
      bus.generationPowerKw = reactors
        .filter((reactor) => reactor.busId === busId)
        .reduce((total, reactor) => total + reactor.outputKw, 0);
      bus.batteryPowerKw = batteries
        .filter((battery) => battery.busId === busId)
        .reduce((total, battery) => total + battery.lastPowerKw, 0);
      const busLoads = loads.filter((load) => load.busId === busId);
      bus.demandedPowerKw = busLoads.reduce(
        (total, load) =>
          total + effectiveLoadDemandPowerKw(load),
        0,
      );
      bus.servedPowerKw = busLoads.reduce(
        (total, load) => total + load.servedPowerKw,
        0,
      );
      bus.unservedPowerKw = busLoads.reduce(
        (total, load) => total + load.unservedPowerKw,
        0,
      );
      bus.curtailedPowerKw =
        generationPowerKw > 0
          ? curtailedPowerKw *
            (bus.generationPowerKw / generationPowerKw)
          : 0;
    }

    if (island.length === 1) {
      const bus = findById(snapshot.buses, island[0], "electrical bus");
      bus.netTransferPowerKw = 0;
    } else {
      const first = findById(snapshot.buses, island[0], "electrical bus");
      const second = findById(snapshot.buses, island[1], "electrical bus");
      assignTwoBusNetTransferPowerKw(first, second);
    }
  }

  for (const bus of snapshot.buses) {
    const localSupplyPowerKw =
      bus.generationPowerKw +
      Math.max(0, bus.batteryPowerKw) +
      Math.max(0, bus.netTransferPowerKw);
    const serviceFraction =
      bus.demandedPowerKw === 0
        ? 1
        : bus.servedPowerKw / bus.demandedPowerKw;
    bus.energized =
      localSupplyPowerKw > 0 ||
      bus.servedPowerKw > 0 ||
      (bus.demandedPowerKw === 0 && bus.generationPowerKw > 0);
    if (!bus.energized) {
      bus.voltageV = 0;
      bus.frequencyHz = 0;
    } else {
      bus.voltageV =
        bus.nominalVoltageV * (0.75 + 0.25 * serviceFraction);
      bus.frequencyHz =
        bus.nominalFrequencyHz * (0.97 + 0.03 * serviceFraction);
    }
  }

  for (const breaker of snapshot.breakers) {
    if (!breakerIsClosed(breaker)) {
      breaker.currentPowerKw = 0;
      continue;
    }
    if (breaker.kind === "generator") {
      breaker.currentPowerKw = findById(
        snapshot.reactors,
        breaker.fromId,
        "reactor",
      ).outputKw;
    } else if (breaker.kind === "storage") {
      breaker.currentPowerKw = Math.abs(
        findById(snapshot.batteries, breaker.fromId, "battery").lastPowerKw,
      );
    } else if (breaker.kind === "load") {
      breaker.currentPowerKw = findById(
        snapshot.loads,
        breaker.toId,
        "load",
      ).servedPowerKw;
    } else {
      breaker.currentPowerKw = Math.abs(
        findById(snapshot.buses, "bus-a", "electrical bus")
          .netTransferPowerKw,
      );
    }
  }

  const generationPowerKw = snapshot.buses.reduce(
    (total, bus) => total + bus.generationPowerKw,
    0,
  );
  const servedPowerKw = snapshot.loads.reduce(
    (total, load) => total + load.servedPowerKw,
    0,
  );
  const demandedLoadEnergyKWhById = emptyLoadEnergyRecord();
  const servedLoadEnergyKWhById = emptyLoadEnergyRecord();
  for (const load of snapshot.loads) {
    demandedLoadEnergyKWhById[load.id] =
      (load.enabled ? effectiveLoadDemandPowerKw(load) : 0) *
      deltaHours;
    servedLoadEnergyKWhById[load.id] =
      load.servedPowerKw * deltaHours;
  }
  return {
    reactorGenerationKWh: generationPowerKw * deltaHours,
    servedLoadKWh: servedPowerKw * deltaHours,
    demandedLoadEnergyKWhById,
    servedLoadEnergyKWhById,
    curtailedGenerationKWh: totalCurtailedPowerKw * deltaHours,
    batteryChargeInputKWh,
    batteryDischargeOutputKWh,
    batteryConversionLossKWh,
    criticalServiceFraction: physicalServiceFractionForTier(
      snapshot.loads,
      "critical",
    ),
  };
}

function runPowerInterval(
  snapshot: ElectricalNetworkSnapshot,
  deltaSeconds: number,
): IntervalEnergy {
  const beforeStoredEnergyKWh = totalStoredEnergy(snapshot);
  advanceReactorOutputs(snapshot, deltaSeconds);
  const physical = dispatchPower(snapshot, deltaSeconds / 3_600);
  const storedEnergyChangeKWh =
    totalStoredEnergy(snapshot) - beforeStoredEnergyKWh;
  const numericalResidualBeforeKWh =
    snapshot.ledger.numericalResidualKWh;
  snapshot.ledger.reactorGenerationKWh += physical.reactorGenerationKWh;
  snapshot.ledger.servedLoadKWh += physical.servedLoadKWh;
  for (const loadId of ELECTRICAL_LOAD_IDS) {
    snapshot.ledger.demandedLoadEnergyKWhById[loadId] +=
      physical.demandedLoadEnergyKWhById[loadId];
    snapshot.ledger.servedLoadEnergyKWhById[loadId] +=
      physical.servedLoadEnergyKWhById[loadId];
  }
  snapshot.ledger.curtailedGenerationKWh +=
    physical.curtailedGenerationKWh;
  snapshot.ledger.batteryConversionLossKWh +=
    physical.batteryConversionLossKWh;
  reconcileNumericalEnergyResidual(snapshot);
  const numericalResidualKWh =
    snapshot.ledger.numericalResidualKWh -
    numericalResidualBeforeKWh;
  return {
    ...physical,
    storedEnergyChangeKWh,
    numericalResidualKWh,
  };
}

function createBaselineSnapshot(
  options: ElectricalNetworkOptions,
): ElectricalNetworkSnapshot {
  const reactors: FusionReactor[] = FUSION_REACTOR_IDS.map(
    (id, index): FusionReactor => {
      const online = index < 4;
      const busId: ElectricalBusId =
        index === 0 || index === 1 || index === 4 ? "bus-a" : "bus-b";
      return {
        id,
        label: `聚变模块 ${index + 1}`,
        busId,
        breakerId: `breaker:${id}` as ElectricalBreakerId,
        ratedOutputKw: 225_000,
        rampRateKwPerSecond: 5_000,
        mode: online ? "online" : "hot-standby",
        condition: "nominal",
        targetOutputKw: online ? 210_500 : 0,
        outputKw: online ? 210_500 : 0,
        tripReason: null,
      };
    },
  );
  const buses: ElectricalBus[] = ELECTRICAL_BUS_IDS.map((id) => ({
    id,
    label: id === "bus-a" ? "A 主母线" : "B 主母线",
    nominalVoltageV: 11_000,
    nominalFrequencyHz: 50,
    voltageV: 11_000,
    frequencyHz: 50,
    energized: true,
    generationPowerKw: 0,
    batteryPowerKw: 0,
    demandedPowerKw: 0,
    servedPowerKw: 0,
    unservedPowerKw: 0,
    curtailedPowerKw: 0,
    netTransferPowerKw: 0,
  }));
  const breakers: ElectricalBreaker[] = BASELINE_BREAKER_TOPOLOGY.map(
    (specification) => ({
      ...cloneData(specification),
      condition: "nominal",
      tripReason: null,
      currentPowerKw: 0,
    }),
  );
  const loads: ElectricalLoad[] = BASELINE_LOAD_SPECS.map(
    (specification) => ({
      ...cloneData(specification),
      breakerId: `breaker:${specification.id}` as ElectricalBreakerId,
      controllerDemandFraction:
        specification.id.startsWith("propulsion-control")
        ? 0
        : 1,
      enabled: true,
      servedPowerKw: 0,
      unservedPowerKw: 0,
    }),
  );
  const batteries: ElectricalBattery[] = ELECTRICAL_BATTERY_IDS.map(
    (id, index) => ({
      id,
      label: index === 0 ? "A 组储能" : "B 组储能",
      busId: index === 0 ? "bus-a" : "bus-b",
      breakerId: `breaker:${id}` as ElectricalBreakerId,
      capacityKWh: 3_600_000,
      storedEnergyKWh: 1_200_000,
      maximumChargePowerKw: 180_000,
      maximumDischargePowerKw: 180_000,
      chargeEfficiency: 0.96,
      dischargeEfficiency: 0.94,
      condition: "nominal",
      controlMode: "automatic",
      lastPowerKw: 0,
      throughputKWh: 0,
      conversionLossKWh: 0,
      faultReason: null,
    }),
  );
  const seed = hashSeed(options.seed ?? 0);
  const sensors: ElectricalSensor[] = BASELINE_SENSOR_SPECS.map(
    (specification, index) => ({
      ...cloneData(specification),
      sampleIntervalMicroseconds: DEFAULT_SENSOR_INTERVAL_MICROSECONDS,
      delayMicroseconds: DEFAULT_SENSOR_DELAY_MICROSECONDS,
      bias: 0,
      driftPerSecond: 0,
      condition: "nominal",
      stuckValue: null,
      nextSampleMicroseconds: 0,
      randomState: hashSeed(`${seed}:${index}:${specification.id}`),
      spareNormal: null,
      pending: [],
      latest: null,
    }),
  );
  const snapshot: ElectricalNetworkSnapshot = {
    snapshotVersion: ELECTRICAL_SNAPSHOT_VERSION,
    elapsedMicroseconds: 0,
    revision: 0,
    reactors,
    buses,
    breakers,
    loads,
    batteries,
    sensors,
    ledger: {
      initialStoredEnergyKWh: batteries.reduce(
        (total, battery) => total + battery.storedEnergyKWh,
        0,
      ),
      reactorGenerationKWh: 0,
      servedLoadKWh: 0,
      demandedLoadEnergyKWhById: emptyLoadEnergyRecord(),
      servedLoadEnergyKWhById: emptyLoadEnergyRecord(),
      curtailedGenerationKWh: 0,
      batteryConversionLossKWh: 0,
      externalEnergyKWh: 0,
      numericalResidualKWh: 0,
    },
    nextControlSequence: 1,
    controlLog: [],
  };
  dispatchPower(snapshot, 0);
  return snapshot;
}

function validateEntityIdOrder(
  entities: readonly { id: string }[],
  expectedIds: readonly string[],
  label: string,
): void {
  if (entities.length !== expectedIds.length) {
    throw new Error(`${label} must contain exactly ${expectedIds.length} entities`);
  }
  for (let index = 0; index < expectedIds.length; index += 1) {
    if (entities[index].id !== expectedIds[index]) {
      throw new Error(
        `${label}[${index}].id must be ${expectedIds[index]}, received ${entities[index].id}`,
      );
    }
  }
}

function validateSensorReading(
  value: unknown,
  label: string,
  sensor: ElectricalSensor,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "sensorId",
      "targetId",
      "quantity",
      "sampledAtMicroseconds",
      "availableAtMicroseconds",
      "value",
      "quality",
    ],
    label,
  );
  if (value.sensorId !== sensor.id) {
    throw new Error(`${label}.sensorId must match its sensor`);
  }
  if (value.targetId !== sensor.targetId) {
    throw new Error(`${label}.targetId must match its sensor`);
  }
  if (value.quantity !== sensor.quantity) {
    throw new Error(`${label}.quantity must match its sensor`);
  }
  assertSafeMicroseconds(value.sampledAtMicroseconds, `${label}.sampledAtMicroseconds`);
  assertSafeMicroseconds(
    value.availableAtMicroseconds,
    `${label}.availableAtMicroseconds`,
  );
  if (
    (value.availableAtMicroseconds as number) <
    (value.sampledAtMicroseconds as number)
  ) {
    throw new Error(`${label} is available before it was sampled`);
  }
  if (value.value !== null) {
    assertFinite(value.value, `${label}.value`);
  }
  assertEnum(
    value.quality,
    ["nominal", "degraded", "stuck", "offline"] as const,
    `${label}.quality`,
  );
}

function validateSensorTarget(sensor: ElectricalSensor, label: string): void {
  const busQuantities: ElectricalSensorQuantity[] = [
    "voltageV",
    "frequencyHz",
    "generationPowerKw",
    "servedPowerKw",
    "unservedPowerKw",
  ];
  if (busQuantities.includes(sensor.quantity)) {
    assertEnum(sensor.targetId, ELECTRICAL_BUS_IDS, `${label}.targetId`);
  } else if (sensor.quantity === "reactorOutputKw") {
    assertEnum(sensor.targetId, FUSION_REACTOR_IDS, `${label}.targetId`);
  } else {
    assertEnum(sensor.targetId, ELECTRICAL_BATTERY_IDS, `${label}.targetId`);
  }
}

export function validateElectricalSnapshot(
  value: unknown,
): asserts value is ElectricalNetworkSnapshot {
  assertRecord(value, "electrical snapshot");
  assertExactKeys(
    value,
    [
      "snapshotVersion",
      "elapsedMicroseconds",
      "revision",
      "reactors",
      "buses",
      "breakers",
      "loads",
      "batteries",
      "sensors",
      "ledger",
      "nextControlSequence",
      "controlLog",
    ],
    "electrical snapshot",
  );
  if (value.snapshotVersion !== ELECTRICAL_SNAPSHOT_VERSION) {
    throw new Error(
      `unsupported electrical snapshot version: ${String(value.snapshotVersion)}`,
    );
  }
  assertSafeMicroseconds(value.elapsedMicroseconds, "elapsedMicroseconds");
  assertSafeInteger(value.revision, "revision");
  assertSafeInteger(value.nextControlSequence, "nextControlSequence");
  if ((value.nextControlSequence as number) < 1) {
    throw new RangeError("nextControlSequence must be at least one");
  }
  if (!Array.isArray(value.reactors)) {
    throw new TypeError("reactors must be an array");
  }
  if (!Array.isArray(value.buses)) {
    throw new TypeError("buses must be an array");
  }
  if (!Array.isArray(value.breakers)) {
    throw new TypeError("breakers must be an array");
  }
  if (!Array.isArray(value.loads)) {
    throw new TypeError("loads must be an array");
  }
  if (!Array.isArray(value.batteries)) {
    throw new TypeError("batteries must be an array");
  }
  if (!Array.isArray(value.sensors)) {
    throw new TypeError("sensors must be an array");
  }
  if (!Array.isArray(value.controlLog)) {
    throw new TypeError("controlLog must be an array");
  }

  validateEntityIdOrder(value.reactors, FUSION_REACTOR_IDS, "reactors");
  validateEntityIdOrder(value.buses, ELECTRICAL_BUS_IDS, "buses");
  validateEntityIdOrder(value.breakers, ELECTRICAL_BREAKER_IDS, "breakers");
  validateEntityIdOrder(value.loads, ELECTRICAL_LOAD_IDS, "loads");
  validateEntityIdOrder(value.batteries, ELECTRICAL_BATTERY_IDS, "batteries");
  validateEntityIdOrder(value.sensors, BASELINE_SENSOR_IDS, "sensors");

  for (const [index, rawReactor] of value.reactors.entries()) {
    const label = `reactors[${index}]`;
    assertRecord(rawReactor, label);
    assertExactKeys(
      rawReactor,
      [
        "id",
        "label",
        "busId",
        "breakerId",
        "ratedOutputKw",
        "rampRateKwPerSecond",
        "mode",
        "condition",
        "targetOutputKw",
        "outputKw",
        "tripReason",
      ],
      label,
    );
    assertEnum(rawReactor.id, FUSION_REACTOR_IDS, `${label}.id`);
    if (typeof rawReactor.label !== "string" || rawReactor.label.length === 0) {
      throw new TypeError(`${label}.label must be a non-empty string`);
    }
    assertEnum(rawReactor.busId, ELECTRICAL_BUS_IDS, `${label}.busId`);
    const expectedBusId: ElectricalBusId =
      index === 0 || index === 1 || index === 4 ? "bus-a" : "bus-b";
    if (rawReactor.busId !== expectedBusId) {
      throw new Error(`${label}.busId violates fixed reactor topology`);
    }
    if (rawReactor.breakerId !== `breaker:${rawReactor.id}`) {
      throw new Error(`${label}.breakerId violates fixed reactor topology`);
    }
    assertPositive(rawReactor.ratedOutputKw, `${label}.ratedOutputKw`);
    assertPositive(rawReactor.rampRateKwPerSecond, `${label}.rampRateKwPerSecond`);
    if (
      rawReactor.ratedOutputKw !== 225_000 ||
      rawReactor.rampRateKwPerSecond !== 5_000
    ) {
      throw new Error(`${label} physical rating does not match this model version`);
    }
    assertEnum(
      rawReactor.mode,
      ["online", "hot-standby", "offline"] as const,
      `${label}.mode`,
    );
    assertEnum(
      rawReactor.condition,
      ["nominal", "tripped"] as const,
      `${label}.condition`,
    );
    assertNonNegative(rawReactor.targetOutputKw, `${label}.targetOutputKw`);
    assertNonNegative(rawReactor.outputKw, `${label}.outputKw`);
    if (
      (rawReactor.targetOutputKw as number) >
        (rawReactor.ratedOutputKw as number) ||
      (rawReactor.outputKw as number) > (rawReactor.ratedOutputKw as number)
    ) {
      throw new RangeError(`${label} output exceeds reactor rating`);
    }
    assertNullableString(rawReactor.tripReason, `${label}.tripReason`);
    if (
      rawReactor.condition === "tripped" &&
      ((rawReactor.outputKw as number) !== 0 ||
        (rawReactor.targetOutputKw as number) !== 0 ||
        rawReactor.mode !== "offline" ||
        rawReactor.tripReason === null)
    ) {
      throw new Error(`${label} tripped state is inconsistent`);
    }
  }

  for (const [index, rawBus] of value.buses.entries()) {
    const label = `buses[${index}]`;
    assertRecord(rawBus, label);
    assertExactKeys(
      rawBus,
      [
        "id",
        "label",
        "nominalVoltageV",
        "nominalFrequencyHz",
        "voltageV",
        "frequencyHz",
        "energized",
        "generationPowerKw",
        "batteryPowerKw",
        "demandedPowerKw",
        "servedPowerKw",
        "unservedPowerKw",
        "curtailedPowerKw",
        "netTransferPowerKw",
      ],
      label,
    );
    assertEnum(rawBus.id, ELECTRICAL_BUS_IDS, `${label}.id`);
    if (typeof rawBus.label !== "string" || rawBus.label.length === 0) {
      throw new TypeError(`${label}.label must be a non-empty string`);
    }
    assertPositive(rawBus.nominalVoltageV, `${label}.nominalVoltageV`);
    assertPositive(rawBus.nominalFrequencyHz, `${label}.nominalFrequencyHz`);
    if (
      rawBus.nominalVoltageV !== 11_000 ||
      rawBus.nominalFrequencyHz !== 50
    ) {
      throw new Error(`${label} nominal rating does not match this model version`);
    }
    assertNonNegative(rawBus.voltageV, `${label}.voltageV`);
    assertNonNegative(rawBus.frequencyHz, `${label}.frequencyHz`);
    assertBoolean(rawBus.energized, `${label}.energized`);
    assertNonNegative(rawBus.generationPowerKw, `${label}.generationPowerKw`);
    assertFinite(rawBus.batteryPowerKw, `${label}.batteryPowerKw`);
    assertNonNegative(rawBus.demandedPowerKw, `${label}.demandedPowerKw`);
    assertNonNegative(rawBus.servedPowerKw, `${label}.servedPowerKw`);
    assertNonNegative(rawBus.unservedPowerKw, `${label}.unservedPowerKw`);
    assertNonNegative(rawBus.curtailedPowerKw, `${label}.curtailedPowerKw`);
    assertFinite(rawBus.netTransferPowerKw, `${label}.netTransferPowerKw`);
    if (
      Math.abs(
        (rawBus.demandedPowerKw as number) -
          (rawBus.servedPowerKw as number) -
          (rawBus.unservedPowerKw as number),
      ) > 1e-6
    ) {
      throw new Error(`${label} demand does not reconcile`);
    }
  }

  for (const [index, rawBreaker] of value.breakers.entries()) {
    const label = `breakers[${index}]`;
    const topology = BASELINE_BREAKER_TOPOLOGY[index];
    assertRecord(rawBreaker, label);
    assertExactKeys(
      rawBreaker,
      [
        "id",
        "label",
        "kind",
        "fromId",
        "toId",
        "ratedPowerKw",
        "commandedClosed",
        "condition",
        "tripReason",
        "currentPowerKw",
      ],
      label,
    );
    if (
      rawBreaker.id !== topology.id ||
      rawBreaker.kind !== topology.kind ||
      rawBreaker.fromId !== topology.fromId ||
      rawBreaker.toId !== topology.toId
    ) {
      throw new Error(`${label} violates fixed breaker topology`);
    }
    if (typeof rawBreaker.label !== "string" || rawBreaker.label.length === 0) {
      throw new TypeError(`${label}.label must be a non-empty string`);
    }
    assertPositive(rawBreaker.ratedPowerKw, `${label}.ratedPowerKw`);
    if (rawBreaker.ratedPowerKw !== topology.ratedPowerKw) {
      throw new Error(`${label}.ratedPowerKw violates fixed breaker topology`);
    }
    assertBoolean(rawBreaker.commandedClosed, `${label}.commandedClosed`);
    assertEnum(
      rawBreaker.condition,
      ["nominal", "tripped"] as const,
      `${label}.condition`,
    );
    assertNullableString(rawBreaker.tripReason, `${label}.tripReason`);
    assertNonNegative(rawBreaker.currentPowerKw, `${label}.currentPowerKw`);
    if (
      rawBreaker.condition === "tripped" &&
      rawBreaker.tripReason === null
    ) {
      throw new Error(`${label} tripped breaker requires a reason`);
    }
    if (
      rawBreaker.condition === "tripped" &&
      ((rawBreaker.currentPowerKw as number) !== 0 ||
        rawBreaker.commandedClosed !== false)
    ) {
      throw new Error(`${label} tripped state is inconsistent`);
    }
    if (
      (rawBreaker.currentPowerKw as number) >
      (rawBreaker.ratedPowerKw as number) + 1e-6
    ) {
      throw new Error(`${label} current power exceeds breaker rating`);
    }
  }

  for (const [index, rawLoad] of value.loads.entries()) {
    const label = `loads[${index}]`;
    const specification = BASELINE_LOAD_SPECS[index];
    assertRecord(rawLoad, label);
    assertExactKeys(
      rawLoad,
      [
        "id",
        "label",
        "busId",
        "breakerId",
        "tier",
        "demandedPowerKw",
        "controllerDemandFraction",
        "enabled",
        "servedPowerKw",
        "unservedPowerKw",
      ],
      label,
    );
    if (
      rawLoad.id !== specification.id ||
      rawLoad.busId !== specification.busId ||
      rawLoad.tier !== specification.tier ||
      rawLoad.breakerId !== `breaker:${specification.id}`
    ) {
      throw new Error(`${label} violates fixed load topology`);
    }
    if (typeof rawLoad.label !== "string" || rawLoad.label.length === 0) {
      throw new TypeError(`${label}.label must be a non-empty string`);
    }
    assertPositive(rawLoad.demandedPowerKw, `${label}.demandedPowerKw`);
    if (rawLoad.demandedPowerKw !== specification.demandedPowerKw) {
      throw new Error(`${label} demand does not match this model version`);
    }
    assertFraction(
      rawLoad.controllerDemandFraction,
      `${label}.controllerDemandFraction`,
    );
    assertBoolean(rawLoad.enabled, `${label}.enabled`);
    assertNonNegative(rawLoad.servedPowerKw, `${label}.servedPowerKw`);
    assertNonNegative(rawLoad.unservedPowerKw, `${label}.unservedPowerKw`);
    if (
      rawLoad.enabled &&
      breakerIsClosed(
        value.breakers[index + 8] as unknown as ElectricalBreaker,
      ) &&
        Math.abs(
          (rawLoad.demandedPowerKw as number) *
            (rawLoad.controllerDemandFraction as number) -
            (rawLoad.servedPowerKw as number) -
          (rawLoad.unservedPowerKw as number),
      ) > 1e-6
    ) {
      throw new Error(`${label} demand does not reconcile`);
    }
  }

  for (const [index, rawBattery] of value.batteries.entries()) {
    const label = `batteries[${index}]`;
    assertRecord(rawBattery, label);
    assertExactKeys(
      rawBattery,
      [
        "id",
        "label",
        "busId",
        "breakerId",
        "capacityKWh",
        "storedEnergyKWh",
        "maximumChargePowerKw",
        "maximumDischargePowerKw",
        "chargeEfficiency",
        "dischargeEfficiency",
        "condition",
        "controlMode",
        "lastPowerKw",
        "throughputKWh",
        "conversionLossKWh",
        "faultReason",
      ],
      label,
    );
    const expectedBusId: ElectricalBusId = index === 0 ? "bus-a" : "bus-b";
    if (
      rawBattery.busId !== expectedBusId ||
      rawBattery.breakerId !== `breaker:${rawBattery.id}`
    ) {
      throw new Error(`${label} violates fixed battery topology`);
    }
    if (typeof rawBattery.label !== "string" || rawBattery.label.length === 0) {
      throw new TypeError(`${label}.label must be a non-empty string`);
    }
    assertPositive(rawBattery.capacityKWh, `${label}.capacityKWh`);
    assertNonNegative(rawBattery.storedEnergyKWh, `${label}.storedEnergyKWh`);
    if (
      (rawBattery.storedEnergyKWh as number) >
      (rawBattery.capacityKWh as number)
    ) {
      throw new RangeError(`${label} charge exceeds capacity`);
    }
    assertPositive(
      rawBattery.maximumChargePowerKw,
      `${label}.maximumChargePowerKw`,
    );
    assertPositive(
      rawBattery.maximumDischargePowerKw,
      `${label}.maximumDischargePowerKw`,
    );
    assertFraction(rawBattery.chargeEfficiency, `${label}.chargeEfficiency`);
    assertFraction(
      rawBattery.dischargeEfficiency,
      `${label}.dischargeEfficiency`,
    );
    if (
      rawBattery.capacityKWh !== 3_600_000 ||
      rawBattery.maximumChargePowerKw !== 180_000 ||
      rawBattery.maximumDischargePowerKw !== 180_000 ||
      rawBattery.chargeEfficiency !== 0.96 ||
      rawBattery.dischargeEfficiency !== 0.94
    ) {
      throw new Error(`${label} physical rating does not match this model version`);
    }
    assertEnum(
      rawBattery.condition,
      ["nominal", "degraded", "thermal-lockout", "failed"] as const,
      `${label}.condition`,
    );
    assertEnum(
      rawBattery.controlMode,
      ["automatic", "charge-only", "discharge-only", "standby"] as const,
      `${label}.controlMode`,
    );
    assertFinite(rawBattery.lastPowerKw, `${label}.lastPowerKw`);
    assertNonNegative(rawBattery.throughputKWh, `${label}.throughputKWh`);
    assertNonNegative(
      rawBattery.conversionLossKWh,
      `${label}.conversionLossKWh`,
    );
    assertNullableString(rawBattery.faultReason, `${label}.faultReason`);
    if (
      rawBattery.condition !== "nominal" &&
      rawBattery.faultReason === null
    ) {
      throw new Error(`${label} fault requires a reason`);
    }
    if (
      conditionPowerFraction(rawBattery.condition as BatteryCondition) === 0 &&
      (rawBattery.lastPowerKw as number) !== 0
    ) {
      throw new Error(`${label} supplies power while unavailable`);
    }
  }

  for (const [index, rawSensor] of value.sensors.entries()) {
    const label = `sensors[${index}]`;
    const specification = BASELINE_SENSOR_SPECS[index];
    assertRecord(rawSensor, label);
    assertExactKeys(
      rawSensor,
      [
        "id",
        "targetId",
        "quantity",
        "sampleIntervalMicroseconds",
        "delayMicroseconds",
        "noiseStandardDeviation",
        "bias",
        "driftPerSecond",
        "condition",
        "stuckValue",
        "nextSampleMicroseconds",
        "randomState",
        "spareNormal",
        "pending",
        "latest",
      ],
      label,
    );
    assertEnum(
      rawSensor.quantity,
      [
        "voltageV",
        "frequencyHz",
        "generationPowerKw",
        "servedPowerKw",
        "unservedPowerKw",
        "reactorOutputKw",
        "batteryStateOfChargeFraction",
        "batteryPowerKw",
      ] as const,
      `${label}.quantity`,
    );
    if (
      rawSensor.targetId !== specification.targetId ||
      rawSensor.quantity !== specification.quantity
    ) {
      throw new Error(`${label} violates fixed sensor topology`);
    }
    validateSensorTarget(
      rawSensor as unknown as ElectricalSensor,
      label,
    );
    assertSafeInteger(
      rawSensor.sampleIntervalMicroseconds,
      `${label}.sampleIntervalMicroseconds`,
    );
    if (
      (rawSensor.sampleIntervalMicroseconds as number) <
      MIN_SENSOR_INTERVAL_MICROSECONDS
    ) {
      throw new RangeError(`${label}.sampleIntervalMicroseconds is too short`);
    }
    assertSafeInteger(rawSensor.delayMicroseconds, `${label}.delayMicroseconds`);
    if (
      (rawSensor.delayMicroseconds as number) > MAX_SENSOR_DELAY_MICROSECONDS
    ) {
      throw new RangeError(`${label}.delayMicroseconds exceeds model limit`);
    }
    assertNonNegative(
      rawSensor.noiseStandardDeviation,
      `${label}.noiseStandardDeviation`,
    );
    assertFinite(rawSensor.bias, `${label}.bias`);
    assertFinite(rawSensor.driftPerSecond, `${label}.driftPerSecond`);
    assertEnum(
      rawSensor.condition,
      ["nominal", "degraded", "stuck", "offline"] as const,
      `${label}.condition`,
    );
    if (rawSensor.stuckValue !== null) {
      assertFinite(rawSensor.stuckValue, `${label}.stuckValue`);
    }
    assertSafeMicroseconds(
      rawSensor.nextSampleMicroseconds,
      `${label}.nextSampleMicroseconds`,
    );
    if (
      (rawSensor.nextSampleMicroseconds as number) <=
      (value.elapsedMicroseconds as number)
    ) {
      throw new Error(`${label}.nextSampleMicroseconds must be in the future`);
    }
    assertSafeInteger(rawSensor.randomState, `${label}.randomState`);
    if ((rawSensor.randomState as number) > 0xffff_ffff) {
      throw new RangeError(`${label}.randomState exceeds uint32`);
    }
    if (rawSensor.spareNormal !== null) {
      assertFinite(rawSensor.spareNormal, `${label}.spareNormal`);
    }
    if (!Array.isArray(rawSensor.pending)) {
      throw new TypeError(`${label}.pending must be an array`);
    }
    let previousAvailability = -1;
    for (const [readingIndex, reading] of rawSensor.pending.entries()) {
      validateSensorReading(
        reading,
        `${label}.pending[${readingIndex}]`,
        rawSensor as unknown as ElectricalSensor,
      );
      const availability = (
        reading as unknown as ElectricalSensorReading
      ).availableAtMicroseconds;
      if (availability < previousAvailability) {
        throw new Error(`${label}.pending must be ordered by availability`);
      }
      if (availability <= (value.elapsedMicroseconds as number)) {
        throw new Error(`${label}.pending contains an already available reading`);
      }
      previousAvailability = availability;
    }
    if (rawSensor.latest !== null) {
      validateSensorReading(
        rawSensor.latest,
        `${label}.latest`,
        rawSensor as unknown as ElectricalSensor,
      );
      if (
        (
          rawSensor.latest as unknown as ElectricalSensorReading
        ).availableAtMicroseconds > (value.elapsedMicroseconds as number)
      ) {
        throw new Error(`${label}.latest is not yet available`);
      }
    }
  }

  assertRecord(value.ledger, "ledger");
  assertExactKeys(
    value.ledger,
    [
      "initialStoredEnergyKWh",
      "reactorGenerationKWh",
      "servedLoadKWh",
      "demandedLoadEnergyKWhById",
      "servedLoadEnergyKWhById",
      "curtailedGenerationKWh",
      "batteryConversionLossKWh",
      "externalEnergyKWh",
      "numericalResidualKWh",
    ],
    "ledger",
  );
  assertNonNegative(
    value.ledger.initialStoredEnergyKWh,
    "ledger.initialStoredEnergyKWh",
  );
  assertNonNegative(
    value.ledger.reactorGenerationKWh,
    "ledger.reactorGenerationKWh",
  );
  assertNonNegative(value.ledger.servedLoadKWh, "ledger.servedLoadKWh");
  for (const key of [
    "demandedLoadEnergyKWhById",
    "servedLoadEnergyKWhById",
  ] as const) {
    const record = value.ledger[key];
    assertRecord(record, `ledger.${key}`);
    assertExactKeys(record, ELECTRICAL_LOAD_IDS, `ledger.${key}`);
    for (const loadId of ELECTRICAL_LOAD_IDS) {
      assertNonNegative(
        record[loadId],
        `ledger.${key}.${loadId}`,
      );
    }
  }
  const typedLedger =
    value.ledger as unknown as ElectricalEnergyLedger;
  let servedByLoadKWh = 0;
  for (const loadId of ELECTRICAL_LOAD_IDS) {
    if (
      typedLedger.servedLoadEnergyKWhById[loadId] >
      typedLedger.demandedLoadEnergyKWhById[loadId] + 1e-8
    ) {
      throw new Error(
        `ledger served energy for ${loadId} exceeds demanded energy`,
      );
    }
    servedByLoadKWh +=
      typedLedger.servedLoadEnergyKWhById[loadId];
  }
  if (
    Math.abs(
      servedByLoadKWh - typedLedger.servedLoadKWh,
    ) >
    Math.max(1e-8, typedLedger.servedLoadKWh * 1e-10)
  ) {
    throw new Error(
      "ledger served load energy by id does not reconcile",
    );
  }
  assertNonNegative(
    value.ledger.curtailedGenerationKWh,
    "ledger.curtailedGenerationKWh",
  );
  assertNonNegative(
    value.ledger.batteryConversionLossKWh,
    "ledger.batteryConversionLossKWh",
  );
  assertFinite(value.ledger.externalEnergyKWh, "ledger.externalEnergyKWh");
  assertFinite(
    value.ledger.numericalResidualKWh,
    "ledger.numericalResidualKWh",
  );

  let expectedSequence = 1;
  for (const [index, rawRecord] of value.controlLog.entries()) {
    const label = `controlLog[${index}]`;
    assertRecord(rawRecord, label);
    assertExactKeys(
      rawRecord,
      [
        "sequence",
        "simulatedAtMicroseconds",
        "type",
        "targetId",
        "summary",
        "reason",
      ],
      label,
    );
    assertSafeInteger(rawRecord.sequence, `${label}.sequence`);
    if (rawRecord.sequence !== expectedSequence) {
      throw new Error(`${label}.sequence must be contiguous`);
    }
    expectedSequence += 1;
    assertSafeMicroseconds(
      rawRecord.simulatedAtMicroseconds,
      `${label}.simulatedAtMicroseconds`,
    );
    if (
      (rawRecord.simulatedAtMicroseconds as number) >
      (value.elapsedMicroseconds as number)
    ) {
      throw new Error(`${label} occurs after snapshot time`);
    }
    assertEnum(
      rawRecord.type,
      [
        "set-reactor-target",
        "set-reactor-mode",
        "reset-reactor-trip",
        "set-breaker",
        "reset-breaker-trip",
        "set-load-enabled",
        "set-battery-mode",
        "reactor-trip",
        "breaker-trip",
        "battery-fault",
        "battery-energy-injection",
        "external-generation-force",
      ] as const,
      `${label}.type`,
    );
    if (
      typeof rawRecord.targetId !== "string" ||
      rawRecord.targetId.length === 0 ||
      typeof rawRecord.summary !== "string" ||
      rawRecord.summary.length === 0
    ) {
      throw new TypeError(`${label} targetId and summary must be non-empty strings`);
    }
    assertNullableString(rawRecord.reason, `${label}.reason`);
  }
  if (value.nextControlSequence !== expectedSequence) {
    throw new Error("nextControlSequence does not follow controlLog");
  }

  const snapshot = value as unknown as ElectricalNetworkSnapshot;
  for (const bus of snapshot.buses) {
    const busLoads = snapshot.loads.filter((load) => {
      const breaker = findById(
        snapshot.breakers,
        load.breakerId,
        "load breaker",
      );
      return load.busId === bus.id && load.enabled && breakerIsClosed(breaker);
    });
    const expectedGenerationPowerKw = snapshot.reactors
      .filter((reactor) => {
        const breaker = findById(
          snapshot.breakers,
          reactor.breakerId,
          "reactor breaker",
        );
        return reactor.busId === bus.id && breakerIsClosed(breaker);
      })
      .reduce((total, reactor) => total + reactor.outputKw, 0);
    const expectedBatteryPowerKw = snapshot.batteries
      .filter((battery) => battery.busId === bus.id)
      .reduce((total, battery) => total + battery.lastPowerKw, 0);
    const expectedDemandedPowerKw = busLoads.reduce(
      (total, load) => total + effectiveLoadDemandPowerKw(load),
      0,
    );
    const expectedServedPowerKw = busLoads.reduce(
      (total, load) => total + load.servedPowerKw,
      0,
    );
    const expectedUnservedPowerKw = busLoads.reduce(
      (total, load) => total + load.unservedPowerKw,
      0,
    );
    if (
      Math.abs(bus.generationPowerKw - expectedGenerationPowerKw) > 1e-6 ||
      Math.abs(bus.batteryPowerKw - expectedBatteryPowerKw) > 1e-6 ||
      Math.abs(bus.demandedPowerKw - expectedDemandedPowerKw) > 1e-6 ||
      Math.abs(bus.servedPowerKw - expectedServedPowerKw) > 1e-6 ||
      Math.abs(bus.unservedPowerKw - expectedUnservedPowerKw) > 1e-6
    ) {
      throw new Error(`${bus.id} projection does not match connected entities`);
    }
    const localPowerErrorKw =
      bus.generationPowerKw +
      bus.batteryPowerKw +
      bus.netTransferPowerKw -
      bus.servedPowerKw -
      bus.curtailedPowerKw;
    if (Math.abs(localPowerErrorKw) > 1e-6) {
      throw new Error(`${bus.id} local power does not reconcile`);
    }
    const expectedLocalSupplyPowerKw =
      bus.generationPowerKw +
      Math.max(0, bus.batteryPowerKw) +
      Math.max(0, bus.netTransferPowerKw);
    const expectedEnergized =
      expectedLocalSupplyPowerKw > 0 ||
      bus.servedPowerKw > 0 ||
      (bus.demandedPowerKw === 0 && bus.generationPowerKw > 0);
    const serviceFraction =
      bus.demandedPowerKw === 0
        ? 1
        : bus.servedPowerKw / bus.demandedPowerKw;
    const expectedVoltageV = expectedEnergized
      ? bus.nominalVoltageV * (0.75 + 0.25 * serviceFraction)
      : 0;
    const expectedFrequencyHz = expectedEnergized
      ? bus.nominalFrequencyHz * (0.97 + 0.03 * serviceFraction)
      : 0;
    if (
      bus.energized !== expectedEnergized ||
      Math.abs(bus.voltageV - expectedVoltageV) > 1e-6 ||
      Math.abs(bus.frequencyHz - expectedFrequencyHz) > 1e-9
    ) {
      throw new Error(`${bus.id} voltage or energized state is inconsistent`);
    }
  }
  for (const load of snapshot.loads) {
    const connected =
      load.enabled &&
      breakerIsClosed(
        findById(snapshot.breakers, load.breakerId, "load breaker"),
      );
    if (
      !connected &&
      (load.servedPowerKw !== 0 || load.unservedPowerKw !== 0)
    ) {
      throw new Error(`${load.id} has power while disconnected`);
    }
  }
  for (const battery of snapshot.batteries) {
    const breaker = findById(
      snapshot.breakers,
      battery.breakerId,
      "battery breaker",
    );
    const powerFraction = conditionPowerFraction(battery.condition);
    if (
      (!breakerIsClosed(breaker) ||
        battery.controlMode === "standby" ||
        powerFraction === 0) &&
      battery.lastPowerKw !== 0
    ) {
      throw new Error(`${battery.id} has power while unavailable`);
    }
    const powerLimitKw =
      battery.lastPowerKw >= 0
        ? battery.maximumDischargePowerKw * powerFraction
        : battery.maximumChargePowerKw * powerFraction;
    if (Math.abs(battery.lastPowerKw) > powerLimitKw + 1e-6) {
      throw new Error(`${battery.id} exceeds its power limit`);
    }
  }
  for (const breaker of snapshot.breakers) {
    let expectedCurrentPowerKw = 0;
    if (breakerIsClosed(breaker)) {
      if (breaker.kind === "generator") {
        expectedCurrentPowerKw = findById(
          snapshot.reactors,
          breaker.fromId,
          "reactor",
        ).outputKw;
      } else if (breaker.kind === "storage") {
        expectedCurrentPowerKw = Math.abs(
          findById(snapshot.batteries, breaker.fromId, "battery").lastPowerKw,
        );
      } else if (breaker.kind === "load") {
        expectedCurrentPowerKw = findById(
          snapshot.loads,
          breaker.toId,
          "load",
        ).servedPowerKw;
      } else {
        expectedCurrentPowerKw = Math.abs(
          findById(snapshot.buses, "bus-a", "electrical bus")
            .netTransferPowerKw,
        );
      }
    }
    if (Math.abs(breaker.currentPowerKw - expectedCurrentPowerKw) > 1e-6) {
      throw new Error(`${breaker.id} current does not match network flow`);
    }
  }
  const generationPowerKw = snapshot.buses.reduce(
    (total, bus) => total + bus.generationPowerKw,
    0,
  );
  const connectedGenerationKw = snapshot.reactors.reduce((total, reactor) => {
    const breaker = findById(
      snapshot.breakers,
      reactor.breakerId,
      "reactor breaker",
    );
    return total + (breakerIsClosed(breaker) ? reactor.outputKw : 0);
  }, 0);
  if (Math.abs(generationPowerKw - connectedGenerationKw) > 1e-6) {
    throw new Error("bus generation does not match connected reactors");
  }
  const powerBalanceErrorKw =
    generationPowerKw +
    snapshot.batteries.reduce(
      (total, battery) => total + battery.lastPowerKw,
      0,
    ) -
    snapshot.loads.reduce(
      (total, load) => total + load.servedPowerKw,
      0,
    ) -
    snapshot.buses.reduce(
      (total, bus) => total + bus.curtailedPowerKw,
      0,
    );
  if (Math.abs(powerBalanceErrorKw) > 1e-6) {
    throw new Error(`instantaneous power does not reconcile: ${powerBalanceErrorKw}`);
  }
  const transferBalanceKw = snapshot.buses.reduce(
    (total, bus) => total + bus.netTransferPowerKw,
    0,
  );
  if (Math.abs(transferBalanceKw) > 1e-6) {
    throw new Error("bus transfer power does not reconcile");
  }
  const ledgerExpectedStoredEnergyKWh =
    expectedStoredEnergyBeforeNumericalResidualKWh(
      snapshot.ledger,
    ) + snapshot.ledger.numericalResidualKWh;
  const closureErrorKWh =
    totalStoredEnergy(snapshot) - ledgerExpectedStoredEnergyKWh;
  if (Math.abs(closureErrorKWh) > 1e-6) {
    throw new Error(
      `electrical energy ledger does not reconcile: ${closureErrorKWh} kWh`,
    );
  }
  const batteryLossKWh = snapshot.batteries.reduce(
    (total, battery) => total + battery.conversionLossKWh,
    0,
  );
  if (
    Math.abs(
      batteryLossKWh - snapshot.ledger.batteryConversionLossKWh,
    ) > 1e-6
  ) {
    throw new Error("battery conversion-loss records do not reconcile");
  }
}

function validateControlCommand(
  command: ElectricalControlCommand,
): void {
  assertRecord(command, "electrical control command");
  if (typeof command.type !== "string") {
    throw new TypeError("electrical control command.type must be a string");
  }
  switch (command.type) {
    case "set-reactor-target":
      assertExactKeys(
        command,
        ["type", "reactorId", "targetOutputKw"],
        "set-reactor-target command",
      );
      assertEnum(command.reactorId, FUSION_REACTOR_IDS, "command.reactorId");
      assertNonNegative(command.targetOutputKw, "command.targetOutputKw");
      break;
    case "set-reactor-mode":
      assertExactKeys(
        command,
        ["type", "reactorId", "mode"],
        "set-reactor-mode command",
      );
      assertEnum(command.reactorId, FUSION_REACTOR_IDS, "command.reactorId");
      assertEnum(
        command.mode,
        ["online", "hot-standby", "offline"] as const,
        "command.mode",
      );
      break;
    case "reset-reactor-trip":
      assertExactKeys(
        command,
        ["type", "reactorId"],
        "reset-reactor-trip command",
      );
      assertEnum(command.reactorId, FUSION_REACTOR_IDS, "command.reactorId");
      break;
    case "set-breaker":
      assertExactKeys(
        command,
        ["type", "breakerId", "commandedClosed"],
        "set-breaker command",
      );
      assertEnum(command.breakerId, ELECTRICAL_BREAKER_IDS, "command.breakerId");
      assertBoolean(command.commandedClosed, "command.commandedClosed");
      break;
    case "reset-breaker-trip":
      assertExactKeys(
        command,
        ["type", "breakerId"],
        "reset-breaker-trip command",
      );
      assertEnum(command.breakerId, ELECTRICAL_BREAKER_IDS, "command.breakerId");
      break;
    case "set-load-enabled":
      assertExactKeys(
        command,
        ["type", "loadId", "enabled"],
        "set-load-enabled command",
      );
      assertEnum(command.loadId, ELECTRICAL_LOAD_IDS, "command.loadId");
      assertBoolean(command.enabled, "command.enabled");
      break;
    case "set-battery-mode":
      assertExactKeys(
        command,
        ["type", "batteryId", "mode"],
        "set-battery-mode command",
      );
      assertEnum(command.batteryId, ELECTRICAL_BATTERY_IDS, "command.batteryId");
      assertEnum(
        command.mode,
        ["automatic", "charge-only", "discharge-only", "standby"] as const,
        "command.mode",
      );
      break;
    default:
      throw new RangeError("unsupported electrical control command");
  }
}

export class ShipElectricalNetwork {
  private stateValue: ElectricalNetworkSnapshot;

  constructor(options: ElectricalNetworkOptions = {}) {
    this.stateValue = createBaselineSnapshot(options);
    this.sampleDueSensors();
    this.deliverAvailableReadings();
    validateElectricalSnapshot(this.stateValue);
  }

  get elapsedMicroseconds(): number {
    return this.stateValue.elapsedMicroseconds;
  }

  get elapsedSeconds(): number {
    return this.stateValue.elapsedMicroseconds /
      ELECTRICAL_MICROSECONDS_PER_SECOND;
  }

  get revision(): number {
    return this.stateValue.revision;
  }

  listReactors(): FusionReactor[] {
    return cloneData(this.stateValue.reactors);
  }

  listBuses(): ElectricalBus[] {
    return cloneData(this.stateValue.buses);
  }

  listBreakers(): ElectricalBreaker[] {
    return cloneData(this.stateValue.breakers);
  }

  listLoads(): ElectricalLoad[] {
    return cloneData(this.stateValue.loads);
  }

  listBatteries(): ElectricalBattery[] {
    return cloneData(this.stateValue.batteries);
  }

  listSensors(): ElectricalSensor[] {
    return cloneData(this.stateValue.sensors);
  }

  getReactor(reactorId: FusionReactorId): FusionReactor {
    return cloneData(
      findById(this.stateValue.reactors, reactorId, "fusion reactor"),
    );
  }

  getBus(busId: ElectricalBusId): ElectricalBus {
    return cloneData(findById(this.stateValue.buses, busId, "electrical bus"));
  }

  getBreaker(breakerId: ElectricalBreakerId): ElectricalBreaker {
    return cloneData(
      findById(this.stateValue.breakers, breakerId, "electrical breaker"),
    );
  }

  getLoad(loadId: ElectricalLoadId): ElectricalLoad {
    return cloneData(findById(this.stateValue.loads, loadId, "electrical load"));
  }

  getBattery(batteryId: ElectricalBatteryId): ElectricalBattery {
    return cloneData(
      findById(this.stateValue.batteries, batteryId, "electrical battery"),
    );
  }

  getSensorReading(sensorId: string): ElectricalSensorReading | null {
    const sensor = findById(
      this.stateValue.sensors,
      sensorId,
      "electrical sensor",
    );
    return sensor.latest ? cloneData(sensor.latest) : null;
  }

  getControlLog(): ElectricalControlRecord[] {
    return cloneData(this.stateValue.controlLog);
  }

  getEnergyBalance(): ElectricalEnergyBalance {
    const ledger = this.stateValue.ledger;
    const storedEnergyKWh = totalStoredEnergy(this.stateValue);
    const ledgerExpectedStoredEnergyKWh =
      expectedStoredEnergyBeforeNumericalResidualKWh(ledger) +
      ledger.numericalResidualKWh;
    return {
      storedEnergyKWh,
      ledgerExpectedStoredEnergyKWh,
      closureErrorKWh: storedEnergyKWh - ledgerExpectedStoredEnergyKWh,
      reactorGenerationKWh: ledger.reactorGenerationKWh,
      servedLoadKWh: ledger.servedLoadKWh,
      curtailedGenerationKWh: ledger.curtailedGenerationKWh,
      batteryConversionLossKWh: ledger.batteryConversionLossKWh,
      externalEnergyKWh: ledger.externalEnergyKWh,
      numericalResidualKWh: ledger.numericalResidualKWh,
    };
  }

  getSummary(): ElectricalNetworkSummary {
    const generationPowerKw = this.stateValue.buses.reduce(
      (total, bus) => total + bus.generationPowerKw,
      0,
    );
    const demandedPowerKw = this.stateValue.loads.reduce(
      (total, load) =>
        total +
        (load.enabled &&
        breakerIsClosed(
          findById(this.stateValue.breakers, load.breakerId, "load breaker"),
        )
          ? effectiveLoadDemandPowerKw(load)
          : 0),
      0,
    );
    const servedPowerKw = this.stateValue.loads.reduce(
      (total, load) => total + load.servedPowerKw,
      0,
    );
    const curtailedGenerationKw = this.stateValue.buses.reduce(
      (total, bus) => total + bus.curtailedPowerKw,
      0,
    );
    const batteryNetPowerKw = this.stateValue.batteries.reduce(
      (total, battery) => total + battery.lastPowerKw,
      0,
    );
    return {
      generationPowerKw,
      demandedPowerKw,
      servedPowerKw,
      unservedPowerKw: Math.max(0, demandedPowerKw - servedPowerKw),
      curtailedGenerationKw,
      batteryNetPowerKw,
      batteryStoredEnergyKWh: totalStoredEnergy(this.stateValue),
      batteryCapacityKWh: this.stateValue.batteries.reduce(
        (total, battery) => total + battery.capacityKWh,
        0,
      ),
      criticalServiceFraction: physicalServiceFractionForTier(
        this.stateValue.loads,
        "critical",
      ),
      essentialServiceFraction: physicalServiceFractionForTier(
        this.stateValue.loads,
        "essential",
      ),
      onlineReactorCount: this.stateValue.reactors.filter(
        (reactor) =>
          reactor.mode === "online" && reactor.condition === "nominal",
      ).length,
      hotStandbyReactorCount: this.stateValue.reactors.filter(
        (reactor) =>
          reactor.mode === "hot-standby" && reactor.condition === "nominal",
      ).length,
      energizedBusCount: this.stateValue.buses.filter((bus) => bus.energized)
        .length,
      powerBalanceErrorKw:
        generationPowerKw +
        batteryNetPowerKw -
        servedPowerKw -
        curtailedGenerationKw,
      energyClosureErrorKWh: this.getEnergyBalance().closureErrorKWh,
    };
  }

  getTierServiceFractions(
    tier: LoadTier,
  ): ElectricalTierServiceFractions {
    assertEnum(
      tier,
      [
        "critical",
        "essential",
        "discretionary",
        "jump",
      ] as const,
      "load tier",
    );
    return {
      physicalServiceFraction:
        physicalServiceFractionForTier(
          this.stateValue.loads,
          tier,
        ),
      controllerRequestedServiceFraction:
        controllerRequestedServiceFractionForTier(
          this.stateValue.loads,
          tier,
        ),
    };
  }

  executeControlCommand(
    command: ElectricalControlCommand,
  ): ElectricalControlResult {
    validateControlCommand(command);
    const next = this.snapshot();
    let targetId: string;
    let summary: string;

    switch (command.type) {
      case "set-reactor-target": {
        const reactor = findById(next.reactors, command.reactorId, "reactor");
        if (command.targetOutputKw > reactor.ratedOutputKw) {
          throw new RangeError(
            `${reactor.id} target exceeds its rated output`,
          );
        }
        if (reactor.condition === "tripped") {
          throw new Error(`${reactor.id} is tripped and cannot accept a target`);
        }
        reactor.targetOutputKw = command.targetOutputKw;
        targetId = reactor.id;
        summary = `target output set to ${command.targetOutputKw} kW`;
        break;
      }
      case "set-reactor-mode": {
        const reactor = findById(next.reactors, command.reactorId, "reactor");
        if (reactor.condition === "tripped" && command.mode !== "offline") {
          throw new Error(`${reactor.id} is tripped and must be reset first`);
        }
        reactor.mode = command.mode;
        if (command.mode !== "online") reactor.targetOutputKw = 0;
        targetId = reactor.id;
        summary = `reactor mode set to ${command.mode}`;
        break;
      }
      case "reset-reactor-trip": {
        const reactor = findById(next.reactors, command.reactorId, "reactor");
        if (reactor.condition !== "tripped") {
          throw new Error(`${reactor.id} is not tripped`);
        }
        reactor.condition = "nominal";
        reactor.tripReason = null;
        reactor.mode = "hot-standby";
        reactor.targetOutputKw = 0;
        reactor.outputKw = 0;
        targetId = reactor.id;
        summary = "reactor trip latch reset into hot standby";
        break;
      }
      case "set-breaker": {
        const breaker = findById(next.breakers, command.breakerId, "breaker");
        if (command.commandedClosed && breaker.condition === "tripped") {
          throw new Error(`${breaker.id} is tripped and must be reset first`);
        }
        breaker.commandedClosed = command.commandedClosed;
        targetId = breaker.id;
        summary = `breaker commanded ${command.commandedClosed ? "closed" : "open"}`;
        break;
      }
      case "reset-breaker-trip": {
        const breaker = findById(next.breakers, command.breakerId, "breaker");
        if (breaker.condition !== "tripped") {
          throw new Error(`${breaker.id} is not tripped`);
        }
        breaker.condition = "nominal";
        breaker.tripReason = null;
        breaker.commandedClosed = false;
        targetId = breaker.id;
        summary = "breaker trip latch reset in open state";
        break;
      }
      case "set-load-enabled": {
        const load = findById(next.loads, command.loadId, "load");
        load.enabled = command.enabled;
        targetId = load.id;
        summary = `load ${command.enabled ? "enabled" : "disabled"}`;
        break;
      }
      case "set-battery-mode": {
        const battery = findById(next.batteries, command.batteryId, "battery");
        if (
          conditionPowerFraction(battery.condition) === 0 &&
          command.mode !== "standby"
        ) {
          throw new Error(`${battery.id} is unavailable`);
        }
        battery.controlMode = command.mode;
        targetId = battery.id;
        summary = `battery control mode set to ${command.mode}`;
        break;
      }
    }

    const record = this.appendControlRecord(
      next,
      command.type,
      targetId,
      summary,
      null,
    );
    next.revision += 1;
    dispatchPower(next, 0);
    validateElectricalSnapshot(next);
    this.stateValue = next;
    return {
      record: cloneData(record),
      revision: next.revision,
      summary: this.getSummary(),
    };
  }

  synchronizeLoadControllerDemandFraction(
    loadId: ElectricalLoadId,
    controllerDemandFraction: number,
  ): ElectricalLoad {
    assertFraction(
      controllerDemandFraction,
      "controllerDemandFraction",
    );
    const current = findById(
      this.stateValue.loads,
      loadId,
      "electrical load",
    );
    if (
      current.controllerDemandFraction ===
      controllerDemandFraction
    ) {
      return cloneData(current);
    }
    const next = this.snapshot();
    const load = findById(next.loads, loadId, "electrical load");
    load.controllerDemandFraction = controllerDemandFraction;
    next.revision += 1;
    dispatchPower(next, 0);
    validateElectricalSnapshot(next);
    this.stateValue = next;
    return cloneData(load);
  }

  tripReactor(
    reactorId: FusionReactorId,
    reason: string,
  ): FusionReactor {
    if (reason.trim().length === 0) {
      throw new TypeError("reactor trip reason must be non-empty");
    }
    const next = this.snapshot();
    const reactor = findById(next.reactors, reactorId, "reactor");
    const breaker = findById(next.breakers, reactor.breakerId, "breaker");
    reactor.condition = "tripped";
    reactor.tripReason = reason;
    reactor.mode = "offline";
    reactor.targetOutputKw = 0;
    reactor.outputKw = 0;
    breaker.condition = "tripped";
    breaker.tripReason = `reactor protection: ${reason}`;
    breaker.commandedClosed = false;
    this.appendControlRecord(
      next,
      "reactor-trip",
      reactorId,
      `reactor protection opened ${breaker.id}`,
      reason,
    );
    next.revision += 1;
    dispatchPower(next, 0);
    validateElectricalSnapshot(next);
    this.stateValue = next;
    return this.getReactor(reactorId);
  }

  applyExternalGenerationPower(
    generationPowerKw: number,
    reason: string,
  ): ElectricalNetworkSummary {
    assertNonNegative(
      generationPowerKw,
      "external generation power",
    );
    if (reason.trim().length === 0) {
      throw new TypeError(
        "external generation force reason must be non-empty",
      );
    }
    const next = this.snapshot();
    const eligible = next.reactors
      .filter((reactor) => {
        const breaker = findById(
          next.breakers,
          reactor.breakerId,
          "reactor breaker",
        );
        return (
          reactor.condition === "nominal" &&
          breakerIsClosed(breaker)
        );
      })
      .sort((left, right) => {
        const leftOnline = left.mode === "online" ? 0 : 1;
        const rightOnline = right.mode === "online" ? 0 : 1;
        return leftOnline - rightOnline ||
          left.id.localeCompare(right.id);
      });
    const availablePowerKw = eligible.reduce(
      (total, reactor) => total + reactor.ratedOutputKw,
      0,
    );
    if (generationPowerKw > availablePowerKw) {
      throw new RangeError(
        `external generation power ${generationPowerKw} kW exceeds connected nominal reactor capacity ${availablePowerKw} kW`,
      );
    }

    let remainingPowerKw = generationPowerKw;
    for (const reactor of eligible) {
      const allocatedPowerKw = Math.min(
        reactor.ratedOutputKw,
        remainingPowerKw,
      );
      reactor.targetOutputKw = allocatedPowerKw;
      reactor.outputKw = allocatedPowerKw;
      if (allocatedPowerKw > 0) {
        reactor.mode = "online";
      }
      remainingPowerKw -= allocatedPowerKw;
    }
    this.appendControlRecord(
      next,
      "external-generation-force",
      "fusion-fleet",
      `external authority set connected generation to ${generationPowerKw} kW`,
      reason,
    );
    next.revision += 1;
    dispatchPower(next, 0);
    validateElectricalSnapshot(next);
    this.stateValue = next;
    return this.getSummary();
  }

  tripBreaker(
    breakerId: ElectricalBreakerId,
    reason: string,
  ): ElectricalBreaker {
    if (reason.trim().length === 0) {
      throw new TypeError("breaker trip reason must be non-empty");
    }
    const next = this.snapshot();
    const breaker = findById(next.breakers, breakerId, "breaker");
    breaker.condition = "tripped";
    breaker.tripReason = reason;
    breaker.commandedClosed = false;
    this.appendControlRecord(
      next,
      "breaker-trip",
      breakerId,
      "protection trip opened breaker",
      reason,
    );
    next.revision += 1;
    dispatchPower(next, 0);
    validateElectricalSnapshot(next);
    this.stateValue = next;
    return this.getBreaker(breakerId);
  }

  setBatteryFault(
    batteryId: ElectricalBatteryId,
    condition: BatteryCondition,
    reason: string | null,
  ): ElectricalBattery {
    assertEnum(
      condition,
      ["nominal", "degraded", "thermal-lockout", "failed"] as const,
      "battery condition",
    );
    if (condition !== "nominal" && (reason === null || reason.trim().length === 0)) {
      throw new TypeError("battery fault reason must be non-empty");
    }
    const next = this.snapshot();
    const battery = findById(next.batteries, batteryId, "battery");
    battery.condition = condition;
    battery.faultReason = condition === "nominal" ? null : reason;
    if (conditionPowerFraction(condition) === 0) {
      battery.controlMode = "standby";
      battery.lastPowerKw = 0;
    }
    this.appendControlRecord(
      next,
      "battery-fault",
      batteryId,
      `battery condition set to ${condition}`,
      condition === "nominal" ? null : reason,
    );
    next.revision += 1;
    dispatchPower(next, 0);
    validateElectricalSnapshot(next);
    this.stateValue = next;
    return this.getBattery(batteryId);
  }

  applyExternalBatteryEnergy(
    batteryId: ElectricalBatteryId,
    energyKWh: number,
    reason: string,
  ): ExternalBatteryEnergyResult {
    assertFinite(energyKWh, "energyKWh");
    if (reason.trim().length === 0) {
      throw new TypeError("external battery energy reason must be non-empty");
    }
    const next = this.snapshot();
    const battery = findById(next.batteries, batteryId, "battery");
    const nextEnergyKWh = battery.storedEnergyKWh + energyKWh;
    if (
      nextEnergyKWh < 0 ||
      nextEnergyKWh > battery.capacityKWh ||
      Math.abs(nextEnergyKWh) > MAX_ENERGY_KWH
    ) {
      throw new RangeError("external energy would exceed battery bounds");
    }
    battery.storedEnergyKWh = nextEnergyKWh;
    next.ledger.externalEnergyKWh += energyKWh;
    reconcileNumericalEnergyResidual(next);
    this.appendControlRecord(
      next,
      "battery-energy-injection",
      batteryId,
      `external balance changed stored energy by ${energyKWh} kWh`,
      reason,
    );
    next.revision += 1;
    dispatchPower(next, 0);
    validateElectricalSnapshot(next);
    this.stateValue = next;
    return {
      batteryId,
      appliedEnergyKWh: energyKWh,
      revision: next.revision,
    };
  }

  configureSensor(
    sensorId: string,
    patch: ElectricalSensorPatch,
  ): ElectricalSensor {
    const next = this.snapshot();
    const sensor = findById(next.sensors, sensorId, "electrical sensor");
    Object.assign(sensor, cloneData(patch));
    sensor.pending = [];
    sensor.latest = null;
    sensor.nextSampleMicroseconds =
      next.elapsedMicroseconds + sensor.sampleIntervalMicroseconds;
    sensor.spareNormal = null;
    next.revision += 1;
    validateElectricalSnapshot(next);
    const previous = this.stateValue;
    this.stateValue = next;
    try {
      findById(this.stateValue.sensors, sensorId, "electrical sensor")
        .nextSampleMicroseconds = this.stateValue.elapsedMicroseconds;
      this.sampleDueSensors();
      this.deliverAvailableReadings();
      validateElectricalSnapshot(this.stateValue);
    } catch (error) {
      this.stateValue = previous;
      throw error;
    }
    return cloneData(findById(this.stateValue.sensors, sensorId, "sensor"));
  }

  step(simulatedSeconds: number): ElectricalStepResult {
    assertNonNegative(simulatedSeconds, "simulatedSeconds");
    const durationMicroseconds = Math.round(
      simulatedSeconds * ELECTRICAL_MICROSECONDS_PER_SECOND,
    );
    assertSafeMicroseconds(durationMicroseconds, "step duration");
    const fromMicroseconds = this.stateValue.elapsedMicroseconds;
    const toMicroseconds = fromMicroseconds + durationMicroseconds;
    assertSafeMicroseconds(toMicroseconds, "step target");

    const beforeStoredEnergyKWh = totalStoredEnergy(this.stateValue);
    const ledgerBefore = cloneData(this.stateValue.ledger);
    let substeps = 0;
    let batteryChargeInputKWh = 0;
    let batteryDischargeOutputKWh = 0;
    const demandedLoadEnergyKWhById = emptyLoadEnergyRecord();
    const servedLoadEnergyKWhById = emptyLoadEnergyRecord();
    let minimumCriticalServiceFraction =
      physicalServiceFractionForTier(
        this.stateValue.loads,
        "critical",
      );

    this.sampleDueSensors();
    this.deliverAvailableReadings();

    while (this.stateValue.elapsedMicroseconds < toMicroseconds) {
      const now = this.stateValue.elapsedMicroseconds;
      const nextSampleMicroseconds = Math.min(
        ...this.stateValue.sensors.map(
          (sensor) => sensor.nextSampleMicroseconds,
        ),
      );
      const nextAvailabilityMicroseconds = this.nextPendingAvailability();
      const boundaryMicroseconds = Math.min(
        toMicroseconds,
        now + MAX_PHYSICS_SUBSTEP_MICROSECONDS,
        nextSampleMicroseconds > now
          ? nextSampleMicroseconds
          : Number.POSITIVE_INFINITY,
        nextAvailabilityMicroseconds !== undefined &&
          nextAvailabilityMicroseconds > now
          ? nextAvailabilityMicroseconds
          : Number.POSITIVE_INFINITY,
      );
      if (
        !Number.isFinite(boundaryMicroseconds) ||
        boundaryMicroseconds <= now
      ) {
        throw new Error("electrical scheduler failed to produce a future boundary");
      }
      const deltaSeconds =
        (boundaryMicroseconds - now) / ELECTRICAL_MICROSECONDS_PER_SECOND;
      const interval = runPowerInterval(this.stateValue, deltaSeconds);
      batteryChargeInputKWh += interval.batteryChargeInputKWh;
      batteryDischargeOutputKWh += interval.batteryDischargeOutputKWh;
      for (const loadId of ELECTRICAL_LOAD_IDS) {
        demandedLoadEnergyKWhById[loadId] +=
          interval.demandedLoadEnergyKWhById[loadId];
        servedLoadEnergyKWhById[loadId] +=
          interval.servedLoadEnergyKWhById[loadId];
      }
      minimumCriticalServiceFraction = Math.min(
        minimumCriticalServiceFraction,
        interval.criticalServiceFraction,
      );
      this.stateValue.elapsedMicroseconds = boundaryMicroseconds;
      substeps += 1;
      this.sampleDueSensors();
      this.deliverAvailableReadings();
    }

    if (durationMicroseconds > 0) this.stateValue.revision += 1;
    validateElectricalSnapshot(this.stateValue);

    const afterStoredEnergyKWh = totalStoredEnergy(this.stateValue);
    const reactorGenerationKWh =
      this.stateValue.ledger.reactorGenerationKWh -
      ledgerBefore.reactorGenerationKWh;
    const servedLoadKWh =
      this.stateValue.ledger.servedLoadKWh - ledgerBefore.servedLoadKWh;
    const curtailedGenerationKWh =
      this.stateValue.ledger.curtailedGenerationKWh -
      ledgerBefore.curtailedGenerationKWh;
    const batteryConversionLossKWh =
      this.stateValue.ledger.batteryConversionLossKWh -
      ledgerBefore.batteryConversionLossKWh;
    const storedEnergyChangeKWh =
      afterStoredEnergyKWh - beforeStoredEnergyKWh;
    return {
      fromMicroseconds,
      toMicroseconds,
      simulatedSeconds:
        durationMicroseconds / ELECTRICAL_MICROSECONDS_PER_SECOND,
      substeps,
      reactorGenerationKWh,
      servedLoadKWh,
      demandedLoadEnergyKWhById,
      servedLoadEnergyKWhById,
      curtailedGenerationKWh,
      batteryChargeInputKWh,
      batteryDischargeOutputKWh,
      batteryConversionLossKWh,
      storedEnergyChangeKWh,
      energyClosureErrorKWh:
        storedEnergyChangeKWh -
        (reactorGenerationKWh -
          servedLoadKWh -
          curtailedGenerationKWh -
          batteryConversionLossKWh),
      minimumCriticalServiceFraction,
      revision: this.stateValue.revision,
    };
  }

  private appendControlRecord(
    snapshot: ElectricalNetworkSnapshot,
    type: ElectricalControlRecordType,
    targetId: string,
    summary: string,
    reason: string | null,
  ): ElectricalControlRecord {
    const record: ElectricalControlRecord = {
      sequence: snapshot.nextControlSequence,
      simulatedAtMicroseconds: snapshot.elapsedMicroseconds,
      type,
      targetId,
      summary,
      reason,
    };
    snapshot.controlLog.push(record);
    snapshot.nextControlSequence += 1;
    return record;
  }

  private sensorTruth(sensor: ElectricalSensor): number {
    switch (sensor.quantity) {
      case "voltageV":
        return findById(this.stateValue.buses, sensor.targetId, "bus").voltageV;
      case "frequencyHz":
        return findById(this.stateValue.buses, sensor.targetId, "bus")
          .frequencyHz;
      case "generationPowerKw":
        return findById(this.stateValue.buses, sensor.targetId, "bus")
          .generationPowerKw;
      case "servedPowerKw":
        return findById(this.stateValue.buses, sensor.targetId, "bus")
          .servedPowerKw;
      case "unservedPowerKw":
        return findById(this.stateValue.buses, sensor.targetId, "bus")
          .unservedPowerKw;
      case "reactorOutputKw":
        return findById(this.stateValue.reactors, sensor.targetId, "reactor")
          .outputKw;
      case "batteryStateOfChargeFraction": {
        const battery = findById(
          this.stateValue.batteries,
          sensor.targetId,
          "battery",
        );
        return battery.storedEnergyKWh / battery.capacityKWh;
      }
      case "batteryPowerKw":
        return findById(this.stateValue.batteries, sensor.targetId, "battery")
          .lastPowerKw;
    }
  }

  private createSensorReading(
    sensor: ElectricalSensor,
    sampledAtMicroseconds: number,
  ): ElectricalSensorReading {
    const trueValue = this.sensorTruth(sensor);
    let value: number | null;
    if (sensor.condition === "offline") {
      value = null;
    } else if (sensor.condition === "stuck") {
      if (sensor.stuckValue === null) {
        sensor.stuckValue = sensor.latest?.value ?? trueValue;
      }
      value = sensor.stuckValue;
    } else {
      const noiseMultiplier = sensor.condition === "degraded" ? 4 : 1;
      value =
        trueValue +
        sensor.bias +
        sensor.driftPerSecond *
          (sampledAtMicroseconds / ELECTRICAL_MICROSECONDS_PER_SECOND) +
        nextNormal(sensor) *
          sensor.noiseStandardDeviation *
          noiseMultiplier;
    }
    return {
      sensorId: sensor.id,
      targetId: sensor.targetId,
      quantity: sensor.quantity,
      sampledAtMicroseconds,
      availableAtMicroseconds:
        sampledAtMicroseconds + sensor.delayMicroseconds,
      value,
      quality: sensor.condition,
    };
  }

  private sampleDueSensors(): void {
    const now = this.stateValue.elapsedMicroseconds;
    for (const sensor of this.stateValue.sensors) {
      while (sensor.nextSampleMicroseconds <= now) {
        sensor.pending.push(
          this.createSensorReading(sensor, sensor.nextSampleMicroseconds),
        );
        sensor.nextSampleMicroseconds += sensor.sampleIntervalMicroseconds;
        assertSafeMicroseconds(
          sensor.nextSampleMicroseconds,
          `${sensor.id}.nextSampleMicroseconds`,
        );
      }
    }
  }

  private deliverAvailableReadings(): void {
    const now = this.stateValue.elapsedMicroseconds;
    for (const sensor of this.stateValue.sensors) {
      let latest: ElectricalSensorReading | null = null;
      while (
        sensor.pending.length > 0 &&
        sensor.pending[0].availableAtMicroseconds <= now
      ) {
        latest = sensor.pending.shift() as ElectricalSensorReading;
      }
      if (latest) sensor.latest = latest;
    }
  }

  private nextPendingAvailability(): number | undefined {
    let next: number | undefined;
    for (const sensor of this.stateValue.sensors) {
      const availableAt = sensor.pending[0]?.availableAtMicroseconds;
      if (
        availableAt !== undefined &&
        (next === undefined || availableAt < next)
      ) {
        next = availableAt;
      }
    }
    return next;
  }

  snapshot(): ElectricalNetworkSnapshot {
    return cloneData(this.stateValue);
  }

  serialize(): string {
    return JSON.stringify(this.stateValue);
  }

  static restore(
    source: string | ElectricalNetworkSnapshot,
  ): ShipElectricalNetwork {
    const parsed: unknown =
      typeof source === "string" ? JSON.parse(source) : cloneData(source);
    validateElectricalSnapshot(parsed);
    const restored = new ShipElectricalNetwork({ seed: 0 });
    restored.stateValue = cloneData(parsed);
    return restored;
  }
}

/** @internal Regression hook for two-bus tie-flow assignment. */
export function assignTwoBusNetTransferPowerKwForRegressionTest(
  first: ElectricalBus,
  second: ElectricalBus,
): void {
  assignTwoBusNetTransferPowerKw(first, second);
}
