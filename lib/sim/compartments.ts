/**
 * Deterministic 48-zone atmosphere-network vertical slice.
 *
 * Reduced-order assumptions:
 * - every pressure zone is perfectly mixed at one gas temperature;
 * - pressure follows the ideal-gas law for four tracked species;
 * - pressure-driven edge and breach flow uses an incompressible orifice
 *   approximation, capped per fixed substep for numerical stability;
 * - symmetric exchange represents unresolved turbulence/diffusion through an
 *   open connection;
 * - gas sensible energy uses one constant heat capacity. Wall heat capacity,
 *   humidity condensation and compressible choking belong to the later thermal
 *   and fluid-network models.
 *
 * Despite those simplifications, every internal parcel is removed from one
 * zone and added to another species-by-species. Breach discharge enters an
 * explicit sink, and metabolic atmosphere exchange has its own ledger.
 */

export const COMPARTMENT_COUNT = 48 as const;
export const COMPARTMENT_SNAPSHOT_VERSION = 3 as const;
export const MICROSECONDS_PER_SECOND = 1_000_000;

export const GAS_SPECIES = [
  "oxygen",
  "nitrogen",
  "carbonDioxide",
  "waterVapor",
] as const;

export type GasSpecies = (typeof GAS_SPECIES)[number];
export type ZoneId = `A-${string}` | `B-${string}`;
export const AIR_HANDLER_IDS = [
  "air-handler-a",
  "air-handler-b",
] as const;
export type AirHandlerId = (typeof AIR_HANDLER_IDS)[number];
export type AirHandlerRing = "A" | "B";
export type AirHandlerCondition =
  | "nominal"
  | "degraded"
  | "stuck-off";
export type ConnectionKind = "door" | "duct" | "isolation-valve";
export type ConnectionCondition =
  | "nominal"
  | "degraded"
  | "stuck-closed"
  | "stuck-open";
export type SensorQuantity =
  | "pressurePa"
  | "temperatureK"
  | "oxygenPartialPressurePa"
  | "carbonDioxidePartialPressurePa";
export type SensorCondition = "nominal" | "degraded" | "stuck" | "offline";
export type SensorQuality = SensorCondition;
export type AtmosphereFidelityMode =
  | "equilibrium-fast"
  | "transient-fine"
  | "mixed";

export interface GasMassesKg {
  oxygen: number;
  nitrogen: number;
  carbonDioxide: number;
  waterVapor: number;
}

export interface PressureZone {
  id: ZoneId;
  volumeCubicMeters: number;
  temperatureK: number;
  gasesKg: GasMassesKg;
  awakeOccupants: number;
}

export interface AtmosphereConnection {
  id: string;
  kind: ConnectionKind;
  zoneAId: ZoneId;
  zoneBId: ZoneId;
  areaSquareMeters: number;
  dischargeCoefficient: number;
  commandedOpenFraction: number;
  condition: ConnectionCondition;
  mixingConductanceCubicMetersPerSecond: number;
  maxMassFlowKgPerSecond: number;
  lastForwardGrossMassFlowKgPerSecond: number;
  lastReverseGrossMassFlowKgPerSecond: number;
  lastSignedMassFlowKgPerSecond: number;
}

export interface HullBreach {
  id: string;
  zoneId: ZoneId;
  areaSquareMeters: number;
  dischargeCoefficient: number;
}

export interface SensorReading {
  sensorId: string;
  zoneId: ZoneId;
  quantity: SensorQuantity;
  sampledAtMicroseconds: number;
  availableAtMicroseconds: number;
  value: number | null;
  quality: SensorQuality;
}

export interface AtmosphereSensor {
  id: string;
  zoneId: ZoneId;
  quantity: SensorQuantity;
  sampleIntervalMicroseconds: number;
  delayMicroseconds: number;
  noiseStandardDeviation: number;
  bias: number;
  driftPerSecond: number;
  condition: SensorCondition;
  stuckValue: number | null;
  nextSampleMicroseconds: number;
  randomState: number;
  spareNormal: number | null;
  pending: SensorReading[];
  latest: SensorReading | null;
}

export interface AtmosphereSink {
  ventedGasesKg: GasMassesKg;
  ventedThermalEnergyJ: number;
}

export interface AirHandler {
  id: AirHandlerId;
  ring: AirHandlerRing;
  servedZoneIds: ZoneId[];
  commandedFlowFraction: number;
  scrubberEnabled: boolean;
  condition: AirHandlerCondition;
  electricalServiceFraction: number;
  actualFlowFraction: number;
  carbonDioxideSetpointPa: number;
  ratedCarbonDioxideCaptureKgPerSecond: number;
  cumulativeCapturedCarbonDioxideKg: number;
  lastCapturedCarbonDioxideKg: number;
}

export interface MetabolicExchangeLedger {
  oxygenConsumedKg: number;
  carbonDioxideProducedKg: number;
  waterVaporProducedKg: number;
  sensibleHeatAddedJ: number;
}

export interface CompartmentNetworkSnapshot {
  snapshotVersion: typeof COMPARTMENT_SNAPSHOT_VERSION;
  metabolicHeatAuthority: MetabolicHeatAuthority;
  elapsedMicroseconds: number;
  revision: number;
  zones: PressureZone[];
  connections: AtmosphereConnection[];
  airHandlers: AirHandler[];
  breaches: HullBreach[];
  sensors: AtmosphereSensor[];
  sink: AtmosphereSink;
  metabolism: MetabolicExchangeLedger;
}

export interface ZoneTruth {
  zoneId: ZoneId;
  totalGasMassKg: number;
  densityKgPerCubicMeter: number;
  pressurePa: number;
  temperatureK: number;
  partialPressuresPa: GasMassesKg;
}

export interface CompartmentStepResult {
  fromMicroseconds: number;
  toMicroseconds: number;
  substeps: number;
  fineSubsteps: number;
  equilibriumIntervals: number;
  fidelityMode: AtmosphereFidelityMode;
  internalTransferredGasesKg: GasMassesKg;
  ventedGasesKg: GasMassesKg;
  metabolicExchange: MetabolicExchangeLedger;
  capturedCarbonDioxideKg: number;
  metabolicHeatTransferredToExternalJ: number;
  revision: number;
}

export interface CompartmentAggregateState {
  volumeCubicMeters: number;
  gasesKg: GasMassesKg;
  pressurePa: number;
  oxygenPartialPressurePa: number;
  carbonDioxidePartialPressurePa: number;
  averageTemperatureK: number;
  awakeOccupants: number;
  ventedGasKg: number;
  leakAreaSquareMeters: number;
}

export interface CompartmentNetworkOptions {
  seed?: number | string;
  metabolicHeatAuthority?: MetabolicHeatAuthority;
}

export type MetabolicHeatAuthority =
  | "zone-gas"
  | "external-network";

export interface CompartmentStepOptions {
  fidelity?: "auto" | "fine";
  externalMetabolicHeatRemovalFraction?: number;
}

export interface CompartmentFidelityRequirement {
  requiresFineSolver: boolean;
  maximumSimulatedSecondsPerStep: number | null;
  reasons: Array<
    | "active-breach"
    | "connection-fault"
    | "sensor-fault-or-long-delay"
    | "pressure-temperature-or-composition-gradient"
  >;
}

export type ConnectionPatch = Partial<
  Pick<
    AtmosphereConnection,
    | "areaSquareMeters"
    | "dischargeCoefficient"
    | "commandedOpenFraction"
    | "condition"
    | "mixingConductanceCubicMetersPerSecond"
    | "maxMassFlowKgPerSecond"
  >
>;

export type AirHandlerPatch = Partial<
  Pick<
    AirHandler,
    "commandedFlowFraction" | "scrubberEnabled" | "condition"
  >
>;

export type SensorPatch = Partial<
  Pick<
    AtmosphereSensor,
    | "sampleIntervalMicroseconds"
    | "delayMicroseconds"
    | "noiseStandardDeviation"
    | "bias"
    | "driftPerSecond"
    | "condition"
    | "stuckValue"
  >
>;

const GAS_CONSTANT_J_PER_KG_K: Readonly<Record<GasSpecies, number>> = {
  oxygen: 259.84,
  nitrogen: 296.8,
  carbonDioxide: 188.92,
  waterVapor: 461.5,
};

const GAS_SPECIFIC_HEAT_J_PER_KG_K = 1_005;
const BASELINE_PRESSURE_PA = 101_325;
const BASELINE_TEMPERATURE_K = 295.15;
const BASELINE_ZONE_VOLUME_CUBIC_METERS = 9_375;
// A one-second step is too coarse for a fully open 1.8 m² pressure door and
// produces alternating overshoot. The fixed 100 ms ceiling keeps the
// reduced-order orifice solve monotonic at baseline ship pressures.
const MAX_PHYSICS_SUBSTEP_MICROSECONDS = 100_000;
const FAST_PATH_MINIMUM_DURATION_MICROSECONDS = MICROSECONDS_PER_SECOND;
const FAST_PATH_RECHECK_MICROSECONDS = MICROSECONDS_PER_SECOND;
const FAST_PRESSURE_RELATIVE_SPREAD = 0.002;
const FAST_TEMPERATURE_SPREAD_K = 0.5;
const FAST_SPECIES_MASS_FRACTION_SPREAD = 0.002;
const MAX_SOURCE_DRAIN_FRACTION_PER_SUBSTEP = 0.25;
const MIN_GAS_MASS_KG = 1e-12;

const OXYGEN_CONSUMPTION_KG_PER_PERSON_SECOND = 8.5e-6;
const CARBON_DIOXIDE_PRODUCTION_KG_PER_PERSON_SECOND = 1e-5;
const WATER_VAPOR_PRODUCTION_KG_PER_PERSON_SECOND = 1.2e-5;
const SENSIBLE_HEAT_W_PER_PERSON = 80;
const AIR_HANDLER_RATED_CARBON_DIOXIDE_CAPTURE_KG_PER_SECOND = 0.09;
const AIR_HANDLER_CARBON_DIOXIDE_SETPOINT_PA = 80;
const DEGRADED_AIR_HANDLER_FLOW_MULTIPLIER = 0.5;

const SENSOR_QUANTITIES: readonly SensorQuantity[] = [
  "pressurePa",
  "temperatureK",
  "oxygenPartialPressurePa",
  "carbonDioxidePartialPressurePa",
];

const SENSOR_UNITS: Readonly<Record<SensorQuantity, string>> = {
  pressurePa: "Pa",
  temperatureK: "K",
  oxygenPartialPressurePa: "Pa",
  carbonDioxidePartialPressurePa: "Pa",
};

function makeZoneId(ring: "A" | "B", index: number): ZoneId {
  return `${ring}-${String(index).padStart(2, "0")}` as ZoneId;
}

export const BASELINE_ZONE_IDS: readonly ZoneId[] = Object.freeze([
  ...Array.from({ length: 24 }, (_, index) => makeZoneId("A", index + 1)),
  ...Array.from({ length: 24 }, (_, index) => makeZoneId("B", index + 1)),
]);

function sensorId(zoneId: ZoneId, quantity: SensorQuantity): string {
  return `sensor:${zoneId}:${quantity}`;
}

