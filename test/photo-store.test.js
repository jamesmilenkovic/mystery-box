import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoStore } from '../src/photo-store.js';

// Hand-rolled in-memory stub standing in for the real IndexedDB backend
// (src/indexeddb-backend.js) — zero-npm-deps rule holds, no fake-indexeddb.
function createStubBackend() {
  const map = new Map();
  return {
    async get(id) {
      return map.has(id) ? map.get(id) : null;
    },
    async put(id, blob) {
      map.set(id, blob);
    },
    async delete(id) {
      map.delete(id);
    },
    async keys() {
      return [...map.keys()];
    },
    _map: map, // test-only escape hatch to inspect raw state
  };
}

describe('photo-store: CRUD', () => {
  test('add() stores a blob and returns a fresh photoId', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    const id = await store.add('blob-a');
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);
    assert.equal(await store.get(id), 'blob-a');
  });

  test('two adds never collide on the same photoId', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    const idA = await store.add('blob-a');
    const idB = await store.add('blob-b');
    assert.notEqual(idA, idB);
  });

  test('get() on an unknown photoId returns null, not undefined or throw', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    assert.equal(await store.get('nope'), null);
  });

  test('remove() deletes the blob', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    const id = await store.add('blob-a');
    await store.remove(id);
    assert.equal(await store.get(id), null);
  });

  test('remove() on an already-absent photoId is a no-op, not a throw', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    await assert.doesNotReject(store.remove('never-existed'));
  });
});

describe('photo-store: startup sweep (gc)', () => {
  test('deletes blobs whose id is not in the referenced set', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    const keep = await store.add('kept');
    const orphanA = await store.add('orphan-a');
    const orphanB = await store.add('orphan-b');

    const deleted = await store.gc([keep]);

    assert.deepEqual(new Set(deleted), new Set([orphanA, orphanB]));
    assert.equal(await store.get(keep), 'kept');
    assert.equal(await store.get(orphanA), null);
    assert.equal(await store.get(orphanB), null);
  });

  test('referencing every stored id deletes nothing', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    const idA = await store.add('a');
    const idB = await store.add('b');

    const deleted = await store.gc([idA, idB]);

    assert.deepEqual(deleted, []);
    assert.equal(await store.get(idA), 'a');
    assert.equal(await store.get(idB), 'b');
  });

  test('an empty store sweeps to nothing, no error', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    assert.deepEqual(await store.gc([]), []);
  });

  test('referencing an id that was never stored is harmless', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    const orphan = await store.add('orphan');
    const deleted = await store.gc(['some-id-not-in-store', orphan === 'some-id-not-in-store' ? 'other' : orphan]);
    assert.deepEqual(deleted, []);
  });
});
