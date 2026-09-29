// Explicit, paid replay of the Research Chat conversation that settled for one source.
// It snapshots the source profile's vault and documentary index into a temporary profile
// (never writing to the source), copies only the chat and embedding credentials, and asks
// the same three questions with the same model. Pass --source-profile=/path/to/nodus.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot } from './lib/tsRuntimeHooks.mjs';
const flag = '--research-chat-agent-live-electron';
const source = process.argv.find(arg => arg.startsWith('--source-profile='))?.slice(17);
assert.ok(source, 'Pass --source-profile=/path/to/nodus; this explicitly enables paid API calls.');
if (!process.argv.includes(flag)) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), flag, `--source-profile=${source}`], { cwd: repoRoot, env, stdio: 'inherit' });
  process.exit(0);
}
const { app, safeStorage } = await import('electron');
// Never named «nodus»: a sibling profile of that name is treated as an old install of this one.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-live-'));
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
/** A consistent copy even while the app writes: SQLite's own snapshot, from a read-only handle. */
function snapshot(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const db = new Database(from, { readonly: true, fileMustExist: true });
  try { db.exec(`VACUUM INTO '${to.replaceAll("'", "''")}'`); } finally { db.close(); }
}
snapshot(path.join(source, 'nodus.sqlite'), path.join(profile, 'nodus.sqlite'));
snapshot(path.join(source, 'documentary', 'store.sqlite'), path.join(profile, 'documentary', 'store.sqlite'));
fs.mkdirSync(path.join(profile, 'secrets'));
for (const provider of ['deepseek', 'openrouter']) fs.copyFileSync(path.join(source, 'secrets', `ai_key_${provider}.bin`), path.join(profile, 'secrets', `ai_key_${provider}.bin`));
app.setName('Nodus'); app.setPath('userData', profile);
const output = path.join(repoRoot, 'artifacts/research-chat-agent');
fs.mkdirSync(output, { recursive: true });
const model = { provider: 'deepseek', model: 'deepseek-flash' };
const questions = ['define libro de viaje vs relato de viaje vs literatura de viaje', 'y no dices nada de albuquerque garcía?', 'usa zotero mcp'];

