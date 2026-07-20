import assert from "node:assert/strict";
import test from "node:test";

import {
  ABSOLUTE_MAX_LLM_REQUEST_TIMEOUT_MS,
  ABSOLUTE_MAX_LLM_RESPONSE_BYTES,
  AgentPermissionError,
  AgentRoutineController,
  FixedAgentRegistry,
  InMemoryUsageLedger,
  LlmConfigurationError,
  LlmProviderHttpError,
  LlmGateway,
  LlmRequestAbortedError,
  SELF_ROUTINE_CONFIGURATION_PERMISSION,
  parseFixedAgentSystemDefinition,
} from "../../lib/llm/index.ts";

function endpoint(overrides = {}) {
  return {
    url: "https://llm.example.test/v1/respond",
    secretHeaders: [
      {
        header: "authorization",
        secretRef: "CAPTAIN_API_KEY",
        prefix: "Bearer ",
      },
    ],
    bodyTemplate: {
      model: "ship-captain",
      system: "{{agent.systemPrompt}}",
      messages: "{{request.messages}}",
      openAiMessages: "{{request.openAiMessages}}",
      openAiMessagesWithSystem:
        "{{request.openAiMessagesWithSystem}}",
      tools: "{{request.tools}}",
      thinking: { enabled: true, budget: 2048 },
      stream: "{{request.stream}}",
      routine: "{{routine}}",
    },
    response: {
      kind: "json",
      textPath: ["result", "answer"],
      finishReasonPath: ["result", "stop"],
      toolCallsPath: ["result", "actions"],
      toolCall: {
        idPath: ["call_id"],
        namePath: ["operation"],
        argumentsPath: ["parameters"],
      },
      usage: {
        inputTokensPath: ["metering", "input"],
        outputTokensPath: ["metering", "output"],
        totalTokensPath: ["metering", "total"],
      },
    },
    ...overrides,
  };
}

function systemDefinition(endpointOverrides = {}) {
  return {
    routineLimits: {
      minSystemInfoIntervalSimSeconds: 30,
      maxSystemInfoIntervalSimSeconds: 3600,
      maxDiscussionDepth: 4,
      maxDiscussionRounds: 8,
    },
    agents: [
      {
        id: "captain",
        role: "captain",
        systemPrompt: "Protect the civilian ship and complete the voyage.",
        permissions: [SELF_ROUTINE_CONFIGURATION_PERMISSION, "ship:command"],
        canSendTo: ["engineer"],
        routineDefaults: {
          systemInfoIntervalSimSeconds: 300,
          discussionDepth: 2,
          discussionRounds: 4,
        },
        endpoint: endpoint(endpointOverrides),
      },
      {
        id: "engineer",
        role: "chief-engineer",
        systemPrompt: "Operate only through engineering controls.",
        permissions: [],
        canSendTo: [],
        routineDefaults: {
          systemInfoIntervalSimSeconds: 600,
          discussionDepth: 1,
          discussionRounds: 2,
        },
        endpoint: endpoint({
          url: "https://engineering.example.test/v2/chat",
          ...endpointOverrides,
        }),
      },
    ],
  };
}

test("fixed registry freezes agents and enforces the configured topology", () => {
  const source = systemDefinition();
  const registry = new FixedAgentRegistry(source);

  source.agents[0].role = "mutated-after-startup";
  assert.equal(registry.get("captain").role, "captain");
  assert.equal(registry.canCommunicate("captain", "engineer"), true);
  assert.equal(registry.canCommunicate("engineer", "captain"), false);
  assert.throws(
    () => registry.assertCanCommunicate("engineer", "captain"),
    AgentPermissionError,
  );
  assert.equal(Object.isFrozen(registry.get("captain")), true);
  assert.equal(typeof registry.add, "undefined");
  assert.equal(typeof registry.create, "undefined");
});

