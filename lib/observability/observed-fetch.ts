import { createLogger } from "./logger.ts";
import { createRequestId, isValidRequestId } from "./request-id.ts";

const log = createLogger("browser-http");

/** Successful `llm.status.poll` debug completions: at most once per this window. */
export const STATUS_POLL_SUCCESS_LOG_INTERVAL_MS = 30_000;

let lastStatusPollSuccessLogAt = 0;

export type ObservedFetchOptions = {
  operation?: string;
};

function requestUrl(input: RequestInfo | URL): URL {
  const raw = input instanceof Request ? input.url : String(input);
  const base =
    typeof location === "undefined" ? "http://localhost" : location.origin;
  return new URL(raw, base);
}

function shouldLogStatusPollSuccess(): boolean {
  const now = Date.now();
  if (now - lastStatusPollSuccessLogAt < STATUS_POLL_SUCCESS_LOG_INTERVAL_MS) {
    return false;
  }
  lastStatusPollSuccessLogAt = now;
  return true;
}

/** Test-only: reset status-poll rate-limit bookkeeping. */
export function resetObservedFetchRateLimitsForTests(): void {
  lastStatusPollSuccessLogAt = 0;
}

/**
 * Same-origin fetch with a correlation id and metadata-only logs. Bodies,
 * headers, prompts, and credentials are intentionally never logged.
 */
export async function observedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ObservedFetchOptions = {},
): Promise<Response> {
  const url = requestUrl(input);
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headers = new Headers(
    init.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  const sameOrigin =
    typeof location === "undefined" || url.origin === location.origin;
  const existingId = headers.get("x-request-id");
  const requestId = isValidRequestId(existingId)
    ? existingId
    : createRequestId("browser");
  if (sameOrigin) headers.set("x-request-id", requestId);

  const startedAt = performance.now();
  const isStatusPoll = options.operation === "llm.status.poll";
  const context = {
    requestId,
    method,
    path: url.pathname,
    ...(options.operation ? { operation: options.operation } : {}),
  };
  // Status polls are high-frequency in development; skip start noise.
  if (!isStatusPoll) {
    log.debug("http.client.started", context);
  }
  try {
    const response = await fetch(input, { ...init, headers });
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    const echoedRequestId = response.headers.get("x-request-id");
    const details = {
      ...context,
      status: response.status,
      durationMs,
      ...(echoedRequestId ? { responseRequestId: echoedRequestId } : {}),
    };
    if (!response.ok) {
      log.warn("http.client.completed", details);
    } else if (isStatusPoll) {
      if (shouldLogStatusPollSuccess()) {
        log.debug("http.client.completed", details);
      }
    } else if (method === "GET") {
      log.debug("http.client.completed", details);
    } else {
      log.info("http.client.completed", details);
    }
    return response;
  } catch (error) {
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    const details = { ...context, durationMs, error };
    if (error instanceof DOMException && error.name === "AbortError") {
      log.debug("http.client.aborted", details);
    } else {
      log.error("http.client.failed", details);
    }
    throw error;
  }
}
