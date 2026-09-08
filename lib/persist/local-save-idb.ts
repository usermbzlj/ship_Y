/**
 * Local save via IndexedDB: manual slot + rotating auto slots.
 * Keeps `farhorizon-save` localStorage key for one-time migration / fallback.
 *
 * Avoids importing `LocalSave` from `app/ui/types` (lib → app); callers
 * pass the full save object. Persistence only requires `version`.
 */

import { withLocalSaveChecksum } from "./local-save-checksum.ts";
import type { LocalSave } from "@/app/ui/types";

export const LOCAL_SAVE_STORAGE_KEY = "farhorizon-save";
export const IDB_DB_NAME = "farhorizon";
export const IDB_STORE = "saves";
export const IDB_MANUAL_SLOT = "manual";
export const IDB_AUTO_SLOTS = ["auto-0", "auto-1", "auto-2"] as const;
export const IDB_AUTO_RING_META = "auto-ring";

export type AutoSaveSlotId = (typeof IDB_AUTO_SLOTS)[number];
export type SaveSlotId = typeof IDB_MANUAL_SLOT | AutoSaveSlotId;

const IDB_VERSION = 1;

/** Structural minimum; full shape lives in `app/ui/types` as `LocalSave`. */
export type LocalSavePayload = {
  version: number;
  checksum?: string;
  slotId?: string;
  simulationSeconds?: number;
  missionStarted?: boolean;
};

export type SaveRecord<T extends LocalSavePayload = LocalSavePayload> = {
  id: string;
  save: T;
  updatedAtEpochMs: number;
};

/** @deprecated Prefer SaveRecord; kept for existing call-site clarity. */
export type ManualSaveRecord<T extends LocalSavePayload = LocalSavePayload> =
  SaveRecord<T> & { id: typeof IDB_MANUAL_SLOT };

export type AutoRingMetaRecord = {
  id: typeof IDB_AUTO_RING_META;
  nextIndex: number;
};

export type SaveSlotListing = {
  id: string;
  updatedAtEpochMs: number;
  simulationSeconds: number | null;
  missionStarted: boolean | null;
};

export type IdbFactory = IDBFactory;

export type LocalStorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type LocalSavePersistAdapters = {
  /** Inject for tests; `null` forces “unavailable”. */
  idbFactory?: IdbFactory | null;
  localStorage?: LocalStorageLike | null;
  now?: () => number;
};

function resolveIdbFactory(
  adapters?: LocalSavePersistAdapters,
): IdbFactory | null {
  if (adapters && "idbFactory" in adapters) {
    return adapters.idbFactory ?? null;
  }
  if (typeof indexedDB === "undefined") {
    return null;
  }
  return indexedDB;
}

function resolveLocalStorage(
  adapters?: LocalSavePersistAdapters,
): LocalStorageLike | null {
  if (adapters && "localStorage" in adapters) {
    return adapters.localStorage ?? null;
  }
  if (typeof localStorage === "undefined") {
    return null;
  }
  return localStorage;
}

function resolveNow(adapters?: LocalSavePersistAdapters): number {
  return adapters?.now?.() ?? Date.now();
}

function openDb(factory: IdbFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(IDB_DB_NAME, IDB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB open failed"));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function withStore<T>(
  factory: IdbFactory,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return openDb(factory).then(async (db) => {
    try {
      const tx = db.transaction(IDB_STORE, mode);
      const store = tx.objectStore(IDB_STORE);
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        tx.onabort = () =>
          reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      });
      const result = await run(store);
      await done;
      return result;
    } finally {
      db.close();
    }
  });
}

function isSaveSlotId(id: string): id is SaveSlotId {
  return id === IDB_MANUAL_SLOT || (IDB_AUTO_SLOTS as readonly string[]).includes(id);
}

function toListing(record: SaveRecord): SaveSlotListing {
  const sim = record.save.simulationSeconds;
  return {
    id: record.id,
    updatedAtEpochMs: record.updatedAtEpochMs,
    simulationSeconds:
      typeof sim === "number" && Number.isFinite(sim) ? sim : null,
    missionStarted:
      typeof record.save.missionStarted === "boolean"
        ? record.save.missionStarted
        : null,
  };
}

/**
 * Seal checksum (+ optional slotId) and write one IndexedDB save slot.
 */
export async function putSave<T extends LocalSavePayload>(
  slot: SaveSlotId,
  save: T,
  adapters?: LocalSavePersistAdapters,
): Promise<void> {
  const factory = resolveIdbFactory(adapters);
  if (!factory) {
    throw new Error(
      "IndexedDB is unavailable (SSR or unsupported environment).",
    );
  }
  const sealed = await withLocalSaveChecksum({
    ...save,
    slotId: slot,
  } as T & { slotId: string });
  const record: SaveRecord<typeof sealed> = {
    id: slot,
    save: sealed,
    updatedAtEpochMs: resolveNow(adapters),
  };
  await withStore(factory, "readwrite", async (store) => {
    await idbRequest(store.put(record));
  });
}

