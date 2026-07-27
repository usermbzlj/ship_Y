/**
 * Deterministic maintenance task network.
 *
 * A repair is never a direct condition write. A fixed asset consumes a matching
 * spare, occupies a real repair robot and one awake qualified crew member, then
 * accumulates powered work before the owning physical domain may service it.
 */

export const MAINTENANCE_SNAPSHOT_VERSION = 3 as const;
export const MAINTENANCE_SNAPSHOT_VERSIONS = [1, 2, 3] as const;
export const MAINTENANCE_MICROSECONDS_PER_SECOND = 1_000_000;
export const MAINTENANCE_DIAGNOSTIC_INTERVAL_SECONDS = 60;
export const MAINTENANCE_DIAGNOSTIC_DELAY_SECONDS = 120;

export const MAINTENANCE_ASSET_IDS = [
  "pump-a",
  "pump-b",
  "air-handler-a",
  "air-handler-b",
  "water-processor-a",
  "water-processor-b",
  "ring-a-bearing",
  "ring-b-bearing",
] as const;
export type MaintenanceAssetId =
  (typeof MAINTENANCE_ASSET_IDS)[number];

export const MAINTENANCE_PART_IDS = [
  "pump-service-kit",
  "air-handler-cartridge",
  "water-membrane-pack",
  "bearing-service-kit",
] as const;
export type MaintenancePartId =
  (typeof MAINTENANCE_PART_IDS)[number];

export const MAINTENANCE_ROBOT_IDS = [
  "repair-robot-a1",
  "repair-robot-a2",
  "repair-robot-b1",
  "repair-robot-b2",
] as const;
export type MaintenanceRobotId =
  (typeof MAINTENANCE_ROBOT_IDS)[number];

export type MaintenanceRing = "a" | "b";
export type MaintenanceAssetCondition =
  | "nominal"
  | "degraded"
  | "failed"
  | "stuck-off"
  | "stuck-on"
  | "seized";

export interface MaintenanceAssetSpecification {
  id: MaintenanceAssetId;
  label: string;
  ring: MaintenanceRing;
  requiredPartId: MaintenancePartId;
  requiredWorkSeconds: number;
  preferredSkillIds: readonly string[];
}

export const MAINTENANCE_ASSET_SPECS: Readonly<
  Record<MaintenanceAssetId, MaintenanceAssetSpecification>
> = Object.freeze({
  "pump-a": {
    id: "pump-a",
    label: "A 冷却泵",
    ring: "a",
    requiredPartId: "pump-service-kit",
    requiredWorkSeconds: 7_200,
    preferredSkillIds: ["fluid-loops", "maintenance"],
  },
  "pump-b": {
    id: "pump-b",
    label: "B 冷却泵",
    ring: "b",
    requiredPartId: "pump-service-kit",
    requiredWorkSeconds: 7_200,
    preferredSkillIds: ["fluid-loops", "maintenance"],
  },
  "air-handler-a": {
    id: "air-handler-a",
    label: "A 空气处理机",
    ring: "a",
    requiredPartId: "air-handler-cartridge",
    requiredWorkSeconds: 3_600,
    preferredSkillIds: ["atmosphere", "life-support", "maintenance"],
  },
  "air-handler-b": {
    id: "air-handler-b",
    label: "B 空气处理机",
    ring: "b",
    requiredPartId: "air-handler-cartridge",
    requiredWorkSeconds: 3_600,
    preferredSkillIds: ["atmosphere", "life-support", "maintenance"],
  },
  "water-processor-a": {
    id: "water-processor-a",
    label: "A 水回收机",
    ring: "a",
    requiredPartId: "water-membrane-pack",
    requiredWorkSeconds: 10_800,
    preferredSkillIds: ["water-recycling", "chemistry", "maintenance"],
  },
  "water-processor-b": {
    id: "water-processor-b",
    label: "B 水回收机",
    ring: "b",
    requiredPartId: "water-membrane-pack",
    requiredWorkSeconds: 10_800,
    preferredSkillIds: ["water-recycling", "chemistry", "maintenance"],
  },
  "ring-a-bearing": {
    id: "ring-a-bearing",
    label: "A 居住环轴承",
    ring: "a",
    requiredPartId: "bearing-service-kit",
    requiredWorkSeconds: 21_600,
    preferredSkillIds: ["maintenance", "damage-control", "structural-analysis"],
  },
  "ring-b-bearing": {
    id: "ring-b-bearing",
    label: "B 居住环轴承",
    ring: "b",
    requiredPartId: "bearing-service-kit",
    requiredWorkSeconds: 21_600,
    preferredSkillIds: ["maintenance", "damage-control", "structural-analysis"],
  },
});

const INITIAL_PART_QUANTITIES: Readonly<Record<MaintenancePartId, number>> =
  Object.freeze({
    "pump-service-kit": 4,
    "air-handler-cartridge": 8,
    "water-membrane-pack": 8,
    "bearing-service-kit": 2,
  });

export interface MaintenanceRobot {
  id: MaintenanceRobotId;
  ring: MaintenanceRing;
  assignedTaskId: string | null;
}

export type MaintenanceTaskStatus = "active" | "completed" | "cancelled";
export type MaintenancePriority = "routine" | "priority" | "urgent" | "emergency";
export type MaintenanceBlockedReason =
  | "crew-unavailable"
  | "workshop-unpowered"
  | null;

