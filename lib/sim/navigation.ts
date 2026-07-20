/**
 * Deterministic six-degree-of-freedom rigid-body and conventional-propulsion
 * slice for the Far Horizon.
 *
 * Coordinate conventions:
 * - all public quantities use SI units;
 * - the inertial frame is right-handed;
 * - the body frame is right-handed, with +X forward, +Y starboard, +Z up;
 * - orientation is a unit quaternion rotating body-frame vectors into the
 *   inertial frame;
 * - thruster directions describe force on the vehicle, not exhaust velocity.
 *
 * This is deliberately a local flight-dynamics model rather than an ephemeris
 * or orbital propagator. It nevertheless keeps propulsion causal: fixed
 * thruster geometry produces force and torque, mass flow follows thrust and
 * specific impulse, propellant depletion changes mass and inertia, and the
 * exhaust counter-momentum is recorded in a conservation ledger.
 */

export const NAVIGATION_SNAPSHOT_VERSION = 5 as const;
export const NAVIGATION_MICROSECONDS_PER_SECOND = 1_000_000;
export const STANDARD_GRAVITY_M_PER_S2 = 9.80665;
export const FUSION_TORCH_SPECIFIC_ENERGY_J_PER_KG =
  3.2e14;

const ACTIVE_PHYSICS_SUBSTEP_MICROSECONDS = 100_000;
const COAST_PHYSICS_SUBSTEP_MICROSECONDS = 60_000_000;
const QUATERNION_UNIT_TOLERANCE = 1e-10;
const VECTOR_CLOSURE_RELATIVE_TOLERANCE = 1e-11;
const ENERGY_CLOSURE_RELATIVE_TOLERANCE = 1e-10;
const MAX_SUPPORTED_SPEED_M_PER_S = 100_000_000;
const MAX_SUPPORTED_ANGULAR_SPEED_RAD_PER_S = 10;
const MAX_COMMANDS = 100_000;

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface DiagonalInertiaTensor {
  x: number;
  y: number;
  z: number;
}

export interface NavigationRigidBody {
  positionM: Vector3;
  velocityMPerS: Vector3;
  orientationBodyToInertial: Quaternion;
  angularVelocityBodyRadPerS: Vector3;
  dryMassKg: number;
  propellantMassKg: number;
  dryInertiaDiagonalKgM2: DiagonalInertiaTensor;
  propellantInertiaPerKgM2: DiagonalInertiaTensor;
}

export const THRUSTER_IDS = [
  "main-a",
  "main-b",
  "main-c",
  "main-d",
  "reverse-a",
  "reverse-b",
  "rcs-fore-y-plus",
  "rcs-fore-y-minus",
  "rcs-aft-y-plus",
  "rcs-aft-y-minus",
  "rcs-fore-z-plus",
  "rcs-fore-z-minus",
  "rcs-aft-z-plus",
  "rcs-aft-z-minus",
  "rcs-roll-plus-a",
  "rcs-roll-plus-b",
  "rcs-roll-minus-a",
  "rcs-roll-minus-b",
] as const;

export type ThrusterId = (typeof THRUSTER_IDS)[number];
export type ThrusterRole = "main" | "reverse" | "translation-rcs" | "roll-rcs";
export const PROPULSION_CONTROL_TRAIN_IDS = [
  "propulsion-control-a",
  "propulsion-control-b",
] as const;
export type PropulsionControlTrainId =
  (typeof PROPULSION_CONTROL_TRAIN_IDS)[number];
export type ThrusterCondition =
  | "nominal"
  | "degraded"
  | "stuck-off"
  | "stuck-on";

export interface FixedThruster {
  id: ThrusterId;
  label: string;
  role: ThrusterRole;
  positionBodyM: Vector3;
  forceDirectionBody: Vector3;
  maximumThrustN: number;
  specificImpulseS: number;
  minimumThrottleFraction: number;
  controlTrainId: PropulsionControlTrainId;
  jetConversionEfficiency: number;
  retainedLossFraction: number;
  ignitionEnergyJ: number;
  holdPowerW: number;
  condition: ThrusterCondition;
  performanceFraction: number;
  stuckOnThrottleFraction: number;
  lastCommandedThrottleFraction: number;
  lastActualThrottleFraction: number;
  lastThrustN: number;
  lastMassFlowKgPerS: number;
}

export type ThrusterCommandMode = "pulse" | "sustained";

export interface ThrusterCommand {
  id: string;
  sequence: number;
  thrusterId: ThrusterId;
  mode: ThrusterCommandMode;
  throttleFraction: number;
  startsAtMicroseconds: number;
  endsAtMicroseconds: number | null;
  canceledAtMicroseconds: number | null;
}

export interface PulseCommandOptions {
  commandId?: string;
  startDelaySeconds?: number;
}

export interface SustainedCommandOptions {
  commandId?: string;
  startDelaySeconds?: number;
}

export type ThrusterPatch = Partial<
  Pick<
    FixedThruster,
    "condition" | "performanceFraction" | "stuckOnThrottleFraction"
  >
>;

export const NAVIGATION_SENSOR_IDS = [
  "sensor:position:x",
  "sensor:position:y",
  "sensor:position:z",
  "sensor:velocity:x",
  "sensor:velocity:y",
  "sensor:velocity:z",
  "sensor:attitude:w",
  "sensor:attitude:x",
  "sensor:attitude:y",
  "sensor:attitude:z",
  "sensor:angular-velocity:x",
  "sensor:angular-velocity:y",
  "sensor:angular-velocity:z",
  "sensor:propellant-mass",
  "sensor:fusion-fuel-mass",
] as const;

export type NavigationSensorId = (typeof NAVIGATION_SENSOR_IDS)[number];
export type NavigationSensorQuantity =
  | "positionX"
  | "positionY"
  | "positionZ"
  | "velocityX"
  | "velocityY"
  | "velocityZ"
  | "attitudeW"
  | "attitudeX"
  | "attitudeY"
  | "attitudeZ"
  | "angularVelocityX"
  | "angularVelocityY"
  | "angularVelocityZ"
  | "propellantMass"
  | "fusionFuelMass";
export type NavigationSensorCondition =
  | "nominal"
  | "degraded"
  | "stuck"
  | "offline";
export type NavigationSensorQuality = NavigationSensorCondition;

export interface NavigationSensorReading {
  sensorId: NavigationSensorId;
  quantity: NavigationSensorQuantity;
  frameEpoch: number;
  sampledAtMicroseconds: number;
  availableAtMicroseconds: number;
  value: number | null;
  quality: NavigationSensorQuality;
}

export interface NavigationSensor {
  id: NavigationSensorId;
  quantity: NavigationSensorQuantity;
  sampleIntervalMicroseconds: number;
  delayMicroseconds: number;
  noiseStandardDeviation: number;
  bias: number;
  driftPerSecond: number;
  condition: NavigationSensorCondition;
  stuckValue: number | null;
  nextSampleMicroseconds: number;
  randomState: number;
  spareNormal: number | null;
  pending: NavigationSensorReading[];
  latest: NavigationSensorReading | null;
}

export type NavigationSensorPatch = Partial<
  Pick<
    NavigationSensor,
    | "sampleIntervalMicroseconds"
    | "delayMicroseconds"
    | "noiseStandardDeviation"
    | "bias"
    | "driftPerSecond"
    | "condition"
    | "stuckValue"
  >
>;

export interface NavigationMomentumLedger {
  initialBodyLinearMomentumKgMPerS: Vector3;
  initialBodyAngularMomentumAboutOriginKgM2PerS: Vector3;
  exhaustLinearMomentumKgMPerS: Vector3;
  exhaustAngularMomentumAboutOriginKgM2PerS: Vector3;
  internalAngularImpulseBodyNms: Vector3;
  internalAngularMomentumExchangeInertialKgM2PerS: Vector3;
  thrustImpulseInertialNs: Vector3;
  torqueImpulseBodyNms: Vector3;
  numericalLinearResidualKgMPerS: Vector3;
  numericalAngularResidualKgM2PerS: Vector3;
}

export interface NavigationEnergyLedger {
  initialBodyMechanicalEnergyJ: number;
  idealJetEnergyJ: number;
  propulsionMechanicalEnergyReleasedJ: number;
  exhaustKineticEnergyJ: number;
  internalMechanicalEnergyTransferJ: number;
  numericalResidualJ: number;
}

export interface FusionTorchEnergyLedger {
  fusionFuelConsumedKg: number;
  fusionEnergyReleasedJ: number;
  idealJetEnergyJ: number;
  retainedWasteHeatJ: number;
  directExportEnergyJ: number;
  controlEnergyRequestedJ: number;
  controlEnergyServedJ: number;
}

export interface FusionTorchPropulsionState {
  initialFusionFuelMassKg: number;
  fusionFuelMassKg: number;
  energyLedger: FusionTorchEnergyLedger;
}

export interface PropulsionControlPreview {
  fromMicroseconds: number;
  toMicroseconds: number;
  navigationRevision: number;
  requestedEnergyJByTrain: Record<
    PropulsionControlTrainId,
    number
  >;
  hasTorchActivity: boolean;
}

export interface PropulsionControlApplication {
  requestedEnergyJ: number;
  servedEnergyJ: number;
  retainedControlHeatJ: number;
  terminatedCommandIds: string[];
  revision: number;
}

export interface NavigationSnapshot {
  snapshotVersion: typeof NAVIGATION_SNAPSHOT_VERSION;
  elapsedMicroseconds: number;
  revision: number;
  frameEpoch: number;
  anchorCompletedDistanceLightYears: number;
  body: NavigationRigidBody;
  thrusters: FixedThruster[];
  commands: ThrusterCommand[];
  nextCommandSequence: number;
  sensors: NavigationSensor[];
  momentumLedger: NavigationMomentumLedger;
  energyLedger: NavigationEnergyLedger;
  propulsion: FusionTorchPropulsionState;
}

export interface NavigationInitialCondition {
  positionM?: Vector3;
  velocityMPerS?: Vector3;
  orientationBodyToInertial?: Quaternion;
  angularVelocityBodyRadPerS?: Vector3;
  propellantMassKg?: number;
}

export interface RigidBodyNavigationOptions {
  seed?: number | string;
  initialCondition?: NavigationInitialCondition;
  initialFusionFuelMassKg?: number;
}

export interface NavigationMomentumBalance {
  bodyLinearMomentumKgMPerS: Vector3;
  expectedBodyLinearMomentumKgMPerS: Vector3;
  linearClosureResidualKgMPerS: Vector3;
  linearClosureErrorKgMPerS: number;
  bodyAngularMomentumAboutOriginKgM2PerS: Vector3;
  expectedBodyAngularMomentumAboutOriginKgM2PerS: Vector3;
  angularClosureResidualKgM2PerS: Vector3;
  angularClosureErrorKgM2PerS: number;
  exhaustLinearMomentumKgMPerS: Vector3;
  exhaustAngularMomentumAboutOriginKgM2PerS: Vector3;
  internalAngularImpulseBodyNms: Vector3;
  internalAngularMomentumExchangeInertialKgM2PerS: Vector3;
  thrustImpulseInertialNs: Vector3;
  torqueImpulseBodyNms: Vector3;
  numericalLinearResidualKgMPerS: Vector3;
  numericalAngularResidualKgM2PerS: Vector3;
}

export interface NavigationEnergyBalance {
  bodyMechanicalEnergyJ: number;
  ledgerExpectedBodyMechanicalEnergyJ: number;
  closureErrorJ: number;
  idealJetEnergyJ: number;
  propulsionMechanicalEnergyReleasedJ: number;
  exhaustKineticEnergyJ: number;
  internalMechanicalEnergyTransferJ: number;
  numericalResidualJ: number;
}

export interface InternalAngularMomentumExchangeResult {
  requestedAngularImpulseBodyNms: Vector3;
  actualAngularMomentumChangeInertialKgM2PerS: Vector3;
  bodyMechanicalEnergyChangeJ: number;
  revision: number;
}

export interface NavigationStepResult {
  fromMicroseconds: number;
  toMicroseconds: number;
  simulatedSeconds: number;
  substeps: number;
  propellantConsumedKg: number;
  fusionFuelConsumedKg: number;
  fusionEnergyReleasedJ: number;
  retainedWasteHeatJ: number;
  directExportEnergyJ: number;
  propulsionSourceClosureErrorJ: number;
  thrustImpulseInertialNs: Vector3;
  torqueImpulseBodyNms: Vector3;
  internalRotorGyroscopicAngularMomentumExchangeInertialKgM2PerS:
    Vector3;
  linearMomentumClosureErrorKgMPerS: number;
  angularMomentumClosureErrorKgM2PerS: number;
  energyClosureErrorJ: number;
  revision: number;
}

export interface NavigationSummary {
  frameEpoch: number;
  anchorCompletedDistanceLightYears: number;
  elapsedSeconds: number;
  totalMassKg: number;
  propellantMassKg: number;
  fusionFuelMassKg: number;
  fusionEnergyReleasedJ: number;
  retainedWasteHeatJ: number;
  directExportEnergyJ: number;
  controlEnergyRequestedJ: number;
  controlEnergyServedJ: number;
  positionM: Vector3;
  velocityMPerS: Vector3;
  speedMPerS: number;
  orientationBodyToInertial: Quaternion;
  angularVelocityBodyRadPerS: Vector3;
  angularSpeedRadPerS: number;
  currentInertiaDiagonalKgM2: DiagonalInertiaTensor;
  activeThrusterCount: number;
  totalThrustN: number;
  instantaneousAccelerationMPerS2: number;
  linearMomentumClosureErrorKgMPerS: number;
  angularMomentumClosureErrorKgM2PerS: number;
  energyClosureErrorJ: number;
}

interface ThrusterSpecification {
  id: ThrusterId;
  label: string;
  role: ThrusterRole;
  positionBodyM: Vector3;
  forceDirectionBody: Vector3;
  maximumThrustN: number;
  specificImpulseS: number;
  minimumThrottleFraction: number;
}

interface SensorSpecification {
  id: NavigationSensorId;
  quantity: NavigationSensorQuantity;
  noiseStandardDeviation: number;
}

interface PhysicsDelta {
  propellantConsumedKg: number;
  fusionFuelConsumedKg: number;
  fusionEnergyReleasedJ: number;
  retainedWasteHeatJ: number;
  directExportEnergyJ: number;
  thrustImpulseInertialNs: Vector3;
  torqueImpulseBodyNms: Vector3;
}

const ZERO_VECTOR: Readonly<Vector3> = Object.freeze({ x: 0, y: 0, z: 0 });
const IDENTITY_QUATERNION: Readonly<Quaternion> = Object.freeze({
  w: 1,
  x: 0,
  y: 0,
  z: 0,
});

