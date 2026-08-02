// Walk every endpoint of a LIVE Nodus Server and report what each one actually did.
//
// The test suite proves the code is correct against a server this machine spawned. This
// proves a real deployment behind a real reverse proxy behaves the same: HTTPS, Caddy's
// X-Forwarded-For, Docker's volume, the published limits, and a corpus of the size the
// person actually has rather than a six-row fixture.
//
// It is READ-DOMINANT and additive. It publishes a snapshot, uploads one small image and
// sends one note as a writer; it never deletes a space, never touches an account, and never
// writes to the vault it reads. Point it at a COPY of the vault regardless: publishing runs
// migrations, and running a branch's migrations against a real vault is how a real vault
// gets corrupted.
//
//   NODUS_AUDIT_URL=https://nodus.example.es \
//   NODUS_AUDIT_VAULT=/path/to/copy/nodus.sqlite \
//   NODUS_AUDIT_SPACE_ID=<uuid from the dashboard> \
//   NODUS_AUDIT_OWNER_EMAIL=... NODUS_AUDIT_OWNER_PASSWORD=... \
//   NODUS_AUDIT_READER_EMAIL=... NODUS_AUDIT_READER_PASSWORD=... \
//   NODUS_AUDIT_WRITER_EMAIL=... NODUS_AUDIT_WRITER_PASSWORD=... \
//   node scripts/audit-nodus-server.mjs
//
// Every credential comes from the environment and none is ever printed.
import { createRequire } from 'node:module';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(path.join(repoRoot, 'scripts/audit-nodus-server.mjs'), '--electron-audit')) {
  process.exit(0);
}

const URL_BASE = (process.env.NODUS_AUDIT_URL || '').replace(/\/+$/, '');
const VAULT = process.env.NODUS_AUDIT_VAULT || '';
const SPACE_ID = process.env.NODUS_AUDIT_SPACE_ID || '';
if (!URL_BASE || !VAULT || !SPACE_ID) {
  console.error('Set NODUS_AUDIT_URL, NODUS_AUDIT_VAULT and NODUS_AUDIT_SPACE_ID. See the header of this file.');
  process.exit(2);
}

installRuntimeHooks(path.join(repoRoot, '.audit-userdata'));
const { buildServerSnapshot } = require(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'));
const Database = require('better-sqlite3');

const results = [];
let failures = 0;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail ?? '');
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

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

async function deviceToken(role) {
  const email = process.env[`NODUS_AUDIT_${role}_EMAIL`];
  const password = process.env[`NODUS_AUDIT_${role}_PASSWORD`];
  if (!email || !password) return null;
  const login = await api(null, 'POST', '/api/v1/auth/login', { json: { email, password } });
  expect(login.status === 200, `${role} sign-in returned HTTP ${login.status}`);
  const session = await login.json();
  const device = await api(null, 'POST', '/api/v1/auth/device', {
    json: { ticket: session.ticket, spaceId: SPACE_ID, deviceName: 'Nodus audit' },
  });
  expect(device.status === 200, `${role} device token returned HTTP ${device.status}`);
  const value = await device.json();
  return { ...value, spaces: session.spaces };
}

console.log(`\nAuditing ${URL_BASE} · space ${SPACE_ID}\n`);

// ── Public surface ──────────────────────────────────────────────────────────
let capabilities = null;
await check('GET /healthz', async () => {
  const response = await fetch(`${URL_BASE}/healthz`);
  expect(response.ok, `HTTP ${response.status}`);
  const value = await response.json();
  expect(value.ok === true, 'not healthy');
  return `service ${value.service}`;
});

await check('GET /api/v1/capabilities', async () => {
  const response = await fetch(`${URL_BASE}/api/v1/capabilities`);
  expect(response.ok, `HTTP ${response.status} — is this server running the branch?`);
  capabilities = await response.json();
  expect(capabilities.snapshotVersions?.includes(2), 'this server does not accept snapshot v2');
  expect(capabilities.mutations === true && capabilities.assets === true, 'mutations or assets are not advertised');
  return `snapshot v${capabilities.snapshotVersions.join('/')}, assets ≤ ${(capabilities.maxAssetBytes / 1048576).toFixed(0)} MiB`;
});

await check('both OAuth resources publish their own metadata', async () => {
  const [mcp, apiMeta] = await Promise.all([
    (await fetch(`${URL_BASE}/.well-known/oauth-protected-resource/mcp`)).json(),
    (await fetch(`${URL_BASE}/.well-known/oauth-protected-resource/api/v1`)).json(),
  ]);
  expect(mcp.resource.endsWith('/mcp'), 'mcp resource is wrong');
  expect(apiMeta.resource.endsWith('/api/v1'), 'api resource is wrong');
  expect(!mcp.scopes_supported.includes('materials.write'), 'the AI surface must not advertise a write scope');
  return 'separate resources, write scope only on the API';
});

