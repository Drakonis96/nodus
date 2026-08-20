// The desktop's record of what arrived from another device.
//
// Pins serverInboxRepo against a REAL migrated database, because the two decisions that
// matter here are both about repetition rather than about a single write:
//
//   • a REFUSED mutation stops the apply loop without advancing the cursor, so the server
//     hands back the same mutation every thirty seconds, for as long as the reason stands.
//     Recording it must be idempotent, and must not resurrect an entry as unread.
//   • an APPLIED mutation may be replayed after a dropped acknowledgement, carrying the
//     same id. Same requirement.
//
// Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(path.join(repoRoot, 'scripts/test-server-inbox.mjs'), '--electron-inbox-test')) {
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-inbox-userdata-'));
installRuntimeHooks(userData);

const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const {
  clearServerInbox,
  clearServerInboxEntry,
  listServerInbox,
  markServerInboxRead,
  recordServerInbox,
  unreadServerInboxCount,
} = require(path.join(repoRoot, 'electron/db/serverInboxRepo.ts'));
const { applyIncomingMutations, titleOf } = require(path.join(repoRoot, 'electron/serverSync/mutationInbox.ts'));
const { groupServerInboxEntries, unreadServerInboxGroupCount } = require(path.join(repoRoot, 'src/serverInboxGrouping.ts'));

const SPACE = { spaceId: 'space-1' };

/** The batch as it comes back from applyIncomingMutations: one of each outcome. */
function mixedBatch() {
  return [
    {
      id: 'mut-applied', seq: 1, clientId: 'iphone-de-jorge', table: 'writing_saved_drafts',
      key: ['dr-1'], kind: 'upsert', outcome: 'applied',
      title: 'La reforma agraria en la prensa de 1932', entityKind: 'deep_research',
      schemaVersion: SCHEMA_VERSION, createdAt: '2026-08-01T09:00:00.000Z',
    },
    {
      id: 'mut-kept', seq: 2, clientId: 'iphone-de-jorge', table: 'notes',
      key: ['n-1'], kind: 'upsert', outcome: 'keptLocal',
      title: 'Nota que el propietario ya había corregido', entityKind: 'note',
      schemaVersion: SCHEMA_VERSION, createdAt: '2026-08-01T09:01:00.000Z',
    },
    {
      id: 'mut-refused', seq: 3, clientId: 'ipad-viejo', table: 'notes',
      key: ['n-2'], kind: 'delete', outcome: 'refused',
      reason: 'Procede de un esquema más reciente.',
      schemaVersion: SCHEMA_VERSION + 1, createdAt: '2026-08-01T09:02:00.000Z',
    },
  ];
}

