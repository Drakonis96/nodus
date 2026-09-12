import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { APP_THEME_IDS, sanitizeCustomThemes } from '../shared/appThemes.mjs';
import { deriveThemeTokens, contrast, THEMES } from '../src/theme/themes.mjs';

test('custom theme definitions are normalized and isolated from built-ins', () => {
  const themes = sanitizeCustomThemes([
    { id: 'custom-paper', label: '  Paper  ', accent: '#D47752', deep: '#201817', pale: '#fff8f2', lightText: '#201817', darkText: '#fff8f2', tint: 0.08 },
    { id: 'custom-missing-text', label: 'Missing text', accent: '#D47752', deep: '#201817', pale: '#fff8f2', tint: 0.08 },
    { id: 'default', label: 'Override', accent: '#000000', deep: '#000000', pale: '#ffffff', tint: 0 },
    { id: 'bad id', label: 'Bad', accent: '#000000', deep: '#000000', pale: '#ffffff', tint: 0 },
  ]);
  assert.deepEqual(themes, [{
    id: 'custom-paper', label: 'Paper', accent: '#d47752', deep: '#201817', pale: '#fff8f2',
    lightText: '#201817', darkText: '#fff8f2', tint: 0.08,
  }]);
  assert.ok(APP_THEME_IDS.includes('default'));
});

test('every built-in theme declares both mode foregrounds', () => {
  assert.equal(THEMES.length, APP_THEME_IDS.length - 1);
  for (const theme of THEMES) {
    assert.match(theme.anchors.lightText, /^#[0-9a-f]{6}$/i);
    assert.match(theme.anchors.darkText, /^#[0-9a-f]{6}$/i);
  }
});

test('runtime derivation preserves contrast guarantees for a custom palette', () => {
  const tokens = deriveThemeTokens({
    id: 'custom-paper',
    label: 'Paper',
    anchors: {
      accent: '#d47752', deep: '#201817', pale: '#fff8f2',
      lightText: '#201817', darkText: '#fff8f2', tint: 0.08,
    },
  });
  assert.ok(contrast(tokens.a.light[300], '#ffffff') >= 4.5);
  assert.ok(contrast(tokens.a.dark[300], tokens.n[950]) >= 4.5);
  assert.ok(contrast(tokens.text.light, tokens.n[50]) >= 4.5);
  assert.ok(contrast(tokens.text.dark, tokens.n[950]) >= 4.5);
  assert.equal(tokens.n[50], '#fff8f2');
});

test('settings exposes mode before the palette editor', async () => {
  const source = await readFile(new URL('../src/views/Settings.tsx', import.meta.url), 'utf8');
  const mode = source.indexOf("label={t('Modo de color')}");
  const palette = source.indexOf("label={t('Tema')}");
  assert.ok(mode >= 0 && palette > mode);
  assert.match(source, /\+ \{t\('Crear tema'\)\}/);
  assert.match(source, /data-testid="theme-editor"/);
  assert.match(source, /className="btn btn-ghost h-8 border border-neutral-300 px-3 text-xs dark:border-neutral-700"/);
  assert.match(source, /bg-indigo-100 px-3 text-xs text-indigo-700.*dark:bg-indigo-600 dark:text-white/s);
  assert.match(source, /Texto en modo claro/);
  assert.match(source, /Texto en modo oscuro/);
});

test('runtime theme edge cases are guarded', async () => {
  const [settings, serverSettings, themeBoot, settingsRepo, profileTypes, tokens, utilities, indexCss] = await Promise.all([
    readFile(new URL('../src/views/Settings.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/serverWeb/settings/ServerSettingsView.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/theme/themeBoot.ts', import.meta.url), 'utf8'),
    readFile(new URL('../electron/db/settingsRepo.ts', import.meta.url), 'utf8'),
    readFile(new URL('../shared/serverProfilePreferences.d.mts', import.meta.url), 'utf8'),
    readFile(new URL('../src/theme/tokens.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/theme/runtime-utilities.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
  ]);
  assert.match(settings, /if \(!themeEditorOpen\) return;/);
  assert.match(settings, /const closeThemeEditor = \(\) =>/);
  assert.match(settings, /applyRuntimeAppTheme\(next\.appTheme, next\.customThemes/);
  assert.match(settings, /const selectTheme = \(id: string\) =>/);
  assert.match(settings, /void patch\(\{ appTheme: id, customThemes \}\)/);
  assert.match(indexCss, /input\[type='color'\][\s\S]*box-sizing: border-box/);
  assert.match(indexCss, /input\[type='color'\][\s\S]*border: 1px solid #111827/);
  assert.match(indexCss, /::-webkit-color-swatch[\s\S]*border-radius: 50%/);
  assert.match(indexCss, /::-moz-color-swatch[\s\S]*border-radius: 50%/);
  assert.match(await readFile(new URL('../src/serverWeb/settings/ServerSettings.css', import.meta.url), 'utf8'), /\.ss-theme-colours input\[type='color'\][^}]*border: 1px solid #111827/);
  assert.match(settings, /normalizeThemeColour\(theme\.lightText\) \?\? defaults\.lightText/);
  assert.match(serverSettings, /\): Promise<boolean> =>/);
  assert.match(serverSettings, /if \(!await saveProfile\(next\)\) return;/);
  assert.match(serverSettings, /onAppThemeChange\?\.\(saved\.appearance\.appTheme/);
  assert.match(serverSettings, /const normalizedDraft =/);
  assert.match(serverSettings, /normalizeThemeColour\(theme\.darkText\) \?\? defaults\.darkText/);
  assert.match(serverSettings, /aria-label=\{t\("Tintado de superficies"\)\}/);
  assert.match(await readFile(new URL('../src/serverWeb/App.tsx', import.meta.url), 'utf8'), /if \(!profile\) return;/);
  assert.match(themeBoot, /sanitizeCustomThemes\(parsed\)/);
  assert.match(themeBoot, /--theme-text-light/);
  assert.match(themeBoot, /--theme-text-dark/);
  assert.match(tokens, /--theme-border-light/);
  assert.match(tokens, /--theme-border-dark/);
  assert.match(utilities, /theme-text-light-muted/);
  assert.match(utilities, /theme-border-dark-strong/);
  assert.match(indexCss, /html\.theme-active\.dark \.home-dashboard/);
  assert.match(indexCss, /html\.theme-active\.light \.library-theme-panel/);
  assert.match(indexCss, /\[data-testid="theme-editor"\] input\[type='color'\][\s\S]*appearance: none/);
  assert.match(settingsRepo, /merged\.customThemes = sanitizeCustomThemes\(merged\.customThemes\)/);
  assert.match(profileTypes, /customThemes: CustomAppTheme\[\]/);
});
