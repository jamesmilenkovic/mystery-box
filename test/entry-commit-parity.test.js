// SPEC.md workstream C2 / Testing item C: the explicit Add button is
// additive-only and must commit through the exact same path as typing a
// comma or pressing Return — no separate code path that dedupe/bounds
// behaviour could drift out of sync with.
//
// app.js is DOM-driven and not unit-tested directly (see its header
// comment), so this checks the source rather than executing the wiring —
// same trade-off pwa-precache.test.js makes. It doesn't prove the DOM
// events fire correctly, but it does fail loudly if either handler stops
// calling the shared commitInput({ all: true }) entry point.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const appSource = readFileSync(path.join(root, 'src/app.js'), 'utf8');

describe('setup screen: Add button / comma-Return commit parity', () => {
  test("the Add button's click handler commits via commitInput({ all: true })", () => {
    const match = appSource.match(
      /addButton\.addEventListener\(\s*'click',\s*\(\)\s*=>\s*commitInput\(\{\s*all:\s*true\s*\}\)\s*\);/
    );
    assert.ok(match, "expected addButton's click handler to call commitInput({ all: true })");
  });

  test('the Enter keydown handler commits via commitInput({ all: true }), same as the Add button', () => {
    const keydownBlock = appSource.match(
      /optionInput\.addEventListener\(\s*'keydown',\s*\(e\)\s*=>\s*\{[\s\S]*?\}\s*\);/
    );
    assert.ok(keydownBlock, "expected to find optionInput's keydown handler");
    assert.match(keydownBlock[0], /e\.key === 'Enter'/, 'expected the handler to branch on the Enter key');
    assert.match(
      keydownBlock[0],
      /commitInput\(\{\s*all:\s*true\s*\}\)/,
      'expected Enter to call commitInput({ all: true }), the same call the Add button makes'
    );
  });
});
