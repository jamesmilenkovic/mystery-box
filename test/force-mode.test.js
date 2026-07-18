import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toggleArm, disarmIfMatches, resolveWinnerIndex, serializeBoxForStorage } from '../src/force-mode.js';

describe('force-mode: arm/disarm/re-arm', () => {
  const chipA = { label: 'eggs', emoji: '🥚' };
  const chipB = { label: 'cereal', emoji: '🥣' };
  const chipC = { label: 'toast', emoji: '🍞' };

  test('long-pressing an unarmed chip arms it', () => {
    assert.equal(toggleArm(null, chipA), chipA);
  });

  test('long-pressing the already-armed chip again disarms it (toggle off)', () => {
    assert.equal(toggleArm(chipA, chipA), null);
  });

  test('long-pressing a different chip re-arms to the new one', () => {
    assert.equal(toggleArm(chipA, chipB), chipB);
  });

  test('re-arming after a full disarm works (arm -> disarm -> arm again)', () => {
    let armed = null;
    armed = toggleArm(armed, chipA);
    assert.equal(armed, chipA);
    armed = toggleArm(armed, chipA);
    assert.equal(armed, null);
    armed = toggleArm(armed, chipA);
    assert.equal(armed, chipA);
  });

  test('single-armed invariant: arming a second chip leaves only the second one armed', () => {
    let armed = toggleArm(null, chipA);
    armed = toggleArm(armed, chipB);
    // Only chipB is armed now — chipA is not, by construction, since a
    // single reference is the only state tracked.
    assert.equal(armed, chipB);
    assert.notEqual(armed, chipA);
    armed = toggleArm(armed, chipC);
    assert.equal(armed, chipC);
  });
});

describe('force-mode: disarm on edit/remove', () => {
  const chipA = { label: 'eggs', emoji: '🥚' };
  const chipB = { label: 'cereal', emoji: '🥣' };

  test('removing the armed chip disarms it', () => {
    assert.equal(disarmIfMatches(chipA, chipA), null);
  });

  test('editing (tap-to-fix) the armed chip disarms it', () => {
    // app.js calls this the same way for both "remove" and "edit" — the
    // armed chip object is the thing being acted on either way.
    assert.equal(disarmIfMatches(chipA, chipA), null);
  });

  test('removing/editing a different, unrelated chip leaves the arm untouched', () => {
    assert.equal(disarmIfMatches(chipA, chipB), chipA);
  });

  test('no-op when nothing is armed', () => {
    assert.equal(disarmIfMatches(null, chipA), null);
  });
});

describe('force-mode: resolveWinnerIndex — forced-win is 100% over many trials', () => {
  test('an armed index always wins, regardless of the random draw', () => {
    const armedIndex = 2;
    for (let i = 0; i < 500; i++) {
      const randomDraw = i % 5; // sweep through every possible unforced outcome
      assert.equal(resolveWinnerIndex(armedIndex, randomDraw), armedIndex);
    }
  });

  test('armed index 0 still wins (falsy-but-valid index is not mistaken for "no force")', () => {
    for (let i = 0; i < 20; i++) {
      assert.equal(resolveWinnerIndex(0, i), 0);
    }
  });
});

describe('force-mode: resolveWinnerIndex — auto-clear -> genuinely random (loose bound)', () => {
  test('with no armed index (-1, the auto-cleared sentinel), the random draw passes straight through', () => {
    for (let i = 0; i < 20; i++) {
      assert.equal(resolveWinnerIndex(-1, i), i);
    }
  });

  test('after "consuming" a force (resetting to -1), repeated resolution over real random draws is roughly uniform', () => {
    // Same loose-bound spirit as random.test.js's own uniformity check —
    // this exercises resolveWinnerIndex's unforced pass-through path, not
    // randomIndex() itself (that's already covered in random.test.js).
    const n = 3;
    const draws = 6000;
    const counts = new Array(n).fill(0);
    for (let i = 0; i < draws; i++) {
      const randomDraw = Math.floor(Math.random() * n);
      counts[resolveWinnerIndex(-1, randomDraw)]++;
    }
    for (const count of counts) {
      const fraction = count / draws;
      assert.ok(fraction >= 0.28 && fraction <= 0.39, `expected roughly uniform, got ${(fraction * 100).toFixed(1)}%`);
    }
  });
});

describe('force-mode: localStorage payload stays clean of force state', () => {
  test('only label/emoji are ever included, even for a chip carrying extra properties', () => {
    const chips = [
      { label: 'eggs', emoji: '🥚', armed: true, someOtherField: 'x' },
      { label: 'cereal', emoji: '🥣' },
    ];
    const payload = serializeBoxForStorage(chips);
    assert.deepEqual(payload, {
      options: [
        { label: 'eggs', emoji: '🥚' },
        { label: 'cereal', emoji: '🥣' },
      ],
    });
    assert.ok(!JSON.stringify(payload).includes('armed'), 'no "armed" field may ever reach the serialized payload');
  });

  test('an empty box serializes to an empty options array', () => {
    assert.deepEqual(serializeBoxForStorage([]), { options: [] });
  });
});
