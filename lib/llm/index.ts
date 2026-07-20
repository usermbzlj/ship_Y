export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonPath = readonly (string | number)[];
export type AgentId = string;

export const SELF_ROUTINE_CONFIGURATION_PERMISSION =
  "llm:routine:configure-self";
export const CONFIGURE_SELF_ROUTINE_TOOL_NAME =
  "configure_self_routine";

export interface RoutineSettings {
  systemInfoIntervalSimSeconds: number;
  discussionDepth: number;
  discussionRounds: number;
}

export interface AbsoluteRoutineLimits {
  minSystemInfoIntervalSimSeconds: number;
  maxSystemInfoIntervalSimSeconds: number;
  maxDiscussionDepth: number;
  maxDiscussionRounds: number;
}

export interface SecretHeaderReference {
  header: string;
  secretRef: string;
  prefix?: string;
}

export interface ToolCallMapping {
  idPath?: JsonPath;
  namePath: JsonPath;
  argumentsPath?: JsonPath;
}

export interface UsageMapping {
  inputTokensPath?: JsonPath;
  outputTokensPath?: JsonPath;
  totalTokensPath?: JsonPath;
}

export interface JsonResponseMapping {
  kind: "json";
  textPath?: JsonPath;
  finishReasonPath?: JsonPath;
  toolCallsPath?: JsonPath;
  toolCall?: ToolCallMapping;
  usage?: UsageMapping;
}

export interface StreamDoneCondition {
  path: JsonPath;
  equals: JsonValue;
}

export interface StreamResponseMapping {
  kind: "stream";
  format: "sse" | "ndjson";
  textDeltaPath?: JsonPath;
  finishReasonPath?: JsonPath;
  toolCallsPath?: JsonPath;
  toolCall?: ToolCallMapping;
  usage?: UsageMapping;
  dataPrefix?: string;
  doneSentinel?: string;
  doneWhen?: StreamDoneCondition;
  acceptEof?: boolean;
}

export type ResponseMapping = JsonResponseMapping | StreamResponseMapping;

export interface HttpEndpointDefinition {
  url: string;
  method?: string;
  headers?: Readonly<Record<string, string>>;
  secretHeaders?: readonly SecretHeaderReference[];
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  bodyTemplate: JsonObject;
  response: ResponseMapping;
}

export interface FixedAgentDefinition {
  id: AgentId;
  role: string;
  systemPrompt: string;
  permissions: readonly string[];
  canSendTo: readonly AgentId[];
  routineDefaults: RoutineSettings;
  endpoint: HttpEndpointDefinition;
}

export interface FixedAgentSystemDefinition {
  routineLimits: AbsoluteRoutineLimits;
  agents: readonly FixedAgentDefinition[];
}

export interface LlmMessage {
  role: string;
  content: JsonValue;
  name?: string;
}

export interface LlmToolDefinition {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
}

export interface DiscussionPosition {
  depth: number;
  round: number;
}

export interface LlmInvocation {
  agentId: AgentId;
  fromAgentId?: AgentId;
  messages: readonly LlmMessage[];
  tools?: readonly LlmToolDefinition[];
  metadata?: JsonObject;
  discussion?: DiscussionPosition;
  signal?: AbortSignal;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: JsonValue;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LlmInvocationResult {
  callId: string;
  agentId: AgentId;
  text: string;
  toolCalls: readonly LlmToolCall[];
  finishReason: string | null;
  usage: LlmUsage;
  attempts: number;
}

export interface LlmUsageRecord extends LlmUsage {
  callId: string;
  agentId: AgentId;
  attempts: number;
  startedAtEpochMs: number;
  completedAtEpochMs: number;
}

export interface UsageSink {
  record(record: LlmUsageRecord): void | Promise<void>;
}

export interface RetryPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
}

export interface GatewayAvailabilityEvent {
  agentId: AgentId;
  callId: string;
  status: "retrying" | "ready";
  attempt: number;
  retryInMs?: number;
  error?: string;
}

export interface LlmGatewayOptions {
  fetch: typeof fetch;
  resolveSecret: (secretRef: string) => string | Promise<string>;
  routines?: AgentRoutineController;
  usage?: UsageSink;
  retry?: Partial<RetryPolicy>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  onAvailabilityChange?: (
    event: GatewayAvailabilityEvent,
  ) => void | Promise<void>;
  now?: () => number;
  createCallId?: () => string;
}

export interface FixedAgentRuntimeStatus {
  id: AgentId;
  role: string;
  canSendTo: readonly AgentId[];
  routine: RoutineSettings;
  state: "ready" | "retrying" | "missing-secret";
}

export interface FixedLlmServerStatus {
  ready: boolean;
  fixedAgentCount: number;
  agents: readonly FixedAgentRuntimeStatus[];
  pendingRoutineTickets: number;
  usage: LlmUsage;
}

export interface RoutineTicketReference {
  callId: string;
  toolCallId: string;
  expiresAtEpochMs: number;
}

export interface FixedLlmServerInvocationResult
  extends LlmInvocationResult {
  routineTickets: readonly RoutineTicketReference[];
}

export interface RoutineTicketConsumption {
  callId: string;
  toolCallId: string;
}

export interface RoutineTicketConsumptionResult
  extends RoutineTicketConsumption {
  agentId: AgentId;
  routine: RoutineSettings;
}

export interface FixedLlmServerRuntimeOptions {
  fetch: typeof fetch;
  readEnvironment: (name: string) => string | undefined;
  retry?: Partial<RetryPolicy>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  onAvailabilityChange?: (
    event: GatewayAvailabilityEvent,
  ) => void | Promise<void>;
  now?: () => number;
  createCallId?: () => string;
  routineTicketTtlMs?: number;
  maxRoutineTickets?: number;
}

export const MAX_LLM_INVOKE_BODY_BYTES = 1_048_576;
export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 120_000;
export const ABSOLUTE_MAX_LLM_REQUEST_TIMEOUT_MS = 600_000;
export const DEFAULT_LLM_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const ABSOLUTE_MAX_LLM_RESPONSE_BYTES = 16 * 1024 * 1024;

export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigurationError";
  }
}

export class UnknownAgentError extends Error {
  constructor(agentId: string) {
    super(`Unknown fixed LLM agent: ${agentId}`);
    this.name = "UnknownAgentError";
  }
}

export class AgentPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPermissionError";
  }
}

export class LlmRequestAbortedError extends Error {
  constructor() {
    super("LLM request was aborted");
    this.name = "LlmRequestAbortedError";
  }
}

export class LlmProviderHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number) {
    const detail =
      status === 400
        ? "rejected the request payload"
        : status === 401 || status === 403
          ? "rejected authentication"
          : status === 404
            ? "could not find the configured endpoint or model"
            : "returned an error";
    super(`LLM provider ${detail} (HTTP ${status})`);
    this.name = "LlmProviderHttpError";
    this.status = status;
    this.retryable =
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      status >= 500;
  }
}

class LlmProviderRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`LLM provider request timed out after ${timeoutMs} ms`);
    this.name = "LlmProviderRequestTimeoutError";
  }
}

class LlmResponseByteLimitError extends Error {
  constructor(maxResponseBytes: number) {
    super(
      `LLM response exceeded the ${maxResponseBytes} byte response limit`,
    );
    this.name = "LlmResponseByteLimitError";
  }
}

export class LlmInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmInputValidationError";
  }
}

export class LlmEndpointUnavailableError extends Error {
  constructor(agentId: string) {
    super(`LLM endpoint for fixed agent ${agentId} is not configured`);
    this.name = "LlmEndpointUnavailableError";
  }
}

export class RoutineTicketNotFoundError extends Error {
  constructor() {
    super("Routine change ticket was not found");
    this.name = "RoutineTicketNotFoundError";
  }
}

export class RoutineTicketConsumedError extends Error {
  constructor() {
    super("Routine change ticket has already been consumed");
    this.name = "RoutineTicketConsumedError";
  }
}

export class RoutineTicketExpiredError extends Error {
  constructor() {
    super("Routine change ticket has expired");
    this.name = "RoutineTicketExpiredError";
  }
}

export class UnsupportedRoutineToolError extends Error {
  constructor(toolName: string) {
    super(`Tool ${toolName} cannot be consumed as a routine change`);
    this.name = "UnsupportedRoutineToolError";
  }
}

export class InvalidRoutineToolArgumentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRoutineToolArgumentsError";
  }
}

export class FixedAgentRegistry {
  readonly #agents: ReadonlyMap<AgentId, FixedAgentDefinition>;
  readonly routineLimits: AbsoluteRoutineLimits;

  constructor(definition: FixedAgentSystemDefinition) {
    validateRoutineLimits(definition.routineLimits);
    if (definition.agents.length === 0) {
      throw new LlmConfigurationError(
        "At least one fixed LLM agent must be configured",
      );
    }

    const cloned = structuredClone(definition);
    const ids = new Set<string>();
    for (const agent of cloned.agents) {
      if (!agent.id.trim()) {
        throw new LlmConfigurationError("Agent id cannot be empty");
      }
      if (ids.has(agent.id)) {
        throw new LlmConfigurationError(`Duplicate agent id: ${agent.id}`);
      }
      ids.add(agent.id);
      validateRoutineSettings(
        agent.routineDefaults,
        cloned.routineLimits,
        `agent ${agent.id}`,
      );
      validateEndpoint(agent.endpoint, agent.id);
    }

    for (const agent of cloned.agents) {
      for (const target of agent.canSendTo) {
        if (!ids.has(target)) {
          throw new LlmConfigurationError(
            `Agent ${agent.id} references unknown communication target ${target}`,
          );
        }
      }
    }

    const frozen = deepFreeze(cloned);
    this.routineLimits = frozen.routineLimits;
    this.#agents = new Map(frozen.agents.map((agent) => [agent.id, agent]));
  }

