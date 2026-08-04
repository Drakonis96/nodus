// Drive a connected vault against a LIVE Nodus Server, using the real desktop modules.
//
// scripts/test-connected-vault-replica.mjs proves the mechanism against a server the test
// spawned and a six-row fixture. This runs the same production code — the vault registry,
// the migrations, notesRepo, the outbox triggers, replicaService, the mutation inbox —
// against a Dockerised server and a real corpus, in an ISOLATED user-data profile.
//
// The profile matters. A test instance that shares the real one's userData has, in this
// project's history, destroyed stored API keys; and running a branch's migrations against a
// real vault is how a real vault gets corrupted. Nothing here touches either: the profile is
// a fresh directory, and the corpus it publishes is a copy.
//
//   NODUS_LAB_URL=http://127.0.0.1:7444 \
//   NODUS_LAB_SPACE=<uuid> \
//   NODUS_LAB_VAULT=/path/to/copy/nodus.sqlite \
//   NODUS_LAB_OWNER_EMAIL=… NODUS_LAB_OWNER_PASSWORD=… (plus WRITER_ and READER_) \
//   node scripts/verify-connected-vault-live.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(path.join(repoRoot, 'scripts/verify-connected-vault-live.mjs'), '--electron-lab')) {
  process.exit(0);
}

const URL_BASE = (process.env.NODUS_LAB_URL || 'http://127.0.0.1:7444').replace(/\/+$/, '');
const SPACE_ID = process.env.NODUS_LAB_SPACE || '';
const VAULT = process.env.NODUS_LAB_VAULT || '';
if (!SPACE_ID || !VAULT) {
  console.error('Set NODUS_LAB_SPACE and NODUS_LAB_VAULT. See the header of this file.');
  process.exit(2);
}

// Never named `nodus`: a profile with that name once shadowed the real installation and
// took its stored API keys with it.
const PROFILE = process.env.NODUS_LAB_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-replica-lab-'));
fs.mkdirSync(PROFILE, { recursive: true });
installRuntimeHooks(PROFILE);

