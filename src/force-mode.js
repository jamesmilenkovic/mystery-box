// Pure module: the secret, parent-gated "force" arming rules from PRD
// principle 5 (revised 2026-07-18). No DOM, no storage — app.js owns the
// single mutable "which chip is armed" reference and calls these pure
// helpers to decide state transitions, which is what makes the rules
// (arm/disarm/re-arm, single-armed invariant, storage cleanliness)
// unit-testable in isolation.
//
// Binding guardrails this module exists to uphold (see SPEC.md appendix):
//   - force state is memory-only, never persisted — serializeBoxForStorage
//     below is a narrow whitelist so an armed reference can never leak
//     into the localStorage payload even by accident.
//   - no probability weighting anywhere — resolveWinnerIndex never
//     invents randomness itself, it only chooses between an armed index
//     and a genuinely random one the caller already drew.

/**
 * Decides the new armed reference after a long-press toggle gesture on a
 * chip. Long-pressing the already-armed chip again disarms it; long-
 * pressing a different chip arms that one instead — since only one
 * reference is ever tracked, arming a new chip implicitly disarms
 * whichever was armed before ("max one armed").
 *
 * @param {*} currentArmed - the currently armed chip reference, or null.
 * @param {*} pressedChip - the chip reference that was just long-pressed.
 * @returns {*} the new armed chip reference, or null.
 */
export function toggleArm(currentArmed, pressedChip) {
  return currentArmed === pressedChip ? null : pressedChip;
}

/**
 * Clears the armed reference if the chip being removed or edited
 * (emoji tap-to-fix) is the one currently armed. Leaves it untouched if
 * some other, unrelated chip was affected — removing/editing a different
 * chip must not disturb an existing arm.
 *
 * @param {*} currentArmed
 * @param {*} affectedChip - the chip that was just removed/edited.
 * @returns {*} the new armed chip reference, or null.
 */
export function disarmIfMatches(currentArmed, affectedChip) {
  return currentArmed === affectedChip ? null : currentArmed;
}

/**
 * Resolves which option index a spin should land on. A forced (armed)
 * index always wins outright; the unforced path returns the caller-
 * supplied genuinely-random index untouched — this function never draws
 * or weights randomness itself, it only substitutes the final winner.
 *
 * @param {number} armedIndex - index of the armed option, or -1 if none.
 * @param {number} randomWinnerIndex - the result of a real random draw.
 * @returns {number}
 */
export function resolveWinnerIndex(armedIndex, randomWinnerIndex) {
  return armedIndex >= 0 ? armedIndex : randomWinnerIndex;
}

/**
 * Builds the exact object persisted to localStorage for the current box.
 * Deliberately narrow — only ever includes {label, emoji, photoId} per
 * option (increment 3 extends the whitelist by exactly photoId) — so
 * memory-only force state can never leak into storage even if a caller
 * accidentally passes a chip object carrying extra properties.
 *
 * @param {{label: string, emoji: string, photoId?: string|null}[]} chips
 * @returns {{options: {label: string, emoji: string, photoId: string|null}[]}}
 */
export function serializeBoxForStorage(chips) {
  return {
    options: chips.map(({ label, emoji, photoId }) => ({ label, emoji, photoId: photoId ?? null })),
  };
}
