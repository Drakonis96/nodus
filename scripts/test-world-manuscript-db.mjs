// The manuscript (schema v100) against a REAL migrated vault.
//
// Two properties are worth a real database here, and both would fail silently otherwise:
// that the migration keeps its two repair paths, and that THE TEXT NEVER TRAVELS WITH A
// LIST. A novel of 120 000 words is ~700 KB, and four different screens read the list of
// scenes; one careless join turns every one of them into a full read of the book.

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

if (!process.argv.includes('--electron-manuscript-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-world-manuscript-db.mjs'), '--electron-manuscript-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-manuscript-test-'));
installRuntimeHooks(root);

const NEW_TABLES = [
  'world_scene_text',
  'world_chapter_breaks',
  'world_word_days',
  // v101
  'world_manuscript_starts',
  'world_scene_snapshots',
];

try {
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION, migrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const db = getDb();

  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 101, 'the shelf and the snapshots arrived at v101');

  // ── 0. The migration keeps both of its repair paths ───────────────────────
  {
    for (const version of [100, 101]) {
      const migration = migrations.find((m) => m.version === version);
      assert.ok(migration, `migration ${version} exists`);
      assert.ok(!migration.up.includes('`'), 'a backtick would silently terminate the template literal');
      const bare = migration.up.replace(/--[^\n]*/g, ' ');
      // ALTER is what would have been needed to put the prose on world_scenes — and it is
      // exactly what disqualifies a migration from backfillMissingCreateOnly.
      assert.doesNotMatch(bare, /\b(ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i, `migration ${version} is CREATE-only`);
      assert.doesNotMatch(bare, /REFERENCES/i, 'ownership is enforced by deleteScene, not by the schema');
    }
  }

  // ── 1. The tables and their content-derived keys ──────────────────────────
  for (const table of NEW_TABLES) {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?").get(table).c,
      1,
      `${table} exists`
    );
  }
  const keyOf = (table) =>
    db.prepare('SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk').all(table).map((row) => row.name);
  assert.deepEqual(keyOf('world_scene_text'), ['scene_id']);
  assert.deepEqual(keyOf('world_chapter_breaks'), ['scene_id']);
  assert.deepEqual(keyOf('world_word_days'), ['day']);
  assert.deepEqual(keyOf('world_manuscript_starts'), ['scene_id'], 'a book is a mark on the scene that opens it');

  // ── 2. Everything travels, and its deletions travel too ───────────────────
  {
    const { describeSyncCoverage } = require(path.join(repoRoot, 'electron/db/syncTables.ts'));
    const coverage = describeSyncCoverage();
    assert.deepEqual(coverage.unclassified, [], 'no table is left unclassified');
    assert.deepEqual(coverage.unmergeable, [], 'every synced table has a row identity');
    for (const table of NEW_TABLES) {
      assert.ok(coverage.included.worldbuilding.includes(table), `${table} travels`);
    }
    const triggers = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'nodus_tomb_%'")
        .all()
        .map((row) => row.name)
    );
    for (const table of NEW_TABLES) {
      assert.ok(triggers.has(`nodus_tomb_del_${table}`), `${table} records its deletions`);
    }
  }

  // ── 3. The prose, the chapter and the spine through the repo ──────────────
  {
    const repo = require(path.join(repoRoot, 'electron/db/worldManuscriptRepo.ts'));
    const story = require(path.join(repoRoot, 'electron/db/worldStoryRepo.ts'));
    const characters = require(path.join(repoRoot, 'electron/db/charactersRepo.ts'));

    const kaelen = characters.createCharacter({ displayName: 'Kaelen Vor' });
    const one = story.createScene({ title: 'El vado' });
    const two = story.createScene({ title: 'El juicio' });

    assert.deepEqual(repo.getSceneText(one.sceneId), {
      sceneId: one.sceneId,
      text: null,
      wordCount: 0,
      updatedAt: null,
    });

    // Typing `[[Kaelen Vor]]` mid-sentence makes a real link, exactly as in every other
    // prose field of the vault — which is what makes the manuscript part of the world.
    const saved = repo.saveSceneText(one.sceneId, 'Cruzó el vado con [[Kaelen Vor]] detrás.');
    assert.match(saved.text, /\[Kaelen Vor\]\(nodus:\/\/world\/character\//);
    assert.equal(saved.wordCount, 7, 'the URL is not counted as words');
    // The backlink itself arrives in M4, when `entryIndexableProse` starts handing the
    // manuscript to the indexers. Promotion is what M0 owes: the two link forms must be
    // invisible to the author from the first keystroke, or the text stores `[[…]]` for
    // ever and no later phase can tell which were meant as links.

    // The property the whole table exists for.
    const listed = story.listScenes('narrative');
    assert.equal(listed.length, 2);
    assert.ok(
      listed.every((scene) => !Object.prototype.hasOwnProperty.call(scene, 'text')),
      'not one word of prose travels with the list of scenes'
    );

    repo.setChapterBreak(two.sceneId, { title: 'Segunda parte', epigraph: 'Nadie vino.' });
    const spine = repo.manuscriptSpine();
    assert.equal(spine.chapters.length, 2);
    assert.equal(spine.chapters[0].title, null, 'the run before the first break is kept');
    assert.equal(spine.chapters[1].title, 'Segunda parte');
    assert.equal(spine.totals.words, 7);
    assert.equal(spine.totals.chapters, 1);
    assert.ok(
      !JSON.stringify(spine).includes('Cruzó el vado'),
      'the spine carries counts and titles, never the prose itself'
    );

    // Removing the break merges the run upwards rather than orphaning anything.
    repo.setChapterBreak(two.sceneId, null);
    assert.equal(repo.manuscriptSpine().chapters.length, 1);

    // The diary records where the manuscript stood, and today's row is not its own baseline.
    const progress = repo.manuscriptProgress();
    assert.equal(progress.words, 7);
    assert.equal(progress.today, 7, 'the first day is the day everything was written');

    // ── M4: the prose is part of the world ─────────────────────────────────
    // The backlink now exists, because `entryIndexableProse` hands the manuscript to the
    // indexer. This is the whole payoff of the design: no code was written for it.
    const encyclopedia = require(path.join(repoRoot, 'electron/db/worldEncyclopediaRepo.ts'));
    assert.ok(
      encyclopedia
        .worldBacklinks({ kind: 'character', id: kaelen.personId })
        .some((link) => link.source.kind === 'scene' && link.source.id === one.sceneId),
      "the character's sheet knows which scene names them"
    );
    assert.ok(
      encyclopedia.searchWorldBodies('vado').some((hit) => hit.field === 'text'),
      'the manuscript is searchable like any other prose'
    );
    // But the world bible must NOT swallow the novel: entryProse stays what a reader is
    // told, and only the indexers see the manuscript.
    assert.ok(
      !encyclopedia.entryProse({ kind: 'scene', id: one.sceneId }).some((block) => block.field === 'text'),
      'entryProse — and therefore the world bible export — is unchanged'
    );
    assert.ok(
      encyclopedia.entryIndexableProse({ kind: 'scene', id: one.sceneId }).some((block) => block.field === 'text'),
      'the indexers do see it'
    );

    // A hole left mid-chapter is a decision nobody took, and it reaches «Preguntas
    // abiertas» without a line of code written for it.
    repo.saveSceneText(two.sceneId, 'El juicio empezó al ??? de la tarde.');
    const questions = require(path.join(repoRoot, 'electron/db/worldQuestionsRepo.ts'));
    assert.ok(
      questions.questionFeed().some((item) => item.anchor?.id === two.sceneId && item.anchorField === 'text'),
      'a ??? in the manuscript is an open question'
    );

    // And the check that only the manuscript makes possible: named in the text, absent
    // from the cast — so half the vault is not counting them as being there.
    const findings = require(path.join(repoRoot, 'electron/db/worldContinuityRepo.ts')).runContinuity();
    assert.ok(
      findings.some(
        (finding) => finding.checkId === 'manuscript.uncastMention' && finding.subjects.some((s) => s.id === kaelen.personId)
      ),
      'somebody in the prose and not in the cast is reported'
    );
    story.addSceneCharacter(one.sceneId, kaelen.personId);
    assert.ok(
      !require(path.join(repoRoot, 'electron/db/worldContinuityRepo.ts'))
        .runContinuity()
        .some((finding) => finding.checkId === 'manuscript.uncastMention'),
      'declaring them in the cast settles it'
    );

    // ── M7: el estante ──────────────────────────────────────────────────────
    repo.setBookStart(two.sceneId, { title: 'Libro segundo', subtitle: null, targetWords: 90000 });
    const shelf = repo.manuscriptSpine();
    assert.deepEqual(shelf.books.map((book) => book.title), [null, 'Libro segundo']);
    assert.equal(shelf.books[1].targetWords, 90000);
    // Y el orden del relato sigue siendo UNO: el libro no añade eje, agrupa un tramo.
    assert.deepEqual(
      shelf.books.flatMap((book) => book.chapters.flatMap((chapter) => chapter.scenes.map((s) => s.narrativeOrder))),
      [0, 1]
    );
    repo.setBookStart(two.sceneId, null);
    assert.equal(repo.manuscriptSpine().books.length, 1, 'quitar la marca funde el tramo con el libro de arriba');

    // ── M8: instantáneas ────────────────────────────────────────────────────
    repo.saveSceneText(two.sceneId, Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(' '));
    assert.equal(repo.listSceneSnapshots(two.sceneId).length, 0, 'escribir no genera instantáneas');
    // Un pegado que se come la escena la guarda solo: es el momento en que nadie se acuerda
    // de pulsar nada.
    repo.saveSceneText(two.sceneId, 'Cuatro palabras nada más.');
    const auto = repo.listSceneSnapshots(two.sceneId);
    assert.equal(auto.length, 1);
    assert.equal(auto[0].reason, 'shrink');
    assert.equal(auto[0].wordCount, 60);
    assert.ok(!Object.prototype.hasOwnProperty.call(auto[0], 'text'), 'la lista no lleva el texto');

    // Restaurar es una edición destructiva, así que guarda antes lo que hay: un deshacer
    // que no se puede deshacer es una trampa.
    repo.restoreSceneSnapshot(auto[0].snapshotId);
    assert.match(repo.getSceneText(two.sceneId).text, /palabra0 palabra1/);
    // ISO timestamps only resolve to milliseconds. Force the collision that happens under
    // load so insertion order, never a random UUID, decides which undo is the newest.
    db.prepare("UPDATE world_scene_snapshots SET created_at = '2026-07-28T12:00:00.000Z' WHERE scene_id = ?").run(two.sceneId);
    const afterRestore = repo.listSceneSnapshots(two.sceneId);
    assert.equal(afterRestore.length, 2);
    assert.equal(afterRestore[0].wordCount, 4, 'lo que había antes de restaurar');

    // Cutting a scene takes its prose and its chapter with it: no cascade reaches them.
    repo.setChapterBreak(two.sceneId, { title: 'Vuelve' });
    story.deleteScene(two.sceneId);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM world_chapter_breaks').get().c, 0);
    story.deleteScene(one.sceneId);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM world_scene_text').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM world_scene_snapshots').get().c, 0, 'snapshots go too');
    // And it is an editing decision, not a database error: v100 declares no foreign keys.
    characters.deleteCharacter(kaelen.personId);
  }

  console.log('Manuscript database test passed!');
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