const { buildServerSnapshot } = require(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'));
const { applyIncomingMutations } = require(path.join(repoRoot, 'electron/serverSync/mutationInbox.ts'));
const { outboxTriggersInstalled, countOutbox } = require(path.join(repoRoot, 'electron/serverSync/outboxTriggers.ts'));
const { listVaults } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
const { withVaultDatabase } = require(path.join(repoRoot, 'electron/db/database.ts'));
const notesRepo = require(path.join(repoRoot, 'electron/db/notesRepo.ts'));
const replica = require(path.join(repoRoot, 'electron/serverSync/replicaService.ts'));
const Database = require('better-sqlite3');

let failures = 0;
function record(ok, name, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}
async function check(name, fn) {
  try { record(true, name, (await fn()) ?? ''); }
  catch (error) { record(false, name, error instanceof Error ? error.message : String(error)); }
}
function expect(condition, message) { if (!condition) throw new Error(message); }

async function api(token, method, pathname, options = {}) {
  return fetch(`${URL_BASE}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
}

async function signIn(role) {
  const email = process.env[`NODUS_LAB_${role}_EMAIL`];
  const password = process.env[`NODUS_LAB_${role}_PASSWORD`];
  const login = await api(null, 'POST', '/api/v1/auth/login', { json: { email, password } });
  expect(login.status === 200, `${role} sign-in HTTP ${login.status}`);
  const session = await login.json();
  const device = await api(null, 'POST', '/api/v1/auth/device', { json: { ticket: session.ticket, spaceId: SPACE_ID, deviceName: `Lab ${role}` } });
  expect(device.status === 200, `${role} device token HTTP ${device.status}`);
  return device.json();
}

/** Publish the corpus the way the desktop publisher does: assets first, then the JSON. */
async function publish(token) {
  const db = new Database(VAULT, { readonly: true, fileMustExist: true });
  let snapshot;
  try {
    snapshot = buildServerSnapshot(
      { id: 'lab', name: 'Lab', type: process.env.NODUS_LAB_VAULT_TYPE || 'academic' },
      { nodusServerIncludeUserContent: true, nodusServerIncludePassages: false },
      db,
    );
  } finally { db.close(); }

  const wanted = new Map();
  for (const asset of snapshot.assets) {
    wanted.set(asset.hash, { data: asset.data, mime: asset.mime });
    if (asset.thumbHash && asset.thumbData) wanted.set(asset.thumbHash, { data: asset.thumbData, mime: asset.thumbMime });
  }
  if (wanted.size) {
    const negotiate = await api(token, 'POST', `/api/v1/spaces/${SPACE_ID}/assets/negotiate`, {
      json: { assets: [...wanted].map(([hash, value]) => ({ hash, bytes: value.data.length, mime: value.mime })) },
    });
    for (const hash of (await negotiate.json()).missing ?? []) {
      const asset = wanted.get(hash);
      await api(token, 'POST', `/api/v1/spaces/${SPACE_ID}/assets/${hash}`, { body: asset.data, headers: { 'content-type': asset.mime } });
    }
  }
  const response = await api(token, 'PUT', `/api/v1/spaces/${SPACE_ID}/snapshot`, {
    body: gzipSync(snapshot.buffer, { level: 1 }),
    headers: { 'content-encoding': 'gzip', 'x-nodus-revision': snapshot.revision },
  });
  expect(response.ok, `publish HTTP ${response.status}`);
  return snapshot;
}

console.log(`\nProfile ${PROFILE}\nServer  ${URL_BASE} · space ${SPACE_ID}\n`);

const owner = await signIn('OWNER');
let published = null;
await check('the owner publishes the corpus', async () => {
  published = await publish(owner.deviceToken);
  const rows = Object.values(published.counts).reduce((sum, n) => sum + n, 0);
  return `${rows.toLocaleString('es-ES')} rows, ${published.assets.length} illustration(s)`;
});

// ── The reader's replica ────────────────────────────────────────────────────
let readerVault = null;
await check('a reader creates a connected vault from the real desktop flow', async () => {
  const session = await replica.signInToNodusServer(URL_BASE, process.env.NODUS_LAB_READER_EMAIL, process.env.NODUS_LAB_READER_PASSWORD);
  const space = session.spaces.find((entry) => entry.id === SPACE_ID);
  expect(space, 'the reader cannot see the space');
  expect(space.role === 'reader', `expected reader, got ${space.role}`);
  readerVault = await replica.createConnectedVault({
    url: session.url, ticket: session.ticket, space,
    userEmail: session.userEmail, serverName: session.serverName,
  });
  expect(readerVault.origin === 'connected', 'the vault was not registered as connected');
  // The type comes from the publication, never from a picker, so it must match the vault
  // that was actually published rather than a hard-coded academic default.
  const expectedType = process.env.NODUS_LAB_VAULT_TYPE || 'academic';
  expect(readerVault.type === expectedType, `vault type came back as ${readerVault.type}, expected ${expectedType}`);
  return `"${readerVault.name}", ${readerVault.remote.role}, schema migrated locally`;
});

await check('the corpus really arrived', async () => {
  const db = new Database(readerVault.path, { fileMustExist: true });
  try {
    const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    // Compare against whatever this vault type actually published, table by table, rather
    // than against a hard-coded academic shape.
    const mismatched = [];
    let total = 0;
    for (const [table, expected] of Object.entries(published.counts)) {
      if (expected === 0) continue;
      total += expected;
      const actual = n(table);
      if (actual !== expected) mismatched.push(`${table} ${actual}≠${expected}`);
    }
    expect(mismatched.length === 0, `tables did not arrive intact: ${mismatched.join(', ')}`);
    const summary = Object.entries(published.counts).filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([table, count]) => `${count} ${table}`).join(', ');
    return `${total.toLocaleString('es-ES')} rows across ${Object.values(published.counts).filter((count) => count > 0).length} tables — ${summary}`;
  } finally { db.close(); }
});

await check('a Deep Research report is readable in the replica', async () => {
  const db = new Database(readerVault.path, { fileMustExist: true });
  try {
    let row = null;
    try { row = db.prepare("SELECT id, title, draft_json FROM writing_saved_drafts WHERE brief_json LIKE '%deep_research%' LIMIT 1").get(); } catch { row = null; }
    if (!row) return 'no reports in this corpus';
    const draft = JSON.parse(row.draft_json);
    expect(draft.draftMarkdown?.length > 0, 'the report arrived without its prose');
    return `"${row.title.slice(0, 40)}…", ${draft.draftMarkdown.split(/\s+/).length.toLocaleString('es-ES')} words`;
  } finally { db.close(); }
});

await check('the images reached the replica', async () => {
  // Both kinds that may travel: a Deep Research illustration and a person's portrait. The
  // check used to look only at the first, so a genealogy vault reported 0/0 while its
  // portraits were silently missing.
  const db = new Database(readerVault.path, { fileMustExist: true });
  try {
    const parts = [];
    const reports = db.prepare("SELECT COUNT(*) n FROM decorative_images WHERE entity_kind = 'deep_research' AND status = 'ready'").get().n;
    if (reports > 0) {
      const withBytes = db.prepare("SELECT COUNT(*) n FROM decorative_images WHERE entity_kind = 'deep_research' AND status = 'ready' AND LENGTH(image_blob) > 0").get().n;
      expect(withBytes === reports, `${withBytes} of ${reports} report illustrations have bytes — a broken image in the rest`);
      parts.push(`${withBytes}/${reports} report illustrations`);
    }
    const portraits = db.prepare('SELECT COUNT(*) n FROM person_portraits').get().n;
    if (portraits > 0) {
      const withBytes = db.prepare('SELECT COUNT(*) n FROM person_portraits WHERE LENGTH(blob) > 0').get().n;
      // A zero-length blob is the placeholder the row was inserted with. Still zero means
      // the asset pass never filled it, and every face on the tree would be blank.
      expect(withBytes === portraits, `${withBytes} of ${portraits} portraits have bytes — the rest are empty placeholders`);
      parts.push(`${withBytes}/${portraits} portraits`);
    }
    return parts.length ? parts.join(', ') : 'this corpus has no images';
  } finally { db.close(); }
});

await check('a reader cannot queue anything, whatever the app does', async () => {
  const db = new Database(readerVault.path, { fileMustExist: true });
  try {
    expect(outboxTriggersInstalled(db) === false, "the reader's database has queue triggers");
  } finally { db.close(); }
  // Write through the REAL repository, not straight SQL.
  const note = await withVaultDatabase(readerVault.id, () => notesRepo.createNote({ title: 'Nota privada del lector', folderId: null }));
  const after = new Database(readerVault.path, { fileMustExist: true });
  try {
    expect(countOutbox(after).pending === 0, "the reader's own work entered the queue");
    expect(after.prepare('SELECT 1 FROM notes WHERE id = ?').get(note.id), 'the note was not saved locally');
  } finally { after.close(); }
  return 'no triggers, nothing queued, the note stays on this machine';
});

await check('the panel sees what it needs to show', async () => {
  // These three are exactly what the Settings panel calls. They had no coverage at all:
  // the channels existed and nothing invoked them, so a replica's state was invisible.
  const overview = replica.getReplicaOverview();
  const entry = overview.find((item) => item.vaultId === readerVault.id);
  expect(entry, 'the replica does not appear in the overview');
  expect(entry.role === 'reader' && entry.state === 'active', `role ${entry.role}, state ${entry.state}`);
  expect(entry.spaceName && entry.serverName && entry.userEmail, 'the panel would render an unidentifiable card');
  expect(entry.lastPulledAt, 'no last-update timestamp to show');
  expect(entry.phase === 'ok', `phase ${entry.phase}`);
  expect(typeof entry.pendingMutations === 'number' && typeof entry.rejectedMutations === 'number', 'the counters are missing');

  // "Update now" is a manual pull, and it must be a no-op against an unchanged revision.
  const after = await replica.syncReplicaNow(readerVault.id);
  const refreshed = after.find((item) => item.vaultId === readerVault.id);
  expect(refreshed.phase === 'ok', `manual sync left phase ${refreshed.phase}: ${refreshed.lastError ?? ''}`);
  expect(refreshed.lastImages?.downloaded === 0, `a second pull re-downloaded ${refreshed.lastImages?.downloaded} images`);
  return `role, state, timestamps and counters all present; manual sync downloaded 0 images`;
});

// ── The writer's replica ────────────────────────────────────────────────────
let writerVault = null;
let writtenNoteId = null;
await check('a writer creates a connected vault and queues its work', async () => {
  const session = await replica.signInToNodusServer(URL_BASE, process.env.NODUS_LAB_WRITER_EMAIL, process.env.NODUS_LAB_WRITER_PASSWORD);
  const space = session.spaces.find((entry) => entry.id === SPACE_ID);
  writerVault = await replica.createConnectedVault({
    url: session.url, ticket: session.ticket, space,
    userEmail: session.userEmail, serverName: session.serverName,
  });
  expect(writerVault.remote.role === 'writer', `expected writer, got ${writerVault.remote.role}`);
  const db = new Database(writerVault.path, { fileMustExist: true });
  try {
    expect(outboxTriggersInstalled(db), 'a writer has no queue triggers');
    expect(countOutbox(db).pending === 0, 'hydration queued the corpus it just received');
  } finally { db.close(); }

  const note = await withVaultDatabase(writerVault.id, () => notesRepo.createNote({ title: 'Aportación del colaborador', folderId: null }));
  writtenNoteId = note.id;
  const after = new Database(writerVault.path, { fileMustExist: true });
  try {
    const queued = after.prepare("SELECT * FROM server_outbox WHERE state = 'pending'").all();
    expect(queued.length === 1, `${queued.length} entries queued, expected 1`);
    expect(queued[0].row_key === JSON.stringify([note.id]), `row key ${queued[0].row_key}`);
  } finally { after.close(); }
  return `1 note queued as ${JSON.stringify([note.id])}`;
});

await check('the queue drains to the server', async () => {
  // Anything an earlier attempt left in the ledger is not what this check is about.
  const stale = await (await api(owner.deviceToken, 'GET', `/api/v1/spaces/${SPACE_ID}/mutations`)).json();
  if (stale.cursor) await api(owner.deviceToken, 'POST', `/api/v1/spaces/${SPACE_ID}/mutations/ack`, { json: { cursor: stale.cursor } });
  await replica.drainOutbox(writerVault.id);
  const db = new Database(writerVault.path, { fileMustExist: true });
  try {
    const counts = countOutbox(db);
    expect(counts.pending === 0, `${counts.pending} still pending`);
    expect(counts.rejected === 0, `${counts.rejected} rejected`);
  } finally { db.close(); }
  const ledger = await (await api(owner.deviceToken, 'GET', `/api/v1/spaces/${SPACE_ID}/mutations`)).json();
  expect(ledger.mutations.length === 1, `${ledger.mutations.length} mutations in the ledger`);
  return 'accepted and waiting for the owner';
});

await check('the owner collects it into the canonical vault and republishes', async () => {
  const ledger = await (await api(owner.deviceToken, 'GET', `/api/v1/spaces/${SPACE_ID}/mutations`)).json();
  const db = new Database(VAULT, { fileMustExist: true });
  let summary;
  try {
    summary = applyIncomingMutations(db, ledger.mutations);
    expect(summary.applied === 1, `applied ${summary.applied}, refused ${JSON.stringify(summary.refused)}`);
    expect(db.prepare('SELECT 1 FROM notes WHERE id = ?').get(writtenNoteId), 'the note is not in the owner vault');
    // What the Inbox will show for this arrival, against a live server rather than a fixture.
    expect(summary.entries.length === 1, `${summary.entries.length} inbox entries for one mutation`);
    expect(summary.entries[0].outcome === 'applied', `inbox says "${summary.entries[0].outcome}"`);
    expect(summary.entries[0].entityKind === 'note', `inbox kind is "${summary.entries[0].entityKind}"`);
    // Replaying the batch describes the same mutation under the same id, which is what lets
    // recordServerInbox keep the first account instead of duplicating or resurrecting it.
    const again = applyIncomingMutations(db, ledger.mutations);
    expect(again.entries[0]?.id === summary.entries[0].id, 'a replay changed the mutation id');
  } finally { db.close(); }
  await api(owner.deviceToken, 'POST', `/api/v1/spaces/${SPACE_ID}/mutations/ack`, { json: { cursor: summary.cursor } });
  await publish(owner.deviceToken);
  return 'applied, acknowledged and republished';
});

await check('the reader now sees it, and keeps their own note', async () => {
  await replica.pullReplica(readerVault.id);
  const db = new Database(readerVault.path, { fileMustExist: true });
  try {
    expect(db.prepare('SELECT 1 FROM notes WHERE id = ?').get(writtenNoteId), "the collaborator's note did not arrive");
    const mine = db.prepare("SELECT COUNT(*) n FROM notes WHERE title = 'Nota privada del lector'").get().n;
    expect(mine === 1, `the reader's own note survived ${mine} times`);
    for (const [table, expected] of Object.entries(published.counts)) {
      if (expected === 0) continue;
      expect(db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n >= expected, `${table} was damaged by the pull`);
    }
  } finally { db.close(); }
  return "the collaborator's work arrived and the reader's own survived the overwrite";
});

