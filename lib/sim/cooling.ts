/**
 * Deterministic, reduced-order cooling and thermal network.
 *
 * The model deliberately keeps every effect causal:
 * - heat sources and pump work add joules to named thermal nodes;
 * - heat exchangers and coolant-to-panel links only move energy between nodes;
 * - radiator panels reject energy to an explicit deep-space heat sink;
 * - pump and conductance faults alter entity performance rather than directly
 *   changing a temperature;
 * - sensor observations are delayed, noisy, and independently fallible.
 *
 * Thermal nodes are perfectly mixed lumped masses with constant heat capacity.
 * Internal heat flow is evaluated on deterministic fixed boundaries and
 * limited to the two-node equilibrium energy, which prevents overshoot.
 * Radiation uses Stefan-Boltzmann emission over each fixed substep. This is a
 * compact engineering model, not a CFD solver, but its global energy ledger
 * closes to floating-point tolerance.
 */

export const COOLING_SNAPSHOT_VERSION = 5 as const;
export const COOLING_MICROSECONDS_PER_SECOND = 1_000_000;

export const COOLING_LOOP_IDS = ["loop-a", "loop-b"] as const;
export type CoolingLoopId = (typeof COOLING_LOOP_IDS)[number];

export const THERMAL_NODE_IDS = [
  "thermal-bus",
  "coolant-a",
  "coolant-b",
  "radiator-a",
  "radiator-b",
] as const;
export type ThermalNodeId = (typeof THERMAL_NODE_IDS)[number];

export const COOLANT_PUMP_IDS = ["pump-a", "pump-b"] as const;
export type CoolantPumpId = (typeof COOLANT_PUMP_IDS)[number];

export const HEAT_EXCHANGER_IDS = ["heat-exchanger-a", "heat-exchanger-b"] as const;
export type HeatExchangerId = (typeof HEAT_EXCHANGER_IDS)[number];

export const RADIATOR_IDS = ["radiator-wing-a", "radiator-wing-b"] as const;
export type RadiatorId = (typeof RADIATOR_IDS)[number];

export const HEAT_SOURCE_IDS = ["ship-service-thermal-load"] as const;
export type HeatSourceId = (typeof HEAT_SOURCE_IDS)[number];

export const EXTERNAL_THERMAL_SOURCE_IDS = [
  "propulsion",
  "jump-drive",
  "electrical-loss",
  "metabolic",
  "rotation-drive",
  "ship-services",
  "intervention",
] as const;
export type ExternalThermalSourceId =
  (typeof EXTERNAL_THERMAL_SOURCE_IDS)[number];
export type ExternalThermalEnergyBySourceJ = Record<
  ExternalThermalSourceId,
  number
>;

export type PumpCondition =
  | "nominal"
  | "degraded"
  | "stuck-off"
  | "stuck-on";
export type ConductanceCondition = "nominal" | "degraded" | "isolated";
export type RadiatorCondition = "nominal" | "degraded" | "stowed";
export type ThermalSensorCondition =
  | "nominal"
  | "degraded"
  | "stuck"
  | "offline";
export type ThermalSensorQuality = ThermalSensorCondition;
export type ThermalSensorQuantity =
  | "temperatureK"
  | "massFlowKgPerSecond"
  | "radiatedPowerW";

export interface ThermalNode {
  id: ThermalNodeId;
  label: string;
  temperatureK: number;
  heatCapacityJPerK: number;
}

export interface CoolingLoop {
  id: CoolingLoopId;
  label: string;
  pumpId: CoolantPumpId;
  heatExchangerId: HeatExchangerId;
  radiatorId: RadiatorId;
  coolantNodeId: ThermalNodeId;
  radiatorNodeId: ThermalNodeId;
}

export interface CoolantPump {
  id: CoolantPumpId;
  loopId: CoolingLoopId;
  nominalMassFlowKgPerSecond: number;
  coolantDensityKgPerCubicMeter: number;
  pressureRisePa: number;
  hydraulicEfficiency: number;
  commandedSpeedFraction: number;
  electricalSupplyFraction: number;
  condition: PumpCondition;
  lastMassFlowKgPerSecond: number;
  lastElectricalPowerW: number;
}

export interface HeatExchanger {
  id: HeatExchangerId;
  loopId: CoolingLoopId;
  hotNodeId: ThermalNodeId;
  coldNodeId: ThermalNodeId;
  nominalConductanceWPerK: number;
  conductanceFraction: number;
  condition: ConductanceCondition;
  lastHeatTransferW: number;
}

export interface SpaceRadiator {
  id: RadiatorId;
  loopId: CoolingLoopId;
  coolantNodeId: ThermalNodeId;
  panelNodeId: ThermalNodeId;
  nominalCoolantConductanceWPerK: number;
  coolantConductanceFraction: number;
  surfaceAreaSquareMeters: number;
  emissivity: number;
  viewFactorToSpace: number;
  deployedFraction: number;
  condition: RadiatorCondition;
  lastCoolantHeatTransferW: number;
  lastRadiatedPowerW: number;
}

export interface ThermalHeatSource {
  id: HeatSourceId;
  nodeId: ThermalNodeId;
  thermalPowerW: number;
  enabled: boolean;
  lastAppliedPowerW: number;
}

export interface ThermalSensorReading {
  sensorId: string;
  targetId: string;
  quantity: ThermalSensorQuantity;
  sampledAtMicroseconds: number;
  availableAtMicroseconds: number;
  value: number | null;
  quality: ThermalSensorQuality;
}

export interface ThermalSensor {
  id: string;
  targetId: string;
  quantity: ThermalSensorQuantity;
  sampleIntervalMicroseconds: number;
  delayMicroseconds: number;
  noiseStandardDeviation: number;
  bias: number;
  driftPerSecond: number;
  condition: ThermalSensorCondition;
  stuckValue: number | null;
  nextSampleMicroseconds: number;
  randomState: number;
  spareNormal: number | null;
  pending: ThermalSensorReading[];
  latest: ThermalSensorReading | null;
}

export interface ThermalEnergyLedger {
  initialNodeThermalEnergyJ: number;
  heatSourceInputJ: number;
  pumpWorkInputJ: number;
  radiatedToSpaceJ: number;
  externalEnergyJ: number;
  externalEnergyBySourceJ: ExternalThermalEnergyBySourceJ;
  numericalResidualJ: number;
}

export interface CoolingNetworkSnapshot {
  snapshotVersion: typeof COOLING_SNAPSHOT_VERSION;
  elapsedMicroseconds: number;
  revision: number;
  externalSpaceTemperatureK: number;
  loops: CoolingLoop[];
  nodes: ThermalNode[];
  pumps: CoolantPump[];
  heatExchangers: HeatExchanger[];
  radiators: SpaceRadiator[];
  heatSources: ThermalHeatSource[];
  sensors: ThermalSensor[];
  ledger: ThermalEnergyLedger;
}

export interface CoolingNetworkOptions {
  seed?: number | string;
}

export interface CoolingStepResult {
  fromMicroseconds: number;
  toMicroseconds: number;
  simulatedSeconds: number;
  substeps: number;
  heatSourceInputJ: number;
  pumpWorkInputJ: number;
  radiatedToSpaceJ: number;
  nodeThermalEnergyChangeJ: number;
  energyClosureErrorJ: number;
  revision: number;
}

export interface CoolingEnergyBalance {
  nodeThermalEnergyJ: number;
  ledgerExpectedNodeThermalEnergyJ: number;
  closureErrorJ: number;
  heatSourceInputJ: number;
  pumpWorkInputJ: number;
  radiatedToSpaceJ: number;
  externalEnergyJ: number;
  externalEnergyBySourceJ: ExternalThermalEnergyBySourceJ;
  numericalResidualJ: number;
}

export interface ThermalNodeTemperatureOverride {
  nodeId: ThermalNodeId;
  temperatureK: number;
}

export interface ExternalThermalEnergyResult {
  appliedEnergyJ: number;
  affectedNodeIds: ThermalNodeId[];
  revision: number;
}

