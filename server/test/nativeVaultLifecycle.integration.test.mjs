import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import { withServer } from '../../scripts/lib/nodusServerHarness.mjs';
import { loadCanonicalMigrations } from '../lib/nativeMigrations.mjs';
import { NativeVaultStore } from '../lib/nativeVaultStore.mjs';

const TYPES = ['academic', 'estudio', 'primary_sources', 'genealogy', 'prosopography', 'databases', 'testimonios', 'worldbuilding', 'docencia'];
const { SCHEMA_VERSION } = await loadCanonicalMigrations();
const HOME_COLLECTION = {
  academic: 'ideas', estudio: 'study-courses', primary_sources: 'archive-items',
  genealogy: 'persons', prosopography: 'persons', databases: 'databases',
  testimonios: 'testimony-interviews', worldbuilding: 'world-entries', docencia: 'teaching-exams',
};

async function nativeRequest(ctx, method, pathname, json, cookie = ctx.adminCookie) {
  const headers = { cookie, origin: ctx.origin };
  if (json !== undefined) { headers['content-type'] = 'application/json'; headers['x-csrf-token'] = await ctx.csrf(cookie); }
  return fetch(`${ctx.origin}${pathname}`, { method, headers, ...(json === undefined ? {} : { body: JSON.stringify(json) }) });
}

test('server-native lifecycle supports all nine vault types and keeps metadata in SQLite', async () => {
  await withServer({ label: 'native-lifecycle' }, async (ctx) => {
    const created = [];
    let response;
    for (const type of TYPES) {
      response = await nativeRequest(ctx, 'POST', '/api/v2/vaults', { name: `Native ${type}`, vaultType: type });
      assert.equal(response.status, 201, type);
      const payload = await response.json(); created.push(payload.vault);
      assert.equal(payload.vault.storageKind, 'server_native');
      assert.equal(payload.vault.authorityMode, 'server');
      assert.equal(payload.vault.schemaVersion, Number(SCHEMA_VERSION));
      assert.equal(payload.vault.initializationState, 'ready');
      assert.ok(fs.existsSync(`${ctx.root}/vaults/${payload.vault.id}/vault.sqlite`));
    }
    const list = await nativeRequest(ctx, 'GET', '/api/v2/vaults');
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).vaults.map((vault) => vault.vaultType).sort(), [...TYPES].sort());

    // The existing web contract must be able to open every newly-created native
    // vault before it has a published snapshot. Collection reads are an empty,
    // revisioned projection; private annotations stay on their own API route.
    for (const vault of created) {
      response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}`);
      assert.equal(response.status, 200, `${vault.vaultType} summary`);
      assert.equal((await response.json()).vault.type, vault.vaultType);
      response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}/${HOME_COLLECTION[vault.vaultType]}`);
      assert.equal(response.status, 200, `${vault.vaultType} Home collection`);
      assert.deepEqual((await response.json()).items, []);
      response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}/personal-annotations`);
      assert.equal(response.status, 200, `${vault.vaultType} private annotations`);
      assert.deepEqual((await response.json()).annotations, []);
    }

    const vault = created[0];
    response = await nativeRequest(ctx, 'PATCH', `/api/v2/vaults/${vault.id}`, { name: 'Renamed', expectedRevision: 0 });
    assert.equal(response.status, 200); const renamed = (await response.json()).vault;
    assert.equal(renamed.revision, 1); assert.equal(renamed.name, 'Renamed');
    response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}`);
    assert.equal(response.status, 200); assert.equal((await response.json()).vault.type, 'academic');
    response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}/ideas`);
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).items, []);
    response = await nativeRequest(ctx, 'PATCH', `/api/v2/vaults/${vault.id}`, { name: 'Stale', expectedRevision: 0 });
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'revision_conflict');

    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/commands`, { kind: 'pages.update', idempotencyKey: 'native-test-1', expectedRevision: 1, payload: { pageId: 'p1' } });
    assert.equal(response.status, 201); const command = (await response.json()).command;
    assert.equal(command.status, 'queued');
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/commands`, { kind: 'pages.update', idempotencyKey: 'native-test-1', expectedRevision: 1, payload: { pageId: 'p1' } });
    assert.equal(response.status, 200); assert.equal((await response.json()).duplicate, true);
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/commands`, { kind: 'pages.update', idempotencyKey: 'native-test-1', expectedRevision: 1, payload: { pageId: 'other' } });
    assert.equal(response.status, 409);

    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/duplicate`, { name: 'Duplicate' });
    assert.equal(response.status, 201); const duplicate = (await response.json()).vault;
    assert.equal(duplicate.storageKind, 'server_native');
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${duplicate.id}/reset`, { expectedRevision: 0 });
    assert.equal(response.status, 200); assert.equal((await response.json()).vault.revision, 1);

    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${vault.id}/export`);
    assert.equal(response.status, 200); const exported = Buffer.from(await response.arrayBuffer()); assert.ok(exported.length > 1000);
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/import`, { base64: exported.toString('base64'), expectedRevision: 1 });
    assert.equal(response.status, 200); assert.equal((await response.json()).vault.id, vault.id);
    response = await fetch(`${ctx.origin}/api/v2/vaults/${vault.id}/import`, { method: 'POST', headers: { cookie: ctx.adminCookie, origin: ctx.origin, 'content-type': 'application/vnd.sqlite3', 'x-csrf-token': await ctx.csrf() }, body: exported });
    assert.equal(response.status, 200); assert.equal((await response.json()).vault.id, vault.id);
    response = await nativeRequest(ctx, 'DELETE', `/api/v2/vaults/${duplicate.id}?expectedRevision=1`, {});
    assert.equal(response.status, 200); assert.equal(fs.existsSync(`${ctx.root}/vaults/${duplicate.id}`), false);
  });
});

