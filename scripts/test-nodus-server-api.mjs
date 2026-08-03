// The REST read surface, endpoint by endpoint.
//
// Nodus Server had no GET of data at all: everything a client could read went through MCP.
// The mobile app and the desktop replica need a plain HTTP API, and the risk of adding one
// beside an existing surface is that the two drift — so the envelope here is asserted to be
// the same one electron/mcp/tools.ts:554 produces, and the equivalent MCP tool is queried in
// the same test to compare.
//
// Also pinned here: the OAuth resource split. Before it, `oauthAccess()` compared against a
// hard-coded MCP resource, so any REST route would have accepted an MCP token and vice versa.
import assert from 'node:assert/strict';
import test from 'node:test';
import { academicSnapshot, PNG_BYTES, publish, sha256 } from './lib/nodusServerFixtures.mjs';
import { mcp, oauthLogin, registerOauthClient, withServer } from './lib/nodusServerHarness.mjs';

async function readJson(response) {
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  return response.json();
}

test('every collection endpoint answers with the MCP page envelope and honours its bounds', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-read' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('lector@example.test', 'lector-account-password', [{ spaceId, role: 'reader' }]);
    const reader = await server.deviceToken('lector@example.test', 'lector-account-password', spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    for (const [pathname, key, expected] of [
      ['works', 'works', 2],
      ['ideas', 'ideas', 3],
      ['themes', 'themes', 2],
      ['gaps', 'gaps', 1],
      ['authors', 'authors', 2],
      ['passages', 'passages', 1],
      ['notes', 'notes', 1],
      ['deep-research', 'reports', 1],
      ['immersion', 'sessions', 1],
    ]) {
      const response = await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/${pathname}`);
      assert.equal(response.status, 200, pathname);
      const value = await readJson(response);
      assert.ok(Array.isArray(value[key]), `${pathname} answers under "${key}"`);
      assert.equal(value[key].length, expected, pathname);
      assert.equal(value.total, expected, pathname);
      assert.equal(value.limit, 100);
      assert.equal(value.offset, 0);
      assert.equal(value.hasMore, false);
      assert.ok(value.revision, 'every list names the revision it was read from');
    }

    // Only Deep Research reports appear under /deep-research; an ordinary draft does not.
    const reports = await readJson(await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/deep-research`));
    assert.deepEqual(reports.reports.map((report) => report.id), ['dr-1']);
    assert.equal(reports.reports[0].kind, 'deep_research');

    // Bounds: 0 falls back to the default, an absurd limit is capped, and an offset past
    // the end is an empty page rather than an error.
    const zero = await readJson(await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas?limit=0`));
    assert.equal(zero.limit, 100);
    const huge = await readJson(await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas?limit=999`));
    assert.equal(huge.limit, 200);
    const past = await readJson(await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas?offset=99`));
    assert.deepEqual(past.ideas, []);
    assert.equal(past.total, 3);
    assert.equal(past.hasMore, false, 'an offset past the end is not "there is more"');

    const paged = await readJson(await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas?limit=2&offset=0`));
    assert.equal(paged.hasMore, true);
    assert.equal(paged.ideas.length, 2);

    // Detail endpoints, including the relations an idea carries.
    const idea = await readJson(await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas/i-a`));
    assert.equal(idea.idea.global_id, 'i-a');
    assert.deepEqual(idea.themes, ['Memoria']);
    assert.equal(idea.evidence.length, 1);
    // e-hidden is vetoed in edge_feedback, stored in the reverse direction.
    assert.deepEqual(idea.relations.map((edge) => edge.id).sort(), ['e-ab', 'e-sup']);

    const work = await readJson(await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/works/w-1`));
    assert.deepEqual(work.work.authors, ['Alba, Rosa'], 'authors_json is parsed, as toView() does');
    assert.equal(work.passages, 1);

    const author = await readJson(await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/authors/a-1`));
    assert.deepEqual(author.works.map((entry) => entry.nodus_id), ['w-1']);

    const report = await readJson(await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/deep-research/dr-1`));
    assert.match(report.report.draft.draftMarkdown, /## Resumen/);

    const session = await readJson(await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/immersion/im-1`));
    assert.ok(session.session.plan, 'the immersion plan replays without new AI calls');
    assert.equal('progress' in session.session, false, "another device's progress is not served");

    assert.equal((await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas/does-not-exist`)).status, 404);
  });
});

