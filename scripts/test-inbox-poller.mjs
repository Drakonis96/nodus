// The round trip the Inbox exists for, with a REAL server and no phone.
//
// A phone sending a Deep Research report is, on the wire, a device with write access
// POSTing one mutation against writing_saved_drafts whose brief_json.kind is
// "deep_research". That is what this posts. Everything after it is the real desktop code:
// the real poller, the real applyIncomingMutations, the real serverInboxRepo, the real
// acknowledgement.
//
// What it pins is the hole this feature closes. The desktop used to collect mutations only
// from inside publishVault, which runs when the ACTIVE vault gets dirty — and an incoming
// mutation dirties nothing, so an idle desktop never collected at all. So the assertions
// worth having are: it drains without anybody publishing, the report lands, the ledger is
// acknowledged, the inbox says what happened, and the vault is left wanting a publication
// so the work travels back out.
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
import { withServer } from './lib/nodusServerHarness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(path.join(repoRoot, 'scripts/test-inbox-poller.mjs'), '--electron-poller-test')) {
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-poller-userdata-'));
installRuntimeHooks(userData);

const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const { updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const { setNodusServerToken } = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
const { listServerInbox, unreadServerInboxCount } = require(path.join(repoRoot, 'electron/db/serverInboxRepo.ts'));
const { drainServerInboxNow } = require(path.join(repoRoot, 'electron/serverSync/inboxPoller.ts'));
const { getNodusServerOverview } = require(path.join(repoRoot, 'electron/serverSync/serverSyncService.ts'));

const STAMP = '2026-08-04T09:00:00.000Z';

/** The row a phone sends for a finished report. */
function reportRow(id, title, objective) {
  return {
    id,
    title,
    brief_json: JSON.stringify({ kind: 'deep_research', objective, language: 'es' }),
    selection_json: JSON.stringify({ ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [] }),
    model_json: null,
    draft_json: JSON.stringify({ title, draftMarkdown: '# Informe\n\nEscrito en el teléfono.' }),
    created_at: STAMP,
    updated_at: STAMP,
  };
}

function reportMutation(mutationId, row, overrides = {}) {
  return {
    id: mutationId,
    clientId: 'iphone-de-jorge',
    kind: 'upsert',
    table: 'writing_saved_drafts',
    key: [row.id],
    row,
    schemaVersion: SCHEMA_VERSION,
    createdAt: STAMP,
    ...overrides,
  };
}

test('an idle desktop drains the ledger on its own and shows what arrived', { timeout: 120_000 }, async () => {
  await withServer({ label: 'inbox-poller' }, async (server) => {
    const spaceId = await server.createSpace('Bandeja');
    await server.createUser('telefono@example.test', 'telefono-account-password', [{ spaceId, role: 'writer' }]);
    const phone = await server.deviceToken('telefono@example.test', 'telefono-account-password', spaceId, 'iPhone');
    const desktop = await server.pair(await server.pairingCode(spaceId), 'Nodus Desktop');

    // Configure the open vault exactly as pairNodusServer would, without the pairing flow:
    // this test is about what happens AFTER a vault is connected.
    setNodusServerToken(desktop.accessToken);
    updateSettings({
      nodusServerUrl: server.origin,
      nodusServerSpaceId: spaceId,
      nodusServerSpaceName: 'Bandeja',
      nodusServerEnabled: true,
      // Explicitly OFF. Pausing outbound publishing must not stop the desktop receiving:
      // that is a different promise, and one the user never made.
      nodusServerAutoSync: false,
    });

    const db = getDb();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM writing_saved_drafts').get().n, 0);

    // ── The phone sends ──────────────────────────────────────────────────────
    const sent = await server.api(phone.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: { mutations: [reportMutation('mut-report-1', reportRow('dr-1', 'La reforma agraria', 'Qué decía la prensa de 1932'))] },
    });
    assert.equal(sent.status, 200);
    const accepted = await sent.json();
    assert.deepEqual(accepted.accepted, ['mut-report-1']);
    assert.equal(accepted.cursor, 1, 'the phone keeps this cursor to tell "delivered" from "on the server"');

    // ── The desktop drains, without publishing and without being touched ─────
    await drainServerInboxNow();

    const landed = db.prepare("SELECT * FROM writing_saved_drafts WHERE id = 'dr-1'").get();
    assert.ok(landed, 'the report never reached the vault');
    assert.equal(landed.title, 'La reforma agraria');
    assert.equal(JSON.parse(landed.brief_json).kind, 'deep_research');

    const inbox = listServerInbox();
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].id, 'mut-report-1');
    assert.equal(inbox[0].outcome, 'applied');
    assert.equal(inbox[0].entityKind, 'deep_research', 'so the panel can offer to open the report');
    assert.equal(inbox[0].title, 'La reforma agraria');
    assert.equal(inbox[0].clientId, 'iphone-de-jorge');
    assert.equal(inbox[0].spaceId, spaceId);
    assert.equal(inbox[0].read, false);
    assert.equal(unreadServerInboxCount(), 1, 'and the header badge has something to show');

    // Acknowledged, so the server stops handing it back.
    const remaining = await (await server.api(desktop.accessToken, 'GET', `/api/v1/spaces/${spaceId}/mutations`)).json();
    assert.equal(remaining.mutations.length, 0, 'the ledger was not acknowledged');

    // And the vault is left wanting a publication, which is how the collaborator's work
    // travels back out — the guarantee publishVault's own collect step used to provide.
    const connection = getNodusServerOverview().connections.find((entry) => entry.spaceId === spaceId);
    assert.ok(connection, 'the connection is not in the overview');
    assert.deepEqual(connection.lastInbox, { applied: 1, deleted: 0, keptLocal: 0, refused: 0 });

    // ── The same report again: updated, not duplicated ───────────────────────
    // The phone reuses the row id, so this exercises mutationInbox's UPDATE path.
    const resent = await server.api(phone.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: {
        mutations: [reportMutation(
          'mut-report-2',
          { ...reportRow('dr-1', 'La reforma agraria (revisada)', 'Qué decía la prensa de 1932'), updated_at: '2026-08-04T10:00:00.000Z' },
          { createdAt: '2026-08-04T10:00:00.000Z' }
        )],
      },
    });
    assert.equal(resent.status, 200);
    await drainServerInboxNow();

    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM writing_saved_drafts').get().n, 1, 'the report was duplicated');
    assert.equal(db.prepare("SELECT title FROM writing_saved_drafts WHERE id = 'dr-1'").get().title, 'La reforma agraria (revisada)');
    assert.equal(listServerInbox().length, 2, 'a second arrival is a second inbox entry');
    assert.equal(listServerInbox()[0].id, 'mut-report-2', 'newest first');
  });
});

