// Pure module: matches a typed option label to an emoji.
// No DOM, no fetch, no I/O — callers pass in the alias and dataset lookup
// objects (loaded however suits the environment: fetch() in the browser,
// fs.readFileSync in tests). Keeping this pure is what makes it unit-testable.

// Shown when nothing matches, so the UI can render a tap-to-fix prompt
// instead of a blank/undefined chip.
export const MISS_EMOJI = '❓';

// Minimum key length considered for word-boundary/substring fallback
// matching. Keeps very short dataset keys (like "a", "at") from matching
// almost anything by accident.
const MIN_FALLBACK_KEY_LENGTH = 3;

// Single-word "modifier" aliases (colours, directions) that must only ever
// win on an EXACT whole-label match ("red" alone), never via the
// word-boundary/substring fallback tier below. Without this, a phrase like
// "red car" would find "red" as a fallback word-match and win before a
// more specific match (e.g. "car") ever gets a look-in — the spec calls
// this out explicitly: "red car" must still prefer 🚗-family matches, not
// the plain colour swatch.
const FALLBACK_EXEMPT_ALIAS_WORDS = new Set([
  'red', 'blue', 'green', 'yellow', 'purple', 'pink', 'black', 'white', 'brown', 'orange',
  'left', 'right',
]);

// Second guardrail for the alias overlay, general rather than word-by-word
// like the one above. The fuzzy prefix/suffix tier below (isBoundaryPartialMatch)
// is meant to catch genuine inflected/typo'd forms of a *specific, distinctive*
// key ("chocolatey" -> "chocolate"), but for a SHORT key that reliability
// breaks down: any 3-5 letter alias word sits at the start or end of a huge
// number of unrelated everyday words purely by coincidence — "pop" inside
// "popper"/"poplar", "ten" inside "often"/"tenpin", "car" inside
// "carpet"/"carton". The alias overlay keeps gaining short single-word
// entries every increment (family terms, numbers, colours, "car"...), so
// this is a length threshold, not a word list — it protects every short
// alias automatically instead of needing a name added here by hand each
// time. Tier 1 (the strict \bkey\b whole-word match just below) doesn't
// have this problem — a real word boundary is a real word boundary
// regardless of key length — so it keeps using MIN_FALLBACK_KEY_LENGTH and
// stays available for short alias words there.
const MIN_ALIAS_PARTIAL_MATCH_KEY_LENGTH = 6;

function normalize(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Naive English singularizer covering the common cases needed here
// (plural food/object words). Not a full inflector — good enough for
// short kid-vocab option labels, and only used as one step in the chain.
function singularize(word) {
  if (word.endsWith('ies') && word.length > 4) {
    // e.g. strawberries -> strawberry, berries -> berry
    return word.slice(0, -3) + 'y';
  }
  if (/(?:s|x|z|ch|sh)es$/.test(word)) {
    // e.g. boxes -> box, watches -> watch
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 1) {
    // e.g. eggs -> egg
    return word.slice(0, -1);
  }
  return word;
}

// Applies singularize() to the last word only, so multi-word labels like
// "green apples" become "green apple" rather than mangling earlier words.
function singularizePhrase(normalized) {
  const words = normalized.split(' ');
  const last = words.pop();
  words.push(singularize(last));
  return words.join(' ');
}

// Minimum share of the longer string that the shorter string must cover
// to count as a genuine partial match in the second fallback tier below.
// This is what tells a real partial word like "chocolatey" -> "chocolate"
// (90% overlap) apart from a short key that just happens to sit at the
// start of an unrelated longer word, like "cat" -> "category" (37%
// overlap) — both are technically prefixes, but only one is substantial
// enough to trust.
const MIN_PARTIAL_MATCH_RATIO = 0.5;

// True if `a` and `b` are genuinely related by a partial-word match: the
// shorter of the two is a prefix or suffix of the longer (an actual
// word/token edge — the very start or end of the string — not an
// arbitrary run of letters embedded in the middle), and the shorter one
// makes up at least MIN_PARTIAL_MATCH_RATIO of the longer one's length.
function isBoundaryPartialMatch(a, b) {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length === 0) return false;
  if (shorter.length / longer.length < MIN_PARTIAL_MATCH_RATIO) return false;
  return longer.startsWith(shorter) || longer.endsWith(shorter);
}

