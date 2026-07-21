import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PRESETS,
  serializePresetOptions,
  buildPreset,
  serializePresetForStorage,
  serializePresetsForStorage,
  canAddPreset,
  addPreset,
  removePreset,
  renamePreset,
  updatePresetIcon,
  referencedPhotoIds,
  orphanedPhotoIdsOnDelete,
} from '../src/presets.js';
import { createPhotoStore } from '../src/photo-store.js';

// Same hand-rolled in-memory stub backend photo-store.test.js uses —
// zero-npm-deps rule, no fake-indexeddb.
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
  };
}

describe('presets: CRUD round-trip on the real chip shape (incl. photoId)', () => {
  test('buildPreset() produces {id, name, icon, options} with options whitelisted to {label, emoji, photoId}', () => {
    const chips = [
      { label: 'eggs', emoji: '🥚', photoId: null },
      { label: 'ice cream', emoji: '❓', photoId: 'photo_abc123' },
    ];
    const preset = buildPreset('Breakfast', '🍳', chips);
    assert.equal(typeof preset.id, 'string');
    assert.ok(preset.id.length > 0);
    assert.equal(preset.name, 'Breakfast');
    assert.equal(preset.icon, '🍳');
    assert.deepEqual(preset.options, [
      { label: 'eggs', emoji: '🥚', photoId: null },
      { label: 'ice cream', emoji: '❓', photoId: 'photo_abc123' },
    ]);
  });

  test('two builds never collide on the same preset id', () => {
    const chips = [{ label: 'a', emoji: '🅰️', photoId: null }];
    const p1 = buildPreset('One', '1️⃣', chips);
    const p2 = buildPreset('Two', '2️⃣', chips);
    assert.notEqual(p1.id, p2.id);
  });

  test('a chip missing photoId serializes it as null, not undefined/missing', () => {
    const options = serializePresetOptions([{ label: 'toast', emoji: '🍞' }]);
    assert.equal(options[0].photoId, null);
    assert.ok('photoId' in options[0]);
  });

  test('rename / change icon / delete round-trip through the array helpers', () => {
    let presets = addPreset([], buildPreset('Breakfast', '🍳', [{ label: 'eggs', emoji: '🥚', photoId: null }]));
    const id = presets[0].id;

    presets = renamePreset(presets, id, 'Morning food');
    assert.equal(presets[0].name, 'Morning food');

    presets = updatePresetIcon(presets, id, '🥞');
    assert.equal(presets[0].icon, '🥞');

    presets = removePreset(presets, id);
    assert.deepEqual(presets, []);
  });

  test('renaming/re-iconing an unknown id leaves the array unchanged (no throw)', () => {
    const presets = addPreset([], buildPreset('Breakfast', '🍳', []));
    assert.deepEqual(renamePreset(presets, 'nope', 'X'), presets);
    assert.deepEqual(updatePresetIcon(presets, 'nope', '🥞'), presets);
  });

  test('serializePresetForStorage / serializePresetsForStorage whitelist exactly {id, name, icon, options}', () => {
    const preset = buildPreset('Breakfast', '🍳', [{ label: 'eggs', emoji: '🥚', photoId: 'photo_1' }]);
    const payload = serializePresetForStorage(preset);
    assert.deepEqual(Object.keys(payload).sort(), ['icon', 'id', 'name', 'options']);
    assert.deepEqual(serializePresetsForStorage([preset]), [payload]);
  });
});

describe('presets: force/armed state is structurally unleakable', () => {
  // Mirrors force-mode.test.js's own whitelist tests, extended to the
  // preset path (SPEC.md workstream A4) — a chip carrying stray fields
  // (as if an "armed" marker had accidentally ended up on it) must never
  // reach the stored preset payload.
  test('a chip carrying extra fields (armed, someOtherField) is whitelisted away', () => {
    const chips = [{ label: 'eggs', emoji: '🥚', photoId: null, armed: true, someOtherField: 'x' }];
    const preset = buildPreset('Breakfast', '🍳', chips);
    assert.deepEqual(preset.options, [{ label: 'eggs', emoji: '🥚', photoId: null }]);
    assert.ok(!JSON.stringify(preset).toLowerCase().includes('arm'), 'no "armed"-related text may ever reach a built preset');
  });

  test('building a preset while a chip is armed (app.js session shape) produces byte-identical options to building unarmed', () => {
    // app.js never puts "armed" on the chip itself — armedChip is a
    // separate variable pointing at the chip object. Mirror that exactly,
    // like force-mode.qa.test.js does for serializeBoxForStorage.
    const chips = [
      { label: 'eggs', emoji: '🥚', photoId: null },
      { label: 'cereal', emoji: '🥣', photoId: null },
    ];
    const unarmedPreset = buildPreset('Breakfast', '🍳', chips);

    const armedChip = chips[0]; // "arming" is just holding a reference elsewhere
    const armedPreset = buildPreset('Breakfast', '🍳', chips);

    assert.deepEqual(armedPreset.options, unarmedPreset.options);
    assert.ok(armedChip, 'sanity check: armedChip really does reference chips[0]');
  });

  test('serializePresetForStorage keeps the payload clean even on a preset built from a photo chip with extra fields', () => {
    const chips = [{ label: '', emoji: '❓', photoId: 'photo_xyz', armed: true }];
    const preset = buildPreset('Ice cream', '🍦', chips);
    const payload = serializePresetForStorage(preset);
    assert.deepEqual(payload.options, [{ label: '', emoji: '❓', photoId: 'photo_xyz' }]);
    assert.ok(!JSON.stringify(payload).toLowerCase().includes('arm'));
  });
});