test('the styled report document carries its cover image, and says so when it cannot be laid out', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-report-document' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    const hash = sha256(PNG_BYTES);

    await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${hash}`, {
      body: PNG_BYTES, headers: { 'content-type': 'image/png' },
    });
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot({
      assets: [{
        hash, thumbHash: null, mime: 'image/png', thumbMime: null, bytes: PNG_BYTES.length, thumbBytes: null,
        kind: 'deep_research_image', table: 'decorative_images', key: ['deep_research', 'dr-3'],
      }],
      tables: {
        writing_saved_drafts: [
          {
            id: 'dr-3',
            title: 'Informe ilustrado',
            brief_json: JSON.stringify({ kind: 'deep_research', objective: 'Estado de la cuestión', language: 'es' }),
            selection_json: '{}',
            model_json: '{}',
            // The whole shape the layout reads (shared/types.ts:5838).
            draft_json: JSON.stringify({
              generatedAt: '2026-02-01T00:00:00.000Z',
              brief: { kind: 'deep_research', objective: 'Estado de la cuestión', language: 'es' },
              title: 'Informe ilustrado',
              abstract: 'Un resumen.',
              outline: [{ id: 's1', title: 'Introducción', purpose: '', keyClaims: [], sources: [] }],
              draftMarkdown: '## Introducción\n\nTexto del informe.',
              matrix: [], bibliography: [], nextSteps: [], limitations: [],
              stats: { selectedIdeas: 1, selectedWorks: 1 },
            }),
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          // The fixture's own report: a draft written before the layout existed, missing every
          // field it reads.
          {
            id: 'dr-1',
            title: 'Informe sobre el archivo',
            brief_json: JSON.stringify({ kind: 'deep_research', objective: 'Estado de la cuestión', language: 'es' }),
            selection_json: '{}',
            model_json: '{}',
            draft_json: JSON.stringify({ title: 'Informe sobre el archivo', draftMarkdown: '## Resumen\nTexto.', bibliography: [] }),
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    }));

    const document = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/deep-research/dr-3/document.html`);
    assert.equal(document.status, 200);
    assert.equal(document.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await document.text();
    assert.match(html, /^<!doctype html>/);
    // The cover image reaches the page as bytes, not as a link: whatever prints this document
    // may not be able to fetch anything else, and a snapshot asset carries only a hash.
    assert.ok(
      html.includes(`data:image/png;base64,${PNG_BYTES.toString('base64')}`),
      'the published illustration is inlined into the cover',
    );

    // A draft the layout cannot read is a 422 that names the problem, not an exception that
    // reaches the client as "could not build the PDF".
    const broken = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/deep-research/dr-1/document.html`);
    assert.equal(broken.status, 422);
    assert.equal((await broken.json()).error, 'unrenderable_draft');

    assert.equal(
      (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/deep-research/nope/document.html`)).status,
      404,
    );
  });
});

/**
 * The study and teaching surfaces: the exam with its questions, the plan with its blocks, and
 * the agenda that reads the two dated tables as one.
 *
 * The id assertion is the load-bearing one. Every study and teaching table names its primary
 * key `id` (electron/db/migrations.ts:1573 onwards); this table used to declare `subject_id`,
 * `card_id` and `exam_id`, columns none of them has. Here the lookup fell through to
 * `candidate.id` and worked by accident, and on the client — where the same declaration
 * decides whether a row can be opened at all — it did not.
 */
