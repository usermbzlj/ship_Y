import exampleConfiguration from "@/config/llm.example.json";
import {
  expandFarHorizonFixedTopology,
  FAR_HORIZON_DEPARTMENT_AGENT_IDS,
  FAR_HORIZON_KEY_PASSENGER_AGENT_IDS,
} from "@/lib/llm/fixed-topology";
import {
  GodAssistRuntime,
  splitLlmConfigurationRoot,
  type PlayerAssistantsConfig,
} from "@/lib/llm/god-assist";
import {
  AgentPermissionError,
  FixedLlmServerRuntime,
  InvalidRoutineToolArgumentsError,
  LlmConfigurationError,
  LlmEndpointUnavailableError,
  LlmInputValidationError,
  LlmProviderHttpError,
  LlmRequestAbortedError,
  MAX_LLM_INVOKE_BODY_BYTES,
  RoutineTicketConsumedError,
  RoutineTicketExpiredError,
  RoutineTicketNotFoundError,
  UnsupportedRoutineToolError,
  UnknownAgentError,
  type LlmMessage,
} from "@/lib/llm";

class HttpRequestValidationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpRequestValidationError";
    this.status = status;
  }
}

let cachedSource: string | undefined;
let cachedRuntime: FixedLlmServerRuntime | undefined;
let cachedGodAssistRuntime: GodAssistRuntime | undefined;
let cachedPlayerAssistants: PlayerAssistantsConfig | undefined;

const PUBLIC_CAPTAIN_CONSULTANT_IDS = new Set<string>(
  FAR_HORIZON_DEPARTMENT_AGENT_IDS.filter(
    (agentId) =>
      agentId !== "captain" &&
      agentId !== "passenger-service",
  ),
);
const PUBLIC_KEY_PASSENGER_IDS = new Set<string>(
  FAR_HORIZON_KEY_PASSENGER_AGENT_IDS,
);
const PUBLIC_INVOCATION_CONCURRENCY_LIMIT = 4;
const PUBLIC_PASSENGER_CONCURRENCY_LIMIT = 1;
let activePublicInvocations = 0;
let activePassengerInvocations = 0;

type PublicInvocationKind =
  | "captain-decision"
  | "captain-consultation"
  | "passenger-self"
  | "god-assist";

export type NormalizedPublicLlmInvocation =
  | {
      kind: "captain-decision" | "captain-consultation" | "passenger-self";
      invocation: unknown;
    }
  | NormalizedGodAssistInvocation;

export interface NormalizedGodAssistInvocation {
  kind: "god-assist";
  messages: LlmMessage[];
  worldContext?: Record<string, unknown>;
  previousRejection?: string;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const expected = new Set(expectedKeys);
  const unexpected = Object.keys(value).filter(
    (key) => !expected.has(key),
  );
  if (unexpected.length > 0) {
    throw new HttpRequestValidationError(
      `${label} has unsupported fields: ${unexpected.join(", ")}`,
      400,
    );
  }
}

function expectPublicString(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength
  ) {
    throw new HttpRequestValidationError(
      `${label} must be a non-empty string no longer than ${maximumLength} characters`,
      400,
    );
  }
  return value;
}

function expectPublicFiniteNumber(
  value: unknown,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new HttpRequestValidationError(
      `${label} must be a finite non-negative number`,
      400,
    );
  }
  return value;
}

function expectPublicEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (
    typeof value !== "string" ||
    !allowed.includes(value as T)
  ) {
    throw new HttpRequestValidationError(
      `${label} is outside the fixed allowlist`,
      400,
    );
  }
  return value as T;
}

function expectPublicZoneId(
  value: unknown,
  label: string,
): string {
  const zoneId = expectPublicString(value, label, 4);
  if (!/^[AB]-(?:0[1-9]|1\d|2[0-4])$/.test(zoneId)) {
    throw new HttpRequestValidationError(
      `${label} is not one of the 48 fixed pressure zones`,
      400,
    );
  }
  return zoneId;
}

function expectPublicInvocation(
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(input.invocation)) {
    throw new HttpRequestValidationError(
      "Public LLM invocation.invocation must be an object",
      400,
    );
  }
  if (
    "agentId" in input.invocation ||
    "fromAgentId" in input.invocation
  ) {
    throw new HttpRequestValidationError(
      "Public callers cannot choose or impersonate an LLM agent identity",
      403,
    );
  }
  return input.invocation;
}

