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

/** Deterministic JSON: sorted object keys, recursive; arrays keep order. */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJsonStringify(entry)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJsonStringify(
          (value as Record<string, unknown>)[key],
        )}`,
    )
    .join(",");
  return `{${body}}`;
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