test('native vault permissions enforce owner, writer and reader roles', async () => {
  await withServer({ label: 'native-roles' }, async (ctx) => {
    const response = await nativeRequest(ctx, 'POST', '/api/v2/vaults', { name: 'Role vault', vaultType: 'academic' });
    const vault = (await response.json()).vault;
    const writer = { email: 'native-writer@example.test', password: 'native-writer-password' };
    const reader = { email: 'native-reader@example.test', password: 'native-reader-password' };
    await ctx.createUser(writer.email, writer.password, [{ spaceId: vault.id, role: 'writer' }]);
    await ctx.createUser(reader.email, reader.password, [{ spaceId: vault.id, role: 'reader' }]);
    const writerCookie = await ctx.signIn(writer.email, writer.password);
    const readerCookie = await ctx.signIn(reader.email, reader.password);
    const writerDevice = await ctx.deviceToken(writer.email, writer.password, vault.id, 'Native writer device');
    assert.equal((await nativeRequest(ctx, 'GET', `/api/v2/vaults/${vault.id}`, undefined, readerCookie)).status, 200);
    assert.equal((await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/commands`, { kind: 'pages.update', idempotencyKey: 'reader', expectedRevision: 0, payload: {} }, readerCookie)).status, 403);
    assert.equal((await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/commands`, { kind: 'pages.update', idempotencyKey: 'writer', expectedRevision: 0, payload: {} }, writerCookie)).status, 201);
    assert.equal((await ctx.api(writerDevice.deviceToken, 'POST', `/api/v2/vaults/${vault.id}/commands`, { json: { kind: 'pages.update', idempotencyKey: 'writer-device', expectedRevision: 0, payload: {} } })).status, 201);
    assert.equal((await nativeRequest(ctx, 'PATCH', `/api/v2/vaults/${vault.id}`, { name: 'Nope', expectedRevision: 0 }, writerCookie)).status, 403);
  });
});