  get(agentId: AgentId): FixedAgentDefinition {
    const agent = this.#agents.get(agentId);
    if (!agent) throw new UnknownAgentError(agentId);
    return agent;
  }

  list(): readonly FixedAgentDefinition[] {
    return Object.freeze([...this.#agents.values()]);
  }

  canCommunicate(fromAgentId: AgentId, toAgentId: AgentId): boolean {
    const from = this.get(fromAgentId);
    this.get(toAgentId);
    return fromAgentId === toAgentId || from.canSendTo.includes(toAgentId);
  }

  assertCanCommunicate(fromAgentId: AgentId, toAgentId: AgentId): void {
    if (!this.canCommunicate(fromAgentId, toAgentId)) {
      throw new AgentPermissionError(
        `Agent ${fromAgentId} cannot send messages to ${toAgentId}`,
      );
    }
  }
}

export class AgentRoutineController {
  readonly #registry: FixedAgentRegistry;
  readonly #settings = new Map<AgentId, RoutineSettings>();

  constructor(registry: FixedAgentRegistry) {
    this.#registry = registry;
    for (const agent of registry.list()) {
      this.#settings.set(
        agent.id,
        deepFreeze(structuredClone(agent.routineDefaults)),
      );
    }
  }

  get(agentId: AgentId): RoutineSettings {
    this.#registry.get(agentId);
    const settings = this.#settings.get(agentId);
    if (!settings) throw new UnknownAgentError(agentId);
    return settings;
  }

  setByAgent(
    agentId: AgentId,
    patch: Partial<RoutineSettings>,
  ): RoutineSettings {
    const agent = this.#registry.get(agentId);
    if (!agent.permissions.includes(SELF_ROUTINE_CONFIGURATION_PERMISSION)) {
      throw new AgentPermissionError(
        `Agent ${agentId} cannot change its routine LLM schedule`,
      );
    }

    const next = { ...this.get(agentId), ...patch };
    validateRoutineSettings(
      next,
      this.#registry.routineLimits,
      `agent ${agentId}`,
    );
    const frozen = deepFreeze(next);
    this.#settings.set(agentId, frozen);
    return frozen;
  }

  assertDiscussionPosition(
    agentId: AgentId,
    position: DiscussionPosition,
  ): void {
    const settings = this.get(agentId);
    if (
      !Number.isInteger(position.depth) ||
      position.depth < 1 ||
      position.depth > settings.discussionDepth
    ) {
      throw new AgentPermissionError(
        `Discussion depth ${position.depth} exceeds the configured limit for ${agentId}`,
      );
    }
    if (
      !Number.isInteger(position.round) ||
      position.round < 1 ||
      position.round > settings.discussionRounds
    ) {
      throw new AgentPermissionError(
        `Discussion round ${position.round} exceeds the configured limit for ${agentId}`,
      );
    }
  }
}

export class InMemoryUsageLedger implements UsageSink {
  readonly #records = new Map<string, LlmUsageRecord>();

  record(record: LlmUsageRecord): void {
    this.#records.set(
      record.callId,
      deepFreeze(structuredClone(record)),
    );
  }

  list(agentId?: AgentId): readonly LlmUsageRecord[] {
    const records = [...this.#records.values()].filter(
      (record) => agentId === undefined || record.agentId === agentId,
    );
    return Object.freeze(records);
  }

  totals(agentId?: AgentId): LlmUsage {
    return this.list(agentId).reduce<LlmUsage>(
      (total, record) => ({
        inputTokens: total.inputTokens + record.inputTokens,
        outputTokens: total.outputTokens + record.outputTokens,
        totalTokens: total.totalTokens + record.totalTokens,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    );
  }
}

interface ParsedResponse {
  text: string;
  toolCalls: LlmToolCall[];
  finishReason: string | null;
  usage: LlmUsage;
}

interface MutableStreamToolCall {
  id: string;
  name: string;
  argumentText: string;
  argumentValue?: JsonValue;
}

interface PendingRoutineToolTicket {
  state: "pending";
  callId: string;
  toolCallId: string;
  agentId: AgentId;
  toolName: string;
  arguments: JsonValue;
  expiresAtEpochMs: number;
}

interface ConsumedRoutineToolTicket {
  state: "consumed";
  callId: string;
  toolCallId: string;
  expiresAtEpochMs: number;
}

type StoredRoutineToolTicket =
  | PendingRoutineToolTicket
  | ConsumedRoutineToolTicket;

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  multiplier: 2,
};
const DEFAULT_ROUTINE_TICKET_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ROUTINE_TICKETS = 1024;
const CLIENT_WORLD_TOOL_PERMISSIONS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  execute_jump: ["ship:command", "navigation:command"],
  schedule_thruster_pulse: [
    "ship:command",
    "navigation:command",
  ],
  schedule_thruster_maneuver: [
    "ship:command",
    "navigation:command",
  ],
  set_reactor_target: ["ship:command", "engineering:command"],
  set_reactor_mode: ["ship:command", "engineering:command"],
  set_cooling_pump_speed: [
    "ship:command",
    "engineering:command",
  ],
  set_electrical_load_enabled: [
    "ship:command",
    "engineering:command",
  ],
  set_electrical_breaker: [
    "ship:command",
    "engineering:command",
  ],
  set_battery_mode: ["ship:command", "engineering:command"],
  set_habitat_ring_control: [
    "ship:command",
    "engineering:command",
  ],
  set_air_handler_control: [
    "ship:command",
    "engineering:command",
    "life-support:command",
  ],
  set_water_processor_control: [
    "ship:command",
    "engineering:command",
    "life-support:command",
  ],
  schedule_maintenance: [
    "ship:command",
    "engineering:command",
  ],
  set_awake_target: ["ship:command", "medical:command"],
  isolate_pressure_zone: [
    "ship:command",
    "life-support:command",
    "security:command",
  ],
});

export class LlmGateway {
  readonly #registry: FixedAgentRegistry;
  readonly #options: Required<
    Pick<
      LlmGatewayOptions,
      "fetch" | "resolveSecret" | "sleep" | "now" | "createCallId"
    >
  > &
    Pick<
      LlmGatewayOptions,
      "routines" | "usage" | "onAvailabilityChange"
    >;
  readonly #retry: RetryPolicy;

  constructor(registry: FixedAgentRegistry, options: LlmGatewayOptions) {
    this.#registry = registry;
    this.#retry = {
      ...DEFAULT_RETRY_POLICY,
      ...options.retry,
    };
    validateRetryPolicy(this.#retry);
    this.#options = {
      fetch: options.fetch,
      resolveSecret: options.resolveSecret,
      routines: options.routines,
      usage: options.usage,
      sleep: options.sleep ?? abortableSleep,
      onAvailabilityChange: options.onAvailabilityChange,
      now: options.now ?? Date.now,
      createCallId:
        options.createCallId ?? (() => globalThis.crypto.randomUUID()),
    };
  }

  async invoke(invocation: LlmInvocation): Promise<LlmInvocationResult> {
    const agent = this.#registry.get(invocation.agentId);
    if (invocation.fromAgentId) {
      this.#registry.assertCanCommunicate(
        invocation.fromAgentId,
        invocation.agentId,
      );
    }
    if (invocation.discussion) {
      if (!this.#options.routines) {
        throw new LlmConfigurationError(
          "Discussion limits require an AgentRoutineController",
        );
      }
      this.#options.routines.assertDiscussionPosition(
        invocation.agentId,
        invocation.discussion,
      );
    }
    throwIfAborted(invocation.signal);

    const callId = this.#options.createCallId();
    const startedAtEpochMs = this.#options.now();
    let attempts = 0;
    let parsed: ParsedResponse;
    let retrying = false;

    try {
      while (true) {
        attempts += 1;
        try {
          parsed = await this.#executeAttempt(agent, invocation);
          break;
        } catch (error) {
          if (isAbort(error, invocation.signal)) {
            throw new LlmRequestAbortedError();
          }
          if (
            error instanceof LlmProviderHttpError &&
            !error.retryable
          ) {
            throw error;
          }

          retrying = true;
          const retryInMs = retryDelay(this.#retry, attempts);
          await this.#options.onAvailabilityChange?.({
            agentId: agent.id,
            callId,
            status: "retrying",
            attempt: attempts,
            retryInMs,
            error: errorMessage(error),
          });
          try {
            await this.#options.sleep(retryInMs, invocation.signal);
            throwIfAborted(invocation.signal);
          } catch (sleepError) {
            if (isAbort(sleepError, invocation.signal)) {
              throw new LlmRequestAbortedError();
            }
            throw sleepError;
          }
        }
      }

      const completedAtEpochMs = this.#options.now();
      await this.#options.usage?.record({
        callId,
        agentId: agent.id,
        attempts,
        ...parsed.usage,
        startedAtEpochMs,
        completedAtEpochMs,
      });

      return {
        callId,
        agentId: agent.id,
        text: parsed.text,
        toolCalls: Object.freeze(parsed.toolCalls),
        finishReason: parsed.finishReason,
        usage: deepFreeze(parsed.usage),
        attempts,
      };
    } finally {
      if (retrying) {
        await this.#options.onAvailabilityChange?.({
          agentId: agent.id,
          callId,
          status: "ready",
          attempt: attempts,
        });
      }
    }
  }

  async #executeAttempt(
    agent: FixedAgentDefinition,
    invocation: LlmInvocation,
  ): Promise<ParsedResponse> {
    const endpoint = agent.endpoint;
    const headers = new Headers(endpoint.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    for (const reference of endpoint.secretHeaders ?? []) {
      const secret = await this.#options.resolveSecret(reference.secretRef);
      if (!secret) {
        throw new Error(`Secret reference ${reference.secretRef} is empty`);
      }
      headers.set(reference.header, `${reference.prefix ?? ""}${secret}`);
    }

    const routine =
      this.#options.routines?.get(agent.id) ?? agent.routineDefaults;
    const openAiMessages = toOpenAiCompatibleMessages(
      invocation.messages,
    );
    const messagesWithSystem = [
      {
        role: "system",
        content: agent.systemPrompt,
      },
      ...invocation.messages,
    ];
    const renderedBody = renderJsonTemplate(endpoint.bodyTemplate, {
      agent: {
        id: agent.id,
        role: agent.role,
        systemPrompt: agent.systemPrompt,
      },
      request: {
        messages: invocation.messages,
        messagesWithSystem,
        openAiMessages,
        openAiMessagesWithSystem: [
          {
            role: "system",
            content: agent.systemPrompt,
          },
          ...openAiMessages,
        ],
        tools: invocation.tools ?? [],
        openAiTools: (invocation.tools ?? []).map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description ?? "",
            parameters: tool.inputSchema ?? {
              type: "object",
              properties: {},
            },
          },
        })),
        metadata: invocation.metadata ?? {},
        stream: endpoint.response.kind === "stream",
      },
      routine,
    });

    const timeoutMs =
      endpoint.requestTimeoutMs ?? DEFAULT_LLM_REQUEST_TIMEOUT_MS;
    const maxResponseBytes =
      endpoint.maxResponseBytes ?? DEFAULT_LLM_MAX_RESPONSE_BYTES;

    return runProviderAttempt(
      timeoutMs,
      invocation.signal,
      async (attemptSignal) => {
        const response = await this.#options.fetch(endpoint.url, {
          method: endpoint.method ?? "POST",
          headers,
          body: JSON.stringify(renderedBody),
          signal: attemptSignal,
        });
        if (!response.ok) {
          await discardResponseBody(response);
          throw new LlmProviderHttpError(response.status);
        }

        if (endpoint.response.kind === "stream") {
          return parseStreamResponse(
            response,
            endpoint.response,
            maxResponseBytes,
            attemptSignal,
          );
        }
        return parseJsonResponse(
          response,
          endpoint.response,
          maxResponseBytes,
          attemptSignal,
        );
      },
    );
  }
}

