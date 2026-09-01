import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const require = createRequire(import.meta.url);

async function loadPack() {
  const outfile = path.join(os.tmpdir(), `nodus-project-insertion-${process.pid}.cjs`);
  await build({
    entryPoints: [path.join(root, 'shared/projectInsertionPromptPacks.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
  });
  try {
    return require(outfile);
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}

test('project insertion prompt packs are complete and schema-parity safe', async () => {
  const { projectInsertionPromptPack } = await loadPack();
  const spanish = projectInsertionPromptPack('es');
  const protocol = ['suggestions', 'objetivo.numero_minimo', 'citationRefs', 'relatedRefs', 'idea', 'work', 'gap', 'contradiction', 'nodus://'];

  assert.equal((spanish.system.match(/\n/g) ?? []).length, 9, 'Spanish canonical prompt must retain all 10 clauses');
  for (const language of languages) {
    const prompt = projectInsertionPromptPack(language);
    assert.ok(prompt.system && prompt.examples, `${language}: incomplete pack`);
    assert.equal((prompt.system.match(/\n/g) ?? []).length, (spanish.system.match(/\n/g) ?? []).length, `${language}: clause count changed`);
    for (const token of protocol) assert.match(prompt.system, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${language}: lost ${token}`);
    for (const field of ['chunkId', 'materialId', 'paragraph', 'exactCitationRef', 'whyItFits']) assert.ok(prompt.examples[field], `${language}: missing ${field}`);
    if (language !== 'es') {
      assert.doesNotMatch(prompt.system, /Eres un asistente academico dentro de Nodus|Tu tarea es proponer inserciones puntuales para un capitulo|Se EXHAUSTIVO: genera UNA sugerencia|Devuelve solo JSON valido con la forma/i);
      assert.doesNotMatch(Object.values(prompt.examples).join('\n'), /id exacto|por que encaja|parrafo breve|material usado/i);
    }
  }
  assert.equal(spanish.examples.chunkId, 'id exacto de chunk');
  assert.equal(spanish.examples.materialId, 'id exacto del material usado');
  assert.equal(spanish.examples.paragraph, '1 parrafo breve, parafraseado, con una o varias citas Markdown nodus:// (incluye las ideas conectadas cuando aporten)');
});

test('project insertion wires configured promptLanguage and preserves output keys', () => {
  const source = fs.readFileSync(path.join(root, 'electron/ai/projectInsertion.ts'), 'utf8');
  assert.match(source, /projectInsertionPromptPack\(getSettings\(\)\.promptLanguage \?\? 'es'\)/);
  assert.match(source, /system:\s*prompt\.system/);
  assert.match(source, /prompt\.examples\.paragraph/);
  for (const key of ['targetChunkId', 'kind', 'refId', 'operation', 'proposedText', 'citationRefs', 'rationale', 'confidence']) {
    assert.match(source, new RegExp(`${key}:`), `output key ${key} was changed`);
  }
});