const BASELINE_SENSOR_IDS = Object.freeze(
  BASELINE_ZONE_IDS.flatMap((zoneId) =>
    SENSOR_QUANTITIES.map((quantity) => sensorId(zoneId, quantity)),
  ),
);

function zeroGases(): GasMassesKg {
  return {
    oxygen: 0,
    nitrogen: 0,
    carbonDioxide: 0,
    waterVapor: 0,
  };
}

function zeroMetabolism(): MetabolicExchangeLedger {
  return {
    oxygenConsumedKg: 0,
    carbonDioxideProducedKg: 0,
    waterVaporProducedKg: 0,
    sensibleHeatAddedJ: 0,
  };
}

function cloneData<T>(value: T): T {
  return structuredClone(value);
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
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `${label} has unexpected keys: ${actual.join(", ")}`,
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
  if (value < 0) {
    throw new RangeError(`${label} cannot be negative`);
  }
}

function assertPositive(
  value: unknown,
  label: string,
): asserts value is number {
  assertFinite(value, label);
  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero`);
  }
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

function assertSafeMicroseconds(
  value: unknown,
  label: string,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
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

function assertInteger(
  value: unknown,
  label: string,
  minimum = 0,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new RangeError(
      `${label} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
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
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function nextUniform(sensor: AtmosphereSensor): number {
  sensor.randomState = (sensor.randomState + 0x6d2b79f5) >>> 0;
  let value = sensor.randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}

function nextNormal(sensor: AtmosphereSensor): number {
  if (sensor.spareNormal !== null) {
    const spare = sensor.spareNormal;
    sensor.spareNormal = null;
    return spare;
  }
  let first = 0;
  let second = 0;
  while (first <= Number.EPSILON) first = nextUniform(sensor);
  while (second <= Number.EPSILON) second = nextUniform(sensor);
  const magnitude = Math.sqrt(-2 * Math.log(first));
  const angle = 2 * Math.PI * second;
  sensor.spareNormal = magnitude * Math.sin(angle);
  return magnitude * Math.cos(angle);
}

function advanceUniformState(sensor: AtmosphereSensor, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("uniform skip count must be a non-negative integer");
  }
  sensor.randomState =
    (sensor.randomState + Math.imul(0x6d2b79f5, count >>> 0)) >>> 0;
}

/**
 * Skips Gaussian samples while preserving the exact PRNG state and Box-Muller
 * spare-value state that repeated nextNormal() calls would leave behind.
 */
function skipNormalSamples(sensor: AtmosphereSensor, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("normal skip count must be a non-negative integer");
  }
  let remaining = count;
  if (remaining === 0) return;
  if (sensor.spareNormal !== null) {
    sensor.spareNormal = null;
    remaining -= 1;
  }
  const completePairs = Math.floor(remaining / 2);
  advanceUniformState(sensor, completePairs * 2);
  remaining -= completePairs * 2;
  if (remaining === 1) {
    // One normal consumes two uniforms and leaves the paired normal cached.
    nextNormal(sensor);
  }
}

function totalGasMass(gases: GasMassesKg): number {
  return GAS_SPECIES.reduce((total, gas) => total + gases[gas], 0);
}

function gasMassFraction(gases: GasMassesKg, gas: GasSpecies): number {
  const total = totalGasMass(gases);
  return total > 0 ? gases[gas] / total : 0;
}

function addGases(target: GasMassesKg, addition: GasMassesKg): void {
  for (const gas of GAS_SPECIES) {
    target[gas] += addition[gas];
  }
}

function subtractGases(target: GasMassesKg, subtraction: GasMassesKg): void {
  for (const gas of GAS_SPECIES) {
    target[gas] -= subtraction[gas];
    if (target[gas] < 0 && target[gas] > -1e-12) {
      target[gas] = 0;
    }
  }
}

function gasParcel(
  gases: GasMassesKg,
  requestedTotalKg: number,
): GasMassesKg {
  const total = totalGasMass(gases);
  if (total <= 0 || requestedTotalKg <= 0) return zeroGases();
  const parcel = zeroGases();
  for (const gas of GAS_SPECIES) {
    parcel[gas] = requestedTotalKg * (gases[gas] / total);
  }
  return parcel;
}

function scaleGases(gases: GasMassesKg, scale: number): GasMassesKg {
  return {
    oxygen: gases.oxygen * scale,
    nitrogen: gases.nitrogen * scale,
    carbonDioxide: gases.carbonDioxide * scale,
    waterVapor: gases.waterVapor * scale,
  };
}

function differenceGases(
  after: GasMassesKg,
  before: GasMassesKg,
): GasMassesKg {
  return {
    oxygen: after.oxygen - before.oxygen,
    nitrogen: after.nitrogen - before.nitrogen,
    carbonDioxide: after.carbonDioxide - before.carbonDioxide,
    waterVapor: after.waterVapor - before.waterVapor,
  };
}

function differenceMetabolism(
  after: MetabolicExchangeLedger,
  before: MetabolicExchangeLedger,
): MetabolicExchangeLedger {
  return {
    oxygenConsumedKg: after.oxygenConsumedKg - before.oxygenConsumedKg,
    carbonDioxideProducedKg:
      after.carbonDioxideProducedKg - before.carbonDioxideProducedKg,
    waterVaporProducedKg:
      after.waterVaporProducedKg - before.waterVaporProducedKg,
    sensibleHeatAddedJ:
      after.sensibleHeatAddedJ - before.sensibleHeatAddedJ,
  };
}

function gasesInZonesAndSinks(
  zones: readonly PressureZone[],
  sink: AtmosphereSink,
  airHandlers: readonly AirHandler[],
): GasMassesKg {
  const total = sumZoneGases(zones);
  addGases(total, sink.ventedGasesKg);
  total.carbonDioxide += airHandlers.reduce(
    (captured, handler) =>
      captured + handler.cumulativeCapturedCarbonDioxideKg,
    0,
  );
  return total;
}

function assertSpeciesBalance(
  before: GasMassesKg,
  after: GasMassesKg,
  metabolicDelta: MetabolicExchangeLedger,
): void {
  const expected: GasMassesKg = {
    oxygen: before.oxygen - metabolicDelta.oxygenConsumedKg,
    nitrogen: before.nitrogen,
    carbonDioxide:
      before.carbonDioxide + metabolicDelta.carbonDioxideProducedKg,
    waterVapor:
      before.waterVapor + metabolicDelta.waterVaporProducedKg,
  };
  for (const gas of GAS_SPECIES) {
    const tolerance = Math.max(1e-9, Math.abs(expected[gas]) * 1e-12);
    if (Math.abs(after[gas] - expected[gas]) > tolerance) {
      throw new Error(
        `atmosphere ${gas} balance failed: expected ${expected[gas]}, received ${after[gas]}`,
      );
    }
  }
}

function applyMetabolism(
  zone: PressureZone,
  deltaSeconds: number,
  ledger: MetabolicExchangeLedger,
  retainedSensibleHeatFraction: number,
): number {
  const demandedOxygen =
    zone.awakeOccupants *
    OXYGEN_CONSUMPTION_KG_PER_PERSON_SECOND *
    deltaSeconds;
  const consumedOxygen = Math.min(zone.gasesKg.oxygen, demandedOxygen);
  const fulfillment =
    demandedOxygen > 0 ? consumedOxygen / demandedOxygen : 0;
  const producedCarbonDioxide =
    zone.awakeOccupants *
    CARBON_DIOXIDE_PRODUCTION_KG_PER_PERSON_SECOND *
    deltaSeconds *
    fulfillment;
  const producedWaterVapor =
    zone.awakeOccupants *
    WATER_VAPOR_PRODUCTION_KG_PER_PERSON_SECOND *
    deltaSeconds *
    fulfillment;
  const sensibleHeat =
    zone.awakeOccupants *
    SENSIBLE_HEAT_W_PER_PERSON *
    deltaSeconds *
    fulfillment;

  zone.gasesKg.oxygen -= consumedOxygen;
  zone.gasesKg.carbonDioxide += producedCarbonDioxide;
  zone.gasesKg.waterVapor += producedWaterVapor;
  ledger.oxygenConsumedKg += consumedOxygen;
  ledger.carbonDioxideProducedKg += producedCarbonDioxide;
  ledger.waterVaporProducedKg += producedWaterVapor;
  ledger.sensibleHeatAddedJ += sensibleHeat;

  // Removed and produced gases cross the passenger/atmosphere boundary at
  // local gas temperature. Explicit metabolic heat is then added.
  return (
    totalGasMass(zone.gasesKg) *
      GAS_SPECIFIC_HEAT_J_PER_KG_K *
      zone.temperatureK +
    sensibleHeat * retainedSensibleHeatFraction
  );
}

function makeInitialGases(
  volumeCubicMeters: number,
  temperatureK: number,
): GasMassesKg {
  const moleFractions: Readonly<Record<GasSpecies, number>> = {
    oxygen: 0.209,
    nitrogen: 0.7784,
    carbonDioxide: 0.0006,
    waterVapor: 0.012,
  };
  return {
    oxygen:
      (BASELINE_PRESSURE_PA *
        moleFractions.oxygen *
        volumeCubicMeters) /
      (GAS_CONSTANT_J_PER_KG_K.oxygen * temperatureK),
    nitrogen:
      (BASELINE_PRESSURE_PA *
        moleFractions.nitrogen *
        volumeCubicMeters) /
      (GAS_CONSTANT_J_PER_KG_K.nitrogen * temperatureK),
    carbonDioxide:
      (BASELINE_PRESSURE_PA *
        moleFractions.carbonDioxide *
        volumeCubicMeters) /
      (GAS_CONSTANT_J_PER_KG_K.carbonDioxide * temperatureK),
    waterVapor:
      (BASELINE_PRESSURE_PA *
        moleFractions.waterVapor *
        volumeCubicMeters) /
      (GAS_CONSTANT_J_PER_KG_K.waterVapor * temperatureK),
  };
}

function createZones(): PressureZone[] {
  return BASELINE_ZONE_IDS.map((id, index) => ({
    id,
    volumeCubicMeters: BASELINE_ZONE_VOLUME_CUBIC_METERS,
    temperatureK: BASELINE_TEMPERATURE_K,
    gasesKg: makeInitialGases(
      BASELINE_ZONE_VOLUME_CUBIC_METERS,
      BASELINE_TEMPERATURE_K,
    ),
    awakeOccupants: index < 26 ? 5 : 4,
  }));
}

function nextRingZoneId(ring: "A" | "B", index: number): ZoneId {
  return makeZoneId(ring, index === 24 ? 1 : index + 1);
}

