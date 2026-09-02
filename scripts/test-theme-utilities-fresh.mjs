import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './gen-theme-utilities.mjs';

// The two theme stylesheets are generated from src/theme/themes.mjs and committed.
// If themes.mjs changes without re-running `npm run gen:theme`, the committed CSS
// drifts from the source of truth — this catches that.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { tokens, utils } = render();

test('tokens.generated.css is up to date', () => {
  const onDisk = readFileSync(path.join(ROOT, 'src/theme/tokens.generated.css'), 'utf8');
  assert.equal(onDisk, tokens, 'run `npm run gen:theme` and commit src/theme/tokens.generated.css');
});

test('utilities.generated.css is up to date', () => {
  const onDisk = readFileSync(path.join(ROOT, 'src/theme/utilities.generated.css'), 'utf8');
  assert.equal(onDisk, utils, 'run `npm run gen:theme` and commit src/theme/utilities.generated.css');
});
