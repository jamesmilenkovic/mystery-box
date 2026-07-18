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
function findFallbackMatch(normalized, data) {
  let bestWordKey = null;
  for (const key of Object.keys(data)) {
    if (key.length < MIN_FALLBACK_KEY_LENGTH) continue;
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`);
    if (re.test(normalized) && (!bestWordKey || key.length > bestWordKey.length)) {
      bestWordKey = key;
    }
  }
  if (bestWordKey) return data[bestWordKey];

  const words = normalized.split(' ');
  let bestSubstringKey = null;
  for (const key of Object.keys(data)) {
    if (key.length < MIN_FALLBACK_KEY_LENGTH) continue;
    const matches =
      isBoundaryPartialMatch(normalized, key) ||
      words.some((word) => isBoundaryPartialMatch(word, key));
    if (matches && (!bestSubstringKey || key.length > bestSubstringKey.length)) {
      bestSubstringKey = key;
    }
  }
  return bestSubstringKey ? data[bestSubstringKey] : undefined;
}

/**
 * Matches a raw option label to an emoji.
 *
 * Match order: alias exact -> dataset exact -> singularised (alias then
 * dataset) -> word-boundary/substring (alias then dataset) -> miss.
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

  const aliasFallback = findFallbackMatch(normalized, aliases);
  if (aliasFallback !== undefined) return aliasFallback;

  const datasetFallback = findFallbackMatch(normalized, dataset);
  if (datasetFallback !== undefined) return datasetFallback;

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
