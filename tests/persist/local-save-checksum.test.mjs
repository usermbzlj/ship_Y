import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalJsonStringify,
  computeLocalSaveChecksum,
  verifyLocalSaveChecksum,
  withLocalSaveChecksum,
} from "../../lib/persist/local-save-checksum.ts";

test("canonicalJsonStringify sorts object keys", () => {
  assert.equal(
    canonicalJsonStringify({ b: 1, a: 2 }),
    '{"a":2,"b":1}',
  );
  assert.equal(
    canonicalJsonStringify({ a: { d: 1, c: 2 }, b: [3, { z: 1, y: 2 }] }),
    '{"a":{"c":2,"d":1},"b":[3,{"y":2,"z":1}]}',
  );
});

test("checksum ignores checksum field and is stable", async () => {
  const base = { version: 24, origin: "sol", nested: { b: 2, a: 1 } };
  const a = await computeLocalSaveChecksum(base);
  const b = await computeLocalSaveChecksum({ ...base, checksum: "deadbeef" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("withLocalSaveChecksum + verify round-trip", async () => {
  const sealed = await withLocalSaveChecksum({
    version: 24,
    directive: "probe",
    slotId: "manual",
  });
  assert.equal(typeof sealed.checksum, "string");
  assert.equal(await verifyLocalSaveChecksum(sealed), true);
  assert.equal(
    await verifyLocalSaveChecksum({ ...sealed, checksum: "0".repeat(64) }),
    false,
  );
});

test("tampering payload fails verify", async () => {
  const sealed = await withLocalSaveChecksum({ version: 24, x: 1 });
  assert.equal(
    await verifyLocalSaveChecksum({ ...sealed, x: 2 }),
    false,
  );
});