export interface MaintenanceTask {
  id: string;
  sequence: number;
  assetId: MaintenanceAssetId;
  assetConditionAtDetection: Exclude<MaintenanceAssetCondition, "nominal">;
  status: MaintenanceTaskStatus;
  blockedReason: MaintenanceBlockedReason;
  createdAtMicroseconds: number;
  completedAtMicroseconds: number | null;
  cancelledAtMicroseconds: number | null;
  cancellationReason: string | null;
  priority: MaintenancePriority;
  assignedRobotId: MaintenanceRobotId;
  assignedCrewId: string;
  assignedSkillId: string;
  crewProficiency: number;
  nominalRequiredPartId: MaintenancePartId;
  requiredPartId: MaintenancePartId;
  repairDeratingFraction: number;
  requiredWorkSeconds: number;
  completedWorkSeconds: number;
}

export type MaintenanceConditionRecord = Record<
  MaintenanceAssetId,
  MaintenanceAssetCondition
>;

export interface MaintenanceDiagnosticFrame {
  sampledAtMicroseconds: number;
  availableAtMicroseconds: number;
  conditions: MaintenanceConditionRecord;
}

export interface MaintenanceSnapshot {
  snapshotVersion: (typeof MAINTENANCE_SNAPSHOT_VERSIONS)[number];
  elapsedMicroseconds: number;
  nextTaskSequence: number;
  inventory: Record<MaintenancePartId, number>;
  manufacturedInventory: Record<MaintenancePartId, number>;
  assetServiceLimitFractionById: Record<MaintenanceAssetId, number>;
  robots: MaintenanceRobot[];
  tasks: MaintenanceTask[];
  diagnostics: {
    nextSampleMicroseconds: number;
    published: MaintenanceDiagnosticFrame | null;
    pending: MaintenanceDiagnosticFrame[];
  };
}

export interface MaintenanceCrewAssignment {
  passengerId: string;
  skillId: string;
  proficiency: number;
}

export interface ScheduleMaintenanceInput {
  assetId: MaintenanceAssetId;
  detectedCondition: Exclude<MaintenanceAssetCondition, "nominal">;
  crew: MaintenanceCrewAssignment;
  requiredPartId?: MaintenancePartId;
  repairDeratingFraction?: number;
}

export interface MaintenanceAdvanceInput {
  currentConditions: MaintenanceConditionRecord;
  workshopServiceFractionByRing: Record<MaintenanceRing, number>;
  awakeCrewIds: ReadonlySet<string>;
}

export interface MaintenanceAdvanceResult {
  completedTasks: MaintenanceTask[];
}

export type MaintenanceSchedulingBlockReason =
  | "nominal-or-unknown"
  | "active-task-exists"
  | "part-inventory-exhausted"
  | "ring-robot-unavailable";

export type MaintenanceSchedulingFeasibility = {
  schedulable: boolean;
  blockReason: MaintenanceSchedulingBlockReason | null;
};

/**
 * Pure feasibility check for creating a new maintenance task.
 * Does not consider crew wakefulness (that requires the passenger roster);
 * robot occupancy and spare inventory are the hard same-ring capacity gates.
 */
export function evaluateMaintenanceSchedulingFeasibility(input: {
  assetId: MaintenanceAssetId;
  condition: MaintenanceAssetCondition | null | undefined;
  activeAssetIds: ReadonlySet<string> | ReadonlyArray<{ assetId: string; status?: string }>;
  robots: ReadonlyArray<Pick<MaintenanceRobot, "ring" | "assignedTaskId">>;
  inventory: Readonly<Partial<Record<MaintenancePartId, number>>>;
  requiredPartId?: MaintenancePartId;
}): MaintenanceSchedulingFeasibility {
  const spec = MAINTENANCE_ASSET_SPECS[input.assetId];
  if (!spec) {
    return { schedulable: false, blockReason: "nominal-or-unknown" };
  }
  if (
    input.condition === null ||
    input.condition === undefined ||
    input.condition === "nominal"
  ) {
    return { schedulable: false, blockReason: "nominal-or-unknown" };
  }
  const activeAssetIds =
    input.activeAssetIds instanceof Set
      ? input.activeAssetIds
      : new Set(
          (
            input.activeAssetIds as ReadonlyArray<{
              assetId: string;
              status?: string;
            }>
          )
            .filter((task) => task.status === undefined || task.status === "active")
            .map((task) => task.assetId),
        );
  if (activeAssetIds.has(input.assetId)) {
    return { schedulable: false, blockReason: "active-task-exists" };
  }
  const requiredPartId = input.requiredPartId ?? spec.requiredPartId;
  if ((input.inventory[requiredPartId] ?? 0) <= 0) {
    return { schedulable: false, blockReason: "part-inventory-exhausted" };
  }
  const freeRobot = input.robots.some(
    (robot) => robot.ring === spec.ring && robot.assignedTaskId === null,
  );
  if (!freeRobot) {
    return { schedulable: false, blockReason: "ring-robot-unavailable" };
  }
  return { schedulable: true, blockReason: null };
}

/**
 * Faults that are diagnosed, have no active task, and can actually be scheduled
 * right now (same-ring free robot + spare part). Capacity-blocked faults must
 * not be treated as "unattended emergencies."
 *
 * Optional truthConditions / recentlyCompletedAssetIds suppress lag-window
 * false positives: delayed diagnostics can still show a fault after repair
 * completed (or truth already returned to nominal). Triggers and UI lists that
 * omit these will keep waking the captain to re-schedule already-fixed assets.
 */
