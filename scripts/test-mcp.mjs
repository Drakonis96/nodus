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
  assert.ok(capabilities.vault.active.type, 'capabilities exposes the active vault type');

  // Read-only genealogy tools are wired and safe on a non-genealogy corpus.
  const personList = await callTool(server, 'nodus_list_persons', { limit: 10, offset: 0 });
  assert.deepEqual(personList, { persons: [], total: 0 }, 'nodus_list_persons callable, empty without a records layer');
  const kinList = await callTool(server, 'nodus_list_kin_suggestions', { limit: 10, offset: 0 });
  assert.deepEqual(kinList, { suggestions: [], total: 0 }, 'nodus_list_kin_suggestions callable, empty');

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