function normalizePassengerSelfInvocation(
  input: Record<string, unknown>,
): NormalizedPublicLlmInvocation {
  assertOnlyKeys(
    input,
    [
      "intent",
      "passengerId",
      "pollId",
      "selfObservation",
      "publicContext",
      "previousOwnNote",
    ],
    "passenger-self request",
  );
  const passengerId = expectPublicString(
    input.passengerId,
    "passengerId",
    64,
  );
  if (!PUBLIC_KEY_PASSENGER_IDS.has(passengerId)) {
    throw new HttpRequestValidationError(
      "passengerId is not one of the fixed key-passenger slots",
      403,
    );
  }
  const pollId = expectPublicString(input.pollId, "pollId", 128);
  const previousOwnNote =
    input.previousOwnNote === null ||
    input.previousOwnNote === undefined
      ? null
      : expectPublicString(
          input.previousOwnNote,
          "previousOwnNote",
          512,
        );
  if (!isRecord(input.selfObservation)) {
    throw new HttpRequestValidationError(
      "selfObservation must be an object",
      400,
    );
  }
  assertOnlyKeys(
    input.selfObservation,
    [
      "passengerId",
      "sampledAtSimulationSeconds",
      "sampleAgeSeconds",
      "displayName",
      "occupation",
      "cabinId",
      "assignedZoneId",
      "assignedZoneCondition",
      "observedPressureBand",
      "lifeState",
      "physicalHealthBand",
      "medicalStabilityBand",
      "psychologicalStabilityBand",
      "stressBand",
      "trustBand",
    ],
    "selfObservation",
  );
  const observedPassengerId = expectPublicString(
    input.selfObservation.passengerId,
    "selfObservation.passengerId",
    64,
  );
  if (observedPassengerId !== passengerId) {
    throw new HttpRequestValidationError(
      "The fixed passenger identity must match selfObservation.passengerId",
      403,
    );
  }
  const selfObservation = {
    passengerId,
    sampledAtSimulationSeconds: expectPublicFiniteNumber(
      input.selfObservation.sampledAtSimulationSeconds,
      "selfObservation.sampledAtSimulationSeconds",
    ),
    sampleAgeSeconds: expectPublicFiniteNumber(
      input.selfObservation.sampleAgeSeconds,
      "selfObservation.sampleAgeSeconds",
    ),
    displayName: expectPublicString(
      input.selfObservation.displayName,
      "selfObservation.displayName",
      128,
    ),
    occupation: expectPublicString(
      input.selfObservation.occupation,
      "selfObservation.occupation",
      128,
    ),
    cabinId: expectPublicString(
      input.selfObservation.cabinId,
      "selfObservation.cabinId",
      64,
    ),
    assignedZoneId: expectPublicZoneId(
      input.selfObservation.assignedZoneId,
      "selfObservation.assignedZoneId",
    ),
    assignedZoneCondition: expectPublicEnum(
      input.selfObservation.assignedZoneCondition,
      ["nominal", "watch", "critical", "offline"] as const,
      "selfObservation.assignedZoneCondition",
    ),
    observedPressureBand: expectPublicEnum(
      input.selfObservation.observedPressureBand,
      ["unknown", "low", "nominal", "high"] as const,
      "selfObservation.observedPressureBand",
    ),
    lifeState: expectPublicEnum(
      input.selfObservation.lifeState,
      ["awake"] as const,
      "selfObservation.lifeState",
    ),
    physicalHealthBand: expectPublicEnum(
      input.selfObservation.physicalHealthBand,
      ["stable", "watch", "critical"] as const,
      "selfObservation.physicalHealthBand",
    ),
    medicalStabilityBand: expectPublicEnum(
      input.selfObservation.medicalStabilityBand,
      ["stable", "watch", "critical"] as const,
      "selfObservation.medicalStabilityBand",
    ),
    psychologicalStabilityBand: expectPublicEnum(
      input.selfObservation.psychologicalStabilityBand,
      ["stable", "watch", "critical"] as const,
      "selfObservation.psychologicalStabilityBand",
    ),
    stressBand: expectPublicEnum(
      input.selfObservation.stressBand,
      ["low", "moderate", "high"] as const,
      "selfObservation.stressBand",
    ),
    trustBand: expectPublicEnum(
      input.selfObservation.trustBand,
      ["low", "mixed", "high"] as const,
      "selfObservation.trustBand",
    ),
  };

  if (!isRecord(input.publicContext)) {
    throw new HttpRequestValidationError(
      "publicContext must be an object",
      400,
    );
  }
  assertOnlyKeys(
    input.publicContext,
    [
      "origin",
      "destination",
      "elapsedSimulationSeconds",
    ],
    "publicContext",
  );
  const publicContext = {
    origin: expectPublicString(
      input.publicContext.origin,
      "publicContext.origin",
      128,
    ),
    destination: expectPublicString(
      input.publicContext.destination,
      "publicContext.destination",
      128,
    ),
    elapsedSimulationSeconds: expectPublicFiniteNumber(
      input.publicContext.elapsedSimulationSeconds,
      "publicContext.elapsedSimulationSeconds",
    ),
  };

  return {
    kind: "passenger-self",
    invocation: {
      agentId: passengerId,
      fromAgentId: "passenger-service",
      messages: [
        {
          role: "user",
          content: {
            channel:
              "个人终端授权摘要；仅含该乘员自己的延迟状态分级与公开航线公告",
            pollId,
            selfObservation,
            publicContext,
            previousOwnNote,
            instruction:
              "请以该乘员自身身份简短表达当前体验、需求或建议。不得假定自己看到了其他乘员资料，不得声称设备命令已经执行，也不得请求或创建其他代理。",
          },
        },
      ],
      metadata: {
        intent: "passenger-self",
        privacyScope: "one-fixed-passenger",
        pollId,
      },
      discussion: { depth: 1, round: 1 },
    },
  };
}

