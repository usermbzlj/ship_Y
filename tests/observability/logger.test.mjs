import assert from "node:assert/strict";
import test from "node:test";

import {
  createLogger,
  parseLogLevel,
  sanitizeLogValue,
} from "../../lib/observability/logger.ts";
import {
  isValidRequestId,
  requestIdFromHeaders,
} from "../../lib/observability/request-id.ts";

test("structured logger redacts secrets and bounds hostile values", () => {
  const circular = { requestId: "browser-safe-request-1" };
  circular.self = circular;
  circular.authorization = "Bearer must-not-leak";
  circular.accessToken = "token-must-not-leak";
  circular.nested = {
    apiKey: "must-not-leak",
    message: "useful failure",
  };

  const sanitized = sanitizeLogValue(circular);
  const encoded = JSON.stringify(sanitized);
  assert.match(encoded, /browser-safe-request-1/);
  assert.match(encoded, /useful failure/);
  assert.match(encoded, /\[REDACTED\]/);
  assert.match(encoded, /\[circular\]/);
  assert.doesNotMatch(encoded, /must-not-leak/);
});

test("logger enforces levels and serializes Error details", () => {
  const entries = [];
  const logger = createLogger("test", {
    minLevel: "warn",
    context: { requestId: "request-12345678" },
    sink: (entry) => entries.push(entry),
  });
  logger.info("ignored");
  logger.warn("recoverable", { error: new Error("disk fallback") });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, "recoverable");
  assert.equal(entries[0].context.requestId, "request-12345678");
  assert.equal(entries[0].details.error.message, "disk fallback");
  assert.equal(parseLogLevel("ERROR"), "error");
  assert.equal(parseLogLevel("nonsense", "debug"), "debug");
});

test("request ids accept safe correlation values and replace hostile input", () => {
  assert.equal(isValidRequestId("browser-12345678"), true);
  assert.equal(isValidRequestId("too-short"), true);
  assert.equal(isValidRequestId("bad id with spaces"), false);

  const accepted = requestIdFromHeaders(
    new Headers({ "x-request-id": "browser-12345678" }),
  );
  assert.equal(accepted, "browser-12345678");

  const replaced = requestIdFromHeaders(
    new Headers({ "x-request-id": "bad id with spaces" }),
  );
  assert.match(replaced, /^req-/);
  assert.equal(isValidRequestId(replaced), true);
});

test("value scan redacts bearer tokens and sk- secrets", () => {
  const sanitized = sanitizeLogValue({
    note: "ok",
    authHeader: "Bearer secret-token-value",
    apiSecret: "sk-abcdefghijklmnop",
    ordinary: "not-a-secret",
  });
  const encoded = JSON.stringify(sanitized);
  assert.match(encoded, /"note":"ok"/);
  assert.match(encoded, /"ordinary":"not-a-secret"/);
  assert.match(encoded, /\[REDACTED\]/);
  assert.doesNotMatch(encoded, /secret-token-value/);
  assert.doesNotMatch(encoded, /sk-abcdefghijklmnop/);
  assert.doesNotMatch(encoded, /Bearer /);
});

test("privateKey and setCookie keys are redacted", () => {
  const sanitized = sanitizeLogValue({
    privateKey: "pk-must-not-leak",
    setCookie: "session=must-not-leak",
    safeField: "visible",
  });
  const encoded = JSON.stringify(sanitized);
  assert.match(encoded, /"safeField":"visible"/);
  assert.match(encoded, /\[REDACTED\]/);
  assert.doesNotMatch(encoded, /pk-must-not-leak/);
  assert.doesNotMatch(encoded, /must-not-leak/);
  assert.equal(sanitized.privateKey, "[REDACTED]");
  assert.equal(sanitized.setCookie, "[REDACTED]");
});
