// Pure module: the "Closed for now" parent toggle (SPEC.md increment 4,
// workstream B3). Manual only — no scheduling — a single boolean app.js
// persists to localStorage. Kept here, separate from app.js's DOM code,
// so the storage parse/serialize defensiveness and the spin-blocked
// decision are unit-testable in isolation.

const CLOSED_VALUE = 'true';

/**
 * Defensive parse of the raw localStorage value — anything other than the
 * exact stored "true" string reads as open (not closed), including
 * missing/corrupt storage, so a bad value never accidentally locks the
 * box shut.
 *
 * @param {string|null} raw
 * @returns {boolean}
 */
export function parseClosedState(raw) {
  return raw === CLOSED_VALUE;
}

/** @param {boolean} closed @returns {string} */
export function serializeClosedState(closed) {
  return closed ? CLOSED_VALUE : 'false';
}

/**
 * Whether the box may be spun right now. Closed, already-spinning, or
 * already-spun (one spin per decision) all block it.
 *
 * @param {{closed: boolean, spinning: boolean, spun: boolean}} state
 * @returns {boolean}
 */
export function canSpin({ closed, spinning, spun }) {
  return !closed && !spinning && !spun;
}
