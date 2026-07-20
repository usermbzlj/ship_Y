/**
 * Deterministic individual-passenger vertical slice.
 *
 * This module deliberately has no wall-clock, network, UI, or model-provider
 * dependency. The manifest is closed after generation: there is no API for
 * adding people or promoting additional people to key-LLM status at runtime.
 */

export const PASSENGER_SNAPSHOT_VERSION = 2 as const;
export const PASSENGER_COUNT = 2_000 as const;
export const CREW_COUNT = 120 as const;
export const PERSON_COUNT = 2_120 as const;
export const HIBERNATION_POD_CAPACITY = 2_200 as const;
export const DEFAULT_KEY_LLM_COUNT = 32 as const;
export const HIBERNATION_LOCAL_RIDE_THROUGH_SECONDS =
  15 * 60;

const MICROSECONDS_PER_SECOND = 1_000_000;

export type PassengerKind = "passenger" | "crew";
export type PassengerLifeState = "awake" | "hibernating" | "deceased";
export type HibernationAction = "hibernate" | "wake";
export type HibernationPowerBankId = "a" | "b";
export type HibernationPhase =
  | "scheduled"
  | "induction"
  | "waking"
  | "recovery";

export type ExperienceDimension =
  | "safety"
  | "comfort"
  | "freedom"
  | "fairness"
  | "trust"
  | "transparency"
  | "hibernation";

export interface PassengerSkill {
  id: string;
  proficiency: number;
}

export interface PassengerHealth {
  physical: number;
  resilience: number;
  chronicRisk: number;
}

export interface PassengerPsychology {
  stability: number;
  stress: number;
  sociability: number;
}

export interface PassengerExperience {
  safety: number;
  comfort: number;
  freedom: number;
  fairness: number;
  trust: number;
  transparency: number;
  hibernation: number;
}

export interface PassengerIncidentHealthImpact {
  physical?: number;
  resilience?: number;
  chronicRisk?: number;
}

export interface PassengerIncidentPsychologyImpact {
  stability?: number;
  stress?: number;
  sociability?: number;
}

export interface PassengerIncidentMemoryAudit {
  eventId: string;
  healthImpact: PassengerIncidentHealthImpact;
  psychologyImpact: PassengerIncidentPsychologyImpact;
  fatalRequested: boolean;
  causedDeath: boolean;
}

export interface PassengerEventMemory {
  id: string;
  atMicroseconds: number;
  eventType: string;
  summary: string;
  valence: number;
  salience: number;
  confidence: number;
  experienceImpact: Partial<Record<ExperienceDimension, number>>;
  incident?: PassengerIncidentMemoryAudit;
}

export interface Passenger {
  id: string;
  kind: PassengerKind;
  name: string;
  ageYears: number;
  cabinId: string;
  occupation: string;
  skills: PassengerSkill[];
  lifeState: PassengerLifeState;
  health: PassengerHealth;
  psychology: PassengerPsychology;
  familyId: string;
  relationshipIds: string[];
  memories: PassengerEventMemory[];
  experience: PassengerExperience;
  hibernationPodId: string | null;
  isKeyLlm: boolean;
  keyLlmSlot: number | null;
}

export interface HibernationDurations {
  inductionSeconds: number;
  wakingSeconds: number;
  recoverySeconds: number;
}

export interface HibernationTransition {
  id: string;
  sequence: number;
  passengerId: string;
  action: HibernationAction;
  phase: HibernationPhase;
  requestedAtMicroseconds: number;
  scheduledStartMicroseconds: number;
  phaseStartedAtMicroseconds: number;
  phaseEndsAtMicroseconds: number;
  podId: string;
  durations: HibernationDurations;
}

export interface ScheduleHibernationInput {
  passengerId: string;
  action: HibernationAction;
  startAtMicroseconds: number;
  podId?: string;
  durations?: Partial<HibernationDurations>;
}

export interface HibernationAdvanceEvent {
  transitionId: string;
  passengerId: string;
  atMicroseconds: number;
  from: HibernationPhase;
  to: HibernationPhase | PassengerLifeState;
}

export interface PassengerAdvanceInterval {
  fromMicroseconds: number;
  toMicroseconds: number;
}

export interface PassengerAdvanceHooks {
  beforeAdvance?: (interval: PassengerAdvanceInterval) => void;
  hibernationServiceFraction?: (
    transition: Readonly<HibernationTransition>,
  ) => number;
  validateAfterAdvance?: boolean;
}

export interface HibernationPowerBankState {
  bankId: HibernationPowerBankId;
  reserveSeconds: number;
  unprotectedDoseSeconds: number;
  outageSequence: number;
  highestIncidentLevel: number;
  lastFeederServiceFraction: number;
}

export interface HibernationPowerIncidentThreshold {
  bankId: HibernationPowerBankId;
  outageSequence: number;
  level: number;
  unprotectedDoseSeconds: number;
}

export interface HibernationPowerAdvanceResult {
  effectiveServiceFractionByBank: Record<
    HibernationPowerBankId,
    number
  >;
  crossedIncidentThresholds: HibernationPowerIncidentThreshold[];
}

export interface RecordPassengerEventInput {
  eventType: string;
  summary: string;
  valence?: number;
  salience?: number;
  confidence?: number;
  experienceImpact?: Partial<Record<ExperienceDimension, number>>;
}

export interface ApplyPassengerIncidentInput {
  eventId: string;
  eventType?: string;
  summary: string;
  targetPassengerIds: string[];
  healthImpact?: PassengerIncidentHealthImpact;
  psychologyImpact?: PassengerIncidentPsychologyImpact;
  experienceImpact?: Partial<Record<ExperienceDimension, number>>;
  valence?: number;
  salience?: number;
  confidence?: number;
  fatal?: boolean;
}

export interface PassengerIncidentOutcome {
  passengerId: string;
  status: "applied" | "already-applied";
  memoryId: string;
  lifeState: PassengerLifeState;
  causedDeath: boolean;
  cancelledTransitionId: string | null;
  releasedPodId: string | null;
}

export interface PassengerIncidentApplication {
  eventId: string;
  outcomes: PassengerIncidentOutcome[];
}

export interface PassengerSimulationSnapshot {
  snapshotVersion: typeof PASSENGER_SNAPSHOT_VERSION;
  generationSeed: string;
  nowMicroseconds: number;
  podCapacity: number;
  keyLlmPassengerIds: string[];
  passengers: Passenger[];
  activeTransitions: HibernationTransition[];
  hibernationPowerBanks: HibernationPowerBankState[];
  nextTransitionSequence: number;
  nextMemorySequence: number;
}

export interface PassengerPopulationSummary {
  total: number;
  passengers: number;
  crew: number;
  awake: number;
  hibernating: number;
  deceased: number;
  averageHealth: number;
  averageMorale: number;
  activeHibernationTransitions: number;
  keyLlmPassengers: number;
}

const EXPERIENCE_DIMENSIONS: readonly ExperienceDimension[] = [
  "safety",
  "comfort",
  "freedom",
  "fairness",
  "trust",
  "transparency",
  "hibernation",
];

const HIBERNATION_POWER_BANK_IDS = [
  "a",
  "b",
] as const satisfies readonly HibernationPowerBankId[];
const HIBERNATION_POWER_INCIDENT_THRESHOLDS_SECONDS = [
  30 * 60,
  2 * 60 * 60,
  6 * 60 * 60,
  24 * 60 * 60,
] as const;
const HIBERNATION_RESERVE_RECHARGE_SECONDS_PER_SECOND = 0.25;

const INCIDENT_HEALTH_DIMENSIONS = [
  "physical",
  "resilience",
  "chronicRisk",
] as const satisfies readonly (keyof PassengerHealth)[];

const INCIDENT_PSYCHOLOGY_DIMENSIONS = [
  "stability",
  "stress",
  "sociability",
] as const satisfies readonly (keyof PassengerPsychology)[];

const DEFAULT_HIBERNATION_DURATIONS: HibernationDurations = {
  inductionSeconds: 45 * 60,
  wakingSeconds: 90 * 60,
  recoverySeconds: 4 * 60 * 60,
};

const GIVEN_NAMES = [
  "Aiko",
  "Amara",
  "An",
  "Arun",
  "Aya",
  "Camila",
  "Chen",
  "Dalia",
  "Diego",
  "Elena",
  "Emil",
  "Farah",
  "Hana",
  "Hugo",
  "Idris",
  "Ines",
  "Jian",
  "Jun",
  "Kaito",
  "Leila",
  "Lin",
  "Luca",
  "Mara",
  "Mateo",
  "Mei",
  "Nadia",
  "Noah",
  "Priya",
  "Ravi",
  "Sara",
  "Tomas",
  "Yuna",
] as const;

const FAMILY_NAMES = [
  "Adebayo",
  "Alvarez",
  "Bauer",
  "Bennett",
  "Chen",
  "Costa",
  "Dahl",
  "Das",
  "Dubois",
  "El-Sayed",
  "Fischer",
  "Garcia",
  "Gupta",
  "Haddad",
  "Ito",
  "Ivanov",
  "Johansson",
  "Khan",
  "Kim",
  "Kowalski",
  "Li",
  "Liu",
  "Martin",
  "Mensah",
  "Mori",
  "Nakamura",
  "Nguyen",
  "Novak",
  "Okafor",
  "Patel",
  "Rossi",
  "Santos",
  "Silva",
  "Singh",
  "Smith",
  "Sokolov",
  "Tanaka",
  "Wang",
  "Weber",
  "Williams",
  "Wu",
  "Xu",
  "Yamamoto",
  "Young",
  "Zhang",
] as const;