export class FixedLlmServerRuntime {
  readonly registry: FixedAgentRegistry;
  readonly routines: AgentRoutineController;
  readonly usage: InMemoryUsageLedger;
  readonly #gateway: LlmGateway;
  readonly #readEnvironment: (name: string) => string | undefined;
  readonly #retryingCalls = new Map<string, AgentId>();
  readonly #routineTickets = new Map<string, StoredRoutineToolTicket>();
  readonly #routineTicketTtlMs: number;
  readonly #maxRoutineTickets: number;
  readonly #now: () => number;

  constructor(
    definition: unknown,
    options: FixedLlmServerRuntimeOptions,
  ) {
    const parsedDefinition = parseFixedAgentSystemDefinition(definition);
    this.registry = new FixedAgentRegistry(parsedDefinition);
    this.routines = new AgentRoutineController(this.registry);
    this.usage = new InMemoryUsageLedger();
    this.#readEnvironment = options.readEnvironment;
    this.#routineTicketTtlMs =
      options.routineTicketTtlMs ?? DEFAULT_ROUTINE_TICKET_TTL_MS;
    this.#maxRoutineTickets =
      options.maxRoutineTickets ?? DEFAULT_MAX_ROUTINE_TICKETS;
    this.#now = options.now ?? Date.now;
    if (
      !Number.isFinite(this.#routineTicketTtlMs) ||
      this.#routineTicketTtlMs < 1000 ||
      this.#routineTicketTtlMs > 24 * 60 * 60_000 ||
      !Number.isInteger(this.#maxRoutineTickets) ||
      this.#maxRoutineTickets < 1 ||
      this.#maxRoutineTickets > 10_000
    ) {
      throw new LlmConfigurationError(
        "Invalid routine change ticket retention limits",
      );
    }

    this.#gateway = new LlmGateway(this.registry, {
      fetch: options.fetch,
      resolveSecret: (secretRef) => {
        const value = this.#readEnvironment(secretRef);
        if (!isUsableSecret(value)) {
          throw new Error(`Required secret ${secretRef} is unavailable`);
        }
        return value;
      },
      routines: this.routines,
      usage: this.usage,
      retry: options.retry,
      sleep: options.sleep,
      now: options.now,
      createCallId: options.createCallId,
      onAvailabilityChange: async (event) => {
        if (event.status === "retrying") {
          this.#retryingCalls.set(event.callId, event.agentId);
        } else {
          this.#retryingCalls.delete(event.callId);
        }
        await options.onAvailabilityChange?.(event);
      },
    });
  }

  status(): FixedLlmServerStatus {
    this.#cleanupRoutineTickets(this.#now());
    const agents = this.registry.list().map<FixedAgentRuntimeStatus>((agent) => {
      const hasEverySecret = (agent.endpoint.secretHeaders ?? []).every(
        (reference) =>
          isUsableSecret(this.#readEnvironment(reference.secretRef)),
      );
      return deepFreeze({
        id: agent.id,
        role: agent.role,
        canSendTo: [...agent.canSendTo],
        routine: this.routines.get(agent.id),
        state: hasEverySecret
          ? ([...this.#retryingCalls.values()].includes(agent.id)
              ? "retrying"
              : "ready")
          : "missing-secret",
      });
    });

    return deepFreeze({
      ready: agents.every((agent) => agent.state === "ready"),
      fixedAgentCount: agents.length,
      agents,
      pendingRoutineTickets: [...this.#routineTickets.values()].filter(
        (ticket) =>
          ticket.state === "pending" &&
          ticket.toolName === CONFIGURE_SELF_ROUTINE_TOOL_NAME,
      ).length,
      usage: this.usage.totals(),
    });
  }

  async invoke(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<FixedLlmServerInvocationResult> {
    const invocation = parseLlmInvocation(input);
    const agent = this.registry.get(invocation.agentId);
    if (!invocation.fromAgentId && agent.id !== "captain") {
      throw new AgentPermissionError(
        `Direct player/system invocation is restricted to the fixed captain; ${agent.id} requires an authorized sender`,
      );
    }
    for (const tool of invocation.tools ?? []) {
      const acceptedPermissions =
        CLIENT_WORLD_TOOL_PERMISSIONS[tool.name];
      if (!acceptedPermissions) {
        throw new LlmInputValidationError(
          `Client-supplied tool ${tool.name} is not in the fixed world-tool registry`,
        );
      }
      if (
        !acceptedPermissions.some((permission) =>
          agent.permissions.includes(permission),
        )
      ) {
        throw new AgentPermissionError(
          `Agent ${agent.id} cannot receive world tool ${tool.name}`,
        );
      }
    }
    const hasEverySecret = (agent.endpoint.secretHeaders ?? []).every(
      (reference) =>
        isUsableSecret(this.#readEnvironment(reference.secretRef)),
    );
    if (!hasEverySecret) {
      throw new LlmEndpointUnavailableError(agent.id);
    }
    if (
      invocation.tools?.some(
        (tool) => tool.name === CONFIGURE_SELF_ROUTINE_TOOL_NAME,
      )
    ) {
      throw new LlmInputValidationError(
        `${CONFIGURE_SELF_ROUTINE_TOOL_NAME} is a server-controlled tool`,
      );
    }

    const tools = [...(invocation.tools ?? [])];
    if (
      agent.permissions.includes(SELF_ROUTINE_CONFIGURATION_PERMISSION)
    ) {
      tools.push(this.#routineConfigurationTool());
    }
    const result = await this.#gateway.invoke({
      ...invocation,
      tools,
      signal,
    });
    const routineTickets = this.#stageRoutineToolCalls(result);
    return deepFreeze({ ...result, routineTickets });
  }

  consumeRoutineTicket(input: unknown): RoutineTicketConsumptionResult {
    const request = parseRoutineTicketConsumption(input);
    const key = routineTicketKey(request.callId, request.toolCallId);
    const now = this.#now();
    const ticket = this.#routineTickets.get(key);
    if (!ticket) {
      this.#cleanupRoutineTickets(now);
      throw new RoutineTicketNotFoundError();
    }
    if (ticket.expiresAtEpochMs <= now) {
      this.#routineTickets.delete(key);
      this.#cleanupRoutineTickets(now);
      throw new RoutineTicketExpiredError();
    }
    this.#cleanupRoutineTickets(now);
    if (ticket.state === "consumed") {
      throw new RoutineTicketConsumedError();
    }

    this.#routineTickets.set(key, {
      state: "consumed",
      callId: ticket.callId,
      toolCallId: ticket.toolCallId,
      expiresAtEpochMs: ticket.expiresAtEpochMs,
    });
    if (ticket.toolName !== CONFIGURE_SELF_ROUTINE_TOOL_NAME) {
      throw new UnsupportedRoutineToolError(ticket.toolName);
    }

    const patch = parseRoutineSettingsPatch(
      ticket.arguments,
      this.registry.routineLimits,
    );
    const routine = this.routines.setByAgent(ticket.agentId, patch);
    return deepFreeze({
      callId: ticket.callId,
      toolCallId: ticket.toolCallId,
      agentId: ticket.agentId,
      routine,
    });
  }

  #routineConfigurationTool(): LlmToolDefinition {
    const limits = this.registry.routineLimits;
    return {
      name: CONFIGURE_SELF_ROUTINE_TOOL_NAME,
      description:
        "Adjust only your own routine system-information interval and discussion limits. The server enforces absolute limits.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          systemInfoIntervalSimSeconds: {
            type: "number",
            minimum: limits.minSystemInfoIntervalSimSeconds,
            maximum: limits.maxSystemInfoIntervalSimSeconds,
          },
          discussionDepth: {
            type: "integer",
            minimum: 1,
            maximum: limits.maxDiscussionDepth,
          },
          discussionRounds: {
            type: "integer",
            minimum: 1,
            maximum: limits.maxDiscussionRounds,
          },
        },
      },
    };
  }

  #stageRoutineToolCalls(
    result: LlmInvocationResult,
  ): readonly RoutineTicketReference[] {
    const now = this.#now();
    this.#cleanupRoutineTickets(now);
    const expiresAtEpochMs = now + this.#routineTicketTtlMs;
    const references: RoutineTicketReference[] = [];
    const seen = new Set<string>();

    for (const toolCall of result.toolCalls) {
      const key = routineTicketKey(result.callId, toolCall.id);
      if (seen.has(key)) continue;
      seen.add(key);
      while (this.#routineTickets.size >= this.#maxRoutineTickets) {
        const oldest = this.#routineTickets.keys().next().value;
        if (typeof oldest !== "string") break;
        this.#routineTickets.delete(oldest);
      }
      this.#routineTickets.set(key, {
        state: "pending",
        callId: result.callId,
        toolCallId: toolCall.id,
        agentId: result.agentId,
        toolName: toolCall.name,
        arguments: structuredClone(toolCall.arguments),
        expiresAtEpochMs,
      });
      if (toolCall.name === CONFIGURE_SELF_ROUTINE_TOOL_NAME) {
        references.push({
          callId: result.callId,
          toolCallId: toolCall.id,
          expiresAtEpochMs,
        });
      }
    }
    return Object.freeze(references);
  }

  #cleanupRoutineTickets(now: number): void {
    for (const [key, ticket] of this.#routineTickets) {
      if (ticket.expiresAtEpochMs <= now) {
        this.#routineTickets.delete(key);
      }
    }
  }
}

