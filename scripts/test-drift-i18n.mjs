// Nodus Drift: its copy, in every language Nodus ships, and what that copy is allowed to say.
//
// The general coverage test (test-i18n-coverage.mjs) already collects Drift's literal t()
// keys and its catalogue keys. This one is stricter about the catalogue: it loads the real
// module and checks every name, description and category in each of the eleven tables, that
// no two sounds share a name inside a language, and that nothing Drift says claims an effect
// on the listener.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadTs, repoRoot } from './drift-test-utils.mjs';

const { DRIFT_CATEGORIES } = loadTs('shared/drift.ts');
const { DRIFT_SOUNDS } = loadTs('shared/driftCatalog.ts');

const LANGUAGES = [
  ['en', 'src/i18n.en.ts', 'EN'], ['fr', 'src/i18n.fr.ts', 'FR'], ['de', 'src/i18n.de.ts', 'DE'],
  ['pt', 'src/i18n.pt.ts', 'PT'], ['pt-BR', 'src/i18n.pt-BR.ts', 'PT_BR'], ['it', 'src/i18n.it.ts', 'IT'],
  ['tr', 'src/i18n.tr.ts', 'TR'], ['zh-CN', 'src/i18n.zh-CN.ts', 'ZH_CN'], ['zh-TW', 'src/i18n.zh-TW.ts', 'ZH_TW'],
  ['ja', 'src/i18n.ja.ts', 'JA'], ['ko', 'src/i18n.ko.ts', 'KO'],
].map(([lang, file, name]) => ({ lang, table: loadTs(file)[name] }));
const EN = LANGUAGES[0].table;

/** Every Spanish key the catalogue and the categories hand to t(). */
const CATALOGUE_KEYS = [...new Set([
  ...DRIFT_CATEGORIES.map((category) => category.nameKey),
  ...DRIFT_SOUNDS.flatMap((sound) => [sound.nameKey, sound.descriptionKey]),
])];

const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');

