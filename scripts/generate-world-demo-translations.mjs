import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const traverse = traverseModule.default;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = [
  'electron/db/worldbuildingDemoData.ts',
  'electron/db/worldbuildingDemoNarrative.ts',
];
const targetFile = path.join(repoRoot, 'shared/worldbuildingDemoTranslations.generated.ts');
const targetLanguages = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const googleLanguage = { en: 'en', fr: 'fr', de: 'de', pt: 'pt-PT', 'pt-BR': 'pt', it: 'it', tr: 'tr' };

const pairs = new Map();
const rawPropertyNames = new Set([
  'name',
  'birth',
  'death',
  'species',
  'gender',
  'pronouns',
]);

function literal(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((part) => part.value.cooked ?? part.value.raw).join('');
  }
  return null;
}

function add(es, en = null) {
  if (!es?.trim()) return;
  const previous = pairs.get(es);
  if (previous && en && previous !== en) {
    throw new Error(`Conflicting English source for ${JSON.stringify(es)}: ${JSON.stringify(previous)} / ${JSON.stringify(en)}`);
  }
  pairs.set(es, en ?? previous ?? null);
}

for (const relative of sourceFiles) {
  const source = await fs.readFile(path.join(repoRoot, relative), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  traverse(ast, {
    CallExpression(path) {
      const name = path.node.callee.type === 'Identifier' ? path.node.callee.name : '';
      if (name !== 'text' && name !== 'localized' && name !== 'demoText') return;
      const es = literal(path.node.arguments[0]);
      const en = literal(path.node.arguments[1]);
      if (es && en) add(es, en);
    },
    ConditionalExpression(path) {
      const test = path.get('test').toString();
      if (!test.includes("'es'") && !test.includes('"es"')) return;
      const es = literal(path.node.consequent);
      const en = literal(path.node.alternate);
      if (es && en) add(es, en);
    },
    ObjectProperty(path) {
      const key =
        path.node.key.type === 'Identifier'
          ? path.node.key.name
          : path.node.key.type === 'StringLiteral'
            ? path.node.key.value
            : '';
      if (!rawPropertyNames.has(key)) return;
      const value = literal(path.node.value);
      if (value && /[\p{L}]/u.test(value)) add(value);
    },
    StringLiteral(path) {
      if (/^(?:\d+ de [\p{L}]+, \d{3} D\.F\.|\d{3} D\.F\.|\d{3}–\d{3} D\.F\.)$/u.test(path.node.value)) {
        add(path.node.value);
      }
      const cast = path.findParent((parent) =>
        parent.isVariableDeclarator()
        && parent.node.id.type === 'Identifier'
        && parent.node.id.name === 'cast'
      );
      if (cast && /[\p{L}]/u.test(path.node.value)) add(path.node.value);
    },
  });
}

// Values kept as raw fields because the IDs and graph references use their source names.
// They still need a localized display value when inserted into the demo database.
[
  ['Regente Maelor Sarn', 'Regent Maelor Sarn'],
  ['Hermana Vesh', 'Sister Vesh'],
  ['Casa del Faro', 'Lighthouse House'],
  ['Barrio Hundido', 'Sunken District'],
  ['Archivo Sumergido', 'Sunken Archive'],
  ['Observatorio de Orla', 'Rim Observatory'],
  ['Puerta de Sal', 'Salt Gate'],
  ['Isla Nácar', 'Pearl Island'],
  ['Mar de Vidrio', 'Glass Sea'],
  ['Desierto de Ceniza', 'Ash Desert'],
  ['Consejo de Ceniza', 'Ash Council'],
  ['Guardia de Ceniza', 'Ash Guard'],
  ['Archivo de Bajamar', 'Low-Tide Archive'],
  ['Gremio de las Seis Velas', 'Guild of Six Sails'],
  ['Casa Venn', 'House Venn'],
  ['Casa Sarn', 'House Sarn'],
  ['Casa Mir', 'House Mir'],
  ['Pueblos de la Marea', 'Tide Peoples'],
  ['Habla de Marea', 'Tidecant'],
  ['Culto de la Primera Luz', 'Cult of the First Light'],
  ['Boros el Calderero', 'Boros the Tinker'],
  ['Año desconocido', 'Unknown year'],
  ['Previsto para 743 D.F.', 'Planned for 743 A.L.'],
].forEach(([es, en]) => add(es, en));

for (const source of [...pairs.keys()]) {
  for (const match of source.matchAll(/\[\[([^\]\n]+)\]\]/g)) add(match[1]);
}

