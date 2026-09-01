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

async function load(entry, prefix) {
  const outfile = path.join(os.tmpdir(), `nodus-${prefix}-${process.pid}.cjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  try { return require(outfile); } finally { fs.rmSync(outfile, { force: true }); }
}

test('study assistant and guide packs are complete in every prompt language', async () => {
  const assistant = await load('shared/studyAssistantPromptPacks.ts', 'study-assistant-pack');
  const guide = await load('shared/studyGuidePromptPacks.ts', 'study-guide-pack');
  const tasks = ['answer', 'summary', 'explain', 'compare', 'outline', 'timeline', 'table', 'concept-map', 'glossary', 'critique', 'review-questions'];
  for (const language of languages) {
    const a = assistant.studyAssistantPromptPack(language);
    const g = guide.studyGuidePromptPack(language);
    for (const task of tasks) assert.equal(typeof a.taskInstruction[task], 'string', `${language}/${task}`);
    assert.match(a.system.cite, /\[S1\]/, `${language}: citation contract`);
    assert.equal(g.session.blocks.length, 3, `${language}: fallback block count`);
    assert.equal(g.session.stepBodies.length, 3, `${language}: fallback body count`);
    assert.equal(g.session.nextActions.length, 3, `${language}: fallback action count`);
    assert.match(g.session.system, /JSON/);
    if (language !== 'es') {
      assert.doesNotMatch(JSON.stringify(a), /Eres el asistente de estudio|Responde en el idioma de la pregunta|No hay información suficiente/i, `${language}: Spanish assistant copy leaked`);
      assert.doesNotMatch(JSON.stringify(g), /Eres el tutor de estudio|Usa solo los datos proporcionados|Sesion de estudio para/i, `${language}: Spanish guide copy leaked`);
    }
  }
});

test('entry points wire configured language and explicit request language', async () => {
  const assistant = fs.readFileSync(path.join(root, 'electron/ai/studyAssistant.ts'), 'utf8');
  const guide = fs.readFileSync(path.join(root, 'electron/ai/studyGuide.ts'), 'utf8');
  for (const token of ['fuentes_seleccionadas', 'conversacion']) assert.match(assistant, new RegExp(token));
  const guidePack = await load('shared/studyGuidePromptPacks.ts', 'study-guide-contract');
  for (const token of ['\"guide\"', '\"sequence\"', '\"quiz\"', '\"nextActions\"']) assert.match(guidePack.studyGuidePromptPack('es').session.system, new RegExp(token));
  assert.match(assistant, /effectivePromptLanguage\(request\.language\)/);
  assert.match(assistant, /studyAssistantPromptPack\(selectedLanguage\)/);
  assert.match(assistant, /studyAssistantPromptPack\(effectivePromptLanguage\(conversation\.language\)\)/);
  assert.match(guide, /requestLanguage\(request\)/);
  assert.match(guide, /localizeStudyGuidePlan\(plan, language\)/);
  assert.match(guide, /studyGuidePromptPack\(language\)\.session\.system/);
});