export function listActionableUnattendedMaintenanceFaults(input: {
  observedAssets: ReadonlyArray<{
    assetId: MaintenanceAssetId;
    condition: MaintenanceAssetCondition | null;
    label?: string;
  }>;
  activeTasks: ReadonlyArray<{ assetId: string; status?: string }>;
  robots: ReadonlyArray<Pick<MaintenanceRobot, "ring" | "assignedTaskId">>;
  inventory: Readonly<Partial<Record<MaintenancePartId, number>>>;
  truthConditions?: Readonly<
    Partial<Record<MaintenanceAssetId, MaintenanceAssetCondition>>
  >;
  recentlyCompletedAssetIds?: ReadonlySet<string> | ReadonlyArray<string>;
}): Array<{
  assetId: MaintenanceAssetId;
  condition: Exclude<MaintenanceAssetCondition, "nominal">;
  label?: string;
}> {
  const activeAssetIds = new Set(
    input.activeTasks
      .filter((task) => task.status === undefined || task.status === "active")
      .map((task) => task.assetId),
  );
  const recentlyCompleted =
    input.recentlyCompletedAssetIds instanceof Set
      ? input.recentlyCompletedAssetIds
      : new Set(input.recentlyCompletedAssetIds ?? []);
  const actionable: Array<{
    assetId: MaintenanceAssetId;
    condition: Exclude<MaintenanceAssetCondition, "nominal">;
    label?: string;
  }> = [];
  for (const asset of input.observedAssets) {
    if (
      asset.condition === null ||
      asset.condition === "nominal" ||
      activeAssetIds.has(asset.assetId) ||
      recentlyCompleted.has(asset.assetId)
    ) {
      continue;
    }
    const truthCondition = input.truthConditions?.[asset.assetId];
    if (truthCondition === "nominal") {
      // Diagnostic lag: observed still faults, truth already repaired.
      continue;
    }
    const feasibility = evaluateMaintenanceSchedulingFeasibility({
      assetId: asset.assetId,
      condition: asset.condition,
      activeAssetIds,
      robots: input.robots,
      inventory: input.inventory,
    });
    if (!feasibility.schedulable) {
      continue;
    }
    actionable.push({
      assetId: asset.assetId,
      condition: asset.condition,
      ...(asset.label !== undefined ? { label: asset.label } : {}),
    });
  }
  return actionable;
}

/**
 * Executor / command-bus rejection text for expected maintenance capacity
 * contention. These are not world-integrity failures; the captain queue may
 * continue and the simulation should not hard-pause.
 */
export function isMaintenanceResourceContentionMessage(
  message: string,
): boolean {
  return (
    /repair robot is available/i.test(message) ||
    /inventory is exhausted/i.test(message) ||
    /没有清醒且具备/.test(message) ||
    /already has an active maintenance task/.test(message) ||
    /当前没有可维修故障/.test(message) ||
    /is not in a repairable fault state/.test(message) ||
    /lacks a qualified skill/.test(message)
  );
}

const CAPTAIN_SOFT_REJECT_BUS_CODES =
  /command (UNKNOWN_ACTOR|FORBIDDEN|REVISION_CONFLICT|REVISION_EXHAUSTED|IDEMPOTENCY_CONFLICT|COMMAND_ID_CONFLICT)\b/;

const CAPTAIN_HARD_REJECT_BUS_CODES =
  /command (INVALID_EXECUTOR_RESULT|REENTRANT_DISPATCH)\b/;

/**
 * Soft rejects are expected admission / business refusals: invalid args,
 * revision mismatch, permission, resource contention, or already-satisfied
 * state. Hard failures are executor/domain inconsistency — those must stop
 * the captain world-command queue and pause the sim.
 */
export function isCaptainWorldCommandSoftRejectMessage(
  message: string,
): boolean {
  if (CAPTAIN_HARD_REJECT_BUS_CODES.test(message)) {
    return false;
  }
  if (
    /does not match the authoritative/i.test(message) ||
    /cross-domain projection/i.test(message) ||
    /fingerprint does not match/i.test(message) ||
    /topology does not match/i.test(message) ||
    /habitability lost/i.test(message) ||
    /maintenance lost /i.test(message)
  ) {
    return false;
  }
  if (CAPTAIN_SOFT_REJECT_BUS_CODES.test(message)) {
    return true;
  }
  if (isMaintenanceResourceContentionMessage(message)) {
    return true;
  }
  return (
    /state revision .+ is stale/i.test(message) ||
    /is in the future; simulation clock/i.test(message) ||
    /\brequires\b/i.test(message) ||
    /is incomplete/i.test(message) ||
    /unsupported ship command/i.test(message) ||
    /unknown (hull breach|maintenance (?:task|robot))\b/i.test(message) ||
    /must differ from the nominal/i.test(message) ||
    /already (?:used|has)\b/i.test(message) ||
    /is not registered/i.test(message) ||
    /cannot execute/i.test(message) ||
    /no hibernation pod is available/i.test(message) ||
    /does not contain enough/i.test(message) ||
    /is not awake for maintenance duty/i.test(message) ||
    /is deceased/i.test(message)
  );
}

function cloneData<T>(value: T): T {
  return structuredClone(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
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
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has an invalid topology`);
  }
}

function assertFiniteRange(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
}

function assertSafeInteger(value: unknown, minimum: number, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer >= ${minimum}`);
  }
}

function isAssetCondition(value: unknown): value is MaintenanceAssetCondition {
  return value === "nominal" || value === "degraded" || value === "failed" || value === "stuck-off" || value === "stuck-on" || value === "seized";
}

