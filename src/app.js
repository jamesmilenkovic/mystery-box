// Main app controller — wires the setup screen, kid mode, and the parent
// gate together. Not unit-tested (DOM-driven); verified manually per the
// spec's Testing section.

import { matchEmoji, searchEmoji } from './emoji-match.js';
import { parseOptions, isValidOptionCount, MIN_OPTIONS, MAX_OPTIONS } from './option-entry.js';
import { randomIndex } from './random.js';
import { getAudioContext, playTick, playPop, playTada, vibrate } from './audio.js';
import { burstConfetti } from './confetti.js';
import { resolveVisual } from './letter-tile.js';
import { toggleArm, disarmIfMatches, resolveWinnerIndex, serializeBoxForStorage } from './force-mode.js';
import { createPhotoStore } from './photo-store.js';
import { createIndexedDbBackend } from './indexeddb-backend.js';
import { processPhotoFile } from './photo-capture.js';

const BOX_STORAGE_KEY = 'mysterybox:box';

const SUSPENSE_DURATION_MS = 2400;
const TICK_START_MS = 260;
const TICK_END_MS = 90;
const HOLD_TO_OPEN_MS = 1500;
const CHIP_ARM_HOLD_MS = 1500;

// ---------- DOM refs ----------

const setupScreen = document.getElementById('setup-screen');
const chipList = document.getElementById('chip-list');
const optionInput = document.getElementById('option-input');
const addButton = document.getElementById('add-button');
const photoButton = document.getElementById('photo-button');
const photoCaptureInput = document.getElementById('photo-capture-input');
const photoLibraryInput = document.getElementById('photo-library-input');
const countHint = document.getElementById('count-hint');
const goButton = document.getElementById('go-button');
const clearButton = document.getElementById('clear-button');

const pickerSheet = document.getElementById('emoji-picker-sheet');
const pickerSearch = document.getElementById('emoji-search');
const pickerClose = document.getElementById('emoji-picker-close');
const pickerGrid = document.getElementById('emoji-suggestion-grid');

const photoSheet = document.getElementById('photo-sheet');
const photoRetake = document.getElementById('photo-retake');
const photoChoose = document.getElementById('photo-choose');
const photoRemove = document.getElementById('photo-remove');
const photoSheetClose = document.getElementById('photo-sheet-close');

const kidScreen = document.getElementById('kid-screen');
const mysteryBox = document.getElementById('mystery-box');
const revealScreen = document.getElementById('reveal-screen');
const revealEmoji = document.getElementById('reveal-emoji');
const revealLabel = document.getElementById('reveal-label');
const confettiCanvas = document.getElementById('confetti-canvas');
const parentDot = document.getElementById('parent-dot');

const parentSheet = document.getElementById('parent-sheet');
const parentRespin = document.getElementById('parent-respin');
const parentEdit = document.getElementById('parent-edit');
const parentDone = document.getElementById('parent-done');

// Real IndexedDB-backed photo storage — src/photo-store.js's CRUD/GC logic
// bound to the real browser backend (src/indexeddb-backend.js). Unit
// tests exercise the same logic against a hand-rolled in-memory stub
// instead of this real backend — see test/photo-store.test.js.
const photoStore = createPhotoStore(createIndexedDbBackend());

// ---------- State ----------

let aliases = {};
let dataset = {};
let chips = []; // [{label, emoji, photoId}] — the box being edited on the setup screen
let currentOptions = []; // the frozen list kid mode is spinning over
let pickerIndex = -1;
let photoSheetIndex = -1; // which chip index the open photo sheet is acting on, or -1
let photoReplaceIndex = -1; // which chip's photo is being replaced by the next file pick, or -1 for "new chip"
let spinning = false;
let spun = false;

// In-memory cache of photoId -> object URL, so a chip's photo blob is only
// read out of IndexedDB and turned into a URL once per session. Also the
// single place object URLs are revoked from (SPEC.md workstream A5) —
// every removal path below goes through revokePhotoUrl() before deleting
// the underlying blob.
const photoUrlCache = new Map();

// In-flight ensurePhotoUrl() reads, keyed by photoId. renderChips() has
// ~10 call sites and an IndexedDB read isn't instant, so it's routine for
// preloadChipPhoto() to re-enter for the same still-loading photoId before
// the first read resolves. Without this, each re-entry would start its own
// photoStore.get() + createObjectURL(), and the last one to finish would
// silently overwrite photoUrlCache's entry — orphaning every earlier
// object URL with nothing left to revoke it. Concurrent callers now share
// the one in-flight request instead.
const pendingPhotoUrls = new Map();