function teachingSnapshot() {
  const stamp = { created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' };
  return academicSnapshot({
    vault: { id: 'vault-t', name: 'Docencia', type: 'docencia' },
    tables: {
      study_courses: [{ id: 'c-1', short_id: 'C1', name: '2.º de Bachillerato', description: '', ...stamp }],
      study_subjects: [{ id: 's-1', short_id: 'S1', course_id: 'c-1', name: 'Historia de España', color: '#ea580c', ...stamp }],
      teaching_exams: [{
        id: 'ex-1', short_id: 'E1', title: 'Examen de la Restauración', subject_id: 's-1', course_id: 'c-1',
        language: 'es', target_question_count: 3, header_json: '{}', logos_json: '[]', position: 0, ...stamp,
      }],
      teaching_exam_questions: [
        // Out of order on purpose: the route sorts, the snapshot does not.
        { id: 'q-2', short_id: 'Q2', exam_id: 'ex-1', parent_id: null, position: 1, type: 'multiple_choice', prompt: 'Elige', points: 2, options_json: '[{"id":"o1","text":"Cánovas","correct":true}]', pairs_json: '[]', items_json: '[]', solution: 'Cánovas', ...stamp },
        { id: 'q-1', short_id: 'Q1', exam_id: 'ex-1', parent_id: null, position: 0, type: 'section', prompt: 'Lee el texto', points: 1, options_json: '[]', pairs_json: '[]', items_json: '[]', solution: '', ...stamp },
        { id: 'q-3', short_id: 'Q3', exam_id: 'ex-1', parent_id: 'q-1', position: 0, type: 'short_answer', prompt: '¿Qué defiende?', points: 3, options_json: '[]', pairs_json: '[]', items_json: '[]', solution: '', ...stamp },
        { id: 'q-4', short_id: 'Q4', exam_id: 'ex-2', parent_id: null, position: 0, type: 'short_answer', prompt: 'De otro examen', points: 9, options_json: '[]', pairs_json: '[]', items_json: '[]', solution: '', ...stamp },
      ],
      study_plans: [{ id: 'p-1', short_id: 'P1', title: 'Plan de repaso', description: 'Antes del examen', course_id: 'c-1', subject_id: 's-1', available_minutes: 120, enabled: 1, config_json: '{}', position: 0, ...stamp }],
      study_plan_blocks: [
        { id: 'b-2', short_id: 'B2', plan_id: 'p-1', title: 'Segundo bloque', block_type: 'study', subject_id: 's-1', starts_at: '2026-03-02T09:00:00.000Z', duration_minutes: 50, status: 'planned', priority: 0, notes: '', position: 1, ...stamp },
        { id: 'b-1', short_id: 'B1', plan_id: 'p-1', title: 'Primer bloque', block_type: 'study', subject_id: 's-1', starts_at: '2026-03-01T09:00:00.000Z', duration_minutes: 25, status: 'done', priority: 0, notes: 'Repasar', position: 0, ...stamp },
        { id: 'b-old', short_id: 'B0', plan_id: 'p-1', title: 'Fuera de ventana', block_type: 'study', subject_id: 's-1', starts_at: '2020-01-01T09:00:00.000Z', duration_minutes: 25, status: 'planned', priority: 0, notes: '', position: 2, ...stamp },
      ],
      study_calendar_events: [
        { id: 'ev-1', short_id: 'V1', title: 'Examen final', event_type: 'exam', starts_at: '2026-03-03T08:00:00.000Z', ends_at: null, all_day: 0, course_id: 'c-1', subject_id: 's-1', topic_id: null, notes: '', reminder_minutes: null, completed: 0, ...stamp },
        { id: 'ev-old', short_id: 'V0', title: 'Del año pasado', event_type: 'session', starts_at: '2020-06-01T08:00:00.000Z', ends_at: null, all_day: 1, course_id: 'c-1', subject_id: 's-1', topic_id: null, notes: '', reminder_minutes: null, completed: 1, ...stamp },
      ],
      study_goals: [{ id: 'g-1', short_id: 'G1', title: 'Cuatro sesiones por semana', period: 'weekly', target_value: 4, current_value: 1, unit: 'sesiones', starts_at: '2026-03-01T00:00:00.000Z', ends_at: null, subject_id: 's-1', completed: 0, ...stamp }],
    },
  });
}

test('an exam carries its questions, a plan its blocks, and the agenda reads both', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-teaching' }, async (server) => {
    const spaceId = await server.createSpace('Docencia');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, teachingSnapshot());
    const get = async (path) => readJson(await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/${path}`));

    // Every study and teaching row is addressed by `id`.
    for (const [path, id] of [['study-subjects', 's-1'], ['study-courses', 'c-1'], ['study-plans', 'p-1'], ['study-goals', 'g-1'], ['teaching-exams', 'ex-1']]) {
      const response = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/${path}/${id}`);
      assert.equal(response.status, 200, `${path}/${id}`);
    }

    const exam = await get('teaching-exams/ex-1');
    // Sorted by position, sub-questions included, and nothing from the exam next door.
    assert.deepEqual(exam.questions.map((question) => question.id), ['q-1', 'q-3', 'q-2']);
    // A `section` is a shared statement, not a question: its own points are never counted
    // (shared/teachingExams.ts:290). 2 + 3, not 1 + 2 + 3.
    assert.equal(exam.points, 5);
    assert.equal(exam.subject.name, 'Historia de España');
    assert.equal(exam.course.name, '2.º de Bachillerato');

    const plan = await get('study-plans/p-1');
    assert.deepEqual(plan.blocks.map((block) => block.id), ['b-old', 'b-1', 'b-2'], 'blocks come back in the order they happen');

    // The agenda: one window, both tables, sorted, and the subjects that name them.
    const agenda = await get('study-agenda?from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z');
    assert.deepEqual(agenda.events.map((event) => event.id), ['ev-1'], 'the 2020 event is outside the window');
    assert.deepEqual(agenda.blocks.map((block) => block.id), ['b-1', 'b-2'], 'sorted by start, 2020 excluded');
    assert.deepEqual(agenda.subjects, [{ id: 's-1', name: 'Historia de España', color: '#ea580c' }]);
    assert.equal(agenda.total, 3);
    assert.equal(agenda.hasMore, false);

    // No window is the whole vault, which is what a client with no dates asks for.
    const everything = await get('study-agenda');
    assert.equal(everything.events.length, 2);
    assert.equal(everything.blocks.length, 3);
  });
});

