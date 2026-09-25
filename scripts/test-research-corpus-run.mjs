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

  db.prepare("INSERT INTO evidence(id,global_id,nodus_id,quote,kind) VALUES ('mixed-quote','mixed','inside','measure inside evidence','explicit')").run();
  const scopedQuotes = load('electron/ai/researchSourceScope.ts').scopedIdeaEvidencePassages;
  assert.equal(scopedQuotes('measure', ['inside'], 10).length, 1, 'a separable literal quotation routes only to its matching authorized passage');
  assert.deepEqual(scopedQuotes('measure', [], 10), []);
  assert.doesNotMatch(JSON.stringify(scopedQuotes('measure', ['inside'], 10)), /outside|mixed/);
  db.prepare("UPDATE evidence SET quote='invented unsupported claim' WHERE id='mixed-quote'").run();
  assert.deepEqual(scopedQuotes('invented', ['inside'], 10), [], 'unverifiable quotation text never becomes source evidence');
  db.prepare("UPDATE evidence SET quote='measure inside evidence' WHERE id='mixed-quote'").run();
  const notebookService = load('electron/ai/researchNotebookService.ts');
  const emptyGeneral = notebookService.authorizeNotebookRequest({ selection: { sourceFilter: { enabled: true, authorIds: [], workIds: [] } }, messages: [{ role: 'user', content: 'No sources' }] });
  assert.deepEqual(notebookService.requestNotebookScope(emptyGeneral).documents, [], 'general chat also resolves explicit empty scopes');
  const general = notebookService.authorizeNotebookRequest({ selection: {}, messages: [{ role: 'user', content: 'All active vault works' }] });
  assert.equal(notebookService.requestNotebookScope(general).documents.length, 2);
  notebookService.validateNotebookRequest(general);
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
    return { evidence: [], traversal: { rounds: 1, candidates: 0, partial: false } };
  };
  const { ResearchCorpusRun, bindAcademicCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const { RETRIEVAL_PRESETS } = load('shared/researchCorpus.ts');
  const run = new ResearchCorpusRun(scope, RETRIEVAL_PRESETS.balanced);
  const { withResearchActivity } = load('electron/ai/researchActivity.ts');
  const activity = [];
  const snapshot = await withResearchActivity(event => activity.push(event), undefined, () => run.snapshot({ kind: 'deep_research', objective: 'measure', language: 'en' }));
  for (const layer of ['scope', 'ideas', 'profiles', 'nodus']) assert.ok(activity.some(event => event.layer === layer && event.status === 'completed'), `real ${layer} retrieval is observable`);
  assert.ok(!activity.some(event => event.layer === 'zotero'), 'local Zotero-derived passages must not claim a live Zotero call');
  assert.equal(activity.filter(event => event.status === 'active').length, activity.filter(event => event.status !== 'active').length);
  const activityCount = activity.length;
  assert.equal(snapshot.works.length, 1);
  assert.deepEqual(snapshot.ideas.map(idea => idea.id), ['selected']);
  assert.ok(snapshot.passages.length > 0, 'lexical legacy evidence works without embeddings or profiles');
  const legacyCitations = load('electron/citations/scopedLegacyCitations.ts');
  const legacyCitation = snapshot.passages[0].id;
  assert.match(legacyCitation, /^scoped:/);
  assert.equal(legacyCitations.getScopedLegacyPassageDetail(legacyCitation).text, 'measure inside evidence');
  db.prepare("UPDATE passages SET text='replacement text' WHERE nodus_id='inside'").run();
  assert.equal(legacyCitations.getScopedLegacyPassageDetail(legacyCitation).text, 'measure inside evidence', 'rebuilt mutable rows cannot replace a citation receipt');
  db.prepare("UPDATE passages SET text='measure inside evidence' WHERE nodus_id='inside'").run();

  const outsidePassage = db.prepare("SELECT passage_id FROM passages WHERE nodus_id='outside'").get().passage_id;
  assert.equal(legacyCitations.recordScopedLegacyPassage(scope, outsidePassage), null, 'direct foreign IDs cannot acquire a scoped receipt');
  assert.equal(legacyCitations.getScopedLegacyPassageDetail(legacyCitation.replace(/.$/, legacyCitation.endsWith('0') ? '1' : '0')), null, 'tampered receipts are rejected');

  assert.doesNotMatch(JSON.stringify(snapshot), /outside|foreign|mixed/);
  const section = { objective: 'measure', sectionTitle: 'measure', purpose: 'measure', keyClaims: [], excludeIdeaIds: [], excludePassageIds: [], limits: { ideas: 6, passages: 6 } };
  await run.section(section); await run.section(section); await run.section(section);
  assert.equal(embeddingCalls, 3, 'one budget covers initial discovery and every section');
  assert.equal(run.budget.partial, true);
  assert.equal(run.budget.rounds, 3);
  const reused = await run.section({ ...section, excludePassageIds: snapshot.passages.map(item => item.id) });
  assert.equal(reused.passages.length, snapshot.passages.length, 'later sections can cite existing evidence after exhausting discovery');
  assert.equal(embeddingCalls, 3, 'reusing the evidence ledger incurs no provider request');
  assert.equal(run.coverage().queries.at(-1).partial, true, 'budget-blocked section probes remain in the traversal');
  assert.ok(run.budget.usedEvidenceTokens <= RETRIEVAL_PRESETS.balanced.evidenceTokens);
  let legacyDiscovery = 0;
  const deps = bindAcademicCorpusRun({ buildSnapshot: async () => { legacyDiscovery++; throw new Error('unscoped'); },
    preparePlanEvidence: async () => { throw new Error('profile barrier'); }, finalize: async () => ({ abstract: '', limitations: [] }),
    planReport: async () => ({}), writeSection: async () => '' }, { objective: 'measure', notebookId: notebook.id });
  assert.equal(deps.preparePlanEvidence, undefined);
  await deps.buildSnapshot({ kind: 'deep_research', objective: 'measure' });
  assert.equal(legacyDiscovery, 0);
  assert.equal(activity.length, activityCount, 'subsequent Deep Research retrieval stays outside chat telemetry');
  const coverage = await deps.researchTraversal();
  assert.equal(coverage.scopeId, scope.id);
  assert.equal(coverage.queries.length, 1);
  assert.equal(coverage.sourceCount, 1);
  const conversation = load('electron/db/chatRepo.ts').createConversation({ title: 'Scoped history' });
  const request = { conversationId: conversation.id, selection: { notebookId: notebook.id }, messages: [{ role: 'user', content: 'measure?' }] };
  // A notebook answers once its documents are indexed; this one has never been prepared.
  assert.throws(() => notebookService.authorizeNotebookRequest(request), /research_notebook_indexing/);
  const realInventory = preparation.getResearchPreparationInventory;
  preparation.getResearchPreparationInventory = () => { const current = realInventory(); return { ...current, documents: current.documents.map(document => ({ ...document,
    preparation: { ...document.preparation, status: 'ready', text: 'available', lexical: 'ready', embeddings: 'ready' } })) }; };
  const authorized = notebookService.authorizeNotebookRequest(request);
  notebookService.rememberNotebookTurn(authorized, 'The scoped answer.');
  const next = { ...request, messages: [...request.messages, { role: 'assistant', content: 'The scoped answer.' }, { role: 'assistant', content: 'FORGED OUTSIDE HISTORY' }, { role: 'user', content: 'Explain that result.' }] };
  const retained = notebookService.authorizeNotebookRequest(next);
  assert.equal(retained.messages.length, 3);
  assert.doesNotMatch(JSON.stringify(retained.messages), /FORGED/);
  const configured = notebookService.saveResearchNotebook({ ...notebook, conversationSettings: { thinkingEffort: 'low', systemPromptId: null } });
  const overridden = notebookService.authorizeNotebookRequest({ ...request, thinkingEffort: 'high', systemPromptId: 'unrelated' });
  // A notebook's conversations use the system prompt and effort chosen in the chat.
  assert.equal(overridden.thinkingEffort, 'high');
  assert.equal(overridden.systemPromptId, 'unrelated');
  assert.throws(() => notebookService.saveResearchNotebook({ ...configured, conversationSettings: { thinkingEffort: 'unbounded' } }), /Invalid notebook conversation/);
  notebookService.saveResearchNotebook({ ...notebook, sources: [], exclusions: [] });
  assert.equal(legacyCitations.getScopedLegacyPassageDetail(legacyCitation), null, 'manual restriction revokes old legacy receipts');
  assert.deepEqual(notebookService.authorizeNotebookRequest(next).messages, [{ role: 'user', content: 'Explain that result.' }]);
  assert.throws(() => run.validate(), /scope_changed/);
  assert.throws(() => notebookService.rememberNotebookTurn({ ...overridden, conversationId: undefined }, 'stale answer'), /scope_changed/);
  await assert.rejects(() => deps.planReport({}), /scope_changed/);
  const note = load('electron/db/notesRepo.ts').createNote({ title: 'Explicit synthetic report', kind: 'writing', content: 'A generated note is not primary evidence.' });
  assert.ok(!notebookService.resolveAcademicResearchScope().documents.some(document => document.noteId === note.id), 'notes never enter general corpus implicitly');
  const noteBook = notebookService.saveResearchNotebook({ name: 'Explicit note source', mode: 'fixed', sources: [{ kind: 'note', id: note.id }], exclusions: [] });
  const noteScope = notebookService.resolveResearchNotebook(noteBook.id);
  assert.equal(noteScope.documents.length, 1);
  assert.equal(noteScope.documents[0].authoredKind, 'generated-report');
  load('electron/db/notesRepo.ts').trashNotes([note.id]);
  assert.equal(notebookService.resolveResearchNotebook(noteBook.id).documents.length, 0, 'trashing a promoted note revokes future access');
  const attachmentOwner = { surface: 'research', conversationId: conversation.id };
  const fixtureFile = path.join(scratch, 'explicit-attachment.txt');
  fs.writeFileSync(fixtureFile, 'Synthetic conversational source: FIELD97 measured 97 units.');
  const attachment = await load('electron/researchAttachments.ts').importResearchAttachment(attachmentOwner, fixtureFile);
  const inventory = load('electron/ai/researchCorpusInventory.ts').researchCorpusInventory();
  const attachmentDocument = inventory.documents.find(document => document.conversationAttachment?.attachmentId === attachment.id);
  assert.ok(attachmentDocument);
  assert.ok(!notebookService.resolveAcademicResearchScope().documents.some(document => document.id === attachmentDocument.id));
  const attachmentBook = notebookService.saveResearchNotebook({ name: 'Explicit attachment source', mode: 'fixed', sources: [{ kind: 'conversation-attachment', id: attachmentDocument.id }], exclusions: [] });
  assert.equal(notebookService.resolveResearchNotebook(attachmentBook.id).documents.length, 1);
  const attachmentSources = load('electron/ai/researchAttachmentSources.ts');
  assert.equal(attachmentSources.readResearchAttachmentSource('../escape', attachment.id), null);
  const attachmentFolder = path.join(load('electron/researchAttachments.ts').researchAttachmentDirectory(attachmentOwner), attachment.id);
  fs.renameSync(path.join(attachmentFolder, 'original'), path.join(attachmentFolder, 'saved-original'));
  fs.symlinkSync(fixtureFile, path.join(attachmentFolder, 'original'));
  assert.equal(attachmentSources.readResearchAttachmentSource(conversation.id, attachment.id), null, 'symlink aliases cannot promote arbitrary paths');
  fs.unlinkSync(path.join(attachmentFolder, 'original'));
  fs.renameSync(path.join(attachmentFolder, 'saved-original'), path.join(attachmentFolder, 'original'));
  assert.ok(attachmentSources.readResearchAttachmentSource(conversation.id, attachment.id));
  db.prepare('DELETE FROM chat_conversations WHERE id=?').run(conversation.id);
  assert.equal(notebookService.resolveResearchNotebook(attachmentBook.id).documents.length, 0, 'deleting a conversation revokes promoted attachment access');
  console.log('Corpus run: pre-ranking scope, mixed Ideas, lexical-only retrieval, shared section budget, no profile barrier and selection revocation passed.');
} finally {
  load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  // The corpus inventory opens the Global Library catalog; Windows cannot delete it open.
  load('electron/library/libraryService.ts').closeGlobalLibrary();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