const THRUSTER_SPECIFICATIONS: readonly ThrusterSpecification[] = [
  {
    id: "main-a",
    label: "主推进器 A",
    role: "main",
    positionBodyM: { x: -390, y: -120, z: -55 },
    forceDirectionBody: { x: 1, y: 0, z: 0 },
    maximumThrustN: 12_000_000,
    specificImpulseS: 50_000,
    minimumThrottleFraction: 0.05,
  },
  {
    id: "main-b",
    label: "主推进器 B",
    role: "main",
    positionBodyM: { x: -390, y: 120, z: -55 },
    forceDirectionBody: { x: 1, y: 0, z: 0 },
    maximumThrustN: 12_000_000,
    specificImpulseS: 50_000,
    minimumThrottleFraction: 0.05,
  },
  {
    id: "main-c",
    label: "主推进器 C",
    role: "main",
    positionBodyM: { x: -390, y: -120, z: 55 },
    forceDirectionBody: { x: 1, y: 0, z: 0 },
    maximumThrustN: 12_000_000,
    specificImpulseS: 50_000,
    minimumThrottleFraction: 0.05,
  },
  {
    id: "main-d",
    label: "主推进器 D",
    role: "main",
    positionBodyM: { x: -390, y: 120, z: 55 },
    forceDirectionBody: { x: 1, y: 0, z: 0 },
    maximumThrustN: 12_000_000,
    specificImpulseS: 50_000,
    minimumThrottleFraction: 0.05,
  },
  {
    id: "reverse-a",
    label: "反推器 A",
    role: "reverse",
    positionBodyM: { x: 390, y: -100, z: 0 },
    forceDirectionBody: { x: -1, y: 0, z: 0 },
    maximumThrustN: 2_000_000,
    specificImpulseS: 18_000,
    minimumThrottleFraction: 0.08,
  },
  {
    id: "reverse-b",
    label: "反推器 B",
    role: "reverse",
    positionBodyM: { x: 390, y: 100, z: 0 },
    forceDirectionBody: { x: -1, y: 0, z: 0 },
    maximumThrustN: 2_000_000,
    specificImpulseS: 18_000,
    minimumThrottleFraction: 0.08,
  },
  {
    id: "rcs-fore-y-plus",
    label: "艏部横移 +Y",
    role: "translation-rcs",
    positionBodyM: { x: 370, y: 0, z: 0 },
    forceDirectionBody: { x: 0, y: 1, z: 0 },
    maximumThrustN: 400_000,
    specificImpulseS: 9_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-fore-y-minus",
    label: "艏部横移 -Y",
    role: "translation-rcs",
    positionBodyM: { x: 370, y: 0, z: 0 },
    forceDirectionBody: { x: 0, y: -1, z: 0 },
    maximumThrustN: 400_000,
    specificImpulseS: 9_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-aft-y-plus",
    label: "艉部横移 +Y",
    role: "translation-rcs",
    positionBodyM: { x: -370, y: 0, z: 0 },
    forceDirectionBody: { x: 0, y: 1, z: 0 },
    maximumThrustN: 400_000,
    specificImpulseS: 9_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-aft-y-minus",
    label: "艉部横移 -Y",
    role: "translation-rcs",
    positionBodyM: { x: -370, y: 0, z: 0 },
    forceDirectionBody: { x: 0, y: -1, z: 0 },
    maximumThrustN: 400_000,
    specificImpulseS: 9_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-fore-z-plus",
    label: "艏部纵移 +Z",
    role: "translation-rcs",
    positionBodyM: { x: 370, y: 0, z: 0 },
    forceDirectionBody: { x: 0, y: 0, z: 1 },
    maximumThrustN: 400_000,
    specificImpulseS: 9_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-fore-z-minus",
    label: "艏部纵移 -Z",
    role: "translation-rcs",
    positionBodyM: { x: 370, y: 0, z: 0 },
    forceDirectionBody: { x: 0, y: 0, z: -1 },
    maximumThrustN: 400_000,
    specificImpulseS: 9_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-aft-z-plus",
    label: "艉部纵移 +Z",
    role: "translation-rcs",
    positionBodyM: { x: -370, y: 0, z: 0 },
    forceDirectionBody: { x: 0, y: 0, z: 1 },
    maximumThrustN: 400_000,
    specificImpulseS: 9_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-aft-z-minus",
    label: "艉部纵移 -Z",
    role: "translation-rcs",
    positionBodyM: { x: -370, y: 0, z: 0 },
    forceDirectionBody: { x: 0, y: 0, z: -1 },
    maximumThrustN: 400_000,
    specificImpulseS: 9_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-roll-plus-a",
    label: "滚转 +A",
    role: "roll-rcs",
    positionBodyM: { x: 0, y: 220, z: 0 },
    forceDirectionBody: { x: 0, y: 0, z: 1 },
    maximumThrustN: 250_000,
    specificImpulseS: 8_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-roll-plus-b",
    label: "滚转 +B",
    role: "roll-rcs",
    positionBodyM: { x: 0, y: -220, z: 0 },
    forceDirectionBody: { x: 0, y: 0, z: -1 },
    maximumThrustN: 250_000,
    specificImpulseS: 8_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-roll-minus-a",
    label: "滚转 -A",
    role: "roll-rcs",
    positionBodyM: { x: 0, y: 220, z: 0 },
    forceDirectionBody: { x: 0, y: 0, z: -1 },
    maximumThrustN: 250_000,
    specificImpulseS: 8_000,
    minimumThrottleFraction: 0.1,
  },
  {
    id: "rcs-roll-minus-b",
    label: "滚转 -B",
    role: "roll-rcs",
    positionBodyM: { x: 0, y: -220, z: 0 },
    forceDirectionBody: { x: 0, y: 0, z: 1 },
    maximumThrustN: 250_000,
    specificImpulseS: 8_000,
    minimumThrottleFraction: 0.1,
  },
] as const;

const PROPULSION_CONTROL_TRAIN_A_THRUSTERS =
  new Set<ThrusterId>([
    "main-a",
    "main-d",
    "reverse-a",
    "rcs-fore-y-plus",
    "rcs-aft-y-minus",
    "rcs-fore-z-plus",
    "rcs-aft-z-minus",
    "rcs-roll-plus-a",
    "rcs-roll-minus-a",
  ]);

function fixedTorchParameters(
  specification: ThrusterSpecification,
): Pick<
  FixedThruster,
  | "controlTrainId"
  | "jetConversionEfficiency"
  | "retainedLossFraction"
  | "ignitionEnergyJ"
  | "holdPowerW"
> {
  const controlTrainId: PropulsionControlTrainId =
    PROPULSION_CONTROL_TRAIN_A_THRUSTERS.has(
      specification.id,
    )
      ? "propulsion-control-a"
      : "propulsion-control-b";
  switch (specification.role) {
    case "main":
      return {
        controlTrainId,
        jetConversionEfficiency: 0.85,
        retainedLossFraction: 0.002,
        ignitionEnergyJ: 20_000_000,
        holdPowerW: 1_000_000,
      };
    case "reverse":
      return {
        controlTrainId,
        jetConversionEfficiency: 0.8,
        retainedLossFraction: 0.005,
        ignitionEnergyJ: 5_000_000,
        holdPowerW: 400_000,
      };
    case "translation-rcs":
      return {
        controlTrainId,
        jetConversionEfficiency: 0.72,
        retainedLossFraction: 0.01,
        ignitionEnergyJ: 500_000,
        holdPowerW: 50_000,
      };
    case "roll-rcs":
      return {
        controlTrainId,
        jetConversionEfficiency: 0.68,
        retainedLossFraction: 0.015,
        ignitionEnergyJ: 250_000,
        holdPowerW: 30_000,
      };
  }
}

const SENSOR_SPECIFICATIONS: readonly SensorSpecification[] = [
  { id: "sensor:position:x", quantity: "positionX", noiseStandardDeviation: 0.02 },
  { id: "sensor:position:y", quantity: "positionY", noiseStandardDeviation: 0.02 },
  { id: "sensor:position:z", quantity: "positionZ", noiseStandardDeviation: 0.02 },
  { id: "sensor:velocity:x", quantity: "velocityX", noiseStandardDeviation: 0.0001 },
  { id: "sensor:velocity:y", quantity: "velocityY", noiseStandardDeviation: 0.0001 },
  { id: "sensor:velocity:z", quantity: "velocityZ", noiseStandardDeviation: 0.0001 },
  { id: "sensor:attitude:w", quantity: "attitudeW", noiseStandardDeviation: 1e-7 },
  { id: "sensor:attitude:x", quantity: "attitudeX", noiseStandardDeviation: 1e-7 },
  { id: "sensor:attitude:y", quantity: "attitudeY", noiseStandardDeviation: 1e-7 },
  { id: "sensor:attitude:z", quantity: "attitudeZ", noiseStandardDeviation: 1e-7 },
  {
    id: "sensor:angular-velocity:x",
    quantity: "angularVelocityX",
    noiseStandardDeviation: 1e-8,
  },
  {
    id: "sensor:angular-velocity:y",
    quantity: "angularVelocityY",
    noiseStandardDeviation: 1e-8,
  },
  {
    id: "sensor:angular-velocity:z",
    quantity: "angularVelocityZ",
    noiseStandardDeviation: 1e-8,
  },
  {
    id: "sensor:propellant-mass",
    quantity: "propellantMass",
    noiseStandardDeviation: 2,
  },
  {
    id: "sensor:fusion-fuel-mass",
    quantity: "fusionFuelMass",
    noiseStandardDeviation: 0.02,
  },
] as const;

function cloneData<T>(value: T): T {
  return structuredClone(value);
}

function vector(x = 0, y = 0, z = 0): Vector3 {
  return { x, y, z };
}

function add(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.x + second.x,
    y: first.y + second.y,
    z: first.z + second.z,
  };
}

function subtract(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z,
  };
}

function scale(value: Vector3, factor: number): Vector3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

function dot(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function cross(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

function magnitudeSquared(value: Vector3): number {
  return dot(value, value);
}

function magnitude(value: Vector3): number {
  return Math.sqrt(magnitudeSquared(value));
}

function quaternionMultiply(first: Quaternion, second: Quaternion): Quaternion {
  return {
    w:
      first.w * second.w -
      first.x * second.x -
      first.y * second.y -
      first.z * second.z,
    x:
      first.w * second.x +
      first.x * second.w +
      first.y * second.z -
      first.z * second.y,
    y:
      first.w * second.y -
      first.x * second.z +
      first.y * second.w +
      first.z * second.x,
    z:
      first.w * second.z +
      first.x * second.y -
      first.y * second.x +
      first.z * second.w,
  };
}

function quaternionNorm(value: Quaternion): number {
  return Math.hypot(value.w, value.x, value.y, value.z);
}

function normalizeQuaternion(value: Quaternion): Quaternion {
  const norm = quaternionNorm(value);
  if (!Number.isFinite(norm) || norm <= 0) {
    throw new RangeError("orientation quaternion must have a positive finite norm");
  }
  return {
    w: value.w / norm,
    x: value.x / norm,
    y: value.y / norm,
    z: value.z / norm,
  };
}

function quaternionFromAngularVelocity(
  angularVelocityBodyRadPerS: Vector3,
  deltaSeconds: number,
): Quaternion {
  const angularSpeed = magnitude(angularVelocityBodyRadPerS);
  const angle = angularSpeed * deltaSeconds;
  if (angle < 1e-12) {
    const halfDelta = 0.5 * deltaSeconds;
    return normalizeQuaternion({
      w: 1,
      x: angularVelocityBodyRadPerS.x * halfDelta,
      y: angularVelocityBodyRadPerS.y * halfDelta,
      z: angularVelocityBodyRadPerS.z * halfDelta,
    });
  }
  const halfAngle = angle * 0.5;
  const factor = Math.sin(halfAngle) / angularSpeed;
  return {
    w: Math.cos(halfAngle),
    x: angularVelocityBodyRadPerS.x * factor,
    y: angularVelocityBodyRadPerS.y * factor,
    z: angularVelocityBodyRadPerS.z * factor,
  };
}

function rotateBodyToInertial(
  orientationBodyToInertial: Quaternion,
  bodyVector: Vector3,
): Vector3 {
  const qVector = vector(
    orientationBodyToInertial.x,
    orientationBodyToInertial.y,
    orientationBodyToInertial.z,
  );
  const twiceCross = scale(cross(qVector, bodyVector), 2);
  return add(
    bodyVector,
    add(
      scale(twiceCross, orientationBodyToInertial.w),
      cross(qVector, twiceCross),
    ),
  );
}

function rotateInertialToBody(
  orientationBodyToInertial: Quaternion,
  inertialVector: Vector3,
): Vector3 {
  return rotateBodyToInertial(
    {
      w: orientationBodyToInertial.w,
      x: -orientationBodyToInertial.x,
      y: -orientationBodyToInertial.y,
      z: -orientationBodyToInertial.z,
    },
    inertialVector,
  );
}

function multiplyDiagonal(
  inertia: DiagonalInertiaTensor,
  value: Vector3,
): Vector3 {
  return {
    x: inertia.x * value.x,
    y: inertia.y * value.y,
    z: inertia.z * value.z,
  };
}

function divideDiagonal(
  value: Vector3,
  inertia: DiagonalInertiaTensor,
): Vector3 {
  return {
    x: value.x / inertia.x,
    y: value.y / inertia.y,
    z: value.z / inertia.z,
  };
}

function totalMass(body: NavigationRigidBody): number {
  return body.dryMassKg + body.propellantMassKg;
}

function currentInertia(
  body: NavigationRigidBody,
): DiagonalInertiaTensor {
  return {
    x:
      body.dryInertiaDiagonalKgM2.x +
      body.propellantInertiaPerKgM2.x * body.propellantMassKg,
    y:
      body.dryInertiaDiagonalKgM2.y +
      body.propellantInertiaPerKgM2.y * body.propellantMassKg,
    z:
      body.dryInertiaDiagonalKgM2.z +
      body.propellantInertiaPerKgM2.z * body.propellantMassKg,
  };
}

function bodyLinearMomentum(body: NavigationRigidBody): Vector3 {
  return scale(body.velocityMPerS, totalMass(body));
}

function bodySpinAngularMomentumInertial(
  body: NavigationRigidBody,
): Vector3 {
  return rotateBodyToInertial(
    body.orientationBodyToInertial,
    multiplyDiagonal(
      currentInertia(body),
      body.angularVelocityBodyRadPerS,
    ),
  );
}

function bodyAngularMomentumAboutOrigin(
  body: NavigationRigidBody,
): Vector3 {
  return add(
    cross(body.positionM, bodyLinearMomentum(body)),
    bodySpinAngularMomentumInertial(body),
  );
}

function bodyMechanicalEnergy(body: NavigationRigidBody): number {
  const massKg = totalMass(body);
  const translational =
    0.5 * massKg * magnitudeSquared(body.velocityMPerS);
  const spinMomentum = multiplyDiagonal(
    currentInertia(body),
    body.angularVelocityBodyRadPerS,
  );
  const rotational =
    0.5 * dot(body.angularVelocityBodyRadPerS, spinMomentum);
  return translational + rotational;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `${label} has unexpected keys; expected ${expected.join(", ")}`,
    );
  }
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

function assertNonNegative(
  value: unknown,
  label: string,
): asserts value is number {
  assertFinite(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
}

function assertPositive(
  value: unknown,
  label: string,
): asserts value is number {
  assertFinite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be greater than zero`);
}

function assertFraction(
  value: unknown,
  label: string,
): asserts value is number {
  assertFinite(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be between zero and one`);
  }
}