// Finds the best word-boundary or partial-word match for `normalized`
// among the keys of `data`. Prefers a whole-word match over a partial
// one, and prefers the longest (most specific) matching key.
//
// @param {Set<string>} [exemptKeys] - keys to skip entirely in this tier
//   (used to keep single-word "modifier" aliases like colours from
//   winning inside an unrelated phrase — see FALLBACK_EXEMPT_ALIAS_WORDS).
// @param {number} [minPartialMatchKeyLength] - minimum key length allowed
//   into the second, fuzzy prefix/suffix tier specifically — see
//   MIN_ALIAS_PARTIAL_MATCH_KEY_LENGTH for why this needs to be higher
//   than the first (strict word-boundary) tier's threshold for short
//   alias words. Defaults to MIN_FALLBACK_KEY_LENGTH, i.e. no extra
//   restriction beyond what tier 1 already applies.
function findFallbackMatch(normalized, data, { exemptKeys = EMPTY_SET, minPartialMatchKeyLength = MIN_FALLBACK_KEY_LENGTH } = {}) {
  let bestWordKey = null;
  for (const key of Object.keys(data)) {
    if (key.length < MIN_FALLBACK_KEY_LENGTH || exemptKeys.has(key)) continue;
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`);
    if (re.test(normalized) && (!bestWordKey || key.length > bestWordKey.length)) {
      bestWordKey = key;
    }
  }
  if (bestWordKey) return data[bestWordKey];

  const words = normalized.split(' ');
  let bestSubstringKey = null;
  for (const key of Object.keys(data)) {
    if (key.length < minPartialMatchKeyLength || exemptKeys.has(key)) continue;
    const matches =
      isBoundaryPartialMatch(normalized, key) ||
      words.some((word) => isBoundaryPartialMatch(word, key));
    if (matches && (!bestSubstringKey || key.length > bestSubstringKey.length)) {
      bestSubstringKey = key;
    }
  }
  return bestSubstringKey ? data[bestSubstringKey] : undefined;
}

const EMPTY_SET = new Set();

// English stopwords excluded from the name-word index below — otherwise a
// filler word like "with" (which appears in ~100 dataset names, e.g.
// "bowl with spoon") would "win" an index slot and produce nonsense
// matches for a query that happens to just be that word.
const NAME_WORD_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'with', 'without', 'for', 'to',
]);

// One index per distinct `data` object (aliases vs dataset), built lazily
// and cached by object identity — matchEmoji is called once per committed
// option label, not on every keystroke, but there's no reason to redo the
// full dataset scan every time either.
const nameWordIndexCache = new WeakMap();

function splitIntoWords(key) {
  return key.split(/[^a-z0-9']+/).filter(Boolean);
}

// Builds a word -> key index from every multi-word name in `data` (e.g.
// "military medal" indexes both "military" and "medal"). Single-word keys
// are skipped — a query that's already exactly one of those keys is
// resolved by the plain exact-match tier long before this runs.
//
// When more than one multi-word name contains the same word, the most
// specific-feeling one wins: fewest words first (closer to a direct name
// for the concept), then shortest overall key, then alphabetical — so the
// choice is stable and reproducible rather than depending on JSON key
// order.
function buildNameWordIndex(data) {
  const index = new Map(); // word -> { key, wordCount }
  for (const key of Object.keys(data)) {
    const words = splitIntoWords(key);
    if (words.length < 2) continue;
    for (const word of words) {
      if (word.length < MIN_FALLBACK_KEY_LENGTH || NAME_WORD_STOPWORDS.has(word)) continue;
      const existing = index.get(word);
      if (
        !existing ||
        words.length < existing.wordCount ||
        (words.length === existing.wordCount &&
          (key.length < existing.key.length || (key.length === existing.key.length && key < existing.key)))
      ) {
        index.set(word, { key, wordCount: words.length });
      }
    }
  }
  return index;
}

function getNameWordIndex(data) {
  let index = nameWordIndexCache.get(data);
  if (!index) {
    index = buildNameWordIndex(data);
    nameWordIndexCache.set(data, index);
  }
  return index;
}

// Last-resort lookup: is `word` (a single-word query) one of the indexed
// name-words for `data`? Only ever consulted for single-word queries — a
// multi-word phrase is already handled correctly by findFallbackMatch
// above, and opening this tier up to phrases would reintroduce the same
// "red car" precedence risk the alias fallback exemption guards against.
function findNameWordMatch(word, data) {
  const entry = getNameWordIndex(data).get(word);
  return entry ? data[entry.key] : undefined;
}

/**
 * Matches a raw option label to an emoji.
 *
 * Match order: alias exact -> dataset exact -> singularised (alias then
 * dataset) -> word-boundary/substring (alias then dataset) -> name-word
 * index (single-word queries only; alias then dataset) -> miss.
 *
 * @param {string} rawLabel - the text the parent typed, e.g. "Avo Toast".
 * @param {object} aliases - curated AU/kid alias overlay, keyword -> emoji.
 * @param {object} dataset - vendored general keyword -> emoji dataset.
 * @returns {string} an emoji, or MISS_EMOJI if nothing matched.
 */
export function matchEmoji(rawLabel, aliases, dataset) {
  const normalized = normalize(rawLabel);
  if (!normalized) return MISS_EMOJI;

  if (aliases[normalized] !== undefined) return aliases[normalized];
  if (dataset[normalized] !== undefined) return dataset[normalized];

  const singular = singularizePhrase(normalized);
  if (singular !== normalized) {
    if (aliases[singular] !== undefined) return aliases[singular];
    if (dataset[singular] !== undefined) return dataset[singular];
  }

  const aliasFallback = findFallbackMatch(normalized, aliases, {
    exemptKeys: FALLBACK_EXEMPT_ALIAS_WORDS,
    minPartialMatchKeyLength: MIN_ALIAS_PARTIAL_MATCH_KEY_LENGTH,
  });
  if (aliasFallback !== undefined) return aliasFallback;

  const datasetFallback = findFallbackMatch(normalized, dataset);
  if (datasetFallback !== undefined) return datasetFallback;

  // Name-word index: only for single-word queries (see findNameWordMatch)
  // so this can never re-open the phrase-vs-modifier-word precedence
  // problem the exemption above guards against.
  if (!normalized.includes(' ')) {
    const aliasWordMatch = findNameWordMatch(normalized, aliases);
    if (aliasWordMatch !== undefined) return aliasWordMatch;

    const datasetWordMatch = findNameWordMatch(normalized, dataset);
    if (datasetWordMatch !== undefined) return datasetWordMatch;
  }

  return MISS_EMOJI;
}

/**
 * Powers the tap-to-fix picker sheet: returns keyword/emoji suggestions
 * whose keyword contains `query`, alias overlay first. Not part of the
 * spec's tested match chain — used only to populate the suggestion grid.
 *
 * @param {string} query - search field text (empty returns first entries).
 * @param {object} aliases
 * @param {object} dataset
 * @param {number} limit - max suggestions to return.
 * @returns {{key: string, emoji: string}[]}
 */
export function searchEmoji(query, aliases, dataset, limit = 24) {
  const normalized = normalize(query);
  const seen = new Set();
  const results = [];

  const addFrom = (data) => {
    for (const key of Object.keys(data)) {
      if (results.length >= limit) break;
      if (!normalized || key.includes(normalized)) {
        const emoji = data[key];
        const dedupeKey = `${key}:${emoji}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          results.push({ key, emoji });
        }
      }
    }
  };

  addFrom(aliases);
  if (results.length < limit) addFrom(dataset);
  return results.slice(0, limit);
}
