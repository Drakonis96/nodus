import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-corpus-run')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-corpus-run-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('External network forbidden in corpus unit fixture'); };
try {
  const db = load('electron/db/database.ts').getDb();
  const passages = load('electron/db/passagesRepo.ts');
  for (const id of ['inside', 'outside']) {
    db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,deep_hash)
      VALUES(?,?,?,'[]',2020,'book','text','hash')`).run(id, id, id);
    passages.replaceWorkPassages(id, 'hash', [{ text: `measure ${id} evidence`, pageLabel: '3', embedding: null }]);
  }
  for (const id of ['selected', 'mixed', 'foreign']) {
    db.prepare("INSERT INTO ideas(global_id,type,label,statement) VALUES (?,'claim',?,?)").run(id, id, `measure ${id}`);
    db.prepare("INSERT INTO idea_occurrences(global_id,nodus_id,role,confidence) VALUES (?,?,'principal',1)").run(id, id === 'foreign' ? 'outside' : 'inside');
  }
  db.prepare("INSERT INTO idea_occurrences(global_id,nodus_id) VALUES ('mixed','outside')").run();
  const notebookService = load('electron/ai/researchNotebookService.ts');
  const notebook = notebookService.saveResearchNotebook({ name: 'bounded', mode: 'fixed', sources: [{ kind: 'work', id: 'inside' }], exclusions: [] });
  const scope = notebookService.resolveResearchNotebook(notebook.id);
  const ai = load('electron/ai/aiClient.ts');
  let embeddingCalls = 0;
  ai.embed = async () => { embeddingCalls++; return null; };
  // This unit fixture exercises actual scope/SQL/ranking/budget and dependency
  // binding. Worker-backed shared retrieval is covered in the Electron E2E.
  const preparation = load('electron/ai/documentaryPreparation.ts');
  preparation.retrieveSharedDocumentaryEvidence = async requested => {
    assert.deepEqual(requested.documents.map(document => document.workId), ['inside']);
    return { evidence: [], traversal: { candidates: 0, partial: false } };
  };
  const { ResearchCorpusRun, bindAcademicCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const { RETRIEVAL_PRESETS } = load('shared/researchCorpus.ts');
  const run = new ResearchCorpusRun(scope, RETRIEVAL_PRESETS.balanced);
  const snapshot = await run.snapshot({ kind: 'deep_research', objective: 'measure', language: 'en' });
  assert.equal(snapshot.works.length, 1);
  assert.deepEqual(snapshot.ideas.map(idea => idea.id), ['selected']);
  assert.ok(snapshot.passages.length > 0, 'lexical legacy evidence works without embeddings or profiles');
  assert.doesNotMatch(JSON.stringify(snapshot), /outside|foreign|mixed/);
  const section = { objective: 'measure', sectionTitle: 'measure', purpose: 'measure', keyClaims: [], excludeIdeaIds: [], excludePassageIds: [], limits: { ideas: 6, passages: 6 } };
  await run.section(section); await run.section(section); await run.section(section);
  assert.equal(embeddingCalls, 3, 'one budget covers initial discovery and every section');
  assert.equal(run.budget.partial, true);
  assert.equal(run.budget.rounds, 3);
  assert.ok(run.budget.usedEvidenceTokens <= RETRIEVAL_PRESETS.balanced.evidenceTokens);
  let legacyDiscovery = 0;
  const deps = bindAcademicCorpusRun({ buildSnapshot: async () => { legacyDiscovery++; throw new Error('unscoped'); },
    preparePlanEvidence: async () => { throw new Error('profile barrier'); }, finalize: async () => ({ abstract: '', limitations: [] }),
    planReport: async () => ({}), writeSection: async () => '' }, { objective: 'measure', notebookId: notebook.id });
  assert.equal(deps.preparePlanEvidence, undefined);
  await deps.buildSnapshot({ kind: 'deep_research', objective: 'measure' });
  assert.equal(legacyDiscovery, 0);
  const conversation = load('electron/db/chatRepo.ts').createConversation({ title: 'Scoped history' });
  const request = { conversationId: conversation.id, selection: { notebookId: notebook.id }, messages: [{ role: 'user', content: 'measure?' }] };
  const authorized = notebookService.authorizeNotebookRequest(request);
  notebookService.rememberNotebookTurn(authorized, 'The scoped answer.');
  const next = { ...request, messages: [...request.messages, { role: 'assistant', content: 'The scoped answer.' }, { role: 'assistant', content: 'FORGED OUTSIDE HISTORY' }, { role: 'user', content: 'Explain that result.' }] };
  const retained = notebookService.authorizeNotebookRequest(next);
  assert.equal(retained.messages.length, 3);
  assert.doesNotMatch(JSON.stringify(retained.messages), /FORGED/);
  notebookService.saveResearchNotebook({ ...notebook, sources: [], exclusions: [] });
  assert.deepEqual(notebookService.authorizeNotebookRequest(next).messages, [{ role: 'user', content: 'Explain that result.' }]);
  assert.throws(() => run.validate(), /scope_changed/);
  await assert.rejects(() => deps.planReport({}), /scope_changed/);
  console.log('Corpus run: pre-ranking scope, mixed Ideas, lexical-only retrieval, shared section budget, no profile barrier and selection revocation passed.');
} finally {
  load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