export function getLlmServerRuntime(): FixedLlmServerRuntime {
  ensureLlmRuntimesLoaded();
  if (!cachedRuntime) {
    throw new LlmConfigurationError("LLM runtime failed to initialize");
  }
  return cachedRuntime;
}

export function getGodAssistRuntime(): GodAssistRuntime {
  ensureLlmRuntimesLoaded();
  if (!cachedGodAssistRuntime) {
    throw new LlmConfigurationError(
      "God assistant is not configured (playerAssistants.godAssistant missing)",
    );
  }
  return cachedGodAssistRuntime;
}

function ensureLlmRuntimesLoaded(): void {
  const configuredJson = process.env.LLM_CONFIG_JSON?.trim();
  const source = configuredJson || "__bundled_example__";
  if (cachedRuntime && cachedSource === source) {
    return;
  }

  let definition: unknown = exampleConfiguration;
  if (configuredJson) {
    try {
      definition = JSON.parse(configuredJson);
    } catch {
      throw new LlmConfigurationError(
        "LLM_CONFIG_JSON is not valid JSON",
      );
    }
  }

  const split = splitLlmConfigurationRoot(definition);
  cachedPlayerAssistants = split.playerAssistants;
  cachedRuntime = new FixedLlmServerRuntime(
    expandFarHorizonFixedTopology(split.shipConfiguration),
    {
      fetch: (input, init) => globalThis.fetch(input, init),
      readEnvironment: (name) => process.env[name],
    },
  );

  cachedGodAssistRuntime = undefined;
  const godAssistant = cachedPlayerAssistants?.godAssistant;
  if (godAssistant) {
    cachedGodAssistRuntime = new GodAssistRuntime(godAssistant, {
      fetch: (input, init) => globalThis.fetch(input, init),
      readEnvironment: (name) => process.env[name],
    });
  } else if (!configuredJson) {
    // Bundled example: derive god assistant from captain endpoint template.
    const example = exampleConfiguration as {
      agents: Array<{ id: string; endpoint: unknown }>;
    };
    const captain = example.agents.find((agent) => agent.id === "captain");
    if (captain?.endpoint) {
      cachedGodAssistRuntime = new GodAssistRuntime(
        {
          endpoint: captain.endpoint as never,
        },
        {
          fetch: (input, init) => globalThis.fetch(input, init),
          readEnvironment: (name) => process.env[name],
        },
      );
    }
  }

  cachedSource = source;
}