export function parseFixedAgentSystemDefinition(
  input: unknown,
): FixedAgentSystemDefinition {
  assertJsonByteSize(input, 1_048_576, "LLM configuration");
  const root = expectRecord(input, "LLM configuration");
  assertOnlyKeys(root, ["routineLimits", "agents"], "LLM configuration");

  const limitsInput = expectRecord(
    root.routineLimits,
    "routineLimits",
  );
  assertOnlyKeys(
    limitsInput,
    [
      "minSystemInfoIntervalSimSeconds",
      "maxSystemInfoIntervalSimSeconds",
      "maxDiscussionDepth",
      "maxDiscussionRounds",
    ],
    "routineLimits",
  );
  const routineLimits: AbsoluteRoutineLimits = {
    minSystemInfoIntervalSimSeconds: expectFiniteNumber(
      limitsInput.minSystemInfoIntervalSimSeconds,
      "routineLimits.minSystemInfoIntervalSimSeconds",
    ),
    maxSystemInfoIntervalSimSeconds: expectFiniteNumber(
      limitsInput.maxSystemInfoIntervalSimSeconds,
      "routineLimits.maxSystemInfoIntervalSimSeconds",
    ),
    maxDiscussionDepth: expectInteger(
      limitsInput.maxDiscussionDepth,
      "routineLimits.maxDiscussionDepth",
    ),
    maxDiscussionRounds: expectInteger(
      limitsInput.maxDiscussionRounds,
      "routineLimits.maxDiscussionRounds",
    ),
  };

  const agentsInput = expectArray(root.agents, "agents");
  if (agentsInput.length < 1 || agentsInput.length > 64) {
    throw new LlmConfigurationError(
      "LLM configuration must define between 1 and 64 fixed agents",
    );
  }
  const agents = agentsInput.map((value, index) =>
    parseFixedAgent(value, `agents[${index}]`),
  );
  return { routineLimits, agents };
}

export function parseLlmInvocation(input: unknown): LlmInvocation {
  assertJsonByteSize(input, MAX_LLM_INVOKE_BODY_BYTES, "LLM invocation");
  const root = expectInputRecord(input, "request body");
  assertOnlyInputKeys(
    root,
    [
      "agentId",
      "fromAgentId",
      "messages",
      "tools",
      "metadata",
      "discussion",
    ],
    "request body",
  );

  const agentId = expectInputIdentifier(root.agentId, "agentId");
  const fromAgentId =
    root.fromAgentId === undefined
      ? undefined
      : expectInputIdentifier(root.fromAgentId, "fromAgentId");
  const messagesInput = expectInputArray(root.messages, "messages");
  if (messagesInput.length > 256) {
    throw new LlmInputValidationError(
      "messages cannot contain more than 256 entries",
    );
  }
  const messages = messagesInput.map((value, index) =>
    parseInvocationMessage(value, index),
  );

  let tools: LlmToolDefinition[] | undefined;
  if (root.tools !== undefined) {
    const toolsInput = expectInputArray(root.tools, "tools");
    if (toolsInput.length > 128) {
      throw new LlmInputValidationError(
        "tools cannot contain more than 128 entries",
      );
    }
    tools = toolsInput.map((value, index) =>
      parseInvocationTool(value, index),
    );
    const names = new Set(tools.map((tool) => tool.name));
    if (names.size !== tools.length) {
      throw new LlmInputValidationError("tool names must be unique");
    }
  }

  let metadata: JsonObject | undefined;
  if (root.metadata !== undefined) {
    metadata = cloneInputJsonObject(root.metadata, "metadata");
  }

  let discussion: DiscussionPosition | undefined;
  if (root.discussion !== undefined) {
    const value = expectInputRecord(root.discussion, "discussion");
    assertOnlyInputKeys(value, ["depth", "round"], "discussion");
    discussion = {
      depth: expectPositiveInputInteger(value.depth, "discussion.depth"),
      round: expectPositiveInputInteger(value.round, "discussion.round"),
    };
  }

  return {
    agentId,
    ...(fromAgentId === undefined ? {} : { fromAgentId }),
    messages,
    ...(tools === undefined ? {} : { tools }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(discussion === undefined ? {} : { discussion }),
  };
}

export function parseRoutineTicketConsumption(
  input: unknown,
): RoutineTicketConsumption {
  assertJsonByteSize(input, 4096, "LLM invocation");
  const value = expectInputRecord(input, "request body");
  assertOnlyInputKeys(
    value,
    ["callId", "toolCallId"],
    "request body",
  );
  return {
    callId: expectTicketIdentifier(value.callId, "callId"),
    toolCallId: expectTicketIdentifier(value.toolCallId, "toolCallId"),
  };
}

function parseRoutineSettingsPatch(
  input: JsonValue,
  limits: AbsoluteRoutineLimits,
): Partial<RoutineSettings> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidRoutineToolArgumentsError(
      `${CONFIGURE_SELF_ROUTINE_TOOL_NAME} arguments must be an object`,
    );
  }
  const allowed = new Set([
    "systemInfoIntervalSimSeconds",
    "discussionDepth",
    "discussionRounds",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new InvalidRoutineToolArgumentsError(
        `${CONFIGURE_SELF_ROUTINE_TOOL_NAME} cannot change ${key}`,
      );
    }
  }
  if (Object.keys(input).length === 0) {
    throw new InvalidRoutineToolArgumentsError(
      `${CONFIGURE_SELF_ROUTINE_TOOL_NAME} requires at least one setting`,
    );
  }

  const patch: Partial<RoutineSettings> = {};
  const interval = input.systemInfoIntervalSimSeconds;
  if (interval !== undefined) {
    if (
      typeof interval !== "number" ||
      !Number.isFinite(interval) ||
      interval < limits.minSystemInfoIntervalSimSeconds ||
      interval > limits.maxSystemInfoIntervalSimSeconds
    ) {
      throw new InvalidRoutineToolArgumentsError(
        "systemInfoIntervalSimSeconds is outside absolute limits",
      );
    }
    patch.systemInfoIntervalSimSeconds = interval;
  }
  const depth = input.discussionDepth;
  if (depth !== undefined) {
    if (
      typeof depth !== "number" ||
      !Number.isInteger(depth) ||
      depth < 1 ||
      depth > limits.maxDiscussionDepth
    ) {
      throw new InvalidRoutineToolArgumentsError(
        "discussionDepth is outside absolute limits",
      );
    }
    patch.discussionDepth = depth;
  }
  const rounds = input.discussionRounds;
  if (rounds !== undefined) {
    if (
      typeof rounds !== "number" ||
      !Number.isInteger(rounds) ||
      rounds < 1 ||
      rounds > limits.maxDiscussionRounds
    ) {
      throw new InvalidRoutineToolArgumentsError(
        "discussionRounds is outside absolute limits",
      );
    }
    patch.discussionRounds = rounds;
  }
  return patch;
}