function createConnections(): AtmosphereConnection[] {
  const connections: AtmosphereConnection[] = [];
  for (const ring of ["A", "B"] as const) {
    for (let index = 1; index <= 24; index += 1) {
      const zoneAId = makeZoneId(ring, index);
      const zoneBId = nextRingZoneId(ring, index);
      connections.push({
        id: `door:${zoneAId}:${zoneBId}`,
        kind: "door",
        zoneAId,
        zoneBId,
        areaSquareMeters: 1.8,
        dischargeCoefficient: 0.65,
        commandedOpenFraction: 1,
        condition: "nominal",
        mixingConductanceCubicMetersPerSecond: 0.05,
        maxMassFlowKgPerSecond: 150,
        lastForwardGrossMassFlowKgPerSecond: 0,
        lastReverseGrossMassFlowKgPerSecond: 0,
        lastSignedMassFlowKgPerSecond: 0,
      });
      connections.push({
        id: `duct:${zoneAId}:${zoneBId}`,
        kind: "duct",
        zoneAId,
        zoneBId,
        areaSquareMeters: 0.08,
        dischargeCoefficient: 0.55,
        commandedOpenFraction: 1,
        condition: "nominal",
        mixingConductanceCubicMetersPerSecond: 0.4,
        maxMassFlowKgPerSecond: 20,
        lastForwardGrossMassFlowKgPerSecond: 0,
        lastReverseGrossMassFlowKgPerSecond: 0,
        lastSignedMassFlowKgPerSecond: 0,
      });
    }
  }
  for (let index = 1; index <= 24; index += 1) {
    const zoneAId = makeZoneId("A", index);
    const zoneBId = makeZoneId("B", index);
    connections.push({
      id: `isolation:${zoneAId}:${zoneBId}`,
      kind: "isolation-valve",
      zoneAId,
      zoneBId,
      areaSquareMeters: 0.04,
      dischargeCoefficient: 0.6,
      commandedOpenFraction: 0.35,
      condition: "nominal",
      mixingConductanceCubicMetersPerSecond: 0.02,
      maxMassFlowKgPerSecond: 10,
      lastForwardGrossMassFlowKgPerSecond: 0,
      lastReverseGrossMassFlowKgPerSecond: 0,
      lastSignedMassFlowKgPerSecond: 0,
    });
  }
  return connections;
}

function airHandlerZoneIds(ring: AirHandlerRing): ZoneId[] {
  return BASELINE_ZONE_IDS.filter((zoneId) =>
    zoneId.startsWith(`${ring}-`),
  );
}

function airHandlerConditionMultiplier(
  condition: AirHandlerCondition,
): number {
  switch (condition) {
    case "nominal":
      return 1;
    case "degraded":
      return DEGRADED_AIR_HANDLER_FLOW_MULTIPLIER;
    case "stuck-off":
      return 0;
  }
}

function actualAirHandlerFlowFraction(
  handler: Pick<
    AirHandler,
    | "commandedFlowFraction"
    | "condition"
    | "electricalServiceFraction"
  >,
): number {
  return (
    handler.commandedFlowFraction *
    handler.electricalServiceFraction *
    airHandlerConditionMultiplier(handler.condition)
  );
}

function createAirHandlers(): AirHandler[] {
  return AIR_HANDLER_IDS.map((id, index) => {
    const ring: AirHandlerRing = index === 0 ? "A" : "B";
    return {
      id,
      ring,
      servedZoneIds: airHandlerZoneIds(ring),
      commandedFlowFraction: 1,
      scrubberEnabled: true,
      condition: "nominal",
      electricalServiceFraction: 1,
      actualFlowFraction: 1,
      carbonDioxideSetpointPa: AIR_HANDLER_CARBON_DIOXIDE_SETPOINT_PA,
      ratedCarbonDioxideCaptureKgPerSecond:
        AIR_HANDLER_RATED_CARBON_DIOXIDE_CAPTURE_KG_PER_SECOND,
      cumulativeCapturedCarbonDioxideKg: 0,
      lastCapturedCarbonDioxideKg: 0,
    };
  });
}

function sensorDefaults(
  quantity: SensorQuantity,
): Pick<
  AtmosphereSensor,
  "sampleIntervalMicroseconds" | "delayMicroseconds" | "noiseStandardDeviation"
> {
  switch (quantity) {
    case "pressurePa":
      return {
        sampleIntervalMicroseconds: MICROSECONDS_PER_SECOND,
        delayMicroseconds: 250_000,
        noiseStandardDeviation: 4,
      };
    case "temperatureK":
      return {
        sampleIntervalMicroseconds: MICROSECONDS_PER_SECOND,
        delayMicroseconds: 250_000,
        noiseStandardDeviation: 0.02,
      };
    case "oxygenPartialPressurePa":
      return {
        sampleIntervalMicroseconds: 5 * MICROSECONDS_PER_SECOND,
        delayMicroseconds: MICROSECONDS_PER_SECOND,
        noiseStandardDeviation: 3,
      };
    case "carbonDioxidePartialPressurePa":
      return {
        sampleIntervalMicroseconds: 5 * MICROSECONDS_PER_SECOND,
        delayMicroseconds: MICROSECONDS_PER_SECOND,
        noiseStandardDeviation: 1,
      };
  }
}

function createSensors(seed: number): AtmosphereSensor[] {
  return BASELINE_ZONE_IDS.flatMap((zoneId) =>
    SENSOR_QUANTITIES.map((quantity) => {
      const id = sensorId(zoneId, quantity);
      return {
        id,
        zoneId,
        quantity,
        ...sensorDefaults(quantity),
        bias: 0,
        driftPerSecond: 0,
        condition: "nominal" as const,
        stuckValue: null,
        nextSampleMicroseconds: 0,
        randomState: combineSeed(seed, id),
        spareNormal: null,
        pending: [],
        latest: null,
      };
    }),
  );
}

export function createBaselineCompartmentSnapshot(
  options: CompartmentNetworkOptions = {},
): CompartmentNetworkSnapshot {
  const seed = hashSeed(options.seed ?? 0);
  const snapshot: CompartmentNetworkSnapshot = {
    snapshotVersion: COMPARTMENT_SNAPSHOT_VERSION,
    metabolicHeatAuthority:
      options.metabolicHeatAuthority ?? "zone-gas",
    elapsedMicroseconds: 0,
    revision: 0,
    zones: createZones(),
    connections: createConnections(),
    airHandlers: createAirHandlers(),
    breaches: [],
    sensors: createSensors(seed),
    sink: {
      ventedGasesKg: zeroGases(),
      ventedThermalEnergyJ: 0,
    },
    metabolism: zeroMetabolism(),
  };
  validateCompartmentSnapshot(snapshot);
  return snapshot;
}

function validateGasMasses(value: unknown, label: string): asserts value is GasMassesKg {
  assertRecord(value, label);
  assertExactKeys(value, GAS_SPECIES, label);
  for (const gas of GAS_SPECIES) {
    assertNonNegative(value[gas], `${label}.${gas}`);
  }
}

function validateZone(value: unknown, expectedId: ZoneId, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "volumeCubicMeters",
      "temperatureK",
      "gasesKg",
      "awakeOccupants",
    ],
    label,
  );
  if (value.id !== expectedId) {
    throw new Error(`${label}.id must be stable id ${expectedId}`);
  }
  assertPositive(value.volumeCubicMeters, `${label}.volumeCubicMeters`);
  assertPositive(value.temperatureK, `${label}.temperatureK`);
  validateGasMasses(value.gasesKg, `${label}.gasesKg`);
  assertInteger(value.awakeOccupants, `${label}.awakeOccupants`);
}

function validateConnection(
  value: unknown,
  zoneIds: ReadonlySet<string>,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "kind",
      "zoneAId",
      "zoneBId",
      "areaSquareMeters",
      "dischargeCoefficient",
      "commandedOpenFraction",
      "condition",
      "mixingConductanceCubicMetersPerSecond",
      "maxMassFlowKgPerSecond",
      "lastForwardGrossMassFlowKgPerSecond",
      "lastReverseGrossMassFlowKgPerSecond",
      "lastSignedMassFlowKgPerSecond",
    ],
    label,
  );
  assertNonEmptyString(value.id, `${label}.id`);
  if (
    value.kind !== "door" &&
    value.kind !== "duct" &&
    value.kind !== "isolation-valve"
  ) {
    throw new TypeError(`${label}.kind is invalid`);
  }
  if (
    typeof value.zoneAId !== "string" ||
    !zoneIds.has(value.zoneAId) ||
    typeof value.zoneBId !== "string" ||
    !zoneIds.has(value.zoneBId) ||
    value.zoneAId === value.zoneBId
  ) {
    throw new Error(`${label} has invalid endpoints`);
  }
  assertNonNegative(value.areaSquareMeters, `${label}.areaSquareMeters`);
  assertFraction(value.dischargeCoefficient, `${label}.dischargeCoefficient`);
  assertFraction(value.commandedOpenFraction, `${label}.commandedOpenFraction`);
  if (
    value.condition !== "nominal" &&
    value.condition !== "degraded" &&
    value.condition !== "stuck-closed" &&
    value.condition !== "stuck-open"
  ) {
    throw new TypeError(`${label}.condition is invalid`);
  }
  assertNonNegative(
    value.mixingConductanceCubicMetersPerSecond,
    `${label}.mixingConductanceCubicMetersPerSecond`,
  );
  assertNonNegative(
    value.maxMassFlowKgPerSecond,
    `${label}.maxMassFlowKgPerSecond`,
  );
  assertNonNegative(
    value.lastForwardGrossMassFlowKgPerSecond,
    `${label}.lastForwardGrossMassFlowKgPerSecond`,
  );
  assertNonNegative(
    value.lastReverseGrossMassFlowKgPerSecond,
    `${label}.lastReverseGrossMassFlowKgPerSecond`,
  );
  assertFinite(
    value.lastSignedMassFlowKgPerSecond,
    `${label}.lastSignedMassFlowKgPerSecond`,
  );
}

