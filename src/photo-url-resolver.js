// Pure-ish module: object-URL cache + in-flight-read dedup for chip
// photos, extracted out of app.js (SPEC.md increment 4, workstream C) so
// two things can be unit-tested against a stub instead of only verified
// by reading the source:
//
//   C1. ensureUrl() failure path — a rejecting backend must never throw
//       out of ensureUrl(); callers get null back and fall back to the
//       emoji/letter-tile visual (resolveVisual() already does this for a
//       falsy photoUrl).
//   C3. pendingPhotoUrls race-dedup — concurrent ensureUrl() calls for the
//       same photoId share one underlying read, and a revoke() that lands
//       mid-flight is race-safe (the read can't resurrect a cache entry
//       for a photo that was deleted/replaced while it was in progress).
//
// Same dependency-injection shape as photo-store.js: the real backend
// (IndexedDB + real URL.createObjectURL/revokeObjectURL) is wired up in
// app.js; tests drive this against a hand-rolled stub photoStore and fake
// create/revoke functions, no real browser APIs required.

/**
 * @param {{photoStore: {get: Function}, createObjectURL: Function, revokeObjectURL: Function}} deps
 */
export function createPhotoUrlResolver({ photoStore, createObjectURL, revokeObjectURL }) {
  const urlCache = new Map(); // photoId -> object URL
  const pending = new Map(); // photoId -> in-flight ensureUrl() promise

  /**
   * Revokes and forgets a photoId's cached URL (if any), and drops any
   * in-flight read for it so a slow, late-arriving read can't resurrect a
   * URL for a photo that's just been deleted/replaced out from under it —
   * the read's continuation below checks pending's identity before
   * writing to urlCache, and finds itself superseded.
   *
   * @param {string} photoId
   */
  function revoke(photoId) {
    const url = urlCache.get(photoId);
    if (url) {
      revokeObjectURL(url);
      urlCache.delete(photoId);
    }
    pending.delete(photoId);
  }

  /**
   * Resolves (from cache, or by reading the blob out of the store) the
   * object URL for a photoId. Never rejects — a failing read resolves to
   * null so callers can fall back gracefully instead of breaking.
   *
   * @param {string|null|undefined} photoId
   * @returns {Promise<string|null>}
   */
  function ensureUrl(photoId) {
    if (!photoId) return Promise.resolve(null);
    if (urlCache.has(photoId)) return Promise.resolve(urlCache.get(photoId));
    const inFlight = pending.get(photoId);
    if (inFlight) return inFlight;

    const request = photoStore.get(photoId).then(
      (blob) => {
        // Superseded by a revoke() (photo deleted/replaced) while this
        // read was in flight — don't touch the resolved cache.
        if (pending.get(photoId) !== request) return null;
        pending.delete(photoId);
        if (!blob) return null;
        const url = createObjectURL(blob);
        urlCache.set(photoId, url);
        return url;
      },
      () => {
        // Graceful fallback (SPEC.md workstream C1): never let a rejected
        // read throw out of ensureUrl. Also don't leave the rejection
        // permanently camped in `pending` — a later call should retry
        // rather than reusing this failure forever.
        if (pending.get(photoId) === request) pending.delete(photoId);
        return null;
      },
    );
    pending.set(photoId, request);
    return request;
  }

  /**
   * The currently-cached URL for a photoId, if any — synchronous, does
   * not trigger a read.
   * @param {string|null|undefined} photoId
   */
  function getCached(photoId) {
    return photoId ? urlCache.get(photoId) : undefined;
  }

  return { ensureUrl, revoke, getCached };
}
