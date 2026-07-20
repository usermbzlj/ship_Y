/**
 * Deterministic admission, idempotency, and audit for simulation commands.
 *
 * The bus owns no domain state and consults no wall clock. A command that
 * passes its checks is handed to one synchronous executor, which must return
 * a plain JSON object.
 */

export const COMMAND_BUS_SNAPSHOT_VERSION = 1 as const;
export const DEFAULT_COMMAND_HISTORY_CAPACITY = 256;
export const MAX_COMMAND_HISTORY_CAPACITY = 10_000;

export type CommandJsonPrimitive = null | boolean | number | string;
export type CommandJsonValue =
  | CommandJsonPrimitive
  | CommandJsonValue[]
  | { [key: string]: CommandJsonValue };
export type StructuredCommandResult = {
  [key: string]: CommandJsonValue;
};

export interface FixedCommandActor<TRole extends string = string> {
  id: string;
  role: TRole;
}

export interface RoleCommandPermission<
  TRole extends string = string,
  TKind extends string = string,
> {
  role: TRole;
  kinds: readonly TKind[];
}

export interface CommandEnvelope<
  TActor extends string = string,
  TKind extends string = string,
  TPayload extends CommandJsonValue = CommandJsonValue,
> {
  commandId: string;
  idempotencyKey: string;
  actor: TActor;
  kind: TKind;
  payload: TPayload;
  /** Caller-supplied logical simulation time; the bus never reads wall time. */
  issuedAt: number;
  expectedRevision: number;
}

export type CommandRejectionCode =
  | "UNKNOWN_ACTOR"
  | "FORBIDDEN"
  | "REVISION_CONFLICT"
  | "REVISION_EXHAUSTED"
  | "IDEMPOTENCY_CONFLICT"
  | "COMMAND_ID_CONFLICT"
  | "REENTRANT_DISPATCH"
  | "EXECUTOR_ERROR"
  | "INVALID_EXECUTOR_RESULT";

export interface CommandRejection {
  code: CommandRejectionCode;
  message: string;
}

interface CommandReceiptBase {
  commandId: string;
  idempotencyKey: string;
  fingerprint: string;
  revisionBefore: number;
  revisionAfter: number;
}

export type CommandDispatchReceipt<
  TResult extends StructuredCommandResult = StructuredCommandResult,
> =
  | (CommandReceiptBase & {
      status: "succeeded";
      result: TResult;
    })
  | (CommandReceiptBase & {
      status: "rejected";
      rejection: CommandRejection;
    });

interface CommandAuditBase extends CommandReceiptBase {
  sequence: number;
  actor: string;
  role: string | null;
  kind: string;
  issuedAt: number;
  expectedRevision: number;
}

export type CommandAuditEntry =
  | (CommandAuditBase & {
      status: "succeeded";
      result: StructuredCommandResult;
    })
  | (CommandAuditBase & {
      status: "rejected";
      rejection: CommandRejection;
    });

export interface ProcessedCommandRecord {
  envelope: CommandEnvelope;
  canonicalEnvelope: string;
  fingerprint: string;
  receipt: CommandDispatchReceipt;
}

export interface CommandBusSnapshot {
  snapshotVersion: typeof COMMAND_BUS_SNAPSHOT_VERSION;
  revision: number;
  historyCapacity: number;
  topologyFingerprint: string;
  actors: FixedCommandActor[];
  permissions: RoleCommandPermission[];
  processedHistory: ProcessedCommandRecord[];
  auditHistory: CommandAuditEntry[];
  nextAuditSequence: number;
}

export interface DeterministicCommandBusOptions<
  TRole extends string = string,
  TKind extends string = string,
> {
  actors: readonly FixedCommandActor<TRole>[];
  permissions: readonly RoleCommandPermission<TRole, TKind>[];
  initialRevision?: number;
  historyCapacity?: number;
}

export interface CommandExecutorContext<
  TActor extends string = string,
  TRole extends string = string,
  TKind extends string = string,
  TPayload extends CommandJsonValue = CommandJsonValue,
> {
  command: CommandEnvelope<TActor, TKind, TPayload>;
  actor: FixedCommandActor<TRole>;
  revision: number;
}

export type CommandExecutor<
  TActor extends string = string,
  TRole extends string = string,
  TKind extends string = string,
  TPayload extends CommandJsonValue = CommandJsonValue,
  TResult extends StructuredCommandResult = StructuredCommandResult,
