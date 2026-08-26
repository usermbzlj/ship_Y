import assert from "node:assert/strict";
import test from "node:test";

import {
  BASELINE_ZONE_IDS,
  COMPARTMENT_COUNT,
  ZONE_CATALOG,
  resolveZoneIdForCabin,
  zoneCatalogEntry,
  zoneIdsForRole,
} from "../../lib/sim/compartments.ts";

const CREW_ROLES = new Set([
  "industrial",
  "access",
  "medical",
  "galley",
]);
const HAB_ROLES = new Set(["living", "public"]);

test("zone catalog covers all 48 baseline zones with roles", () => {
  assert.equal(ZONE_CATALOG.length, COMPARTMENT_COUNT);
  assert.equal(ZONE_CATALOG.length, BASELINE_ZONE_IDS.length);
  assert.deepEqual(
    ZONE_CATALOG.map((entry) => entry.id),
    [...BASELINE_ZONE_IDS],
  );
  for (const entry of ZONE_CATALOG) {
    assert.ok(entry.role, `${entry.id} must have a role`);
    assert.ok(entry.labelZh.length > 0);
    assert.ok(entry.purposeZh.length > 0);
    assert.equal(entry.ring, entry.id.startsWith("A") ? "A" : "B");
    assert.equal(zoneCatalogEntry(entry.id).role, entry.role);
  }
  assert.equal(zoneIdsForRole("living").length, 20);
  assert.equal(zoneIdsForRole("living", "A").length, 10);
  assert.equal(zoneIdsForRole("galley", "B").length, 1);
});

test("crew cabins map into duty zones and hab into living/public", () => {
  for (let index = 1; index <= 40; index += 1) {
    const crewCabin = `CREW-01-${String(index).padStart(4, "0")}`;
    const habCabin = `HAB-01-${String(index).padStart(4, "0")}`;
    const crewZone = resolveZoneIdForCabin(crewCabin);
    const habZone = resolveZoneIdForCabin(habCabin);
    assert.ok(
      CREW_ROLES.has(zoneCatalogEntry(crewZone).role),
      `${crewCabin} -> ${crewZone}`,
    );
    assert.ok(
      HAB_ROLES.has(zoneCatalogEntry(habZone).role),
      `${habCabin} -> ${habZone}`,
    );
  }
});

test("cabin to zone mapping is deterministic", () => {
  const cabin = "HAB-02-0042";
  const first = resolveZoneIdForCabin(cabin);
  const second = resolveZoneIdForCabin(cabin);
  assert.equal(first, second);
  assert.equal(first, "A-03");
  assert.equal(resolveZoneIdForCabin("CREW-01-0001"), "B-21");
  assert.equal(resolveZoneIdForCabin("HAB-01-0002"), "A-02");
});

test("resolveZoneIdForCabin rejects a zero cabin index instead of returning a bogus zone", () => {
  // (0 - 1) % pool.length is negative in JS, which previously produced an
  // undefined zone index (e.g. "A-undefined") behind a non-null assertion.
  assert.throws(() => resolveZoneIdForCabin("HAB-01-0000"), /index must be >= 1/);
  assert.throws(() => resolveZoneIdForCabin("CREW-02-0000"), /index must be >= 1/);
});