test('all Drift interface actions, preset editor and icon labels are translated in every locale', () => {
  const files = ['src/views/ToolkitDriftView.tsx', 'src/components/drift/DriftSoundCard.tsx', 'src/components/drift/DriftMiniPlayer.tsx', 'src/components/drift/DriftPresets.tsx', 'src/components/drift/DriftSortMenu.tsx'];
  const sources = files.map(read).join('\n');
  const keys = new Set([...sources.matchAll(/\b(?:t|tx)\(\s*(['"])(.*?)\1/g)].map((match) => match[2]));
  for (const match of sources.matchAll(/label: '([^']+)'/g)) if (match[1] !== 'Nodus Drift') keys.add(match[1]);
  for (const { lang, table } of LANGUAGES) {
    for (const key of keys) {
      assert.ok(table[key]?.trim(), `${lang}: ${key}`);
      assert.deepEqual([...table[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `${lang}: placeholders in ${key}`);
    }
  }
});

test('every sound name, description and category has a translation in every language', () => {
  assert.ok(CATALOGUE_KEYS.length > 150, `${CATALOGUE_KEYS.length} keys collected`);
  for (const { lang, table } of LANGUAGES) {
    const missing = CATALOGUE_KEYS.filter((key) => typeof table[key] !== 'string' || !table[key].trim());
    assert.deepEqual(missing, [], `${lang} is missing Drift catalogue translations`);
  }
});

test('a translation is a translation: not the Spanish source left in place', () => {
  // Proper names and units (Delta 2 Hz, Binaural, Café, Restaurant...) may legitimately stay
  // as they are; a whole sentence may not. Count what would give a language away.
  // The one sentence that is genuinely the same in Spanish and Portuguese.
  const SAME_IN_PORTUGUESE = new Set(['Mugidos de vacas.']);
  for (const { lang, table } of LANGUAGES) {
    const sentences = CATALOGUE_KEYS.filter((key) => /[.]$/.test(key));
    const untranslated = sentences.filter((key) => table[key] === key && !(lang.startsWith('pt') && SAME_IN_PORTUGUESE.has(key)));
    assert.deepEqual(untranslated, [], `${lang}: descriptions left in Spanish`);
  }
});

test('within one language no two sounds share a name, so the grid never shows twins', () => {
  for (const { lang, table } of LANGUAGES) {
    const seen = new Map();
    const twins = [];
    for (const sound of DRIFT_SOUNDS) {
      const name = table[sound.nameKey];
      if (seen.has(name)) twins.push(`${sound.id} and ${seen.get(name)} are both "${name}"`);
      else seen.set(name, sound.id);
    }
    assert.deepEqual(twins, [], `${lang}: duplicated sound names`);
  }
  // and Spanish, the source language, follows the same rule
  const spanish = DRIFT_SOUNDS.map((sound) => sound.nameKey);
  assert.equal(new Set(spanish).size, spanish.length);
});

test('the placeholders of every parameterised Drift string survive translation', () => {
  const keys = [
    '{n} de {max} sonidos', '{n} sonidos no disponibles', '{n} sonidos en la mezcla', 'Quitar {name} de la mezcla', 'Volumen de {name}',
    'Reintentar {name}', 'Quitar {name} de favoritos', 'Añadir {name} a favoritos',
    'La mezcla admite como máximo {max} sonidos. Quita uno para añadir otro.',
  ];
  const names = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const { lang, table } of LANGUAGES) {
    for (const key of keys) {
      assert.ok(table[key], `${lang} translates ${key}`);
      assert.equal(names(table[key]), names(key), `${lang}: ${key}`);
    }
  }
  // and the views really use them with those variable names
  const sources = ['src/views/ToolkitDriftView.tsx', 'src/components/drift/DriftSoundCard.tsx', 'src/components/drift/DriftMiniPlayer.tsx'].map(read).join('\n');
  for (const key of keys) assert.ok(sources.includes(key), `${key} is used`);
});

test('the binaural help says what was asked, in Spanish and everywhere else', () => {
  const key = 'Usa auriculares estéreo para percibir la separación entre canales.';
  assert.ok(read('src/views/ToolkitDriftView.tsx').includes(key));
  for (const { lang, table } of LANGUAGES) assert.ok(table[key]?.trim(), `${lang} has the headphones note`);
  assert.match(EN[key], /stereo headphones/i);
});

test('the brand is not translated', () => {
  for (const { lang, table } of LANGUAGES) {
    for (const key of Object.keys(table).filter((k) => /Nodus Drift/.test(k))) {
      assert.match(table[key], /Nodus Drift/, `${lang}: "${key}" keeps the product name`);
    }
  }
  const view = read('src/views/ToolkitDriftView.tsx');
  assert.match(view, /<h1>Nodus Drift<\/h1>/);
  assert.match(read('src/navigation.ts'), /name: 'Nodus Drift'/);
});

// ── neutrality ─────────────────────────────────────────────────────────────

/** A claim about what the audio does to the listener. Physical descriptions are fine. */
const CLAIMS = [
  /sue[ñn]o profundo|deep sleep/i,
  /ansiedad|anxiety|insomni|depres|estr[eé]s|stress\b|dolor|\bpain\b|migra[ñn]/i,
  /inteligencia|intelligence|\bIQ\b|cognitiv|\bfocus\b|concentraci[oó]n|productiv/i,
  /\bcura(r|s|n)?\b|\bcure[sd]?\b|terapia|therap|tratamiento|\btreat(s|ment|ing)?\b|sanar|\bheal/i,
  /mejora(r|n|s)?\b|\bimprove[sd]?\b|potencia|boost|aumenta|enhance/i,
  /relaj|\brelax|calma|\bcalm\b|\bsooth|beneficios?|\bbenefit/i,
];

test('nothing Drift says promises a therapeutic or cognitive effect (Spanish and English)', () => {
  const strings = [];
  for (const sound of DRIFT_SOUNDS) {
    strings.push([sound.id, sound.nameKey], [sound.id, sound.descriptionKey], [sound.id, EN[sound.nameKey]], [sound.id, EN[sound.descriptionKey]]);
  }
  for (const category of DRIFT_CATEGORIES) strings.push([category.id, category.nameKey], [category.id, EN[category.nameKey]]);
  // the UI copy of the tool: every Spanish key in the new module, with its English text
  const module = read('src/i18n.drift.ts');
  const keys = [...new Set([...module.matchAll(/^ {2}\['((?:[^'\\\n]|\\.)*)'/gm)].map((match) => match[1].replace(/\\'/g, "'")))];
  for (const key of keys) strings.push(['ui', key], ['ui', EN[key]]);
  strings.push(['tool', read('src/navigation.ts').match(/name: 'Nodus Drift',\s*description: '([^']+)'/)?.[1]]);

  assert.ok(strings.length > 300);
  const offences = [];
  for (const [where, text] of strings) {
    if (typeof text !== 'string') continue;
    for (const claim of CLAIMS) if (claim.test(text)) offences.push(`${where}: ${JSON.stringify(text)} matches ${claim}`);
  }
  assert.deepEqual(offences, []);
});

test('the guard itself can fail: it flags the copy it exists to keep out', () => {
  for (const claim of ['Mejora tu memoria mientras duermes', 'Improves focus and concentration', 'Ayuda a tratar la ansiedad', 'Sueño profundo garantizado', 'Boosts intelligence']) {
    assert.ok(CLAIMS.some((pattern) => pattern.test(claim)), claim);
  }
  for (const fine of ['Tonos binaurales con 10 Hz de diferencia entre los oídos.', 'Ruido con más energía en las frecuencias graves.', 'Combina sonidos ambiente para acompañar la lectura, el estudio y el descanso, sin conexión.']) {
    assert.ok(!CLAIMS.some((pattern) => pattern.test(fine)), fine);
  }
});