function routineTicketKey(callId: string, toolCallId: string): string {
  return JSON.stringify([callId, toolCallId]);
}

function parseFixedAgent(
  input: unknown,
  label: string,
): FixedAgentDefinition {
  const value = expectRecord(input, label);
  assertOnlyKeys(
    value,
    [
      "id",
      "role",
      "systemPrompt",
      "permissions",
      "canSendTo",
      "routineDefaults",
      "endpoint",
    ],
    label,
  );
  const id = expectConfigurationIdentifier(value.id, `${label}.id`);
  const role = expectConfigurationString(value.role, `${label}.role`, 128);
  const systemPrompt = expectConfigurationString(
    value.systemPrompt,
    `${label}.systemPrompt`,
    100_000,
  );
  const permissions = parseConfigurationStringArray(
    value.permissions,
    `${label}.permissions`,
    256,
  );
  const canSendTo = parseConfigurationStringArray(
    value.canSendTo,
    `${label}.canSendTo`,
    64,
    true,
  );

  const routineInput = expectRecord(
    value.routineDefaults,
    `${label}.routineDefaults`,
  );
  assertOnlyKeys(
    routineInput,
    [
      "systemInfoIntervalSimSeconds",
      "discussionDepth",
      "discussionRounds",
    ],
    `${label}.routineDefaults`,
  );
  const routineDefaults: RoutineSettings = {
    systemInfoIntervalSimSeconds: expectFiniteNumber(
      routineInput.systemInfoIntervalSimSeconds,
      `${label}.routineDefaults.systemInfoIntervalSimSeconds`,
    ),
    discussionDepth: expectInteger(
      routineInput.discussionDepth,
      `${label}.routineDefaults.discussionDepth`,
    ),
    discussionRounds: expectInteger(
      routineInput.discussionRounds,
      `${label}.routineDefaults.discussionRounds`,
    ),
  };

  return {
    id,
    role,
    systemPrompt,
    permissions,
    canSendTo,
    routineDefaults,
    endpoint: parseEndpointDefinition(value.endpoint, `${label}.endpoint`),
  };
}

