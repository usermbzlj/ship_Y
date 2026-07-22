import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { expandFarHorizonFixedTopology } from "../../lib/llm/fixed-topology.ts";
import {
  CANONICAL_SYSTEM_PROMPT_STUB,
  CAPTAIN_SYSTEM_PROMPT,
  DEFAULT_GOD_SYSTEM_PROMPT,
  DEPARTMENT_SYSTEM_PROMPTS,
  KEY_PASSENGER_SELF_INSTRUCTION,
  LLM_OUTPUT_STYLE_CONTRACT,
  applyCanonicalSystemPrompts,
  keyPassengerSystemPrompt,
  systemPromptForAgent,
} from "../../lib/llm/prompts/index.ts";
import { DEFAULT_KEY_LLM_PASSENGER_IDS } from "../../lib/sim/passengers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadExampleConfig() {
  return JSON.parse(
    readFileSync(join(root, "config/llm.example.json"), "utf8"),
  );
}

test("canonical stub is what example JSON ships for departments", () => {
  const config = loadExampleConfig();
  assert.equal(config.agents.length, 8);
  for (const agent of config.agents) {
    assert.equal(agent.systemPrompt, CANONICAL_SYSTEM_PROMPT_STUB);
  }
  assert.equal(
    config.playerAssistants.godAssistant.systemPrompt,
    CANONICAL_SYSTEM_PROMPT_STUB,
  );
});

test("expand applies structured canonical prompts to all 40 agents", () => {
  const expanded = expandFarHorizonFixedTopology(loadExampleConfig());
  assert.equal(expanded.agents.length, 40);

  const captain = expanded.agents.find((agent) => agent.id === "captain");
  assert.ok(captain);
  assert.equal(captain.systemPrompt, CAPTAIN_SYSTEM_PROMPT);
  assert.match(captain.systemPrompt, /<identity>/);
  assert.match(captain.systemPrompt, /<priorities>/);
  assert.match(captain.systemPrompt, /<edge_cases>/);
  assert.match(captain.systemPrompt, /<output>/);
  assert.ok(captain.systemPrompt.includes(LLM_OUTPUT_STYLE_CONTRACT));

  for (const [id, prompt] of Object.entries(DEPARTMENT_SYSTEM_PROMPTS)) {
    const agent = expanded.agents.find((entry) => entry.id === id);
    assert.ok(agent, id);
    assert.equal(agent.systemPrompt, prompt);
    assert.match(agent.systemPrompt, /本回合通常没有世界改写工具/);
    assert.doesNotMatch(agent.systemPrompt, /改变世界只能通过本回合提供的工具调用/);
  }

  const passengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[0];
  const passenger = expanded.agents.find((agent) => agent.id === passengerId);
  assert.ok(passenger);
  assert.equal(passenger.systemPrompt, keyPassengerSystemPrompt(passengerId));
  assert.match(passenger.systemPrompt, /第一人称/);
  assert.match(passenger.systemPrompt, /普通乘员/);
  assert.doesNotMatch(passenger.systemPrompt, /LLM 槽位/);
});

test("systemPromptForAgent covers ship roles and god assistant", () => {
  assert.equal(systemPromptForAgent("captain"), CAPTAIN_SYSTEM_PROMPT);
  assert.equal(
    systemPromptForAgent("engineering"),
    DEPARTMENT_SYSTEM_PROMPTS.engineering,
  );
  assert.equal(
    systemPromptForAgent(DEFAULT_KEY_LLM_PASSENGER_IDS[3]),
    keyPassengerSystemPrompt(DEFAULT_KEY_LLM_PASSENGER_IDS[3]),
  );
  assert.equal(systemPromptForAgent("god-assistant"), DEFAULT_GOD_SYSTEM_PROMPT);
  assert.equal(systemPromptForAgent("unknown-agent"), undefined);
});

test("applyCanonicalSystemPrompts overwrites stubs and preserves strangers", () => {
  const applied = applyCanonicalSystemPrompts([
    { id: "captain", systemPrompt: "old" },
    { id: "custom-bot", systemPrompt: "keep-me" },
  ]);
  assert.equal(applied[0].systemPrompt, CAPTAIN_SYSTEM_PROMPT);
  assert.equal(applied[1].systemPrompt, "keep-me");
});

test("department prompts stay advisory; captain owns tools language", () => {
  assert.match(CAPTAIN_SYSTEM_PROMPT, /世界内工具/);
  assert.doesNotMatch(
    DEPARTMENT_SYSTEM_PROMPTS.navigation,
    /你必须通过工具提交/,
  );
  assert.match(DEFAULT_GOD_SYSTEM_PROMPT, /trigger_causal_event/);
  assert.match(KEY_PASSENGER_SELF_INSTRUCTION, /第一人称|自身身份/);
});