test('a refused mutation is recorded once, however often it comes back', { timeout: 120_000 }, async () => {
  await withServer({ label: 'inbox-refusal' }, async (server) => {
    const spaceId = await server.createSpace('Rechazos');
    await server.createUser('telefono2@example.test', 'telefono-account-password', [{ spaceId, role: 'writer' }]);
    const phone = await server.deviceToken('telefono2@example.test', 'telefono-account-password', spaceId, 'iPhone');
    const desktop = await server.pair(await server.pairingCode(spaceId), 'Nodus Desktop');

    setNodusServerToken(desktop.accessToken);
    updateSettings({
      nodusServerUrl: server.origin,
      nodusServerSpaceId: spaceId,
      nodusServerSpaceName: 'Rechazos',
      nodusServerEnabled: true,
      nodusServerAutoSync: false,
    });

    // A mutation written against a schema this build does not have. It is refused, the
    // cursor does not advance, and the server therefore keeps offering it — forever, until
    // the user updates Nodus. That is the case the DO NOTHING conflict clause is for.
    const sent = await server.api(phone.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: {
        mutations: [reportMutation('mut-future', reportRow('dr-future', 'Del futuro', 'Un esquema más reciente'), {
          schemaVersion: SCHEMA_VERSION + 5,
        })],
      },
    });
    assert.equal(sent.status, 200);

    await drainServerInboxNow();
    const first = listServerInbox().filter((entry) => entry.id === 'mut-future');
    assert.equal(first.length, 1);
    assert.equal(first[0].outcome, 'refused');
    assert.match(first[0].reason, /esquema más reciente/);
    assert.equal(first[0].title, null, 'a refusal names no row, because none was written');

    // The user reads it, and the poller runs again — twice, as it would every 30 seconds.
    const { markServerInboxRead } = require(path.join(repoRoot, 'electron/db/serverInboxRepo.ts'));
    markServerInboxRead('mut-future');
    await drainServerInboxNow();
    await drainServerInboxNow();

    const after = listServerInbox().filter((entry) => entry.id === 'mut-future');
    assert.equal(after.length, 1, 'the same refusal was recorded more than once');
    assert.equal(after[0].read, true, 'and it came back as unread, which the user could never clear');
    assert.equal(after[0].arrivedAt, first[0].arrivedAt, 'a stuck mutation must not keep floating to the top');

    // It is still in the ledger, because refusing does not acknowledge.
    const remaining = await (await server.api(desktop.accessToken, 'GET', `/api/v1/spaces/${spaceId}/mutations`)).json();
    assert.equal(remaining.mutations.length, 1, 'a refusal must never be acknowledged away');
  });
  await rm(userData, { recursive: true, force: true });
});