const entries = [...pairs].map(([es, en], index) => ({ id: String(index), es, en }));
const translations = Object.fromEntries(entries.map((entry) => [entry.es, { es: entry.es, ...(entry.en ? { en: entry.en } : {}) }]));

function chunksFor(items, maxChars = 3600) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const item of items) {
    const next = item.es.length + 32;
    if (current.length && size + next > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += next;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function translateBatch(items, language, attempt = 1) {
  const protectedItems = items.map((item) => {
    const labels = [];
    const text = item.es.replace(/\[\[([^\]\n]+)\]\]/g, (_whole, label) => {
      const index = labels.push(label) - 1;
      return `⟦NODUSWIKI_${item.id}_${index}⟧`;
    });
    return { ...item, labels, text };
  });
  const source = protectedItems.map((item) => `⟦NODUS_${item.id}⟧\n${item.text}`).join('\n');
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'es');
  url.searchParams.set('tl', googleLanguage[language]);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', source);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
  const payload = await response.json();
  const output = payload[0].map((part) => part[0]).join('');
  const matches = [...output.matchAll(/⟦NODUS_(\d+)⟧\n?([\s\S]*?)(?=\n?⟦NODUS_\d+⟧|$)/g)];
  if (matches.length !== items.length) {
    if (attempt < 3) return translateBatch(items, language, attempt + 1);
    throw new Error(`Expected ${items.length} ${language} segments, received ${matches.length}`);
  }
  return Object.fromEntries(matches.map((match) => {
    const item = protectedItems.find((candidate) => candidate.id === match[1]);
    let translated = match[2].trim();
    for (let index = 0; index < (item?.labels.length ?? 0); index += 1) {
      translated = translated.replace(
        new RegExp(`⟦NODUSWIKI_${match[1]}_${index}⟧`, 'g'),
        `[[${item.labels[index]}]]`
      );
    }
    return [match[1], translated];
  }));
}

for (const language of targetLanguages) {
  const missing = entries.filter((entry) => !translations[entry.es][language]);
  if (!missing.length) continue;
  const chunks = chunksFor(missing);
  process.stdout.write(`${language}: ${missing.length} strings in ${chunks.length} batches\n`);
  for (let index = 0; index < chunks.length; index += 1) {
    const batch = chunks[index];
    const result = await translateBatch(batch, language);
    for (const entry of batch) translations[entry.es][language] = result[entry.id];
    process.stdout.write(`  ${index + 1}/${chunks.length}\r`);
  }
  process.stdout.write('\n');
}

// Whole-sentence translation can choose a different synonym for a linked title than the
// same title translated alone. Canonicalise every wiki label so the resolver can always
// turn it into a working nodus:// link.
for (const [source, values] of Object.entries(translations)) {
  const labels = [...source.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((match) => match[1]);
  if (!labels.length) continue;
  for (const language of targetLanguages) {
    // Authored English is already canonical and is also passed directly to
    // worldbuildingDemoText(). Rewriting it here would make seeded and relocalized
    // English diverge.
    if (language === 'en') continue;
    let index = 0;
    values[language] = values[language].replace(/\[\[([^\]\n]+)\]\]/g, () => {
      const sourceLabel = labels[index++];
      return `[[${translations[sourceLabel]?.[language] ?? sourceLabel}]]`;
    });
  }
}

const sorted = Object.fromEntries(
  Object.entries(translations)
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([source, values]) => [source, values])
);
const body = `/* Generated by scripts/generate-world-demo-translations.mjs. */\n` +
  `import type { AppLanguage } from './types';\n\n` +
  `export const WORLD_DEMO_TRANSLATIONS: Record<string, Record<AppLanguage, string>> = ${JSON.stringify(sorted, null, 2)};\n`;
await fs.writeFile(targetFile, body);
process.stdout.write(`Wrote ${Object.keys(sorted).length} complete demo translations to ${path.relative(repoRoot, targetFile)}\n`);