test('the vault is migrated far enough to hold an inbox', () => {
  assert.ok(SCHEMA_VERSION >= 132, 'group parent metadata arrives in v132');
  assert.equal(getDb().pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.deepEqual(listServerInbox(), [], 'a fresh vault has received nothing');
});

test('a batch is recorded whole, newest first, and every field survives', () => {
  recordServerInbox(mixedBatch(), SPACE);
  const list = listServerInbox();
  assert.equal(list.length, 3);
  // arrived_at is one timestamp for the whole batch, so seq DESC is what orders it.
  assert.deepEqual(list.map((entry) => entry.id), ['mut-refused', 'mut-kept', 'mut-applied']);

  const report = list.find((entry) => entry.id === 'mut-applied');
  assert.equal(report.outcome, 'applied');
  assert.equal(report.spaceId, 'space-1');
  assert.equal(report.clientId, 'iphone-de-jorge', 'which device, not which person');
  assert.equal(report.table, 'writing_saved_drafts');
  assert.deepEqual(report.key, ['dr-1'], 'the key round-trips through its JSON encoding');
  assert.equal(report.op, 'upsert');
  assert.equal(report.entityKind, 'deep_research');
  assert.equal(report.title, 'La reforma agraria en la prensa de 1932');
  assert.equal(report.createdAt, '2026-08-01T09:00:00.000Z', 'when the phone wrote it');
  assert.ok(report.arrivedAt, 'and when this desktop applied it');
  assert.equal(report.read, false);

  // camelCase in the summary, snake_case in the column: the one that reaches the UI is
  // the stored spelling, so a chip cannot be written against a value that never arrives.
  assert.equal(list.find((entry) => entry.id === 'mut-kept').outcome, 'kept_local');
  const refused = list.find((entry) => entry.id === 'mut-refused');
  assert.equal(refused.outcome, 'refused');
  assert.equal(refused.reason, 'Procede de un esquema más reciente.');
  assert.equal(refused.title, null, 'a delete carries no row, so it has no name');
  assert.equal(refused.op, 'delete');
});

test('reading is per entry, and marking all read clears the badge', () => {
  assert.equal(unreadServerInboxCount(), 3);
  markServerInboxRead('mut-applied');
  assert.equal(unreadServerInboxCount(), 2, 'one entry, not the lot');
  assert.equal(listServerInbox().find((entry) => entry.id === 'mut-applied').read, true);
  markServerInboxRead();
  assert.equal(unreadServerInboxCount(), 0);
});

test('re-recording the same batch never resurrects an entry as unread', () => {
  // This is the case that actually happens: a refusal does not advance the cursor, so the
  // server keeps handing that mutation back every poll. INSERT OR REPLACE here would zero
  // `read` on each one and hand the user a badge they could never clear.
  const before = listServerInbox();
  recordServerInbox(mixedBatch(), SPACE);
  const after = listServerInbox();
  assert.equal(after.length, 3, 'no duplicates');
  assert.equal(unreadServerInboxCount(), 0, 'and nothing came back unread');
  assert.deepEqual(
    after.map((entry) => entry.arrivedAt),
    before.map((entry) => entry.arrivedAt),
    'a permanently refused mutation must not become permanently the newest thing'
  );
});

test('an entry can be removed one at a time, or all at once', () => {
  assert.equal(clearServerInboxEntry('mut-kept'), true);
  assert.equal(clearServerInboxEntry('mut-kept'), false, 'removing it twice changes nothing');
  assert.equal(listServerInbox().length, 2);
  assert.equal(clearServerInbox(), 2);
  assert.deepEqual(listServerInbox(), []);
  assert.equal(unreadServerInboxCount(), 0);
});

test('an empty batch touches nothing', () => {
  recordServerInbox([], SPACE);
  assert.deepEqual(listServerInbox(), []);
});

test('titleOf names what a person would recognise, and nothing else', () => {
  // The row the phone sends: brief_json.kind is what makes it a Deep Research report.
  const brief = JSON.stringify({ kind: 'deep_research', objective: 'Qué decía la prensa' });
  assert.deepEqual(
    titleOf('writing_saved_drafts', { title: 'Informe final', brief_json: brief }),
    { title: 'Informe final', entityKind: 'deep_research' }
  );
  // Without a title it falls back to the objective the user actually typed.
  assert.deepEqual(
    titleOf('writing_saved_drafts', { title: '   ', brief_json: brief }),
    { title: 'Qué decía la prensa', entityKind: 'deep_research' }
  );
  // A brief this build cannot parse still leaves the row's own title usable.
  assert.deepEqual(
    titleOf('writing_saved_drafts', { title: 'Informe', brief_json: '{no es json' }),
    { title: 'Informe', entityKind: null }
  );
  assert.deepEqual(titleOf('notes', { title: 'Una nota' }), { title: 'Una nota', entityKind: 'note' });
  assert.deepEqual(titleOf('note_folders', { name: 'Capítulo 3' }), { title: 'Capítulo 3', entityKind: 'note_folder' });
  assert.deepEqual(titleOf('immersion_sessions', { title: 'Ruta guiada', topic: 'Memoria' }), { title: 'Ruta guiada', entityKind: 'immersion' });
  assert.deepEqual(
    titleOf('writing_draft_annotations', { selected_text: 'Un fragmento' }),
    { title: 'Un fragmento', entityKind: 'deep_research_annotation' }
  );
  // Anything else, and a delete, have no name: the panel falls back to table + key.
  assert.deepEqual(titleOf('saved_searches', { id: 's-1' }), { title: null, entityKind: null });
  assert.deepEqual(titleOf('notes', null), { title: null, entityKind: null });
});

test('what applyIncomingMutations reports is exactly what the inbox can store', async () => {
  // The two halves have to agree about a real mutation, not about a fixture: the outcome
  // vocabulary, the key encoding and the derived title all cross this boundary.
  const db = getDb();
  const now = '2026-08-02T10:00:00.000Z';
  const summary = applyIncomingMutations(db, [{
    id: 'mut-live', seq: 9, clientId: 'iphone-de-jorge', kind: 'upsert', table: 'writing_saved_drafts',
    key: ['dr-live'],
    row: {
      id: 'dr-live', title: 'Informe llegado del teléfono',
      brief_json: JSON.stringify({ kind: 'deep_research', objective: 'El objetivo' }),
      selection_json: '{}', model_json: null, draft_json: '{}', created_at: now, updated_at: now,
    },
    schemaVersion: SCHEMA_VERSION, createdAt: now,
  }]);
  assert.equal(summary.applied, 1);
  assert.equal(summary.entries.length, 1);

  recordServerInbox(summary.entries, SPACE);
  const [entry] = listServerInbox();
  assert.equal(entry.id, 'mut-live');
  assert.equal(entry.outcome, 'applied');
  assert.equal(entry.entityKind, 'deep_research');
  assert.equal(entry.title, 'Informe llegado del teléfono');
  assert.deepEqual(entry.key, ['dr-live']);
  assert.ok(db.prepare("SELECT 1 FROM writing_saved_drafts WHERE id = 'dr-live'").get(), 'and the report really landed');

  const annotationRows = [
    { id: 'a-live-1', kind: 'highlight', selected: 'Informe', start: 0 },
    { id: 'a-live-2', kind: 'comment', selected: 'llegado', start: 8, comment: 'Comprobar esta afirmación' },
  ];
  const annotationSummary = applyIncomingMutations(db, annotationRows.map((item, index) => ({
    id: `mut-${item.id}`, seq: 10 + index, clientId: 'iphone-de-jorge', kind: 'upsert', table: 'writing_draft_annotations',
    key: [item.id],
    row: {
      id: item.id, draft_id: 'dr-live', scope: 'source', kind: item.kind,
      color: item.kind === 'highlight' ? 'yellow' : null,
      start_offset: item.start, end_offset: item.start + item.selected.length,
      selected_text: item.selected, prefix: '', suffix: '', comment_text: item.comment ?? null,
      created_at: now, updated_at: now, target_json: null,
    },
    schemaVersion: SCHEMA_VERSION, createdAt: now,
  })));
  assert.equal(annotationSummary.entries.length, 2);
  assert.deepEqual(
    annotationSummary.entries.map(({ parentEntityKind, parentEntityId, parentTitle }) => ({ parentEntityKind, parentEntityId, parentTitle })),
    annotationRows.map(() => ({ parentEntityKind: 'deep_research', parentEntityId: 'dr-live', parentTitle: 'Informe llegado del teléfono' }))
  );
  recordServerInbox(annotationSummary.entries, SPACE);
  const grouped = groupServerInboxEntries(listServerInbox());
  assert.equal(grouped.length, 1, 'the report and both nested changes are one notification');
  assert.equal(grouped[0].entries.length, 3);
  assert.equal(grouped[0].title, 'Informe llegado del teléfono');
  assert.equal(grouped[0].unreadCount, 3);
  assert.equal(unreadServerInboxGroupCount(listServerInbox()), 1, 'the header badge counts the group, not its children');

  db.prepare(`INSERT INTO immersion_sessions (
    id, topic, title, language, minutes, model_json, plan_json, progress_json, stats_json, created_at, updated_at
  ) VALUES ('imm-live', 'Memoria', 'Ruta de memoria', 'es', 90, NULL, '{}', '{}', '{}', ?, ?)`
  ).run(now, now);
  const immersionAnnotationSummary = applyIncomingMutations(db, [{
    id: 'mut-immersion-comment', seq: 13, clientId: 'iphone-de-jorge', kind: 'upsert', table: 'writing_draft_annotations',
    key: ['immersion-comment'],
    row: {
      id: 'immersion-comment', draft_id: 'immersion:imm-live', scope: 'step:1:source', kind: 'comment',
      color: null, start_offset: 0, end_offset: 7, selected_text: 'Memoria', prefix: '', suffix: '',
      comment_text: 'Volver sobre este concepto', created_at: now, updated_at: now, target_json: null,
    },
    schemaVersion: SCHEMA_VERSION, createdAt: now,
  }]);
  assert.deepEqual(
    immersionAnnotationSummary.entries.map(({ entityKind, parentEntityKind, parentEntityId, parentTitle }) => ({ entityKind, parentEntityKind, parentEntityId, parentTitle })),
    [{ entityKind: 'immersion_annotation', parentEntityKind: 'immersion', parentEntityId: 'imm-live', parentTitle: 'Ruta de memoria' }],
  );

  clearServerInbox();
  await rm(userData, { recursive: true, force: true });
});

test('global-library annotations can leave the vault database through the external mutation route', () => {
  const db = getDb();
  const now = '2026-08-13T12:00:00.000Z';
  const mutation = {
    id: 'mut-library-highlight', seq: 14, clientId: 'iphone-de-jorge', kind: 'upsert', table: 'writing_draft_annotations',
    key: ['library-annotation:ZG9jdW1lbnQ6d2l0aC1jb2xvbg:highlight-1'],
    row: { id: 'library-annotation:ZG9jdW1lbnQ6d2l0aC1jb2xvbg:highlight-1', draft_id: 'nodus-library:document:with-colon' },
    schemaVersion: SCHEMA_VERSION, createdAt: now,
  };
  let routed = null;
  const summary = applyIncomingMutations(db, [mutation], {
    external(value) {
      routed = value;
      return {
        outcome: 'applied', title: 'Fragmento subrayado', entityKind: 'library_annotation',
        parentEntityKind: 'library_document', parentEntityId: 'document:with-colon', parentTitle: 'Documento global',
      };
    },
  });
  assert.equal(routed, mutation);
  assert.equal(summary.applied, 1);
  assert.equal(summary.cursor, 14);
  assert.deepEqual(summary.entries.map(({ outcome, entityKind, parentEntityKind, parentEntityId, parentTitle }) => ({ outcome, entityKind, parentEntityKind, parentEntityId, parentTitle })), [
    {
      outcome: 'applied', entityKind: 'library_annotation', parentEntityKind: 'library_document',
      parentEntityId: 'document:with-colon', parentTitle: 'Documento global',
    },
  ]);
});