function normalizeGodAssistInvocation(
  input: Record<string, unknown>,
): NormalizedGodAssistInvocation {
  assertOnlyKeys(
    input,
    ["intent", "messages", "worldContext", "previousRejection"],
    "god-assist request",
  );
  if (!Array.isArray(input.messages) || input.messages.length < 1) {
    throw new HttpRequestValidationError(
      "god-assist messages must be a non-empty array",
      400,
    );
  }
  if (input.messages.length > 32) {
    throw new HttpRequestValidationError(
      "god-assist messages cannot exceed 32 entries",
      400,
    );
  }
  const messages: LlmMessage[] = input.messages.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new HttpRequestValidationError(
        `messages[${index}] must be an object`,
        400,
      );
    }
    assertOnlyKeys(
      entry,
      ["role", "content"],
      `messages[${index}]`,
    );
    const role = expectPublicString(entry.role, `messages[${index}].role`, 32);
    if (role !== "user" && role !== "assistant" && role !== "system") {
      throw new HttpRequestValidationError(
        `messages[${index}].role must be user, assistant, or system`,
        400,
      );
    }
    if (typeof entry.content !== "string" || entry.content.length < 1) {
      throw new HttpRequestValidationError(
        `messages[${index}].content must be a non-empty string`,
        400,
      );
    }
    if (entry.content.length > 8_000) {
      throw new HttpRequestValidationError(
        `messages[${index}].content is too long`,
        400,
      );
    }
    return { role, content: entry.content };
  });

  let worldContext: Record<string, unknown> | undefined;
  if (input.worldContext !== undefined) {
    if (!isRecord(input.worldContext)) {
      throw new HttpRequestValidationError(
        "worldContext must be an object",
        400,
      );
    }
    worldContext = input.worldContext;
  }

  let previousRejection: string | undefined;
  if (input.previousRejection !== undefined) {
    previousRejection = expectPublicString(
      input.previousRejection,
      "previousRejection",
      2_000,
    );
  }

  return {
    kind: "god-assist",
    messages,
    ...(worldContext === undefined ? {} : { worldContext }),
    ...(previousRejection === undefined ? {} : { previousRejection }),
  };
}

export function assertTrustedLocalRequest(
  request: Request,
): void {
  const requestUrl = new URL(request.url);
  const loopbackHost =
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname === "127.0.0.1" ||
    requestUrl.hostname === "[::1]" ||
    requestUrl.hostname === "::1";
  if (!loopbackHost) {
    throw new HttpRequestValidationError(
      "LLM mutation routes are restricted to this single-player loopback UI",
      403,
    );
  }
  const origin = request.headers.get("origin");
  if (origin !== requestUrl.origin) {
    throw new HttpRequestValidationError(
      "LLM mutation routes require a same-origin browser request",
      403,
    );
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    fetchSite !== null &&
    fetchSite !== "same-origin"
  ) {
    throw new HttpRequestValidationError(
      "Cross-site LLM mutation requests are forbidden",
      403,
    );
  }
}

export function normalizePublicLlmInvocation(
  input: unknown,
): NormalizedPublicLlmInvocation {
  if (!isRecord(input)) {
    throw new HttpRequestValidationError(
      "Public LLM invocation must be an object",
      400,
    );
  }
  if (input.intent === "passenger-self") {
    return normalizePassengerSelfInvocation(input);
  }
  if (input.intent === "god-assist") {
    return normalizeGodAssistInvocation(input);
  }

  if (input.intent === "captain-decision") {
    const invocation = expectPublicInvocation(input);
    assertOnlyKeys(
      input,
      ["intent", "invocation"],
      "captain-decision request",
    );
    return {
      kind: "captain-decision",
      invocation: {
        ...invocation,
        agentId: "captain",
      },
    };
  }
  if (input.intent === "captain-consultation") {
    const invocation = expectPublicInvocation(input);
    assertOnlyKeys(
      input,
      ["intent", "consultantId", "invocation"],
      "captain-consultation request",
    );
    if (
      typeof input.consultantId !== "string" ||
      !PUBLIC_CAPTAIN_CONSULTANT_IDS.has(input.consultantId)
    ) {
      throw new HttpRequestValidationError(
        "consultantId is not in the fixed captain consultation allowlist",
        403,
      );
    }
    return {
      kind: "captain-consultation",
      invocation: {
        ...invocation,
        agentId: input.consultantId,
        fromAgentId: "captain",
      },
    };
  }
  throw new HttpRequestValidationError(
    "Unsupported public LLM invocation intent",
    400,
  );
}