await check('a revoked replica keeps every byte', async () => {
  // Measure whatever this vault type's largest published table is: `works` is empty in a
  // genealogy or study corpus and would prove nothing.
  const biggest = Object.entries(published.counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'works';
  const before = new Database(readerVault.path, { fileMustExist: true });
  const works = before.prepare(`SELECT COUNT(*) n FROM "${biggest}"`).get().n;
  before.close();

  // Revoke through the real administration form.
  const login = await fetch(`${URL_BASE}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'audit-admin@local.test', password: 'local-audit-admin-throwaway-2026', next: '/' }),
  });
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const page = await (await fetch(`${URL_BASE}/`, { headers: { cookie } })).text();
  const csrf = page.match(/name="csrf" value="([^"]+)"/)[1];
  const row = page.slice(page.indexOf(process.env.NODUS_LAB_READER_EMAIL));
  const userId = row.match(/name="userId" value="([0-9a-f-]{36})"/)[1];
  await fetch(`${URL_BASE}/admin/access/revoke`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ csrf, userId, spaceId: SPACE_ID }),
  });

  await replica.pullReplica(readerVault.id, { force: true });
  const overview = replica.getReplicaOverview().find((entry) => entry.vaultId === readerVault.id);
  expect(overview.state === 'revoked', `state is ${overview.state}`);
  const after = new Database(readerVault.path, { fileMustExist: true });
  try {
    expect(after.prepare(`SELECT COUNT(*) n FROM "${biggest}"`).get().n === works, 'the corpus was destroyed on revocation');
    expect(after.prepare("SELECT 1 FROM notes WHERE title = 'Nota privada del lector'").get(), "the reader's own work was destroyed");
  } finally { after.close(); }
  // Restore the membership this check deliberately removed, so the script can be run twice
  // against the same space without every earlier check failing on the second pass.
  const page2 = await (await fetch(`${URL_BASE}/`, { headers: { cookie } })).text();
  await fetch(`${URL_BASE}/admin/access/grant`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ csrf: page2.match(/name="csrf" value="([^"]+)"/)[1], userId, spaceId: SPACE_ID, role: 'reader' }),
  });
  return `${works} works still readable offline, own notes intact`;
});

await check('the owner publishes its embeddings and semantic search works', async () => {
  const { buildVectorSet } = require(path.join(repoRoot, 'electron/serverSync/serverVectors.ts'));
  const db = new Database(VAULT, { readonly: true, fileMustExist: true });
  let built;
  let probe;
  try {
    built = buildVectorSet(db, 'ideas');
    if (!built) return 'this corpus has no idea embeddings (only academic vaults index ideas)';
    // A vector taken FROM the corpus: its nearest neighbour must be itself, which is the
    // only end-to-end proof that quantization, the wire format and the search all agree.
    probe = db.prepare(
      `SELECT global_id, label, embedding FROM ideas
        WHERE embedding IS NOT NULL AND embedding_provider = ? AND embedding_model = ? AND embedding_dim = ?
        ORDER BY global_id LIMIT 1`
    ).get(built.summary.provider, built.summary.model, built.summary.dim);
  } finally { db.close(); }

  const gz = gzipSync(built.buffer, { level: 1 });
  const upload = await api(owner.deviceToken, 'PUT', `/api/v1/spaces/${SPACE_ID}/vectors?kind=ideas`, {
    body: gz, headers: { 'content-type': 'application/vnd.nodus.vectors', 'content-encoding': 'gzip' },
  });
  // Read the body once: interpolating a second read into the failure message consumes it.
  const stored = await upload.json().catch(() => ({}));
  expect(upload.ok, `vector upload HTTP ${upload.status}: ${JSON.stringify(stored)}`);
  expect(stored.count === built.summary.count, `server stored ${stored.count} of ${built.summary.count}`);

  const vector = Array.from(new Float32Array(probe.embedding.buffer, probe.embedding.byteOffset, built.summary.dim));
  const started = Date.now();
  const search = await (await api(owner.deviceToken, 'POST', `/api/v1/spaces/${SPACE_ID}/search/semantic`, {
    json: { vector, provider: built.summary.provider, model: built.summary.model, dim: built.summary.dim, limit: 10 },
  })).json();
  const elapsed = Date.now() - started;
  expect(search.indexed === true, `search says indexed=${search.indexed} (${search.reason ?? ''})`);
  expect(search.results[0]?.id === probe.global_id, `nearest neighbour was ${search.results[0]?.id}, expected itself`);
  expect(search.results[0].score > 0.99, `self-similarity came back as ${search.results[0].score}`);
  expect(search.results[0].row?.label === probe.label, 'the hit did not resolve to its corpus row');

  // A different provider must be told, not handed an empty list.
  const mismatched = await (await api(owner.deviceToken, 'POST', `/api/v1/spaces/${SPACE_ID}/search/semantic`, {
    json: { query: 'memoria', vector, provider: 'openai', model: 'text-embedding-3-small', dim: built.summary.dim },
  })).json();
  expect(mismatched.indexed === false && mismatched.reason === 'provider_mismatch', 'a mismatched provider was not reported');

  return `${stored.count.toLocaleString('es-ES')} vectors of ${stored.dim}d, ${(gz.length / 1048576).toFixed(1)} MiB on the wire (${(built.buffer.length / 1048576).toFixed(1)} raw), query in ${elapsed} ms, self-match ${search.results[0].score.toFixed(4)}`;
});

await check('disconnecting keeps the vault and stops the syncing', async () => {
  const biggestTable = Object.entries(published.counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'works';
  const before = new Database(writerVault.path, { fileMustExist: true });
  const works = before.prepare(`SELECT COUNT(*) AS n FROM "${biggestTable}"`).get().n;
  before.close();
  const after = replica.detachReplica(writerVault.id);
  const entry = after.find((item) => item.vaultId === writerVault.id);
  expect(entry.state === 'paused', `state is ${entry.state}`);
  const db = new Database(writerVault.path, { fileMustExist: true });
  try {
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "${biggestTable}"`).get().n === works, 'disconnecting destroyed the corpus');
  } finally { db.close(); }
  // A detached vault is not pulled again on the next tick.
  await replica.pullReplica(writerVault.id);
  expect(replica.getReplicaOverview().find((item) => item.vaultId === writerVault.id).state === 'paused', 'a detached replica resumed syncing');
  return `${works} ${biggestTable} kept, syncing stopped`;
});

console.log(`\n${failures === 0 ? 'All' : `${failures} of the`} checks ${failures === 0 ? 'passed' : 'FAILED'}.`);
replica.stopReplicaSync();
if (!process.env.NODUS_LAB_KEEP) fs.rmSync(PROFILE, { recursive: true, force: true });
process.exit(failures > 0 ? 1 : 0);