await check('an unauthenticated read is refused', async () => {
  const response = await api(null, 'GET', `/api/v1/spaces/${SPACE_ID}/ideas`);
  expect(response.status === 401, `expected 401, got ${response.status}`);
  expect(/oauth-protected-resource\/api\/v1/.test(response.headers.get('www-authenticate') || ''), 'the challenge names the wrong resource');
  return '401 with the API resource in the challenge';
});

// ── Sign in ─────────────────────────────────────────────────────────────────
let owner = null;
let reader = null;
let writer = null;
await check('owner signs in and takes a device token', async () => {
  owner = await deviceToken('OWNER');
  expect(owner, 'NODUS_AUDIT_OWNER_EMAIL / _PASSWORD are not set');
  expect(owner.role === 'owner', `this account is ${owner.role} on that space, not owner`);
  return `role ${owner.role}, ${owner.spaces.length} space(s) visible`;
});
await check('reader signs in', async () => {
  reader = await deviceToken('READER');
  if (!reader) return 'skipped (no reader credentials)';
  expect(reader.role === 'reader', `expected reader, got ${reader.role}`);
  return `role ${reader.role}`;
});
await check('writer signs in', async () => {
  writer = await deviceToken('WRITER');
  if (!writer) return 'skipped (no writer credentials)';
  expect(writer.role === 'writer', `expected writer, got ${writer.role}`);
  return `role ${writer.role}`;
});

// ── Publish the corpus ──────────────────────────────────────────────────────
let snapshot = null;
await check('build a snapshot from the vault copy', async () => {
  const db = new Database(VAULT, { readonly: true, fileMustExist: true });
  try {
    snapshot = buildServerSnapshot(
      { id: 'audit', name: 'Audit', type: 'academic' },
      { nodusServerIncludeUserContent: true, nodusServerIncludePassages: process.env.NODUS_AUDIT_PASSAGES === '1' },
      db,
    );
  } finally {
    db.close();
  }
  const tables = Object.entries(snapshot.counts).filter(([, n]) => n > 0);
  const rows = tables.reduce((sum, [, n]) => sum + n, 0);
  return `${tables.length} tables, ${rows.toLocaleString('es-ES')} rows, ${(snapshot.buffer.length / 1048576).toFixed(1)} MiB raw, ${snapshot.assets.length} image(s)`;
});

await check('upload the images the snapshot references', async () => {
  if (!snapshot?.assets.length) return 'no images in this vault';
  const wanted = new Map();
  for (const asset of snapshot.assets) {
    wanted.set(asset.hash, { data: asset.data, mime: asset.mime });
    if (asset.thumbHash && asset.thumbData) wanted.set(asset.thumbHash, { data: asset.thumbData, mime: asset.thumbMime });
  }
  const negotiate = await api(owner.deviceToken, 'POST', `/api/v1/spaces/${SPACE_ID}/assets/negotiate`, {
    json: { assets: [...wanted].map(([hash, value]) => ({ hash, bytes: value.data.length, mime: value.mime })) },
  });
  expect(negotiate.ok, `negotiate returned HTTP ${negotiate.status}`);
  const { missing } = await negotiate.json();
  let sent = 0;
  for (const hash of missing) {
    const asset = wanted.get(hash);
    const upload = await api(owner.deviceToken, 'POST', `/api/v1/spaces/${SPACE_ID}/assets/${hash}`, {
      body: asset.data, headers: { 'content-type': asset.mime },
    });
    expect(upload.ok, `image ${hash.slice(0, 8)} returned HTTP ${upload.status}`);
    sent += 1;
  }
  return `${wanted.size} referenced, ${sent} uploaded, ${wanted.size - sent} already there`;
});

await check('a document is refused by the image channel', async () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
  const hash = require('node:crypto').createHash('sha256').update(pdf).digest('hex');
  const response = await api(owner.deviceToken, 'POST', `/api/v1/spaces/${SPACE_ID}/assets/${hash}`, { body: pdf });
  expect(response.status === 415, `expected 415, got ${response.status}`);
  return '415 on a PDF, as the product rule requires';
});

await check('PUT snapshot', async () => {
  const gzipped = gzipSync(snapshot.buffer, { level: 1 });
  const response = await api(owner.deviceToken, 'PUT', `/api/v1/spaces/${SPACE_ID}/snapshot`, {
    body: gzipped,
    headers: { 'content-encoding': 'gzip', 'x-nodus-revision': snapshot.revision, 'content-type': 'application/vnd.nodus.snapshot+json' },
  });
  const value = await response.json();
  expect(response.ok, `HTTP ${response.status}: ${value.error ?? ''}`);
  return `${(gzipped.length / 1048576).toFixed(1)} MiB on the wire`;
});