const CREW_OCCUPATIONS = [
  "航行官",
  "跃迁工程师",
  "聚变堆工程师",
  "热控工程师",
  "生命保障工程师",
  "休眠医学官",
  "急诊医师",
  "护理主管",
  "心理健康官",
  "结构工程师",
  "机器人平台主管",
  "电网调度员",
  "大气系统技师",
  "水循环技师",
  "通信官",
  "安保协调员",
  "物资平台主管",
  "食品系统工程师",
  "任务规划师",
  "乘客事务官",
] as const;

const PASSENGER_OCCUPATIONS = [
  "农业生态学家",
  "材料科学家",
  "教师",
  "建筑师",
  "机械技师",
  "软件工程师",
  "医生",
  "护士",
  "社会学家",
  "心理学家",
  "厨师",
  "音乐家",
  "地质学家",
  "气候学家",
  "电气工程师",
  "生物学家",
  "制造平台主管",
  "物流规划师",
  "儿童照护员",
  "公共管理员",
  "历史学家",
  "语言学家",
  "艺术家",
  "学生",
  "儿童乘客",
  "普通乘客",
] as const;

const OCCUPATION_SKILLS: Readonly<Record<string, readonly string[]>> = {
  航行官: ["orbital-navigation", "relativistic-routing", "sensor-fusion"],
  跃迁工程师: ["jump-drive", "field-calibration", "fault-isolation"],
  聚变堆工程师: ["fusion-reactor", "plasma-control", "radiation-safety"],
  热控工程师: ["thermal-control", "fluid-loops", "radiator-repair"],
  生命保障工程师: ["life-support", "atmosphere", "closed-loop-ecology"],
  休眠医学官: ["hibernation-medicine", "anesthesia", "cryobiology"],
  急诊医师: ["emergency-medicine", "surgery", "triage"],
  护理主管: ["critical-care", "clinical-logistics", "triage"],
  心理健康官: ["psychiatry", "conflict-deescalation", "counselling"],
  结构工程师: ["structural-analysis", "damage-control", "eva"],
  机器人平台主管: ["robotics", "teleoperation", "maintenance"],
  电网调度员: ["power-grid", "load-shedding", "electrical-repair"],
  大气系统技师: ["atmosphere", "fluid-loops", "hazard-response"],
  水循环技师: ["water-recycling", "chemistry", "maintenance"],
  通信官: ["communications", "network-operations", "cryptography"],
  安保协调员: ["security", "investigation", "conflict-deescalation"],
  物资平台主管: ["inventory", "logistics", "fabrication"],
  食品系统工程师: ["food-systems", "hydroponics", "nutrition"],
  任务规划师: ["mission-planning", "risk-analysis", "operations"],
  乘客事务官: ["mediation", "public-communication", "administration"],
  农业生态学家: ["hydroponics", "ecology", "food-systems"],
  材料科学家: ["materials", "laboratory", "fabrication"],
  教师: ["teaching", "child-development", "public-communication"],
  建筑师: ["habitat-design", "structures", "planning"],
  机械技师: ["maintenance", "fabrication", "damage-control"],
  软件工程师: ["software", "automation", "network-operations"],
  医生: ["medicine", "triage", "public-health"],
  护士: ["clinical-care", "triage", "public-health"],
  社会学家: ["social-research", "mediation", "governance"],
  心理学家: ["counselling", "behavioral-science", "mediation"],
  厨师: ["food-systems", "nutrition", "inventory"],
  音乐家: ["music", "community-care", "teaching"],
  地质学家: ["geology", "field-science", "laboratory"],
  气候学家: ["climate-science", "data-analysis", "ecology"],
  电气工程师: ["electrical-repair", "power-grid", "instrumentation"],
  生物学家: ["biology", "laboratory", "ecology"],
  制造平台主管: ["fabrication", "quality-control", "logistics"],
  物流规划师: ["logistics", "inventory", "planning"],
  儿童照护员: ["child-development", "first-aid", "teaching"],
  公共管理员: ["administration", "governance", "mediation"],
  历史学家: ["history", "teaching", "archives"],
  语言学家: ["languages", "teaching", "public-communication"],
  艺术家: ["visual-arts", "community-care", "fabrication"],
  学生: ["learning", "community-care", "first-aid"],
  儿童乘客: ["learning", "play", "community-care"],
  普通乘客: ["general-maintenance", "first-aid", "community-care"],
};

function formatId(prefix: string, index: number, digits = 4): string {
  return `${prefix}-${String(index).padStart(digits, "0")}`;
}

const FIXED_KEY_LLM_IDS = [
  ...Array.from({ length: 12 }, (_, index) => formatId("crew", index + 1)),
  ...Array.from({ length: 20 }, (_, index) =>
    formatId("passenger", index + 1),
  ),
];

export const DEFAULT_KEY_LLM_PASSENGER_IDS: readonly string[] = Object.freeze([
  ...FIXED_KEY_LLM_IDS,
]);

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

function assertUnitInterval(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be between zero and one`);
  }
}

function assertSignedUnitDelta(value: number, label: string): void {
  assertFinite(value, label);
  if (value < -1 || value > 1) {
    throw new RangeError(`${label} must be between -1 and 1`);
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} cannot be empty`);
  }
}

function assertMicroseconds(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface NormalizedPassengerIncidentInput {
  eventId: string;
  eventType: string;
  summary: string;
  targetPassengerIds: string[];
  healthImpact: PassengerIncidentHealthImpact;
  psychologyImpact: PassengerIncidentPsychologyImpact;
  experienceImpact: Partial<Record<ExperienceDimension, number>>;
  valence: number;
  salience: number;
  confidence: number;
  fatal: boolean;
}

function normalizeHealthImpact(
  impact: PassengerIncidentHealthImpact | undefined,
): PassengerIncidentHealthImpact {
  const normalized = impact ?? {};
  for (const [dimension, delta] of Object.entries(normalized)) {
    if (
      !INCIDENT_HEALTH_DIMENSIONS.includes(
        dimension as keyof PassengerHealth,
      )
    ) {
      throw new Error(`unknown incident health dimension: ${dimension}`);
    }
    assertSignedUnitDelta(delta, `healthImpact.${dimension}`);
  }
  return cloneData(normalized);
}

function normalizePsychologyImpact(
  impact: PassengerIncidentPsychologyImpact | undefined,
): PassengerIncidentPsychologyImpact {
  const normalized = impact ?? {};
  for (const [dimension, delta] of Object.entries(normalized)) {
    if (
      !INCIDENT_PSYCHOLOGY_DIMENSIONS.includes(
        dimension as keyof PassengerPsychology,
      )
    ) {
      throw new Error(`unknown incident psychology dimension: ${dimension}`);
    }
    assertSignedUnitDelta(delta, `psychologyImpact.${dimension}`);
  }
  return cloneData(normalized);
}

function normalizeExperienceImpact(
  impact: Partial<Record<ExperienceDimension, number>> | undefined,
): Partial<Record<ExperienceDimension, number>> {
  const normalized = impact ?? {};
  for (const [dimension, delta] of Object.entries(normalized)) {
    if (!EXPERIENCE_DIMENSIONS.includes(dimension as ExperienceDimension)) {
      throw new Error(`unknown experience dimension: ${dimension}`);
    }
    assertSignedUnitDelta(delta, `experienceImpact.${dimension}`);
  }
  return cloneData(normalized);
}

function normalizeIncidentInput(
  input: ApplyPassengerIncidentInput,
): NormalizedPassengerIncidentInput {
  assertNonEmpty(input.eventId, "eventId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input.eventId)) {
    throw new TypeError(
      "eventId must be a stable ASCII identifier of at most 128 characters",
    );
  }
  const eventType = input.eventType ?? "passenger-incident";
  assertNonEmpty(eventType, "eventType");
  assertNonEmpty(input.summary, "summary");
  if (!Array.isArray(input.targetPassengerIds)) {
    throw new TypeError("targetPassengerIds must be an array");
  }
  if (input.targetPassengerIds.length === 0) {
    throw new RangeError("incident must target at least one passenger");
  }
  const targetPassengerIds = [...input.targetPassengerIds].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const passengerId of targetPassengerIds) {
    assertNonEmpty(passengerId, "targetPassengerIds[]");
  }
  if (new Set(targetPassengerIds).size !== targetPassengerIds.length) {
    throw new Error("incident target passenger ids must be unique");
  }

  const valence = input.valence ?? 0;
  const salience = input.salience ?? 0.5;
  const confidence = input.confidence ?? 1;
  assertFinite(valence, "valence");
  if (valence < -1 || valence > 1) {
    throw new RangeError("valence must be between -1 and 1");
  }
  assertUnitInterval(salience, "salience");
  assertUnitInterval(confidence, "confidence");
  if (input.fatal !== undefined && typeof input.fatal !== "boolean") {
    throw new TypeError("fatal must be a boolean");
  }

  return {
    eventId: input.eventId,
    eventType,
    summary: input.summary,
    targetPassengerIds,
    healthImpact: normalizeHealthImpact(input.healthImpact),
    psychologyImpact: normalizePsychologyImpact(input.psychologyImpact),
    experienceImpact: normalizeExperienceImpact(input.experienceImpact),
    valence,
    salience,
    confidence,
    fatal: input.fatal ?? false,
  };
}

function incidentMemoryMatchesInput(
  memory: PassengerEventMemory,
  input: NormalizedPassengerIncidentInput,
): boolean {
  const audit = memory.incident;
  if (
    !audit ||
    memory.eventType !== input.eventType ||
    memory.summary !== input.summary ||
    memory.valence !== input.valence ||
    memory.salience !== input.salience ||
    memory.confidence !== input.confidence ||
    audit.fatalRequested !== input.fatal
  ) {
    return false;
  }
  for (const dimension of INCIDENT_HEALTH_DIMENSIONS) {
    if (audit.healthImpact[dimension] !== input.healthImpact[dimension]) {
      return false;
    }
  }
  for (const dimension of INCIDENT_PSYCHOLOGY_DIMENSIONS) {
    if (
      audit.psychologyImpact[dimension] !==
      input.psychologyImpact[dimension]
    ) {
      return false;
    }
  }
  return EXPERIENCE_DIMENSIONS.every(
    (dimension) =>
      memory.experienceImpact[dimension] ===
      input.experienceImpact[dimension],
  );
}

