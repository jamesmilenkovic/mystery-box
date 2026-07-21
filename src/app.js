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
import { createPhotoUrlResolver } from './photo-url-resolver.js';
import {
  buildPreset,
  serializePresetsForStorage,
  canAddPreset,
  addPreset,
  removePreset,
  renamePreset,
  updatePresetIcon,
  referencedPhotoIds,
  orphanedPhotoIdsOnDelete,
} from './presets.js';
import { parseClosedState, serializeClosedState, canSpin } from './closed-state.js';

const BOX_STORAGE_KEY = 'mysterybox:box';
const PRESETS_STORAGE_KEY = 'mysterybox:presets';
const CLOSED_STORAGE_KEY = 'mysterybox:closed';
const GROWNUPS_HINT_SEEN_KEY = 'mysterybox:grownups-hint-seen';

const SUSPENSE_DURATION_MS = 2400;
const TICK_START_MS = 260;
const TICK_END_MS = 90;
const HOLD_TO_OPEN_MS = 1500;
const CHIP_ARM_HOLD_MS = 1500;
const PHOTO_TOAST_DURATION_MS = 2200;

// ---------- DOM refs ----------

const presetScreen = document.getElementById('preset-screen');
const presetList = document.getElementById('preset-list');
const presetNewButton = document.getElementById('preset-new-button');
const presetGrownupsButton = document.getElementById('preset-grownups-button');

const managePresetsSheet = document.getElementById('manage-presets-sheet');
const managePresetsList = document.getElementById('manage-presets-list');
const managePresetsDone = document.getElementById('manage-presets-done');

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
const saveBoxButton = document.getElementById('save-box-button');
const photoToast = document.getElementById('photo-toast');

const pickerSheet = document.getElementById('emoji-picker-sheet');
const pickerSearch = document.getElementById('emoji-search');
const pickerClose = document.getElementById('emoji-picker-close');
const pickerGrid = document.getElementById('emoji-suggestion-grid');

const photoSheet = document.getElementById('photo-sheet');
const photoRetake = document.getElementById('photo-retake');
const photoChoose = document.getElementById('photo-choose');
const photoRemove = document.getElementById('photo-remove');
const photoSheetClose = document.getElementById('photo-sheet-close');

const savePresetSheet = document.getElementById('save-preset-sheet');
const presetIconButton = document.getElementById('preset-icon-button');
const presetNameInput = document.getElementById('preset-name-input');
const presetCapHint = document.getElementById('preset-cap-hint');
const presetSaveButton = document.getElementById('preset-save-button');
const presetSaveCancel = document.getElementById('preset-save-cancel');

const kidScreen = document.getElementById('kid-screen');
const mysteryBox = document.getElementById('mystery-box');
const boxClosedEl = document.getElementById('box-closed');
const revealScreen = document.getElementById('reveal-screen');
const revealEmoji = document.getElementById('reveal-emoji');
const revealLabel = document.getElementById('reveal-label');
const revealSaveButton = document.getElementById('reveal-save-button');
const confettiCanvas = document.getElementById('confetti-canvas');
const grownupsButton = document.getElementById('grownups-button');
const grownupsHint = document.getElementById('grownups-hint');
const grownupsHintClose = document.getElementById('grownups-hint-close');

const parentSheet = document.getElementById('parent-sheet');
const parentRespin = document.getElementById('parent-respin');
const parentNewBox = document.getElementById('parent-newbox');
const parentToggleClosed = document.getElementById('parent-toggle-closed');
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
let presets = []; // [{id, name, icon, options: [{label, emoji, photoId}]}] — saved boxes
let pickerContext = null; // { type: 'chip', index } | { type: 'preset-draft' } | { type: 'preset-icon', presetId }
let presetSaveSourceChips = []; // the chip list "Keep this box?" is currently offering to save
let presetDraftIcon = ''; // live-matched (or tap-to-fix overridden) icon for the save sheet
let presetIconManuallySet = false; // true once the parent tap-to-fixes the draft icon
let photoSheetIndex = -1; // which chip index the open photo sheet is acting on, or -1
let photoReplaceIndex = -1; // which chip's photo is being replaced by the next file pick, or -1 for "new chip"
let spinning = false;
let spun = false;
let boxClosed = false; // "Closed for now" parent toggle (SPEC.md workstream B3) — manual only, persisted

