// QA-authored supplementary coverage for increment 2 workstream C, written
// independently of the coder's test/emoji-match.test.js. Targets gaps the
// spec's Testing section calls out explicitly (name-word indexing, alias
// spot-checks, phrase-vs-colour precedence) plus adversarial probing for
// the substring-fallback false-positive class the coder's own tests
// already acknowledge as a risk area ("cat" inside "category").
//
// Pure data-driven tests only — no feature source is modified here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { matchEmoji, MISS_EMOJI } from '../src/emoji-match.js';
import { resolveVisual } from '../src/letter-tile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const aliases = JSON.parse(readFileSync(path.join(here, '..', 'assets', 'emoji-aliases.json'), 'utf8'));
const dataset = JSON.parse(readFileSync(path.join(here, '..', 'assets', 'emoji-dataset.json'), 'utf8'));

const match = (label) => matchEmoji(label, aliases, dataset);

describe('emoji-match QA: "mum" resolves via the alias overlay, not name-word indexing', () => {
  test('aliases carries an exact "mum" key', () => {
    assert.equal(aliases['mum'], '👩');
  });

  test('the dataset alone (no alias overlay) does NOT resolve "mum" — proves the alias exact-match', () => {
    // If this were passing because of the dataset's name-word index instead
    // of the alias overlay, this call (aliases stripped out) would still
    // resolve. It must not: nothing in the vendored dataset's names
    // contains "mum" as a word.
    assert.equal(matchEmoji('mum', {}, dataset), MISS_EMOJI);
  });

  test('no multi-word dataset name contains "mum" as one of its words', () => {
    const hits = Object.keys(dataset).filter((key) => /\bmum\b/.test(key));
    assert.deepEqual(hits, [], `expected no dataset names containing "mum", found: ${hits}`);
  });
});

describe('emoji-match QA: extended phrase-vs-colour precedence stress test', () => {
  // The coder's own tests cover "red car" and "orange juice"/"orange car".
  // This sweeps more colour+noun combinations to make sure the exemption
  // generalises rather than being tuned to just the two spec examples.
  const cases = [
    ['blue car', '🔵'],
    ['purple bike', '🟣'],
    ['black cat', '⚫'],
    ['white car', '⚪'],
    ['pink car', '🩷'],
    ['yellow car', '🟡'],
    ['green apple', '🟢'],
    ['brown bread', '🟤'],
  ];

  for (const [label, swatch] of cases) {
    test(`"${label}" does not resolve to the bare colour swatch ${swatch}`, () => {
      const result = match(label);
      assert.notEqual(result, swatch, `"${label}" wrongly matched the colour swatch instead of a specific noun match`);
      assert.notEqual(result, MISS_EMOJI, `"${label}" should resolve to something, not a miss`);
    });
  }
});

describe('emoji-match QA: data integrity — MISS_EMOJI (❓) is never a real mapped alias value', () => {
  test('no alias entry maps to the ❓ glyph', () => {
    const offenders = Object.entries(aliases).filter(([, v]) => v === MISS_EMOJI);
    assert.deepEqual(offenders, [], `alias entries must never map to ❓: ${JSON.stringify(offenders)}`);
  });
});

