/**
 * Deterministic, headless simulation primitives for the ship.
 *
 * Design rules:
 * - no wall clock, Math.random(), DOM, network, or persistence dependencies;
 * - time is integer microseconds;
 * - all externally forced state changes are atomic and append-only audited;
 * - snapshots contain every piece of mutable state required for exact replay.
 */

export const SIMULATION_SNAPSHOT_VERSION = 6 as const;
export const MICROSECONDS_PER_SECOND = 1_000_000;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface RandomSnapshot {
  algorithm: "mulberry32";
  state: number;
}

export interface ClockSnapshot {
  elapsedMicroseconds: number;
  timeScale: number;
  fractionalMicroseconds: number;
}

export interface PowerState {
  generationKw: number;
  essentialDemandKw: number;
  discretionaryDemandKw: number;
  jumpDriveDemandKw: number;
  servedDemandKw: number;
  unservedDemandKw: number;
  curtailedGenerationKw: number;
  batteryCapacityKWh: number;
  batteryChargeKWh: number;
  batteryThroughputKWh: number;
}

export interface ThermalState {
  habitatTemperatureK: number;
  habitatTargetTemperatureK: number;
  coolantTemperatureK: number;
  radiatorTemperatureK: number;
  spaceSinkTemperatureK: number;
  internalHeatKw: number;
  radiatorConductanceKwPerK: number;
  coolantHeatCapacityKJPerK: number;
  radiatedHeatKw: number;
}

export interface AtmosphericGasMasses {
  oxygen: number;
  nitrogen: number;
  carbonDioxide: number;
  waterVapor: number;
}

export interface AtmosphereState {
  volumeCubicMeters: number;
  pressurePa: number;
  oxygenPartialPressurePa: number;
  carbonDioxidePartialPressurePa: number;
  gasesKg: AtmosphericGasMasses;
  capturedCarbonDioxideKg: number;
  ventedGasKg: number;
  leakAreaSquareMeters: number;
  leakFractionPerSquareMeterSecond: number;
  scrubberCapacityKgPerSecond: number;
}

export interface WaterState {
  potableKg: number;
  wastewaterKg: number;
  reserveIceKg: number;
  brineWasteKg: number;
  consumptionKgPerAwakePersonDay: number;
  recyclerCapacityKgPerDay: number;
  recyclerEfficiency: number;
  recycledKgCumulative: number;
}

export interface ConsumablesState {
  foodDryKg: number;
  foodConsumedKgCumulative: number;
}

export interface PopulationState {
  total: number;
  passengers: number;
  crew: number;
  awake: number;
  hibernating: number;
  deceased: number;
  averageHealth: number;
  averageMorale: number;
}

export interface HibernationState {
  podCapacity: number;
  operationalPods: number;
  occupiedPods: number;
  wakeupsInProgress: number;
  completedWakeCycles: number;
}

export interface EnvironmentState {
  radiationDoseRateMilliSievertsPerHour: number;
  accumulatedHullDoseMilliSieverts: number;
  chargedParticleFluxPerSquareMeterSecond: number;
  micrometeoroidFluxPerSquareMeterYear: number;
  stellarIrradianceWattsPerSquareMeter: number;
}

export type JourneyStatus =
  | "charging"
  | "ready"
  | "in-transit"
  | "arrived"
  | "stranded";

export interface JourneyState {
  origin: string;
  destination: string;
  totalDistanceLightYears: number;
  completedDistanceLightYears: number;
  currentLeg: number;
  totalLegs: number;
  jumpsCompleted: number;
  jumpDriveChargeKWh: number;
  jumpDriveCapacityKWh: number;
  requiredChargePerJumpKWh: number;
  jumpDriveChargeEfficiency: number;
  status: JourneyStatus;
}

export interface ShipState {
  schemaVersion: 1;
  revision: number;
  power: PowerState;
  thermal: ThermalState;
  atmosphere: AtmosphereState;
  water: WaterState;
  consumables: ConsumablesState;
  population: PopulationState;
  hibernation: HibernationState;
  environment: EnvironmentState;
  journey: JourneyState;
}

export type InterventionOperation =
  | {
      operation: "set";
      path: string;
      value: JsonPrimitive;
    }
  | {
      operation: "add" | "multiply";
      path: string;
      value: number;
    };

export interface ExternalBalanceDelta {
  massKg: number;
  energyJ: number;
  linearMomentumKgMPerSecond: [number, number, number];
  angularMomentumKgM2PerSecond: [number, number, number];
  note: string;
}

export interface ExternalInterventionRequest {
  id?: string;
  actor: string;
  reason: string;
  operations: InterventionOperation[];
  declaredBalance: ExternalBalanceDelta;
  metadata?: { [key: string]: JsonValue };
}

export interface AppliedInterventionOperation {
  operation: InterventionOperation["operation"];
  path: string;
  operand: JsonPrimitive;
  before: JsonPrimitive;
  after: JsonPrimitive;
}

export interface ExternalInterventionRecord {
  sequence: number;
  id: string;
  simTimeMicroseconds: number;
  actor: string;
  reason: string;
  status: "applied" | "rejected";
  operations: AppliedInterventionOperation[];
  declaredBalance: ExternalBalanceDelta;
  stateRevisionBefore: number;
  stateRevisionAfter: number;
  metadata?: { [key: string]: JsonValue };
  error?: string;
}

export interface ScheduledEvent<TPayload extends JsonValue = JsonValue> {
  id: string;
  type: string;
  atMicroseconds: number;
  priority: number;
  sequence: number;
  payload: TPayload;
}

export interface ScheduleEventInput<TPayload extends JsonValue = JsonValue> {
  id?: string;
  type: string;
  atMicroseconds: number;
  priority?: number;
  payload: TPayload;
}

export interface EventQueueSnapshot {
  nextSequence: number;
  events: ScheduledEvent[];
}

export interface SchedulerTaskSnapshot {
  id: string;
  periodMicroseconds: number;
  priority: number;
  nextRunMicroseconds: number;
}

export interface SchedulerSnapshot {
  tasks: SchedulerTaskSnapshot[];
}

export interface ProcessedEventRecord {
  event: ScheduledEvent;
  processedAtMicroseconds: number;
  outcome: "observed" | "intervention-applied" | "intervention-rejected";
  detail?: string;
}

export interface SimulationSnapshot {
  snapshotVersion: typeof SIMULATION_SNAPSHOT_VERSION;
  powerAuthority: PowerAuthority;
  atmosphereAuthority: AtmosphereAuthority;
  thermalAuthority: ThermalAuthority;
  populationAuthority: PopulationAuthority;
  waterAuthority: WaterAuthority;
  state: ShipState;
  clock: ClockSnapshot;
  random: RandomSnapshot;
  eventQueue: EventQueueSnapshot;
  scheduler: SchedulerSnapshot;
  interventionLedger: ExternalInterventionRecord[];
  eventLog: ProcessedEventRecord[];
  nextInterventionSequence: number;
}

export interface SimulationStepResult {
  fromMicroseconds: number;
  toMicroseconds: number;
  simulatedSeconds: number;
  processedEvents: ProcessedEventRecord[];
  systemRuns: { [systemId: string]: number };
  stateRevision: number;
}

export interface SimulationStepSlice {
  fromMicroseconds: number;
  toMicroseconds: number;
  simulatedSeconds: number;
}

export interface SimulationSliceLimitContext {
  fromMicroseconds: number;
  remainingSimulatedSeconds: number;
}

export type SimulationSliceLimit =
  | number
  | ((context: SimulationSliceLimitContext) => number);

export interface SimulationEngineOptions {
  seed?: number | string;
  timeScale?: number;
  state?: ShipState;
  powerAuthority?: PowerAuthority;
  atmosphereAuthority?: AtmosphereAuthority;
  thermalAuthority?: ThermalAuthority;
  populationAuthority?: PopulationAuthority;
  waterAuthority?: WaterAuthority;
}

export type PowerAuthority = "aggregate" | "external-network";
export type AtmosphereAuthority = "aggregate" | "external-network";
export type ThermalAuthority = "aggregate" | "external-network";
export type PopulationAuthority = "aggregate" | "external-roster";
export type WaterAuthority = "aggregate" | "external-network";

export interface JumpExecutionResult {
  distanceLightYears: number;
  energyConsumedKWh: number;
  wasteHeatJoules: number;
  completedDistanceLightYears: number;
  jumpsCompleted: number;
  status: JourneyStatus;
}

export interface ExternalJumpDriveChargingResult {
  servedElectricalEnergyKWh: number;
  storedFieldEnergyKWh: number;
  dissipatedHeatEnergyKWh: number;
  status: JourneyStatus;
}

export interface PopulationCountSynchronization {
  awake: number;
  hibernating: number;
  deceased: number;
}

export interface PopulationAverageSynchronization {
  averageHealth: number;
  averageMorale: number;
}

export type PowerNetworkSynchronization = PowerState;

export interface AtmosphereNetworkSynchronization {
  volumeCubicMeters: number;
  gasesKg: AtmosphericGasMasses;
  pressurePa: number;
  oxygenPartialPressurePa: number;
  carbonDioxidePartialPressurePa: number;
  capturedCarbonDioxideKg: number;
  ventedGasKg: number;
  leakAreaSquareMeters: number;
}

export interface ThermalNetworkSynchronization {
  habitatTemperatureK: number;
  coolantTemperatureK: number;
  radiatorTemperatureK: number;
  spaceSinkTemperatureK: number;
  internalHeatKw: number;
  radiatedHeatKw: number;
  radiatorConductanceKwPerK: number;
  coolantHeatCapacityKJPerK: number;
}

export interface MetabolicMassExchange {
  oxygenConsumedKg: number;
  carbonDioxideProducedKg: number;
  waterVaporProducedKg: number;
}

interface SystemContext {
  state: ShipState;
  deltaSeconds: number;
  nowMicroseconds: number;
  random: SeededRandom;
}

export interface SchedulerTask<TContext> {
  id: string;
  periodMicroseconds: number;
  priority: number;
  run: (context: TContext) => void;
}

const INTERVENTION_EVENT_TYPE = "simulation.external-intervention";
const STATE_MUTABLE_ROOTS = new Set([
  "power",
  "thermal",
  "atmosphere",
  "water",
  "consumables",
  "population",
  "hibernation",
  "environment",
  "journey",
]);

const GAS_CONSTANT_J_PER_KG_K = {
  oxygen: 259.84,
  nitrogen: 296.8,
  carbonDioxide: 188.92,
  waterVapor: 461.5,
} as const;

const OXYGEN_CONSUMPTION_KG_PER_AWAKE_PERSON_SECOND = 0.0000085;

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

function assertNonNegative(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value < 0) {
    throw new RangeError(`${label} cannot be negative`);
  }
}

