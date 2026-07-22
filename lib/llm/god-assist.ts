import {
  AgentRoutineController,
  FixedAgentRegistry,
  LlmConfigurationError,
  LlmEndpointUnavailableError,
  LlmGateway,
  LlmInputValidationError,
  parseFixedAgentSystemDefinition,
  type FixedAgentDefinition,
  type HttpEndpointDefinition,
  type JsonObject,
  type LlmInvocationResult,
  type LlmMessage,
  type LlmToolDefinition,
} from "./index.ts";
import {
  CANONICAL_SYSTEM_PROMPT_STUB,
  DEFAULT_GOD_SYSTEM_PROMPT,
} from "./prompts/index.ts";

export { DEFAULT_GOD_SYSTEM_PROMPT } from "./prompts/index.ts";

export const GOD_ASSISTANT_AGENT_ID = "god-assistant" as const;

export const GOD_ASSIST_CAUSAL_EVENT_TYPES = Object.freeze([
  "micrometeoroid",
  "coolant-pump-seizure",
  "stellar-flare",
  "fusion-reactor-trip",
  "ring-bearing-degradation",
  "air-handler-trip",
  "water-processor-trip",
  "passenger-emergency",
] as const);

export const GOD_ASSIST_FORCE_FIELD_IDS = Object.freeze([
  "coolant-temperature",
  "generation",
  "oxygen-mass",
  "leak-area",
  "radiation-rate",
  "potable-water",
] as const);

export type GodAssistCausalEventType =
  (typeof GOD_ASSIST_CAUSAL_EVENT_TYPES)[number];
export type GodAssistForceFieldId =
  (typeof GOD_ASSIST_FORCE_FIELD_IDS)[number];

export type GodAssistPlanStep =
  | {
      kind: "causal-event";
      eventType: GodAssistCausalEventType;
      label: string;
    }
  | {
      kind: "force-override";
      fieldId: GodAssistForceFieldId;
      value: number;
      label: string;
    };

export interface GodAssistPlan {
  summary: string;
  steps: GodAssistPlanStep[];
}

export interface GodAssistantEndpointConfig {
  endpoint: HttpEndpointDefinition;
  systemPrompt?: string;
}

export interface PlayerAssistantsConfig {
  godAssistant?: GodAssistantEndpointConfig;
}

function resolveGodSystemPrompt(configured?: string): string {
  const trimmed = configured?.trim();
  if (!trimmed || trimmed === CANONICAL_SYSTEM_PROMPT_STUB) {
    return DEFAULT_GOD_SYSTEM_PROMPT;
  }
  return trimmed;
}

export const GOD_ASSIST_TOOLS = Object.freeze([
  {
    name: "trigger_causal_event",
    description:
      "触发单一因果事件。eventType 必须是允许的上帝因果事件之一。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["eventType", "label"],
      properties: {
        eventType: {
          type: "string",
          enum: [...GOD_ASSIST_CAUSAL_EVENT_TYPES],
        },
        label: { type: "string" },
      },
    },
  },
  {
    name: "apply_force_override",
    description:
      "对单一受支持字段做原力覆写。value 必须是有限非负数（按字段单位）。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fieldId", "value", "label"],
      properties: {
        fieldId: {
          type: "string",
          enum: [...GOD_ASSIST_FORCE_FIELD_IDS],
        },
        value: { type: "number" },
        label: { type: "string" },
      },
    },
  },
  {
    name: "apply_intervention_plan",
    description:
      "提交有序多步上帝干预计划。用于需要连带合理参数的复杂覆写。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "steps"],
      properties: {
        summary: { type: "string" },
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: {
              kind: {
                type: "string",
                enum: ["causal-event", "force-override"],
              },
              eventType: {
                type: "string",
                enum: [...GOD_ASSIST_CAUSAL_EVENT_TYPES],
              },
              fieldId: {
                type: "string",
                enum: [...GOD_ASSIST_FORCE_FIELD_IDS],
              },
              value: { type: "number" },
              label: { type: "string" },
            },
          },
        },
      },
    },
  },
]) as unknown as readonly LlmToolDefinition[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LlmInputValidationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function expectFiniteNonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new LlmInputValidationError(
      `${label} must be a finite non-negative number`,
    );
  }
  return value;
}

function isCausalEventType(value: string): value is GodAssistCausalEventType {
  return (GOD_ASSIST_CAUSAL_EVENT_TYPES as readonly string[]).includes(value);
}

function isForceFieldId(value: string): value is GodAssistForceFieldId {
  return (GOD_ASSIST_FORCE_FIELD_IDS as readonly string[]).includes(value);
}

