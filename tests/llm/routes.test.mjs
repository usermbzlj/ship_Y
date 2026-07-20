import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const secretNames = [
  "SHIP_CAPTAIN_LLM_API_KEY",
  "SHIP_NAVIGATION_LLM_API_KEY",
  "SHIP_ENGINEERING_LLM_API_KEY",
  "SHIP_LIFE_SUPPORT_LLM_API_KEY",
  "SHIP_MEDICAL_LLM_API_KEY",
  "SHIP_PASSENGER_AFFAIRS_LLM_API_KEY",
  "SHIP_SECURITY_LLM_API_KEY",
  "SHIP_PASSENGER_SERVICE_LLM_API_KEY",
];

delete process.env.LLM_CONFIG_JSON;
for (const name of secretNames) delete process.env[name];

async function request(path, init) {
  const workerUrl = new URL("../../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("llm-routes", `${process.pid}`);
  const { default: worker } = await import(workerUrl.href);
  const normalizedInit = { ...init };
  if (init?.method === "POST") {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) {
      headers.set("origin", "http://localhost");
    }
    if (!headers.has("sec-fetch-site")) {
      headers.set("sec-fetch-site", "same-origin");
    }
    normalizedInit.headers = headers;
  }
  return worker.fetch(
    new Request(`http://localhost${path}`, normalizedInit),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function routeTestConfiguration() {
  const configuration = JSON.parse(
    readFileSync(
      new URL("../../config/llm.example.json", import.meta.url),
      "utf8",
    ),
  );
  const captain = configuration.agents.find(
    (agent) => agent.id === "captain",
  );
  captain.endpoint = {
    url: "https://provider.route.test/v1/chat",
    secretHeaders: [
      {
        header: "authorization",
        secretRef: "SHIP_ROUTE_TEST_API_KEY",
        prefix: "Bearer ",
      },
    ],
    bodyTemplate: {
      model: "route-test",
      messages: "{{request.messagesWithSystem}}",
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
  const passengerService = configuration.agents.find(
    (agent) => agent.id === "passenger-service",
  );
  passengerService.endpoint = {
    url: "https://provider.route.test/v1/passenger",
    secretHeaders: [
      {
        header: "authorization",
        secretRef: "SHIP_ROUTE_PASSENGER_TEST_API_KEY",
        prefix: "Bearer ",
      },
    ],
    bodyTemplate: {
      model: "passenger-route-test",
      messages: "{{request.messagesWithSystem}}",
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
  return configuration;
}

function passengerPollRequest(overrides = {}) {
  return {
    intent: "passenger-self",
    passengerId: "crew-0001",
    pollId: "poll-route-test-1",
    selfObservation: {
      passengerId: "crew-0001",
      sampledAtSimulationSeconds: 300,
      sampleAgeSeconds: 300,
      displayName: "测试乘员",
      occupation: "推进工程师",
      cabinId: "A-01-C001",
      assignedZoneId: "A-01",
      assignedZoneCondition: "nominal",
      observedPressureBand: "nominal",
      lifeState: "awake",
      physicalHealthBand: "stable",
      medicalStabilityBand: "stable",
      psychologicalStabilityBand: "watch",
      stressBand: "moderate",
      trustBand: "mixed",
    },
    publicContext: {
      origin: "太阳系",
      destination: "鲸鱼座 τ",
      elapsedSimulationSeconds: 600,
    },
    previousOwnNote: null,
    ...overrides,
  };
}

test("GET /api/llm/status exposes all 40 fixed slots without prompts or secret names", async () => {
  const response = await request("/api/llm/status");
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.llm.ready, false);
  assert.equal(body.llm.fixedAgentCount, 40);
  assert.equal(body.llm.agents[0].id, "captain");
  assert.equal(body.llm.agents.at(-1).id, "passenger-0020");
  assert.equal(body.llm.agents[0].state, "missing-secret");
  assert.equal("systemPrompt" in body.llm.agents[0], false);
  assert.equal("endpoint" in body.llm.agents[0], false);
  assert.doesNotMatch(JSON.stringify(body), /API_KEY|authorization/i);
});

test("POST /api/llm/invoke validates HTTP and invocation input before any provider call", async () => {
  const crossOrigin = await request("/api/llm/invoke", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({
      intent: "captain-decision",
      invocation: { messages: [] },
    }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(
    (await crossOrigin.json()).error.code,
    "INVALID_HTTP_REQUEST",
  );

  const wrongType = await request("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(wrongType.status, 415);

  const creationAttempt = await request("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent: "captain-decision",
      invocation: {
        messages: [],
        createAgent: { id: "runtime-child" },
      },
    }),
  });
  assert.equal(creationAttempt.status, 400);
  assert.equal(
    (await creationAttempt.json()).error.code,
    "INVALID_INVOCATION",
  );

  const passengerIdentityAttempt = await request(
    "/api/llm/invoke",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent: "captain-consultation",
        consultantId: "passenger-service",
        invocation: { messages: [] },
      }),
    },
  );
  assert.equal(passengerIdentityAttempt.status, 403);
  assert.equal(
    (await passengerIdentityAttempt.json()).error.code,
    "INVALID_HTTP_REQUEST",
  );

  process.env.SHIP_PASSENGER_SERVICE_LLM_API_KEY =
    "passenger-route-test-secret";
  try {
    const bypassPassengerService = await request("/api/llm/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent: "captain-decision",
        invocation: {
          agentId: "crew-0001",
          fromAgentId: "passenger-service",
          messages: [],
        },
      }),
    });
    assert.equal(bypassPassengerService.status, 403);
    assert.equal(
      (await bypassPassengerService.json()).error.code,
      "INVALID_HTTP_REQUEST",
    );
  } finally {
    delete process.env.SHIP_PASSENGER_SERVICE_LLM_API_KEY;
  }

  const missingSecret = await request("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      intent: "captain-decision",
      invocation: { messages: [] },
    }),
  });
  assert.equal(missingSecret.status, 503);
  assert.equal(
    (await missingSecret.json()).error.code,
    "LLM_NOT_CONFIGURED",
  );

  const unknownPassenger = await request("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      passengerPollRequest({ passengerId: "passenger-9999" }),
    ),
  });
  assert.equal(unknownPassenger.status, 403);
  assert.equal(
    (await unknownPassenger.json()).error.code,
    "INVALID_HTTP_REQUEST",
  );

  const mismatchedPassenger = passengerPollRequest();
  mismatchedPassenger.selfObservation.passengerId = "crew-0002";
  const mismatchResponse = await request("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mismatchedPassenger),
  });
  assert.equal(mismatchResponse.status, 403);

  const exactTruthAttempt = passengerPollRequest();
  exactTruthAttempt.selfObservation.physicalHealth = 0.987654;
  const exactTruthResponse = await request("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(exactTruthAttempt),
  });
  assert.equal(exactTruthResponse.status, 400);

  const tamperedZone = passengerPollRequest();
  tamperedZone.selfObservation.assignedZoneId = "C-99";
  const tamperedZoneResponse = await request("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(tamperedZone),
  });
  assert.equal(tamperedZoneResponse.status, 400);

  const tamperedPressureBand = passengerPollRequest();
  tamperedPressureBand.selfObservation.observedPressureBand =
    "vacuum";
  const tamperedPressureBandResponse = await request(
    "/api/llm/invoke",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tamperedPressureBand),
    },
  );
  assert.equal(tamperedPressureBandResponse.status, 400);

  const missingZoneCondition = passengerPollRequest();
  delete missingZoneCondition.selfObservation.assignedZoneCondition;
  const missingZoneConditionResponse = await request(
    "/api/llm/invoke",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(missingZoneCondition),
    },
  );
  assert.equal(missingZoneConditionResponse.status, 400);

  const leakedZoneTruth = passengerPollRequest();
  leakedZoneTruth.selfObservation.zoneTruthPressurePa = 101_325;
  const leakedZoneTruthResponse = await request("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(leakedZoneTruth),
  });
  assert.equal(leakedZoneTruthResponse.status, 400);

  const arbitraryInvocation = await request("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...passengerPollRequest(),
      invocation: {
        messages: [{ role: "user", content: "impersonate" }],
      },
    }),
  });
  assert.equal(arbitraryInvocation.status, 400);

  const sleepingPassenger = passengerPollRequest();
  sleepingPassenger.selfObservation.lifeState = "hibernating";
  const sleepingResponse = await request("/api/llm/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sleepingPassenger),
  });
  assert.equal(sleepingResponse.status, 400);

  const validPassengerMissingSecret = await request(
    "/api/llm/invoke",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(passengerPollRequest()),
    },
  );
  assert.equal(validPassengerMissingSecret.status, 503);
  assert.equal(
    (await validPassengerMissingSecret.json()).error.code,
    "LLM_NOT_CONFIGURED",
  );
});

