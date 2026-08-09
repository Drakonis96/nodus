import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-saved-authors-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-saved-authors.mjs'), '--electron-saved-authors-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-saved-authors-'));
installTsHook();

try {
  const Database = require('better-sqlite3');
  const { runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const db = new Database(path.join(root, 'vault.sqlite'));
  runMigrations(db);
  stubModule('electron/db/database.ts', { getDb: () => db });
  stubModule('electron/ai/aiClient.ts', {
    completeJson: async () => {
      throw new Error('AI is not used by the saved-authors data path.');
    },
  });

  const savedAuthors = require(path.join(repoRoot, 'electron/db/savedAuthorsRepo.ts'));
  const authors = require(path.join(repoRoot, 'electron/ai/authorDossier.ts'));

  assert.ok(SCHEMA_VERSION >= 125);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_authors'").get());

  const insertAuthor = db.prepare('INSERT INTO authors (author_id, name, affiliation, canonical_key) VALUES (?, ?, NULL, ?)');
  const insertWork = db.prepare(
    `INSERT INTO works (nodus_id, title, authors_json, archived, read_tag)
     VALUES (?, ?, ?, 0, 0)`
  );
  const link = db.prepare('INSERT INTO work_authors (nodus_id, author_id, role) VALUES (?, ?, ?)');

  insertAuthor.run('author-ada', 'Lovelace, Ada', 'lovelace::a');
  insertAuthor.run('author-alan', 'Turing, Alan', 'turing::a');
  insertWork.run('work-ada', 'Notes on the Analytical Engine', JSON.stringify(['Lovelace, Ada']));
  insertWork.run('work-alan', 'Computing Machinery and Intelligence', JSON.stringify(['Turing, Alan']));
  link.run('work-ada', 'author-ada', 'author');
  link.run('work-alan', 'author-alan', 'author');

  const request = {
    offset: 0,
    limit: 80,
    sort: 'surname',
    synthesis: 'all',
    savedOnly: true,
  };
  assert.equal(authors.listAuthorsPage(request).total, 0, 'the saved workspace starts empty');

  savedAuthors.setAuthorSaved('author-ada', true);
  let page = authors.listAuthorsPage(request);
  assert.equal(page.total, 1, 'only saved authors appear');
  assert.equal(page.items[0].author_id, 'author-ada');
  assert.equal(page.items[0].saved, true, 'the card exposes its saved state');
  assert.equal(authors.listAuthorsPage({ ...request, query: 'alan' }).total, 0, 'search stays scoped to saved authors');
  assert.equal(authors.listAuthorsPage({ ...request, query: 'ada' }).total, 1, 'search finds a saved author');

  // The bookmark follows the stable canonical identity if the derived author row is rebuilt.
  insertAuthor.run('author-ada-rebuilt', 'Lovelace, Ada', 'lovelace::a');
  db.prepare('UPDATE work_authors SET author_id = ? WHERE author_id = ?').run('author-ada-rebuilt', 'author-ada');
  db.prepare('DELETE FROM authors WHERE author_id = ?').run('author-ada');
  page = authors.listAuthorsPage(request);
  assert.equal(page.items[0].author_id, 'author-ada-rebuilt', 'a rescan does not lose the bookmark');

  savedAuthors.setAuthorSaved('author-ada-rebuilt', false);
  assert.equal(authors.listAuthorsPage(request).total, 0, 'removing the star removes the author immediately');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM saved_authors').get().n, 0, 'the removal is persisted');

  const { describeSyncCoverage } = require(path.join(repoRoot, 'electron/db/syncTables.ts'));
  const coverage = describeSyncCoverage();
  assert.ok(coverage.excluded.includes('saved_authors'), 'the local author identity bookmark is explicitly classified');
  assert.ok(!coverage.unclassified.includes('saved_authors'));

  db.close();
  console.log('saved authors persistence and filtering test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function stubModule(relative, exports) {
  const filename = path.join(repoRoot, relative);
  const Module = require('node:module');
  const stub = new Module(filename, null);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[filename] = stub;
}

function installTsHook() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
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
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