test("endpoint security is validated before any provider request", () => {
  let fetchCalls = 0;
  const createGateway = (endpointOverrides) => {
    const registry = new FixedAgentRegistry(
      systemDefinition(endpointOverrides),
    );
    return new LlmGateway(registry, {
      fetch: async () => {
        fetchCalls += 1;
        throw new Error("security validation must precede network access");
      },
      resolveSecret: () => "secret",
    });
  };

  assert.throws(
    () => createGateway({ url: "http://llm.example.test/v1/respond" }),
    /secretHeaders must use HTTPS/,
  );
  assert.throws(
    () =>
      createGateway({
        url: "http://llm.example.test/v1/respond",
        secretHeaders: [],
      }),
    /HTTP only for a loopback endpoint/,
  );
  assert.throws(
    () =>
      createGateway({
        url: "http://localhost:8080/v1/respond",
      }),
    /secretHeaders must use HTTPS/,
  );
  assert.throws(
    () =>
      createGateway({
        url: "https://user:password@llm.example.test/v1/respond",
      }),
    /cannot contain credentials/,
  );

  for (const url of [
    "http://localhost:8080/v1/respond",
    "http://127.0.0.1:8080/v1/respond",
    "http://[::1]:8080/v1/respond",
  ]) {
    assert.doesNotThrow(() =>
      createGateway({ url, secretHeaders: [] }),
    );
  }
  assert.doesNotThrow(() => createGateway({}));
  assert.equal(fetchCalls, 0);
});

test("configuration rejects ordinary auth-bearing headers and unsafe endpoint limits", () => {
  for (const header of [
    "Cookie",
    "x-auth",
    "x-session-id",
    "credential",
    "x-client-credential",
    "x-api-key",
  ]) {
    const definition = systemDefinition({
      headers: { [header]: "plaintext-secret" },
    });
    assert.throws(
      () => parseFixedAgentSystemDefinition(definition),
      LlmConfigurationError,
      header,
    );
    assert.throws(
      () => new FixedAgentRegistry(definition),
      LlmConfigurationError,
      `${header} registry preflight`,
    );
  }

  assert.throws(
    () =>
      parseFixedAgentSystemDefinition(
        systemDefinition({
          requestTimeoutMs:
            ABSOLUTE_MAX_LLM_REQUEST_TIMEOUT_MS + 1,
        }),
      ),
    LlmConfigurationError,
  );
  assert.throws(
    () =>
      parseFixedAgentSystemDefinition(
        systemDefinition({
          maxResponseBytes: ABSOLUTE_MAX_LLM_RESPONSE_BYTES + 1,
        }),
      ),
    LlmConfigurationError,
  );

  const parsed = parseFixedAgentSystemDefinition(
    systemDefinition({
      requestTimeoutMs: 25,
      maxResponseBytes: 512,
    }),
  );
  assert.equal(parsed.agents[0].endpoint.requestTimeoutMs, 25);
  assert.equal(parsed.agents[0].endpoint.maxResponseBytes, 512);
});

test("agents may tune only their own routine within absolute limits", () => {
  const registry = new FixedAgentRegistry(systemDefinition());
  const routines = new AgentRoutineController(registry);

  assert.deepEqual(
    routines.setByAgent("captain", {
      systemInfoIntervalSimSeconds: 120,
      discussionDepth: 3,
      discussionRounds: 6,
    }),
    {
      systemInfoIntervalSimSeconds: 120,
      discussionDepth: 3,
      discussionRounds: 6,
    },
  );
  assert.throws(
    () => routines.setByAgent("captain", { discussionDepth: 5 }),
    LlmConfigurationError,
  );
  assert.throws(
    () => routines.setByAgent("engineer", { discussionRounds: 1 }),
    AgentPermissionError,
  );
  assert.throws(
    () =>
      routines.assertDiscussionPosition("captain", {
        depth: 4,
        round: 1,
      }),
    AgentPermissionError,
  );
});

