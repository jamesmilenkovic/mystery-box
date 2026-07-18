// Hand-rolled service worker (no Workbox, no third-party libraries).
// Precaches the entire app shell so it works with zero network once
// installed. Cache-first everywhere: this app makes no dynamic/network
// requests, so there's nothing to revalidate against.
//
// Deploy = bump CACHE_NAME. That's what forces old clients to fetch a
// fresh shell instead of running on a stale cache forever.
const CACHE_NAME = 'mystery-box-v1';

// Every path here is relative (no leading "/") since this app is served
// from a GitHub Pages project subpath, not domain root.
//
// PRECACHE_URLS must stay a strict JSON array of double-quoted strings —
// test/pwa-precache.test.js parses this literal directly to check
// nothing index.html/the module graph references is missing from it.
const PRECACHE_URLS = [
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "src/app.js",
  "src/audio.js",
  "src/confetti.js",
  "src/emoji-match.js",
  "src/force-mode.js",
  "src/letter-tile.js",
  "src/option-entry.js",
  "src/random.js",
  "assets/emoji-aliases.json",
  "assets/emoji-dataset.json",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-192.png",
  "assets/icons/icon-maskable-512.png",
  "assets/icons/apple-touch-icon.png"
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // silent updates — no "reload to update" prompt
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
