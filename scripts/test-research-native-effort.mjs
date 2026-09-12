import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--native-effort')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-native-effort-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('Network forbidden in native chat tests'); };
try {
  const settings = load('electron/db/settingsRepo.ts');
  settings.updateSettings({ synthesisModel: { provider: 'openai', model: 'gpt-4.1' }, chatReasoning: 'high' });
  const ai = load('electron/ai/aiClient.ts');
  let calls = [];
  ai.completeTextStream = async (options, onDelta, model) => { calls.push({ options, model }); onDelta('Respuesta local.'); return 'Respuesta local.'; };
  const db = load('electron/db/databasesRepo.ts').createDatabase('Datos');
  const article = load('electron/db/worldEncyclopediaRepo.ts').createWorldArticle({ title: 'Observatorio', body: 'El observatorio tiene tres cúpulas.' });
  const database = load('electron/ai/databaseChat.ts');
  const world = load('electron/ai/worldChat.ts');
  const study = load('electron/ai/studyAssistant.ts');
  const native = load('shared/researchReasoning.ts');
  for (const modelId of ['gpt-4.1', 'gpt-5', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-6-astra']) {
    for (const effort of ['standard', 'high']) {
      const model = { provider: 'openai', model: modelId };
      const options = { model, thinkingEffort: effort };
      calls = [];
      await database.streamDatabaseChat({ ...options, question: 'Resume los datos', databaseIds: [db.id] }, () => {});
      await world.streamWorldChat({ ...options, question: 'Describe el Observatorio', focusKeys: [`article:${article.articleId}`] }, () => {});
      await study.streamStudyAssistant({ ...options, messages: [{ id: 'u', role: 'user', content: 'Explica el tema', createdAt: new Date().toISOString() }], selection: { scope: 'manual', sourceKeys: [] }, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: true }, () => {});
      assert.equal(calls.length, 3, `${modelId}/${effort}: all native engines reach the mocked transport`);
      for (const call of calls) {
        assert.deepEqual(call.model, model);
        assert.equal(call.options.researchEffort, effort);
        assert.equal(call.options.reasoning, 'off');
        const body = native.researchReasoningBody(model, call.options.researchEffort, call.options.maxTokens);
        const profile = native.researchReasoningProfile(model);
        assert.equal(body.reasoning_effort, native.resolveResearchEffort(profile, effort));
      }
    }
  }
  assert.equal(settings.getSettings().chatReasoning, 'high', 'global/Nodi preference remains untouched');
  load('electron/db/database.ts').closeDb();
  console.log('30 real native-engine requests passed with intercepted transports: old models, Sol, Luna, Astra; Standard/High and unchanged global reasoning. No network or paid calls.');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