function parseEndpointDefinition(
  input: unknown,
  label: string,
): HttpEndpointDefinition {
  const value = expectRecord(input, label);
  assertOnlyKeys(
    value,
    [
      "url",
      "method",
      "headers",
      "secretHeaders",
      "requestTimeoutMs",
      "maxResponseBytes",
      "bodyTemplate",
      "response",
    ],
    label,
  );
  const url = expectConfigurationString(value.url, `${label}.url`, 2048);
  const method =
    value.method === undefined
      ? undefined
      : expectConfigurationString(value.method, `${label}.method`, 16);
  if (method && !/^[A-Z]+$/i.test(method)) {
    throw new LlmConfigurationError(`${label}.method is invalid`);
  }
  const requestTimeoutMs =
    value.requestTimeoutMs === undefined
      ? undefined
      : expectEndpointLimit(
          value.requestTimeoutMs,
          `${label}.requestTimeoutMs`,
          ABSOLUTE_MAX_LLM_REQUEST_TIMEOUT_MS,
        );
  const maxResponseBytes =
    value.maxResponseBytes === undefined
      ? undefined
      : expectEndpointLimit(
          value.maxResponseBytes,
          `${label}.maxResponseBytes`,
          ABSOLUTE_MAX_LLM_RESPONSE_BYTES,
        );

  let headers: Record<string, string> | undefined;
  if (value.headers !== undefined) {
    const headerInput = expectRecord(value.headers, `${label}.headers`);
    headers = {};
    for (const [name, headerValue] of Object.entries(headerInput)) {
      validateHeaderName(name, `${label}.headers`);
      if (isSensitiveHeaderName(name)) {
        throw new LlmConfigurationError(
          `${label}.headers.${name} must use secretHeaders and an environment reference`,
        );
      }
      headers[name] = expectConfigurationHeaderValue(
        headerValue,
        `${label}.headers.${name}`,
      );
    }
  }

  let secretHeaders: SecretHeaderReference[] | undefined;
  if (value.secretHeaders !== undefined) {
    const references = expectArray(
      value.secretHeaders,
      `${label}.secretHeaders`,
    );
    if (references.length > 16) {
      throw new LlmConfigurationError(
        `${label}.secretHeaders cannot exceed 16 entries`,
      );
    }
    secretHeaders = references.map((entry, index) => {
      const reference = expectRecord(
        entry,
        `${label}.secretHeaders[${index}]`,
      );
      assertOnlyKeys(
        reference,
        ["header", "secretRef", "prefix"],
        `${label}.secretHeaders[${index}]`,
      );
      const header = expectConfigurationString(
        reference.header,
        `${label}.secretHeaders[${index}].header`,
        128,
      );
      validateHeaderName(header, `${label}.secretHeaders[${index}].header`);
      const secretRef = expectConfigurationString(
        reference.secretRef,
        `${label}.secretHeaders[${index}].secretRef`,
        128,
      );
      if (!/^[A-Z][A-Z0-9_]*$/.test(secretRef)) {
        throw new LlmConfigurationError(
          `${label}.secretHeaders[${index}].secretRef must be an environment variable name`,
        );
      }
      const prefix =
        reference.prefix === undefined
          ? undefined
          : expectConfigurationHeaderValue(
              reference.prefix,
              `${label}.secretHeaders[${index}].prefix`,
            );
      return { header, secretRef, ...(prefix === undefined ? {} : { prefix }) };
    });
  }

  return {
    url,
    ...(method === undefined ? {} : { method }),
    ...(headers === undefined ? {} : { headers }),
    ...(secretHeaders === undefined ? {} : { secretHeaders }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    bodyTemplate: cloneConfigurationJsonObject(
      value.bodyTemplate,
      `${label}.bodyTemplate`,
    ),
    response: parseResponseDefinition(value.response, `${label}.response`),
  };
}

function parseResponseDefinition(
  input: unknown,
  label: string,
): ResponseMapping {
  const value = expectRecord(input, label);
  const kind = expectConfigurationString(value.kind, `${label}.kind`, 16);
  const commonKeys = [
    "kind",
    "textPath",
    "finishReasonPath",
    "toolCallsPath",
    "toolCall",
    "usage",
  ];
  if (kind === "json") {
    assertOnlyKeys(value, commonKeys, label);
    return {
      kind,
      ...parseCommonResponseFields(value, label),
    };
  }
  if (kind !== "stream") {
    throw new LlmConfigurationError(
      `${label}.kind must be json or stream`,
    );
  }
  assertOnlyKeys(
    value,
    [
      ...commonKeys,
      "format",
      "dataPrefix",
      "doneSentinel",
      "doneWhen",
      "acceptEof",
    ],
    label,
  );
  const format = expectConfigurationString(
    value.format,
    `${label}.format`,
    16,
  );
  if (format !== "sse" && format !== "ndjson") {
    throw new LlmConfigurationError(
      `${label}.format must be sse or ndjson`,
    );
  }
  const fields = parseCommonResponseFields(value, label);
  const dataPrefix = parseOptionalConfigurationString(
    value.dataPrefix,
    `${label}.dataPrefix`,
    128,
  );
  const doneSentinel = parseOptionalConfigurationString(
    value.doneSentinel,
    `${label}.doneSentinel`,
    1024,
    true,
  );
  const acceptEof =
    value.acceptEof === undefined
      ? undefined
      : expectConfigurationBoolean(value.acceptEof, `${label}.acceptEof`);
  let doneWhen: StreamDoneCondition | undefined;
  if (value.doneWhen !== undefined) {
    const done = expectRecord(value.doneWhen, `${label}.doneWhen`);
    assertOnlyKeys(done, ["path", "equals"], `${label}.doneWhen`);
    doneWhen = {
      path: parseJsonPath(done.path, `${label}.doneWhen.path`),
      equals: cloneConfigurationJsonValue(
        done.equals,
        `${label}.doneWhen.equals`,
      ),
    };
  }
  return {
    kind,
    format,
    ...fields,
    ...(dataPrefix === undefined ? {} : { dataPrefix }),
    ...(doneSentinel === undefined ? {} : { doneSentinel }),
    ...(doneWhen === undefined ? {} : { doneWhen }),
    ...(acceptEof === undefined ? {} : { acceptEof }),
  };
}

function parseCommonResponseFields(
  value: Record<string, unknown>,
  label: string,
): Omit<JsonResponseMapping, "kind"> {
  const textPath =
    value.textPath === undefined
      ? undefined
      : parseJsonPath(value.textPath, `${label}.textPath`);
  const finishReasonPath =
    value.finishReasonPath === undefined
      ? undefined
      : parseJsonPath(
          value.finishReasonPath,
          `${label}.finishReasonPath`,
        );
  const toolCallsPath =
    value.toolCallsPath === undefined
      ? undefined
      : parseJsonPath(value.toolCallsPath, `${label}.toolCallsPath`);
  const toolCall =
    value.toolCall === undefined
      ? undefined
      : parseToolCallDefinition(value.toolCall, `${label}.toolCall`);
  const usage =
    value.usage === undefined
      ? undefined
      : parseUsageDefinition(value.usage, `${label}.usage`);
  return {
    ...(textPath === undefined ? {} : { textPath }),
    ...(finishReasonPath === undefined ? {} : { finishReasonPath }),
    ...(toolCallsPath === undefined ? {} : { toolCallsPath }),
    ...(toolCall === undefined ? {} : { toolCall }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function parseToolCallDefinition(
  input: unknown,
  label: string,
): ToolCallMapping {
  const value = expectRecord(input, label);
  assertOnlyKeys(value, ["idPath", "namePath", "argumentsPath"], label);
  return {
    ...(value.idPath === undefined
      ? {}
      : { idPath: parseJsonPath(value.idPath, `${label}.idPath`) }),
    namePath: parseJsonPath(value.namePath, `${label}.namePath`),
    ...(value.argumentsPath === undefined
      ? {}
      : {
          argumentsPath: parseJsonPath(
            value.argumentsPath,
            `${label}.argumentsPath`,
          ),
        }),
  };
}

function parseUsageDefinition(
  input: unknown,
  label: string,
): UsageMapping {
  const value = expectRecord(input, label);
  assertOnlyKeys(
    value,
    ["inputTokensPath", "outputTokensPath", "totalTokensPath"],
    label,
  );
  return {
    ...(value.inputTokensPath === undefined
      ? {}
      : {
          inputTokensPath: parseJsonPath(
            value.inputTokensPath,
            `${label}.inputTokensPath`,
          ),
        }),
    ...(value.outputTokensPath === undefined
      ? {}
      : {
          outputTokensPath: parseJsonPath(
            value.outputTokensPath,
            `${label}.outputTokensPath`,
          ),
        }),
    ...(value.totalTokensPath === undefined
      ? {}
      : {
          totalTokensPath: parseJsonPath(
            value.totalTokensPath,
            `${label}.totalTokensPath`,
          ),
        }),
  };
}

function parseJsonPath(input: unknown, label: string): JsonPath {
  const value = expectArray(input, label);
  if (value.length > 32) {
    throw new LlmConfigurationError(`${label} is too deep`);
  }
  return value.map((segment, index) => {
    if (
      typeof segment === "number" &&
      Number.isInteger(segment) &&
      segment >= 0
    ) {
      return segment;
    }
    if (
      typeof segment === "string" &&
      segment.length > 0 &&
      segment.length <= 128
    ) {
      return segment;
    }
    throw new LlmConfigurationError(
      `${label}[${index}] must be a key or non-negative array index`,
    );
  });
}

function parseInvocationMessage(
  input: unknown,
  index: number,
): LlmMessage {
  const label = `messages[${index}]`;
  const value = expectInputRecord(input, label);
  assertOnlyInputKeys(value, ["role", "content", "name"], label);
  const role = expectInputString(value.role, `${label}.role`, 32);
  if (!["user", "assistant", "tool"].includes(role)) {
    throw new LlmInputValidationError(
      `${label}.role must be user, assistant, or tool`,
    );
  }
  const content = cloneInputJsonValue(value.content, `${label}.content`);
  const name =
    value.name === undefined
      ? undefined
      : expectInputIdentifier(value.name, `${label}.name`);
  return { role, content, ...(name === undefined ? {} : { name }) };
}

function parseInvocationTool(
  input: unknown,
  index: number,
): LlmToolDefinition {
  const label = `tools[${index}]`;
  const value = expectInputRecord(input, label);
  assertOnlyInputKeys(
    value,
    ["name", "description", "inputSchema"],
    label,
  );
  const name = expectInputString(value.name, `${label}.name`, 128);
  if (!/^[A-Za-z0-9_.:-]+$/.test(name)) {
    throw new LlmInputValidationError(`${label}.name is invalid`);
  }
  const description =
    value.description === undefined
      ? undefined
      : expectInputString(value.description, `${label}.description`, 4096);
  const inputSchema =
    value.inputSchema === undefined
      ? undefined
      : cloneInputJsonObject(value.inputSchema, `${label}.inputSchema`);
  return {
    name,
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
  };
}

function validateRoutineLimits(limits: AbsoluteRoutineLimits): void {
  if (
    !Number.isFinite(limits.minSystemInfoIntervalSimSeconds) ||
    limits.minSystemInfoIntervalSimSeconds <= 0 ||
    !Number.isFinite(limits.maxSystemInfoIntervalSimSeconds) ||
    limits.maxSystemInfoIntervalSimSeconds <
      limits.minSystemInfoIntervalSimSeconds ||
    !Number.isInteger(limits.maxDiscussionDepth) ||
    limits.maxDiscussionDepth < 1 ||
    !Number.isInteger(limits.maxDiscussionRounds) ||
    limits.maxDiscussionRounds < 1
  ) {
    throw new LlmConfigurationError("Invalid absolute routine limits");
  }
}

function validateRoutineSettings(
  settings: RoutineSettings,
  limits: AbsoluteRoutineLimits,
  label: string,
): void {
  if (
    !Number.isFinite(settings.systemInfoIntervalSimSeconds) ||
    settings.systemInfoIntervalSimSeconds <
      limits.minSystemInfoIntervalSimSeconds ||
    settings.systemInfoIntervalSimSeconds >
      limits.maxSystemInfoIntervalSimSeconds
  ) {
    throw new LlmConfigurationError(
      `System information interval is outside absolute limits for ${label}`,
    );
  }
  if (
    !Number.isInteger(settings.discussionDepth) ||
    settings.discussionDepth < 1 ||
    settings.discussionDepth > limits.maxDiscussionDepth
  ) {
    throw new LlmConfigurationError(
      `Discussion depth is outside absolute limits for ${label}`,
    );
  }
  if (
    !Number.isInteger(settings.discussionRounds) ||
    settings.discussionRounds < 1 ||
    settings.discussionRounds > limits.maxDiscussionRounds
  ) {
    throw new LlmConfigurationError(
      `Discussion rounds are outside absolute limits for ${label}`,
    );
  }
}

function validateEndpoint(
  endpoint: HttpEndpointDefinition,
  agentId: string,
): void {
  let url: URL;
  try {
    url = new URL(endpoint.url);
  } catch {
    throw new LlmConfigurationError(
      `Agent ${agentId} has an invalid HTTP endpoint URL`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LlmConfigurationError(
      `Agent ${agentId} endpoint must use HTTP or HTTPS`,
    );
  }
  if (url.username || url.password) {
    throw new LlmConfigurationError(
      `Agent ${agentId} endpoint URL cannot contain credentials`,
    );
  }
  const usesSecretHeaders = (endpoint.secretHeaders?.length ?? 0) > 0;
  if (url.protocol === "http:" && usesSecretHeaders) {
    throw new LlmConfigurationError(
      `Agent ${agentId} endpoint with secretHeaders must use HTTPS`,
    );
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new LlmConfigurationError(
      `Agent ${agentId} may use HTTP only for a loopback endpoint`,
    );
  }
  validateEndpointLimit(
    endpoint.requestTimeoutMs ?? DEFAULT_LLM_REQUEST_TIMEOUT_MS,
    ABSOLUTE_MAX_LLM_REQUEST_TIMEOUT_MS,
    `Agent ${agentId} requestTimeoutMs`,
  );
  validateEndpointLimit(
    endpoint.maxResponseBytes ?? DEFAULT_LLM_MAX_RESPONSE_BYTES,
    ABSOLUTE_MAX_LLM_RESPONSE_BYTES,
    `Agent ${agentId} maxResponseBytes`,
  );
  if (
    typeof endpoint.bodyTemplate !== "object" ||
    endpoint.bodyTemplate === null ||
    Array.isArray(endpoint.bodyTemplate)
  ) {
    throw new LlmConfigurationError(
      `Agent ${agentId} request body template must be a JSON object`,
    );
  }

  const headerNames = new Set<string>();
  for (const [header, headerValue] of Object.entries(
    endpoint.headers ?? {},
  )) {
    validateHeaderName(header, `Agent ${agentId} headers`);
    if (isSensitiveHeaderName(header)) {
      throw new LlmConfigurationError(
        `Agent ${agentId} header ${header} must use secretHeaders`,
      );
    }
    expectConfigurationHeaderValue(
      headerValue,
      `Agent ${agentId} header ${header}`,
    );
    headerNames.add(header.toLowerCase());
  }
  for (const reference of endpoint.secretHeaders ?? []) {
    validateHeaderName(
      reference.header,
      `Agent ${agentId} secretHeaders`,
    );
    const header = reference.header.toLowerCase();
    if (
      !/^[A-Z][A-Z0-9_]*$/.test(reference.secretRef) ||
      headerNames.has(header)
    ) {
      throw new LlmConfigurationError(
        `Agent ${agentId} has a duplicate or empty secret header reference`,
      );
    }
    if (reference.prefix !== undefined) {
      expectConfigurationHeaderValue(
        reference.prefix,
        `Agent ${agentId} secret header prefix`,
      );
    }
    headerNames.add(header);
  }
  validateResponseMapping(endpoint.response, agentId);
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function validateEndpointLimit(
  value: number,
  absoluteMaximum: number,
  label: string,
): void {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > absoluteMaximum
  ) {
    throw new LlmConfigurationError(
      `${label} must be an integer from 1 through ${absoluteMaximum}`,
    );
  }
}

function validateResponseMapping(
  mapping: ResponseMapping,
  agentId: string,
): void {
  if (
    mapping.toolCallsPath &&
    (!mapping.toolCall || mapping.toolCall.namePath.length === 0)
  ) {
    throw new LlmConfigurationError(
      `Agent ${agentId} tool response mapping is incomplete`,
    );
  }
  if (mapping.kind === "stream" && !mapping.acceptEof) {
    const sentinel = mapping.doneSentinel ?? "[DONE]";
    if (!sentinel && !mapping.doneWhen) {
      throw new LlmConfigurationError(
        `Agent ${agentId} stream needs a terminal signal or acceptEof`,
      );
    }
  }
}

function validateRetryPolicy(policy: RetryPolicy): void {
  if (
    !Number.isFinite(policy.initialDelayMs) ||
    policy.initialDelayMs < 0 ||
    !Number.isFinite(policy.maxDelayMs) ||
    policy.maxDelayMs < policy.initialDelayMs ||
    !Number.isFinite(policy.multiplier) ||
    policy.multiplier < 1
  ) {
    throw new LlmConfigurationError("Invalid LLM retry policy");
  }
}

function retryDelay(policy: RetryPolicy, failedAttempt: number): number {
  return Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs * policy.multiplier ** (failedAttempt - 1),
  );
}

function toOpenAiCompatibleMessages(
  messages: readonly LlmMessage[],
): JsonObject[] {
  return messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
    ...(message.name === undefined ? {} : { name: message.name }),
  }));
}

async function discardResponseBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The provider or runtime may already have closed the failed response.
  }
}

