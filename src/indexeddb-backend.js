// Thin promise-wrapper around a single IndexedDB object store (photoId ->
// Blob). Not unit-tested — this wraps the real browser IndexedDB API
// 1:1, same as app.js's other DOM/browser-API code (see its header
// comment). src/photo-store.js is where the testable CRUD/GC logic lives,
// exercised in tests against a hand-rolled in-memory stub of this same
// {get, put, delete, keys} shape.

const DB_NAME = 'mysterybox-photos';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Builds the real, browser-backed photo storage backend for
 * createPhotoStore() (src/photo-store.js) to use.
 */
export function createIndexedDbBackend() {
  let dbPromise = null;
  function getDb() {
    if (!dbPromise) dbPromise = openDb();
    return dbPromise;
  }

  return {
    async get(id) {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    },

    async put(id, blob) {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    async delete(id) {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    async keys() {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
  };
}
