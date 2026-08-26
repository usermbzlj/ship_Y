/**
 * Deterministic A/B water-recovery network.
 *
 * The model intentionally stays reduced-order, but every stored kilogram has
 * one owner. Domestic use transfers potable water to wastewater; metabolic
 * water leaves this domain for the compartment atmosphere; processing passes
 * wastewater through a primary recovery stage and a brine-polishing stage.
 *
 * Per-ring distribution spurs are a minimal faultable delivery edge (not a
 * full pipe network): requested potable withdrawals for crew / ops / growth
 * are scaled by effectiveDeliveryFraction; undelivered mass is ledgered.
 */

export const WATER_RECOVERY_SNAPSHOT_VERSION = 3 as const;
export const WATER_RECOVERY_SNAPSHOT_VERSIONS = [1, 2, 3] as const;
export const WATER_LOOP_IDS = ["water-loop-a", "water-loop-b"] as const;
export const WATER_PROCESSOR_IDS = [
  "water-processor-a",
  "water-processor-b",
] as const;
export const WATER_DISTRIBUTION_SPUR_IDS = [
  "water-spur-a",
  "water-spur-b",
] as const;

export type WaterLoopId = (typeof WATER_LOOP_IDS)[number];
export type WaterProcessorId = (typeof WATER_PROCESSOR_IDS)[number];
export type WaterDistributionSpurId =
  (typeof WATER_DISTRIBUTION_SPUR_IDS)[number];
export type WaterRing = "a" | "b";
export type WaterProcessorCondition = "nominal" | "degraded" | "stuck-off";
export type WaterDistributionSpurCondition =
  | "nominal"
  | "degraded"
  | "stuck-closed";

export interface WaterDistributionSpur {
  id: WaterDistributionSpurId;
  condition: WaterDistributionSpurCondition;
  commandedOpenFraction: number;
}

export interface WaterLoop {
  id: WaterLoopId;
  ring: WaterRing;
  potableKg: number;
  potableCapacityKg: number;
  wastewaterKg: number;
  wastewaterCapacityKg: number;
  reserveIceKg: number;
  brineWasteKg: number;
  awakeOccupants: number;
  consumptionKgPerAwakePersonDay: number;
  unmetDemandKgCumulative: number;
  /** Ring potable distribution spur (tank → users). */
  distributionSpur: WaterDistributionSpur;
  /** Last domestic/ops delivery shortfall attributed to the spur. */
  lastDeliveryShortfallKg: number;
}

export interface WaterProcessor {
  id: WaterProcessorId;
  loopId: WaterLoopId;
  ring: WaterRing;
  commandedThroughputFraction: number;
  condition: WaterProcessorCondition;
  electricalServiceFraction: number;
  ratedThroughputKgPerDay: number;
  primaryRecoveryFraction: number;
  brineRecoveryFraction: number;
  actualThroughputKgPerSecond: number;
  lastProcessedKg: number;
  lastPrimaryRecoveredKg: number;
  lastBrineRecoveredKg: number;
  lastResidualBrineKg: number;
}

export interface WaterMassLedger {
  initialInventoryKg: number;
  domesticTransferredKg: number;
  metabolicOutflowKg: number;
  condensateInflowKg: number;
  externallyAddedKg: number;
  /** Accumulated floating-point closure residual; not a physical source/sink. */
  numericalResidualKg: number;
  /** Cumulative requested potable that the spur did not deliver. */
  undeliveredPotableKg: number;
  wastewaterProcessedKg: number;
  primaryRecoveredKg: number;
  brineRecoveredKg: number;
  residualBrineKg: number;
}

export interface WaterObservationFrame {
  sampledAtMicroseconds: number;
  availableAtMicroseconds: number;
  potableKgByRing: Record<WaterRing, number>;
  wastewaterKgByRing: Record<WaterRing, number>;
  deliveryShortfallKgByRing: Record<WaterRing, number>;
  processorThroughputKgPerDay: Record<WaterProcessorId, number>;
}

export interface WaterObservationState {
  published: WaterObservationFrame | null;
  pending: WaterObservationFrame[];
}

export interface WaterRecoverySnapshot {
  snapshotVersion: (typeof WATER_RECOVERY_SNAPSHOT_VERSIONS)[number];
  elapsedMicroseconds: number;
  loops: WaterLoop[];
  processors: WaterProcessor[];
  ledger: WaterMassLedger;
  observation: WaterObservationState;
}

export interface WaterRecoverySummary {
  potableKg: number;
  wastewaterKg: number;
  reserveIceKg: number;
  brineWasteKg: number;
  recycledKgCumulative: number;
  recyclerCapacityKgPerDay: number;
  recyclerEfficiency: number;
  totalUnmetDemandKg: number;
  undeliveredPotableKg: number;
  deliveryShortfallKgByRing: Record<WaterRing, number>;
  massClosureErrorKg: number;
}

export type WaterProcessorPatch = Partial<
  Pick<
    WaterProcessor,
    "commandedThroughputFraction" | "condition"
  >
>;

export type WaterDistributionSpurPatch = Partial<
  Pick<WaterDistributionSpur, "commandedOpenFraction" | "condition">
>;