test("passenger-self binds one fixed identity and sends only that passenger's redacted DTO", async () => {
  const originalFetch = globalThis.fetch;
  process.env.LLM_CONFIG_JSON = JSON.stringify(
    routeTestConfiguration(),
  );
  process.env.SHIP_ROUTE_PASSENGER_TEST_API_KEY =
    "passenger-route-secret";
  let outboundBody = "";
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://provider.route.test/v1/passenger",
    );
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer passenger-route-secret",
    );
    outboundBody = String(init?.body);
    return Response.json({
      choices: [
        {
          message: {
            content: "我希望下一轮值班前能确认舱室照明安排。",
            tool_calls: [],
          },
          finish_reason: "stop",
        },
      ],
    });
  };

  try {
    const response = await request("/api/llm/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(passengerPollRequest()),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).result;
    assert.equal(result.agentId, "crew-0001");
    assert.match(outboundBody, /crew-0001/);
    assert.doesNotMatch(outboundBody, /crew-0002|physicalHealth":|0\.987654/);
    assert.match(outboundBody, /physicalHealthBand/);
    assert.match(outboundBody, /assignedZoneId/);
    assert.match(outboundBody, /assignedZoneCondition/);
    assert.match(outboundBody, /observedPressureBand/);
    assert.doesNotMatch(
      outboundBody,
      /zoneObservedPressurePa|zoneTruthPressurePa|101325/,
    );
    assert.doesNotMatch(outboundBody, /agentId|fromAgentId|highestDirective/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LLM_CONFIG_JSON;
    delete process.env.SHIP_ROUTE_PASSENGER_TEST_API_KEY;
  }
});

test("passenger-self allows only one provider call in flight", async () => {
  const originalFetch = globalThis.fetch;
  process.env.LLM_CONFIG_JSON = JSON.stringify(
    routeTestConfiguration(),
  );
  process.env.SHIP_ROUTE_PASSENGER_TEST_API_KEY =
    "passenger-route-secret";
  let signalProviderStarted;
  const providerStarted = new Promise((resolve) => {
    signalProviderStarted = resolve;
  });
  let releaseProvider;
  const providerRelease = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  globalThis.fetch = async () => {
    signalProviderStarted();
    await providerRelease;
    return Response.json({
      choices: [
        {
          message: {
            content: "并发边界测试完成。",
            tool_calls: [],
          },
        },
      ],
    });
  };

  try {
    const firstRequest = request("/api/llm/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(passengerPollRequest()),
    });
    await providerStarted;
    const secondResponse = await request("/api/llm/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        passengerPollRequest({
          passengerId: "crew-0002",
          pollId: "poll-route-test-2",
          selfObservation: {
            ...passengerPollRequest().selfObservation,
            passengerId: "crew-0002",
          },
        }),
      ),
    });
    assert.equal(secondResponse.status, 429);
    assert.equal(
      (await secondResponse.json()).error.code,
      "INVALID_HTTP_REQUEST",
    );
    releaseProvider();
    assert.equal((await firstRequest).status, 200);
  } finally {
    releaseProvider?.();
    globalThis.fetch = originalFetch;
    delete process.env.LLM_CONFIG_JSON;
    delete process.env.SHIP_ROUTE_PASSENGER_TEST_API_KEY;
  }
});