function renderJsonTemplate(
  template: JsonObject,
  variables: unknown,
): JsonObject {
  const rendered = renderTemplateValue(template, variables);
  if (
    typeof rendered !== "object" ||
    rendered === null ||
    Array.isArray(rendered)
  ) {
    throw new LlmConfigurationError(
      "Rendered LLM request body must remain a JSON object",
    );
  }
  return rendered;
}

function renderTemplateValue(
  value: JsonValue,
  variables: unknown,
): JsonValue | undefined {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{\s*([A-Za-z0-9_.]+)\s*\}\}$/);
    if (whole) {
      return asJsonValue(readDottedPath(variables, whole[1]));
    }
    return value.replace(
      /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g,
      (_match, path: string) => {
        const replacement = readDottedPath(variables, path);
        if (replacement === undefined) return "";
        return typeof replacement === "object"
          ? JSON.stringify(replacement)
          : String(replacement);
      },
    );
  }
  if (Array.isArray(value)) {
    return value.map(
      (item) => renderTemplateValue(item, variables) ?? null,
    );
  }
  if (value !== null && typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      const rendered = renderTemplateValue(item, variables);
      if (rendered !== undefined) result[key] = rendered;
    }
    return result;
  }
  return value;
}

function readDottedPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, root);
}

function getAtPath(root: unknown, path: JsonPath | undefined): unknown {
  if (!path) return undefined;
  return path.reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (typeof segment === "number") {
      return Array.isArray(current) ? current[segment] : undefined;
    }
    return typeof current === "object"
      ? (current as Record<string, unknown>)[segment]
      : undefined;
  }, root);
}

async function runProviderAttempt<T>(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  execute: (attemptSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  throwIfAborted(callerSignal);

  const controller = new AbortController();
  let rejectGuard: (reason: unknown) => void = () => {};
  const guard = new Promise<never>((_resolve, reject) => {
    rejectGuard = reject;
  });
  const timeout = setTimeout(() => {
    const error = new LlmProviderRequestTimeoutError(timeoutMs);
    rejectGuard(error);
    controller.abort(error);
  }, timeoutMs);
  const abortFromCaller = () => {
    const error = new LlmRequestAbortedError();
    rejectGuard(error);
    controller.abort(error);
  };

  callerSignal?.addEventListener("abort", abortFromCaller, {
    once: true,
  });
  if (callerSignal?.aborted) abortFromCaller();

  try {
    const operation = Promise.resolve().then(() =>
      execute(controller.signal),
    );
    return await Promise.race([operation, guard]);
  } catch (error) {
    if (callerSignal?.aborted) {
      throw new LlmRequestAbortedError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function readBoundedResponseText(
  response: Response,
  maxResponseBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!response.body) throw new Error("LLM JSON response has no body");
  assertContentLengthWithinLimit(response, maxResponseBytes);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  const stopWatchingAbort = watchReaderAbort(reader, signal);

  try {
    while (true) {
      throwIfAborted(signal);
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > maxResponseBytes) {
        const error = new LlmResponseByteLimitError(maxResponseBytes);
        cancelReader(reader, error);
        throw error;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    stopWatchingAbort();
    reader.releaseLock();
  }
}

function assertContentLengthWithinLimit(
  response: Response,
  maxResponseBytes: number,
): void {
  const header = response.headers.get("content-length")?.trim();
  if (!header || !/^\d+$/.test(header)) return;
  if (Number(header) > maxResponseBytes) {
    throw new LlmResponseByteLimitError(maxResponseBytes);
  }
}

function watchReaderAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): () => void {
  if (!signal) return () => {};
  const abort = () => {
    cancelReader(reader, signal.reason);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return () => signal.removeEventListener("abort", abort);
}

function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): void {
  try {
    void reader.cancel(reason).catch(() => {});
  } catch {
    // The stream may already be errored, closed, or unlocked.
  }
}

async function parseJsonResponse(
  response: Response,
  mapping: JsonResponseMapping,
  maxResponseBytes: number,
  signal?: AbortSignal,
): Promise<ParsedResponse> {
  const payload: unknown = JSON.parse(
    await readBoundedResponseText(response, maxResponseBytes, signal),
  );
  return {
    text: textValue(getAtPath(payload, mapping.textPath)),
    toolCalls: parseToolCalls(
      getAtPath(payload, mapping.toolCallsPath),
      mapping.toolCall,
    ),
    finishReason: nullableString(
      getAtPath(payload, mapping.finishReasonPath),
    ),
    usage: readUsage(payload, mapping.usage),
  };
}

async function parseStreamResponse(
  response: Response,
  mapping: StreamResponseMapping,
  maxResponseBytes: number,
  signal?: AbortSignal,
): Promise<ParsedResponse> {
  if (!response.body) throw new Error("LLM stream response has no body");
  assertContentLengthWithinLimit(response, maxResponseBytes);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const streamTools = new Map<string, MutableStreamToolCall>();
  let text = "";
  let finishReason: string | null = null;
  let usage: LlmUsage = emptyUsage();
  let buffer = "";
  let sawDone = false;
  let receivedBytes = 0;
  const stopWatchingAbort = watchReaderAbort(reader, signal);

  const processPayload = (rawPayload: string): void => {
    const payloadText = stripStreamPrefix(rawPayload, mapping);
    if (payloadText === null) return;
    const doneSentinel = mapping.doneSentinel ?? "[DONE]";
    if (doneSentinel && payloadText.trim() === doneSentinel) {
      sawDone = true;
      return;
    }

    const payload: unknown = JSON.parse(payloadText);
    text += textValue(getAtPath(payload, mapping.textDeltaPath));
    const currentFinishReason = nullableString(
      getAtPath(payload, mapping.finishReasonPath),
    );
    if (currentFinishReason !== null) finishReason = currentFinishReason;
    mergeStreamToolCalls(
      streamTools,
      getAtPath(payload, mapping.toolCallsPath),
      mapping.toolCall,
    );
    usage = mergeUsage(usage, readUsage(payload, mapping.usage));
    if (
      mapping.doneWhen &&
      jsonEquals(
        getAtPath(payload, mapping.doneWhen.path),
        mapping.doneWhen.equals,
      )
    ) {
      sawDone = true;
    }
  };

  try {
    while (true) {
      throwIfAborted(signal);
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > maxResponseBytes) {
        cancelReader(
          reader,
          new LlmResponseByteLimitError(maxResponseBytes),
        );
        throw new LlmResponseByteLimitError(maxResponseBytes);
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = normalizeNewlines(buffer);
      buffer = drainStreamBuffer(buffer, mapping.format, processPayload);
      if (sawDone) {
        await reader.cancel();
        break;
      }
    }
    buffer += decoder.decode();
    buffer = normalizeNewlines(buffer);
    if (!sawDone && buffer.trim()) {
      processPayload(buffer);
      buffer = "";
    }
  } finally {
    stopWatchingAbort();
    reader.releaseLock();
  }

  if (!sawDone && !mapping.acceptEof) {
    throw new Error(
      "LLM stream ended before its terminal signal; partial output discarded",
    );
  }

  return {
    text,
    toolCalls: [...streamTools.values()].map(finalizeStreamToolCall),
    finishReason,
    usage,
  };
}

function drainStreamBuffer(
  source: string,
  format: StreamResponseMapping["format"],
  consume: (payload: string) => void,
): string {
  let buffer = source;
  const separator = format === "sse" ? "\n\n" : "\n";
  while (true) {
    const end = buffer.indexOf(separator);
    if (end < 0) return buffer;
    const payload = buffer.slice(0, end);
    buffer = buffer.slice(end + separator.length);
    if (payload.trim()) consume(payload);
  }
}

function stripStreamPrefix(
  rawPayload: string,
  mapping: StreamResponseMapping,
): string | null {
  if (mapping.format === "ndjson") return rawPayload.trim();
  const prefix = mapping.dataPrefix ?? "data:";
  const dataLines = rawPayload
    .split("\n")
    .filter((line) => line.trimStart().startsWith(prefix))
    .map((line) => {
      const trimmed = line.trimStart().slice(prefix.length);
      return trimmed.startsWith(" ") ? trimmed.slice(1) : trimmed;
    });
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseToolCalls(
  value: unknown,
  mapping: ToolCallMapping | undefined,
): LlmToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !mapping) {
    throw new Error("Mapped tool calls must be an array");
  }
  return value.map((item, index) => {
    const name = nullableString(getAtPath(item, mapping.namePath));
    if (!name) throw new Error("Mapped tool call is missing a name");
    return {
      id:
        nullableString(getAtPath(item, mapping.idPath)) ?? `tool-${index + 1}`,
      name,
      arguments: normalizeToolArguments(
        getAtPath(item, mapping.argumentsPath) ?? {},
      ),
    };
  });
}

function mergeStreamToolCalls(
  target: Map<string, MutableStreamToolCall>,
  value: unknown,
  mapping: ToolCallMapping | undefined,
): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || !mapping) {
    throw new Error("Mapped streaming tool calls must be an array");
  }
  value.forEach((item, index) => {
    const id =
      nullableString(getAtPath(item, mapping.idPath)) ?? `tool-${index + 1}`;
    const existing = target.get(id) ?? {
      id,
      name: "",
      argumentText: "",
    };
    const namePart = nullableString(getAtPath(item, mapping.namePath));
    if (namePart) existing.name = existing.name || namePart;
    const argumentPart = getAtPath(item, mapping.argumentsPath);
    if (typeof argumentPart === "string") {
      existing.argumentText += argumentPart;
    } else if (argumentPart !== undefined) {
      existing.argumentValue = asJsonValue(argumentPart) ?? null;
    }
    target.set(id, existing);
  });
}