// Object-URL cache + in-flight-read dedup for chip photos, bound to the
// real photoStore + browser URL.createObjectURL/revokeObjectURL. The
// underlying logic lives in src/photo-url-resolver.js so it can be unit
// tested against a stub backend (SPEC.md increment 4, workstream C1/C3) —
// this is just the real wiring. Every photo-blob removal path funnels
// through photoUrlResolver.revoke() (called from deleteChipPhoto() below)
// before the underlying blob is deleted.
const photoUrlResolver = createPhotoUrlResolver({
  photoStore,
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
});

// Fire-and-forget preload used by renderChips(): a chip whose photo isn't
// cached yet renders its emoji/tile fallback immediately, then swaps in
// the real thumbnail once the blob has loaded, via a re-render. A failed
// read resolves to null (never throws — see photo-url-resolver.js), so a
// broken read just leaves the emoji/letter-tile fallback in place.
function preloadChipPhoto(photoId) {
  if (!photoId || photoUrlResolver.getCached(photoId)) return;
  photoUrlResolver.ensureUrl(photoId).then((url) => {
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

// Defensive parse mirroring loadBox() — a malformed/corrupt entry is
// dropped rather than crashing the preset list; each surviving preset is
// reshaped to the exact {id, name, icon, options: [{label, emoji,
// photoId}]} the app relies on elsewhere (SPEC.md workstream A4).
function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.options))
      .map((p) => ({
        id: p.id,
        name: p.name,
        icon: typeof p.icon === 'string' ? p.icon : '',
        options: p.options
          .filter((o) => o && typeof o.label === 'string' && typeof o.emoji === 'string')
          .map((o) => ({ label: o.label, emoji: o.emoji, photoId: typeof o.photoId === 'string' ? o.photoId : null })),
      }));
  } catch {
    return [];
  }
}

function persistPresets() {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(serializePresetsForStorage(presets)));
  } catch {
    // storage unavailable — fail silently, same as persistBox()
  }
}

function loadClosedState() {
  try {
    return parseClosedState(localStorage.getItem(CLOSED_STORAGE_KEY));
  } catch {
    return false;
  }
}

