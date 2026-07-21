// QA-authored supplementary coverage for increment 2 workstream B, written
// independently of the coder's test/force-mode.test.js. The coder's suite
// tests each pure helper in isolation; this file composes them into
// realistic multi-step session sequences (the same call order app.js
// actually uses) to catch wiring gaps that per-function tests can miss —
// per SPEC.md's binding guardrail that force state must never leak into
// the localStorage payload, across arm→persist, arm→edit, and arm→remove
// flows, plus a multi-spin session check for double-apply/state leakage.
//
// Pure data-driven tests only — no feature source is modified here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toggleArm, disarmIfMatches, resolveWinnerIndex, serializeBoxForStorage } from '../src/force-mode.js';

// Chips are built exactly the way app.js's addOptionsFromText() builds
// them — {label, emoji, photoId} only, never carrying an "armed" field.
// armedChip in app.js is a *separate* reference variable, not a property
// on the chip. These tests deliberately mirror that shape rather than the
// coder's synthetic "chip carrying extra properties" fixture, to prove
// the real production data flow (not just the serializer's defensiveness)
// never leaks force state. (photoId: null added in increment 3, workstream
// A4's whitelist extension — see SPEC.md.)

function freshChips() {
  return [
    { label: 'eggs', emoji: '🥚', photoId: null },
    { label: 'cereal', emoji: '🥣', photoId: null },
    { label: 'toast', emoji: '🍞', photoId: null },
  ];
}

describe('force-mode QA: realistic session — armed, then persisted (page reload scenario)', () => {
  test('persisting while a chip is armed produces byte-identical output to persisting unarmed', () => {
    const chips = freshChips();
    const unarmedPayload = serializeBoxForStorage(chips);

    // Arm the first chip (long-press), exactly as app.js's chip-hold
    // handler does — armedChip is a variable pointing at the chip, chips
    // themselves are never mutated.
    let armedChip = toggleArm(null, chips[0]);
    assert.equal(armedChip, chips[0]);

    // Simulate persistBox() running while armed (e.g. parent arms, then
    // the page is backgrounded/reloaded before a spin happens).
    const armedPayload = serializeBoxForStorage(chips);

    assert.deepEqual(armedPayload, unarmedPayload, 'the serialized payload must be identical whether or not a chip is armed');
    assert.ok(!JSON.stringify(armedPayload).toLowerCase().includes('arm'), 'no "armed"-related text may ever appear in the persisted payload');
  });

  test('every option in the payload has the exact same key set, armed or not (no per-item side channel)', () => {
    const chips = freshChips();
    const armedChip = toggleArm(null, chips[1]);
    assert.equal(armedChip, chips[1]);

    const payload = serializeBoxForStorage(chips);
    const keySets = payload.options.map((o) => Object.keys(o).sort().join(','));
    assert.equal(new Set(keySets).size, 1, `expected every serialized option to share the same key set, got: ${keySets}`);
    assert.deepEqual(keySets[0].split(','), ['emoji', 'label', 'photoId']);
  });
});

describe('force-mode QA: realistic session — armed, then the armed chip is edited (tap-to-fix)', () => {
  test('editing the armed chip disarms it and the payload stays clean', () => {
    const chips = freshChips();
    let armedChip = toggleArm(null, chips[0]);
    assert.equal(armedChip, chips[0]);

    // app.js's picker click handler: disarm-if-matches, THEN mutate the
    // emoji field, in that order.
    armedChip = disarmIfMatches(armedChip, chips[0]);
    chips[0] = { ...chips[0], emoji: '🍳' };

    assert.equal(armedChip, null, 'editing the armed chip must disarm it');
    const payload = serializeBoxForStorage(chips);
    assert.deepEqual(payload.options[0], { label: 'eggs', emoji: '🍳', photoId: null });
    assert.ok(!JSON.stringify(payload).toLowerCase().includes('arm'));
  });

  test('editing a DIFFERENT chip while one is armed leaves the arm intact and the payload still clean', () => {
    const chips = freshChips();
    let armedChip = toggleArm(null, chips[0]); // arm "eggs"

    // Parent edits "cereal" (index 1) instead — unrelated to the armed chip.
    armedChip = disarmIfMatches(armedChip, chips[1]);
    chips[1] = { ...chips[1], emoji: '🥛' };

    assert.equal(armedChip, chips[0], 'editing an unrelated chip must not disturb the existing arm');
    const payload = serializeBoxForStorage(chips);
    assert.ok(!JSON.stringify(payload).toLowerCase().includes('arm'));
  });
});

