// Precache-completeness test (spec workstream A, item 3): parses
// index.html + the JS module graph (+ manifest.webmanifest) for every
// local asset the app actually needs, and fails if sw.js's PRECACHE_URLS
// is missing any of them — the whole point being that "works with zero
// network" can't silently regress when a new file gets added later.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function read(relPath) {
  return readFileSync(path.join(root, relPath), 'utf8');
}

// Strips a leading "./" so "./index.html" and "index.html" compare equal
// — both are valid ways to write a same-directory relative path.
function normalize(relPath) {
  return relPath.replace(/^\.\//, '');
}

function extractPrecacheUrls() {
  const swSource = read('sw.js');
  const match = swSource.match(/const PRECACHE_URLS = (\[[\s\S]*?\]);/);
  assert.ok(match, 'sw.js must define a PRECACHE_URLS array the test can parse');
  const urls = JSON.parse(match[1]);
  return new Set(urls.map(normalize));
}

function extractIndexHtmlRefs() {
  const html = read('index.html');
  const refs = new Set();

  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.add(m[1]);

  return refs;
}

// Follows local relative `import ... from '...'` statements starting from
// src/app.js, returning every module file (relative to repo root) that's
// reachable in the module graph.
function walkModuleGraph(entryRelPath) {
  const visited = new Set();
  const queue = [entryRelPath];

  while (queue.length) {
    const relPath = queue.pop();
    if (visited.has(relPath)) continue;
    visited.add(relPath);

    const source = read(relPath);
    const dir = path.dirname(relPath);
    for (const m of source.matchAll(/import\s+[^'"]*from\s+['"](\.[^'"]+)['"]/g)) {
      const resolved = normalize(path.posix.join(dir, m[1]));
      queue.push(resolved);
    }
  }

  return visited;
}

// Local relative `fetch('...')` calls inside a module — this is how
// app.js loads the two emoji JSON assets, which never show up in the
// module graph or index.html itself.
function extractFetchCalls(relPath) {
  const source = read(relPath);
  const refs = new Set();
  for (const m of source.matchAll(/fetch\(\s*['"](?!https?:)([^'"]+)['"]\s*\)/g)) {
    refs.add(m[1]);
  }
  return refs;
}

function extractManifestIconRefs() {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  return (manifest.icons || []).map((icon) => icon.src);
}

describe('PWA precache completeness', () => {
  const precached = extractPrecacheUrls();

  test('every asset referenced by index.html (stylesheet, modules, manifest, icons) is precached', () => {
    const refs = extractIndexHtmlRefs();
    const missing = [...refs].map(normalize).filter((ref) => !precached.has(ref));
    assert.deepEqual(missing, [], `index.html references assets missing from sw.js PRECACHE_URLS: ${missing}`);
  });

  test('every module in the JS import graph (starting from src/app.js) is precached', () => {
    const modules = walkModuleGraph('src/app.js');
    const missing = [...modules].filter((mod) => !precached.has(normalize(mod)));
    assert.deepEqual(missing, [], `modules missing from sw.js PRECACHE_URLS: ${missing}`);
  });

  test('every local fetch() target across the module graph is precached (the emoji JSON assets)', () => {
    const modules = walkModuleGraph('src/app.js');
    const refs = new Set();
    for (const mod of modules) {
      for (const ref of extractFetchCalls(mod)) refs.add(ref);
    }
    assert.ok(refs.size > 0, 'expected at least one local fetch() call to be found (sanity check on the parser itself)');
    const missing = [...refs].map(normalize).filter((ref) => !precached.has(ref));
    assert.deepEqual(missing, [], `fetch() targets missing from sw.js PRECACHE_URLS: ${missing}`);
  });

  test('every icon listed in manifest.webmanifest is precached', () => {
    const refs = extractManifestIconRefs();
    assert.ok(refs.length > 0, 'expected the manifest to list at least one icon (sanity check on the parser itself)');
    const missing = refs.map(normalize).filter((ref) => !precached.has(ref));
    assert.deepEqual(missing, [], `manifest icons missing from sw.js PRECACHE_URLS: ${missing}`);
  });

  test('every precached URL actually exists on disk (catches typos the other direction)', () => {
    const missing = [...precached].filter((rel) => !existsSync(path.join(root, rel)));
    assert.deepEqual(missing, [], `sw.js PRECACHE_URLS lists files that don't exist: ${missing}`);
  });

  test('no path in PRECACHE_URLS is root-absolute (would break on a GitHub Pages subpath)', () => {
    const absolute = [...precached].filter((rel) => rel.startsWith('/'));
    assert.deepEqual(absolute, [], `PRECACHE_URLS must only contain relative paths: ${absolute}`);
  });
});
