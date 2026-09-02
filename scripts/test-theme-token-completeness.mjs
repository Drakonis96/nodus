import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, THEME_IDS, SHADES } from '../src/theme/themes.mjs';
import { APP_THEME_IDS } from '../shared/appThemes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokensCss = readFileSync(path.join(ROOT, 'src/theme/tokens.generated.css'), 'utf8');
const utilsCss = readFileSync(path.join(ROOT, 'src/theme/utilities.generated.css'), 'utf8');
const typesTs = readFileSync(path.join(ROOT, 'shared/types.ts'), 'utf8');

test('theme id lists agree across themes.mjs, appThemes.mjs and types.ts', () => {
  assert.deepEqual(APP_THEME_IDS, THEME_IDS, 'shared/appThemes.mjs APP_THEME_IDS drifted from src/theme/themes.mjs');
  for (const id of THEME_IDS) {
    assert.ok(typesTs.includes(`| '${id}'`), `AppTheme in shared/types.ts is missing '${id}'`);
  }
});

test('every non-default theme defines all 22 tokens', () => {
  for (const theme of THEMES) {
    for (const shade of SHADES) {
      assert.ok(theme.tokens.n[shade], `${theme.id} missing --n-${shade}`);
      assert.ok(theme.tokens.a.dark[shade], `${theme.id} missing dark --a-${shade}`);
      assert.ok(theme.tokens.a.light[shade], `${theme.id} missing light --a-${shade}`);
    }
    // Emitted into the stylesheet.
    assert.ok(tokensCss.includes(`html.theme-${theme.id} {`), `${theme.id} neutral block missing from tokens.generated.css`);
    assert.ok(tokensCss.includes(`html.theme-${theme.id}.dark {`), `${theme.id} dark accent block missing`);
    assert.ok(tokensCss.includes(`html.theme-${theme.id}.light {`), `${theme.id} light accent block missing`);
    // Neutral utilities are dark-scoped (light themes reuse the default surface system).
    assert.ok(utilsCss.includes(`html.theme-${theme.id}.dark .bg-neutral-950 {`), `${theme.id} has no generated neutral block`);
    assert.ok(utilsCss.includes(`html.theme-${theme.id}.dark .text-indigo-600 {`), `${theme.id} has no dark accent block`);
    assert.ok(utilsCss.includes(`html.theme-${theme.id}.light .text-indigo-600 {`), `${theme.id} has no light accent block`);
  }
});

test('default theme carries no generated rules', () => {
  assert.ok(!tokensCss.includes('html.theme-default'), 'default theme must not appear in tokens.generated.css');
  assert.ok(!utilsCss.includes('html.theme-default'), 'default theme must not appear in utilities.generated.css');
});

test('generated selectors always carry the html element prefix (specificity guard)', () => {
  for (const line of utilsCss.split('\n')) {
    if (!line.includes('{') || line.trim().startsWith('/*')) continue;
    assert.ok(/^html\.theme-/.test(line), `utility rule not prefixed with html.theme-: ${line}`);
  }
});
