import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { LlmInputValidationError } from "../../lib/llm/index.ts";
import {
  GOD_ASSIST_CAUSAL_EVENT_TYPES,
  GOD_ASSIST_FORCE_FIELD_IDS,
  GOD_ASSIST_TOOLS,
  GodAssistRuntime,
  parseGodAssistPlanFromToolCalls,
  parsePlayerAssistantsConfig,
  splitLlmConfigurationRoot,
} from "../../lib/llm/god-assist.ts";
import { expandFarHorizonFixedTopology } from "../../lib/llm/fixed-topology.ts";

const exampleConfigUrl = new URL(
  "../../config/llm.example.json",
  import.meta.url,
);

function godAssistEndpoint(secretRef = "SHIP_GOD_ASSIST_TEST_API_KEY") {
  return {
    url: "https://provider.god-assist.test/v1/chat",
    method: "POST",
    secretHeaders: [
      {
        header: "authorization",
        secretRef,
        prefix: "Bearer ",
      },
    ],
    bodyTemplate: {
      model: "god-assist-test",
      messages: "{{request.openAiMessagesWithSystem}}",
      tools: "{{request.openAiTools}}",
    },
    response: {
      kind: "json",
      textPath: ["choices", 0, "message", "content"],
      toolCallsPath: ["choices", 0, "message", "tool_calls"],
      toolCall: {
        idPath: ["id"],
        namePath: ["function", "name"],
        argumentsPath: ["function", "arguments"],
      },
    },
  };
}

function toolResponse(id, name, argumentsValue) {
  return Response.json({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id,
              function: {
                name,
                arguments: JSON.stringify(argumentsValue),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
    },
  });
}

test("GOD_ASSIST_TOOLS expose inputSchema for each intervention tool", () => {
  assert.equal(GOD_ASSIST_TOOLS.length, 3);
  for (const tool of GOD_ASSIST_TOOLS) {
    assert.equal(typeof tool.name, "string");
    assert.equal(typeof tool.description, "string");
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal("parameters" in tool, false);
  }

  const planTool = GOD_ASSIST_TOOLS.find(
    (tool) => tool.name === "apply_intervention_plan",
  );
  assert.deepEqual(
    planTool.inputSchema.properties.steps.items.properties.kind.enum,
    ["causal-event", "force-override"],
  );
});

test("parseGodAssistPlanFromToolCalls accepts single causal and force tools", () => {
  const plan = parseGodAssistPlanFromToolCalls([
    {
      name: "trigger_causal_event",
      arguments: {
        eventType: "stellar-flare",
        label: "太阳耀斑冲击",
      },
    },
    {
      name: "apply_force_override",
      arguments: {
        fieldId: "generation",
        value: 650_000,
        label: "聚变总发电",
      },
    },
  ]);

  assert.equal(plan.summary, "上帝干预计划");
  assert.equal(plan.steps.length, 2);
  assert.deepEqual(plan.steps[0], {
    kind: "causal-event",
    eventType: "stellar-flare",
    label: "太阳耀斑冲击",
  });
  assert.deepEqual(plan.steps[1], {
    kind: "force-override",
    fieldId: "generation",
    value: 650_000,
    label: "聚变总发电",
  });
});

test("parseGodAssistPlanFromToolCalls accepts bundled intervention plans", () => {
  const plan = parseGodAssistPlanFromToolCalls([
    {
      name: "apply_intervention_plan",
      arguments: {
        summary: "恢复冷却并抬升发电",
        steps: [
          {
            kind: "force-override",
            fieldId: "coolant-temperature",
            value: 295,
            label: "冷却剂温度",
          },
          {
            kind: "force-override",
            fieldId: "generation",
            value: 500_000,
          },
        ],
      },
    },
  ]);

  assert.equal(plan.summary, "恢复冷却并抬升发电");
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[1].label, "generation");
});

test("parseGodAssistPlanFromToolCalls rejects invalid enums and negative values", () => {
  assert.throws(
    () =>
      parseGodAssistPlanFromToolCalls([
        {
          name: "trigger_causal_event",
          arguments: {
            eventType: "black-hole",
            label: "无效事件",
          },
        },
      ]),
    LlmInputValidationError,
  );

  assert.throws(
    () =>
      parseGodAssistPlanFromToolCalls([
        {
          name: "apply_force_override",
          arguments: {
            fieldId: "generation",
            value: -1,
            label: "负发电",
          },
        },
      ]),
    LlmInputValidationError,
  );

  assert.throws(
    () => parseGodAssistPlanFromToolCalls([]),
    /at least one intervention tool/,
  );
});

test("splitLlmConfigurationRoot strips playerAssistants before topology expansion", async () => {
  const source = JSON.parse(await readFile(exampleConfigUrl, "utf8"));
  const split = splitLlmConfigurationRoot(source);

  assert.ok(split.playerAssistants?.godAssistant?.endpoint);
  assert.equal(
    expandFarHorizonFixedTopology(split.shipConfiguration).agents.length,
    40,
  );
  assert.equal(
    expandFarHorizonFixedTopology(source).agents.length,
    40,
  );
});

test("parsePlayerAssistantsConfig validates godAssistant shape", () => {
  assert.deepEqual(parsePlayerAssistantsConfig(undefined), undefined);
  assert.deepEqual(parsePlayerAssistantsConfig({}), {});

  const parsed = parsePlayerAssistantsConfig({
    godAssistant: {
      systemPrompt: "  只输出工具计划  ",
      endpoint: godAssistEndpoint(),
    },
  });
  assert.equal(parsed?.godAssistant?.systemPrompt, "只输出工具计划");

  assert.throws(
    () =>
      parsePlayerAssistantsConfig({
        runtimeChild: { endpoint: {} },
      }),
    /unsupported fields/,
  );
});

test("GodAssistRuntime.invoke returns parsed plan from provider tool calls", async () => {
  const runtime = new GodAssistRuntime(
    { endpoint: godAssistEndpoint() },
    {
      fetch: async (input, init) => {
        assert.equal(
          String(input),
          "https://provider.god-assist.test/v1/chat",
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer god-assist-secret",
        );
        return toolResponse("god-tool-1", "apply_intervention_plan", {
          summary: "抬升氧气库存",
          steps: [
            {
              kind: "force-override",
              fieldId: "oxygen-mass",
              value: 12_000,
              label: "氧气质量",
            },
          ],
        });
      },
      readEnvironment: (name) =>
        name === "SHIP_GOD_ASSIST_TEST_API_KEY"
          ? "god-assist-secret"
          : undefined,
    },
  );

  const result = await runtime.invoke({
    messages: [{ role: "user", content: "把氧气补到安全线以上" }],
    metadata: { intent: "god-assist" },
  });

  assert.equal(result.agentId, "god-assistant");
  assert.equal(result.plan.summary, "抬升氧气库存");
  assert.equal(result.plan.steps[0].fieldId, "oxygen-mass");
  assert.deepEqual(
    [...GOD_ASSIST_CAUSAL_EVENT_TYPES],
    [
      "micrometeoroid",
      "coolant-pump-seizure",
      "stellar-flare",
      "fusion-reactor-trip",
      "ring-bearing-degradation",
      "air-handler-trip",
      "water-processor-trip",
      "passenger-emergency",
    ],
  );
  assert.deepEqual(
    [...GOD_ASSIST_FORCE_FIELD_IDS],
    [
      "coolant-temperature",
      "generation",
      "oxygen-mass",
      "leak-area",
      "radiation-rate",
      "potable-water",
    ],
  );
});