function assertSafeInteger(
  value: unknown,
  label: string,
  minimum = 0,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new TypeError(
      `${label} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
}

function assertNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertEnum<T extends string>(
  value: unknown,
  options: readonly T[],
  label: string,
): asserts value is T {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new TypeError(`${label} must be one of ${options.join(", ")}`);
  }
}

function assertVector(value: unknown, label: string): asserts value is Vector3 {
  assertRecord(value, label);
  assertExactKeys(value, ["x", "y", "z"], label);
  assertFinite(value.x, `${label}.x`);
  assertFinite(value.y, `${label}.y`);
  assertFinite(value.z, `${label}.z`);
}

function assertQuaternion(
  value: unknown,
  label: string,
): asserts value is Quaternion {
  assertRecord(value, label);
  assertExactKeys(value, ["w", "x", "y", "z"], label);
  assertFinite(value.w, `${label}.w`);
  assertFinite(value.x, `${label}.x`);
  assertFinite(value.y, `${label}.y`);
  assertFinite(value.z, `${label}.z`);
  const unitError = Math.abs(quaternionNorm(value as unknown as Quaternion) - 1);
  if (unitError > QUATERNION_UNIT_TOLERANCE) {
    throw new RangeError(`${label} must be a unit quaternion`);
  }
}

function assertDiagonalInertia(
  value: unknown,
  label: string,
): asserts value is DiagonalInertiaTensor {
  assertVector(value, label);
  assertPositive(value.x, `${label}.x`);
  assertPositive(value.y, `${label}.y`);
  assertPositive(value.z, `${label}.z`);
}

function assertClose(
  actual: number,
  expected: number,
  relativeTolerance: number,
  absoluteTolerance: number,
  label: string,
): void {
  const tolerance =
    absoluteTolerance +
    relativeTolerance * Math.max(1, Math.abs(actual), Math.abs(expected));
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label} does not reconcile: expected ${expected}, received ${actual}`,
    );
  }
}

function assertVectorClose(
  actual: Vector3,
  expected: Vector3,
  relativeTolerance: number,
  absoluteTolerance: number,
  label: string,
): void {
  assertClose(
    actual.x,
    expected.x,
    relativeTolerance,
    absoluteTolerance,
    `${label}.x`,
  );
  assertClose(
    actual.y,
    expected.y,
    relativeTolerance,
    absoluteTolerance,
    `${label}.y`,
  );
  assertClose(
    actual.z,
    expected.z,
    relativeTolerance,
    absoluteTolerance,
    `${label}.z`,
  );
}

function hashSeed(seed: number | string): number {
  if (typeof seed === "number") {
    assertFinite(seed, "seed");
    return seed >>> 0;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function combineSeed(seed: number, text: string): number {
  let hash = seed ^ 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

function nextUniform(sensor: NavigationSensor): number {
  sensor.randomState = (sensor.randomState + 0x6d2b79f5) >>> 0;
  let value = sensor.randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

function nextNormal(sensor: NavigationSensor): number {
  if (sensor.spareNormal !== null) {
    const spare = sensor.spareNormal;
    sensor.spareNormal = null;
    return spare;
  }
  const first = Math.max(nextUniform(sensor), Number.EPSILON);
  const second = nextUniform(sensor);
  const radius = Math.sqrt(-2 * Math.log(first));
  const angle = 2 * Math.PI * second;
  sensor.spareNormal = radius * Math.sin(angle);
  return radius * Math.cos(angle);
}

function findById<T extends { id: string }>(
  entities: readonly T[],
  id: string,
  label: string,
): T {
  const entity = entities.find((candidate) => candidate.id === id);
  if (!entity) throw new RangeError(`unknown ${label}: ${id}`);
  return entity;
}

function makeBaselineBody(
  initialCondition: NavigationInitialCondition = {},
): NavigationRigidBody {
  const dryMassKg = 280_000_000;
  const baseline: NavigationRigidBody = {
    positionM: cloneData(initialCondition.positionM ?? ZERO_VECTOR),
    velocityMPerS: cloneData(initialCondition.velocityMPerS ?? ZERO_VECTOR),
    orientationBodyToInertial: normalizeQuaternion(
      cloneData(initialCondition.orientationBodyToInertial ?? IDENTITY_QUATERNION),
    ),
    angularVelocityBodyRadPerS: cloneData(
      initialCondition.angularVelocityBodyRadPerS ?? ZERO_VECTOR,
    ),
    dryMassKg,
    propellantMassKg: initialCondition.propellantMassKg ?? 36_000_000,
    // The dry hull is approximated as an 820 m x 470 m x 180 m box.
    dryInertiaDiagonalKgM2: {
      x: (dryMassKg * (470 ** 2 + 180 ** 2)) / 12,
      y: (dryMassKg * (820 ** 2 + 180 ** 2)) / 12,
      z: (dryMassKg * (820 ** 2 + 470 ** 2)) / 12,
    },
    // Propellant is represented as a symmetric central 300 m x 240 m x
    // 120 m distributed reservoir, so depletion moves neither the modeled
    // center of mass nor the principal axes.
    propellantInertiaPerKgM2: {
      x: (240 ** 2 + 120 ** 2) / 12,
      y: (300 ** 2 + 120 ** 2) / 12,
      z: (300 ** 2 + 240 ** 2) / 12,
    },
  };
  validateBody(baseline, "initial body");
  return baseline;
}

function makeBaselineThrusters(): FixedThruster[] {
  return THRUSTER_SPECIFICATIONS.map((specification) => ({
    ...cloneData(specification),
    ...fixedTorchParameters(specification),
    condition: "nominal",
    performanceFraction: 1,
    stuckOnThrottleFraction: 1,
    lastCommandedThrottleFraction: 0,
    lastActualThrottleFraction: 0,
    lastThrustN: 0,
    lastMassFlowKgPerS: 0,
  }));
}

function makeBaselineSensors(seed: number): NavigationSensor[] {
  return SENSOR_SPECIFICATIONS.map((specification) => ({
    id: specification.id,
    quantity: specification.quantity,
    sampleIntervalMicroseconds: 5 * NAVIGATION_MICROSECONDS_PER_SECOND,
    delayMicroseconds: 2 * NAVIGATION_MICROSECONDS_PER_SECOND,
    noiseStandardDeviation: specification.noiseStandardDeviation,
    bias: 0,
    driftPerSecond: 0,
    condition: "nominal",
    stuckValue: null,
    nextSampleMicroseconds: 0,
    randomState: combineSeed(seed, specification.id),
    spareNormal: null,
    pending: [],
    latest: null,
  }));
}

export function createBaselineNavigationSnapshot(
  options: RigidBodyNavigationOptions = {},
): NavigationSnapshot {
  const body = makeBaselineBody(options.initialCondition);
  const initialFusionFuelMassKg =
    options.initialFusionFuelMassKg ??
    body.propellantMassKg * (24_000 / 36_000_000);
  assertNonNegative(
    initialFusionFuelMassKg,
    "initialFusionFuelMassKg",
  );
  if (initialFusionFuelMassKg > body.propellantMassKg) {
    throw new RangeError(
      "initialFusionFuelMassKg cannot exceed propellant mass",
    );
  }
  return {
    snapshotVersion: NAVIGATION_SNAPSHOT_VERSION,
    elapsedMicroseconds: 0,
    revision: 0,
    frameEpoch: 0,
    anchorCompletedDistanceLightYears: 0,
    body,
    thrusters: makeBaselineThrusters(),
    commands: [],
    nextCommandSequence: 1,
    sensors: makeBaselineSensors(
      hashSeed(options.seed ?? "far-horizon-navigation"),
    ),
    momentumLedger: {
      initialBodyLinearMomentumKgMPerS: bodyLinearMomentum(body),
      initialBodyAngularMomentumAboutOriginKgM2PerS:
        bodyAngularMomentumAboutOrigin(body),
      exhaustLinearMomentumKgMPerS: vector(),
      exhaustAngularMomentumAboutOriginKgM2PerS: vector(),
      internalAngularImpulseBodyNms: vector(),
      internalAngularMomentumExchangeInertialKgM2PerS: vector(),
      thrustImpulseInertialNs: vector(),
      torqueImpulseBodyNms: vector(),
      numericalLinearResidualKgMPerS: vector(),
      numericalAngularResidualKgM2PerS: vector(),
    },
    energyLedger: {
      initialBodyMechanicalEnergyJ: bodyMechanicalEnergy(body),
      idealJetEnergyJ: 0,
      propulsionMechanicalEnergyReleasedJ: 0,
      exhaustKineticEnergyJ: 0,
      internalMechanicalEnergyTransferJ: 0,
      numericalResidualJ: 0,
    },
    propulsion: {
      initialFusionFuelMassKg,
      fusionFuelMassKg: initialFusionFuelMassKg,
      energyLedger: {
        fusionFuelConsumedKg: 0,
        fusionEnergyReleasedJ: 0,
        idealJetEnergyJ: 0,
        retainedWasteHeatJ: 0,
        directExportEnergyJ: 0,
        controlEnergyRequestedJ: 0,
        controlEnergyServedJ: 0,
      },
    },
  };
}

function validateBody(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "positionM",
      "velocityMPerS",
      "orientationBodyToInertial",
      "angularVelocityBodyRadPerS",
      "dryMassKg",
      "propellantMassKg",
      "dryInertiaDiagonalKgM2",
      "propellantInertiaPerKgM2",
    ],
    label,
  );
  assertVector(value.positionM, `${label}.positionM`);
  assertVector(value.velocityMPerS, `${label}.velocityMPerS`);
  if (magnitude(value.velocityMPerS) > MAX_SUPPORTED_SPEED_M_PER_S) {
    throw new RangeError(`${label}.velocityMPerS exceeds the model limit`);
  }
  assertQuaternion(
    value.orientationBodyToInertial,
    `${label}.orientationBodyToInertial`,
  );
  assertVector(
    value.angularVelocityBodyRadPerS,
    `${label}.angularVelocityBodyRadPerS`,
  );
  if (
    magnitude(value.angularVelocityBodyRadPerS) >
    MAX_SUPPORTED_ANGULAR_SPEED_RAD_PER_S
  ) {
    throw new RangeError(
      `${label}.angularVelocityBodyRadPerS exceeds the model limit`,
    );
  }
  assertPositive(value.dryMassKg, `${label}.dryMassKg`);
  assertNonNegative(value.propellantMassKg, `${label}.propellantMassKg`);
  assertDiagonalInertia(
    value.dryInertiaDiagonalKgM2,
    `${label}.dryInertiaDiagonalKgM2`,
  );
  assertDiagonalInertia(
    value.propellantInertiaPerKgM2,
    `${label}.propellantInertiaPerKgM2`,
  );
}

function validateThruster(
  value: unknown,
  specification: ThrusterSpecification,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "label",
      "role",
      "positionBodyM",
      "forceDirectionBody",
      "maximumThrustN",
      "specificImpulseS",
      "minimumThrottleFraction",
      "controlTrainId",
      "jetConversionEfficiency",
      "retainedLossFraction",
      "ignitionEnergyJ",
      "holdPowerW",
      "condition",
      "performanceFraction",
      "stuckOnThrottleFraction",
      "lastCommandedThrottleFraction",
      "lastActualThrottleFraction",
      "lastThrustN",
      "lastMassFlowKgPerS",
    ],
    label,
  );
  if (value.id !== specification.id) {
    throw new Error(`${label}.id must be ${specification.id}`);
  }
  if (value.label !== specification.label) {
    throw new Error(`${label}.label must be ${specification.label}`);
  }
  if (value.role !== specification.role) {
    throw new Error(`${label}.role must be ${specification.role}`);
  }
  assertVector(value.positionBodyM, `${label}.positionBodyM`);
  assertVectorClose(
    value.positionBodyM,
    specification.positionBodyM,
    0,
    0,
    `${label}.positionBodyM`,
  );
  assertVector(value.forceDirectionBody, `${label}.forceDirectionBody`);
  assertVectorClose(
    value.forceDirectionBody,
    specification.forceDirectionBody,
    0,
    0,
    `${label}.forceDirectionBody`,
  );
  assertClose(
    magnitude(value.forceDirectionBody),
    1,
    0,
    1e-12,
    `${label}.forceDirectionBody norm`,
  );
  assertPositive(value.maximumThrustN, `${label}.maximumThrustN`);
  assertPositive(value.specificImpulseS, `${label}.specificImpulseS`);
  if (value.maximumThrustN !== specification.maximumThrustN) {
    throw new Error(`${label}.maximumThrustN must preserve fixed topology`);
  }
  if (value.specificImpulseS !== specification.specificImpulseS) {
    throw new Error(`${label}.specificImpulseS must preserve fixed topology`);
  }
  if (value.minimumThrottleFraction !== specification.minimumThrottleFraction) {
    throw new Error(
      `${label}.minimumThrottleFraction must preserve fixed topology`,
    );
  }
  const torch = fixedTorchParameters(specification);
  for (const key of [
    "controlTrainId",
    "jetConversionEfficiency",
    "retainedLossFraction",
    "ignitionEnergyJ",
    "holdPowerW",
  ] as const) {
    if (value[key] !== torch[key]) {
      throw new Error(
        `${label}.${key} must preserve fixed propulsion topology`,
      );
    }
  }
  assertFraction(
    value.jetConversionEfficiency,
    `${label}.jetConversionEfficiency`,
  );
  if (value.jetConversionEfficiency === 0) {
    throw new RangeError(
      `${label}.jetConversionEfficiency must be positive`,
    );
  }
  assertFraction(
    value.retainedLossFraction,
    `${label}.retainedLossFraction`,
  );
  assertNonNegative(value.ignitionEnergyJ, `${label}.ignitionEnergyJ`);
  assertNonNegative(value.holdPowerW, `${label}.holdPowerW`);
  assertEnum(
    value.condition,
    ["nominal", "degraded", "stuck-off", "stuck-on"],
    `${label}.condition`,
  );
  assertFraction(value.performanceFraction, `${label}.performanceFraction`);
  assertFraction(
    value.stuckOnThrottleFraction,
    `${label}.stuckOnThrottleFraction`,
  );
  assertFraction(
    value.lastCommandedThrottleFraction,
    `${label}.lastCommandedThrottleFraction`,
  );
  assertFraction(
    value.lastActualThrottleFraction,
    `${label}.lastActualThrottleFraction`,
  );
  assertNonNegative(value.lastThrustN, `${label}.lastThrustN`);
  assertNonNegative(value.lastMassFlowKgPerS, `${label}.lastMassFlowKgPerS`);
}