function persistClosedState() {
  try {
    localStorage.setItem(CLOSED_STORAGE_KEY, serializeClosedState(boxClosed));
  } catch {
    // storage unavailable — fail silently, same as persistBox()
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
      emojiBtn.addEventListener('click', () => openPicker({ type: 'chip', index }));
    }
    applyVisual(emojiBtn, resolveVisual(chip.emoji, chip.label, photoUrlResolver.getCached(chip.photoId)));

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
  // "Keep this box?" is offered from setup too (SPEC.md workstream A1) —
  // same enablement bound as GO, so there's always a valid box to save.
  // Purely additive: GO itself is untouched, so ad-hoc use stays exactly
  // as fast as before.
  saveBoxButton.hidden = !isValidOptionCount(chips.length);
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
// The single choke point every photo-blob-releasing path funnels through
// — removing a chip, Clear all, replacing/removing a chip's photo
// (SPEC.md workstream A5), and now also deleting a preset that was the
// photo's last remaining reference (workstream A5 extended, increment 4).
function deleteChipPhoto(photoId) {
  if (!photoId) return;
  photoUrlResolver.revoke(photoId);
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

// Minimal photo-decode-failure feedback (SPEC.md increment 4, workstream
// C2) — a small toast on the capture control, auto-hiding itself. No
// bigger error UI/component system.
let photoToastTimer = null;
function showPhotoToast() {
  photoToast.hidden = false;
  clearTimeout(photoToastTimer);
  photoToastTimer = setTimeout(() => {
    photoToast.hidden = true;
  }, PHOTO_TOAST_DURATION_MS);
}

async function onPhotoFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file next time
  if (!file) return;

  // A decode/encode failure here (rare — e.g. a transient hiccup on the
  // very first capture of a session) must not leave photoReplaceIndex
  // stuck or throw an unhandled rejection out of this event handler; the
  // parent just sees nothing happen and taps 📷 again — plus, since
  // increment 4, a brief toast confirming what happened so it doesn't
  // look like the tap did nothing at all.
  try {
    const blob = await processPhotoFile(file);
    if (photoReplaceIndex >= 0) {
      await replaceChipPhoto(photoReplaceIndex, blob);
    } else {
      await addPhotoChip(blob);
    }
  } catch (err) {
    console.error('Photo capture failed:', err);
    showPhotoToast();
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

// ---------- "Keep this box?" — save the current box as a preset ----------
//
// Offered from the setup screen (Save box) and after any reveal (Keep
// this box?) — SPEC.md workstream A1. Purely additive/optional: nothing
// about GO or the reveal itself waits on this, so ad-hoc (not-saving) use
// stays exactly as fast as before. Icon auto-matches from the typed name
// via the same emoji pipeline as everywhere else, tap-to-fix like a chip.

function renderPresetIconButton() {
  applyVisual(presetIconButton, resolveVisual(presetDraftIcon, presetNameInput.value));
}

function updatePresetSaveButtonState() {
  const hasName = presetNameInput.value.trim().length > 0;
  const roomForMore = canAddPreset(presets);
  presetCapHint.hidden = roomForMore;
  presetSaveButton.disabled = !hasName || !roomForMore;
}

function openSavePresetSheet(sourceChips) {
  // Whitelisted to exactly the shape a preset stores — mirrors
  // serializePresetOptions, and (same as that function) structurally
  // cannot carry force/armed state since only label/emoji/photoId are
  // ever read off each chip.
  presetSaveSourceChips = sourceChips.map((c) => ({ label: c.label, emoji: c.emoji, photoId: c.photoId ?? null }));
  presetNameInput.value = '';
  presetIconManuallySet = false;
  presetDraftIcon = matchEmoji('', aliases, dataset);
  renderPresetIconButton();
  updatePresetSaveButtonState();
  savePresetSheet.hidden = false;
  presetNameInput.focus();
}

function closeSavePresetSheet() {
  savePresetSheet.hidden = true;
}

saveBoxButton.addEventListener('click', () => openSavePresetSheet(chips));
revealSaveButton.addEventListener('click', () => openSavePresetSheet(currentOptions));

presetNameInput.addEventListener('input', () => {
  if (!presetIconManuallySet) {
    presetDraftIcon = matchEmoji(presetNameInput.value.trim(), aliases, dataset);
    renderPresetIconButton();
  }
  updatePresetSaveButtonState();
});

presetIconButton.addEventListener('click', () => openPicker({ type: 'preset-draft' }));

presetSaveButton.addEventListener('click', () => {
  const name = presetNameInput.value.trim().replace(/\s+/g, ' ');
  if (!name || !canAddPreset(presets)) return;
  const preset = buildPreset(name, presetDraftIcon, presetSaveSourceChips);
  presets = addPreset(presets, preset);
  persistPresets();
  closeSavePresetSheet();
});

// Declining leaves nothing behind — nothing was written to `presets` or
// localStorage until Save is tapped, so Cancel is a pure discard.
presetSaveCancel.addEventListener('click', closeSavePresetSheet);

// ---------- Tap-to-fix emoji picker ----------
//
// Shared by three call sites (SPEC.md increment 4 extends this beyond just
// chips): fixing a setup-screen chip's emoji, picking a preset's icon
// while saving it ("Keep this box?"), and changing an already-saved
// preset's icon from the manage sheet. pickerContext records which.

function openPicker(context) {
  pickerContext = context;
  pickerSearch.value = '';
  renderPickerResults('');
  pickerSheet.hidden = false;
  pickerSearch.focus();
}

function closePicker() {
  pickerSheet.hidden = true;
  pickerContext = null;
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
      applyPickedEmoji(emoji);
      closePicker();
    });
    pickerGrid.appendChild(btn);
  }
}

