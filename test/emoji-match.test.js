import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { matchEmoji, MISS_EMOJI } from '../src/emoji-match.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const aliases = JSON.parse(readFileSync(path.join(here, '..', 'assets', 'emoji-aliases.json'), 'utf8'));
const dataset = JSON.parse(readFileSync(path.join(here, '..', 'assets', 'emoji-dataset.json'), 'utf8'));

const match = (label) => matchEmoji(label, aliases, dataset);

describe('emoji-match: alias overlay hits', () => {
  test('"avo toast" hits the AU alias overlay', () => {
    assert.equal(match('avo toast'), '🥑');
  });

  test('"milo" hits the AU alias overlay', () => {
    assert.equal(match('milo'), '🍫');
  });

  test('is case-insensitive and trims whitespace', () => {
    assert.equal(match('  Avo Toast  '), '🥑');
    assert.equal(match('MILO'), '🍫');
  });

  test('AU/kid alias examples from the spec', () => {
    assert.equal(match('vegemite'), '🍞');
    assert.equal(match('weet-bix'), '🥣');
    assert.equal(match('babyccino'), '☕');
    assert.equal(match('booster seat'), '🪑');
    assert.equal(match('duplo'), '🧱');
    assert.equal(match('paw patrol'), '🐶');
    assert.equal(match('bluey'), '🐕');
    assert.equal(match('yoto'), '🔊');
    assert.equal(match('playground'), '🛝');
    assert.equal(match('scooter'), '🛴');
  });

  test('ice cream flavours from the spec', () => {
    assert.equal(match('mango'), '🥭');
    assert.equal(match('choc'), '🍫');
    assert.equal(match('chocolate'), '🍫');
    assert.equal(match('strawberry'), '🍓');
    assert.equal(match('vanilla'), '🍦');
    assert.equal(match('cookies and cream'), '🍪');
  });

  test('alias overlay overrides a known-bad dataset entry', () => {
    // The vendored dataset maps "chocolate" to a gift-box heart emoji
    // (an emojilib artifact), not an actual chocolate bar. The alias
    // overlay must win because it is checked first.
    assert.notEqual(dataset['chocolate'], '🍫');
    assert.equal(match('chocolate'), '🍫');
  });
});

describe('emoji-match: dataset exact hits', () => {
  test('matches a plain dataset entry with no alias', () => {
    assert.equal(match('watermelon'), dataset['watermelon']);
    assert.equal(match('watermelon'), '🍉');
  });

  test('matches "egg" directly from the dataset', () => {
    assert.equal(match('egg'), '🥚');
  });
});

describe('emoji-match: singularisation fallback', () => {
  test('"eggs" singularises to "egg" (spec example)', () => {
    assert.equal(dataset['eggs'], undefined, 'precondition: dataset has no plural entry');
    assert.equal(match('eggs'), '🥚');
  });

  test('"strawberries" singularises to "strawberry"', () => {
    assert.equal(dataset['strawberries'], undefined, 'precondition: dataset has no plural entry');
    assert.equal(match('strawberries'), '🍓');
  });

  test('plural phrases still resolve via the singularised last word', () => {
    // The dataset's own "green apple" entry wins here (a more specific
    // match found at the singularised-exact step), which is the correct
    // behaviour — it's still a sensible apple emoji, just not the generic
    // 🍎 that bare "apple" resolves to.
    assert.equal(match('green apples'), '🍏');
  });
});

describe('emoji-match: word-boundary/substring fallback', () => {
  test('finds a whole-word match inside a longer phrase', () => {
    // "banana" isn't a key on its own in this phrase, but appears as a
    // whole word, so the fallback step should still find it.
    assert.equal(match('yellow banana please'), '🍌');
  });

  test('prefers the alias overlay over the dataset during fallback', () => {
    assert.equal(match('some chocolate please'), '🍫');
  });
});

describe('emoji-match: substring fallback false-positive guard', () => {
  // The spec's Testing section explicitly calls out word-boundary/substring
  // fallback as a risk area for false positives. findFallbackMatch() tries
  // a whole-word (\b...\b) match first, which correctly rejects "cat"
  // inside these words (no word boundary there) — but it then falls
  // through to a second, unguarded raw-substring tier (`.includes()`) that
  // has no such protection, so these labels wrongly resolve to the cat
  // emoji anyway. A kid-facing option like "category" or "vacation
  // scatter game" should not silently become a cat.
  test('does not match "cat" as a bare substring inside "scatter"', () => {
    assert.notEqual(match('scatter'), dataset['cat']);
  });

  test('does not match "cat" as a bare substring inside "category"', () => {
    assert.notEqual(match('category'), dataset['cat']);
  });

  test('does not match "cat" as a bare substring inside "concatenate"', () => {
    assert.notEqual(match('concatenate'), dataset['cat']);
  });

  test('does not match "cat" as a bare substring inside "catastrophe"', () => {
    assert.notEqual(match('catastrophe'), dataset['cat']);
  });
});

describe('emoji-match: miss', () => {
  test('returns the ❓ placeholder, not null/undefined, when nothing matches', () => {
    const result = match('qwfpzxcvzz');
    assert.equal(result, MISS_EMOJI);
    assert.notEqual(result, null);
    assert.notEqual(result, undefined);
  });

  test('empty input returns the ❓ placeholder', () => {
    assert.equal(match(''), MISS_EMOJI);
    assert.equal(match('   '), MISS_EMOJI);
  });
});