function validateCommand(value: unknown, index: number): void {
  const label = `snapshot.commands[${index}]`;
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "sequence",
      "thrusterId",
      "mode",
      "throttleFraction",
      "startsAtMicroseconds",
      "endsAtMicroseconds",
      "canceledAtMicroseconds",
    ],
    label,
  );
  assertNonEmptyString(value.id, `${label}.id`);
  assertSafeInteger(value.sequence, `${label}.sequence`, 1);
  assertEnum(value.thrusterId, THRUSTER_IDS, `${label}.thrusterId`);
  assertEnum(value.mode, ["pulse", "sustained"], `${label}.mode`);
  assertFraction(value.throttleFraction, `${label}.throttleFraction`);
  assertSafeInteger(
    value.startsAtMicroseconds,
    `${label}.startsAtMicroseconds`,
  );
  if (value.mode === "pulse") {
    assertSafeInteger(value.endsAtMicroseconds, `${label}.endsAtMicroseconds`);
    if (value.endsAtMicroseconds <= value.startsAtMicroseconds) {
      throw new RangeError(`${label}.endsAtMicroseconds must follow its start`);
    }
  } else if (value.endsAtMicroseconds !== null) {
    throw new TypeError(`${label}.endsAtMicroseconds must be null when sustained`);
  }
  if (value.canceledAtMicroseconds !== null) {
    assertSafeInteger(
      value.canceledAtMicroseconds,
      `${label}.canceledAtMicroseconds`,
    );
  }
}

function validateReading(
  value: unknown,
  sensor: Pick<NavigationSensor, "id" | "quantity" | "delayMicroseconds">,
  frameEpoch: number,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "sensorId",
      "quantity",
      "frameEpoch",
      "sampledAtMicroseconds",
      "availableAtMicroseconds",
      "value",
      "quality",
    ],
    label,
  );
  if (value.sensorId !== sensor.id) {
    throw new Error(`${label}.sensorId must be ${sensor.id}`);
  }
  if (value.quantity !== sensor.quantity) {
    throw new Error(`${label}.quantity must be ${sensor.quantity}`);
  }
  assertSafeInteger(value.frameEpoch, `${label}.frameEpoch`);
  if (value.frameEpoch !== frameEpoch) {
    throw new Error(
      `${label}.frameEpoch must match navigation frame ${frameEpoch}`,
    );
  }
  assertSafeInteger(value.sampledAtMicroseconds, `${label}.sampledAtMicroseconds`);
  assertSafeInteger(
    value.availableAtMicroseconds,
    `${label}.availableAtMicroseconds`,
  );
  if (
    value.availableAtMicroseconds !==
    value.sampledAtMicroseconds + sensor.delayMicroseconds
  ) {
    throw new Error(`${label} availability does not match sensor delay`);
  }
  if (value.value !== null) assertFinite(value.value, `${label}.value`);
  assertEnum(
    value.quality,
    ["nominal", "degraded", "stuck", "offline"],
    `${label}.quality`,
  );
}

function validateSensor(
  value: unknown,
  specification: SensorSpecification,
  elapsedMicroseconds: number,
  frameEpoch: number,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
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
  if (value.id !== specification.id) {
    throw new Error(`${label}.id must be ${specification.id}`);
  }
  if (value.quantity !== specification.quantity) {
    throw new Error(`${label}.quantity must be ${specification.quantity}`);
  }
  assertSafeInteger(
    value.sampleIntervalMicroseconds,
    `${label}.sampleIntervalMicroseconds`,
    1,
  );
  assertSafeInteger(value.delayMicroseconds, `${label}.delayMicroseconds`);
  assertNonNegative(
    value.noiseStandardDeviation,
    `${label}.noiseStandardDeviation`,
  );
  assertFinite(value.bias, `${label}.bias`);
  assertFinite(value.driftPerSecond, `${label}.driftPerSecond`);
  assertEnum(
    value.condition,
    ["nominal", "degraded", "stuck", "offline"],
    `${label}.condition`,
  );
  if (value.stuckValue !== null) {
    assertFinite(value.stuckValue, `${label}.stuckValue`);
  }
  assertSafeInteger(
    value.nextSampleMicroseconds,
    `${label}.nextSampleMicroseconds`,
  );
  if (value.nextSampleMicroseconds <= elapsedMicroseconds) {
    throw new Error(`${label}.nextSampleMicroseconds must be in the future`);
  }
  assertSafeInteger(value.randomState, `${label}.randomState`);
  if (value.randomState > 0xffff_ffff) {
    throw new RangeError(`${label}.randomState must be an unsigned 32-bit value`);
  }
  if (value.spareNormal !== null) {
    assertFinite(value.spareNormal, `${label}.spareNormal`);
  }
  if (!Array.isArray(value.pending)) {
    throw new TypeError(`${label}.pending must be an array`);
  }
  let previousAvailability = -1;
  for (const [index, reading] of value.pending.entries()) {
    validateReading(
      reading,
      value as unknown as NavigationSensor,
      frameEpoch,
      `${label}.pending[${index}]`,
    );
    const typed = reading as NavigationSensorReading;
    if (typed.availableAtMicroseconds <= elapsedMicroseconds) {
      throw new Error(`${label}.pending contains an already available reading`);
    }
    if (typed.availableAtMicroseconds < previousAvailability) {
      throw new Error(`${label}.pending must be ordered by availability`);
    }
    previousAvailability = typed.availableAtMicroseconds;
  }
  if (value.latest !== null) {
    validateReading(
      value.latest,
      value as unknown as NavigationSensor,
      frameEpoch,
      `${label}.latest`,
    );
    if (
      (value.latest as unknown as NavigationSensorReading)
        .availableAtMicroseconds > elapsedMicroseconds
    ) {
      throw new Error(`${label}.latest is not yet available`);
    }
  }
}

function validateMomentumLedger(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "initialBodyLinearMomentumKgMPerS",
      "initialBodyAngularMomentumAboutOriginKgM2PerS",
      "exhaustLinearMomentumKgMPerS",
      "exhaustAngularMomentumAboutOriginKgM2PerS",
      "internalAngularImpulseBodyNms",
      "internalAngularMomentumExchangeInertialKgM2PerS",
      "thrustImpulseInertialNs",
      "torqueImpulseBodyNms",
      "numericalLinearResidualKgMPerS",
      "numericalAngularResidualKgM2PerS",
    ],
    label,
  );
  assertVector(
    value.initialBodyLinearMomentumKgMPerS,
    `${label}.initialBodyLinearMomentumKgMPerS`,
  );
  assertVector(
    value.initialBodyAngularMomentumAboutOriginKgM2PerS,
    `${label}.initialBodyAngularMomentumAboutOriginKgM2PerS`,
  );
  assertVector(
    value.exhaustLinearMomentumKgMPerS,
    `${label}.exhaustLinearMomentumKgMPerS`,
  );
  assertVector(
    value.exhaustAngularMomentumAboutOriginKgM2PerS,
    `${label}.exhaustAngularMomentumAboutOriginKgM2PerS`,
  );
  assertVector(
    value.internalAngularImpulseBodyNms,
    `${label}.internalAngularImpulseBodyNms`,
  );
  assertVector(
    value.internalAngularMomentumExchangeInertialKgM2PerS,
    `${label}.internalAngularMomentumExchangeInertialKgM2PerS`,
  );
  assertVector(
    value.thrustImpulseInertialNs,
    `${label}.thrustImpulseInertialNs`,
  );
  assertVector(value.torqueImpulseBodyNms, `${label}.torqueImpulseBodyNms`);
  assertVector(
    value.numericalLinearResidualKgMPerS,
    `${label}.numericalLinearResidualKgMPerS`,
  );
  assertVector(
    value.numericalAngularResidualKgM2PerS,
    `${label}.numericalAngularResidualKgM2PerS`,
  );
}

function validateEnergyLedger(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "initialBodyMechanicalEnergyJ",
      "idealJetEnergyJ",
      "propulsionMechanicalEnergyReleasedJ",
      "exhaustKineticEnergyJ",
      "internalMechanicalEnergyTransferJ",
      "numericalResidualJ",
    ],
    label,
  );
  assertNonNegative(
    value.initialBodyMechanicalEnergyJ,
    `${label}.initialBodyMechanicalEnergyJ`,
  );
  assertNonNegative(value.idealJetEnergyJ, `${label}.idealJetEnergyJ`);
  assertFinite(
    value.propulsionMechanicalEnergyReleasedJ,
    `${label}.propulsionMechanicalEnergyReleasedJ`,
  );
  assertNonNegative(
    value.exhaustKineticEnergyJ,
    `${label}.exhaustKineticEnergyJ`,
  );
  assertFinite(
    value.internalMechanicalEnergyTransferJ,
    `${label}.internalMechanicalEnergyTransferJ`,
  );
  assertFinite(value.numericalResidualJ, `${label}.numericalResidualJ`);
}

function validateFusionTorchPropulsion(
  value: unknown,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "initialFusionFuelMassKg",
      "fusionFuelMassKg",
      "energyLedger",
    ],
    label,
  );
  assertNonNegative(
    value.initialFusionFuelMassKg,
    `${label}.initialFusionFuelMassKg`,
  );
  assertNonNegative(
    value.fusionFuelMassKg,
    `${label}.fusionFuelMassKg`,
  );
  if (value.fusionFuelMassKg > value.initialFusionFuelMassKg) {
    throw new Error(
      `${label}.fusionFuelMassKg cannot exceed its initial inventory`,
    );
  }
  assertRecord(value.energyLedger, `${label}.energyLedger`);
  assertExactKeys(
    value.energyLedger,
    [
      "fusionFuelConsumedKg",
      "fusionEnergyReleasedJ",
      "idealJetEnergyJ",
      "retainedWasteHeatJ",
      "directExportEnergyJ",
      "controlEnergyRequestedJ",
      "controlEnergyServedJ",
    ],
    `${label}.energyLedger`,
  );
  for (const key of [
    "fusionFuelConsumedKg",
    "fusionEnergyReleasedJ",
    "idealJetEnergyJ",
    "retainedWasteHeatJ",
    "directExportEnergyJ",
    "controlEnergyRequestedJ",
    "controlEnergyServedJ",
  ] as const) {
    assertNonNegative(
      value.energyLedger[key],
      `${label}.energyLedger.${key}`,
    );
  }
  const typed = value as unknown as FusionTorchPropulsionState;
  assertClose(
    typed.initialFusionFuelMassKg - typed.fusionFuelMassKg,
    typed.energyLedger.fusionFuelConsumedKg,
    ENERGY_CLOSURE_RELATIVE_TOLERANCE,
    1e-12,
    `${label} fusion fuel inventory`,
  );
  assertClose(
    typed.energyLedger.fusionFuelConsumedKg *
      FUSION_TORCH_SPECIFIC_ENERGY_J_PER_KG,
    typed.energyLedger.fusionEnergyReleasedJ,
    ENERGY_CLOSURE_RELATIVE_TOLERANCE,
    1e-3,
    `${label} fusion source`,
  );
  assertClose(
    typed.energyLedger.fusionEnergyReleasedJ,
    typed.energyLedger.idealJetEnergyJ +
      typed.energyLedger.retainedWasteHeatJ +
      typed.energyLedger.directExportEnergyJ,
    ENERGY_CLOSURE_RELATIVE_TOLERANCE,
    1e-3,
    `${label} propulsion source allocation`,
  );
  if (
    typed.energyLedger.controlEnergyServedJ >
    typed.energyLedger.controlEnergyRequestedJ + 1e-6
  ) {
    throw new Error(
      `${label} propulsion control served energy exceeds requested energy`,
    );
  }
}

function commandAtTime(
  commands: readonly ThrusterCommand[],
  thrusterId: ThrusterId,
  elapsedMicroseconds: number,
): ThrusterCommand | undefined {
  let selected: ThrusterCommand | undefined;
  for (const command of commands) {
    if (
      command.thrusterId !== thrusterId ||
      command.startsAtMicroseconds > elapsedMicroseconds ||
      (command.endsAtMicroseconds !== null &&
        command.endsAtMicroseconds <= elapsedMicroseconds) ||
      (command.canceledAtMicroseconds !== null &&
        command.canceledAtMicroseconds <= elapsedMicroseconds)
    ) {
      continue;
    }
    if (!selected || command.sequence > selected.sequence) selected = command;
  }
  return selected;
}

function actualThrottle(
  thruster: FixedThruster,
  commandedThrottleFraction: number,
  hasPropellant: boolean,
): number {
  if (!hasPropellant || thruster.condition === "stuck-off") return 0;
  if (thruster.condition === "stuck-on") {
    return (
      Math.max(
        thruster.minimumThrottleFraction,
        thruster.stuckOnThrottleFraction,
      ) * thruster.performanceFraction
    );
  }
  if (commandedThrottleFraction <= 0) return 0;
  const requested = Math.max(
    commandedThrottleFraction,
    thruster.minimumThrottleFraction,
  );
  return (
    requested *
    (thruster.condition === "degraded"
      ? thruster.performanceFraction
      : 1)
  );
}

function expectedThrusterOutput(
  thruster: FixedThruster,
  commands: readonly ThrusterCommand[],
  elapsedMicroseconds: number,
  hasPropellant: boolean,
): Pick<
  FixedThruster,
  | "lastCommandedThrottleFraction"
  | "lastActualThrottleFraction"
  | "lastThrustN"
  | "lastMassFlowKgPerS"
> {
  const command = commandAtTime(commands, thruster.id, elapsedMicroseconds);
  const commanded = command?.throttleFraction ?? 0;
  const actual = actualThrottle(thruster, commanded, hasPropellant);
  const thrustN = thruster.maximumThrustN * actual;
  return {
    lastCommandedThrottleFraction: commanded,
    lastActualThrottleFraction: actual,
    lastThrustN: thrustN,
    lastMassFlowKgPerS:
      thrustN / (thruster.specificImpulseS * STANDARD_GRAVITY_M_PER_S2),
  };
}

