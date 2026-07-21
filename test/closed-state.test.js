import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseClosedState, serializeClosedState, canSpin } from '../src/closed-state.js';

describe('closed-state: serialization round-trip', () => {
  test('serializing closed then parsing it back reads as closed', () => {
    assert.equal(parseClosedState(serializeClosedState(true)), true);
  });

  test('serializing open then parsing it back reads as open', () => {
    assert.equal(parseClosedState(serializeClosedState(false)), false);
  });

  test('missing/corrupt storage (null, empty string, garbage) defensively reads as open, never closed', () => {
    assert.equal(parseClosedState(null), false);
    assert.equal(parseClosedState(''), false);
    assert.equal(parseClosedState('garbage'), false);
    assert.equal(parseClosedState(undefined), false);
  });
});

describe('closed-state: spin-blocked logic', () => {
  test('spinnable when open, not spinning, not yet spun', () => {
    assert.equal(canSpin({ closed: false, spinning: false, spun: false }), true);
  });

  test('closed blocks a spin even if otherwise idle', () => {
    assert.equal(canSpin({ closed: true, spinning: false, spun: false }), false);
  });

  test('already spinning blocks a second spin', () => {
    assert.equal(canSpin({ closed: false, spinning: true, spun: false }), false);
  });

  test('already spun (one spin per decision) blocks another spin', () => {
    assert.equal(canSpin({ closed: false, spinning: false, spun: true }), false);
  });

  test('closed AND spun still blocks (no double-counting assumptions)', () => {
    assert.equal(canSpin({ closed: true, spinning: false, spun: true }), false);
  });
});
