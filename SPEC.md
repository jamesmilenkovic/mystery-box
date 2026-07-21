# Increment 3 — Photo options (snap the actual things)

**Project:** Mystery Box · **Phase 1, slice 3**
**PRD:** `PRDs/2-in-progress/2026-07-17-mystery-box.md`
**Base:** `main` @ `789afc7` (inc-2 combined + iOS Safari long-press fix).
Repo-status 2026-07-18 shows `789afc7` local, **ahead 1 of origin** — push
before starting so Pages and origin match the base.
**Status:** Build-ready (scoped 2026-07-18)

## Goal

The canonical day-one case: three ice-cream tubs, one stalled kid. Skip
typing — **snap a photo per option**. Real objects in front of you are
faster to photograph than to name, and the camera is the one rich-image
source that works with zero network. Photo and emoji options mix freely in
one box; the reveal shows the actual thing, full-bleed.

Three workstreams, one loop pass. A is the risk surface (camera +
IndexedDB); B is rendering; C is the setup-screen layout fix the PRD
explicitly queued for this increment ("fix the layout approach once rather
than twice" — photo thumbnails make the occlusion worse).

---

## Workstream A — Capture + storage

1. **Capture:** 📷 button in the entry row → `<input type="file"
   accept="image/*" capture="environment">` (native iOS camera sheet;
   photo library reachable from the same control). No `getUserMedia`, no
   custom camera UI, no new permissions surface.
2. **Processing:** downscale to ≤1280 px long edge, JPEG ~0.8 quality,
   target ≲300 KB/photo. Respect EXIF orientation — `createImageBitmap`
   with `imageOrientation: 'from-image'` where supported, documented
   fallback where not. Pure geometry/decision logic in its own module so
   it's unit-testable.
3. **Storage:** new pure module `src/photo-store.js` — IndexedDB, single
   object store, `photoId → blob`. **Backend injected** so unit tests run
   against a hand-rolled in-memory stub (zero-npm-deps rule holds; no
   fake-indexeddb). localStorage keeps everything else, per inc-2's
   "don't foreclose IndexedDB" note.
4. **Option shape:** chip gains nullable `photoId`.
   `serializeBoxForStorage` whitelist extends `{label, emoji}` →
   `{label, emoji, photoId}` — one deliberate change; force/armed state
   stays structurally excluded (test against the real chip shape).
5. **Garbage collection:** removing a chip, Clear all, or replacing a
   photo deletes its blob; a startup sweep removes blobs unreferenced by
   the persisted box. Revoke object URLs when chips/reveals go away.
6. **Labels optional on photo chips** — the photo carries the meaning
   (pre-reader rule); a typed label is allowed and shown small.

## Workstream B — Setup + reveal rendering

1. **Photo chips:** thumbnail sits where the emoji sits. Tap thumbnail →
   small sheet: Retake / Choose from library / Remove photo (chip falls
   back to emoji/letter-tile from its label). ✕-remove and **long-press
   force-arm work identically on photo chips** (object-identity arming
   already survives; `789afc7`'s iOS long-press fix applies).
2. **Reveal:** extend the `resolveVisual()` choke point — photo →
   **full-bleed cover-fit image** (same confetti/ta-da), emoji → as now
   (~40vh), miss → letter tile. Suspense/reveal functions still take only
   an int — the forced/unforced structural identity from inc 2 must not
   be disturbed.
3. **Mixed boxes:** photo and text/emoji options freely mixed, 2–6 rule
   unchanged.
4. **While in this code:** bring letter-tile reveal size in line with the
   emoji reveal (inc-2 cosmetic watch-item — same code area, close it).

## Workstream C — Setup-screen layout fix (pulled from the PRD's queued UX pass)

1. **Keyboard occlusion (root cause already confirmed — see PRD "Future
   ideas", 2026-07-18):** GO is pinned to the bottom of a `100dvh` flex
   column via `margin-top: auto`, and iOS Safari's keyboard doesn't
   reflow the layout viewport — so GO ends up under the keyboard.
   Restructure: chip list becomes the scrollable region
   (`overflow-y: auto`), entry row + GO stay reachable with the keyboard
   up (sticky entry row and/or `visualViewport` handling — coder's call).
   Note the PRD's caveat: headless Chrome cannot reproduce a real iOS
   keyboard; James verifies on device.
2. **Explicit "Add" button** next to the text field — additive (comma/
   Return stays). Pulled in because the entry row is being reworked for
   📷 anyway. One-handed mobile entry is the point.

---

## Offline note (no SW changes expected)

Photos live in IndexedDB and render via object URLs — never fetched — so
`sw.js` and the precache list should be untouched apart from the
mandatory `CACHE_NAME` bump on deploy. Precache-completeness test stays
green with zero photo entries. README addition: home-screen install
exempts IndexedDB from Safari's 7-day eviction (same clause as the cache
note).

## Out of scope

Presets (inc 4), first-run parent hint (inc 4), AI images (inc 5), photo
cropping/editing/filters, multi-photo per option, "closed for now" state
(still queued, unscoped), any change to random/force semantics, Workbox.

## Testing (all `node --test`; inc-1/2 suites stay green — 113 incl. the 1 documented todo)

- **A:** photo-store CRUD + GC + startup sweep against the injected stub;
  downscale/orientation decision logic; serializer round-trip with
  `photoId` on the real chip shape, force state still unleakable.
- **B:** `resolveVisual` precedence photo → emoji → letter tile; ❓ still
  unreachable; letter-tile/emoji size parity (style-level assertion or
  documented manual check).
- **C:** entry via Add button === entry via comma/Return (same commit
  path, same dedupe/bounds).

## Acceptance (James, iPhone — one session; also covers the still-pending inc-1/2 phone acceptance if not yet done)

1. **Ice-cream test:** 3 photo options snapped into a box in well under a
   minute — faster than naming them. Typed boxes still ~15 s.
2. **Airplane mode:** full photo decision end-to-end offline; force-quit
   + relaunch → photos still there.
3. **Mixed box** (2 photos + 1 typed): both render correctly in setup and
   reveal.
4. **Force:** long-press arm a *photo* chip; forced reveal
   indistinguishable; auto-clears.
5. **Keyboard:** with the entry field focused and keyboard up, Add and GO
   both reachable without dismissing the keyboard.
6. Nonsense typed word → letter tile, now the same size as an emoji
   reveal.
