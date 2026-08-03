/**
 * Minimal in-memory IndexedDB + localStorage for persist unit tests.
 * Matches the injectable adapters in `lib/persist/local-save-idb.ts`.
 */

import {
  IDB_STORE,
} from "../../lib/persist/local-save-idb.ts";

/** Minimal LocalSave-shaped legacy fixture (shape only; get/put only require `version`). */
export const sampleLocalSave = {
  version: 21,
  activeView: "bridge",
  missionStarted: false,
  paused: true,
  timeScale: 1,
  simulationSeconds: 0,
  nextCaptainRoutineAtSimulationSeconds: null,
  origin: "sol",
  destination: "proxima",
  directive: "test",
  events: [],
  keyPassengerLlm: { snapshotVersion: 2 },
  runtimeSnapshot: null,
};

export function createMemoryIdbFactory() {
  /** @type {Map<string, Map<string, unknown>>} */
  const databases = new Map();

  function ensureDb(name, version) {
    let db = databases.get(name);
    if (!db) {
      db = {
        version,
        stores: new Map(),
      };
      databases.set(name, db);
    }
    if (!db.stores.has(IDB_STORE)) {
      db.stores.set(IDB_STORE, new Map());
    }
    return db;
  }

  /** @type {IDBFactory} */
  const factory = {
    open(name, version = 1) {
      const request = createRequest();
      queueMicrotask(() => {
        const dbState = ensureDb(name, version);
        const db = {
          name,
          version: dbState.version,
          objectStoreNames: {
            contains(storeName) {
              return dbState.stores.has(storeName);
            },
          },
          createObjectStore(storeName, options) {
            if (!dbState.stores.has(storeName)) {
              dbState.stores.set(storeName, new Map());
            }
            return {
              name: storeName,
              keyPath: options?.keyPath ?? null,
            };
          },
          transaction(storeName) {
            const storeMap = dbState.stores.get(storeName);
            if (!storeMap) {
              throw new Error(`missing store ${storeName}`);
            }
            const tx = {
              error: null,
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore() {
                return {
                  put(value) {
                    const key = value.id;
                    const req = createRequest();
                    queueMicrotask(() => {
                      storeMap.set(key, structuredClone(value));
                      completeRequest(req, undefined);
                      queueMicrotask(() => {
                        tx.oncomplete?.();
                      });
                    });
                    return req;
                  },
                  get(key) {
                    const req = createRequest();
                    queueMicrotask(() => {
                      const value = storeMap.has(key)
                        ? structuredClone(storeMap.get(key))
                        : undefined;
                      completeRequest(req, value);
                      queueMicrotask(() => {
                        tx.oncomplete?.();
                      });
                    });
                    return req;
                  },
                  getAll() {
                    const req = createRequest();
                    queueMicrotask(() => {
                      const values = [...storeMap.values()].map((value) =>
                        structuredClone(value),
                      );
                      completeRequest(req, values);
                      queueMicrotask(() => {
                        tx.oncomplete?.();
                      });
                    });
                    return req;
                  },
                  getAllKeys() {
                    const req = createRequest();
                    queueMicrotask(() => {
                      completeRequest(req, [...storeMap.keys()]);
                      queueMicrotask(() => {
                        tx.oncomplete?.();
                      });
                    });
                    return req;
                  },
                  delete(key) {
                    const req = createRequest();
                    queueMicrotask(() => {
                      storeMap.delete(key);
                      completeRequest(req, undefined);
                      queueMicrotask(() => {
                        tx.oncomplete?.();
                      });
                    });
                    return req;
                  },
                };
              },
            };
            return tx;
          },
          close() {},
        };

        completeRequest(request, db);
      });
      return request;
    },
    deleteDatabase() {
      return createRequest();
    },
    cmp() {
      return 0;
    },
    databases: async () => [],
  };

  return factory;
}

function createRequest() {
  return {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
}

function completeRequest(request, result) {
  request.result = result;
  request.onsuccess?.({ target: request });
}

export function createMemoryLocalStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}