describe('force-mode QA: realistic session — armed, then the armed chip is removed', () => {
  test('removing the armed chip disarms it, and it is absent from the persisted payload', () => {
    const chips = freshChips();
    let armedChip = toggleArm(null, chips[2]); // arm "toast"
    assert.equal(armedChip, chips[2]);

    // app.js's removeChip(): disarm-if-matches, THEN splice.
    armedChip = disarmIfMatches(armedChip, chips[2]);
    const remaining = chips.filter((c) => c !== chips[2]);

    assert.equal(armedChip, null, 'removing the armed chip must disarm it');
    const payload = serializeBoxForStorage(remaining);
    assert.deepEqual(
      payload.options.map((o) => o.label),
      ['eggs', 'cereal']
    );
    assert.ok(!JSON.stringify(payload).toLowerCase().includes('arm'));
  });

  test('no dangling reference: the armed variable never survives pointing at a chip removed from the array', () => {
    // Demonstrates why disarmIfMatches must run BEFORE the splice/filter:
    // if it ran after (or not at all), armedChip would keep referencing an
    // object no longer present anywhere in `remaining` — a dangling
    // reference that forcedIndex = chips.indexOf(armedChip) would later
    // resolve to -1 for the wrong reason (not found, not "no force").
    const chips = freshChips();
    let armedChip = toggleArm(null, chips[1]);
    armedChip = disarmIfMatches(armedChip, chips[1]);
    const remaining = chips.filter((c) => c !== chips[1]);

    assert.equal(armedChip, null, 'the armed reference must be cleared, not left dangling on a removed chip');
    assert.ok(!remaining.includes(chips[1]), 'sanity check: the chip really was removed from the array');
  });
});

describe('force-mode QA: multi-spin session — force applies exactly once, never leaks into later spins', () => {
  test('spin 1 is forced, auto-clears, and spins 2..N are all genuinely random with no residual bias', () => {
    const chips = freshChips();
    let armedChip = toggleArm(null, chips[1]); // arm "cereal" (index 1)
    let forcedIndex = chips.indexOf(armedChip); // snapshot at "enter kid mode" time
    assert.equal(forcedIndex, 1);

    // --- Spin 1: forced ---
    const randomDrawForSpin1 = 0; // whatever the real RNG happened to draw
    const winner1 = resolveWinnerIndex(forcedIndex, randomDrawForSpin1);
    assert.equal(winner1, 1, 'spin 1 must land on the armed index regardless of the random draw');

    // Auto-clear the instant the reveal fires (app.js's reveal()).
    forcedIndex = -1;
    armedChip = null;

    // --- Spins 2..N: unforced, must never re-apply the spent force. The
    // correct invariant is uniformity across all three options — index 1
    // (last spin's forced winner) must be neither excluded nor favoured,
    // just one of three equally-likely outcomes like the others.
    const n = 3;
    const draws = 6000;
    const counts = new Array(n).fill(0);
    for (let i = 0; i < draws; i++) {
      const randomDraw = Math.floor(Math.random() * n);
      const winner = resolveWinnerIndex(forcedIndex, randomDraw); // forcedIndex is -1 for every one of these
      counts[winner]++;
    }

    for (const count of counts) {
      const fraction = count / draws;
      assert.ok(fraction >= 0.28 && fraction <= 0.39, `expected roughly uniform post-clear distribution, got ${(fraction * 100).toFixed(1)}%`);
    }
  });

  test('re-arming after a spin works cleanly for a second forced decision (arm -> spin -> clear -> arm -> spin)', () => {
    const chips = freshChips();

    // First decision: force "eggs" (index 0).
    let armedChip = toggleArm(null, chips[0]);
    let forcedIndex = chips.indexOf(armedChip);
    assert.equal(resolveWinnerIndex(forcedIndex, 2), 0);
    forcedIndex = -1;
    armedChip = null; // auto-clear

    // Second decision, fresh arm on a different chip: force "toast" (index 2).
    armedChip = toggleArm(null, chips[2]);
    forcedIndex = chips.indexOf(armedChip);
    assert.equal(forcedIndex, 2);
    assert.equal(resolveWinnerIndex(forcedIndex, 0), 2, 'the second force must win independently of the first, spent one');
  });
});
