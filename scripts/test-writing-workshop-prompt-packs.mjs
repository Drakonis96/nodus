import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
const require = createRequire(import.meta.url);

async function load(entry) {
  const outfile = path.join(os.tmpdir(), `nodus-writing-workshop-packs-${process.pid}.cjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  try { return require(outfile); } finally { fs.rmSync(outfile, { force: true }); }
}

test('writing workshop has a complete, non-condensed native pack in every locale', async () => {
  const { writingWorkshopPromptPack } = await load('shared/writingWorkshopPromptPacks.ts');
  const required = [
    'nodus://', 'resumen_orientacion', 'pasajes_evidencia', 'draftMarkdown',
    'matrix', 'limitations', '700', '1200', '1800',
    'global_id', 'nodus_id', 'gap_id', 'edge_id', 'passage_id',
    'support|contrast|gap|method|definition|context',
  ];
  const systems = languages.map((language) => {
    const pack = writingWorkshopPromptPack(language);
    assert.ok(pack.system && pack.contextRule, `${language}: system/user copy missing`);
    assert.equal(pack.system.split('\n').length, writingWorkshopPromptPack('es').system.split('\n').length, `${language}: clauses were condensed`);
    for (const marker of required) assert.match(pack.system, new RegExp(marker.replace(/[|]/g, '\\|')), `${language}: missing ${marker}`);
    assert.match(pack.system, /2\s*(?:-|–|à|bis|a|e|〜)\s*4/i, `${language}: missing 2-4 paragraph rule`);
    assert.match(pack.system, /SOLO|ONLY|UNIQUEMENT|NUR|APENAS|SOMENTE|SOLAMENTE|Yalnızca/i, `${language}: missing exclusive-material rule`);
    for (const uri of ['nodus://idea/', 'nodus://work/', 'nodus://gap/', 'nodus://contradiction/', 'nodus://passage/']) {
      assert.match(pack.system, new RegExp(uri.replace(/[/:]/g, '\\$&')), `${language}: missing ${uri}`);
      assert.match(pack.contextRule, new RegExp(uri.slice(0, -1).replace(/[/:]/g, '\\$&')), `${language}: user rule missing ${uri}`);
    }
    for (const key of ['title', 'abstract', 'outline', 'draftMarkdown', 'matrix', 'bibliography', 'nextSteps', 'limitations']) assert.match(pack.system, new RegExp(`"${key}"`), `${language}: schema key ${key}`);
    for (const key of ['evidenceTitle', 'planningTitle', 'debateTitle', 'gapTitle', 'noIdeas', 'noPassages', 'noContradictions', 'noGaps', 'nextStep', 'limitation']) assert.ok(pack.fallback[key], `${language}: fallback ${key}`);
    return pack.system;
  });
  assert.notEqual(systems[0], systems[1]);
  assert.match(writingWorkshopPromptPack('en').system, /You are the Nodus Writing Workshop/);
  assert.match(writingWorkshopPromptPack('fr').system, /Atelier d’écriture/);
  assert.match(writingWorkshopPromptPack('de').system, /Schreibworkshop/);
  assert.match(writingWorkshopPromptPack('tr').system, /Yazım Atölyesi/);
});

test('writing workshop wiring preserves JSON contract, IDs, enums, limits, and temperature', () => {
  const source = fs.readFileSync(path.join(root, 'electron/ai/writingWorkshop.ts'), 'utf8');
  assert.match(source, /getSettings\(\)\.promptLanguage \?\? 'es'/);
  assert.match(source, /writingWorkshopPromptPack\(promptLanguage\)/);
  assert.match(source, /contextRule/);
  assert.match(source, /temperature: 0\.18/);
  assert.match(source, /maxTokens: 16000/);
  for (const key of ['brief', 'ideas', 'temas', 'huecos', 'contradicciones', 'obras', 'pasajes_evidencia', 'rutas_tutor', 'regla']) assert.match(source, new RegExp(`${key}:`), `context key ${key}`);
  for (const uri of ['nodus://idea/', 'nodus://work/', 'nodus://gap/', 'nodus://contradiction/', 'nodus://passage/']) assert.match(source, new RegExp(uri.replace(/[/:]/g, '\\$&')));
  assert.match(source, /support', 'contrast', 'gap', 'method', 'definition', 'context/);
});
