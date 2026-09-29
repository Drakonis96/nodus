import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-chat-agent')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chat-agent-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('External network forbidden in the chat agent fixture'); };

// The conversation that failed: a definition of travel writing answered from one source,
// a follow-up naming Alburquerque García answered with «no text of his here» while eight of
// his works sat in the library, and «usa zotero mcp» searched for the words «usa zotero mcp».
try {
  const db = load('electron/db/database.ts').getDb();
  const works = [
    ['c8', 'Algunas notas sobre la consolidación de los relatos de viaje como género literario', ['Alburquerque García, L.'], 2009],
    ['rf', 'El "relato de viajes": hitos y formas en la evolución del género', ['Albuquerque García, L.'], 2011],
    ['p5', 'La literatura de viajes a través de la historia: reflexiones sobre el género relato de viajes', ['Alburquerque García, L.'], 2014],
    ['se', 'Teoría e historia en los relatos de viaje', ['Albuquerque García, L.'], 2016],
    ['72', 'Periodismo y literatura: el "relato de viajes" como género híbrido', ['Albuquerque García, L.', 'Hernández Guerrero, José Antonio'], 2018],
    ['gu', '¿Teatro de viajes?: paradojas modales de un género literario', ['García Barrientos, José Luis'], 2011],
    ['pe', 'El relato europeo de Enrique Gil en el marco de la literatura de viaje española', ['Peñate Rivero, Julio'], 2015],
    ['fo', 'Fotografía y turismo en el franquismo', ['Vega, Carmelo'], 2014],
  ];
  for (const [id, title, authors, year] of works) db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type) VALUES(?,?,?,?,?,'journalArticle','text')").run(id, id, title, JSON.stringify(authors), year);
  const scope = load('electron/ai/researchNotebookService.ts').resolveAcademicResearchScope();
  const idOf = work => scope.documents.find(document => document.workId === work).id;
  const workOf = id => scope.documents.find(document => document.id === id).workId;
  const preparation = load('electron/ai/documentaryPreparation.ts');
  // Every source is indexed but Peñate's, which only an original read can reach.
  preparation.getResearchPreparationInventory = () => ({ documents: scope.documents.map(document => ({ id: document.id, title: document.title,
    preparation: { documentId: document.id, revision: document.revision, text: document.workId === 'pe' ? 'missing' : 'available', lexical: 'ready', embeddings: 'ready', reason: null } })) });
  const readInside = [];
  preparation.retrieveSharedDocumentaryEvidence = async (requested, query) => {
    if (requested.documents.length !== 1) return { evidence: [], traversal: { rounds: 1, candidates: 0, partial: false } };
    const document = requested.documents[0];
    readInside.push({ work: document.workId, query });
    return { evidence: [{ id: `${'e'.repeat(64)}:${readInside.length}`, documentId: document.id, workId: document.workId, attachmentId: null, revision: document.revision,
      text: `${document.title}: el viaje articula el relato.`, locator: { sourceRef: null, pageNumber: 3, pageLabel: '3' }, provenance: 'source', limitations: [] }],
    traversal: { rounds: 1, candidates: 1, partial: false } };
  };
  const ai = load('electron/ai/aiClient.ts');
  ai.embed = async () => null;
  const { validResearchAction } = load('shared/researchActions.ts');
  assert.equal(validResearchAction({ action: 'catalog', author: 'Alburquerque' }), false, 'only the chat agent is offered the catalogue');
  assert.equal(validResearchAction({ action: 'catalog', author: 'Alburquerque' }, false, true), true);
  assert.equal(validResearchAction({ action: 'catalog' }, false, true), false, 'a lookup asks for something');
  assert.equal(validResearchAction({ action: 'catalog', author: 'x', path: '/etc' }, false, true), false);

  // 1. The planner turns a follow-up into a question about the conversation's topic.
  const { planResearchTurn, literalResearchTurnPlan } = load('electron/ai/researchTurnPlanner.ts');
  const history = [
    { role: 'user', content: 'define libro de viaje vs relato de viaje vs literatura de viaje' },
    { role: 'assistant', content: 'García Barrientos propone tres extensiones [García Barrientos, 2011](nodus://passage/x).' },
    { role: 'user', content: 'y no dices nada de albuquerque garcía?' },
  ];
  let plannerInput;
  ai.completeJson = async (options, guard) => {
    plannerInput = JSON.parse(options.user);
    const plan = { goal: 'Qué dice Alburquerque García sobre libro de viaje, relato de viaje y literatura de viaje', queries: ['relato de viaje género literario definición'],
      authors: ['albuquerque garcía'], titles: [], explicitLibrary: false, kind: 'survey' };
    assert.equal(guard(plan), true); return plan;
  };
  const plan = await planResearchTurn(history, null);
  assert.equal(plan.planned, true);
  assert.deepEqual(plan.authors, ['albuquerque garcía']);
  assert.equal(plannerInput.conversation.length, 3, 'the planner reads the conversation, not only the last message');
  assert.doesNotMatch(JSON.stringify(plannerInput), /nodus:\/\//, 'citation links reach the planner as their words');
  ai.completeJson = async () => ({ goal: 'libro de viaje y relato de viaje', queries: ['relato de viaje'], authors: [], titles: [], explicitLibrary: false, kind: 'definition' });
  assert.equal((await planResearchTurn([...history, { role: 'user', content: 'usa zotero mcp' }], null)).explicitLibrary, true, 'the words of a request for Zotero are honoured when the model misses them');
  ai.completeJson = async () => { throw new Error('provider_unavailable'); };
  const literal = await planResearchTurn([...history, { role: 'user', content: 'usa zotero mcp' }], null);
  assert.deepEqual([literal.planned, literal.goal, literal.explicitLibrary], [false, 'usa zotero mcp', true], 'a planner that fails falls back to the literal message');
  assert.equal(literalResearchTurnPlan('define libro de viaje vs relato de viaje').kind, 'comparison');

  // 2. The agent looks the author up, reads their works and does not settle for too few.
  const { ResearchCorpusRun } = load('electron/ai/researchCorpusRun.ts');
  const { RESEARCH_CHAT_AGENT_SETTINGS, RESEARCH_CHAT_AGENT_DECISION_BYTES } = load('shared/researchCorpus.ts');
  const run = new ResearchCorpusRun(scope, RESEARCH_CHAT_AGENT_SETTINGS);
  run.budget.decisionTokenLimit = RESEARCH_CHAT_AGENT_DECISION_BYTES;
  run.agent = { plan, question: history[2].content, compact: false, minSources: 5 };
  const decisions = [
    { action: 'finish' },
    { action: 'catalog', author: 'Peñate' },
    { action: 'read', documentId: idOf('rf'), operation: { kind: 'search', query: 'relato de viaje' } },
    { action: 'finish' },
    { action: 'finish' },
  ];
  const payloads = [];
  let system = '';
  ai.completeJson = async (options, guard) => {
    system = options.system; payloads.push(JSON.parse(options.user));
    const decision = decisions[payloads.length - 1] ?? { action: 'finish' };
    assert.equal(guard(decision), true, JSON.stringify(decision)); return decision;
  };
  await run.investigate(plan.goal);
  assert.deepEqual(run.catalogLookups.map(lookup => [lookup.query.author ?? lookup.query.keywords, lookup.hits]).slice(0, 1), [['albuquerque garcía', 5]], 'both spellings of the author are found');
  assert.deepEqual(readInside.slice(0, 3).map(read => read.work), ['72', 'se', 'p5'], 'three of his works, newest first, are read before any decision');
  assert.ok(readInside.slice(0, 3).every(read => read.query === plan.goal), 'each is searched for the goal');
  assert.equal(payloads.length, 5, 'two premature finishes are refused, the third is accepted');
  assert.match(system, /"action":"catalog"/);
  assert.equal(payloads[0].goal, plan.goal);
  assert.equal(payloads[0].question, history[2].content);
  assert.equal(payloads[0].sources_with_evidence, 3);
  assert.ok(payloads[0].catalog_hits.some(hit => hit.id === idOf('rf') && hit.has_evidence === false && hit.authors[0] === 'Albuquerque García, L.'), 'the supervisor sees who wrote each find');
  assert.ok(payloads[0].sources.every(source => Array.isArray(source.authors)));
  assert.equal(payloads[0].coordinator_note, undefined);
  assert.match(payloads[1].coordinator_note, /Only 3 sources support/);
  assert.ok(payloads[1].coordinator_note.includes(idOf('c8')) && payloads[1].coordinator_note.includes(idOf('rf')), 'the refusal names the unread candidates');
  assert.ok(run.catalogHits.has(idOf('pe')), 'a catalogue action of the supervisor runs');
  assert.equal(payloads[2].coordinator_note, undefined, 'a note is shown once');
  assert.match(payloads[4].coordinator_note, new RegExp(idOf('c8')));
  assert.ok(!payloads[4].coordinator_note.includes(idOf('rf')), 'a source already read is no longer a candidate');
  assert.deepEqual([...run.supportedDocuments()].map(workOf).sort(), ['72', 'p5', 'rf', 'se']);
  const log = run.researchLog().join('\n');
  assert.match(log, /Goal of this turn.*Alburquerque García/);
  assert.match(log, /catalogue \(the user's Zotero and Nodus records.*author albuquerque garcía: 5 works/);
  assert.match(log, /Sources whose own text reached this answer: .*\(Albuquerque García, 2018\)/);

  // 2b. One work is searched inside twice at most; a third search is refused with a note.
  const repeatedRun = new ResearchCorpusRun(scope, RESEARCH_CHAT_AGENT_SETTINGS);
  repeatedRun.budget.decisionTokenLimit = RESEARCH_CHAT_AGENT_DECISION_BYTES;
  repeatedRun.agent = { plan: { ...literalResearchTurnPlan('hitos del relato de viajes'), kind: 'other' }, question: 'hitos del relato de viajes', compact: false, minSources: 1 };
  const again = ['hitos', 'formas', 'evolución'].map(query => ({ action: 'read', documentId: idOf('rf'), operation: { kind: 'search', query } }));
  const repeatedPayloads = [];
  ai.completeJson = async options => { repeatedPayloads.push(JSON.parse(options.user)); return [...again, { action: 'finish' }][repeatedPayloads.length - 1] ?? { action: 'finish' }; };
  const before = readInside.length;
  await repeatedRun.investigate('hitos del relato de viajes');
  assert.deepEqual(readInside.slice(before).map(read => read.work), ['rf', 'rf'], 'the third search inside the same work is not run');
  assert.match(repeatedPayloads[3].coordinator_note, /already searched inside twice/);

  // 2c. A further planned query that fails (a retrieval timeout) costs its evidence, not the turn.
  const shared = preparation.retrieveSharedDocumentaryEvidence;
  preparation.retrieveSharedDocumentaryEvidence = async (requested, query, ...rest) => {
    if (requested.documents.length > 1 && query === 'consulta lenta') throw new Error('documentary_retrieval_timeout');
    return shared(requested, query, ...rest);
  };
  ai.completeJson = async () => ({ action: 'finish' });
  const slow = new ResearchCorpusRun(scope, RESEARCH_CHAT_AGENT_SETTINGS);
  slow.agent = { plan: { ...literalResearchTurnPlan('hitos del relato de viajes'), queries: ['consulta lenta'], kind: 'other' }, question: 'hitos', compact: false, minSources: 1 };
  await slow.investigate('hitos del relato de viajes');
  assert.ok(slow.coverage().limitations.includes('research_read_unavailable'));
  preparation.retrieveSharedDocumentaryEvidence = shared;

  // 3. A turn without a plan keeps the supervisor as it was: no catalogue, no refusal.
  ai.completeJson = async (options, guard) => { assert.equal(guard({ action: 'catalog', author: 'x' }), false); return { action: 'finish' }; };
  const plain = new ResearchCorpusRun(scope, RESEARCH_CHAT_AGENT_SETTINGS);
  await plain.investigate('relato de viaje');
  assert.equal(plain.catalogLookups.length, 0);

  // 4. Passages earlier answers cited come back; foreign or forged ids do not.
  const passages = load('electron/db/passagesRepo.ts');
  passages.replaceWorkPassages('gu', 'hash', [{ text: 'Libro, literatura y relato: de mayor a menor amplitud nocional.', pageLabel: '15', embedding: null }]);
  const passageId = db.prepare("SELECT passage_id FROM passages WHERE nodus_id='gu'").get().passage_id;
  const receipt = load('electron/citations/scopedLegacyCitations.ts').recordScopedLegacyPassage(scope, passageId);
  const cited = [{ role: 'user', content: 'define' }, { role: 'assistant', content: `Tres extensiones [García Barrientos, 2011, p. 15](nodus://passage/${encodeURIComponent(receipt.passage_id)}) y [otra](nodus://passage/${encodeURIComponent(`scoped:${'a'.repeat(64)}:${'b'.repeat(64)}`)}) [web](nodus://passage/web%3Ax).` }];
  const followUp = new ResearchCorpusRun(scope, RESEARCH_CHAT_AGENT_SETTINGS);
  assert.equal(followUp.seedPriorEvidence(cited), 1);
  assert.equal(followUp.evidence.get(receipt.passage_id).summary, 'Libro, literatura y relato: de mayor a menor amplitud nocional.');
  assert.ok(followUp.matchedDocuments.has(idOf('gu')));
  assert.equal(followUp.seedPriorEvidence(cited), 1, 'a passage already carried is not charged twice');
  console.log('Research chat agent: follow-up planning, catalogue by author, groundwork reads, refused premature finishes and carried citations passed.');
} finally {
  load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation();
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
