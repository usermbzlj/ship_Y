/**
 * Captain operations authority.
 *
 * This domain owns the durable, auditable operational state which is neither
 * a raw physical actuator nor a player/system control-plane concern: mission
 * intent, delegated orders, communications, personnel dispositions, security,
 * logistics, active sensing and deployable craft.  It advances on the same
 * authoritative simulation clock as the physical domains.
 */

import type { ElectricalLoadId } from "./electrical.ts";
import type { MaintenancePartId } from "./maintenance.ts";
import {
  zoneCatalogEntry,
  type GasSpecies,
  type ZoneId,
  type ZoneRole,
} from "./compartments.ts";

/**
 * Reduced-order ZoneRole water demand (kg/awake-person-day), not a pipe network.
 * Living stays at the historical ~3 kg baseline; other roles diverge by purpose.
 */
export const ZONE_ROLE_WATER_KG_PER_AWAKE_PERSON_DAY: Readonly<
  Record<ZoneRole, number>
> = Object.freeze({
  living: 3,
  public: 2.5,
  medical: 4,
  galley: 6,
  agriculture: 8,
  cargo: 1.5,
  industrial: 2,
  access: 1.5,
});

export function defaultWaterAllocationKgPerDay(zoneId: ZoneId): number {
  return ZONE_ROLE_WATER_KG_PER_AWAKE_PERSON_DAY[zoneCatalogEntry(zoneId).role];
}

export const CAPTAIN_OPERATIONS_SNAPSHOT_VERSION = 3 as const;
export const CAPTAIN_OPERATIONS_SNAPSHOT_VERSIONS = [1, 2, 3] as const;

export const SHIP_DEPARTMENT_IDS = [
  "navigation",
  "engineering",
  "life-support",
  "medical",
  "passenger-affairs",
  "security",
  "passenger-service",
] as const;
export type ShipDepartmentId = (typeof SHIP_DEPARTMENT_IDS)[number];

export const DUTY_SHIFT_IDS = ["alpha", "beta", "gamma", "off"] as const;
export type DutyShiftId = (typeof DUTY_SHIFT_IDS)[number];

export const ORDER_PRIORITIES = [
  "routine",
  "priority",
  "urgent",
  "emergency",
] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export const SECURITY_TEAM_IDS = [
  "security-team-a",
  "security-team-b",
  "security-team-c",
  "security-team-d",
] as const;
export type SecurityTeamId = (typeof SECURITY_TEAM_IDS)[number];

export const AGRICULTURE_BAY_IDS = [
  "agriculture-a",
  "agriculture-b",
] as const;
export type AgricultureBayId = (typeof AGRICULTURE_BAY_IDS)[number];

export const FABRICATOR_IDS = ["fabricator-a", "fabricator-b"] as const;
export type FabricatorId = (typeof FABRICATOR_IDS)[number];

export const OXYGEN_GENERATOR_IDS = [
  "oxygen-generator-a",
  "oxygen-generator-b",
] as const;
export type OxygenGeneratorId = (typeof OXYGEN_GENERATOR_IDS)[number];

export const REMOTE_ASSET_IDS = [
  "probe-a",
  "probe-b",
  "drone-a1",
  "drone-a2",
  "drone-b1",
  "drone-b2",
] as const;
export type RemoteAssetId = (typeof REMOTE_ASSET_IDS)[number];

export const ACTIVE_SENSOR_PACKAGE_IDS = [
  "navigation-array",
  "hull-inspection-array",
  "thermal-diagnostic-array",
  "atmosphere-diagnostic-array",
  "external-radar",
  "communications-array",
] as const;
export type ActiveSensorPackageId =
  (typeof ACTIVE_SENSOR_PACKAGE_IDS)[number];

export type MissionDisposition =
  | "continue"
  | "return"
  | "divert"
  | "abandon";

export interface MissionWaypoint {
  id: string;
  label: string;
  distanceFromPreviousLightYears: number;
}

export interface CaptainMissionPlan {
  originalOrigin: string;
  originalDestination: string;
  destination: string;
  objective: string;
  disposition: MissionDisposition;
  route: MissionWaypoint[];
  revisedAtMicroseconds: number;
  revision: number;
}

export type DepartmentOrderStatus =
  | "queued"
  | "active"
  | "completed"
  | "cancelled"
  | "overdue";

export interface DepartmentOrder {
  id: string;
  departmentId: ShipDepartmentId;
  title: string;
  instruction: string;
  priority: OrderPriority;
  createdAtMicroseconds: number;
  dueAtMicroseconds: number;
  estimatedWorkSeconds: number;
  completedWorkSeconds: number;
  status: DepartmentOrderStatus;
  reportingIntervalSeconds: number;
  nextReportAtMicroseconds: number;
  reports: Array<{
    atMicroseconds: number;
    status: DepartmentOrderStatus;
    progressFraction: number;
    summary: string;
  }>;
  cancelledReason: string | null;
}

export type CommunicationKind =
  | "announcement"
  | "policy-explanation"
  | "grievance-response"
  | "external-message";

export interface CommunicationRecord {
  id: string;
  kind: CommunicationKind;
  audienceOrTarget: string;
  subject: string;
  message: string;
  createdAtMicroseconds: number;
  deliverAtMicroseconds: number;
  deliveredAtMicroseconds: number | null;
  relatedGrievanceId: string | null;
}

export interface PassengerGrievance {
  id: string;
  category: string;
  summary: string;
  filedAtMicroseconds: number;
  status: "open" | "accepted" | "answered" | "closed";
  responseCommunicationId: string | null;
  /** 提出申诉的乘客 id；开局种子或匿名汇总为 null。 */
  filedByPassengerId: string | null;
}

export interface CrewAssignment {
  personId: string;
  departmentId: ShipDepartmentId;
  role: string;
  shiftId: DutyShiftId;
  dutyZoneId: ZoneId | null;
  isDepartmentHead: boolean;
  effectiveAtMicroseconds: number;
}

export type TriageLevel =
  | "none"
  | "routine"
  | "urgent"
  | "critical"
  | "expectant";

export interface PersonDisposition {
  personId: string;
  currentZoneId: ZoneId | null;
  evacuationZoneId: ZoneId | null;
  triageLevel: TriageLevel;
  treatmentPlan: string | null;
  treatmentStatus: "none" | "scheduled" | "active" | "completed";
  detained: boolean;
  detentionReason: string | null;
  updatedAtMicroseconds: number;
}

export interface SecurityTeamState {
  id: SecurityTeamId;
  assignedZoneId: ZoneId | null;
  posture: "standby" | "patrol" | "protect" | "investigate" | "evacuate";
  caseId: string | null;
  available: boolean;
}

export interface SecurityCase {
  id: string;
  subjectPersonId: string | null;
  zoneId: ZoneId | null;
  allegation: string;
  status: "open" | "investigating" | "substantiated" | "cleared" | "closed";
  openedAtMicroseconds: number;
  findings: string[];
}

export interface AccessControlState {
  connectionId: string;
  accessMode: "open" | "restricted" | "sealed";
  reason: string;
  updatedAtMicroseconds: number;
}

export interface AgricultureBayState {
  id: AgricultureBayId;
  crop: string;
  intensityFraction: number;
  condition: "nominal" | "degraded" | "offline";
  cumulativeFoodProducedKg: number;
  cumulativeWaterConsumedKg: number;
}

export interface CargoLot {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  zoneId: ZoneId;
  reservedQuantity: number;
}

export interface CabinAllocation {
  personId: string;
  cabinId: string;
  zoneId: ZoneId;
  reason: string;
}

export interface SpareSubstitutionRule {
  assetId: string;
  substitutePartId: MaintenancePartId;
  approved: boolean;
  deratingFraction: number;
}

export type OperationsTaskKind =
  | "medical-treatment"
  | "relocation"
  | "hull-repair"
  | "manufacturing"
  | "security-investigation"
  | "active-scan"
  | "remote-deployment";

export interface OperationsTask {
  id: string;
  kind: OperationsTaskKind;
  targetId: string;
  description: string;
  createdAtMicroseconds: number;
  dueAtMicroseconds: number;
  requiredWorkSeconds: number;
  completedWorkSeconds: number;
  completedAtMicroseconds: number | null;
  status: "active" | "completed" | "cancelled" | "failed";
  priority: OrderPriority;
  assignedDepartmentId: ShipDepartmentId;
  effect: Record<string, string | number | boolean | null>;
  completionSummary: string | null;
}

export interface RemoteAssetState {
  id: RemoteAssetId;
  kind: "probe" | "drone";
  status: "stowed" | "deploying" | "deployed" | "recovering" | "lost";
  assignedMission: string | null;
  target: string | null;
  deployedAtMicroseconds: number | null;
  energyCapacityKWh: number;
  energyStoredKWh: number;
  deployedPowerKw: number;
  rechargePowerKw: number;
  lastTelemetryAtMicroseconds: number | null;
  telemetry: string[];
}

export interface OxygenGeneratorState {
  id: OxygenGeneratorId;
  ring: "a" | "b";
  enabled: boolean;
  ratedProductionKgPerHour: number;
  targetProductionKgPerHour: number;
  lastElectricalServiceFraction: number;
  cumulativeOxygenProducedKg: number;
  cumulativeWaterConsumedKg: number;
  cumulativeHydrogenProducedKg: number;
}

export interface SensorOperationsState {
  sampleIntervalSecondsByPackage: Record<ActiveSensorPackageId, number>;
  activeScans: OperationsTask[];
  completedScanReports: Array<{
    taskId: string;
    packageId: ActiveSensorPackageId;
    target: string;
    completedAtMicroseconds: number;
    summary: string;
  }>;
}