function assertSafeMicroseconds(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} cannot be empty`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertJsonValue(value: unknown, label = "value"): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    assertFiniteNumber(value, label);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${label}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, `${label}.${key}`);
    }
    return;
  }
  throw new TypeError(`${label} must be JSON-compatible`);
}

function hashSeed(seed: number | string): number {
  if (typeof seed === "number") {
    assertFiniteNumber(seed, "seed");
    return seed >>> 0;
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function secondsToMicroseconds(seconds: number): number {
  assertNonNegative(seconds, "seconds");
  const result = Math.round(seconds * MICROSECONDS_PER_SECOND);
  assertSafeMicroseconds(result, "converted microseconds");
  return result;
}

export function microsecondsToSeconds(microseconds: number): number {
  assertSafeMicroseconds(microseconds, "microseconds");
  return microseconds / MICROSECONDS_PER_SECOND;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number | string = 0) {
    this.state = hashSeed(seed);
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  between(minimum: number, maximum: number): number {
    assertFiniteNumber(minimum, "minimum");
    assertFiniteNumber(maximum, "maximum");
    if (maximum < minimum) {
      throw new RangeError("maximum must be greater than or equal to minimum");
    }
    return minimum + (maximum - minimum) * this.next();
  }

  integer(minimumInclusive: number, maximumExclusive: number): number {
    if (
      !Number.isSafeInteger(minimumInclusive) ||
      !Number.isSafeInteger(maximumExclusive) ||
      maximumExclusive <= minimumInclusive
    ) {
      throw new RangeError("integer bounds must define a non-empty safe range");
    }
    return Math.floor(this.between(minimumInclusive, maximumExclusive));
  }

  chance(probability: number): boolean {
    assertFiniteNumber(probability, "probability");
    if (probability < 0 || probability > 1) {
      throw new RangeError("probability must be between 0 and 1");
    }
    return this.next() < probability;
  }

  snapshot(): RandomSnapshot {
    return { algorithm: "mulberry32", state: this.state };
  }

  restore(snapshot: RandomSnapshot): void {
    if (
      snapshot.algorithm !== "mulberry32" ||
      !Number.isInteger(snapshot.state) ||
      snapshot.state < 0 ||
      snapshot.state > 0xffff_ffff
    ) {
      throw new TypeError("invalid random snapshot");
    }
    this.state = snapshot.state >>> 0;
  }

  static fromSnapshot(snapshot: RandomSnapshot): SeededRandom {
    const random = new SeededRandom(0);
    random.restore(snapshot);
    return random;
  }
}

export class SimulationClock {
  private elapsedMicrosecondsValue: number;
  private timeScaleValue: number;
  private fractionalMicrosecondsValue: number;

  constructor(timeScale = 1, elapsedMicroseconds = 0) {
    assertSafeMicroseconds(elapsedMicroseconds, "elapsedMicroseconds");
    this.elapsedMicrosecondsValue = elapsedMicroseconds;
    this.fractionalMicrosecondsValue = 0;
    this.timeScaleValue = 1;
    this.setTimeScale(timeScale);
  }

  get elapsedMicroseconds(): number {
    return this.elapsedMicrosecondsValue;
  }

  get elapsedSeconds(): number {
    return microsecondsToSeconds(this.elapsedMicrosecondsValue);
  }

  get timeScale(): number {
    return this.timeScaleValue;
  }

  setTimeScale(timeScale: number): void {
    assertNonNegative(timeScale, "timeScale");
    this.timeScaleValue = timeScale;
  }

  scaledDurationForRealSeconds(realSeconds: number): number {
    assertNonNegative(realSeconds, "realSeconds");
    const exactMicroseconds =
      realSeconds * this.timeScaleValue * MICROSECONDS_PER_SECOND +
      this.fractionalMicrosecondsValue;
    assertFiniteNumber(exactMicroseconds, "scaled duration");

    const wholeMicroseconds = Math.floor(exactMicroseconds);
    assertSafeMicroseconds(wholeMicroseconds, "scaled duration");
    this.fractionalMicrosecondsValue =
      exactMicroseconds - wholeMicroseconds;
    return wholeMicroseconds;
  }

  advanceTo(targetMicroseconds: number): void {
    assertSafeMicroseconds(targetMicroseconds, "targetMicroseconds");
    if (targetMicroseconds < this.elapsedMicrosecondsValue) {
      throw new RangeError("simulation clock cannot move backwards");
    }
    this.elapsedMicrosecondsValue = targetMicroseconds;
  }

  snapshot(): ClockSnapshot {
    return {
      elapsedMicroseconds: this.elapsedMicrosecondsValue,
      timeScale: this.timeScaleValue,
      fractionalMicroseconds: this.fractionalMicrosecondsValue,
    };
  }

  restore(snapshot: ClockSnapshot): void {
    assertSafeMicroseconds(
      snapshot.elapsedMicroseconds,
      "clock.elapsedMicroseconds",
    );
    assertNonNegative(snapshot.timeScale, "clock.timeScale");
    assertNonNegative(
      snapshot.fractionalMicroseconds,
      "clock.fractionalMicroseconds",
    );
    if (snapshot.fractionalMicroseconds >= 1) {
      throw new RangeError("clock.fractionalMicroseconds must be below one");
    }
    this.elapsedMicrosecondsValue = snapshot.elapsedMicroseconds;
    this.timeScaleValue = snapshot.timeScale;
    this.fractionalMicrosecondsValue = snapshot.fractionalMicroseconds;
  }
}

function compareEvents(left: ScheduledEvent, right: ScheduledEvent): number {
  return (
    left.atMicroseconds - right.atMicroseconds ||
    right.priority - left.priority ||
    left.sequence - right.sequence
  );
}

export class DeterministicEventQueue {
  private events: ScheduledEvent[] = [];
  private nextSequenceValue = 1;

  get size(): number {
    return this.events.length;
  }

  schedule<TPayload extends JsonValue>(
    input: ScheduleEventInput<TPayload>,
  ): ScheduledEvent<TPayload> {
    assertNonEmpty(input.type, "event type");
    assertSafeMicroseconds(input.atMicroseconds, "event.atMicroseconds");
    assertJsonValue(input.payload, "event.payload");
    const priority = input.priority ?? 0;
    assertFiniteNumber(priority, "event.priority");

    const sequence = this.nextSequenceValue;
    this.nextSequenceValue += 1;
    const id = input.id ?? `event-${sequence}`;
    assertNonEmpty(id, "event id");
    if (this.events.some((event) => event.id === id)) {
      throw new Error(`queued event id already exists: ${id}`);
    }

    const event: ScheduledEvent<TPayload> = {
      id,
      type: input.type,
      atMicroseconds: input.atMicroseconds,
      priority,
      sequence,
      payload: cloneData(input.payload),
    };
    this.events.push(event);
    this.events.sort(compareEvents);
    return cloneData(event);
  }

  cancel(id: string): boolean {
    const index = this.events.findIndex((event) => event.id === id);
    if (index < 0) {
      return false;
    }
    this.events.splice(index, 1);
    return true;
  }

  peek(): ScheduledEvent | undefined {
    const event = this.events[0];
    return event ? cloneData(event) : undefined;
  }

  popDue(throughMicroseconds: number): ScheduledEvent[] {
    assertSafeMicroseconds(throughMicroseconds, "throughMicroseconds");
    let count = 0;
    while (
      count < this.events.length &&
      this.events[count].atMicroseconds <= throughMicroseconds
    ) {
      count += 1;
    }
    return cloneData(this.events.splice(0, count));
  }

  snapshot(): EventQueueSnapshot {
    return {
      nextSequence: this.nextSequenceValue,
      events: cloneData(this.events),
    };
  }

  restore(snapshot: EventQueueSnapshot): void {
    if (!Number.isSafeInteger(snapshot.nextSequence) || snapshot.nextSequence < 1) {
      throw new TypeError("invalid event queue sequence");
    }
    const ids = new Set<string>();
    const sequences = new Set<number>();
    let greatestSequence = 0;
    for (const event of snapshot.events) {
      assertNonEmpty(event.id, "event.id");
      assertNonEmpty(event.type, "event.type");
      assertSafeMicroseconds(event.atMicroseconds, "event.atMicroseconds");
      assertFiniteNumber(event.priority, "event.priority");
      if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
        throw new TypeError("invalid event sequence");
      }
      assertJsonValue(event.payload, "event.payload");
      if (ids.has(event.id)) {
        throw new Error(`duplicate queued event id: ${event.id}`);
      }
      if (sequences.has(event.sequence)) {
        throw new Error(`duplicate queued event sequence: ${event.sequence}`);
      }
      ids.add(event.id);
      sequences.add(event.sequence);
      greatestSequence = Math.max(greatestSequence, event.sequence);
    }
    if (snapshot.nextSequence <= greatestSequence) {
      throw new Error("event queue next sequence must follow queued events");
    }
    this.events = cloneData(snapshot.events).sort(compareEvents);
    this.nextSequenceValue = snapshot.nextSequence;
  }
}

export class MultiRateScheduler<TContext> {
  private tasks = new Map<
    string,
    SchedulerTask<TContext> & { nextRunMicroseconds: number }
  >();

  register(
    task: SchedulerTask<TContext>,
    firstRunMicroseconds = task.periodMicroseconds,
  ): void {
    assertNonEmpty(task.id, "scheduler task id");
    assertSafeMicroseconds(task.periodMicroseconds, "task.periodMicroseconds");
    if (task.periodMicroseconds === 0) {
      throw new RangeError("task period must be greater than zero");
    }
    assertSafeMicroseconds(firstRunMicroseconds, "task.firstRunMicroseconds");
    assertFiniteNumber(task.priority, "task.priority");
    if (this.tasks.has(task.id)) {
      throw new Error(`scheduler task already exists: ${task.id}`);
    }
    this.tasks.set(task.id, { ...task, nextRunMicroseconds: firstRunMicroseconds });
  }

  nextRunMicroseconds(): number | undefined {
    let next: number | undefined;
    for (const task of this.tasks.values()) {
      if (next === undefined || task.nextRunMicroseconds < next) {
        next = task.nextRunMicroseconds;
      }
    }
    return next;
  }

  runAt(
    nowMicroseconds: number,
    contextFactory: (
      task: SchedulerTaskSnapshot,
    ) => TContext,
  ): { [taskId: string]: number } {
    assertSafeMicroseconds(nowMicroseconds, "nowMicroseconds");
    const due = [...this.tasks.values()]
      .filter((task) => task.nextRunMicroseconds === nowMicroseconds)
      .sort(
        (left, right) =>
          right.priority - left.priority || compareStrings(left.id, right.id),
      );

    const runs: { [taskId: string]: number } = {};
    for (const task of due) {
      const taskSnapshot: SchedulerTaskSnapshot = {
        id: task.id,
        periodMicroseconds: task.periodMicroseconds,
        priority: task.priority,
        nextRunMicroseconds: task.nextRunMicroseconds,
      };
      task.run(contextFactory(taskSnapshot));
      task.nextRunMicroseconds += task.periodMicroseconds;
      assertSafeMicroseconds(
        task.nextRunMicroseconds,
        `${task.id}.nextRunMicroseconds`,
      );
      runs[task.id] = (runs[task.id] ?? 0) + 1;
    }
    return runs;
  }

  snapshot(): SchedulerSnapshot {
    return {
      tasks: [...this.tasks.values()]
        .map((task) => ({
          id: task.id,
          periodMicroseconds: task.periodMicroseconds,
          priority: task.priority,
          nextRunMicroseconds: task.nextRunMicroseconds,
        }))
        .sort((left, right) => compareStrings(left.id, right.id)),
    };
  }

  restore(snapshot: SchedulerSnapshot, currentMicroseconds = 0): void {
    assertSafeMicroseconds(currentMicroseconds, "currentMicroseconds");
    const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
    if (
      snapshot.tasks.length !== this.tasks.size ||
      byId.size !== this.tasks.size
    ) {
      throw new Error("scheduler snapshot does not match registered systems");
    }

    for (const task of this.tasks.values()) {
      const saved = byId.get(task.id);
      if (
        !saved ||
        saved.periodMicroseconds !== task.periodMicroseconds ||
        saved.priority !== task.priority
      ) {
        throw new Error(`scheduler definition mismatch for ${task.id}`);
      }
      assertSafeMicroseconds(saved.nextRunMicroseconds, `${task.id}.nextRun`);
      if (saved.nextRunMicroseconds <= currentMicroseconds) {
        throw new RangeError(`${task.id}.nextRun must be in the future`);
      }
      task.nextRunMicroseconds = saved.nextRunMicroseconds;
    }
  }
}

function calculateAtmosphericPressures(state: ShipState): void {
  const { atmosphere } = state;
  const temperatureK = state.thermal.habitatTemperatureK;
  const volume = atmosphere.volumeCubicMeters;
  const oxygen =
    (atmosphere.gasesKg.oxygen *
      GAS_CONSTANT_J_PER_KG_K.oxygen *
      temperatureK) /
    volume;
  const nitrogen =
    (atmosphere.gasesKg.nitrogen *
      GAS_CONSTANT_J_PER_KG_K.nitrogen *
      temperatureK) /
    volume;
  const carbonDioxide =
    (atmosphere.gasesKg.carbonDioxide *
      GAS_CONSTANT_J_PER_KG_K.carbonDioxide *
      temperatureK) /
    volume;
  const waterVapor =
    (atmosphere.gasesKg.waterVapor *
      GAS_CONSTANT_J_PER_KG_K.waterVapor *
      temperatureK) /
    volume;

  atmosphere.oxygenPartialPressurePa = oxygen;
  atmosphere.carbonDioxidePartialPressurePa = carbonDioxide;
  atmosphere.pressurePa = oxygen + nitrogen + carbonDioxide + waterVapor;
}

export function createBaselineShipState(): ShipState {
  const state: ShipState = {
    schemaVersion: 1,
    revision: 0,
    power: {
      generationKw: 842_000,
      essentialDemandKw: 420_000,
      discretionaryDemandKw: 160_000,
      jumpDriveDemandKw: 240_000,
      servedDemandKw: 820_000,
      unservedDemandKw: 0,
      curtailedGenerationKw: 22_000,
      batteryCapacityKWh: 7_200_000,
      batteryChargeKWh: 2_400_000,
      batteryThroughputKWh: 0,
    },
    thermal: {
      habitatTemperatureK: 295.15,
      habitatTargetTemperatureK: 295.15,
      coolantTemperatureK: 330,
      radiatorTemperatureK: 325,
      spaceSinkTemperatureK: 3,
      internalHeatKw: 311_000,
      radiatorConductanceKwPerK: 966,
      coolantHeatCapacityKJPerK: 90_000_000,
      radiatedHeatKw: 311_052,
    },
    atmosphere: {
      volumeCubicMeters: 450_000,
      pressurePa: 0,
      oxygenPartialPressurePa: 0,
      carbonDioxidePartialPressurePa: 0,
      gasesKg: {
        oxygen: 124_258.64606395348,
        nitrogen: 405_158.7935779377,
        carbonDioxide: 490.63627235838163,
        waterVapor: 4_016.9449436162718,
      },
      capturedCarbonDioxideKg: 0,
      ventedGasKg: 0,
      leakAreaSquareMeters: 0,
      leakFractionPerSquareMeterSecond: 0.002,
      scrubberCapacityKgPerSecond: 0.004,
    },
    water: {
      potableKg: 3_600_000,
      wastewaterKg: 120_000,
      reserveIceKg: 8_000_000,
      brineWasteKg: 0,
      consumptionKgPerAwakePersonDay: 3,
      recyclerCapacityKgPerDay: 6_000,
      recyclerEfficiency: 0.981,
      recycledKgCumulative: 0,
    },
    consumables: {
      foodDryKg: 1_200_000,
      foodConsumedKgCumulative: 0,
    },
    population: {
      total: 2_120,
      passengers: 2_000,
      crew: 120,
      awake: 218,
      hibernating: 1_902,
      deceased: 0,
      averageHealth: 0.985,
      averageMorale: 0.82,
    },
    hibernation: {
      podCapacity: 2_200,
      operationalPods: 2_160,
      occupiedPods: 1_902,
      wakeupsInProgress: 0,
      completedWakeCycles: 0,
    },
    environment: {
      radiationDoseRateMilliSievertsPerHour: 0.012,
      accumulatedHullDoseMilliSieverts: 0,
      chargedParticleFluxPerSquareMeterSecond: 3_800,
      micrometeoroidFluxPerSquareMeterYear: 0.000018,
      stellarIrradianceWattsPerSquareMeter: 0.42,
    },
    journey: {
      origin: "Sol",
      destination: "Tau Ceti",
      totalDistanceLightYears: 11.9,
      completedDistanceLightYears: 0,
      currentLeg: 1,
      totalLegs: 5,
      jumpsCompleted: 0,
      jumpDriveChargeKWh: 2_400_000,
      jumpDriveCapacityKWh: 7_200_000,
      requiredChargePerJumpKWh: 6_000_000,
      jumpDriveChargeEfficiency: 0.86,
      status: "charging",
    },
  };
  calculateAtmosphericPressures(state);
  validateShipState(state);
  return state;
}

export function validateShipState(state: ShipState): void {
  if (state.schemaVersion !== 1) {
    throw new Error("unsupported ship state schema");
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new RangeError("state.revision must be a non-negative safe integer");
  }

  const nonNegativeFields: Array<[number, string]> = [
    [state.power.generationKw, "power.generationKw"],
    [state.power.essentialDemandKw, "power.essentialDemandKw"],
    [state.power.discretionaryDemandKw, "power.discretionaryDemandKw"],
    [state.power.jumpDriveDemandKw, "power.jumpDriveDemandKw"],
    [state.power.servedDemandKw, "power.servedDemandKw"],
    [state.power.unservedDemandKw, "power.unservedDemandKw"],
    [state.power.curtailedGenerationKw, "power.curtailedGenerationKw"],
    [state.power.batteryCapacityKWh, "power.batteryCapacityKWh"],
    [state.power.batteryChargeKWh, "power.batteryChargeKWh"],
    [state.power.batteryThroughputKWh, "power.batteryThroughputKWh"],
    [state.thermal.habitatTemperatureK, "thermal.habitatTemperatureK"],
    [state.thermal.habitatTargetTemperatureK, "thermal.habitatTargetTemperatureK"],
    [state.thermal.coolantTemperatureK, "thermal.coolantTemperatureK"],
    [state.thermal.radiatorTemperatureK, "thermal.radiatorTemperatureK"],
    [state.thermal.spaceSinkTemperatureK, "thermal.spaceSinkTemperatureK"],
    [state.thermal.internalHeatKw, "thermal.internalHeatKw"],
    [
      state.thermal.radiatorConductanceKwPerK,
      "thermal.radiatorConductanceKwPerK",
    ],
    [state.thermal.coolantHeatCapacityKJPerK, "thermal.coolantHeatCapacityKJPerK"],
    [state.thermal.radiatedHeatKw, "thermal.radiatedHeatKw"],
    [state.atmosphere.volumeCubicMeters, "atmosphere.volumeCubicMeters"],
    [state.atmosphere.pressurePa, "atmosphere.pressurePa"],
    [state.atmosphere.oxygenPartialPressurePa, "atmosphere.oxygenPartialPressurePa"],
    [
      state.atmosphere.carbonDioxidePartialPressurePa,
      "atmosphere.carbonDioxidePartialPressurePa",
    ],
    [state.atmosphere.gasesKg.oxygen, "atmosphere.gasesKg.oxygen"],
    [state.atmosphere.gasesKg.nitrogen, "atmosphere.gasesKg.nitrogen"],
    [
      state.atmosphere.gasesKg.carbonDioxide,
      "atmosphere.gasesKg.carbonDioxide",
    ],
    [state.atmosphere.gasesKg.waterVapor, "atmosphere.gasesKg.waterVapor"],
    [
      state.atmosphere.capturedCarbonDioxideKg,
      "atmosphere.capturedCarbonDioxideKg",
    ],
    [state.atmosphere.ventedGasKg, "atmosphere.ventedGasKg"],
    [state.atmosphere.leakAreaSquareMeters, "atmosphere.leakAreaSquareMeters"],
    [
      state.atmosphere.leakFractionPerSquareMeterSecond,
      "atmosphere.leakFractionPerSquareMeterSecond",
    ],
    [
      state.atmosphere.scrubberCapacityKgPerSecond,
      "atmosphere.scrubberCapacityKgPerSecond",
    ],
    [state.water.potableKg, "water.potableKg"],
    [state.water.wastewaterKg, "water.wastewaterKg"],
    [state.water.reserveIceKg, "water.reserveIceKg"],
    [state.water.brineWasteKg, "water.brineWasteKg"],
    [
      state.water.consumptionKgPerAwakePersonDay,
      "water.consumptionKgPerAwakePersonDay",
    ],
    [state.water.recyclerCapacityKgPerDay, "water.recyclerCapacityKgPerDay"],
    [state.water.recycledKgCumulative, "water.recycledKgCumulative"],
    [state.consumables.foodDryKg, "consumables.foodDryKg"],
    [
      state.consumables.foodConsumedKgCumulative,
      "consumables.foodConsumedKgCumulative",
    ],
    [state.population.total, "population.total"],
    [state.population.passengers, "population.passengers"],
    [state.population.crew, "population.crew"],
    [state.population.awake, "population.awake"],
    [state.population.hibernating, "population.hibernating"],
    [state.population.deceased, "population.deceased"],
    [state.hibernation.podCapacity, "hibernation.podCapacity"],
    [state.hibernation.operationalPods, "hibernation.operationalPods"],
    [state.hibernation.occupiedPods, "hibernation.occupiedPods"],
    [state.hibernation.wakeupsInProgress, "hibernation.wakeupsInProgress"],
    [state.hibernation.completedWakeCycles, "hibernation.completedWakeCycles"],
    [
      state.environment.radiationDoseRateMilliSievertsPerHour,
      "environment.radiationDoseRateMilliSievertsPerHour",
    ],
    [
      state.environment.accumulatedHullDoseMilliSieverts,
      "environment.accumulatedHullDoseMilliSieverts",
    ],
    [
      state.environment.chargedParticleFluxPerSquareMeterSecond,
      "environment.chargedParticleFluxPerSquareMeterSecond",
    ],
    [
      state.environment.micrometeoroidFluxPerSquareMeterYear,
      "environment.micrometeoroidFluxPerSquareMeterYear",
    ],
    [
      state.environment.stellarIrradianceWattsPerSquareMeter,
      "environment.stellarIrradianceWattsPerSquareMeter",
    ],
    [state.journey.totalDistanceLightYears, "journey.totalDistanceLightYears"],
    [
      state.journey.completedDistanceLightYears,
      "journey.completedDistanceLightYears",
    ],
    [state.journey.currentLeg, "journey.currentLeg"],
    [state.journey.totalLegs, "journey.totalLegs"],
    [state.journey.jumpsCompleted, "journey.jumpsCompleted"],
    [state.journey.jumpDriveChargeKWh, "journey.jumpDriveChargeKWh"],
    [state.journey.jumpDriveCapacityKWh, "journey.jumpDriveCapacityKWh"],
    [
      state.journey.requiredChargePerJumpKWh,
      "journey.requiredChargePerJumpKWh",
    ],
  ];
  nonNegativeFields.forEach(([value, label]) => assertNonNegative(value, label));

  const integerFields: Array<[number, string]> = [
    [state.population.total, "population.total"],
    [state.population.passengers, "population.passengers"],
    [state.population.crew, "population.crew"],
    [state.population.awake, "population.awake"],
    [state.population.hibernating, "population.hibernating"],
    [state.population.deceased, "population.deceased"],
    [state.hibernation.podCapacity, "hibernation.podCapacity"],
    [state.hibernation.operationalPods, "hibernation.operationalPods"],
    [state.hibernation.occupiedPods, "hibernation.occupiedPods"],
    [state.hibernation.wakeupsInProgress, "hibernation.wakeupsInProgress"],
    [state.hibernation.completedWakeCycles, "hibernation.completedWakeCycles"],
    [state.journey.currentLeg, "journey.currentLeg"],
    [state.journey.totalLegs, "journey.totalLegs"],
    [state.journey.jumpsCompleted, "journey.jumpsCompleted"],
  ];
  for (const [value, label] of integerFields) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${label} must be a safe integer`);
    }
  }

  if (state.power.batteryChargeKWh > state.power.batteryCapacityKWh) {
    throw new Error("battery charge exceeds capacity");
  }
  if (
    state.atmosphere.volumeCubicMeters === 0 ||
    state.thermal.coolantHeatCapacityKJPerK === 0
  ) {
    throw new RangeError("atmospheric volume and thermal capacity must be positive");
  }
  assertFiniteNumber(
    state.water.recyclerEfficiency,
    "water.recyclerEfficiency",
  );
  if (state.water.recyclerEfficiency < 0 || state.water.recyclerEfficiency > 1) {
    throw new RangeError("water.recyclerEfficiency must be between zero and one");
  }
  assertFiniteNumber(state.population.averageHealth, "population.averageHealth");
  assertFiniteNumber(state.population.averageMorale, "population.averageMorale");
  if (
    state.population.averageHealth < 0 ||
    state.population.averageHealth > 1 ||
    state.population.averageMorale < 0 ||
    state.population.averageMorale > 1
  ) {
    throw new RangeError("population health and morale must be between zero and one");
  }
  if (
    state.population.total !==
    state.population.awake +
      state.population.hibernating +
      state.population.deceased
  ) {
    throw new Error("population counts do not reconcile");
  }
  if (
    state.population.total !==
    state.population.passengers + state.population.crew
  ) {
    throw new Error("passenger and crew counts do not reconcile");
  }
  if (state.hibernation.occupiedPods !== state.population.hibernating) {
    throw new Error("occupied pods must equal hibernating population");
  }
  if (
    state.hibernation.operationalPods < state.hibernation.occupiedPods ||
    state.hibernation.podCapacity < state.hibernation.operationalPods
  ) {
    throw new Error("hibernation pod capacity is inconsistent");
  }
  if (
    state.journey.jumpDriveChargeKWh > state.journey.jumpDriveCapacityKWh ||
    state.journey.requiredChargePerJumpKWh >
      state.journey.jumpDriveCapacityKWh
  ) {
    throw new Error("jump drive charge or requirement exceeds capacity");
  }
  if (
    state.journey.completedDistanceLightYears >
    state.journey.totalDistanceLightYears
  ) {
    throw new Error("completed journey distance exceeds total distance");
  }
  if (
    state.journey.jumpDriveChargeEfficiency < 0 ||
    state.journey.jumpDriveChargeEfficiency > 1
  ) {
    throw new RangeError("jump drive efficiency must be between zero and one");
  }
  assertFiniteNumber(
    state.journey.jumpDriveChargeEfficiency,
    "journey.jumpDriveChargeEfficiency",
  );
  if (
    !(
      [
        "charging",
        "ready",
        "in-transit",
        "arrived",
        "stranded",
      ] as string[]
    ).includes(state.journey.status)
  ) {
    throw new Error(`unknown journey status: ${state.journey.status}`);
  }
  assertNonEmpty(state.journey.origin, "journey.origin");
  assertNonEmpty(state.journey.destination, "journey.destination");
}

