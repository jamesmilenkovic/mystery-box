// Pure module: turns raw typed/pasted text into a list of option labels,
// and enforces the 2-6 option bounds. No DOM — the setup screen calls
// this on whatever text fragment was just committed (comma or Return).

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

/**
 * Splits raw text on commas and/or newlines into trimmed, non-empty,
 * de-duplicated (case-insensitive, first occurrence wins) labels.
 *
 * @param {string} rawText
 * @returns {string[]}
 */
export function parseOptions(rawText) {
  const pieces = String(rawText ?? '').split(/[,\n\r]+/);
  const seen = new Set();
  const result = [];

  for (const piece of pieces) {
    const trimmed = piece.trim().replace(/\s+/g, ' ');
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

/**
 * Whether a given option count satisfies the 2-6 bounds the GO button
 * enforces.
 *
 * @param {number} count
 * @returns {boolean}
 */
export function isValidOptionCount(count) {
  return Number.isInteger(count) && count >= MIN_OPTIONS && count <= MAX_OPTIONS;
}