const MICROSECONDS_PER_SECOND = 1_000_000;
const LOOP_BY_PROCESSOR: Readonly<Record<WaterProcessorId, WaterLoopId>> = {
  "water-processor-a": "water-loop-a",
  "water-processor-b": "water-loop-b",
};
const RING_BY_LOOP: Readonly<Record<WaterLoopId, WaterRing>> = {
  "water-loop-a": "a",
  "water-loop-b": "b",
};
const SPUR_BY_RING: Readonly<Record<WaterRing, WaterDistributionSpurId>> = {
  a: "water-spur-a",
  b: "water-spur-b",
};
const LOOP_BY_SPUR: Readonly<
  Record<WaterDistributionSpurId, WaterLoopId>
> = {
  "water-spur-a": "water-loop-a",
  "water-spur-b": "water-loop-b",
};
const BASELINE_POTABLE_KG_PER_LOOP = 900_000;
const BASELINE_WASTEWATER_KG_PER_LOOP = 60_000;
/** Dual-loop total ≈3e6 kg — tense vs ~1.8e6 kg potable, not a slack ocean. */
const BASELINE_RESERVE_ICE_KG_PER_LOOP = 1_500_000;
const POTABLE_CAPACITY_KG_PER_LOOP = 2_200_000;
const WASTEWATER_CAPACITY_KG_PER_LOOP = 300_000;
/** Living-role baseline until ops syncs person-weighted ZoneRole demand. */
const CONSUMPTION_KG_PER_AWAKE_PERSON_DAY = 3;
/** Per-loop rated recovery; dual-nominal ≈2× awake demand, single-loop failure is tense. */
const RATED_THROUGHPUT_KG_PER_DAY = 900;
const PRIMARY_RECOVERY_FRACTION = 0.85;
const BRINE_RECOVERY_FRACTION = 0.87;
const DEGRADED_THROUGHPUT_MULTIPLIER = 0.5;
const OBSERVATION_DELAY_MICROSECONDS = 5_000_000;

function cloneData<T>(value: T): T {
  return structuredClone(value);
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
}

function assertNonNegative(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative`);
  }
}

function assertFraction(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1`);
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function processorConditionMultiplier(
  condition: WaterProcessorCondition,
): number {
  switch (condition) {
    case "nominal":
      return 1;
    case "degraded":
      return DEGRADED_THROUGHPUT_MULTIPLIER;
    case "stuck-off":
      return 0;
  }
}

function spurConditionMultiplier(
  condition: WaterDistributionSpurCondition,
): number {
  switch (condition) {
    case "nominal":
      return 1;
    case "degraded":
      return DEGRADED_THROUGHPUT_MULTIPLIER;
    case "stuck-closed":
      return 0;
  }
}

export function effectiveDeliveryFraction(
  spur: Pick<
    WaterDistributionSpur,
    "commandedOpenFraction" | "condition"
  >,
): number {
  return (
    spur.commandedOpenFraction * spurConditionMultiplier(spur.condition)
  );
}

function createNominalSpur(ring: WaterRing): WaterDistributionSpur {
  return {
    id: SPUR_BY_RING[ring],
    condition: "nominal",
    commandedOpenFraction: 1,
  };
}

function combinedRecoveryFraction(processor: WaterProcessor): number {
  return (
    processor.primaryRecoveryFraction +
    (1 - processor.primaryRecoveryFraction) *
      processor.brineRecoveryFraction
  );
}

function expectedActualThroughput(processor: WaterProcessor): number {
  return (
    (processor.ratedThroughputKgPerDay / 86_400) *
    processor.commandedThroughputFraction *
    processor.electricalServiceFraction *
    processorConditionMultiplier(processor.condition)
  );
}

function createLoops(): WaterLoop[] {
  return WATER_LOOP_IDS.map((id) => ({
    id,
    ring: RING_BY_LOOP[id],
    potableKg: BASELINE_POTABLE_KG_PER_LOOP,
    potableCapacityKg: POTABLE_CAPACITY_KG_PER_LOOP,
    wastewaterKg: BASELINE_WASTEWATER_KG_PER_LOOP,
    wastewaterCapacityKg: WASTEWATER_CAPACITY_KG_PER_LOOP,
    reserveIceKg: BASELINE_RESERVE_ICE_KG_PER_LOOP,
    brineWasteKg: 0,
    awakeOccupants: 0,
    consumptionKgPerAwakePersonDay:
      CONSUMPTION_KG_PER_AWAKE_PERSON_DAY,
    unmetDemandKgCumulative: 0,
    distributionSpur: createNominalSpur(RING_BY_LOOP[id]),
    lastDeliveryShortfallKg: 0,
  }));
}

function createProcessors(): WaterProcessor[] {
  return WATER_PROCESSOR_IDS.map((id) => {
    const loopId = LOOP_BY_PROCESSOR[id];
    const processor: WaterProcessor = {
      id,
      loopId,
      ring: RING_BY_LOOP[loopId],
      commandedThroughputFraction: 1,
      condition: "nominal",
      electricalServiceFraction: 1,
      ratedThroughputKgPerDay: RATED_THROUGHPUT_KG_PER_DAY,
      primaryRecoveryFraction: PRIMARY_RECOVERY_FRACTION,
      brineRecoveryFraction: BRINE_RECOVERY_FRACTION,
      actualThroughputKgPerSecond: 0,
      lastProcessedKg: 0,
      lastPrimaryRecoveredKg: 0,
      lastBrineRecoveredKg: 0,
      lastResidualBrineKg: 0,
    };
    processor.actualThroughputKgPerSecond =
      expectedActualThroughput(processor);
    return processor;
  });
}

