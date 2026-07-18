# Increment 2 (combined) — Offline PWA + Force mode + Emoji coverage

**Project:** Mystery Box · **Phase 1, slice 2** (merges former inc 2 +
inc 2.5 + a live-testing emoji fix — James's call, 2026-07-18)
**PRD:** `PRDs/2-in-progress/2026-07-17-mystery-box.md` (principle 5 as
revised 2026-07-18 binds workstream B)
**Base:** `main` @ `b65dee8`
**Status:** Build-ready (scoped 2026-07-18)

Three independent workstreams, one loop pass. A and B don't touch the same
files; C touches emoji-match only. Success = all three acceptance blocks
pass in one iPhone session.

---

## Workstream A — PWA + full offline

Core promise: works anywhere with zero network, installed like a real app.

1. **Manifest + icons:** `manifest.webmanifest` (standalone, portrait,
   theme colours, relative `start_url` — Pages subpath), icons 192/512 +
   maskable **+ `apple-touch-icon` 180×180** (iOS takes the home-screen icon
   from the link tag), iOS standalone meta tags.
2. **Service worker, hand-rolled (~50 lines, no Workbox):** precache the
   entire shell (html, all modules, css, both emoji JSONs, any assets);
   cache-first everything (zero dynamic requests exist); versioned cache
   name bumped per deploy; activate-cleanup; `skipWaiting`+`clients.claim`
   (silent updates); relative registration, feature-detected.
3. **Precache-completeness unit test:** parse index.html + module graph,
   fail if any referenced asset is missing from the list.
4. README notes: home-screen apps exempt from Safari 7-day eviction;
   deploy = bump cache version.

**Acceptance A (James, iPhone):** Add to Home Screen → airplane mode → full
decision end-to-end with sound → force-quit + relaunch, still works. Then
verify a later deploy actually updates (no stale-forever cache).

## Workstream B — Force mode (secret, parent-gated)

Per revised principle 5. One-shot covert force:

1. **Arm in setup:** long-press an option chip ~1.5 s toggles it armed; max
   one armed (arming another disarms the first); edit/remove disarms.
   Parent-subtle indicator only (hairline/faint corner dot — nothing a kid
   can point at). No regression to tap-to-fix / ✕ / Clear all.
2. **Forced spin:** winner substitution only — suspense/reveal path
   untouched, pixel- and timing-identical. Auto-clears the moment the
   reveal fires; next spin genuinely random.
3. **Guardrails (binding):** force state memory-only — never in the
   localStorage payload, never in future presets; `src/random.js` untouched
   on the unforced path; no probability weighting anywhere; no history of
   forced spins.

**Acceptance B (James):** arm one-handed in ~2 s; indicator invisible at kid
distance; forced vs real spin side-by-side indistinguishable; next spin
random.

## Workstream C — Emoji coverage (live-testing gaps: "mum", "red", "blue" → ❓)

1. **Index emoji names, not just keywords:** the vendored dataset maps
   keywords only, so 🔴 ("red_circle") never matches "red". Split names on
   `_`, add name words to the index (likely fixes all colours generically).
2. **Alias overlay expansion, ~105 → ~300 curated entries.** Must include:
   - **Family/people:** mum/mummy/mama 👩, dad/daddy 👨, nanna/nan/grandma
     👵, grandpa/pop/poppy 👴, brother 👦, sister 👧, baby 👶, friend 🧒
   - **Colours:** red 🔴, blue 🔵, green 🟢, yellow 🟡, purple 🟣, orange
     🟠, pink 🩷, black ⚫, white ⚪, brown 🟤 (word-only, e.g. "red" — a
     phrase like "red car" should still prefer 🚗-family matches)
   - **Car/seats:** front seat, back seat, window seat, middle 💺/🚗;
     left ⬅️, right ➡️
   - **Places/activities:** park, playground, beach, pool, library, movies,
     bike, scooter, swim, drawing, lego, books, trampoline…
   - Numbers 1–10 (1️⃣…🔟) and anything else sensible found while curating.
3. **Letter-tile fallback replaces ❓ entirely:** any residual miss renders
   a big coloured circle tile with the option's first letter — colour
   deterministic from the label (stable across sessions), high-contrast
   palette, so every option is always visually distinct for a pre-reader.
   Tap-to-fix picker unchanged on top.

**Acceptance C (James):** type "mum, red, blue" → three real visuals, zero
❓ anywhere in the app; a nonsense word gets a coloured letter tile.

---

## Out of scope

Photos/camera (inc 3), presets (inc 4), AI images, weighting of any kind,
multi-spin force, kid-mode force UI, Workbox, update prompts.

## Testing (all `node --test`, inc-1 suites stay green)

- A: precache-completeness (see above).
- B: forced-win 100% over many trials; auto-clear→uniform (loose bound);
  arm/disarm/re-arm; single-armed invariant; localStorage payload clean.
- C: name-word indexing ("red"→🔴, "blue"→🔵); alias set spot-checks (mum,
  nanna, front seat, left); phrase-vs-colour precedence ("red car" ≠ 🔴);
  letter-tile determinism (same label → same colour) + uniqueness of
  first-letter rendering; ❓ no longer reachable.

---

## Appendix — PRD principle 5, verbatim (revised 2026-07-18, binding on workstream B)

> **5. Honest box by default, with a parent trump card in the drawer.**
> *(Revised 2026-07-18 — James's call after live use: "sometimes I need to
> FORCE an outcome.")* Unforced spins are genuinely uniform random — no
> probability weighting, ever. But a parent can secretly arm a **one-shot
> force** before handing over: the box plays the normal reveal and lands on
> the chosen option. Non-negotiable guardrails: armed by an explicit hidden
> parent gesture only, indistinguishable reveal (identical timing/animation
> — no tell), auto-clears after one spin, never saved into presets. Known
> accepted risk: if the boys ever catch on, box authority is spent — use
> sparingly.

This is a binding contract, not a suggestion: no probability weighting
anywhere in the codebase, ever (forced or unforced); force state is
memory-only and must never appear in the localStorage payload or any future
preset; `src/random.js` stays untouched on the unforced path; the reveal
path (timing, animation, DOM structure) must be pixel- and
timing-identical whether the win was forced or genuinely random.