function runPowerSystem(context: SystemContext): void {
  const { power } = context.state;
  const demand =
    power.essentialDemandKw +
    power.discretionaryDemandKw +
    power.jumpDriveDemandKw;
  const netPowerKw = power.generationKw - demand;
  const durationHours = context.deltaSeconds / 3_600;

  if (netPowerKw >= 0) {
    const availableEnergyKWh = netPowerKw * durationHours;
    const storedEnergyKWh = Math.min(
      availableEnergyKWh,
      power.batteryCapacityKWh - power.batteryChargeKWh,
    );
    power.batteryChargeKWh += storedEnergyKWh;
    power.batteryThroughputKWh += storedEnergyKWh;
    power.servedDemandKw = demand;
    power.unservedDemandKw = 0;
    power.curtailedGenerationKw = Math.max(
      0,
      context.deltaSeconds === 0
        ? netPowerKw
        : netPowerKw - storedEnergyKWh / durationHours,
    );
  } else {
    const deficitEnergyKWh = -netPowerKw * durationHours;
    const dischargedEnergyKWh = Math.min(
      deficitEnergyKWh,
      power.batteryChargeKWh,
    );
    power.batteryChargeKWh -= dischargedEnergyKWh;
    power.batteryThroughputKWh += dischargedEnergyKWh;
    const batteryContributionKw =
      context.deltaSeconds === 0
        ? 0
        : dischargedEnergyKWh / durationHours;
    power.unservedDemandKw = Math.max(
      0,
      demand - power.generationKw - batteryContributionKw,
    );
    power.servedDemandKw = demand - power.unservedDemandKw;
    power.curtailedGenerationKw = 0;
  }
  context.state.revision += 1;
}