function validateConditionRecord(value: unknown, label: string): asserts value is MaintenanceConditionRecord {
  assertRecord(value, label);
  assertExactKeys(value, MAINTENANCE_ASSET_IDS, label);
  for (const assetId of MAINTENANCE_ASSET_IDS) {
    if (!isAssetCondition(value[assetId])) {
      throw new Error(`${label}.${assetId} has an invalid condition`);
    }
  }
}

function robotBaseline(): MaintenanceRobot[] {
  return MAINTENANCE_ROBOT_IDS.map((id) => ({
    id,
    ring: id.includes("-a") ? "a" : "b",
    assignedTaskId: null,
  }));
}

function createSnapshot(): MaintenanceSnapshot {
  return {
    snapshotVersion: MAINTENANCE_SNAPSHOT_VERSION,
    elapsedMicroseconds: 0,
    nextTaskSequence: 1,
    inventory: cloneData(INITIAL_PART_QUANTITIES),
    manufacturedInventory: Object.fromEntries(
      MAINTENANCE_PART_IDS.map((partId) => [partId, 0]),
    ) as Record<MaintenancePartId, number>,
    assetServiceLimitFractionById: Object.fromEntries(
      MAINTENANCE_ASSET_IDS.map((assetId) => [assetId, 1]),
    ) as Record<MaintenanceAssetId, number>,
    robots: robotBaseline(),
    tasks: [],
    diagnostics: {
      nextSampleMicroseconds: 0,
      published: null,
      pending: [],
    },
  };
}

function validateDiagnosticFrame(value: unknown, label: string): asserts value is MaintenanceDiagnosticFrame {
  assertRecord(value, label);
  assertExactKeys(value, ["sampledAtMicroseconds", "availableAtMicroseconds", "conditions"], label);
  assertSafeInteger(value.sampledAtMicroseconds, 0, `${label}.sampledAtMicroseconds`);
  assertSafeInteger(value.availableAtMicroseconds, 0, `${label}.availableAtMicroseconds`);
  if (value.availableAtMicroseconds < value.sampledAtMicroseconds) {
    throw new Error(`${label} is available before it was sampled`);
  }
  validateConditionRecord(value.conditions, `${label}.conditions`);
}

