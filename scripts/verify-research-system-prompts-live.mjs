// Explicit live smoke only. Requires a prepared isolated copy; never targets the user's profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot } from './lib/tsRuntimeHooks.mjs';
const marker = '--electron-research-prompts-live';
const profile = process.argv.find(arg => arg.startsWith('--profile='))?.slice(10);
assert.ok(profile && fs.existsSync(path.join(profile, 'ISOLATED_RESEARCH_PROMPT_TEST')), 'Requires an explicitly prepared isolated profile');
if (!process.argv.includes(marker)) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker, `--profile=${profile}`], { cwd: repoRoot, env, stdio: 'inherit' });
  process.exit(0);
}
const { app, safeStorage } = await import('electron');
app.setName('Nodus'); app.setPath('userData', profile);
async function run() {
installRuntimeHooks(profile, { app, safeStorage });
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const output = path.join(repoRoot, 'artifacts/research-assistant/system-prompts-live.json');
let calls = 0;
const usage = [];
const checkRequest = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
  assert.equal(url.hostname, 'api.deepseek.com', 'only the chosen text provider is allowed');
  if (url.pathname.endsWith('/chat/completions')) {
    assert.ok(++calls <= 3, 'at most three paid requests');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'deepseek-v4-flash');
    assert.ok(body.max_tokens <= 1000);
    console.log(`DeepSeek Flash request ${calls}/3 (isolated copy, bounded output)`);
  }
};
globalThis.fetch = () => { throw new Error('Unexpected fetch outside the bounded DeepSeek transport'); };
const OpenAI = require('openai').default;
const nativeFetch = OpenAI.prototype.fetchWithTimeout;
OpenAI.prototype.fetchWithTimeout = function(input, init, ...rest) {
  checkRequest(input, init);
  return nativeFetch.call(this, input, init, ...rest);
};
try {
  const settings = load('electron/db/settingsRepo.ts');
  const model = { provider: 'deepseek', model: 'deepseek-v4-flash' };
  settings.updateSettings({ synthesisModel: model, chatModel: model, promptLanguage: 'es', embeddingProvider: 'openai' });
  const key = load('electron/secrets/secretStore.ts').getApiKey('deepseek');
  assert.ok(key, 'DeepSeek credential must be readable from the isolated copy');
  const registry = load('electron/chatSkills.ts');
  for (const skill of registry.restoreChatSkills()) registry.saveChatSkill({ ...skill, enabled: { assistant: skill.builtin === 'svg', nodi: false } });
  const db = load('electron/db/database.ts').getDb();
  const work = 'research-prompts-smoke-work'; const idea = 'research-prompts-smoke-idea';
  const statement = 'En un ensayo de germinación se observaron 20 semillas de lenteja: germinaron 8 de las 10 del grupo control y 6 de las 10 con luz filtrada. No hubo asignación aleatoria. El tamaño pequeño y el diseño impiden concluir causalidad.';
  db.prepare("INSERT OR REPLACE INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,light_status,deep_status) VALUES (?,?,?,'[\"Laboratorio de prueba\"]',2026,'article','text',0,'done','done')").run(work, work, 'Ensayo sintético de germinación');
  db.prepare("INSERT OR REPLACE INTO ideas(global_id,type,label,statement,created_at) VALUES (?,'finding','Luz filtrada y germinación',?,datetime('now'))").run(idea, statement);
  db.prepare("INSERT OR REPLACE INTO idea_occurrences(global_id,nodus_id,role,development,confidence) VALUES (?,?,'supports',?,.9)").run(idea, work, statement);
  db.prepare("INSERT OR REPLACE INTO evidence(id,global_id,nodus_id,quote,location,kind) VALUES (?,?,?,?,'1','quote')").run('research-prompts-evidence', idea, work, statement);
  const selection = { ideas: true, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: false, passages: false, graph: false, graphParts: {}, sourceFilter: { enabled: true, authorIds: [], workIds: [work] } };
  const repo = load('electron/db/researchSystemPromptsRepo.ts');
  const savedPrompt = (name, instructions) => repo.saveResearchSystemPrompt({ id: repo.getResearchSystemPrompts().prompts.find(p => p.name === name)?.id, name, instructions });
  const analytical = savedPrompt('Prueba · Revisor crítico', 'Empieza tu respuesta con DICTAMEN. Explica primero la evidencia y después los límites del estudio. Sé breve y preciso.');
  const teaching = savedPrompt('Prueba · Tutor socrático', 'Empieza tu respuesta con GUÍA. Ayuda a aprender mediante dos preguntas breves con su respuesta orientativa. Explica los términos de forma sencilla.');
  const chats = load('electron/db/chatRepo.ts');
  const conversation = chats.createConversation({ title: 'Prueba aislada de system prompts', model, selection });
  const ai = load('electron/ai/aiClient.ts');
  ai.embed = async () => null; // lexical retrieval over the selected synthetic work; no embedding API calls
  const nativeStream = ai.completeTextStream;
  const captured = [];
  ai.completeTextStream = async (options, onDelta, ref, signal) => {
    captured.push(options.system);
    assert.ok(options.user.includes(idea), 'the real retrieval pipeline includes the selected idea');
    return nativeStream({ ...options, maxTokens: 950, noRetry: true }, onDelta, ref, signal);
  };
  const shared = load('shared/chatSkills.ts');
  const research = load('electron/ai/researchAssistant.ts');
  const turns = [];
  for (const prompt of [null, analytical, teaching]) {
    repo.selectResearchSystemPrompt(`research:${conversation.id}`, prompt?.id ?? null);
    const question = 'Compara ambos grupos y explica qué se puede concluir. Cita la idea de germinación proporcionada. Añade un SVG mínimo completo con solo dos rectángulos y dos etiquetas, sin ejes ni leyendas, de menos de 150 palabras de código, usando la skill habilitada. Máximo 70 palabras además del SVG.';
    const user = { id: crypto.randomUUID(), role: 'user', content: question };
    const response = await research.streamResearchChat({ conversationId: conversation.id, messages: [...turns, user], selection, model, thinkingEffort: 'standard', systemPromptId: prompt?.id ?? null }, () => {}, AbortSignal.timeout(60000));
    const hasCitation = response.answer.includes(`nodus://idea/${idea}`);
    const hasSvg = response.answer.includes('</svg>') && shared.splitChatVisuals(response.answer).some(part => part.kind === 'svg');
    const hasStyle = !prompt || response.answer.includes(prompt.id === analytical.id ? 'DICTAMEN' : 'GUÍA');
    usage.push({ prompt: prompt?.name ?? 'Default', answer: response.answer, hasCitation, hasSvg, hasStyle });
    assert.ok(hasCitation, 'custom prompts retain clickable evidence');
    assert.ok(hasSvg, 'custom prompts retain native skill rendering');
    assert.ok(hasStyle, 'custom style is followed');
    turns.push(user, { id: crypto.randomUUID(), role: 'assistant', content: response.answer, stats: response.stats });
    chats.saveMessages(conversation.id, turns, { model, selection });
    console.log(`${prompt?.name ?? 'Default'}: citation, SVG skill and style passed`);
  }
  assert.ok(captured[1].endsWith(captured[0]) && captured[2].endsWith(captured[0]), 'base system and skill instructions are identical in every run');
  assert.equal(chats.getConversation(conversation.id).messages.length, 6);
  assert.equal(calls, 3, 'all three calls used the bounded real SDK transport');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ passed: true, model, calls, isolatedProfile: profile, originalProfileModified: false, sameConversation: true, baseSystemUnchanged: true, results: usage }, null, 2));
  console.log(`Live prompt smoke passed; report: ${output}`);
  load('electron/db/database.ts').closeDb(); app.quit();
} catch (error) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ passed: false, calls, results: usage, error: String(error) }, null, 2));
  console.error(String(error)); app.exit(1);
}
}
void app.whenReady().then(run).catch(error => { console.error(String(error)); app.exit(1); });