export function parsePlayerAssistantsConfig(
  input: unknown,
): PlayerAssistantsConfig | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    throw new LlmConfigurationError("playerAssistants must be an object");
  }
  const unexpected = Object.keys(input).filter(
    (key) => key !== "godAssistant",
  );
  if (unexpected.length > 0) {
    throw new LlmConfigurationError(
      `playerAssistants has unsupported fields: ${unexpected.join(", ")}`,
    );
  }
  if (input.godAssistant === undefined) {
    return {};
  }
  if (!isRecord(input.godAssistant)) {
    throw new LlmConfigurationError(
      "playerAssistants.godAssistant must be an object",
    );
  }
  if (!isRecord(input.godAssistant.endpoint)) {
    throw new LlmConfigurationError(
      "playerAssistants.godAssistant.endpoint is required",
    );
  }
  const systemPrompt =
    input.godAssistant.systemPrompt === undefined
      ? undefined
      : expectString(
          input.godAssistant.systemPrompt,
          "playerAssistants.godAssistant.systemPrompt",
        );
  return {
    godAssistant: {
      endpoint: input.godAssistant.endpoint as unknown as HttpEndpointDefinition,
      ...(systemPrompt === undefined ? {} : { systemPrompt }),
    },
  };
}

/** Strip playerAssistants before ship topology expansion. */
export function splitLlmConfigurationRoot(raw: unknown): {
  shipConfiguration: unknown;
  playerAssistants?: PlayerAssistantsConfig;
} {
  if (!isRecord(raw)) {
    return { shipConfiguration: raw };
  }
  if (!Object.hasOwn(raw, "playerAssistants")) {
    return { shipConfiguration: raw };
  }
  const { playerAssistants: playerAssistantsRaw, ...shipConfiguration } = raw;
  return {
    shipConfiguration,
    playerAssistants: parsePlayerAssistantsConfig(playerAssistantsRaw),
  };
}

function buildGodAssistantAgent(
  config: GodAssistantEndpointConfig,
  routineLimits: {
    minSystemInfoIntervalSimSeconds: number;
    maxSystemInfoIntervalSimSeconds: number;
    maxDiscussionDepth: number;
    maxDiscussionRounds: number;
  },
): FixedAgentDefinition {
  return {
    id: GOD_ASSISTANT_AGENT_ID,
    role: "世界外上帝模式助手",
    systemPrompt: resolveGodSystemPrompt(config.systemPrompt),
    permissions: ["ship:read-all"],
    canSendTo: [],
    routineDefaults: {
      systemInfoIntervalSimSeconds: Math.max(
        routineLimits.minSystemInfoIntervalSimSeconds,
        3_600,
      ),
      discussionDepth: 1,
      discussionRounds: 1,
    },
    endpoint: config.endpoint,
  };
}

export function parseGodAssistPlanFromToolCalls(
  toolCalls: readonly {
    name: string;
    arguments: Record<string, unknown>;
  }[],
): GodAssistPlan {
  if (toolCalls.length === 0) {
    throw new LlmInputValidationError(
      "God assistant must call at least one intervention tool",
    );
  }
  if (toolCalls.length > 8) {
    throw new LlmInputValidationError(
      "God assistant cannot return more than 8 tool calls",
    );
  }

  const steps: GodAssistPlanStep[] = [];
  let summary = "上帝干预计划";

  for (const toolCall of toolCalls) {
    if (toolCall.name === "trigger_causal_event") {
      const eventType = expectString(
        toolCall.arguments.eventType,
        "eventType",
      );
      if (!isCausalEventType(eventType)) {
        throw new LlmInputValidationError(
          `Unsupported causal eventType: ${eventType}`,
        );
      }
      steps.push({
        kind: "causal-event",
        eventType,
        label: expectString(toolCall.arguments.label, "label"),
      });
      continue;
    }
    if (toolCall.name === "apply_force_override") {
      const fieldId = expectString(toolCall.arguments.fieldId, "fieldId");
      if (!isForceFieldId(fieldId)) {
        throw new LlmInputValidationError(
          `Unsupported force fieldId: ${fieldId}`,
        );
      }
      steps.push({
        kind: "force-override",
        fieldId,
        value: expectFiniteNonNegative(toolCall.arguments.value, "value"),
        label: expectString(toolCall.arguments.label, "label"),
      });
      continue;
    }
    if (toolCall.name === "apply_intervention_plan") {
      summary = expectString(toolCall.arguments.summary, "summary");
      if (!Array.isArray(toolCall.arguments.steps)) {
        throw new LlmInputValidationError("steps must be an array");
      }
      if (
        toolCall.arguments.steps.length < 1 ||
        toolCall.arguments.steps.length > 8
      ) {
        throw new LlmInputValidationError(
          "steps must contain between 1 and 8 entries",
        );
      }
      for (const [index, rawStep] of toolCall.arguments.steps.entries()) {
        if (!isRecord(rawStep)) {
          throw new LlmInputValidationError(`steps[${index}] must be an object`);
        }
        const kind = expectString(rawStep.kind, `steps[${index}].kind`);
        if (kind === "causal-event") {
          const eventType = expectString(
            rawStep.eventType,
            `steps[${index}].eventType`,
          );
          if (!isCausalEventType(eventType)) {
            throw new LlmInputValidationError(
              `Unsupported causal eventType: ${eventType}`,
            );
          }
          steps.push({
            kind: "causal-event",
            eventType,
            label: expectString(
              rawStep.label ?? eventType,
              `steps[${index}].label`,
            ),
          });
        } else if (kind === "force-override") {
          const fieldId = expectString(
            rawStep.fieldId,
            `steps[${index}].fieldId`,
          );
          if (!isForceFieldId(fieldId)) {
            throw new LlmInputValidationError(
              `Unsupported force fieldId: ${fieldId}`,
            );
          }
          steps.push({
            kind: "force-override",
            fieldId,
            value: expectFiniteNonNegative(
              rawStep.value,
              `steps[${index}].value`,
            ),
            label: expectString(
              rawStep.label ?? fieldId,
              `steps[${index}].label`,
            ),
          });
        } else {
          throw new LlmInputValidationError(
            `Unsupported step kind: ${kind}`,
          );
        }
      }
      continue;
    }
    throw new LlmInputValidationError(
      `Unsupported god-assist tool: ${toolCall.name}`,
    );
  }

  if (steps.length === 0) {
    throw new LlmInputValidationError("God assist plan has no executable steps");
  }
  return { summary, steps };
}