function applyPickedEmoji(emoji) {
  const context = pickerContext;
  if (!context) return;

  if (context.type === 'chip') {
    const chip = chips[context.index];
    if (!chip) return;
    // Changing the emoji counts as editing this chip — disarms it if it
    // was the armed one, per the spec's "edit/remove disarms" rule.
    armedChip = disarmIfMatches(armedChip, chip);
    chip.emoji = emoji;
    renderChips();
    persistBox();
  } else if (context.type === 'preset-draft') {
    presetDraftIcon = emoji;
    presetIconManuallySet = true;
    renderPresetIconButton();
  } else if (context.type === 'preset-icon') {
    presets = updatePresetIcon(presets, context.presetId, emoji);
    persistPresets();
    renderManagePresetsList();
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
  // frame (or longer) instead of the actual photo. A failed read resolves
  // to null rather than rejecting (SPEC.md workstream C1), so this never
  // throws — it just falls back to the emoji/letter-tile visual.
  await Promise.all(chips.filter((c) => c.photoId).map((c) => photoUrlResolver.ensureUrl(c.photoId)));

  currentOptions = chips.map((c) => ({ ...c }));
  // Snapshot which index is armed for this spin, if any. chips and
  // currentOptions share the same order/length right now, so the index
  // carries over safely — armedChip itself stays untouched (still needed
  // if the parent bails out to New box before ever tapping the box).
  forcedIndex = armedChip ? chips.indexOf(armedChip) : -1;
  spun = false;
  spinning = false;
  resetBoxVisual();
  presetScreen.hidden = true;
  setupScreen.hidden = true;
  kidScreen.hidden = false;
  maybeShowGrownupsHint();
}

function resetBoxVisual() {
  revealScreen.hidden = true;
  // "Closed for now" (SPEC.md workstream B3): the sleeping box replaces
  // mysteryBox entirely — no idle-wobble/invite animation, and the real
  // box element is hidden so it can't be tapped at all.
  boxClosedEl.hidden = !boxClosed;
  mysteryBox.hidden = boxClosed;
  mysteryBox.classList.remove('shaking');
  mysteryBox.style.removeProperty('--shake-interval');
  mysteryBox.style.removeProperty('--shake-scale');
}

mysteryBox.addEventListener('click', () => {
  if (!canSpin({ closed: boxClosed, spinning, spun })) return;
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
  // The resolver's cache is guaranteed populated here — enterKidMode()
  // awaits every photo option's URL before the kid screen is ever shown.
  applyVisual(revealEmoji, resolveVisual(winner.emoji, winner.label, photoUrlResolver.getCached(winner.photoId)));
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
//
// SPEC.md increment 4, workstream B1: the old invisible corner dot is
// replaced by a small VISIBLE "grown-ups" button — kids can see it but
// the same ~1.5s hold-to-open gate (unchanged timing) still keeps a quick
// tap a no-op. Two buttons share this exact gesture (kid mode's
// grownupsButton and the preset list's presetGrownupsButton), each
// opening a different sheet, so the hold logic is factored out once here
// rather than duplicated.

function attachHoldGate(el, onOpen) {
  let holdTimer = null;
  function cancelHold() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }
  el.addEventListener('pointerdown', () => {
    cancelHold();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      onOpen();
    }, HOLD_TO_OPEN_MS);
  });
  el.addEventListener('pointerup', cancelHold);
  el.addEventListener('pointercancel', cancelHold);
  el.addEventListener('pointerleave', cancelHold);
}

