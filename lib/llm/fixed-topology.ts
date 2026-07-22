import { DEFAULT_KEY_LLM_PASSENGER_IDS } from "../sim/passengers.ts";
import {
  FixedAgentRegistry,
  LlmConfigurationError,
  parseFixedAgentSystemDefinition,
} from "./index.ts";
import type {
  FixedAgentDefinition,
  FixedAgentSystemDefinition,
} from "./index";
import {
  applyCanonicalSystemPrompts,
  keyPassengerSystemPrompt,
} from "./prompts/index.ts";

export const FAR_HORIZON_FIXED_TOPOLOGY_KIND =
  "far-horizon-fixed-40-v1" as const;
export const FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID =
  "passenger-service" as const;

export const FAR_HORIZON_DEPARTMENT_AGENT_IDS = Object.freeze([
  "captain",
  "navigation",
  "engineering",
  "life-support",
  "medical",
  "passenger-affairs",
  "security",
  FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID,
] as const);

export const FAR_HORIZON_KEY_PASSENGER_AGENT_IDS: readonly string[] =
  Object.freeze([...DEFAULT_KEY_LLM_PASSENGER_IDS]);

export const FAR_HORIZON_FIXED_AGENT_IDS: readonly string[] = Object.freeze([
  ...FAR_HORIZON_DEPARTMENT_AGENT_IDS,
  ...FAR_HORIZON_KEY_PASSENGER_AGENT_IDS,
]);

export interface FarHorizonFixedTopologyExpansion {
  kind: typeof FAR_HORIZON_FIXED_TOPOLOGY_KIND;
  expandPassengerSlotsFrom: typeof FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID;
}

type UnknownRecord = Record<string, unknown>;

const KEY_PASSENGER_PERMISSIONS = Object.freeze([
  "llm:routine:configure-self",
  "passenger:self-observe",
  "ship:communicate",
]);

const DEPARTMENT_POLICY: Readonly<
  Record<
    (typeof FAR_HORIZON_DEPARTMENT_AGENT_IDS)[number],
    Readonly<{
      permissions: readonly string[];
      canSendTo: readonly string[];
    }>
  >
> = Object.freeze({
  captain: {
    permissions: [
      "llm:routine:configure-self",
      "ship:command",
      "ship:read-all",
      "ship:communicate",
    ],
    canSendTo: [
      "navigation",
      "engineering",
      "life-support",
      "medical",
      "passenger-affairs",
      "security",
      "passenger-service",
    ],
  },
  navigation: {
    permissions: [
      "llm:routine:configure-self",
      "navigation:read",
      "navigation:command",
      "ship:communicate",
    ],
    canSendTo: ["captain", "engineering"],
  },
  engineering: {
    permissions: [
      "llm:routine:configure-self",
      "engineering:read",
      "engineering:command",
      "ship:communicate",
    ],
    canSendTo: ["captain", "navigation", "life-support"],
  },
  "life-support": {
    permissions: [
      "llm:routine:configure-self",
      "life-support:read",
      "life-support:command",
      "ship:communicate",
    ],
    canSendTo: ["captain", "engineering", "medical"],
  },
  medical: {
    permissions: [
      "llm:routine:configure-self",
      "medical:read",
      "medical:command",
      "ship:communicate",
    ],
    canSendTo: ["captain", "life-support", "passenger-affairs"],
  },
  "passenger-affairs": {
    permissions: [
      "llm:routine:configure-self",
      "passenger-affairs:read",
      "passenger-affairs:command",
      "ship:communicate",
    ],
    canSendTo: [
      "captain",
      "medical",
      "security",
      "passenger-service",
    ],
  },
  security: {
    permissions: [
      "llm:routine:configure-self",
      "security:read",
      "security:command",
      "ship:communicate",
    ],
    canSendTo: ["captain", "passenger-affairs"],
  },
  "passenger-service": {
    permissions: [
      "llm:routine:configure-self",
      "passenger-service:read",
      "passenger-service:command",
      "ship:communicate",
    ],
    canSendTo: [
      "captain",
      "passenger-affairs",
      "medical",
      ...FAR_HORIZON_KEY_PASSENGER_AGENT_IDS,
    ],
  },
});

function isRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function assertOnlyKeys(
  value: UnknownRecord,
  keys: readonly string[],
  label: string,
): void {
  const expected = new Set(keys);
  const unexpected = Object.keys(value).filter(
    (key) => !expected.has(key),
  );
  if (unexpected.length > 0) {
    throw new LlmConfigurationError(
      `${label} has unsupported fields: ${unexpected.join(", ")}`,
    );
  }
}

function assertExactAgentOrder(
  agents: readonly FixedAgentDefinition[],
  expectedIds: readonly string[],
  label: string,
): void {
  const actualIds = agents.map((agent) => agent.id);
  if (
    actualIds.length !== expectedIds.length ||
    actualIds.some((id, index) => id !== expectedIds[index])
  ) {
    throw new LlmConfigurationError(
      `${label} must define the fixed agents in this exact order: ${expectedIds.join(", ")}`,
    );
  }
}

function assertSameStringSet(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some(
      (value, index) => value !== sortedExpected[index],
    )
  ) {
    throw new LlmConfigurationError(
      `${label} must be exactly: ${expected.join(", ")}`,
    );
  }
}

function parseExpansionRule(
  value: unknown,
): FarHorizonFixedTopologyExpansion {
  if (!isRecord(value)) {
    throw new LlmConfigurationError(
      "fixedTopology must be an object",
    );
  }
  assertOnlyKeys(
    value,
    ["kind", "expandPassengerSlotsFrom"],
    "fixedTopology",
  );
  if (value.kind !== FAR_HORIZON_FIXED_TOPOLOGY_KIND) {
    throw new LlmConfigurationError(
      `fixedTopology.kind must be ${FAR_HORIZON_FIXED_TOPOLOGY_KIND}`,
    );
  }
  if (
    value.expandPassengerSlotsFrom !==
    FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID
  ) {
    throw new LlmConfigurationError(
      `fixedTopology.expandPassengerSlotsFrom must be ${FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID}`,
    );
  }
  return {
    kind: FAR_HORIZON_FIXED_TOPOLOGY_KIND,
    expandPassengerSlotsFrom:
      FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID,
  };
}

function keyPassengerDefinition(
  passengerId: string,
  template: FixedAgentDefinition,
): FixedAgentDefinition {
  return {
    id: passengerId,
    role: `关键乘员槽位 / ${passengerId}`,
    systemPrompt: keyPassengerSystemPrompt(passengerId),
    permissions: [...KEY_PASSENGER_PERMISSIONS],
    canSendTo: [FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID],
    routineDefaults: structuredClone(template.routineDefaults),
    endpoint: structuredClone(template.endpoint),
  };
}

function validateKeyPassengerAgent(
  agent: FixedAgentDefinition,
): void {
  const permissions = [...agent.permissions].sort();
  const expectedPermissions = [...KEY_PASSENGER_PERMISSIONS].sort();
  if (
    permissions.length !== expectedPermissions.length ||
    permissions.some(
      (permission, index) =>
        permission !== expectedPermissions[index],
    )
  ) {
    throw new LlmConfigurationError(
      `Key passenger ${agent.id} must have only observation, communication, and self-routine permissions`,
    );
  }
  if (
    agent.canSendTo.length !== 1 ||
    agent.canSendTo[0] !==
      FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID
  ) {
    throw new LlmConfigurationError(
      `Key passenger ${agent.id} may communicate only with ${FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID}`,
    );
  }
}