function inventoryKg(loops: readonly WaterLoop[]): number {
  return loops.reduce(
    (total, loop) =>
      total +
      loop.potableKg +
      loop.wastewaterKg +
      loop.reserveIceKg +
      loop.brineWasteKg,
    0,
  );
}

function createSnapshot(): WaterRecoverySnapshot {
  const loops = createLoops();
  return {
    snapshotVersion: WATER_RECOVERY_SNAPSHOT_VERSION,
    elapsedMicroseconds: 0,
    loops,
    processors: createProcessors(),
    ledger: {
      initialInventoryKg: inventoryKg(loops),
      domesticTransferredKg: 0,
      metabolicOutflowKg: 0,
      condensateInflowKg: 0,
      externallyAddedKg: 0,
      numericalResidualKg: 0,
      undeliveredPotableKg: 0,
      wastewaterProcessedKg: 0,
      primaryRecoveredKg: 0,
      brineRecoveredKg: 0,
      residualBrineKg: 0,
    },
    observation: {
      published: null,
      pending: [],
    },
  };
}

function createObservationFrame(
  snapshot: WaterRecoverySnapshot,
): WaterObservationFrame {
  const loopA = snapshot.loops.find((loop) => loop.ring === "a")!;
  const loopB = snapshot.loops.find((loop) => loop.ring === "b")!;
  return {
    sampledAtMicroseconds: snapshot.elapsedMicroseconds,
    availableAtMicroseconds:
      snapshot.elapsedMicroseconds + OBSERVATION_DELAY_MICROSECONDS,
    potableKgByRing: { a: loopA.potableKg, b: loopB.potableKg },
    wastewaterKgByRing: {
      a: loopA.wastewaterKg,
      b: loopB.wastewaterKg,
    },
    deliveryShortfallKgByRing: {
      a: loopA.lastDeliveryShortfallKg,
      b: loopB.lastDeliveryShortfallKg,
    },
    processorThroughputKgPerDay: Object.fromEntries(
      snapshot.processors.map((processor) => [
        processor.id,
        processor.actualThroughputKgPerSecond * 86_400,
      ]),
    ) as Record<WaterProcessorId, number>,
  };
}

function validateObservationFrame(
  frame: WaterObservationFrame,
  label: string,
): void {
  if (
    !Number.isSafeInteger(frame.sampledAtMicroseconds) ||
    !Number.isSafeInteger(frame.availableAtMicroseconds) ||
    frame.sampledAtMicroseconds < 0 ||
    frame.availableAtMicroseconds - frame.sampledAtMicroseconds !==
      OBSERVATION_DELAY_MICROSECONDS
  ) {
    throw new Error(`${label} has an invalid observation clock`);
  }
  for (const ring of ["a", "b"] as const) {
    assertNonNegative(
      frame.potableKgByRing[ring],
      `${label}.potableKgByRing.${ring}`,
    );
    assertNonNegative(
      frame.wastewaterKgByRing[ring],
      `${label}.wastewaterKgByRing.${ring}`,
    );
    assertNonNegative(
      frame.deliveryShortfallKgByRing[ring],
      `${label}.deliveryShortfallKgByRing.${ring}`,
    );
  }
  for (const processorId of WATER_PROCESSOR_IDS) {
    assertNonNegative(
      frame.processorThroughputKgPerDay[processorId],
      `${label}.processorThroughputKgPerDay.${processorId}`,
    );
  }
}

function expectedInventoryKg(snapshot: WaterRecoverySnapshot): number {
  return (
    snapshot.ledger.initialInventoryKg +
    snapshot.ledger.condensateInflowKg +
    snapshot.ledger.externallyAddedKg +
    snapshot.ledger.numericalResidualKg -
    snapshot.ledger.metabolicOutflowKg
  );
}

function massClosureError(snapshot: WaterRecoverySnapshot): number {
  return inventoryKg(snapshot.loops) - expectedInventoryKg(snapshot);
}

/** Same spirit as cooling energy closure: absolute floor + relative scale. */
function massClosureToleranceKg(snapshot: WaterRecoverySnapshot): number {
  return Math.max(1e-4, Math.abs(inventoryKg(snapshot.loops)) * 1e-11);
}

/**
 * Fold floating-point inventory/ledger mismatch into the numerical residual so
 * long AFK runs do not trip the hard conservation gate.
 */
function absorbNumericalMassResidual(snapshot: WaterRecoverySnapshot): void {
  snapshot.ledger.numericalResidualKg += massClosureError(snapshot);
}