function openParentSheet() {
  dismissGrownupsHint(); // successfully finding + holding the button counts as "seen"
  parentToggleClosed.textContent = boxClosed ? 'Open the box' : 'Close the box';
  parentSheet.hidden = false;
}

function closeParentSheet() {
  parentSheet.hidden = true;
}

attachHoldGate(grownupsButton, openParentSheet);

parentRespin.addEventListener('click', () => {
  closeParentSheet();
  // Full fresh reset, no visible re-roll: jump straight back to a pristine
  // idle box. The kid only ever sees the idle box or a reveal, never a
  // transition between the two triggered by the parent.
  spun = false;
  spinning = false;
  resetBoxVisual();
});

// "New box" (SPEC.md workstream B1) — leaves kid mode for the same
// launch flow app boot uses (preset list if any presets exist, else
// setup). Deliberately does NOT clear `chips`: if there are no presets to
// choose from instead, this lands back on the setup screen with the
// current box still there to tweak, same as the old "Edit options" did.
parentNewBox.addEventListener('click', () => {
  closeParentSheet();
  kidScreen.hidden = true;
  showLaunchScreen();
});

// "Close the box" / "Open the box" (SPEC.md workstream B3) — manual-only
// toggle, persisted so it survives a relaunch. Full reset alongside the
// toggle, same spirit as Spin again, so a box closed mid-suspense doesn't
// leave a half-finished spin behind.
parentToggleClosed.addEventListener('click', () => {
  closeParentSheet();
  boxClosed = !boxClosed;
  persistClosedState();
  spun = false;
  spinning = false;
  resetBoxVisual();
});

parentDone.addEventListener('click', () => {
  closeParentSheet();
});

// ---------- First-run hint ("Hold for grown-ups") ----------
//
// SPEC.md workstream B4: shown once ever, on the first-ever kid-mode
// entry, then dismissed forever (persisted).

function maybeShowGrownupsHint() {
  let seen = false;
  try {
    seen = !!localStorage.getItem(GROWNUPS_HINT_SEEN_KEY);
  } catch {
    seen = false;
  }
  if (!seen) grownupsHint.hidden = false;
}

function dismissGrownupsHint() {
  if (grownupsHint.hidden) return;
  grownupsHint.hidden = true;
  try {
    localStorage.setItem(GROWNUPS_HINT_SEEN_KEY, '1');
  } catch {
    // storage unavailable — the hint just won't stay dismissed across a
    // relaunch in that case, same soft-fail as the rest of storage here
  }
}

grownupsHintClose.addEventListener('click', dismissGrownupsHint);

// ---------- Preset list (saved boxes) ----------
//
// SPEC.md workstream A2/A3: the app's launch screen once any presets
// exist, plus the manage sheet (rename/change icon/delete) behind its own
// grown-ups hold gate.

function renderPresetList() {
  presetList.innerHTML = '';
  for (const preset of presets) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset-card';

    const iconEl = document.createElement('span');
    iconEl.className = 'preset-card-icon';
    applyVisual(iconEl, resolveVisual(preset.icon, preset.name));

    const nameEl = document.createElement('span');
    nameEl.className = 'preset-card-name';
    nameEl.textContent = preset.name;

    card.append(iconEl, nameEl);
    card.addEventListener('click', () => enterPreset(preset));
    presetList.appendChild(card);
  }
}

// One tap on a preset -> straight into kid mode, ready to spin (SPEC.md
// acceptance criterion 1).
async function enterPreset(preset) {
  chips = preset.options.map((o) => ({ ...o }));
  armedChip = null; // presets never carry force state — explicit belt-and-braces reset
  persistBox();
  presetScreen.hidden = true;
  await enterKidMode();
}

presetNewButton.addEventListener('click', () => {
  chips = [];
  armedChip = null;
  persistBox();
  presetScreen.hidden = true;
  setupScreen.hidden = false;
  renderChips();
});

function openManagePresetsSheet() {
  renderManagePresetsList();
  managePresetsSheet.hidden = false;
}

