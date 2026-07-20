/**
 * Deterministic maintenance task network.
 *
 * A repair is never a direct condition write. A fixed asset consumes a matching
 * spare, occupies a real repair robot and one awake qualified crew member, then
 * accumulates powered work before the owning physical domain may service it.
 */

export const MAINTENANCE_SNAPSHOT_VERSION = 1 as const;
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

export type MaintenanceTaskStatus = "active" | "completed";
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
  assignedRobotId: MaintenanceRobotId;
  assignedCrewId: string;
  assignedSkillId: string;
  crewProficiency: number;
  requiredPartId: MaintenancePartId;
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
  snapshotVersion: typeof MAINTENANCE_SNAPSHOT_VERSION;
  elapsedMicroseconds: number;
  nextTaskSequence: number;
  inventory: Record<MaintenancePartId, number>;
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
}

export interface MaintenanceAdvanceInput {
  currentConditions: MaintenanceConditionRecord;
  workshopServiceFractionByRing: Record<MaintenanceRing, number>;
  awakeCrewIds: ReadonlySet<string>;
}

export interface MaintenanceAdvanceResult {
  completedTasks: MaintenanceTask[];
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
  assertRecord(value, "maintenance snapshot");
  assertExactKeys(
    value,
    ["snapshotVersion", "elapsedMicroseconds", "nextTaskSequence", "inventory", "robots", "tasks", "diagnostics"],
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
    if ((value.inventory[partId] as number) > INITIAL_PART_QUANTITIES[partId]) {
      throw new Error(`maintenance inventory.${partId} exceeds initial stock`);
    }
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
        "createdAtMicroseconds", "completedAtMicroseconds", "assignedRobotId", "assignedCrewId",
        "assignedSkillId", "crewProficiency", "requiredPartId", "requiredWorkSeconds", "completedWorkSeconds",
      ],
      `maintenance tasks[${index}]`,
    );
    if (typeof rawTask.id !== "string" || !taskIds.add(rawTask.id)) throw new Error("maintenance task id is invalid or duplicated");
    assertSafeInteger(rawTask.sequence, 1, `${rawTask.id}.sequence`);
    if (!MAINTENANCE_ASSET_IDS.includes(rawTask.assetId as MaintenanceAssetId)) throw new Error(`${rawTask.id}.assetId is invalid`);
    const assetId = rawTask.assetId as MaintenanceAssetId;
    if (!isAssetCondition(rawTask.assetConditionAtDetection) || rawTask.assetConditionAtDetection === "nominal") throw new Error(`${rawTask.id} has no repairable detected condition`);
    if (rawTask.status !== "active" && rawTask.status !== "completed") throw new Error(`${rawTask.id}.status is invalid`);
    if (rawTask.blockedReason !== null && rawTask.blockedReason !== "crew-unavailable" && rawTask.blockedReason !== "workshop-unpowered") throw new Error(`${rawTask.id}.blockedReason is invalid`);
    assertSafeInteger(rawTask.createdAtMicroseconds, 0, `${rawTask.id}.createdAtMicroseconds`);
    if (rawTask.completedAtMicroseconds !== null) assertSafeInteger(rawTask.completedAtMicroseconds, 0, `${rawTask.id}.completedAtMicroseconds`);
    if (!MAINTENANCE_ROBOT_IDS.includes(rawTask.assignedRobotId as MaintenanceRobotId)) throw new Error(`${rawTask.id}.assignedRobotId is invalid`);
    if (typeof rawTask.assignedCrewId !== "string" || rawTask.assignedCrewId.length === 0) throw new Error(`${rawTask.id}.assignedCrewId is invalid`);
    if (typeof rawTask.assignedSkillId !== "string" || rawTask.assignedSkillId.length === 0) throw new Error(`${rawTask.id}.assignedSkillId is invalid`);
    assertFiniteRange(rawTask.crewProficiency, 0, 1, `${rawTask.id}.crewProficiency`);
    const spec = MAINTENANCE_ASSET_SPECS[assetId];
    if (rawTask.requiredPartId !== spec.requiredPartId || rawTask.requiredWorkSeconds !== spec.requiredWorkSeconds) throw new Error(`${rawTask.id} changed its fixed repair recipe`);
    assertFiniteRange(rawTask.completedWorkSeconds, 0, spec.requiredWorkSeconds, `${rawTask.id}.completedWorkSeconds`);
    consumedByPart[spec.requiredPartId] += 1;
    const robot = robots.find((item) => (item as Record<string, unknown>).id === rawTask.assignedRobotId) as Record<string, unknown> | undefined;
    if (rawTask.status === "active") {
      if (!activeAssets.add(assetId)) throw new Error(`multiple active tasks target ${assetId}`);
      if (rawTask.completedAtMicroseconds !== null || rawTask.completedWorkSeconds >= spec.requiredWorkSeconds) throw new Error(`${rawTask.id} has invalid active progress`);
      if (robot?.assignedTaskId !== rawTask.id) throw new Error(`${rawTask.id} lost its robot assignment`);
    } else {
      if (rawTask.completedAtMicroseconds === null || rawTask.completedWorkSeconds !== spec.requiredWorkSeconds || rawTask.blockedReason !== null) throw new Error(`${rawTask.id} has invalid completion state`);
      if (robot?.assignedTaskId === rawTask.id) throw new Error(`${rawTask.id} retained a robot after completion`);
    }
  }
  for (const partId of MAINTENANCE_PART_IDS) {
    if ((value.inventory[partId] as number) !== INITIAL_PART_QUANTITIES[partId] - consumedByPart[partId]) {
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

export class MaintenanceNetwork {
  private stateValue: MaintenanceSnapshot;

  constructor(snapshot?: MaintenanceSnapshot) {
    this.stateValue = cloneData(snapshot ?? createSnapshot());
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
    if (this.stateValue.inventory[spec.requiredPartId] <= 0) {
      throw new Error(`${spec.requiredPartId} inventory is exhausted`);
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
      assignedRobotId: robot.id,
      assignedCrewId: input.crew.passengerId,
      assignedSkillId: input.crew.skillId,
      crewProficiency: input.crew.proficiency,
      requiredPartId: spec.requiredPartId,
      requiredWorkSeconds: spec.requiredWorkSeconds,
      completedWorkSeconds: 0,
    };
    this.stateValue.nextTaskSequence += 1;
    this.stateValue.inventory[spec.requiredPartId] -= 1;
    robot.assignedTaskId = task.id;
    this.stateValue.tasks.push(task);
    validateMaintenanceSnapshot(this.stateValue);
    return cloneData(task);
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
      task.completedWorkSeconds = Math.min(
        task.requiredWorkSeconds,
        task.completedWorkSeconds + deltaSeconds * serviceFraction * skillEfficiency,
      );
      if (task.completedWorkSeconds >= task.requiredWorkSeconds) {
        task.completedWorkSeconds = task.requiredWorkSeconds;
        task.status = "completed";
        task.completedAtMicroseconds = targetMicroseconds;
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
    validateMaintenanceSnapshot(parsed);
    return new MaintenanceNetwork(parsed);
  }
}