function migrateWaterSnapshot(
  snapshot: WaterRecoverySnapshot,
): WaterRecoverySnapshot {
  const version = snapshot.snapshotVersion as number;
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new Error("unsupported water-recovery snapshot version");
  }
  const ledger = snapshot.ledger as WaterMassLedger & {
    numericalResidualKg?: number;
    undeliveredPotableKg?: number;
  };
  const migratedLoops = snapshot.loops.map((loop) => {
    const raw = loop as WaterLoop & {
      distributionSpur?: WaterDistributionSpur;
      lastDeliveryShortfallKg?: number;
    };
    return {
      ...raw,
      distributionSpur: raw.distributionSpur ?? createNominalSpur(raw.ring),
      lastDeliveryShortfallKg: raw.lastDeliveryShortfallKg ?? 0,
    };
  });
  const migrated: WaterRecoverySnapshot = {
    ...snapshot,
    snapshotVersion: WATER_RECOVERY_SNAPSHOT_VERSION,
    loops: migratedLoops,
    ledger: {
      ...ledger,
      numericalResidualKg: ledger.numericalResidualKg ?? 0,
      undeliveredPotableKg: ledger.undeliveredPotableKg ?? 0,
    },
    observation: migrateObservation(snapshot.observation),
  };
  return migrated;
}

function migrateObservation(
  observation: WaterObservationState,
): WaterObservationState {
  const migrateFrame = (
    frame: WaterObservationFrame | null,
  ): WaterObservationFrame | null => {
    if (frame === null) return null;
    const raw = frame as WaterObservationFrame & {
      deliveryShortfallKgByRing?: Record<WaterRing, number>;
    };
    return {
      ...raw,
      deliveryShortfallKgByRing: raw.deliveryShortfallKgByRing ?? {
        a: 0,
        b: 0,
      },
    };
  };
  return {
    published: migrateFrame(observation.published),
    pending: observation.pending.map(
      (frame) => migrateFrame(frame) as WaterObservationFrame,
    ),
  };
}

