# Mystery Box

A kid decision-maker box. Static vanilla-JS PWA, no build step, zero
runtime dependencies.

## Running locally

Serve the folder with any static file server (module scripts need
`http(s)://`, not `file://`), e.g.:

```
npx serve .
```

## Tests

```
node --test "test/**/*.test.js"
```

## PWA notes

- **Offline / installed:** the app is precached in full by `sw.js`
  (hand-rolled, no Workbox) — after the first load it works with the
  network off, including "Add to Home Screen" on iOS.
- **Deploying an update:** bump `CACHE_NAME` in `sw.js`. That's what makes
  installed clients pick up the new version — without it, an old cache
  can serve stale files forever. The service worker uses `skipWaiting` +
  `clients.claim`, so updates apply silently on next launch, no "reload
  to update" prompt.
- **Home-screen apps are exempt from Safari's 7-day eviction.** Safari
  normally clears a site's cache/storage after 7 days of no visits, but
  that only applies to sites opened in the browser — once "Added to Home
  Screen", the app runs in its own standalone context and isn't subject
  to that eviction policy. The same exemption covers IndexedDB (where
  photo options are stored), not just the service worker cache.
- **Photos never touch the network or the precache.** They live in
  IndexedDB and render via `URL.createObjectURL()` object URLs, so adding
  photo options doesn't change what `sw.js` needs to precache.