describe('presets: 12-cap enforced', () => {
  test('addPreset stops accepting new presets once MAX_PRESETS is reached', () => {
    let presets = [];
    for (let i = 0; i < MAX_PRESETS; i++) {
      assert.equal(canAddPreset(presets), true, `expected room for preset #${i + 1}`);
      presets = addPreset(presets, buildPreset(`Box ${i}`, '📦', []));
    }
    assert.equal(presets.length, MAX_PRESETS);
    assert.equal(canAddPreset(presets), false);

    const attemptedThirteenth = addPreset(presets, buildPreset('One too many', '📦', []));
    assert.equal(attemptedThirteenth.length, MAX_PRESETS, 'a 13th preset must not be added');
    assert.equal(attemptedThirteenth, presets, 'at-cap addPreset returns the same array reference (no-op)');
  });

  test('removing a preset below the cap allows adding again', () => {
    let presets = [];
    for (let i = 0; i < MAX_PRESETS; i++) presets = addPreset(presets, buildPreset(`Box ${i}`, '📦', []));
    presets = removePreset(presets, presets[0].id);
    assert.equal(canAddPreset(presets), true);
    presets = addPreset(presets, buildPreset('New one', '📦', []));
    assert.equal(presets.length, MAX_PRESETS);
  });
});

describe('presets: startup GC sweep keeps preset-referenced blobs, releases them on delete', () => {
  test('referencedPhotoIds collects every photoId across all presets', () => {
    const p1 = buildPreset('A', '🅰️', [{ label: 'x', emoji: '❓', photoId: 'photo_1' }]);
    const p2 = buildPreset('B', '🅱️', [
      { label: 'y', emoji: '❓', photoId: 'photo_2' },
      { label: 'z', emoji: '❓', photoId: null },
    ]);
    assert.deepEqual(new Set(referencedPhotoIds([p1, p2])), new Set(['photo_1', 'photo_2']));
  });

  test('the GC sweep (photo-store.gc) keeps a blob referenced only by a preset, not the current box', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    const presetPhotoId = await store.add('preset-photo-blob');
    const orphanId = await store.add('truly-orphaned-blob');

    const currentBoxChips = []; // current box has no photo chips at all
    const preset = buildPreset('Ice cream', '🍦', [{ label: '', emoji: '❓', photoId: presetPhotoId }]);
    const presets = [preset];

    const referencedIds = [
      ...currentBoxChips.filter((c) => c.photoId).map((c) => c.photoId),
      ...referencedPhotoIds(presets),
    ];
    const deleted = await store.gc(referencedIds);

    assert.deepEqual(deleted, [orphanId]);
    assert.equal(await store.get(presetPhotoId), 'preset-photo-blob', 'preset-referenced blob must survive the sweep');
    assert.equal(await store.get(orphanId), null);
  });

  test('deleting a preset releases its now-unreferenced photo via orphanedPhotoIdsOnDelete', async () => {
    const backend = createStubBackend();
    const store = createPhotoStore(backend);
    const onlyInPreset = await store.add('only-in-preset');
    const sharedWithCurrentBox = await store.add('shared-blob');

    const preset = buildPreset('Ice cream', '🍦', [
      { label: 'a', emoji: '❓', photoId: onlyInPreset },
      { label: 'b', emoji: '❓', photoId: sharedWithCurrentBox },
    ]);
    const presets = [preset];
    const currentBoxChips = [{ label: 'b again', emoji: '❓', photoId: sharedWithCurrentBox }];

    const remainingPresets = removePreset(presets, preset.id);
    const orphaned = orphanedPhotoIdsOnDelete(preset, currentBoxChips, remainingPresets);

    assert.deepEqual(orphaned, [onlyInPreset], 'only the photo not referenced elsewhere should be released');

    // Simulate app.js's deleteChipPhoto() choke point running for each
    // orphaned id.
    for (const id of orphaned) await store.remove(id);

    assert.equal(await store.get(onlyInPreset), null, 'the unreferenced photo must be released');
    assert.equal(await store.get(sharedWithCurrentBox), 'shared-blob', 'a photo still referenced by the current box must survive');
  });

  test('deleting a preset whose photo is also used by ANOTHER remaining preset does not release it', () => {
    const sharedId = 'photo_shared';
    const presetA = buildPreset('A', '🅰️', [{ label: 'x', emoji: '❓', photoId: sharedId }]);
    const presetB = buildPreset('B', '🅱️', [{ label: 'y', emoji: '❓', photoId: sharedId }]);
    const remainingPresets = [presetB]; // presetA is being deleted
    const orphaned = orphanedPhotoIdsOnDelete(presetA, [], remainingPresets);
    assert.deepEqual(orphaned, [], 'a photo still referenced by another preset must not be released');
  });
});
