// Pure module: uniform random index picker for the honest box.
// No weighting of any kind — every option must have an equal chance,
// which is a hard product rule for this app, not a style choice.

const UINT32_RANGE = 0x100000000; // 2 ** 32

/**
 * Picks a uniformly random integer in [0, n) using crypto.getRandomValues
 * with rejection sampling, so the result is not biased by n not evenly
 * dividing 2^32 (the classic "modulo bias" problem with `random() % n`).
 *
 * @param {number} n - number of options (must be a positive integer).
 * @param {(arr: Uint32Array) => Uint32Array} [randomSource] - defaults to
 *   crypto.getRandomValues; overridable in tests to inject specific draws
 *   and verify the rejection logic without depending on real randomness.
 * @returns {number} a value in [0, n).
 */
export function randomIndex(n, randomSource = (arr) => crypto.getRandomValues(arr)) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError('randomIndex: n must be a positive integer');
  }
  if (n === 1) return 0;

  // Largest multiple of n that is <= 2^32. Draws at or above this limit
  // are rejected and redrawn so every kept value maps to an equally-sized
  // bucket of size (2^32 / n) — no option is more likely than another.
  const limit = UINT32_RANGE - (UINT32_RANGE % n);

  const buffer = new Uint32Array(1);
  let draw;
  do {
    randomSource(buffer);
    draw = buffer[0];
  } while (draw >= limit);

  return draw % n;
}
