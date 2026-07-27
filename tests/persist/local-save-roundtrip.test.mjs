import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_SAVE_STORAGE_KEY,
  getManualSave,
  migrateLocalStorageSaveOnce,
  putManualSave,
} from "../../lib/persist/local-save-idb.ts";
import {
  createMemoryIdbFactory,
  createMemoryLocalStorage,
  sampleLocalSave,
} from "./idb-memory.mjs";

function keyFields(save) {
  return {
    version: save.version,
    origin: save.origin,
    destination: save.destination,
    directive: save.directive,
    simulationSeconds: save.simulationSeconds,
  };
}

test("putManualSave → getManualSave deep-equals key LocalSave fields", async () => {
  const adapters = {
    idbFactory: createMemoryIdbFactory(),
    localStorage: null,
    now: () => 1_700_000_000_000,
  };

  await putManualSave(sampleLocalSave, adapters);
  const loaded = await getManualSave(adapters);
  assert.ok(loaded);
  assert.deepEqual(keyFields(loaded), keyFields(sampleLocalSave));
  assert.equal(loaded.version, 21);
});

test("migrateLocalStorageSaveOnce: LS JSON → empty IDB → IDB load, LS cleared", async () => {
  const idbFactory = createMemoryIdbFactory();
  const localStorage = createMemoryLocalStorage();
  localStorage.setItem(LOCAL_SAVE_STORAGE_KEY, JSON.stringify(sampleLocalSave));
  const adapters = { idbFactory, localStorage, now: () => 42 };

  assert.equal(await getManualSave({ idbFactory, localStorage: null }), null);
  assert.equal(await migrateLocalStorageSaveOnce(adapters), "migrated");
  assert.equal(localStorage.getItem(LOCAL_SAVE_STORAGE_KEY), null);

  const loaded = await getManualSave(adapters);
  assert.ok(loaded);
  assert.deepEqual(keyFields(loaded), keyFields(sampleLocalSave));
});