/**
 * A database, read: the user's own column and row order, the page's cells, and which of the
 * page's files turned out to be an image.
 *
 * `attachment` is the one column type whose contents are not images by construction, so the
 * answer has to distinguish the three cases a reader sees: a picture, a file that is not a
 * picture, and a row with nothing attached at all.
 */
test('a database answers in the user’s order, with the page’s files and which of them are images', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-databases' }, async (server) => {
    const spaceId = await server.createSpace('Bases');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    const hash = sha256(PNG_BYTES);
    await server.api(owner.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/assets/${hash}`, {
      body: PNG_BYTES, headers: { 'content-type': 'image/png' },
    });

    const stamp = { created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' };
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot({
      vault: { id: 'vault-db', name: 'Fotografías', type: 'databases' },
      assets: [{
        hash, thumbHash: null, mime: 'image/png', thumbMime: null, bytes: PNG_BYTES.length, thumbBytes: null,
        kind: 'db_attachment', table: 'db_attachments', key: ['att-photo'],
      }],
      tables: {
        db_databases: [{ id: 'db-1', short_id: 'DB-1', name: 'Fototeca', icon: null, position: 0, ...stamp }],
        // Declared out of order: the route sorts by `position`, the snapshot does not.
        db_columns: [
          { id: 'col-tag', database_id: 'db-1', name: 'Etiqueta', type: 'select', position: 2, config_json: null, created_at: stamp.created_at },
          { id: 'col-title', database_id: 'db-1', name: 'Título', type: 'title', position: 0, config_json: null, created_at: stamp.created_at },
          { id: 'col-file', database_id: 'db-1', name: 'Imagen', type: 'attachment', position: 1, config_json: null, created_at: stamp.created_at },
        ],
        db_select_options: [{ id: 'opt-a', column_id: 'col-tag', label: 'Retrato', color: '#b30333', position: 0 }],
        db_rows: [
          { id: 'r-2', database_id: 'db-1', position: 1, ...stamp },
          { id: 'r-1', database_id: 'db-1', position: 0, ...stamp },
        ],
        db_cells: [
          { row_id: 'r-1', column_id: 'col-title', value_text: 'Plaza mayor, 1931' },
          { row_id: 'r-1', column_id: 'col-tag', value_text: 'opt-a' },
          { row_id: 'r-2', column_id: 'col-title', value_text: 'Expediente escaneado' },
        ],
        db_attachments: [
          // One image that travelled, and one PDF that did not. Both are metadata here.
          { id: 'att-photo', row_id: 'r-1', column_id: 'col-file', file_name: 'plaza.png', mime_type: 'image/png', bytes: PNG_BYTES.length, content_hash: 'x', description: 'Una plaza', extracted_text: 'ESTO NO DEBE VIAJAR EN LA PÁGINA', position: 0, created_at: stamp.created_at },
          { id: 'att-pdf', row_id: 'r-2', column_id: 'col-file', file_name: 'expediente.pdf', mime_type: 'application/pdf', bytes: 900_000, content_hash: 'y', description: null, extracted_text: null, position: 0, created_at: stamp.created_at },
        ],
        db_relations: [{ id: 'rel-1', row_id: 'r-1', column_id: 'col-tag', target_kind: 'db_row', target_id: 'r-2', position: 0, created_at: stamp.created_at }],
      },
    }));

    const detail = await readJson(await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/databases/db-1`));
    assert.deepEqual(detail.columns.map((column) => column.id), ['col-title', 'col-file', 'col-tag'], 'columns in the user’s order');
    assert.deepEqual(detail.rows.map((row) => row.id), ['r-1', 'r-2'], 'rows in the user’s order');
    assert.equal(detail.total, 2);

    const photo = detail.attachments.find((entry) => entry.id === 'att-photo');
    const pdf = detail.attachments.find((entry) => entry.id === 'att-pdf');
    assert.equal(photo.hash, hash, 'the image is addressable by content hash');
    assert.equal(photo.file_name, 'plaza.png');
    assert.equal(pdf.hash, null, 'a PDF has no image to fetch');
    assert.equal(pdf.file_name, 'expediente.pdf', 'and is still named, so the row does not look empty');
    assert.equal('extracted_text' in photo, false, 'a scan’s whole text does not ride with every page');

    assert.deepEqual(detail.relations.map((relation) => relation.id), ['rel-1']);

    // Paging cuts after the sort, and carries only its own page's cells and files.
    const second = await readJson(await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/databases/db-1?limit=1&offset=1`));
    assert.deepEqual(second.rows.map((row) => row.id), ['r-2']);
    assert.equal(second.hasMore, false);
    assert.deepEqual(second.attachments.map((entry) => entry.id), ['att-pdf']);
    assert.ok(second.cells.every((cell) => cell.row_id === 'r-2'));
  });
});

test('debates and the idea subgraph both hide what the owner vetoed', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-debates' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    const debates = await readJson(await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/debates`));
    const ids = debates.debates.map((debate) => debate.id);
    assert.deepEqual(ids.sort(), ['e-ab', 'e-bc']);
    assert.ok(!ids.includes('e-hidden'), 'a pair vetoed in the reverse direction stays hidden');
    for (const debate of debates.debates) assert.equal(debate.trace, null, 'edge_traces never travels, and the API says so');

    const detail = await readJson(await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/debates/e-ab`));
    assert.equal(detail.debate.relation, 'contradicts');
    assert.equal(detail.debate.sideA.ideaId, 'i-a');
    assert.equal((await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/debates/e-hidden`)).status, 404);
    assert.equal((await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/debates/e-sup`)).status, 404, 'a supports edge is not a debate');

    const graph = await readJson(await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas/i-a/graph?depth=1`));
    assert.equal(graph.seedId, 'i-a');
    assert.ok(graph.ideas.some((idea) => idea.global_id === 'i-b'));
    assert.ok(!graph.edges.some((edge) => edge.id === 'e-hidden'), 'the subgraph walks visible edges only');
  });
});