function closeManagePresetsSheet() {
  managePresetsSheet.hidden = true;
}

attachHoldGate(presetGrownupsButton, openManagePresetsSheet);

function renderManagePresetsList() {
  managePresetsList.innerHTML = '';
  if (presets.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'count-hint';
    empty.textContent = 'No saved boxes yet.';
    managePresetsList.appendChild(empty);
    return;
  }

  for (const preset of presets) {
    const row = document.createElement('div');
    row.className = 'manage-preset-row';

    const iconBtn = document.createElement('button');
    iconBtn.type = 'button';
    iconBtn.className = 'chip-emoji preset-icon-button';
    iconBtn.setAttribute('aria-label', `Change icon for ${preset.name}`);
    applyVisual(iconBtn, resolveVisual(preset.icon, preset.name));
    iconBtn.addEventListener('click', () => openPicker({ type: 'preset-icon', presetId: preset.id }));

    const nameEl = document.createElement('span');
    nameEl.className = 'manage-preset-name';
    nameEl.textContent = preset.name;

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'manage-preset-action';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => renamePresetPrompt(preset));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'manage-preset-action manage-preset-delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deletePresetConfirmed(preset));

    row.append(iconBtn, nameEl, renameBtn, deleteBtn);
    managePresetsList.appendChild(row);
  }
}

function renamePresetPrompt(preset) {
  const next = window.prompt('Rename this box', preset.name);
  if (next === null) return; // cancelled
  const trimmed = next.trim().replace(/\s+/g, ' ');
  if (!trimmed) return;
  presets = renamePreset(presets, preset.id, trimmed);
  persistPresets();
  renderManagePresetsList();
}

// Deleting a preset releases any of its photos not still referenced by
// the current box or another remaining preset, via the same
// deleteChipPhoto() choke point every other photo removal path uses
// (SPEC.md workstream A5).
function deletePresetConfirmed(preset) {
  if (!window.confirm(`Delete "${preset.name}"? This can't be undone.`)) return;
  const remaining = removePreset(presets, preset.id);
  const orphaned = orphanedPhotoIdsOnDelete(preset, chips, remaining);
  for (const photoId of orphaned) deleteChipPhoto(photoId);
  presets = remaining;
  persistPresets();

  if (presets.length === 0) {
    // Nothing left to manage or launch into — fall back to setup rather
    // than showing an empty preset list.
    closeManagePresetsSheet();
    presetScreen.hidden = true;
    setupScreen.hidden = false;
    renderChips();
  } else {
    renderManagePresetsList();
    renderPresetList();
  }
}

managePresetsDone.addEventListener('click', () => {
  closeManagePresetsSheet();
  renderPresetList();
});

// The app's launch flow (SPEC.md workstream A2): the preset list when any
// presets exist (with a prominent New box path), otherwise straight to
// setup as before. Reused by "New box" in the kid-mode parent sheet too.
function showLaunchScreen() {
  if (presets.length > 0) {
    renderPresetList();
    presetScreen.hidden = false;
    setupScreen.hidden = true;
  } else {
    presetScreen.hidden = true;
    setupScreen.hidden = false;
  }
}

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

// Startup sweep (SPEC.md workstream A5, extended in increment 4): deletes
// any stored photo blob no longer referenced by EITHER the persisted
// current box OR any saved preset — the safety net for anything orphaned
// by a crash/force-quit between a blob write and the matching localStorage
// write (the explicit deletes in removeChip/clearChips/replaceChipPhoto/
// removeChipPhoto/deletePresetConfirmed handle the normal-path cases).
async function sweepOrphanedPhotos() {
  const referencedIds = [...chips.filter((c) => c.photoId).map((c) => c.photoId), ...referencedPhotoIds(presets)];
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
  presets = loadPresets();
  boxClosed = loadClosedState();

  renderChips();
  showLaunchScreen();
  setupKeyboardViewportFix();
  registerServiceWorker();
  sweepOrphanedPhotos();
}

init();
