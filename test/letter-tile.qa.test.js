// QA-authored supplementary coverage for increment 2 workstream C letter
// tiles. The coder's test/letter-tile.test.js already covers same-process
// determinism; this file specifically targets the spec's "stable across
// sessions" wording by re-evaluating the module fresh (cache-busted
// dynamic import, simulating a brand new page load / app relaunch) and
// checking the result still matches — ruling out any hidden per-load
// state (e.g. a Math.random()-seeded palette shuffle) that a same-process
// repeated-call test could not catch.
//
// Pure data-driven tests only — no feature source is modified here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tileColor, tileLetter } from '../src/letter-tile.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const modulePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'letter-tile.js');
const moduleUrl = 'file://' + modulePath;

describe('letter-tile QA: colour is stable across a simulated fresh session (module re-evaluated from scratch)', () => {
  test('tileColor for a fixed label is identical across two independent module loads', async () => {
    // A distinct query string forces Node's ESM loader to treat this as a
    // separate module instance, re-running all top-level module code
    // (PALETTE construction etc.) as if the app had been relaunched.
    const fresh1 = await import(`${moduleUrl}?session=1`);
    const fresh2 = await import(`${moduleUrl}?session=2`);

    const labels = ['Excavator', 'Grandpa Joe', 'Qwfpzxcvzz'];
    for (const label of labels) {
      assert.equal(fresh1.tileColor(label), fresh2.tileColor(label), `tileColor("${label}") differed across simulated sessions`);
      assert.equal(fresh1.tileColor(label), tileColor(label), 'and matches the originally-imported instance too');
    }
  });

  test('tileLetter for a fixed label is identical across two independent module loads', async () => {
    const fresh1 = await import(`${moduleUrl}?session=3`);
    const fresh2 = await import(`${moduleUrl}?session=4`);

    for (const label of ['Excavator', 'Zebra']) {
      assert.equal(fresh1.tileLetter(label), fresh2.tileLetter(label));
      assert.equal(fresh1.tileLetter(label), tileLetter(label));
    }
  });
});

describe('letter-tile QA: colour is drawn from a bounded, fixed-size palette (no unbounded/random colour generation)', () => {
  test('50 varied labels only ever produce colours from a small fixed set', () => {
    const labels = Array.from({ length: 50 }, (_, i) => `Option label number ${i} with some words`);
    const colours = new Set(labels.map(tileColor));
    // The palette is documented as a fixed high-contrast set; regardless
    // of its exact size, it must not be effectively unbounded (which
    // would suggest per-call randomness rather than a deterministic hash
    // into a fixed palette).
    assert.ok(colours.size <= 20, `expected a small bounded palette, saw ${colours.size} distinct colours across 50 labels`);
    for (const c of colours) {
      assert.match(c, /^#[0-9a-f]{6}$/i, `expected a hex colour, got ${c}`);
    }
  });
});
