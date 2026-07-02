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
    'nodus_list_works',
    'nodus_get_work',
    'nodus_list_work_passages',
    'nodus_get_passage',
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
    'nodus_create_folder',
    'nodus_update_folder_summary',
    'nodus_create_note',
    'nodus_update_note',
  ];
  assert.deepEqual([...server.tools.keys()], expectedTools);

  seedMcpDatabase(getDb());

  const capabilities = await callTool(server, 'nodus_get_capabilities');
  assert.equal(capabilities.counts.works, 3);
  assert.equal(capabilities.counts.notes, 1);

  const ideas = await callTool(server, 'nodus_list_ideas', { limit: 1, offset: 0, query: 'turismo' });
  assert.equal(ideas.total, 1);
  assert.equal(ideas.hasMore, false);
  assert.equal(ideas.ideas[0].global_id, 'idea-1');

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

async function callToolRaw(server, name, args = {}) {
  const entry = server.tools.get(name);
  assert.ok(entry, `missing MCP tool ${name}`);
  return entry.handler(args);
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
