# Increment 1 — Core loop (type options → box → reveal)

**Project:** Mystery Box · **Phase 1, slice 1 of 4**
**PRD:** `PRDs/2-in-progress/2026-07-17-mystery-box.md`
**Status:** Build-ready (scoped 2026-07-17)

## Goal

Prove the magic end-to-end: parent types 2–6 options in ~10 s, each gets a
big emoji automatically, kid presses the mystery box, suspense builds, box
bursts open, winner revealed like a prize. **Success = a real family decision
(breakfast / ice cream flavours) made on James's iPhone this week, and the
kid accepts the outcome.**

No photos, no presets, no PWA/offline yet. Just entry → box → reveal, on a
URL the phone can open.

## Stack (fixed for the project)

1. **Static single-page vanilla HTML/JS/CSS** (house style — same as
   metronome/drum-trainer). No framework, no build step; ES modules fine.
   Prefer zero npm runtime dependencies — hand-rolled canvas confetti over a
   library unless the loop argues otherwise.
2. **No backend, no secrets — public GitHub repo + GitHub Pages** from this
   increment, so the app is on a real HTTPS URL James's iPhone can open at
   breakfast. (PWA install/offline is increment 4; a URL is enough for now.)
3. **Phone-first:** iPhone Safari is the acceptance device; must also be
   usable on an iPad. Portrait-first layout, big touch targets.

## Build

### 1. Emoji auto-match (`src/emoji-match.js`, pure module, unit-tested)

- Vendored keyword→emoji dataset (derive once from emojilib or similar into a
  static JSON asset committed to the repo — no runtime fetch, no dependency).
- Curated **AU/kid alias overlay** (own JSON, checked first): avo toast, avo,
  milo, vegemite, weet-bix, babyccino, booster seat, duplo, paw patrol,
  bluey (→ 🐕), yoto, playground, scooter, ice cream flavours (mango 🥭,
  choc/chocolate 🍫, strawberry 🍓, vanilla 🍦, cookies and cream 🍪)… seed
  ~80–120 entries, easy to extend.
- Match order: alias exact → dataset exact → singularised ("eggs"→"egg") →
  word-boundary/substring → miss (❓ placeholder that invites tap-to-fix).
- **Tap-to-fix picker:** tapping any option's emoji opens a sheet with a
  search field over the same data + suggestion grid; picking replaces the
  emoji. Parent-facing, so text UI is fine here.

### 2. Setup screen (parent, target <15 s)

- One text input: type an option, comma or return commits it as a chip (big
  emoji + label). Tap chip's emoji to fix; tap ✕ to remove. 2–6 options
  enforced (GO disabled outside that).
- Sound toggle (default on) persisted to localStorage.
- Current box persisted to localStorage (survive an accidental refresh —
  this is NOT the presets feature; one slot, no naming, no list).
- Big **GO** → kid mode.

### 3. Kid mode + the reveal (the product)

- Full-screen: closed mystery box (drawn/SVG — original art, nothing
  Netflix), gentle idle wobble that invites the tap. Nothing else tappable.
- Kid taps box → **suspense sequence ~2–3 s**: shake with rising intensity,
  rattle ticks, slight grow → burst open: winner's emoji huge (~40vh), label
  under it, confetti burst, ta-da sound. Sequence is tap-triggered
  end-to-end (iOS audio unlock rides the same gesture — see Testing).
- Result stays on screen until a parent acts. **One spin per decision:** the
  box cannot be re-run from kid mode.
- **Grown-up gate:** small dim dot in a top corner; press-and-hold ~1.5 s
  opens the parent sheet: Re-spin (full fresh reset — kid never sees a
  visible re-roll, per PRD open Q1 leaning), Edit options, Done. Accidental
  kid taps on the dot do nothing.

### 4. Randomness

- Uniform pick via `crypto.getRandomValues` with proper rejection sampling
  (no modulo bias). No weighting of any kind — the honest box is a product
  rule, not a nice-to-have.

### 5. Audio + haptics

- Web Audio, synthesized (oscillator/noise) or tiny bundled assets: rattle
  ticks during suspense, ta-da + pop on reveal. All initiated from the kid's
  tap. Respect the mute toggle. `navigator.vibrate` on reveal where
  supported (Android/desktop — iOS Safari doesn't expose it; degrade
  silently).

## Out of scope (this increment)

Photos/camera (inc 2), saved presets (inc 3), PWA/service worker/offline +
home-screen install (inc 4), AI images, weighting, theatre packs, multi-kid
theming, remove-an-option-before-spin.

## Testing

- Unit tests (`node --test`): emoji-match (alias hit, exact, plural,
  substring, miss → ❓; AU aliases incl. "avo toast", "milo"); option-entry
  parsing (commas, returns, trims, dupes, 2–6 bounds); random picker
  (rejection sampling correctness; loose uniformity check over 10k draws,
  e.g. each of 3 options within 28–39%).
- Manual acceptance (James, on iPhone Safari via the Pages URL):
  1. Type "eggs, avo on toast, cereal" → three correct emoji, under 15 s.
  2. Kid mode: suspense feels exciting not slow; **sound plays from the
     kid's tap on iOS** (PRD open Q3 — verify explicitly).
  3. One-spin rule: no way back to a spin without the long-press.
  4. The real gate: run one genuine decision with one of the boys.