export interface CaptainOperationsSnapshot {
  snapshotVersion: typeof CAPTAIN_OPERATIONS_SNAPSHOT_VERSION;
  elapsedMicroseconds: number;
  revision: number;
  nextSequence: number;
  mission: CaptainMissionPlan;
  departmentOrders: DepartmentOrder[];
  communications: CommunicationRecord[];
  grievances: PassengerGrievance[];
  crewAssignments: CrewAssignment[];
  personDispositions: PersonDisposition[];
  securityTeams: SecurityTeamState[];
  securityCases: SecurityCase[];
  accessControls: AccessControlState[];
  rationKgPerAwakePersonDay: number;
  waterKgPerAwakePersonDayByZone: Record<ZoneId, number>;
  agricultureBays: AgricultureBayState[];
  cargo: CargoLot[];
  cabinAllocations: CabinAllocation[];
  spareSubstitutions: SpareSubstitutionRule[];
  tasks: OperationsTask[];
  remoteAssets: RemoteAssetState[];
  oxygenGenerators: OxygenGeneratorState[];
  hydrogenReserveKg: number;
  sensors: SensorOperationsState;
  powerAllocationLimitByLoad: Record<ElectricalLoadId, number>;
  atmosphereReserveKg: Record<GasSpecies, number>;
}

export type CaptainOperationsEffect =
  | {
      type: "food-produced";
      foodKg: number;
      /** Growth + facility irrigation potable debit (debited via water network). */
      waterConsumedKgByRing: { a: number; b: number };
      /** Facility irrigation only (intensity×power); subset of waterConsumed. */
      irrigationWaterKgByRing: { a: number; b: number };
    }
  | {
      type: "oxygen-produced";
      oxygenKg: number;
      hydrogenKg: number;
      waterConsumedKgByRing: { a: number; b: number };
    }
  | {
      type: "task-completed";
      task: OperationsTask;
    };

export interface CaptainOperationsAdvanceResult {
  effects: CaptainOperationsEffect[];
  reports: DepartmentOrder["reports"];
  deliveredCommunications: CommunicationRecord[];
}

export interface CaptainOperationsAdvanceInput {
  departmentServiceFractionById?: Partial<
    Record<ShipDepartmentId, number>
  >;
  taskServiceFractionById?: Readonly<Record<string, number>>;
  agricultureServiceFractionByRing?: Partial<Record<"a" | "b", number>>;
  /** 0–1 plant CO₂ availability by ring (worker derives from ag-zone pCO₂). */
  agricultureCo2AvailabilityByRing?: Partial<Record<"a" | "b", number>>;
  oxygenProductionServiceFractionByRing?: Partial<
    Record<"a" | "b", number>
  >;
  remoteAssetServiceFraction?: number;
  availablePotableWaterKgByRing?: Partial<Record<"a" | "b", number>>;
}

/** Below this CO₂ partial pressure, agriculture yield factor is 0. */
export const AGRICULTURE_CO2_STARVE_PA = 10;
/** At/above this CO₂ partial pressure, agriculture yield factor is 1 (Earth-like). */
export const AGRICULTURE_CO2_NOMINAL_PA = 40;
/**
 * Facility irrigation overhead (kg/day) at intensity 1.0 per bay, scaled by
 * intensity×power only (not CO₂). Dual bays at 0.65 ≈ 390 kg/day — material vs
 * ~900 kg/day recycler, far from draining ~1.8e6 kg potable.
 */
export const AGRICULTURE_IRRIGATION_KG_PER_DAY_AT_FULL_INTENSITY = 300;
/** Attempted food mass (kg/day) at intensity 1.0 per bay before power×CO₂. */
export const AGRICULTURE_FOOD_KG_PER_DAY_AT_FULL_INTENSITY = 42;
/** Growth stoichiometry: kg water drawn per attempted food kg. */
export const AGRICULTURE_GROWTH_WATER_KG_PER_FOOD_KG = 1.8;

/**
 * Simple plant CO₂ yield factor in [0, 1]:
 * clamp((pCO₂ − starve) / (nominal − starve), 0, 1).
 */
export function agricultureCo2YieldFactor(
  carbonDioxidePartialPressurePa: number,
): number {
  assertFinite(
    carbonDioxidePartialPressurePa,
    "agriculture CO2 partial pressure",
  );
  if (carbonDioxidePartialPressurePa <= AGRICULTURE_CO2_STARVE_PA) return 0;
  if (carbonDioxidePartialPressurePa >= AGRICULTURE_CO2_NOMINAL_PA) return 1;
  return (
    (carbonDioxidePartialPressurePa - AGRICULTURE_CO2_STARVE_PA) /
    (AGRICULTURE_CO2_NOMINAL_PA - AGRICULTURE_CO2_STARVE_PA)
  );
}

const MICROSECONDS_PER_SECOND = 1_000_000;
const MAX_HISTORY = 512;
const MAX_GRIEVANCES = 256;
const MAX_GRIEVANCE_SUMMARY_CHARS = 240;

function cloneData<T>(value: T): T {
  return structuredClone(value);
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function assertNonNegative(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0) throw new RangeError(`${label} cannot be negative`);
}

function assertFraction(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1`);
  }
}

function assertNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must be non-empty`);
  return normalized;
}

function initialWaterAllocations(zoneIds: readonly ZoneId[]): Record<ZoneId, number> {
  return Object.fromEntries(
    zoneIds.map((zoneId) => [zoneId, defaultWaterAllocationKgPerDay(zoneId)]),
  ) as Record<ZoneId, number>;
}

/** Fill missing zone keys with role defaults; preserve existing saved values. */
function ensureWaterAllocationsByZone(
  existing: Partial<Record<ZoneId, number>> | undefined,
  zoneIds: readonly ZoneId[],
): Record<ZoneId, number> {
  const next = {} as Record<ZoneId, number>;
  for (const zoneId of zoneIds) {
    const value = existing?.[zoneId];
    next[zoneId] =
      typeof value === "number" && Number.isFinite(value)
        ? value
        : defaultWaterAllocationKgPerDay(zoneId);
  }
  return next;
}

function initialPowerAllocations(
  loadIds: readonly ElectricalLoadId[],
): Record<ElectricalLoadId, number> {
  return Object.fromEntries(loadIds.map((loadId) => [loadId, 1])) as Record<
    ElectricalLoadId,
    number
  >;
}

function createInitialSnapshot(input: {
  origin: string;
  destination: string;
  objective: string;
  zoneIds: readonly ZoneId[];
  electricalLoadIds: readonly ElectricalLoadId[];
  elapsedMicroseconds?: number;
}): CaptainOperationsSnapshot {
  const grievances: PassengerGrievance[] = [
    {
      id: "grievance:ration-transparency",
      category: "rationing",
      summary: "乘客要求公开口粮分配规则与库存依据。",
      filedAtMicroseconds: 0,
      status: "open",
      responseCommunicationId: null,
      filedByPassengerId: null,
    },
    {
      id: "grievance:shift-equity",
      category: "duty-roster",
      summary: "清醒乘员要求复核值班负担是否公平。",
      filedAtMicroseconds: 0,
      status: "open",
      responseCommunicationId: null,
      filedByPassengerId: null,
    },
    {
      id: "grievance:medical-wait",
      category: "medical",
      summary: "乘客要求说明非急诊医疗等待顺序。",
      filedAtMicroseconds: 0,
      status: "open",
      responseCommunicationId: null,
      filedByPassengerId: null,
    },
  ];
  return {
    snapshotVersion: CAPTAIN_OPERATIONS_SNAPSHOT_VERSION,
    elapsedMicroseconds: input.elapsedMicroseconds ?? 0,
    revision: 0,
    nextSequence: 1,
    mission: {
      originalOrigin: assertNonEmpty(input.origin, "origin"),
      originalDestination: assertNonEmpty(input.destination, "destination"),
      destination: input.destination.trim(),
      objective: assertNonEmpty(input.objective, "objective"),
      disposition: "continue",
      route: [],
      revisedAtMicroseconds: input.elapsedMicroseconds ?? 0,
      revision: 0,
    },
    departmentOrders: [],
    communications: [],
    grievances,
    crewAssignments: [],
    personDispositions: [],
    securityTeams: SECURITY_TEAM_IDS.map((id) => ({
      id,
      assignedZoneId: null,
      posture: "standby",
      caseId: null,
      available: true,
    })),
    securityCases: [],
    accessControls: [],
    rationKgPerAwakePersonDay: 0.62,
    waterKgPerAwakePersonDayByZone: initialWaterAllocations(input.zoneIds),
    agricultureBays: AGRICULTURE_BAY_IDS.map((id) => ({
      id,
      crop: "复合谷物与豆科",
      intensityFraction: 0.65,
      condition: "nominal",
      cumulativeFoodProducedKg: 0,
      cumulativeWaterConsumedKg: 0,
    })),
    cargo: [
      {
        id: "cargo:hull-sealant",
        description: "舱体快速密封材料",
        quantity: 96,
        unit: "kit",
        zoneId: input.zoneIds[0],
        reservedQuantity: 0,
      },
      {
        id: "cargo:fabricator-feedstock",
        description: "通用制造原料",
        quantity: 24_000,
        unit: "kg",
        zoneId: input.zoneIds[Math.floor(input.zoneIds.length / 2)],
        reservedQuantity: 0,
      },
    ],
    cabinAllocations: [],
    spareSubstitutions: [],
    tasks: [],
    remoteAssets: REMOTE_ASSET_IDS.map((id) => ({
      id,
      kind: id.startsWith("probe") ? "probe" : "drone",
      status: "stowed",
      assignedMission: null,
      target: null,
      deployedAtMicroseconds: null,
      energyCapacityKWh: id.startsWith("probe") ? 240 : 48,
      energyStoredKWh: id.startsWith("probe") ? 240 : 48,
      deployedPowerKw: id.startsWith("probe") ? 0.8 : 3,
      rechargePowerKw: id.startsWith("probe") ? 4 : 12,
      lastTelemetryAtMicroseconds: null,
      telemetry: [],
    })),
    oxygenGenerators: OXYGEN_GENERATOR_IDS.map((id) => ({
      id,
      ring: id.endsWith("-a") ? "a" : "b",
      enabled: true,
      ratedProductionKgPerHour: 8,
      targetProductionKgPerHour: 4,
      lastElectricalServiceFraction: 1,
      cumulativeOxygenProducedKg: 0,
      cumulativeWaterConsumedKg: 0,
      cumulativeHydrogenProducedKg: 0,
    })),
    hydrogenReserveKg: 0,
    sensors: {
      sampleIntervalSecondsByPackage: Object.fromEntries(
        ACTIVE_SENSOR_PACKAGE_IDS.map((id) => [id, 60]),
      ) as Record<ActiveSensorPackageId, number>,
      activeScans: [],
      completedScanReports: [],
    },
    powerAllocationLimitByLoad: initialPowerAllocations(input.electricalLoadIds),
    atmosphereReserveKg: {
      oxygen: 32_000,
      nitrogen: 120_000,
      carbonDioxide: 4_000,
      waterVapor: 1_000,
    },
  };
}