function momentumBalanceForSnapshot(
  snapshot: NavigationSnapshot,
): NavigationMomentumBalance {
  const ledger = snapshot.momentumLedger;
  const currentLinear = bodyLinearMomentum(snapshot.body);
  const expectedLinear = add(
    subtract(
      ledger.initialBodyLinearMomentumKgMPerS,
      ledger.exhaustLinearMomentumKgMPerS,
    ),
    ledger.numericalLinearResidualKgMPerS,
  );
  const linearResidual = subtract(currentLinear, expectedLinear);
  const currentAngular = bodyAngularMomentumAboutOrigin(snapshot.body);
  const expectedAngular = add(
    add(
      subtract(
        ledger.initialBodyAngularMomentumAboutOriginKgM2PerS,
        ledger.exhaustAngularMomentumAboutOriginKgM2PerS,
      ),
      ledger.internalAngularMomentumExchangeInertialKgM2PerS,
    ),
    ledger.numericalAngularResidualKgM2PerS,
  );
  const angularResidual = subtract(currentAngular, expectedAngular);
  return {
    bodyLinearMomentumKgMPerS: currentLinear,
    expectedBodyLinearMomentumKgMPerS: expectedLinear,
    linearClosureResidualKgMPerS: linearResidual,
    linearClosureErrorKgMPerS: magnitude(linearResidual),
    bodyAngularMomentumAboutOriginKgM2PerS: currentAngular,
    expectedBodyAngularMomentumAboutOriginKgM2PerS: expectedAngular,
    angularClosureResidualKgM2PerS: angularResidual,
    angularClosureErrorKgM2PerS: magnitude(angularResidual),
    exhaustLinearMomentumKgMPerS: cloneData(
      ledger.exhaustLinearMomentumKgMPerS,
    ),
    exhaustAngularMomentumAboutOriginKgM2PerS: cloneData(
      ledger.exhaustAngularMomentumAboutOriginKgM2PerS,
    ),
    internalAngularImpulseBodyNms: cloneData(
      ledger.internalAngularImpulseBodyNms,
    ),
    internalAngularMomentumExchangeInertialKgM2PerS: cloneData(
      ledger.internalAngularMomentumExchangeInertialKgM2PerS,
    ),
    thrustImpulseInertialNs: cloneData(ledger.thrustImpulseInertialNs),
    torqueImpulseBodyNms: cloneData(ledger.torqueImpulseBodyNms),
    numericalLinearResidualKgMPerS: cloneData(
      ledger.numericalLinearResidualKgMPerS,
    ),
    numericalAngularResidualKgM2PerS: cloneData(
      ledger.numericalAngularResidualKgM2PerS,
    ),
  };
}

function energyBalanceForSnapshot(
  snapshot: NavigationSnapshot,
): NavigationEnergyBalance {
  const ledger = snapshot.energyLedger;
  const current = bodyMechanicalEnergy(snapshot.body);
  const expected =
    ledger.initialBodyMechanicalEnergyJ +
    ledger.propulsionMechanicalEnergyReleasedJ -
    ledger.exhaustKineticEnergyJ +
    ledger.internalMechanicalEnergyTransferJ +
    ledger.numericalResidualJ;
  return {
    bodyMechanicalEnergyJ: current,
    ledgerExpectedBodyMechanicalEnergyJ: expected,
    closureErrorJ: current - expected,
    idealJetEnergyJ: ledger.idealJetEnergyJ,
    propulsionMechanicalEnergyReleasedJ:
      ledger.propulsionMechanicalEnergyReleasedJ,
    exhaustKineticEnergyJ: ledger.exhaustKineticEnergyJ,
    internalMechanicalEnergyTransferJ:
      ledger.internalMechanicalEnergyTransferJ,
    numericalResidualJ: ledger.numericalResidualJ,
  };
}

export function validateNavigationSnapshot(
  value: unknown,
): asserts value is NavigationSnapshot {
  assertRecord(value, "snapshot");
  assertExactKeys(
    value,
    [
      "snapshotVersion",
      "elapsedMicroseconds",
      "revision",
      "frameEpoch",
      "anchorCompletedDistanceLightYears",
      "body",
      "thrusters",
      "commands",
      "nextCommandSequence",
      "sensors",
      "momentumLedger",
      "energyLedger",
      "propulsion",
    ],
    "snapshot",
  );
  if (value.snapshotVersion !== NAVIGATION_SNAPSHOT_VERSION) {
    throw new Error(
      `unsupported navigation snapshot version: ${String(value.snapshotVersion)}`,
    );
  }
  assertSafeInteger(value.elapsedMicroseconds, "snapshot.elapsedMicroseconds");
  assertSafeInteger(value.revision, "snapshot.revision");
  assertSafeInteger(value.frameEpoch, "snapshot.frameEpoch");
  assertNonNegative(
    value.anchorCompletedDistanceLightYears,
    "snapshot.anchorCompletedDistanceLightYears",
  );
  validateBody(value.body, "snapshot.body");

  if (!Array.isArray(value.thrusters)) {
    throw new TypeError("snapshot.thrusters must be an array");
  }
  if (value.thrusters.length !== THRUSTER_SPECIFICATIONS.length) {
    throw new Error(
      `snapshot.thrusters must contain exactly ${THRUSTER_SPECIFICATIONS.length} entities`,
    );
  }
  for (const [index, specification] of THRUSTER_SPECIFICATIONS.entries()) {
    validateThruster(
      value.thrusters[index],
      specification,
      `snapshot.thrusters[${index}]`,
    );
  }

  if (!Array.isArray(value.commands)) {
    throw new TypeError("snapshot.commands must be an array");
  }
  if (value.commands.length > MAX_COMMANDS) {
    throw new RangeError(`snapshot.commands exceeds ${MAX_COMMANDS} entries`);
  }
  const commandIds = new Set<string>();
  for (const [index, command] of value.commands.entries()) {
    validateCommand(command, index);
    const typed = command as ThrusterCommand;
    if (typed.sequence !== index + 1) {
      throw new Error("snapshot.commands sequences must be contiguous and ordered");
    }
    if (commandIds.has(typed.id)) {
      throw new Error(`duplicate navigation command id: ${typed.id}`);
    }
    commandIds.add(typed.id);
  }
  assertSafeInteger(
    value.nextCommandSequence,
    "snapshot.nextCommandSequence",
    1,
  );
  if (value.nextCommandSequence !== value.commands.length + 1) {
    throw new Error("snapshot.nextCommandSequence does not follow command history");
  }

  if (!Array.isArray(value.sensors)) {
    throw new TypeError("snapshot.sensors must be an array");
  }
  if (value.sensors.length !== SENSOR_SPECIFICATIONS.length) {
    throw new Error(
      `snapshot.sensors must contain exactly ${SENSOR_SPECIFICATIONS.length} entities`,
    );
  }
  for (const [index, specification] of SENSOR_SPECIFICATIONS.entries()) {
    validateSensor(
      value.sensors[index],
      specification,
      value.elapsedMicroseconds as number,
      value.frameEpoch as number,
      `snapshot.sensors[${index}]`,
    );
  }

  validateMomentumLedger(value.momentumLedger, "snapshot.momentumLedger");
  validateEnergyLedger(value.energyLedger, "snapshot.energyLedger");
  validateFusionTorchPropulsion(
    value.propulsion,
    "snapshot.propulsion",
  );

  const typed = value as unknown as NavigationSnapshot;
  const hasPropulsionFuel =
    typed.body.propellantMassKg > 0 &&
    typed.propulsion.fusionFuelMassKg > 0;
  for (const thruster of typed.thrusters) {
    const expected = expectedThrusterOutput(
      thruster,
      typed.commands,
      typed.elapsedMicroseconds,
      hasPropulsionFuel,
    );
    assertClose(
      thruster.lastCommandedThrottleFraction,
      expected.lastCommandedThrottleFraction,
      1e-13,
      1e-13,
      `${thruster.id}.lastCommandedThrottleFraction`,
    );
    assertClose(
      thruster.lastActualThrottleFraction,
      expected.lastActualThrottleFraction,
      1e-13,
      1e-13,
      `${thruster.id}.lastActualThrottleFraction`,
    );
    assertClose(
      thruster.lastThrustN,
      expected.lastThrustN,
      1e-13,
      1e-8,
      `${thruster.id}.lastThrustN`,
    );
    assertClose(
      thruster.lastMassFlowKgPerS,
      expected.lastMassFlowKgPerS,
      1e-13,
      1e-12,
      `${thruster.id}.lastMassFlowKgPerS`,
    );
  }

  const momentum = momentumBalanceForSnapshot(typed);
  assertVectorClose(
    momentum.bodyLinearMomentumKgMPerS,
    momentum.expectedBodyLinearMomentumKgMPerS,
    VECTOR_CLOSURE_RELATIVE_TOLERANCE,
    1e-5,
    "snapshot linear momentum ledger",
  );
  assertVectorClose(
    momentum.bodyAngularMomentumAboutOriginKgM2PerS,
    momentum.expectedBodyAngularMomentumAboutOriginKgM2PerS,
    VECTOR_CLOSURE_RELATIVE_TOLERANCE,
    1e-3,
    "snapshot angular momentum ledger",
  );
  const energy = energyBalanceForSnapshot(typed);
  assertClose(
    energy.bodyMechanicalEnergyJ,
    energy.ledgerExpectedBodyMechanicalEnergyJ,
    ENERGY_CLOSURE_RELATIVE_TOLERANCE,
    1e-3,
    "snapshot energy ledger",
  );
}

export class RigidBodyNavigation {
  private stateValue: NavigationSnapshot;

  constructor(options: RigidBodyNavigationOptions = {}) {
    this.stateValue = createBaselineNavigationSnapshot(options);
    this.updateThrusterOutputs();
    this.sampleDueSensors();
    this.deliverAvailableReadings();
    validateNavigationSnapshot(this.stateValue);
  }

  get elapsedMicroseconds(): number {
    return this.stateValue.elapsedMicroseconds;
  }

  get elapsedSeconds(): number {
    return this.stateValue.elapsedMicroseconds /
      NAVIGATION_MICROSECONDS_PER_SECOND;
  }

  get revision(): number {
    return this.stateValue.revision;
  }

  getBodyState(): NavigationRigidBody {
    return cloneData(this.stateValue.body);
  }

  getCurrentInertiaDiagonal(): DiagonalInertiaTensor {
    return currentInertia(this.stateValue.body);
  }

  listThrusters(): FixedThruster[] {
    return cloneData(this.stateValue.thrusters);
  }

  getThruster(thrusterId: ThrusterId): FixedThruster {
    return cloneData(findById(this.stateValue.thrusters, thrusterId, "thruster"));
  }

  listCommands(): ThrusterCommand[] {
    return cloneData(this.stateValue.commands);
  }

  listSensors(): NavigationSensor[] {
    return cloneData(this.stateValue.sensors);
  }

  getSensorReading(
    sensorId: NavigationSensorId,
  ): NavigationSensorReading | null {
    const sensor = findById(
      this.stateValue.sensors,
      sensorId,
      "navigation sensor",
    );
    return sensor.latest ? cloneData(sensor.latest) : null;
  }

  getMomentumBalance(): NavigationMomentumBalance {
    return momentumBalanceForSnapshot(this.stateValue);
  }

  getEnergyBalance(): NavigationEnergyBalance {
    return energyBalanceForSnapshot(this.stateValue);
  }

  getSummary(): NavigationSummary {
    const body = this.stateValue.body;
    const momentum = this.getMomentumBalance();
    const energy = this.getEnergyBalance();
    const totalThrustN = this.stateValue.thrusters.reduce(
      (total, thruster) => total + thruster.lastThrustN,
      0,
    );
    return {
      frameEpoch: this.stateValue.frameEpoch,
      anchorCompletedDistanceLightYears:
        this.stateValue.anchorCompletedDistanceLightYears,
      elapsedSeconds: this.elapsedSeconds,
      totalMassKg: totalMass(body),
      propellantMassKg: body.propellantMassKg,
      fusionFuelMassKg:
        this.stateValue.propulsion.fusionFuelMassKg,
      fusionEnergyReleasedJ:
        this.stateValue.propulsion.energyLedger
          .fusionEnergyReleasedJ,
      retainedWasteHeatJ:
        this.stateValue.propulsion.energyLedger
          .retainedWasteHeatJ,
      directExportEnergyJ:
        this.stateValue.propulsion.energyLedger
          .directExportEnergyJ,
      controlEnergyRequestedJ:
        this.stateValue.propulsion.energyLedger
          .controlEnergyRequestedJ,
      controlEnergyServedJ:
        this.stateValue.propulsion.energyLedger
          .controlEnergyServedJ,
      positionM: cloneData(body.positionM),
      velocityMPerS: cloneData(body.velocityMPerS),
      speedMPerS: magnitude(body.velocityMPerS),
      orientationBodyToInertial: cloneData(body.orientationBodyToInertial),
      angularVelocityBodyRadPerS: cloneData(
        body.angularVelocityBodyRadPerS,
      ),
      angularSpeedRadPerS: magnitude(body.angularVelocityBodyRadPerS),
      currentInertiaDiagonalKgM2: currentInertia(body),
      activeThrusterCount: this.stateValue.thrusters.filter(
        (thruster) => thruster.lastThrustN > 0,
      ).length,
      totalThrustN,
      instantaneousAccelerationMPerS2: totalThrustN / totalMass(body),
      linearMomentumClosureErrorKgMPerS:
        momentum.linearClosureErrorKgMPerS,
      angularMomentumClosureErrorKgM2PerS:
        momentum.angularClosureErrorKgM2PerS,
      energyClosureErrorJ: energy.closureErrorJ,
    };
  }

