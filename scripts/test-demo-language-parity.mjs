import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

// The study and prosopography demo vaults used to be seeded from Spanish literals, so
// their seeded course and study were Spanish in every interface language. They now go
// through `studyDemoText()` / `prosopDemoText()` with a catalogue keyed by the Spanish
// source. This pins the catalogue as TOTAL over the interface languages: a new demo
// string with only `es`/`en` would silently show English to a French or Chinese reader.

const traverse = traverseModule.default;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGUAGES = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja'];

function catalogueEntries(file, exportName) {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const entries = new Map();
  traverse(ast, {
    VariableDeclarator(nodePath) {
      if (nodePath.node.id.name !== exportName) return;
      for (const property of nodePath.node.init.properties) {
        const values = {};
        for (const entry of property.value.properties) {
          const key = entry.key.name ?? entry.key.value;
          values[key] = entry.value.value;
        }
        entries.set(property.key.value, values);
      }
    },
  });
  return entries;
}

const CATALOGUES = [
  { label: 'study', file: 'electron/db/studyDemoI18n.ts', exportName: 'STUDY_DEMO_TEXT', accessor: 'studyDemoText', seeder: 'electron/db/studyDemoData.ts' },
  { label: 'prosopography', file: 'electron/db/prosopDemoI18n.ts', exportName: 'PROSOP_DEMO_TEXT', accessor: 'prosopDemoText', seeder: 'electron/db/prosopDemoRepo.ts' },
];

for (const { label, file, exportName, accessor, seeder } of CATALOGUES) {
  test(`the ${label} demo copy covers every interface language`, () => {
    const entries = catalogueEntries(file, exportName);
    assert.ok(entries.size > 20, `${label} demo catalogue looks wrong (${entries.size} entries)`);
    for (const [source, values] of entries) {
      for (const language of LANGUAGES) {
        assert.ok(
          typeof values[language] === 'string' && values[language].trim(),
          `${label} demo copy for ${JSON.stringify(source)} is missing ${language}`
        );
      }
    }
    // Names and other proper nouns are intentionally identical across languages; everything
    // else must actually be translated rather than copied from English.
    const untranslated = [...entries]
      .filter(([, values]) => values['zh-CN'] !== values.en)
      .filter(([, values]) => !/[\u3400-\u9fff]/.test(values['zh-CN']));
    assert.deepEqual(untranslated.map(([source]) => source), [], `${label} demo copy is not translated into Chinese`);
    const untranslatedTraditional = [...entries]
      .filter(([, values]) => values['zh-TW'] !== values.en)
      .filter(([, values]) => !/[\u3400-\u9fff]/.test(values['zh-TW']));
    assert.deepEqual(untranslatedTraditional.map(([source]) => source), [], `${label} demo copy is not translated into Traditional Chinese`);
  });

  test(`the ${label} demo seeder routes its copy through the catalogue`, () => {
    const source = fs.readFileSync(path.join(repoRoot, seeder), 'utf8');
    assert.match(source, new RegExp(`\\b${accessor}\\(`), `${seeder} must use ${accessor}()`);
    assert.doesNotMatch(source, /getSettings\(\)\.uiLanguage === 'es'/, `${seeder} must not branch on Spanish only`);
  });
}
