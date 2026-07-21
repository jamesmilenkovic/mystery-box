# Increment 4 — Presets + parent controls + polish

**Project:** Mystery Box · **Phase 1, slice 4 (last before the ⛩ family gate)**
**PRD:** `PRDs/2-in-progress/2026-07-17-mystery-box.md`
**Base:** `main` @ `dfa53bd` (inc-3 + field-feedback follow-up, CACHE_NAME v3)
**Status:** Build-ready (scoped 2026-07-21)

## Goal

Make the recurring decisions one-tap and make the parent controls
discoverable — then hand the app to the family for the two-week Phase 1
gate. Two PO decisions are baked in below (James's revise-on-review
defaults, 2026-07-21): **"Go again" ships as a visible hold-to-open
grown-ups button** (a kid-tappable re-roll would break principle 2 — the
box's word is final), and **the rounded-card photo reveal stays** (spec
wording updated; no restyle).

Three workstreams. A is the feature; B is the discoverability/product
decision; C is small hardening from inc-3's flagged leftovers.

---

## Workstream A — Presets (saved boxes)

1. **Save:** after any reveal (and from setup), offer "Keep this box?" →
   name it; icon auto-matched from the name via the existing emoji
   pipeline, tap-to-fix as anywhere else. Ad-hoc use stays exactly as
   fast as today — saving is optional, never a gate.
2. **Launch:** app opens to the preset list when presets exist (Breakfast,
   Car seats, …) + a prominent "New box" path. **One tap on a preset →
   kid mode, ready to spin.** No presets yet → straight to setup as now.
3. **Manage:** rename / change icon / delete behind the grown-up gate
   (workstream B's button). Cap at 12 presets — it's a decision maker,
   not a library.
4. **Storage:** preset metadata in localStorage via the existing
   whitelist serializer pattern — `{name, icon, options:[{label, emoji,
   photoId}]}`. **Force/armed state never serializes into a preset**
   (binding, PRD principle 5) — extend the existing serializer tests to
   the preset path.
5. **Photos in presets:** presets may reference photoIds. The startup GC
   sweep must now keep any blob referenced by *either* the current box
   or any preset; deleting a preset releases its otherwise-unreferenced
   photos through the existing `deleteChipPhoto()` choke point.

## Workstream B — Parent controls: visible gate, "Go again", closed state

1. **Replace the invisible corner dot** (kid mode + reveal screen) with a
   small **visible "grown-ups" button** that still requires the same
   ~1.5 s hold to open (quick taps do nothing — kids can see it but
   can't use it). Same sheet both places, extended: **Spin again** (full
   fresh reset, existing behaviour), **New box** (→ preset list/setup),
   **Close the box**, **Done**. This is the "Go again" answer from
   inc-3's field feedback — discoverable for adults (James couldn't find
   the hidden dot himself), still parent-only.
2. **Setup-screen force-arm long-press is untouched and stays secret** —
   the visible button is about the *parent sheet*, not the force. No new
   affordance goes anywhere near arming.
3. **"Closed for now" state** (pulled from the PRD's queue — trivial on
   top of the new sheet, and the family gate needs it): parent sheet →
   Close the box → kid mode shows a sleeping/closed box ("Closed for
   now", no idle-wobble invite, box not spinnable). Reopen via the same
   hold button. Manual toggle only — no scheduling. State survives
   relaunch (localStorage).
4. **First-run hint, one-time:** small dismissible tooltip pointing at
   the grown-ups button on first kid-mode entry ("Hold for grown-ups").
   Lighter than originally planned since the button is now visible.

## Workstream C — Polish + hardening (inc-3 leftovers, all small)

1. **`ensurePhotoUrl()` failure path:** catch at call sites → graceful
   fallback to emoji/letter-tile (reviewer's non-blocking flag; test with
   a failing stub backend).
2. **Photo-decode failure feedback:** minimal toast on the capture
   control ("Didn't work — try again") — deferred twice, now settled;
   no bigger error UI.
3. **`pendingPhotoUrls` race-dedup test** — QA's flagged coverage gap;
   automate what was verified only by code reading.
4. **Haptics pass:** `navigator.vibrate` check on suspense/reveal where
   supported (already silent no-op on iOS) — confirm nothing regressed
   when audio.js changed.
5. **Sound design pass (small):** tune existing synth rattle/ta-da only
   if James flags them at acceptance; no new sounds, no assets. Sound
   stays always-on (toggle removed in inc-3 follow-up; iOS mute-switch
   behaviour now uses `audioSession` playback category).

---

## Out of scope

AI images (inc 5, earned via the gate), theatre packs / per-kid theming
(inc 6), no-repeats memory / history / Atlas-self-serve (inc 7), preset
sync/export of any kind, scheduled/timed closed state, photo
cropping/editing, any change to force semantics or `src/random.js`.

## Testing (all `node --test`; 142-test baseline stays green, 1 pre-existing todo)

- **A:** preset CRUD round-trip on the real chip shape (incl. photoId);
  force state unleakable into presets; GC sweep keeps preset-referenced
  blobs, releases them on preset delete; 12-cap enforced.
- **B:** closed-state serialization + spin-blocked logic (pure parts);
  sheet actions routing (pure state machine if extracted); hold-gate
  timing logic unchanged from the existing dot implementation.
- **C:** ensurePhotoUrl fallback with failing backend; pendingPhotoUrls
  race dedup (concurrent calls share one read; delete-race safe).

## Acceptance (James + family, iPhone — this session opens the ⛩ two-week gate)

1. Save "Breakfast" (incl. one photo option) → force-quit → relaunch →
   **one tap → kid-ready**; total launch-to-spinnable under ~5 s.
2. "Keep this box?" after an ad-hoc decision works; declining leaves
   nothing behind.
3. Grown-ups button: you and Liz both find it unprompted; a quick tap
   does nothing; Rafi can't get through it. Force-arm still works and is
   still invisible.
4. Close the box → sleeping state; kids can't spin; survives relaunch;
   reopen via hold.
5. Photo decode failure (if reproducible) shows the toast and retry
   works first go.
6. Carry-over inc-3 checks still outstanding from your second pass:
   sound audible with mute switch on, photo capture reliable first try,
   ice-cream timing, airplane-mode round-trip, forced photo chip.
