/* 本机数据层：优先 IndexedDB，失败时退回 localStorage / 内存。 */

const DB_NAME = 'ah-cinema';
const DB_VERSION = 1;
const STORES = ['progress', 'favorites', 'settings', 'searches'];
const LS_PREFIX = 'ah-fallback:';

let dbPromise = null;
let idbFailed = false;
const memory = new Map();

function hasIndexedDB() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch (error) {
    return false;
  }
}

function openDB() {
  if (idbFailed || !hasIndexedDB()) {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        STORES.forEach((name) => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        });
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB blocked'));
    }).catch((error) => {
      idbFailed = true;
      throw error;
    });
  }

  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function readFallback(store) {
  if (memory.has(store)) {
    return memory.get(store).slice();
  }

  try {
    const raw = localStorage.getItem(LS_PREFIX + store);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeFallback(store, values) {
  memory.set(store, values);
  try {
    localStorage.setItem(LS_PREFIX + store, JSON.stringify(values));
  } catch (error) {
    /* 私密模式 / 配额满时只保留在内存里。 */
  }
}

export async function getAll(store) {
  if (!STORES.includes(store)) throw new Error('Unknown store: ' + store);

  if (!idbFailed) {
    try {
      const db = await openDB();
      const tx = db.transaction(store, 'readonly');
      const result = await requestToPromise(tx.objectStore(store).getAll());
      await txDone(tx);
      return Array.isArray(result) ? result : [];
    } catch (error) {
      /* 退回 localStorage。 */
    }
  }

  return readFallback(store);
}

export async function get(store, id) {
  const all = await getAll(store);
  return all.find((item) => item && item.id === id) || null;
}

export async function put(store, value) {
  if (!STORES.includes(store)) throw new Error('Unknown store: ' + store);
  if (!value || typeof value.id === 'undefined') throw new Error('Missing id');

  if (!idbFailed) {
    try {
      const db = await openDB();
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      await txDone(tx);
      return value;
    } catch (error) {
      /* 退回 localStorage。 */
    }
  }

  const values = readFallback(store).filter((item) => item && item.id !== value.id);
  values.push(value);
  writeFallback(store, values);
  return value;
}

export async function bulkPut(store, values) {
  if (!STORES.includes(store)) throw new Error('Unknown store: ' + store);
  const list = Array.isArray(values) ? values.filter((item) => item && typeof item.id !== 'undefined') : [];

  if (!idbFailed) {
    try {
      const db = await openDB();
      const tx = db.transaction(store, 'readwrite');
      const objectStore = tx.objectStore(store);
      list.forEach((item) => objectStore.put(item));
      await txDone(tx);
      return;
    } catch (error) {
      /* 退回 localStorage。 */
    }
  }

  const existing = readFallback(store);
  const byId = new Map(existing.map((item) => [item.id, item]));
  list.forEach((item) => byId.set(item.id, item));
  writeFallback(store, Array.from(byId.values()));
}

export async function remove(store, id) {
  if (!STORES.includes(store)) throw new Error('Unknown store: ' + store);

  if (!idbFailed) {
    try {
      const db = await openDB();
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      await txDone(tx);
      return;
    } catch (error) {
      /* 退回 localStorage。 */
    }
  }

  writeFallback(store, readFallback(store).filter((item) => item && item.id !== id));
}

export async function clear(store) {
  if (!STORES.includes(store)) throw new Error('Unknown store: ' + store);

  if (!idbFailed) {
    try {
      const db = await openDB();
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      await txDone(tx);
      return;
    } catch (error) {
      /* 退回 localStorage。 */
    }
  }

  writeFallback(store, []);
}

export async function clearMany(stores) {
  await Promise.all(stores.map((store) => clear(store)));
}