export interface CoolingNetworkSummary {
  thermalBusTemperatureK: number;
  averageCoolantTemperatureK: number;
  hottestNodeTemperatureK: number;
  totalMassFlowKgPerSecond: number;
  totalRadiatedPowerW: number;
  activeLoopCount: number;
  energyClosureErrorJ: number;
}

export type CoolantPumpPatch = Partial<
  Pick<
    CoolantPump,
    | "nominalMassFlowKgPerSecond"
    | "coolantDensityKgPerCubicMeter"
    | "pressureRisePa"
    | "hydraulicEfficiency"
    | "commandedSpeedFraction"
    | "condition"
  >
>;

export type HeatExchangerPatch = Partial<
  Pick<
    HeatExchanger,
    "nominalConductanceWPerK" | "conductanceFraction" | "condition"
  >
>;

export type SpaceRadiatorPatch = Partial<
  Pick<
    SpaceRadiator,
    | "nominalCoolantConductanceWPerK"
    | "coolantConductanceFraction"
    | "surfaceAreaSquareMeters"
    | "emissivity"
    | "viewFactorToSpace"
    | "deployedFraction"
    | "condition"
  >
>;

export type ThermalHeatSourcePatch = Partial<
  Pick<ThermalHeatSource, "thermalPowerW" | "enabled">
>;

export type ThermalSensorPatch = Partial<
  Pick<
    ThermalSensor,
    | "sampleIntervalMicroseconds"
    | "delayMicroseconds"
    | "noiseStandardDeviation"
    | "bias"
    | "driftPerSecond"
    | "condition"
    | "stuckValue"
  >
>;

const STEFAN_BOLTZMANN_W_PER_M2_K4 = 5.670_374_419e-8;
const DEFAULT_SPACE_TEMPERATURE_K = 3;
const MAX_PHYSICS_SUBSTEP_MICROSECONDS = 5 * COOLING_MICROSECONDS_PER_SECOND;
const MIN_SENSOR_INTERVAL_MICROSECONDS = 100_000;
const MAX_SENSOR_DELAY_MICROSECONDS =
  3_600 * COOLING_MICROSECONDS_PER_SECOND;
const NATURAL_CIRCULATION_FRACTION = 0.03;
const MAX_CONDUCTANCE_W_PER_K = 10_000_000;
const MAX_TEMPERATURE_K = 5_000;
const MAX_THERMAL_POWER_W = 10_000_000_000;

const BASELINE_SENSOR_SPECS: readonly Readonly<{
  id: string;
  targetId: string;
  quantity: ThermalSensorQuantity;
  noiseStandardDeviation: number;
}>[] = Object.freeze([
  ...THERMAL_NODE_IDS.map((targetId) => ({
    id: `sensor:${targetId}:temperatureK`,
    targetId,
    quantity: "temperatureK" as const,
    noiseStandardDeviation: 0.04,
  })),
  ...COOLANT_PUMP_IDS.map((targetId) => ({
    id: `sensor:${targetId}:massFlowKgPerSecond`,
    targetId,
    quantity: "massFlowKgPerSecond" as const,
    noiseStandardDeviation: 0.2,
  })),
  ...RADIATOR_IDS.map((targetId) => ({
    id: `sensor:${targetId}:radiatedPowerW`,
    targetId,
    quantity: "radiatedPowerW" as const,
    noiseStandardDeviation: 8_000,
  })),
]);