test("custom templates, secret header references, response maps, and usage work without network", async () => {
  const registry = new FixedAgentRegistry(systemDefinition());
  const routines = new AgentRoutineController(registry);
  const usage = new InMemoryUsageLedger();
  let capturedRequest;

  const gateway = new LlmGateway(registry, {
    fetch: async (url, init) => {
      capturedRequest = { url, init };
      return Response.json({
        result: {
          answer: "Reduce reactor output and isolate coolant loop B.",
          stop: "tool_use",
          actions: [
            {
              call_id: "act-1",
              operation: "set_reactor_output",
              parameters: { fraction: 0.65 },
            },
          ],
        },
        metering: { input: 120, output: 30, total: 150 },
      });
    },
    resolveSecret: async (reference) => {
      assert.equal(reference, "CAPTAIN_API_KEY");
      return "test-secret";
    },
    routines,
    usage,
    createCallId: () => "call-fixed",
    now: (() => {
      const values = [1000, 1100];
      return () => values.shift();
    })(),
  });

  const result = await gateway.invoke({
    agentId: "captain",
    messages: [
      {
        role: "user",
        content: {
          alarm: "coolant-pressure-low",
          measuredKpa: 180,
        },
      },
    ],
    tools: [
      {
        name: "set_reactor_output",
        inputSchema: { type: "object" },
      },
    ],
    discussion: { depth: 1, round: 1 },
  });

  assert.equal(capturedRequest.url, "https://llm.example.test/v1/respond");
  assert.equal(
    new Headers(capturedRequest.init.headers).get("authorization"),
    "Bearer test-secret",
  );
  const body = JSON.parse(capturedRequest.init.body);
  assert.equal(body.thinking.enabled, true);
  assert.equal(body.stream, false);
  assert.equal(body.system, registry.get("captain").systemPrompt);
  assert.deepEqual(body.messages, [
    {
      role: "user",
      content: {
        alarm: "coolant-pressure-low",
        measuredKpa: 180,
      },
    },
  ]);
  assert.deepEqual(body.openAiMessages, [
    {
      role: "user",
      content:
        '{"alarm":"coolant-pressure-low","measuredKpa":180}',
    },
  ]);
  assert.deepEqual(body.openAiMessagesWithSystem, [
    {
      role: "system",
      content: "Protect the civilian ship and complete the voyage.",
    },
    {
      role: "user",
      content:
        '{"alarm":"coolant-pressure-low","measuredKpa":180}',
    },
  ]);
  assert.equal(body.routine.discussionDepth, 2);

  assert.equal(result.text, "Reduce reactor output and isolate coolant loop B.");
  assert.deepEqual(result.toolCalls, [
    {
      id: "act-1",
      name: "set_reactor_output",
      arguments: { fraction: 0.65 },
    },
  ]);
  assert.deepEqual(result.usage, {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
  });
  assert.deepEqual(usage.totals("captain"), result.usage);
  assert.deepEqual(usage.list(), [
    {
      callId: "call-fixed",
      agentId: "captain",
      attempts: 1,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      startedAtEpochMs: 1000,
      completedAtEpochMs: 1100,
    },
  ]);
});

