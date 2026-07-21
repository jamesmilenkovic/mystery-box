// Pure-ish module: CRUD + garbage-collection rules for photo blob storage,
// keyed by photoId. The actual storage backend is injected as a small
// {get, put, delete, keys} interface, so this module has no direct
// IndexedDB/browser dependency — unit tests drive it against a hand-rolled
// in-memory stub (zero-npm-deps rule: no fake-indexeddb). The real
// IndexedDB-backed backend lives in src/indexeddb-backend.js and is not
// unit-tested itself, same as app.js's other DOM/browser-API code.
//
// Backend contract (all async / return Promises):
//   get(photoId)    -> the stored blob, or undefined/null if absent
//   put(photoId, blob)
//   delete(photoId)
//   keys()          -> array of every stored photoId

function randomPhotoId() {
  return `photo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Builds a photo store bound to the given backend.
 *
 * @param {{get: Function, put: Function, delete: Function, keys: Function}} backend
 */
export function createPhotoStore(backend) {
  return {
    /**
     * Stores a blob under a freshly generated photoId.
     * @param {*} blob
     * @returns {Promise<string>} the new photoId
     */
    async add(blob) {
      const photoId = randomPhotoId();
      await backend.put(photoId, blob);
      return photoId;
    },

    /**
     * Fetches the stored blob for a photoId.
     * @param {string} photoId
     * @returns {Promise<*|null>} the blob, or null if not found
     */
    async get(photoId) {
      const blob = await backend.get(photoId);
      return blob ?? null;
    },

    /**
     * Deletes the blob for a photoId (removing a chip, Clear all, or
     * replacing a photo all funnel through this — see SPEC.md workstream
     * A5). A no-op if nothing is stored under that id.
     * @param {string} photoId
     */
    async remove(photoId) {
      await backend.delete(photoId);
    },

    /**
     * Startup sweep: deletes every stored blob whose id is not present in
     * referencedIds (the photoIds actually referenced by the persisted
     * box). Complements the explicit deletes in remove() — this is the
     * safety net for anything orphaned by a crash/force-quit between a
     * blob write and the matching localStorage write.
     * @param {Iterable<string>} referencedIds
     * @returns {Promise<string[]>} the photoIds that were deleted
     */
    async gc(referencedIds) {
      const referenced = new Set(referencedIds);
      const allIds = await backend.keys();
      const orphaned = allIds.filter((id) => !referenced.has(id));
      await Promise.all(orphaned.map((id) => backend.delete(id)));
      return orphaned;
    },
  };
}