test('reads are cached by revision and revalidate with 304', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-etag' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    const first = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas`);
    const etag = first.headers.get('etag');
    assert.ok(etag, 'a list carries an ETag');
    const second = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas`, { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304);
    assert.equal((await second.text()).length, 0);

    // A different query is a different answer and must not reuse the tag.
    const other = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas?limit=1`, { headers: { 'if-none-match': etag } });
    assert.equal(other.status, 200);

    // Republishing changes the revision, so the held tag stops matching.
    const changed = academicSnapshot({ tables: { themes: [{ theme_id: 't-9', label: 'Nuevo tema', created_at: '2026-01-01T00:00:00.000Z' }] } });
    await publish(server.origin, owner.deviceToken, spaceId, changed);
    const afterPublish = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas`, { headers: { 'if-none-match': etag } });
    assert.equal(afterPublish.status, 200, 'a stale tag must not survive a republication');
  });
});

test('the REST API and the MCP tools answer the same questions the same way', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-mcp-parity' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    const client = await registerOauthClient(server.origin, 'Parity client');
    const mcpTokens = await oauthLogin(server.origin, client, server.adminCookie, { resource: `${server.origin}/mcp` });

    const viaMcp = await mcp(server.origin, mcpTokens.access_token, 'tools/call', { name: 'nodus_get_work', arguments: { spaceId, id: 'w-1' } }, 1);
    const viaRest = await readJson(await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/works/w-1`));
    assert.equal(viaMcp.result.structuredContent.work.nodus_id, viaRest.work.nodus_id);
    assert.equal(viaMcp.result.structuredContent.work.title, viaRest.work.title);

    const mcpSearch = await mcp(server.origin, mcpTokens.access_token, 'tools/call', { name: 'nodus_search', arguments: { spaceId, query: 'archivo' } }, 2);
    const restSearch = await readJson(await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/search?q=archivo`));
    assert.deepEqual(
      restSearch.results.map((hit) => `${hit.type}:${hit.id}`),
      mcpSearch.result.structuredContent.results.map((hit) => `${hit.type}:${hit.id}`),
      'both surfaces share one lexical search implementation',
    );

    const mcpSummary = await mcp(server.origin, mcpTokens.access_token, 'tools/call', { name: 'nodus_get_space_summary', arguments: { spaceId } }, 3);
    const restSummary = await readJson(await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}`));
    assert.deepEqual(restSummary.counts, mcpSummary.result.structuredContent.counts);
    assert.deepEqual(restSummary.vault, mcpSummary.result.structuredContent.vault);
    assert.equal(restSummary.schemaVersion, 121);
    assert.equal(restSummary.snapshotFormatVersion, 2);
  });
});