function runExternallyCoupledPowerSystem(
  context: SystemContext,
): void {
  // The external electrical network advances and projects its state before the
  // aggregate systems run. The scheduler slot stays stable for deterministic
  // restore while battery dispatch and load shedding have exactly one owner.
  void context;
}

function runThermalSystem(context: SystemContext): void {
  const { thermal, power } = context.state;
  thermal.radiatedHeatKw = Math.max(
    0,
    thermal.radiatorConductanceKwPerK *
      (thermal.radiatorTemperatureK - thermal.spaceSinkTemperatureK),
  );
  const netHeatKw = thermal.internalHeatKw - thermal.radiatedHeatKw;
  thermal.coolantTemperatureK = Math.max(
    0,
    thermal.coolantTemperatureK +
      (netHeatKw * context.deltaSeconds) /
        thermal.coolantHeatCapacityKJPerK,
  );
  const radiatorResponse = 1 - Math.exp(-context.deltaSeconds / 120);
  thermal.radiatorTemperatureK +=
    (thermal.coolantTemperatureK - thermal.radiatorTemperatureK) *
    radiatorResponse;

  const demandedKw =
    power.essentialDemandKw +
    power.discretionaryDemandKw +
    power.jumpDriveDemandKw;
  const serviceRatio =
    demandedKw === 0 ? 1 : clamp(power.servedDemandKw / demandedKw, 0, 1);
  const climateResponse = serviceRatio * (1 - Math.exp(-context.deltaSeconds / 600));
  thermal.habitatTemperatureK = Math.max(
    0,
    thermal.habitatTemperatureK +
      (thermal.habitatTargetTemperatureK - thermal.habitatTemperatureK) *
        climateResponse,
  );
  context.state.revision += 1;
}

function runExternallyCoupledThermalSystem(
  context: SystemContext,
): void {
  // The external cooling network advances and projects its state before the
  // aggregate systems run. Retaining this scheduler slot preserves a stable
  // scheduler topology without evolving a second, conflicting thermal model.
  void context;
}

function runAtmosphereSystem(context: SystemContext): void {
  const { atmosphere, population } = context.state;
  const oxygenConsumed = Math.min(
    atmosphere.gasesKg.oxygen,
    population.awake *
      OXYGEN_CONSUMPTION_KG_PER_AWAKE_PERSON_SECOND *
      context.deltaSeconds,
  );
  atmosphere.gasesKg.oxygen -= oxygenConsumed;
  atmosphere.gasesKg.carbonDioxide += oxygenConsumed;

  const scrubbed = Math.min(
    atmosphere.gasesKg.carbonDioxide,
    atmosphere.scrubberCapacityKgPerSecond * context.deltaSeconds,
  );
  atmosphere.gasesKg.carbonDioxide -= scrubbed;
  atmosphere.capturedCarbonDioxideKg += scrubbed;

  const leakFraction = clamp(
    atmosphere.leakAreaSquareMeters *
      atmosphere.leakFractionPerSquareMeterSecond *
      context.deltaSeconds,
    0,
    1,
  );
  let vented = 0;
  for (const gas of [
    "oxygen",
    "nitrogen",
    "carbonDioxide",
    "waterVapor",
  ] as const) {
    const lost = atmosphere.gasesKg[gas] * leakFraction;
    atmosphere.gasesKg[gas] -= lost;
    vented += lost;
  }
  atmosphere.ventedGasKg += vented;
  calculateAtmosphericPressures(context.state);
  context.state.revision += 1;
}