function revokePhotoUrl(photoId) {
  const url = photoUrlCache.get(photoId);
  if (url) {
    URL.revokeObjectURL(url);
    photoUrlCache.delete(photoId);
  }
  // A read already in flight for this photoId must not be allowed to
  // resurrect a URL after the photo's been deleted/replaced out from under
  // it. Dropping the pending entry here means ensurePhotoUrl's continuation
  // (below) sees it's been superseded once the read resolves, and abandons
  // the result instead of caching a URL for a photoId nothing references
  // any more.
  pendingPhotoUrls.delete(photoId);
}

// Resolves (from cache, or by reading the blob out of IndexedDB) the
// object URL for a chip's photo. Safe to call repeatedly — already-cached
// photoIds resolve immediately without touching the store again, and
// concurrent calls for the same not-yet-cached photoId share one read.
async function ensurePhotoUrl(photoId) {
  if (!photoId) return null;
  if (photoUrlCache.has(photoId)) return photoUrlCache.get(photoId);
  const pending = pendingPhotoUrls.get(photoId);
  if (pending) return pending;

  const request = photoStore.get(photoId).then(
    (blob) => {
      // Superseded by a revokePhotoUrl() (photo deleted/replaced) while
      // this read was in flight — don't touch the resolved cache.
      if (pendingPhotoUrls.get(photoId) !== request) return null;
      pendingPhotoUrls.delete(photoId);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      photoUrlCache.set(photoId, url);
      return url;
    },
    (err) => {
      // Don't leave a failed read permanently camped in the pending map —
      // let a later call retry instead of reusing this rejection forever.
      if (pendingPhotoUrls.get(photoId) === request) pendingPhotoUrls.delete(photoId);
      throw err;
    },
  );
  pendingPhotoUrls.set(photoId, request);
  return request;
}

// Fire-and-forget preload used by renderChips(): a chip whose photo isn't
// cached yet renders its emoji/tile fallback immediately, then swaps in
// the real thumbnail once the blob has loaded, via a re-render.
function preloadChipPhoto(photoId) {
  if (!photoId || photoUrlCache.has(photoId)) return;
  ensurePhotoUrl(photoId).then((url) => {
    if (url) renderChips();
  });
}

// Force mode (secret, parent-gated — PRD principle 5): a direct reference
// to the armed chip object, or null. Deliberately NOT a field on the chip
// itself and never written anywhere near persistBox()/serializeBoxForStorage,
// so it can never leak into the localStorage payload — see force-mode.js.
let armedChip = null;
// Snapshot of armedChip's index at the moment kid mode was entered (chips
// and currentOptions share the same order/length at that point). -1 means
// no force is in effect for this spin.
let forcedIndex = -1;

// ---------- Storage ----------

function loadBox() {
  try {
    const raw = localStorage.getItem(BOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.options)) {
      return parsed.options
        .filter((o) => o && typeof o.label === 'string' && typeof o.emoji === 'string')
        .map((o) => ({ label: o.label, emoji: o.emoji, photoId: typeof o.photoId === 'string' ? o.photoId : null }));
    }
  } catch {
    // corrupt/unavailable storage — start fresh rather than crash setup
  }
  return [];
}

function persistBox() {
  try {
    localStorage.setItem(BOX_STORAGE_KEY, JSON.stringify(serializeBoxForStorage(chips)));
  } catch {
    // storage unavailable (e.g. private browsing quota) — fail silently,
    // in-memory state still works for this session
  }
}

// ---------- Setup screen: chips ----------