async function run() {
  // Workers are the built ones in dist-electron (run `npx vite build` first), found from the repository.
  app.getAppPath = () => repoRoot;
  assert.ok(fs.existsSync(path.join(repoRoot, 'dist-electron/documentaryRetrievalWorker.js')), 'Build dist-electron first: npx vite build');
  installRuntimeHooks(profile, { app, safeStorage });
  const load = file => require(path.join(repoRoot, file));
  const calls = [];
  const turns = [];
  try {
    assert.ok(load('electron/secrets/secretStore.ts').getApiKey('deepseek'), 'DeepSeek credential unavailable');
    const ai = load('electron/ai/aiClient.ts');
    for (const name of ['completeJson', 'completeText', 'completeTextStream']) {
      const native = ai[name];
      ai[name] = async (options, ...args) => {
        const chosen = name === 'completeJson' ? args[1] : name === 'completeTextStream' ? args[1] : args[0];
        assert.ok(!chosen || (chosen.provider === model.provider && chosen.model === model.model), `Unapproved model blocked: ${JSON.stringify(chosen)}`);
        assert.ok(calls.length < 90, 'Call limit exceeded');
        calls.push({ name, planner: /You plan the library search/.test(options.system ?? ''), supervisor: /Choose ONE next research action/.test(options.system ?? '') });
        return native(options, ...args);
      };
    }
    const { streamResearchChat } = load('electron/ai/researchAssistant.ts');
    const selection = { ideas: true, themes: true, contradictions: true, gaps: true, readingPath: true, authors: true, documents: true, passages: true, graph: true,
      graphParts: { ideaNodes: true, themeNodes: true, ideaEdges: true, authorGraph: true }, layers: { ideas: true, documents: true } };
    // A real conversation, as the app creates it: provenance and the skill audit belong to it.
    const chats = load('electron/db/chatRepo.ts');
    const conversationId = chats.createConversation({ model, selection, title: 'Libro, relato y literatura de viaje' }).id;
    const messages = [];
    const records = [];
    for (const question of questions) {
      messages.push({ role: 'user', content: question });
      const activity = [];
      const started = Date.now();
      // What streamed, kept for a turn that fails: a cut answer shows whether it rambled or looped.
      const streamed = { content: '', reasoning: '' };
      const onDelta = (delta, kind) => { if (kind === 'reasoning') streamed.reasoning += delta; else if (kind === 'replace') streamed.content = delta; else streamed.content += delta; };
      let response;
      try {
        response = await streamResearchChat({ conversationId, messages: [...messages], selection, model, webSearch: 'off' }, onDelta, AbortSignal.timeout(600_000), undefined, event => activity.push(event));
      } catch (error) {
        turns.push({ question, failed: String(error), streamedContentChars: streamed.content.length, streamedReasoningChars: streamed.reasoning.length,
          contentHead: streamed.content.slice(0, 1500), contentTail: streamed.content.slice(-1500),
          activity: activity.filter(event => event.status !== 'active').map(event => `${event.layer}/${event.operation}${event.subject ? ` ${event.subject}` : ''}${event.count !== undefined ? ` (${event.count})` : ''}`) });
        throw error;
      }
      messages.push({ role: 'assistant', content: response.answer });
      records.push({ role: 'user', content: question }, { role: 'assistant', content: response.answer, stats: response.stats });
      chats.saveMessages(conversationId, records, { model, selection });
      const traversal = response.stats.researchTraversal;
      const title = id => traversal.sourceCoverage.find(source => source.documentId === id)?.title;
      const cited = load('electron/ai/citationSanitize.ts').extractCitationRefs(response.answer).filter(ref => ref.kind === 'passage');
      const citedWorks = new Set(cited.map(ref => (load('electron/citations/documentaryCitations.ts').getDocumentaryPassageDetail(ref.id)
        ?? load('electron/citations/scopedLegacyCitations.ts').getScopedLegacyPassageDetail(ref.id))?.work.title).filter(Boolean));
      turns.push({ question, seconds: Math.round((Date.now() - started) / 1000), answer: response.answer,
        queries: traversal.queries.map(entry => entry.query), read: traversal.readDocumentIds.map(title), matched: traversal.matchedDocumentIds.length,
        rounds: traversal.rounds, evidenceTokens: traversal.evidenceTokens, decisionTokens: traversal.decisionTokens, limitations: traversal.limitations,
        contextChars: response.stats.contextChars, citedWorks: [...citedWorks],
        activity: activity.filter(event => event.status !== 'active').map(event => `${event.layer}/${event.operation}${event.subject ? ` ${event.subject}` : ''}${event.count !== undefined ? ` (${event.count})` : ''}`) });
      console.log(`Turn ${turns.length}: ${turns.at(-1).seconds}s, ${citedWorks.size} works cited: ${[...citedWorks].join(' | ')}`);
    }
    fs.writeFileSync(path.join(output, 'live-result.json'), JSON.stringify({ model, calls: calls.length, planner: calls.filter(call => call.planner).length, supervisor: calls.filter(call => call.supervisor).length, turns }, null, 2));
    // What the failed conversation lacked, turn by turn.
    assert.ok(turns[0].citedWorks.length >= 3, `the definition cites several works (${turns[0].citedWorks.length})`);
    assert.ok(turns[1].citedWorks.some(work => /relato|viaje|literatura/i.test(work)) && turns[1].activity.some(line => /^scope\/metadata .*b[ur]*querque/i.test(line)), 'the author is looked up in the catalogue');
    assert.doesNotMatch(turns[2].answer, /no (puedo|tengo|hay|est[aá])[^.]{0,60}(zotero|mcp|herramienta)|habilit/i, 'the answer neither claims Zotero is unavailable nor asks for it to be enabled');
    assert.ok(!turns[2].queries.includes('usa zotero mcp'), 'a request for Zotero is not searched as the topic');
    console.log(`Live Research Chat agent passed: ${calls.length} model calls. Report: ${path.join(output, 'live-result.json')}`);
  } catch (error) {
    fs.writeFileSync(path.join(output, 'live-failure.json'), JSON.stringify({ error: String(error?.stack ?? error), calls: calls.length, turns }, null, 2));
    console.error(error); process.exitCode = 1;
  } finally {
    await load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
    load('electron/db/database.ts').closeDb();
    fs.rmSync(profile, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
}
void app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
