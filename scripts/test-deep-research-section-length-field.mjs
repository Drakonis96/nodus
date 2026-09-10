// Render the "Extensión orientativa de cada sección" control. Actually render it.
//
// One component serves four composers (Deep Research for academic/study/teaching/
// genealogy vaults, Database Deep Research, and its Server Web twin), so a broken
// prop or a missing translation would ship to all of them at once. The component is
// bundled and rendered through react-dom/server: no browser, no DOM, no Electron.
// Interaction — choosing Custom and typing an invalid value — is exercised against a
// real browser by scripts/e2e-deep-research-section-length.mjs.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-section-length-field-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

const outfile = path.join(tmp, 'field.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'visual-tests/deep-research-section-length-entry.tsx')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  alias: { '@shared': path.join(repoRoot, 'shared') },
  loader: { '.css': 'empty' },
  logLevel: 'silent',
});
const { renderSectionLengthField } = await import(pathToFileURL(outfile).href);

/** The option values a <select> offers, in order. */
function optionValues(html) {
  const select = html.match(/<select[^>]*data-testid="deep-research-section-length"[\s\S]*?<\/select>/u)?.[0] ?? '';
  return [...select.matchAll(/<option[^>]*value="([^"]*)"/gu)].map((match) => match[1]);
}

function optionLabels(html) {
  const select = html.match(/<select[^>]*data-testid="deep-research-section-length"[\s\S]*?<\/select>/u)?.[0] ?? '';
  return [...select.matchAll(/<option[^>]*>([^<]*)<\/option>/gu)].map((match) => match[1]);
}

test('the dropdown offers Auto, the five presets and Custom, in that order', () => {
  const html = renderSectionLengthField('auto');
  assert.deepEqual(
    optionValues(html),
    ['auto', '2500', '5000', '10000', '15000', '20000', 'custom'],
    'the requested option list',
  );
  assert.match(html, /data-testid="deep-research-section-length"/u);
});

/** react-dom/server marks the chosen row with `selected=""` on its <option>. */
function selectedValue(html) {
  const select = html.match(/<select[^>]*data-testid="deep-research-section-length"[\s\S]*?<\/select>/u)[0];
  return select.match(/<option value="([^"]*)" selected="">/u)?.[1] ?? null;
}

test('Auto is the default and hides the number field', () => {
  const html = renderSectionLengthField();
  assert.equal(selectedValue(html), 'auto', 'Auto is preselected');
  assert.doesNotMatch(html, /deep-research-section-length-custom/u, 'no number field until Custom is chosen');
  assert.doesNotMatch(html, /deep-research-section-length-error/u, 'and no error is shown by default');
});

test('a preset reopens on its own row without the number field', () => {
  const html = renderSectionLengthField(10_000);
  assert.equal(selectedValue(html), '10000');
  assert.doesNotMatch(html, /deep-research-section-length-custom/u);
});

test('a non-preset value reopens Custom with the number field showing that value', () => {
  const html = renderSectionLengthField(7_300);
  assert.equal(selectedValue(html), 'custom', 'the Custom row is selected');
  assert.match(html, /data-testid="deep-research-section-length-custom"/u, 'the number field is revealed');
  assert.match(html, /type="number"/u, 'and it is a numeric input');
  assert.match(html, /value="7300"/u, 'prefilled with the stored word count');
});

test('the number field is bounded and accessible', () => {
  const html = renderSectionLengthField(7_300);
  const input = html.match(/<input[^>]*data-testid="deep-research-section-length-custom"[^>]*>/u)[0];
  assert.match(input, /min="250"/u, 'the minimum is enforced by the control itself');
  assert.match(input, /max="40000"/u, 'and so is the maximum');
  assert.match(input, /aria-label="[^"]+"/u, 'the number field is named for screen readers');
  assert.match(input, /aria-describedby="[^"]+"/u, 'and points at its help text');
  assert.match(html, /data-testid="deep-research-section-length-help"/u, 'the help text explains words-per-section');
});

test('the help text says words per section, not tokens and not the whole report', () => {
  const html = renderSectionLengthField('auto', 'en');
  const help = html.match(/data-testid="deep-research-section-length-help"[^>]*>([^<]*)</u)[1];
  assert.match(help, /per section/iu);
  assert.match(help, /not for the whole report/iu);
  assert.doesNotMatch(help, /token/iu);
});

test('every supported locale renders the control in its own language', () => {
  const expected = {
    es: ['Extensión orientativa de cada sección', 'Auto (decide la IA)', 'Personalizada'],
    en: ['Guideline length of each section', 'Auto (AI decides)', 'Custom'],
    fr: ['Longueur indicative de chaque section', 'Auto (l’IA décide)', 'Personnalisée'],
    de: ['Richtwert für die Länge jedes Abschnitts', 'Auto (KI entscheidet)', 'Benutzerdefiniert'],
    pt: ['Extensão orientativa de cada secção', 'Auto (a IA decide)', 'Personalizada'],
    'pt-BR': ['Extensão orientativa de cada seção', 'Auto (a IA decide)', 'Personalizada'],
    it: ['Lunghezza indicativa di ogni sezione', 'Auto (decide l’AI)', 'Personalizzata'],
    tr: ['Her bölüm için yol gösterici uzunluk', 'Otomatik (yapay zekâ karar verir)', 'Özel'],
  };
  for (const [language, [label, auto, custom]] of Object.entries(expected)) {
    const html = renderSectionLengthField('auto', language);
    // renderToStaticMarkup escapes the typographic apostrophes the copy uses.
    const decoded = html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    assert.ok(decoded.includes(label), `${language}: the field label is not localized`);
    const labels = optionLabels(decoded);
    assert.ok(labels.includes(auto), `${language}: "Auto" is not localized (got ${labels.join(' | ')})`);
    assert.ok(labels.includes(custom), `${language}: "Custom" is not localized (got ${labels.join(' | ')})`);
    assert.ok(
      labels.some((entry) => /2[.,\s]?500/u.test(entry)),
      `${language}: the 2.500 preset is not rendered in local number formatting`,
    );
  }
});

test('no locale leaves the control showing Spanish source copy', () => {
  for (const language of ['en', 'fr', 'de', 'tr']) {
    const html = renderSectionLengthField(7_300, language);
    assert.doesNotMatch(html, /Extensión orientativa de cada sección/u, `${language} falls back to Spanish`);
    assert.doesNotMatch(html, /Palabras por sección/u, `${language} falls back to Spanish`);
  }
});
