import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, isValidOptionCount, MIN_OPTIONS, MAX_OPTIONS } from '../src/option-entry.js';

describe('option-entry: parseOptions', () => {
  test('splits on commas', () => {
    assert.deepEqual(parseOptions('eggs,cereal,toast'), ['eggs', 'cereal', 'toast']);
  });

  test('splits on returns/newlines', () => {
    assert.deepEqual(parseOptions('eggs\ncereal\ntoast'), ['eggs', 'cereal', 'toast']);
  });

  test('splits on a mix of commas and newlines', () => {
    assert.deepEqual(parseOptions('eggs,\ncereal\n,toast'), ['eggs', 'cereal', 'toast']);
  });

  test('trims surrounding whitespace on each piece', () => {
    assert.deepEqual(parseOptions('  eggs  ,  cereal  '), ['eggs', 'cereal']);
  });

  test('collapses internal repeated whitespace', () => {
    assert.deepEqual(parseOptions('avo   on toast'), ['avo on toast']);
  });

  test('drops empty pieces from stray/doubled delimiters', () => {
    assert.deepEqual(parseOptions('eggs,,cereal,'), ['eggs', 'cereal']);
  });

  test('dedupes case-insensitively, keeping the first occurrence', () => {
    assert.deepEqual(parseOptions('Eggs, cereal, eggs, EGGS'), ['Eggs', 'cereal']);
  });

  test('empty or whitespace-only input yields no options', () => {
    assert.deepEqual(parseOptions(''), []);
    assert.deepEqual(parseOptions('   \n  ,  '), []);
  });
});

describe('option-entry: isValidOptionCount (2-6 bounds)', () => {
  test('rejects below the minimum', () => {
    assert.equal(isValidOptionCount(0), false);
    assert.equal(isValidOptionCount(1), false);
  });

  test('accepts the full valid range', () => {
    for (let n = MIN_OPTIONS; n <= MAX_OPTIONS; n++) {
      assert.equal(isValidOptionCount(n), true, `expected ${n} to be valid`);
    }
  });

  test('rejects above the maximum', () => {
    assert.equal(isValidOptionCount(7), false);
    assert.equal(isValidOptionCount(20), false);
  });
});
