import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-mcp-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-mcp.mjs'), '--electron-mcp-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-mcp-test-'));
installRuntimeHooks(root);

function FakeServer() {
  this.tools = new Map();
}

FakeServer.prototype.registerTool = function registerTool(name, meta, handler) {
  assert.equal(this.tools.has(name), false, `duplicate MCP tool ${name}`);
  this.tools.set(name, { meta, handler });
};

try {
  const { registerTools } = require(path.join(repoRoot, 'electron/mcp/tools.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const server = new FakeServer();
  registerTools(server);

  const expectedTools = [
    'nodus_get_capabilities',
    'nodus_list_ideas',
    'nodus_get_idea',
    'nodus_get_ideas_by_work',
    'nodus_search_ideas',
    'nodus_analyze_passage',
    'nodus_get_copilot_idea',
    'nodus_compose_insertion',
    'nodus_list_debates',
    'nodus_get_debate',
    'nodus_list_gaps',
    'nodus_get_gap',
    'nodus_get_author_relations',
    'nodus_search_authors',
    'nodus_get_author_synthesis',
    'nodus_list_works',
    'nodus_get_work',
    'nodus_list_work_passages',
    'nodus_get_passage',
    'nodus_search_passages',
    'nodus_list_themes',
    'nodus_get_theme',
    'nodus_list_tutor_routes',
    'nodus_get_tutor_route',
    'nodus_list_projects',
    'nodus_get_project',
    'nodus_search_notes',
    'nodus_list_notes_tree',
    'nodus_get_note',
    'nodus_list_coverage_questions',
    'nodus_get_coverage_question',
    'nodus_ask_coverage_question',
    'nodus_writing_snapshot',
    'nodus_generate_writing_draft',
    'nodus_save_writing_draft',
    'nodus_list_writing_drafts',
    'nodus_generate_deep_research',
    'nodus_finalize_deep_research',
    'nodus_create_folder',
    'nodus_update_folder_summary',
    'nodus_create_note',
    'nodus_update_note',
    'nodus_list_persons',
    'nodus_get_person',
    'nodus_list_kin_suggestions',
    'nodus_list_events',
    'nodus_list_archive_items',
    'nodus_get_archive_item',
    'nodus_search_archive',
    'nodus_list_databases',
    'nodus_get_database_schema',
    'nodus_query_database',
    'nodus_get_database_row',
    'nodus_study_get_workspace',
    'nodus_study_get_document',
    'nodus_study_search',
    'nodus_study_list_questions',
    'nodus_study_get_progress',
  ];
  assert.deepEqual([...server.tools.keys()], expectedTools);

  seedMcpDatabase(getDb());

  const capabilitiesRaw = await callToolRaw(server, 'nodus_get_capabilities');
  // Object results mirror into structuredContent (no outputSchema declared) while
  // still carrying the text block for older clients.
  assert.ok(capabilitiesRaw.structuredContent, 'object results expose structuredContent');
  assert.deepEqual(
    capabilitiesRaw.structuredContent,
    JSON.parse(capabilitiesRaw.content[0].text),
    'structuredContent mirrors the text block'
  );
  const capabilities = capabilitiesRaw.structuredContent;
  assert.equal(capabilities.version, '0.0.0-test', 'capabilities reports the running app version');
  assert.equal(capabilities.counts.works, 3);
  assert.equal(capabilities.counts.notes, 1);
  assert.equal(capabilities.counts.themes, 1);
  assert.equal(capabilities.counts.passages, 2);
  assert.equal(capabilities.counts.databases, 0, 'capabilities reports the databases count');
  assert.equal(capabilities.counts.persons, 0, 'capabilities reports the records-layer person count');
  assert.equal(capabilities.counts.events, 0, 'capabilities reports the records-layer event count');
  assert.equal(capabilities.counts.archiveItems, 0, 'capabilities reports the archive count');
  assert.ok(Array.isArray(capabilities.enums.eventTypes), 'capabilities exposes the event-type vocabulary');
  assert.ok(capabilities.vault.active.type, 'capabilities exposes the active vault type');

  // Read-only genealogy tools are wired and safe on a non-genealogy corpus, and use
  // the same paginated shape as every other list tool.
  const personList = await callTool(server, 'nodus_list_persons', { limit: 10, offset: 0 });
  assert.deepEqual(
    personList,
    { persons: [], total: 0, limit: 10, offset: 0, hasMore: false },
    'nodus_list_persons callable, empty without a records layer'
  );
  const kinList = await callTool(server, 'nodus_list_kin_suggestions', { limit: 10, offset: 0 });
  assert.deepEqual(
    kinList,
    { suggestions: [], total: 0, limit: 10, offset: 0, hasMore: false },
    'nodus_list_kin_suggestions callable, empty'
  );
  const emptyEvents = await callTool(server, 'nodus_list_events', { limit: 10, offset: 0 });
  assert.equal(emptyEvents.total, 0, 'nodus_list_events callable, empty without a records layer');
  const emptyArchive = await callTool(server, 'nodus_list_archive_items', { limit: 10, offset: 0 });
  assert.equal(emptyArchive.total, 0, 'nodus_list_archive_items callable, empty without an archive');

  // Records layer: persons, events (timeline) and the evidence archive.
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const archiveRepo = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const juan = entities.createPerson({ displayName: 'Juan García', sex: 'male', birthDate: '1890' });
  const maria = entities.createPerson({ displayName: 'María López', sex: 'female' });
  entities.createEvent({
    type: 'baptism',
    label: 'Bautismo de Juan',
    date: '1890-05-02',
    participants: [
      { personId: juan.personId, role: 'principal' },
      { personId: maria.personId, role: 'mother' },
    ],
  });
  entities.createEvent({
    type: 'marriage',
    label: 'Matrimonio de Juan',
    date: '1915-11-20',
    participants: [{ personId: juan.personId, role: 'principal' }],
  });

  const allEvents = await callTool(server, 'nodus_list_events', { limit: 10, offset: 0 });
  assert.equal(allEvents.total, 2);
  assert.equal(allEvents.events[0].type, 'baptism', 'events come back in chronological order');
  assert.ok(
    allEvents.events[0].participants.some((p) => p.name === 'María López' && p.role === 'mother'),
    'events carry their participants with roles'
  );
  const baptisms = await callTool(server, 'nodus_list_events', { type: 'baptism', limit: 10, offset: 0 });
  assert.equal(baptisms.total, 1, 'events filter by type');
  const windowed = await callTool(server, 'nodus_list_events', { from: '1900', to: '1920', limit: 10, offset: 0 });
  assert.equal(windowed.total, 1, 'events filter by date window');
  assert.equal(windowed.events[0].type, 'marriage');
  const juanEvents = await callTool(server, 'nodus_list_events', { personId: juan.personId, limit: 10, offset: 0 });
  assert.equal(juanEvents.total, 2, 'events filter by participant');
  const badPersonEvents = await callToolRaw(server, 'nodus_list_events', { personId: 'per_missing', limit: 10, offset: 0 });
  assert.equal(badPersonEvents.isError, true);
  assert.equal(JSON.parse(badPersonEvents.content[0].text).error.category, 'not_found');

  const seededPersons = await callTool(server, 'nodus_list_persons', { limit: 1, offset: 0 });
  assert.equal(seededPersons.total, 2);
  assert.equal(seededPersons.hasMore, true, 'person list paginates with hasMore');

  const padronesFolder = archiveRepo.createFolder('Padrones');
  const padron = archiveRepo.createItem({
    folderId: padronesFolder.folderId,
    title: 'Padrón municipal de 1890',
    kind: 'image',
    docType: 'census_padron',
    extractedText: 'Juan García figura como jornalero en el padrón municipal de 1890.',
    description: 'Hoja del padrón con la familia García.',
    source: 'Archivo Municipal, caja 12',
    tags: ['padrón'],
  });
  archiveRepo.linkItemPerson(padron.itemId, juan.personId);
  archiveRepo.createItem({
    title: 'Partida de bautismo',
    kind: 'pdf',
    extractedText: 'Partida de bautismo de la parroquia, año 1890.',
  });

  const archiveList = await callTool(server, 'nodus_list_archive_items', { limit: 10, offset: 0 });
  assert.equal(archiveList.total, 2);
  const compactItem = archiveList.items.find((item) => item.itemId === padron.itemId);
  assert.equal('extractedText' in compactItem, false, 'archive list returns snippets, not full text');
  assert.match(compactItem.extractedTextSnippet, /jornalero/);
  assert.deepEqual(compactItem.folders, ['Padrones'], 'archive list resolves folder names');
  assert.deepEqual(compactItem.linkedPersons, ['Juan García']);
  const archiveByQuery = await callTool(server, 'nodus_list_archive_items', { query: 'jornalero', limit: 10, offset: 0 });
  assert.equal(archiveByQuery.total, 1, 'archive filters by text query');
  const archiveByKind = await callTool(server, 'nodus_list_archive_items', { kinds: ['pdf'], limit: 10, offset: 0 });
  assert.equal(archiveByKind.total, 1, 'archive filters by kind');
  const archiveByTag = await callTool(server, 'nodus_list_archive_items', { tags: ['padrón'], limit: 10, offset: 0 });
  assert.equal(archiveByTag.total, 1, 'archive filters by tag');
  const archiveByPerson = await callTool(server, 'nodus_list_archive_items', { personId: juan.personId, limit: 10, offset: 0 });
  assert.equal(archiveByPerson.total, 1, 'archive filters by linked person');
  const archiveByDocType = await callTool(server, 'nodus_list_archive_items', { docTypes: ['census_padron'], limit: 10, offset: 0 });
  assert.equal(archiveByDocType.total, 1, 'archive filters by document type');

  const fullItem = await callTool(server, 'nodus_get_archive_item', { itemId: padron.itemId });
  assert.match(fullItem.extractedText, /jornalero/, 'get_archive_item returns the full text');
  assert.equal(fullItem.source, 'Archivo Municipal, caja 12');
  const missingItem = await callToolRaw(server, 'nodus_get_archive_item', { itemId: 'ait_missing' });
  assert.equal(missingItem.isError, true);
  assert.equal(JSON.parse(missingItem.content[0].text).error.category, 'not_found');

  const archiveAiError = await callToolRaw(server, 'nodus_search_archive', { query: 'jornalero', limit: 5, minSimilarity: 0.35 });
  assert.equal(archiveAiError.isError, true, 'semantic archive search requires embeddings');
  assert.equal(JSON.parse(archiveAiError.content[0].text).error.category, 'ai_unconfigured');

  // Read-only databases-mode tools: list, schema, query (decoded values), get row.
  const dbmode = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const mdb = dbmode.createDatabase('MCP DB');
  const mName = dbmode.createColumn(mdb.id, 'Nombre', 'title');
  const mSel = dbmode.createColumn(mdb.id, 'Estado', 'select');
  const mVivo = dbmode.addOption(mSel.id, 'vivo');
  const mRow = dbmode.createRow(mdb.id);
  dbmode.setCell(mRow.id, mName.id, 'Gato');
  dbmode.setCell(mRow.id, mSel.id, mVivo.id);
  const dbList = await callTool(server, 'nodus_list_databases');
  assert.ok(dbList.databases.some((d) => d.name === 'MCP DB' && d.rows === 1), 'nodus_list_databases returns the database');
  const schema = await callTool(server, 'nodus_get_database_schema', { databaseId: mdb.id });
  assert.equal(schema.columns.length, 2, 'schema returns columns');
  assert.deepEqual(schema.columns.find((c) => c.type === 'select').options, ['vivo'], 'schema exposes option labels');
  const q = await callTool(server, 'nodus_query_database', { databaseId: mdb.id, limit: 10, offset: 0 });
  assert.equal(q.total, 1);
  assert.equal(q.rows[0].fields.Nombre, 'Gato');
  assert.equal(q.rows[0].fields.Estado, 'vivo', 'query decodes select to its label');
  const qFiltered = await callTool(server, 'nodus_query_database', { databaseId: mdb.id, query: 'perro', limit: 10, offset: 0 });
  assert.equal(qFiltered.total, 0, 'query filters by text');
  const gotRow = await callTool(server, 'nodus_get_database_row', { rowId: mRow.id });
  assert.equal(gotRow.fields.Nombre, 'Gato', 'nodus_get_database_row decodes the row');

  // Derived columns have to reach a client as data it can reason about. A rollup keeps its
  // value beside the cells, so reading cells alone hands the client null; a formula lives in
  // cells but is typed by what it computes, so a numeric one must arrive as a number and the
  // schema must say so — "type: formula" tells a client nothing it can query on.
  const mNum = dbmode.createColumn(mdb.id, 'Peso', 'number');
  dbmode.setCell(mRow.id, mNum.id, '4');
  const mDoble = dbmode.createColumn(mdb.id, 'Doble', 'formula', {
    formula: { kind: 'arithmetic', op: 'multiply', operands: [{ kind: 'column', columnId: mNum.id }, { kind: 'number', value: 2 }] },
  });
  const mVerdict = dbmode.createColumn(mdb.id, 'Veredicto', 'formula', {
    formula: { kind: 'ifThen', rules: [{ id: 'r', conjunction: 'and', conditions: [{ id: 'c', columnId: mNum.id, op: 'gt', value: '3' }], output: { kind: 'text', value: 'Pesado' } }], otherwise: { kind: 'text', value: 'Ligero' } },
  });
  // A rollup over a relation from another database back to this row.
  const mOther = dbmode.createDatabase('MCP Rel');
  const mOtherName = dbmode.createColumn(mOther.id, 'N', 'title');
  const mOtherRow = dbmode.createRow(mOther.id);
  dbmode.setCell(mOtherRow.id, mOtherName.id, 'Enlazado');
  const mRel = dbmode.createColumn(mdb.id, 'Vínculo', 'relation', { relationTargetKind: 'db_row', relationTargetDatabaseId: mOther.id });
  dbmode.addRelation(mRow.id, mRel.id, 'db_row', mOtherRow.id);
  const mRollup = dbmode.createColumn(mdb.id, 'Enlaces', 'rollup', { rollupRelationColumnId: mRel.id, rollupTargetColumnId: '__title__', rollupFunction: 'count' });

  const schema2 = await callTool(server, 'nodus_get_database_schema', { databaseId: mdb.id });
  const doble = schema2.columns.find((c) => c.name === 'Doble');
  assert.equal(doble.type, 'formula', 'the schema still reports the declared type');
  assert.equal(doble.computes, 'number', 'and what the formula computes');
  assert.match(doble.formula, /Peso/, 'and describes the recipe in words');
  assert.equal(schema2.columns.find((c) => c.name === 'Veredicto').computes, 'text', 'a text formula computes text');

  const q2 = await callTool(server, 'nodus_query_database', { databaseId: mdb.id, limit: 10, offset: 0 });
  const f = q2.rows[0].fields;
  assert.strictEqual(f.Doble, 8, 'a numeric formula arrives as a number, not a string');
  assert.strictEqual(f.Veredicto, 'Pesado', 'a text formula arrives as its text');
  assert.strictEqual(f.Enlaces, '1', 'a rollup arrives with its computed value, not null');
  const qFormula = await callTool(server, 'nodus_query_database', { databaseId: mdb.id, query: 'pesado', limit: 10, offset: 0 });
  assert.equal(qFormula.total, 1, 'a formula value is searchable over MCP');

  // Typed filters + sorts: the same engine as the in-app filter bar, addressed by
  // column NAME and option LABEL so an MCP client never needs internal ids.
  const mRow2 = dbmode.createRow(mdb.id);
  dbmode.setCell(mRow2.id, mName.id, 'Perro');
  dbmode.setCell(mRow2.id, mNum.id, '2');
  const heavy = await callTool(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Peso', op: 'gt', value: '3' }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(heavy.total, 1, 'numeric filter narrows the rows');
  assert.equal(heavy.rows[0].fields.Nombre, 'Gato');
  assert.equal(heavy.hasMore, false, 'query_database uses the standard paginated shape');
  const byLabel = await callTool(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Estado', op: 'isAnyOf', value: ['vivo'] }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(byLabel.total, 1, 'select filter accepts option labels');
  assert.equal(byLabel.rows[0].fields.Nombre, 'Gato');
  const eitherOr = await callTool(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: {
      conjunction: 'or',
      conditions: [
        { column: 'Peso', op: 'gt', value: '3' },
        { column: 'Nombre', op: 'contains', value: 'perro' },
      ],
    },
    limit: 10,
    offset: 0,
  });
  assert.equal(eitherOr.total, 2, 'or-conjunction unions the conditions');
  const sortedDesc = await callTool(server, 'nodus_query_database', {
    databaseId: mdb.id,
    sorts: [{ column: 'Peso', dir: 'desc' }],
    limit: 10,
    offset: 0,
  });
  assert.equal(sortedDesc.rows[0].fields.Nombre, 'Gato', 'sorts order rows by column value');
  const sortedAsc = await callTool(server, 'nodus_query_database', {
    databaseId: mdb.id,
    sorts: [{ column: 'Peso', dir: 'asc' }],
    limit: 10,
    offset: 0,
  });
  assert.equal(sortedAsc.rows[0].fields.Nombre, 'Perro');

  const badColumn = await callToolRaw(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Altura', op: 'gt', value: '3' }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(badColumn.isError, true);
  const badColumnError = JSON.parse(badColumn.content[0].text).error;
  assert.equal(badColumnError.category, 'invalid_input');
  assert.match(badColumnError.message, /Peso/, 'unknown-column error lists the available columns');
  const badOp = await callToolRaw(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Nombre', op: 'gt', value: '3' }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(badOp.isError, true);
  assert.match(JSON.parse(badOp.content[0].text).error.message, /contains/, 'invalid-operator error lists the valid operators');
  const badOption = await callToolRaw(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Estado', op: 'isAnyOf', value: ['muerto'] }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(badOption.isError, true);
  assert.match(JSON.parse(badOption.content[0].text).error.message, /vivo/, 'unknown-option error lists the available labels');
  const missingValue = await callToolRaw(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Peso', op: 'gt' }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(missingValue.isError, true);
  assert.equal(JSON.parse(missingValue.content[0].text).error.category, 'invalid_input');

  // A single row resolves its relation columns to target labels and names its database.
  const rowDetail = await callTool(server, 'nodus_get_database_row', { rowId: mRow.id });
  assert.equal(rowDetail.database.name, 'MCP DB', 'row detail names its parent database');
  assert.deepEqual(rowDetail.fields['Vínculo'], [{ label: 'Enlazado', kind: 'db_row' }], 'row detail resolves relation targets to labels');

  // Read-only study-vault tools expose organisation, grounded search, questions
  // and progress without allowing an MCP client to mutate learning state.
  const studyOrg = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const studyQuestions = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const studyCourse = studyOrg.createStudyCourse({ name: 'Biología MCP' });
  const studySubject = studyOrg.createStudySubject({ courseId: studyCourse.id, name: 'Biología celular' });
  const studyTopic = studyOrg.createStudyTopic({ subjectId: studySubject.id, name: 'Membrana' });
  const studyDoc = studyOrg.createStudyDocument({
    title: 'Membrana plasmática',
    contentMarkdown: '# Membrana\n\nEl transporte activo mueve solutos contra gradiente.',
    placement: { courseId: studyCourse.id, subjectId: studySubject.id, topicId: studyTopic.id },
  });
  const studyQuestion = studyQuestions.createStudyQuestion({
    prompt: '¿Qué mueve solutos contra gradiente?',
    type: 'short',
    answer: { text: 'El transporte activo.' },
    explanation: 'El transporte activo requiere energía.',
    courseId: studyCourse.id,
    subjectId: studySubject.id,
    topicId: studyTopic.id,
    documentId: studyDoc.id,
    source: { title: studyDoc.title, excerpt: 'El transporte activo mueve solutos contra gradiente.' },
  });
  const studyWorkspace = await callTool(server, 'nodus_study_get_workspace', { includeArchived: false });
  assert.ok(studyWorkspace.courses.some((course) => course.id === studyCourse.id));
  assert.equal('contentMarkdown' in studyWorkspace.documents.find((document) => document.id === studyDoc.id), false, 'workspace keeps document bodies compact');
  const compactStudyDoc = await callTool(server, 'nodus_study_get_document', { documentId: studyDoc.shortId, includeContent: false });
  assert.equal(compactStudyDoc.contentOmitted, true);
  assert.equal('contentMarkdown' in compactStudyDoc.document, false);
  const fullStudyDoc = await callTool(server, 'nodus_study_get_document', { documentId: studyDoc.id, includeContent: true });
  assert.match(fullStudyDoc.document.contentMarkdown, /transporte activo/);
  const studySearch = await callTool(server, 'nodus_study_search', { query: 'transporte activo', kinds: ['document'], limit: 10 });
  assert.ok(studySearch.results.some((result) => result.sourceId === studyDoc.id), 'study search returns grounded document snippets');
  const questionList = await callTool(server, 'nodus_study_list_questions', { query: 'solutos', favorite: false, limit: 10, offset: 0 });
  assert.ok(questionList.questions.some((question) => question.id === studyQuestion.id));
  const byCourse = await callTool(server, 'nodus_study_list_questions', { courseId: studyCourse.id, favorite: false, limit: 10, offset: 0 });
  assert.equal(byCourse.total, 1, 'questions filter by course');
  const otherCourse = await callTool(server, 'nodus_study_list_questions', { courseId: 'course_missing', favorite: false, limit: 10, offset: 0 });
  assert.equal(otherCourse.total, 0);
  const byType = await callTool(server, 'nodus_study_list_questions', { type: 'short', favorite: false, limit: 10, offset: 0 });
  assert.equal(byType.total, 1, 'questions filter by type');
  const byDifficulty = await callTool(server, 'nodus_study_list_questions', { difficulty: 'hard', favorite: false, limit: 10, offset: 0 });
  assert.equal(byDifficulty.total, 0, 'questions filter by difficulty');
  const byStatus = await callTool(server, 'nodus_study_list_questions', { status: 'pending', favorite: false, limit: 10, offset: 0 });
  assert.equal(byStatus.total, 1, 'questions filter by review status');
  const studyProgress = await callTool(server, 'nodus_study_get_progress');
  assert.equal(typeof studyProgress.progress.dueCards, 'number');
  assert.ok(Array.isArray(studyProgress.planner.events));

  const ideas = await callTool(server, 'nodus_list_ideas', { limit: 1, offset: 0, query: 'turismo' });
  assert.equal(ideas.total, 1);
  assert.equal(ideas.hasMore, false);
  assert.equal(ideas.ideas[0].global_id, 'idea-1');
  // Compact by default: a statement snippet instead of the full statement…
  assert.equal('statement' in ideas.ideas[0], false);
  assert.match(ideas.ideas[0].statementSnippet, /memoria visual/);
  // …and full=true restores the complete rows.
  const fullIdeas = await callTool(server, 'nodus_list_ideas', { limit: 1, offset: 0, query: 'turismo', full: true });
  assert.equal(fullIdeas.ideas[0].statement, 'El turismo reorganiza la memoria visual local.');
  assert.equal('statementSnippet' in fullIdeas.ideas[0], false);

  // query must match text fields only — never JSON keys, enum values or internal ids.
  const enumLeak = await callTool(server, 'nodus_list_ideas', { limit: 10, offset: 0, query: 'claim' });
  assert.equal(enumLeak.total, 0, 'query must not match the type enum');
  const idLeak = await callTool(server, 'nodus_list_ideas', { limit: 10, offset: 0, query: 'idea-1' });
  assert.equal(idLeak.total, 0, 'query must not match internal ids');
  const statementHit = await callTool(server, 'nodus_list_ideas', { limit: 10, offset: 0, query: 'memoria visual' });
  assert.equal(statementHit.total, 1, 'query must match the statement text');
  const noteKindLeak = await callTool(server, 'nodus_search_notes', { query: 'markdown', limit: 10, offset: 0 });
  assert.equal(noteKindLeak.total, 0, 'note query must not match the kind enum');

  const gaps = await callTool(server, 'nodus_list_gaps', { limit: 10, offset: 0, kind: 'open_question' });
  assert.equal(gaps.total, 1);
  assert.equal(gaps.gaps[0].gapIds[0], 'gap-1');

  const works = await callTool(server, 'nodus_list_works', {
    limit: 1,
    offset: 0,
    query: 'turismo',
    includeArchived: false,
    lightStatus: 'all',
    deepStatus: 'all',
    summaryStatus: 'all',
    zoteroTagMode: 'any',
    collectionMode: 'any',
  });
  assert.equal(works.total, 2);
  assert.equal(works.works.length, 1);
  assert.equal(works.hasMore, true);

  const work = await callTool(server, 'nodus_get_work', { workId: 'ZOT1' });
  assert.equal(work.work.nodus_id, 'work-1');
  assert.equal(work.counts.ideas, 1);
  assert.equal(work.counts.passages, 2);

  const passages = await callTool(server, 'nodus_list_work_passages', { workId: 'work-1', query: 'visual', limit: 1, offset: 0 });
  assert.equal(passages.total, 2);
  assert.equal(passages.passages[0].passage_id, 'passage-1');

  const passage = await callTool(server, 'nodus_get_passage', { passageId: 'passage-1' });
  assert.equal(passage.passage_id, 'passage-1');
  assert.match(passage.text, /visual/);

  const themeList = await callTool(server, 'nodus_list_themes', { query: 'turismo', limit: 10, offset: 0 });
  assert.equal(themeList.total, 1);
  assert.equal(themeList.themes[0].label, 'turismo');

  const theme = await callTool(server, 'nodus_get_theme', {
    theme: 'turismo',
    worksLimit: 10,
    worksOffset: 0,
    ideasLimit: 10,
    ideasOffset: 0,
  });
  assert.equal(theme.works.total, 2);
  assert.equal(theme.ideas.total, 1);

  const authors = await callTool(server, 'nodus_search_authors', {
    query: 'ana',
    synthesis: 'all',
    limit: 10,
    offset: 0,
  });
  assert.equal(authors.total, 1);
  assert.equal(authors.authors[0].author_id, 'author-1');
  assert.equal(authors.authors[0].hasSynthesis, true);

  const authorSynthesis = await callTool(server, 'nodus_get_author_synthesis', {
    author: 'author-1',
    generateIfMissing: false,
    refresh: false,
  });
  assert.equal(authorSynthesis.source, 'cached');
  assert.match(authorSynthesis.synthesis.thesis, /memoria visual/);
  assert.equal(authorSynthesis.counts.works, 1);

  const missingAuthorSynthesis = await callTool(server, 'nodus_get_author_synthesis', {
    author: 'author-2',
    generateIfMissing: false,
    refresh: false,
  });
  assert.equal(missingAuthorSynthesis.source, 'missing');
  assert.equal(missingAuthorSynthesis.synthesis, null);

  const routes = await callTool(server, 'nodus_list_tutor_routes', { mode: 'overview', limit: 10, offset: 0 });
  assert.equal(routes.total, 1);
  assert.equal(routes.routes[0].routeTitle, 'Ruta turismo');
  assert.equal(routes.routes[0].stopCount, 1);

  const route = await callTool(server, 'nodus_get_tutor_route', { routeId: 'route-1' });
  assert.equal(route.route.stops[0].id, 'stop-1');

  const projects = await callTool(server, 'nodus_list_projects', { query: 'tesis', status: 'active', limit: 10, offset: 0 });
  assert.equal(projects.total, 1);

  const project = await callTool(server, 'nodus_get_project', { projectId: 'project-1', includeChapterText: false });
  assert.equal(project.stats.chapters, 1);
  assert.equal('currentMarkdown' in project.chapters[0], false);
  assert.match(project.chapters[0].currentMarkdownSnippet, /Capitulo/);

  const noteSearch = await callTool(server, 'nodus_search_notes', { query: 'turismo', limit: 10, offset: 0 });
  assert.equal(noteSearch.total, 1);
  assert.match(noteSearch.notes[0].contentSnippet, /turismo/);

  const noteTree = await callTool(server, 'nodus_list_notes_tree', { query: 'turismo', limit: 1, offset: 0 });
  assert.equal(noteTree.total, 1);
  assert.equal('content' in noteTree.notes[0], false);

  const folder = await callTool(server, 'nodus_create_folder', { name: 'MCP creada', summary: 'Carpeta creada desde el test MCP.' });
  assert.equal(folder.name, 'MCP creada');
  const createdNote = await callTool(server, 'nodus_create_note', {
    title: 'Nota MCP',
    content: 'Contenido creado por la prueba MCP.',
    kind: 'markdown',
    folderId: folder.id,
  });
  assert.equal(createdNote.folderId, folder.id);

  const aiError = await callToolRaw(server, 'nodus_search_ideas', { query: 'turismo', limit: 5 });
  assert.equal(aiError.isError, true);
  assert.equal(JSON.parse(aiError.content[0].text).error.category, 'ai_unconfigured');

  // Progress bridge: with a progressToken, long tools stream notifications/progress.
  // The deep-research pipeline degrades gracefully without an AI provider (fallback
  // plan + sections), so it walks every phase and the bridge must fire throughout.
  const deepArgs = {
    objective: 'Estado del turismo visual en el corpus',
    targetLength: 'adaptive',
    sectionLimit: 'auto',
    writer: 'nodus',
    save: false,
  };
  const progressNotes = [];
  const deepReport = await callToolRaw(server, 'nodus_generate_deep_research', deepArgs, {
    _meta: { progressToken: 'tok-1' },
    sendNotification: async (n) => progressNotes.push(n),
  });
  assert.notEqual(deepReport.isError, true, `deep research failed: ${deepReport.content?.[0]?.text}`);
  assert.ok(progressNotes.length >= 3, `expected several MCP progress notifications, got ${progressNotes.length}`);
  assert.equal(progressNotes[0].method, 'notifications/progress');
  assert.equal(progressNotes[0].params.progressToken, 'tok-1');
  assert.match(progressNotes[0].params.message, /corpus/i);
  assert.ok(
    progressNotes.some((note) => /\[section \d+/.test(note.params.message)),
    'expected per-section progress messages'
  );
  progressNotes.forEach((note, index) => assert.equal(note.params.progress, index + 1, 'progress must increase monotonically'));

  // Without a progressToken the bridge must stay silent (and never crash the tool).
  const silentNotes = [];
  const silentReport = await callToolRaw(server, 'nodus_generate_deep_research', deepArgs, {
    _meta: {},
    sendNotification: async (n) => silentNotes.push(n),
  });
  assert.notEqual(silentReport.isError, true);
  assert.equal(silentNotes.length, 0);

  // Semantic passage search: unconfigured provider must fail cleanly…
  const passageAiError = await callToolRaw(server, 'nodus_search_passages', {
    query: 'turismo visual',
    limit: 10,
    minSimilarity: 0.18,
  });
  assert.equal(passageAiError.isError, true);
  assert.equal(JSON.parse(passageAiError.content[0].text).error.category, 'ai_unconfigured');

  // …and with embeddings in place it must rank by cosine similarity. Stub the
  // embedder (patching the transpiled CommonJS export) and seed vectors that match
  // currentEmbeddingConfig(), exactly as the real pipeline stores them.
  const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  const ideasRepo = require(path.join(repoRoot, 'electron/db/ideasRepo.ts'));
  const embedConfig = ideasRepo.currentEmbeddingConfig();
  const setEmbedding = getDb().prepare(
    'UPDATE passages SET embedding = ?, embedding_provider = ?, embedding_model = ?, embedding_dim = ? WHERE passage_id = ?'
  );
  setEmbedding.run(ideasRepo.encodeEmbedding([1, 0]), embedConfig.provider, embedConfig.model, 2, 'passage-1');
  setEmbedding.run(ideasRepo.encodeEmbedding([0, 1]), embedConfig.provider, embedConfig.model, 2, 'passage-2');
  const originalEmbed = aiClient.embed;
  aiClient.embed = async () => [1, 0];
  try {
    const semantic = await callTool(server, 'nodus_search_passages', {
      query: 'turismo visual',
      limit: 10,
      minSimilarity: 0.18,
    });
    assert.equal(semantic.passages.length, 1, 'only the similar passage clears the threshold');
    assert.equal(semantic.passages[0].passage_id, 'passage-1');
    assert.ok(semantic.passages[0].similarity > 0.9);
    assert.equal(semantic.passages[0].work.zotero_key, 'ZOT1');
    assert.match(semantic.passages[0].textSnippet, /turismo visual/);
    assert.equal('text' in semantic.passages[0], false, 'search returns snippets, not full text');

    const scoped = await callTool(server, 'nodus_search_passages', {
      query: 'turismo visual',
      limit: 10,
      minSimilarity: 0,
      workId: 'ZOT2',
    });
    assert.equal(scoped.passages.length, 0, 'work scoping must exclude other works');

    const badScope = await callToolRaw(server, 'nodus_search_passages', {
      query: 'turismo visual',
      limit: 10,
      minSimilarity: 0.18,
      workId: 'ZOT-MISSING',
    });
    assert.equal(badScope.isError, true);
    assert.equal(JSON.parse(badScope.content[0].text).error.category, 'not_found');

    // Semantic archive search: with embeddings in place, only the similar document
    // clears the threshold and comes back compact with its similarity.
    const archiveItems = archiveRepo.listItems();
    const partida = archiveItems.find((item) => item.itemId !== padron.itemId);
    archiveRepo.setItemEmbedding(padron.itemId, [1, 0], 'test-model', 'hash-padron');
    archiveRepo.setItemEmbedding(partida.itemId, [0, 1], 'test-model', 'hash-partida');
    const archiveHits = await callTool(server, 'nodus_search_archive', { query: 'jornalero', limit: 5, minSimilarity: 0.35 });
    assert.equal(archiveHits.items.length, 1, 'only the similar archive item clears the threshold');
    assert.equal(archiveHits.items[0].itemId, padron.itemId);
    assert.ok(archiveHits.items[0].similarity > 0.9);
    assert.equal('extractedText' in archiveHits.items[0], false, 'archive search returns compact items');
    assert.equal(archiveHits.indexed, 2, 'archive search reports index coverage');
  } finally {
    aiClient.embed = originalEmbed;
  }

  closeDb();
  console.log('mcp tool contract test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function callTool(server, name, args = {}) {
  const result = await callToolRaw(server, name, args);
  assert.notEqual(result.isError, true, `${name} returned an MCP error: ${JSON.stringify(result)}`);
  return JSON.parse(result.content[0].text);
}

async function callToolRaw(server, name, args = {}, extra = undefined) {
  const entry = server.tools.get(name);
  assert.ok(entry, `missing MCP tool ${name}`);
  return entry.handler(args, extra);
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath(name) {
        if (name === 'userData' || name === 'temp' || name === 'documents') return userDataPath;
        return userDataPath;
      },
      getVersion() {
        return '0.0.0-test';
      },
      getAppPath() {
        return repoRoot;
      },
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable() {
        return false;
      },
      encryptString(value) {
        return Buffer.from(String(value), 'utf8');
      },
      decryptString(value) {
        return Buffer.from(value).toString('utf8');
      },
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}

function seedMcpDatabase(db) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO works (
      nodus_id, zotero_key, zotero_version, title, authors_json, year, item_type, doi,
      read_tag, manual_deep, deep_trigger, source_type, light_status, deep_status,
      summary_status, archived, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'work-1',
    'ZOT1',
    1,
    'Turismo visual y memoria',
    JSON.stringify(['Garcia, Ana']),
    2024,
    'book',
    null,
    1,
    1,
    'both',
    'pdf',
    'done',
    'done',
    'done',
    0,
    'Obra central'
  );
  db.prepare(
    `INSERT INTO works (
      nodus_id, zotero_key, zotero_version, title, authors_json, year, item_type, doi,
      read_tag, manual_deep, deep_trigger, source_type, light_status, deep_status,
      summary_status, archived, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'work-2',
    'ZOT2',
    1,
    'Turismo y guias locales',
    JSON.stringify(['Lopez, Marta']),
    2022,
    'article',
    null,
    0,
    0,
    null,
    'abstract_only',
    'done',
    'none',
    'none',
    0,
    null
  );
  db.prepare(
    `INSERT INTO works (
      nodus_id, zotero_key, zotero_version, title, authors_json, year, item_type, doi,
      read_tag, manual_deep, deep_trigger, source_type, light_status, deep_status,
      summary_status, archived, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'work-3',
    'ZOT3',
    1,
    'Archivo patrimonial',
    JSON.stringify(['Diaz, Luis']),
    2018,
    'book',
    null,
    0,
    0,
    null,
    'pdf',
    'none',
    'none',
    'none',
    1,
    null
  );

  db.prepare('INSERT INTO authors (author_id, name, affiliation, canonical_key) VALUES (?, ?, ?, ?)').run(
    'author-1',
    'Garcia, Ana',
    'Universidad de Prueba',
    'garcia::a'
  );
  db.prepare('INSERT INTO authors (author_id, name, affiliation, canonical_key) VALUES (?, ?, ?, ?)').run(
    'author-2',
    'Lopez, Marta',
    null,
    'lopez::m'
  );
  db.prepare('INSERT INTO work_authors (nodus_id, author_id, role) VALUES (?, ?, ?)').run('work-1', 'author-1', 'author');
  db.prepare('INSERT INTO work_authors (nodus_id, author_id, role) VALUES (?, ?, ?)').run('work-2', 'author-2', 'author');
  db.prepare(
    `INSERT INTO author_dossier_synthesis (
      author_id, thesis, remember_json, positioning, model_json, fingerprint, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'author-1',
    'Garcia sintetiza el papel de la memoria visual en el turismo.',
    JSON.stringify(['La memoria visual ordena el corpus.', 'El turismo actua como mediador.']),
    'Se conecta con otros autores a traves del tema turismo.',
    null,
    'test-fingerprint',
    now
  );

  db.prepare('INSERT INTO themes (theme_id, label, created_at, pinned) VALUES (?, ?, ?, ?)').run('theme-1', 'turismo', now, 1);
  db.prepare('INSERT INTO work_themes (nodus_id, theme_id) VALUES (?, ?)').run('work-1', 'theme-1');
  db.prepare('INSERT INTO work_themes (nodus_id, theme_id) VALUES (?, ?)').run('work-2', 'theme-1');
  db.prepare('INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'idea-1',
    'claim',
    'Turismo visual',
    'El turismo reorganiza la memoria visual local.',
    now
  );
  db.prepare('INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'idea-2',
    'finding',
    'Patrimonio selectivo',
    'El patrimonio se selecciona de forma desigual.',
    now
  );
  db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, ?, ?, ?)').run(
    'idea-1',
    'work-1',
    'principal',
    'Desarrollo sobre fotografias y turismo.',
    0.92
  );
  db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, ?, ?, ?)').run(
    'idea-2',
    'work-2',
    'secondary',
    'Contrapunto patrimonial.',
    0.81
  );
  db.prepare('INSERT INTO idea_theme_links (nodus_id, global_id, theme_id, confidence, basis) VALUES (?, ?, ?, ?, ?)').run(
    'work-1',
    'idea-1',
    'theme-1',
    0.9,
    'explicit'
  );
  db.prepare('INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES (?, ?, ?, ?, ?, ?)').run(
    'evidence-1',
    'idea-1',
    'work-1',
    'La imagen turistica reordena la memoria.',
    'p. 12',
    'explicit'
  );
  db.prepare('INSERT INTO gaps (id, nodus_id, related_idea, kind, statement, confidence, evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'gap-1',
    'work-1',
    'idea-1',
    'open_question',
    'Falta comparar la dimension visual con archivos locales.',
    0.72,
    'evidence-1'
  );
  db.prepare(
    `INSERT INTO passages (
      passage_id, nodus_id, chunk_index, text, page_label, char_len, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('passage-1', 'work-1', 0, 'Este pasaje analiza el turismo visual y la memoria.', '12', 51, 'hash-1', now);
  db.prepare(
    `INSERT INTO passages (
      passage_id, nodus_id, chunk_index, text, page_label, char_len, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('passage-2', 'work-1', 1, 'Segundo pasaje sobre memoria local.', '13', 34, 'hash-1', now);

  db.prepare('INSERT INTO note_folders (id, parent_id, name, summary, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'folder-1',
    null,
    'Notas turismo',
    'Ideas sobre turismo',
    0,
    now,
    now
  );
  db.prepare(
    'INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('note-1', 'folder-1', 'Nota turismo', 'markdown', 'Contenido sobre turismo visual y memoria.', null, 0, now, now);

  const route = {
    id: 'route-1',
    title: 'Ruta turismo',
    description: 'Ruta de prueba sobre turismo.',
    weight: 1,
    weightLabel: 'linea principal',
    themes: ['turismo'],
    stops: [{ id: 'stop-1', kind: 'theme', title: 'Turismo', focus: 'Tema principal.', nodeIds: ['theme:theme-1'], edgeId: null }],
  };
  db.prepare(
    `INSERT INTO tutor_saved_routes (
      route_id, plan_id, generated_at, updated_at, last_played_at, mode, prompt, model_json,
      overview, total_themes, total_ideas, total_connections, route_json, rating
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('route-1', 'plan-1', now, now, now, 'overview', '', null, 'Vista general del turismo.', 1, 2, 0, JSON.stringify(route), 5);

  db.prepare(
    `INSERT INTO projects (
      id, title, kind, status, brief, research_question_id, root_folder_id, model_json, target_words, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('project-1', 'Tesis sobre turismo', 'thesis', 'active', 'Brief del proyecto', null, 'folder-1', null, 10000, now, now);
  db.prepare(
    `INSERT INTO project_sections (
      id, project_id, folder_id, title, role, status, target_words, order_idx, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('section-1', 'project-1', 'folder-1', '06 - Manuscrito', 'manuscript', 'in_progress', 3000, 0, now, now);
  db.prepare(
    `INSERT INTO project_chapters (
      id, project_id, section_id, note_id, title, source_format, original_file_name, original_text_hash,
      original_text, current_markdown, word_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'chapter-1',
    'project-1',
    'section-1',
    'note-1',
    'Capitulo 1',
    'markdown',
    'capitulo.md',
    'chapter-hash',
    'Texto original',
    '# Capitulo 1\n\nTexto sobre turismo visual.',
    6,
    now,
    now
  );
}