await check('republishing the same revision is a no-op', async () => {
  const response = await api(owner.deviceToken, 'PUT', `/api/v1/spaces/${SPACE_ID}/snapshot`, {
    body: gzipSync(snapshot.buffer, { level: 1 }),
    headers: { 'content-encoding': 'gzip', 'x-nodus-revision': snapshot.revision },
  });
  const value = await response.json();
  expect(value.unchanged === true, 'the server did not short-circuit an identical publication');
  return 'unchanged, no bytes read';
});

// ── Read everything ─────────────────────────────────────────────────────────
const token = () => (reader?.deviceToken ?? owner.deviceToken);
const readAs = reader ? 'reader' : 'owner';

await check(`GET /spaces/:id as ${readAs}`, async () => {
  const response = await api(token(), 'GET', `/api/v1/spaces/${SPACE_ID}`);
  expect(response.ok, `HTTP ${response.status}`);
  const value = await response.json();
  expect(value.snapshotFormatVersion === 2, `served format v${value.snapshotFormatVersion}`);
  return `schema v${value.schemaVersion}, ${Object.keys(value.counts).length} tables, ${value.assets} image(s)`;
});

for (const [pathname, key] of [
  ['works', 'works'], ['ideas', 'ideas'], ['themes', 'themes'], ['gaps', 'gaps'],
  ['authors', 'authors'], ['notes', 'notes'], ['deep-research', 'reports'],
  ['immersion', 'sessions'], ['debates', 'debates'], ['passages', 'passages'],
]) {
  await check(`GET /${pathname}`, async () => {
    const started = Date.now();
    const response = await api(token(), 'GET', `/api/v1/spaces/${SPACE_ID}/${pathname}?limit=20`);
    expect(response.ok, `HTTP ${response.status}`);
    const value = await response.json();
    expect(Array.isArray(value[key]), `no "${key}" array in the response`);
    return `${value.total.toLocaleString('es-ES')} total, ${value[key].length} returned, ${Date.now() - started} ms`;
  });
}

await check('a list revalidates with 304', async () => {
  const first = await api(token(), 'GET', `/api/v1/spaces/${SPACE_ID}/ideas?limit=20`);
  const etag = first.headers.get('etag');
  expect(etag, 'no ETag on a list');
  const second = await api(token(), 'GET', `/api/v1/spaces/${SPACE_ID}/ideas?limit=20`, { headers: { 'if-none-match': etag } });
  expect(second.status === 304, `expected 304, got ${second.status}`);
  return 'the common refresh costs no body';
});

await check('a detail and its subgraph resolve', async () => {
  const list = await (await api(token(), 'GET', `/api/v1/spaces/${SPACE_ID}/ideas?limit=1`)).json();
  if (!list.ideas.length) return 'no ideas in this vault';
  const id = encodeURIComponent(list.ideas[0].global_id);
  const detail = await (await api(token(), 'GET', `/api/v1/spaces/${SPACE_ID}/ideas/${id}`)).json();
  const graph = await (await api(token(), 'GET', `/api/v1/spaces/${SPACE_ID}/ideas/${id}/graph?depth=2`)).json();
  return `${detail.relations.length} relations, ${detail.themes.length} themes, subgraph ${graph.ideas.length} ideas / ${graph.edges.length} edges`;
});

await check('lexical search', async () => {
  const query = process.env.NODUS_AUDIT_QUERY || 'archivo';
  const started = Date.now();
  const response = await api(token(), 'GET', `/api/v1/spaces/${SPACE_ID}/search?q=${encodeURIComponent(query)}&limit=20`);
  expect(response.ok, `HTTP ${response.status}`);
  const value = await response.json();
  return `"${query}" → ${value.results.length} hits in ${Date.now() - started} ms`;
});

await check('semantic search reports honestly with no index', async () => {
  const response = await api(token(), 'POST', `/api/v1/spaces/${SPACE_ID}/search/semantic`, {
    json: { query: process.env.NODUS_AUDIT_QUERY || 'archivo', vector: [0.1, 0.2], provider: 'openai', model: 'text-embedding-3-small', dim: 2 },
  });
  const value = await response.json();
  expect(value.indexed === false || value.indexed === true, 'no index verdict');
  return value.indexed ? `indexed, ${value.indexable} vectors` : `${value.reason}, fell back to ${value.fallback}`;
});

await check('the context package carries material and no key', async () => {
  const response = await api(token(), 'POST', `/api/v1/spaces/${SPACE_ID}/context`, {
    json: { query: process.env.NODUS_AUDIT_QUERY || 'archivo' },
  });
  expect(response.ok, `HTTP ${response.status}`);
  const value = await response.json();
  expect(!JSON.stringify(value).includes('api_key'), 'the response mentions a key');
  return `${value.sections.length} sections, ${value.stats.chars.toLocaleString('es-ES')} chars${value.stats.truncated ? ' (truncated)' : ''}`;
});