function validateAirHandler(
  value: unknown,
  expectedId: AirHandlerId,
  expectedRing: AirHandlerRing,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "ring",
      "servedZoneIds",
      "commandedFlowFraction",
      "scrubberEnabled",
      "condition",
      "electricalServiceFraction",
      "actualFlowFraction",
      "carbonDioxideSetpointPa",
      "ratedCarbonDioxideCaptureKgPerSecond",
      "cumulativeCapturedCarbonDioxideKg",
      "lastCapturedCarbonDioxideKg",
    ],
    label,
  );
  if (value.id !== expectedId || value.ring !== expectedRing) {
    throw new Error(
      `${label} must retain fixed identity ${expectedId}/${expectedRing}`,
    );
  }
  const expectedZoneIds = airHandlerZoneIds(expectedRing);
  if (
    !Array.isArray(value.servedZoneIds) ||
    value.servedZoneIds.length !== expectedZoneIds.length ||
    value.servedZoneIds.some(
      (zoneId, index) => zoneId !== expectedZoneIds[index],
    )
  ) {
    throw new Error(
      `${label}.servedZoneIds must retain the fixed ${expectedRing}-ring topology`,
    );
  }
  assertFraction(
    value.commandedFlowFraction,
    `${label}.commandedFlowFraction`,
  );
  if (typeof value.scrubberEnabled !== "boolean") {
    throw new TypeError(`${label}.scrubberEnabled must be boolean`);
  }
  if (
    value.condition !== "nominal" &&
    value.condition !== "degraded" &&
    value.condition !== "stuck-off"
  ) {
    throw new TypeError(`${label}.condition is invalid`);
  }
  assertFraction(
    value.electricalServiceFraction,
    `${label}.electricalServiceFraction`,
  );
  assertFraction(value.actualFlowFraction, `${label}.actualFlowFraction`);
  const expectedActualFlowFraction = actualAirHandlerFlowFraction({
    commandedFlowFraction: value.commandedFlowFraction,
    condition: value.condition,
    electricalServiceFraction: value.electricalServiceFraction,
  });
  if (
    Math.abs(value.actualFlowFraction - expectedActualFlowFraction) >
    1e-12
  ) {
    throw new Error(
      `${label}.actualFlowFraction does not match command, condition, and electrical service`,
    );
  }
  if (
    value.carbonDioxideSetpointPa !==
    AIR_HANDLER_CARBON_DIOXIDE_SETPOINT_PA
  ) {
    throw new Error(
      `${label}.carbonDioxideSetpointPa must retain fixed setpoint`,
    );
  }
  if (
    value.ratedCarbonDioxideCaptureKgPerSecond !==
    AIR_HANDLER_RATED_CARBON_DIOXIDE_CAPTURE_KG_PER_SECOND
  ) {
    throw new Error(
      `${label}.ratedCarbonDioxideCaptureKgPerSecond must retain fixed rating`,
    );
  }
  assertNonNegative(
    value.cumulativeCapturedCarbonDioxideKg,
    `${label}.cumulativeCapturedCarbonDioxideKg`,
  );
  assertNonNegative(
    value.lastCapturedCarbonDioxideKg,
    `${label}.lastCapturedCarbonDioxideKg`,
  );
  if (
    value.lastCapturedCarbonDioxideKg >
    value.cumulativeCapturedCarbonDioxideKg + 1e-12
  ) {
    throw new RangeError(
      `${label}.lastCapturedCarbonDioxideKg cannot exceed cumulative capture`,
    );
  }
}

function validateBreach(
  value: unknown,
  zoneIds: ReadonlySet<string>,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    ["id", "zoneId", "areaSquareMeters", "dischargeCoefficient"],
    label,
  );
  assertNonEmptyString(value.id, `${label}.id`);
  if (typeof value.zoneId !== "string" || !zoneIds.has(value.zoneId)) {
    throw new Error(`${label}.zoneId is invalid`);
  }
  assertPositive(value.areaSquareMeters, `${label}.areaSquareMeters`);
  assertFraction(value.dischargeCoefficient, `${label}.dischargeCoefficient`);
}

function validateReading(
  value: unknown,
  sensor: Pick<AtmosphereSensor, "id" | "zoneId" | "quantity">,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "sensorId",
      "zoneId",
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
    value.zoneId !== sensor.zoneId ||
    value.quantity !== sensor.quantity
  ) {
    throw new Error(`${label} identity does not match its sensor`);
  }
  assertSafeMicroseconds(
    value.sampledAtMicroseconds,
    `${label}.sampledAtMicroseconds`,
  );
  assertSafeMicroseconds(
    value.availableAtMicroseconds,
    `${label}.availableAtMicroseconds`,
  );
  if (value.availableAtMicroseconds < value.sampledAtMicroseconds) {
    throw new RangeError(`${label} cannot become available before sampling`);
  }
  if (value.value !== null) assertFinite(value.value, `${label}.value`);
  if (
    value.quality !== "nominal" &&
    value.quality !== "degraded" &&
    value.quality !== "stuck" &&
    value.quality !== "offline"
  ) {
    throw new TypeError(`${label}.quality is invalid`);
  }
}

function validateSensor(
  value: unknown,
  expectedId: string,
  zoneIds: ReadonlySet<string>,
  elapsedMicroseconds: number,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "zoneId",
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
  if (value.id !== expectedId) {
    throw new Error(`${label}.id must be stable id ${expectedId}`);
  }
  if (typeof value.zoneId !== "string" || !zoneIds.has(value.zoneId)) {
    throw new Error(`${label}.zoneId is invalid`);
  }
  if (!SENSOR_QUANTITIES.includes(value.quantity as SensorQuantity)) {
    throw new TypeError(`${label}.quantity is invalid`);
  }
  const expectedSensorId = sensorId(
    value.zoneId as ZoneId,
    value.quantity as SensorQuantity,
  );
  if (value.id !== expectedSensorId) {
    throw new Error(`${label}.id does not match zone and quantity`);
  }
  assertSafeMicroseconds(
    value.sampleIntervalMicroseconds,
    `${label}.sampleIntervalMicroseconds`,
  );
  if (value.sampleIntervalMicroseconds === 0) {
    throw new RangeError(`${label}.sampleIntervalMicroseconds cannot be zero`);
  }
  assertSafeMicroseconds(value.delayMicroseconds, `${label}.delayMicroseconds`);
  assertNonNegative(
    value.noiseStandardDeviation,
    `${label}.noiseStandardDeviation`,
  );
  assertFinite(value.bias, `${label}.bias`);
  assertFinite(value.driftPerSecond, `${label}.driftPerSecond`);
  if (
    value.condition !== "nominal" &&
    value.condition !== "degraded" &&
    value.condition !== "stuck" &&
    value.condition !== "offline"
  ) {
    throw new TypeError(`${label}.condition is invalid`);
  }
  if (value.stuckValue !== null) {
    assertFinite(value.stuckValue, `${label}.stuckValue`);
  }
  assertSafeMicroseconds(
    value.nextSampleMicroseconds,
    `${label}.nextSampleMicroseconds`,
  );
  if (value.nextSampleMicroseconds < elapsedMicroseconds) {
    throw new RangeError(`${label}.nextSampleMicroseconds is in the past`);
  }
  assertInteger(value.randomState, `${label}.randomState`);
  if (value.randomState > 0xffff_ffff) {
    throw new RangeError(`${label}.randomState exceeds uint32`);
  }
  if (value.spareNormal !== null) {
    assertFinite(value.spareNormal, `${label}.spareNormal`);
  }
  if (!Array.isArray(value.pending)) {
    throw new TypeError(`${label}.pending must be an array`);
  }
  const identity = {
    id: value.id,
    zoneId: value.zoneId as ZoneId,
    quantity: value.quantity as SensorQuantity,
  };
  value.pending.forEach((reading, index) =>
    validateReading(reading, identity, `${label}.pending[${index}]`),
  );
  for (let index = 1; index < value.pending.length; index += 1) {
    const previous = value.pending[index - 1] as SensorReading;
    const current = value.pending[index] as SensorReading;
    if (
      current.availableAtMicroseconds < previous.availableAtMicroseconds ||
      (current.availableAtMicroseconds === previous.availableAtMicroseconds &&
        current.sampledAtMicroseconds < previous.sampledAtMicroseconds)
    ) {
      throw new Error(`${label}.pending must be ordered`);
    }
  }
  if (value.latest !== null) {
    validateReading(value.latest, identity, `${label}.latest`);
    if (
      (value.latest as SensorReading).availableAtMicroseconds >
      elapsedMicroseconds
    ) {
      throw new Error(`${label}.latest is not available yet`);
    }
  }
}

function validateSink(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(value, ["ventedGasesKg", "ventedThermalEnergyJ"], label);
  validateGasMasses(value.ventedGasesKg, `${label}.ventedGasesKg`);
  assertNonNegative(value.ventedThermalEnergyJ, `${label}.ventedThermalEnergyJ`);
}

function validateMetabolism(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "oxygenConsumedKg",
      "carbonDioxideProducedKg",
      "waterVaporProducedKg",
      "sensibleHeatAddedJ",
    ],
    label,
  );
  assertNonNegative(value.oxygenConsumedKg, `${label}.oxygenConsumedKg`);
  assertNonNegative(
    value.carbonDioxideProducedKg,
    `${label}.carbonDioxideProducedKg`,
  );
  assertNonNegative(
    value.waterVaporProducedKg,
    `${label}.waterVaporProducedKg`,
  );
  assertNonNegative(value.sensibleHeatAddedJ, `${label}.sensibleHeatAddedJ`);
}

export function validateCompartmentSnapshot(
  value: unknown,
): asserts value is CompartmentNetworkSnapshot {
  assertRecord(value, "snapshot");
  assertExactKeys(
    value,
    [
      "snapshotVersion",
      "metabolicHeatAuthority",
      "elapsedMicroseconds",
      "revision",
      "zones",
      "connections",
      "airHandlers",
      "breaches",
      "sensors",
      "sink",
      "metabolism",
    ],
    "snapshot",
  );
  if (value.snapshotVersion !== COMPARTMENT_SNAPSHOT_VERSION) {
    throw new Error("unsupported compartment snapshot version");
  }
  if (
    value.metabolicHeatAuthority !== "zone-gas" &&
    value.metabolicHeatAuthority !== "external-network"
  ) {
    throw new Error(
      "snapshot has an invalid metabolic heat authority",
    );
  }
  assertSafeMicroseconds(value.elapsedMicroseconds, "snapshot.elapsedMicroseconds");
  assertInteger(value.revision, "snapshot.revision");
  if (!Array.isArray(value.zones) || value.zones.length !== COMPARTMENT_COUNT) {
    throw new Error(`snapshot must contain exactly ${COMPARTMENT_COUNT} zones`);
  }
  value.zones.forEach((zone, index) =>
    validateZone(
      zone,
      BASELINE_ZONE_IDS[index] as ZoneId,
      `snapshot.zones[${index}]`,
    ),
  );
  const zoneIds = new Set(BASELINE_ZONE_IDS);

  if (!Array.isArray(value.connections) || value.connections.length === 0) {
    throw new Error("snapshot.connections must be a non-empty array");
  }
  const connectionIds = new Set<string>();
  const connectionKinds = new Set<ConnectionKind>();
  value.connections.forEach((connection, index) => {
    validateConnection(
      connection,
      zoneIds,
      `snapshot.connections[${index}]`,
    );
    const typed = connection as AtmosphereConnection;
    if (connectionIds.has(typed.id)) {
      throw new Error(`duplicate connection id ${typed.id}`);
    }
    connectionIds.add(typed.id);
    connectionKinds.add(typed.kind);
  });
  for (const kind of [
    "door",
    "duct",
    "isolation-valve",
  ] as const satisfies readonly ConnectionKind[]) {
    if (!connectionKinds.has(kind)) {
      throw new Error(`snapshot has no ${kind} connection`);
    }
  }

  if (
    !Array.isArray(value.airHandlers) ||
    value.airHandlers.length !== AIR_HANDLER_IDS.length
  ) {
    throw new Error(
      `snapshot must contain exactly ${AIR_HANDLER_IDS.length} air handlers`,
    );
  }
  value.airHandlers.forEach((handler, index) =>
    validateAirHandler(
      handler,
      AIR_HANDLER_IDS[index] as AirHandlerId,
      index === 0 ? "A" : "B",
      `snapshot.airHandlers[${index}]`,
    ),
  );

  if (!Array.isArray(value.breaches)) {
    throw new TypeError("snapshot.breaches must be an array");
  }
  const breachIds = new Set<string>();
  value.breaches.forEach((breach, index) => {
    validateBreach(breach, zoneIds, `snapshot.breaches[${index}]`);
    const id = (breach as HullBreach).id;
    if (breachIds.has(id)) throw new Error(`duplicate breach id ${id}`);
    breachIds.add(id);
  });

  if (
    !Array.isArray(value.sensors) ||
    value.sensors.length !== BASELINE_SENSOR_IDS.length
  ) {
    throw new Error(
      `snapshot must contain exactly ${BASELINE_SENSOR_IDS.length} sensors`,
    );
  }
  value.sensors.forEach((sensor, index) =>
    validateSensor(
      sensor,
      BASELINE_SENSOR_IDS[index] as string,
      zoneIds,
      value.elapsedMicroseconds as number,
      `snapshot.sensors[${index}]`,
    ),
  );
  validateSink(value.sink, "snapshot.sink");
  validateMetabolism(value.metabolism, "snapshot.metabolism");
}