test('an MCP token is refused by the client API, and an API token by MCP', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-resources' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await publish(server.origin, owner.deviceToken, spaceId, academicSnapshot());

    const client = await registerOauthClient(server.origin, 'Two-resource client');
    const forMcp = await oauthLogin(server.origin, client, server.adminCookie, { resource: `${server.origin}/mcp` });
    const forApi = await oauthLogin(server.origin, client, server.adminCookie, {
      resource: `${server.origin}/api/v1`,
      scope: 'profile spaces.read materials.read materials.write',
    });

    // Each token works on its own surface…
    assert.equal((await server.api(forApi.access_token, 'GET', `/api/v1/spaces/${spaceId}/ideas`)).status, 200);
    const mcpCall = await mcp(server.origin, forMcp.access_token, 'tools/call', { name: 'nodus_list_spaces', arguments: {} }, 1);
    assert.ok(Array.isArray(mcpCall.result.structuredContent.spaces));

    // …and is rejected on the other. This is the whole point of the split.
    assert.equal((await server.api(forMcp.access_token, 'GET', `/api/v1/spaces/${spaceId}/ideas`)).status, 401);
    const crossed = await fetch(`${server.origin}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${forApi.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(crossed.status, 401);

    // The two resources publish their own metadata documents.
    const apiMetadata = await (await fetch(`${server.origin}/.well-known/oauth-protected-resource/api/v1`)).json();
    assert.equal(apiMetadata.resource, `${server.origin}/api/v1`);
    assert.ok(apiMetadata.scopes_supported.includes('materials.write'));
    const mcpMetadata = await (await fetch(`${server.origin}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(mcpMetadata.resource, `${server.origin}/mcp`);
    assert.ok(!mcpMetadata.scopes_supported.includes('materials.write'), 'the AI surface never advertises a write scope');
  });
});

