const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function isValidRequestId(value: string | null | undefined): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function createRequestId(prefix = "req"): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (id) return `${prefix}-${id}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function requestIdFromHeaders(headers: Headers): string {
  const incoming = headers.get("x-request-id");
  return isValidRequestId(incoming) ? incoming : createRequestId();
}