  previewPropulsionControlInterval(
    simulatedSeconds: number,
  ): PropulsionControlPreview {
    assertNonNegative(simulatedSeconds, "simulatedSeconds");
    const durationMicroseconds = Math.round(
      simulatedSeconds * NAVIGATION_MICROSECONDS_PER_SECOND,
    );
    assertSafeInteger(
      durationMicroseconds,
      "propulsion control preview duration",
    );
    const fromMicroseconds = this.stateValue.elapsedMicroseconds;
    const toMicroseconds = fromMicroseconds + durationMicroseconds;
    assertSafeInteger(
      toMicroseconds,
      "propulsion control preview target",
    );
    const requestedEnergyJByTrain: Record<
      PropulsionControlTrainId,
      number
    > = {
      "propulsion-control-a": 0,
      "propulsion-control-b": 0,
    };
    const hasFuel =
      this.stateValue.body.propellantMassKg > 0 &&
      this.stateValue.propulsion.fusionFuelMassKg > 0;
    let hasTorchActivity = false;

    for (const thruster of this.stateValue.thrusters) {
      if (thruster.condition === "stuck-on" && hasFuel) {
        hasTorchActivity = true;
        continue;
      }
      if (
        !hasFuel ||
        thruster.condition === "stuck-off" ||
        durationMicroseconds === 0
      ) {
        continue;
      }
      const boundaries = new Set<number>([
        fromMicroseconds,
        toMicroseconds,
      ]);
      for (const command of this.stateValue.commands) {
        if (command.thrusterId !== thruster.id) continue;
        for (const boundary of [
          command.startsAtMicroseconds,
          command.endsAtMicroseconds,
          command.canceledAtMicroseconds,
        ]) {
          if (
            boundary !== null &&
            boundary > fromMicroseconds &&
            boundary < toMicroseconds
          ) {
            boundaries.add(boundary);
          }
        }
      }
      const orderedBoundaries = [...boundaries].sort(
        (left, right) => left - right,
      );
      let previousCommand =
        fromMicroseconds > 0
          ? commandAtTime(
              this.stateValue.commands,
              thruster.id,
              fromMicroseconds - 1,
            )
          : undefined;
      for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
        const segmentStart = orderedBoundaries[index];
        const segmentEnd = orderedBoundaries[index + 1];
        const command = commandAtTime(
          this.stateValue.commands,
          thruster.id,
          segmentStart,
        );
        const actual = actualThrottle(
          thruster,
          command?.throttleFraction ?? 0,
          hasFuel,
        );
        if (command && actual > 0) {
          hasTorchActivity = true;
          if (previousCommand?.id !== command.id) {
            requestedEnergyJByTrain[thruster.controlTrainId] +=
              thruster.ignitionEnergyJ;
          }
          requestedEnergyJByTrain[thruster.controlTrainId] +=
            thruster.holdPowerW *
            ((segmentEnd - segmentStart) /
              NAVIGATION_MICROSECONDS_PER_SECOND);
        }
        previousCommand = command;
      }
    }