function finalizeStreamToolCall(call: MutableStreamToolCall): LlmToolCall {
  if (!call.name) throw new Error("Mapped streaming tool call has no name");
  return {
    id: call.id,
    name: call.name,
    arguments:
      call.argumentValue ??
      (call.argumentText ? normalizeToolArguments(call.argumentText) : {}),
  };
}

function normalizeToolArguments(value: unknown): JsonValue {
  if (typeof value === "string") {
    try {
      return asJsonValue(JSON.parse(value)) ?? null;
    } catch {
      return value;
    }
  }
  return asJsonValue(value) ?? null;
}

function readUsage(root: unknown, mapping?: UsageMapping): LlmUsage {
  if (!mapping) return emptyUsage();
  const inputTokens = nonnegativeNumber(
    getAtPath(root, mapping.inputTokensPath),
  );
  const outputTokens = nonnegativeNumber(
    getAtPath(root, mapping.outputTokensPath),
  );
  const mappedTotal = nonnegativeNumber(
    getAtPath(root, mapping.totalTokensPath),
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      mappedTotal || (inputTokens > 0 || outputTokens > 0
        ? inputTokens + outputTokens
        : 0),
  };
}

function mergeUsage(previous: LlmUsage, next: LlmUsage): LlmUsage {
  return {
    inputTokens: next.inputTokens || previous.inputTokens,
    outputTokens: next.outputTokens || previous.outputTokens,
    totalTokens: next.totalTokens || previous.totalTokens,
  };
}

function emptyUsage(): LlmUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function nonnegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function textValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textValue).join("");
  return String(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LlmConfigurationError("JSON values must be finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => asJsonValue(item) ?? null);
  }
  if (typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      const json = asJsonValue(item);
      if (json !== undefined) result[key] = json;
    }
    return result;
  }
  return undefined;
}

function jsonEquals(left: unknown, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    error instanceof LlmRequestAbortedError
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LlmRequestAbortedError();
}

async function abortableSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new LlmRequestAbortedError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function expectRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmConfigurationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectInputRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmInputValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new LlmConfigurationError(`${label} must be an array`);
  }
  return value;
}

function expectInputArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new LlmInputValidationError(`${label} must be an array`);
  }
  return value;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new LlmConfigurationError(
        `${label} contains unsupported field ${key}`,
      );
    }
  }
}

function assertOnlyInputKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new LlmInputValidationError(
        `${label} contains unsupported field ${key}`,
      );
    }
  }
}

function expectConfigurationString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > maxLength
  ) {
    throw new LlmConfigurationError(`${label} must be a valid string`);
  }
  return value;
}

function parseOptionalConfigurationString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
): string | undefined {
  return value === undefined
    ? undefined
    : expectConfigurationString(value, label, maxLength, allowEmpty);
}

function expectInputString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new LlmInputValidationError(`${label} must be a valid string`);
  }
  return value;
}

function expectConfigurationIdentifier(
  value: unknown,
  label: string,
): string {
  const identifier = expectConfigurationString(value, label, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identifier)) {
    throw new LlmConfigurationError(`${label} is not a valid identifier`);
  }
  return identifier;
}

function expectInputIdentifier(value: unknown, label: string): string {
  const identifier = expectInputString(value, label, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identifier)) {
    throw new LlmInputValidationError(`${label} is not a valid identifier`);
  }
  return identifier;
}

function expectTicketIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new LlmInputValidationError(`${label} is not a valid ticket id`);
  }
  return value;
}

function expectFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new LlmConfigurationError(`${label} must be a finite number`);
  }
  return value;
}

function expectInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new LlmConfigurationError(`${label} must be an integer`);
  }
  return value as number;
}

function expectEndpointLimit(
  value: unknown,
  label: string,
  absoluteMaximum: number,
): number {
  const parsed = expectInteger(value, label);
  validateEndpointLimit(parsed, absoluteMaximum, label);
  return parsed;
}

function expectPositiveInputInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new LlmInputValidationError(
      `${label} must be a positive integer`,
    );
  }
  return value as number;
}

function expectConfigurationBoolean(
  value: unknown,
  label: string,
): boolean {
  if (typeof value !== "boolean") {
    throw new LlmConfigurationError(`${label} must be a boolean`);
  }
  return value;
}

function parseConfigurationStringArray(
  value: unknown,
  label: string,
  maximumLength: number,
  identifiers = false,
): string[] {
  const items = expectArray(value, label);
  if (items.length > maximumLength) {
    throw new LlmConfigurationError(
      `${label} cannot exceed ${maximumLength} entries`,
    );
  }
  const parsed = items.map((item, index) =>
    identifiers
      ? expectConfigurationIdentifier(item, `${label}[${index}]`)
      : expectConfigurationString(item, `${label}[${index}]`, 256),
  );
  if (new Set(parsed).size !== parsed.length) {
    throw new LlmConfigurationError(`${label} cannot contain duplicates`);
  }
  return parsed;
}

function validateHeaderName(name: string, label: string): void {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
    throw new LlmConfigurationError(`${label} contains an invalid header`);
  }
}

function expectConfigurationHeaderValue(
  value: unknown,
  label: string,
): string {
  if (
    typeof value !== "string" ||
    value.length > 8192 ||
    /[\r\n]/.test(value)
  ) {
    throw new LlmConfigurationError(`${label} is not a valid header value`);
  }
  return value;
}

function isSensitiveHeaderName(name: string): boolean {
  return (
    /authorization|authentication|api[-_]?key|token|secret|cookie|session|credential|password|passwd|bearer|signature|private[-_]?key/i.test(
      name,
    ) || /(?:^|[-_.])auth(?:$|[-_.])/i.test(name)
  );
}

function cloneConfigurationJsonObject(
  value: unknown,
  label: string,
): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmConfigurationError(`${label} must be a JSON object`);
  }
  validateConfigurationJsonTree(value, label, 0);
  return structuredClone(value) as JsonObject;
}

function cloneConfigurationJsonValue(
  value: unknown,
  label: string,
): JsonValue {
  validateConfigurationJsonTree(value, label, 0);
  return structuredClone(value) as JsonValue;
}

function cloneInputJsonObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmInputValidationError(`${label} must be a JSON object`);
  }
  validateInputJsonTree(value, label, 0);
  return structuredClone(value) as JsonObject;
}

function cloneInputJsonValue(value: unknown, label: string): JsonValue {
  validateInputJsonTree(value, label, 0);
  return structuredClone(value) as JsonValue;
}

function validateConfigurationJsonTree(
  value: unknown,
  label: string,
  depth: number,
): void {
  if (depth > 32) {
    throw new LlmConfigurationError(`${label} exceeds maximum JSON depth`);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateConfigurationJsonTree(item, `${label}[${index}]`, depth + 1),
    );
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (isUnsafeObjectKey(key)) {
        throw new LlmConfigurationError(
          `${label} contains unsafe key ${key}`,
        );
      }
      validateConfigurationJsonTree(item, `${label}.${key}`, depth + 1);
    }
    return;
  }
  throw new LlmConfigurationError(`${label} must contain only JSON values`);
}

function validateInputJsonTree(
  value: unknown,
  label: string,
  depth: number,
): void {
  if (depth > 32) {
    throw new LlmInputValidationError(
      `${label} exceeds maximum JSON depth`,
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateInputJsonTree(item, `${label}[${index}]`, depth + 1),
    );
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (isUnsafeObjectKey(key)) {
        throw new LlmInputValidationError(
          `${label} contains unsafe key ${key}`,
        );
      }
      validateInputJsonTree(item, `${label}.${key}`, depth + 1);
    }
    return;
  }
  throw new LlmInputValidationError(
    `${label} must contain only JSON values`,
  );
}

function isUnsafeObjectKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

function assertJsonByteSize(
  value: unknown,
  maximumBytes: number,
  label: string,
): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = undefined;
  }
  const tooLarge =
    serialized !== undefined &&
    new TextEncoder().encode(serialized).byteLength > maximumBytes;
  if (serialized === undefined || tooLarge) {
    if (label === "LLM invocation") {
      throw new LlmInputValidationError(
        `${label} must be valid JSON no larger than ${maximumBytes} bytes`,
      );
    }
    throw new LlmConfigurationError(
      `${label} must be valid JSON no larger than ${maximumBytes} bytes`,
    );
  }
}

function isUsableSecret(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 8192 &&
    !/[\r\n]/.test(value)
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