function renderChips() {
  chipList.innerHTML = '';
  chips.forEach((chip, index) => {
    const el = document.createElement('span');
    el.className = 'chip';
    // Parent-subtle indicator only — a hairline corner dot styled in CSS,
    // nothing a kid could point at or ask about.
    el.classList.toggle('chip-armed', chip === armedChip);

    const emojiBtn = document.createElement('button');
    emojiBtn.type = 'button';
    emojiBtn.className = 'chip-emoji';
    const labelForAria = chip.label || 'this option';
    // Photo chips open the Retake/Choose/Remove sheet from the same
    // thumbnail slot the emoji "fix" button occupies for text chips
    // (SPEC.md workstream B1) — one tap target, branching on whether a
    // photo is attached.
    if (chip.photoId) {
      emojiBtn.setAttribute('aria-label', `Photo options for ${labelForAria}`);
      emojiBtn.addEventListener('click', () => openPhotoSheet(index));
      preloadChipPhoto(chip.photoId);
    } else {
      emojiBtn.setAttribute('aria-label', `Fix emoji for ${labelForAria}`);
      emojiBtn.addEventListener('click', () => openPicker(index));
    }
    applyVisual(emojiBtn, resolveVisual(chip.emoji, chip.label, photoUrlCache.get(chip.photoId)));

    const labelEl = document.createElement('span');
    labelEl.className = 'chip-label';
    labelEl.classList.toggle('chip-label-photo', !!chip.photoId);
    labelEl.textContent = chip.label;
    // Labels are optional on photo chips (workstream A6) — don't render
    // an empty label pill when there's nothing to show.
    labelEl.hidden = !chip.label;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'chip-remove';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${labelForAria}`);
    removeBtn.addEventListener('click', () => removeChip(index));

    el.append(emojiBtn, labelEl, removeBtn);
    attachChipHold(el, chip, emojiBtn, removeBtn);
    chipList.appendChild(el);
  });

  updateCountHint();
  updateGoButton();
  clearButton.hidden = chips.length === 0;
}

// Renders a resolveVisual() result (photo thumbnail, real emoji, or
// coloured letter tile) onto a target element — the single place chip
// rendering and reveal rendering both go through, so ❓ can never end up
// on screen.
function applyVisual(target, visual) {
  target.classList.toggle('is-tile', visual.kind === 'tile');
  target.classList.toggle('is-photo', visual.kind === 'photo');
  if (visual.kind === 'tile') {
    target.style.setProperty('--tile-color', visual.color);
    target.style.removeProperty('background-image');
    target.textContent = visual.letter;
  } else if (visual.kind === 'photo') {
    target.style.removeProperty('--tile-color');
    target.style.backgroundImage = `url("${visual.url}")`;
    target.textContent = '';
  } else {
    target.style.removeProperty('--tile-color');
    target.style.removeProperty('background-image');
    target.textContent = visual.value;
  }
}

// ---------- Setup screen: force-mode arming (long-press a chip) ----------

let chipHoldTimer = null;

function cancelChipHold() {
  if (chipHoldTimer) {
    clearTimeout(chipHoldTimer);
    chipHoldTimer = null;
  }
}

function attachChipHold(el, chip, emojiBtn, removeBtn) {
  el.addEventListener('pointerdown', (e) => {
    // Don't let a press that started on the emoji (tap-to-fix) or remove
    // (✕) buttons count as an arm gesture — no regression to either.
    if (e.target === emojiBtn || e.target === removeBtn) return;
    cancelChipHold();
    chipHoldTimer = setTimeout(() => {
      chipHoldTimer = null;
      armedChip = toggleArm(armedChip, chip);
      renderChips();
    }, CHIP_ARM_HOLD_MS);
  });
  el.addEventListener('pointerup', cancelChipHold);
  el.addEventListener('pointercancel', cancelChipHold);
  el.addEventListener('pointerleave', cancelChipHold);
}

function updateCountHint() {
  const n = chips.length;
  if (n < MIN_OPTIONS) {
    countHint.textContent = `Add at least ${MIN_OPTIONS} options (${n} so far)`;
  } else if (n >= MAX_OPTIONS) {
    countHint.textContent = `${n} of ${MAX_OPTIONS} max`;
  } else {
    countHint.textContent = `${n} options`;
  }
}

function updateGoButton() {
  goButton.disabled = !isValidOptionCount(chips.length);
}

function addOptionsFromText(text) {
  const labels = parseOptions(text);
  for (const label of labels) {
    if (chips.length >= MAX_OPTIONS) break;
    if (chips.some((c) => c.label.toLowerCase() === label.toLowerCase())) continue;
    const emoji = matchEmoji(label, aliases, dataset);
    chips.push({ label, emoji, photoId: null });
  }
  renderChips();
  persistBox();
}

// Deletes a chip's photo blob (if any) and revokes its cached object URL.
// The single place all three GC triggers in SPEC.md workstream A5 —
// removing a chip, Clear all, and replacing/removing a chip's photo —
// funnel through, so a blob is never deleted from only one of them.
function deleteChipPhoto(photoId) {
  if (!photoId) return;
  revokePhotoUrl(photoId);
  photoStore.remove(photoId).catch(() => {
    // best-effort GC — a failed delete just leaves an orphaned blob for
    // the next startup sweep to catch, it's not worth surfacing to the UI
  });
}

function removeChip(index) {
  const chip = chips[index];
  armedChip = disarmIfMatches(armedChip, chip);
  deleteChipPhoto(chip.photoId);
  chips.splice(index, 1);
  renderChips();
  persistBox();
}

function clearChips() {
  for (const chip of chips) deleteChipPhoto(chip.photoId);
  chips = [];
  armedChip = null;
  renderChips();
  persistBox();
}

// ---------- Setup screen: photo capture (📷 entry-row button + Retake/Choose) ----------

function openPhotoCaptureForNewChip() {
  if (chips.length >= MAX_OPTIONS) return; // mirrors addOptionsFromText's silent bounds check
  photoReplaceIndex = -1;
  photoCaptureInput.click();
}

async function addPhotoChip(blob) {
  if (chips.length >= MAX_OPTIONS) return;
  // Optional typed label (workstream A6) — whatever's currently in the
  // text field, same trim/collapse rule as typed options.
  const label = optionInput.value.trim().replace(/\s+/g, ' ');
  optionInput.value = '';
  const emoji = matchEmoji(label, aliases, dataset); // fallback if the photo is later removed
  const photoId = await photoStore.add(blob);
  chips.push({ label, emoji, photoId });
  renderChips();
  persistBox();
}

async function replaceChipPhoto(index, blob) {
  const chip = chips[index];
  if (!chip) return;
  // Replacing a photo counts as editing this chip — disarms it if it was
  // the armed one, same rule the emoji tap-to-fix picker follows.
  armedChip = disarmIfMatches(armedChip, chip);
  const oldPhotoId = chip.photoId;
  chip.photoId = await photoStore.add(blob);
  deleteChipPhoto(oldPhotoId);
  renderChips();
  persistBox();
}

async function removeChipPhoto(index) {
  const chip = chips[index];
  if (!chip || !chip.photoId) return;
  armedChip = disarmIfMatches(armedChip, chip);
  const oldPhotoId = chip.photoId;
  chip.photoId = null;
  deleteChipPhoto(oldPhotoId);
  renderChips();
  persistBox();
}

async function onPhotoFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file next time
  if (!file) return;

  // A decode/encode failure here (rare — e.g. a transient hiccup on the
  // very first capture of a session) must not leave photoReplaceIndex
  // stuck or throw an unhandled rejection out of this event handler; the
  // parent just sees nothing happen and taps 📷 again.
  try {
    const blob = await processPhotoFile(file);
    if (photoReplaceIndex >= 0) {
      await replaceChipPhoto(photoReplaceIndex, blob);
    } else {
      await addPhotoChip(blob);
    }
  } catch (err) {
    console.error('Photo capture failed:', err);
  } finally {
    photoReplaceIndex = -1;
  }
}

photoButton.addEventListener('click', openPhotoCaptureForNewChip);
photoCaptureInput.addEventListener('change', onPhotoFileChosen);
photoLibraryInput.addEventListener('change', onPhotoFileChosen);

function commitInput({ all }) {
  const raw = optionInput.value;
  if (all) {
    addOptionsFromText(raw);
    optionInput.value = '';
    return;
  }
  const lastComma = raw.lastIndexOf(',');
  if (lastComma === -1) return;
  addOptionsFromText(raw.slice(0, lastComma));
  optionInput.value = raw.slice(lastComma + 1);
}

optionInput.addEventListener('input', () => {
  if (optionInput.value.includes(',')) commitInput({ all: false });
});

optionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitInput({ all: true });
  }
});

// Explicit Add button (workstream C2) — additive only, goes through the
// exact same commitInput({ all: true }) call as pressing Return, so it
// shares dedupe/bounds behaviour with no separate code path to drift.
addButton.addEventListener('click', () => commitInput({ all: true }));

clearButton.addEventListener('click', clearChips);

goButton.addEventListener('click', async () => {
  if (!isValidOptionCount(chips.length)) return;
  persistBox();
  await enterKidMode();
});

// ---------- Tap-to-fix emoji picker ----------

function openPicker(index) {
  pickerIndex = index;
  pickerSearch.value = '';
  renderPickerResults('');
  pickerSheet.hidden = false;
  pickerSearch.focus();
}

function closePicker() {
  pickerSheet.hidden = true;
  pickerIndex = -1;
}

function renderPickerResults(query) {
  const results = searchEmoji(query, aliases, dataset, 30);
  pickerGrid.innerHTML = '';
  for (const { emoji, key } of results) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-emoji';
    btn.textContent = emoji;
    btn.setAttribute('aria-label', key);
    btn.addEventListener('click', () => {
      if (pickerIndex >= 0 && chips[pickerIndex]) {
        // Changing the emoji counts as editing this chip — disarms it if
        // it was the armed one, per the spec's "edit/remove disarms" rule.
        armedChip = disarmIfMatches(armedChip, chips[pickerIndex]);
        chips[pickerIndex].emoji = emoji;
        renderChips();
        persistBox();
      }
      closePicker();
    });
    pickerGrid.appendChild(btn);
  }
}

pickerSearch.addEventListener('input', () => renderPickerResults(pickerSearch.value));
pickerClose.addEventListener('click', closePicker);

// ---------- Tap-to-open photo sheet (Retake / Choose from library / Remove) ----------

function openPhotoSheet(index) {
  photoSheetIndex = index;
  photoSheet.hidden = false;
}

function closePhotoSheet() {
  photoSheet.hidden = true;
  photoSheetIndex = -1;
}

photoRetake.addEventListener('click', () => {
  const index = photoSheetIndex;
  closePhotoSheet();
  photoReplaceIndex = index;
  photoCaptureInput.click();
});

photoChoose.addEventListener('click', () => {
  const index = photoSheetIndex;
  closePhotoSheet();
  photoReplaceIndex = index;
  photoLibraryInput.click();
});

photoRemove.addEventListener('click', () => {
  const index = photoSheetIndex;
  closePhotoSheet();
  removeChipPhoto(index);
});

photoSheetClose.addEventListener('click', closePhotoSheet);

// ---------- Kid mode ----------

async function enterKidMode() {
  // Make sure every photo option's object URL is loaded before the kid
  // ever sees the box — the reveal must never be the first time a photo
  // is fetched from IndexedDB, or it could show a fallback tile for a
  // frame (or longer) instead of the actual photo.
  await Promise.all(chips.filter((c) => c.photoId).map((c) => ensurePhotoUrl(c.photoId)));

  currentOptions = chips.map((c) => ({ ...c }));
  // Snapshot which index is armed for this spin, if any. chips and
  // currentOptions share the same order/length right now, so the index
  // carries over safely — armedChip itself stays untouched (still needed
  // if the parent bails out to Edit before ever tapping the box).
  forcedIndex = armedChip ? chips.indexOf(armedChip) : -1;
  spun = false;
  spinning = false;
  resetBoxVisual();
  setupScreen.hidden = true;
  kidScreen.hidden = false;
}

function resetBoxVisual() {
  revealScreen.hidden = true;
  mysteryBox.hidden = false;
  mysteryBox.classList.remove('shaking');
  mysteryBox.style.removeProperty('--shake-interval');
  mysteryBox.style.removeProperty('--shake-scale');
}

mysteryBox.addEventListener('click', () => {
  if (spinning || spun) return;
  spinning = true;

  // Must create/resume the AudioContext synchronously inside this real
  // user-gesture handler — iOS Safari refuses to let audio play if it's
  // created later (e.g. after an await or a setTimeout callback).
  const ctx = getAudioContext();

  // Winner substitution only: a genuine random winner is always drawn
  // (random.js is never skipped or altered), and resolveWinnerIndex only
  // swaps in the armed index when one is set. Suspense/reveal below run
  // identically either way — no tell.
  const randomWinnerIndex = randomIndex(currentOptions.length);
  const winnerIndex = resolveWinnerIndex(forcedIndex, randomWinnerIndex);
  runSuspense(ctx, winnerIndex);
});

function runSuspense(ctx, winnerIndex) {
  mysteryBox.classList.add('shaking');
  const start = performance.now();

  function tick() {
    const elapsed = performance.now() - start;
    if (elapsed >= SUSPENSE_DURATION_MS) {
      reveal(ctx, winnerIndex);
      return;
    }

    const progress = elapsed / SUSPENSE_DURATION_MS;
    // Rising intensity: ticks speed up and the box grows slightly as the
    // suspense builds toward the burst.
    const interval = TICK_START_MS - (TICK_START_MS - TICK_END_MS) * progress;
    const scale = 1 + progress * 0.15;
    mysteryBox.style.setProperty('--shake-interval', `${interval}ms`);
    mysteryBox.style.setProperty('--shake-scale', scale.toFixed(3));

    playTick(ctx);

    setTimeout(tick, interval);
  }

  tick();
}

function reveal(ctx, winnerIndex) {
  const winner = currentOptions[winnerIndex];

  mysteryBox.classList.remove('shaking');
  mysteryBox.hidden = true;
  // photoUrlCache is guaranteed populated here — enterKidMode() awaits
  // every photo option's URL before the kid screen is ever shown.
  applyVisual(revealEmoji, resolveVisual(winner.emoji, winner.label, photoUrlCache.get(winner.photoId)));
  revealLabel.textContent = winner.label;
  revealScreen.hidden = false;

  burstConfetti(confettiCanvas);
  playPop(ctx);
  setTimeout(() => playTada(ctx), 150);
  vibrate([60, 40, 60, 40, 120]);

  spinning = false;
  spun = true; // one spin per decision — box stays inert until a parent re-spins

  // Auto-clear: the force (if any) is spent the instant this reveal
  // fires. The next spin — even a parent-triggered re-spin — is
  // genuinely random, and the setup screen's corner dot disappears next
  // time it's shown.
  forcedIndex = -1;
  armedChip = null;
}

// ---------- Parent gate ----------

let holdTimer = null;

function cancelHold() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

parentDot.addEventListener('pointerdown', () => {
  cancelHold();
  holdTimer = setTimeout(() => {
    holdTimer = null;
    openParentSheet();
  }, HOLD_TO_OPEN_MS);
});
parentDot.addEventListener('pointerup', cancelHold);
parentDot.addEventListener('pointercancel', cancelHold);
parentDot.addEventListener('pointerleave', cancelHold);

function openParentSheet() {
  parentSheet.hidden = false;
}

function closeParentSheet() {
  parentSheet.hidden = true;
}

parentRespin.addEventListener('click', () => {
  closeParentSheet();
  // Full fresh reset, no visible re-roll: jump straight back to a pristine
  // idle box. The kid only ever sees the idle box or a reveal, never a
  // transition between the two triggered by the parent.
  spun = false;
  spinning = false;
  resetBoxVisual();
});

parentEdit.addEventListener('click', () => {
  closeParentSheet();
  kidScreen.hidden = true;
  setupScreen.hidden = false;
  renderChips();
});

parentDone.addEventListener('click', () => {
  closeParentSheet();
});

// ---------- Boot ----------

async function loadEmojiData() {
  const [aliasResp, datasetResp] = await Promise.all([
    fetch('assets/emoji-aliases.json'),
    fetch('assets/emoji-dataset.json'),
  ]);
  aliases = await aliasResp.json();
  dataset = await datasetResp.json();
}

// Relative registration, feature-detected — 'sw.js' (no leading slash) so
// this resolves correctly under a GitHub Pages project subpath rather
// than assuming the app is served from the domain root.
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }
}

// Startup sweep (SPEC.md workstream A5): deletes any stored photo blob no
// longer referenced by the persisted box — the safety net for anything
// orphaned by a crash/force-quit between a blob write and the matching
// localStorage write (the explicit deletes in removeChip/clearChips/
// replaceChipPhoto/removeChipPhoto handle the normal-path cases).
async function sweepOrphanedPhotos() {
  const referencedIds = chips.filter((c) => c.photoId).map((c) => c.photoId);
  try {
    await photoStore.gc(referencedIds);
  } catch {
    // best-effort — a failed sweep just leaves orphans for next startup
  }
}

// Keyboard occlusion fix (SPEC.md workstream C1): iOS Safari's on-screen
// keyboard doesn't reflow the layout viewport (100dvh doesn't shrink for
// it), but window.visualViewport does report the visible area shrinking.
// Feature-detected — where supported, #setup-screen's height is kept in
// sync with the actual visible area, so the fixed entry-row/GO portion at
// its bottom is pushed up above the keyboard instead of ending up under
// it. Where unsupported, #setup-screen falls back to plain 100dvh (styles.css).
function setupKeyboardViewportFix() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    setupScreen.style.height = `${vv.height}px`;
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

async function init() {
  await loadEmojiData();

  chips = loadBox();

  renderChips();
  setupKeyboardViewportFix();
  registerServiceWorker();
  sweepOrphanedPhotos();
}

init();