function runExternallyCoupledAtmosphereSystem(
  context: SystemContext,
): void {
  // The external 48-zone network advances and synchronizes atmosphere before
  // the rest of the aggregate systems run. Keeping this scheduler slot makes
  // snapshots topology-compatible while ensuring there is only one metabolic
  // and breach authority.
  void context;
}

function runWaterSystem(context: SystemContext): void {
  const { water, population } = context.state;
  const consumed = Math.min(
    water.potableKg,
    (population.awake *
      water.consumptionKgPerAwakePersonDay *
      context.deltaSeconds) /
      86_400,
  );
  water.potableKg -= consumed;
  water.wastewaterKg += consumed;

  const processed = Math.min(
    water.wastewaterKg,
    (water.recyclerCapacityKgPerDay * context.deltaSeconds) / 86_400,
  );
  const reclaimed = processed * water.recyclerEfficiency;
  water.wastewaterKg -= processed;
  water.potableKg += reclaimed;
  water.brineWasteKg += processed - reclaimed;
  water.recycledKgCumulative += reclaimed;
  context.state.revision += 1;
}

function runExternallyCoupledWaterSystem(context: SystemContext): void {
  // The external A/B recovery network advances and projects its aggregate
  // inventory before the remaining aggregate systems run. The scheduler slot
  // remains stable for deterministic snapshot compatibility.
  void context;
}

function runEnvironmentSystem(context: SystemContext): void {
  const { environment } = context.state;
  environment.accumulatedHullDoseMilliSieverts +=
    environment.radiationDoseRateMilliSievertsPerHour *
    (context.deltaSeconds / 3_600);
  context.state.revision += 1;
}

function runPopulationSystem(context: SystemContext): void {
  const { atmosphere, environment, population, thermal, power } =
    context.state;
  let healthRatePerHour = 0.000004;
  if (
    atmosphere.oxygenPartialPressurePa < 18_000 ||
    atmosphere.pressurePa < 75_000
  ) {
    healthRatePerHour -= 0.02;
  }
  if (atmosphere.carbonDioxidePartialPressurePa > 2_000) {
    healthRatePerHour -= 0.01;
  }
  if (
    thermal.habitatTemperatureK < 283.15 ||
    thermal.habitatTemperatureK > 303.15
  ) {
    healthRatePerHour -= 0.004;
  }
  if (power.unservedDemandKw > 0) {
    healthRatePerHour -= 0.001;
  }
  if (environment.radiationDoseRateMilliSievertsPerHour > 0.05) {
    healthRatePerHour -=
      (environment.radiationDoseRateMilliSievertsPerHour - 0.05) * 0.0002;
  }
  population.averageHealth = clamp(
    population.averageHealth +
      healthRatePerHour * (context.deltaSeconds / 3_600),
    0,
    1,
  );

  const comfort =
    1 -
    Math.min(
      1,
      Math.abs(
        thermal.habitatTemperatureK - thermal.habitatTargetTemperatureK,
      ) / 12,
    );
  const targetMorale = clamp(
    0.5 * population.averageHealth + 0.35 * comfort + 0.15,
    0,
    1,
  );
  population.averageMorale +=
    (targetMorale - population.averageMorale) *
    (1 - Math.exp(-context.deltaSeconds / 86_400));
  context.state.revision += 1;
}

function runExternallyCoupledPopulationSystem(
  context: SystemContext,
): void {
  // An external roster advances individual physiology and psychology, then
  // synchronizes its derived population averages through the public API. The
  // scheduler slot remains present so aggregate and roster-backed snapshots
  // retain identical deterministic topology without a second authority
  // inventing health or morale changes.
  void context;
}

function runHibernationSystem(context: SystemContext): void {
  const { hibernation, population } = context.state;
  hibernation.occupiedPods = population.hibernating;
  context.state.revision += 1;
}

function runJourneySystem(context: SystemContext): void {
  const { journey, power } = context.state;
  if (journey.status !== "charging") {
    context.state.revision += 1;
    return;
  }
  const totalDemand =
    power.essentialDemandKw +
    power.discretionaryDemandKw +
    power.jumpDriveDemandKw;
  const serviceRatio =
    totalDemand === 0 ? 1 : clamp(power.servedDemandKw / totalDemand, 0, 1);
  const suppliedJumpPowerKw = power.jumpDriveDemandKw * serviceRatio;
  journey.jumpDriveChargeKWh = Math.min(
    journey.jumpDriveCapacityKWh,
    journey.jumpDriveChargeKWh +
      suppliedJumpPowerKw *
        journey.jumpDriveChargeEfficiency *
        (context.deltaSeconds / 3_600),
  );
  if (journey.jumpDriveChargeKWh >= journey.requiredChargePerJumpKWh) {
    journey.status = "ready";
  }
  context.state.revision += 1;
}

function runExternallyCoupledJourneySystem(
  context: SystemContext,
): void {
  // The external electrical network accounts the energy actually served by
  // the two jump-drive feeders. The worker then transfers only that measured
  // energy into field storage and the cooling ledger. Keeping this scheduler
  // slot stable preserves deterministic snapshots without estimating charge
  // from an aggregate whole-ship service ratio.
  void context;
}

function validateBalanceDelta(delta: ExternalBalanceDelta): void {
  assertFiniteNumber(delta.massKg, "declaredBalance.massKg");
  assertFiniteNumber(delta.energyJ, "declaredBalance.energyJ");
  delta.linearMomentumKgMPerSecond.forEach((value, index) =>
    assertFiniteNumber(
      value,
      `declaredBalance.linearMomentumKgMPerSecond[${index}]`,
    ),
  );
  delta.angularMomentumKgM2PerSecond.forEach((value, index) =>
    assertFiniteNumber(
      value,
      `declaredBalance.angularMomentumKgM2PerSecond[${index}]`,
    ),
  );
  assertNonEmpty(delta.note, "declaredBalance.note");
}

function readStateLeaf(
  root: ShipState,
  path: string,
): { parent: Record<string, unknown>; key: string; value: JsonPrimitive } {
  const segments = path.split(".");
  if (
    segments.length < 2 ||
    segments.some((segment) => !/^[A-Za-z][A-Za-z0-9]*$/.test(segment)) ||
    !STATE_MUTABLE_ROOTS.has(segments[0])
  ) {
    throw new Error(`state path is not externally mutable: ${path}`);
  }

  let cursor: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      throw new Error(`unknown state path: ${path}`);
    }
    cursor = cursor[segment];
  }
  const key = segments[segments.length - 1];
  if (!isRecord(cursor) || !Object.prototype.hasOwnProperty.call(cursor, key)) {
    throw new Error(`unknown state path: ${path}`);
  }
  const value = cursor[key];
  if (
    value !== null &&
    typeof value !== "number" &&
    typeof value !== "string" &&
    typeof value !== "boolean"
  ) {
    throw new Error(`state path does not point to a scalar: ${path}`);
  }
  if (typeof value === "number") {
    assertFiniteNumber(value, path);
  }
  return { parent: cursor, key, value };
}