test('native content boundary applies CRUD atomically and fails closed by vault family', async () => {
  await withServer({ label: 'native-content-boundary' }, async (ctx) => {
    let response = await nativeRequest(ctx, 'POST', '/api/v2/vaults', { name: 'Study authoring', vaultType: 'estudio' });
    const study = (await response.json()).vault;
    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${study.id}/content-contract`);
    assert.equal(response.status, 200);
    const contract = await response.json();
    assert.deepEqual(contract.tables.study_courses.key, ['id']);
    assert.equal(contract.tables.notes, undefined, 'user-scoped notes must never enter a vault contract');

    const course = { id: 'course-1', short_id: 'C1', name: 'Historia' };
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${study.id}/content/study_courses`, { row: course, expectedRevision: 0, idempotencyKey: 'content-create-1' });
    assert.equal(response.status, 201); assert.equal((await response.json()).revision, 1);
    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${study.id}/content/study_courses`);
    assert.equal(response.status, 200); assert.equal((await response.json()).rows[0].name, 'Historia');
    response = await nativeRequest(ctx, 'PATCH', `/api/v2/vaults/${study.id}/content/study_courses/course-1`, { key: { id: 'course-1' }, row: { name: 'Historia moderna' }, expectedRevision: 1, idempotencyKey: 'content-update-1' });
    assert.equal(response.status, 200); assert.equal((await response.json()).revision, 2);
    response = await nativeRequest(ctx, 'DELETE', `/api/v2/vaults/${study.id}/content/study_courses/course-1`, { key: { id: 'course-1' }, expectedRevision: 2, idempotencyKey: 'content-delete-1' });
    assert.equal(response.status, 200); assert.equal((await response.json()).revision, 3);
    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${study.id}/content/study_courses`);
    assert.deepEqual((await response.json()).rows, []);

    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${study.id}/content/study_courses`, { row: course, expectedRevision: 3, idempotencyKey: 'content-invalid-json' });
    assert.equal(response.status, 201);
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${study.id}/content/study_courses`, { row: { id: 'partial' }, expectedRevision: 4, idempotencyKey: 'content-partial' });
    assert.equal(response.status, 400); assert.equal((await response.json()).error, 'missing_required_column');
    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${study.id}`);
    assert.equal((await response.json()).vault.revision, 4, 'a rejected create must not increment revision');

    response = await nativeRequest(ctx, 'POST', '/api/v2/vaults', { name: 'Academic authoring', vaultType: 'academic' });
    const academic = (await response.json()).vault;
    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${academic.id}/content/world_groups`);
    assert.equal(response.status, 400, 'a writer must not cross into another vault family');

    const legacyId = await ctx.createSpace('Published legacy');
    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${legacyId}/content-contract`);
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'desktop_published_read_only');
  });
});

test('CLI SQLite fallback keeps domain row, revision and command log atomic', async () => {
  const root = fs.mkdtempSync(`${os.tmpdir()}/nodus-native-cli-`);
  try {
    const store = new NativeVaultStore(root, { Database: null });
    const vault = await store.create({ id: 'cli-atomic', name: 'CLI atomic', vaultType: 'estudio' });
    const first = await store.mutateContent(vault.id, 'study_courses', 'estudio', 'create', {
      expectedRevision: 0, idempotencyKey: 'cli-create-1', row: { id: 'course-1', short_id: 'C1', name: 'Curso' },
    }, 'cli-user');
    assert.equal(first.revision, 1); assert.equal((await store.listCommands(vault.id)).length, 1);
    await assert.rejects(() => store.mutateContent(vault.id, 'study_courses', 'estudio', 'create', {
      expectedRevision: 1, idempotencyKey: 'cli-create-duplicate', row: { id: 'course-1', short_id: 'C1', name: 'Duplicado' },
    }, 'cli-user'), (error) => error.code === 'content_constraint');
    assert.equal((await store.get(vault.id)).revision, 1);
    assert.equal((await store.listContent(vault.id, 'study_courses', 'estudio')).rows.length, 1);
    assert.equal((await store.listCommands(vault.id)).length, 1, 'failed domain SQL must not leave a command row');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('private teaching, study and testimony tables stay native-only and role-scoped', async () => {
  await withServer({ label: 'native-private-domains' }, async (ctx) => {
    const create = async (vaultType) => {
      const response = await nativeRequest(ctx, 'POST', '/api/v2/vaults', { name: `Native ${vaultType}`, vaultType });
      assert.equal(response.status, 201);
      return (await response.json()).vault;
    };
    const teaching = await create('docencia');
    const study = await create('estudio');
    const testimony = await create('testimonios');

    for (const [vault, tables] of [
      [teaching, ['teaching_groups', 'teaching_students', 'teaching_assessment_plans', 'teaching_assessment_items', 'teaching_grade_entries', 'teaching_rubric_evaluations']],
      [study, ['study_attempts', 'study_attempt_answers', 'study_grading_runs', 'study_grading_annotations', 'study_srs_state', 'study_reviews', 'study_mastery']],
      [testimony, ['testimony_participant_profiles', 'testimony_interview_participants', 'testimony_media', 'testimony_agreements']],
    ]) {
      let response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${vault.id}/content-contract`);
      assert.equal(response.status, 200);
      const contract = await response.json();
      for (const table of tables) {
        assert.ok(contract.tables[table], `${table} is available to its native vault`);
        response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${vault.id}/content/${table}`);
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).rows, []);
      }
    }

    const createNative = async (vault, table, row, expectedRevision, idempotencyKey, cookie = ctx.adminCookie) => {
      const response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/content/${table}`, { row, expectedRevision, idempotencyKey }, cookie);
      assert.equal(response.status, 201, table);
      return response.json();
    };
    await createNative(teaching, 'study_courses', { id: 'course-1', short_id: 'C1', name: 'Synthetic course' }, 0, 'private-course');
    await createNative(teaching, 'study_subjects', { id: 'subject-1', short_id: 'S1', course_id: 'course-1', name: 'Synthetic subject' }, 1, 'private-subject');
    await createNative(teaching, 'teaching_groups', { id: 'group-1', short_id: 'G1', name: 'Synthetic group', subject_id: 'subject-1' }, 2, 'private-group');
    await createNative(teaching, 'teaching_students', { id: 'student-1', group_id: 'group-1', given_names: 'Synthetic', surnames: 'Student', pseudonym_code: 'STU-1' }, 3, 'private-student');
    const roster = await (await nativeRequest(ctx, 'GET', `/api/v2/vaults/${teaching.id}/content/teaching_students`)).json();
    assert.equal(roster.rows.length, 1);
    assert.equal(roster.rows[0].given_names, undefined, 'roster list minimizes identity fields');
    assert.equal(roster.rows[0].surnames, undefined, 'roster list minimizes identity fields');
    assert.equal(roster.rows[0].pseudonym_code, 'STU-1');

    // Media metadata is writable to an authenticated native owner, while the blob
    // itself is never part of the contract or response.
    let response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${testimony.id}/content/testimony_media`, {
      row: { id: 'media-owner', session_id: 'session-1', media_kind: 'audio', role: 'master', file_name: 'synthetic.wav', mime_type: 'audio/wav', created_at: '2026-01-01T00:00:00.000Z' },
      expectedRevision: 0, idempotencyKey: 'native-media-owner',
    });
    assert.equal(response.status, 201);
    const contract = await (await nativeRequest(ctx, 'GET', `/api/v2/vaults/${testimony.id}/content-contract`)).json();
    assert.equal(contract.tables.testimony_media.columns.includes('content_blob'), false);
    const listed = await (await nativeRequest(ctx, 'GET', `/api/v2/vaults/${testimony.id}/content/testimony_media`)).json();
    assert.equal(listed.rows[0].content_blob, undefined);

    const writer = { email: 'native-private-writer@example.test', password: 'native-private-writer-password' };
    const reader = { email: 'native-private-reader@example.test', password: 'native-private-reader-password' };
    await ctx.createUser(writer.email, writer.password, [{ spaceId: testimony.id, role: 'writer' }]);
    await ctx.createUser(reader.email, reader.password, [{ spaceId: testimony.id, role: 'reader' }]);
    const writerCookie = await ctx.signIn(writer.email, writer.password);
    const readerCookie = await ctx.signIn(reader.email, reader.password);
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${testimony.id}/content/testimony_media`, {
      row: { id: 'media-writer', session_id: 'session-1', media_kind: 'audio', role: 'derivative', file_name: 'synthetic-clean.wav', mime_type: 'audio/wav', created_at: '2026-01-01T00:00:00.000Z' },
      expectedRevision: 1, idempotencyKey: 'native-media-writer',
    }, writerCookie);
    assert.equal(response.status, 201);
    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${testimony.id}/content/testimony_media`, undefined, readerCookie);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rows.length, 2);
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${testimony.id}/content/testimony_media`, {
      row: { id: 'media-reader', session_id: 'session-1', media_kind: 'audio', role: 'derivative', file_name: 'should-not-write.wav', mime_type: 'audio/wav', created_at: '2026-01-01T00:00:00.000Z' },
      expectedRevision: 2, idempotencyKey: 'native-media-reader',
    }, readerCookie);
    assert.equal(response.status, 403);

    // The same tables remain permanently unavailable through a desktop-published space.
    const legacyId = await ctx.createSpace('Published private legacy');
    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${legacyId}/content/testimony_media`);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'desktop_published_read_only');
  });
});

test('academic native authoring covers canonical ideas, works, authors, passages, themes and gaps', async () => {
  await withServer({ label: 'native-academic-content' }, async (ctx) => {
    let response = await nativeRequest(ctx, 'POST', '/api/v2/vaults', { name: 'Academic content', vaultType: 'academic' });
    const vault = (await response.json()).vault;
    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${vault.id}/content-contract`);
    const contract = await response.json();
    for (const table of ['ideas', 'works', 'authors', 'passages', 'themes', 'gaps']) assert.ok(contract.tables[table], table);
    assert.equal(contract.tables.ideas.columns.includes('embedding'), false, 'embeddings are never part of the authoring contract');

    const create = async (table, row, revision, idem) => {
      const result = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/content/${table}`, { row, expectedRevision: revision, idempotencyKey: idem });
      assert.equal(result.status, 201, table); return result.json();
    };
    await create('works', { nodus_id: 'work-1', title: 'Obra' }, 0, 'academic-work');
    await create('ideas', { global_id: 'idea-1', type: 'claim', label: 'Idea', statement: 'Enunciado' }, 1, 'academic-idea');
    await create('authors', { author_id: 'author-1', name: 'Autora', affiliation: 'Universidad' }, 2, 'academic-author');
    await create('passages', { passage_id: 'passage-1', nodus_id: 'work-1', chunk_index: 0, text: 'Texto', char_len: 5, content_hash: 'hash' }, 3, 'academic-passage');
    await create('themes', { theme_id: 'theme-1', label: 'Tema' }, 4, 'academic-theme');
    await create('gaps', { id: 'gap-1', nodus_id: 'work-1', related_idea: 'idea-1', kind: 'question', statement: 'Hueco' }, 5, 'academic-gap');
    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${vault.id}/content/ideas`);
    assert.equal((await response.json()).rows[0].label, 'Idea');
    response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}/ideas`);
    assert.equal(response.status, 200); assert.equal((await response.json()).items[0].label, 'Idea');
    response = await nativeRequest(ctx, 'PATCH', `/api/v2/vaults/${vault.id}/content/ideas/idea-1`, { key: { global_id: 'idea-1' }, row: { statement: 'Actualizado' }, expectedRevision: 6, idempotencyKey: 'academic-idea-update' });
    assert.equal(response.status, 200); assert.equal((await response.json()).revision, 7);
    response = await nativeRequest(ctx, 'DELETE', `/api/v2/vaults/${vault.id}/content/gaps/gap-1`, { key: { id: 'gap-1' }, expectedRevision: 7, idempotencyKey: 'academic-gap-delete' });
    assert.equal(response.status, 200); assert.equal((await response.json()).revision, 8);
  });
});
