import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tileColor, tileLetter, resolveVisual } from '../src/letter-tile.js';
import { MISS_EMOJI } from '../src/emoji-match.js';

describe('letter-tile: tileColor determinism', () => {
  test('same label always returns the same colour', () => {
    const first = tileColor('Excavator');
    for (let i = 0; i < 10; i++) {
      assert.equal(tileColor('Excavator'), first);
    }
  });

  test('is case- and whitespace-insensitive (same option however it was typed)', () => {
    assert.equal(tileColor('Excavator'), tileColor('excavator'));
    assert.equal(tileColor('  Excavator  '), tileColor('excavator'));
    assert.equal(tileColor('EXCAVATOR'), tileColor('excavator'));
  });

  test('different labels commonly land on different colours', () => {
    // Not a strict guarantee (finite palette), but a spread of everyday
    // option labels should not all collapse onto the same colour.
    const labels = ['Excavator', 'Sandcastle', 'Qwfpzxcvzz', 'Grandpa Joe', 'Spaghetti'];
    const colors = new Set(labels.map(tileColor));
    assert.ok(colors.size > 1, `expected more than one distinct colour, got ${[...colors]}`);
  });
});

describe('letter-tile: tileLetter', () => {
  test('renders the uppercased first letter of the label', () => {
    assert.equal(tileLetter('excavator'), 'E');
    assert.equal(tileLetter('Zebra'), 'Z');
    assert.equal(tileLetter('quixotic'), 'Q');
  });

  test('trims leading whitespace before taking the first letter', () => {
    assert.equal(tileLetter('  Robot'), 'R');
  });

  test('different labels get their own distinct letters (not all the same)', () => {
    const letters = ['excavator', 'zebra', 'quixotic', 'penguin'].map(tileLetter);
    assert.deepEqual(letters, ['E', 'Z', 'Q', 'P']);
  });

  test('never falls back to the ❓ placeholder, even for an empty label', () => {
    assert.notEqual(tileLetter(''), MISS_EMOJI);
    assert.notEqual(tileLetter('   '), MISS_EMOJI);
  });
});

describe('letter-tile: resolveVisual — ❓ is unreachable in rendering', () => {
  test('a real emoji match renders as the emoji itself', () => {
    assert.deepEqual(resolveVisual('🍞', 'toast'), { kind: 'emoji', value: '🍞' });
  });

  test('a MISS_EMOJI match renders as a tile, never the raw ❓ glyph', () => {
    const result = resolveVisual(MISS_EMOJI, 'qwfpzxcvzz');
    assert.equal(result.kind, 'tile');
    assert.notEqual(result.letter, MISS_EMOJI);
    assert.ok(!JSON.stringify(result).includes(MISS_EMOJI), '❓ must not appear anywhere in the render decision');
  });

  test('the tile carries the same deterministic colour/letter as the standalone helpers', () => {
    const result = resolveVisual(MISS_EMOJI, 'Excavator');
    assert.equal(result.color, tileColor('Excavator'));
    assert.equal(result.letter, tileLetter('Excavator'));
  });
});
