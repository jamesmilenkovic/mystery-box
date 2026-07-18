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

// ---------------------------------------------------------------------
// Increment 2, workstream C: colour/direction word coverage, the
// phrase-vs-colour precedence guardrail, curated alias spot-checks, and
// the new name-word index tier.
// ---------------------------------------------------------------------

describe('emoji-match: colour and direction word coverage (name-word indexing)', () => {
  test('bare colour words resolve to their swatch, not a dataset lookalike', () => {
    assert.equal(match('red'), '🔴');
    assert.equal(match('blue'), '🔵');
    assert.equal(match('green'), '🟢');
    assert.equal(match('yellow'), '🟡');
    assert.equal(match('purple'), '🟣');
    assert.equal(match('pink'), '🩷');
    assert.equal(match('black'), '⚫');
    assert.equal(match('white'), '⚪');
    assert.equal(match('brown'), '🟤');
    // "orange" was deliberately left as the fruit (🍊) during initial
    // curation since it already had a sensible alias from increment 1 —
    // James's explicit call was to override it with the colour swatch to
    // match SPEC.md's alias list literally (2026-07-18).
    assert.equal(match('orange'), '🟠');
  });

  test('phrase-vs-colour precedence: "red car" prefers a car-family match, not the swatch', () => {
    // The vendored dataset maps bare "red"/"blue" to unrelated face
    // emoji, and the alias overlay's colour words are deliberately
    // exempted from the fallback tier for exactly this reason — a real
    // phrase should never lose to a colour word buried inside it.
    assert.notEqual(match('red car'), '🔴');
    assert.notEqual(match('red car'), MISS_EMOJI);
  });

  test('phrase-vs-colour precedence: "orange juice"/"orange car" prefer their real match, not the swatch', () => {
    // Same guardrail as "red car" above, exercised for "orange" now that
    // it resolves to the colour swatch instead of the fruit at the exact
    // tier — without the fallback exemption, these phrases would regress
    // to the plain colour circle.
    assert.notEqual(match('orange juice'), '🟠');
    assert.notEqual(match('orange car'), '🟠');
  });

  test('left/right resolve to direction arrows, same precedence guardrail applies', () => {
    assert.equal(match('left'), '⬅️');
    assert.equal(match('right'), '➡️');
  });
});

describe('emoji-match: alias overlay spot-checks (spec categories)', () => {
  test('family/people', () => {
    assert.equal(match('mum'), '👩');
    assert.equal(match('mummy'), '👩');
    assert.equal(match('dad'), '👨');
    assert.equal(match('nanna'), '👵');
    assert.equal(match('nan'), '👵');
    assert.equal(match('grandpa'), '👴');
    assert.equal(match('brother'), '👦');
    assert.equal(match('sister'), '👧');
    assert.equal(match('baby'), '👶');
    assert.equal(match('friend'), '🧒');
  });

  test('car/seats', () => {
    assert.equal(match('front seat'), '🚗');
    assert.equal(match('back seat'), '🚗');
    assert.equal(match('window seat'), '💺');
    assert.equal(match('car'), '🚗');
  });

  test('numbers 1-10', () => {
    assert.equal(match('1'), '1️⃣');
    assert.equal(match('10'), '🔟');
    assert.equal(match('seven'), '7️⃣');
  });

  test('places/activities', () => {
    assert.equal(match('soccer'), '⚽');
    assert.equal(match('cricket'), '🏏');
    assert.equal(match('drawing'), '🎨');
  });
});

describe('emoji-match: name-word index (single-word query matches a word inside a multi-word name)', () => {
  test('matches a word that only appears as one word of a longer dataset name', () => {
    const miniDataset = { 'party popper': '🎉' };
    // Not reachable via the existing whole-key or boundary-partial-match
    // fallback tiers: "party popper" isn't a substring of "popper", and
    // "popper" only covers 6/13 = 46% of "party popper" — below the
    // partial-match ratio threshold. Only the name-word index closes this.
    assert.equal(matchEmoji('popper', {}, miniDataset), '🎉');
  });

  test('matches a middle word, not just a prefix/suffix of the name', () => {
    const miniDataset = { 'red velvet cake': '🍰' };
    assert.equal(matchEmoji('velvet', {}, miniDataset), '🍰');
  });

  test('only ever applies to single-word queries — a multi-word query does not fall back to it', () => {
    const miniDataset = { 'red velvet cake': '🍰' };
    // "velvet" alone would resolve via the name-word index (see the test
    // above), but as soon as the query is a phrase, that tier must stay
    // out of it entirely — same precedence principle as the colour-word
    // exemption, generalised to any single indexed word.
    assert.equal(matchEmoji('some velvet cake please', {}, miniDataset), MISS_EMOJI);
  });

  test('among multiple names containing the same word, prefers the fewest-words name', () => {
    const miniDataset = {
      'gold star medal': '🥇', // 3 words
      'star medal': '🏅', // 2 words — more directly "about" the query word
    };
    assert.equal(matchEmoji('medal', {}, miniDataset), '🏅');
  });

  test('checks the alias overlay before the dataset, same priority as every other tier', () => {
    const miniAliases = { 'shooting star': '🌠' };
    const miniDataset = { 'lucky star': '⭐' };
    assert.equal(matchEmoji('star', miniAliases, miniDataset), '🌠');
  });

  test('common stopwords (e.g. "with") are not indexed and never produce a match on their own', () => {
    const miniDataset = { 'bowl with spoon': '🥣' };
    assert.equal(matchEmoji('with', {}, miniDataset), MISS_EMOJI);
  });
});
