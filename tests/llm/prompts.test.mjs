import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { expandFarHorizonFixedTopology } from "../../lib/llm/fixed-topology.ts";
import {
  CANONICAL_SYSTEM_PROMPT_STUB,
  CAPTAIN_SYSTEM_PROMPT,
  CAPTAIN_DECISION_INSTRUCTION,
  DEFAULT_GOD_SYSTEM_PROMPT,
  DEPARTMENT_CONSULTATION_REQUEST,
  DEPARTMENT_SYSTEM_PROMPTS,
  KEY_PASSENGER_SELF_INSTRUCTION,
  LLM_ANTI_FABRICATION_CONTRACT,
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

test("captain and navigation prompts do not deadlock the first jump", () => {
  assert.match(CAPTAIN_SYSTEM_PROMPT, /首次跃迁前/);
  assert.match(CAPTAIN_DECISION_INSTRUCTION, /不得要求先有一次历史跃迁/);
  assert.match(DEPARTMENT_SYSTEM_PROMPTS.navigation, /零次跃迁记录/);
  assert.match(DEPARTMENT_SYSTEM_PROMPTS.navigation, /局部六自由度/);
  assert.match(DEPARTMENT_SYSTEM_PROMPTS.engineering, /不是跃迁前置条件/);
});

test("captain handbook and consultation policy are embedded in system prompt", () => {
  assert.match(CAPTAIN_SYSTEM_PROMPT, /<handbook>/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /jumpDriveCharge/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /water-spur/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /cooling-spur/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /默认不开会|仅在多域冲突/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /不要假装已咨询/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /hullIntegrity/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /sensorView\.hullThreat|hullThreat/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /jumpThermalProjection/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /truthCondition|recentlyCompleted/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /带破口跃迁/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /30 min|schedule_hull_repair/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /级联/);
  assert.match(CAPTAIN_DECISION_INSTRUCTION, /distributionSpurs|habitatThermalDeliverySpurs/);
  assert.match(CAPTAIN_DECISION_INSTRUCTION, /不要假装已咨询/);
});

test("engineering and life-support prompts cover hull breach cascade", () => {
  assert.match(
    DEPARTMENT_SYSTEM_PROMPTS.engineering,
    /isolate_pressure_zone/,
  );
  assert.match(
    DEPARTMENT_SYSTEM_PROMPTS.engineering,
    /schedule_hull_repair/,
  );
  assert.match(DEPARTMENT_SYSTEM_PROMPTS.engineering, /级联|30 min/);
  assert.match(
    DEPARTMENT_SYSTEM_PROMPTS["life-support"],
    /isolate_pressure_zone/,
  );
  assert.match(
    DEPARTMENT_SYSTEM_PROMPTS["life-support"],
    /schedule_hull_repair|级联/,
  );
});

test("navigation does not overclaim ephemeris mastery", () => {
  assert.doesNotMatch(
    DEPARTMENT_SYSTEM_PROMPTS.navigation,
    /你懂星图、亚光速航段、跃迁窗口与到达误差/,
  );
  assert.match(
    DEPARTMENT_SYSTEM_PROMPTS.navigation,
    /欧氏 provenance|不是精密星历/,
  );
});

test("life-support prompt covers distribution spurs", () => {
  assert.match(
    DEPARTMENT_SYSTEM_PROMPTS["life-support"],
    /distributionSpurs|configure_water_distribution_spur/,
  );
  assert.match(
    DEPARTMENT_SYSTEM_PROMPTS["life-support"],
    /不能凭空造水|水机不能凭空造水/,
  );
  assert.match(
    DEPARTMENT_SYSTEM_PROMPTS["life-support"],
    /atmosphereReserveKg|set-atmosphere-supply/,
  );
});

test("captain handbook notes oxygen reserve vs cabin supply", () => {
  assert.match(CAPTAIN_SYSTEM_PROMPT, /atmosphereReserveKg/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /set-atmosphere-supply/);
});

test("captain decision instruction warns against reissuing capacity-blocked maintenance schedules", () => {
  assert.match(CAPTAIN_DECISION_INSTRUCTION, /每环仅有 2 台维修机器人/);
  assert.match(CAPTAIN_DECISION_INSTRUCTION, /不要重复提交同一排程/);
});

test("anti-fabrication rules survive in every ship-side contract", () => {
  assert.match(LLM_ANTI_FABRICATION_CONTRACT, /禁止用散文假装已经执行/);
  assert.match(LLM_ANTI_FABRICATION_CONTRACT, /禁止编造/);
  assert.match(LLM_ANTI_FABRICATION_CONTRACT, /禁止逐项复述/);
  assert.match(LLM_ANTI_FABRICATION_CONTRACT, /Markdown 表格/);
  assert.ok(LLM_OUTPUT_STYLE_CONTRACT.includes(LLM_ANTI_FABRICATION_CONTRACT));

  const shipPrompts = [
    CAPTAIN_SYSTEM_PROMPT,
    ...Object.values(DEPARTMENT_SYSTEM_PROMPTS),
  ];
  for (const prompt of shipPrompts) {
    assert.ok(prompt.includes(LLM_ANTI_FABRICATION_CONTRACT));
  }
});

test("the old anti-personality bans are gone", () => {
  const relaxed = [
    CAPTAIN_SYSTEM_PROMPT,
    CAPTAIN_DECISION_INSTRUCTION,
    DEPARTMENT_CONSULTATION_REQUEST,
    KEY_PASSENGER_SELF_INSTRUCTION,
    ...Object.values(DEPARTMENT_SYSTEM_PROMPTS),
  ];
  for (const prompt of relaxed) {
    assert.doesNotMatch(prompt, /自由文本必须极短/);
    assert.doesNotMatch(prompt, /不要煽情演讲/);
    assert.doesNotMatch(prompt, /严禁输出舰长日志/);
  }
});

test("captain carries a private journal and self-set watch conditions", () => {
  assert.match(CAPTAIN_SYSTEM_PROMPT, /<continuity>/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /record_captain_log/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /set_watch_condition/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /你不是每回合重置的脚本/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /<memory>/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /不得把旧记录当作本回合的观测事实/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /允许犹豫、权衡、不安、后悔/);
  assert.match(CAPTAIN_DECISION_INSTRUCTION, /必须调用 record_captain_log/);
});

test("captain owns the final call while dissent stays on the record", () => {
  assert.match(CAPTAIN_SYSTEM_PROMPT, /<command>/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /file_dissent/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /异议不阻止你的命令/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /航程结束报告/);
  assert.match(CAPTAIN_SYSTEM_PROMPT, /<dissent_ledger>/);
});

test("departments may argue with peers and file formal dissent", () => {
  for (const [id, prompt] of Object.entries(DEPARTMENT_SYSTEM_PROMPTS)) {
    assert.match(prompt, /<dissent>/, id);
    assert.match(prompt, /file_dissent/, id);
    assert.match(prompt, /<peer_positions>/, id);
    assert.match(prompt, /专业分歧比虚假一致更有价值/, id);
    assert.match(prompt, /异议是记录，不是否决/, id);
    assert.match(prompt, /<standing>/, id);
  }
  assert.match(DEPARTMENT_CONSULTATION_REQUEST, /file_dissent/);
  assert.match(DEPARTMENT_CONSULTATION_REQUEST, /<peer_positions>/);
});

test("key passengers live in a society with grievances and rumors", () => {
  const passengerId = DEFAULT_KEY_LLM_PASSENGER_IDS[0];
  const prompt = keyPassengerSystemPrompt(passengerId);
  assert.match(prompt, /<social>/);
  assert.match(prompt, /<around_you>/);
  assert.match(prompt, /file_passenger_grievance/);
  assert.match(prompt, /share_passenger_rumor/);
  assert.match(prompt, /可能是假的/);
  assert.match(prompt, /不是命令飞船/);
  assert.match(KEY_PASSENGER_SELF_INSTRUCTION, /file_passenger_grievance/);
  assert.match(KEY_PASSENGER_SELF_INSTRUCTION, /share_passenger_rumor/);
  assert.match(KEY_PASSENGER_SELF_INSTRUCTION, /未经证实/);
});

test("passengers still cannot claim ship control or fabricate", () => {
  for (const passengerId of DEFAULT_KEY_LLM_PASSENGER_IDS.slice(0, 4)) {
    const prompt = keyPassengerSystemPrompt(passengerId);
    assert.match(prompt, /你没有舰船控制权/);
    assert.match(prompt, /不要编造你没听说的事/);
    assert.match(prompt, /不得声称命令已执行|不要声称命令已执行/);
  }
});
