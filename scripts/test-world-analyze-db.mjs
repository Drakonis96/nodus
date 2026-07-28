// The "Analizar" layer (schema v99) against a REAL migrated vault.
//
// The five sections of that group share one skeleton, because all five are readings of a
// single statement the vault could not store before: "in this scene, this moves like so".
// This file guards the shape that makes the sharing safe — the content-derived keys that
// keep rewriting a set from churning tombstones, and the absence of the foreign keys that
// would turn "cut this scene" into a database error.

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

if (!process.argv.includes('--electron-analyze-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-world-analyze-db.mjs'), '--electron-analyze-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-analyze-test-'));
installRuntimeHooks(root);

const NEW_TABLES = [
  'world_scene_days',
  'world_threads',
  'thread_parties',
  'world_beats',
  'world_rules',
  'world_questions',
  'world_question_options',
  'world_notice_mutes',
];

try {
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION, migrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const db = getDb();

  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 99, 'the Analizar layer arrived at v99');

  // ── 0. The migration keeps both of its repair paths ───────────────────────
  {
    const m99 = migrations.find((m) => m.version === 99);
    assert.ok(m99, 'migration 99 exists');
    assert.ok(!m99.up.includes('`'), 'a backtick would silently terminate the template literal');
    const bare = m99.up.replace(/--[^\n]*/g, ' ');
    assert.doesNotMatch(bare, /ON DELETE/i, 'a cascade disqualifies the migration from isCreateOnly');
    assert.doesNotMatch(bare, /\b(ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i, 'migration 99 is CREATE-only');
    // No foreign keys at all. `foreign_keys` is ON, so a REFERENCES with no declared
    // action uses NO ACTION and ABORTS the parent delete: cutting a scene would become a
    // database error instead of an editing decision.
    assert.doesNotMatch(bare, /REFERENCES/i, 'ownership is enforced by the repo, not by the schema');
  }

  // ── 1. The tables, and the keys the design depends on ─────────────────────
  for (const table of NEW_TABLES) {
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?").get(table).c,
      1,
      `${table} exists`
    );
  }
  const keyOf = (table) =>
    db.prepare('SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk').all(table).map((row) => row.name);

  // Content-derived, all three. A surrogate id on any of them turns every save of the
  // set into one permanent tombstone per row, syncing a phantom deletion forever.
  assert.deepEqual(keyOf('world_beats'), ['thread_kind', 'thread_id', 'scene_id']);
  assert.deepEqual(keyOf('thread_parties'), ['thread_id', 'party_kind', 'party_id']);
  assert.deepEqual(keyOf('world_notice_mutes'), ['fingerprint']);
  // `side` is deliberately NOT part of the party key: one entity on both sides of the
  // same conflict is a contradiction, and the key rejecting it is a feature.
  assert.ok(!keyOf('thread_parties').includes('side'));

  // ── 2. Everything travels, and its deletions travel too ───────────────────
  {
    const { describeSyncCoverage } = require(path.join(repoRoot, 'electron/db/syncTables.ts'));
    const coverage = describeSyncCoverage();
    assert.deepEqual(coverage.unclassified, [], 'no table is left unclassified');
    assert.deepEqual(coverage.unmergeable, [], 'every synced table has a row identity');
    for (const table of NEW_TABLES) {
      assert.ok(coverage.included.worldbuilding.includes(table), `${table} travels`);
    }
  }
  {
    // The tombstone triggers are generated from the sync list, so this asserts the two
    // lists really are one: a table that syncs but whose deletions do not propagate
    // resurrects itself on every future merge, in both directions.
    const triggers = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'nodus_tomb_%'")
        .all()
        .map((row) => row.name)
    );
    for (const table of NEW_TABLES) {
      assert.ok(triggers.has(`nodus_tomb_del_${table}`), `${table} records its deletions`);
      assert.ok(triggers.has(`nodus_tomb_ins_${table}`), `${table} clears them on re-insert`);
    }
  }

  // ── 3. Rewriting a set leaves no tombstone behind ─────────────────────────
  // The property the content-derived keys exist for, asserted at the SQL level before any
  // repo depends on it.
  {
    const ts = '2026-07-28T00:00:00.000Z';
    const write = () => {
      db.prepare('DELETE FROM world_beats WHERE thread_kind = ? AND thread_id = ?').run('arc', 'thr_1');
      db.prepare(
        `INSERT INTO world_beats (thread_kind, thread_id, scene_id, mark, text, created_at, updated_at)
         VALUES ('arc', 'thr_1', 'scn_1', 'step', 'algo cambia', ?, ?)`
      ).run(ts, ts);
    };
    write();
    db.prepare("DELETE FROM sync_tombstones WHERE table_name = 'world_beats'").run();
    write();
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM sync_tombstones WHERE table_name = 'world_beats'").get().c,
      0,
      'an unchanged row re-inserts under the same key and clears its own tombstone'
    );
    db.prepare('DELETE FROM world_beats WHERE thread_id = ?').run('thr_1');
    db.prepare("DELETE FROM sync_tombstones WHERE table_name = 'world_beats'").run();
  }

  // ── 4. The chain of days writes the canonical world_day ───────────────────
  {
    const story = require(path.join(repoRoot, 'electron/db/worldStoryRepo.ts'));
    const a = story.createScene({ title: 'Uno' });
    const b = story.createScene({ title: 'Dos' });
    const c = story.createScene({ title: 'Tres' });

    story.setSceneDayLink(a.sceneId, { mode: 'anchor', offsetDays: 0, anchorWorldDay: 412 });
    story.setSceneDayLink(b.sceneId, { mode: 'offset', offsetDays: 3, anchorWorldDay: null });
    story.setSceneDayLink(c.sceneId, { mode: 'same', offsetDays: 0, anchorWorldDay: null });

    const dayOf = (id) => db.prepare('SELECT world_day FROM world_scenes WHERE scene_id = ?').get(id).world_day;
    assert.equal(dayOf(a.sceneId), 412, 'the anchor is written to the canonical column');
    assert.equal(dayOf(b.sceneId), 415);
    assert.equal(dayOf(c.sceneId), 415);

    // Reordering must re-date, not just renumber. A chain edited without recomputing
    // leaves the world ordered and WRONG, in silence.
    story.reorderScene(c.sceneId, 0);
    assert.equal(dayOf(c.sceneId), 0, 'the scene that now leads carries no inherited day');
    assert.equal(dayOf(a.sceneId), 412, 'and the anchor re-pins the line behind it');
    assert.equal(dayOf(b.sceneId), 415);

    const orders = db
      .prepare('SELECT narrative_order FROM world_scenes ORDER BY narrative_order')
      .all()
      .map((row) => row.narrative_order);
    assert.deepEqual(orders, [0, 1, 2], 'every scene is renumbered, so no two share a slot');

    // Clearing a declaration falls back to the default (same day as the previous), and
    // recomputes rather than leaving a stale number behind.
    story.clearSceneDayLink(b.sceneId);
    assert.equal(dayOf(b.sceneId), 412);

    for (const scene of [a, b, c]) story.deleteScene(scene.sceneId);
  }

  // ── 5. Threads, parties and beats through the repo ────────────────────────
  {
    const repo = require(path.join(repoRoot, 'electron/db/worldThreadsRepo.ts'));
    const story = require(path.join(repoRoot, 'electron/db/worldStoryRepo.ts'));
    const characters = require(path.join(repoRoot, 'electron/db/charactersRepo.ts'));
    const groups = require(path.join(repoRoot, 'electron/db/worldGroupsRepo.ts'));

    const kaelen = characters.createCharacter({ displayName: 'Kaelen Vor' });
    const cuervos = groups.createWorldGroup({ kind: 'faction', name: 'Los Cuervos' });
    const scene = story.createScene({ title: 'El vado' });

    const war = repo.createWorldThread({ kind: 'conflict', title: 'La guerra por el vado', stakes: 'El paso' });
    repo.setThreadParties(war.threadId, [
      { partyKind: 'character', partyId: kaelen.personId, side: 'wants' },
      { partyKind: 'group', partyId: cuervos.groupId, side: 'opposes' },
    ]);

    const loaded = repo.getWorldThread(war.threadId);
    assert.equal(loaded.parties.length, 2);
    assert.deepEqual(loaded.parties.map((p) => p.partyName).sort(), ['Kaelen Vor', 'Los Cuervos']);

    // Rewriting the set must not churn tombstones: the key is content-derived precisely
    // so an unchanged party re-inserts over itself.
    db.prepare("DELETE FROM sync_tombstones WHERE table_name = 'thread_parties'").run();
    repo.setThreadParties(war.threadId, [
      { partyKind: 'character', partyId: kaelen.personId, side: 'wants' },
      { partyKind: 'group', partyId: cuervos.groupId, side: 'opposes' },
    ]);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM sync_tombstones WHERE table_name = 'thread_parties'").get().c,
      0,
      'saving the same parties twice leaves no phantom deletion'
    );

    repo.setWorldBeat({ threadKind: 'conflict', threadId: war.threadId, sceneId: scene.sceneId, mark: 'raise' });
    let beats = repo.beatsForScene(scene.sceneId);
    assert.equal(beats.length, 1);
    assert.equal(beats[0].threadTitle, 'La guerra por el vado', 'the title is joined for the UI');
    assert.equal(beats[0].paid, null, 'NULL means "not looked at", never "not paid"');

    // A thread either moves a scene or it does not: it is a set, so re-marking replaces.
    repo.setWorldBeat({ threadKind: 'conflict', threadId: war.threadId, sceneId: scene.sceneId, mark: 'turn', text: 'Cambia de bando' });
    beats = repo.beatsForScene(scene.sceneId);
    assert.equal(beats.length, 1);
    assert.equal(beats[0].mark, 'turn');
    assert.equal(beats[0].text, 'Cambia de bando');

    // Deleting a party's entity must not fail, and must not leave the beat claiming it
    // was in favour of somebody who no longer exists.
    repo.setWorldBeat({
      threadKind: 'conflict',
      threadId: war.threadId,
      sceneId: scene.sceneId,
      mark: 'raise',
      subjectKind: 'group',
      subjectId: cuervos.groupId,
    });
    groups.deleteWorldGroup(cuervos.groupId);
    assert.equal(repo.getWorldThread(war.threadId).parties.length, 1, 'the party is gone');
    assert.equal(repo.beatsForScene(scene.sceneId)[0].subjectId, null, 'and the beat no longer names it');

    // Cutting a scene is an editing decision, not a database error: with a foreign key
    // this line would throw instead of deleting.
    story.deleteScene(scene.sceneId);
    assert.equal(repo.listWorldBeats().length, 0, 'the beats go with the scene');

    repo.deleteWorldThread(war.threadId);
    characters.deleteCharacter(kaelen.personId);
  }

  // ── 6. Continuity over the real vault ─────────────────────────────────────
  {
    const cont = require(path.join(repoRoot, 'electron/db/worldContinuityRepo.ts'));
    const story = require(path.join(repoRoot, 'electron/db/worldStoryRepo.ts'));
    const characters = require(path.join(repoRoot, 'electron/db/charactersRepo.ts'));
    const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));

    const kaelen = characters.createCharacter({ displayName: 'Kaelen Vor' });
    const vael = entities.createPlace({ name: 'Vael' });
    const puerto = entities.createPlace({ name: 'Puerto Gris' });
    const a = story.createScene({ title: 'En Vael', placeId: vael.placeId });
    const b = story.createScene({ title: 'En el puerto', placeId: puerto.placeId });
    story.addSceneCharacter(a.sceneId, kaelen.personId);
    story.addSceneCharacter(b.sceneId, kaelen.personId);
    // Both scenes on the SAME world day: the chain defaults to "same day as the previous".
    story.setSceneDayLink(a.sceneId, { mode: 'anchor', offsetDays: 0, anchorWorldDay: 412 });
    story.setSceneDayLink(b.sceneId, { mode: 'same', offsetDays: 0, anchorWorldDay: null });

    const found = cont.runContinuity();
    const bilocation = found.find((finding) => finding.checkId === 'presence.bilocation');
    assert.ok(bilocation, 'two places on one day is a contradiction over the real vault');
    assert.equal(bilocation.severity, 'contradiction');
    assert.ok(
      bilocation.subjects.some((subject) => subject.kind === 'character' && subject.id === kaelen.personId),
      'and the character is one of its subjects, so the badge on their sheet finds it'
    );

    // Silencing it takes it out of the list, and the silence sticks across a recompute.
    cont.muteNotice({
      fingerprint: bilocation.fingerprint,
      checkId: bilocation.checkId,
      subjects: bilocation.subjects,
      headline: 'Está en dos sitios',
      reasonCode: 'double',
    });
    assert.equal(
      cont.runContinuity().some((finding) => finding.fingerprint === bilocation.fingerprint),
      false,
      'a silenced finding stays silent'
    );
    assert.equal(
      cont.runContinuityUnfiltered().some((finding) => finding.fingerprint === bilocation.fingerprint),
      true,
      'but the exceptions screen can still see it'
    );

    // THE POINT OF A NUMBERLESS FINGERPRINT: moving the date must not resurrect it.
    story.setSceneDayLink(a.sceneId, { mode: 'anchor', offsetDays: 0, anchorWorldDay: 411 });
    assert.equal(
      cont.runContinuity().some((finding) => finding.checkId === 'presence.bilocation'),
      false,
      'changing the day must not bring back an exception the author already judged'
    );

    // Muting the same thing twice is one row, and leaves no tombstone churn.
    db.prepare("DELETE FROM sync_tombstones WHERE table_name = 'world_notice_mutes'").run();
    cont.muteNotice({
      fingerprint: bilocation.fingerprint,
      checkId: bilocation.checkId,
      subjects: bilocation.subjects,
      headline: 'Está en dos sitios',
      reasonCode: 'told',
    });
    assert.equal(cont.listNoticeMutes().length, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM sync_tombstones WHERE table_name = 'world_notice_mutes'").get().c,
      0
    );

    cont.unmuteNotice(bilocation.fingerprint);
    assert.equal(cont.listNoticeMutes().length, 0);

    for (const scene of [a, b]) story.deleteScene(scene.sceneId);
    characters.deleteCharacter(kaelen.personId);
  }

  // ── 8. Open questions: the only writes this layer makes into a sheet ──────
  {
    const repo = require(path.join(repoRoot, 'electron/db/worldQuestionsRepo.ts'));
    const story = require(path.join(repoRoot, 'electron/db/worldStoryRepo.ts'));
    const characters = require(path.join(repoRoot, 'electron/db/charactersRepo.ts'));

    const kaelen = characters.createCharacter({
      displayName: 'Kaelen Vor',
      backstory: 'Nació en ??? y creció lejos del vado.',
    });
    const scene = story.createScene({ title: 'El juicio' });
    story.addSceneCharacter(scene.sceneId, kaelen.personId);

    // The hole is DERIVED, not stored. Nothing was written when the character was.
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM world_questions').get().c, 0);
    const feed = repo.questionFeed();
    const hole = feed.find((item) => item.originKey === `ph:character:${kaelen.personId}:backstory`);
    assert.ok(hole, 'the hole in the backstory shows up on its own');
    assert.equal(hole.questionId, null, 'and it has no row until somebody touches it');
    assert.equal(hole.evidence, 'Nació en ??? y creció lejos del vado.');
    assert.equal(hole.blockedScene?.sceneId, scene.sceneId, 'the unwritten scene it appears in blocks on it');

    // Touching it materialises exactly one row, however many times it is touched.
    const stored = repo.ensureQuestion({
      question: hole.question,
      originKey: hole.originKey,
      origin: 'placeholder',
      anchorKind: 'character',
      anchorId: kaelen.personId,
      anchorField: 'backstory',
    });
    const again = repo.ensureQuestion({ question: 'otra redacción', originKey: hole.originKey });
    assert.equal(again.questionId, stored.questionId, 'the origin key de-duplicates by hand');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM world_questions').get().c, 1);

    // Answering REPLACES the hole in the character's own sheet.
    const option = repo.setQuestionOption({ questionId: stored.questionId, text: 'la casa del carcelero' });
    assert.equal(option.applyMode, 'fill_field', 'the destination is inferred from the anchor');
    repo.applyQuestionOption(option.optionId);
    const backstoryOf = () =>
      db.prepare('SELECT backstory FROM character_profiles WHERE person_id = ?').get(kaelen.personId).backstory;
    assert.equal(backstoryOf(), 'Nació en la casa del carcelero y creció lejos del vado.');
    assert.equal(repo.getWorldQuestion(stored.questionId).status, 'answered');
    assert.equal(repo.canUndoOption(option.optionId), true);

    // And the undo puts back exactly what was there.
    repo.undoQuestionOption(option.optionId);
    assert.equal(backstoryOf(), 'Nació en ??? y creció lejos del vado.');
    assert.equal(repo.getWorldQuestion(stored.questionId).status, 'open');
    assert.equal(repo.canUndoOption(option.optionId), false, 'nothing is applied any more');

    // Rewritten afterwards, the offer disappears rather than the prose.
    repo.applyQuestionOption(option.optionId);
    characters.updateCharacter(kaelen.personId, { backstory: 'Nació donde nadie mira.' });
    assert.equal(repo.canUndoOption(option.optionId), false);
    repo.undoQuestionOption(option.optionId);
    assert.equal(backstoryOf(), 'Nació donde nadie mira.', 'a refused undo writes nothing at all');

    // A question with no anchor writes an article instead, and its links are indexed.
    const worldWide = repo.ensureQuestion({ question: '¿La magia deja marca visible?', origin: 'author' });
    const articleOption = repo.setQuestionOption({
      questionId: worldWide.questionId,
      text: 'Sí: una quemadura que no cura, y [[Kaelen Vor]] la lleva.',
    });
    assert.equal(articleOption.applyMode, 'create_article');
    repo.applyQuestionOption(articleOption.optionId);
    const article = db
      .prepare('SELECT article_id, summary FROM world_articles WHERE title = ?')
      .get('La magia deja marca visible');
    assert.ok(article, 'the article is created from the question, not from a form');
    assert.match(article.summary, /nodus:\/\/world\/character\//, 'its `[[…]]` became a real link');

    // A profile row that does not exist yet must be CREATED, not silently missed: the
    // profile tables hang off their parent by a LEFT JOIN everywhere they are read.
    db.prepare('DELETE FROM character_profiles WHERE person_id = ?').run(kaelen.personId);
    const orphan = repo.ensureQuestion({
      question: '¿Cómo es de cerca?',
      origin: 'author',
      anchorKind: 'character',
      anchorId: kaelen.personId,
      anchorField: 'appearance',
    });
    const look = repo.setQuestionOption({ questionId: orphan.questionId, text: 'Alto y enjuto.' });
    repo.applyQuestionOption(look.optionId);
    assert.equal(
      db.prepare('SELECT appearance FROM character_profiles WHERE person_id = ?').get(kaelen.personId).appearance,
      'Alto y enjuto.'
    );

    // Deleting the anchor keeps the author's sentence and drops the pending write.
    characters.deleteCharacter(kaelen.personId);
    const orphaned = repo.getWorldQuestion(orphan.questionId);
    assert.equal(orphaned.question, '¿Cómo es de cerca?');
    assert.equal(orphaned.anchorTitle, null, 'no title means the sheet is gone');
    assert.ok(repo.questionFeed(true).every((item) => item.questionId !== orphan.questionId || item.anchor === null));

    story.deleteScene(scene.sceneId);
    for (const row of db.prepare('SELECT question_id FROM world_questions').all()) {
      repo.deleteWorldQuestion(row.question_id);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM world_question_options').get().c, 0, 'options go with it');
  }

  console.log('Analyze layer database test passed!');
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