export class GodAssistRuntime {
  readonly #gateway: LlmGateway;
  readonly #registry: FixedAgentRegistry;
  readonly #readEnvironment: (name: string) => string | undefined;

  constructor(
    config: GodAssistantEndpointConfig,
    options: {
      fetch: typeof fetch;
      readEnvironment: (name: string) => string | undefined;
      retry?: ConstructorParameters<typeof LlmGateway>[1]["retry"];
      sleep?: ConstructorParameters<typeof LlmGateway>[1]["sleep"];
    },
  ) {
    const definition = parseFixedAgentSystemDefinition({
      routineLimits: {
        minSystemInfoIntervalSimSeconds: 30,
        maxSystemInfoIntervalSimSeconds: 86_400,
        maxDiscussionDepth: 2,
        maxDiscussionRounds: 2,
      },
      agents: [
        buildGodAssistantAgent(config, {
          minSystemInfoIntervalSimSeconds: 30,
          maxSystemInfoIntervalSimSeconds: 86_400,
          maxDiscussionDepth: 2,
          maxDiscussionRounds: 2,
        }),
      ],
    });
    this.#registry = new FixedAgentRegistry(definition);
    this.#readEnvironment = options.readEnvironment;
    const routines = new AgentRoutineController(this.#registry);
    this.#gateway = new LlmGateway(this.#registry, {
      fetch: options.fetch,
      resolveSecret: (secretRef) => {
        const value = this.#readEnvironment(secretRef);
        if (typeof value !== "string" || value.trim().length === 0) {
          throw new Error(`Required secret ${secretRef} is unavailable`);
        }
        return value;
      },
      routines,
      retry: options.retry,
      sleep: options.sleep,
    });
  }

  async invoke(input: {
    messages: LlmMessage[];
    metadata?: JsonObject;
    signal?: AbortSignal;
  }): Promise<LlmInvocationResult & { plan: GodAssistPlan }> {
    const agent = this.#registry.get(GOD_ASSISTANT_AGENT_ID);
    const hasEverySecret = (agent.endpoint.secretHeaders ?? []).every(
      (reference) => {
        const value = this.#readEnvironment(reference.secretRef);
        return typeof value === "string" && value.trim().length > 0;
      },
    );
    if (!hasEverySecret) {
      throw new LlmEndpointUnavailableError(GOD_ASSISTANT_AGENT_ID);
    }

    const result = await this.#gateway.invoke({
      agentId: GOD_ASSISTANT_AGENT_ID,
      messages: input.messages,
      tools: GOD_ASSIST_TOOLS,
      metadata: input.metadata,
      signal: input.signal,
    });

    const plan = parseGodAssistPlanFromToolCalls(
      result.toolCalls.map((toolCall) => {
        let args: Record<string, unknown> = {};
        if (
          typeof toolCall.arguments === "object" &&
          toolCall.arguments !== null &&
          !Array.isArray(toolCall.arguments)
        ) {
          args = toolCall.arguments as Record<string, unknown>;
        } else if (typeof toolCall.arguments === "string") {
          try {
            const parsed = JSON.parse(toolCall.arguments) as unknown;
            if (
              typeof parsed === "object" &&
              parsed !== null &&
              !Array.isArray(parsed)
            ) {
              args = parsed as Record<string, unknown>;
            }
          } catch {
            throw new LlmInputValidationError(
              `Tool ${toolCall.name} arguments are not valid JSON`,
            );
          }
        }
        return { name: toolCall.name, arguments: args };
      }),
    );
    return { ...result, plan };
  }
}
