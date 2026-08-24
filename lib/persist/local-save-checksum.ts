/**
 * SHA-256 checksum over canonical JSON of a LocalSave payload,
 * excluding the `checksum` field itself.
 *
 * Browser: Web Crypto SubtleCrypto.
 * Node tests: crypto.createHash (when SubtleCrypto is unavailable).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deterministic JSON: sorted object keys, recursive; arrays keep order.
 *
 * Mirrors `JSON.stringify` value semantics exactly so a checksum computed on a
 * live object equals the checksum computed after a `JSON.stringify` →
 * `JSON.parse` round-trip (the IndexedDB → localStorage fallback path). That
 * means: object keys whose value is `undefined`/function/symbol are omitted,
 * such values inside arrays become `null`, non-finite numbers (`NaN`,
 * `Infinity`) become `null`, and `toJSON` (e.g. `Date`) is honored. Without
 * this, a valid save could be flagged corrupt after the fallback re-serializes
 * it and drops those keys.
 */
export function canonicalJsonStringify(value: unknown): string {
  const canonical = canonicalize(value);
  return canonical === undefined ? "null" : canonical;
}

/** Returns the canonical string, or `undefined` for JSON-omitted values. */
function canonicalize(value: unknown): string | undefined {
  if (value === null) return "null";
  const valueType = typeof value;
  if (valueType === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  if (valueType === "boolean" || valueType === "string") {
    return JSON.stringify(value);
  }
  if (
    valueType === "undefined" ||
    valueType === "function" ||
    valueType === "symbol"
  ) {
    return undefined;
  }
  if (valueType === "bigint") {
    // JSON.stringify throws on bigint; match that so bad payloads never seal.
    return JSON.stringify(value as never);
  }
  const objectValue = value as {
    toJSON?: (key?: string) => unknown;
  };
  if (typeof objectValue.toJSON === "function") {
    return canonicalize(objectValue.toJSON());
  }
  if (Array.isArray(value)) {
    const items = value.map((entry) => {
      const canonical = canonicalize(entry);
      return canonical === undefined ? "null" : canonical;
    });
    return `[${items.join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const canonical = canonicalize(record[key]);
    if (canonical === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonical}`);
  }
  return `{${parts.join(",")}}`;
}

export function stripChecksumField<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, "checksum"> {
  const { checksum: _checksum, ...rest } = payload;
  return rest;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export async function sha256Hex(utf8: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    const digest = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(utf8),
    );
    return bytesToHex(new Uint8Array(digest));
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(utf8, "utf8").digest("hex");
}

/**
 * Compute checksum for any save-shaped object (checksum field ignored).
 */
export async function computeLocalSaveChecksum(
  payload: unknown,
): Promise<string> {
  if (!isPlainObject(payload)) {
    throw new Error("checksum requires a plain object payload");
  }
  const canonical = canonicalJsonStringify(stripChecksumField(payload));
  return sha256Hex(canonical);
}

/**
 * Attach (or replace) `checksum` on a save payload.
 */
export async function withLocalSaveChecksum<T extends Record<string, unknown>>(
  payload: T,
): Promise<T & { checksum: string }> {
  const without = stripChecksumField(payload);
  const checksum = await computeLocalSaveChecksum(without);
  return { ...without, checksum } as T & { checksum: string };
}

/**
 * Returns true when `checksum` matches the canonical payload.
 * Missing / non-string checksum → false.
 */
export async function verifyLocalSaveChecksum(
  payload: unknown,
): Promise<boolean> {
  if (!isPlainObject(payload)) {
    return false;
  }
  const expected = payload.checksum;
  if (typeof expected !== "string" || expected.length === 0) {
    return false;
  }
  const actual = await computeLocalSaveChecksum(payload);
  return actual === expected;
}
