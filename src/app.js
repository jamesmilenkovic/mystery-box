// Main app controller — wires the setup screen, kid mode, and the parent
// gate together. Not unit-tested (DOM-driven); verified manually per the
// spec's Testing section.

import { matchEmoji, searchEmoji } from './emoji-match.js';
import { parseOptions, isValidOptionCount, MIN_OPTIONS, MAX_OPTIONS } from './option-entry.js';
import { randomIndex } from './random.js';
import { getAudioContext, playTick, playPop, playTada, vibrate } from './audio.js';
import { burstConfetti } from './confetti.js';

const BOX_STORAGE_KEY = 'mysterybox:box';
const SOUND_STORAGE_KEY = 'mysterybox:sound';

const SUSPENSE_DURATION_MS = 2400;
const TICK_START_MS = 260;
const TICK_END_MS = 90;
const HOLD_TO_OPEN_MS = 1500;

// ---------- DOM refs ----------

const setupScreen = document.getElementById('setup-screen');
const chipList = document.getElementById('chip-list');
const optionInput = document.getElementById('option-input');
const countHint = document.getElementById('count-hint');
const soundToggle = document.getElementById('sound-toggle');
const goButton = document.getElementById('go-button');

const pickerSheet = document.getElementById('emoji-picker-sheet');
const pickerSearch = document.getElementById('emoji-search');
const pickerClose = document.getElementById('emoji-picker-close');
const pickerGrid = document.getElementById('emoji-suggestion-grid');

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

// ---------- State ----------

let aliases = {};
let dataset = {};
let chips = []; // [{label, emoji}] — the box being edited on the setup screen
let currentOptions = []; // the frozen list kid mode is spinning over
let soundOn = true;
let pickerIndex = -1;
let spinning = false;
let spun = false;

// ---------- Storage ----------

function loadBox() {
  try {
    const raw = localStorage.getItem(BOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.options)) {
      return parsed.options.filter((o) => o && typeof o.label === 'string' && typeof o.emoji === 'string');
    }
  } catch {
    // corrupt/unavailable storage — start fresh rather than crash setup
  }
  return [];
}

function persistBox() {
  try {
    localStorage.setItem(BOX_STORAGE_KEY, JSON.stringify({ options: chips }));
  } catch {
    // storage unavailable (e.g. private browsing quota) — fail silently,
    // in-memory state still works for this session
  }
}

function loadSoundSetting() {
  try {
    const v = localStorage.getItem(SOUND_STORAGE_KEY);
    return v === null ? true : v === 'on';
  } catch {
    return true;
  }
}

function persistSoundSetting() {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, soundOn ? 'on' : 'off');
  } catch {
    // ignore
  }
}

// ---------- Setup screen: chips ----------

function renderChips() {
  chipList.innerHTML = '';
  chips.forEach((chip, index) => {
    const el = document.createElement('span');
    el.className = 'chip';

    const emojiBtn = document.createElement('button');
    emojiBtn.type = 'button';
    emojiBtn.className = 'chip-emoji';
    emojiBtn.textContent = chip.emoji;
    emojiBtn.setAttribute('aria-label', `Fix emoji for ${chip.label}`);
    emojiBtn.addEventListener('click', () => openPicker(index));

    const labelEl = document.createElement('span');
    labelEl.className = 'chip-label';
    labelEl.textContent = chip.label;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'chip-remove';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${chip.label}`);
    removeBtn.addEventListener('click', () => removeChip(index));

    el.append(emojiBtn, labelEl, removeBtn);
    chipList.appendChild(el);
  });

  updateCountHint();
  updateGoButton();
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
    chips.push({ label, emoji });
  }
  renderChips();
  persistBox();
}

function removeChip(index) {
  chips.splice(index, 1);
  renderChips();
  persistBox();
}

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

soundToggle.addEventListener('change', () => {
  soundOn = soundToggle.checked;
  persistSoundSetting();
});

goButton.addEventListener('click', () => {
  if (!isValidOptionCount(chips.length)) return;
  persistBox();
  enterKidMode();
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

// ---------- Kid mode ----------

function enterKidMode() {
  currentOptions = chips.map((c) => ({ ...c }));
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

  const winnerIndex = randomIndex(currentOptions.length);
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

    if (soundOn) playTick(ctx);

    setTimeout(tick, interval);
  }

  tick();
}

function reveal(ctx, winnerIndex) {
  const winner = currentOptions[winnerIndex];

  mysteryBox.classList.remove('shaking');
  mysteryBox.hidden = true;
  revealEmoji.textContent = winner.emoji;
  revealLabel.textContent = winner.label;
  revealScreen.hidden = false;

  burstConfetti(confettiCanvas);
  if (soundOn) {
    playPop(ctx);
    setTimeout(() => playTada(ctx), 150);
  }
  vibrate([60, 40, 60, 40, 120]);

  spinning = false;
  spun = true; // one spin per decision — box stays inert until a parent re-spins
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

async function init() {
  await loadEmojiData();

  chips = loadBox();
  soundOn = loadSoundSetting();
  soundToggle.checked = soundOn;

  renderChips();
}

init();