function zoneTruth(zone: PressureZone): ZoneTruth {
  const partialPressuresPa = zeroGases();
  let pressurePa = 0;
  for (const gas of GAS_SPECIES) {
    const partial =
      (zone.gasesKg[gas] *
        GAS_CONSTANT_J_PER_KG_K[gas] *
        zone.temperatureK) /
      zone.volumeCubicMeters;
    partialPressuresPa[gas] = partial;
    pressurePa += partial;
  }
  const totalMass = totalGasMass(zone.gasesKg);
  return {
    zoneId: zone.id,
    totalGasMassKg: totalMass,
    densityKgPerCubicMeter: totalMass / zone.volumeCubicMeters,
    pressurePa,
    temperatureK: zone.temperatureK,
    partialPressuresPa,
  };
}

function effectiveOpening(connection: AtmosphereConnection): number {
  switch (connection.condition) {
    case "stuck-closed":
      return 0;
    case "stuck-open":
      return 1;
    case "degraded":
      return connection.commandedOpenFraction * 0.25;
    case "nominal":
      return connection.commandedOpenFraction;
  }
}

function effectiveMixingConductance(
  connection: AtmosphereConnection,
  airHandlers: readonly AirHandler[],
): number {
  if (connection.kind !== "duct") {
    return connection.mixingConductanceCubicMetersPerSecond;
  }
  const ring: AirHandlerRing = connection.zoneAId.startsWith("A-")
    ? "A"
    : "B";
  const handler = airHandlers.find((candidate) => candidate.ring === ring);
  if (!handler) {
    throw new Error(`duct ${connection.id} has no fixed air handler`);
  }
  return (
    connection.mixingConductanceCubicMetersPerSecond *
    handler.actualFlowFraction
  );
}

interface TransferRequest {
  sourceIndex: number;
  targetIndex: number | null;
  gasesKg: GasMassesKg;
  sourceTemperatureK: number;
  connectionIndex: number | null;
  connectionDirection: 1 | -1 | 0;
}

function requestTotalMass(request: TransferRequest): number {
  return totalGasMass(request.gasesKg);
}

function quantityTruth(truth: ZoneTruth, quantity: SensorQuantity): number {
  switch (quantity) {
    case "pressurePa":
      return truth.pressurePa;
    case "temperatureK":
      return truth.temperatureK;
    case "oxygenPartialPressurePa":
      return truth.partialPressuresPa.oxygen;
    case "carbonDioxidePartialPressurePa":
      return truth.partialPressuresPa.carbonDioxide;
  }
}

function findById<T extends { id: string }>(
  values: readonly T[],
  id: string,
  label: string,
): T {
  const found = values.find((value) => value.id === id);
  if (!found) throw new Error(`unknown ${label} id: ${id}`);
  return found;
}

export class CompartmentAtmosphereNetwork {
  private stateValue: CompartmentNetworkSnapshot;

  constructor(options: CompartmentNetworkOptions = {}) {
    this.stateValue = createBaselineCompartmentSnapshot(options);
    this.sampleDueSensors();
    this.deliverAvailableReadings();
    validateCompartmentSnapshot(this.stateValue);
  }

  get elapsedMicroseconds(): number {
    return this.stateValue.elapsedMicroseconds;
  }

  get revision(): number {
    return this.stateValue.revision;
  }

  listZones(): PressureZone[] {
    return cloneData(this.stateValue.zones);
  }

  getZone(zoneId: ZoneId): PressureZone {
    return cloneData(findById(this.stateValue.zones, zoneId, "zone"));
  }

  getZoneTruth(zoneId: ZoneId): ZoneTruth {
    return cloneData(
      zoneTruth(findById(this.stateValue.zones, zoneId, "zone")),
    );
  }

  listConnections(): AtmosphereConnection[] {
    return cloneData(this.stateValue.connections);
  }

  listAirHandlers(): AirHandler[] {
    return cloneData(this.stateValue.airHandlers);
  }

  listBreaches(): HullBreach[] {
    return cloneData(this.stateValue.breaches);
  }

  listSensors(): AtmosphereSensor[] {
    return cloneData(this.stateValue.sensors);
  }

  getSensorReading(sensorIdentifier: string): SensorReading | null {
    const sensor = findById(
      this.stateValue.sensors,
      sensorIdentifier,
      "sensor",
    );
    return sensor.latest ? cloneData(sensor.latest) : null;
  }

  getSink(): AtmosphereSink {
    return cloneData(this.stateValue.sink);
  }

  getMetabolicExchange(): MetabolicExchangeLedger {
    return cloneData(this.stateValue.metabolism);
  }

  getFidelityRequirement(): CompartmentFidelityRequirement {
    const reasons: CompartmentFidelityRequirement["reasons"] = [];
    if (this.stateValue.breaches.length > 0) {
      reasons.push("active-breach");
    }
    if (
      this.stateValue.connections.some(
        (connection) => connection.condition !== "nominal",
      )
    ) {
      reasons.push("connection-fault");
    }
    if (
      this.stateValue.sensors.some(
        (sensor) =>
          sensor.condition !== "nominal" ||
          Math.ceil(
            sensor.delayMicroseconds /
              sensor.sampleIntervalMicroseconds,
          ) > 64,
      )
    ) {
      reasons.push("sensor-fault-or-long-delay");
    }
    if (!this.isNearEquilibrium()) {
      reasons.push("pressure-temperature-or-composition-gradient");
    }
    return {
      requiresFineSolver: reasons.length > 0,
      maximumSimulatedSecondsPerStep:
        reasons.length > 0 ? 60 : null,
      reasons,
    };
  }

  getAggregateState(): CompartmentAggregateState {
    const gasesKg = sumZoneGases(this.stateValue.zones);
    let volumeCubicMeters = 0;
    let pressureVolumeSum = 0;
    let oxygenPartialPressureVolumeSum = 0;
    let carbonDioxidePartialPressureVolumeSum = 0;
    let temperatureVolumeSum = 0;
    let awakeOccupants = 0;

    for (const zone of this.stateValue.zones) {
      const truth = zoneTruth(zone);
      volumeCubicMeters += zone.volumeCubicMeters;
      pressureVolumeSum += truth.pressurePa * zone.volumeCubicMeters;
      oxygenPartialPressureVolumeSum +=
        truth.partialPressuresPa.oxygen * zone.volumeCubicMeters;
      carbonDioxidePartialPressureVolumeSum +=
        truth.partialPressuresPa.carbonDioxide *
        zone.volumeCubicMeters;
      temperatureVolumeSum += zone.temperatureK * zone.volumeCubicMeters;
      awakeOccupants += zone.awakeOccupants;
    }

    const ventedGasKg = GAS_SPECIES.reduce(
      (total, gas) => total + this.stateValue.sink.ventedGasesKg[gas],
      0,
    );
    const leakAreaSquareMeters = this.stateValue.breaches.reduce(
      (total, breach) => total + breach.areaSquareMeters,
      0,
    );

    return {
      volumeCubicMeters,
      gasesKg,
      pressurePa: pressureVolumeSum / volumeCubicMeters,
      oxygenPartialPressurePa:
        oxygenPartialPressureVolumeSum / volumeCubicMeters,
      carbonDioxidePartialPressurePa:
        carbonDioxidePartialPressureVolumeSum / volumeCubicMeters,
      averageTemperatureK: temperatureVolumeSum / volumeCubicMeters,
      awakeOccupants,
      ventedGasKg,
      leakAreaSquareMeters,
    };
  }

  setAwakeOccupantTotal(totalAwakeOccupants: number): void {
    if (
      !Number.isSafeInteger(totalAwakeOccupants) ||
      totalAwakeOccupants < 0
    ) {
      throw new RangeError(
        "totalAwakeOccupants must be a non-negative safe integer",
      );
    }
    const base = Math.floor(
      totalAwakeOccupants / this.stateValue.zones.length,
    );
    const remainder =
      totalAwakeOccupants % this.stateValue.zones.length;
    const unchanged = this.stateValue.zones.every(
      (zone, index) =>
        zone.awakeOccupants === base + (index < remainder ? 1 : 0),
    );
    if (unchanged) return;

    const next = this.snapshot();
    next.zones.forEach((zone, index) => {
      zone.awakeOccupants = base + (index < remainder ? 1 : 0);
    });
    next.revision += 1;
    validateCompartmentSnapshot(next);
    this.stateValue = next;
  }