export async function getSave<T extends LocalSavePayload = LocalSavePayload>(
  slot: SaveSlotId,
  adapters?: LocalSavePersistAdapters,
): Promise<T | null> {
  const factory = resolveIdbFactory(adapters);
  if (!factory) {
    return null;
  }
  try {
    const record = await withStore(factory, "readonly", async (store) => {
      return idbRequest<SaveRecord<T> | undefined>(store.get(slot));
    });
    if (record?.save != null) {
      return record.save;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * List occupied save slots (manual + auto-*). Excludes ring meta.
 */
export async function listSlots(
  adapters?: LocalSavePersistAdapters,
): Promise<SaveSlotListing[]> {
  const factory = resolveIdbFactory(adapters);
  if (!factory) {
    return [];
  }
  try {
    const records = await withStore(factory, "readonly", async (store) => {
      return idbRequest<unknown[]>(store.getAll());
    });
    const listings: SaveSlotListing[] = [];
    for (const entry of records) {
      if (
        entry == null ||
        typeof entry !== "object" ||
        !("id" in entry) ||
        typeof (entry as SaveRecord).id !== "string"
      ) {
        continue;
      }
      const record = entry as SaveRecord;
      if (!isSaveSlotId(record.id) || record.save == null) {
        continue;
      }
      listings.push(toListing(record));
    }
    listings.sort((a, b) => b.updatedAtEpochMs - a.updatedAtEpochMs);
    return listings;
  } catch {
    return [];
  }
}

/**
 * Write into the next auto-* ring slot (auto-0 → auto-1 → auto-2 → …).
 */
export async function putRotatedAutoSave<T extends LocalSavePayload>(
  save: T,
  adapters?: LocalSavePersistAdapters,
): Promise<AutoSaveSlotId> {
  const factory = resolveIdbFactory(adapters);
  if (!factory) {
    throw new Error(
      "IndexedDB is unavailable (SSR or unsupported environment).",
    );
  }

  // Read ring cursor first; seal checksum outside the write txn so the
  // transaction cannot auto-commit while awaiting Web Crypto / hashing.
  const index = await withStore(factory, "readonly", async (store) => {
    const meta = await idbRequest<AutoRingMetaRecord | undefined>(
      store.get(IDB_AUTO_RING_META),
    );
    if (
      meta &&
      typeof meta.nextIndex === "number" &&
      Number.isInteger(meta.nextIndex) &&
      meta.nextIndex >= 0
    ) {
      return meta.nextIndex % IDB_AUTO_SLOTS.length;
    }
    return 0;
  });
  const slot = IDB_AUTO_SLOTS[index]!;
  const sealed = await withLocalSaveChecksum({
    ...save,
    slotId: slot,
  } as T & { slotId: string });
  const record: SaveRecord<typeof sealed> = {
    id: slot,
    save: sealed,
    updatedAtEpochMs: resolveNow(adapters),
  };
  const ring: AutoRingMetaRecord = {
    id: IDB_AUTO_RING_META,
    nextIndex: (index + 1) % IDB_AUTO_SLOTS.length,
  };
  await withStore(factory, "readwrite", async (store) => {
    await idbRequest(store.put(record));
    await idbRequest(store.put(ring));
  });
  return slot;
}

/** Latest auto-* slot by updatedAtEpochMs, or null. */
export async function getLatestAutoSave<
  T extends LocalSavePayload = LocalSavePayload,
>(adapters?: LocalSavePersistAdapters): Promise<{
  slotId: AutoSaveSlotId;
  save: T;
  updatedAtEpochMs: number;
} | null> {
  const listings = await listSlots(adapters);
  const latest = listings.find((entry) =>
    (IDB_AUTO_SLOTS as readonly string[]).includes(entry.id),
  );
  if (!latest) {
    return null;
  }
  const save = await getSave<T>(latest.id as AutoSaveSlotId, adapters);
  if (!save) {
    return null;
  }
  return {
    slotId: latest.id as AutoSaveSlotId,
    save,
    updatedAtEpochMs: latest.updatedAtEpochMs,
  };
}

/**
 * A05修复:写入时附加commitMeta
 */
export async function putManualSave<T extends LocalSavePayload>(
  save: T,
  adapters?: LocalSavePersistAdapters,
): Promise<void> {
  const withMeta = {
    ...save,
    commitMeta: {
      timestampMs: Date.now(),
      backend: "idb" as const,
    },
  } as T;
  await putSave(IDB_MANUAL_SLOT, withMeta, adapters);
}

function readLocalStorageSave<T extends LocalSavePayload>(
  adapters?: LocalSavePersistAdapters,
): T | null {
  const storage = resolveLocalStorage(adapters);
  if (!storage) {
    return null;
  }
  const raw = storage.getItem(LOCAL_SAVE_STORAGE_KEY);
  if (raw == null || raw === "") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed == null ||
      typeof parsed !== "object" ||
      typeof (parsed as LocalSavePayload).version !== "number"
    ) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * A05修复:从IDB和localStorage读取,选择最新有效commit
 * 不再无条件优先IDB
 */
export async function getManualSave<
  T extends LocalSavePayload = LocalSavePayload,
>(adapters?: LocalSavePersistAdapters): Promise<T | null> {
  const fromIdb = await getSave<T>(IDB_MANUAL_SLOT, adapters);
  const fromLs = await readLocalStorageSave<T>(adapters);
  
  // 都不存在
  if (fromIdb == null && fromLs == null) {
    return null;
  }
  
  // 只有一个存在
  if (fromIdb == null) return fromLs;
  if (fromLs == null) return fromIdb;
  
  // 都存在:按commitMeta.timestampMs选主
  const idbTime = (fromIdb as unknown as LocalSave).commitMeta?.timestampMs ?? 0;
  const lsTime = (fromLs as unknown as LocalSave).commitMeta?.timestampMs ?? 0;
  
  // 优先选择时间戳更新的;相等时优先IDB(旧行为兼容)
  return idbTime >= lsTime ? fromIdb : fromLs;
}

export async function hasManualSave(
  adapters?: LocalSavePersistAdapters,
): Promise<boolean> {
  return (await getManualSave(adapters)) != null;
}

/**
 * One-time migration: if IDB has no manual slot and localStorage still
 * holds `farhorizon-save`, parse → putManualSave → removeItem.
 * Idempotent. On parse failure, leave LS and return `"skipped"`.
 * Uses the IDB slot only (ignores localStorage fallback used by get/has).
 */
export async function migrateLocalStorageSaveOnce(
  adapters?: LocalSavePersistAdapters,
): Promise<"migrated" | "skipped" | "empty"> {
  const factory = resolveIdbFactory(adapters);
  if (!factory) {
    return "skipped";
  }

  try {
    const record = await withStore(factory, "readonly", async (store) => {
      return idbRequest<SaveRecord | undefined>(store.get(IDB_MANUAL_SLOT));
    });
    if (record != null && record.save != null) {
      return "skipped";
    }
  } catch {
    return "skipped";
  }

  const storage = resolveLocalStorage(adapters);
  if (!storage) {
    return "empty";
  }

  const raw = storage.getItem(LOCAL_SAVE_STORAGE_KEY);
  if (raw == null || raw === "") {
    return "empty";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "skipped";
  }

  if (
    parsed == null ||
    typeof parsed !== "object" ||
    typeof (parsed as LocalSavePayload).version !== "number"
  ) {
    return "skipped";
  }

  await putManualSave(parsed as LocalSavePayload, adapters);
  storage.removeItem(LOCAL_SAVE_STORAGE_KEY);
  return "migrated";
}

/**
 * Write to localStorage when IndexedDB put fails (optional fallback).
 * A05修复:附加commitMeta标记localStorage后端和时间戳
 * Clears the IDB manual slot (best-effort) so later get/has prefer this
 * fresher LS copy instead of a stale IDB record.
 * Seals checksum before writing.
 */
export async function putManualSaveToLocalStorageFallback<
  T extends LocalSavePayload,
>(save: T, adapters?: LocalSavePersistAdapters): Promise<void> {
  const storage = resolveLocalStorage(adapters);
  if (!storage) {
    throw new Error("localStorage is unavailable.");
  }
  const withMeta = {
    ...save,
    commitMeta: {
      timestampMs: Date.now(),
      backend: "localStorage" as const,
    },
  } as T & { slotId: string };
  const sealed = await withLocalSaveChecksum({
    ...withMeta,
    slotId: IDB_MANUAL_SLOT,
  });
  storage.setItem(LOCAL_SAVE_STORAGE_KEY, JSON.stringify(sealed));

  const factory = resolveIdbFactory(adapters);
  if (!factory) {
    return;
  }
  try {
    await withStore(factory, "readwrite", async (store) => {
      await idbRequest(store.delete(IDB_MANUAL_SLOT));
    });
  } catch {
    // Best-effort: LS already holds the newer save; get falls through when
    // the slot is gone, and migrate-once can recover on a later load.
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return true;
  }
  return "code" in error && (error.code === 22 || error.code === 1014);
}
