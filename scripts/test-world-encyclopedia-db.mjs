// The encyclopedia (schema v98) against a REAL migrated vault.
//
// Three silent failure modes justify a real database here rather than a bundled unit:
//   - a projected entry vanishing from the index because a read inner-joined an overlay
//     row that a person created by another path never had;
//   - a link surviving a rename but not a deletion, or vice versa — both are correct
//     behaviours and neither is visible without a second table to look at;
//   - re-indexing an unchanged body leaving a tombstone behind, which syncs a phantom
//     deletion forever and is invisible in every other test in the suite.

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

if (!process.argv.includes('--electron-encyclopedia-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-world-encyclopedia-db.mjs'), '--electron-encyclopedia-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-encyclopedia-test-'));
installRuntimeHooks(root);

try {
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION, migrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  const db = getDb();
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 98, 'the encyclopedia arrived at v98');

  // ── 0. The two shapes a migration body must never have ────────────────────
  {
    const offenders = migrations.filter((m) => m.up.includes('`')).map((m) => m.version);
    assert.deepEqual(offenders, [], 'migration bodies must not contain backticks');

    // A cascading foreign key would silently disqualify the migration from BOTH repair
    // paths: isCreateOnly() strips comments and then rejects any body containing the word
    // DELETE, which "ON DELETE CASCADE" contains — so backfillMissingCreateOnly() would
    // not restore these tables, and a database migrated under a differently-numbered
    // build would die with "table already exists" instead of being replayed.
    const m98 = migrations.find((m) => m.version === 98);
    assert.ok(m98, 'migration 98 exists');
    const bare = m98.up.replace(/--[^\n]*/g, ' ');
    assert.doesNotMatch(bare, /ON DELETE CASCADE/i, 'migration 98 must not cascade');
    assert.doesNotMatch(bare, /\b(ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i, 'migration 98 is CREATE-only');
  }

  // ── 1. The three tables exist with the keys the design depends on ─────────
  for (const table of ['world_articles', 'world_links', 'world_entry_proposals']) {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?").get(table).c,
      1,
      `${table} exists`
    );
  }
  {
    // The composite key is what keeps re-indexing from churning tombstones; if it ever
    // became a surrogate id the churn would come back silently.
    const key = db
      .prepare('SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk')
      .all('world_links')
      .map((row) => row.name);
    assert.deepEqual(key, ['source_kind', 'source_id', 'source_field', 'target_key']);

    // Not unique, deliberately: a UNIQUE title would turn a legitimate name collision
    // into a failed sync merge when the other machine's copy arrives.
    const titleIndex = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_world_articles_title_key'")
      .get();
    assert.ok(titleIndex, 'the title index exists');
    assert.doesNotMatch(titleIndex.sql, /UNIQUE/i, 'and it is not unique');
  }

  // ── 2. Everything new travels between machines ────────────────────────────
  {
    const { describeSyncCoverage } = require(path.join(repoRoot, 'electron/db/syncTables.ts'));
    const coverage = describeSyncCoverage();
    assert.deepEqual(coverage.unclassified, [], 'no table is left unclassified');
    assert.deepEqual(coverage.unmergeable, [], 'every synced table has a row identity');
    for (const table of ['world_articles', 'world_links', 'world_entry_proposals']) {
      assert.ok(
        coverage.included.worldbuilding.includes(table),
        `${table} travels in the worldbuilding group`
      );
    }
  }

  // ── 3. The index is a union of six sources, not a table ───────────────────
  const repo = require(path.join(repoRoot, 'electron/db/worldEncyclopediaRepo.ts'));
  const characters = require(path.join(repoRoot, 'electron/db/charactersRepo.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const groups = require(path.join(repoRoot, 'electron/db/worldGroupsRepo.ts'));
  const story = require(path.join(repoRoot, 'electron/db/worldStoryRepo.ts'));
  const enc = require(path.join(repoRoot, 'shared/worldEncyclopedia.ts'));

  const kaelen = characters.createCharacter({
    displayName: 'Kaelen Vor',
    species: 'Semielfo',
    backstory: 'Creció en el puerto.',
  });
  const puerto = entities.createPlace({ name: 'Puerto Gris', kind: 'city' });
  const cuervos = groups.createWorldGroup({ kind: 'faction', name: 'Los Cuervos', summary: 'Ladrones.' });
  const escena = story.createScene({ title: 'La huida', summary: 'Kaelen escapa.' });
  const magia = repo.createWorldArticle({
    title: 'Magia de sangre',
    category: 'magic',
    summary: 'Cuesta lo que pesa.',
  });

  {
    const entries = repo.listWorldEntries();
    const byKey = new Map(entries.map((e) => [e.key, e]));
    assert.equal(entries.length, 5, 'five entities of five kinds, five entries');
    assert.equal(new Set(entries.map((e) => e.key)).size, 5, 'and the keys are unique');
    assert.equal(byKey.get(`article:${magia.articleId}`).editable, true);
    for (const key of [`character:${kaelen.personId}`, `place:${puerto.placeId}`, `group:${cuervos.groupId}`, `scene:${escena.sceneId}`]) {
      assert.equal(byKey.get(key).editable, false, `${key} is browsed here and edited in its own section`);
    }
    assert.equal(byKey.get(`character:${kaelen.personId}`).summary, 'Creció en el puerto.');
    assert.equal(byKey.get(`character:${kaelen.personId}`).stub, false);
    assert.equal(byKey.get(`place:${puerto.placeId}`).stub, true, 'a place with no prose is a stub');
  }

  // A person created outside the worldbuilding vault has NO overlay row. An inner join
  // would drop them from the index with no error at all — the exact silent failure the
  // character layer was written to avoid.
  {
    const orphan = entities.createPerson({ displayName: 'Sin ficha' });
    getDb().prepare('DELETE FROM character_profiles WHERE person_id = ?').run(orphan.personId);
    const entries = repo.listWorldEntries();
    assert.ok(
      entries.some((e) => e.kind === 'character' && e.id === orphan.personId),
      'a person with no overlay still appears in the index'
    );
    entities.deletePerson(orphan.personId);
  }

  // ── 4. Links: written on save, and typing the name is enough ──────────────
  {
    const updated = repo.updateWorldArticle(magia.articleId, {
      body: 'La practican [[Kaelen Vor]] y [[Los Sin Nombre]]. Otra vez [[Kaelen Vor]].',
    });
    assert.match(
      updated.body,
      new RegExp(`\\[Kaelen Vor\\]\\(nodus://world/character/${kaelen.personId}\\)`),
      'a name that exists is promoted to a real link on save'
    );
    assert.match(updated.body, /\[\[Los Sin Nombre\]\]/, 'and one that does not stays pending');

    const links = repo.linksFrom({ kind: 'article', id: magia.articleId });
    const resolved = links.find((l) => l.target);
    assert.equal(resolved.target.id, kaelen.personId);
    assert.equal(resolved.occurrences, 2, 'two mentions are one edge with a count');
    assert.equal(links.filter((l) => l.pendingText).length, 1);

    const backlinks = repo.worldBacklinks({ kind: 'character', id: kaelen.personId });
    assert.equal(backlinks.length, 1);
    assert.equal(backlinks[0].sourceTitle, 'Magia de sangre');
    assert.equal(backlinks[0].sourceField, 'body');
  }

  // ── 5. Re-indexing an unchanged body must leave NO tombstone ──────────────
  // Every synced table carries AFTER DELETE / AFTER INSERT tombstone triggers, and the
  // link index is rewritten on every save. With a surrogate primary key each save would
  // leave one permanent tombstone per link, syncing a phantom deletion forever. Nothing
  // else in the suite can see this.
  {
    getDb().prepare("DELETE FROM sync_tombstones WHERE table_name = 'world_links'").run();
    repo.indexEntryLinks({ kind: 'article', id: magia.articleId });
    repo.indexEntryLinks({ kind: 'article', id: magia.articleId });
    const left = getDb()
      .prepare("SELECT COUNT(*) AS c FROM sync_tombstones WHERE table_name = 'world_links'")
      .get().c;
    assert.equal(left, 0, 'saving twice must not accumulate tombstones');
  }

  // ── 6. A rename moves nothing; a deletion degrades to red ─────────────────
  {
    entities.updatePerson(kaelen.personId, { displayName: 'Kaelen el Callado' });
    const after = repo.worldBacklinks({ kind: 'character', id: kaelen.personId });
    assert.equal(after.length, 1, 'the link still points at the same person');
    assert.equal(after[0].label, 'Kaelen Vor', 'and still says what the author wrote');
    assert.equal(after[0].targetTitle, 'Kaelen el Callado', 'while showing the current name');

    const otro = repo.createWorldArticle({ title: 'Los Cuervos del puerto' });
    repo.updateWorldArticle(otro.articleId, { body: `Ver [Magia](nodus://world/article/${magia.articleId}).` });
    assert.equal(repo.worldBacklinks({ kind: 'article', id: magia.articleId }).length, 1);
    repo.deleteWorldArticle(magia.articleId);
    const orphaned = repo.worldUnresolvedLinks();
    assert.ok(
      orphaned.some((l) => l.pendingText === enc.normalizeTitle('Magia de sangre')),
      'deleting a target degrades its links to unresolved instead of erasing them'
    );
    repo.deleteWorldArticle(otro.articleId);
  }

  // ── 7. Creating an entry from a red link repairs every body waiting on it ─
  {
    const a = repo.createWorldArticle({ title: 'Rito del alba', body: 'Lo guardan [[Los Sin Nombre]].' });
    const b = repo.createWorldArticle({ title: 'Rito del ocaso', body: 'También [[los sin nombre]].' });
    const orden = repo.createWorldArticle({ title: 'Los Sin Nombre', category: 'organization' });
    const repaired = repo.resolveWorldLink('Los Sin Nombre', { kind: 'article', id: orden.articleId });
    assert.equal(repaired, 2, 'both bodies are rewritten, folded and case-insensitively');
    assert.equal(repo.worldBacklinks({ kind: 'article', id: orden.articleId }).length, 2);
    assert.equal(repo.worldUnresolvedLinks().length, 0);
    for (const article of [a, b, orden]) repo.deleteWorldArticle(article.articleId);
  }

  // ── 8. rebuildWorldLinks is idempotent and reads every kind ───────────────
  {
    characters.updateCharacter(kaelen.personId, {
      backstory: `Sirvió a [Los Cuervos](nodus://world/group/${cuervos.groupId}).`,
    });
    const first = repo.rebuildWorldLinks();
    const second = repo.rebuildWorldLinks();
    assert.equal(first, second, 'rebuilding twice yields the same graph');
    const backlinks = repo.worldBacklinks({ kind: 'group', id: cuervos.groupId });
    assert.equal(backlinks.length, 1, 'a link written in a character sheet counts too');
    assert.equal(backlinks[0].sourceField, 'backstory');
  }

  // ── 9. Full-text search reaches prose no index row carries ────────────────
  {
    const hits = repo.searchWorldBodies('Sirvió');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'character');
    assert.equal(hits[0].field, 'backstory');
    assert.match(hits[0].snippet, /Sirvió/);
    // A wildcard typed by the user finds nothing, which is what the reader sees...
    assert.deepEqual(repo.searchWorldBodies('%o'), [], 'a typed % matches nothing');
    assert.deepEqual(repo.searchWorldBodies('S_rvió'), [], 'a typed _ is not "any character"');
    assert.deepEqual(repo.searchWorldBodies('a'), [], 'a single character is not a search');
    // ...but that is the literal `includes` filter doing the work, not the escaping. The
    // escaping only decides whether SQLite scanned the whole corpus first, so assert it
    // where it is actually observable.
    assert.equal(repo.likeParam('50%_x'), '%50\\%\\_x%');
  }

  // ── 10. The world bible, built from the real rows ────────────────────────
  // The pure tests prove the rendering; this proves the DOCUMENT — that a projection's
  // composed body reaches the artifact at all, and that no link survives as a dead URL
  // once the real ids are in play.
  {
    const bibleExport = require(path.join(repoRoot, 'electron/export/worldBibleExport.ts'));
    const bible = require(path.join(repoRoot, 'shared/worldBibleDoc.ts'));
    const options = {
      format: 'md',
      order: 'alpha',
      includeSpoilers: false,
      includeNotes: false,
      includeProposals: false,
      title: 'Mundo de prueba',
    };
    const doc = bibleExport.buildWorldBibleDoc(options);
    const markdown = bible.renderWorldBibleMarkdown(doc, options);

    assert.ok(doc.entries.length >= 4, 'the bible holds the whole world, not only the articles');
    assert.match(markdown, /Sirvió a/, "a character's composed body reaches the document");
    assert.doesNotMatch(markdown, /nodus:\/\//, 'no link survives as a dead URL');
    // The link written in Kaelen's backstory points at a faction that IS in the export,
    // so it must have become an in-document anchor rather than plain text.
    assert.match(markdown, /\[Los Cuervos\]\(#group-los-cuervos-/);
  }

  console.log('Encyclopedia database test passed!');
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
      getPath() {
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
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
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
