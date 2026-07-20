/**
 * Deterministic counter-rotating habitat-ring domain.
 *
 * Coordinate and coupling conventions:
 * - public quantities use SI units unless a field explicitly says rpm or g;
 * - +X is the ship roll axis;
 * - ring state stores angular velocity relative to the carrier body;
 * - the carrier X inertia supplied by navigation already includes both rings
 *   as co-rotating mass, so the rings must not be counted as independent
 *   absolute rotors a second time;
 * - total angular momentum is
 *     I_total * Omega + sum(I_ring * omega_relative);
 * - the ring-dependent addition to kinetic energy is
 *     Omega * sum(I_ring * omega_relative)
 *       + 0.5 * sum(I_ring * omega_relative ** 2).
 *
 * Every internal bearing, brake, or drive impulse returns an equal and
 * opposite carrierBodyAngularImpulseX for navigation to apply.
 */

export const ROTATION_SNAPSHOT_VERSION = 1 as const;
export const ROTATION_MICROSECONDS_PER_SECOND = 1_000_000;
export const ROTATION_STANDARD_GRAVITY_M_PER_S2 = 9.80665;
export const HABITAT_RING_RADIUS_M = 224;
export const HABITAT_RING_MASS_KG = 18_000_000;
export const HABITAT_RING_INERTIA_KG_M2 =
  HABITAT_RING_MASS_KG * HABITAT_RING_RADIUS_M ** 2;

export const ROTATION_RING_IDS = ["ring-a", "ring-b"] as const;
export type RotationRingId = (typeof ROTATION_RING_IDS)[number];

export type RingControlMode = "speed-hold" | "coast" | "brake";
export type RingDriveCondition = "nominal" | "degraded" | "failed";
export type RingBearingCondition =
  | "nominal"
  | "degraded"
  | "seized";

export interface RotationCarrierState {
  angularVelocityXRadPerS: number;
  inertiaXKgM2: number;
  revision: number;
}

export interface RingDrive {
  condition: RingDriveCondition;
  maximumTorqueNm: number;
  efficiency: number;
  controlPowerW: number;
}

export interface RingBearing {
  condition: RingBearingCondition;
  maximumFrictionTorqueNm: number;
  coulombFrictionTorqueNm: number;
  viscousFrictionCoefficientNms: number;
  brakeMaximumTorqueNm: number;
}

export interface HabitatRing {
  id: RotationRingId;
  label: string;
  radiusM: typeof HABITAT_RING_RADIUS_M;
  massKg: typeof HABITAT_RING_MASS_KG;
  inertiaKgM2: typeof HABITAT_RING_INERTIA_KG_M2;
  relativeAngularVelocityRadPerS: number;
  relativeAngleRad: number;
  controlMode: RingControlMode;
  targetRelativeRpm: number;
  drive: RingDrive;
  bearing: RingBearing;
  fatigueFraction: number;
  bearingWearFraction: number;
  lastDriveTorqueNm: number;
  lastBearingTorqueNm: number;
  lastBrakeTorqueNm: number;
}

export interface RingConfigurationPatch {
  controlMode?: RingControlMode;
  targetRelativeRpm?: number;
  drive?: Partial<
    Pick<
      RingDrive,
      "condition" | "maximumTorqueNm" | "efficiency" | "controlPowerW"
    >
  >;
  bearing?: Partial<
    Pick<
      RingBearing,
      | "condition"
      | "maximumFrictionTorqueNm"
      | "coulombFrictionTorqueNm"
      | "viscousFrictionCoefficientNms"
      | "brakeMaximumTorqueNm"
    >
  >;
}

export const ROTATION_SENSOR_IDS = [
  "sensor:ring-a:relative-rpm",
  "sensor:ring-a:artificial-gravity-g",
  "sensor:ring-a:vibration",
  "sensor:ring-b:relative-rpm",
  "sensor:ring-b:artificial-gravity-g",
  "sensor:ring-b:vibration",
] as const;

export type RotationSensorId =
  (typeof ROTATION_SENSOR_IDS)[number];
export type RotationSensorQuantity =
  | "relativeRpm"
  | "artificialGravityG"
  | "vibrationMmPerS";
export type RotationSensorCondition =
  | "nominal"
  | "degraded"
  | "stuck"
  | "offline";

export interface RotationSensorReading {
  sensorId: RotationSensorId;
  ringId: RotationRingId;
  quantity: RotationSensorQuantity;
  sampledAtMicroseconds: number;
  availableAtMicroseconds: number;
  value: number | null;
  quality: RotationSensorCondition;
}

export interface RotationSensor {
  id: RotationSensorId;
  ringId: RotationRingId;
  quantity: RotationSensorQuantity;
  sampleIntervalMicroseconds: number;
  delayMicroseconds: number;
  noiseStandardDeviation: number;
  bias: number;
  driftPerSecond: number;
  condition: RotationSensorCondition;
  stuckValue: number | null;
  nextSampleMicroseconds: number;
  randomState: number;
  spareNormal: number | null;
  pending: RotationSensorReading[];
  latest: RotationSensorReading | null;
}

export type RotationSensorPatch = Partial<
  Pick<
    RotationSensor,
    | "sampleIntervalMicroseconds"
    | "delayMicroseconds"
    | "noiseStandardDeviation"
    | "bias"
    | "driftPerSecond"
    | "condition"
    | "stuckValue"
  >
>;

export interface RotationEnergyLedger {
  requestedElectricalEnergyJ: number;
  servedElectricalEnergyJ: number;
  controlElectricalHeatJ: number;
  driveElectricalLossHeatJ: number;
  bearingFrictionHeatJ: number;
  mechanicalBrakeHeatJ: number;
  activeBrakingHeatJ: number;
  heatJ: number;
  positiveDriveMechanicalWorkJ: number;
  carrierKineticEnergyChangeJ: number;
  ringAdditionalKineticEnergyChangeJ: number;
  mechanicalEnergyChangeJ: number;
  numericalResidualJ: number;
}

export interface RotationSnapshot {
  snapshotVersion: typeof ROTATION_SNAPSHOT_VERSION;
  elapsedMicroseconds: number;
  revision: number;
  rings: HabitatRing[];
  sensors: RotationSensor[];
  energyLedger: RotationEnergyLedger;
  /**
   * Signed impulse delivered to the navigation carrier since the current
   * frame epoch. It has the same sign as RotationStepResult.
   * carrierBodyAngularImpulseX and navigation's applied internal impulse.
   * The rings' relative-angular-momentum change is its negative.
   */
  carrierAngularImpulseXSinceFrame: number;
  /**
   * Predicted carrier kinetic-energy change caused by those internal
   * impulses since the current frame epoch. This has the same sign as the
   * corresponding navigation internal-mechanical-energy transfer.
   */
  carrierKineticEnergyChangeJSinceFrame: number;
  lastCarrierState: RotationCarrierState;
}

export interface RotationControlPreview {
  fromMicroseconds: number;
  toMicroseconds: number;
  rotationRevision: number;
  carrierState: RotationCarrierState;
  requestedEnergyJByRing: Record<RotationRingId, number>;
}

export interface RotationEnergyBalance
  extends RotationEnergyLedger {
  heatComponentSumJ: number;
  mechanicalComponentSumJ: number;
  closureResidualJ: number;
  closureErrorJ: number;
}

export interface RingTruthSummary {
  id: RotationRingId;
  controlMode: RingControlMode;
  targetRelativeRpm: number;
  relativeRpm: number;
  absoluteRpm: number;
  artificialGravityG: number;
  relativeAngularMomentumKgM2PerS: number;
  structureCentripetalLoadN: number;
  bearingRadialLoadN: number;
  coriolisCoefficientPerSecond: number;
  coriolisAccelerationAtOneMPerS2: number;
  vibrationMmPerS: number;
  fatigueFraction: number;
  bearingWearFraction: number;
  driveCondition: RingDriveCondition;
  bearingCondition: RingBearingCondition;
}

export interface RotationSummary {
  elapsedSeconds: number;
  revision: number;
  carrierAngularVelocityXRadPerS: number;
  carrierInertiaXKgM2: number;
  netRelativeRingAngularMomentumKgM2PerS: number;
  totalAngularMomentumXKgM2PerS: number;
  carrierKineticEnergyJ: number;
  ringAdditionalKineticEnergyJ: number;
  totalCoupledKineticEnergyJ: number;
  carrierAngularImpulseXSinceFrame: number;
  carrierKineticEnergyChangeJSinceFrame: number;
  rings: RingTruthSummary[];
  energyClosureErrorJ: number;
}

export interface RotationStepResult {
  fromMicroseconds: number;
  toMicroseconds: number;
  revision: number;
  requestedEnergyJByRing: Record<RotationRingId, number>;
  servedEnergyJByRing: Record<RotationRingId, number>;
  heatJ: number;
  carrierBodyAngularImpulseX: number;
  carrierBodyAngularImpulseXByRing: Record<RotationRingId, number>;
  predictedCarrierAngularVelocityXRadPerS: number;
  positiveDriveMechanicalWorkJByRing: Record<RotationRingId, number>;
  energyBalance: RotationEnergyBalance;
  summary: RotationSummary;
}

export interface CounterRotatingHabitatOptions {
  seed?: number | string;
  initialCarrierState?: RotationCarrierState;
}

const TWO_PI = Math.PI * 2;
const INITIAL_RELATIVE_RPM = 2;
const MAX_RELATIVE_ANGULAR_SPEED_RAD_PER_S = 2;
const MAX_TARGET_RELATIVE_RPM = 12;
const MAX_CARRIER_ANGULAR_SPEED_RAD_PER_S = 10;
const MAX_CARRIER_INERTIA_KG_M2 = 1e22;
const MAX_TORQUE_NM = 1e10;
const MAX_CONTROL_POWER_W = 1e9;
const MAX_SENSOR_INTERVAL_MICROSECONDS =
  24 * 60 * 60 * ROTATION_MICROSECONDS_PER_SECOND;