test('an unauthenticated or unauthorized caller learns nothing about a space', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-authz' }, async (server) => {
    const mine = await server.createSpace('Mío');
    const theirs = await server.createSpace('Ajeno');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, mine);
    await publish(server.origin, owner.deviceToken, mine, academicSnapshot());

    await server.createUser('outsider@example.test', 'outsider-account-password', [{ spaceId: theirs, role: 'reader' }]);
    const outsider = await server.deviceToken('outsider@example.test', 'outsider-account-password', theirs);

    const anonymous = await server.api(null, 'GET', `/api/v1/spaces/${mine}/ideas`);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('www-authenticate') || '', /resource_metadata=".*\/\.well-known\/oauth-protected-resource\/api\/v1"/);

    // A device token bound to another space is not a credential for this one.
    assert.equal((await server.api(outsider.deviceToken, 'GET', `/api/v1/spaces/${mine}/ideas`)).status, 401);

    // A space that does not exist answers exactly like one you may not see, so membership
    // is not something an outsider can probe by comparing status codes.
    const missing = await server.api(outsider.deviceToken, 'GET', '/api/v1/spaces/00000000-0000-4000-8000-000000000000/ideas');
    assert.equal(missing.status, 401);

    // /me lists only what the caller actually has.
    const me = await readJson(await server.api(outsider.deviceToken, 'GET', '/api/v1/me'));
    assert.deepEqual(me.spaces.map((space) => space.id), [theirs]);
    assert.equal(me.user.email, 'outsider@example.test');
    assert.equal(me.device.kind, 'replica');
  });
});

