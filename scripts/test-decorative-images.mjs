// Regression coverage for the optional decorative-image pipeline and the
// shared global-search result modal. No provider request is performed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--electron-decorative-images-test')) {
  execFileSync(
    path.join(root, 'node_modules/.bin/electron'),
    [path.join(root, 'scripts/test-decorative-images.mjs'), '--electron-decorative-images-test'],
    { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-decorative-images-'));

try {
  // Exercise the real centralized style/prompt implementation.
  const outfile = path.join(tmp, 'imageStyles.mjs');
  await build({
    entryPoints: [path.join(root, 'shared/imageStyles.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['./types'],
    logLevel: 'silent',
  });
  const { DECORATIVE_IMAGE_STYLES, DEFAULT_DECORATIVE_IMAGE_STYLE, buildDecorativeImagePrompt } =
    await import(pathToFileURL(outfile).href);
  assert.equal(DEFAULT_DECORATIVE_IMAGE_STYLE, 'antique_book');
  assert.equal(DECORATIVE_IMAGE_STYLES.length, 7, 'the seven centralized style choices remain available');
  assert.equal(new Set(DECORATIVE_IMAGE_STYLES.map((style) => style.id)).size, 7, 'style ids are unique');
  for (const style of DECORATIVE_IMAGE_STYLES) {
    const prompt = buildDecorativeImagePrompt(style.id, `  Escena   visual de ${style.label}  `);
    assert.ok(prompt.length <= 560, 'final prompt is deliberately bounded');
    assert.ok(prompt.includes('no text') && prompt.includes('no logos') && prompt.includes('no watermark'));
    assert.ok(!/\s{2,}/.test(prompt), 'visual context whitespace is compacted');
  }

  const [service, ipc, jobs, migration, imageModels, card, searchView, searchModal, app] = await Promise.all([
    readFile(path.join(root, 'electron/ai/decorativeImages.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ipc.ts'), 'utf8'),
    readFile(path.join(root, 'src/backgroundJobs.ts'), 'utf8'),
    readFile(path.join(root, 'electron/db/migrations.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ai/imageModels.ts'), 'utf8'),
    readFile(path.join(root, 'src/components/DecorativeImageCard.tsx'), 'utf8'),
    readFile(path.join(root, 'src/views/SearchView.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/SearchResultModal.tsx'), 'utf8'),
    readFile(path.join(root, 'src/App.tsx'), 'utf8'),
  ]);

  // Disabled means a DB-only not-requested state: no text/image provider path.
  const off = service.indexOf("if (!option?.enabled) return markNotRequested");
  const queued = service.indexOf('return queueDecorativeImageGeneration', off);
  assert.ok(off >= 0 && queued > off, 'disabled option exits before the generation queue');
  assert.ok(service.includes('setTimeout(() => void runGeneration'), 'image work starts asynchronously');
  assert.ok(service.includes('active.get(key) !== token'), 'stale/deleted attempts cannot overwrite image state');
  assert.ok(service.includes('interruptDecorativeImageGenerations'), 'vault/app shutdown can invalidate process-local image work');
  assert.ok(service.includes('Máximo 45 palabras') && service.includes('maxTokens: 100'), 'visual-context call is short');
  assert.ok(service.includes('noRetry: true') && service.includes('maxRetries: 0'), 'text and Google image calls are single-attempt');
  assert.ok(service.includes('IMAGE_CONTEXT_TIMEOUT_MS = 45_000') && service.includes('IMAGE_TIMEOUT_MS = 120_000'), 'both context and image work are time-bounded');
  assert.ok(!/for\s*\([^)]*retry|while\s*\([^)]*retry/i.test(service), 'there is no automatic retry loop');

  // Main content is awaited/saved first in both owner flows.
  const immersionOwner = ipc.indexOf("h('immersion:generate'");
  assert.ok(ipc.indexOf('await generateImmersionSession', immersionOwner) < ipc.indexOf("applyDecorativeImageOption('immersion'", immersionOwner));
  const reportOwner = ipc.indexOf("h('writing:saved:save'");
  assert.ok(ipc.indexOf('saveWritingWorkshopDraft(request)', reportOwner) < ipc.indexOf("applyDecorativeImageOption('deep_research'", reportOwner));
  assert.ok(jobs.includes('decorativeImage: currentRequest.decorativeImage'), 'background Deep Research save carries the option');

  // Provider endpoints/models stay grounded in the documented integrations.
  assert.ok(service.includes("client.interactions.create"), 'Google uses the official Interactions API client');
  assert.ok(service.includes("https://api.openai.com/v1/images/generations"), 'OpenAI uses the official Images API');
  assert.ok(service.includes("https://openrouter.ai/api/v1/images"), 'OpenRouter uses the image endpoint');
  assert.ok(service.includes('media_type') && service.includes("import('@napi-rs/canvas')"), 'documented OpenRouter raster and vector formats are normalized locally');
  assert.ok(imageModels.includes("gemini-3.1-flash-lite-image"), 'verified Google image model is present');
  assert.ok(imageModels.includes("architecture?.output_modalities?.includes('image')"), 'OpenRouter results require image output');
  assert.ok(imageModels.includes('imagePriceUsd: cheapest?.value ?? null'), 'unpublished image prices remain unavailable');

  // Persistence includes every requested audit field plus optimized thumbnail.
  for (const column of ['requested', 'status', 'provider', 'model', 'style', 'prompt', 'asset_ref', 'error', 'thumbnail_blob']) {
    assert.ok(migration.includes(column), `migration persists ${column}`);
  }
  assert.ok(card.includes("if (thumbnail)"));
  assert.ok(card.includes("current?.status !== 'ready' || !dataUrl) return null"), 'missing thumbnails render no broken space');
  assert.ok(card.includes("action === 'regenerate'") && card.includes('coste adicional'), 'regeneration confirms the new cost');

  // Every result click opens one common modal; graph navigation lives in its
  // explicit secondary action. The disclosure arrow only rotates.
  assert.ok(searchView.includes('onClick={() => setSelectedResult(r)}'));
  assert.ok(searchView.includes('<SearchResultModal') && searchView.includes('onLocate={locate}'));
  assert.ok(searchModal.includes('getSearchResultDetail(result.kind, result.id)'));
  assert.ok(searchModal.includes("t('Localizar en el grafo')"));
  const arrowClass = app.match(/className=\{`transition-transform duration-200[^`]+`\}/)?.[0] ?? '';
  assert.ok(arrowClass.includes('rotate-90') && !arrowClass.includes('translate'), 'search disclosure arrow rotates without translating');

  // Drive the real detail mapper against a representative record of every
  // indexed type. This locks the shared modal contract beyond source wiring.
  const searchOutfile = path.join(tmp, 'searchRepo.mjs');
  await build({
    entryPoints: [path.join(root, 'electron/db/searchRepo.ts')],
    outfile: searchOutfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/*'],
    plugins: [{
      name: 'inject-test-database',
      setup(builder) {
        builder.onResolve({ filter: /\/database$/ }, () => ({ path: 'database', namespace: 'test-db' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-db' }, () => ({
          contents: 'export function getDb(){ return globalThis.__nodusDecorativeTestDb; }',
          loader: 'js',
        }));
      },
    }],
    logLevel: 'silent',
  });
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  globalThis.__nodusDecorativeTestDb = db;
  db.exec(`
    CREATE TABLE ideas (global_id TEXT PRIMARY KEY, type TEXT, label TEXT, statement TEXT, created_at TEXT);
    CREATE TABLE works (nodus_id TEXT PRIMARY KEY, title TEXT, authors_json TEXT, year INTEGER, item_type TEXT, doi TEXT, zotero_key TEXT, notes TEXT, source_type TEXT);
    CREATE TABLE idea_occurrences (global_id TEXT, nodus_id TEXT, role TEXT, development TEXT, confidence REAL);
    CREATE TABLE evidence (id TEXT, global_id TEXT, quote TEXT, location TEXT, kind TEXT);
    CREATE TABLE themes (theme_id TEXT PRIMARY KEY, label TEXT, pinned INTEGER, created_at TEXT);
    CREATE TABLE idea_theme_links (global_id TEXT, theme_id TEXT);
    CREATE TABLE work_themes (nodus_id TEXT, theme_id TEXT);
    CREATE TABLE work_summaries (nodus_id TEXT, summary TEXT);
    CREATE TABLE passages (passage_id TEXT PRIMARY KEY, nodus_id TEXT, text TEXT, page_label TEXT, chunk_index INTEGER, char_len INTEGER, created_at TEXT);
    CREATE TABLE gaps (id TEXT PRIMARY KEY, kind TEXT, statement TEXT, confidence REAL, nodus_id TEXT, related_idea TEXT, evidence_id TEXT);
    CREATE TABLE authors (author_id TEXT PRIMARY KEY, name TEXT, affiliation TEXT, canonical_key TEXT);
    CREATE TABLE work_authors (author_id TEXT, nodus_id TEXT);
    CREATE TABLE note_folders (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, kind TEXT, content TEXT, folder_id TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO ideas VALUES ('i1','claim','Idea de prueba','Enunciado completo','2026-01-01');
    INSERT INTO works VALUES ('w1','Obra de prueba','["Autora, A."]',2026,'book','10/test','Z1','Notas','pdf');
    INSERT INTO idea_occurrences VALUES ('i1','w1','central','Desarrollo',0.9);
    INSERT INTO evidence VALUES ('e1','i1','Cita literal','p. 4','quote');
    INSERT INTO themes VALUES ('t1','Tema de prueba',1,'2026-01-01');
    INSERT INTO idea_theme_links VALUES ('i1','t1');
    INSERT INTO work_themes VALUES ('w1','t1');
    INSERT INTO work_summaries VALUES ('w1','Resumen completo');
    INSERT INTO passages VALUES ('p1','w1','Pasaje completo','4',0,15,'2026-01-01');
    INSERT INTO gaps VALUES ('g1','evidence','Hueco de prueba',0.8,'w1','i1','e1');
    INSERT INTO authors VALUES ('a1','Autora de prueba','Universidad','autora-prueba');
    INSERT INTO work_authors VALUES ('a1','w1');
    INSERT INTO note_folders VALUES ('f1','Carpeta');
    INSERT INTO notes VALUES ('n1','Nota de prueba','markdown','Contenido completo','f1','2026-01-01','2026-01-02');
  `);
  const { getSearchResultDetail } = await import(pathToFileURL(searchOutfile).href);
  const cases = [['idea', 'i1'], ['work', 'w1'], ['passage', 'p1'], ['gap', 'g1'], ['theme', 't1'], ['author', 'a1'], ['note', 'n1']];
  for (const [kind, id] of cases) {
    const detail = getSearchResultDetail(kind, id);
    assert.ok(detail, `${kind} detail exists`);
    assert.equal(detail.kind, kind);
    assert.ok(detail.title.length > 0 && Array.isArray(detail.metadata) && Array.isArray(detail.sections));
  }
  db.close();
  delete globalThis.__nodusDecorativeTestDb;

  console.log('decorative images + search result modal test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