export function validateMaintenanceSnapshot(value: unknown): asserts value is MaintenanceSnapshot {
  value = migrateMaintenanceSnapshot(value);
  assertRecord(value, "maintenance snapshot");
  assertExactKeys(
    value,
    ["snapshotVersion", "elapsedMicroseconds", "nextTaskSequence", "inventory", "manufacturedInventory", "assetServiceLimitFractionById", "robots", "tasks", "diagnostics"],
    "maintenance snapshot",
  );
  if (value.snapshotVersion !== MAINTENANCE_SNAPSHOT_VERSION) {
    throw new Error("unsupported maintenance snapshot version");
  }
  assertSafeInteger(value.elapsedMicroseconds, 0, "maintenance elapsedMicroseconds");
  assertSafeInteger(value.nextTaskSequence, 1, "maintenance nextTaskSequence");

  assertRecord(value.inventory, "maintenance inventory");
  assertExactKeys(value.inventory, MAINTENANCE_PART_IDS, "maintenance inventory");
  for (const partId of MAINTENANCE_PART_IDS) {
    assertSafeInteger(value.inventory[partId], 0, `maintenance inventory.${partId}`);
  }
  assertRecord(value.manufacturedInventory, "maintenance manufactured inventory");
  assertExactKeys(value.manufacturedInventory, MAINTENANCE_PART_IDS, "maintenance manufactured inventory");
  for (const partId of MAINTENANCE_PART_IDS) {
    assertSafeInteger(value.manufacturedInventory[partId], 0, `maintenance manufacturedInventory.${partId}`);
  }
  assertRecord(
    value.assetServiceLimitFractionById,
    "maintenance asset service limits",
  );
  assertExactKeys(
    value.assetServiceLimitFractionById,
    MAINTENANCE_ASSET_IDS,
    "maintenance asset service limits",
  );
  for (const assetId of MAINTENANCE_ASSET_IDS) {
    assertFiniteRange(
      value.assetServiceLimitFractionById[assetId],
      0,
      1,
      `maintenance assetServiceLimitFractionById.${assetId}`,
    );
  }

  if (!Array.isArray(value.robots) || value.robots.length !== MAINTENANCE_ROBOT_IDS.length) {
    throw new Error("maintenance robot topology is invalid");
  }
  const robots = value.robots as unknown[];
  const assignedTaskIds = new Set<string>();
  robots.forEach((rawRobot, index) => {
    assertRecord(rawRobot, `maintenance robots[${index}]`);
    assertExactKeys(rawRobot, ["id", "ring", "assignedTaskId"], `maintenance robots[${index}]`);
    const expectedId = MAINTENANCE_ROBOT_IDS[index];
    if (rawRobot.id !== expectedId) throw new Error("maintenance robot order changed");
    const expectedRing = expectedId.includes("-a") ? "a" : "b";
    if (rawRobot.ring !== expectedRing) throw new Error(`${expectedId} changed home ring`);
    if (rawRobot.assignedTaskId !== null && typeof rawRobot.assignedTaskId !== "string") {
      throw new Error(`${expectedId}.assignedTaskId is invalid`);
    }
    if (typeof rawRobot.assignedTaskId === "string" && !assignedTaskIds.add(rawRobot.assignedTaskId)) {
      throw new Error("one maintenance task is assigned to multiple robots");
    }
  });

  if (!Array.isArray(value.tasks)) throw new Error("maintenance tasks must be an array");
  const taskIds = new Set<string>();
  const activeAssets = new Set<MaintenanceAssetId>();
  const consumedByPart = Object.fromEntries(MAINTENANCE_PART_IDS.map((id) => [id, 0])) as Record<MaintenancePartId, number>;
  for (const [index, rawTask] of value.tasks.entries()) {
    assertRecord(rawTask, `maintenance tasks[${index}]`);
    assertExactKeys(
      rawTask,
      [
        "id", "sequence", "assetId", "assetConditionAtDetection", "status", "blockedReason",
        "createdAtMicroseconds", "completedAtMicroseconds", "cancelledAtMicroseconds", "cancellationReason", "priority", "assignedRobotId", "assignedCrewId",
        "assignedSkillId", "crewProficiency", "nominalRequiredPartId", "requiredPartId", "repairDeratingFraction", "requiredWorkSeconds", "completedWorkSeconds",
      ],
      `maintenance tasks[${index}]`,
    );
    if (typeof rawTask.id !== "string" || !taskIds.add(rawTask.id)) throw new Error("maintenance task id is invalid or duplicated");
    assertSafeInteger(rawTask.sequence, 1, `${rawTask.id}.sequence`);
    if (!MAINTENANCE_ASSET_IDS.includes(rawTask.assetId as MaintenanceAssetId)) throw new Error(`${rawTask.id}.assetId is invalid`);
    const assetId = rawTask.assetId as MaintenanceAssetId;
    if (!isAssetCondition(rawTask.assetConditionAtDetection) || rawTask.assetConditionAtDetection === "nominal") throw new Error(`${rawTask.id} has no repairable detected condition`);
    if (rawTask.status !== "active" && rawTask.status !== "completed" && rawTask.status !== "cancelled") throw new Error(`${rawTask.id}.status is invalid`);
    if (rawTask.blockedReason !== null && rawTask.blockedReason !== "crew-unavailable" && rawTask.blockedReason !== "workshop-unpowered") throw new Error(`${rawTask.id}.blockedReason is invalid`);
    assertSafeInteger(rawTask.createdAtMicroseconds, 0, `${rawTask.id}.createdAtMicroseconds`);
    if (rawTask.completedAtMicroseconds !== null) assertSafeInteger(rawTask.completedAtMicroseconds, 0, `${rawTask.id}.completedAtMicroseconds`);
    if (rawTask.cancelledAtMicroseconds !== null) assertSafeInteger(rawTask.cancelledAtMicroseconds, 0, `${rawTask.id}.cancelledAtMicroseconds`);
    if (rawTask.cancellationReason !== null && (typeof rawTask.cancellationReason !== "string" || rawTask.cancellationReason.length === 0)) throw new Error(`${rawTask.id}.cancellationReason is invalid`);
    if (!["routine", "priority", "urgent", "emergency"].includes(rawTask.priority as string)) throw new Error(`${rawTask.id}.priority is invalid`);
    if (!MAINTENANCE_ROBOT_IDS.includes(rawTask.assignedRobotId as MaintenanceRobotId)) throw new Error(`${rawTask.id}.assignedRobotId is invalid`);
    if (typeof rawTask.assignedCrewId !== "string" || rawTask.assignedCrewId.length === 0) throw new Error(`${rawTask.id}.assignedCrewId is invalid`);
    if (typeof rawTask.assignedSkillId !== "string" || rawTask.assignedSkillId.length === 0) throw new Error(`${rawTask.id}.assignedSkillId is invalid`);
    assertFiniteRange(rawTask.crewProficiency, 0, 1, `${rawTask.id}.crewProficiency`);
    const spec = MAINTENANCE_ASSET_SPECS[assetId];
    if (rawTask.nominalRequiredPartId !== spec.requiredPartId || rawTask.requiredWorkSeconds !== spec.requiredWorkSeconds) throw new Error(`${rawTask.id} changed its fixed repair recipe`);
    if (!MAINTENANCE_PART_IDS.includes(rawTask.requiredPartId as MaintenancePartId)) throw new Error(`${rawTask.id}.requiredPartId is invalid`);
    assertFiniteRange(rawTask.repairDeratingFraction, 0, 1, `${rawTask.id}.repairDeratingFraction`);
    if (rawTask.requiredPartId === spec.requiredPartId && rawTask.repairDeratingFraction !== 0) throw new Error(`${rawTask.id} applies derating to the nominal repair part`);
    assertFiniteRange(rawTask.completedWorkSeconds, 0, spec.requiredWorkSeconds, `${rawTask.id}.completedWorkSeconds`);
    consumedByPart[rawTask.requiredPartId as MaintenancePartId] += 1;
    const robot = robots.find((item) => (item as Record<string, unknown>).id === rawTask.assignedRobotId) as Record<string, unknown> | undefined;
    if (rawTask.status === "active") {
      if (!activeAssets.add(assetId)) throw new Error(`multiple active tasks target ${assetId}`);
      if (rawTask.completedAtMicroseconds !== null || rawTask.completedWorkSeconds >= spec.requiredWorkSeconds) throw new Error(`${rawTask.id} has invalid active progress`);
      if (robot?.assignedTaskId !== rawTask.id) throw new Error(`${rawTask.id} lost its robot assignment`);
    } else if (rawTask.status === "completed") {
      if (rawTask.completedAtMicroseconds === null || rawTask.completedWorkSeconds !== spec.requiredWorkSeconds || rawTask.blockedReason !== null) throw new Error(`${rawTask.id} has invalid completion state`);
      if (robot?.assignedTaskId === rawTask.id) throw new Error(`${rawTask.id} retained a robot after completion`);
    } else {
      if (rawTask.cancelledAtMicroseconds === null || rawTask.cancellationReason === null || rawTask.completedAtMicroseconds !== null || rawTask.blockedReason !== null) throw new Error(`${rawTask.id} has invalid cancellation state`);
      if (robot?.assignedTaskId === rawTask.id) throw new Error(`${rawTask.id} retained a robot after cancellation`);
    }
  }
  for (const partId of MAINTENANCE_PART_IDS) {
    if ((value.inventory[partId] as number) !== INITIAL_PART_QUANTITIES[partId] + (value.manufacturedInventory[partId] as number) - consumedByPart[partId]) {
      throw new Error(`${partId} inventory does not reconcile with scheduled work`);
    }
  }

  assertRecord(value.diagnostics, "maintenance diagnostics");
  assertExactKeys(value.diagnostics, ["nextSampleMicroseconds", "published", "pending"], "maintenance diagnostics");
  assertSafeInteger(value.diagnostics.nextSampleMicroseconds, 0, "maintenance diagnostics.nextSampleMicroseconds");
  if (value.diagnostics.published !== null) validateDiagnosticFrame(value.diagnostics.published, "maintenance diagnostics.published");
  if (!Array.isArray(value.diagnostics.pending)) throw new Error("maintenance diagnostics.pending must be an array");
  let lastAvailable = -1;
  value.diagnostics.pending.forEach((frame, index) => {
    validateDiagnosticFrame(frame, `maintenance diagnostics.pending[${index}]`);
    if ((frame as MaintenanceDiagnosticFrame).availableAtMicroseconds < lastAvailable) throw new Error("maintenance diagnostic queue is not ordered");
    lastAvailable = (frame as MaintenanceDiagnosticFrame).availableAtMicroseconds;
  });
}

