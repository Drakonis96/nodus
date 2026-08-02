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
    snapshot = buildServerSnapshot({ id: 'lab', name: 'Lab', type: 'academic' }, { nodusServerIncludeUserContent: true, nodusServerIncludePassages: false }, db);
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
  expect(readerVault.type === 'academic', `vault type came back as ${readerVault.type}`);
  return `"${readerVault.name}", ${readerVault.remote.role}, schema migrated locally`;
});

await check('the corpus really arrived', async () => {
  const db = new Database(readerVault.path, { fileMustExist: true });
  try {
    const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    const local = { works: n('works'), ideas: n('ideas'), edges: n('edges'), drafts: n('writing_saved_drafts'), immersion: n('immersion_sessions') };
    expect(local.works === published.counts.works, `works ${local.works} vs published ${published.counts.works}`);
    expect(local.ideas === published.counts.ideas, `ideas ${local.ideas} vs ${published.counts.ideas}`);
    expect(local.edges === published.counts.edges, `edges ${local.edges} vs ${published.counts.edges}`);
    return `${local.works} works, ${local.ideas} ideas, ${local.edges} edges, ${local.drafts} drafts, ${local.immersion} immersion`;
  } finally { db.close(); }
});

await check('a Deep Research report is readable in the replica', async () => {
  const db = new Database(readerVault.path, { fileMustExist: true });
  try {
    const row = db.prepare("SELECT id, title, draft_json FROM writing_saved_drafts WHERE brief_json LIKE '%deep_research%' LIMIT 1").get();
    if (!row) return 'no reports in this corpus';
    const draft = JSON.parse(row.draft_json);
    expect(draft.draftMarkdown?.length > 0, 'the report arrived without its prose');
    return `"${row.title.slice(0, 40)}…", ${draft.draftMarkdown.split(/\s+/).length.toLocaleString('es-ES')} words`;
  } finally { db.close(); }
});

await check('the illustrations reached the replica', async () => {
  const db = new Database(readerVault.path, { fileMustExist: true });
  try {
    const ready = db.prepare("SELECT COUNT(*) n FROM decorative_images WHERE entity_kind = 'deep_research' AND status = 'ready'").get().n;
    const withBytes = db.prepare("SELECT COUNT(*) n FROM decorative_images WHERE image_blob IS NOT NULL").get().n;
    expect(ready === 0 || withBytes > 0, `${ready} illustration(s) are marked ready but ${withBytes} have bytes — a broken image in every report`);
    return `${withBytes}/${ready} illustrations have their bytes`;
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
    expect(db.prepare('SELECT COUNT(*) n FROM works').get().n === published.counts.works, 'the corpus was damaged by the pull');
  } finally { db.close(); }
  return "the collaborator's work arrived and the reader's own survived the overwrite";
});

await check('a revoked replica keeps every byte', async () => {
  const before = new Database(readerVault.path, { fileMustExist: true });
  const works = before.prepare('SELECT COUNT(*) n FROM works').get().n;
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
    expect(after.prepare('SELECT COUNT(*) n FROM works').get().n === works, 'the corpus was destroyed on revocation');
    expect(after.prepare("SELECT 1 FROM notes WHERE title = 'Nota privada del lector'").get(), "the reader's own work was destroyed");
  } finally { after.close(); }
  return `${works} works still readable offline, own notes intact`;
});

console.log(`\n${failures === 0 ? 'All' : `${failures} of the`} checks ${failures === 0 ? 'passed' : 'FAILED'}.`);
replica.stopReplicaSync();
if (!process.env.NODUS_LAB_KEEP) fs.rmSync(PROFILE, { recursive: true, force: true });
process.exit(failures > 0 ? 1 : 0);