function validateSnapshot(snapshot: WaterRecoverySnapshot): void {
  if (
    snapshot.snapshotVersion !== WATER_RECOVERY_SNAPSHOT_VERSION
  ) {
    throw new Error("unsupported water-recovery snapshot version");
  }
  if (
    !Number.isSafeInteger(snapshot.elapsedMicroseconds) ||
    snapshot.elapsedMicroseconds < 0
  ) {
    throw new TypeError("water elapsedMicroseconds must be a non-negative safe integer");
  }
  if (
    snapshot.loops.length !== WATER_LOOP_IDS.length ||
    snapshot.processors.length !== WATER_PROCESSOR_IDS.length
  ) {
    throw new Error("water snapshot does not match the fixed A/B topology");
  }

  const sortedLoops = [...snapshot.loops].sort((left, right) =>
    compareStrings(left.id, right.id),
  );
  const sortedProcessors = [...snapshot.processors].sort((left, right) =>
    compareStrings(left.id, right.id),
  );
  for (let index = 0; index < WATER_LOOP_IDS.length; index += 1) {
    const loop = sortedLoops[index];
    const expectedId = WATER_LOOP_IDS[index];
    if (loop.id !== expectedId || loop.ring !== RING_BY_LOOP[expectedId]) {
      throw new Error("water loop topology does not match the fixed A/B contract");
    }
    for (const [value, label] of [
      [loop.potableKg, `${loop.id}.potableKg`],
      [loop.potableCapacityKg, `${loop.id}.potableCapacityKg`],
      [loop.wastewaterKg, `${loop.id}.wastewaterKg`],
      [loop.wastewaterCapacityKg, `${loop.id}.wastewaterCapacityKg`],
      [loop.reserveIceKg, `${loop.id}.reserveIceKg`],
      [loop.brineWasteKg, `${loop.id}.brineWasteKg`],
      [loop.awakeOccupants, `${loop.id}.awakeOccupants`],
      [
        loop.consumptionKgPerAwakePersonDay,
        `${loop.id}.consumptionKgPerAwakePersonDay`,
      ],
      [loop.unmetDemandKgCumulative, `${loop.id}.unmetDemandKgCumulative`],
      [
        loop.lastDeliveryShortfallKg,
        `${loop.id}.lastDeliveryShortfallKg`,
      ],
    ] as const) {
      assertNonNegative(value, label);
    }
    if (!Number.isSafeInteger(loop.awakeOccupants)) {
      throw new TypeError(`${loop.id}.awakeOccupants must be a safe integer`);
    }
    const spur = loop.distributionSpur;
    if (
      !spur ||
      spur.id !== SPUR_BY_RING[loop.ring] ||
      LOOP_BY_SPUR[spur.id] !== loop.id
    ) {
      throw new Error(`${loop.id} distribution spur topology is invalid`);
    }
    assertFraction(
      spur.commandedOpenFraction,
      `${loop.id}.distributionSpur.commandedOpenFraction`,
    );
    if (
      spur.condition !== "nominal" &&
      spur.condition !== "degraded" &&
      spur.condition !== "stuck-closed"
    ) {
      throw new Error(`${loop.id} distribution spur has an invalid condition`);
    }
    if (
      loop.potableCapacityKg !== POTABLE_CAPACITY_KG_PER_LOOP ||
      loop.wastewaterCapacityKg !== WASTEWATER_CAPACITY_KG_PER_LOOP ||
      loop.consumptionKgPerAwakePersonDay > 12 ||
      loop.potableKg > loop.potableCapacityKg + 1e-9 ||
      loop.wastewaterKg > loop.wastewaterCapacityKg + 1e-9
    ) {
      throw new Error(`${loop.id} violates fixed capacity or consumption limits`);
    }
  }

  for (let index = 0; index < WATER_PROCESSOR_IDS.length; index += 1) {
    const processor = sortedProcessors[index];
    const expectedId = WATER_PROCESSOR_IDS[index];
    const expectedLoopId = LOOP_BY_PROCESSOR[expectedId];
    if (
      processor.id !== expectedId ||
      processor.loopId !== expectedLoopId ||
      processor.ring !== RING_BY_LOOP[expectedLoopId]
    ) {
      throw new Error("water processor topology does not match the fixed A/B contract");
    }
    assertFraction(
      processor.commandedThroughputFraction,
      `${processor.id}.commandedThroughputFraction`,
    );
    assertFraction(
      processor.electricalServiceFraction,
      `${processor.id}.electricalServiceFraction`,
    );
    assertFraction(
      processor.primaryRecoveryFraction,
      `${processor.id}.primaryRecoveryFraction`,
    );
    assertFraction(
      processor.brineRecoveryFraction,
      `${processor.id}.brineRecoveryFraction`,
    );
    if (
      processor.condition !== "nominal" &&
      processor.condition !== "degraded" &&
      processor.condition !== "stuck-off"
    ) {
      throw new Error(`${processor.id} has an invalid condition`);
    }
    for (const [value, label] of [
      [processor.ratedThroughputKgPerDay, `${processor.id}.ratedThroughputKgPerDay`],
      [processor.actualThroughputKgPerSecond, `${processor.id}.actualThroughputKgPerSecond`],
      [processor.lastProcessedKg, `${processor.id}.lastProcessedKg`],
      [processor.lastPrimaryRecoveredKg, `${processor.id}.lastPrimaryRecoveredKg`],
      [processor.lastBrineRecoveredKg, `${processor.id}.lastBrineRecoveredKg`],
      [processor.lastResidualBrineKg, `${processor.id}.lastResidualBrineKg`],
    ] as const) {
      assertNonNegative(value, label);
    }
    if (
      processor.ratedThroughputKgPerDay !== RATED_THROUGHPUT_KG_PER_DAY ||
      processor.primaryRecoveryFraction !== PRIMARY_RECOVERY_FRACTION ||
      processor.brineRecoveryFraction !== BRINE_RECOVERY_FRACTION
    ) {
      throw new Error(`${processor.id} fixed performance constants were altered`);
    }
    const expectedThroughput = expectedActualThroughput(processor);
    if (
      Math.abs(
        processor.actualThroughputKgPerSecond - expectedThroughput,
      ) > 1e-12
    ) {
      throw new Error(`${processor.id} actual throughput is not causally derived`);
    }
    const processedProducts =
      processor.lastPrimaryRecoveredKg +
      processor.lastBrineRecoveredKg +
      processor.lastResidualBrineKg;
    if (Math.abs(processedProducts - processor.lastProcessedKg) > 1e-8) {
      throw new Error(`${processor.id} last-run mass balance does not close`);
    }
  }

  for (const [key, value] of Object.entries(snapshot.ledger)) {
    if (key === "externallyAddedKg" || key === "numericalResidualKg") {
      assertFinite(value, `ledger.${key}`);
    } else {
      assertNonNegative(value, `ledger.${key}`);
    }
  }
  if (
    snapshot.ledger.initialInventoryKg !==
    2 *
      (BASELINE_POTABLE_KG_PER_LOOP +
        BASELINE_WASTEWATER_KG_PER_LOOP +
        BASELINE_RESERVE_ICE_KG_PER_LOOP)
  ) {
    throw new Error("water initial inventory ledger was altered");
  }
  if (
    Math.abs(
      snapshot.ledger.primaryRecoveredKg +
        snapshot.ledger.brineRecoveredKg +
        snapshot.ledger.residualBrineKg -
        snapshot.ledger.wastewaterProcessedKg,
    ) > 1e-6
  ) {
    throw new Error("water processor cumulative mass balance does not close");
  }
  if (Math.abs(massClosureError(snapshot)) > massClosureToleranceKg(snapshot)) {
    throw new Error("water inventory mass balance does not close");
  }
  if (!Array.isArray(snapshot.observation.pending)) {
    throw new TypeError("water observation pending frames must be an array");
  }
  if (snapshot.observation.published !== null) {
    validateObservationFrame(
      snapshot.observation.published,
      "observation.published",
    );
    if (
      snapshot.observation.published.availableAtMicroseconds >
      snapshot.elapsedMicroseconds
    ) {
      throw new Error("published water observation is not yet available");
    }
  }
  let previousSampledAt = -1;
  for (const [index, frame] of snapshot.observation.pending.entries()) {
    validateObservationFrame(frame, `observation.pending.${index}`);
    if (
      frame.availableAtMicroseconds <= snapshot.elapsedMicroseconds ||
      frame.sampledAtMicroseconds <= previousSampledAt
    ) {
      throw new Error("pending water observations are stale or out of order");
    }
    previousSampledAt = frame.sampledAtMicroseconds;
  }
}

export class WaterRecoveryNetwork {
  private stateValue: WaterRecoverySnapshot;

  constructor(snapshot?: WaterRecoverySnapshot) {
    this.stateValue = cloneData(
      snapshot ? migrateWaterSnapshot(snapshot) : createSnapshot(),
    );
    validateSnapshot(this.stateValue);
  }

