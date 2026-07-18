// Pure module: deterministic coloured letter-tile fallback for option
// labels matchEmoji() couldn't resolve to a real emoji (MISS_EMOJI). Keeps
// every option visually distinct for a pre-reader even on a total miss,
// and is what replaces the ❓ placeholder glyph everywhere in the
// rendered UI — matchEmoji() itself is untouched and still returns
// MISS_EMOJI internally as a "this was a miss" signal; the tile is a
// rendering-layer decision, not a change to the matching contract.

import { MISS_EMOJI } from './emoji-match.js';

// High-contrast, kid-friendly palette. Picked to stay clearly distinct
// from one another at a glance and to read well with a white letter on
// top, so two tiles sitting side by side (e.g. two misses in one box)
// don't get confused for each other.
const PALETTE = [
  '#e4572e', // burnt orange
  '#2a6f97', // deep sky blue
  '#2a9d8f', // teal
  '#8338ec', // violet
  '#d62839', // red
  '#457b9d', // slate blue
  '#f3722c', // orange
  '#43aa8b', // sea green
  '#6a4c93', // purple
  '#c9184a', // pink-red
  '#277da1', // ocean blue
  '#9d4edd', // lavender
];

// Simple deterministic string hash (djb2) — same label always produces
// the same hash, both within a session and across reloads, which is what
// makes the tile colour "stable across sessions" per the spec.
function hashLabel(label) {
  let hash = 5381;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) + hash + label.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function normalizeLabel(label) {
  return String(label ?? '').trim().toLowerCase();
}

/**
 * Deterministic tile background colour for a given option label.
 *
 * @param {string} label - the option's typed text, e.g. "Excavator".
 * @returns {string} a hex colour from the high-contrast palette.
 */
export function tileColor(label) {
  const normalized = normalizeLabel(label);
  const hash = hashLabel(normalized);
  return PALETTE[hash % PALETTE.length];
}

/**
 * The single uppercase letter rendered inside the tile. Falls back to a
 * neutral bullet (never "?") in the pathological case of an empty label —
 * shouldn't be reachable given option-entry's non-empty enforcement, but
 * keeps this pure function total rather than throwing.
 *
 * @param {string} label
 * @returns {string}
 */
export function tileLetter(label) {
  const trimmed = String(label ?? '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '•';
}

/**
 * Single choke point the UI renders an option's icon through, so the raw
 * ❓ placeholder can never leak into the actual app — every call site
 * (setup chips, the reveal screen) goes through this instead of branching
 * on MISS_EMOJI itself.
 *
 * @param {string} emoji - matchEmoji()'s result for this option.
 * @param {string} label - the option's typed text (used for the tile).
 * @returns {{kind: 'emoji', value: string} | {kind: 'tile', color: string, letter: string}}
 */
export function resolveVisual(emoji, label) {
  if (emoji === MISS_EMOJI) {
    return { kind: 'tile', color: tileColor(label), letter: tileLetter(label) };
  }
  return { kind: 'emoji', value: emoji };
}