  setAwakeOccupantsByZone(
    occupants: Readonly<Record<ZoneId, number>>,
  ): void {
    let changed = false;
    for (const zone of this.stateValue.zones) {
      const count = occupants[zone.id];
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError(
          `occupants.${zone.id} must be a non-negative safe integer`,
        );
      }
      if (zone.awakeOccupants !== count) {
        changed = true;
      }
    }
    if (!changed) return;
    const next = this.snapshot();
    for (const zone of next.zones) {
      zone.awakeOccupants = occupants[zone.id];
    }
    next.revision += 1;
    validateCompartmentSnapshot(next);
    this.stateValue = next;
  }

  setTotalGasMass(gas: GasSpecies, targetMassKg: number): number {
    if (!GAS_SPECIES.includes(gas)) {
      throw new TypeError(`unknown gas species: ${gas}`);
    }
    assertNonNegative(targetMassKg, "targetMassKg");
    const next = this.snapshot();
    const currentMassKg = next.zones.reduce(
      (total, zone) => total + zone.gasesKg[gas],
      0,
    );
    if (currentMassKg === targetMassKg) return 0;

    if (currentMassKg > 0) {
      const scale = targetMassKg / currentMassKg;
      for (const zone of next.zones) {
        zone.gasesKg[gas] *= scale;
      }
    } else {
      const totalVolume = next.zones.reduce(
        (total, zone) => total + zone.volumeCubicMeters,
        0,
      );
      for (const zone of next.zones) {
        zone.gasesKg[gas] =
          targetMassKg * (zone.volumeCubicMeters / totalVolume);
      }
    }

    const assignedMassKg = next.zones.reduce(
      (total, zone) => total + zone.gasesKg[gas],
      0,
    );
    const correction = targetMassKg - assignedMassKg;
    next.zones[next.zones.length - 1].gasesKg[gas] = Math.max(
      0,
      next.zones[next.zones.length - 1].gasesKg[gas] + correction,
    );
    next.revision += 1;
    validateCompartmentSnapshot(next);
    this.stateValue = next;
    return targetMassKg - currentMassKg;
  }

  removeGasProportionally(
    gas: GasSpecies,
    maximumMassKg: number,
  ): number {
    assertNonNegative(maximumMassKg, "maximumMassKg");
    const currentMassKg = this.stateValue.zones.reduce(
      (total, zone) => total + zone.gasesKg[gas],
      0,
    );
    const removedMassKg = Math.min(currentMassKg, maximumMassKg);
    if (removedMassKg === 0) return 0;
    this.setTotalGasMass(gas, currentMassKg - removedMassKg);
    return removedMassKg;
  }

  configureConnection(
    connectionId: string,
    patch: ConnectionPatch,
  ): AtmosphereConnection {
    const next = this.snapshot();
    const connection = findById(next.connections, connectionId, "connection");
    Object.assign(connection, cloneData(patch));
    next.revision += 1;
    validateCompartmentSnapshot(next);
    this.stateValue = next;
    return cloneData(connection);
  }

  configureAirHandler(
    airHandlerId: AirHandlerId,
    patch: AirHandlerPatch,
  ): AirHandler {
    const next = this.snapshot();
    const handler = findById(
      next.airHandlers,
      airHandlerId,
      "air handler",
    );
    Object.assign(handler, cloneData(patch));
    handler.actualFlowFraction =
      actualAirHandlerFlowFraction(handler);
    next.revision += 1;
    validateCompartmentSnapshot(next);
    this.stateValue = next;
    return cloneData(handler);
  }

  synchronizeAirHandlerElectricalServiceFraction(
    airHandlerId: AirHandlerId,
    electricalServiceFraction: number,
  ): AirHandler {
    assertFraction(
      electricalServiceFraction,
      "electricalServiceFraction",
    );
    const current = findById(
      this.stateValue.airHandlers,
      airHandlerId,
      "air handler",
    );
    if (
      current.electricalServiceFraction ===
      electricalServiceFraction
    ) {
      return cloneData(current);
    }
    const next = this.snapshot();
    const handler = findById(
      next.airHandlers,
      airHandlerId,
      "air handler",
    );
    handler.electricalServiceFraction = electricalServiceFraction;
    handler.actualFlowFraction =
      actualAirHandlerFlowFraction(handler);
    next.revision += 1;
    validateCompartmentSnapshot(next);
    this.stateValue = next;
    return cloneData(handler);
  }

  upsertBreach(breach: HullBreach): HullBreach {
    const next = this.snapshot();
    const index = next.breaches.findIndex((entry) => entry.id === breach.id);
    if (index >= 0) {
      next.breaches[index] = cloneData(breach);
    } else {
      next.breaches.push(cloneData(breach));
      next.breaches.sort((left, right) => left.id.localeCompare(right.id));
    }
    next.revision += 1;
    validateCompartmentSnapshot(next);
    this.stateValue = next;
    return cloneData(breach);
  }

  removeBreach(breachId: string): boolean {
    const next = this.snapshot();
    const index = next.breaches.findIndex((entry) => entry.id === breachId);
    if (index < 0) return false;
    next.breaches.splice(index, 1);
    next.revision += 1;
    validateCompartmentSnapshot(next);
    this.stateValue = next;
    return true;
  }

  configureSensor(
    sensorIdentifier: string,
    patch: SensorPatch,
  ): AtmosphereSensor {
    const next = this.snapshot();
    const sensor = findById(next.sensors, sensorIdentifier, "sensor");
    Object.assign(sensor, cloneData(patch));

    // Configuration/fault changes are entity changes. Future samples use the
    // new hardware state; already queued readings are discarded explicitly.
    sensor.pending = [];
    sensor.latest = null;
    sensor.nextSampleMicroseconds = next.elapsedMicroseconds;
    sensor.spareNormal = null;

    next.revision += 1;
    validateCompartmentSnapshot(next);
    this.stateValue = next;
    this.sampleDueSensors();
    this.deliverAvailableReadings();
    return cloneData(
      findById(this.stateValue.sensors, sensorIdentifier, "sensor"),
    );
  }

  private captureCarbonDioxide(
    deltaSeconds: number,
  ): ReadonlyMap<ZoneId, number> {
    const removedByZone = new Map<ZoneId, number>();
    for (const handler of this.stateValue.airHandlers) {
      if (
        !handler.scrubberEnabled ||
        handler.actualFlowFraction <= 0 ||
        deltaSeconds <= 0
      ) {
        continue;
      }
      const servedZones = handler.servedZoneIds.map((zoneId) =>
        findById(this.stateValue.zones, zoneId, "zone"),
      );
      const removableByZone = servedZones.map((zone) => {
        const massAtSetpointKg =
          (handler.carbonDioxideSetpointPa * zone.volumeCubicMeters) /
          (GAS_CONSTANT_J_PER_KG_K.carbonDioxide * zone.temperatureK);
        return Math.max(
          0,
          zone.gasesKg.carbonDioxide - massAtSetpointKg,
        );
      });
      const availableCarbonDioxideKg = removableByZone.reduce(
        (total, removableKg) => total + removableKg,
        0,
      );
      const capacityKg =
        handler.ratedCarbonDioxideCaptureKgPerSecond *
        handler.actualFlowFraction *
        deltaSeconds;
      const capturedKg = Math.min(
        availableCarbonDioxideKg,
        capacityKg,
      );
      if (capturedKg <= 0) continue;

      let assignedKg = 0;
      servedZones.forEach((zone, index) => {
        const isLast = index === servedZones.length - 1;
        const removedKg = isLast
          ? capturedKg - assignedKg
          : capturedKg *
            (removableByZone[index] / availableCarbonDioxideKg);
        zone.gasesKg.carbonDioxide -= removedKg;
        if (
          zone.gasesKg.carbonDioxide < 0 &&
          zone.gasesKg.carbonDioxide > -1e-12
        ) {
          zone.gasesKg.carbonDioxide = 0;
        }
        assignedKg += removedKg;
        removedByZone.set(
          zone.id,
          (removedByZone.get(zone.id) ?? 0) + removedKg,
        );
      });
      handler.cumulativeCapturedCarbonDioxideKg += capturedKg;
    }
    return removedByZone;
  }

  step(
    simulatedSeconds: number,
    options: CompartmentStepOptions = {},
  ): CompartmentStepResult {
    assertNonNegative(simulatedSeconds, "simulatedSeconds");
    if (
      options.fidelity !== undefined &&
      options.fidelity !== "auto" &&
      options.fidelity !== "fine"
    ) {
      throw new TypeError("step fidelity must be auto or fine");
    }
    const externalHeatRemovalFraction =
      options.externalMetabolicHeatRemovalFraction ?? 1;
    assertFraction(
      externalHeatRemovalFraction,
      "externalMetabolicHeatRemovalFraction",
    );
    if (
      this.stateValue.metabolicHeatAuthority === "zone-gas" &&
      options.externalMetabolicHeatRemovalFraction !== undefined
    ) {
      throw new Error(
        "external metabolic heat removal requires external-network authority",
      );
    }
    const retainedSensibleHeatFraction =
      this.stateValue.metabolicHeatAuthority === "zone-gas"
        ? 1
        : 1 - externalHeatRemovalFraction;
    const durationMicroseconds = Math.round(
      simulatedSeconds * MICROSECONDS_PER_SECOND,
    );
    assertSafeMicroseconds(durationMicroseconds, "step duration");
    const fromMicroseconds = this.stateValue.elapsedMicroseconds;
    const targetMicroseconds = fromMicroseconds + durationMicroseconds;
    assertSafeMicroseconds(targetMicroseconds, "step target");

    const sinkBefore = cloneData(this.stateValue.sink.ventedGasesKg);
    const metabolismBefore = cloneData(this.stateValue.metabolism);
    const capturedBefore = new Map(
      this.stateValue.airHandlers.map((handler) => [
        handler.id,
        handler.cumulativeCapturedCarbonDioxideKg,
      ]),
    );
    const internalTransferredGasesKg = zeroGases();
    let fineSubsteps = 0;
    let equilibriumIntervals = 0;
    let nextFastPathCheckMicroseconds = fromMicroseconds;
    const fastPathBlocked =
      options.fidelity === "fine" || this.hasFastPathBlocker();

    this.sampleDueSensors();
    this.deliverAvailableReadings();

    while (this.stateValue.elapsedMicroseconds < targetMicroseconds) {
      const now = this.stateValue.elapsedMicroseconds;
      const remaining = targetMicroseconds - now;
      if (
        !fastPathBlocked &&
        remaining >= FAST_PATH_MINIMUM_DURATION_MICROSECONDS &&
        now >= nextFastPathCheckMicroseconds
      ) {
        if (this.isNearEquilibrium()) {
          this.advanceEquilibriumFast(
            targetMicroseconds,
            internalTransferredGasesKg,
            retainedSensibleHeatFraction,
          );
          equilibriumIntervals += 1;
          continue;
        }
        nextFastPathCheckMicroseconds =
          now + FAST_PATH_RECHECK_MICROSECONDS;
      }

      const nextSample = Math.min(
        ...this.stateValue.sensors.map(
          (sensor) => sensor.nextSampleMicroseconds,
        ),
      );
      const pendingAvailability = this.nextPendingAvailability();
      const boundary = Math.min(
        targetMicroseconds,
        now + MAX_PHYSICS_SUBSTEP_MICROSECONDS,
        nextSample,
        pendingAvailability ?? Number.POSITIVE_INFINITY,
      );

      if (boundary === now) {
        this.deliverAvailableReadings();
        this.sampleDueSensors();
        this.deliverAvailableReadings();
        continue;
      }

      this.advancePhysics(
        (boundary - now) / MICROSECONDS_PER_SECOND,
        internalTransferredGasesKg,
        retainedSensibleHeatFraction,
      );
      this.stateValue.elapsedMicroseconds = boundary;
      fineSubsteps += 1;
      this.deliverAvailableReadings();
      this.sampleDueSensors();
      this.deliverAvailableReadings();
    }

    let capturedCarbonDioxideKg = 0;
    for (const handler of this.stateValue.airHandlers) {
      const captured =
        handler.cumulativeCapturedCarbonDioxideKg -
        (capturedBefore.get(handler.id) ?? 0);
      handler.lastCapturedCarbonDioxideKg = captured;
      capturedCarbonDioxideKg += captured;
    }
    validateCompartmentSnapshot(this.stateValue);
    const fidelityMode: AtmosphereFidelityMode =
      equilibriumIntervals > 0
        ? fineSubsteps > 0
          ? "mixed"
          : "equilibrium-fast"
        : "transient-fine";
    const metabolicExchange = differenceMetabolism(
      this.stateValue.metabolism,
      metabolismBefore,
    );
    return {
      fromMicroseconds,
      toMicroseconds: targetMicroseconds,
      substeps: fineSubsteps + equilibriumIntervals,
      fineSubsteps,
      equilibriumIntervals,
      fidelityMode,
      internalTransferredGasesKg,
      ventedGasesKg: differenceGases(
        this.stateValue.sink.ventedGasesKg,
        sinkBefore,
      ),
      metabolicExchange,
      capturedCarbonDioxideKg,
      metabolicHeatTransferredToExternalJ:
        this.stateValue.metabolicHeatAuthority === "external-network"
          ? metabolicExchange.sensibleHeatAddedJ *
            externalHeatRemovalFraction
          : 0,
      revision: this.stateValue.revision,
    };
  }

  private hasFastPathBlocker(): boolean {
    if (this.stateValue.breaches.length > 0) return true;
    if (
      this.stateValue.connections.some(
        (connection) => connection.condition !== "nominal",
      )
    ) {
      return true;
    }
    return this.stateValue.sensors.some(
      (sensor) =>
        sensor.condition !== "nominal" ||
        Math.ceil(
          sensor.delayMicroseconds / sensor.sampleIntervalMicroseconds,
        ) > 64,
    );
  }

  private equilibriumComponents(): number[][] {
    const zones = this.stateValue.zones;
    const indexById = new Map(
      zones.map((zone, index) => [zone.id, index] as const),
    );
    const adjacency = zones.map(() => [] as number[]);
    for (const connection of this.stateValue.connections) {
      if (
        effectiveOpening(connection) <= 0 ||
        (connection.areaSquareMeters <= 0 &&
          effectiveMixingConductance(
            connection,
            this.stateValue.airHandlers,
          ) <= 0)
      ) {
        continue;
      }
      const left = indexById.get(connection.zoneAId);
      const right = indexById.get(connection.zoneBId);
      if (left === undefined || right === undefined) {
        throw new Error(`connection ${connection.id} references an unknown zone`);
      }
      adjacency[left].push(right);
      adjacency[right].push(left);
    }
    adjacency.forEach((neighbors) => neighbors.sort((left, right) => left - right));

    const visited = new Set<number>();
    const components: number[][] = [];
    for (let start = 0; start < zones.length; start += 1) {
      if (visited.has(start)) continue;
      const component: number[] = [];
      const queue = [start];
      visited.add(start);
      while (queue.length > 0) {
        const current = queue.shift() as number;
        component.push(current);
        for (const neighbor of adjacency[current]) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      component.sort((left, right) => left - right);
      components.push(component);
    }
    return components;
  }

  private isNearEquilibrium(): boolean {
    const truths = this.stateValue.zones.map(zoneTruth);
    for (const component of this.equilibriumComponents()) {
      let minimumPressure = Number.POSITIVE_INFINITY;
      let maximumPressure = 0;
      let minimumTemperature = Number.POSITIVE_INFINITY;
      let maximumTemperature = 0;
      const minimumFractions = {
        oxygen: Number.POSITIVE_INFINITY,
        nitrogen: Number.POSITIVE_INFINITY,
        carbonDioxide: Number.POSITIVE_INFINITY,
        waterVapor: Number.POSITIVE_INFINITY,
      };
      const maximumFractions = zeroGases();

      for (const index of component) {
        const zone = this.stateValue.zones[index];
        const truth = truths[index];
        minimumPressure = Math.min(minimumPressure, truth.pressurePa);
        maximumPressure = Math.max(maximumPressure, truth.pressurePa);
        minimumTemperature = Math.min(
          minimumTemperature,
          zone.temperatureK,
        );
        maximumTemperature = Math.max(
          maximumTemperature,
          zone.temperatureK,
        );
        for (const gas of GAS_SPECIES) {
          const fraction = gasMassFraction(zone.gasesKg, gas);
          minimumFractions[gas] = Math.min(
            minimumFractions[gas],
            fraction,
          );
          maximumFractions[gas] = Math.max(
            maximumFractions[gas],
            fraction,
          );
        }
      }

      const referencePressure = Math.max(
        1,
        (minimumPressure + maximumPressure) / 2,
      );
      if (
        (maximumPressure - minimumPressure) / referencePressure >
          FAST_PRESSURE_RELATIVE_SPREAD ||
        maximumTemperature - minimumTemperature >
          FAST_TEMPERATURE_SPREAD_K
      ) {
        return false;
      }
      for (const gas of GAS_SPECIES) {
        if (
          maximumFractions[gas] - minimumFractions[gas] >
          FAST_SPECIES_MASS_FRACTION_SPREAD
        ) {
          return false;
        }
      }
    }
    return true;
  }

  private advanceEquilibriumFast(
    targetMicroseconds: number,
    internalTransferredGasesKg: GasMassesKg,
    retainedSensibleHeatFraction: number,
  ): void {
    const startMicroseconds = this.stateValue.elapsedMicroseconds;
    const deltaSeconds =
      (targetMicroseconds - startMicroseconds) / MICROSECONDS_PER_SECOND;
    const startTruth = new Map(
      this.stateValue.zones.map(
        (zone) => [zone.id, zoneTruth(zone)] as const,
      ),
    );
    const gasesBefore = gasesInZonesAndSinks(
      this.stateValue.zones,
      this.stateValue.sink,
      this.stateValue.airHandlers,
    );
    const metabolismBefore = cloneData(this.stateValue.metabolism);
    const zoneEnergiesJ = this.stateValue.zones.map((zone) =>
      applyMetabolism(
        zone,
        deltaSeconds,
        this.stateValue.metabolism,
        retainedSensibleHeatFraction,
      ),
    );
    const capturedByZone = this.captureCarbonDioxide(deltaSeconds);
    this.stateValue.zones.forEach((zone, index) => {
      zoneEnergiesJ[index] -=
        (capturedByZone.get(zone.id) ?? 0) *
        GAS_SPECIFIC_HEAT_J_PER_KG_K *
        zone.temperatureK;
    });

    for (const connection of this.stateValue.connections) {
      connection.lastForwardGrossMassFlowKgPerSecond = 0;
      connection.lastReverseGrossMassFlowKgPerSecond = 0;
      connection.lastSignedMassFlowKgPerSecond = 0;
    }

    for (const component of this.equilibriumComponents()) {
      const postTreatmentGases = new Map<number, GasMassesKg>();
      let totalEnergyJ = 0;
      let totalVolumeCubicMeters = 0;
      const componentGases = zeroGases();

      for (const index of component) {
        const zone = this.stateValue.zones[index];
        totalEnergyJ += zoneEnergiesJ[index];
        postTreatmentGases.set(index, cloneData(zone.gasesKg));
        addGases(componentGases, zone.gasesKg);
        totalVolumeCubicMeters += zone.volumeCubicMeters;
      }

      const componentMassKg = totalGasMass(componentGases);
      const commonTemperatureK =
        componentMassKg > MIN_GAS_MASS_KG
          ? totalEnergyJ /
            (componentMassKg * GAS_SPECIFIC_HEAT_J_PER_KG_K)
          : component.reduce(
              (total, index) =>
                total +
                this.stateValue.zones[index].temperatureK *
                  (this.stateValue.zones[index].volumeCubicMeters /
                    totalVolumeCubicMeters),
              0,
            );
      const assignedGases = zeroGases();

      component.forEach((index, componentIndex) => {
        const zone = this.stateValue.zones[index];
        const isLast = componentIndex === component.length - 1;
        const volumeShare =
          zone.volumeCubicMeters / totalVolumeCubicMeters;
        const nextGases = zeroGases();
        for (const gas of GAS_SPECIES) {
          nextGases[gas] = isLast
            ? componentGases[gas] - assignedGases[gas]
            : componentGases[gas] * volumeShare;
          assignedGases[gas] += nextGases[gas];
          const prior = (postTreatmentGases.get(index) as GasMassesKg)[gas];
          if (nextGases[gas] > prior) {
            internalTransferredGasesKg[gas] += nextGases[gas] - prior;
          }
        }
        zone.gasesKg = nextGases;
        zone.temperatureK = commonTemperatureK;
      });
    }

    assertSpeciesBalance(
      gasesBefore,
      gasesInZonesAndSinks(
        this.stateValue.zones,
        this.stateValue.sink,
        this.stateValue.airHandlers,
      ),
      differenceMetabolism(this.stateValue.metabolism, metabolismBefore),
    );
    this.stateValue.revision += 1;
    this.stateValue.elapsedMicroseconds = targetMicroseconds;

    const endTruth = new Map(
      this.stateValue.zones.map(
        (zone) => [zone.id, zoneTruth(zone)] as const,
      ),
    );
    this.compressSensorSamples(
      startMicroseconds,
      targetMicroseconds,
      startTruth,
      endTruth,
    );
  }

  private compressSensorSamples(
    startMicroseconds: number,
    endMicroseconds: number,
    startTruth: ReadonlyMap<ZoneId, ZoneTruth>,
    endTruth: ReadonlyMap<ZoneId, ZoneTruth>,
  ): void {
    const duration = endMicroseconds - startMicroseconds;
    for (const sensor of this.stateValue.sensors) {
      let latest = sensor.latest;
      const remainingPending: SensorReading[] = [];
      for (const reading of sensor.pending) {
        if (reading.availableAtMicroseconds <= endMicroseconds) {
          latest = reading;
        } else {
          remainingPending.push(reading);
        }
      }

      const firstSample = sensor.nextSampleMicroseconds;
      const sampleCount =
        firstSample <= endMicroseconds
          ? Math.floor(
              (endMicroseconds - firstSample) /
                sensor.sampleIntervalMicroseconds,
            ) + 1
          : 0;
      const lastDeliveredIndex = Math.min(
        sampleCount - 1,
        Math.floor(
          (endMicroseconds -
            sensor.delayMicroseconds -
            firstSample) /
            sensor.sampleIntervalMicroseconds,
        ),
      );
      const neededIndices: number[] = [];
      if (lastDeliveredIndex >= 0) neededIndices.push(lastDeliveredIndex);
      for (
        let index = Math.max(0, lastDeliveredIndex + 1);
        index < sampleCount;
        index += 1
      ) {
        neededIndices.push(index);
      }

      let consumedSamples = 0;
      for (const index of neededIndices) {
        skipNormalSamples(sensor, index - consumedSamples);
        const sampledAtMicroseconds =
          firstSample + index * sensor.sampleIntervalMicroseconds;
        const ratio =
          duration > 0
            ? (sampledAtMicroseconds - startMicroseconds) / duration
            : 1;
        const before = startTruth.get(sensor.zoneId);
        const after = endTruth.get(sensor.zoneId);
        if (!before || !after) {
          throw new Error(`sensor ${sensor.id} references an unknown zone`);
        }
        const trueValue =
          quantityTruth(before, sensor.quantity) +
          (quantityTruth(after, sensor.quantity) -
            quantityTruth(before, sensor.quantity)) *
            ratio;
        const reading = this.createSensorReading(
          sensor,
          sampledAtMicroseconds,
          trueValue,
        );
        if (reading.availableAtMicroseconds <= endMicroseconds) {
          latest = reading;
        } else {
          remainingPending.push(reading);
        }
        consumedSamples = index + 1;
      }
      skipNormalSamples(sensor, sampleCount - consumedSamples);
      sensor.nextSampleMicroseconds +=
        sampleCount * sensor.sampleIntervalMicroseconds;
      assertSafeMicroseconds(
        sensor.nextSampleMicroseconds,
        `${sensor.id}.nextSampleMicroseconds`,
      );
      remainingPending.sort(
        (left, right) =>
          left.availableAtMicroseconds - right.availableAtMicroseconds ||
          left.sampledAtMicroseconds - right.sampledAtMicroseconds,
      );
      sensor.pending = remainingPending;
      sensor.latest = latest;
    }
  }

  private advancePhysics(
    deltaSeconds: number,
    internalTransferredGasesKg: GasMassesKg,
    retainedSensibleHeatFraction: number,
  ): void {
    const zones = this.stateValue.zones;
    const gasesBefore = gasesInZonesAndSinks(
      zones,
      this.stateValue.sink,
      this.stateValue.airHandlers,
    );
    const metabolismBefore = cloneData(this.stateValue.metabolism);
    const zoneIndex = new Map(
      zones.map((zone, index) => [zone.id, index] as const),
    );
    const energyJ = zones.map(
      (zone) =>
        totalGasMass(zone.gasesKg) *
        GAS_SPECIFIC_HEAT_J_PER_KG_K *
        zone.temperatureK,
    );

    for (let index = 0; index < zones.length; index += 1) {
      energyJ[index] = applyMetabolism(
        zones[index],
        deltaSeconds,
        this.stateValue.metabolism,
        retainedSensibleHeatFraction,
      );
    }
    const capturedByZone = this.captureCarbonDioxide(deltaSeconds);
    for (let index = 0; index < zones.length; index += 1) {
      energyJ[index] -=
        (capturedByZone.get(zones[index].id) ?? 0) *
        GAS_SPECIFIC_HEAT_J_PER_KG_K *
        zones[index].temperatureK;
    }

    const truths = zones.map(zoneTruth);
    const requests: TransferRequest[] = [];
    for (
      let connectionIndex = 0;
      connectionIndex < this.stateValue.connections.length;
      connectionIndex += 1
    ) {
      const connection = this.stateValue.connections[connectionIndex];
      connection.lastForwardGrossMassFlowKgPerSecond = 0;
      connection.lastReverseGrossMassFlowKgPerSecond = 0;
      connection.lastSignedMassFlowKgPerSecond = 0;
      const opening = effectiveOpening(connection);
      if (opening <= 0 || connection.areaSquareMeters <= 0) continue;

      const indexA = zoneIndex.get(connection.zoneAId);
      const indexB = zoneIndex.get(connection.zoneBId);
      if (indexA === undefined || indexB === undefined) {
        throw new Error(`connection ${connection.id} references an unknown zone`);
      }
      const truthA = truths[indexA];
      const truthB = truths[indexB];
      const pressureDelta = truthA.pressurePa - truthB.pressurePa;
      if (pressureDelta !== 0) {
        const sourceIndex = pressureDelta > 0 ? indexA : indexB;
        const targetIndex = pressureDelta > 0 ? indexB : indexA;
        const sourceTruth = truths[sourceIndex];
        const rate = Math.min(
          connection.maxMassFlowKgPerSecond,
          connection.dischargeCoefficient *
            connection.areaSquareMeters *
            opening *
            Math.sqrt(
              2 *
                sourceTruth.densityKgPerCubicMeter *
                Math.abs(pressureDelta),
            ),
        );
        requests.push({
          sourceIndex,
          targetIndex,
          gasesKg: gasParcel(
            zones[sourceIndex].gasesKg,
            rate * deltaSeconds,
          ),
          sourceTemperatureK: zones[sourceIndex].temperatureK,
          connectionIndex,
          connectionDirection: pressureDelta > 0 ? 1 : -1,
        });
      }

      const mixingVolume =
        effectiveMixingConductance(
          connection,
          this.stateValue.airHandlers,
        ) *
        opening *
        deltaSeconds;
      if (mixingVolume > 0) {
        requests.push({
          sourceIndex: indexA,
          targetIndex: indexB,
          gasesKg: gasParcel(
            zones[indexA].gasesKg,
            mixingVolume * truthA.densityKgPerCubicMeter,
          ),
          sourceTemperatureK: zones[indexA].temperatureK,
          connectionIndex,
          connectionDirection: 1,
        });
        requests.push({
          sourceIndex: indexB,
          targetIndex: indexA,
          gasesKg: gasParcel(
            zones[indexB].gasesKg,
            mixingVolume * truthB.densityKgPerCubicMeter,
          ),
          sourceTemperatureK: zones[indexB].temperatureK,
          connectionIndex,
          connectionDirection: -1,
        });
      }
    }

    for (const breach of this.stateValue.breaches) {
      const sourceIndex = zoneIndex.get(breach.zoneId);
      if (sourceIndex === undefined) {
        throw new Error(`breach ${breach.id} references an unknown zone`);
      }
      const truth = truths[sourceIndex];
      const rate =
        breach.dischargeCoefficient *
        breach.areaSquareMeters *
        Math.sqrt(
          2 * truth.densityKgPerCubicMeter * truth.pressurePa,
        );
      requests.push({
        sourceIndex,
        targetIndex: null,
        gasesKg: gasParcel(
          zones[sourceIndex].gasesKg,
          rate * deltaSeconds,
        ),
        sourceTemperatureK: zones[sourceIndex].temperatureK,
        connectionIndex: null,
        connectionDirection: 0,
      });
    }

    const requestedOutboundKg = Array.from(
      { length: zones.length },
      () => 0,
    );
    for (const request of requests) {
      requestedOutboundKg[request.sourceIndex] += requestTotalMass(request);
    }
    const sourceScales = zones.map((zone, index) => {
      const requested = requestedOutboundKg[index];
      if (requested <= 0) return 1;
      const maximum =
        totalGasMass(zone.gasesKg) *
        MAX_SOURCE_DRAIN_FRACTION_PER_SUBSTEP;
      return Math.min(1, maximum / requested);
    });

    for (const request of requests) {
      const movedGases = scaleGases(
        request.gasesKg,
        sourceScales[request.sourceIndex],
      );
      const movedMass = totalGasMass(movedGases);
      if (movedMass <= 0) continue;

      subtractGases(zones[request.sourceIndex].gasesKg, movedGases);
      const movedEnergy =
        movedMass *
        GAS_SPECIFIC_HEAT_J_PER_KG_K *
        request.sourceTemperatureK;
      energyJ[request.sourceIndex] -= movedEnergy;

      if (request.targetIndex === null) {
        addGases(this.stateValue.sink.ventedGasesKg, movedGases);
        this.stateValue.sink.ventedThermalEnergyJ += movedEnergy;
      } else {
        addGases(zones[request.targetIndex].gasesKg, movedGases);
        energyJ[request.targetIndex] += movedEnergy;
        addGases(internalTransferredGasesKg, movedGases);
      }

      if (
        request.connectionIndex !== null &&
        request.connectionDirection !== 0
      ) {
        const connection =
          this.stateValue.connections[request.connectionIndex];
        const rate = movedMass / deltaSeconds;
        if (request.connectionDirection === 1) {
          connection.lastForwardGrossMassFlowKgPerSecond += rate;
        } else {
          connection.lastReverseGrossMassFlowKgPerSecond += rate;
        }
      }
    }

    for (const connection of this.stateValue.connections) {
      connection.lastSignedMassFlowKgPerSecond =
        connection.lastForwardGrossMassFlowKgPerSecond -
        connection.lastReverseGrossMassFlowKgPerSecond;
    }

    for (let index = 0; index < zones.length; index += 1) {
      const mass = totalGasMass(zones[index].gasesKg);
      if (mass > MIN_GAS_MASS_KG) {
        zones[index].temperatureK =
          energyJ[index] / (mass * GAS_SPECIFIC_HEAT_J_PER_KG_K);
      }
      assertPositive(zones[index].temperatureK, `${zones[index].id}.temperatureK`);
    }
    assertSpeciesBalance(
      gasesBefore,
      gasesInZonesAndSinks(
        zones,
        this.stateValue.sink,
        this.stateValue.airHandlers,
      ),
      differenceMetabolism(this.stateValue.metabolism, metabolismBefore),
    );
    this.stateValue.revision += 1;
  }

  private nextPendingAvailability(): number | undefined {
    let next: number | undefined;
    for (const sensor of this.stateValue.sensors) {
      const available = sensor.pending[0]?.availableAtMicroseconds;
      if (available !== undefined && (next === undefined || available < next)) {
        next = available;
      }
    }
    return next;
  }

  private createSensorReading(
    sensor: AtmosphereSensor,
    sampledAtMicroseconds: number,
    trueValue: number,
  ): SensorReading {
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
          (sampledAtMicroseconds / MICROSECONDS_PER_SECOND) +
        nextNormal(sensor) *
          sensor.noiseStandardDeviation *
          noiseMultiplier;
    }
    const reading: SensorReading = {
      sensorId: sensor.id,
      zoneId: sensor.zoneId,
      quantity: sensor.quantity,
      sampledAtMicroseconds,
      availableAtMicroseconds:
        sampledAtMicroseconds + sensor.delayMicroseconds,
      value,
      quality: sensor.condition,
    };
    assertSafeMicroseconds(
      reading.availableAtMicroseconds,
      `${sensor.id} reading availability`,
    );
    return reading;
  }

  private sampleDueSensors(): void {
    const now = this.stateValue.elapsedMicroseconds;
    for (const sensor of this.stateValue.sensors) {
      while (sensor.nextSampleMicroseconds <= now) {
        const sampledAtMicroseconds = sensor.nextSampleMicroseconds;
        const truth = zoneTruth(
          findById(this.stateValue.zones, sensor.zoneId, "zone"),
        );
        const trueValue = quantityTruth(truth, sensor.quantity);
        const reading = this.createSensorReading(
          sensor,
          sampledAtMicroseconds,
          trueValue,
        );
        sensor.pending.push(reading);
        sensor.pending.sort(
          (left, right) =>
            left.availableAtMicroseconds - right.availableAtMicroseconds ||
            left.sampledAtMicroseconds - right.sampledAtMicroseconds,
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
      let delivered: SensorReading | null = null;
      while (
        sensor.pending.length > 0 &&
        sensor.pending[0].availableAtMicroseconds <= now
      ) {
        delivered = sensor.pending.shift() as SensorReading;
      }
      if (delivered) sensor.latest = delivered;
    }
  }

  snapshot(): CompartmentNetworkSnapshot {
    return cloneData(this.stateValue);
  }

  serialize(): string {
    return JSON.stringify(this.stateValue);
  }

  static restore(
    source: string | CompartmentNetworkSnapshot,
  ): CompartmentAtmosphereNetwork {
    const parsed: unknown =
      typeof source === "string" ? JSON.parse(source) : cloneData(source);
    validateCompartmentSnapshot(parsed);
    const restored = new CompartmentAtmosphereNetwork({ seed: 0 });
    restored.stateValue = cloneData(parsed);
    return restored;
  }
}

export function sumZoneGases(
  zones: readonly PressureZone[],
): GasMassesKg {
  const total = zeroGases();
  for (const zone of zones) addGases(total, zone.gasesKg);
  return total;
}

export function sensorUnit(quantity: SensorQuantity): string {
  return SENSOR_UNITS[quantity];
}
