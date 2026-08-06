import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project's public accounts appear on two surfaces — the What's New modal and
// Settings → About Nodus. PayPal and Ko-fi were written into both by hand and
// drifted (Ko-fi reached the About card a release before the modal), so the three
// social accounts live in ONE table and this file checks both surfaces read it.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-social-'));
const bundle = path.join(outDir, 'socialLinks.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/socialLinks.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const { NODUS_SOCIAL_LINKS } = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

const read = (file) => readFile(path.join(repoRoot, file), 'utf8');
const modal = await read('src/components/WhatsNewModal.tsx');
const settings = await read('src/views/Settings.tsx');
const icons = await read('src/components/ui.tsx');
const styles = await read('src/index.css');
const english = await read('src/i18n.en.ts');

test('the table holds exactly the three accounts, with their real addresses', () => {
  assert.deepEqual(
    NODUS_SOCIAL_LINKS.map((link) => [link.id, link.url]),
    [
      ['reddit', 'https://www.reddit.com/r/NodusApp/'],
      ['youtube', 'https://www.youtube.com/@nodus_app'],
      ['x', 'https://x.com/try_Nodus'],
    ]
  );
  // Brand names are not translated, and shell:openExternal only follows http(s).
  for (const link of NODUS_SOCIAL_LINKS) {
    assert.match(link.url, /^https:\/\//, `${link.id} must be an https link`);
    assert.ok(link.label.trim(), `${link.id} needs a visible label`);
  }
});

test('every social glyph exists and is a filled brand mark', () => {
  for (const link of NODUS_SOCIAL_LINKS) {
    const entry = icons.match(new RegExp(`^  ${link.icon}: '(.*)',$`, 'm'));
    // Icon() renders nothing for an unknown name, so a typo would ship a button
    // with a label and no glyph rather than fail anywhere.
    assert.ok(entry, `icon "${link.icon}" is missing from ICON_PATHS`);
    // The <svg> is stroke-only; a brand path drawn with it renders as a hollow
    // outline nobody recognises, so each mark must override both attributes.
    assert.match(entry[1], /fill="currentColor"/, `${link.icon} must fill its path`);
    assert.match(entry[1], /stroke="none"/, `${link.icon} must drop the feather stroke`);
  }
  // The close button already owns `x`; a brand mark named `x` would silently
  // replace every ✕ in the app.
  assert.equal(NODUS_SOCIAL_LINKS.find((link) => link.id === 'x').icon, 'brandX');
  assert.match(icons, /^ {2}x: '<line/m, 'the close icon must keep the name `x`');
});

test('the What\'s New modal maps over the table instead of listing links again', () => {
  assert.match(modal, /import \{ NODUS_SOCIAL_LINKS \} from '@shared\/socialLinks';/);
  assert.match(modal, /data-testid="whats-new-social"/);
  assert.match(modal, /NODUS_SOCIAL_LINKS\.map\(\(link\) =>/);
  assert.match(modal, /data-testid=\{`whats-new-social-\$\{link\.id\}`\}/);
  assert.match(modal, /window\.nodus\.openExternal\(link\.url\)/);
  assert.match(modal, /<Icon name=\{link\.icon\}/);
  // The strip sits in the scrolling body, after the support aside, so the footer
  // keeps its three balanced columns.
  assert.ok(
    modal.indexOf('whats-new-paypal-support') < modal.indexOf('data-testid="whats-new-social"'),
    'the community strip belongs below the support aside'
  );
  for (const link of NODUS_SOCIAL_LINKS) {
    assert.doesNotMatch(modal, new RegExp(link.url.replace(/[/.]/g, '\\$&')), `${link.id}'s address must live only in the table`);
  }
});

test('About Nodus offers the same three accounts', () => {
  assert.match(settings, /import \{ NODUS_SOCIAL_LINKS \} from '@shared\/socialLinks';/);
  assert.match(settings, /data-testid="about-social"/);
  assert.match(settings, /data-testid=\{`about-social-\$\{link\.id\}`\}/);
  assert.match(settings, /window\.nodus\.openExternal\(link\.url\)/);
  for (const link of NODUS_SOCIAL_LINKS) {
    assert.doesNotMatch(settings, new RegExp(link.url.replace(/[/.]/g, '\\$&')), `${link.id}'s address must live only in the table`);
  }
  // Searching Settings for a network has to reach the card that holds it.
  for (const term of ['redes sociales', 'reddit', 'youtube', 'comunidad']) {
    assert.ok(
      settings.split('\n').some((line) => line.includes("visibleSettingsSection('about'") && line.includes(term)),
      `"${term}" must be a search keyword of the About section`
    );
  }
});

test('each account is told apart by its own brand colour, in both themes', () => {
  for (const link of NODUS_SOCIAL_LINKS) {
    assert.match(styles, new RegExp(`\\.whats-new-social-${link.id} \\{[^}]*background:`), `the modal button for ${link.id} has no colour`);
    assert.match(styles, new RegExp(`\\.btn-social-${link.id} \\{[\\s\\S]{0,120}?background:`), `the About button for ${link.id} has no colour`);
  }
  // X's black is a hole in a dark panel, so the dark theme lifts it and outlines it.
  assert.match(styles, /\.dark \.whats-new-social-x \{[^}]*box-shadow: inset/);
  assert.match(styles, /\.dark \.btn-social-x \{[\s\S]*?box-shadow: inset/);
});

test('a brand whose glyph spells its name does not print the name twice', () => {
  // The X mark IS the word "X", so "𝕏 X" is what a visible label buys you there.
  assert.equal(NODUS_SOCIAL_LINKS.find((link) => link.id === 'x').glyphIsWordmark, true);
  for (const [surface, name] of [[modal, 'the modal'], [settings, 'About Nodus']]) {
    assert.match(surface, /\{!link\.glyphIsWordmark && link\.label\}/, `${name} prints the label unconditionally`);
    // Dropping the text must not drop the name: it stays as the accessible one.
    assert.match(surface, /aria-label=\{link\.label\}/, `${name} leaves a glyph-only button unnamed`);
    assert.match(surface, /title=\{link\.label\}/, `${name} leaves a glyph-only button without a tooltip`);
  }
});

test('the community copy is translated, not left in Spanish', () => {
  // Only English is asserted here; test-i18n-coverage demands all seven tables.
  for (const key of [
    'COMUNIDAD',
    'Sigue a Nodus',
    'Cada versión, los tutoriales nuevos y las dudas de otras personas se comentan en los perfiles públicos del proyecto.',
    'El enlace se abrirá en tu navegador. Seguir el proyecto es opcional y la aplicación no envía nada a estas redes.',
  ]) {
    assert.ok(english.includes(`'${key}'`), `"${key}" has no English translation`);
    assert.ok(modal.includes(key) || settings.includes(key), `"${key}" is translated but never shown`);
  }
});