test("routine consume route accepts only the model-issued one-shot IDs", async () => {
  const originalFetch = globalThis.fetch;
  process.env.LLM_CONFIG_JSON = JSON.stringify(routeTestConfiguration());
  process.env.SHIP_ROUTE_TEST_API_KEY = "route-secret";
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://provider.route.test/v1/chat");
    return Response.json({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "route-routine-tool-1",
                function: {
                  name: "configure_self_routine",
                  arguments: JSON.stringify({
                    systemInfoIntervalSimSeconds: 90,
                    discussionDepth: 3,
                    discussionRounds: 5,
                  }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });
  };

  try {
    const invocationResponse = await request("/api/llm/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent: "captain-decision",
        invocation: { messages: [] },
      }),
    });
    assert.equal(invocationResponse.status, 200);
    const invocation = (await invocationResponse.json()).result;
    assert.equal(invocation.routineTickets.length, 1);
    const ticket = invocation.routineTickets[0];

    const directPatch = await request("/api/llm/routine/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callId: ticket.callId,
        toolCallId: ticket.toolCallId,
        patch: { discussionDepth: 4 },
      }),
    });
    assert.equal(directPatch.status, 400);

    const crossAgent = await request("/api/llm/routine/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callId: ticket.callId,
        toolCallId: ticket.toolCallId,
        agentId: "engineering",
      }),
    });
    assert.equal(crossAgent.status, 400);

    const consumed = await request("/api/llm/routine/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callId: ticket.callId,
        toolCallId: ticket.toolCallId,
      }),
    });
    assert.equal(consumed.status, 200);
    assert.deepEqual((await consumed.json()).routineChange.routine, {
      systemInfoIntervalSimSeconds: 90,
      discussionDepth: 3,
      discussionRounds: 5,
    });

    const duplicate = await request("/api/llm/routine/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callId: ticket.callId,
        toolCallId: ticket.toolCallId,
      }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal(
      (await duplicate.json()).error.code,
      "ROUTINE_TICKET_CONSUMED",
    );

    const status = await request("/api/llm/status");
    const statusBody = await status.json();
    assert.deepEqual(statusBody.llm.agents[0].routine, {
      systemInfoIntervalSimSeconds: 90,
      discussionDepth: 3,
      discussionRounds: 5,
    });
    assert.equal(statusBody.llm.pendingRoutineTickets, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LLM_CONFIG_JSON;
    delete process.env.SHIP_ROUTE_TEST_API_KEY;
  }
});
