// Style-level regression guard for SPEC.md workstream B4 (increment 3):
// "bring letter-tile reveal size in line with the emoji reveal" — an
// inc-2 cosmetic watch-item closed in this pass. There's no DOM here to
// measure rendered pixels against (same limitation as app.js itself —
// see its header comment), so per the spec's own testing note ("style-
// level assertion or documented manual check") this parses styles.css
// directly and asserts the tile's size is driven off the same vh figure
// as the emoji's font-size, the way pwa-precache.test.js parses sw.js.
// James verifies the actual on-screen result per the acceptance criteria.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, '..', 'styles.css'), 'utf8');

// Matches a bare selector's rule body — e.g. ruleBody('.reveal-emoji')
// must find *that* rule, not the more specific '.reveal-emoji.is-tile'
// one that immediately follows it in styles.css, hence the negative
// lookahead ruling out a selector continuing with another chained class.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}(?![.\\w-])\\s*\\{([^}]*)\\}`));
  assert.ok(match, `expected to find a "${selector}" rule in styles.css`);
  return match[1];
}

function vhValue(text) {
  const match = text.match(/(\d+(?:\.\d+)?)vh/);
  assert.ok(match, `expected a vh value in: ${text}`);
  return Number(match[1]);
}

describe('reveal size parity: letter-tile matches the emoji reveal (SPEC.md workstream B4)', () => {
  test('.reveal-emoji.is-tile is sized off the same vh figure as .reveal-emoji\'s font-size', () => {
    const emojiFontSize = vhValue(ruleBody('.reveal-emoji'));
    const tileWidth = ruleBody('.reveal-emoji.is-tile');
    assert.equal(vhValue(tileWidth), emojiFontSize, 'the tile\'s width/height cap should share the emoji reveal\'s vh basis, not a smaller one');
  });
});