> = (
  context: CommandExecutorContext<TActor, TRole, TKind, TPayload>,
) => TResult;

type UnknownRecord = Record<string, unknown>;

const REJECTION_CODES = new Set<CommandRejectionCode>([
  "UNKNOWN_ACTOR",
  "FORBIDDEN",
  "REVISION_CONFLICT",
  "REVISION_EXHAUSTED",
  "IDEMPOTENCY_CONFLICT",
  "COMMAND_ID_CONFLICT",
  "REENTRANT_DISPATCH",
  "EXECUTOR_ERROR",
  "INVALID_EXECUTOR_RESULT",
]);

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertText(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new TypeError(`${label} must be a non-empty, trimmed string`);
  }
}

function assertInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function assertJson(
  value: unknown,
  label: string,
  ancestors = new Set<object>(),
): asserts value is CommandJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} contains a non-finite number`);
    }
    return;
  }
  if (typeof value !== "object" || (!Array.isArray(value) && !isRecord(value))) {
    throw new TypeError(`${label} must contain only JSON values`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${label} must not contain cycles`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertJson(entry, `${label}[${index}]`, ancestors),
    );
  } else {
    Object.keys(value).forEach((key) =>
      assertJson(value[key], `${label}.${key}`, ancestors),
    );
  }
  ancestors.delete(value);
}

function stableStringify(value: CommandJsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function cloneJson<T>(value: T): T {
  assertJson(value, "value");
  return JSON.parse(stableStringify(value)) as T;
}

function hash(value: string, seed: number): number {
  let current = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    current = Math.imul(current ^ (code & 0xff), 0x01000193);
    current = Math.imul(current ^ (code >>> 8), 0x01000193);
  }
  return current >>> 0;
}