const BASELINE_SENSOR_IDS = Object.freeze(
  BASELINE_SENSOR_SPECS.map((specification) => specification.id),
);

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
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has unexpected keys: ${actual.join(", ")}`);
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
  if (value < 0) throw new RangeError(`${label} cannot be negative`);
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

function assertEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): asserts value is T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new TypeError(`${label} has an unsupported value`);
  }
}

function assertIdentifierSequence<T extends { id: string }>(
  values: readonly T[],
  expectedIds: readonly string[],
  label: string,
): void {
  if (values.length !== expectedIds.length) {
    throw new Error(`${label} must contain exactly ${expectedIds.length} entities`);
  }
  values.forEach((value, index) => {
    if (value.id !== expectedIds[index]) {
      throw new Error(
        `${label}[${index}].id must be ${expectedIds[index]}, received ${value.id}`,
      );
    }
  });
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

function nextUniform(sensor: ThermalSensor): number {
  sensor.randomState = (sensor.randomState + 0x6d2b79f5) >>> 0;
  let value = sensor.randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}

function nextNormal(sensor: ThermalSensor): number {
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

function findById<T extends { id: string }>(
  entities: readonly T[],
  id: string,
  label: string,
): T {
  const entity = entities.find((candidate) => candidate.id === id);
  if (!entity) throw new Error(`unknown ${label} id: ${id}`);
  return entity;
}

function totalNodeThermalEnergy(nodes: readonly ThermalNode[]): number {
  return nodes.reduce(
    (total, node) => total + node.heatCapacityJPerK * node.temperatureK,
    0,
  );
}

function effectivePumpSpeed(pump: CoolantPump): number {
  let mechanicalSpeedFraction: number;
  switch (pump.condition) {
    case "nominal":
      mechanicalSpeedFraction = pump.commandedSpeedFraction;
      break;
    case "degraded":
      mechanicalSpeedFraction = pump.commandedSpeedFraction * 0.35;
      break;
    case "stuck-off":
      mechanicalSpeedFraction = 0;
      break;
    case "stuck-on":
      mechanicalSpeedFraction = 1;
      break;
  }
  return mechanicalSpeedFraction * pump.electricalSupplyFraction;
}

function pumpOperatingPoint(pump: CoolantPump): {
  massFlowKgPerSecond: number;
  electricalPowerW: number;
} {
  const speed = effectivePumpSpeed(pump);
  const massFlowKgPerSecond = pump.nominalMassFlowKgPerSecond * speed;
  const volumeFlowCubicMetersPerSecond =
    massFlowKgPerSecond / pump.coolantDensityKgPerCubicMeter;
  const hydraulicPowerW =
    pump.pressureRisePa * volumeFlowCubicMetersPerSecond * speed * speed;
  return {
    massFlowKgPerSecond,
    electricalPowerW:
      hydraulicPowerW > 0 ? hydraulicPowerW / pump.hydraulicEfficiency : 0,
  };
}

function flowConductanceFraction(pump: CoolantPump): number {
  const operatingPoint = pumpOperatingPoint(pump);
  const forcedFraction =
    pump.nominalMassFlowKgPerSecond > 0
      ? Math.min(
          1,
          operatingPoint.massFlowKgPerSecond /
            pump.nominalMassFlowKgPerSecond,
        )
      : 0;
  return (
    NATURAL_CIRCULATION_FRACTION +
    (1 - NATURAL_CIRCULATION_FRACTION) * forcedFraction
  );
}

function conductanceConditionFraction(
  condition: ConductanceCondition,
): number {
  switch (condition) {
    case "nominal":
      return 1;
    case "degraded":
      return 0.2;
    case "isolated":
      return 0;
  }
}

function radiatorConditionFractions(
  condition: RadiatorCondition,
): { coolant: number; emittingArea: number } {
  switch (condition) {
    case "nominal":
      return { coolant: 1, emittingArea: 1 };
    case "degraded":
      return { coolant: 0.35, emittingArea: 0.45 };
    case "stowed":
      return { coolant: 0.05, emittingArea: 0.02 };
  }
}

function limitedPairwiseEnergyJ(
  first: ThermalNode,
  second: ThermalNode,
  conductanceWPerK: number,
  deltaSeconds: number,
): number {
  if (conductanceWPerK <= 0 || deltaSeconds <= 0) return 0;
  const temperatureDifferenceK =
    first.temperatureK - second.temperatureK;
  if (temperatureDifferenceK === 0) return 0;
  const requestedEnergyJ =
    conductanceWPerK * temperatureDifferenceK * deltaSeconds;
  const equilibriumEnergyMagnitudeJ =
    Math.abs(temperatureDifferenceK) /
    (1 / first.heatCapacityJPerK + 1 / second.heatCapacityJPerK);
  return (
    Math.sign(requestedEnergyJ) *
    Math.min(Math.abs(requestedEnergyJ), equilibriumEnergyMagnitudeJ)
  );
}

function radiatedPowerW(
  radiator: SpaceRadiator,
  panelTemperatureK: number,
  externalSpaceTemperatureK: number,
): number {
  const condition = radiatorConditionFractions(radiator.condition);
  const temperatureTerm =
    panelTemperatureK ** 4 - externalSpaceTemperatureK ** 4;
  if (temperatureTerm <= 0) return 0;
  return (
    STEFAN_BOLTZMANN_W_PER_M2_K4 *
    radiator.emissivity *
    radiator.surfaceAreaSquareMeters *
    radiator.viewFactorToSpace *
    radiator.deployedFraction *
    condition.emittingArea *
    temperatureTerm
  );
}

function makeBaselineNodes(): ThermalNode[] {
  return [
    {
      id: "thermal-bus",
      label: "船体主热汇流排",
      temperatureK: 330,
      heatCapacityJPerK: 30_000_000_000,
    },
    {
      id: "coolant-a",
      label: "A 回路冷却剂",
      temperatureK: 318,
      heatCapacityJPerK: 2_000_000_000,
    },
    {
      id: "coolant-b",
      label: "B 回路冷却剂",
      temperatureK: 318,
      heatCapacityJPerK: 2_000_000_000,
    },
    {
      id: "radiator-a",
      label: "A 翼散热面板",
      temperatureK: 310,
      heatCapacityJPerK: 1_000_000_000,
    },
    {
      id: "radiator-b",
      label: "B 翼散热面板",
      temperatureK: 310,
      heatCapacityJPerK: 1_000_000_000,
    },
  ];
}

function makeBaselineLoops(): CoolingLoop[] {
  return [
    {
      id: "loop-a",
      label: "主冷却回路 A",
      pumpId: "pump-a",
      heatExchangerId: "heat-exchanger-a",
      radiatorId: "radiator-wing-a",
      coolantNodeId: "coolant-a",
      radiatorNodeId: "radiator-a",
    },
    {
      id: "loop-b",
      label: "主冷却回路 B",
      pumpId: "pump-b",
      heatExchangerId: "heat-exchanger-b",
      radiatorId: "radiator-wing-b",
      coolantNodeId: "coolant-b",
      radiatorNodeId: "radiator-b",
    },
  ];
}

function makeBaselinePumps(): CoolantPump[] {
  const pumps: CoolantPump[] = COOLING_LOOP_IDS.map((loopId, index) => ({
    id: COOLANT_PUMP_IDS[index],
    loopId,
    nominalMassFlowKgPerSecond: 400,
    coolantDensityKgPerCubicMeter: 1_000,
    pressureRisePa: 300_000,
    hydraulicEfficiency: 0.78,
    commandedSpeedFraction: 1,
    electricalSupplyFraction: 1,
    condition: "nominal",
    lastMassFlowKgPerSecond: 0,
    lastElectricalPowerW: 0,
  }));
  for (const pump of pumps) {
    const point = pumpOperatingPoint(pump);
    pump.lastMassFlowKgPerSecond = point.massFlowKgPerSecond;
    pump.lastElectricalPowerW = point.electricalPowerW;
  }
  return pumps;
}

function makeBaselineHeatExchangers(): HeatExchanger[] {
  return COOLING_LOOP_IDS.map((loopId, index) => ({
    id: HEAT_EXCHANGER_IDS[index],
    loopId,
    hotNodeId: "thermal-bus",
    coldNodeId: THERMAL_NODE_IDS[index + 1],
    nominalConductanceWPerK: 2_400_000,
    conductanceFraction: 1,
    condition: "nominal",
    lastHeatTransferW: 28_800_000,
  }));
}

function makeBaselineRadiators(): SpaceRadiator[] {
  return COOLING_LOOP_IDS.map((loopId, index) => ({
    id: RADIATOR_IDS[index],
    loopId,
    coolantNodeId: THERMAL_NODE_IDS[index + 1],
    panelNodeId: THERMAL_NODE_IDS[index + 3],
    nominalCoolantConductanceWPerK: 3_600_000,
    coolantConductanceFraction: 1,
    surfaceAreaSquareMeters: 65_000,
    emissivity: 0.88,
    viewFactorToSpace: 0.96,
    deployedFraction: 1,
    condition: "nominal",
    lastCoolantHeatTransferW: 28_800_000,
    lastRadiatedPowerW: 0,
  }));
}

function makeBaselineSensors(seed: number): ThermalSensor[] {
  return BASELINE_SENSOR_SPECS.map((specification) => ({
    id: specification.id,
    targetId: specification.targetId,
    quantity: specification.quantity,
    sampleIntervalMicroseconds: 5 * COOLING_MICROSECONDS_PER_SECOND,
    delayMicroseconds: 2 * COOLING_MICROSECONDS_PER_SECOND,
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

function makeEmptyExternalThermalEnergyBySource(): ExternalThermalEnergyBySourceJ {
  return {
    propulsion: 0,
    "jump-drive": 0,
    "electrical-loss": 0,
    metabolic: 0,
    "rotation-drive": 0,
    "ship-services": 0,
    intervention: 0,
  };
}

function totalClassifiedExternalEnergyJ(
  bySource: ExternalThermalEnergyBySourceJ,
): number {
  return EXTERNAL_THERMAL_SOURCE_IDS.reduce(
    (total, sourceId) => total + bySource[sourceId],
    0,
  );
}

export function createBaselineCoolingSnapshot(
  options: CoolingNetworkOptions = {},
): CoolingNetworkSnapshot {
  const seed = hashSeed(options.seed ?? "far-horizon-cooling");
  const nodes = makeBaselineNodes();
  const radiators = makeBaselineRadiators();
  for (const radiator of radiators) {
    const panel = findById(nodes, radiator.panelNodeId, "thermal node");
    radiator.lastRadiatedPowerW = radiatedPowerW(
      radiator,
      panel.temperatureK,
      DEFAULT_SPACE_TEMPERATURE_K,
    );
  }
  return {
    snapshotVersion: COOLING_SNAPSHOT_VERSION,
    elapsedMicroseconds: 0,
    revision: 0,
    externalSpaceTemperatureK: DEFAULT_SPACE_TEMPERATURE_K,
    loops: makeBaselineLoops(),
    nodes,
    pumps: makeBaselinePumps(),
    heatExchangers: makeBaselineHeatExchangers(),
    radiators,
    heatSources: [
      {
        id: "ship-service-thermal-load",
        nodeId: "thermal-bus",
        thermalPowerW: 57_200_000,
        enabled: true,
        lastAppliedPowerW: 57_200_000,
      },
    ],
    sensors: makeBaselineSensors(seed),
    ledger: {
      initialNodeThermalEnergyJ: totalNodeThermalEnergy(nodes),
      heatSourceInputJ: 0,
      pumpWorkInputJ: 0,
      radiatedToSpaceJ: 0,
      externalEnergyJ: 0,
      externalEnergyBySourceJ: makeEmptyExternalThermalEnergyBySource(),
      numericalResidualJ: 0,
    },
  };
}

function validateNode(value: unknown, expectedId: string, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    ["id", "label", "temperatureK", "heatCapacityJPerK"],
    label,
  );
  if (value.id !== expectedId) {
    throw new Error(`${label}.id must be ${expectedId}`);
  }
  assertNonEmptyString(value.label, `${label}.label`);
  assertPositive(value.temperatureK, `${label}.temperatureK`);
  if (value.temperatureK > MAX_TEMPERATURE_K) {
    throw new RangeError(`${label}.temperatureK exceeds the model limit`);
  }
  assertPositive(value.heatCapacityJPerK, `${label}.heatCapacityJPerK`);
}

function validateLoop(value: unknown, expected: CoolingLoop, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "label",
      "pumpId",
      "heatExchangerId",
      "radiatorId",
      "coolantNodeId",
      "radiatorNodeId",
    ],
    label,
  );
  for (const key of [
    "id",
    "pumpId",
    "heatExchangerId",
    "radiatorId",
    "coolantNodeId",
    "radiatorNodeId",
  ] as const) {
    if (value[key] !== expected[key]) {
      throw new Error(`${label}.${key} must be ${expected[key]}`);
    }
  }
  assertNonEmptyString(value.label, `${label}.label`);
}

function validatePump(value: unknown, expectedId: string, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "loopId",
      "nominalMassFlowKgPerSecond",
      "coolantDensityKgPerCubicMeter",
      "pressureRisePa",
      "hydraulicEfficiency",
      "commandedSpeedFraction",
      "electricalSupplyFraction",
      "condition",
      "lastMassFlowKgPerSecond",
      "lastElectricalPowerW",
    ],
    label,
  );
  if (value.id !== expectedId) throw new Error(`${label}.id must be ${expectedId}`);
  assertEnum(value.loopId, COOLING_LOOP_IDS, `${label}.loopId`);
  assertPositive(
    value.nominalMassFlowKgPerSecond,
    `${label}.nominalMassFlowKgPerSecond`,
  );
  assertPositive(
    value.coolantDensityKgPerCubicMeter,
    `${label}.coolantDensityKgPerCubicMeter`,
  );
  assertNonNegative(value.pressureRisePa, `${label}.pressureRisePa`);
  assertFraction(value.hydraulicEfficiency, `${label}.hydraulicEfficiency`);
  if (value.hydraulicEfficiency === 0) {
    throw new RangeError(`${label}.hydraulicEfficiency must be greater than zero`);
  }
  assertFraction(
    value.commandedSpeedFraction,
    `${label}.commandedSpeedFraction`,
  );
  assertFraction(
    value.electricalSupplyFraction,
    `${label}.electricalSupplyFraction`,
  );
  assertEnum(
    value.condition,
    ["nominal", "degraded", "stuck-off", "stuck-on"],
    `${label}.condition`,
  );
  assertNonNegative(
    value.lastMassFlowKgPerSecond,
    `${label}.lastMassFlowKgPerSecond`,
  );
  assertNonNegative(
    value.lastElectricalPowerW,
    `${label}.lastElectricalPowerW`,
  );
}

function validateHeatExchanger(
  value: unknown,
  expected: HeatExchanger,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "loopId",
      "hotNodeId",
      "coldNodeId",
      "nominalConductanceWPerK",
      "conductanceFraction",
      "condition",
      "lastHeatTransferW",
    ],
    label,
  );
  for (const key of ["id", "loopId", "hotNodeId", "coldNodeId"] as const) {
    if (value[key] !== expected[key]) {
      throw new Error(`${label}.${key} must be ${expected[key]}`);
    }
  }
  assertNonNegative(
    value.nominalConductanceWPerK,
    `${label}.nominalConductanceWPerK`,
  );
  if (value.nominalConductanceWPerK > MAX_CONDUCTANCE_W_PER_K) {
    throw new RangeError(`${label}.nominalConductanceWPerK exceeds model limit`);
  }
  assertFraction(value.conductanceFraction, `${label}.conductanceFraction`);
  assertEnum(
    value.condition,
    ["nominal", "degraded", "isolated"],
    `${label}.condition`,
  );
  assertFinite(value.lastHeatTransferW, `${label}.lastHeatTransferW`);
}

function validateRadiator(
  value: unknown,
  expected: SpaceRadiator,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "id",
      "loopId",
      "coolantNodeId",
      "panelNodeId",
      "nominalCoolantConductanceWPerK",
      "coolantConductanceFraction",
      "surfaceAreaSquareMeters",
      "emissivity",
      "viewFactorToSpace",
      "deployedFraction",
      "condition",
      "lastCoolantHeatTransferW",
      "lastRadiatedPowerW",
    ],
    label,
  );
  for (const key of [
    "id",
    "loopId",
    "coolantNodeId",
    "panelNodeId",
  ] as const) {
    if (value[key] !== expected[key]) {
      throw new Error(`${label}.${key} must be ${expected[key]}`);
    }
  }
  assertNonNegative(
    value.nominalCoolantConductanceWPerK,
    `${label}.nominalCoolantConductanceWPerK`,
  );
  if (value.nominalCoolantConductanceWPerK > MAX_CONDUCTANCE_W_PER_K) {
    throw new RangeError(
      `${label}.nominalCoolantConductanceWPerK exceeds model limit`,
    );
  }
  assertFraction(
    value.coolantConductanceFraction,
    `${label}.coolantConductanceFraction`,
  );
  assertPositive(value.surfaceAreaSquareMeters, `${label}.surfaceAreaSquareMeters`);
  assertFraction(value.emissivity, `${label}.emissivity`);
  assertFraction(value.viewFactorToSpace, `${label}.viewFactorToSpace`);
  assertFraction(value.deployedFraction, `${label}.deployedFraction`);
  assertEnum(
    value.condition,
    ["nominal", "degraded", "stowed"],
    `${label}.condition`,
  );
  assertFinite(
    value.lastCoolantHeatTransferW,
    `${label}.lastCoolantHeatTransferW`,
  );
  assertNonNegative(value.lastRadiatedPowerW, `${label}.lastRadiatedPowerW`);
}

function validateHeatSource(
  value: unknown,
  expected: ThermalHeatSource,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    ["id", "nodeId", "thermalPowerW", "enabled", "lastAppliedPowerW"],
    label,
  );
  if (value.id !== expected.id) throw new Error(`${label}.id must be ${expected.id}`);
  if (value.nodeId !== expected.nodeId) {
    throw new Error(`${label}.nodeId must be ${expected.nodeId}`);
  }
  assertNonNegative(value.thermalPowerW, `${label}.thermalPowerW`);
  if (value.thermalPowerW > MAX_THERMAL_POWER_W) {
    throw new RangeError(`${label}.thermalPowerW exceeds model limit`);
  }
  if (typeof value.enabled !== "boolean") {
    throw new TypeError(`${label}.enabled must be a boolean`);
  }
  assertNonNegative(value.lastAppliedPowerW, `${label}.lastAppliedPowerW`);
}

function validateReading(
  value: unknown,
  sensorIdentity: Readonly<
    Pick<ThermalSensor, "id" | "targetId" | "quantity">
  >,
  label: string,
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
  if (value.sensorId !== sensorIdentity.id) {
    throw new Error(`${label}.sensorId does not match its sensor`);
  }
  if (value.targetId !== sensorIdentity.targetId) {
    throw new Error(`${label}.targetId does not match its sensor`);
  }
  if (value.quantity !== sensorIdentity.quantity) {
    throw new Error(`${label}.quantity does not match its sensor`);
  }
  assertSafeMicroseconds(value.sampledAtMicroseconds, `${label}.sampledAtMicroseconds`);
  assertSafeMicroseconds(
    value.availableAtMicroseconds,
    `${label}.availableAtMicroseconds`,
  );
  if (value.availableAtMicroseconds < value.sampledAtMicroseconds) {
    throw new RangeError(`${label} cannot be available before it is sampled`);
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
  expected: Readonly<{
    id: string;
    targetId: string;
    quantity: ThermalSensorQuantity;
  }>,
  elapsedMicroseconds: number,
  label: string,
): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
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
  for (const key of ["id", "targetId", "quantity"] as const) {
    if (value[key] !== expected[key]) {
      throw new Error(`${label}.${key} must be ${expected[key]}`);
    }
  }
  assertSafeMicroseconds(
    value.sampleIntervalMicroseconds,
    `${label}.sampleIntervalMicroseconds`,
  );
  if (value.sampleIntervalMicroseconds < MIN_SENSOR_INTERVAL_MICROSECONDS) {
    throw new RangeError(`${label}.sampleIntervalMicroseconds is too short`);
  }
  assertSafeMicroseconds(value.delayMicroseconds, `${label}.delayMicroseconds`);
  if (value.delayMicroseconds > MAX_SENSOR_DELAY_MICROSECONDS) {
    throw new RangeError(`${label}.delayMicroseconds exceeds the model limit`);
  }
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
  assertSafeMicroseconds(
    value.nextSampleMicroseconds,
    `${label}.nextSampleMicroseconds`,
  );
  if (value.nextSampleMicroseconds < elapsedMicroseconds) {
    throw new Error(`${label}.nextSampleMicroseconds is in the past`);
  }
  if (
    typeof value.randomState !== "number" ||
    !Number.isSafeInteger(value.randomState) ||
    value.randomState < 0 ||
    value.randomState > 0xffff_ffff
  ) {
    throw new RangeError(`${label}.randomState must be an unsigned 32-bit integer`);
  }
  if (value.spareNormal !== null) {
    assertFinite(value.spareNormal, `${label}.spareNormal`);
  }
  if (!Array.isArray(value.pending)) {
    throw new TypeError(`${label}.pending must be an array`);
  }
  const identity = {
    id: value.id,
    targetId: value.targetId,
    quantity: value.quantity,
  } as Pick<ThermalSensor, "id" | "targetId" | "quantity">;
  value.pending.forEach((reading, index) =>
    validateReading(reading, identity, `${label}.pending[${index}]`),
  );
  for (let index = 1; index < value.pending.length; index += 1) {
    const previous = value.pending[index - 1] as ThermalSensorReading;
    const current = value.pending[index] as ThermalSensorReading;
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
      (value.latest as ThermalSensorReading).availableAtMicroseconds >
      elapsedMicroseconds
    ) {
      throw new Error(`${label}.latest is not available yet`);
    }
  }
}

function validateLedger(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "initialNodeThermalEnergyJ",
      "heatSourceInputJ",
      "pumpWorkInputJ",
      "radiatedToSpaceJ",
      "externalEnergyJ",
      "externalEnergyBySourceJ",
      "numericalResidualJ",
    ],
    label,
  );
  assertPositive(
    value.initialNodeThermalEnergyJ,
    `${label}.initialNodeThermalEnergyJ`,
  );
  assertNonNegative(value.heatSourceInputJ, `${label}.heatSourceInputJ`);
  assertNonNegative(value.pumpWorkInputJ, `${label}.pumpWorkInputJ`);
  assertNonNegative(value.radiatedToSpaceJ, `${label}.radiatedToSpaceJ`);
  assertFinite(value.externalEnergyJ, `${label}.externalEnergyJ`);
  assertRecord(
    value.externalEnergyBySourceJ,
    `${label}.externalEnergyBySourceJ`,
  );
  assertExactKeys(
    value.externalEnergyBySourceJ,
    EXTERNAL_THERMAL_SOURCE_IDS,
    `${label}.externalEnergyBySourceJ`,
  );
  let classifiedExternalEnergyJ = 0;
  for (const sourceId of EXTERNAL_THERMAL_SOURCE_IDS) {
    const sourceEnergyJ = value.externalEnergyBySourceJ[sourceId];
    assertFinite(
      sourceEnergyJ,
      `${label}.externalEnergyBySourceJ.${sourceId}`,
    );
    classifiedExternalEnergyJ += sourceEnergyJ;
  }
  const classificationToleranceJ = Math.max(
    1e-6,
    Math.max(
      Math.abs(value.externalEnergyJ),
      Math.abs(classifiedExternalEnergyJ),
    ) *
      Number.EPSILON *
      EXTERNAL_THERMAL_SOURCE_IDS.length *
      8,
  );
  if (
    Math.abs(classifiedExternalEnergyJ - value.externalEnergyJ) >
    classificationToleranceJ
  ) {
    throw new Error(
      `${label}.externalEnergyBySourceJ does not reconcile with externalEnergyJ`,
    );
  }
  assertFinite(value.numericalResidualJ, `${label}.numericalResidualJ`);
}

export function validateCoolingSnapshot(
  value: unknown,
): asserts value is CoolingNetworkSnapshot {
  assertRecord(value, "snapshot");
  assertExactKeys(
    value,
    [
      "snapshotVersion",
      "elapsedMicroseconds",
      "revision",
      "externalSpaceTemperatureK",
      "loops",
      "nodes",
      "pumps",
      "heatExchangers",
      "radiators",
      "heatSources",
      "sensors",
      "ledger",
    ],
    "snapshot",
  );
  if (value.snapshotVersion !== COOLING_SNAPSHOT_VERSION) {
    throw new Error("unsupported cooling snapshot version");
  }
  assertSafeMicroseconds(value.elapsedMicroseconds, "snapshot.elapsedMicroseconds");
  if (
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  ) {
    throw new RangeError("snapshot.revision must be a non-negative safe integer");
  }
  assertPositive(
    value.externalSpaceTemperatureK,
    "snapshot.externalSpaceTemperatureK",
  );
  if (value.externalSpaceTemperatureK > 1_000) {
    throw new RangeError("snapshot.externalSpaceTemperatureK exceeds model limit");
  }

  if (!Array.isArray(value.nodes)) {
    throw new TypeError("snapshot.nodes must be an array");
  }
  assertIdentifierSequence(
    value.nodes as ThermalNode[],
    THERMAL_NODE_IDS,
    "snapshot.nodes",
  );
  value.nodes.forEach((node, index) =>
    validateNode(node, THERMAL_NODE_IDS[index], `snapshot.nodes[${index}]`),
  );

  const baselineLoops = makeBaselineLoops();
  if (!Array.isArray(value.loops)) {
    throw new TypeError("snapshot.loops must be an array");
  }
  assertIdentifierSequence(
    value.loops as CoolingLoop[],
    COOLING_LOOP_IDS,
    "snapshot.loops",
  );
  value.loops.forEach((loop, index) =>
    validateLoop(loop, baselineLoops[index], `snapshot.loops[${index}]`),
  );

  if (!Array.isArray(value.pumps)) {
    throw new TypeError("snapshot.pumps must be an array");
  }
  assertIdentifierSequence(
    value.pumps as CoolantPump[],
    COOLANT_PUMP_IDS,
    "snapshot.pumps",
  );
  value.pumps.forEach((pump, index) =>
    validatePump(pump, COOLANT_PUMP_IDS[index], `snapshot.pumps[${index}]`),
  );

  const baselineExchangers = makeBaselineHeatExchangers();
  if (!Array.isArray(value.heatExchangers)) {
    throw new TypeError("snapshot.heatExchangers must be an array");
  }
  assertIdentifierSequence(
    value.heatExchangers as HeatExchanger[],
    HEAT_EXCHANGER_IDS,
    "snapshot.heatExchangers",
  );
  value.heatExchangers.forEach((exchanger, index) =>
    validateHeatExchanger(
      exchanger,
      baselineExchangers[index],
      `snapshot.heatExchangers[${index}]`,
    ),
  );

  const baselineRadiators = makeBaselineRadiators();
  if (!Array.isArray(value.radiators)) {
    throw new TypeError("snapshot.radiators must be an array");
  }
  assertIdentifierSequence(
    value.radiators as SpaceRadiator[],
    RADIATOR_IDS,
    "snapshot.radiators",
  );
  value.radiators.forEach((radiator, index) =>
    validateRadiator(
      radiator,
      baselineRadiators[index],
      `snapshot.radiators[${index}]`,
    ),
  );

  const baselineSources = createBaselineCoolingSnapshotForValidation().heatSources;
  if (!Array.isArray(value.heatSources)) {
    throw new TypeError("snapshot.heatSources must be an array");
  }
  assertIdentifierSequence(
    value.heatSources as ThermalHeatSource[],
    HEAT_SOURCE_IDS,
    "snapshot.heatSources",
  );
  value.heatSources.forEach((source, index) =>
    validateHeatSource(
      source,
      baselineSources[index],
      `snapshot.heatSources[${index}]`,
    ),
  );

  if (!Array.isArray(value.sensors)) {
    throw new TypeError("snapshot.sensors must be an array");
  }
  assertIdentifierSequence(
    value.sensors as ThermalSensor[],
    BASELINE_SENSOR_IDS,
    "snapshot.sensors",
  );
  value.sensors.forEach((sensor, index) =>
    validateSensor(
      sensor,
      BASELINE_SENSOR_SPECS[index],
      value.elapsedMicroseconds as number,
      `snapshot.sensors[${index}]`,
    ),
  );

  validateLedger(value.ledger, "snapshot.ledger");
  const typedNodes = value.nodes as ThermalNode[];
  const typedLedger = value.ledger as unknown as ThermalEnergyLedger;
  const currentEnergyJ = totalNodeThermalEnergy(typedNodes);
  const expectedEnergyJ =
    typedLedger.initialNodeThermalEnergyJ +
    typedLedger.heatSourceInputJ +
    typedLedger.pumpWorkInputJ -
    typedLedger.radiatedToSpaceJ +
    typedLedger.externalEnergyJ +
    typedLedger.numericalResidualJ;
  const closureErrorJ = currentEnergyJ - expectedEnergyJ;
  const closureToleranceJ = Math.max(0.1, Math.abs(currentEnergyJ) * 5e-12);
  if (Math.abs(closureErrorJ) > closureToleranceJ) {
    throw new Error(
      `snapshot thermal energy ledger does not reconcile: error ${closureErrorJ} J`,
    );
  }
}

/**
 * Avoid recursively constructing and validating a full snapshot while
 * validating the immutable identity of the only baseline heat source.
 */
function createBaselineCoolingSnapshotForValidation(): Pick<
  CoolingNetworkSnapshot,
  "heatSources"
> {
  return {
    heatSources: [
      {
        id: "ship-service-thermal-load",
        nodeId: "thermal-bus",
        thermalPowerW: 57_200_000,
        enabled: true,
        lastAppliedPowerW: 57_200_000,
      },
    ],
  };
}

interface PhysicsDelta {
  heatSourceInputJ: number;
  pumpWorkInputJ: number;
  radiatedToSpaceJ: number;
  nodeThermalEnergyChangeJ: number;
  numericalResidualJ: number;
}

export class CoolingThermalNetwork {
  private stateValue: CoolingNetworkSnapshot;

  constructor(options: CoolingNetworkOptions = {}) {
    this.stateValue = createBaselineCoolingSnapshot(options);
    this.sampleDueSensors();
    this.deliverAvailableReadings();
    validateCoolingSnapshot(this.stateValue);
  }

  get elapsedMicroseconds(): number {
    return this.stateValue.elapsedMicroseconds;
  }

  get elapsedSeconds(): number {
    return this.stateValue.elapsedMicroseconds / COOLING_MICROSECONDS_PER_SECOND;
  }

  get revision(): number {
    return this.stateValue.revision;
  }

  listLoops(): CoolingLoop[] {
    return cloneData(this.stateValue.loops);
  }

  listNodes(): ThermalNode[] {
    return cloneData(this.stateValue.nodes);
  }

  getNode(nodeId: ThermalNodeId): ThermalNode {
    return cloneData(findById(this.stateValue.nodes, nodeId, "thermal node"));
  }

  listPumps(): CoolantPump[] {
    return cloneData(this.stateValue.pumps);
  }

  listHeatExchangers(): HeatExchanger[] {
    return cloneData(this.stateValue.heatExchangers);
  }

  listRadiators(): SpaceRadiator[] {
    return cloneData(this.stateValue.radiators);
  }

  listHeatSources(): ThermalHeatSource[] {
    return cloneData(this.stateValue.heatSources);
  }

  listSensors(): ThermalSensor[] {
    return cloneData(this.stateValue.sensors);
  }

  getSensorReading(sensorId: string): ThermalSensorReading | null {
    const sensor = findById(this.stateValue.sensors, sensorId, "thermal sensor");
    return sensor.latest ? cloneData(sensor.latest) : null;
  }

  getEnergyBalance(): CoolingEnergyBalance {
    const ledger = this.stateValue.ledger;
    const nodeThermalEnergyJ = totalNodeThermalEnergy(this.stateValue.nodes);
    const ledgerExpectedNodeThermalEnergyJ =
      ledger.initialNodeThermalEnergyJ +
      ledger.heatSourceInputJ +
      ledger.pumpWorkInputJ -
      ledger.radiatedToSpaceJ +
      ledger.externalEnergyJ +
      ledger.numericalResidualJ;
    return {
      nodeThermalEnergyJ,
      ledgerExpectedNodeThermalEnergyJ,
      closureErrorJ: nodeThermalEnergyJ - ledgerExpectedNodeThermalEnergyJ,
      heatSourceInputJ: ledger.heatSourceInputJ,
      pumpWorkInputJ: ledger.pumpWorkInputJ,
      radiatedToSpaceJ: ledger.radiatedToSpaceJ,
      externalEnergyJ: ledger.externalEnergyJ,
      externalEnergyBySourceJ: cloneData(
        ledger.externalEnergyBySourceJ,
      ),
      numericalResidualJ: ledger.numericalResidualJ,
    };
  }

  getSummary(): CoolingNetworkSummary {
    const thermalBusTemperatureK = findById(
      this.stateValue.nodes,
      "thermal-bus",
      "thermal node",
    ).temperatureK;
    const coolantTemperatures = ["coolant-a", "coolant-b"].map(
      (nodeId) =>
        findById(this.stateValue.nodes, nodeId, "thermal node").temperatureK,
    );
    const energyBalance = this.getEnergyBalance();
    return {
      thermalBusTemperatureK,
      averageCoolantTemperatureK:
        coolantTemperatures.reduce((total, value) => total + value, 0) /
        coolantTemperatures.length,
      hottestNodeTemperatureK: Math.max(
        ...this.stateValue.nodes.map((node) => node.temperatureK),
      ),
      totalMassFlowKgPerSecond: this.stateValue.pumps.reduce(
        (total, pump) => total + pump.lastMassFlowKgPerSecond,
        0,
      ),
      totalRadiatedPowerW: this.stateValue.radiators.reduce(
        (total, radiator) => total + radiator.lastRadiatedPowerW,
        0,
      ),
      activeLoopCount: this.stateValue.pumps.filter(
        (pump) => pump.lastMassFlowKgPerSecond > 0,
      ).length,
      energyClosureErrorJ: energyBalance.closureErrorJ,
    };
  }

  configurePump(pumpId: CoolantPumpId, patch: CoolantPumpPatch): CoolantPump {
    const next = this.snapshot();
    const pump = findById(next.pumps, pumpId, "coolant pump");
    Object.assign(pump, cloneData(patch));
    const operatingPoint = pumpOperatingPoint(pump);
    pump.lastMassFlowKgPerSecond = operatingPoint.massFlowKgPerSecond;
    pump.lastElectricalPowerW = operatingPoint.electricalPowerW;
    next.revision += 1;
    validateCoolingSnapshot(next);
    this.stateValue = next;
    return cloneData(pump);
  }

  synchronizePumpElectricalSupplyFraction(
    pumpId: CoolantPumpId,
    electricalSupplyFraction: number,
  ): CoolantPump {
    assertFraction(
      electricalSupplyFraction,
      "electricalSupplyFraction",
    );
    const current = findById(
      this.stateValue.pumps,
      pumpId,
      "coolant pump",
    );
    if (
      current.electricalSupplyFraction ===
      electricalSupplyFraction
    ) {
      return cloneData(current);
    }
    const next = this.snapshot();
    const pump = findById(next.pumps, pumpId, "coolant pump");
    pump.electricalSupplyFraction = electricalSupplyFraction;
    const operatingPoint = pumpOperatingPoint(pump);
    pump.lastMassFlowKgPerSecond =
      operatingPoint.massFlowKgPerSecond;
    pump.lastElectricalPowerW = operatingPoint.electricalPowerW;
    next.revision += 1;
    validateCoolingSnapshot(next);
    this.stateValue = next;
    return cloneData(pump);
  }

  configureHeatExchanger(
    heatExchangerId: HeatExchangerId,
    patch: HeatExchangerPatch,
  ): HeatExchanger {
    const next = this.snapshot();
    const exchanger = findById(
      next.heatExchangers,
      heatExchangerId,
      "heat exchanger",
    );
    Object.assign(exchanger, cloneData(patch));
    exchanger.lastHeatTransferW = 0;
    next.revision += 1;
    validateCoolingSnapshot(next);
    this.stateValue = next;
    return cloneData(exchanger);
  }

  configureRadiator(
    radiatorId: RadiatorId,
    patch: SpaceRadiatorPatch,
  ): SpaceRadiator {
    const next = this.snapshot();
    const radiator = findById(next.radiators, radiatorId, "radiator");
    Object.assign(radiator, cloneData(patch));
    radiator.lastCoolantHeatTransferW = 0;
    const panel = findById(next.nodes, radiator.panelNodeId, "thermal node");
    radiator.lastRadiatedPowerW = radiatedPowerW(
      radiator,
      panel.temperatureK,
      next.externalSpaceTemperatureK,
    );
    next.revision += 1;
    validateCoolingSnapshot(next);
    this.stateValue = next;
    return cloneData(radiator);
  }

  configureHeatSource(
    heatSourceId: HeatSourceId,
    patch: ThermalHeatSourcePatch,
  ): ThermalHeatSource {
    const next = this.snapshot();
    const source = findById(next.heatSources, heatSourceId, "heat source");
    Object.assign(source, cloneData(patch));
    source.lastAppliedPowerW = source.enabled ? source.thermalPowerW : 0;
    next.revision += 1;
    validateCoolingSnapshot(next);
    this.stateValue = next;
    return cloneData(source);
  }

  configureSensor(
    sensorId: string,
    patch: ThermalSensorPatch,
  ): ThermalSensor {
    const next = this.snapshot();
    const sensor = findById(next.sensors, sensorId, "thermal sensor");
    Object.assign(sensor, cloneData(patch));
    sensor.pending = [];
    sensor.latest = null;
    sensor.nextSampleMicroseconds = next.elapsedMicroseconds;
    sensor.spareNormal = null;
    next.revision += 1;
    validateCoolingSnapshot(next);
    this.stateValue = next;
    this.sampleDueSensors();
    this.deliverAvailableReadings();
    return cloneData(findById(this.stateValue.sensors, sensorId, "thermal sensor"));
  }

  setExternalSpaceTemperature(temperatureK: number): void {
    assertPositive(temperatureK, "externalSpaceTemperatureK");
    if (temperatureK > 1_000) {
      throw new RangeError("externalSpaceTemperatureK exceeds model limit");
    }
    if (temperatureK === this.stateValue.externalSpaceTemperatureK) return;
    const next = this.snapshot();
    next.externalSpaceTemperatureK = temperatureK;
    for (const radiator of next.radiators) {
      const panel = findById(next.nodes, radiator.panelNodeId, "thermal node");
      radiator.lastRadiatedPowerW = radiatedPowerW(
        radiator,
        panel.temperatureK,
        temperatureK,
      );
    }
    next.revision += 1;
    validateCoolingSnapshot(next);
    this.stateValue = next;
  }

  applyExternalEnergy(
    nodeId: ThermalNodeId,
    energyJ: number,
    sourceId: ExternalThermalSourceId = "intervention",
  ): ExternalThermalEnergyResult {
    assertFinite(energyJ, "energyJ");
    assertEnum(
      sourceId,
      EXTERNAL_THERMAL_SOURCE_IDS,
      "sourceId",
    );
    const next = this.snapshot();
    const node = findById(next.nodes, nodeId, "thermal node");
    const nextTemperatureK =
      node.temperatureK + energyJ / node.heatCapacityJPerK;
    if (
      !Number.isFinite(nextTemperatureK) ||
      nextTemperatureK <= 0 ||
      nextTemperatureK > MAX_TEMPERATURE_K
    ) {
      throw new RangeError(
        `external energy would move ${nodeId} outside the supported temperature range`,
      );
    }
    node.temperatureK = nextTemperatureK;
    next.ledger.externalEnergyBySourceJ[sourceId] += energyJ;
    // The classified ledger is authoritative. Re-derive the redundant total
    // in the same stable source order so long voyages cannot accumulate a
    // different floating-point sum merely because heat sources arrived in a
    // different order.
    next.ledger.externalEnergyJ = totalClassifiedExternalEnergyJ(
      next.ledger.externalEnergyBySourceJ,
    );
    next.revision += 1;
    validateCoolingSnapshot(next);
    this.stateValue = next;
    return {
      appliedEnergyJ: energyJ,
      affectedNodeIds: [nodeId],
      revision: next.revision,
    };
  }

  setNodeTemperatures(
    overrides: readonly ThermalNodeTemperatureOverride[],
  ): ExternalThermalEnergyResult {
    if (overrides.length === 0) {
      throw new RangeError("at least one thermal node override is required");
    }
    const next = this.snapshot();
    const affectedNodeIds: ThermalNodeId[] = [];
    const seen = new Set<ThermalNodeId>();
    let appliedEnergyJ = 0;
    for (const [index, override] of overrides.entries()) {
      if (!isRecord(override)) {
        throw new TypeError(`overrides[${index}] must be an object`);
      }
      assertEnum(
        override.nodeId,
        THERMAL_NODE_IDS,
        `overrides[${index}].nodeId`,
      );
      if (seen.has(override.nodeId)) {
        throw new Error(`duplicate thermal node override: ${override.nodeId}`);
      }
      assertPositive(
        override.temperatureK,
        `overrides[${index}].temperatureK`,
      );
      if (override.temperatureK > MAX_TEMPERATURE_K) {
        throw new RangeError(
          `overrides[${index}].temperatureK exceeds the model limit`,
        );
      }
      const node = findById(next.nodes, override.nodeId, "thermal node");
      appliedEnergyJ +=
        (override.temperatureK - node.temperatureK) *
        node.heatCapacityJPerK;
      node.temperatureK = override.temperatureK;
      affectedNodeIds.push(override.nodeId);
      seen.add(override.nodeId);
    }
    next.ledger.externalEnergyBySourceJ.intervention += appliedEnergyJ;
    next.ledger.externalEnergyJ = totalClassifiedExternalEnergyJ(
      next.ledger.externalEnergyBySourceJ,
    );
    next.revision += 1;
    validateCoolingSnapshot(next);
    this.stateValue = next;
    return {
      appliedEnergyJ,
      affectedNodeIds,
      revision: next.revision,
    };
  }

  step(simulatedSeconds: number): CoolingStepResult {
    assertNonNegative(simulatedSeconds, "simulatedSeconds");
    const durationMicroseconds = Math.round(
      simulatedSeconds * COOLING_MICROSECONDS_PER_SECOND,
    );
    assertSafeMicroseconds(durationMicroseconds, "step duration");
    const fromMicroseconds = this.stateValue.elapsedMicroseconds;
    const toMicroseconds = fromMicroseconds + durationMicroseconds;
    assertSafeMicroseconds(toMicroseconds, "step target");

    const beforeEnergyJ = totalNodeThermalEnergy(this.stateValue.nodes);
    const ledgerBefore = cloneData(this.stateValue.ledger);
    let substeps = 0;

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
        throw new Error("cooling scheduler failed to produce a future boundary");
      }
      const deltaSeconds =
        (boundaryMicroseconds - now) / COOLING_MICROSECONDS_PER_SECOND;
      this.advancePhysics(deltaSeconds);
      this.stateValue.elapsedMicroseconds = boundaryMicroseconds;
      substeps += 1;
      this.sampleDueSensors();
      this.deliverAvailableReadings();
    }

    if (durationMicroseconds > 0) this.stateValue.revision += 1;
    validateCoolingSnapshot(this.stateValue);

    const afterEnergyJ = totalNodeThermalEnergy(this.stateValue.nodes);
    const heatSourceInputJ =
      this.stateValue.ledger.heatSourceInputJ - ledgerBefore.heatSourceInputJ;
    const pumpWorkInputJ =
      this.stateValue.ledger.pumpWorkInputJ - ledgerBefore.pumpWorkInputJ;
    const radiatedToSpaceJ =
      this.stateValue.ledger.radiatedToSpaceJ -
      ledgerBefore.radiatedToSpaceJ;
    const nodeThermalEnergyChangeJ = afterEnergyJ - beforeEnergyJ;
    return {
      fromMicroseconds,
      toMicroseconds,
      simulatedSeconds:
        durationMicroseconds / COOLING_MICROSECONDS_PER_SECOND,
      substeps,
      heatSourceInputJ,
      pumpWorkInputJ,
      radiatedToSpaceJ,
      nodeThermalEnergyChangeJ,
      energyClosureErrorJ:
        nodeThermalEnergyChangeJ -
        (heatSourceInputJ + pumpWorkInputJ - radiatedToSpaceJ),
      revision: this.stateValue.revision,
    };
  }

  private advancePhysics(deltaSeconds: number): PhysicsDelta {
    const beforeEnergyJ = totalNodeThermalEnergy(this.stateValue.nodes);
    const energyDeltaByNode = new Map<ThermalNodeId, number>(
      this.stateValue.nodes.map((node) => [node.id, 0]),
    );
    let heatSourceInputJ = 0;
    let pumpWorkInputJ = 0;
    let radiatedToSpaceJ = 0;

    const addNodeEnergy = (nodeId: ThermalNodeId, energyJ: number): void => {
      energyDeltaByNode.set(
        nodeId,
        (energyDeltaByNode.get(nodeId) ?? 0) + energyJ,
      );
    };

    for (const source of this.stateValue.heatSources) {
      const appliedPowerW = source.enabled ? source.thermalPowerW : 0;
      const energyJ = appliedPowerW * deltaSeconds;
      source.lastAppliedPowerW = appliedPowerW;
      addNodeEnergy(source.nodeId, energyJ);
      heatSourceInputJ += energyJ;
    }

    for (const pump of this.stateValue.pumps) {
      const operatingPoint = pumpOperatingPoint(pump);
      pump.lastMassFlowKgPerSecond = operatingPoint.massFlowKgPerSecond;
      pump.lastElectricalPowerW = operatingPoint.electricalPowerW;
      const loop = findById(this.stateValue.loops, pump.loopId, "cooling loop");
      const energyJ = operatingPoint.electricalPowerW * deltaSeconds;
      addNodeEnergy(loop.coolantNodeId, energyJ);
      pumpWorkInputJ += energyJ;
    }

    for (const exchanger of this.stateValue.heatExchangers) {
      const pump = findById(
        this.stateValue.pumps,
        findById(this.stateValue.loops, exchanger.loopId, "cooling loop").pumpId,
        "coolant pump",
      );
      const effectiveConductanceWPerK =
        exchanger.nominalConductanceWPerK *
        exchanger.conductanceFraction *
        conductanceConditionFraction(exchanger.condition) *
        flowConductanceFraction(pump);
      const hotNode = findById(
        this.stateValue.nodes,
        exchanger.hotNodeId,
        "thermal node",
      );
      const coldNode = findById(
        this.stateValue.nodes,
        exchanger.coldNodeId,
        "thermal node",
      );
      const transferredEnergyJ = limitedPairwiseEnergyJ(
        hotNode,
        coldNode,
        effectiveConductanceWPerK,
        deltaSeconds,
      );
      addNodeEnergy(hotNode.id, -transferredEnergyJ);
      addNodeEnergy(coldNode.id, transferredEnergyJ);
      exchanger.lastHeatTransferW = transferredEnergyJ / deltaSeconds;
    }

    for (const radiator of this.stateValue.radiators) {
      const loop = findById(
        this.stateValue.loops,
        radiator.loopId,
        "cooling loop",
      );
      const pump = findById(this.stateValue.pumps, loop.pumpId, "coolant pump");
      const condition = radiatorConditionFractions(radiator.condition);
      const effectiveConductanceWPerK =
        radiator.nominalCoolantConductanceWPerK *
        radiator.coolantConductanceFraction *
        condition.coolant *
        flowConductanceFraction(pump);
      const coolantNode = findById(
        this.stateValue.nodes,
        radiator.coolantNodeId,
        "thermal node",
      );
      const panelNode = findById(
        this.stateValue.nodes,
        radiator.panelNodeId,
        "thermal node",
      );
      const transferredEnergyJ = limitedPairwiseEnergyJ(
        coolantNode,
        panelNode,
        effectiveConductanceWPerK,
        deltaSeconds,
      );
      addNodeEnergy(coolantNode.id, -transferredEnergyJ);
      addNodeEnergy(panelNode.id, transferredEnergyJ);
      radiator.lastCoolantHeatTransferW =
        transferredEnergyJ / deltaSeconds;

      const requestedRadiatedEnergyJ =
        radiatedPowerW(
          radiator,
          panelNode.temperatureK,
          this.stateValue.externalSpaceTemperatureK,
        ) * deltaSeconds;
      const maximumRadiatedEnergyJ = Math.max(
        0,
        (panelNode.temperatureK -
          this.stateValue.externalSpaceTemperatureK) *
          panelNode.heatCapacityJPerK,
      );
      const emittedEnergyJ = Math.min(
        requestedRadiatedEnergyJ,
        maximumRadiatedEnergyJ,
      );
      addNodeEnergy(panelNode.id, -emittedEnergyJ);
      radiator.lastRadiatedPowerW = emittedEnergyJ / deltaSeconds;
      radiatedToSpaceJ += emittedEnergyJ;
    }

    for (const node of this.stateValue.nodes) {
      const energyDeltaJ = energyDeltaByNode.get(node.id) ?? 0;
      node.temperatureK += energyDeltaJ / node.heatCapacityJPerK;
      if (
        !Number.isFinite(node.temperatureK) ||
        node.temperatureK <= 0 ||
        node.temperatureK > MAX_TEMPERATURE_K
      ) {
        throw new Error(`thermal node ${node.id} left the supported temperature range`);
      }
    }

    const afterEnergyJ = totalNodeThermalEnergy(this.stateValue.nodes);
    const nodeThermalEnergyChangeJ = afterEnergyJ - beforeEnergyJ;
    const numericalResidualJ =
      nodeThermalEnergyChangeJ -
      (heatSourceInputJ + pumpWorkInputJ - radiatedToSpaceJ);
    this.stateValue.ledger.heatSourceInputJ += heatSourceInputJ;
    this.stateValue.ledger.pumpWorkInputJ += pumpWorkInputJ;
    this.stateValue.ledger.radiatedToSpaceJ += radiatedToSpaceJ;
    this.stateValue.ledger.numericalResidualJ += numericalResidualJ;

    return {
      heatSourceInputJ,
      pumpWorkInputJ,
      radiatedToSpaceJ,
      nodeThermalEnergyChangeJ,
      numericalResidualJ,
    };
  }

  private sensorTruth(sensor: ThermalSensor): number {
    switch (sensor.quantity) {
      case "temperatureK":
        return findById(
          this.stateValue.nodes,
          sensor.targetId,
          "thermal node",
        ).temperatureK;
      case "massFlowKgPerSecond":
        return findById(
          this.stateValue.pumps,
          sensor.targetId,
          "coolant pump",
        ).lastMassFlowKgPerSecond;
      case "radiatedPowerW":
        return findById(
          this.stateValue.radiators,
          sensor.targetId,
          "radiator",
        ).lastRadiatedPowerW;
    }
  }

  private createSensorReading(
    sensor: ThermalSensor,
    sampledAtMicroseconds: number,
  ): ThermalSensorReading {
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
          (sampledAtMicroseconds / COOLING_MICROSECONDS_PER_SECOND) +
        nextNormal(sensor) *
          sensor.noiseStandardDeviation *
          noiseMultiplier;
    }
    const reading: ThermalSensorReading = {
      sensorId: sensor.id,
      targetId: sensor.targetId,
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
      let latest: ThermalSensorReading | null = null;
      while (
        sensor.pending.length > 0 &&
        sensor.pending[0].availableAtMicroseconds <= now
      ) {
        latest = sensor.pending.shift() as ThermalSensorReading;
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

  snapshot(): CoolingNetworkSnapshot {
    return cloneData(this.stateValue);
  }

  serialize(): string {
    return JSON.stringify(this.stateValue);
  }

  static restore(
    source: string | CoolingNetworkSnapshot,
  ): CoolingThermalNetwork {
    const parsed: unknown =
      typeof source === "string" ? JSON.parse(source) : cloneData(source);
    validateCoolingSnapshot(parsed);
    const restored = new CoolingThermalNetwork({ seed: 0 });
    restored.stateValue = cloneData(parsed);
    return restored;
  }
}