function migrateCaptainOperationsSnapshot(
  value: unknown,
): CaptainOperationsSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("captain operations snapshot must be an object");
  }
  const legacy = cloneData(value) as Record<string, unknown>;
  if (legacy.snapshotVersion === 1) {
    const remoteAssets = Array.isArray(legacy.remoteAssets)
      ? legacy.remoteAssets
      : [];
    legacy.remoteAssets = remoteAssets.map((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return candidate;
      const asset = candidate as Record<string, unknown>;
      const probe =
        typeof asset.id === "string" && asset.id.startsWith("probe");
      return {
        ...asset,
        energyCapacityKWh: probe ? 240 : 48,
        energyStoredKWh: probe ? 240 : 48,
        deployedPowerKw: probe ? 0.8 : 3,
        rechargePowerKw: probe ? 4 : 12,
        lastTelemetryAtMicroseconds: null,
      };
    });
    legacy.tasks = Array.isArray(legacy.tasks)
      ? legacy.tasks.map((candidate) =>
          typeof candidate === "object" && candidate !== null
            ? { ...candidate, completedAtMicroseconds: null }
            : candidate,
        )
      : legacy.tasks;
    legacy.oxygenGenerators = OXYGEN_GENERATOR_IDS.map((id) => ({
      id,
      ring: id.endsWith("-a") ? "a" : "b",
      enabled: true,
      ratedProductionKgPerHour: 8,
      targetProductionKgPerHour: 4,
      lastElectricalServiceFraction: 1,
      cumulativeOxygenProducedKg: 0,
      cumulativeWaterConsumedKg: 0,
      cumulativeHydrogenProducedKg: 0,
    }));
    legacy.hydrogenReserveKg = 0;
    legacy.snapshotVersion = 2;
  }
  if (legacy.snapshotVersion === 2) {
    const grievances = Array.isArray(legacy.grievances)
      ? legacy.grievances
      : [];
    legacy.grievances = grievances.map((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return candidate;
      const grievance = candidate as Record<string, unknown>;
      return {
        ...grievance,
        filedByPassengerId:
          typeof grievance.filedByPassengerId === "string"
            ? grievance.filedByPassengerId
            : null,
      };
    });
    legacy.snapshotVersion = CAPTAIN_OPERATIONS_SNAPSHOT_VERSION;
  }
  return legacy as unknown as CaptainOperationsSnapshot;
}

function validateSnapshot(
  snapshot: CaptainOperationsSnapshot,
  zoneIds: readonly ZoneId[],
  loadIds: readonly ElectricalLoadId[],
): void {
  if (snapshot.snapshotVersion !== CAPTAIN_OPERATIONS_SNAPSHOT_VERSION) {
    throw new Error("unsupported captain operations snapshot version");
  }
  if (!Number.isSafeInteger(snapshot.elapsedMicroseconds) || snapshot.elapsedMicroseconds < 0) {
    throw new RangeError("captain operations clock is invalid");
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
    throw new RangeError("captain operations revision is invalid");
  }
  if (!Number.isSafeInteger(snapshot.nextSequence) || snapshot.nextSequence < 1) {
    throw new RangeError("captain operations sequence is invalid");
  }
  assertNonEmpty(snapshot.mission.originalOrigin, "mission.originalOrigin");
  assertNonEmpty(snapshot.mission.originalDestination, "mission.originalDestination");
  assertNonEmpty(snapshot.mission.destination, "mission.destination");
  assertNonEmpty(snapshot.mission.objective, "mission.objective");
  if (!["continue", "return", "divert", "abandon"].includes(snapshot.mission.disposition)) {
    throw new Error("mission disposition is invalid");
  }
  const zones = new Set(zoneIds);
  const loads = new Set(loadIds);
  for (const zoneId of zoneIds) {
    assertNonNegative(snapshot.waterKgPerAwakePersonDayByZone[zoneId], `water allocation ${zoneId}`);
  }
  if (Object.keys(snapshot.waterKgPerAwakePersonDayByZone).length !== zoneIds.length) {
    throw new Error("water allocation topology does not match fixed zones");
  }
  for (const loadId of loadIds) {
    if (!loads.has(loadId)) throw new Error(`unknown electrical load ${loadId}`);
    assertFraction(snapshot.powerAllocationLimitByLoad[loadId], `power allocation ${loadId}`);
  }
  for (const gas of ["oxygen", "nitrogen", "carbonDioxide", "waterVapor"] as const) {
    assertNonNegative(snapshot.atmosphereReserveKg[gas], `atmosphere reserve ${gas}`);
  }
  assertNonNegative(snapshot.hydrogenReserveKg, "hydrogen reserve");
  if (Object.keys(snapshot.powerAllocationLimitByLoad).length !== loadIds.length) {
    throw new Error("power allocation topology does not match fixed loads");
  }
  for (const disposition of snapshot.personDispositions) {
    if (disposition.currentZoneId !== null && !zones.has(disposition.currentZoneId)) {
      throw new Error(`unknown person location ${disposition.currentZoneId}`);
    }
  }
  const ids = new Set<string>();
  for (const collection of [
    snapshot.departmentOrders,
    snapshot.communications,
    snapshot.securityCases,
    snapshot.tasks,
  ]) {
    for (const item of collection) {
      if (ids.has(item.id)) throw new Error(`duplicate captain operations id ${item.id}`);
      ids.add(item.id);
    }
  }
  assertNonNegative(snapshot.rationKgPerAwakePersonDay, "rationKgPerAwakePersonDay");
  for (const bay of snapshot.agricultureBays) {
    assertFraction(bay.intensityFraction, `${bay.id}.intensityFraction`);
    assertNonNegative(bay.cumulativeFoodProducedKg, `${bay.id}.foodProduced`);
    assertNonNegative(bay.cumulativeWaterConsumedKg, `${bay.id}.waterConsumed`);
  }
  if (snapshot.oxygenGenerators.length !== OXYGEN_GENERATOR_IDS.length) {
    throw new Error("oxygen generator topology does not match fixed plant");
  }
  for (const generatorId of OXYGEN_GENERATOR_IDS) {
    const generator = snapshot.oxygenGenerators.find(
      (item) => item.id === generatorId,
    );
    if (!generator) throw new Error(`missing oxygen generator ${generatorId}`);
    assertNonNegative(
      generator.ratedProductionKgPerHour,
      `${generator.id}.ratedProductionKgPerHour`,
    );
    assertNonNegative(
      generator.targetProductionKgPerHour,
      `${generator.id}.targetProductionKgPerHour`,
    );
    if (
      generator.targetProductionKgPerHour >
      generator.ratedProductionKgPerHour
    ) {
      throw new RangeError(`${generator.id} target exceeds rated production`);
    }
    assertFraction(
      generator.lastElectricalServiceFraction,
      `${generator.id}.lastElectricalServiceFraction`,
    );
    assertNonNegative(
      generator.cumulativeOxygenProducedKg,
      `${generator.id}.cumulativeOxygenProducedKg`,
    );
    assertNonNegative(
      generator.cumulativeWaterConsumedKg,
      `${generator.id}.cumulativeWaterConsumedKg`,
    );
    assertNonNegative(
      generator.cumulativeHydrogenProducedKg,
      `${generator.id}.cumulativeHydrogenProducedKg`,
    );
  }
  for (const asset of snapshot.remoteAssets) {
    assertNonNegative(asset.energyCapacityKWh, `${asset.id}.energyCapacityKWh`);
    assertNonNegative(asset.energyStoredKWh, `${asset.id}.energyStoredKWh`);
    if (asset.energyStoredKWh > asset.energyCapacityKWh + 1e-9) {
      throw new RangeError(`${asset.id} energy exceeds capacity`);
    }
    assertNonNegative(asset.deployedPowerKw, `${asset.id}.deployedPowerKw`);
    assertNonNegative(asset.rechargePowerKw, `${asset.id}.rechargePowerKw`);
  }
}

export class CaptainOperations {
  private stateValue: CaptainOperationsSnapshot;
  private readonly zoneIds: readonly ZoneId[];
  private readonly loadIds: readonly ElectricalLoadId[];

