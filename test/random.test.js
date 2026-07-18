import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomIndex } from '../src/random.js';

describe('random: input validation', () => {
  test('throws for non-positive-integer n', () => {
    assert.throws(() => randomIndex(0));
    assert.throws(() => randomIndex(-1));
    assert.throws(() => randomIndex(1.5));
  });

  test('n=1 always returns 0 without consulting the random source', () => {
    let called = false;
    const source = () => {
      called = true;
    };
    assert.equal(randomIndex(1, source), 0);
    assert.equal(called, false);
  });
});

describe('random: rejection sampling correctness', () => {
  test('rejects a draw at the bias boundary and redraws (n=3)', () => {
    // 2^32 is not evenly divisible by 3 (2^32 % 3 === 1), so the single
    // largest uint32 value (0xFFFFFFFF) is the only draw that must be
    // rejected and redrawn. This proves the rejection loop actually runs
    // instead of just doing draw % n on every value.
    const draws = [0xffffffff, 5]; // 5 % 3 === 2, an unambiguous accepted value
    let callCount = 0;
    const source = (arr) => {
      arr[0] = draws[callCount];
      callCount++;
    };
    const result = randomIndex(3, source);
    assert.equal(callCount, 2, 'expected the boundary value to be rejected and a second draw made');
    assert.equal(result, 2);
  });

  test('accepts a draw just below the bias boundary on the first try (n=3)', () => {
    const draws = [0xfffffffe]; // one below the rejected value, 0xFFFFFFFE % 3 === 2
    let callCount = 0;
    const source = (arr) => {
      arr[0] = draws[callCount];
      callCount++;
    };
    const result = randomIndex(3, source);
    assert.equal(callCount, 1);
    assert.equal(result, 2);
  });

  test('never returns a value outside [0, n) across many injected draws', () => {
    const n = 7;
    for (let i = 0; i < 1000; i++) {
      const fixed = Math.floor(Math.random() * 0x100000000);
      const source = (arr) => {
        arr[0] = fixed;
      };
      const result = randomIndex(n, source);
      assert.ok(result >= 0 && result < n);
    }
  });
});

describe('random: uniformity (loose statistical check)', () => {
  test('distributes ~10k draws roughly evenly across 3 options', () => {
    const n = 3;
    const draws = 10000;
    const counts = new Array(n).fill(0);

    for (let i = 0; i < draws; i++) {
      counts[randomIndex(n)]++;
    }

    // Spec's own tolerance example: each of 3 options should land within
    // roughly 28-39% over 10k draws. This is a loose sanity check against
    // gross bias, not a rigorous statistical test.
    for (const count of counts) {
      const fraction = count / draws;
      assert.ok(
        fraction >= 0.28 && fraction <= 0.39,
        `expected each option's share to land within 28-39%, got ${(fraction * 100).toFixed(1)}% (counts=${counts})`
      );
    }
  });
});
