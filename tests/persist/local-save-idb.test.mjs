import assert from "node:assert/strict";
import test from "node:test";

import {
  IDB_DB_NAME,
  IDB_MANUAL_SLOT,
  IDB_STORE,
  LOCAL_SAVE_STORAGE_KEY,
  getManualSave,
  hasManualSave,
  isQuotaExceededError,
  migrateLocalStorageSaveOnce,
  putManualSave,
  putManualSaveToLocalStorageFallback,
} from "../../lib/persist/local-save-idb.ts";
import {
  createMemoryIdbFactory,
  createMemoryLocalStorage,
  sampleLocalSave,
} from "./idb-memory.mjs";

const sampleSave = sampleLocalSave;

test("put/get/has manual save via injectable idb", async () => {
  const idbFactory = createMemoryIdbFactory();
  const adapters = {
    idbFactory,
    localStorage: null,
    now: () => 1_700_000_000_000,
  };

  assert.equal(await hasManualSave(adapters), false);
  assert.equal(await getManualSave(adapters), null);

  await putManualSave(sampleSave, adapters);
  assert.equal(await hasManualSave(adapters), true);
  const loaded = await getManualSave(adapters);
  assert.deepEqual(loaded, sampleSave);
});

test("SSR / missing indexedDB: get/has null-safe, put throws", async () => {
  const adapters = { idbFactory: null, localStorage: null };
  assert.equal(await getManualSave(adapters), null);
  assert.equal(await hasManualSave(adapters), false);
  await assert.rejects(
    () => putManualSave(sampleSave, adapters),
    /IndexedDB is unavailable/,
  );
});

test("migrateLocalStorageSaveOnce migrates then is idempotent", async () => {
  const idbFactory = createMemoryIdbFactory();
  const localStorage = createMemoryLocalStorage();
  localStorage.setItem(LOCAL_SAVE_STORAGE_KEY, JSON.stringify(sampleSave));
  const adapters = { idbFactory, localStorage, now: () => 42 };

  assert.equal(await migrateLocalStorageSaveOnce(adapters), "migrated");
  assert.equal(localStorage.getItem(LOCAL_SAVE_STORAGE_KEY), null);
  assert.deepEqual(await getManualSave(adapters), sampleSave);

  assert.equal(await migrateLocalStorageSaveOnce(adapters), "skipped");
  // Re-seed LS; IDB already has slot → still skipped, LS untouched
  localStorage.setItem(LOCAL_SAVE_STORAGE_KEY, JSON.stringify(sampleSave));
  assert.equal(await migrateLocalStorageSaveOnce(adapters), "skipped");
  assert.equal(
    localStorage.getItem(LOCAL_SAVE_STORAGE_KEY),
    JSON.stringify(sampleSave),
  );
});

test("migrate returns empty when no LS and no IDB slot", async () => {
  const adapters = {
    idbFactory: createMemoryIdbFactory(),
    localStorage: createMemoryLocalStorage(),
  };
  assert.equal(await migrateLocalStorageSaveOnce(adapters), "empty");
});

test("migrate skips on invalid JSON and leaves LS", async () => {
  const localStorage = createMemoryLocalStorage();
  localStorage.setItem(LOCAL_SAVE_STORAGE_KEY, "{not-json");
  const adapters = {
    idbFactory: createMemoryIdbFactory(),
    localStorage,
  };
  assert.equal(await migrateLocalStorageSaveOnce(adapters), "skipped");
  assert.equal(localStorage.getItem(LOCAL_SAVE_STORAGE_KEY), "{not-json");
});

test("migrate skips when IDB unavailable", async () => {
  const localStorage = createMemoryLocalStorage();
  localStorage.setItem(LOCAL_SAVE_STORAGE_KEY, JSON.stringify(sampleSave));
  assert.equal(
    await migrateLocalStorageSaveOnce({ idbFactory: null, localStorage }),
    "skipped",
  );
  assert.equal(
    localStorage.getItem(LOCAL_SAVE_STORAGE_KEY),
    JSON.stringify(sampleSave),
  );
});

test("localStorage fallback helpers and get/has when IDB empty", async () => {
  const localStorage = createMemoryLocalStorage();
  await putManualSaveToLocalStorageFallback(sampleSave, { localStorage });
  assert.equal(
    localStorage.getItem(LOCAL_SAVE_STORAGE_KEY),
    JSON.stringify(sampleSave),
  );

  const adapters = {
    idbFactory: createMemoryIdbFactory(),
    localStorage,
  };
  assert.equal(await hasManualSave(adapters), true);
  assert.deepEqual(await getManualSave(adapters), sampleSave);
});

test("LS fallback after IDB put failure clears stale IDB so get returns newer LS", async () => {
  const idbFactory = createMemoryIdbFactory();
  const localStorage = createMemoryLocalStorage();
  const older = { ...sampleSave, directive: "older-idb" };
  const newer = { ...sampleSave, directive: "newer-ls-fallback" };

  await putManualSave(older, {
    idbFactory,
    localStorage,
    now: () => 1_000,
  });
  assert.deepEqual(await getManualSave({ idbFactory, localStorage }), older);

  await putManualSaveToLocalStorageFallback(newer, {
    idbFactory,
    localStorage,
    now: () => 2_000,
  });

  assert.deepEqual(await getManualSave({ idbFactory, localStorage }), newer);
  assert.equal(await hasManualSave({ idbFactory, localStorage }), true);
  // Slot cleared → migrate can recover LS into IDB on a later load
  assert.equal(
    await migrateLocalStorageSaveOnce({
      idbFactory,
      localStorage,
      now: () => 3_000,
    }),
    "migrated",
  );
  assert.equal(localStorage.getItem(LOCAL_SAVE_STORAGE_KEY), null);
  assert.deepEqual(await getManualSave({ idbFactory, localStorage }), newer);
});

test("isQuotaExceededError recognizes quota names", () => {
  assert.equal(isQuotaExceededError({ name: "QuotaExceededError" }), true);
  assert.equal(
    isQuotaExceededError({ name: "NS_ERROR_DOM_QUOTA_REACHED" }),
    true,
  );
  assert.equal(isQuotaExceededError({ name: "TypeError" }), false);
  assert.equal(isQuotaExceededError(null), false);
});

test("exported constants stay stable for migration", () => {
  assert.equal(LOCAL_SAVE_STORAGE_KEY, "farhorizon-save");
  assert.equal(IDB_DB_NAME, "farhorizon");
  assert.equal(IDB_STORE, "saves");
  assert.equal(IDB_MANUAL_SLOT, "manual");
});