  constructor(input: {
    origin: string;
    destination: string;
    objective: string;
    zoneIds: readonly ZoneId[];
    electricalLoadIds: readonly ElectricalLoadId[];
    elapsedMicroseconds?: number;
    snapshot?: CaptainOperationsSnapshot;
  }) {
    this.zoneIds = [...input.zoneIds];
    this.loadIds = [...input.electricalLoadIds];
    this.stateValue = cloneData(
      input.snapshot ?? createInitialSnapshot(input),
    );
    this.stateValue.waterKgPerAwakePersonDayByZone = ensureWaterAllocationsByZone(
      this.stateValue.waterKgPerAwakePersonDayByZone,
      this.zoneIds,
    );
    validateSnapshot(this.stateValue, this.zoneIds, this.loadIds);
  }

  get elapsedMicroseconds(): number {
    return this.stateValue.elapsedMicroseconds;
  }

  get revision(): number {
    return this.stateValue.revision;
  }

  getMission(): CaptainMissionPlan {
    return cloneData(this.stateValue.mission);
  }

  getRationKgPerAwakePersonDay(): number {
    return this.stateValue.rationKgPerAwakePersonDay;
  }

  getWaterAllocationKgPerDay(zoneId: ZoneId): number {
    const value = this.stateValue.waterKgPerAwakePersonDayByZone[zoneId];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : defaultWaterAllocationKgPerDay(zoneId);
  }

  getPowerAllocationLimit(loadId: ElectricalLoadId): number {
    return this.stateValue.powerAllocationLimitByLoad[loadId];
  }

  getSpareSubstitution(assetId: string): SpareSubstitutionRule | null {
    const rule = this.stateValue.spareSubstitutions.find(
      (item) => item.assetId === assetId && item.approved,
    );
    return rule ? cloneData(rule) : null;
  }

  locationOverrideFor(personId: string): ZoneId | null {
    return (
      this.stateValue.personDispositions.find(
        (item) => item.personId === personId,
      )?.currentZoneId ?? null
    );
  }

  reviseMission(input: {
    disposition: MissionDisposition;
    destination: string;
    objective: string;
    route: MissionWaypoint[];
  }): CaptainMissionPlan {
    const destination = assertNonEmpty(input.destination, "destination");
    const objective = assertNonEmpty(input.objective, "objective");
    if (!["continue", "return", "divert", "abandon"].includes(input.disposition)) {
      throw new Error("mission disposition is invalid");
    }
    if (input.route.length > 16) throw new RangeError("route cannot exceed 16 waypoints");
    input.route.forEach((waypoint, index) => {
      assertNonEmpty(waypoint.label, `route[${index}].label`);
      assertNonNegative(
        waypoint.distanceFromPreviousLightYears,
        `route[${index}].distance`,
      );
    });
    this.stateValue.mission = {
      ...this.stateValue.mission,
      destination,
      objective,
      disposition: input.disposition,
      route: cloneData(input.route),
      revisedAtMicroseconds: this.stateValue.elapsedMicroseconds,
      revision: this.stateValue.mission.revision + 1,
    };
    this.bumpRevision();
    return this.getMission();
  }

  createDepartmentOrder(input: {
    departmentId: ShipDepartmentId;
    title: string;
    instruction: string;
    priority: OrderPriority;
    deadlineSeconds: number;
    estimatedWorkSeconds: number;
    reportingIntervalSeconds: number;
  }): DepartmentOrder {
    if (!(SHIP_DEPARTMENT_IDS as readonly string[]).includes(input.departmentId)) {
      throw new Error("unknown department");
    }
    assertNonNegative(input.deadlineSeconds, "deadlineSeconds");
    if (input.deadlineSeconds <= 0 || input.deadlineSeconds > 2_592_000) {
      throw new RangeError("department order deadline must be within 30 days");
    }
    if (input.estimatedWorkSeconds <= 0 || input.estimatedWorkSeconds > 2_592_000) {
      throw new RangeError("department order work estimate must be within 30 days");
    }
    if (input.reportingIntervalSeconds < 60 || input.reportingIntervalSeconds > 86_400) {
      throw new RangeError("reporting interval must be between 60 and 86400 seconds");
    }
    const now = this.stateValue.elapsedMicroseconds;
    const order: DepartmentOrder = {
      id: this.nextId("order"),
      departmentId: input.departmentId,
      title: assertNonEmpty(input.title, "order title"),
      instruction: assertNonEmpty(input.instruction, "order instruction"),
      priority: input.priority,
      createdAtMicroseconds: now,
      dueAtMicroseconds: now + Math.round(input.deadlineSeconds * MICROSECONDS_PER_SECOND),
      estimatedWorkSeconds: input.estimatedWorkSeconds,
      completedWorkSeconds: 0,
      status: "queued",
      reportingIntervalSeconds: input.reportingIntervalSeconds,
      nextReportAtMicroseconds:
        now + Math.round(input.reportingIntervalSeconds * MICROSECONDS_PER_SECOND),
      reports: [],
      cancelledReason: null,
    };
    this.stateValue.departmentOrders.push(order);
    this.trimHistory(this.stateValue.departmentOrders);
    this.bumpRevision();
    return cloneData(order);
  }

  changeDepartmentOrder(input: {
    orderId: string;
    instruction?: string;
    priority?: OrderPriority;
    deadlineSeconds?: number;
    reportingIntervalSeconds?: number;
  }): DepartmentOrder {
    const order = this.requireDepartmentOrder(input.orderId);
    if (!["queued", "active", "overdue"].includes(order.status)) {
      throw new Error(`${order.id} cannot be changed in status ${order.status}`);
    }
    if (input.instruction !== undefined) {
      order.instruction = assertNonEmpty(input.instruction, "order instruction");
    }
    if (input.priority !== undefined) order.priority = input.priority;
    if (input.deadlineSeconds !== undefined) {
      if (input.deadlineSeconds <= 0 || input.deadlineSeconds > 2_592_000) {
        throw new RangeError("changed deadline must be within 30 days");
      }
      order.dueAtMicroseconds =
        this.stateValue.elapsedMicroseconds +
        Math.round(input.deadlineSeconds * MICROSECONDS_PER_SECOND);
    }
    if (input.reportingIntervalSeconds !== undefined) {
      if (input.reportingIntervalSeconds < 60 || input.reportingIntervalSeconds > 86_400) {
        throw new RangeError("reporting interval must be between 60 and 86400 seconds");
      }
      order.reportingIntervalSeconds = input.reportingIntervalSeconds;
      order.nextReportAtMicroseconds =
        this.stateValue.elapsedMicroseconds +
        Math.round(input.reportingIntervalSeconds * MICROSECONDS_PER_SECOND);
    }
    this.bumpRevision();
    return cloneData(order);
  }

  cancelDepartmentOrder(orderId: string, reason: string): DepartmentOrder {
    const order = this.requireDepartmentOrder(orderId);
    if (["completed", "cancelled"].includes(order.status)) {
      throw new Error(`${order.id} is already terminal`);
    }
    order.status = "cancelled";
    order.cancelledReason = assertNonEmpty(reason, "cancellation reason");
    this.bumpRevision();
    return cloneData(order);
  }

  reportDepartmentOrder(orderId: string): DepartmentOrder["reports"][number] {
    const order = this.requireDepartmentOrder(orderId);
    const report = this.makeOrderReport(order, "舰长要求即时进度回报");
    order.reports.push(report);
    this.bumpRevision();
    return cloneData(report);
  }

  /**
   * 登记一条乘客申诉。同一乘客同 category 已有 open 申诉时幂等返回既有条目，
   * 避免 LLM 轮询刷爆队列；队列超过上限时优先丢弃最旧已关闭项。
   */
  fileGrievance(input: {
    passengerId: string;
    category: string;
    summary: string;
  }): PassengerGrievance {
    const passengerId = assertNonEmpty(input.passengerId, "passengerId");
    const category = assertNonEmpty(input.category, "category");
    const summary = assertNonEmpty(input.summary, "summary").slice(
      0,
      MAX_GRIEVANCE_SUMMARY_CHARS,
    );
    const existing = this.stateValue.grievances.find(
      (item) =>
        item.status === "open" &&
        item.filedByPassengerId === passengerId &&
        item.category === category,
    );
    if (existing) return cloneData(existing);

    const grievance: PassengerGrievance = {
      id: this.nextId("grievance"),
      category,
      summary,
      filedAtMicroseconds: this.stateValue.elapsedMicroseconds,
      status: "open",
      responseCommunicationId: null,
      filedByPassengerId: passengerId,
    };
    this.stateValue.grievances.push(grievance);
    this.trimGrievanceQueue();
    this.bumpRevision();
    return cloneData(grievance);
  }

  recordCommunication(input: {
    kind: CommunicationKind;
    audienceOrTarget: string;
    subject: string;
    message: string;
    deliveryDelaySeconds?: number;
    relatedGrievanceId?: string;
  }): CommunicationRecord {
    const delaySeconds = input.deliveryDelaySeconds ?? 0;
    assertNonNegative(delaySeconds, "deliveryDelaySeconds");
    if (delaySeconds > 31_536_000) {
      throw new RangeError("communication delay cannot exceed one year");
    }
    let grievance: PassengerGrievance | undefined;
    if (input.relatedGrievanceId) {
      grievance = this.stateValue.grievances.find(
        (item) => item.id === input.relatedGrievanceId,
      );
      if (!grievance) throw new Error(`unknown grievance ${input.relatedGrievanceId}`);
    }
    const now = this.stateValue.elapsedMicroseconds;
    const record: CommunicationRecord = {
      id: this.nextId("communication"),
      kind: input.kind,
      audienceOrTarget: assertNonEmpty(input.audienceOrTarget, "audienceOrTarget"),
      subject: assertNonEmpty(input.subject, "subject"),
      message: assertNonEmpty(input.message, "message"),
      createdAtMicroseconds: now,
      deliverAtMicroseconds: now + Math.round(delaySeconds * MICROSECONDS_PER_SECOND),
      deliveredAtMicroseconds: delaySeconds === 0 ? now : null,
      relatedGrievanceId: grievance?.id ?? null,
    };
    this.stateValue.communications.push(record);
    if (grievance) {
      grievance.status = "answered";
      grievance.responseCommunicationId = record.id;
    }
    this.trimHistory(this.stateValue.communications);
    this.bumpRevision();
    return cloneData(record);
  }