export async function invokePublicLlm(
  input: unknown,
  signal?: AbortSignal,
) {
  const normalized = normalizePublicLlmInvocation(input);
  if (
    activePublicInvocations >=
    PUBLIC_INVOCATION_CONCURRENCY_LIMIT
  ) {
    throw new HttpRequestValidationError(
      "The local LLM gateway concurrency limit is busy",
      429,
    );
  }
  if (
    normalized.kind === "passenger-self" &&
    activePassengerInvocations >=
      PUBLIC_PASSENGER_CONCURRENCY_LIMIT
  ) {
    throw new HttpRequestValidationError(
      "Only one key-passenger model call may run at a time",
      429,
    );
  }

  activePublicInvocations += 1;
  if (normalized.kind === "passenger-self") {
    activePassengerInvocations += 1;
  }
  try {
    if (normalized.kind === "god-assist") {
      const godRequest = normalized as NormalizedGodAssistInvocation;
      const runtime = getGodAssistRuntime();
      const contextMessages: LlmMessage[] = [];
      if (godRequest.worldContext) {
        contextMessages.push({
          role: "system",
          content:
            "当前只读观测摘要（非世界真值）：\n" +
            JSON.stringify(godRequest.worldContext),
        });
      }
      if (godRequest.previousRejection) {
        contextMessages.push({
          role: "system",
          content:
            "上一份干预计划被物理引擎拒绝，请修正参数后重新提交工具调用。拒收原因：\n" +
            godRequest.previousRejection,
        });
      }
      const result = await runtime.invoke({
        messages: [...contextMessages, ...godRequest.messages],
        metadata: {
          intent: "god-assist",
          privacyScope: "player-side-god-mode",
        },
        signal,
      });
      return {
        text: result.text,
        toolCalls: result.toolCalls,
        usage: result.usage,
        plan: result.plan,
        agentId: "god-assistant",
      };
    }
    return await getLlmServerRuntime().invoke(
      normalized.invocation,
      signal,
    );
  } finally {
    activePublicInvocations -= 1;
    if (normalized.kind === "passenger-self") {
      activePassengerInvocations -= 1;
    }
  }
}

export async function readStrictJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpRequestValidationError(
      "Content-Type must be application/json",
      415,
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isInteger(length) || length < 0) {
      throw new HttpRequestValidationError(
        "Content-Length is invalid",
        400,
      );
    }
    if (length > MAX_LLM_INVOKE_BODY_BYTES) {
      throw new HttpRequestValidationError(
        "Request body is too large",
        413,
      );
    }
  }

  const text = await request.text();
  if (
    new TextEncoder().encode(text).byteLength > MAX_LLM_INVOKE_BODY_BYTES
  ) {
    throw new HttpRequestValidationError("Request body is too large", 413);
  }
  if (!text.trim()) {
    throw new HttpRequestValidationError("Request body is empty", 400);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpRequestValidationError(
      "Request body is not valid JSON",
      400,
    );
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function routeErrorResponse(error: unknown): Response {
  if (error instanceof HttpRequestValidationError) {
    return jsonError("INVALID_HTTP_REQUEST", error.message, error.status);
  }
  if (error instanceof LlmInputValidationError) {
    return jsonError("INVALID_INVOCATION", error.message, 400);
  }
  if (error instanceof AgentPermissionError) {
    return jsonError("AGENT_PERMISSION_FORBIDDEN", error.message, 403);
  }
  if (error instanceof UnknownAgentError) {
    return jsonError("UNKNOWN_FIXED_AGENT", error.message, 404);
  }
  if (
    error instanceof LlmEndpointUnavailableError ||
    error instanceof LlmConfigurationError
  ) {
    return jsonError("LLM_NOT_CONFIGURED", error.message, 503);
  }
  if (error instanceof LlmRequestAbortedError) {
    return jsonError("INVOCATION_ABORTED", error.message, 408);
  }
  if (error instanceof LlmProviderHttpError) {
    return jsonError("LLM_PROVIDER_REJECTED", error.message, 502);
  }
  if (error instanceof RoutineTicketNotFoundError) {
    return jsonError("ROUTINE_TICKET_NOT_FOUND", error.message, 404);
  }
  if (error instanceof RoutineTicketConsumedError) {
    return jsonError("ROUTINE_TICKET_CONSUMED", error.message, 409);
  }
  if (error instanceof RoutineTicketExpiredError) {
    return jsonError("ROUTINE_TICKET_EXPIRED", error.message, 410);
  }
  if (error instanceof UnsupportedRoutineToolError) {
    return jsonError("UNSUPPORTED_ROUTINE_TOOL", error.message, 422);
  }
  if (error instanceof InvalidRoutineToolArgumentsError) {
    return jsonError(
      "INVALID_ROUTINE_TOOL_ARGUMENTS",
      error.message,
      422,
    );
  }
  return jsonError(
    "LLM_GATEWAY_ERROR",
    "The server could not complete the LLM invocation",
    502,
  );
}

function jsonError(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}