function fingerprint(value: string): string {
  const left = hash(value, 0x811c9dc5).toString(16).padStart(8, "0");
  const right = hash(value, 0x9e3779b9).toString(16).padStart(8, "0");
  return `cmd-v1-${left}${right}-${value.length.toString(16)}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertEnvelope(value: unknown): asserts value is CommandEnvelope {
  if (!isRecord(value)) {
    throw new TypeError("command envelope must be a plain object");
  }
  assertText(value.commandId, "command.commandId");
  assertText(value.idempotencyKey, "command.idempotencyKey");
  assertText(value.actor, "command.actor");
  assertText(value.kind, "command.kind");
  assertJson(value.payload, "command.payload");
  assertInteger(value.issuedAt, "command.issuedAt");
  assertInteger(value.expectedRevision, "command.expectedRevision");
}

function canonicalCommand(envelope: CommandEnvelope): string {
  return stableStringify({
    actor: envelope.actor,
    commandId: envelope.commandId,
    expectedRevision: envelope.expectedRevision,
    idempotencyKey: envelope.idempotencyKey,
    issuedAt: envelope.issuedAt,
    kind: envelope.kind,
    payload: envelope.payload,
  });
}

export function fingerprintCommand(envelope: CommandEnvelope): string {
  assertEnvelope(envelope);
  return fingerprint(canonicalCommand(envelope));
}

function normalizeActors<TRole extends string>(
  actors: readonly FixedCommandActor<TRole>[],
): FixedCommandActor<TRole>[] {
  if (actors.length === 0) {
    throw new TypeError("at least one fixed actor is required");
  }
  const ids = new Set<string>();
  const normalized = actors.map((actor, index) => {
    if (!isRecord(actor)) {
      throw new TypeError(`actors[${index}] must be a plain object`);
    }
    assertText(actor.id, `actors[${index}].id`);
    assertText(actor.role, `actors[${index}].role`);
    if (ids.has(actor.id)) {
      throw new Error(`duplicate fixed actor: ${actor.id}`);
    }
    ids.add(actor.id);
    return { id: actor.id, role: actor.role as TRole };
  });
  return normalized.sort((left, right) => compareText(left.id, right.id));
}

function normalizePermissions<
  TRole extends string,
  TKind extends string,
>(
  permissions: readonly RoleCommandPermission<TRole, TKind>[],
): RoleCommandPermission<TRole, TKind>[] {
  const roles = new Set<string>();
  const normalized = permissions.map((permission, index) => {
    if (!isRecord(permission) || !Array.isArray(permission.kinds)) {
      throw new TypeError(`permissions[${index}] must define a kinds array`);
    }
    assertText(permission.role, `permissions[${index}].role`);
    if (roles.has(permission.role)) {
      throw new Error(`duplicate role permission: ${permission.role}`);
    }
    roles.add(permission.role);
    const kinds = permission.kinds.map((kind, kindIndex) => {
      assertText(kind, `permissions[${index}].kinds[${kindIndex}]`);
      return kind as TKind;
    });
    if (new Set(kinds).size !== kinds.length) {
      throw new Error(`duplicate command kind for role: ${permission.role}`);
    }
    return { role: permission.role as TRole, kinds: kinds.sort(compareText) };
  });
  return normalized.sort((left, right) =>
    compareText(left.role, right.role),
  );
}

function topologyFingerprint(
  actors: readonly FixedCommandActor[],
  permissions: readonly RoleCommandPermission[],
): string {
  return fingerprint(
    stableStringify({
      actors: actors.map(({ id, role }) => ({ id, role })),
      permissions: permissions.map(({ role, kinds }) => ({
        kinds: [...kinds],
        role,
      })),
    }),
  );
}

function assertRejection(value: unknown): asserts value is CommandRejection {
  if (!isRecord(value)) {
    throw new TypeError("rejection must be a plain object");
  }
  assertText(value.code, "rejection.code");
  assertText(value.message, "rejection.message");
  if (!REJECTION_CODES.has(value.code as CommandRejectionCode)) {
    throw new TypeError(`unsupported rejection code: ${value.code}`);
  }
}

function assertOutcome(
  value: unknown,
  maximumRevision: number,
  label: string,
): asserts value is CommandDispatchReceipt {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  assertText(value.commandId, `${label}.commandId`);
  assertText(value.idempotencyKey, `${label}.idempotencyKey`);
  assertText(value.fingerprint, `${label}.fingerprint`);
  assertInteger(value.revisionBefore, `${label}.revisionBefore`);
  assertInteger(value.revisionAfter, `${label}.revisionAfter`);
  if (value.revisionAfter > maximumRevision) {
    throw new Error(`${label} exceeds the bus revision`);
  }
  if (value.status === "succeeded") {
    if (value.revisionAfter !== value.revisionBefore + 1) {
      throw new Error(`${label} must advance revision exactly once`);
    }
    assertJson(value.result, `${label}.result`);
    if (!isRecord(value.result)) {
      throw new TypeError(`${label}.result must be a JSON object`);
    }
  } else if (value.status === "rejected") {
    if (value.revisionAfter !== value.revisionBefore) {
      throw new Error(`${label} must not advance revision`);
    }
    assertRejection(value.rejection);
  } else {
    throw new TypeError(`${label}.status is unsupported`);
  }
}

export class DeterministicCommandBus<
  TActor extends string = string,
  TRole extends string = string,
  TKind extends string = string,
> {
  private readonly actorsValue: FixedCommandActor<TRole>[];
  private readonly permissionsValue: RoleCommandPermission<TRole, TKind>[];
  private readonly actorById = new Map<string, FixedCommandActor<TRole>>();
  private readonly kindsByRole = new Map<string, ReadonlySet<string>>();
  private readonly capacityValue: number;
  private readonly topologyValue: string;
  private revisionValue: number;
  private nextAuditSequenceValue = 1;
  private processedValue: ProcessedCommandRecord[] = [];
  private auditValue: CommandAuditEntry[] = [];
  private readonly byIdempotency = new Map<string, ProcessedCommandRecord>();
  private readonly byCommandId = new Map<string, ProcessedCommandRecord>();
  private executorActive = false;

  constructor(options: DeterministicCommandBusOptions<TRole, TKind>) {
    const capacity = options.historyCapacity ?? DEFAULT_COMMAND_HISTORY_CAPACITY;
    if (
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      capacity > MAX_COMMAND_HISTORY_CAPACITY
    ) {
      throw new RangeError(
        `historyCapacity must be between 1 and ${MAX_COMMAND_HISTORY_CAPACITY}`,
      );
    }
    const initialRevision = options.initialRevision ?? 0;
    assertInteger(initialRevision, "initialRevision");
    this.actorsValue = normalizeActors(options.actors);
    this.permissionsValue = normalizePermissions(options.permissions);

    const configuredRoles = new Set(
      this.permissionsValue.map(({ role }) => role),
    );
    for (const actor of this.actorsValue) {
      if (!configuredRoles.has(actor.role)) {
        throw new Error(
          `actor ${actor.id} has no whitelist for role ${actor.role}`,
        );
      }
      this.actorById.set(actor.id, actor);
    }
    for (const permission of this.permissionsValue) {
      this.kindsByRole.set(permission.role, new Set(permission.kinds));
    }
    this.capacityValue = capacity;
    this.revisionValue = initialRevision;
    this.topologyValue = topologyFingerprint(
      this.actorsValue,
      this.permissionsValue,
    );
  }

  get revision(): number {
    return this.revisionValue;
  }

  get historyCapacity(): number {
    return this.capacityValue;
  }

  get topologyFingerprint(): string {
    return this.topologyValue;
  }

  canExecute(actorId: TActor, kind: TKind): boolean {
    const actor = this.actorById.get(actorId);
    return (
      actor !== undefined &&
      this.kindsByRole.get(actor.role)?.has(kind) === true
    );
  }

  getAuditHistory(): CommandAuditEntry[] {
    return cloneJson(this.auditValue);
  }

  getProcessedHistory(): ProcessedCommandRecord[] {
    return cloneJson(this.processedValue);
  }

  dispatch<
    TPayload extends CommandJsonValue,
    TResult extends StructuredCommandResult,
  >(
    envelope: CommandEnvelope<TActor, TKind, TPayload>,
    executor: CommandExecutor<
      TActor,
      TRole,
      TKind,
      TPayload,
      TResult
    >,
  ): CommandDispatchReceipt<TResult> {
    assertEnvelope(envelope);
    if (typeof executor !== "function") {
      throw new TypeError("command executor must be a function");
    }
    const canonical = canonicalCommand(envelope);
    const commandFingerprint = fingerprint(canonical);

    const priorKey = this.byIdempotency.get(envelope.idempotencyKey);
    if (priorKey) {
      if (priorKey.canonicalEnvelope === canonical) {
        return cloneJson(priorKey.receipt) as CommandDispatchReceipt<TResult>;
      }
      return this.reject(
        envelope,
        commandFingerprint,
        "IDEMPOTENCY_CONFLICT",
        `idempotency key ${envelope.idempotencyKey} belongs to another command`,
      ) as CommandDispatchReceipt<TResult>;
    }
    if (this.byCommandId.has(envelope.commandId)) {
      return this.reject(
        envelope,
        commandFingerprint,
        "COMMAND_ID_CONFLICT",
        `command id ${envelope.commandId} was already used`,
      ) as CommandDispatchReceipt<TResult>;
    }

    const actor = this.actorById.get(envelope.actor);
    if (!actor) {
      return this.reject(
        envelope,
        commandFingerprint,
        "UNKNOWN_ACTOR",
        `actor ${envelope.actor} is not registered`,
        true,
        canonical,
      ) as CommandDispatchReceipt<TResult>;
    }
    if (this.kindsByRole.get(actor.role)?.has(envelope.kind) !== true) {
      return this.reject(
        envelope,
        commandFingerprint,
        "FORBIDDEN",
        `role ${actor.role} cannot execute ${envelope.kind}`,
        true,
        canonical,
        actor.role,
      ) as CommandDispatchReceipt<TResult>;
    }
    if (envelope.expectedRevision !== this.revisionValue) {
      return this.reject(
        envelope,
        commandFingerprint,
        "REVISION_CONFLICT",
        `expected revision ${envelope.expectedRevision}, current revision is ${this.revisionValue}`,
        true,
        canonical,
        actor.role,
      ) as CommandDispatchReceipt<TResult>;
    }
    if (this.revisionValue === Number.MAX_SAFE_INTEGER) {
      return this.reject(
        envelope,
        commandFingerprint,
        "REVISION_EXHAUSTED",
        "command bus revision is exhausted",
        true,
        canonical,
        actor.role,
      ) as CommandDispatchReceipt<TResult>;
    }
    if (this.executorActive) {
      return this.reject(
        envelope,
        commandFingerprint,
        "REENTRANT_DISPATCH",
        "an executor cannot dispatch on the same bus",
        true,
        canonical,
        actor.role,
      ) as CommandDispatchReceipt<TResult>;
    }

    let rawResult: TResult;
    this.executorActive = true;
    try {
      rawResult = executor({
        command: cloneJson(envelope),
        actor: cloneJson(actor),
        revision: this.revisionValue,
      });
    } catch (error) {
      const detail =
        error instanceof Error && error.message.trim()
          ? error.message
          : "non-Error value";
      return this.reject(
        envelope,
        commandFingerprint,
        "EXECUTOR_ERROR",
        `executor failed: ${detail}`,
        true,
        canonical,
        actor.role,
      ) as CommandDispatchReceipt<TResult>;
    } finally {
      this.executorActive = false;
    }

    try {
      assertJson(rawResult, "executor result");
      if (!isRecord(rawResult)) {
        throw new TypeError("executor result must be a plain JSON object");
      }
    } catch (error) {
      return this.reject(
        envelope,
        commandFingerprint,
        "INVALID_EXECUTOR_RESULT",
        error instanceof Error ? error.message : "invalid executor result",
        true,
        canonical,
        actor.role,
      ) as CommandDispatchReceipt<TResult>;
    }

    const before = this.revisionValue;
    this.revisionValue += 1;
    const result = cloneJson(rawResult);
    const receipt: CommandDispatchReceipt<TResult> = {
      status: "succeeded",
      commandId: envelope.commandId,
      idempotencyKey: envelope.idempotencyKey,
      fingerprint: commandFingerprint,
      revisionBefore: before,
      revisionAfter: this.revisionValue,
      result,
    };
    this.audit({
      ...receipt,
      sequence: this.nextAuditSequenceValue,
      actor: envelope.actor,
      role: actor.role,
      kind: envelope.kind,
      issuedAt: envelope.issuedAt,
      expectedRevision: envelope.expectedRevision,
    });
    this.remember(envelope, canonical, commandFingerprint, receipt);
    return cloneJson(receipt);
  }

  snapshot(): CommandBusSnapshot {
    return cloneJson({
      snapshotVersion: COMMAND_BUS_SNAPSHOT_VERSION,
      revision: this.revisionValue,
      historyCapacity: this.capacityValue,
      topologyFingerprint: this.topologyValue,
      actors: this.actorsValue,
      permissions: this.permissionsValue,
      processedHistory: this.processedValue,
      auditHistory: this.auditValue,
      nextAuditSequence: this.nextAuditSequenceValue,
    });
  }

  serialize(): string {
    return stableStringify(this.snapshot() as unknown as CommandJsonValue);
  }

  static restore<
    TActor extends string = string,
    TRole extends string = string,
    TKind extends string = string,
  >(
    serialized: string | CommandBusSnapshot,
  ): DeterministicCommandBus<TActor, TRole, TKind> {
    const parsed: unknown =
      typeof serialized === "string" ? JSON.parse(serialized) : serialized;
    assertJson(parsed, "command bus snapshot");
    if (
      !isRecord(parsed) ||
      parsed.snapshotVersion !== COMMAND_BUS_SNAPSHOT_VERSION
    ) {
      throw new Error("unsupported or malformed command bus snapshot");
    }
    assertInteger(parsed.revision, "snapshot.revision");
    assertInteger(parsed.historyCapacity, "snapshot.historyCapacity");
    assertInteger(parsed.nextAuditSequence, "snapshot.nextAuditSequence");
    assertText(parsed.topologyFingerprint, "snapshot.topologyFingerprint");
    if (
      !Array.isArray(parsed.actors) ||
      !Array.isArray(parsed.permissions) ||
      !Array.isArray(parsed.processedHistory) ||
      !Array.isArray(parsed.auditHistory)
    ) {
      throw new TypeError("snapshot topology and histories must be arrays");
    }
    if (
      parsed.processedHistory.length > parsed.historyCapacity ||
      parsed.auditHistory.length > parsed.historyCapacity
    ) {
      throw new Error("snapshot history exceeds its capacity");
    }

    const bus = new DeterministicCommandBus<TActor, TRole, TKind>({
      actors: parsed.actors as unknown as FixedCommandActor<TRole>[],
      permissions: parsed.permissions as unknown as RoleCommandPermission<
        TRole,
        TKind
      >[],
      initialRevision: parsed.revision,
      historyCapacity: parsed.historyCapacity,
    });
    if (bus.topologyFingerprint !== parsed.topologyFingerprint) {
      throw new Error("snapshot topology fingerprint does not match its data");
    }

    for (const raw of parsed.processedHistory) {
      if (!isRecord(raw)) {
        throw new TypeError("processed history entry must be an object");
      }
      assertEnvelope(raw.envelope);
      assertText(raw.canonicalEnvelope, "processed.canonicalEnvelope");
      assertText(raw.fingerprint, "processed.fingerprint");
      const canonical = canonicalCommand(raw.envelope);
      const expectedFingerprint = fingerprint(canonical);
      if (
        raw.canonicalEnvelope !== canonical ||
        raw.fingerprint !== expectedFingerprint
      ) {
        throw new Error("processed command fingerprint does not match its envelope");
      }
      assertOutcome(raw.receipt, bus.revision, "processed receipt");
      if (
        raw.receipt.commandId !== raw.envelope.commandId ||
        raw.receipt.idempotencyKey !== raw.envelope.idempotencyKey ||
        raw.receipt.fingerprint !== expectedFingerprint ||
        bus.byIdempotency.has(raw.envelope.idempotencyKey) ||
        bus.byCommandId.has(raw.envelope.commandId)
      ) {
        throw new Error("processed command identity is inconsistent or duplicated");
      }
      const record: ProcessedCommandRecord = cloneJson({
        envelope: raw.envelope,
        canonicalEnvelope: canonical,
        fingerprint: expectedFingerprint,
        receipt: raw.receipt,
      });
      bus.processedValue.push(record);
      bus.byIdempotency.set(record.envelope.idempotencyKey, record);
      bus.byCommandId.set(record.envelope.commandId, record);
    }

    let previousSequence = 0;
    for (const raw of parsed.auditHistory) {
      if (!isRecord(raw)) {
        throw new TypeError("audit history entry must be an object");
      }
      assertInteger(raw.sequence, "audit.sequence");
      if (raw.sequence <= previousSequence || raw.sequence === 0) {
        throw new Error("audit sequences must be strictly increasing");
      }
      assertOutcome(raw, bus.revision, "audit entry");
      assertText(raw.actor, "audit.actor");
      assertText(raw.kind, "audit.kind");
      assertInteger(raw.issuedAt, "audit.issuedAt");
      assertInteger(raw.expectedRevision, "audit.expectedRevision");
      if (raw.role !== null) {
        assertText(raw.role, "audit.role");
      }
      previousSequence = raw.sequence;
      bus.auditValue.push(
        cloneJson(raw) as unknown as CommandAuditEntry,
      );
    }
    if (
      parsed.nextAuditSequence <= previousSequence ||
      parsed.nextAuditSequence === 0
    ) {
      throw new Error("next audit sequence must follow retained history");
    }
    bus.nextAuditSequenceValue = parsed.nextAuditSequence;
    return bus;
  }

  private reject<TPayload extends CommandJsonValue>(
    envelope: CommandEnvelope<TActor, TKind, TPayload>,
    commandFingerprint: string,
    code: CommandRejectionCode,
    message: string,
    shouldRemember = false,
    canonical = canonicalCommand(envelope),
    role: string | null = this.actorById.get(envelope.actor)?.role ?? null,
  ): CommandDispatchReceipt {
    const receipt: CommandDispatchReceipt = {
      status: "rejected",
      commandId: envelope.commandId,
      idempotencyKey: envelope.idempotencyKey,
      fingerprint: commandFingerprint,
      revisionBefore: this.revisionValue,
      revisionAfter: this.revisionValue,
      rejection: { code, message },
    };
    this.audit({
      ...receipt,
      sequence: this.nextAuditSequenceValue,
      actor: envelope.actor,
      role,
      kind: envelope.kind,
      issuedAt: envelope.issuedAt,
      expectedRevision: envelope.expectedRevision,
    });
    if (shouldRemember) {
      this.remember(envelope, canonical, commandFingerprint, receipt);
    }
    return cloneJson(receipt);
  }

  private audit(entry: CommandAuditEntry): void {
    this.nextAuditSequenceValue += 1;
    this.auditValue.push(cloneJson(entry));
    if (this.auditValue.length > this.capacityValue) {
      this.auditValue.shift();
    }
  }

  private remember<TPayload extends CommandJsonValue>(
    envelope: CommandEnvelope<TActor, TKind, TPayload>,
    canonicalEnvelope: string,
    commandFingerprint: string,
    receipt: CommandDispatchReceipt,
  ): void {
    const record: ProcessedCommandRecord = cloneJson({
      envelope,
      canonicalEnvelope,
      fingerprint: commandFingerprint,
      receipt,
    });
    this.processedValue.push(record);
    this.byIdempotency.set(envelope.idempotencyKey, record);
    this.byCommandId.set(envelope.commandId, record);
    if (this.processedValue.length <= this.capacityValue) {
      return;
    }
    const evicted = this.processedValue.shift();
    if (evicted) {
      this.byIdempotency.delete(evicted.envelope.idempotencyKey);
      this.byCommandId.delete(evicted.envelope.commandId);
    }
  }
}