  assignCrew(input: {
    personId: string;
    departmentId: ShipDepartmentId;
    role: string;
    shiftId: DutyShiftId;
    dutyZoneId: ZoneId | null;
    departmentHead: boolean;
  }): CrewAssignment {
    if (input.dutyZoneId !== null && !this.zoneIds.includes(input.dutyZoneId)) {
      throw new Error(`unknown duty zone ${input.dutyZoneId}`);
    }
    if (input.departmentHead) {
      for (const assignment of this.stateValue.crewAssignments) {
        if (assignment.departmentId === input.departmentId) {
          assignment.isDepartmentHead = false;
        }
      }
    }
    const next: CrewAssignment = {
      personId: assertNonEmpty(input.personId, "personId"),
      departmentId: input.departmentId,
      role: assertNonEmpty(input.role, "role"),
      shiftId: input.shiftId,
      dutyZoneId: input.dutyZoneId,
      isDepartmentHead: input.departmentHead,
      effectiveAtMicroseconds: this.stateValue.elapsedMicroseconds,
    };
    const index = this.stateValue.crewAssignments.findIndex(
      (assignment) => assignment.personId === next.personId,
    );
    if (index >= 0) this.stateValue.crewAssignments[index] = next;
    else this.stateValue.crewAssignments.push(next);
    this.bumpRevision();
    return cloneData(next);
  }

  setPersonDisposition(input: {
    personId: string;
    currentZoneId?: ZoneId | null;
    evacuationZoneId?: ZoneId | null;
    triageLevel?: TriageLevel;
    treatmentPlan?: string | null;
    treatmentStatus?: PersonDisposition["treatmentStatus"];
    detained?: boolean;
    detentionReason?: string | null;
  }): PersonDisposition {
    for (const zoneId of [input.currentZoneId, input.evacuationZoneId]) {
      if (zoneId !== undefined && zoneId !== null && !this.zoneIds.includes(zoneId)) {
        throw new Error(`unknown zone ${zoneId}`);
      }
    }
    let disposition = this.stateValue.personDispositions.find(
      (item) => item.personId === input.personId,
    );
    if (!disposition) {
      disposition = {
        personId: assertNonEmpty(input.personId, "personId"),
        currentZoneId: null,
        evacuationZoneId: null,
        triageLevel: "none",
        treatmentPlan: null,
        treatmentStatus: "none",
        detained: false,
        detentionReason: null,
        updatedAtMicroseconds: this.stateValue.elapsedMicroseconds,
      };
      this.stateValue.personDispositions.push(disposition);
    }
    if (input.currentZoneId !== undefined) disposition.currentZoneId = input.currentZoneId;
    if (input.evacuationZoneId !== undefined) disposition.evacuationZoneId = input.evacuationZoneId;
    if (input.triageLevel !== undefined) disposition.triageLevel = input.triageLevel;
    if (input.treatmentPlan !== undefined) disposition.treatmentPlan = input.treatmentPlan;
    if (input.treatmentStatus !== undefined) disposition.treatmentStatus = input.treatmentStatus;
    if (input.detained !== undefined) disposition.detained = input.detained;
    if (input.detentionReason !== undefined) disposition.detentionReason = input.detentionReason;
    disposition.updatedAtMicroseconds = this.stateValue.elapsedMicroseconds;
    this.bumpRevision();
    return cloneData(disposition);
  }

  deploySecurityTeam(input: {
    teamId: SecurityTeamId;
    zoneId: ZoneId | null;
    posture: SecurityTeamState["posture"];
    caseId?: string | null;
  }): SecurityTeamState {
    const team = this.stateValue.securityTeams.find((item) => item.id === input.teamId);
    if (!team) throw new Error(`unknown security team ${input.teamId}`);
    if (!team.available) throw new Error(`${team.id} is unavailable`);
    if (input.zoneId !== null && !this.zoneIds.includes(input.zoneId)) {
      throw new Error(`unknown security zone ${input.zoneId}`);
    }
    if (input.caseId) this.requireSecurityCase(input.caseId);
    team.assignedZoneId = input.zoneId;
    team.posture = input.posture;
    team.caseId = input.caseId ?? null;
    this.bumpRevision();
    return cloneData(team);
  }

  openSecurityCase(input: {
    subjectPersonId?: string | null;
    zoneId?: ZoneId | null;
    allegation: string;
  }): SecurityCase {
    if (input.zoneId && !this.zoneIds.includes(input.zoneId)) {
      throw new Error(`unknown security zone ${input.zoneId}`);
    }
    const securityCase: SecurityCase = {
      id: this.nextId("case"),
      subjectPersonId: input.subjectPersonId ?? null,
      zoneId: input.zoneId ?? null,
      allegation: assertNonEmpty(input.allegation, "allegation"),
      status: "open",
      openedAtMicroseconds: this.stateValue.elapsedMicroseconds,
      findings: [],
    };
    this.stateValue.securityCases.push(securityCase);
    this.trimHistory(this.stateValue.securityCases);
    this.bumpRevision();
    return cloneData(securityCase);
  }

  markSecurityCaseInvestigating(caseId: string): SecurityCase {
    const securityCase = this.requireSecurityCase(caseId);
    if (!["open", "investigating"].includes(securityCase.status)) {
      throw new Error(`${caseId} cannot return to investigation`);
    }
    securityCase.status = "investigating";
    this.bumpRevision();
    return cloneData(securityCase);
  }

  setAccessControl(input: {
    connectionId: string;
    accessMode: AccessControlState["accessMode"];
    reason: string;
  }): AccessControlState {
    const record: AccessControlState = {
      connectionId: assertNonEmpty(input.connectionId, "connectionId"),
      accessMode: input.accessMode,
      reason: assertNonEmpty(input.reason, "reason"),
      updatedAtMicroseconds: this.stateValue.elapsedMicroseconds,
    };
    const index = this.stateValue.accessControls.findIndex(
      (item) => item.connectionId === record.connectionId,
    );
    if (index >= 0) this.stateValue.accessControls[index] = record;
    else this.stateValue.accessControls.push(record);
    this.bumpRevision();
    return cloneData(record);
  }

  setRation(kgPerAwakePersonDay: number): number {
    assertNonNegative(kgPerAwakePersonDay, "kgPerAwakePersonDay");
    if (kgPerAwakePersonDay > 1.5) throw new RangeError("ration exceeds human service bound");
    this.stateValue.rationKgPerAwakePersonDay = kgPerAwakePersonDay;
    this.bumpRevision();
    return kgPerAwakePersonDay;
  }

  configureAgriculture(input: {
    bayId: AgricultureBayId;
    crop: string;
    intensityFraction: number;
  }): AgricultureBayState {
    const bay = this.stateValue.agricultureBays.find((item) => item.id === input.bayId);
    if (!bay) throw new Error(`unknown agriculture bay ${input.bayId}`);
    assertFraction(input.intensityFraction, "intensityFraction");
    bay.crop = assertNonEmpty(input.crop, "crop");
    bay.intensityFraction = input.intensityFraction;
    this.bumpRevision();
    return cloneData(bay);
  }

  moveCargo(input: {
    cargoId: string;
    quantity: number;
    destinationZoneId: ZoneId;
  }): CargoLot {
    const cargo = this.stateValue.cargo.find((item) => item.id === input.cargoId);
    if (!cargo) throw new Error(`unknown cargo ${input.cargoId}`);
    assertNonNegative(input.quantity, "cargo quantity");
    if (input.quantity <= 0 || input.quantity > cargo.quantity - cargo.reservedQuantity) {
      throw new Error(`${cargo.id} has insufficient unreserved quantity`);
    }
    if (!this.zoneIds.includes(input.destinationZoneId)) {
      throw new Error(`unknown cargo destination ${input.destinationZoneId}`);
    }
    const movable = cargo.quantity - cargo.reservedQuantity;
    if (input.quantity < movable) {
      cargo.quantity -= input.quantity;
      this.stateValue.cargo.push({
        ...cloneData(cargo),
        id: this.nextId("cargo-lot"),
        quantity: input.quantity,
        reservedQuantity: 0,
        zoneId: input.destinationZoneId,
      });
    } else {
      cargo.zoneId = input.destinationZoneId;
    }
    this.bumpRevision();
    return cloneData(cargo);
  }

  consumeCargo(cargoId: string, quantity: number): CargoLot {
    const cargo = this.stateValue.cargo.find((item) => item.id === cargoId);
    if (!cargo) throw new Error(`unknown cargo ${cargoId}`);
    assertNonNegative(quantity, "cargo consumption quantity");
    if (quantity <= 0 || quantity > cargo.quantity - cargo.reservedQuantity) {
      throw new Error(`${cargo.id} has insufficient unreserved quantity`);
    }
    cargo.quantity -= quantity;
    this.bumpRevision();
    return cloneData(cargo);
  }

