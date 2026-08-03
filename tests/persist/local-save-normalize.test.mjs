import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLoadedLocalSave } from "../../lib/persist/local-save-normalize.ts";
import { CAPTAIN_JOURNAL_SNAPSHOT_VERSION } from "../../lib/llm/captain-journal.ts";
import { createCaptainJournalSnapshot } from "../../lib/llm/captain-journal.ts";
import { createCaptainWatchSnapshot } from "../../lib/llm/captain-watch.ts";
import { createDepartmentStandingSnapshot } from "../../lib/llm/department-standing.ts";
import {
  createPassengerSocietySnapshot,
  recordPassengerRumor,
} from "../../lib/llm/passenger-society.ts";
import {
  withLocalSaveChecksum,
} from "../../lib/persist/local-save-checksum.ts";

function validSaveBase(overrides = {}) {
  return {
    version: 22,
    activeView: "voyage",
    missionStarted: false,
    paused: true,
    timeScale: 1,
    simulationSeconds: 120,
    nextCaptainRoutineAtSimulationSeconds: null,
    origin: "sol",
    destination: "barnard",
    directive: "test directive",
    events: [],
    keyPassengerLlm: { snapshotVersion: 2 },
    captainWatch: undefined,
    departmentStanding: undefined,
    passengerSociety: undefined,
    runtimeSnapshot: null,
    ...overrides,
  };
}

test("rejects v18", async () => {
  const result = await normalizeLoadedLocalSave(
    validSaveBase({ version: 18 }),
    { captainRoutineSeconds: 3_600 },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "v18-unsupported");
  }
});

test("accepts v22 and normalizes to v24", async () => {
  const result = await normalizeLoadedLocalSave(validSaveBase(), {
    captainRoutineSeconds: 3_600,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.save.version, 24);
    assert.equal(result.save.origin, "sol");
    assert.equal(result.save.destination, "barnard");
    assert.equal(result.save.nextCaptainRoutineAtSimulationSeconds, null);
  }
});

test("accepts v23 and v24", async () => {
  for (const version of [23, 24]) {
    const result = await normalizeLoadedLocalSave(
      validSaveBase({ version }),
      { captainRoutineSeconds: 3_600 },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.save.version, 24);
    }
  }
});

test("fills missing journal", async () => {
  const result = await normalizeLoadedLocalSave(
    validSaveBase({
      version: 21,
      captainJournal: undefined,
    }),
    { captainRoutineSeconds: 3_600 },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.save.version, 24);
    assert.equal(
      result.save.captainJournal.snapshotVersion,
      CAPTAIN_JOURNAL_SNAPSHOT_VERSION,
    );
    assert.ok(Array.isArray(result.save.captainJournal.entries));
    assert.equal(result.save.captainJournal.entries.length, 0);
  }
});

test("prefers runtime v20 passengerSociety over outer field", async () => {
  const outer = createPassengerSocietySnapshot();
  const recorded = recordPassengerRumor(createPassengerSocietySnapshot(), {
    originPassengerId: "p-rt",
    originDisplayName: "运行时",
    zoneId: "B-04",
    text: "运行时权威传言",
    simulationSeconds: 30,
  });

  const result = await normalizeLoadedLocalSave(
    validSaveBase({
      version: 24,
      missionStarted: true,
      passengerSociety: outer,
      runtimeSnapshot: {
        snapshotVersion: 20,
        nextCaptainRoutineAtSimulationSeconds: 7_200,
        captainJournal: createCaptainJournalSnapshot(),
        captainWatch: createCaptainWatchSnapshot(),
        departmentStanding: createDepartmentStandingSnapshot(),
        passengerSociety: recorded.snapshot,
        llmOrchestration: { pending: null, acceptedCallIds: [] },
        highestDirective: "x",
      },
    }),
    { captainRoutineSeconds: 3_600 },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.save.passengerSociety.rumors.length, 1);
    assert.equal(
      result.save.passengerSociety.rumors[0].text,
      "运行时权威传言",
    );
  }
});

test("prefers runtime v19 sidecars over outer fields", async () => {
  const result = await normalizeLoadedLocalSave(
    validSaveBase({
      version: 23,
      missionStarted: true,
      nextCaptainRoutineAtSimulationSeconds: 9_999,
      captainJournal: createCaptainJournalSnapshot(),
      captainWatch: createCaptainWatchSnapshot(),
      departmentStanding: createDepartmentStandingSnapshot(),
      runtimeSnapshot: {
        snapshotVersion: 19,
        nextCaptainRoutineAtSimulationSeconds: 7_200,
        captainJournal: createCaptainJournalSnapshot(),
        captainWatch: createCaptainWatchSnapshot(),
        departmentStanding: createDepartmentStandingSnapshot(),
        llmOrchestration: { pending: null, acceptedCallIds: [] },
        highestDirective: "x",
      },
    }),
    { captainRoutineSeconds: 3_600 },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.save.nextCaptainRoutineAtSimulationSeconds, 7_200);
  }
});

test("rejects corrupt checksum with clear code", async () => {
  const sealed = await withLocalSaveChecksum(validSaveBase({ version: 24 }));
  const result = await normalizeLoadedLocalSave(
    { ...sealed, checksum: "0".repeat(64) },
    { captainRoutineSeconds: 3_600 },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "checksum-mismatch");
  }
});

test("accepts valid checksum", async () => {
  const sealed = await withLocalSaveChecksum(validSaveBase({ version: 24 }));
  const result = await normalizeLoadedLocalSave(sealed, {
    captainRoutineSeconds: 3_600,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.save.version, 24);
    assert.equal(result.save.checksum, sealed.checksum);
  }
});