function migrateMaintenanceSnapshot(value: unknown): MaintenanceSnapshot {
  assertRecord(value, "maintenance snapshot");
  const version = value.snapshotVersion;
  if (!(MAINTENANCE_SNAPSHOT_VERSIONS as readonly unknown[]).includes(version)) {
    throw new Error("unsupported maintenance snapshot version");
  }
  if (version === MAINTENANCE_SNAPSHOT_VERSION) {
    return value as unknown as MaintenanceSnapshot;
  }
  const legacy = cloneData(value) as Record<string, unknown>;
  if (version === 1) {
    legacy.manufacturedInventory = Object.fromEntries(
      MAINTENANCE_PART_IDS.map((partId) => [partId, 0]),
    );
    if (Array.isArray(legacy.tasks)) {
      legacy.tasks = legacy.tasks.map((rawTask) => ({
        ...(rawTask as Record<string, unknown>),
        cancelledAtMicroseconds: null,
        cancellationReason: null,
        priority: "priority",
      }));
    }
  }
  legacy.assetServiceLimitFractionById = Object.fromEntries(
    MAINTENANCE_ASSET_IDS.map((assetId) => [assetId, 1]),
  );
  if (Array.isArray(legacy.tasks)) {
    legacy.tasks = legacy.tasks.map((rawTask) => {
      const task = rawTask as Record<string, unknown>;
      const assetId = task.assetId as MaintenanceAssetId;
      const nominalRequiredPartId = MAINTENANCE_ASSET_SPECS[assetId]?.requiredPartId;
      return {
        ...task,
        nominalRequiredPartId,
        repairDeratingFraction: 0,
      };
    });
  }
  legacy.snapshotVersion = MAINTENANCE_SNAPSHOT_VERSION;
  return legacy as unknown as MaintenanceSnapshot;
}

export class MaintenanceNetwork {
  private stateValue: MaintenanceSnapshot;

  constructor(snapshot?: MaintenanceSnapshot) {
    this.stateValue = migrateMaintenanceSnapshot(
      cloneData(snapshot ?? createSnapshot()),
    );
    validateMaintenanceSnapshot(this.stateValue);
  }

  get elapsedMicroseconds(): number {
    return this.stateValue.elapsedMicroseconds;
  }

  listTasks(): MaintenanceTask[] {
    return cloneData(this.stateValue.tasks);
  }

  listRobots(): MaintenanceRobot[] {
    return cloneData(this.stateValue.robots);
  }

  getInventory(): Record<MaintenancePartId, number> {
    return cloneData(this.stateValue.inventory);
  }

  getAssetServiceLimitFraction(assetId: MaintenanceAssetId): number {
    return this.stateValue.assetServiceLimitFractionById[assetId];
  }

  getPublishedDiagnostic(): MaintenanceDiagnosticFrame | null {
    return cloneData(this.stateValue.diagnostics.published);
  }