  allocateCabin(input: {
    personId: string;
    cabinId: string;
    zoneId: ZoneId;
    reason: string;
  }): CabinAllocation {
    if (!this.zoneIds.includes(input.zoneId)) throw new Error(`unknown cabin zone ${input.zoneId}`);
    const allocation: CabinAllocation = {
      personId: assertNonEmpty(input.personId, "personId"),
      cabinId: assertNonEmpty(input.cabinId, "cabinId"),
      zoneId: input.zoneId,
      reason: assertNonEmpty(input.reason, "reason"),
    };
    const occupant = this.stateValue.cabinAllocations.find(
      (item) => item.cabinId === allocation.cabinId && item.personId !== allocation.personId,
    );
    if (occupant) throw new Error(`${allocation.cabinId} is already allocated`);
    const index = this.stateValue.cabinAllocations.findIndex(
      (item) => item.personId === allocation.personId,
    );
    if (index >= 0) this.stateValue.cabinAllocations[index] = allocation;
    else this.stateValue.cabinAllocations.push(allocation);
    this.setPersonDisposition({ personId: allocation.personId, currentZoneId: allocation.zoneId });
    return cloneData(allocation);
  }

  approveSpareSubstitution(input: SpareSubstitutionRule): SpareSubstitutionRule {
    assertFraction(input.deratingFraction, "deratingFraction");
    const rule = cloneData(input);
    const index = this.stateValue.spareSubstitutions.findIndex(
      (item) => item.assetId === input.assetId,
    );
    if (index >= 0) this.stateValue.spareSubstitutions[index] = rule;
    else this.stateValue.spareSubstitutions.push(rule);
    this.bumpRevision();
    return cloneData(rule);
  }

  configureOxygenGenerator(input: {
    generatorId: OxygenGeneratorId;
    enabled: boolean;
    targetProductionKgPerHour: number;
  }): OxygenGeneratorState {
    const generator = this.stateValue.oxygenGenerators.find(
      (item) => item.id === input.generatorId,
    );
    if (!generator) throw new Error(`unknown oxygen generator ${input.generatorId}`);
    assertNonNegative(
      input.targetProductionKgPerHour,
      "targetProductionKgPerHour",
    );
    if (input.targetProductionKgPerHour > generator.ratedProductionKgPerHour) {
      throw new RangeError(
        `${generator.id} target exceeds ${generator.ratedProductionKgPerHour} kg/h rating`,
      );
    }
    generator.enabled = input.enabled;
    generator.targetProductionKgPerHour = input.targetProductionKgPerHour;
    this.bumpRevision();
    return cloneData(generator);
  }

  setWaterAllocation(zoneId: ZoneId, kgPerAwakePersonDay: number): number {
    if (!this.zoneIds.includes(zoneId)) throw new Error(`unknown water zone ${zoneId}`);
    assertNonNegative(kgPerAwakePersonDay, "kgPerAwakePersonDay");
    if (kgPerAwakePersonDay > 12) throw new RangeError("water allocation exceeds service bound");
    this.stateValue.waterKgPerAwakePersonDayByZone[zoneId] = kgPerAwakePersonDay;
    this.bumpRevision();
    return kgPerAwakePersonDay;
  }

  setPowerAllocation(loadId: ElectricalLoadId, limitFraction: number): number {
    if (!this.loadIds.includes(loadId)) throw new Error(`unknown power load ${loadId}`);
    assertFraction(limitFraction, "limitFraction");
    this.stateValue.powerAllocationLimitByLoad[loadId] = limitFraction;
    this.bumpRevision();
    return limitFraction;
  }

  transferAtmosphereReserve(
    gas: GasSpecies,
    massKg: number,
    direction: "to-compartment" | "from-compartment",
  ): number {
    assertNonNegative(massKg, "atmosphere reserve transfer mass");
    if (massKg === 0) throw new RangeError("atmosphere reserve transfer must be positive");
    if (direction === "to-compartment") {
      if (this.stateValue.atmosphereReserveKg[gas] + 1e-9 < massKg) {
        throw new Error(`${gas} reserve is insufficient`);
      }
      this.stateValue.atmosphereReserveKg[gas] = Math.max(
        0,
        this.stateValue.atmosphereReserveKg[gas] - massKg,
      );
    } else {
      this.stateValue.atmosphereReserveKg[gas] += massKg;
    }
    this.bumpRevision();
    return this.stateValue.atmosphereReserveKg[gas];
  }

  scheduleTask(input: Omit<OperationsTask, "id" | "createdAtMicroseconds" | "dueAtMicroseconds" | "completedWorkSeconds" | "completedAtMicroseconds" | "status" | "completionSummary"> & { deadlineSeconds: number }): OperationsTask {
    if (input.requiredWorkSeconds <= 0 || input.requiredWorkSeconds > 2_592_000) {
      throw new RangeError("operations task work must be within 30 days");
    }
    if (input.deadlineSeconds <= 0 || input.deadlineSeconds > 2_592_000) {
      throw new RangeError("operations task deadline must be within 30 days");
    }
    const now = this.stateValue.elapsedMicroseconds;
    const task: OperationsTask = {
      id: this.nextId("task"),
      kind: input.kind,
      targetId: assertNonEmpty(input.targetId, "task targetId"),
      description: assertNonEmpty(input.description, "task description"),
      createdAtMicroseconds: now,
      dueAtMicroseconds: now + Math.round(input.deadlineSeconds * MICROSECONDS_PER_SECOND),
      requiredWorkSeconds: input.requiredWorkSeconds,
      completedWorkSeconds: 0,
      completedAtMicroseconds: null,
      status: "active",
      priority: input.priority,
      assignedDepartmentId: input.assignedDepartmentId,
      effect: cloneData(input.effect),
      completionSummary: null,
    };
    this.stateValue.tasks.push(task);
    this.trimHistory(this.stateValue.tasks);
    this.bumpRevision();
    return cloneData(task);
  }

  cancelTask(taskId: string, reason: string): OperationsTask {
    const task = this.requireTask(taskId);
    if (task.status !== "active") throw new Error(`${task.id} is not active`);
    task.status = "cancelled";
    task.completionSummary = assertNonEmpty(reason, "task cancellation reason");
    this.bumpRevision();
    return cloneData(task);
  }

  setSensorSampleInterval(
    packageId: ActiveSensorPackageId,
    sampleIntervalSeconds: number,
  ): number {
    if (!(ACTIVE_SENSOR_PACKAGE_IDS as readonly string[]).includes(packageId)) {
      throw new Error(`unknown sensor package ${packageId}`);
    }
    if (sampleIntervalSeconds < 1 || sampleIntervalSeconds > 86_400) {
      throw new RangeError("sensor interval must be between 1 and 86400 seconds");
    }
    this.stateValue.sensors.sampleIntervalSecondsByPackage[packageId] = sampleIntervalSeconds;
    this.bumpRevision();
    return sampleIntervalSeconds;
  }

  configureRemoteAsset(input: {
    assetId: RemoteAssetId;
    action: "deploy" | "recover" | "retask";
    mission: string;
    target: string;
  }): RemoteAssetState {
    const asset = this.stateValue.remoteAssets.find((item) => item.id === input.assetId);
    if (!asset) throw new Error(`unknown remote asset ${input.assetId}`);
    if (input.action === "deploy") {
      if (asset.status !== "stowed") throw new Error(`${asset.id} is not stowed`);
      asset.status = "deploying";
    } else if (input.action === "recover") {
      if (asset.status !== "deployed") throw new Error(`${asset.id} is not deployed`);
      asset.status = "recovering";
    } else if (asset.status !== "deployed") {
      throw new Error(`${asset.id} must be deployed before retasking`);
    }
    asset.assignedMission = assertNonEmpty(input.mission, "remote mission");
    asset.target = assertNonEmpty(input.target, "remote target");
    this.bumpRevision();
    return cloneData(asset);
  }

  applyCompletedTask(
    taskId: string,
    authoritativeCompletionSummary?: string,
  ): OperationsTask {
    const task = this.requireTask(taskId);
    if (task.status !== "completed") {
      throw new Error(`${task.id} is not completed`);
    }
    if (authoritativeCompletionSummary !== undefined) {
      task.completionSummary = assertNonEmpty(
        authoritativeCompletionSummary,
        "task completion summary",
      );
    }
    if (task.kind === "remote-deployment") {
      const asset = this.stateValue.remoteAssets.find(
        (item) => item.id === task.targetId,
      );
      if (!asset) throw new Error(`unknown remote asset ${task.targetId}`);
      const action = task.effect.action;
      if (action === "deploy") {
        asset.status = "deployed";
        asset.deployedAtMicroseconds = this.stateValue.elapsedMicroseconds;
        asset.lastTelemetryAtMicroseconds = this.stateValue.elapsedMicroseconds;
      } else if (action === "recover") {
        asset.status = "stowed";
        asset.deployedAtMicroseconds = null;
        asset.lastTelemetryAtMicroseconds = null;
      }
      asset.telemetry.push(task.completionSummary ?? `${task.description} 已完成`);
      if (asset.telemetry.length > 32) asset.telemetry.splice(0, asset.telemetry.length - 32);
    } else if (task.kind === "active-scan") {
      const packageId = task.effect.packageId;
      const target = task.effect.target;
      if (typeof packageId !== "string" || typeof target !== "string") {
        throw new Error(`${task.id} active scan effect is malformed`);
      }
      this.stateValue.sensors.completedScanReports.push({
        taskId: task.id,
        packageId: packageId as ActiveSensorPackageId,
        target,
        completedAtMicroseconds: this.stateValue.elapsedMicroseconds,
        summary:
          task.completionSummary ??
          `主动扫描完成：${target}；数据已进入 ${packageId} 分析队列。`,
      });
      this.trimHistory(this.stateValue.sensors.completedScanReports);
    } else if (task.kind === "medical-treatment") {
      const personId = task.effect.personId;
      if (typeof personId === "string") {
        this.setPersonDisposition({ personId, treatmentStatus: "completed" });
      }
    } else if (task.kind === "relocation") {
      const personId = task.effect.personId;
      const zoneId = task.effect.zoneId;
      if (typeof personId !== "string" || typeof zoneId !== "string") {
        throw new Error(`${task.id} relocation effect is malformed`);
      }
      this.setPersonDisposition({
        personId,
        currentZoneId: zoneId as ZoneId,
        evacuationZoneId:
          task.effect.evacuation === true ? (zoneId as ZoneId) : undefined,
      });
    } else if (task.kind === "security-investigation") {
      const caseId = task.effect.caseId;
      if (typeof caseId !== "string") {
        throw new Error(`${task.id} security investigation has no caseId`);
      }
      const securityCase = this.requireSecurityCase(caseId);
      securityCase.status = "cleared";
      securityCase.findings.push(
        task.completionSummary ??
          `${task.description} 已完成；未发现足以支持指控的实体证据。`,
      );
      const teamId = task.effect.teamId;
      if (typeof teamId === "string") {
        const team = this.stateValue.securityTeams.find(
          (candidate) => candidate.id === teamId,
        );
        if (team) {
          team.posture = "standby";
          team.caseId = null;
        }
      }
    }
    this.bumpRevision();
    return cloneData(task);
  }