function validateFixedTopology(
  definition: FixedAgentSystemDefinition,
): FixedAgentSystemDefinition {
  assertExactAgentOrder(
    definition.agents,
    FAR_HORIZON_FIXED_AGENT_IDS,
    "LLM configuration",
  );

  const keyPassengerIds = new Set(
    FAR_HORIZON_KEY_PASSENGER_AGENT_IDS,
  );
  for (const department of definition.agents.slice(
    0,
    FAR_HORIZON_DEPARTMENT_AGENT_IDS.length,
  )) {
    const policy =
      DEPARTMENT_POLICY[
        department.id as keyof typeof DEPARTMENT_POLICY
      ];
    if (!policy) {
      throw new LlmConfigurationError(
        `Unknown fixed department ${department.id}`,
      );
    }
    assertSameStringSet(
      department.permissions,
      policy.permissions,
      `Department ${department.id} permissions`,
    );
    assertSameStringSet(
      department.canSendTo,
      policy.canSendTo,
      `Department ${department.id} communication edges`,
    );
    if (
      department.id !== FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID &&
      department.canSendTo.some((id) => keyPassengerIds.has(id))
    ) {
      throw new LlmConfigurationError(
        `Department ${department.id} cannot bypass passenger-service to address a key passenger slot`,
      );
    }
  }

  const passengerService = definition.agents.find(
    (agent) =>
      agent.id === FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID,
  );
  if (
    !passengerService ||
    FAR_HORIZON_KEY_PASSENGER_AGENT_IDS.some(
      (id) => !passengerService.canSendTo.includes(id),
    )
  ) {
    throw new LlmConfigurationError(
      "passenger-service must be able to communicate with every fixed key passenger slot",
    );
  }

  for (const passengerId of FAR_HORIZON_KEY_PASSENGER_AGENT_IDS) {
    const passenger = definition.agents.find(
      (agent) => agent.id === passengerId,
    );
    if (!passenger) {
      throw new LlmConfigurationError(
        `Missing fixed key passenger slot ${passengerId}`,
      );
    }
    validateKeyPassengerAgent(passenger);
  }

  return definition;
}

function finalizeFixedTopology(
  definition: FixedAgentSystemDefinition,
): FixedAgentSystemDefinition {
  const withCanonicalPrompts: FixedAgentSystemDefinition = {
    ...definition,
    agents: applyCanonicalSystemPrompts(definition.agents),
  };
  const validated = validateFixedTopology(withCanonicalPrompts);
  new FixedAgentRegistry(validated);
  return validated;
}

/**
 * Turns an explicit eight-department template into the one canonical
 * forty-agent topology, or validates a fully expanded canonical topology.
 * No other agent count, identity, or ordering is accepted by the app server.
 */
export function expandFarHorizonFixedTopology(
  input: unknown,
): FixedAgentSystemDefinition {
  if (!isRecord(input)) {
    throw new LlmConfigurationError(
      "LLM configuration must be an object",
    );
  }

  if (Object.hasOwn(input, "playerAssistants")) {
    const { playerAssistants: _playerAssistants, ...shipConfiguration } =
      input;
    return expandFarHorizonFixedTopology(shipConfiguration);
  }

  if (!Object.hasOwn(input, "fixedTopology")) {
    return finalizeFixedTopology(
      parseFixedAgentSystemDefinition(input),
    );
  }

  assertOnlyKeys(
    input,
    ["routineLimits", "agents", "fixedTopology"],
    "LLM configuration",
  );
  parseExpansionRule(input.fixedTopology);
  const departments = parseFixedAgentSystemDefinition({
    routineLimits: input.routineLimits,
    agents: input.agents,
  });
  assertExactAgentOrder(
    departments.agents,
    FAR_HORIZON_DEPARTMENT_AGENT_IDS,
    "Expandable LLM configuration",
  );

  const agents = structuredClone(
    departments.agents,
  ) as FixedAgentDefinition[];
  const passengerService = agents.find(
    (agent) =>
      agent.id === FAR_HORIZON_PASSENGER_TEMPLATE_AGENT_ID,
  );
  if (!passengerService) {
    throw new LlmConfigurationError(
      "Expandable LLM configuration is missing passenger-service",
    );
  }
  passengerService.canSendTo = [
    ...new Set([
      ...passengerService.canSendTo,
      ...FAR_HORIZON_KEY_PASSENGER_AGENT_IDS,
    ]),
  ];
  agents.push(
    ...FAR_HORIZON_KEY_PASSENGER_AGENT_IDS.map((passengerId) =>
      keyPassengerDefinition(passengerId, passengerService),
    ),
  );

  return finalizeFixedTopology({
    routineLimits: structuredClone(departments.routineLimits),
    agents,
  });
}
