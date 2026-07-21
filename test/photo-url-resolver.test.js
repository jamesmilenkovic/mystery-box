// SPEC.md increment 4, workstream C1 + C3: ensureUrl() must never throw
// on a failing backend (graceful fallback to emoji/letter-tile), and
// concurrent calls for the same photoId must share one underlying read
// (dedup) while staying safe against a delete/revoke landing mid-flight.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoUrlResolver } from '../src/photo-url-resolver.js';

function createDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeUrlFns() {
  let counter = 0;
  const revoked = [];
  return {
    createObjectURL: (blob) => `blob:fake-${++counter}(${blob})`,
    revokeObjectURL: (url) => revoked.push(url),
    revoked,
  };
}

describe('photo-url-resolver: basic resolve + cache', () => {
  test('a falsy photoId resolves to null without touching the store', async () => {
    let getCalls = 0;
    const resolver = createPhotoUrlResolver({
      photoStore: { get: async () => { getCalls++; return 'blob'; } },
      ...createFakeUrlFns(),
    });
    assert.equal(await resolver.ensureUrl(null), null);
    assert.equal(await resolver.ensureUrl(undefined), null);
    assert.equal(await resolver.ensureUrl(''), null);
    assert.equal(getCalls, 0);
  });

  test('resolves a blob to a URL and caches it — a second call does not re-read the store', async () => {
    let getCalls = 0;
    const resolver = createPhotoUrlResolver({
      photoStore: { get: async (id) => { getCalls++; return `blob-for-${id}`; } },
      ...createFakeUrlFns(),
    });
    const url1 = await resolver.ensureUrl('photo_1');
    assert.ok(url1);
    assert.equal(resolver.getCached('photo_1'), url1);

    const url2 = await resolver.ensureUrl('photo_1');
    assert.equal(url2, url1);
    assert.equal(getCalls, 1, 'the second call must be served from cache, not a fresh read');
  });

  test('a store that returns null/undefined (photo absent) resolves to null, not a cached empty URL', async () => {
    const resolver = createPhotoUrlResolver({
      photoStore: { get: async () => null },
      ...createFakeUrlFns(),
    });
    assert.equal(await resolver.ensureUrl('missing'), null);
    assert.equal(resolver.getCached('missing'), undefined);
  });
});

describe('photo-url-resolver: C1 — graceful fallback on a failing backend', () => {
  test('a rejecting store.get() resolves ensureUrl to null instead of throwing', async () => {
    const resolver = createPhotoUrlResolver({
      photoStore: { get: async () => { throw new Error('IndexedDB read failed'); } },
      ...createFakeUrlFns(),
    });
    await assert.doesNotReject(resolver.ensureUrl('photo_broken'));
    assert.equal(await resolver.ensureUrl('photo_broken'), null);
  });

  test('after a failure, a later call retries rather than reusing the rejection forever', async () => {
    let attempt = 0;
    const resolver = createPhotoUrlResolver({
      photoStore: {
        get: async () => {
          attempt++;
          if (attempt === 1) throw new Error('transient failure');
          return 'blob-ok';
        },
      },
      ...createFakeUrlFns(),
    });
    assert.equal(await resolver.ensureUrl('photo_retry'), null, 'first attempt fails gracefully');
    const url = await resolver.ensureUrl('photo_retry');
    assert.ok(url, 'second attempt must retry the read and succeed');
    assert.equal(attempt, 2);
  });
});

describe('photo-url-resolver: C3 — concurrent-call dedup', () => {
  test('N concurrent ensureUrl() calls for the same photoId share exactly one underlying read', async () => {
    const deferred = createDeferred();
    let getCalls = 0;
    const resolver = createPhotoUrlResolver({
      photoStore: {
        get: async (id) => {
          getCalls++;
          return deferred.promise;
        },
      },
      ...createFakeUrlFns(),
    });

    const p1 = resolver.ensureUrl('photo_x');
    const p2 = resolver.ensureUrl('photo_x');
    const p3 = resolver.ensureUrl('photo_x');
    assert.equal(getCalls, 1, 'concurrent calls before resolution must not start a second read');

    deferred.resolve('the-blob');
    const [u1, u2, u3] = await Promise.all([p1, p2, p3]);
    assert.equal(u1, u2);
    assert.equal(u2, u3);
    assert.ok(u1);
  });

  test('concurrent calls for DIFFERENT photoIds each get their own read', async () => {
    const seen = [];
    const resolver = createPhotoUrlResolver({
      photoStore: { get: async (id) => { seen.push(id); return `blob-${id}`; } },
      ...createFakeUrlFns(),
    });
    await Promise.all([resolver.ensureUrl('a'), resolver.ensureUrl('b')]);
    assert.deepEqual(seen.sort(), ['a', 'b']);
  });
});

describe('photo-url-resolver: C3 — delete/revoke race safety', () => {
  test('a revoke() that lands while a read is in flight prevents that read from resurrecting a cache entry', async () => {
    const deferred = createDeferred();
    const resolver = createPhotoUrlResolver({
      photoStore: { get: async () => deferred.promise },
      ...createFakeUrlFns(),
    });

    const pending = resolver.ensureUrl('photo_deleted_midflight');
    resolver.revoke('photo_deleted_midflight'); // e.g. the chip/photo was removed while the read was still in progress

    deferred.resolve('late-arriving-blob');
    const result = await pending;

    assert.equal(result, null, 'a read superseded by a revoke() must not resolve into a URL');
    assert.equal(resolver.getCached('photo_deleted_midflight'), undefined, 'no cache entry may exist for the revoked photoId');
  });

  test('revoke() on a resolved cache entry calls revokeObjectURL and clears the cache', async () => {
    const fakeUrlFns = createFakeUrlFns();
    const resolver = createPhotoUrlResolver({
      photoStore: { get: async () => 'blob' },
      ...fakeUrlFns,
    });
    const url = await resolver.ensureUrl('photo_1');
    resolver.revoke('photo_1');
    assert.deepEqual(fakeUrlFns.revoked, [url]);
    assert.equal(resolver.getCached('photo_1'), undefined);
  });

  test('revoke() on a photoId with nothing cached or in flight is a harmless no-op', () => {
    const resolver = createPhotoUrlResolver({
      photoStore: { get: async () => 'blob' },
      ...createFakeUrlFns(),
    });
    assert.doesNotThrow(() => resolver.revoke('never-requested'));
  });

  test('a fresh ensureUrl() call after a revoke() starts a brand new read (not stuck reusing the old in-flight promise)', async () => {
    let getCalls = 0;
    const resolver = createPhotoUrlResolver({
      photoStore: { get: async () => { getCalls++; return `blob-${getCalls}`; } },
      ...createFakeUrlFns(),
    });
    await resolver.ensureUrl('photo_1');
    resolver.revoke('photo_1');
    await resolver.ensureUrl('photo_1');
    assert.equal(getCalls, 2);
  });
});