  get elapsedMicroseconds(): number {
    return this.stateValue.elapsedMicroseconds;
  }

  listLoops(): WaterLoop[] {
    return cloneData(this.stateValue.loops);
  }

  listProcessors(): WaterProcessor[] {
    return cloneData(this.stateValue.processors);
  }

  getProcessor(id: WaterProcessorId): WaterProcessor {
    const processor = this.stateValue.processors.find((item) => item.id === id);
    if (!processor) throw new Error(`unknown water processor: ${id}`);
    return cloneData(processor);
  }

  getObservation(): WaterObservationFrame | null {
    return cloneData(this.stateValue.observation.published);
  }

  synchronizeAwakeOccupants(occupants: Readonly<Record<WaterRing, number>>): void {
    for (const ring of ["a", "b"] as const) {
      const count = occupants[ring];
      assertNonNegative(count, `awakeOccupants.${ring}`);
      if (!Number.isSafeInteger(count)) {
        throw new TypeError(`awakeOccupants.${ring} must be a safe integer`);
      }
      this.requireLoop(ring === "a" ? "water-loop-a" : "water-loop-b")
        .awakeOccupants = count;
    }
  }

  synchronizeProcessorElectricalServiceFraction(
    id: WaterProcessorId,
    fraction: number,
  ): void {
    assertFraction(fraction, `${id}.electricalServiceFraction`);
    const processor = this.requireProcessor(id);
    processor.electricalServiceFraction = fraction;
    processor.actualThroughputKgPerSecond =
      expectedActualThroughput(processor);
  }

  configureProcessor(id: WaterProcessorId, patch: WaterProcessorPatch): void {
    const processor = this.requireProcessor(id);
    if (patch.commandedThroughputFraction !== undefined) {
      assertFraction(
        patch.commandedThroughputFraction,
        `${id}.commandedThroughputFraction`,
      );
      processor.commandedThroughputFraction =
        patch.commandedThroughputFraction;
    }
    if (patch.condition !== undefined) {
      if (
        patch.condition !== "nominal" &&
        patch.condition !== "degraded" &&
        patch.condition !== "stuck-off"
      ) {
        throw new Error(`${id} has an invalid condition`);
      }
      processor.condition = patch.condition;
    }
    processor.actualThroughputKgPerSecond =
      expectedActualThroughput(processor);
  }

  configureDistributionSpur(
    id: WaterDistributionSpurId,
    patch: WaterDistributionSpurPatch,
  ): void {
    const loop = this.requireLoop(LOOP_BY_SPUR[id]);
    const spur = loop.distributionSpur;
    if (spur.id !== id) {
      throw new Error(`unknown water distribution spur: ${id}`);
    }
    if (patch.commandedOpenFraction !== undefined) {
      assertFraction(
        patch.commandedOpenFraction,
        `${id}.commandedOpenFraction`,
      );
      spur.commandedOpenFraction = patch.commandedOpenFraction;
    }
    if (patch.condition !== undefined) {
      if (
        patch.condition !== "nominal" &&
        patch.condition !== "degraded" &&
        patch.condition !== "stuck-closed"
      ) {
        throw new Error(`${id} has an invalid condition`);
      }
      spur.condition = patch.condition;
    }
    validateSnapshot(this.stateValue);
  }

  getDistributionSpur(id: WaterDistributionSpurId): WaterDistributionSpur {
    const loop = this.requireLoop(LOOP_BY_SPUR[id]);
    return cloneData(loop.distributionSpur);
  }

  withdrawMetabolicWater(
    withdrawalsKg: Readonly<Record<WaterRing, number>>,
  ): void {
    for (const ring of ["a", "b"] as const) {
      const amount = withdrawalsKg[ring];
      assertNonNegative(amount, `metabolicWater.${ring}`);
      const loop = this.requireLoop(
        ring === "a" ? "water-loop-a" : "water-loop-b",
      );
      if (amount > loop.potableKg + 1e-9) {
        throw new Error(`${loop.id} potable water is exhausted`);
      }
      loop.potableKg = Math.max(0, loop.potableKg - amount);
      this.stateValue.ledger.metabolicOutflowKg += amount;
    }
    absorbNumericalMassResidual(this.stateValue);
    validateSnapshot(this.stateValue);
  }

  collectCondensate(
    additionsKg: Readonly<Record<WaterRing, number>>,
  ): void {
    for (const ring of ["a", "b"] as const) {
      const amount = additionsKg[ring];
      assertNonNegative(amount, `condensate.${ring}`);
      const loop = this.requireLoop(
        ring === "a" ? "water-loop-a" : "water-loop-b",
      );
      if (loop.wastewaterKg + amount > loop.wastewaterCapacityKg + 1e-9) {
        throw new Error(`${loop.id} wastewater tank cannot accept condensate`);
      }
      loop.wastewaterKg += amount;
      this.stateValue.ledger.condensateInflowKg += amount;
    }
    absorbNumericalMassResidual(this.stateValue);
    validateSnapshot(this.stateValue);
  }