test("permanent provider 4xx errors fail fast instead of retrying forever", async () => {
  const registry = new FixedAgentRegistry(systemDefinition());
  let calls = 0;
  const gateway = new LlmGateway(registry, {
    fetch: async () => {
      calls += 1;
      return new Response("invalid payload", { status: 400 });
    },
    resolveSecret: () => "secret",
    sleep: async () => {
      assert.fail("permanent provider errors must not enter retry sleep");
    },
  });

  await assert.rejects(
    gateway.invoke({ agentId: "captain", messages: [] }),
    (error) => {
      assert.ok(error instanceof LlmProviderHttpError);
      assert.equal(error.status, 400);
      assert.equal(error.retryable, false);
      assert.match(error.message, /request payload.*HTTP 400/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("gateway retries continuously with capped exponential delays and exposes pause/resume events", async () => {
  const registry = new FixedAgentRegistry(systemDefinition());
  let calls = 0;
  const delays = [];
  const availability = [];

  const gateway = new LlmGateway(registry, {
    fetch: async () => {
      calls += 1;
      if (calls < 4) throw new Error(`offline-${calls}`);
      return Response.json({
        result: { answer: "Recovered.", stop: "complete", actions: [] },
        metering: { input: 1, output: 1, total: 2 },
      });
    },
    resolveSecret: () => "secret",
    retry: { initialDelayMs: 10, maxDelayMs: 20, multiplier: 2 },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    onAvailabilityChange: async (event) => {
      availability.push(event);
    },
    createCallId: () => "retry-call",
  });

  const result = await gateway.invoke({
    agentId: "captain",
    messages: [],
  });

  assert.equal(result.attempts, 4);
  assert.deepEqual(delays, [10, 20, 20]);
  assert.deepEqual(
    availability.map(({ status, attempt, retryInMs }) => ({
      status,
      attempt,
      retryInMs,
    })),
    [
      { status: "retrying", attempt: 1, retryInMs: 10 },
      { status: "retrying", attempt: 2, retryInMs: 20 },
      { status: "retrying", attempt: 3, retryInMs: 20 },
      { status: "ready", attempt: 4, retryInMs: undefined },
    ],
  );
});

test(
  "a provider attempt timeout aborts the attempt and retries from scratch",
  { timeout: 2000 },
  async () => {
    const registry = new FixedAgentRegistry(
      systemDefinition({ requestTimeoutMs: 10 }),
    );
    let calls = 0;
    let firstAttemptSignal;
    const errors = [];

    const gateway = new LlmGateway(registry, {
      fetch: (_url, init) => {
        calls += 1;
        if (calls === 1) {
          firstAttemptSignal = init.signal;
          return new Promise(() => {});
        }
        return Promise.resolve(
          Response.json({
            result: {
              answer: "Recovered after timeout.",
              stop: "complete",
              actions: [],
            },
            metering: { input: 1, output: 2, total: 3 },
          }),
        );
      },
      resolveSecret: () => "secret",
      sleep: async () => {},
      onAvailabilityChange: async (event) => {
        if (event.error) errors.push(event.error);
      },
      createCallId: () => "timeout-call",
    });

    const result = await gateway.invoke({
      agentId: "captain",
      messages: [],
    });

    assert.equal(result.attempts, 2);
    assert.equal(result.text, "Recovered after timeout.");
    assert.equal(calls, 2);
    assert.equal(firstAttemptSignal.aborted, true);
    assert.match(errors[0], /timed out after 10 ms/);
  },
);

test(
  "a caller AbortSignal stops a hung provider request without retrying",
  { timeout: 2000 },
  async () => {
    const registry = new FixedAgentRegistry(
      systemDefinition({ requestTimeoutMs: 1000 }),
    );
    const controller = new AbortController();
    let calls = 0;
    let attemptSignal;
    let announceStarted;
    const started = new Promise((resolve) => {
      announceStarted = resolve;
    });

    const gateway = new LlmGateway(registry, {
      fetch: (_url, init) => {
        calls += 1;
        attemptSignal = init.signal;
        announceStarted();
        return new Promise(() => {});
      },
      resolveSecret: () => "secret",
      sleep: async () => {
        assert.fail("caller cancellation must not enter retry sleep");
      },
    });

    const invocation = gateway.invoke({
      agentId: "captain",
      messages: [],
      signal: controller.signal,
    });
    await started;
    controller.abort();

    await assert.rejects(invocation, LlmRequestAbortedError);
    assert.equal(calls, 1);
    assert.equal(attemptSignal.aborted, true);
  },
);

test("oversized JSON responses are discarded and retried", async () => {
  const registry = new FixedAgentRegistry(
    systemDefinition({ maxResponseBytes: 256 }),
  );
  let calls = 0;
  const errors = [];
  const gateway = new LlmGateway(registry, {
    fetch: async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({
          result: {
            answer: "x".repeat(2048),
            stop: "complete",
            actions: [],
          },
        });
      }
      return Response.json({
        result: {
          answer: "bounded-response",
          stop: "complete",
          actions: [],
        },
        metering: { input: 2, output: 3, total: 5 },
      });
    },
    resolveSecret: () => "secret",
    sleep: async () => {},
    onAvailabilityChange: async (event) => {
      if (event.error) errors.push(event.error);
    },
  });

  const result = await gateway.invoke({
    agentId: "captain",
    messages: [],
  });

  assert.equal(result.attempts, 2);
  assert.equal(result.text, "bounded-response");
  assert.equal(calls, 2);
  assert.match(errors[0], /byte response limit/);
});

test("an interrupted stream discards partial output before retrying", async () => {
  const streamResponse = {
    kind: "stream",
    format: "sse",
    textDeltaPath: ["delta", "text"],
    usage: {
      inputTokensPath: ["usage", "input"],
      outputTokensPath: ["usage", "output"],
    },
  };
  const registry = new FixedAgentRegistry(
    systemDefinition({ response: streamResponse }),
  );
  let calls = 0;

  const gateway = new LlmGateway(registry, {
    fetch: async () => {
      calls += 1;
      if (calls === 1) {
        let sent = false;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (!sent) {
                sent = true;
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"delta":{"text":"discard-me"}}\n\n',
                  ),
                );
              } else {
                controller.error(new Error("connection interrupted"));
              }
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }

      return new Response(
        [
          'data: {"delta":{"text":"kept"}}\n\n',
          'data: {"usage":{"input":7,"output":3}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
    resolveSecret: () => "secret",
    sleep: async () => {},
    createCallId: () => "stream-call",
  });

  const result = await gateway.invoke({
    agentId: "captain",
    messages: [],
  });

  assert.equal(result.attempts, 2);
  assert.equal(result.text, "kept");
  assert.deepEqual(result.usage, {
    inputTokens: 7,
    outputTokens: 3,
    totalTokens: 10,
  });
});

for (const format of ["sse", "ndjson"]) {
  test(`${format} streams enforce a cumulative response byte limit`, async () => {
    const streamResponse = {
      kind: "stream",
      format,
      textDeltaPath: ["delta", "text"],
    };
    const registry = new FixedAgentRegistry(
      systemDefinition({
        response: streamResponse,
        maxResponseBytes: 180,
      }),
    );
    const encoder = new TextEncoder();
    const frame = (text) => {
      const payload = JSON.stringify({ delta: { text } });
      return format === "sse"
        ? `data: ${payload}\n\n`
        : `${payload}\n`;
    };
    const done = format === "sse" ? "data: [DONE]\n\n" : "[DONE]\n";
    let calls = 0;
    let oversizedStreamCancelled = false;
    const errors = [];

    const gateway = new LlmGateway(registry, {
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(frame("x".repeat(100))));
                controller.enqueue(encoder.encode(frame("y".repeat(100))));
              },
              cancel() {
                oversizedStreamCancelled = true;
              },
            }),
          );
        }
        return new Response(`${frame("kept")}${done}`);
      },
      resolveSecret: () => "secret",
      sleep: async () => {},
      onAvailabilityChange: async (event) => {
        if (event.error) errors.push(event.error);
      },
    });

    const result = await gateway.invoke({
      agentId: "captain",
      messages: [],
    });

    assert.equal(result.attempts, 2);
    assert.equal(result.text, "kept");
    assert.equal(calls, 2);
    assert.equal(oversizedStreamCancelled, true);
    assert.match(errors[0], /byte response limit/);
  });
}