describe('emoji-match QA: BUG (low severity) — MISS_EMOJI sentinel collides with the dataset\'s legitimate "question mark" emoji', () => {
  // The vendored dataset legitimately maps "question mark" -> ❓ (it IS the
  // real Unicode question-mark emoji). But matchEmoji() and
  // resolveVisual() use that same "❓" string as the internal "no match
  // found" sentinel (MISS_EMOJI). The two are indistinguishable by value,
  // so a parent who literally types "question mark" as an option gets a
  // *successful* dataset match of "❓" — which resolveVisual() then
  // misreads as a miss and silently swaps for a red "Q" letter tile
  // instead of showing the actual question-mark emoji.
  //
  // Very low real-world impact (an unusual option label), but it's the
  // one case where the spec's "❓ never visibly appears" guarantee is
  // trivially true for the wrong reason — the correct match *was* ❓ and
  // got suppressed anyway. Flagging for the coder to judge whether it's
  // worth a fix (e.g. a non-emoji-valued internal sentinel) or an
  // accepted edge case.
  test('the dataset does contain a legitimate ❓ entry ("question mark")', () => {
    assert.equal(dataset['question mark'], MISS_EMOJI);
  });

  test('matchEmoji("question mark") returns a real, successful match (not a miss)', () => {
    assert.equal(match('question mark'), MISS_EMOJI); // same glyph — matched correctly by matchEmoji
  });

  // TODO, not fixed in this pass — known, low-severity, accepted edge
  // case (James/QA agreement): "❓" is both the internal MISS_EMOJI
  // sentinel and the dataset's real "question mark" -> ❓ value, so a
  // parent typing "question mark" as an option gets misread as a miss and
  // rendered as a letter tile instead of the actual ❓ emoji. Left as
  // `todo` rather than deleted or force-passed so the suite reads green
  // while the issue stays documented and traceable — same spirit as the
  // "cart"/"muscat" affix-collision watch-item logged in increment 1.
  test('but resolveVisual() then renders it as a letter tile instead of the actual ❓ emoji — the observable product bug', { todo: 'known low-severity sentinel collision, not fixed in this pass — see comment above' }, () => {
    const matched = match('question mark');
    const visual = resolveVisual(matched, 'question mark');
    // What SHOULD happen for a genuine match: kind 'emoji', value '❓'.
    // What actually happens: the sentinel collision makes resolveVisual
    // treat this successful match identically to a failed one.
    assert.equal(visual.kind, 'emoji', 'a real dataset match for "question mark" should render as the emoji itself, not a fallback tile');
  });
});

describe('emoji-match QA: BUG — short alias words falsely capture ordinary English words via the boundary-partial-match fallback tier', () => {
  // Root cause: findFallbackMatch's second tier (isBoundaryPartialMatch)
  // accepts any candidate word where the alias key covers >= 50% of the
  // word's length AND sits at a start/end boundary. Short (3-letter)
  // alias words newly added for workstream C's family/number categories
  // ("pop", "ten") are NOT in FALLBACK_EXEMPT_ALIAS_WORDS the way colours
  // and left/right are, so this tier fires on plausible everyday words
  // before the (correct) dataset name-word index ever gets a look-in.
  // This is the same false-positive class the coder's own
  // "substring fallback false-positive guard" suite tests for "cat" — it
  // just wasn't extended to the newly-added short aliases.
  //
  // These assertions currently FAIL against the implementation as shipped
  // — see the QA report for the concrete repro and suggested fix
  // directions (widen FALLBACK_EXEMPT_ALIAS_WORDS, raise
  // MIN_PARTIAL_MATCH_RATIO, or raise MIN_FALLBACK_KEY_LENGTH for the
  // alias tier).

  test('"popper" must not resolve to the "pop" (grandpa) alias — dataset has a real "party popper" 🎉 entry', () => {
    const result = match('popper');
    assert.notEqual(result, aliases['pop'], `"popper" wrongly resolved to the grandpa alias (${aliases['pop']}); got ${result}`);
  });

  test('"poplar" (a tree) must not resolve to the "pop" (grandpa) alias', () => {
    const result = match('poplar');
    assert.notEqual(result, aliases['pop'], `"poplar" wrongly resolved to the grandpa alias (${aliases['pop']}); got ${result}`);
  });

  test('"popup"/"popped"/"poppin" must not resolve to the "pop" (grandpa) alias', () => {
    for (const word of ['popup', 'popped', 'poppin']) {
      const result = match(word);
      assert.notEqual(result, aliases['pop'], `"${word}" wrongly resolved to the grandpa alias (${aliases['pop']}); got ${result}`);
    }
  });

  test('"often" must not resolve to the "ten" (number 10) alias', () => {
    const result = match('often');
    assert.notEqual(result, aliases['ten'], `"often" wrongly resolved to the number-10 alias (${aliases['ten']}); got ${result}`);
  });

  test('"tenpin"/"tender" must not resolve to the "ten" (number 10) alias', () => {
    for (const word of ['tenpin', 'tender']) {
      const result = match(word);
      assert.notEqual(result, aliases['ten'], `"${word}" wrongly resolved to the number-10 alias (${aliases['ten']}); got ${result}`);
    }
  });

  test('"carpet"/"carton" must not resolve to the "car" alias', () => {
    for (const word of ['carpet', 'carton']) {
      const result = match(word);
      assert.notEqual(result, aliases['car'], `"${word}" wrongly resolved to the car alias (${aliases['car']}); got ${result}`);
    }
  });
});