  scheduleTask(input: ScheduleMaintenanceInput): MaintenanceTask {
    const spec = MAINTENANCE_ASSET_SPECS[input.assetId];
    if (!spec) throw new Error(`unknown maintenance asset: ${input.assetId}`);
    const detectedCondition: unknown = input.detectedCondition;
    if (!isAssetCondition(detectedCondition) || detectedCondition === "nominal") {
      throw new Error(`${input.assetId} is not in a repairable fault state`);
    }
    if (this.stateValue.tasks.some((task) => task.status === "active" && task.assetId === input.assetId)) {
      throw new Error(`${input.assetId} already has an active maintenance task`);
    }
    if (!spec.preferredSkillIds.includes(input.crew.skillId)) {
      throw new Error(`${input.crew.passengerId} lacks a qualified skill for ${input.assetId}`);
    }
    if (typeof input.crew.passengerId !== "string" || input.crew.passengerId.length === 0) {
      throw new Error("maintenance crew passengerId is required");
    }
    assertFiniteRange(input.crew.proficiency, 0, 1, "maintenance crew proficiency");
    const requiredPartId = input.requiredPartId ?? spec.requiredPartId;
    if (!MAINTENANCE_PART_IDS.includes(requiredPartId)) {
      throw new Error(`unknown maintenance part ${requiredPartId}`);
    }
    const repairDeratingFraction =
      input.repairDeratingFraction ??
      (requiredPartId === spec.requiredPartId ? 0 : 0.25);
    assertFiniteRange(
      repairDeratingFraction,
      0,
      1,
      "repair derating fraction",
    );
    if (
      requiredPartId === spec.requiredPartId &&
      repairDeratingFraction !== 0
    ) {
      throw new Error("nominal maintenance parts cannot impose repair derating");
    }
    if (this.stateValue.inventory[requiredPartId] <= 0) {
      throw new Error(`${requiredPartId} inventory is exhausted`);
    }
    const robot = this.stateValue.robots.find(
      (candidate) => candidate.ring === spec.ring && candidate.assignedTaskId === null,
    );
    if (!robot) throw new Error(`no ${spec.ring.toUpperCase()}-ring repair robot is available`);

    const sequence = this.stateValue.nextTaskSequence;
    const task: MaintenanceTask = {
      id: `maintenance-${String(sequence).padStart(6, "0")}`,
      sequence,
      assetId: input.assetId,
      assetConditionAtDetection: input.detectedCondition,
      status: "active",
      blockedReason: null,
      createdAtMicroseconds: this.stateValue.elapsedMicroseconds,
      completedAtMicroseconds: null,
      cancelledAtMicroseconds: null,
      cancellationReason: null,
      priority: "priority",
      assignedRobotId: robot.id,
      assignedCrewId: input.crew.passengerId,
      assignedSkillId: input.crew.skillId,
      crewProficiency: input.crew.proficiency,
      nominalRequiredPartId: spec.requiredPartId,
      requiredPartId,
      repairDeratingFraction,
      requiredWorkSeconds: spec.requiredWorkSeconds,
      completedWorkSeconds: 0,
    };
    this.stateValue.nextTaskSequence += 1;
    this.stateValue.inventory[requiredPartId] -= 1;
    robot.assignedTaskId = task.id;
    this.stateValue.tasks.push(task);
    validateMaintenanceSnapshot(this.stateValue);
    return cloneData(task);
  }