    return {
      fromMicroseconds,
      toMicroseconds,
      navigationRevision: this.stateValue.revision,
      requestedEnergyJByTrain,
      hasTorchActivity,
    };
  }

  applyPropulsionControlReceipt(
    preview: PropulsionControlPreview,
    servedEnergyJByTrain: Record<
      PropulsionControlTrainId,
      number
    >,
  ): PropulsionControlApplication {
    if (
      preview.fromMicroseconds !== this.stateValue.elapsedMicroseconds ||
      preview.navigationRevision !== this.stateValue.revision ||
      preview.toMicroseconds < preview.fromMicroseconds
    ) {
      throw new Error(
        "propulsion control receipt does not match the current navigation interval",
      );
    }
    const fresh = this.previewPropulsionControlInterval(
      (preview.toMicroseconds - preview.fromMicroseconds) /
        NAVIGATION_MICROSECONDS_PER_SECOND,
    );
    let requestedEnergyJ = 0;
    let servedEnergyJ = 0;
    const serviceFractionByTrain = new Map<
      PropulsionControlTrainId,
      number
    >();
    for (const trainId of PROPULSION_CONTROL_TRAIN_IDS) {
      const requested =
        preview.requestedEnergyJByTrain[trainId];
      const expected =
        fresh.requestedEnergyJByTrain[trainId];
      const served = servedEnergyJByTrain[trainId];
      assertNonNegative(
        requested,
        `preview.requestedEnergyJByTrain.${trainId}`,
      );
      assertClose(
        requested,
        expected,
        ENERGY_CLOSURE_RELATIVE_TOLERANCE,
        1e-6,
        `propulsion control preview ${trainId}`,
      );
      assertNonNegative(
        served,
        `servedEnergyJByTrain.${trainId}`,
      );
      if (served > requested + 1e-6) {
        throw new RangeError(
          `served propulsion control energy exceeds the ${trainId} request`,
        );
      }
      requestedEnergyJ += requested;
      servedEnergyJ += served;
      serviceFractionByTrain.set(
        trainId,
        requested > 0 ? Math.min(1, served / requested) : 1,
      );
    }
    if (fresh.hasTorchActivity !== preview.hasTorchActivity) {
      throw new Error(
        "propulsion control preview activity does not reconcile",
      );
    }

    const next = this.snapshot();
    const terminatedCommandIds: string[] = [];
    for (const command of next.commands) {
      const thruster = findById(
        next.thrusters,
        command.thrusterId,
        "thruster",
      );
      if (thruster.condition === "stuck-on") continue;
      const activeFrom = Math.max(
        preview.fromMicroseconds,
        command.startsAtMicroseconds,
      );
      const activeUntil = Math.min(
        preview.toMicroseconds,
        command.endsAtMicroseconds ?? Number.POSITIVE_INFINITY,
        command.canceledAtMicroseconds ??
          Number.POSITIVE_INFINITY,
      );
      if (activeFrom >= activeUntil) continue;
      const startsInsideInterval =
        command.startsAtMicroseconds >=
          preview.fromMicroseconds &&
        command.startsAtMicroseconds <
          preview.toMicroseconds;
      const minimumServiceFraction = startsInsideInterval
        ? 0.95
        : 0.9;
      if (
        (serviceFractionByTrain.get(thruster.controlTrainId) ?? 0) +
          1e-12 <
        minimumServiceFraction
      ) {
        command.canceledAtMicroseconds = activeFrom;
        terminatedCommandIds.push(command.id);
      }
    }

    if (
      requestedEnergyJ > 0 ||
      servedEnergyJ > 0 ||
      terminatedCommandIds.length > 0
    ) {
      next.propulsion.energyLedger.controlEnergyRequestedJ +=
        requestedEnergyJ;
      next.propulsion.energyLedger.controlEnergyServedJ +=
        servedEnergyJ;
      next.revision += 1;
      this.commitCandidate(next);
    }
    return {
      requestedEnergyJ,
      servedEnergyJ,
      retainedControlHeatJ: servedEnergyJ,
      terminatedCommandIds,
      revision: this.stateValue.revision,
    };
  }

  getNextPropulsionBoundaryMicroseconds(): number | undefined {
    return this.nextCommandBoundary();
  }

  schedulePulse(
    thrusterId: ThrusterId,
    throttleFraction: number,
    durationSeconds: number,
    options: PulseCommandOptions = {},
  ): ThrusterCommand {
    assertFraction(throttleFraction, "throttleFraction");
    assertPositive(durationSeconds, "durationSeconds");
    const durationMicroseconds = Math.round(
      durationSeconds * NAVIGATION_MICROSECONDS_PER_SECOND,
    );
    assertSafeInteger(durationMicroseconds, "pulse duration", 1);
    return this.appendCommand(
      thrusterId,
      throttleFraction,
      "pulse",
      durationMicroseconds,
      options,
    );
  }

  setSustainedThrottle(
    thrusterId: ThrusterId,
    throttleFraction: number,
    options: SustainedCommandOptions = {},
  ): ThrusterCommand {
    assertFraction(throttleFraction, "throttleFraction");
    return this.appendCommand(
      thrusterId,
      throttleFraction,
      "sustained",
      null,
      options,
    );
  }

  private appendCommand(
    thrusterId: ThrusterId,
    throttleFraction: number,
    mode: ThrusterCommandMode,
    durationMicroseconds: number | null,
    options: PulseCommandOptions | SustainedCommandOptions,
  ): ThrusterCommand {
    findById(this.stateValue.thrusters, thrusterId, "thruster");
    if (this.stateValue.commands.length >= MAX_COMMANDS) {
      throw new RangeError(`navigation command history exceeds ${MAX_COMMANDS}`);
    }
    const startDelaySeconds = options.startDelaySeconds ?? 0;
    assertNonNegative(startDelaySeconds, "startDelaySeconds");
    const delayMicroseconds = Math.round(
      startDelaySeconds * NAVIGATION_MICROSECONDS_PER_SECOND,
    );
    assertSafeInteger(delayMicroseconds, "command start delay");
    const startsAtMicroseconds =
      this.stateValue.elapsedMicroseconds + delayMicroseconds;
    assertSafeInteger(startsAtMicroseconds, "command start");
    const sequence = this.stateValue.nextCommandSequence;
    const id = options.commandId ?? `navigation-command-${sequence}`;
    assertNonEmptyString(id, "commandId");
    if (this.stateValue.commands.some((command) => command.id === id)) {
      throw new Error(`duplicate navigation command id: ${id}`);
    }
    const endsAtMicroseconds =
      durationMicroseconds === null
        ? null
        : startsAtMicroseconds + durationMicroseconds;
    if (endsAtMicroseconds !== null) {
      assertSafeInteger(endsAtMicroseconds, "command end");
    }
    const command: ThrusterCommand = {
      id,
      sequence,
      thrusterId,
      mode,
      throttleFraction,
      startsAtMicroseconds,
      endsAtMicroseconds,
      canceledAtMicroseconds: null,
    };
    const next = this.snapshot();
    next.commands.push(command);
    next.nextCommandSequence += 1;
    next.revision += 1;
    this.commitCandidate(next);
    return cloneData(command);
  }

  cancelCommand(commandId: string): ThrusterCommand {
    assertNonEmptyString(commandId, "commandId");
    const command = findById(
      this.stateValue.commands,
      commandId,
      "navigation command",
    );
    if (command.canceledAtMicroseconds !== null) return cloneData(command);
    const next = this.snapshot();
    const nextCommand = findById(
      next.commands,
      commandId,
      "navigation command",
    );
    nextCommand.canceledAtMicroseconds = next.elapsedMicroseconds;
    next.revision += 1;
    this.commitCandidate(next);
    return cloneData(
      findById(this.stateValue.commands, commandId, "navigation command"),
    );
  }

  configureThruster(
    thrusterId: ThrusterId,
    patch: ThrusterPatch,
  ): FixedThruster {
    const next = this.snapshot();
    const thruster = findById(next.thrusters, thrusterId, "thruster");
    Object.assign(thruster, cloneData(patch));
    next.revision += 1;
    this.commitCandidate(next);
    return this.getThruster(thrusterId);
  }

  configureSensor(
    sensorId: NavigationSensorId,
    patch: NavigationSensorPatch,
  ): NavigationSensor {
    const next = this.snapshot();
    const sensor = findById(next.sensors, sensorId, "navigation sensor");
    Object.assign(sensor, cloneData(patch));
    sensor.pending = [];
    sensor.latest = null;
    sensor.nextSampleMicroseconds = next.elapsedMicroseconds;
    sensor.spareNormal = null;
    next.revision += 1;
    this.commitCandidate(next, true);
    return cloneData(
      findById(this.stateValue.sensors, sensorId, "navigation sensor"),
    );
  }

  rebaseLocalFrameAfterJump(
    completedDistanceLightYears: number,
  ): NavigationSummary {
    assertNonNegative(
      completedDistanceLightYears,
      "completedDistanceLightYears",
    );
    if (
      completedDistanceLightYears <
      this.stateValue.anchorCompletedDistanceLightYears
    ) {
      throw new RangeError(
        "navigation frame anchor cannot move backwards",
      );
    }
    const next = this.snapshot();
    next.frameEpoch += 1;
    next.anchorCompletedDistanceLightYears =
      completedDistanceLightYears;
    next.body.positionM = vector();
    next.momentumLedger = {
      initialBodyLinearMomentumKgMPerS:
        bodyLinearMomentum(next.body),
      initialBodyAngularMomentumAboutOriginKgM2PerS:
        bodyAngularMomentumAboutOrigin(next.body),
      exhaustLinearMomentumKgMPerS: vector(),
      exhaustAngularMomentumAboutOriginKgM2PerS: vector(),
      internalAngularImpulseBodyNms: vector(),
      internalAngularMomentumExchangeInertialKgM2PerS: vector(),
      thrustImpulseInertialNs: vector(),
      torqueImpulseBodyNms: vector(),
      numericalLinearResidualKgMPerS: vector(),
      numericalAngularResidualKgM2PerS: vector(),
    };
    next.energyLedger = {
      initialBodyMechanicalEnergyJ:
        bodyMechanicalEnergy(next.body),
      idealJetEnergyJ: 0,
      propulsionMechanicalEnergyReleasedJ: 0,
      exhaustKineticEnergyJ: 0,
      internalMechanicalEnergyTransferJ: 0,
      numericalResidualJ: 0,
    };
    for (const sensor of next.sensors) {
      sensor.pending = [];
      sensor.latest = null;
      sensor.nextSampleMicroseconds =
        next.elapsedMicroseconds;
      sensor.spareNormal = null;
    }
    next.revision += 1;
    this.commitCandidate(next, true);
    return this.getSummary();
  }

  private commitCandidate(
    candidate: NavigationSnapshot,
    resampleSensors = false,
  ): void {
    const previous = this.stateValue;
    this.stateValue = candidate;
    try {
      this.updateThrusterOutputs();
      if (resampleSensors) {
        this.sampleDueSensors();
        this.deliverAvailableReadings();
      }
      validateNavigationSnapshot(this.stateValue);
    } catch (error) {
      this.stateValue = previous;
      throw error;
    }
  }

  /**
   * Applies an angular impulse exchanged with a modeled internal rotor.
   *
   * The impulse changes the carrier rigid body's angular momentum, but it is
   * neither external authority nor exhaust momentum. Keeping it in dedicated
   * momentum and energy ledger terms lets a coupled rotor domain prove the
   * equal-and-opposite exchange instead of hiding it by rebasing the initial
   * state.
   */
  applyInternalAngularMomentumExchangeBody(
    angularImpulseBodyNms: Vector3,
  ): InternalAngularMomentumExchangeResult {
    assertVector(
      angularImpulseBodyNms,
      "internal angular impulse",
    );
    const next = this.snapshot();
    const body = next.body;
    const inertia = currentInertia(body);
    const beforeAngularMomentum =
      bodyAngularMomentumAboutOrigin(body);
    const beforeMechanicalEnergyJ =
      bodyMechanicalEnergy(body);
    const spinAngularMomentumBody = multiplyDiagonal(
      inertia,
      body.angularVelocityBodyRadPerS,
    );
    body.angularVelocityBodyRadPerS = divideDiagonal(
      add(spinAngularMomentumBody, angularImpulseBodyNms),
      inertia,
    );
    if (
      magnitude(body.angularVelocityBodyRadPerS) >
      MAX_SUPPORTED_ANGULAR_SPEED_RAD_PER_S
    ) {
      throw new RangeError(
        "internal angular impulse exceeds supported navigation state limits",
      );
    }

    const actualAngularMomentumChangeInertialKgM2PerS =
      subtract(
        bodyAngularMomentumAboutOrigin(body),
        beforeAngularMomentum,
      );
    const bodyMechanicalEnergyChangeJ =
      bodyMechanicalEnergy(body) - beforeMechanicalEnergyJ;
    next.momentumLedger.internalAngularImpulseBodyNms = add(
      next.momentumLedger.internalAngularImpulseBodyNms,
      angularImpulseBodyNms,
    );
    next.momentumLedger
      .internalAngularMomentumExchangeInertialKgM2PerS = add(
      next.momentumLedger
        .internalAngularMomentumExchangeInertialKgM2PerS,
      actualAngularMomentumChangeInertialKgM2PerS,
    );
    next.energyLedger.internalMechanicalEnergyTransferJ +=
      bodyMechanicalEnergyChangeJ;
    next.revision += 1;
    this.commitCandidate(next);
    return {
      requestedAngularImpulseBodyNms: cloneData(
        angularImpulseBodyNms,
      ),
      actualAngularMomentumChangeInertialKgM2PerS:
        cloneData(
          actualAngularMomentumChangeInertialKgM2PerS,
        ),
      bodyMechanicalEnergyChangeJ,
      revision: next.revision,
    };
  }

  applyExternalMomentumImpulse(
    linearImpulseInertialNs: Vector3,
    angularMomentumChangeAboutOriginKgM2PerS: Vector3,
  ): NavigationSummary {
    assertVector(
      linearImpulseInertialNs,
      "external linear impulse",
    );
    assertVector(
      angularMomentumChangeAboutOriginKgM2PerS,
      "external angular momentum change",
    );
    const next = this.snapshot();
    const body = next.body;
    const massKg = totalMass(body);
    const beforeLinearMomentum = bodyLinearMomentum(body);
    const beforeAngularMomentum =
      bodyAngularMomentumAboutOrigin(body);
    const beforeMechanicalEnergyJ = bodyMechanicalEnergy(body);
    const afterLinearMomentum = add(
      beforeLinearMomentum,
      linearImpulseInertialNs,
    );
    body.velocityMPerS = scale(
      afterLinearMomentum,
      1 / massKg,
    );

    const afterAngularMomentum = add(
      beforeAngularMomentum,
      angularMomentumChangeAboutOriginKgM2PerS,
    );
    const orbitalAngularMomentum = cross(
      body.positionM,
      afterLinearMomentum,
    );
    const spinAngularMomentumInertial = subtract(
      afterAngularMomentum,
      orbitalAngularMomentum,
    );
    const spinAngularMomentumBody = rotateInertialToBody(
      body.orientationBodyToInertial,
      spinAngularMomentumInertial,
    );
    body.angularVelocityBodyRadPerS = divideDiagonal(
      spinAngularMomentumBody,
      currentInertia(body),
    );
    if (
      magnitude(body.velocityMPerS) > MAX_SUPPORTED_SPEED_M_PER_S ||
      magnitude(body.angularVelocityBodyRadPerS) >
        MAX_SUPPORTED_ANGULAR_SPEED_RAD_PER_S
    ) {
      throw new RangeError(
        "external impulse exceeds supported navigation state limits",
      );
    }

    const actualLinearChange = subtract(
      bodyLinearMomentum(body),
      beforeLinearMomentum,
    );
    const actualAngularChange = subtract(
      bodyAngularMomentumAboutOrigin(body),
      beforeAngularMomentum,
    );
    next.momentumLedger.initialBodyLinearMomentumKgMPerS = add(
      next.momentumLedger.initialBodyLinearMomentumKgMPerS,
      actualLinearChange,
    );
    next.momentumLedger
      .initialBodyAngularMomentumAboutOriginKgM2PerS = add(
      next.momentumLedger
        .initialBodyAngularMomentumAboutOriginKgM2PerS,
      actualAngularChange,
    );
    next.energyLedger.initialBodyMechanicalEnergyJ +=
      bodyMechanicalEnergy(body) - beforeMechanicalEnergyJ;
    next.revision += 1;
    this.commitCandidate(next);
    return this.getSummary();
  }

  step(
    simulatedSeconds: number,
    coupledRotorAngularMomentumBodyKgM2PerS: Vector3 =
      ZERO_VECTOR,
  ): NavigationStepResult {
    assertNonNegative(simulatedSeconds, "simulatedSeconds");
    assertVector(
      coupledRotorAngularMomentumBodyKgM2PerS,
      "coupled rotor angular momentum",
    );
    if (
      magnitude(coupledRotorAngularMomentumBodyKgM2PerS) >
      1e15
    ) {
      throw new RangeError(
        "coupled rotor angular momentum exceeds the supported model range",
      );
    }
    const durationMicroseconds = Math.round(
      simulatedSeconds * NAVIGATION_MICROSECONDS_PER_SECOND,
    );
    assertSafeInteger(durationMicroseconds, "step duration");
    const fromMicroseconds = this.stateValue.elapsedMicroseconds;
    const toMicroseconds = fromMicroseconds + durationMicroseconds;
    assertSafeInteger(toMicroseconds, "step target");

    const propellantBefore = this.stateValue.body.propellantMassKg;
    const propulsionBefore = cloneData(
      this.stateValue.propulsion,
    );
    const thrustImpulseBefore = cloneData(
      this.stateValue.momentumLedger.thrustImpulseInertialNs,
    );
    const torqueImpulseBefore = cloneData(
      this.stateValue.momentumLedger.torqueImpulseBodyNms,
    );
    const internalAngularExchangeBefore = cloneData(
      this.stateValue.momentumLedger
        .internalAngularMomentumExchangeInertialKgM2PerS,
    );
    let substeps = 0;

    this.updateThrusterOutputs();
    this.sampleDueSensors();
    this.deliverAvailableReadings();

    while (this.stateValue.elapsedMicroseconds < toMicroseconds) {
      const now = this.stateValue.elapsedMicroseconds;
      const activeDynamics =
        this.stateValue.thrusters.some((thruster) => thruster.lastThrustN > 0) ||
        magnitude(this.stateValue.body.angularVelocityBodyRadPerS) > 1e-12;
      const physicsLimit =
        now +
        (activeDynamics
          ? ACTIVE_PHYSICS_SUBSTEP_MICROSECONDS
          : COAST_PHYSICS_SUBSTEP_MICROSECONDS);
      const nextSample = Math.min(
        ...this.stateValue.sensors.map(
          (sensor) => sensor.nextSampleMicroseconds,
        ),
      );
      const nextAvailability = this.nextPendingAvailability();
      const nextCommandBoundary = this.nextCommandBoundary();
      const fuelDepletionBoundary = this.nextFuelDepletionBoundary();
      const boundaryMicroseconds = Math.min(
        toMicroseconds,
        physicsLimit,
        nextSample > now ? nextSample : Number.POSITIVE_INFINITY,
        nextAvailability !== undefined && nextAvailability > now
          ? nextAvailability
          : Number.POSITIVE_INFINITY,
        nextCommandBoundary !== undefined && nextCommandBoundary > now
          ? nextCommandBoundary
          : Number.POSITIVE_INFINITY,
        fuelDepletionBoundary !== undefined && fuelDepletionBoundary > now
          ? fuelDepletionBoundary
          : Number.POSITIVE_INFINITY,
      );
      if (
        !Number.isFinite(boundaryMicroseconds) ||
        boundaryMicroseconds <= now
      ) {
        throw new Error(
          "navigation scheduler failed to produce a future boundary",
        );
      }
      const deltaSeconds =
        (boundaryMicroseconds - now) /
        NAVIGATION_MICROSECONDS_PER_SECOND;
      this.advancePhysics(
        deltaSeconds,
        coupledRotorAngularMomentumBodyKgM2PerS,
      );
      this.stateValue.elapsedMicroseconds = boundaryMicroseconds;
      substeps += 1;
      this.updateThrusterOutputs();
      this.sampleDueSensors();
      this.deliverAvailableReadings();
    }

    if (durationMicroseconds > 0) this.stateValue.revision += 1;
    validateNavigationSnapshot(this.stateValue);
    const momentum = this.getMomentumBalance();
    const energy = this.getEnergyBalance();
    return {
      fromMicroseconds,
      toMicroseconds,
      simulatedSeconds:
        durationMicroseconds / NAVIGATION_MICROSECONDS_PER_SECOND,
      substeps,
      propellantConsumedKg:
        propellantBefore - this.stateValue.body.propellantMassKg,
      fusionFuelConsumedKg:
        propulsionBefore.fusionFuelMassKg -
        this.stateValue.propulsion.fusionFuelMassKg,
      fusionEnergyReleasedJ:
        this.stateValue.propulsion.energyLedger
          .fusionEnergyReleasedJ -
        propulsionBefore.energyLedger.fusionEnergyReleasedJ,
      retainedWasteHeatJ:
        this.stateValue.propulsion.energyLedger.retainedWasteHeatJ -
        propulsionBefore.energyLedger.retainedWasteHeatJ,
      directExportEnergyJ:
        this.stateValue.propulsion.energyLedger.directExportEnergyJ -
        propulsionBefore.energyLedger.directExportEnergyJ,
      propulsionSourceClosureErrorJ:
        (this.stateValue.propulsion.energyLedger
          .fusionEnergyReleasedJ -
          propulsionBefore.energyLedger.fusionEnergyReleasedJ) -
        ((this.stateValue.propulsion.energyLedger.idealJetEnergyJ -
          propulsionBefore.energyLedger.idealJetEnergyJ) +
          (this.stateValue.propulsion.energyLedger
            .retainedWasteHeatJ -
            propulsionBefore.energyLedger.retainedWasteHeatJ) +
          (this.stateValue.propulsion.energyLedger
            .directExportEnergyJ -
            propulsionBefore.energyLedger.directExportEnergyJ)),
      thrustImpulseInertialNs: subtract(
        this.stateValue.momentumLedger.thrustImpulseInertialNs,
        thrustImpulseBefore,
      ),
      torqueImpulseBodyNms: subtract(
        this.stateValue.momentumLedger.torqueImpulseBodyNms,
        torqueImpulseBefore,
      ),
      internalRotorGyroscopicAngularMomentumExchangeInertialKgM2PerS:
        subtract(
          this.stateValue.momentumLedger
            .internalAngularMomentumExchangeInertialKgM2PerS,
          internalAngularExchangeBefore,
        ),
      linearMomentumClosureErrorKgMPerS:
        momentum.linearClosureErrorKgMPerS,
      angularMomentumClosureErrorKgM2PerS:
        momentum.angularClosureErrorKgM2PerS,
      energyClosureErrorJ: energy.closureErrorJ,
      revision: this.stateValue.revision,
    };
  }

  private advancePhysics(
    deltaSeconds: number,
    coupledRotorAngularMomentumBodyKgM2PerS: Vector3,
  ): PhysicsDelta {
    const body = this.stateValue.body;
    const beforeBody = cloneData(body);
    const beforeLinearMomentum = bodyLinearMomentum(beforeBody);
    const beforeAngularMomentum = bodyAngularMomentumAboutOrigin(beforeBody);
    const beforeMechanicalEnergyJ = bodyMechanicalEnergy(beforeBody);
    const massBeforeKg = totalMass(beforeBody);
    const inertiaBefore = currentInertia(beforeBody);
    const angularMomentumBodyBefore = multiplyDiagonal(
      inertiaBefore,
      beforeBody.angularVelocityBodyRadPerS,
    );
    const rotorAngularMomentumInertialBefore =
      rotateBodyToInertial(
        beforeBody.orientationBodyToInertial,
        coupledRotorAngularMomentumBodyKgM2PerS,
      );

    const requestedPropellantKg = this.stateValue.thrusters.reduce(
      (total, thruster) =>
        total + thruster.lastMassFlowKgPerS * deltaSeconds,
      0,
    );
    const requestedFusionFuelKg = this.stateValue.thrusters.reduce(
      (total, thruster) => {
        const expelledMassKg =
          thruster.lastMassFlowKgPerS * deltaSeconds;
        const exhaustSpeedMPerS =
          thruster.specificImpulseS * STANDARD_GRAVITY_M_PER_S2;
        const idealJetEnergyJ =
          0.5 * expelledMassKg * exhaustSpeedMPerS ** 2;
        return (
          total +
          idealJetEnergyJ /
            thruster.jetConversionEfficiency /
            FUSION_TORCH_SPECIFIC_ENERGY_J_PER_KG
        );
      },
      0,
    );
    const fuelScale = Math.min(
      1,
      requestedPropellantKg > 0
        ? beforeBody.propellantMassKg / requestedPropellantKg
        : 1,
      requestedFusionFuelKg > 0
        ? this.stateValue.propulsion.fusionFuelMassKg /
          requestedFusionFuelKg
        : 1,
    );
    const propellantConsumedKg = requestedPropellantKg * fuelScale;
    const massAfterKg = massBeforeKg - propellantConsumedKg;
    if (!Number.isFinite(massAfterKg) || massAfterKg <= 0) {
      throw new Error("navigation mass left its supported range");
    }

    const estimatedAngularVelocityMid = beforeBody.angularVelocityBodyRadPerS;
    const midpointOrientation = normalizeQuaternion(
      quaternionMultiply(
        beforeBody.orientationBodyToInertial,
        quaternionFromAngularVelocity(
          estimatedAngularVelocityMid,
          deltaSeconds * 0.5,
        ),
      ),
    );

    let totalImpulseInertial = vector();
    let totalTorqueBody = vector();
    let totalTorqueImpulseBody = vector();
    let idealJetEnergyJ = 0;
    let exhaustKineticEnergyJ = 0;
    let fusionEnergyReleasedJ = 0;
    let retainedWasteHeatJ = 0;
    let directExportEnergyJ = 0;

    for (const thruster of this.stateValue.thrusters) {
      const thrustN = thruster.lastThrustN * fuelScale;
      if (thrustN <= 0) continue;
      const forceBody = scale(thruster.forceDirectionBody, thrustN);
      const forceInertial = rotateBodyToInertial(
        midpointOrientation,
        forceBody,
      );
      const impulseInertial = scale(forceInertial, deltaSeconds);
      totalImpulseInertial = add(totalImpulseInertial, impulseInertial);
      const torqueBody = cross(thruster.positionBodyM, forceBody);
      totalTorqueBody = add(totalTorqueBody, torqueBody);
      totalTorqueImpulseBody = add(
        totalTorqueImpulseBody,
        scale(torqueBody, deltaSeconds),
      );

      const expelledMassKg =
        thruster.lastMassFlowKgPerS * deltaSeconds * fuelScale;
      if (expelledMassKg > 0) {
        const exhaustSpeedMPerS =
          thruster.specificImpulseS * STANDARD_GRAVITY_M_PER_S2;
        const exhaustVelocityInertial = subtract(
          beforeBody.velocityMPerS,
          scale(
            rotateBodyToInertial(
              midpointOrientation,
              thruster.forceDirectionBody,
            ),
            exhaustSpeedMPerS,
          ),
        );
        const thrusterIdealJetEnergyJ =
          0.5 * expelledMassKg * exhaustSpeedMPerS ** 2;
        const thrusterFusionEnergyJ =
          thrusterIdealJetEnergyJ /
          thruster.jetConversionEfficiency;
        const conversionLossJ =
          thrusterFusionEnergyJ - thrusterIdealJetEnergyJ;
        const thrusterRetainedWasteHeatJ =
          conversionLossJ * thruster.retainedLossFraction;
        idealJetEnergyJ += thrusterIdealJetEnergyJ;
        fusionEnergyReleasedJ += thrusterFusionEnergyJ;
        retainedWasteHeatJ += thrusterRetainedWasteHeatJ;
        directExportEnergyJ +=
          conversionLossJ - thrusterRetainedWasteHeatJ;
        exhaustKineticEnergyJ +=
          0.5 * expelledMassKg * magnitudeSquared(exhaustVelocityInertial);
      }
    }

    const velocityDelta =
      massAfterKg > 0
        ? scale(totalImpulseInertial, 1 / massAfterKg)
        : vector();
    body.positionM = add(
      beforeBody.positionM,
      add(
        scale(beforeBody.velocityMPerS, deltaSeconds),
        scale(velocityDelta, 0.5 * deltaSeconds),
      ),
    );
    body.velocityMPerS = add(beforeBody.velocityMPerS, velocityDelta);
    body.propellantMassKg = Math.max(
      0,
      beforeBody.propellantMassKg - propellantConsumedKg,
    );

    const gyroscopicTerm = cross(
      beforeBody.angularVelocityBodyRadPerS,
      add(
        angularMomentumBodyBefore,
        coupledRotorAngularMomentumBodyKgM2PerS,
      ),
    );
    const angularMomentumBodyAfter = add(
      angularMomentumBodyBefore,
      scale(subtract(totalTorqueBody, gyroscopicTerm), deltaSeconds),
    );
    const inertiaAfter = currentInertia(body);
    body.angularVelocityBodyRadPerS = divideDiagonal(
      angularMomentumBodyAfter,
      inertiaAfter,
    );
    const averageAngularVelocity = scale(
      add(
        beforeBody.angularVelocityBodyRadPerS,
        body.angularVelocityBodyRadPerS,
      ),
      0.5,
    );
    body.orientationBodyToInertial = normalizeQuaternion(
      quaternionMultiply(
        beforeBody.orientationBodyToInertial,
        quaternionFromAngularVelocity(
          averageAngularVelocity,
          deltaSeconds,
        ),
      ),
    );

    const afterLinearMomentum = bodyLinearMomentum(body);
    const afterAngularMomentum = bodyAngularMomentumAboutOrigin(body);
    const rotorAngularMomentumInertialAfter =
      rotateBodyToInertial(
        body.orientationBodyToInertial,
        coupledRotorAngularMomentumBodyKgM2PerS,
      );
    const rotorGyroscopicReactionInertial = scale(
      subtract(
        rotorAngularMomentumInertialAfter,
        rotorAngularMomentumInertialBefore,
      ),
      -1,
    );
    const afterMechanicalEnergyJ = bodyMechanicalEnergy(body);
    const propulsionWasActive = propellantConsumedKg > 0;
    const exhaustLinearMomentum = propulsionWasActive
      ? subtract(beforeLinearMomentum, afterLinearMomentum)
      : vector();
    const exhaustAngularMomentum = propulsionWasActive
      ? subtract(beforeAngularMomentum, afterAngularMomentum)
      : vector();
    const propulsionMechanicalEnergyReleasedJ = propulsionWasActive
      ? afterMechanicalEnergyJ +
        exhaustKineticEnergyJ -
        beforeMechanicalEnergyJ
      : 0;
    const momentumLedger = this.stateValue.momentumLedger;
    momentumLedger.exhaustLinearMomentumKgMPerS = add(
      momentumLedger.exhaustLinearMomentumKgMPerS,
      exhaustLinearMomentum,
    );
    momentumLedger.exhaustAngularMomentumAboutOriginKgM2PerS = add(
      momentumLedger.exhaustAngularMomentumAboutOriginKgM2PerS,
      exhaustAngularMomentum,
    );
    momentumLedger.thrustImpulseInertialNs = add(
      momentumLedger.thrustImpulseInertialNs,
      totalImpulseInertial,
    );
    momentumLedger.torqueImpulseBodyNms = add(
      momentumLedger.torqueImpulseBodyNms,
      totalTorqueImpulseBody,
    );
    momentumLedger
      .internalAngularMomentumExchangeInertialKgM2PerS = add(
      momentumLedger
        .internalAngularMomentumExchangeInertialKgM2PerS,
      rotorGyroscopicReactionInertial,
    );
    momentumLedger.internalAngularImpulseBodyNms = add(
      momentumLedger.internalAngularImpulseBodyNms,
      rotateInertialToBody(
        midpointOrientation,
        rotorGyroscopicReactionInertial,
      ),
    );
    momentumLedger.numericalLinearResidualKgMPerS = subtract(
      afterLinearMomentum,
      subtract(
        momentumLedger.initialBodyLinearMomentumKgMPerS,
        momentumLedger.exhaustLinearMomentumKgMPerS,
      ),
    );
    momentumLedger.numericalAngularResidualKgM2PerS = subtract(
      afterAngularMomentum,
      add(
        subtract(
          momentumLedger
            .initialBodyAngularMomentumAboutOriginKgM2PerS,
          momentumLedger
            .exhaustAngularMomentumAboutOriginKgM2PerS,
        ),
        momentumLedger
          .internalAngularMomentumExchangeInertialKgM2PerS,
      ),
    );

    const energyLedger = this.stateValue.energyLedger;
    energyLedger.idealJetEnergyJ += idealJetEnergyJ;
    energyLedger.propulsionMechanicalEnergyReleasedJ +=
      propulsionMechanicalEnergyReleasedJ;
    energyLedger.exhaustKineticEnergyJ += exhaustKineticEnergyJ;
    // Rebase the cumulative floating-point residual instead of summing local
    // round-off. This keeps the saved ledger self-reconciling even after many
    // microsteps while leaving the physical terms untouched.
    energyLedger.numericalResidualJ =
      afterMechanicalEnergyJ -
      (energyLedger.initialBodyMechanicalEnergyJ +
        energyLedger.propulsionMechanicalEnergyReleasedJ -
        energyLedger.exhaustKineticEnergyJ +
        energyLedger.internalMechanicalEnergyTransferJ);

    const propulsionLedger =
      this.stateValue.propulsion.energyLedger;
    propulsionLedger.fusionEnergyReleasedJ +=
      fusionEnergyReleasedJ;
    propulsionLedger.idealJetEnergyJ += idealJetEnergyJ;
    propulsionLedger.retainedWasteHeatJ +=
      retainedWasteHeatJ;
    propulsionLedger.directExportEnergyJ += directExportEnergyJ;
    propulsionLedger.fusionFuelConsumedKg =
      propulsionLedger.fusionEnergyReleasedJ /
      FUSION_TORCH_SPECIFIC_ENERGY_J_PER_KG;
    this.stateValue.propulsion.fusionFuelMassKg = Math.max(
      0,
      this.stateValue.propulsion.initialFusionFuelMassKg -
        propulsionLedger.fusionFuelConsumedKg,
    );

    if (
      magnitude(body.velocityMPerS) > MAX_SUPPORTED_SPEED_M_PER_S ||
      magnitude(body.angularVelocityBodyRadPerS) >
        MAX_SUPPORTED_ANGULAR_SPEED_RAD_PER_S
    ) {
      throw new RangeError("navigation state exceeded the supported speed limit");
    }
    return {
      propellantConsumedKg,
      fusionFuelConsumedKg:
        fusionEnergyReleasedJ /
        FUSION_TORCH_SPECIFIC_ENERGY_J_PER_KG,
      fusionEnergyReleasedJ,
      retainedWasteHeatJ,
      directExportEnergyJ,
      thrustImpulseInertialNs: totalImpulseInertial,
      torqueImpulseBodyNms: totalTorqueImpulseBody,
    };
  }

  private updateThrusterOutputs(): void {
    const hasPropellant =
      this.stateValue.body.propellantMassKg > 0 &&
      this.stateValue.propulsion.fusionFuelMassKg > 0;
    for (const thruster of this.stateValue.thrusters) {
      Object.assign(
        thruster,
        expectedThrusterOutput(
          thruster,
          this.stateValue.commands,
          this.stateValue.elapsedMicroseconds,
          hasPropellant,
        ),
      );
    }
  }

  private nextCommandBoundary(): number | undefined {
    const now = this.stateValue.elapsedMicroseconds;
    let next: number | undefined;
    for (const command of this.stateValue.commands) {
      for (const boundary of [
        command.startsAtMicroseconds,
        command.endsAtMicroseconds,
        command.canceledAtMicroseconds,
      ]) {
        if (
          boundary !== null &&
          boundary > now &&
          (next === undefined || boundary < next)
        ) {
          next = boundary;
        }
      }
    }
    return next;
  }

  private nextFuelDepletionBoundary(): number | undefined {
    if (
      this.stateValue.body.propellantMassKg <= 0 ||
      this.stateValue.propulsion.fusionFuelMassKg <= 0
    ) {
      return undefined;
    }
    const totalMassFlowKgPerS = this.stateValue.thrusters.reduce(
      (total, thruster) => total + thruster.lastMassFlowKgPerS,
      0,
    );
    if (totalMassFlowKgPerS <= 0) return undefined;
    const totalFusionFuelFlowKgPerS =
      this.stateValue.thrusters.reduce((total, thruster) => {
        const exhaustSpeedMPerS =
          thruster.specificImpulseS * STANDARD_GRAVITY_M_PER_S2;
        const idealJetPowerW =
          0.5 *
          thruster.lastMassFlowKgPerS *
          exhaustSpeedMPerS ** 2;
        return (
          total +
          idealJetPowerW /
            thruster.jetConversionEfficiency /
            FUSION_TORCH_SPECIFIC_ENERGY_J_PER_KG
        );
      }, 0);
    const secondsUntilPropellantDepletion =
      this.stateValue.body.propellantMassKg /
      totalMassFlowKgPerS;
    const secondsUntilFusionFuelDepletion =
      totalFusionFuelFlowKgPerS > 0
        ? this.stateValue.propulsion.fusionFuelMassKg /
          totalFusionFuelFlowKgPerS
        : Number.POSITIVE_INFINITY;
    const remainingMicroseconds = Math.max(
      1,
      Math.round(
        Math.min(
          secondsUntilPropellantDepletion,
          secondsUntilFusionFuelDepletion,
        ) *
          NAVIGATION_MICROSECONDS_PER_SECOND,
      ),
    );
    const boundary =
      this.stateValue.elapsedMicroseconds + remainingMicroseconds;
    assertSafeInteger(boundary, "fuel depletion boundary");
    return boundary;
  }

  private sensorTruth(sensor: NavigationSensor): number {
    const body = this.stateValue.body;
    switch (sensor.quantity) {
      case "positionX":
        return body.positionM.x;
      case "positionY":
        return body.positionM.y;
      case "positionZ":
        return body.positionM.z;
      case "velocityX":
        return body.velocityMPerS.x;
      case "velocityY":
        return body.velocityMPerS.y;
      case "velocityZ":
        return body.velocityMPerS.z;
      case "attitudeW":
        return body.orientationBodyToInertial.w;
      case "attitudeX":
        return body.orientationBodyToInertial.x;
      case "attitudeY":
        return body.orientationBodyToInertial.y;
      case "attitudeZ":
        return body.orientationBodyToInertial.z;
      case "angularVelocityX":
        return body.angularVelocityBodyRadPerS.x;
      case "angularVelocityY":
        return body.angularVelocityBodyRadPerS.y;
      case "angularVelocityZ":
        return body.angularVelocityBodyRadPerS.z;
      case "propellantMass":
        return body.propellantMassKg;
      case "fusionFuelMass":
        return this.stateValue.propulsion.fusionFuelMassKg;
    }
  }

  private createSensorReading(
    sensor: NavigationSensor,
    sampledAtMicroseconds: number,
  ): NavigationSensorReading {
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
      const noiseMultiplier = sensor.condition === "degraded" ? 4 : 1;
      value =
        truth +
        sensor.bias +
        sensor.driftPerSecond *
          (sampledAtMicroseconds /
            NAVIGATION_MICROSECONDS_PER_SECOND) +
        nextNormal(sensor) *
          sensor.noiseStandardDeviation *
          noiseMultiplier;
    }
    return {
      sensorId: sensor.id,
      quantity: sensor.quantity,
      frameEpoch: this.stateValue.frameEpoch,
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
        const reading = this.createSensorReading(
          sensor,
          sensor.nextSampleMicroseconds,
        );
        assertSafeInteger(
          reading.availableAtMicroseconds,
          `${sensor.id} reading availability`,
        );
        sensor.pending.push(reading);
        sensor.nextSampleMicroseconds += sensor.sampleIntervalMicroseconds;
        assertSafeInteger(
          sensor.nextSampleMicroseconds,
          `${sensor.id}.nextSampleMicroseconds`,
        );
      }
    }
  }

  private deliverAvailableReadings(): void {
    const now = this.stateValue.elapsedMicroseconds;
    for (const sensor of this.stateValue.sensors) {
      let latest: NavigationSensorReading | null = null;
      while (
        sensor.pending.length > 0 &&
        sensor.pending[0].availableAtMicroseconds <= now
      ) {
        latest = sensor.pending.shift() as NavigationSensorReading;
      }
      if (latest) sensor.latest = latest;
    }
  }

  private nextPendingAvailability(): number | undefined {
    let next: number | undefined;
    for (const sensor of this.stateValue.sensors) {
      const availableAtMicroseconds =
        sensor.pending[0]?.availableAtMicroseconds;
      if (
        availableAtMicroseconds !== undefined &&
        (next === undefined || availableAtMicroseconds < next)
      ) {
        next = availableAtMicroseconds;
      }
    }
    return next;
  }

  snapshot(): NavigationSnapshot {
    return cloneData(this.stateValue);
  }

  serialize(): string {
    return JSON.stringify(this.stateValue);
  }

  static restore(
    source: string | NavigationSnapshot,
  ): RigidBodyNavigation {
    const parsed: unknown =
      typeof source === "string" ? JSON.parse(source) : cloneData(source);
    validateNavigationSnapshot(parsed);
    const restored = new RigidBodyNavigation({ seed: 0 });
    restored.stateValue = cloneData(parsed);
    return restored;
  }
}