  setTotalPotableInventoryKg(totalKg: number): void {
    assertNonNegative(totalKg, "total potable inventory");
    const totalCapacity = this.stateValue.loops.reduce(
      (total, loop) => total + loop.potableCapacityKg,
      0,
    );
    if (totalKg > totalCapacity) {
      throw new RangeError("total potable inventory exceeds fixed tank capacity");
    }
    const before = this.getSummary().potableKg;
    const fillFraction = totalCapacity === 0 ? 0 : totalKg / totalCapacity;
    for (const loop of this.stateValue.loops) {
      loop.potableKg = loop.potableCapacityKg * fillFraction;
    }
    this.stateValue.ledger.externallyAddedKg += totalKg - before;
    absorbNumericalMassResidual(this.stateValue);
    validateSnapshot(this.stateValue);
  }

  transferPotableWater(
    fromRing: WaterRing,
    toRing: WaterRing,
    massKg: number,
  ): void {
    assertNonNegative(massKg, "potable transfer mass");
    if (fromRing === toRing) throw new Error("potable transfer rings must differ");
    const from = this.requireLoop(
      fromRing === "a" ? "water-loop-a" : "water-loop-b",
    );
    const to = this.requireLoop(
      toRing === "a" ? "water-loop-a" : "water-loop-b",
    );
    if (massKg > from.potableKg + 1e-9) {
      throw new Error(`${from.id} has insufficient potable water`);
    }
    if (to.potableKg + massKg > to.potableCapacityKg + 1e-9) {
      throw new Error(`${to.id} has insufficient potable tank headroom`);
    }
    from.potableKg = Math.max(0, from.potableKg - massKg);
    to.potableKg = Math.min(to.potableCapacityKg, to.potableKg + massKg);
    absorbNumericalMassResidual(this.stateValue);
    validateSnapshot(this.stateValue);
  }

  setConsumptionKgPerAwakePersonDayByRing(
    allocation: Readonly<Record<WaterRing, number>>,
  ): void {
    for (const ring of ["a", "b"] as const) {
      assertNonNegative(allocation[ring], `water consumption allocation ${ring}`);
      if (allocation[ring] > 12) {
        throw new RangeError(`water consumption allocation ${ring} exceeds service bound`);
      }
      this.requireLoop(
        ring === "a" ? "water-loop-a" : "water-loop-b",
      ).consumptionKgPerAwakePersonDay = allocation[ring];
    }
    validateSnapshot(this.stateValue);
  }

  withdrawPotableForOperations(
    withdrawalsKg: Readonly<Record<WaterRing, number>>,
  ): void {
    for (const ring of ["a", "b"] as const) {
      assertNonNegative(withdrawalsKg[ring], `operations withdrawal ${ring}`);
    }
    for (const ring of ["a", "b"] as const) {
      const needed = withdrawalsKg[ring];
      const loop = this.requireLoop(
        ring === "a" ? "water-loop-a" : "water-loop-b",
      );
      const deliveryFraction = effectiveDeliveryFraction(
        loop.distributionSpur,
      );
      const attempted = needed * deliveryFraction;
      const spurShortfall = needed - attempted;
      if (attempted > loop.potableKg + 1e-9) {
        throw new Error(`${loop.id} has insufficient potable water for operations`);
      }
      loop.potableKg = Math.max(0, loop.potableKg - attempted);
      // Accumulate onto the domestic shortfall set by step() this tick instead
      // of overwriting it, so telemetry reflects total (domestic + operations)
      // undelivered water rather than only the last writer.
      loop.lastDeliveryShortfallKg += spurShortfall;
      this.stateValue.ledger.externallyAddedKg -= attempted;
      this.stateValue.ledger.undeliveredPotableKg += spurShortfall;
    }
    absorbNumericalMassResidual(this.stateValue);
    validateSnapshot(this.stateValue);
  }