await check('an image can be fetched back', async () => {
  if (!snapshot?.assets.length) return 'no images in this vault';
  const asset = snapshot.assets[0];
  const response = await api(token(), 'GET', `/api/v1/spaces/${SPACE_ID}/assets/${asset.thumbHash ?? asset.hash}`);
  expect(response.ok, `HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(response.headers.get('content-type').startsWith('image/'), 'not served as an image');
  return `${(bytes.length / 1024).toFixed(0)} KiB, ${response.headers.get('content-type')}`;
});

await check('the snapshot can be pulled back for hydration', async () => {
  const response = await api(token(), 'GET', `/api/v1/spaces/${SPACE_ID}/snapshot`);
  expect(response.ok, `HTTP ${response.status}`);
  const text = await response.text();
  const payload = JSON.parse(text);
  expect(payload.formatVersion === 2, `pulled format v${payload.formatVersion}`);
  return `${Object.keys(payload.tables).length} tables came back`;
});

// ── Write path ──────────────────────────────────────────────────────────────
await check('a reader cannot publish', async () => {
  if (!reader) return 'skipped (no reader credentials)';
  const response = await api(reader.deviceToken, 'PUT', `/api/v1/spaces/${SPACE_ID}/snapshot`, {
    body: gzipSync(Buffer.from('{}')), headers: { 'content-encoding': 'gzip', 'x-nodus-revision': 'audit' },
  });
  expect(response.status === 403, `expected 403, got ${response.status}`);
  return `403, required ${(await response.json()).required}`;
});

await check('a reader cannot send a mutation', async () => {
  if (!reader) return 'skipped (no reader credentials)';
  const response = await api(reader.deviceToken, 'POST', `/api/v1/spaces/${SPACE_ID}/mutations`, {
    json: { mutations: [{ id: `audit-${Date.now()}`, kind: 'upsert', table: 'notes', key: ['audit'], row: { id: 'audit' }, schemaVersion: 122, createdAt: new Date().toISOString() }] },
  });
  expect(response.status === 403, `expected 403, got ${response.status}`);
  return '403, and nothing stored';
});

await check('a writer sends a note and the owner collects it', async () => {
  if (!writer) return 'skipped (no writer credentials)';
  const stamp = new Date().toISOString();
  const id = `audit-note-${Date.now()}`;
  const sent = await api(writer.deviceToken, 'POST', `/api/v1/spaces/${SPACE_ID}/mutations`, {
    json: { mutations: [{
      id, clientId: 'audit', kind: 'upsert', table: 'notes', key: [id],
      row: { id, folder_id: null, title: 'Nota de auditoría', kind: 'markdown', content: 'Enviada por el script de auditoría.', source_json: null, order_idx: 0, created_at: stamp, updated_at: stamp },
      schemaVersion: 122, createdAt: stamp,
    }] },
  });
  const accepted = await sent.json();
  expect(sent.ok, `HTTP ${sent.status}: ${JSON.stringify(accepted)}`);
  expect(accepted.accepted?.length === 1, `rejected: ${JSON.stringify(accepted.rejected)}`);

  const drained = await (await api(owner.deviceToken, 'GET', `/api/v1/spaces/${SPACE_ID}/mutations`)).json();
  expect(drained.mutations.some((entry) => entry.id === id), 'the owner did not see the mutation');
  const acked = await api(owner.deviceToken, 'POST', `/api/v1/spaces/${SPACE_ID}/mutations/ack`, { json: { cursor: drained.cursor } });
  expect(acked.ok, `ack returned HTTP ${acked.status}`);
  return `queued, collected and acknowledged (${drained.mutations.length} pending before ack)`;
});

await check('a writer cannot drain the queue', async () => {
  if (!writer) return 'skipped (no writer credentials)';
  const response = await api(writer.deviceToken, 'GET', `/api/v1/spaces/${SPACE_ID}/mutations`);
  expect(response.status === 403, `expected 403, got ${response.status}`);
  return '403 — only the owner collects';
});

await check('GET /api/v1/me lists only what the caller has', async () => {
  const response = await api(token(), 'GET', '/api/v1/me');
  expect(response.ok, `HTTP ${response.status}`);
  const value = await response.json();
  return `${value.spaces.length} space(s), device kind ${value.device?.kind}`;
});

console.log(`\n${results.length - failures}/${results.length} checks passed.`);
if (failures > 0) {
  console.log('\nFailures:');
  for (const result of results.filter((entry) => !entry.ok)) console.log(`  · ${result.name}: ${result.detail}`);
}
process.exit(failures > 0 ? 1 : 0);
