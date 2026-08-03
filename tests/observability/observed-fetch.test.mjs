import assert from "node:assert/strict";
import test from "node:test";

import {
  observedFetch,
  resetObservedFetchRateLimitsForTests,
  STATUS_POLL_SUCCESS_LOG_INTERVAL_MS,
} from "../../lib/observability/observed-fetch.ts";
import { isValidRequestId } from "../../lib/observability/request-id.ts";

test("observedFetch attaches x-request-id and forwards operation option", async () => {
  const originalFetch = globalThis.fetch;
  /** @type {{ input: RequestInfo | URL, init?: RequestInit }[]} */
  const calls = [];

  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": "echo-browser-12345678",
      },
    });
  };

  try {
    const response = await observedFetch(
      "/api/llm/status",
      { method: "GET", cache: "no-store" },
      { operation: "llm.status.poll" },
    );

    assert.equal(calls.length, 1);
    assert.equal(String(calls[0].input), "/api/llm/status");
    const headers = new Headers(calls[0].init?.headers);
    const requestId = headers.get("x-request-id");
    assert.ok(requestId);
    assert.equal(isValidRequestId(requestId), true);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), "echo-browser-12345678");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("observedFetch preserves an existing valid x-request-id", async () => {
  const originalFetch = globalThis.fetch;
  /** @type {Headers | undefined} */
  let seenHeaders;

  globalThis.fetch = async (_input, init) => {
    seenHeaders = new Headers(init?.headers);
    return new Response("{}", { status: 200 });
  };

  try {
    await observedFetch(
      "/api/llm/invoke",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "browser-existing-1",
        },
        body: "{}",
      },
      { operation: "god-assist.invoke" },
    );
    assert.equal(seenHeaders?.get("x-request-id"), "browser-existing-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("llm.status.poll success logging is rate-limited without affecting fetch", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  };

  try {
    resetObservedFetchRateLimitsForTests();
    await observedFetch("/api/llm/status", { method: "GET" }, {
      operation: "llm.status.poll",
    });
    await observedFetch("/api/llm/status", { method: "GET" }, {
      operation: "llm.status.poll",
    });
    assert.equal(calls, 2);
    assert.ok(STATUS_POLL_SUCCESS_LOG_INTERVAL_MS >= 1_000);
  } finally {
    globalThis.fetch = originalFetch;
    resetObservedFetchRateLimitsForTests();
  }
});
