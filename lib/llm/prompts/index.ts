/**
 * 远穹号 LLM Prompt 单一真相源。
 * 舰载 systemPrompt 在 expand/finalize 时由此覆写；JSON 中仅为占位。
 */

export {
  CANONICAL_SYSTEM_PROMPT_STUB,
  CAPTAIN_DECISION_INSTRUCTION,
  DEPARTMENT_CONSULTATION_REQUEST,
  DEFAULT_PRIORITIES,
  KEY_PASSENGER_SELF_INSTRUCTION,
  LLM_OUTPUT_STYLE_CONTRACT,
  LLM_TOOL_ACTION_CONTRACT,
  OUTPUT_CONTRACT_BLOCK,
  SHIP_NAME,
  WORLD_FRAME,
  joinPromptSections,
} from "./shared.ts";

export {
  CAPTAIN_SYSTEM_PROMPT,
  DEPARTMENT_SYSTEM_PROMPTS,
  SHIP_AGENT_SYSTEM_PROMPTS,
} from "./departments.ts";
export type { DepartmentAgentId } from "./departments.ts";

export {
  DEFAULT_GOD_SYSTEM_PROMPT,
  keyPassengerSystemPrompt,
} from "./passengers.ts";

import { DEFAULT_KEY_LLM_PASSENGER_IDS } from "../../sim/passengers.ts";
import { SHIP_AGENT_SYSTEM_PROMPTS } from "./departments.ts";
import {
  DEFAULT_GOD_SYSTEM_PROMPT,
  keyPassengerSystemPrompt,
} from "./passengers.ts";

const KEY_PASSENGER_ID_SET = new Set<string>(DEFAULT_KEY_LLM_PASSENGER_IDS);

/**
 * 返回规范 systemPrompt；未知 id 返回 undefined（调用方保留原值）。
 */
export function systemPromptForAgent(agentId: string): string | undefined {
  if (Object.hasOwn(SHIP_AGENT_SYSTEM_PROMPTS, agentId)) {
    return SHIP_AGENT_SYSTEM_PROMPTS[agentId];
  }
  if (KEY_PASSENGER_ID_SET.has(agentId)) {
    return keyPassengerSystemPrompt(agentId);
  }
  if (agentId === "god-assistant") {
    return DEFAULT_GOD_SYSTEM_PROMPT;
  }
  return undefined;
}

/** 对 agent 列表就地覆写规范 Prompt（返回新数组）。 */
export function applyCanonicalSystemPrompts<
  T extends { id: string; systemPrompt: string },
>(agents: readonly T[]): T[] {
  return agents.map((agent) => {
    const canonical = systemPromptForAgent(agent.id);
    if (!canonical) return agent;
    return { ...agent, systemPrompt: canonical };
  });
}
