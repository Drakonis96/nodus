import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-primary-sources-research-test')) {
  const files = Object.fromEntries([
    ['search', 'src/views/PrimarySourcesSearchView.tsx'],
    ['notes', 'src/views/PrimarySourcesNotesView.tsx'],
    ['home', 'src/views/PrimarySourcesHomeView.tsx'],
    ['sharedHome', 'src/views/HomeView.tsx'],
    ['app', '@shell'],
    ['repo', 'electron/db/primarySourceResearchRepo.ts'],
    ['schema', 'electron/db/migrations.ts'],
    ['sync', 'electron/db/syncTables.ts'],
    ['shared', '@api'],
    ['preload', '@bridge'],
    ['ipc', '@main'],
  ].map(([name, relative]) => [name, readSource(relative)]));

  for (const marker of [
    'primary-sources-search-input',
    'Sintaxis: comillas para frases',
    'Texto no revisado',
    'Interpretación',
    'Abrir contexto',
    'primary-sources-notes',
    'Fuentes enlazadas',
    'Insertar cita',
    'backlinks',
    'primary-sources-attention',
    'primary-sources-preservation',
    'primary-sources-activity',
    'nodus.primarySourcesAttention',
  ]) {
    assert.ok(
      files.search.includes(marker) || files.notes.includes(marker) || files.home.includes(marker),
      `phase 9 UI contains ${marker}`
    );
  }
  assert.match(files.app, /<PrimarySourcesSearchView/);
  assert.match(files.app, /<PrimarySourcesNotesView/);
  assert.match(files.app, /<PrimarySourcesHomeView/);
  assert.doesNotMatch(files.app, /PrimarySourcesSectionView section="search"/);
  assert.doesNotMatch(files.search, /<aside\b/, 'search filters do not use a dedicated sidebar');
  assert.match(files.search, /className="input input-with-leading-icon h-10 w-full pr-10 text-sm"/,
    'the corpus search reserves space for the leading search icon');
  assert.match(files.search, /primary-sources-search-filter-toggle/);
  assert.match(files.search, /primary-sources-search-active-filters/);
  assert.match(files.home, /<DemoOfferCard[\s\S]*variant="primary-sources"/,
    'the Primary Sources home reuses the shared demo card');
  assert.match(files.sharedHome, /Cargar demo de fuentes primarias/);
  assert.ok(Number(files.schema.match(/SCHEMA_VERSION = (\d+)/)[1]) >= 114,
    'the research-workspace migration is applied');
  assert.match(files.schema, /primary_source_note_profiles/);
  assert.match(files.schema, /primary_source_note_link_snapshots/);
  assert.match(files.sync, /'primary_source_note_profiles'/);
  assert.match(files.sync, /'primary_source_note_link_snapshots'/);
  assert.match(files.repo, /parsePrimarySourceSearchSyntax/);
  assert.match(files.repo, /decidePrimarySourcePolicy/);
  assert.match(files.repo, /ftsRecommended/);
  assert.match(files.repo, /primarySourceExcerptDeepLink/);

  for (const method of [
    'searchPrimarySourceCorpus',
    'getPrimarySourceNoteWorkspace',
    'createPrimarySourceNote',
    'updatePrimarySourceNoteProfile',
    'addPrimarySourceNoteLink',
    'removePrimarySourceNoteLink',
    'getPrimarySourceBacklinks',
    'insertPrimarySourceExcerptCitation',
    'getPrimarySourceOperationalDashboard',
  ]) {
    assert.ok(files.shared.includes(method), `${method} is typed`);
    assert.ok(files.preload.includes(method), `${method} is exposed`);
  }
  for (const channel of [
    'primarySources:search',
    'primarySources:notes:workspace',
    'primarySources:notes:create',
    'primarySources:notes:updateProfile',
    'primarySources:notes:addLink',
    'primarySources:notes:removeLink',
    'primarySources:notes:backlinks',
    'primarySources:notes:insertCitation',
    'primarySources:dashboard',
  ]) assert.ok(files.ipc.includes(channel), `${channel} is registered`);

  const buildDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-research-i18n-'));
  try {
    const output = path.join(buildDir, 'research.cjs');
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      path.join(repoRoot, 'src/i18n.primarySourcesResearch.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${output}`,
    ], { cwd: repoRoot, stdio: 'inherit' });
    const translations = require(output).PRIMARY_SOURCES_RESEARCH_TRANSLATIONS;
    const reference = Object.keys(translations.en).sort();
    assert.ok(reference.length >= 80, 'phase 9 translation catalogue is substantive');
    for (const language of ['en', 'fr', 'de', 'pt', 'ptBR', 'it', 'tr']) {
      assert.deepEqual(Object.keys(translations[language]).sort(), reference, `${language} has every phase 9 key`);
      assert.ok(Object.values(translations[language]).every(Boolean), `${language} has no blank phase 9 copy`);
    }
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-primary-sources-research-workspace.mjs'), '--electron-primary-sources-research-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-research-'));
installRuntimeHooks(root);