  getNextScheduledBoundaryMicroseconds(): number | undefined {
    const now = this.stateValue.elapsedMicroseconds;
    const candidates: number[] = [];
    for (const communication of this.stateValue.communications) {
      if (
        communication.deliveredAtMicroseconds === null &&
        communication.deliverAtMicroseconds > now
      ) {
        candidates.push(communication.deliverAtMicroseconds);
      }
    }
    for (const order of this.stateValue.departmentOrders) {
      if (!["queued", "active", "overdue"].includes(order.status)) continue;
      if (order.nextReportAtMicroseconds > now) {
        candidates.push(order.nextReportAtMicroseconds);
      }
      const maximumRate = {
        routine: 0.8,
        priority: 1,
        urgent: 1.15,
        emergency: 1.3,
      }[order.priority];
      const remainingWork = Math.max(
        0,
        order.estimatedWorkSeconds - order.completedWorkSeconds,
      );
      if (remainingWork > 0) {
        candidates.push(
          now +
            Math.max(
              1,
              Math.round(
                (remainingWork / maximumRate) * MICROSECONDS_PER_SECOND,
              ),
            ),
        );
      }
    }
    for (const task of this.stateValue.tasks) {
      if (task.status !== "active") continue;
      const maximumRate = {
        routine: 0.8,
        priority: 1,
        urgent: 1.15,
        emergency: 1.25,
      }[task.priority];
      const remainingWork = Math.max(
        0,
        task.requiredWorkSeconds - task.completedWorkSeconds,
      );
      if (remainingWork > 0) {
        candidates.push(
          now +
            Math.max(
              1,
              Math.round(
                (remainingWork / maximumRate) * MICROSECONDS_PER_SECOND,
              ),
            ),
        );
      }
    }
    for (const asset of this.stateValue.remoteAssets) {
      if (
        asset.status === "deployed" &&
        asset.deployedPowerKw > 0 &&
        asset.energyStoredKWh > 0
      ) {
        candidates.push(
          now +
            Math.max(
              1,
              Math.round(
                (asset.energyStoredKWh / asset.deployedPowerKw) *
                  3_600 *
                  MICROSECONDS_PER_SECOND,
              ),
            ),
        );
      }
    }
    const next = candidates.filter((candidate) => candidate > now).sort(
      (left, right) => left - right,
    )[0];
    return next;
  }