test('capabilities are readable before there is anything to authenticate against', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-capabilities' }, async (server) => {
    const response = await fetch(`${server.origin}/api/v1/capabilities`);
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.api, 'v1');
    assert.deepEqual(value.snapshotVersions, [1, 2]);
    assert.equal(value.assets, true);
    assert.equal(value.mutations, true);
    assert.equal(value.vectors, true);
    assert.equal(value.resources.mcp, `${server.origin}/mcp`);
    assert.equal(value.resources.api, `${server.origin}/api/v1`);
    assert.ok(value.maxAssetBytes > 0 && value.maxSnapshotBytes > 0);

    // An unpublished space is a 409 the client can act on, not a 404 it would read as "gone".
    const spaceId = await server.createSpace('Vacío');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    assert.equal((await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas`)).status, 409);
    assert.equal((await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/snapshot`)).status, 409);
    // The space summary still answers, so a client can tell "no publication yet" apart from
    // "no access".
    const summary = await readJson(await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}`));
    assert.equal(summary.snapshotFormatVersion, null);
    assert.deepEqual(summary.counts, {});
  });
});

test('the snapshot can be fetched back for replica hydration', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-snapshot-get' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    await server.createUser('replica@example.test', 'replica-account-password', [{ spaceId, role: 'reader' }]);
    const reader = await server.deviceToken('replica@example.test', 'replica-account-password', spaceId);
    const snapshot = academicSnapshot();
    await publish(server.origin, owner.deviceToken, spaceId, snapshot);

    const response = await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/snapshot`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.equal(response.headers.get('x-nodus-revision'), snapshot.revision);
    // fetch() transparently gunzips, so what comes back is the JSON itself.
    const payload = JSON.parse(await response.text());
    assert.equal(payload.formatVersion, 2);
    assert.equal(payload.tables.works.length, 2);

    const etag = response.headers.get('etag');
    const again = await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/snapshot`, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304, 'the common case of an unchanged replica costs no body at all');
  });
});

test('a version 1 snapshot from an older desktop is still accepted', { timeout: 60_000 }, async () => {
  await withServer({ label: 'api-snapshot-v1' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);
    const modern = academicSnapshot();
    const legacy = {
      ...modern,
      gzipped: (await import('node:zlib')).gzipSync(Buffer.from(JSON.stringify({
        format: 'nodus.server-snapshot',
        formatVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        vault: modern.payload.vault,
        tables: modern.payload.tables,
      }))),
      revision: 'legacy-revision',
    };
    await publish(server.origin, owner.deviceToken, spaceId, legacy);
    const summary = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}`)).json();
    assert.equal(summary.snapshotFormatVersion, 1);
    // No assets and no edge_feedback in a v1 payload: absent, not broken.
    const ideas = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas`)).json();
    assert.equal(ideas.total, 3);
    assert.equal(summary.assets, 0);
  });
});

// A person's dossier returned an empty relationships list for every genealogy vault, because
// the filter named columns the table does not have. `relationships` is created by migration
// 1154 as {rel_id, from_person, to_person, type}; the filter compared `from_person_id` and
// `to_person_id`, which are undefined on every row, so nothing ever matched. The bug is
// invisible from the academic fixture — that vault has no people at all.
test('a person dossier returns the relationships that name them', { timeout: 60_000 }, async () => {
  await withServer({ label: 'person-relationships' }, async (server) => {
    const spaceId = await server.createSpace('Familia');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId);

    const tables = {
      persons: [
        { person_id: 'per-1', display_name: 'Ana Ruiz', sex: 'female', birth_date: '1950' },
        { person_id: 'per-2', display_name: 'Luis Ruiz', sex: 'male', birth_date: '1948' },
        { person_id: 'per-3', display_name: 'Marta Ruiz', sex: 'female', birth_date: '1975' },
      ],
      relationships: [
        { rel_id: 'r-1', from_person: 'per-1', to_person: 'per-3', type: 'parent', created_at: '2026-01-01T00:00:00.000Z' },
        { rel_id: 'r-2', from_person: 'per-2', to_person: 'per-3', type: 'parent', created_at: '2026-01-01T00:00:00.000Z' },
        { rel_id: 'r-3', from_person: 'per-1', to_person: 'per-2', type: 'spouse', created_at: '2026-01-01T00:00:00.000Z' },
      ],
    };
    const payload = {
      format: 'nodus.server-snapshot',
      formatVersion: 2,
      generatedAt: '2026-02-01T00:00:00.000Z',
      schemaVersion: 121,
      vault: { id: 'vault-g', name: 'Familia', type: 'genealogy' },
      capabilities: { includesUserContent: true, includesPassages: false, hasAssets: false },
      assets: [],
      tables,
    };
    const { createHash } = await import('node:crypto');
    const { gzipSync } = await import('node:zlib');
    await publish(server.origin, owner.deviceToken, spaceId, {
      revision: createHash('sha256').update(JSON.stringify(tables)).digest('base64url'),
      gzipped: gzipSync(Buffer.from(JSON.stringify(payload))),
    });

    const ana = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/persons/per-1`)).json();
    assert.equal(ana.person.display_name, 'Ana Ruiz');
    // Ana is a parent of per-3 and the spouse of per-2: three rows name her, two of them here.
    assert.equal(ana.relationships.length, 2, 'Ana appears in two relationships');
    assert.deepEqual(ana.relationships.map((entry) => entry.rel_id).sort(), ['r-1', 'r-3']);

    const marta = await (await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/persons/per-3`)).json();
    assert.equal(marta.relationships.length, 2, 'Marta is named by both parent edges');
  });
});
