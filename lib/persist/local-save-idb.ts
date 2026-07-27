/**
 * Manual local save via IndexedDB (single slot).
 * Keeps `farhorizon-save` localStorage key for one-time migration.
 *
 * Avoids importing `LocalSave` from `app/ui/types` (lib → app); callers
 * pass the full save object. Persistence only requires `version`.
 */

export const LOCAL_SAVE_STORAGE_KEY = "farhorizon-save";
export const IDB_DB_NAME = "farhorizon";
export const IDB_STORE = "saves";
export const IDB_MANUAL_SLOT = "manual";

const IDB_VERSION = 1;

/** Structural minimum; full shape lives in `app/ui/types` as `LocalSave`. */
export type LocalSavePayload = {
  version: number;
};

export type ManualSaveRecord<T extends LocalSavePayload = LocalSavePayload> = {
  id: typeof IDB_MANUAL_SLOT;
  save: T;
  updatedAtEpochMs: number;
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

export async function putManualSave<T extends LocalSavePayload>(
  save: T,
  adapters?: LocalSavePersistAdapters,
): Promise<void> {
  const factory = resolveIdbFactory(adapters);
  if (!factory) {
    throw new Error(
      "IndexedDB is unavailable (SSR or unsupported environment).",
    );
  }
  const record: ManualSaveRecord<T> = {
    id: IDB_MANUAL_SLOT,
    save,
    updatedAtEpochMs: resolveNow(adapters),
  };
  await withStore(factory, "readwrite", async (store) => {
    await idbRequest(store.put(record));
  });
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

export async function getManualSave<T extends LocalSavePayload = LocalSavePayload>(
  adapters?: LocalSavePersistAdapters,
): Promise<T | null> {
  const factory = resolveIdbFactory(adapters);
  if (factory) {
    try {
      const record = await withStore(factory, "readonly", async (store) => {
        return idbRequest<ManualSaveRecord<T> | undefined>(
          store.get(IDB_MANUAL_SLOT),
        );
      });
      if (record?.save != null) {
        return record.save;
      }
    } catch {
      // Fall through to localStorage fallback.
    }
  }
  return readLocalStorageSave<T>(adapters);
}

export async function hasManualSave(
  adapters?: LocalSavePersistAdapters,
): Promise<boolean> {
  const factory = resolveIdbFactory(adapters);
  if (factory) {
    try {
      const record = await withStore(factory, "readonly", async (store) => {
        return idbRequest<ManualSaveRecord | undefined>(
          store.get(IDB_MANUAL_SLOT),
        );
      });
      if (record != null && record.save != null) {
        return true;
      }
    } catch {
      // Fall through to localStorage fallback.
    }
  }
  return readLocalStorageSave(adapters) != null;
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
      return idbRequest<ManualSaveRecord | undefined>(
        store.get(IDB_MANUAL_SLOT),
      );
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
 * Clears the IDB manual slot (best-effort) so later get/has prefer this
 * fresher LS copy instead of a stale IDB record.
 */
export async function putManualSaveToLocalStorageFallback<
  T extends LocalSavePayload,
>(save: T, adapters?: LocalSavePersistAdapters): Promise<void> {
  const storage = resolveLocalStorage(adapters);
  if (!storage) {
    throw new Error("localStorage is unavailable.");
  }
  storage.setItem(LOCAL_SAVE_STORAGE_KEY, JSON.stringify(save));

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
  return (
    "code" in error &&
    (error.code === 22 || error.code === 1014)
  );
}