  advance(
    simulatedSeconds: number,
    input: CaptainOperationsAdvanceInput = {},
  ): CaptainOperationsAdvanceResult {
    assertNonNegative(simulatedSeconds, "simulatedSeconds");
    const targetMicroseconds =
      this.stateValue.elapsedMicroseconds +
      Math.round(simulatedSeconds * MICROSECONDS_PER_SECOND);
    if (!Number.isSafeInteger(targetMicroseconds)) {
      throw new RangeError("captain operations clock exceeds safe range");
    }
    const reports: DepartmentOrder["reports"] = [];
    const deliveredCommunications: CommunicationRecord[] = [];
    const effects: CaptainOperationsEffect[] = [];
    const serviceForDepartment = (departmentId: ShipDepartmentId): number => {
      const value = input.departmentServiceFractionById?.[departmentId] ?? 1;
      assertFraction(value, `${departmentId} department service fraction`);
      return value;
    };
    const serviceForRing = (
      values: Partial<Record<"a" | "b", number>> | undefined,
      ring: "a" | "b",
      label: string,
    ): number => {
      const value = values?.[ring] ?? 1;
      assertFraction(value, `${ring} ${label} service fraction`);
      return value;
    };
    const remainingPotableWaterKgByRing = {
      a: input.availablePotableWaterKgByRing?.a ?? Number.MAX_SAFE_INTEGER,
      b: input.availablePotableWaterKgByRing?.b ?? Number.MAX_SAFE_INTEGER,
    };
    assertNonNegative(
      remainingPotableWaterKgByRing.a,
      "A-ring available potable water",
    );
    assertNonNegative(
      remainingPotableWaterKgByRing.b,
      "B-ring available potable water",
    );

    for (const order of this.stateValue.departmentOrders) {
      if (!["queued", "active", "overdue"].includes(order.status)) continue;
      if (order.status === "queued") order.status = "active";
      const priorityMultiplier = {
        routine: 0.8,
        priority: 1,
        urgent: 1.15,
        emergency: 1.3,
      }[order.priority];
      const workAtStart = order.completedWorkSeconds;
      const workRate =
        priorityMultiplier * serviceForDepartment(order.departmentId);
      const remainingWorkSeconds = Math.max(
        0,
        order.estimatedWorkSeconds - workAtStart,
      );
      const completionAtMicroseconds =
        workRate > 0
          ? this.stateValue.elapsedMicroseconds +
            Math.round(
              (remainingWorkSeconds / workRate) * MICROSECONDS_PER_SECOND,
            )
          : Number.POSITIVE_INFINITY;
      while (
        order.nextReportAtMicroseconds <=
          Math.min(targetMicroseconds, completionAtMicroseconds) &&
        order.status !== "cancelled"
      ) {
        const reportAtMicroseconds = order.nextReportAtMicroseconds;
        const elapsedToReportSeconds = Math.max(
          0,
          (reportAtMicroseconds - this.stateValue.elapsedMicroseconds) /
            MICROSECONDS_PER_SECOND,
        );
        const workAtReport = Math.min(
          order.estimatedWorkSeconds,
          workAtStart + elapsedToReportSeconds * workRate,
        );
        const statusAtReport: DepartmentOrderStatus =
          workAtReport >= order.estimatedWorkSeconds
            ? "completed"
            : reportAtMicroseconds > order.dueAtMicroseconds
              ? "overdue"
              : "active";
        const report = this.makeOrderReport(
          order,
          "定期进度回报",
          reportAtMicroseconds,
          workAtReport,
          statusAtReport,
        );
        order.reports.push(report);
        reports.push(cloneData(report));
        order.nextReportAtMicroseconds += Math.round(
          order.reportingIntervalSeconds * MICROSECONDS_PER_SECOND,
        );
        if (statusAtReport === "completed") break;
      }
      order.completedWorkSeconds = Math.min(
        order.estimatedWorkSeconds,
        workAtStart + simulatedSeconds * workRate,
      );
      if (order.completedWorkSeconds >= order.estimatedWorkSeconds) {
        order.status = "completed";
      } else if (targetMicroseconds > order.dueAtMicroseconds) {
        order.status = "overdue";
      }
      if (order.status === "completed" && order.reports.at(-1)?.status !== "completed") {
        const report = this.makeOrderReport(
          order,
          "部门命令已完成",
          Math.min(targetMicroseconds, completionAtMicroseconds),
        );
        order.reports.push(report);
        reports.push(cloneData(report));
      }
      if (order.reports.length > 32) order.reports.splice(0, order.reports.length - 32);
    }

    for (const communication of this.stateValue.communications) {
      if (
        communication.deliveredAtMicroseconds === null &&
        communication.deliverAtMicroseconds <= targetMicroseconds
      ) {
        communication.deliveredAtMicroseconds = communication.deliverAtMicroseconds;
        deliveredCommunications.push(cloneData(communication));
      }
    }

    for (const task of this.stateValue.tasks) {
      if (task.status !== "active") continue;
      const multiplier = {
        routine: 0.8,
        priority: 1,
        urgent: 1.15,
        emergency: 1.25,
      }[task.priority];
      const taskServiceFraction =
        input.taskServiceFractionById?.[task.id] ??
        serviceForDepartment(task.assignedDepartmentId);
      assertFraction(
        taskServiceFraction,
        `${task.id} operations task service fraction`,
      );
      const workAtStart = task.completedWorkSeconds;
      const workRate = multiplier * taskServiceFraction;
      task.completedWorkSeconds = Math.min(
        task.requiredWorkSeconds,
        workAtStart + simulatedSeconds * workRate,
      );
      if (task.completedWorkSeconds >= task.requiredWorkSeconds) {
        task.status = "completed";
        task.completedAtMicroseconds =
          workRate <= 0
            ? targetMicroseconds
            : Math.min(
                targetMicroseconds,
                this.stateValue.elapsedMicroseconds +
                  Math.round(
                    ((task.requiredWorkSeconds - workAtStart) / workRate) *
                      MICROSECONDS_PER_SECOND,
                  ),
              );
        task.completionSummary = `${task.description} 已完成`;
        effects.push({ type: "task-completed", task: cloneData(task) });
      } else if (targetMicroseconds > task.dueAtMicroseconds) {
        task.completionSummary = `${task.description} 已超过要求期限`;
      }
    }

    let producedOxygenKg = 0;
    let producedHydrogenKg = 0;
    const oxygenWaterByRing = { a: 0, b: 0 };
    for (const generator of this.stateValue.oxygenGenerators) {
      const serviceFraction = generator.enabled
        ? serviceForRing(
            input.oxygenProductionServiceFractionByRing,
            generator.ring,
            "oxygen production",
          )
        : 0;
      generator.lastElectricalServiceFraction = serviceFraction;
      const desiredOxygenKg =
        (simulatedSeconds / 3_600) *
        generator.targetProductionKgPerHour *
        serviceFraction;
      const desiredWaterKg = desiredOxygenKg * (9 / 8);
      const waterKg = Math.min(
        desiredWaterKg,
        remainingPotableWaterKgByRing[generator.ring],
      );
      const oxygenKg = waterKg * (8 / 9);
      const hydrogenKg = waterKg / 9;
      remainingPotableWaterKgByRing[generator.ring] -= waterKg;
      generator.cumulativeOxygenProducedKg += oxygenKg;
      generator.cumulativeWaterConsumedKg += waterKg;
      generator.cumulativeHydrogenProducedKg += hydrogenKg;
      // Honesty: O₂ production credits atmosphereReserveKg only — cabin gas needs
      // set-atmosphere-supply. Do not auto-inject into zones here.
      this.stateValue.atmosphereReserveKg.oxygen += oxygenKg;
      this.stateValue.hydrogenReserveKg += hydrogenKg;
      producedOxygenKg += oxygenKg;
      producedHydrogenKg += hydrogenKg;
      oxygenWaterByRing[generator.ring] += waterKg;
    }
    if (producedOxygenKg > 0) {
      effects.push({
        type: "oxygen-produced",
        oxygenKg: producedOxygenKg,
        hydrogenKg: producedHydrogenKg,
        waterConsumedKgByRing: oxygenWaterByRing,
      });
    }

    let producedFoodKg = 0;
    const waterByRing = { a: 0, b: 0 };
    const irrigationByRing = { a: 0, b: 0 };
    for (const bay of this.stateValue.agricultureBays) {
      const ring = bay.id.endsWith("-a") ? "a" : "b";
      const conditionFraction =
        bay.condition === "nominal" ? 1 : bay.condition === "degraded" ? 0.45 : 0;
      const powerFactor = serviceForRing(
        input.agricultureServiceFractionByRing,
        ring,
        "agriculture",
      );
      const co2Factor = serviceForRing(
        input.agricultureCo2AvailabilityByRing,
        ring,
        "agriculture CO2",
      );
      const dayFraction = simulatedSeconds / 86_400;
      // Facility irrigation: intensity×power only (lights on → plants watered).
      const irrigationDemandKg =
        dayFraction *
        AGRICULTURE_IRRIGATION_KG_PER_DAY_AT_FULL_INTENSITY *
        bay.intensityFraction *
        conditionFraction *
        powerFactor;
      const irrigationKg = Math.min(
        irrigationDemandKg,
        remainingPotableWaterKgByRing[ring],
      );
      remainingPotableWaterKgByRing[ring] -= irrigationKg;
      // Growth water follows attempted growth; food is scaled by power×CO₂.
      const attemptedFoodKg =
        dayFraction *
        AGRICULTURE_FOOD_KG_PER_DAY_AT_FULL_INTENSITY *
        bay.intensityFraction *
        conditionFraction;
      const growthWaterKg = Math.min(
        attemptedFoodKg * AGRICULTURE_GROWTH_WATER_KG_PER_FOOD_KG,
        remainingPotableWaterKgByRing[ring],
      );
      const foodKg =
        (growthWaterKg / AGRICULTURE_GROWTH_WATER_KG_PER_FOOD_KG) *
        powerFactor *
        co2Factor;
      remainingPotableWaterKgByRing[ring] -= growthWaterKg;
      const waterKg = irrigationKg + growthWaterKg;
      bay.cumulativeFoodProducedKg += foodKg;
      bay.cumulativeWaterConsumedKg += waterKg;
      producedFoodKg += foodKg;
      waterByRing[ring] += waterKg;
      irrigationByRing[ring] += irrigationKg;
    }
    if (producedFoodKg > 0 || waterByRing.a > 0 || waterByRing.b > 0) {
      effects.push({
        type: "food-produced",
        foodKg: producedFoodKg,
        waterConsumedKgByRing: waterByRing,
        irrigationWaterKgByRing: irrigationByRing,
      });
    }

    const remoteAssetServiceFraction = input.remoteAssetServiceFraction ?? 1;
    assertFraction(
      remoteAssetServiceFraction,
      "remote asset support service fraction",
    );
    for (const asset of this.stateValue.remoteAssets) {
      if (asset.status === "stowed") {
        asset.energyStoredKWh = Math.min(
          asset.energyCapacityKWh,
          asset.energyStoredKWh +
            asset.rechargePowerKw *
              remoteAssetServiceFraction *
              (simulatedSeconds / 3_600),
        );
        continue;
      }
      if (asset.status !== "deployed") continue;
      const demandedEnergyKWh =
        asset.deployedPowerKw * (simulatedSeconds / 3_600);
      asset.energyStoredKWh = Math.max(
        0,
        asset.energyStoredKWh - demandedEnergyKWh,
      );
      if (asset.energyStoredKWh <= 1e-9) {
        asset.status = "lost";
        asset.telemetry.push(
          `${(targetMicroseconds / MICROSECONDS_PER_SECOND).toFixed(0)}s：能源耗尽，遥测丢失。`,
        );
        continue;
      }
      const lastTelemetry =
        asset.lastTelemetryAtMicroseconds ??
        asset.deployedAtMicroseconds ??
        this.stateValue.elapsedMicroseconds;
      if (targetMicroseconds - lastTelemetry >= 3_600 * MICROSECONDS_PER_SECOND) {
        asset.lastTelemetryAtMicroseconds = targetMicroseconds;
        asset.telemetry.push(
          `${(targetMicroseconds / MICROSECONDS_PER_SECOND).toFixed(0)}s：${asset.target ?? "待定目标"} 遥测正常，能源 ${asset.energyStoredKWh.toFixed(2)}/${asset.energyCapacityKWh.toFixed(2)} kWh。`,
        );
      }
      if (asset.telemetry.length > 32) {
        asset.telemetry.splice(0, asset.telemetry.length - 32);
      }
    }

    this.stateValue.elapsedMicroseconds = targetMicroseconds;
    if (simulatedSeconds > 0) this.bumpRevision();
    validateSnapshot(this.stateValue, this.zoneIds, this.loadIds);
    return { effects, reports, deliveredCommunications };
  }

  snapshot(): CaptainOperationsSnapshot {
    return cloneData(this.stateValue);
  }

  static restore(input: {
    snapshot: unknown;
    zoneIds: readonly ZoneId[];
    electricalLoadIds: readonly ElectricalLoadId[];
  }): CaptainOperations {
    const snapshot = migrateCaptainOperationsSnapshot(input.snapshot);
    return new CaptainOperations({
      origin: snapshot.mission.originalOrigin,
      destination: snapshot.mission.originalDestination,
      objective: snapshot.mission.objective,
      zoneIds: input.zoneIds,
      electricalLoadIds: input.electricalLoadIds,
      snapshot,
    });
  }

  private nextId(prefix: string): string {
    const id = `${prefix}:${String(this.stateValue.nextSequence).padStart(6, "0")}`;
    this.stateValue.nextSequence += 1;
    return id;
  }

  private bumpRevision(): void {
    this.stateValue.revision += 1;
  }

  private requireDepartmentOrder(orderId: string): DepartmentOrder {
    const order = this.stateValue.departmentOrders.find((item) => item.id === orderId);
    if (!order) throw new Error(`unknown department order ${orderId}`);
    return order;
  }

  private requireSecurityCase(caseId: string): SecurityCase {
    const securityCase = this.stateValue.securityCases.find((item) => item.id === caseId);
    if (!securityCase) throw new Error(`unknown security case ${caseId}`);
    return securityCase;
  }

  private requireTask(taskId: string): OperationsTask {
    const task = this.stateValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`unknown operations task ${taskId}`);
    return task;
  }

  private makeOrderReport(
    order: DepartmentOrder,
    prefix: string,
    atMicroseconds = this.stateValue.elapsedMicroseconds,
    completedWorkSeconds = order.completedWorkSeconds,
    status = order.status,
  ): DepartmentOrder["reports"][number] {
    const progressFraction =
      order.estimatedWorkSeconds === 0
        ? 1
        : completedWorkSeconds / order.estimatedWorkSeconds;
    return {
      atMicroseconds,
      status,
      progressFraction,
      summary: `${prefix}：${order.title}，进度 ${(progressFraction * 100).toFixed(1)}%，状态 ${status}。`,
    };
  }

  private trimHistory<T>(items: T[]): void {
    if (items.length > MAX_HISTORY) items.splice(0, items.length - MAX_HISTORY);
  }

  private trimGrievanceQueue(): void {
    while (this.stateValue.grievances.length > MAX_GRIEVANCES) {
      const closedIndex = this.stateValue.grievances.findIndex(
        (item) => item.status === "answered" || item.status === "closed",
      );
      if (closedIndex >= 0) {
        this.stateValue.grievances.splice(closedIndex, 1);
      } else {
        this.stateValue.grievances.shift();
      }
    }
  }
}