function secondsToMicroseconds(seconds: number, label: string): number {
  assertFinite(seconds, label);
  if (seconds <= 0) {
    throw new RangeError(`${label} must be greater than zero`);
  }
  const microseconds = Math.round(seconds * MICROSECONDS_PER_SECOND);
  assertMicroseconds(microseconds, label);
  return microseconds;
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

class ManifestRandom {
  private state: number;

  constructor(seed: string) {
    this.state = hashSeed(seed);
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  }

  integer(minimumInclusive: number, maximumExclusive: number): number {
    return Math.floor(
      minimumInclusive +
        (maximumExclusive - minimumInclusive) * this.next(),
    );
  }

  unitAround(center: number, radius: number): number {
    return clamp(center + (this.next() * 2 - 1) * radius, 0, 1);
  }
}

function makePodId(index: number): string {
  return formatId("POD", index);
}

function parsePodIndex(podId: string): number | null {
  const match = /^POD-(\d{4})$/.exec(podId);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

export function hibernationPowerBankForPodId(
  podId: string,
): HibernationPowerBankId {
  const podIndex = parsePodIndex(podId);
  if (
    podIndex === null ||
    podIndex < 1 ||
    podIndex > HIBERNATION_POD_CAPACITY
  ) {
    throw new Error(`invalid hibernation pod id: ${podId}`);
  }
  return podIndex % 2 === 1 ? "a" : "b";
}

function makeCabinId(kind: PassengerKind, index: number): string {
  const prefix = kind === "crew" ? "CREW" : "HAB";
  const deck = String(Math.floor((index - 1) / 100) + 1).padStart(2, "0");
  return `${prefix}-${deck}-${String(index).padStart(4, "0")}`;
}

function makeExperience(random: ManifestRandom): PassengerExperience {
  return {
    safety: random.unitAround(0.78, 0.12),
    comfort: random.unitAround(0.72, 0.14),
    freedom: random.unitAround(0.68, 0.15),
    fairness: random.unitAround(0.74, 0.13),
    trust: random.unitAround(0.76, 0.14),
    transparency: random.unitAround(0.67, 0.16),
    hibernation: random.unitAround(0.73, 0.15),
  };
}

function makeSkills(
  occupation: string,
  random: ManifestRandom,
): PassengerSkill[] {
  const skillIds = OCCUPATION_SKILLS[occupation] ?? [
    "general-maintenance",
    "first-aid",
  ];
  return skillIds.map((id, index) => ({
    id,
    proficiency: Number(
      clamp(0.55 + random.next() * 0.4 - index * 0.04, 0, 1).toFixed(4),
    ),
  }));
}

function createPerson(
  kind: PassengerKind,
  index: number,
  random: ManifestRandom,
  podCounter: { value: number },
  memoryCounter: { value: number },
): Passenger {
  const id = formatId(kind, index);
  const isAwake =
    kind === "crew" ? index <= 86 : index <= 132;
  const lifeState: PassengerLifeState = isAwake ? "awake" : "hibernating";
  const ageYears =
    kind === "crew"
      ? random.integer(26, 63)
      : random.integer(4, 80);
  const occupation =
    kind === "crew"
      ? CREW_OCCUPATIONS[(index - 1) % CREW_OCCUPATIONS.length]
      : ageYears < 12
        ? "儿童乘客"
        : ageYears < 18
          ? "学生"
          : PASSENGER_OCCUPATIONS[
              random.integer(0, PASSENGER_OCCUPATIONS.length)
            ];
  const givenName = GIVEN_NAMES[random.integer(0, GIVEN_NAMES.length)];
  const familyName =
    FAMILY_NAMES[
      (index + random.integer(0, FAMILY_NAMES.length)) %
        FAMILY_NAMES.length
    ];
  const middleInitial = String.fromCharCode(65 + ((index - 1) % 26));
  const keyLlmIndex = FIXED_KEY_LLM_IDS.indexOf(id);
  const memoryId = formatId("memory", memoryCounter.value, 6);
  memoryCounter.value += 1;

  let hibernationPodId: string | null = null;
  if (lifeState === "hibernating") {
    hibernationPodId = makePodId(podCounter.value);
    podCounter.value += 1;
  }

  return {
    id,
    kind,
    name: `${givenName} ${middleInitial}. ${familyName}`,
    ageYears,
    cabinId: makeCabinId(kind, index),
    occupation,
    skills: makeSkills(occupation, random),
    lifeState,
    health: {
      physical: random.unitAround(0.92, 0.08),
      resilience: random.unitAround(0.76, 0.18),
      chronicRisk: random.unitAround(ageYears / 180, 0.08),
    },
    psychology: {
      stability: random.unitAround(0.78, 0.16),
      stress: random.unitAround(0.24, 0.16),
      sociability: random.unitAround(0.62, 0.28),
    },
    familyId: "",
    relationshipIds: [],
    memories: [
      {
        id: memoryId,
        atMicroseconds: 0,
        eventType: "voyage-boarding",
        summary: "完成登舰、身份核验与航程安全说明。",
        valence: 0.35,
        salience: 0.55,
        confidence: 1,
        experienceImpact: {},
      },
    ],
    experience: makeExperience(random),
    hibernationPodId,
    isKeyLlm: keyLlmIndex >= 0,
    keyLlmSlot: keyLlmIndex >= 0 ? keyLlmIndex + 1 : null,
  };
}

function generateDefaultSnapshot(seed: number | string): PassengerSimulationSnapshot {
  const generationSeed = String(seed);
  const random = new ManifestRandom(generationSeed);
  const passengers: Passenger[] = [];
  const podCounter = { value: 1 };
  const memoryCounter = { value: 1 };

  for (let index = 1; index <= CREW_COUNT; index += 1) {
    passengers.push(
      createPerson("crew", index, random, podCounter, memoryCounter),
    );
  }
  for (let index = 1; index <= PASSENGER_COUNT; index += 1) {
    passengers.push(
      createPerson("passenger", index, random, podCounter, memoryCounter),
    );
  }

  for (let offset = 0; offset < passengers.length; offset += 4) {
    const family = passengers.slice(offset, offset + 4);
    const familyId = formatId("family", offset / 4 + 1);
    for (const person of family) {
      person.familyId = familyId;
      person.relationshipIds = family
        .filter((relative) => relative.id !== person.id)
        .map((relative) => relative.id);
    }
  }

  const snapshot: PassengerSimulationSnapshot = {
    snapshotVersion: PASSENGER_SNAPSHOT_VERSION,
    generationSeed,
    nowMicroseconds: 0,
    podCapacity: HIBERNATION_POD_CAPACITY,
    keyLlmPassengerIds: [...FIXED_KEY_LLM_IDS],
    passengers,
    activeTransitions: [],
    hibernationPowerBanks: HIBERNATION_POWER_BANK_IDS.map(
      (bankId) => ({
        bankId,
        reserveSeconds:
          HIBERNATION_LOCAL_RIDE_THROUGH_SECONDS,
        unprotectedDoseSeconds: 0,
        outageSequence: 0,
        highestIncidentLevel: 0,
        lastFeederServiceFraction: 1,
      }),
    ),
    nextTransitionSequence: 1,
    nextMemorySequence: memoryCounter.value,
  };
  validatePassengerSnapshot(snapshot);
  return snapshot;
}

function validateDurations(
  durations: HibernationDurations,
  label: string,
): void {
  secondsToMicroseconds(durations.inductionSeconds, `${label}.inductionSeconds`);
  secondsToMicroseconds(durations.wakingSeconds, `${label}.wakingSeconds`);
  secondsToMicroseconds(durations.recoverySeconds, `${label}.recoverySeconds`);
}

function validatePassengerScalarState(person: Passenger): void {
  assertNonEmpty(person.id, "passenger.id");
  assertNonEmpty(person.name, `${person.id}.name`);
  assertNonEmpty(person.cabinId, `${person.id}.cabinId`);
  assertNonEmpty(person.occupation, `${person.id}.occupation`);
  assertNonEmpty(person.familyId, `${person.id}.familyId`);
  if (
    person.kind !== "crew" &&
    person.kind !== "passenger"
  ) {
    throw new Error(`invalid kind for ${person.id}`);
  }
  if (
    person.lifeState !== "awake" &&
    person.lifeState !== "hibernating" &&
    person.lifeState !== "deceased"
  ) {
    throw new Error(`invalid life state for ${person.id}`);
  }
  if (
    !Number.isSafeInteger(person.ageYears) ||
    person.ageYears < 0 ||
    person.ageYears > 120
  ) {
    throw new RangeError(`${person.id}.ageYears is invalid`);
  }
  if (person.skills.length === 0) {
    throw new Error(`${person.id} must have at least one skill`);
  }
  const skillIds = new Set<string>();
  for (const skill of person.skills) {
    assertNonEmpty(skill.id, `${person.id}.skill.id`);
    assertUnitInterval(skill.proficiency, `${person.id}.${skill.id}`);
    if (skillIds.has(skill.id)) {
      throw new Error(`${person.id} has duplicate skill ${skill.id}`);
    }
    skillIds.add(skill.id);
  }
  assertUnitInterval(person.health.physical, `${person.id}.health.physical`);
  assertUnitInterval(person.health.resilience, `${person.id}.health.resilience`);
  assertUnitInterval(person.health.chronicRisk, `${person.id}.health.chronicRisk`);
  assertUnitInterval(
    person.psychology.stability,
    `${person.id}.psychology.stability`,
  );
  assertUnitInterval(person.psychology.stress, `${person.id}.psychology.stress`);
  assertUnitInterval(
    person.psychology.sociability,
    `${person.id}.psychology.sociability`,
  );
  for (const dimension of EXPERIENCE_DIMENSIONS) {
    assertUnitInterval(
      person.experience[dimension],
      `${person.id}.experience.${dimension}`,
    );
  }
  if (person.isKeyLlm !== (person.keyLlmSlot !== null)) {
    throw new Error(`${person.id} has inconsistent key-LLM marker`);
  }
  if (
    person.keyLlmSlot !== null &&
    (!Number.isSafeInteger(person.keyLlmSlot) ||
      person.keyLlmSlot < 1 ||
      person.keyLlmSlot > DEFAULT_KEY_LLM_COUNT)
  ) {
    throw new Error(`${person.id} has invalid key-LLM slot`);
  }
}

export function validatePassengerSnapshot(
  snapshot: PassengerSimulationSnapshot,
): void {
  if (snapshot.snapshotVersion !== PASSENGER_SNAPSHOT_VERSION) {
    throw new Error("unsupported passenger snapshot version");
  }
  assertNonEmpty(snapshot.generationSeed, "generationSeed");
  assertMicroseconds(snapshot.nowMicroseconds, "nowMicroseconds");
  if (snapshot.podCapacity !== HIBERNATION_POD_CAPACITY) {
    throw new Error("hibernation pod capacity does not match the fixed manifest");
  }
  if (snapshot.passengers.length !== PERSON_COUNT) {
    throw new Error(`passenger manifest must contain exactly ${PERSON_COUNT} people`);
  }
  if (
    snapshot.keyLlmPassengerIds.length !== DEFAULT_KEY_LLM_COUNT ||
    snapshot.keyLlmPassengerIds.some(
      (id, index) => id !== FIXED_KEY_LLM_IDS[index],
    )
  ) {
    throw new Error("key-LLM manifest must match the fixed 32-person roster");
  }
  if (
    !Number.isSafeInteger(snapshot.nextTransitionSequence) ||
    snapshot.nextTransitionSequence < 1 ||
    !Number.isSafeInteger(snapshot.nextMemorySequence) ||
    snapshot.nextMemorySequence < 1
  ) {
    throw new Error("snapshot sequences are invalid");
  }
  if (
    snapshot.hibernationPowerBanks.length !==
      HIBERNATION_POWER_BANK_IDS.length ||
    snapshot.hibernationPowerBanks.some(
      (bank, index) =>
        bank.bankId !== HIBERNATION_POWER_BANK_IDS[index],
    )
  ) {
    throw new Error(
      "hibernation power state must contain fixed A/B banks",
    );
  }
  for (const bank of snapshot.hibernationPowerBanks) {
    assertFinite(
      bank.reserveSeconds,
      `hibernationPower.${bank.bankId}.reserveSeconds`,
    );
    assertFinite(
      bank.unprotectedDoseSeconds,
      `hibernationPower.${bank.bankId}.unprotectedDoseSeconds`,
    );
    assertUnitInterval(
      bank.lastFeederServiceFraction,
      `hibernationPower.${bank.bankId}.lastFeederServiceFraction`,
    );
    if (
      bank.reserveSeconds < 0 ||
      bank.reserveSeconds >
        HIBERNATION_LOCAL_RIDE_THROUGH_SECONDS
    ) {
      throw new RangeError(
        `hibernationPower.${bank.bankId}.reserveSeconds is invalid`,
      );
    }
    if (bank.unprotectedDoseSeconds < 0) {
      throw new RangeError(
        `hibernationPower.${bank.bankId}.unprotectedDoseSeconds cannot be negative`,
      );
    }
    if (
      !Number.isSafeInteger(bank.outageSequence) ||
      bank.outageSequence < 0 ||
      !Number.isSafeInteger(bank.highestIncidentLevel) ||
      bank.highestIncidentLevel < 0 ||
      bank.highestIncidentLevel >
        HIBERNATION_POWER_INCIDENT_THRESHOLDS_SECONDS.length
    ) {
      throw new Error(
        `hibernationPower.${bank.bankId} has invalid incident state`,
      );
    }
  }

  const byId = new Map<string, Passenger>();
  const cabinIds = new Set<string>();
  const occupiedPods = new Map<string, string>();
  const memoryIds = new Set<string>();
  let greatestMemorySequence = 0;
  let crewCount = 0;
  let passengerCount = 0;
  let keyLlmCount = 0;

  for (const person of snapshot.passengers) {
    validatePassengerScalarState(person);
    const idMatch = /^(crew|passenger)-(\d{4})$/.exec(person.id);
    const rosterIndex = idMatch ? Number(idMatch[2]) : 0;
    const rosterMaximum =
      person.kind === "crew" ? CREW_COUNT : PASSENGER_COUNT;
    if (
      !idMatch ||
      idMatch[1] !== person.kind ||
      rosterIndex < 1 ||
      rosterIndex > rosterMaximum
    ) {
      throw new Error(`${person.id} is not a stable manifest id`);
    }
    if (byId.has(person.id)) {
      throw new Error(`duplicate passenger id: ${person.id}`);
    }
    if (cabinIds.has(person.cabinId)) {
      throw new Error(`duplicate cabin assignment: ${person.cabinId}`);
    }
    byId.set(person.id, person);
    cabinIds.add(person.cabinId);
    crewCount += person.kind === "crew" ? 1 : 0;
    passengerCount += person.kind === "passenger" ? 1 : 0;
    keyLlmCount += person.isKeyLlm ? 1 : 0;

    if (person.lifeState === "hibernating" && person.hibernationPodId === null) {
      throw new Error(`${person.id} is hibernating without a pod`);
    }
    if (
      person.lifeState === "awake" &&
      person.hibernationPodId !== null
    ) {
      throw new Error(`${person.id} is awake while occupying a pod`);
    }
    if (person.hibernationPodId !== null) {
      const podIndex = parsePodIndex(person.hibernationPodId);
      if (
        podIndex === null ||
        podIndex < 1 ||
        podIndex > snapshot.podCapacity
      ) {
        throw new Error(`${person.id} has an invalid pod assignment`);
      }
      const occupant = occupiedPods.get(person.hibernationPodId);
      if (occupant) {
        throw new Error(
          `pod ${person.hibernationPodId} is occupied by ${occupant} and ${person.id}`,
        );
      }
      occupiedPods.set(person.hibernationPodId, person.id);
    }

    const incidentEventIds = new Set<string>();
    for (const memory of person.memories) {
      assertNonEmpty(memory.id, `${person.id}.memory.id`);
      assertNonEmpty(memory.eventType, `${memory.id}.eventType`);
      assertNonEmpty(memory.summary, `${memory.id}.summary`);
      assertMicroseconds(memory.atMicroseconds, `${memory.id}.atMicroseconds`);
      if (memory.atMicroseconds > snapshot.nowMicroseconds) {
        throw new Error(`${memory.id} occurs in the future`);
      }
      assertFinite(memory.valence, `${memory.id}.valence`);
      if (memory.valence < -1 || memory.valence > 1) {
        throw new RangeError(`${memory.id}.valence must be between -1 and 1`);
      }
      assertUnitInterval(memory.salience, `${memory.id}.salience`);
      assertUnitInterval(memory.confidence, `${memory.id}.confidence`);
      if (memoryIds.has(memory.id)) {
        throw new Error(`duplicate memory id: ${memory.id}`);
      }
      const memoryMatch = /^memory-(\d{6,})$/.exec(memory.id);
      if (!memoryMatch) {
        throw new Error(`${memory.id} is not a stable memory id`);
      }
      memoryIds.add(memory.id);
      greatestMemorySequence = Math.max(
        greatestMemorySequence,
        Number(memoryMatch[1]),
      );
      for (const [dimension, impact] of Object.entries(
        memory.experienceImpact,
      )) {
        if (!EXPERIENCE_DIMENSIONS.includes(dimension as ExperienceDimension)) {
          throw new Error(`${memory.id} has an unknown experience dimension`);
        }
        assertFinite(impact, `${memory.id}.${dimension}`);
      }
      if (memory.incident !== undefined) {
        const audit = memory.incident;
        assertNonEmpty(audit.eventId, `${memory.id}.incident.eventId`);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(audit.eventId)) {
          throw new Error(`${memory.id} has an invalid incident event id`);
        }
        if (incidentEventIds.has(audit.eventId)) {
          throw new Error(
            `${person.id} has duplicate incident event ${audit.eventId}`,
          );
        }
        incidentEventIds.add(audit.eventId);
        if (
          typeof audit.healthImpact !== "object" ||
          audit.healthImpact === null ||
          Array.isArray(audit.healthImpact) ||
          typeof audit.psychologyImpact !== "object" ||
          audit.psychologyImpact === null ||
          Array.isArray(audit.psychologyImpact)
        ) {
          throw new TypeError(`${memory.id} has malformed incident impacts`);
        }
        normalizeHealthImpact(audit.healthImpact);
        normalizePsychologyImpact(audit.psychologyImpact);
        if (
          typeof audit.fatalRequested !== "boolean" ||
          typeof audit.causedDeath !== "boolean"
        ) {
          throw new TypeError(`${memory.id} has invalid incident death flags`);
        }
        if (audit.fatalRequested && !audit.causedDeath) {
          throw new Error(`${memory.id} requested a fatality but caused none`);
        }
        if (
          audit.causedDeath &&
          (person.lifeState !== "deceased" ||
            person.health.physical !== 0 ||
            person.hibernationPodId !== null)
        ) {
          throw new Error(
            `${memory.id} death audit conflicts with current passenger state`,
          );
        }
      }
    }
  }

  if (crewCount !== CREW_COUNT || passengerCount !== PASSENGER_COUNT) {
    throw new Error("crew/passenger role counts do not match the fixed manifest");
  }
  if (snapshot.nextMemorySequence <= greatestMemorySequence) {
    throw new Error("next memory sequence must follow existing memories");
  }
  if (keyLlmCount !== DEFAULT_KEY_LLM_COUNT) {
    throw new Error("exactly 32 people must be marked as key LLMs");
  }
  for (let slot = 1; slot <= DEFAULT_KEY_LLM_COUNT; slot += 1) {
    const expectedId = FIXED_KEY_LLM_IDS[slot - 1];
    const person = byId.get(expectedId);
    if (!person?.isKeyLlm || person.keyLlmSlot !== slot) {
      throw new Error(`fixed key-LLM slot ${slot} must belong to ${expectedId}`);
    }
  }

  for (const person of snapshot.passengers) {
    const relationshipIds = new Set(person.relationshipIds);
    if (relationshipIds.size !== person.relationshipIds.length) {
      throw new Error(`${person.id} has duplicate relationship ids`);
    }
    if (relationshipIds.has(person.id)) {
      throw new Error(`${person.id} cannot relate to itself`);
    }
    for (const relatedId of relationshipIds) {
      const related = byId.get(relatedId);
      if (!related) {
        throw new Error(`${person.id} references missing person ${relatedId}`);
      }
      if (!related.relationshipIds.includes(person.id)) {
        throw new Error(`${person.id} and ${relatedId} relationship is not mutual`);
      }
      if (related.familyId !== person.familyId) {
        throw new Error(`${person.id} has a cross-family relationship in family list`);
      }
    }
  }

  const transitionPassengers = new Set<string>();
  const transitionIds = new Set<string>();
  const transitionSequences = new Set<number>();
  const reservedPods = new Map<string, string>();
  let greatestTransitionSequence = 0;
  for (const transition of snapshot.activeTransitions) {
    assertNonEmpty(transition.id, "transition.id");
    assertMicroseconds(
      transition.requestedAtMicroseconds,
      `${transition.id}.requestedAt`,
    );
    assertMicroseconds(
      transition.scheduledStartMicroseconds,
      `${transition.id}.scheduledStart`,
    );
    assertMicroseconds(
      transition.phaseStartedAtMicroseconds,
      `${transition.id}.phaseStartedAt`,
    );
    assertMicroseconds(
      transition.phaseEndsAtMicroseconds,
      `${transition.id}.phaseEndsAt`,
    );
    validateDurations(transition.durations, `${transition.id}.durations`);
    if (
      !Number.isSafeInteger(transition.sequence) ||
      transition.sequence < 1 ||
      transition.phaseEndsAtMicroseconds < snapshot.nowMicroseconds
    ) {
      throw new Error(`${transition.id} has invalid sequence or timing`);
    }
    if (
      transition.phase !== "scheduled" &&
      transition.phase !== "induction" &&
      transition.phase !== "waking" &&
      transition.phase !== "recovery"
    ) {
      throw new Error(`${transition.id} has an invalid phase`);
    }
    if (
      (transition.action === "hibernate" &&
        transition.phase !== "scheduled" &&
        transition.phase !== "induction") ||
      (transition.action === "wake" &&
        transition.phase !== "scheduled" &&
        transition.phase !== "waking" &&
        transition.phase !== "recovery")
    ) {
      throw new Error(`${transition.id} phase is impossible for its action`);
    }
    const person = byId.get(transition.passengerId);
    if (!person) {
      throw new Error(`${transition.id} references a missing passenger`);
    }
    if (
      (transition.action === "hibernate" && person.lifeState !== "awake") ||
      (transition.action === "wake" && person.lifeState !== "hibernating")
    ) {
      throw new Error(`${transition.id} contradicts passenger life state`);
    }
    const podIndex = parsePodIndex(transition.podId);
    if (
      podIndex === null ||
      podIndex < 1 ||
      podIndex > snapshot.podCapacity
    ) {
      throw new Error(`${transition.id} references an invalid pod`);
    }
    if (
      transition.action === "wake" &&
      person.hibernationPodId !== transition.podId
    ) {
      throw new Error(`${transition.id} wake pod does not match its occupant`);
    }
    if (transition.action === "hibernate") {
      const occupant = occupiedPods.get(transition.podId);
      const reserver = reservedPods.get(transition.podId);
      if (occupant || reserver) {
        throw new Error(`${transition.id} targets an unavailable pod`);
      }
      reservedPods.set(transition.podId, transition.passengerId);
    }
    if (transitionPassengers.has(transition.passengerId)) {
      throw new Error(`${transition.passengerId} has multiple active transitions`);
    }
    if (transitionIds.has(transition.id)) {
      throw new Error(`duplicate transition id: ${transition.id}`);
    }
    if (transitionSequences.has(transition.sequence)) {
      throw new Error(`duplicate transition sequence: ${transition.sequence}`);
    }
    transitionPassengers.add(transition.passengerId);
    transitionIds.add(transition.id);
    transitionSequences.add(transition.sequence);
    greatestTransitionSequence = Math.max(
      greatestTransitionSequence,
      transition.sequence,
    );
  }
  if (snapshot.nextTransitionSequence <= greatestTransitionSequence) {
    throw new Error("next transition sequence must follow active transitions");
  }
}

function qualitative(value: number): string {
  if (value >= 0.82) {
    return "非常正面";
  }
  if (value >= 0.67) {
    return "较为满意";
  }
  if (value >= 0.48) {
    return "感受复杂";
  }
  if (value >= 0.3) {
    return "明显不满";
  }
  return "强烈负面";
}

function averageJourneyExperience(person: Passenger): number {
  return (
    EXPERIENCE_DIMENSIONS.reduce(
      (total, dimension) => total + person.experience[dimension],
      0,
    ) / EXPERIENCE_DIMENSIONS.length
  );
}

function comparePassengerIds(left: Passenger, right: Passenger): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareExperienceAscending(
  left: Passenger,
  right: Passenger,
): number {
  return (
    averageJourneyExperience(left) - averageJourneyExperience(right) ||
    comparePassengerIds(left, right)
  );
}

function mostSignificantIncidentMemory(
  person: Passenger,
): PassengerEventMemory | undefined {
  return person.memories
    .filter((memory) => memory.incident !== undefined)
    .sort(
      (left, right) =>
        Number(right.incident?.causedDeath ?? false) -
          Number(left.incident?.causedDeath ?? false) ||
        right.salience - left.salience ||
        Math.abs(right.valence) - Math.abs(left.valence) ||
        right.atMicroseconds - left.atMicroseconds ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )[0];
}

function compareIncidentSignificance(
  left: Passenger,
  right: Passenger,
): number {
  const leftMemory = mostSignificantIncidentMemory(left);
  const rightMemory = mostSignificantIncidentMemory(right);
  if (!leftMemory) {
    return rightMemory ? 1 : comparePassengerIds(left, right);
  }
  if (!rightMemory) {
    return -1;
  }
  return (
    Number(rightMemory.incident?.causedDeath ?? false) -
      Number(leftMemory.incident?.causedDeath ?? false) ||
    rightMemory.salience - leftMemory.salience ||
    Math.abs(rightMemory.valence) - Math.abs(leftMemory.valence) ||
    rightMemory.atMicroseconds - leftMemory.atMicroseconds ||
    comparePassengerIds(left, right)
  );
}

function interleaveExperienceExtremes(
  people: readonly Passenger[],
): Passenger[] {
  const ordered = [...people].sort(compareExperienceAscending);
  const interleaved: Passenger[] = [];
  let lower = 0;
  let upper = ordered.length - 1;
  while (lower <= upper) {
    interleaved.push(ordered[lower]);
    lower += 1;
    if (lower <= upper) {
      interleaved.push(ordered[upper]);
      upper -= 1;
    }
  }
  return interleaved;
}

export class PassengerSimulation {
  private generationSeedValue: string;
  private nowMicrosecondsValue: number;
  private passengersValue: Passenger[];
  private activeTransitionsValue: HibernationTransition[];
  private hibernationPowerBanksValue: HibernationPowerBankState[];
  private nextTransitionSequenceValue: number;
  private nextMemorySequenceValue: number;

  constructor(
    seed: number | string = "civilian-voyage-v1",
    restoredSnapshot?: PassengerSimulationSnapshot,
  ) {
    const snapshot = restoredSnapshot ?? generateDefaultSnapshot(seed);
    validatePassengerSnapshot(snapshot);
    this.generationSeedValue = snapshot.generationSeed;
    this.nowMicrosecondsValue = snapshot.nowMicroseconds;
    this.passengersValue = cloneData(snapshot.passengers);
    this.activeTransitionsValue = cloneData(snapshot.activeTransitions);
    this.hibernationPowerBanksValue = cloneData(
      snapshot.hibernationPowerBanks,
    );
    this.nextTransitionSequenceValue = snapshot.nextTransitionSequence;
    this.nextMemorySequenceValue = snapshot.nextMemorySequence;
  }

  get nowMicroseconds(): number {
    return this.nowMicrosecondsValue;
  }

  get personCount(): number {
    return this.passengersValue.length;
  }

  getAllPassengers(): Passenger[] {
    return cloneData(this.passengersValue);
  }

  getAwakeCabinIds(): string[] {
    return this.passengersValue
      .filter((person) => person.lifeState === "awake")
      .map((person) => person.cabinId);
  }

  getPassenger(passengerId: string): Passenger {
    return cloneData(this.requirePassenger(passengerId));
  }

  getKeyLlmPassengers(): Passenger[] {
    return cloneData(
      this.passengersValue
        .filter((person) => person.isKeyLlm)
        .sort((left, right) => (left.keyLlmSlot ?? 0) - (right.keyLlmSlot ?? 0)),
    );
  }

  getPopulationSummary(): PassengerPopulationSummary {
    const summary: PassengerPopulationSummary = {
      total: this.passengersValue.length,
      passengers: 0,
      crew: 0,
      awake: 0,
      hibernating: 0,
      deceased: 0,
      averageHealth: 0,
      averageMorale: 0,
      activeHibernationTransitions: this.activeTransitionsValue.length,
      keyLlmPassengers: 0,
    };
    let livingCount = 0;
    for (const person of this.passengersValue) {
      summary[person.kind === "crew" ? "crew" : "passengers"] += 1;
      summary[person.lifeState] += 1;
      if (person.lifeState !== "deceased") {
        livingCount += 1;
        summary.averageHealth += person.health.physical;
        summary.averageMorale += person.psychology.stability;
      }
      if (person.isKeyLlm) {
        summary.keyLlmPassengers += 1;
      }
    }
    if (livingCount > 0) {
      summary.averageHealth /= livingCount;
      summary.averageMorale /= livingCount;
    }
    return summary;
  }

  /**
   * Selects a small, deterministic cross-section for end-of-journey reports.
   *
   * With the default six-person sample, the anchors cover the low and high
   * experience ends of both crew and passenger populations, plus the person
   * carrying the most significant audited incident memory. Remaining slots
   * use stable, experience-extreme interleaving rather than key-LLM order.
   */
  getJourneyRepresentativePassengers(limit = 6): Passenger[] {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError("representative passenger limit must be a non-negative integer");
    }
    const targetCount = Math.min(limit, this.passengersValue.length);
    if (targetCount === 0) {
      return [];
    }

    const byKind = {
      crew: this.passengersValue
        .filter((person) => person.kind === "crew")
        .sort(compareExperienceAscending),
      passenger: this.passengersValue
        .filter((person) => person.kind === "passenger")
        .sort(compareExperienceAscending),
    };
    const incidentRepresentatives = this.passengersValue
      .filter((person) =>
        person.memories.some((memory) => memory.incident !== undefined),
      )
      .sort(compareIncidentSignificance);
    const selected: Passenger[] = [];
    const selectedIds = new Set<string>();
    const select = (person: Passenger | undefined): void => {
      if (
        person &&
        selected.length < targetCount &&
        !selectedIds.has(person.id)
      ) {
        selected.push(person);
        selectedIds.add(person.id);
      }
    };

    select(incidentRepresentatives[0]);
    select(byKind.crew[0]);
    select(byKind.crew.at(-1));
    select(byKind.passenger[0]);
    select(byKind.passenger.at(-1));

    const crewFallback = interleaveExperienceExtremes(byKind.crew);
    const passengerFallback = interleaveExperienceExtremes(byKind.passenger);
    const fallbackDepth = Math.max(
      incidentRepresentatives.length,
      crewFallback.length,
      passengerFallback.length,
    );
    for (
      let index = 0;
      index < fallbackDepth && selected.length < targetCount;
      index += 1
    ) {
      select(incidentRepresentatives[index]);
      select(crewFallback[index]);
      select(passengerFallback[index]);
    }

    return cloneData(selected);
  }

  getActiveTransitions(): HibernationTransition[] {
    return cloneData(this.activeTransitionsValue);
  }

  getHibernationPowerBanks(): HibernationPowerBankState[] {
    return cloneData(this.hibernationPowerBanksValue);
  }

  getHibernatingPassengerIdsForPowerBank(
    bankId: HibernationPowerBankId,
  ): string[] {
    if (!HIBERNATION_POWER_BANK_IDS.includes(bankId)) {
      throw new Error(`unknown hibernation power bank: ${bankId}`);
    }
    return this.passengersValue
      .filter(
        (person) =>
          person.lifeState === "hibernating" &&
          person.hibernationPodId !== null &&
          hibernationPowerBankForPodId(
            person.hibernationPodId,
          ) === bankId,
      )
      .map((person) => person.id)
      .sort();
  }

  advanceHibernationPower(
    simulatedSeconds: number,
    feederServiceFractionByBank: Readonly<
      Record<HibernationPowerBankId, number>
    >,
    validateAfterAdvance = true,
  ): HibernationPowerAdvanceResult {
    assertFinite(simulatedSeconds, "simulatedSeconds");
    if (simulatedSeconds < 0) {
      throw new RangeError("simulatedSeconds cannot be negative");
    }
    const next = cloneData(this.hibernationPowerBanksValue);
    const effectiveServiceFractionByBank = {
      a: 1,
      b: 1,
    } satisfies Record<HibernationPowerBankId, number>;
    const crossedIncidentThresholds: HibernationPowerIncidentThreshold[] =
      [];

    for (const bank of next) {
      const feederServiceFraction =
        feederServiceFractionByBank[bank.bankId];
      assertUnitInterval(
        feederServiceFraction,
        `feederServiceFraction.${bank.bankId}`,
      );
      bank.lastFeederServiceFraction =
        feederServiceFraction;
      const requestedRideThroughSeconds =
        simulatedSeconds * (1 - feederServiceFraction);
      const suppliedRideThroughSeconds = Math.min(
        bank.reserveSeconds,
        requestedRideThroughSeconds,
      );
      bank.reserveSeconds -= suppliedRideThroughSeconds;
      effectiveServiceFractionByBank[bank.bankId] =
        simulatedSeconds === 0
          ? feederServiceFraction
          : Math.min(
              1,
              feederServiceFraction +
                suppliedRideThroughSeconds / simulatedSeconds,
            );

      const uncoveredSeconds = Math.max(
        0,
        requestedRideThroughSeconds -
          suppliedRideThroughSeconds,
      );
      if (uncoveredSeconds > 0) {
        if (bank.unprotectedDoseSeconds === 0) {
          bank.outageSequence += 1;
          bank.highestIncidentLevel = 0;
        }
        bank.unprotectedDoseSeconds += uncoveredSeconds;
        HIBERNATION_POWER_INCIDENT_THRESHOLDS_SECONDS.forEach(
          (thresholdSeconds, index) => {
            const level = index + 1;
            if (
              bank.highestIncidentLevel < level &&
              bank.unprotectedDoseSeconds >= thresholdSeconds
            ) {
              bank.highestIncidentLevel = level;
              crossedIncidentThresholds.push({
                bankId: bank.bankId,
                outageSequence: bank.outageSequence,
                level,
                unprotectedDoseSeconds:
                  bank.unprotectedDoseSeconds,
              });
            }
          },
        );
      } else if (feederServiceFraction === 1) {
        bank.reserveSeconds = Math.min(
          HIBERNATION_LOCAL_RIDE_THROUGH_SECONDS,
          bank.reserveSeconds +
            simulatedSeconds *
              HIBERNATION_RESERVE_RECHARGE_SECONDS_PER_SECOND,
        );
        if (
          bank.reserveSeconds ===
          HIBERNATION_LOCAL_RIDE_THROUGH_SECONDS
        ) {
          bank.unprotectedDoseSeconds = 0;
          bank.highestIncidentLevel = 0;
        }
      }
    }

    this.hibernationPowerBanksValue = next;
    if (validateAfterAdvance) {
      this.validateCurrentSnapshot();
    }
    return {
      effectiveServiceFractionByBank,
      crossedIncidentThresholds,
    };
  }

  getAvailablePodIds(
    limit: number = HIBERNATION_POD_CAPACITY,
  ): string[] {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError("pod result limit must be a non-negative integer");
    }
    const unavailable = new Set<string>();
    for (const person of this.passengersValue) {
      if (person.hibernationPodId) {
        unavailable.add(person.hibernationPodId);
      }
    }
    for (const transition of this.activeTransitionsValue) {
      unavailable.add(transition.podId);
    }
    const available: string[] = [];
    for (
      let index = 1;
      index <= HIBERNATION_POD_CAPACITY && available.length < limit;
      index += 1
    ) {
      const podId = makePodId(index);
      if (!unavailable.has(podId)) {
        available.push(podId);
      }
    }
    return available;
  }

  scheduleHibernationTransition(
    input: ScheduleHibernationInput,
  ): HibernationTransition {
    assertMicroseconds(input.startAtMicroseconds, "startAtMicroseconds");
    if (input.startAtMicroseconds < this.nowMicrosecondsValue) {
      throw new RangeError("hibernation transition cannot start in the past");
    }
    const person = this.requirePassenger(input.passengerId);
    if (person.lifeState === "deceased") {
      throw new Error("deceased passengers cannot enter hibernation transitions");
    }
    if (
      this.activeTransitionsValue.some(
        (transition) => transition.passengerId === person.id,
      )
    ) {
      throw new Error(`${person.id} already has an active transition`);
    }
    if (
      (input.action === "hibernate" && person.lifeState !== "awake") ||
      (input.action === "wake" && person.lifeState !== "hibernating")
    ) {
      throw new Error(
        `${input.action} is incompatible with ${person.id} state ${person.lifeState}`,
      );
    }

    const durations: HibernationDurations = {
      ...DEFAULT_HIBERNATION_DURATIONS,
      ...input.durations,
    };
    validateDurations(durations, "durations");

    let podId: string;
    if (input.action === "wake") {
      if (!person.hibernationPodId) {
        throw new Error(`${person.id} has no occupied hibernation pod`);
      }
      if (input.podId && input.podId !== person.hibernationPodId) {
        throw new Error("wake request pod does not match passenger assignment");
      }
      podId = person.hibernationPodId;
    } else {
      if (!input.podId) {
        throw new Error("hibernate request must specify an available pod");
      }
      const podIndex = parsePodIndex(input.podId);
      if (
        podIndex === null ||
        podIndex < 1 ||
        podIndex > HIBERNATION_POD_CAPACITY
      ) {
        throw new Error("hibernate request references an invalid pod");
      }
      if (!this.getAvailablePodIds(HIBERNATION_POD_CAPACITY).includes(input.podId)) {
        throw new Error(`hibernation pod is unavailable: ${input.podId}`);
      }
      podId = input.podId;
    }

    const sequence = this.nextTransitionSequenceValue;
    this.nextTransitionSequenceValue += 1;
    const transition: HibernationTransition = {
      id: formatId("transition", sequence, 6),
      sequence,
      passengerId: person.id,
      action: input.action,
      phase: "scheduled",
      requestedAtMicroseconds: this.nowMicrosecondsValue,
      scheduledStartMicroseconds: input.startAtMicroseconds,
      phaseStartedAtMicroseconds: this.nowMicrosecondsValue,
      phaseEndsAtMicroseconds: input.startAtMicroseconds,
      podId,
      durations,
    };
    this.activeTransitionsValue.push(transition);
    this.validateCurrentSnapshot();
    return cloneData(transition);
  }

  advanceBySeconds(seconds: number): HibernationAdvanceEvent[] {
    assertFinite(seconds, "seconds");
    if (seconds < 0) {
      throw new RangeError("time cannot move backwards");
    }
    const duration = Math.round(seconds * MICROSECONDS_PER_SECOND);
    assertMicroseconds(duration, "duration");
    return this.advanceTo(this.nowMicrosecondsValue + duration);
  }

  advanceTo(
    targetMicroseconds: number,
    hooks: PassengerAdvanceHooks = {},
  ): HibernationAdvanceEvent[] {
    assertMicroseconds(targetMicroseconds, "targetMicroseconds");
    if (targetMicroseconds < this.nowMicrosecondsValue) {
      throw new RangeError("passenger simulation cannot move backwards");
    }
    const events: HibernationAdvanceEvent[] = [];

    while (true) {
      const nextBoundary = this.activeTransitionsValue.reduce<
        number | undefined
      >((earliest, transition) => {
        const completionMicroseconds =
          this.transitionCompletionMicroseconds(
            transition,
            hooks,
          );
        if (
          completionMicroseconds === undefined ||
          completionMicroseconds > targetMicroseconds
        ) {
          return earliest;
        }
        if (
          earliest === undefined ||
          completionMicroseconds < earliest
        ) {
          return completionMicroseconds;
        }
        return earliest;
      }, undefined);
      if (nextBoundary === undefined) {
        break;
      }

      const intervalStartMicroseconds =
        this.nowMicrosecondsValue;
      if (nextBoundary > this.nowMicrosecondsValue) {
        hooks.beforeAdvance?.({
          fromMicroseconds: this.nowMicrosecondsValue,
          toMicroseconds: nextBoundary,
        });
      }
      this.progressPoweredTransitions(
        intervalStartMicroseconds,
        nextBoundary,
        hooks,
      );
      this.nowMicrosecondsValue = nextBoundary;
      const due = this.activeTransitionsValue
        .filter(
          (transition) =>
            transition.phaseEndsAtMicroseconds ===
            this.nowMicrosecondsValue,
        )
        .sort((left, right) => left.sequence - right.sequence);
      for (const transition of due) {
        events.push(this.advanceTransition(transition));
      }
    }

    if (targetMicroseconds > this.nowMicrosecondsValue) {
      const intervalStartMicroseconds =
        this.nowMicrosecondsValue;
      hooks.beforeAdvance?.({
        fromMicroseconds: this.nowMicrosecondsValue,
        toMicroseconds: targetMicroseconds,
      });
      this.progressPoweredTransitions(
        intervalStartMicroseconds,
        targetMicroseconds,
        hooks,
      );
    }
    this.nowMicrosecondsValue = targetMicroseconds;
    if (hooks.validateAfterAdvance !== false) {
      this.validateCurrentSnapshot();
    }
    return cloneData(events);
  }

  validateState(): void {
    this.validateCurrentSnapshot();
  }

  private transitionServiceFraction(
    transition: HibernationTransition,
    hooks: PassengerAdvanceHooks,
  ): number {
    if (transition.phase === "scheduled") {
      return 1;
    }
    const serviceFraction =
      hooks.hibernationServiceFraction?.(cloneData(transition)) ??
      1;
    if (
      !Number.isFinite(serviceFraction) ||
      serviceFraction < 0 ||
      serviceFraction > 1
    ) {
      throw new RangeError(
        `hibernation service for ${transition.id} must be between 0 and 1`,
      );
    }
    return serviceFraction;
  }

  private transitionCompletionMicroseconds(
    transition: HibernationTransition,
    hooks: PassengerAdvanceHooks,
  ): number | undefined {
    if (transition.phase === "scheduled") {
      return transition.phaseEndsAtMicroseconds;
    }
    const remainingPoweredMicroseconds =
      transition.phaseEndsAtMicroseconds -
      this.nowMicrosecondsValue;
    if (remainingPoweredMicroseconds <= 0) {
      return this.nowMicrosecondsValue;
    }
    const serviceFraction = this.transitionServiceFraction(
      transition,
      hooks,
    );
    if (serviceFraction === 0) {
      return undefined;
    }
    return (
      this.nowMicrosecondsValue +
      Math.ceil(
        remainingPoweredMicroseconds / serviceFraction,
      )
    );
  }

  private progressPoweredTransitions(
    fromMicroseconds: number,
    toMicroseconds: number,
    hooks: PassengerAdvanceHooks,
  ): void {
    const elapsedMicroseconds =
      toMicroseconds - fromMicroseconds;
    if (elapsedMicroseconds <= 0) return;
    for (const transition of this.activeTransitionsValue) {
      if (transition.phase === "scheduled") continue;
      const remainingPoweredMicroseconds = Math.max(
        0,
        transition.phaseEndsAtMicroseconds -
          fromMicroseconds,
      );
      const serviceFraction = this.transitionServiceFraction(
        transition,
        hooks,
      );
      const servedMicroseconds =
        serviceFraction === 1
          ? elapsedMicroseconds
          : Math.round(
              elapsedMicroseconds * serviceFraction,
            );
      const remainingAfterService = Math.max(
        0,
        remainingPoweredMicroseconds - servedMicroseconds,
      );
      transition.phaseEndsAtMicroseconds =
        toMicroseconds + remainingAfterService;
    }
  }

  private advanceTransition(
    transition: HibernationTransition,
  ): HibernationAdvanceEvent {
    const person = this.requirePassenger(transition.passengerId);
    const from = transition.phase;
    let to: HibernationPhase | PassengerLifeState;

    if (transition.phase === "scheduled") {
      transition.phase = transition.action === "hibernate" ? "induction" : "waking";
      transition.phaseStartedAtMicroseconds = this.nowMicrosecondsValue;
      const durationSeconds =
        transition.action === "hibernate"
          ? transition.durations.inductionSeconds
          : transition.durations.wakingSeconds;
      transition.phaseEndsAtMicroseconds =
        this.nowMicrosecondsValue +
        secondsToMicroseconds(durationSeconds, "transition phase duration");
      to = transition.phase;
    } else if (transition.phase === "induction") {
      person.lifeState = "hibernating";
      person.hibernationPodId = transition.podId;
      this.removeTransition(transition.id);
      this.appendMemory(person, {
        eventType: "hibernation-induction-complete",
        summary: `在 ${transition.podId} 完成休眠诱导并进入稳定休眠。`,
        valence: 0.15,
        salience: 0.72,
        confidence: 1,
        experienceImpact: { hibernation: 0.01, safety: 0.005 },
      });
      to = "hibernating";
    } else if (transition.phase === "waking") {
      transition.phase = "recovery";
      transition.phaseStartedAtMicroseconds = this.nowMicrosecondsValue;
      transition.phaseEndsAtMicroseconds =
        this.nowMicrosecondsValue +
        secondsToMicroseconds(
          transition.durations.recoverySeconds,
          "recovery duration",
        );
      to = "recovery";
    } else {
      person.lifeState = "awake";
      person.hibernationPodId = null;
      this.removeTransition(transition.id);
      this.appendMemory(person, {
        eventType: "hibernation-recovery-complete",
        summary: `从 ${transition.podId} 唤醒并完成医学恢复观察。`,
        valence: 0.1,
        salience: 0.78,
        confidence: 1,
        experienceImpact: { hibernation: 0.015, safety: 0.005 },
      });
      to = "awake";
    }

    return {
      transitionId: transition.id,
      passengerId: transition.passengerId,
      atMicroseconds: this.nowMicrosecondsValue,
      from,
      to,
    };
  }

  recordPassengerEvent(
    passengerId: string,
    input: RecordPassengerEventInput,
  ): PassengerEventMemory {
    const person = this.requirePassenger(passengerId);
    const memory = this.appendMemory(person, input);
    this.validateCurrentSnapshot();
    return cloneData(memory);
  }

  /**
   * Applies one externally stable incident to a set of manifest people.
   *
   * The complete request is preflighted and then applied to a candidate
   * snapshot. No live state changes unless that candidate passes the same
   * validation as a save restore. Replaying the same eventId and payload for a
   * person returns "already-applied"; reusing it with a different payload is
   * rejected as an audit collision.
   */
  applyPassengerIncident(
    input: ApplyPassengerIncidentInput,
  ): PassengerIncidentApplication {
    const normalized = normalizeIncidentInput(input);
    const preflight = normalized.targetPassengerIds.map((passengerId) => {
      const person = this.requirePassenger(passengerId);
      const existingMemory = person.memories.find(
        (memory) => memory.incident?.eventId === normalized.eventId,
      );
      if (
        existingMemory &&
        !incidentMemoryMatchesInput(existingMemory, normalized)
      ) {
        throw new Error(
          `incident eventId collision for ${passengerId}: ${normalized.eventId}`,
        );
      }
      if (!existingMemory && person.lifeState === "deceased") {
        throw new Error(
          `cannot apply a new incident to deceased passenger ${passengerId}`,
        );
      }
      return { passengerId, existingMemory };
    });

    if (preflight.every(({ existingMemory }) => existingMemory !== undefined)) {
      return {
        eventId: normalized.eventId,
        outcomes: preflight.map(({ passengerId, existingMemory }) => ({
          passengerId,
          status: "already-applied",
          memoryId: existingMemory!.id,
          lifeState: this.requirePassenger(passengerId).lifeState,
          causedDeath: existingMemory!.incident!.causedDeath,
          cancelledTransitionId: null,
          releasedPodId: null,
        })),
      };
    }

    const candidate = this.snapshot();
    const candidateById = new Map(
      candidate.passengers.map((person) => [person.id, person]),
    );
    const outcomes: PassengerIncidentOutcome[] = [];

    for (const { passengerId, existingMemory } of preflight) {
      const person = candidateById.get(passengerId);
      if (!person) {
        throw new Error(`candidate snapshot lost passenger ${passengerId}`);
      }
      if (existingMemory) {
        outcomes.push({
          passengerId,
          status: "already-applied",
          memoryId: existingMemory.id,
          lifeState: person.lifeState,
          causedDeath: existingMemory.incident!.causedDeath,
          cancelledTransitionId: null,
          releasedPodId: null,
        });
        continue;
      }

      for (const dimension of INCIDENT_HEALTH_DIMENSIONS) {
        const delta = normalized.healthImpact[dimension];
        if (delta !== undefined) {
          person.health[dimension] = clamp(
            person.health[dimension] + delta,
            0,
            1,
          );
        }
      }
      for (const dimension of INCIDENT_PSYCHOLOGY_DIMENSIONS) {
        const delta = normalized.psychologyImpact[dimension];
        if (delta !== undefined) {
          person.psychology[dimension] = clamp(
            person.psychology[dimension] + delta,
            0,
            1,
          );
        }
      }
      for (const dimension of EXPERIENCE_DIMENSIONS) {
        const delta = normalized.experienceImpact[dimension];
        if (delta !== undefined) {
          person.experience[dimension] = clamp(
            person.experience[dimension] + delta,
            0,
            1,
          );
        }
      }

      const causedDeath =
        normalized.fatal || person.health.physical === 0;
      let cancelledTransitionId: string | null = null;
      let releasedPodId: string | null = null;
      if (causedDeath) {
        const activeTransition = candidate.activeTransitions.find(
          (transition) => transition.passengerId === passengerId,
        );
        cancelledTransitionId = activeTransition?.id ?? null;
        releasedPodId =
          person.hibernationPodId ?? activeTransition?.podId ?? null;
        candidate.activeTransitions = candidate.activeTransitions.filter(
          (transition) => transition.passengerId !== passengerId,
        );
        person.health.physical = 0;
        person.lifeState = "deceased";
        person.hibernationPodId = null;
      }

      const memory: PassengerEventMemory = {
        id: formatId("memory", candidate.nextMemorySequence, 6),
        atMicroseconds: candidate.nowMicroseconds,
        eventType: normalized.eventType,
        summary: normalized.summary,
        valence: normalized.valence,
        salience: normalized.salience,
        confidence: normalized.confidence,
        experienceImpact: cloneData(normalized.experienceImpact),
        incident: {
          eventId: normalized.eventId,
          healthImpact: cloneData(normalized.healthImpact),
          psychologyImpact: cloneData(normalized.psychologyImpact),
          fatalRequested: normalized.fatal,
          causedDeath,
        },
      };
      candidate.nextMemorySequence += 1;
      person.memories.push(memory);
      outcomes.push({
        passengerId,
        status: "applied",
        memoryId: memory.id,
        lifeState: person.lifeState,
        causedDeath,
        cancelledTransitionId,
        releasedPodId,
      });
    }

    validatePassengerSnapshot(candidate);
    this.passengersValue = candidate.passengers;
    this.activeTransitionsValue = candidate.activeTransitions;
    this.nextMemorySequenceValue = candidate.nextMemorySequence;
    return {
      eventId: normalized.eventId,
      outcomes: cloneData(outcomes),
    };
  }

  getJourneyEvaluation(passengerId: string): string {
    const person = this.requirePassenger(passengerId);
    const lifeState =
      person.lifeState === "awake"
        ? "清醒抵达"
        : person.lifeState === "hibernating"
          ? "仍在休眠中抵达"
          : "未能完成航程";
    const firstParagraph =
      `${person.name} 以${person.occupation}身份登船，最终状态为${lifeState}。` +
      `这段经历对其身体健康的影响呈${qualitative(person.health.physical)}倾向，` +
      `心理稳定感则为${qualitative(person.psychology.stability)}。`;

    const secondParagraph =
      `在具体乘坐体验上，这名乘员对安全感的看法${qualitative(person.experience.safety)}，` +
      `对居住舒适度的看法${qualitative(person.experience.comfort)}；` +
      `其对个人自由和处置公平性的感受分别${qualitative(person.experience.freedom)}与` +
      `${qualitative(person.experience.fairness)}。` +
      `对舰载 AI 的信任${qualitative(person.experience.trust)}，` +
      `对信息透明度的评价${qualitative(person.experience.transparency)}，` +
      `对休眠流程本身的体验${qualitative(person.experience.hibernation)}。`;

    const salientMemories = [...person.memories]
      .sort(
        (left, right) =>
          right.salience - left.salience ||
          right.atMicroseconds - left.atMicroseconds ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .slice(0, 2)
      .map((memory) => memory.summary);
    const thirdParagraph =
      salientMemories.length === 0
        ? "其个人记录中没有足以形成长期印象的事件记忆。"
        : `其最鲜明的航程记忆包括：${salientMemories.join("；")}这些亲历事件构成了评价的主要依据。`;

    return [firstParagraph, secondParagraph, thirdParagraph].join("\n\n");
  }

  snapshot(): PassengerSimulationSnapshot {
    return {
      snapshotVersion: PASSENGER_SNAPSHOT_VERSION,
      generationSeed: this.generationSeedValue,
      nowMicroseconds: this.nowMicrosecondsValue,
      podCapacity: HIBERNATION_POD_CAPACITY,
      keyLlmPassengerIds: [...FIXED_KEY_LLM_IDS],
      passengers: cloneData(this.passengersValue),
      activeTransitions: cloneData(this.activeTransitionsValue),
      hibernationPowerBanks: cloneData(
        this.hibernationPowerBanksValue,
      ),
      nextTransitionSequence: this.nextTransitionSequenceValue,
      nextMemorySequence: this.nextMemorySequenceValue,
    };
  }

  serialize(): string {
    return JSON.stringify(this.snapshot());
  }

  static restore(
    serialized: string | PassengerSimulationSnapshot,
  ): PassengerSimulation {
    const snapshot =
      typeof serialized === "string"
        ? (JSON.parse(serialized) as PassengerSimulationSnapshot)
        : cloneData(serialized);
    validatePassengerSnapshot(snapshot);
    return new PassengerSimulation(snapshot.generationSeed, snapshot);
  }

  private appendMemory(
    person: Passenger,
    input: RecordPassengerEventInput,
  ): PassengerEventMemory {
    assertNonEmpty(input.eventType, "eventType");
    assertNonEmpty(input.summary, "summary");
    const valence = input.valence ?? 0;
    const salience = input.salience ?? 0.5;
    const confidence = input.confidence ?? 1;
    assertFinite(valence, "valence");
    if (valence < -1 || valence > 1) {
      throw new RangeError("valence must be between -1 and 1");
    }
    assertUnitInterval(salience, "salience");
    assertUnitInterval(confidence, "confidence");
    const experienceImpact = input.experienceImpact ?? {};
    for (const [dimension, impact] of Object.entries(experienceImpact)) {
      if (!EXPERIENCE_DIMENSIONS.includes(dimension as ExperienceDimension)) {
        throw new Error(`unknown experience dimension: ${dimension}`);
      }
      assertFinite(impact, `experienceImpact.${dimension}`);
      const key = dimension as ExperienceDimension;
      person.experience[key] = clamp(person.experience[key] + impact, 0, 1);
    }

    const sequence = this.nextMemorySequenceValue;
    this.nextMemorySequenceValue += 1;
    const memory: PassengerEventMemory = {
      id: formatId("memory", sequence, 6),
      atMicroseconds: this.nowMicrosecondsValue,
      eventType: input.eventType,
      summary: input.summary,
      valence,
      salience,
      confidence,
      experienceImpact: cloneData(experienceImpact),
    };
    person.memories.push(memory);
    return memory;
  }

  private requirePassenger(passengerId: string): Passenger {
    const person = this.passengersValue.find(
      (candidate) => candidate.id === passengerId,
    );
    if (!person) {
      throw new Error(`unknown passenger: ${passengerId}`);
    }
    return person;
  }

  private removeTransition(transitionId: string): void {
    const index = this.activeTransitionsValue.findIndex(
      (transition) => transition.id === transitionId,
    );
    if (index < 0) {
      throw new Error(`unknown transition: ${transitionId}`);
    }
    this.activeTransitionsValue.splice(index, 1);
  }

  private validateCurrentSnapshot(): void {
    validatePassengerSnapshot(this.snapshot());
  }
}