  step(deltaSeconds: number): void {
    assertNonNegative(deltaSeconds, "deltaSeconds");
    const deltaMicroseconds = Math.round(
      deltaSeconds * MICROSECONDS_PER_SECOND,
    );
    if (!Number.isSafeInteger(deltaMicroseconds)) {
      throw new RangeError("water step duration exceeds safe clock range");
    }
    if (deltaMicroseconds === 0) return;
    const normalizedSeconds = deltaMicroseconds / MICROSECONDS_PER_SECOND;

    for (const loop of this.stateValue.loops) {
      const demanded =
        (loop.awakeOccupants *
          loop.consumptionKgPerAwakePersonDay *
          normalizedSeconds) /
        86_400;
      const deliveryFraction = effectiveDeliveryFraction(
        loop.distributionSpur,
      );
      const attempted = demanded * deliveryFraction;
      const spurShortfall = demanded - attempted;
      const wastewaterHeadroom =
        loop.wastewaterCapacityKg - loop.wastewaterKg;
      const supplied = Math.min(loop.potableKg, attempted, wastewaterHeadroom);
      loop.potableKg -= supplied;
      loop.wastewaterKg += supplied;
      loop.unmetDemandKgCumulative += attempted - supplied;
      loop.lastDeliveryShortfallKg = spurShortfall;
      this.stateValue.ledger.domesticTransferredKg += supplied;
      this.stateValue.ledger.undeliveredPotableKg += spurShortfall;
    }

    for (const processor of this.stateValue.processors) {
      processor.actualThroughputKgPerSecond =
        expectedActualThroughput(processor);
      const loop = this.requireLoop(processor.loopId);
      const recoveryFraction = combinedRecoveryFraction(processor);
      const potableHeadroom = loop.potableCapacityKg - loop.potableKg;
      const capacityLimitedInput =
        recoveryFraction > 0
          ? potableHeadroom / recoveryFraction
          : Number.POSITIVE_INFINITY;
      const processed = Math.max(
        0,
        Math.min(
          loop.wastewaterKg,
          processor.actualThroughputKgPerSecond * normalizedSeconds,
          capacityLimitedInput,
        ),
      );
      const primaryRecovered =
        processed * processor.primaryRecoveryFraction;
      const primaryBrine = processed - primaryRecovered;
      const brineRecovered =
        primaryBrine * processor.brineRecoveryFraction;
      const residualBrine = primaryBrine - brineRecovered;

      loop.wastewaterKg -= processed;
      loop.potableKg += primaryRecovered + brineRecovered;
      loop.brineWasteKg += residualBrine;
      processor.lastProcessedKg = processed;
      processor.lastPrimaryRecoveredKg = primaryRecovered;
      processor.lastBrineRecoveredKg = brineRecovered;
      processor.lastResidualBrineKg = residualBrine;
      this.stateValue.ledger.wastewaterProcessedKg += processed;
      this.stateValue.ledger.primaryRecoveredKg += primaryRecovered;
      this.stateValue.ledger.brineRecoveredKg += brineRecovered;
      this.stateValue.ledger.residualBrineKg += residualBrine;
    }

    this.stateValue.elapsedMicroseconds += deltaMicroseconds;
    if (!Number.isSafeInteger(this.stateValue.elapsedMicroseconds)) {
      throw new RangeError("water elapsed clock exceeds safe integer range");
    }
    const available = this.stateValue.observation.pending.filter(
      (frame) =>
        frame.availableAtMicroseconds <=
        this.stateValue.elapsedMicroseconds,
    );
    if (available.length > 0) {
      this.stateValue.observation.published = available.at(-1)!;
    }
    this.stateValue.observation.pending =
      this.stateValue.observation.pending.filter(
        (frame) =>
          frame.availableAtMicroseconds >
          this.stateValue.elapsedMicroseconds,
      );
    this.stateValue.observation.pending.push(
      createObservationFrame(this.stateValue),
    );
    absorbNumericalMassResidual(this.stateValue);
    validateSnapshot(this.stateValue);
  }

  getSummary(): WaterRecoverySummary {
    const recycledKgCumulative =
      this.stateValue.ledger.primaryRecoveredKg +
      this.stateValue.ledger.brineRecoveredKg;
    const recyclerCapacityKgPerDay = this.stateValue.processors.reduce(
      (total, processor) =>
        total +
        processor.ratedThroughputKgPerDay *
          processor.commandedThroughputFraction *
          processor.electricalServiceFraction *
          processorConditionMultiplier(processor.condition),
      0,
    );
    const ratedInput = this.stateValue.processors.reduce(
      (total, processor) => total + processor.ratedThroughputKgPerDay,
      0,
    );
    const weightedRecovered = this.stateValue.processors.reduce(
      (total, processor) =>
        total +
        processor.ratedThroughputKgPerDay *
          combinedRecoveryFraction(processor),
      0,
    );
    return {
      potableKg: this.stateValue.loops.reduce(
        (total, loop) => total + loop.potableKg,
        0,
      ),
      wastewaterKg: this.stateValue.loops.reduce(
        (total, loop) => total + loop.wastewaterKg,
        0,
      ),
      reserveIceKg: this.stateValue.loops.reduce(
        (total, loop) => total + loop.reserveIceKg,
        0,
      ),
      brineWasteKg: this.stateValue.loops.reduce(
        (total, loop) => total + loop.brineWasteKg,
        0,
      ),
      recycledKgCumulative,
      recyclerCapacityKgPerDay,
      recyclerEfficiency: ratedInput === 0 ? 0 : weightedRecovered / ratedInput,
      totalUnmetDemandKg: this.stateValue.loops.reduce(
        (total, loop) => total + loop.unmetDemandKgCumulative,
        0,
      ),
      undeliveredPotableKg: this.stateValue.ledger.undeliveredPotableKg,
      deliveryShortfallKgByRing: {
        a: this.requireLoop("water-loop-a").lastDeliveryShortfallKg,
        b: this.requireLoop("water-loop-b").lastDeliveryShortfallKg,
      },
      massClosureErrorKg: massClosureError(this.stateValue),
    };
  }

  snapshot(): WaterRecoverySnapshot {
    return cloneData(this.stateValue);
  }

  static restore(snapshot: WaterRecoverySnapshot): WaterRecoveryNetwork {
    return new WaterRecoveryNetwork(snapshot);
  }

  private requireLoop(id: WaterLoopId): WaterLoop {
    const loop = this.stateValue.loops.find((item) => item.id === id);
    if (!loop) throw new Error(`unknown water loop: ${id}`);
    return loop;
  }

  private requireProcessor(id: WaterProcessorId): WaterProcessor {
    const processor = this.stateValue.processors.find((item) => item.id === id);
    if (!processor) throw new Error(`unknown water processor: ${id}`);
    return processor;
  }
}