const MAX_SENSOR_DELAY_MICROSECONDS =
  24 * 60 * 60 * ROTATION_MICROSECONDS_PER_SECOND;
const MAX_SENSOR_PENDING_READINGS = 100_000;
const ENERGY_RELATIVE_TOLERANCE = 2e-9;
const ENERGY_ABSOLUTE_TOLERANCE_J = 1e-2;
const FIVE_YEARS_SECONDS = 5 * 365.25 * 86_400;
const THIRTY_YEARS_SECONDS = 30 * 365.25 * 86_400;

interface SensorSpecification {
  id: RotationSensorId;
  ringId: RotationRingId;
  quantity: RotationSensorQuantity;
  noiseStandardDeviation: number;
}

const SENSOR_SPECIFICATIONS: readonly SensorSpecification[] = [
  {
    id: "sensor:ring-a:relative-rpm",
    ringId: "ring-a",
    quantity: "relativeRpm",
    noiseStandardDeviation: 0.002,
  },
  {
    id: "sensor:ring-a:artificial-gravity-g",
    ringId: "ring-a",
    quantity: "artificialGravityG",
    noiseStandardDeviation: 0.001,
  },
  {
    id: "sensor:ring-a:vibration",
    ringId: "ring-a",
    quantity: "vibrationMmPerS",
    noiseStandardDeviation: 0.01,
  },
  {
    id: "sensor:ring-b:relative-rpm",
    ringId: "ring-b",
    quantity: "relativeRpm",
    noiseStandardDeviation: 0.002,
  },
  {
    id: "sensor:ring-b:artificial-gravity-g",
    ringId: "ring-b",
    quantity: "artificialGravityG",
    noiseStandardDeviation: 0.001,
  },
  {
    id: "sensor:ring-b:vibration",
    ringId: "ring-b",
    quantity: "vibrationMmPerS",
    noiseStandardDeviation: 0.01,
  },
];

type Pair = [number, number];
type Matrix2 = [[number, number], [number, number]];

interface CoupledState {
  rings: HabitatRing[];
  carrierAngularVelocityXRadPerS: number;
}

interface ImpulseApplication {
  state: CoupledState;
  deltaRelativeAngularVelocity: Pair;
  carrierImpulse: number;
  mechanicalEnergyChangeJ: number;
}

interface PassiveStageResult {
  state: CoupledState;
  heatJ: number;
  generalizedImpulseByRing: Pair;
}

interface ActiveStageResult {
  state: CoupledState;
  generalizedImpulseByRing: Pair;
  mechanicalWorkJByRing: Pair;
  mechanicalEnergyChangeJ: number;
}

function cloneData<T>(value: T): T {
  return structuredClone(value);
}

function rpmToRadPerS(rpm: number): number {
  return (rpm * TWO_PI) / 60;
}

function radPerSToRpm(radPerS: number): number {
  return (radPerS * 60) / TWO_PI;
}

function normalizeAngle(angleRad: number): number {
  const normalized = angleRad % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(
      `${label} must contain exactly: ${wanted.join(", ")}`,
    );
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

function assertRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  assertFinite(value, label);
  if (value < minimum || value > maximum) {
    throw new RangeError(
      `${label} must be in [${minimum}, ${maximum}]`,
    );
  }
}

function assertNonNegative(value: number, label: string): void {
  assertRange(value, 0, Number.MAX_VALUE, label);
}

function assertSafeNonNegativeInteger(
  value: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${label} must be a non-negative safe integer`,
    );
  }
}

function assertClose(
  actual: number,
  expected: number,
  label: string,
  relativeTolerance = ENERGY_RELATIVE_TOLERANCE,
  absoluteTolerance = ENERGY_ABSOLUTE_TOLERANCE_J,
): void {
  const tolerance = Math.max(
    absoluteTolerance,
    Math.max(Math.abs(actual), Math.abs(expected)) *
      relativeTolerance,
  );
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label} does not close: expected ${expected}, received ${actual}`,
    );
  }
}

function assertEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${label} is not a supported value`);
  }
}

function ringIndex(ringId: RotationRingId): 0 | 1 {
  const index = ROTATION_RING_IDS.indexOf(ringId);
  if (index < 0) {
    throw new Error(`unknown fixed habitat ring: ${ringId}`);
  }
  return index as 0 | 1;
}

function findRing(
  rings: readonly HabitatRing[],
  ringId: RotationRingId,
): HabitatRing {
  const ring = rings[ringIndex(ringId)];
  if (ring?.id !== ringId) {
    throw new Error("fixed habitat ring order is corrupted");
  }
  return ring;
}

function findSensor(
  sensors: readonly RotationSensor[],
  sensorId: RotationSensorId,
): RotationSensor {
  const index = ROTATION_SENSOR_IDS.indexOf(sensorId);
  if (index < 0 || sensors[index]?.id !== sensorId) {
    throw new Error(`unknown fixed rotation sensor: ${sensorId}`);
  }
  return sensors[index];
}

function pairRecord(values: Pair): Record<RotationRingId, number> {
  return {
    "ring-a": values[0],
    "ring-b": values[1],
  };
}

function recordPair(
  value: Record<RotationRingId, number>,
): Pair {
  return [value["ring-a"], value["ring-b"]];
}

function assertRingEnergyRecord(
  value: unknown,
  label: string,
): asserts value is Record<RotationRingId, number> {
  assertRecord(value, label);
  assertExactKeys(value, ROTATION_RING_IDS, label);
  for (const ringId of ROTATION_RING_IDS) {
    assertNonNegative(
      value[ringId] as number,
      `${label}.${ringId}`,
    );
  }
}

function hashSeed(seed: number | string): number {
  if (typeof seed === "number") {
    assertFinite(seed, "seed");
    return Math.trunc(seed) >>> 0;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function nextUniform(sensor: RotationSensor): number {
  sensor.randomState = (sensor.randomState + 0x6d2b79f5) >>> 0;
  let value = sensor.randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

function nextNormal(sensor: RotationSensor): number {
  if (sensor.spareNormal !== null) {
    const spare = sensor.spareNormal;
    sensor.spareNormal = null;
    return spare;
  }
  const first = Math.max(nextUniform(sensor), Number.MIN_VALUE);
  const second = nextUniform(sensor);
  const magnitude = Math.sqrt(-2 * Math.log(first));
  const angle = TWO_PI * second;
  sensor.spareNormal = magnitude * Math.sin(angle);
  return magnitude * Math.cos(angle);
}

function validateCarrierState(
  value: unknown,
  label: string,
): asserts value is RotationCarrierState {
  assertRecord(value, label);
  assertExactKeys(
    value,
    ["angularVelocityXRadPerS", "inertiaXKgM2", "revision"],
    label,
  );
  assertRange(
    value.angularVelocityXRadPerS as number,
    -MAX_CARRIER_ANGULAR_SPEED_RAD_PER_S,
    MAX_CARRIER_ANGULAR_SPEED_RAD_PER_S,
    `${label}.angularVelocityXRadPerS`,
  );
  assertRange(
    value.inertiaXKgM2 as number,
    HABITAT_RING_INERTIA_KG_M2 * ROTATION_RING_IDS.length *
      (1 + 1e-12),
    MAX_CARRIER_INERTIA_KG_M2,
    `${label}.inertiaXKgM2`,
  );
  assertSafeNonNegativeInteger(
    value.revision as number,
    `${label}.revision`,
  );
}

function makeBaselineRing(
  ringId: RotationRingId,
): HabitatRing {
  const direction = ringId === "ring-a" ? 1 : -1;
  return {
    id: ringId,
    label:
      ringId === "ring-a"
        ? "A 环 / 正向居住环"
        : "B 环 / 反向居住环",
    radiusM: HABITAT_RING_RADIUS_M,
    massKg: HABITAT_RING_MASS_KG,
    inertiaKgM2: HABITAT_RING_INERTIA_KG_M2,
    relativeAngularVelocityRadPerS:
      direction * rpmToRadPerS(INITIAL_RELATIVE_RPM),
    relativeAngleRad: 0,
    controlMode: "speed-hold",
    targetRelativeRpm: direction * INITIAL_RELATIVE_RPM,
    drive: {
      condition: "nominal",
      maximumTorqueNm: 8_000_000,
      efficiency: 0.92,
      controlPowerW: 100_000,
    },
    bearing: {
      condition: "nominal",
      maximumFrictionTorqueNm: 30_000_000,
      coulombFrictionTorqueNm: 100_000,
      viscousFrictionCoefficientNms: 200_000,
      brakeMaximumTorqueNm: 12_000_000,
    },
    fatigueFraction: 0,
    bearingWearFraction: 0,
    lastDriveTorqueNm: 0,
    lastBearingTorqueNm: 0,
    lastBrakeTorqueNm: 0,
  };
}

function makeBaselineSensors(seed: number | string): RotationSensor[] {
  const baseSeed = hashSeed(seed);
  return SENSOR_SPECIFICATIONS.map((specification, index) => ({
    id: specification.id,
    ringId: specification.ringId,
    quantity: specification.quantity,
    sampleIntervalMicroseconds:
      60 * ROTATION_MICROSECONDS_PER_SECOND,
    delayMicroseconds: 5 * ROTATION_MICROSECONDS_PER_SECOND,
    noiseStandardDeviation:
      specification.noiseStandardDeviation,
    bias: 0,
    driftPerSecond: 0,
    condition: "nominal",
    stuckValue: null,
    nextSampleMicroseconds: 0,
    randomState:
      (baseSeed + Math.imul(index + 1, 0x9e3779b9)) >>> 0,
    spareNormal: null,
    pending: [],
    latest: null,
  }));
}

function emptyEnergyLedger(): RotationEnergyLedger {
  return {
    requestedElectricalEnergyJ: 0,
    servedElectricalEnergyJ: 0,
    controlElectricalHeatJ: 0,
    driveElectricalLossHeatJ: 0,
    bearingFrictionHeatJ: 0,
    mechanicalBrakeHeatJ: 0,
    activeBrakingHeatJ: 0,
    heatJ: 0,
    positiveDriveMechanicalWorkJ: 0,
    carrierKineticEnergyChangeJ: 0,
    ringAdditionalKineticEnergyChangeJ: 0,
    mechanicalEnergyChangeJ: 0,
    numericalResidualJ: 0,
  };
}

function makeBaselineSnapshot(
  options: CounterRotatingHabitatOptions,
): RotationSnapshot {
  const lastCarrierState =
    options.initialCarrierState === undefined
      ? {
          angularVelocityXRadPerS: 0,
          inertiaXKgM2: 5e15,
          revision: 0,
        }
      : cloneData(options.initialCarrierState);
  validateCarrierState(lastCarrierState, "initialCarrierState");
  return {
    snapshotVersion: ROTATION_SNAPSHOT_VERSION,
    elapsedMicroseconds: 0,
    revision: 0,
    rings: ROTATION_RING_IDS.map(makeBaselineRing),
    sensors: makeBaselineSensors(options.seed ?? 0x726f7461),
    energyLedger: emptyEnergyLedger(),
    carrierAngularImpulseXSinceFrame: 0,
    carrierKineticEnergyChangeJSinceFrame: 0,
    lastCarrierState,
  };
}

function effectiveMassMatrix(
  carrierInertiaXKgM2: number,
  rings: readonly HabitatRing[],
): Matrix2 {
  const first = rings[0].inertiaKgM2;
  const second = rings[1].inertiaKgM2;
  return [
    [
      first - (first * first) / carrierInertiaXKgM2,
      -(first * second) / carrierInertiaXKgM2,
    ],
    [
      -(first * second) / carrierInertiaXKgM2,
      second - (second * second) / carrierInertiaXKgM2,
    ],
  ];
}

function invertMatrix(matrix: Matrix2): Matrix2 {
  const determinant =
    matrix[0][0] * matrix[1][1] -
    matrix[0][1] * matrix[1][0];
  if (!Number.isFinite(determinant) || determinant <= 0) {
    throw new RangeError(
      "carrier inertia produces a singular ring coupling matrix",
    );
  }
  return [
    [
      matrix[1][1] / determinant,
      -matrix[0][1] / determinant,
    ],
    [
      -matrix[1][0] / determinant,
      matrix[0][0] / determinant,
    ],
  ];
}

function multiplyMatrixVector(
  matrix: Matrix2,
  vector: Pair,
): Pair {
  return [
    matrix[0][0] * vector[0] +
      matrix[0][1] * vector[1],
    matrix[1][0] * vector[0] +
      matrix[1][1] * vector[1],
  ];
}

function relativeAngularVelocityPair(
  rings: readonly HabitatRing[],
): Pair {
  return [
    rings[0].relativeAngularVelocityRadPerS,
    rings[1].relativeAngularVelocityRadPerS,
  ];
}

function netRelativeRingAngularMomentum(
  rings: readonly HabitatRing[],
): number {
  return rings.reduce(
    (total, ring) =>
      total +
      ring.inertiaKgM2 *
        ring.relativeAngularVelocityRadPerS,
    0,
  );
}

function carrierKineticEnergy(
  carrierState: Pick<
    RotationCarrierState,
    "angularVelocityXRadPerS" | "inertiaXKgM2"
  >,
): number {
  return (
    0.5 *
    carrierState.inertiaXKgM2 *
    carrierState.angularVelocityXRadPerS ** 2
  );
}

function ringAdditionalKineticEnergy(
  carrierAngularVelocityXRadPerS: number,
  rings: readonly HabitatRing[],
): number {
  const relativeMomentum =
    netRelativeRingAngularMomentum(rings);
  const relativeQuadratic = rings.reduce(
    (total, ring) =>
      total +
      0.5 *
        ring.inertiaKgM2 *
        ring.relativeAngularVelocityRadPerS ** 2,
    0,
  );
  return (
    carrierAngularVelocityXRadPerS * relativeMomentum +
    relativeQuadratic
  );
}

function coupledKineticEnergy(
  carrierInertiaXKgM2: number,
  carrierAngularVelocityXRadPerS: number,
  rings: readonly HabitatRing[],
): number {
  return (
    0.5 *
      carrierInertiaXKgM2 *
      carrierAngularVelocityXRadPerS ** 2 +
    ringAdditionalKineticEnergy(
      carrierAngularVelocityXRadPerS,
      rings,
    )
  );
}

function applyGeneralizedImpulses(
  state: CoupledState,
  carrierInertiaXKgM2: number,
  impulses: Pair,
): ImpulseApplication {
  const rings = cloneData(state.rings);
  const inverse = invertMatrix(
    effectiveMassMatrix(carrierInertiaXKgM2, rings),
  );
  const delta = multiplyMatrixVector(inverse, impulses);
  const beforeEnergy = coupledKineticEnergy(
    carrierInertiaXKgM2,
    state.carrierAngularVelocityXRadPerS,
    rings,
  );
  for (let index = 0; index < rings.length; index += 1) {
    rings[index].relativeAngularVelocityRadPerS += delta[index];
    assertRange(
      rings[index].relativeAngularVelocityRadPerS,
      -MAX_RELATIVE_ANGULAR_SPEED_RAD_PER_S,
      MAX_RELATIVE_ANGULAR_SPEED_RAD_PER_S,
      `${rings[index].id}.relativeAngularVelocityRadPerS`,
    );
  }
  const carrierImpulse =
    -rings.reduce(
      (total, ring, index) =>
        total + ring.inertiaKgM2 * delta[index],
      0,
    );
  const carrierAngularVelocityXRadPerS =
    state.carrierAngularVelocityXRadPerS +
    carrierImpulse / carrierInertiaXKgM2;
  const afterEnergy = coupledKineticEnergy(
    carrierInertiaXKgM2,
    carrierAngularVelocityXRadPerS,
    rings,
  );
  return {
    state: {
      rings,
      carrierAngularVelocityXRadPerS,
    },
    deltaRelativeAngularVelocity: delta,
    carrierImpulse,
    mechanicalEnergyChangeJ: afterEnergy - beforeEnergy,
  };
}

function bearingFrictionTorque(ring: HabitatRing): number {
  const base = Math.min(
    ring.bearing.maximumFrictionTorqueNm,
    ring.bearing.coulombFrictionTorqueNm +
      ring.bearing.viscousFrictionCoefficientNms *
        Math.abs(ring.relativeAngularVelocityRadPerS),
  );
  switch (ring.bearing.condition) {
    case "nominal":
      return base;
    case "degraded":
      return Math.min(
        ring.bearing.maximumFrictionTorqueNm,
        base * 4,
      );
    case "seized":
      return ring.bearing.maximumFrictionTorqueNm;
  }
}

function applyDissipativeTorques(
  initial: CoupledState,
  carrierInertiaXKgM2: number,
  durationSeconds: number,
  torqueForRing: (
    ring: HabitatRing,
    index: 0 | 1,
  ) => number,
): PassiveStageResult {
  const state = cloneData(initial);
  let impulses = state.rings.map((ring, index) => {
    const speed = ring.relativeAngularVelocityRadPerS;
    const torque = Math.max(
      0,
      torqueForRing(ring, index as 0 | 1),
    );
    return (
      speed === 0
        ? 0
        : -Math.sign(speed) * torque * durationSeconds
    );
  }) as Pair;
  const inverse = invertMatrix(
    effectiveMassMatrix(carrierInertiaXKgM2, state.rings),
  );
  const rawDelta = multiplyMatrixVector(inverse, impulses);
  let scale = 1;
  for (let index = 0; index < 2; index += 1) {
    const before =
      state.rings[index].relativeAngularVelocityRadPerS;
    const after = before + rawDelta[index];
    if (
      before !== 0 &&
      Math.sign(after) !== Math.sign(before)
    ) {
      scale = Math.min(
        scale,
        Math.abs(before / rawDelta[index]),
      );
    }
  }
  impulses = [impulses[0] * scale, impulses[1] * scale];
  const applied = applyGeneralizedImpulses(
    state,
    carrierInertiaXKgM2,
    impulses,
  );
  const tolerance = Math.max(
    ENERGY_ABSOLUTE_TOLERANCE_J,
    Math.abs(applied.mechanicalEnergyChangeJ) *
      ENERGY_RELATIVE_TOLERANCE,
  );
  if (applied.mechanicalEnergyChangeJ > tolerance) {
    throw new Error(
      "a passive ring torque attempted to create mechanical energy",
    );
  }
  return {
    state: applied.state,
    heatJ: Math.max(0, -applied.mechanicalEnergyChangeJ),
    generalizedImpulseByRing: impulses,
  };
}

function driveTorqueFraction(condition: RingDriveCondition): number {
  switch (condition) {
    case "nominal":
      return 1;
    case "degraded":
      return 0.5;
    case "failed":
      return 0;
  }
}

function desiredDriveImpulses(
  state: CoupledState,
  carrierInertiaXKgM2: number,
  durationSeconds: number,
  controlFractionByRing: Pair,
): Pair {
  const desiredDelta: Pair = [0, 0];
  for (let index = 0; index < state.rings.length; index += 1) {
    const ring = state.rings[index];
    if (ring.controlMode === "speed-hold") {
      desiredDelta[index] =
        rpmToRadPerS(ring.targetRelativeRpm) -
        ring.relativeAngularVelocityRadPerS;
    }
  }
  const matrix = effectiveMassMatrix(
    carrierInertiaXKgM2,
    state.rings,
  );
  const desired = multiplyMatrixVector(matrix, desiredDelta);
  return desired.map((impulse, index) => {
    const ring = state.rings[index];
    if (ring.controlMode !== "speed-hold") return 0;
    const maximumImpulse =
      ring.drive.maximumTorqueNm *
      driveTorqueFraction(ring.drive.condition) *
      controlFractionByRing[index] *
      durationSeconds;
    return Math.max(
      -maximumImpulse,
      Math.min(maximumImpulse, impulse),
    );
  }) as Pair;
}

function workByActuator(
  beforeRelativeSpeed: Pair,
  deltaRelativeSpeed: Pair,
  impulses: Pair,
): Pair {
  return [
    impulses[0] *
      (beforeRelativeSpeed[0] +
        0.5 * deltaRelativeSpeed[0]),
    impulses[1] *
      (beforeRelativeSpeed[1] +
        0.5 * deltaRelativeSpeed[1]),
  ];
}

function limitImpulsesByAvailableEnergy(
  state: CoupledState,
  carrierInertiaXKgM2: number,
  candidate: Pair,
  availableDriveInputJByRing: Pair,
): Pair {
  const before = relativeAngularVelocityPair(state.rings);
  const scales: Pair = [1, 1];
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const impulses: Pair = [
      candidate[0] * scales[0],
      candidate[1] * scales[1],
    ];
    const delta = multiplyMatrixVector(
      invertMatrix(
        effectiveMassMatrix(
          carrierInertiaXKgM2,
          state.rings,
        ),
      ),
      impulses,
    );
    const work = workByActuator(before, delta, impulses);
    let changed = false;
    for (let index = 0; index < 2; index += 1) {
      const allowed =
        availableDriveInputJByRing[index] *
        state.rings[index].drive.efficiency;
      if (
        work[index] >
        allowed +
          Math.max(
            ENERGY_ABSOLUTE_TOLERANCE_J,
            allowed * ENERGY_RELATIVE_TOLERANCE,
          )
      ) {
        const ratio =
          work[index] > 0
            ? Math.max(0, Math.min(1, allowed / work[index]))
            : 0;
        scales[index] *= ratio;
        changed = true;
      }
    }
    if (!changed) return impulses;
  }
  return [
    candidate[0] * scales[0],
    candidate[1] * scales[1],
  ];
}

function applyActiveDrive(
  initial: CoupledState,
  carrierInertiaXKgM2: number,
  durationSeconds: number,
  controlFractionByRing: Pair,
  availableDriveInputJByRing: Pair,
): ActiveStageResult {
  const beforeRelativeSpeed =
    relativeAngularVelocityPair(initial.rings);
  const candidate = desiredDriveImpulses(
    initial,
    carrierInertiaXKgM2,
    durationSeconds,
    controlFractionByRing,
  );
  const impulses = limitImpulsesByAvailableEnergy(
    initial,
    carrierInertiaXKgM2,
    candidate,
    availableDriveInputJByRing,
  );
  const applied = applyGeneralizedImpulses(
    initial,
    carrierInertiaXKgM2,
    impulses,
  );
  const work = workByActuator(
    beforeRelativeSpeed,
    applied.deltaRelativeAngularVelocity,
    impulses,
  );
  assertClose(
    work[0] + work[1],
    applied.mechanicalEnergyChangeJ,
    "active generalized work",
  );
  for (let index = 0; index < 2; index += 1) {
    const positiveWork = Math.max(0, work[index]);
    const maximumMechanicalWork =
      availableDriveInputJByRing[index] *
      initial.rings[index].drive.efficiency;
    if (
      positiveWork >
      maximumMechanicalWork +
        Math.max(
          ENERGY_ABSOLUTE_TOLERANCE_J,
          maximumMechanicalWork *
            ENERGY_RELATIVE_TOLERANCE,
        )
    ) {
      throw new Error(
        `${initial.rings[index].id} drive exceeded served energy`,
      );
    }
  }
  return {
    state: applied.state,
    generalizedImpulseByRing: impulses,
    mechanicalWorkJByRing: work,
    mechanicalEnergyChangeJ:
      applied.mechanicalEnergyChangeJ,
  };
}

function controlEnergyRequest(
  ring: HabitatRing,
  durationSeconds: number,
): number {
  return ring.controlMode === "coast"
    ? 0
    : ring.drive.controlPowerW * durationSeconds;
}

function previewRequestedEnergy(
  rings: readonly HabitatRing[],
  carrierState: RotationCarrierState,
  durationSeconds: number,
): Pair {
  let state: CoupledState = {
    rings: rings.map((ring) => cloneData(ring)),
    carrierAngularVelocityXRadPerS:
      carrierState.angularVelocityXRadPerS,
  };
  const bearing = applyDissipativeTorques(
    state,
    carrierState.inertiaXKgM2,
    durationSeconds,
    (ring) => bearingFrictionTorque(ring),
  );
  state = bearing.state;
  const brake = applyDissipativeTorques(
    state,
    carrierState.inertiaXKgM2,
    durationSeconds,
    (ring) =>
      ring.controlMode === "brake"
        ? ring.bearing.brakeMaximumTorqueNm
        : 0,
  );
  state = brake.state;
  const effectivelyUnlimitedInput: Pair = [
    Number.MAX_VALUE,
    Number.MAX_VALUE,
  ];
  const active = applyActiveDrive(
    state,
    carrierState.inertiaXKgM2,
    durationSeconds,
    [1, 1],
    effectivelyUnlimitedInput,
  );
  return ROTATION_RING_IDS.map((ringId, index) => {
    const ring = rings[index];
    const control = controlEnergyRequest(ring, durationSeconds);
    const positiveMechanicalWork = Math.max(
      0,
      active.mechanicalWorkJByRing[index],
    );
    return (
      control +
      positiveMechanicalWork / ring.drive.efficiency
    );
  }) as Pair;
}

function ringAbsoluteAngularVelocity(
  ring: HabitatRing,
  carrierAngularVelocityXRadPerS: number,
): number {
  return (
    carrierAngularVelocityXRadPerS +
    ring.relativeAngularVelocityRadPerS
  );
}

function artificialGravityG(
  ring: HabitatRing,
  carrierAngularVelocityXRadPerS: number,
): number {
  const absolute = ringAbsoluteAngularVelocity(
    ring,
    carrierAngularVelocityXRadPerS,
  );
  return (
    (absolute ** 2 * ring.radiusM) /
    ROTATION_STANDARD_GRAVITY_M_PER_S2
  );
}

function ringVibrationMmPerS(
  ring: HabitatRing,
  carrierAngularVelocityXRadPerS: number,
): number {
  const conditionContribution =
    ring.bearing.condition === "nominal"
      ? 0
      : ring.bearing.condition === "degraded"
        ? 0.8
        : 6;
  const torqueFraction =
    (Math.abs(ring.lastBearingTorqueNm) +
      Math.abs(ring.lastBrakeTorqueNm) +
      0.15 * Math.abs(ring.lastDriveTorqueNm)) /
    Math.max(1, ring.bearing.maximumFrictionTorqueNm);
  return (
    0.08 +
    Math.abs(
      radPerSToRpm(
        ringAbsoluteAngularVelocity(
          ring,
          carrierAngularVelocityXRadPerS,
        ),
      ),
    ) *
      0.012 +
    ring.bearingWearFraction * 5 +
    conditionContribution +
    Math.min(10, torqueFraction * 2)
  );
}

function ringTruthSummary(
  ring: HabitatRing,
  carrierAngularVelocityXRadPerS: number,
): RingTruthSummary {
  const absoluteAngularVelocity = ringAbsoluteAngularVelocity(
    ring,
    carrierAngularVelocityXRadPerS,
  );
  const structureCentripetalLoadN =
    ring.massKg *
    ring.radiusM *
    absoluteAngularVelocity ** 2;
  const vibration = ringVibrationMmPerS(
    ring,
    carrierAngularVelocityXRadPerS,
  );
  const bearingRadialLoadN =
    structureCentripetalLoadN *
      (0.0005 + Math.min(0.05, vibration / 1_000)) +
    (Math.abs(ring.lastDriveTorqueNm) +
      Math.abs(ring.lastBearingTorqueNm) +
      Math.abs(ring.lastBrakeTorqueNm)) /
      ring.radiusM;
  return {
    id: ring.id,
    controlMode: ring.controlMode,
    targetRelativeRpm: ring.targetRelativeRpm,
    relativeRpm: radPerSToRpm(
      ring.relativeAngularVelocityRadPerS,
    ),
    absoluteRpm: radPerSToRpm(absoluteAngularVelocity),
    artificialGravityG: artificialGravityG(
      ring,
      carrierAngularVelocityXRadPerS,
    ),
    relativeAngularMomentumKgM2PerS:
      ring.inertiaKgM2 *
      ring.relativeAngularVelocityRadPerS,
    structureCentripetalLoadN,
    bearingRadialLoadN,
    coriolisCoefficientPerSecond:
      2 * absoluteAngularVelocity,
    coriolisAccelerationAtOneMPerS2:
      2 * Math.abs(absoluteAngularVelocity),
    vibrationMmPerS: vibration,
    fatigueFraction: ring.fatigueFraction,
    bearingWearFraction: ring.bearingWearFraction,
    driveCondition: ring.drive.condition,
    bearingCondition: ring.bearing.condition,
  };
}

function validateDrive(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    ["condition", "maximumTorqueNm", "efficiency", "controlPowerW"],
    label,
  );
  assertEnum(
    value.condition as string,
    ["nominal", "degraded", "failed"] as const,
    `${label}.condition`,
  );
  assertRange(
    value.maximumTorqueNm as number,
    0,
    MAX_TORQUE_NM,
    `${label}.maximumTorqueNm`,
  );
  assertRange(
    value.efficiency as number,
    0.05,
    1,
    `${label}.efficiency`,
  );
  assertRange(
    value.controlPowerW as number,
    0,
    MAX_CONTROL_POWER_W,
    `${label}.controlPowerW`,
  );
}

function validateBearing(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "condition",
      "maximumFrictionTorqueNm",
      "coulombFrictionTorqueNm",
      "viscousFrictionCoefficientNms",
      "brakeMaximumTorqueNm",
    ],
    label,
  );
  assertEnum(
    value.condition as string,
    ["nominal", "degraded", "seized"] as const,
    `${label}.condition`,
  );
  for (const key of [
    "maximumFrictionTorqueNm",
    "coulombFrictionTorqueNm",
    "viscousFrictionCoefficientNms",
    "brakeMaximumTorqueNm",
  ] as const) {
    assertRange(
      value[key] as number,
      0,
      MAX_TORQUE_NM,
      `${label}.${key}`,
    );
  }
  if (
    (value.coulombFrictionTorqueNm as number) >
    (value.maximumFrictionTorqueNm as number)
  ) {
    throw new RangeError(
      `${label}.coulombFrictionTorqueNm exceeds its maximum`,
    );
  }
}

function validateRing(
  value: unknown,
  expectedId: RotationRingId,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "label",
      "radiusM",
      "massKg",
      "inertiaKgM2",
      "relativeAngularVelocityRadPerS",
      "relativeAngleRad",
      "controlMode",
      "targetRelativeRpm",
      "drive",
      "bearing",
      "fatigueFraction",
      "bearingWearFraction",
      "lastDriveTorqueNm",
      "lastBearingTorqueNm",
      "lastBrakeTorqueNm",
    ],
    label,
  );
  if (
    value.id !== expectedId ||
    value.radiusM !== HABITAT_RING_RADIUS_M ||
    value.massKg !== HABITAT_RING_MASS_KG ||
    value.inertiaKgM2 !== HABITAT_RING_INERTIA_KG_M2 ||
    typeof value.label !== "string" ||
    value.label.length === 0
  ) {
    throw new Error(`${label} violates fixed ring topology`);
  }
  assertRange(
    value.relativeAngularVelocityRadPerS as number,
    -MAX_RELATIVE_ANGULAR_SPEED_RAD_PER_S,
    MAX_RELATIVE_ANGULAR_SPEED_RAD_PER_S,
    `${label}.relativeAngularVelocityRadPerS`,
  );
  assertRange(
    value.relativeAngleRad as number,
    0,
    TWO_PI,
    `${label}.relativeAngleRad`,
  );
  if ((value.relativeAngleRad as number) === TWO_PI) {
    throw new RangeError(`${label}.relativeAngleRad must be below 2π`);
  }
  assertEnum(
    value.controlMode as string,
    ["speed-hold", "coast", "brake"] as const,
    `${label}.controlMode`,
  );
  assertRange(
    value.targetRelativeRpm as number,
    -MAX_TARGET_RELATIVE_RPM,
    MAX_TARGET_RELATIVE_RPM,
    `${label}.targetRelativeRpm`,
  );
  validateDrive(value.drive, `${label}.drive`);
  validateBearing(value.bearing, `${label}.bearing`);
  assertRange(
    value.fatigueFraction as number,
    0,
    1,
    `${label}.fatigueFraction`,
  );
  assertRange(
    value.bearingWearFraction as number,
    0,
    1,
    `${label}.bearingWearFraction`,
  );
  for (const key of [
    "lastDriveTorqueNm",
    "lastBearingTorqueNm",
    "lastBrakeTorqueNm",
  ] as const) {
    assertRange(
      value[key] as number,
      -MAX_TORQUE_NM,
      MAX_TORQUE_NM,
      `${label}.${key}`,
    );
  }
}

function validateSensorReading(
  value: unknown,
  sensor: RotationSensor,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "sensorId",
      "ringId",
      "quantity",
      "sampledAtMicroseconds",
      "availableAtMicroseconds",
      "value",
      "quality",
    ],
    label,
  );
  if (
    value.sensorId !== sensor.id ||
    value.ringId !== sensor.ringId ||
    value.quantity !== sensor.quantity
  ) {
    throw new Error(`${label} does not match its fixed sensor`);
  }
  assertSafeNonNegativeInteger(
    value.sampledAtMicroseconds as number,
    `${label}.sampledAtMicroseconds`,
  );
  assertSafeNonNegativeInteger(
    value.availableAtMicroseconds as number,
    `${label}.availableAtMicroseconds`,
  );
  if (
    (value.availableAtMicroseconds as number) !==
    (value.sampledAtMicroseconds as number) +
      sensor.delayMicroseconds
  ) {
    throw new Error(
      `${label}.availableAtMicroseconds violates sensor delay`,
    );
  }
  if (value.value !== null) {
    assertFinite(value.value as number, `${label}.value`);
  }
  assertEnum(
    value.quality as string,
    ["nominal", "degraded", "stuck", "offline"] as const,
    `${label}.quality`,
  );
}

function validateSensor(
  value: unknown,
  specification: SensorSpecification,
  elapsedMicroseconds: number,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "ringId",
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
  if (
    value.id !== specification.id ||
    value.ringId !== specification.ringId ||
    value.quantity !== specification.quantity
  ) {
    throw new Error(`${label} violates fixed sensor topology`);
  }
  assertSafeNonNegativeInteger(
    value.sampleIntervalMicroseconds as number,
    `${label}.sampleIntervalMicroseconds`,
  );
  assertRange(
    value.sampleIntervalMicroseconds as number,
    1,
    MAX_SENSOR_INTERVAL_MICROSECONDS,
    `${label}.sampleIntervalMicroseconds`,
  );
  assertSafeNonNegativeInteger(
    value.delayMicroseconds as number,
    `${label}.delayMicroseconds`,
  );
  assertRange(
    value.delayMicroseconds as number,
    0,
    MAX_SENSOR_DELAY_MICROSECONDS,
    `${label}.delayMicroseconds`,
  );
  assertRange(
    value.noiseStandardDeviation as number,
    0,
    1e6,
    `${label}.noiseStandardDeviation`,
  );
  assertRange(
    value.bias as number,
    -1e9,
    1e9,
    `${label}.bias`,
  );
  assertRange(
    value.driftPerSecond as number,
    -1e6,
    1e6,
    `${label}.driftPerSecond`,
  );
  assertEnum(
    value.condition as string,
    ["nominal", "degraded", "stuck", "offline"] as const,
    `${label}.condition`,
  );
  if (value.stuckValue !== null) {
    assertFinite(
      value.stuckValue as number,
      `${label}.stuckValue`,
    );
  }
  assertSafeNonNegativeInteger(
    value.nextSampleMicroseconds as number,
    `${label}.nextSampleMicroseconds`,
  );
  if (
    (value.nextSampleMicroseconds as number) <=
    elapsedMicroseconds
  ) {
    throw new Error(
      `${label}.nextSampleMicroseconds must be in the future`,
    );
  }
  assertRange(
    value.randomState as number,
    0,
    0xffff_ffff,
    `${label}.randomState`,
  );
  if (!Number.isInteger(value.randomState as number)) {
    throw new RangeError(`${label}.randomState must be an integer`);
  }
  if (value.spareNormal !== null) {
    assertFinite(
      value.spareNormal as number,
      `${label}.spareNormal`,
    );
  }
  if (
    !Array.isArray(value.pending) ||
    value.pending.length > MAX_SENSOR_PENDING_READINGS
  ) {
    throw new Error(`${label}.pending is invalid or unbounded`);
  }
  const sensor = value as unknown as RotationSensor;
  let previousAvailability = -1;
  for (let index = 0; index < sensor.pending.length; index += 1) {
    const reading = sensor.pending[index];
    validateSensorReading(
      reading,
      sensor,
      `${label}.pending[${index}]`,
    );
    if (
      reading.availableAtMicroseconds <= elapsedMicroseconds ||
      reading.availableAtMicroseconds <= previousAvailability
    ) {
      throw new Error(
        `${label}.pending must contain ordered future readings`,
      );
    }
    previousAvailability = reading.availableAtMicroseconds;
  }
  if (sensor.latest !== null) {
    validateSensorReading(sensor.latest, sensor, `${label}.latest`);
    if (
      sensor.latest.availableAtMicroseconds >
      elapsedMicroseconds
    ) {
      throw new Error(`${label}.latest is not available yet`);
    }
  }
}

const ENERGY_LEDGER_KEYS = [
  "requestedElectricalEnergyJ",
  "servedElectricalEnergyJ",
  "controlElectricalHeatJ",
  "driveElectricalLossHeatJ",
  "bearingFrictionHeatJ",
  "mechanicalBrakeHeatJ",
  "activeBrakingHeatJ",
  "heatJ",
  "positiveDriveMechanicalWorkJ",
  "carrierKineticEnergyChangeJ",
  "ringAdditionalKineticEnergyChangeJ",
  "mechanicalEnergyChangeJ",
  "numericalResidualJ",
] as const;

function validateEnergyLedger(
  value: unknown,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(value, ENERGY_LEDGER_KEYS, label);
  for (const key of ENERGY_LEDGER_KEYS) {
    assertFinite(value[key] as number, `${label}.${key}`);
  }
  for (const key of [
    "requestedElectricalEnergyJ",
    "servedElectricalEnergyJ",
    "controlElectricalHeatJ",
    "driveElectricalLossHeatJ",
    "bearingFrictionHeatJ",
    "mechanicalBrakeHeatJ",
    "activeBrakingHeatJ",
    "heatJ",
    "positiveDriveMechanicalWorkJ",
  ] as const) {
    assertNonNegative(value[key] as number, `${label}.${key}`);
  }
  const ledger = value as unknown as RotationEnergyLedger;
  if (
    ledger.servedElectricalEnergyJ >
    ledger.requestedElectricalEnergyJ +
      Math.max(
        ENERGY_ABSOLUTE_TOLERANCE_J,
        ledger.requestedElectricalEnergyJ *
          ENERGY_RELATIVE_TOLERANCE,
      )
  ) {
    throw new Error(`${label} served more energy than requested`);
  }
  const heatComponents =
    ledger.controlElectricalHeatJ +
    ledger.driveElectricalLossHeatJ +
    ledger.bearingFrictionHeatJ +
    ledger.mechanicalBrakeHeatJ +
    ledger.activeBrakingHeatJ;
  assertClose(ledger.heatJ, heatComponents, `${label}.heatJ`);
  const mechanicalComponents =
    ledger.carrierKineticEnergyChangeJ +
    ledger.ringAdditionalKineticEnergyChangeJ;
  assertClose(
    ledger.mechanicalEnergyChangeJ,
    mechanicalComponents,
    `${label}.mechanicalEnergyChangeJ`,
  );
  assertClose(
    ledger.numericalResidualJ,
    ledger.servedElectricalEnergyJ -
      ledger.heatJ -
      ledger.mechanicalEnergyChangeJ,
    `${label}.numericalResidualJ`,
  );
}

export function validateRotationSnapshot(
  value: unknown,
): asserts value is RotationSnapshot {
  assertRecord(value, "rotation snapshot");
  assertExactKeys(
    value,
    [
      "snapshotVersion",
      "elapsedMicroseconds",
      "revision",
      "rings",
      "sensors",
      "energyLedger",
      "carrierAngularImpulseXSinceFrame",
      "carrierKineticEnergyChangeJSinceFrame",
      "lastCarrierState",
    ],
    "rotation snapshot",
  );
  if (value.snapshotVersion !== ROTATION_SNAPSHOT_VERSION) {
    throw new Error(
      `unsupported rotation snapshot version: ${String(value.snapshotVersion)}`,
    );
  }
  assertSafeNonNegativeInteger(
    value.elapsedMicroseconds as number,
    "rotation snapshot.elapsedMicroseconds",
  );
  assertSafeNonNegativeInteger(
    value.revision as number,
    "rotation snapshot.revision",
  );
  if (
    !Array.isArray(value.rings) ||
    value.rings.length !== ROTATION_RING_IDS.length
  ) {
    throw new Error(
      "rotation snapshot must contain exactly ring-a and ring-b",
    );
  }
  value.rings.forEach((ring, index) =>
    validateRing(
      ring,
      ROTATION_RING_IDS[index],
      `rotation snapshot.rings[${index}]`,
    ),
  );
  if (
    !Array.isArray(value.sensors) ||
    value.sensors.length !== SENSOR_SPECIFICATIONS.length
  ) {
    throw new Error(
      "rotation snapshot has an invalid fixed sensor topology",
    );
  }
  value.sensors.forEach((sensor, index) =>
    validateSensor(
      sensor,
      SENSOR_SPECIFICATIONS[index],
      value.elapsedMicroseconds as number,
      `rotation snapshot.sensors[${index}]`,
    ),
  );
  validateEnergyLedger(
    value.energyLedger,
    "rotation snapshot.energyLedger",
  );
  assertFinite(
    value.carrierAngularImpulseXSinceFrame as number,
    "rotation snapshot.carrierAngularImpulseXSinceFrame",
  );
  assertFinite(
    value.carrierKineticEnergyChangeJSinceFrame as number,
    "rotation snapshot.carrierKineticEnergyChangeJSinceFrame",
  );
  validateCarrierState(
    value.lastCarrierState,
    "rotation snapshot.lastCarrierState",
  );
  const matrix = effectiveMassMatrix(
    (value.lastCarrierState as unknown as RotationCarrierState)
      .inertiaXKgM2,
    value.rings as unknown as HabitatRing[],
  );
  invertMatrix(matrix);
}

function validateControlPreview(
  value: unknown,
): asserts value is RotationControlPreview {
  assertRecord(value, "rotation control preview");
  assertExactKeys(
    value,
    [
      "fromMicroseconds",
      "toMicroseconds",
      "rotationRevision",
      "carrierState",
      "requestedEnergyJByRing",
    ],
    "rotation control preview",
  );
  assertSafeNonNegativeInteger(
    value.fromMicroseconds as number,
    "rotation control preview.fromMicroseconds",
  );
  assertSafeNonNegativeInteger(
    value.toMicroseconds as number,
    "rotation control preview.toMicroseconds",
  );
  if (
    (value.toMicroseconds as number) <
    (value.fromMicroseconds as number)
  ) {
    throw new RangeError(
      "rotation control preview ends before it starts",
    );
  }
  assertSafeNonNegativeInteger(
    value.rotationRevision as number,
    "rotation control preview.rotationRevision",
  );
  validateCarrierState(
    value.carrierState,
    "rotation control preview.carrierState",
  );
  assertRingEnergyRecord(
    value.requestedEnergyJByRing,
    "rotation control preview.requestedEnergyJByRing",
  );
}

export class CounterRotatingHabitat {
  private stateValue: RotationSnapshot;

  constructor(options: CounterRotatingHabitatOptions = {}) {
    this.stateValue = makeBaselineSnapshot(options);
    this.sampleDueSensors();
    this.deliverAvailableReadings();
    validateRotationSnapshot(this.stateValue);
  }

  get elapsedMicroseconds(): number {
    return this.stateValue.elapsedMicroseconds;
  }

  get elapsedSeconds(): number {
    return (
      this.stateValue.elapsedMicroseconds /
      ROTATION_MICROSECONDS_PER_SECOND
    );
  }

  get revision(): number {
    return this.stateValue.revision;
  }

  getCarrierState(): RotationCarrierState {
    return cloneData(this.stateValue.lastCarrierState);
  }

  listRings(): HabitatRing[] {
    return cloneData(this.stateValue.rings);
  }

  getRing(ringId: RotationRingId): HabitatRing {
    return cloneData(findRing(this.stateValue.rings, ringId));
  }

  listSensors(): RotationSensor[] {
    return cloneData(this.stateValue.sensors);
  }

  getSensorReading(
    sensorId: RotationSensorId,
  ): RotationSensorReading | null {
    const sensor = findSensor(this.stateValue.sensors, sensorId);
    return sensor.latest ? cloneData(sensor.latest) : null;
  }

  getEnergyBalance(): RotationEnergyBalance {
    const ledger = cloneData(this.stateValue.energyLedger);
    const heatComponentSumJ =
      ledger.controlElectricalHeatJ +
      ledger.driveElectricalLossHeatJ +
      ledger.bearingFrictionHeatJ +
      ledger.mechanicalBrakeHeatJ +
      ledger.activeBrakingHeatJ;
    const mechanicalComponentSumJ =
      ledger.carrierKineticEnergyChangeJ +
      ledger.ringAdditionalKineticEnergyChangeJ;
    const closureResidualJ =
      ledger.servedElectricalEnergyJ -
      ledger.heatJ -
      ledger.mechanicalEnergyChangeJ;
    return {
      ...ledger,
      heatComponentSumJ,
      mechanicalComponentSumJ,
      closureResidualJ,
      closureErrorJ: Math.abs(closureResidualJ),
    };
  }

  getSummary(): RotationSummary {
    const carrier = this.stateValue.lastCarrierState;
    const relativeMomentum = netRelativeRingAngularMomentum(
      this.stateValue.rings,
    );
    const carrierEnergy = carrierKineticEnergy(carrier);
    const additionalEnergy = ringAdditionalKineticEnergy(
      carrier.angularVelocityXRadPerS,
      this.stateValue.rings,
    );
    return {
      elapsedSeconds: this.elapsedSeconds,
      revision: this.stateValue.revision,
      carrierAngularVelocityXRadPerS:
        carrier.angularVelocityXRadPerS,
      carrierInertiaXKgM2: carrier.inertiaXKgM2,
      netRelativeRingAngularMomentumKgM2PerS:
        relativeMomentum,
      totalAngularMomentumXKgM2PerS:
        carrier.inertiaXKgM2 *
          carrier.angularVelocityXRadPerS +
        relativeMomentum,
      carrierKineticEnergyJ: carrierEnergy,
      ringAdditionalKineticEnergyJ: additionalEnergy,
      totalCoupledKineticEnergyJ:
        carrierEnergy + additionalEnergy,
      carrierAngularImpulseXSinceFrame:
        this.stateValue.carrierAngularImpulseXSinceFrame,
      carrierKineticEnergyChangeJSinceFrame:
        this.stateValue
          .carrierKineticEnergyChangeJSinceFrame,
      rings: this.stateValue.rings.map((ring) =>
        ringTruthSummary(
          ring,
          carrier.angularVelocityXRadPerS,
        ),
      ),
      energyClosureErrorJ:
        this.getEnergyBalance().closureErrorJ,
    };
  }

  configureRing(
    ringId: RotationRingId,
    patch: RingConfigurationPatch,
  ): HabitatRing {
    if (
      typeof patch !== "object" ||
      patch === null ||
      Array.isArray(patch)
    ) {
      throw new TypeError(
        "ring configuration patch must be an object",
      );
    }
    const allowed = new Set([
      "controlMode",
      "targetRelativeRpm",
      "drive",
      "bearing",
    ]);
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        throw new Error(`ring configuration cannot change ${key}`);
      }
    }
    const next = this.snapshot();
    const ring = findRing(next.rings, ringId);
    if (patch.controlMode !== undefined) {
      ring.controlMode = patch.controlMode;
    }
    if (patch.targetRelativeRpm !== undefined) {
      ring.targetRelativeRpm = patch.targetRelativeRpm;
    }
    if (patch.drive !== undefined) {
      assertRecord(patch.drive, "ring drive patch");
      const driveAllowed = new Set([
        "condition",
        "maximumTorqueNm",
        "efficiency",
        "controlPowerW",
      ]);
      for (const key of Object.keys(patch.drive)) {
        if (!driveAllowed.has(key)) {
          throw new Error(`ring drive patch cannot change ${key}`);
        }
      }
      Object.assign(ring.drive, cloneData(patch.drive));
    }
    if (patch.bearing !== undefined) {
      assertRecord(patch.bearing, "ring bearing patch");
      const bearingAllowed = new Set([
        "condition",
        "maximumFrictionTorqueNm",
        "coulombFrictionTorqueNm",
        "viscousFrictionCoefficientNms",
        "brakeMaximumTorqueNm",
      ]);
      for (const key of Object.keys(patch.bearing)) {
        if (!bearingAllowed.has(key)) {
          throw new Error(
            `ring bearing patch cannot change ${key}`,
          );
        }
      }
      Object.assign(ring.bearing, cloneData(patch.bearing));
    }
    next.revision += 1;
    this.commitCandidate(next);
    return this.getRing(ringId);
  }

  completeBearingMaintenance(ringId: RotationRingId): HabitatRing {
    const next = this.snapshot();
    const ring = findRing(next.rings, ringId);
    ring.bearing.condition = "nominal";
    // A service task replaces the loaded wear surfaces without pretending the
    // rest of the assembly became factory-new. A small residual wear history
    // therefore remains and continues to influence future degradation.
    ring.bearingWearFraction = Math.min(
      0.05,
      ring.bearingWearFraction * 0.15,
    );
    next.revision += 1;
    this.commitCandidate(next);
    return this.getRing(ringId);
  }

  configureSensor(
    sensorId: RotationSensorId,
    patch: RotationSensorPatch,
  ): RotationSensor {
    assertRecord(patch, "rotation sensor patch");
    const allowed = new Set([
      "sampleIntervalMicroseconds",
      "delayMicroseconds",
      "noiseStandardDeviation",
      "bias",
      "driftPerSecond",
      "condition",
      "stuckValue",
    ]);
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        throw new Error(
          `rotation sensor patch cannot change ${key}`,
        );
      }
    }
    const next = this.snapshot();
    const sensor = findSensor(next.sensors, sensorId);
    Object.assign(sensor, cloneData(patch));
    sensor.pending = [];
    sensor.latest = null;
    sensor.nextSampleMicroseconds = next.elapsedMicroseconds;
    sensor.spareNormal = null;
    if (patch.stuckValue === undefined) {
      sensor.stuckValue = null;
    }
    next.revision += 1;
    this.commitCandidate(next, true);
    return cloneData(findSensor(this.stateValue.sensors, sensorId));
  }

  /**
   * Starts a new navigation frame ledger without changing either ring's
   * physical relative speed, phase, wear, or the lifetime energy ledger.
   *
   * carrierAngularImpulseXSinceFrame is defined as impulse delivered to
   * navigation, so Worker restore reconciliation compares it with the
   * navigation internal impulse using the same sign.
   */
  rebaseCarrierExchangeLedger(
    carrierState: RotationCarrierState,
  ): RotationSummary {
    validateCarrierState(carrierState, "carrierState");
    const next = this.snapshot();
    next.carrierAngularImpulseXSinceFrame = 0;
    next.carrierKineticEnergyChangeJSinceFrame = 0;
    next.lastCarrierState = cloneData(carrierState);
    next.revision += 1;
    this.commitCandidate(next);
    return this.getSummary();
  }

  previewControlInterval(
    simulatedSeconds: number,
    carrierState: RotationCarrierState,
  ): RotationControlPreview {
    assertNonNegative(simulatedSeconds, "simulatedSeconds");
    validateCarrierState(carrierState, "carrierState");
    const durationMicroseconds = Math.round(
      simulatedSeconds * ROTATION_MICROSECONDS_PER_SECOND,
    );
    assertSafeNonNegativeInteger(
      durationMicroseconds,
      "rotation control preview duration",
    );
    const fromMicroseconds = this.stateValue.elapsedMicroseconds;
    const toMicroseconds =
      fromMicroseconds + durationMicroseconds;
    assertSafeNonNegativeInteger(
      toMicroseconds,
      "rotation control preview target",
    );
    const requested = previewRequestedEnergy(
      this.stateValue.rings,
      carrierState,
      durationMicroseconds /
        ROTATION_MICROSECONDS_PER_SECOND,
    );
    return {
      fromMicroseconds,
      toMicroseconds,
      rotationRevision: this.stateValue.revision,
      carrierState: cloneData(carrierState),
      requestedEnergyJByRing: pairRecord(requested),
    };
  }

  step(
    preview: RotationControlPreview,
    carrierState: RotationCarrierState,
    servedEnergyJByRing: Record<RotationRingId, number>,
  ): RotationStepResult {
    validateControlPreview(preview);
    validateCarrierState(carrierState, "carrierState");
    assertRingEnergyRecord(
      servedEnergyJByRing,
      "servedEnergyJByRing",
    );
    if (
      preview.fromMicroseconds !==
        this.stateValue.elapsedMicroseconds ||
      preview.rotationRevision !== this.stateValue.revision
    ) {
      throw new Error(
        "rotation control preview does not match the current interval or revision",
      );
    }
    for (const key of [
      "angularVelocityXRadPerS",
      "inertiaXKgM2",
      "revision",
    ] as const) {
      if (
        preview.carrierState[key] !== carrierState[key]
      ) {
        throw new Error(
          `rotation control preview carrier ${key} is stale`,
        );
      }
    }
    const durationSeconds =
      (preview.toMicroseconds - preview.fromMicroseconds) /
      ROTATION_MICROSECONDS_PER_SECOND;
    const fresh = this.previewControlInterval(
      durationSeconds,
      carrierState,
    );
    for (const ringId of ROTATION_RING_IDS) {
      assertClose(
        preview.requestedEnergyJByRing[ringId],
        fresh.requestedEnergyJByRing[ringId],
        `rotation preview request ${ringId}`,
      );
      const served = servedEnergyJByRing[ringId];
      const requested =
        preview.requestedEnergyJByRing[ringId];
      if (
        served >
        requested +
          Math.max(
            ENERGY_ABSOLUTE_TOLERANCE_J,
            requested * ENERGY_RELATIVE_TOLERANCE,
          )
      ) {
        throw new RangeError(
          `${ringId} served energy exceeds its preview request`,
        );
      }
    }

    const beforeRings = cloneData(this.stateValue.rings);
    const beforeCarrierAngularVelocity =
      carrierState.angularVelocityXRadPerS;
    const beforeCarrierEnergy = carrierKineticEnergy(carrierState);
    const beforeRingAdditionalEnergy =
      ringAdditionalKineticEnergy(
        beforeCarrierAngularVelocity,
        beforeRings,
      );
    let coupled: CoupledState = {
      rings: cloneData(beforeRings),
      carrierAngularVelocityXRadPerS:
        beforeCarrierAngularVelocity,
    };

    const controlRequested: Pair = coupled.rings.map((ring) =>
      controlEnergyRequest(ring, durationSeconds),
    ) as Pair;
    const served = recordPair(servedEnergyJByRing);
    const controlServed: Pair = [
      Math.min(served[0], controlRequested[0]),
      Math.min(served[1], controlRequested[1]),
    ];
    const controlFraction: Pair = [
      controlRequested[0] > 0
        ? Math.min(1, controlServed[0] / controlRequested[0])
        : 1,
      controlRequested[1] > 0
        ? Math.min(1, controlServed[1] / controlRequested[1])
        : 1,
    ];
    const driveInput: Pair = [
      Math.max(0, served[0] - controlServed[0]),
      Math.max(0, served[1] - controlServed[1]),
    ];

    const bearing = applyDissipativeTorques(
      coupled,
      carrierState.inertiaXKgM2,
      durationSeconds,
      (ring) => bearingFrictionTorque(ring),
    );
    coupled = bearing.state;
    const brake = applyDissipativeTorques(
      coupled,
      carrierState.inertiaXKgM2,
      durationSeconds,
      (ring, index) =>
        ring.controlMode === "brake"
          ? ring.bearing.brakeMaximumTorqueNm *
            controlFraction[index]
          : 0,
    );
    coupled = brake.state;
    const active = applyActiveDrive(
      coupled,
      carrierState.inertiaXKgM2,
      durationSeconds,
      controlFraction,
      driveInput,
    );
    coupled = active.state;

    const positiveMechanicalWork: Pair = [
      Math.max(0, active.mechanicalWorkJByRing[0]),
      Math.max(0, active.mechanicalWorkJByRing[1]),
    ];
    const activeBrakingHeatJ =
      Math.max(0, -active.mechanicalWorkJByRing[0]) +
      Math.max(0, -active.mechanicalWorkJByRing[1]);
    const controlElectricalHeatJ =
      controlServed[0] + controlServed[1];
    const driveElectricalLossHeatJ =
      driveInput[0] +
      driveInput[1] -
      positiveMechanicalWork[0] -
      positiveMechanicalWork[1];
    if (driveElectricalLossHeatJ < -ENERGY_ABSOLUTE_TOLERANCE_J) {
      throw new Error(
        "positive drive work exceeded served drive electricity",
      );
    }

    const afterRings = coupled.rings;
    const carrierBodyAngularImpulseXByRing: Pair = [
      -afterRings[0].inertiaKgM2 *
        (afterRings[0].relativeAngularVelocityRadPerS -
          beforeRings[0].relativeAngularVelocityRadPerS),
      -afterRings[1].inertiaKgM2 *
        (afterRings[1].relativeAngularVelocityRadPerS -
          beforeRings[1].relativeAngularVelocityRadPerS),
    ];
    const carrierBodyAngularImpulseX =
      carrierBodyAngularImpulseXByRing[0] +
      carrierBodyAngularImpulseXByRing[1];
    const predictedCarrierAngularVelocityXRadPerS =
      beforeCarrierAngularVelocity +
      carrierBodyAngularImpulseX / carrierState.inertiaXKgM2;
    assertClose(
      predictedCarrierAngularVelocityXRadPerS,
      coupled.carrierAngularVelocityXRadPerS,
      "carrier reaction prediction",
      1e-10,
      1e-15,
    );

    const predictedCarrierState: RotationCarrierState = {
      angularVelocityXRadPerS:
        predictedCarrierAngularVelocityXRadPerS,
      inertiaXKgM2: carrierState.inertiaXKgM2,
      revision: carrierState.revision,
    };
    const afterCarrierEnergy = carrierKineticEnergy(
      predictedCarrierState,
    );
    const afterRingAdditionalEnergy =
      ringAdditionalKineticEnergy(
        predictedCarrierAngularVelocityXRadPerS,
        afterRings,
      );
    const carrierKineticEnergyChangeJ =
      afterCarrierEnergy - beforeCarrierEnergy;
    const ringAdditionalKineticEnergyChangeJ =
      afterRingAdditionalEnergy -
      beforeRingAdditionalEnergy;
    const mechanicalEnergyChangeJ =
      carrierKineticEnergyChangeJ +
      ringAdditionalKineticEnergyChangeJ;
    const servedTotalJ = served[0] + served[1];
    const requestedTotalJ =
      preview.requestedEnergyJByRing["ring-a"] +
      preview.requestedEnergyJByRing["ring-b"];
    const heatJ =
      controlElectricalHeatJ +
      Math.max(0, driveElectricalLossHeatJ) +
      bearing.heatJ +
      brake.heatJ +
      activeBrakingHeatJ;
    const numericalResidualJ =
      servedTotalJ - heatJ - mechanicalEnergyChangeJ;
    assertClose(
      mechanicalEnergyChangeJ,
      -bearing.heatJ -
        brake.heatJ +
        active.mechanicalEnergyChangeJ,
      "step mechanical energy decomposition",
    );

    const next = this.snapshot();
    next.rings = afterRings;
    for (let index = 0; index < next.rings.length; index += 1) {
      const ring = next.rings[index];
      ring.relativeAngleRad = normalizeAngle(
        beforeRings[index].relativeAngleRad +
          0.5 *
            (beforeRings[index]
              .relativeAngularVelocityRadPerS +
              ring.relativeAngularVelocityRadPerS) *
            durationSeconds,
      );
      ring.lastBearingTorqueNm =
        durationSeconds > 0
          ? bearing.generalizedImpulseByRing[index] /
            durationSeconds
          : 0;
      ring.lastBrakeTorqueNm =
        durationSeconds > 0
          ? brake.generalizedImpulseByRing[index] /
            durationSeconds
          : 0;
      ring.lastDriveTorqueNm =
        durationSeconds > 0
          ? active.generalizedImpulseByRing[index] /
            durationSeconds
          : 0;
      const averageAbsoluteAngularVelocity =
        0.5 *
        (beforeCarrierAngularVelocity +
          beforeRings[index].relativeAngularVelocityRadPerS +
          predictedCarrierAngularVelocityXRadPerS +
          ring.relativeAngularVelocityRadPerS);
      const averageGravityG =
        (averageAbsoluteAngularVelocity ** 2 *
          ring.radiusM) /
        ROTATION_STANDARD_GRAVITY_M_PER_S2;
      const wearLoadFraction =
        (Math.abs(ring.lastBearingTorqueNm) +
          Math.abs(ring.lastBrakeTorqueNm)) /
        Math.max(1, ring.bearing.maximumFrictionTorqueNm);
      const bearingConditionMultiplier =
        ring.bearing.condition === "nominal"
          ? 1
          : ring.bearing.condition === "degraded"
            ? 4
            : 20;
      ring.bearingWearFraction = Math.min(
        1,
        ring.bearingWearFraction +
          (durationSeconds / FIVE_YEARS_SECONDS) *
            bearingConditionMultiplier *
            (0.2 + Math.min(20, wearLoadFraction)),
      );
      const gravityLoad = Math.max(0, averageGravityG / 1.1);
      ring.fatigueFraction = Math.min(
        1,
        ring.fatigueFraction +
          (durationSeconds / THIRTY_YEARS_SECONDS) *
            (0.05 + gravityLoad ** 4),
      );
    }
    next.elapsedMicroseconds = preview.toMicroseconds;
    next.revision += 1;
    next.lastCarrierState = predictedCarrierState;
    const ledger = next.energyLedger;
    ledger.requestedElectricalEnergyJ += requestedTotalJ;
    ledger.servedElectricalEnergyJ += servedTotalJ;
    ledger.controlElectricalHeatJ += controlElectricalHeatJ;
    ledger.driveElectricalLossHeatJ += Math.max(
      0,
      driveElectricalLossHeatJ,
    );
    ledger.bearingFrictionHeatJ += bearing.heatJ;
    ledger.mechanicalBrakeHeatJ += brake.heatJ;
    ledger.activeBrakingHeatJ += activeBrakingHeatJ;
    ledger.heatJ += heatJ;
    ledger.positiveDriveMechanicalWorkJ +=
      positiveMechanicalWork[0] +
      positiveMechanicalWork[1];
    ledger.carrierKineticEnergyChangeJ +=
      carrierKineticEnergyChangeJ;
    ledger.ringAdditionalKineticEnergyChangeJ +=
      ringAdditionalKineticEnergyChangeJ;
    ledger.mechanicalEnergyChangeJ += mechanicalEnergyChangeJ;
    ledger.numericalResidualJ += numericalResidualJ;
    next.carrierAngularImpulseXSinceFrame +=
      carrierBodyAngularImpulseX;
    next.carrierKineticEnergyChangeJSinceFrame +=
      carrierKineticEnergyChangeJ;
    this.commitCandidate(next, true);

    return {
      fromMicroseconds: preview.fromMicroseconds,
      toMicroseconds: preview.toMicroseconds,
      revision: this.stateValue.revision,
      requestedEnergyJByRing: cloneData(
        preview.requestedEnergyJByRing,
      ),
      servedEnergyJByRing: cloneData(servedEnergyJByRing),
      heatJ,
      carrierBodyAngularImpulseX,
      carrierBodyAngularImpulseXByRing: pairRecord(
        carrierBodyAngularImpulseXByRing,
      ),
      predictedCarrierAngularVelocityXRadPerS,
      positiveDriveMechanicalWorkJByRing: pairRecord(
        positiveMechanicalWork,
      ),
      energyBalance: this.getEnergyBalance(),
      summary: this.getSummary(),
    };
  }

  private commitCandidate(
    candidate: RotationSnapshot,
    resampleSensors = false,
  ): void {
    const previous = this.stateValue;
    this.stateValue = candidate;
    try {
      if (resampleSensors) {
        this.sampleDueSensors();
        this.deliverAvailableReadings();
      }
      validateRotationSnapshot(this.stateValue);
    } catch (error) {
      this.stateValue = previous;
      throw error;
    }
  }

  private sensorTruth(sensor: RotationSensor): number {
    const ring = findRing(this.stateValue.rings, sensor.ringId);
    switch (sensor.quantity) {
      case "relativeRpm":
        return radPerSToRpm(
          ring.relativeAngularVelocityRadPerS,
        );
      case "artificialGravityG":
        return artificialGravityG(
          ring,
          this.stateValue.lastCarrierState
            .angularVelocityXRadPerS,
        );
      case "vibrationMmPerS":
        return ringVibrationMmPerS(
          ring,
          this.stateValue.lastCarrierState
            .angularVelocityXRadPerS,
        );
    }
  }

  private createSensorReading(
    sensor: RotationSensor,
    sampledAtMicroseconds: number,
  ): RotationSensorReading {
    const truth = this.sensorTruth(sensor);
    let value: number | null;
    if (sensor.condition === "offline") {
      value = null;
    } else if (sensor.condition === "stuck") {
      if (sensor.stuckValue === null) {
        sensor.stuckValue = sensor.latest?.value ?? truth;
      }
      value = sensor.stuckValue;
    } else {
      const noiseMultiplier =
        sensor.condition === "degraded" ? 4 : 1;
      value =
        truth +
        sensor.bias +
        sensor.driftPerSecond *
          (sampledAtMicroseconds /
            ROTATION_MICROSECONDS_PER_SECOND) +
        nextNormal(sensor) *
          sensor.noiseStandardDeviation *
          noiseMultiplier;
    }
    return {
      sensorId: sensor.id,
      ringId: sensor.ringId,
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
      let latestDelivered: RotationSensorReading | null = null;
      while (sensor.nextSampleMicroseconds <= now) {
        const reading = this.createSensorReading(
          sensor,
          sensor.nextSampleMicroseconds,
        );
        if (reading.availableAtMicroseconds <= now) {
          latestDelivered = reading;
        } else {
          sensor.pending.push(reading);
          if (
            sensor.pending.length >
            MAX_SENSOR_PENDING_READINGS
          ) {
            throw new Error(
              `${sensor.id} pending readings exceeded the fixed cap`,
            );
          }
        }
        sensor.nextSampleMicroseconds +=
          sensor.sampleIntervalMicroseconds;
        assertSafeNonNegativeInteger(
          sensor.nextSampleMicroseconds,
          `${sensor.id}.nextSampleMicroseconds`,
        );
      }
      if (latestDelivered) sensor.latest = latestDelivered;
    }
  }

  private deliverAvailableReadings(): void {
    const now = this.stateValue.elapsedMicroseconds;
    for (const sensor of this.stateValue.sensors) {
      let latest: RotationSensorReading | null = null;
      while (
        sensor.pending.length > 0 &&
        sensor.pending[0].availableAtMicroseconds <= now
      ) {
        latest = sensor.pending.shift() as RotationSensorReading;
      }
      if (latest) sensor.latest = latest;
    }
  }

  snapshot(): RotationSnapshot {
    return cloneData(this.stateValue);
  }

  serialize(): string {
    return JSON.stringify(this.stateValue);
  }

  static restore(
    source: string | RotationSnapshot,
  ): CounterRotatingHabitat {
    const parsed: unknown =
      typeof source === "string"
        ? JSON.parse(source)
        : cloneData(source);
    validateRotationSnapshot(parsed);
    const restored = new CounterRotatingHabitat({
      seed: 0,
      initialCarrierState: parsed.lastCarrierState,
    });
    restored.stateValue = cloneData(parsed);
    return restored;
  }
}