try {
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const primary = require(path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'));
  const textRepo = require(path.join(repoRoot, 'electron/db/archiveTextsRepo.ts'));
  const evidenceRepo = require(path.join(repoRoot, 'electron/db/archiveEvidenceRepo.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const hierarchy = require(path.join(repoRoot, 'electron/db/archiveHierarchyRepo.ts'));
  const research = require(path.join(repoRoot, 'electron/db/primarySourceResearchRepo.ts'));
  const chatContext = require(path.join(repoRoot, 'electron/ai/primarySourcesChatContext.ts'));
  const { getDb, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const db = getDb();
  assert.ok(SCHEMA_VERSION >= 114);

  const repository = hierarchy.createArchiveRepository({
    name: 'Archivo Municipal de Pruebas',
    identifier: 'AMP',
  });
  const person = entities.createPerson({ displayName: 'María López' });
  const place = entities.findOrCreatePlace('Puerto de Cádiz');
  const expression = 'cólera';
  const content = `El informe confirma un brote de ${expression} en el puerto.`;
  const item = archive.createItem({
    title: `Expediente de ${expression}`,
    kind: 'report',
    fileName: 'expediente.txt',
    mimeType: 'text/plain',
    blob: Buffer.from(content),
    description: `Metadatos municipales sobre ${expression}.`,
  });
  primary.ensurePrimarySourceProjection(item.itemId, {
    title: `Expediente de ${expression}`,
    referenceCode: 'AMP/LEG/42',
    repositoryId: repository.repositoryId,
    creatorDisplay: 'Junta de Sanidad',
    dateDisplay: '1894',
    scopeContent: `Registro sanitario de ${expression}.`,
  });
  db.prepare(
    `UPDATE archive_item_profiles
        SET access_status='open', citation_status='ready'
      WHERE item_id=?`
  ).run(item.itemId);
  const version = textRepo.createPrimarySourceTextVersion({
    itemId: item.itemId,
    kind: 'ocr',
    languageCode: 'es',
    content,
    status: 'automatic',
    engine: 'phase9-test',
  }).version;
  const start = content.indexOf(expression);
  const excerpt = evidenceRepo.createStableArchiveExcerpt({
    itemId: item.itemId,
    textVersionId: version.textVersionId,
    startOffset: start,
    endOffset: start + expression.length,
    locatorDisplay: 'folio 7r, líneas 2–3',
    reviewStatus: 'reviewed',
    createdBy: 'researcher',
  });
  db.prepare(
    `INSERT INTO archive_person_mentions
      (mention_id, item_id, excerpt_id, person_id, original_label, role, certainty,
       identity_status, created_at, updated_at)
     VALUES ('phase9-person', ?, ?, ?, 'María López', 'author', 1, 'confirmed',
             datetime('now'), datetime('now'))`
  ).run(item.itemId, excerpt.excerptId, person.personId);
  db.prepare(
    `INSERT INTO archive_place_mentions
      (mention_id, item_id, excerpt_id, place_id, original_label, role, certainty,
       status, created_at, updated_at)
     VALUES ('phase9-place', ?, ?, ?, 'el puerto', 'mentioned', 1, 'resolved',
             datetime('now'), datetime('now'))`
  ).run(item.itemId, excerpt.excerptId, place.placeId);

  const note = research.createPrimarySourceNote({
    title: `Lectura sobre el ${expression}`,
    content: `Interpretación inicial del ${expression}.`,
    noteType: 'observation',
    status: 'draft',
    collection: 'Salud pública',
  });
  assert.equal(note.profile.noteType, 'observation');
  assert.equal(note.profile.collection, 'Salud pública');

  const response = research.searchPrimarySourceCorpus({
    query: `"${expression}"`,
    limit: 100,
  });
  assert.equal(response.indexStrategy, 'sqlite_like');
  assert.equal(response.ftsRecommended, false);
  for (const layer of ['metadata', 'ocr', 'excerpt', 'note']) {
    assert.ok(response.results.some((result) => result.layer === layer), `${expression} found in ${layer}`);
  }
  const metadataHit = response.results.find((result) => result.layer === 'metadata');
  const ocrHit = response.results.find((result) => result.layer === 'ocr' && result.textVersionId === version.textVersionId);
  const noteHit = response.results.find((result) => result.layer === 'note');
  assert.equal(metadataHit.itemId, item.itemId);
  assert.equal(ocrHit.itemId, item.itemId);
  assert.equal(ocrHit.excerptId, excerpt.excerptId);
  assert.equal(ocrHit.locator, excerpt.locatorDisplay);
  assert.ok(ocrHit.startOffset >= 0 && ocrHit.endOffset > ocrHit.startOffset);
  assert.equal(ocrHit.unreviewedText, true);
  assert.equal(noteHit.interpretation, true);
  assert.equal(noteHit.noteId, note.id);
  assert.ok(response.results.every((result) => result.matchText.includes(expression)));

  const filtered = research.searchPrimarySourceCorpus({
    query: `"${expression}" persona:"María López" repositorio:"Archivo Municipal" fecha:1894`,
  });
  assert.ok(filtered.results.some((result) => result.itemId === item.itemId));
  assert.ok(filtered.results.every((result) => result.noteId === null), 'unlinked interpretations do not impersonate documentary filters');

  const citation = research.insertPrimarySourceExcerptCitation({
    noteId: note.id,
    targetKind: 'excerpt',
    targetId: excerpt.excerptId,
    excerptId: excerpt.excerptId,
  });
  assert.equal(citation.link.relationKind, 'quotes');
  assert.equal(citation.link.locator, excerpt.locatorDisplay);
  assert.match(citation.markdown, /nodus:\/\/primary-source\//);
  assert.match(citation.markdown, /AMP\/LEG\/42/);
  assert.match(citation.markdown, /cólera/);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM primary_source_note_link_snapshots').get().count,
    1
  );

  const secondNote = research.createPrimarySourceNote({
    title: 'Comparación externa',
    noteType: 'comparison',
    status: 'in_review',
  });
  const backlink = research.addPrimarySourceNoteLink({
    noteId: secondNote.id,
    targetKind: 'note',
    targetId: note.id,
    relationKind: 'contradicts',
  });
  assert.equal(backlink.relationKind, 'contradicts');
  assert.equal(research.getPrimarySourceBacklinks('note', note.id).length, 1);
  research.updatePrimarySourceNoteProfile(note.id, {
    noteType: 'hypothesis',
    status: 'stable',
  });
  const notesWorkspace = research.getPrimarySourceNoteWorkspace();
  const enriched = notesWorkspace.notes.find((candidate) => candidate.id === note.id);
  assert.equal(enriched.profile.noteType, 'hypothesis');
  assert.equal(enriched.profile.status, 'stable');
  assert.equal(enriched.links.length, 1);
  assert.equal(enriched.backlinkCount, 1);
  assert.ok(notesWorkspace.collections.includes('Salud pública'));

  const restricted = archive.createItem({
    title: 'Fuente bajo restricción',
    kind: 'report',
    fileName: 'restricted.txt',
    mimeType: 'text/plain',
    blob: Buffer.from('frase-reservada'),
    description: 'Descripción pública.',
  });
  primary.ensurePrimarySourceProjection(restricted.itemId, {
    title: 'Fuente bajo restricción',
    referenceCode: 'AMP/RES/1',
    repositoryId: repository.repositoryId,
  });
  db.prepare(`UPDATE archive_item_profiles SET access_status='restricted' WHERE item_id=?`).run(restricted.itemId);
  textRepo.createPrimarySourceTextVersion({
    itemId: restricted.itemId,
    kind: 'ocr',
    content: 'frase-reservada',
    status: 'automatic',
  });
  assert.equal(
    research.searchPrimarySourceCorpus({ query: '"frase-reservada"' }).results.length,
    0,
    'restricted content is excluded by the backend policy'
  );
  assert.ok(
    research.searchPrimarySourceCorpus({
      query: '"frase-reservada"',
      allowRestrictedContent: true,
    }).results.some((result) => result.layer === 'ocr'),
    'an explicit vault-policy opt-in makes restricted local content searchable'
  );

  const grounded = await chatContext.buildPrimarySourcesChatContext(
    `¿Qué documenta el expediente sobre ${expression}?`,
  );
  assert.ok(
    grounded.sources.some((source) =>
      source.sourceId === item.itemId
      && source.preferredText?.content.includes(expression)
      && source.acceptedPersonMentions.some((mention) => mention.display_name === 'María López')
      && source.acceptedPlaceMentions.some((mention) => mention.original_label === 'el puerto')),
    'Nodi receives the reviewed archival structure, text and resolved entities',
  );
  assert.ok(
    grounded.sources.every((source) => source.sourceId !== restricted.itemId),
    'Nodi never receives restricted source content',
  );
  assert.doesNotMatch(JSON.stringify(grounded), /Interpretación inicial/u, 'private research notes stay outside Nodi context');
  const validLink = grounded.sources.find((source) => source.sourceId === item.itemId).link;
  assert.equal(
    chatContext.validatePrimarySourceAnswerCitations(`[fuente](${validLink})`),
    `[fuente](${validLink})`,
    'a real open source link survives answer validation',
  );
  assert.equal(
    chatContext.validatePrimarySourceAnswerCitations(
      `[inventada](nodus://primary-source/missing) [restringida](nodus://primary-source/${restricted.itemId})`,
    ),
    'inventada restringida',
    'invented and policy-ineligible source links are stripped from model answers',
  );

  const dashboard = research.getPrimarySourceOperationalDashboard();
  assert.ok(dashboard.metrics.descriptionUnits >= 2);
  assert.equal(dashboard.metrics.citationReadySources, 1);
  assert.equal(dashboard.metrics.identifiedPersons, 1);
  assert.equal(dashboard.metrics.resolvedPlaces, 1);
  assert.ok(dashboard.tasks.some((task) => task.kind === 'ocr_review'));
  assert.ok(dashboard.tasks.find((task) => task.kind === 'ocr_review').targetIds.includes(item.itemId));
  assert.ok(dashboard.recentActivity.some((activity) => activity.kind === 'note'));
  assert.equal(dashboard.latestSource.itemId, restricted.itemId);
  assert.deepEqual(db.pragma('foreign_key_check'), []);

  console.log('Primary Sources research workspace phase test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    protocol: {
      registerSchemesAsPrivileged: () => undefined,
      handle: () => undefined,
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
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