function mergeRunCounts(
  target: { [systemId: string]: number },
  addition: { [systemId: string]: number },
): void {
  for (const [id, count] of Object.entries(addition)) {
    target[id] = (target[id] ?? 0) + count;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SimulationEngine {
  private stateValue: ShipState;
  private clockValue: SimulationClock;
  private randomValue: SeededRandom;
  private eventQueueValue: DeterministicEventQueue;
  private schedulerValue: MultiRateScheduler<SystemContext>;
  private powerAuthorityValue: PowerAuthority;
  private atmosphereAuthorityValue: AtmosphereAuthority;
  private thermalAuthorityValue: ThermalAuthority;
  private populationAuthorityValue: PopulationAuthority;
  private waterAuthorityValue: WaterAuthority;
  private interventionLedgerValue: ExternalInterventionRecord[] = [];
  private eventLogValue: ProcessedEventRecord[] = [];
  private nextInterventionSequenceValue = 1;

  constructor(options: SimulationEngineOptions = {}) {
    this.stateValue = cloneData(options.state ?? createBaselineShipState());
    validateShipState(this.stateValue);
    this.powerAuthorityValue =
      options.powerAuthority ?? "aggregate";
    this.atmosphereAuthorityValue =
      options.atmosphereAuthority ?? "aggregate";
    this.thermalAuthorityValue =
      options.thermalAuthority ?? "aggregate";
    this.populationAuthorityValue =
      options.populationAuthority ?? "aggregate";
    this.waterAuthorityValue = options.waterAuthority ?? "aggregate";
    if (
      this.populationAuthorityValue !== "aggregate" &&
      this.populationAuthorityValue !== "external-roster"
    ) {
      throw new TypeError("invalid population authority");
    }
    if (
      this.waterAuthorityValue !== "aggregate" &&
      this.waterAuthorityValue !== "external-network"
    ) {
      throw new TypeError("invalid water authority");
    }
    this.clockValue = new SimulationClock(options.timeScale ?? 1);
    this.randomValue = new SeededRandom(options.seed ?? 0);
    this.eventQueueValue = new DeterministicEventQueue();
    this.schedulerValue = new MultiRateScheduler<SystemContext>();
    this.registerBuiltInSystems();
  }

  private registerBuiltInSystems(): void {
    const register = (
      id: string,
      periodSeconds: number,
      priority: number,
      run: (context: SystemContext) => void,
    ): void => {
      this.schedulerValue.register({
        id,
        periodMicroseconds: secondsToMicroseconds(periodSeconds),
        priority,
        run,
      });
    };

    register(
      "power",
      1,
      100,
      this.powerAuthorityValue === "external-network"
        ? runExternallyCoupledPowerSystem
        : runPowerSystem,
    );
    register(
      "thermal",
      2,
      90,
      this.thermalAuthorityValue === "external-network"
        ? runExternallyCoupledThermalSystem
        : runThermalSystem,
    );
    register(
      "atmosphere",
      5,
      80,
      this.atmosphereAuthorityValue === "external-network"
        ? runExternallyCoupledAtmosphereSystem
        : runAtmosphereSystem,
    );
    register(
      "water",
      60,
      70,
      this.waterAuthorityValue === "external-network"
        ? runExternallyCoupledWaterSystem
        : runWaterSystem,
    );
    register("environment", 60, 65, runEnvironmentSystem);
    register(
      "population",
      60,
      60,
      this.populationAuthorityValue === "external-roster"
        ? runExternallyCoupledPopulationSystem
        : runPopulationSystem,
    );
    register("hibernation", 60, 50, runHibernationSystem);
    register(
      "journey",
      60,
      40,
      this.powerAuthorityValue === "external-network"
        ? runExternallyCoupledJourneySystem
        : runJourneySystem,
    );
  }

  get elapsedMicroseconds(): number {
    return this.clockValue.elapsedMicroseconds;
  }

  get elapsedSeconds(): number {
    return this.clockValue.elapsedSeconds;
  }

  get timeScale(): number {
    return this.clockValue.timeScale;
  }

  setTimeScale(timeScale: number): void {
    this.clockValue.setTimeScale(timeScale);
  }

  previewScaledSimulationSeconds(realSeconds: number): number {
    assertNonNegative(realSeconds, "realSeconds");
    const clock = this.clockValue.snapshot();
    const exactMicroseconds =
      realSeconds * clock.timeScale * MICROSECONDS_PER_SECOND +
      clock.fractionalMicroseconds;
    assertFiniteNumber(exactMicroseconds, "scaled duration");
    const wholeMicroseconds = Math.floor(exactMicroseconds);
    assertSafeMicroseconds(wholeMicroseconds, "scaled duration");
    return microsecondsToSeconds(wholeMicroseconds);
  }

  executeJump(requestedDistanceLightYears: number): JumpExecutionResult {
    assertFiniteNumber(
      requestedDistanceLightYears,
      "requestedDistanceLightYears",
    );
    if (
      requestedDistanceLightYears < 0.1 ||
      requestedDistanceLightYears > 5
    ) {
      throw new RangeError(
        "a single jump must cover between 0.1 and 5 light-years",
      );
    }
    const { journey, thermal } = this.stateValue;
    if (journey.status !== "ready") {
      throw new Error("jump drive is not ready");
    }
    const remainingDistance =
      journey.totalDistanceLightYears -
      journey.completedDistanceLightYears;
    if (remainingDistance <= 0) {
      throw new Error("journey has no remaining distance");
    }

    const distanceLightYears = Math.min(
      requestedDistanceLightYears,
      remainingDistance,
    );
    const distanceFraction = distanceLightYears / 5;
    const energyConsumedKWh =
      journey.requiredChargePerJumpKWh *
      (0.35 + 0.65 * distanceFraction ** 2);
    if (journey.jumpDriveChargeKWh < energyConsumedKWh) {
      throw new Error("jump drive charge is insufficient");
    }

    journey.jumpDriveChargeKWh -= energyConsumedKWh;
    journey.completedDistanceLightYears = Math.min(
      journey.totalDistanceLightYears,
      journey.completedDistanceLightYears + distanceLightYears,
    );
    journey.jumpsCompleted += 1;
    journey.currentLeg = Math.min(
      journey.totalLegs,
      journey.jumpsCompleted + 1,
    );

    const wasteHeatJoules = energyConsumedKWh * 3_600_000 * 0.008;
    thermal.coolantTemperatureK +=
      wasteHeatJoules /
      (thermal.coolantHeatCapacityKJPerK * 1_000);

    const arrived =
      journey.totalDistanceLightYears -
        journey.completedDistanceLightYears <
      1e-9;
    journey.status = arrived ? "arrived" : "charging";
    this.stateValue.revision += 1;
    validateShipState(this.stateValue);

    return {
      distanceLightYears,
      energyConsumedKWh,
      wasteHeatJoules,
      completedDistanceLightYears: journey.completedDistanceLightYears,
      jumpsCompleted: journey.jumpsCompleted,
      status: journey.status,
    };
  }

  acceptExternallySuppliedJumpDriveEnergy(
    servedElectricalEnergyKWh: number,
  ): ExternalJumpDriveChargingResult {
    if (this.powerAuthorityValue !== "external-network") {
      throw new Error(
        "external jump-drive charging requires external electrical authority",
      );
    }
    assertNonNegative(
      servedElectricalEnergyKWh,
      "servedElectricalEnergyKWh",
    );
    const { journey } = this.stateValue;
    let storedFieldEnergyKWh = 0;
    if (
      journey.status === "charging" &&
      servedElectricalEnergyKWh > 0
    ) {
      const requiredHeadroomKWh = Math.max(
        0,
        journey.requiredChargePerJumpKWh -
          journey.jumpDriveChargeKWh,
      );
      storedFieldEnergyKWh = Math.min(
        requiredHeadroomKWh,
        servedElectricalEnergyKWh *
          journey.jumpDriveChargeEfficiency,
      );
      journey.jumpDriveChargeKWh = Math.min(
        journey.jumpDriveCapacityKWh,
        journey.jumpDriveChargeKWh + storedFieldEnergyKWh,
      );
      if (
        journey.jumpDriveChargeKWh >=
        journey.requiredChargePerJumpKWh
      ) {
        journey.status = "ready";
      }
      this.stateValue.revision += 1;
      validateShipState(this.stateValue);
    }
    return {
      servedElectricalEnergyKWh,
      storedFieldEnergyKWh,
      dissipatedHeatEnergyKWh:
        servedElectricalEnergyKWh - storedFieldEnergyKWh,
      status: journey.status,
    };
  }

  synchronizePopulationCounts(
    counts: PopulationCountSynchronization,
  ): void {
    for (const [value, label] of [
      [counts.awake, "counts.awake"],
      [counts.hibernating, "counts.hibernating"],
      [counts.deceased, "counts.deceased"],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative integer`);
      }
    }
    if (
      counts.awake + counts.hibernating + counts.deceased !==
      this.stateValue.population.total
    ) {
      throw new Error(
        "individual passenger counts must match the aggregate population",
      );
    }
    if (
      counts.hibernating >
      this.stateValue.hibernation.operationalPods
    ) {
      throw new Error("hibernating population exceeds operational pods");
    }
    this.stateValue.population.awake = counts.awake;
    this.stateValue.population.hibernating = counts.hibernating;
    this.stateValue.population.deceased = counts.deceased;
    this.stateValue.hibernation.occupiedPods = counts.hibernating;
    this.stateValue.revision += 1;
    validateShipState(this.stateValue);
  }

  synchronizePopulationAverages(
    averages: PopulationAverageSynchronization,
  ): void {
    for (const [value, label] of [
      [averages.averageHealth, "averages.averageHealth"],
      [averages.averageMorale, "averages.averageMorale"],
    ] as const) {
      assertFiniteNumber(value, label);
      if (value < 0 || value > 1) {
        throw new RangeError(`${label} must be between zero and one`);
      }
    }
    this.stateValue.population.averageHealth = averages.averageHealth;
    this.stateValue.population.averageMorale = averages.averageMorale;
    this.stateValue.revision += 1;
    validateShipState(this.stateValue);
  }

  synchronizePowerNetwork(
    power: PowerNetworkSynchronization,
  ): void {
    for (const [value, label] of [
      [power.generationKw, "power.generationKw"],
      [power.essentialDemandKw, "power.essentialDemandKw"],
      [power.discretionaryDemandKw, "power.discretionaryDemandKw"],
      [power.jumpDriveDemandKw, "power.jumpDriveDemandKw"],
      [power.servedDemandKw, "power.servedDemandKw"],
      [power.unservedDemandKw, "power.unservedDemandKw"],
      [power.curtailedGenerationKw, "power.curtailedGenerationKw"],
      [power.batteryCapacityKWh, "power.batteryCapacityKWh"],
      [power.batteryChargeKWh, "power.batteryChargeKWh"],
      [power.batteryThroughputKWh, "power.batteryThroughputKWh"],
    ] as const) {
      assertNonNegative(value, label);
    }
    if (power.batteryChargeKWh > power.batteryCapacityKWh) {
      throw new RangeError(
        "power.batteryChargeKWh cannot exceed battery capacity",
      );
    }
    const demandedKw =
      power.essentialDemandKw +
      power.discretionaryDemandKw +
      power.jumpDriveDemandKw;
    const serviceClosureErrorKw =
      power.servedDemandKw +
      power.unservedDemandKw -
      demandedKw;
    if (Math.abs(serviceClosureErrorKw) > 1e-6) {
      throw new Error(
        `power demand service does not close: ${serviceClosureErrorKw} kW`,
      );
    }

    this.stateValue.power = cloneData(power);
    this.stateValue.revision += 1;
    validateShipState(this.stateValue);
  }

  synchronizeAtmosphereNetwork(
    atmosphere: AtmosphereNetworkSynchronization,
  ): void {
    for (const [value, label] of [
      [atmosphere.volumeCubicMeters, "atmosphere.volumeCubicMeters"],
      [atmosphere.pressurePa, "atmosphere.pressurePa"],
      [
        atmosphere.oxygenPartialPressurePa,
        "atmosphere.oxygenPartialPressurePa",
      ],
      [
        atmosphere.carbonDioxidePartialPressurePa,
        "atmosphere.carbonDioxidePartialPressurePa",
      ],
      [
        atmosphere.capturedCarbonDioxideKg,
        "atmosphere.capturedCarbonDioxideKg",
      ],
      [atmosphere.ventedGasKg, "atmosphere.ventedGasKg"],
      [
        atmosphere.leakAreaSquareMeters,
        "atmosphere.leakAreaSquareMeters",
      ],
      [atmosphere.gasesKg.oxygen, "atmosphere.gasesKg.oxygen"],
      [atmosphere.gasesKg.nitrogen, "atmosphere.gasesKg.nitrogen"],
      [
        atmosphere.gasesKg.carbonDioxide,
        "atmosphere.gasesKg.carbonDioxide",
      ],
      [
        atmosphere.gasesKg.waterVapor,
        "atmosphere.gasesKg.waterVapor",
      ],
    ] as const) {
      assertNonNegative(value, label);
    }
    if (atmosphere.volumeCubicMeters <= 0) {
      throw new RangeError(
        "atmosphere.volumeCubicMeters must be greater than zero",
      );
    }
    if (
      atmosphere.oxygenPartialPressurePa +
        atmosphere.carbonDioxidePartialPressurePa >
      atmosphere.pressurePa + 1e-6
    ) {
      throw new Error(
        "reported gas partial pressures exceed total pressure",
      );
    }

    this.stateValue.atmosphere = {
      ...this.stateValue.atmosphere,
      volumeCubicMeters: atmosphere.volumeCubicMeters,
      gasesKg: cloneData(atmosphere.gasesKg),
      pressurePa: atmosphere.pressurePa,
      oxygenPartialPressurePa: atmosphere.oxygenPartialPressurePa,
      carbonDioxidePartialPressurePa:
        atmosphere.carbonDioxidePartialPressurePa,
      capturedCarbonDioxideKg:
        atmosphere.capturedCarbonDioxideKg,
      ventedGasKg: atmosphere.ventedGasKg,
      leakAreaSquareMeters: atmosphere.leakAreaSquareMeters,
    };
    this.stateValue.revision += 1;
    validateShipState(this.stateValue);
  }

  synchronizeThermalNetwork(
    thermal: ThermalNetworkSynchronization,
  ): void {
    for (const [value, label] of [
      [thermal.habitatTemperatureK, "thermal.habitatTemperatureK"],
      [thermal.coolantTemperatureK, "thermal.coolantTemperatureK"],
      [thermal.radiatorTemperatureK, "thermal.radiatorTemperatureK"],
      [thermal.spaceSinkTemperatureK, "thermal.spaceSinkTemperatureK"],
      [thermal.internalHeatKw, "thermal.internalHeatKw"],
      [thermal.radiatedHeatKw, "thermal.radiatedHeatKw"],
      [
        thermal.radiatorConductanceKwPerK,
        "thermal.radiatorConductanceKwPerK",
      ],
      [
        thermal.coolantHeatCapacityKJPerK,
        "thermal.coolantHeatCapacityKJPerK",
      ],
    ] as const) {
      assertNonNegative(value, label);
    }
    if (
      thermal.habitatTemperatureK <= 0 ||
      thermal.coolantTemperatureK <= 0 ||
      thermal.radiatorTemperatureK <= 0 ||
      thermal.spaceSinkTemperatureK <= 0 ||
      thermal.coolantHeatCapacityKJPerK <= 0
    ) {
      throw new RangeError(
        "thermal network temperatures and heat capacity must be positive",
      );
    }

    this.stateValue.thermal = {
      ...this.stateValue.thermal,
      ...cloneData(thermal),
    };
    this.stateValue.revision += 1;
    validateShipState(this.stateValue);
  }

  synchronizeWaterNetwork(water: WaterState): void {
    for (const [value, label] of [
      [water.potableKg, "water.potableKg"],
      [water.wastewaterKg, "water.wastewaterKg"],
      [water.reserveIceKg, "water.reserveIceKg"],
      [water.brineWasteKg, "water.brineWasteKg"],
      [
        water.consumptionKgPerAwakePersonDay,
        "water.consumptionKgPerAwakePersonDay",
      ],
      [water.recyclerCapacityKgPerDay, "water.recyclerCapacityKgPerDay"],
      [water.recyclerEfficiency, "water.recyclerEfficiency"],
      [water.recycledKgCumulative, "water.recycledKgCumulative"],
    ] as const) {
      assertNonNegative(value, label);
    }
    if (water.recyclerEfficiency > 1) {
      throw new RangeError("water.recyclerEfficiency must not exceed 1");
    }
    this.stateValue.water = cloneData(water);
    this.stateValue.revision += 1;
    validateShipState(this.stateValue);
  }

  applyMetabolicMassExchange(
    exchange: MetabolicMassExchange,
  ): void {
    for (const [value, label] of [
      [exchange.oxygenConsumedKg, "exchange.oxygenConsumedKg"],
      [
        exchange.carbonDioxideProducedKg,
        "exchange.carbonDioxideProducedKg",
      ],
      [
        exchange.waterVaporProducedKg,
        "exchange.waterVaporProducedKg",
      ],
    ] as const) {
      assertNonNegative(value, label);
    }
    const feedstockConsumedKg =
      exchange.carbonDioxideProducedKg -
      exchange.oxygenConsumedKg;
    if (feedstockConsumedKg < -1e-12) {
      throw new Error(
        "carbon dioxide output cannot weigh less than consumed oxygen in this reduced metabolic chemistry",
      );
    }
    const normalizedFeedstockConsumedKg = Math.max(
      0,
      feedstockConsumedKg,
    );
    if (
      normalizedFeedstockConsumedKg >
      this.stateValue.consumables.foodDryKg + 1e-12
    ) {
      throw new Error("metabolic feedstock reservoir is exhausted");
    }
    if (
      this.waterAuthorityValue === "aggregate" &&
      exchange.waterVaporProducedKg >
      this.stateValue.water.potableKg + 1e-12
    ) {
      throw new Error("metabolic water reservoir is exhausted");
    }

    this.stateValue.consumables.foodDryKg = Math.max(
      0,
      this.stateValue.consumables.foodDryKg -
        normalizedFeedstockConsumedKg,
    );
    this.stateValue.consumables.foodConsumedKgCumulative +=
      normalizedFeedstockConsumedKg;
    if (this.waterAuthorityValue === "aggregate") {
      this.stateValue.water.potableKg = Math.max(
        0,
        this.stateValue.water.potableKg -
          exchange.waterVaporProducedKg,
      );
    }
    this.stateValue.revision += 1;
    validateShipState(this.stateValue);
  }

  getState(): ShipState {
    return cloneData(this.stateValue);
  }

  getInterventionLedger(): ExternalInterventionRecord[] {
    return cloneData(this.interventionLedgerValue);
  }

  getEventLog(): ProcessedEventRecord[] {
    return cloneData(this.eventLogValue);
  }

  getExternalBalance(): ExternalBalanceDelta {
    const balance: ExternalBalanceDelta = {
      massKg: 0,
      energyJ: 0,
      linearMomentumKgMPerSecond: [0, 0, 0],
      angularMomentumKgM2PerSecond: [0, 0, 0],
      note: "Sum of applied external interventions",
    };
    for (const record of this.interventionLedgerValue) {
      if (record.status !== "applied") {
        continue;
      }
      balance.massKg += record.declaredBalance.massKg;
      balance.energyJ += record.declaredBalance.energyJ;
      for (let index = 0; index < 3; index += 1) {
        balance.linearMomentumKgMPerSecond[index] +=
          record.declaredBalance.linearMomentumKgMPerSecond[index];
        balance.angularMomentumKgM2PerSecond[index] +=
          record.declaredBalance.angularMomentumKgM2PerSecond[index];
      }
    }
    return balance;
  }

  scheduleEvent<TPayload extends JsonValue>(
    input: ScheduleEventInput<TPayload>,
  ): ScheduledEvent<TPayload> {
    if (input.atMicroseconds < this.clockValue.elapsedMicroseconds) {
      throw new RangeError("cannot schedule an event in the past");
    }
    return this.eventQueueValue.schedule(input);
  }

  scheduleIntervention(
    atMicroseconds: number,
    request: ExternalInterventionRequest,
    priority = 1_000,
  ): ScheduledEvent {
    this.validateInterventionEnvelope(request);
    const payload = cloneData(request);
    assertJsonValue(payload, "intervention event payload");
    return this.scheduleEvent({
      type: INTERVENTION_EVENT_TYPE,
      atMicroseconds,
      priority,
      payload,
    });
  }

  cancelEvent(id: string): boolean {
    return this.eventQueueValue.cancel(id);
  }

  applyExternalIntervention(
    request: ExternalInterventionRequest,
  ): ExternalInterventionRecord {
    this.validateInterventionEnvelope(request);
    const sequence = this.nextInterventionSequenceValue;
    this.nextInterventionSequenceValue += 1;
    const id = request.id ?? `intervention-${sequence}`;
    assertNonEmpty(id, "intervention id");
    if (this.interventionLedgerValue.some((entry) => entry.id === id)) {
      throw new Error(`intervention id already exists: ${id}`);
    }

    const revisionBefore = this.stateValue.revision;
    const draft = cloneData(this.stateValue);
    const appliedOperations: AppliedInterventionOperation[] = [];

    try {
      for (const operation of request.operations) {
        const leaf = readStateLeaf(draft, operation.path);
        let after: JsonPrimitive;
        if (operation.operation === "set") {
          if (
            typeof leaf.value === "number" &&
            typeof operation.value !== "number"
          ) {
            throw new TypeError(`${operation.path} must remain numeric`);
          }
          if (
            typeof leaf.value === "string" &&
            typeof operation.value !== "string"
          ) {
            throw new TypeError(`${operation.path} must remain a string`);
          }
          if (
            typeof leaf.value === "boolean" &&
            typeof operation.value !== "boolean"
          ) {
            throw new TypeError(`${operation.path} must remain boolean`);
          }
          after = operation.value;
        } else {
          if (typeof leaf.value !== "number") {
            throw new TypeError(`${operation.path} is not numeric`);
          }
          assertFiniteNumber(operation.value, `${operation.path} operand`);
          after =
            operation.operation === "add"
              ? leaf.value + operation.value
              : leaf.value * operation.value;
          assertFiniteNumber(after, `${operation.path} result`);
        }
        leaf.parent[leaf.key] = after;
        appliedOperations.push({
          operation: operation.operation,
          path: operation.path,
          operand: operation.value,
          before: leaf.value,
          after,
        });
      }

      draft.revision = revisionBefore + 1;
      validateShipState(draft);
      this.stateValue = draft;
      const record: ExternalInterventionRecord = {
        sequence,
        id,
        simTimeMicroseconds: this.clockValue.elapsedMicroseconds,
        actor: request.actor,
        reason: request.reason,
        status: "applied",
        operations: appliedOperations,
        declaredBalance: cloneData(request.declaredBalance),
        stateRevisionBefore: revisionBefore,
        stateRevisionAfter: draft.revision,
        ...(request.metadata ? { metadata: cloneData(request.metadata) } : {}),
      };
      this.interventionLedgerValue.push(record);
      return cloneData(record);
    } catch (error) {
      const record: ExternalInterventionRecord = {
        sequence,
        id,
        simTimeMicroseconds: this.clockValue.elapsedMicroseconds,
        actor: request.actor,
        reason: request.reason,
        status: "rejected",
        operations: appliedOperations,
        declaredBalance: cloneData(request.declaredBalance),
        stateRevisionBefore: revisionBefore,
        stateRevisionAfter: revisionBefore,
        ...(request.metadata ? { metadata: cloneData(request.metadata) } : {}),
        error: errorMessage(error),
      };
      this.interventionLedgerValue.push(record);
      throw error;
    }
  }

  private validateInterventionEnvelope(
    request: ExternalInterventionRequest,
  ): void {
    assertNonEmpty(request.actor, "intervention.actor");
    assertNonEmpty(request.reason, "intervention.reason");
    if (
      request.operations.length === 0 &&
      request.metadata?.mode !== "causal-event"
    ) {
      throw new Error(
        "intervention must contain an operation unless it is a causal domain event",
      );
    }
    validateBalanceDelta(request.declaredBalance);
    request.operations.forEach((operation, index) => {
      assertNonEmpty(operation.path, `operations[${index}].path`);
      if (
        operation.operation !== "set" &&
        operation.operation !== "add" &&
        operation.operation !== "multiply"
      ) {
        throw new TypeError(`unsupported intervention operation at index ${index}`);
      }
      assertJsonValue(operation.value, `operations[${index}].value`);
    });
    if (request.metadata) {
      assertJsonValue(request.metadata, "intervention.metadata");
    }
  }

  step(realSeconds: number): SimulationStepResult {
    const simulatedMicroseconds =
      this.clockValue.scaledDurationForRealSeconds(realSeconds);
    return this.advanceByMicroseconds(simulatedMicroseconds);
  }

  stepSliced(
    realSeconds: number,
    maximumSimulatedSliceSeconds: SimulationSliceLimit,
    beforeSlice?: (slice: SimulationStepSlice) => void,
  ): SimulationStepResult {
    assertNonNegative(realSeconds, "realSeconds");
    const sliceLimitResolver =
      typeof maximumSimulatedSliceSeconds === "function"
        ? maximumSimulatedSliceSeconds
        : null;
    const fixedMaximumSliceMicroseconds =
      typeof maximumSimulatedSliceSeconds === "number"
        ? (() => {
            assertFiniteNumber(
              maximumSimulatedSliceSeconds,
              "maximumSimulatedSliceSeconds",
            );
            if (maximumSimulatedSliceSeconds <= 0) {
              throw new RangeError(
                "maximumSimulatedSliceSeconds must be positive",
              );
            }
            const converted = secondsToMicroseconds(
              maximumSimulatedSliceSeconds,
            );
            if (converted === 0) {
              throw new RangeError(
                "maximumSimulatedSliceSeconds is below clock resolution",
              );
            }
            return converted;
          })()
        : null;

    const simulatedMicroseconds =
      this.clockValue.scaledDurationForRealSeconds(realSeconds);
    const fromMicroseconds = this.clockValue.elapsedMicroseconds;
    const processedEvents: ProcessedEventRecord[] = [];
    const systemRuns: { [systemId: string]: number } = {};
    let remainingMicroseconds = simulatedMicroseconds;

    while (remainingMicroseconds > 0) {
      const maximumSliceMicroseconds =
        fixedMaximumSliceMicroseconds ??
        (() => {
          const resolved = sliceLimitResolver!({
            fromMicroseconds:
              this.clockValue.elapsedMicroseconds,
            remainingSimulatedSeconds:
              microsecondsToSeconds(remainingMicroseconds),
          });
          assertFiniteNumber(
            resolved,
            "resolved maximumSimulatedSliceSeconds",
          );
          if (resolved <= 0) {
            throw new RangeError(
              "resolved maximumSimulatedSliceSeconds must be positive",
            );
          }
          const converted = secondsToMicroseconds(resolved);
          if (converted === 0) {
            throw new RangeError(
              "resolved maximumSimulatedSliceSeconds is below clock resolution",
            );
          }
          return converted;
        })();
      const sliceMicroseconds = Math.min(
        maximumSliceMicroseconds,
        remainingMicroseconds,
      );
      const sliceFromMicroseconds =
        this.clockValue.elapsedMicroseconds;
      beforeSlice?.({
        fromMicroseconds: sliceFromMicroseconds,
        toMicroseconds:
          sliceFromMicroseconds + sliceMicroseconds,
        simulatedSeconds:
          microsecondsToSeconds(sliceMicroseconds),
      });
      const result = this.advanceByMicroseconds(
        sliceMicroseconds,
      );
      processedEvents.push(...result.processedEvents);
      mergeRunCounts(systemRuns, result.systemRuns);
      remainingMicroseconds -= sliceMicroseconds;
    }

    if (simulatedMicroseconds === 0) {
      return this.advanceByMicroseconds(0);
    }
    return {
      fromMicroseconds,
      toMicroseconds: this.clockValue.elapsedMicroseconds,
      simulatedSeconds:
        microsecondsToSeconds(simulatedMicroseconds),
      processedEvents,
      systemRuns,
      stateRevision: this.stateValue.revision,
    };
  }

  stepSimulation(simulatedSeconds: number): SimulationStepResult {
    return this.advanceByMicroseconds(secondsToMicroseconds(simulatedSeconds));
  }

  private advanceByMicroseconds(
    simulatedMicroseconds: number,
  ): SimulationStepResult {
    assertSafeMicroseconds(simulatedMicroseconds, "simulatedMicroseconds");
    const fromMicroseconds = this.clockValue.elapsedMicroseconds;
    const targetMicroseconds = fromMicroseconds + simulatedMicroseconds;
    assertSafeMicroseconds(targetMicroseconds, "targetMicroseconds");
    const processedEvents: ProcessedEventRecord[] = [];
    const systemRuns: { [systemId: string]: number } = {};

    while (true) {
      const nextEventTime = this.eventQueueValue.peek()?.atMicroseconds;
      const nextSystemTime = this.schedulerValue.nextRunMicroseconds();
      const candidates = [nextEventTime, nextSystemTime].filter(
        (value): value is number =>
          value !== undefined && value <= targetMicroseconds,
      );
      if (candidates.length === 0) {
        break;
      }
      const boundary = Math.min(...candidates);
      this.clockValue.advanceTo(boundary);

      if (nextEventTime === boundary) {
        const dueEvents = this.eventQueueValue.popDue(boundary);
        for (const event of dueEvents) {
          const record = this.processEvent(event);
          processedEvents.push(record);
          this.eventLogValue.push(record);
        }
      }

      if (nextSystemTime === boundary) {
        const runs = this.schedulerValue.runAt(boundary, (task) => ({
          state: this.stateValue,
          deltaSeconds: microsecondsToSeconds(task.periodMicroseconds),
          nowMicroseconds: boundary,
          random: this.randomValue,
        }));
        mergeRunCounts(systemRuns, runs);
        validateShipState(this.stateValue);
      }
    }

    this.clockValue.advanceTo(targetMicroseconds);
    return {
      fromMicroseconds,
      toMicroseconds: targetMicroseconds,
      simulatedSeconds: microsecondsToSeconds(simulatedMicroseconds),
      processedEvents: cloneData(processedEvents),
      systemRuns,
      stateRevision: this.stateValue.revision,
    };
  }

  private processEvent(event: ScheduledEvent): ProcessedEventRecord {
    if (event.type !== INTERVENTION_EVENT_TYPE) {
      return {
        event: cloneData(event),
        processedAtMicroseconds: this.clockValue.elapsedMicroseconds,
        outcome: "observed",
      };
    }

    try {
      const request = cloneData(event.payload) as unknown;
      if (!isRecord(request)) {
        throw new TypeError("scheduled intervention payload must be an object");
      }
      const record = this.applyExternalIntervention(
        request as unknown as ExternalInterventionRequest,
      );
      return {
        event: cloneData(event),
        processedAtMicroseconds: this.clockValue.elapsedMicroseconds,
        outcome: "intervention-applied",
        detail: record.id,
      };
    } catch (error) {
      return {
        event: cloneData(event),
        processedAtMicroseconds: this.clockValue.elapsedMicroseconds,
        outcome: "intervention-rejected",
        detail: errorMessage(error),
      };
    }
  }

  snapshot(): SimulationSnapshot {
    return {
      snapshotVersion: SIMULATION_SNAPSHOT_VERSION,
      powerAuthority: this.powerAuthorityValue,
      atmosphereAuthority: this.atmosphereAuthorityValue,
      thermalAuthority: this.thermalAuthorityValue,
      populationAuthority: this.populationAuthorityValue,
      waterAuthority: this.waterAuthorityValue,
      state: this.getState(),
      clock: this.clockValue.snapshot(),
      random: this.randomValue.snapshot(),
      eventQueue: this.eventQueueValue.snapshot(),
      scheduler: this.schedulerValue.snapshot(),
      interventionLedger: this.getInterventionLedger(),
      eventLog: this.getEventLog(),
      nextInterventionSequence: this.nextInterventionSequenceValue,
    };
  }

  serialize(): string {
    return JSON.stringify(this.snapshot());
  }

  static restore(
    serialized: string | SimulationSnapshot,
  ): SimulationEngine {
    const parsed: unknown =
      typeof serialized === "string" ? JSON.parse(serialized) : cloneData(serialized);
    if (!isRecord(parsed) || parsed.snapshotVersion !== SIMULATION_SNAPSHOT_VERSION) {
      throw new Error("unsupported or malformed simulation snapshot");
    }
    if (
      parsed.powerAuthority !== "aggregate" &&
      parsed.powerAuthority !== "external-network"
    ) {
      throw new Error("simulation snapshot has an invalid power authority");
    }
    if (
      parsed.atmosphereAuthority !== "aggregate" &&
      parsed.atmosphereAuthority !== "external-network"
    ) {
      throw new Error("simulation snapshot has an invalid atmosphere authority");
    }
    if (
      parsed.thermalAuthority !== "aggregate" &&
      parsed.thermalAuthority !== "external-network"
    ) {
      throw new Error("simulation snapshot has an invalid thermal authority");
    }
    if (
      parsed.populationAuthority !== "aggregate" &&
      parsed.populationAuthority !== "external-roster"
    ) {
      throw new Error("simulation snapshot has an invalid population authority");
    }
    if (
      parsed.waterAuthority !== "aggregate" &&
      parsed.waterAuthority !== "external-network"
    ) {
      throw new Error("simulation snapshot has an invalid water authority");
    }
    const snapshot = parsed as unknown as SimulationSnapshot;
    validateShipState(snapshot.state);
    assertSafeMicroseconds(
      snapshot.clock.elapsedMicroseconds,
      "snapshot clock time",
    );
    if (
      !Number.isSafeInteger(snapshot.nextInterventionSequence) ||
      snapshot.nextInterventionSequence < 1
    ) {
      throw new TypeError("invalid next intervention sequence");
    }

    const engine = new SimulationEngine({
      state: snapshot.state,
      seed: 0,
      timeScale: snapshot.clock.timeScale,
      powerAuthority: snapshot.powerAuthority,
      atmosphereAuthority: snapshot.atmosphereAuthority,
      thermalAuthority: snapshot.thermalAuthority,
      populationAuthority: snapshot.populationAuthority,
      waterAuthority: snapshot.waterAuthority,
    });
    engine.clockValue.restore(snapshot.clock);
    engine.randomValue.restore(snapshot.random);
    engine.eventQueueValue.restore(snapshot.eventQueue);
    engine.schedulerValue.restore(
      snapshot.scheduler,
      snapshot.clock.elapsedMicroseconds,
    );
    engine.interventionLedgerValue = cloneData(snapshot.interventionLedger);
    engine.eventLogValue = cloneData(snapshot.eventLog);
    engine.nextInterventionSequenceValue = snapshot.nextInterventionSequence;

    for (const record of engine.interventionLedgerValue) {
      validateBalanceDelta(record.declaredBalance);
    }
    return engine;
  }
}