  cancelTask(taskId: string, reason: string): MaintenanceTask {
    const task = this.stateValue.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`unknown maintenance task ${taskId}`);
    if (task.status !== "active") throw new Error(`${taskId} is not active`);
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new Error("maintenance cancellation reason is required");
    const robot = this.stateValue.robots.find((candidate) => candidate.id === task.assignedRobotId);
    if (!robot || robot.assignedTaskId !== task.id) throw new Error(`${task.id} lost its robot assignment`);
    robot.assignedTaskId = null;
    task.status = "cancelled";
    task.blockedReason = null;
    task.cancelledAtMicroseconds = this.stateValue.elapsedMicroseconds;
    task.cancellationReason = normalizedReason;
    validateMaintenanceSnapshot(this.stateValue);
    return cloneData(task);
  }

  setTaskPriority(taskId: string, priority: MaintenancePriority): MaintenanceTask {
    const task = this.stateValue.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`unknown maintenance task ${taskId}`);
    if (task.status !== "active") throw new Error(`${taskId} is not active`);
    if (!["routine", "priority", "urgent", "emergency"].includes(priority)) {
      throw new Error("maintenance priority is invalid");
    }
    task.priority = priority;
    validateMaintenanceSnapshot(this.stateValue);
    return cloneData(task);
  }

  reassignTask(input: {
    taskId: string;
    crew: MaintenanceCrewAssignment;
    robotId?: MaintenanceRobotId;
  }): MaintenanceTask {
    const task = this.stateValue.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task) throw new Error(`unknown maintenance task ${input.taskId}`);
    if (task.status !== "active") throw new Error(`${input.taskId} is not active`);
    const spec = MAINTENANCE_ASSET_SPECS[task.assetId];
    if (!spec.preferredSkillIds.includes(input.crew.skillId)) {
      throw new Error(`${input.crew.passengerId} lacks a qualified skill for ${task.assetId}`);
    }
    assertFiniteRange(input.crew.proficiency, 0, 1, "maintenance crew proficiency");
    if (input.robotId && input.robotId !== task.assignedRobotId) {
      const nextRobot = this.stateValue.robots.find((candidate) => candidate.id === input.robotId);
      if (!nextRobot || nextRobot.ring !== spec.ring || nextRobot.assignedTaskId !== null) {
        throw new Error(`${input.robotId} is not an available ${spec.ring.toUpperCase()}-ring robot`);
      }
      const oldRobot = this.stateValue.robots.find((candidate) => candidate.id === task.assignedRobotId);
      if (!oldRobot || oldRobot.assignedTaskId !== task.id) throw new Error(`${task.id} lost its robot assignment`);
      oldRobot.assignedTaskId = null;
      nextRobot.assignedTaskId = task.id;
      task.assignedRobotId = nextRobot.id;
    }
    task.assignedCrewId = input.crew.passengerId;
    task.assignedSkillId = input.crew.skillId;
    task.crewProficiency = input.crew.proficiency;
    validateMaintenanceSnapshot(this.stateValue);
    return cloneData(task);
  }

  addManufacturedPart(partId: MaintenancePartId, quantity: number): number {
    assertSafeInteger(quantity, 1, "manufactured part quantity");
    this.stateValue.inventory[partId] += quantity;
    this.stateValue.manufacturedInventory[partId] += quantity;
    validateMaintenanceSnapshot(this.stateValue);
    return this.stateValue.inventory[partId];
  }

  advance(deltaSeconds: number, input: MaintenanceAdvanceInput): MaintenanceAdvanceResult {
    assertFiniteRange(deltaSeconds, 0, Number.MAX_SAFE_INTEGER, "maintenance deltaSeconds");
    validateConditionRecord(input.currentConditions, "maintenance currentConditions");
    assertFiniteRange(input.workshopServiceFractionByRing.a, 0, 1, "maintenance workshop service A");
    assertFiniteRange(input.workshopServiceFractionByRing.b, 0, 1, "maintenance workshop service B");
    if (!(input.awakeCrewIds instanceof Set)) throw new TypeError("maintenance awakeCrewIds must be a Set");

    const deltaMicroseconds = Math.round(deltaSeconds * MAINTENANCE_MICROSECONDS_PER_SECOND);
    if (Math.abs(deltaSeconds * MAINTENANCE_MICROSECONDS_PER_SECOND - deltaMicroseconds) > 1e-6) {
      throw new RangeError("maintenance deltaSeconds must resolve to whole microseconds");
    }
    const targetMicroseconds = this.stateValue.elapsedMicroseconds + deltaMicroseconds;
    const diagnosticInterval = MAINTENANCE_DIAGNOSTIC_INTERVAL_SECONDS * MAINTENANCE_MICROSECONDS_PER_SECOND;
    const diagnosticDelay = MAINTENANCE_DIAGNOSTIC_DELAY_SECONDS * MAINTENANCE_MICROSECONDS_PER_SECOND;
    while (this.stateValue.diagnostics.nextSampleMicroseconds <= targetMicroseconds) {
      const sampledAtMicroseconds = this.stateValue.diagnostics.nextSampleMicroseconds;
      this.stateValue.diagnostics.pending.push({
        sampledAtMicroseconds,
        availableAtMicroseconds: sampledAtMicroseconds + diagnosticDelay,
        conditions: cloneData(input.currentConditions),
      });
      this.stateValue.diagnostics.nextSampleMicroseconds += diagnosticInterval;
    }

    const completedTasks: MaintenanceTask[] = [];
    for (const task of this.stateValue.tasks) {
      if (task.status !== "active") continue;
      const spec = MAINTENANCE_ASSET_SPECS[task.assetId];
      const crewAwake = input.awakeCrewIds.has(task.assignedCrewId);
      const serviceFraction = input.workshopServiceFractionByRing[spec.ring];
      if (!crewAwake) {
        task.blockedReason = "crew-unavailable";
        continue;
      }
      if (serviceFraction <= 0) {
        task.blockedReason = "workshop-unpowered";
        continue;
      }
      task.blockedReason = null;
      const skillEfficiency = 0.5 + task.crewProficiency * 0.5;
      const priorityMultiplier = {
        routine: 0.8,
        priority: 1,
        urgent: 1.15,
        emergency: 1.3,
      }[task.priority];
      task.completedWorkSeconds = Math.min(
        task.requiredWorkSeconds,
        task.completedWorkSeconds + deltaSeconds * serviceFraction * skillEfficiency * priorityMultiplier,
      );
      if (task.completedWorkSeconds >= task.requiredWorkSeconds) {
        task.completedWorkSeconds = task.requiredWorkSeconds;
        task.status = "completed";
        task.completedAtMicroseconds = targetMicroseconds;
        this.stateValue.assetServiceLimitFractionById[task.assetId] =
          1 - task.repairDeratingFraction;
        const robot = this.stateValue.robots.find((candidate) => candidate.id === task.assignedRobotId);
        if (!robot || robot.assignedTaskId !== task.id) throw new Error(`${task.id} cannot release its assigned robot`);
        robot.assignedTaskId = null;
        completedTasks.push(cloneData(task));
      }
    }

    this.stateValue.elapsedMicroseconds = targetMicroseconds;
    while (
      this.stateValue.diagnostics.pending.length > 0 &&
      this.stateValue.diagnostics.pending[0].availableAtMicroseconds <= targetMicroseconds
    ) {
      this.stateValue.diagnostics.published = this.stateValue.diagnostics.pending.shift() ?? null;
    }
    validateMaintenanceSnapshot(this.stateValue);
    return { completedTasks };
  }

  snapshot(): MaintenanceSnapshot {
    return cloneData(this.stateValue);
  }

  static restore(serialized: string | MaintenanceSnapshot): MaintenanceNetwork {
    const parsed = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
    const migrated = migrateMaintenanceSnapshot(parsed);
    validateMaintenanceSnapshot(migrated);
    return new MaintenanceNetwork(migrated);
  }
}
