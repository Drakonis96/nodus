import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { getDb } from '../db/database';
import { SCHEMA_VERSION } from '../db/migrations';
import { quoteIdentifier, identityColumns } from '../db/rowIdentity';
import { createVault, deleteVault, getVault, listVaults, updateVaultRemote } from '../vaults/vaultRegistry';
import { clearNodusServerTokenFor, getNodusServerTokenFor, setNodusServerTokenFor } from '../secrets/secretStore';
import type { VaultRemote, VaultRemoteRole, VaultSummary, VaultType } from '@shared/types';
import { normalizeVaultType } from '@shared/vaultTypes';
import { applySnapshotToReplica } from './replicaApply';
import { stripUnpublishableColumns } from './serverSnapshot';
import {
  countOutbox, ensureOutboxTriggers, listPendingOutbox, markOutboxRejected, markOutboxSent, MUTABLE_TABLES, pruneSentOutbox,
} from './outboxTriggers';

/**
 * A connected vault: a local replica of a Nodus Server space.
 *
 * The publisher in serverSyncService.ts pushes; this pulls, and — for an account with write
 * access — drains the outgoing queue. They are deliberately separate services with separate
 * timers, because a machine can hold both kinds of vault at once: the corpus it owns and
 * publishes, and a colleague's corpus it merely reads.
 *
 * What this never does is delete local data. A revoked replica stops syncing and says so;
 * its rows stay exactly where they are. Destroying someone's own notes because a server
 * withdrew access is not a recovery, and it is not ours to do.
 */

const CHECK_INTERVAL_MS = 30_000;
const FIRST_TICK_MS = 7_000;
const REQUEST_TIMEOUT_MS = 60_000;
const OUTBOX_BATCH = 100;

let timer: ReturnType<typeof setInterval> | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;
let working = false;

export type ReplicaPhase = 'idle' | 'syncing' | 'ok' | 'error' | 'revoked' | 'paused';

interface ReplicaRuntime {
  phase: ReplicaPhase;
  lastPulledAt: string | null;
  lastError: string | null;
  pendingMutations: number;
  rejectedMutations: number;
}

const runtimes = new Map<string, ReplicaRuntime>();
const readonlyPool = new Map<string, Database.Database>();

function runtimeFor(vaultId: string): ReplicaRuntime {
  let runtime = runtimes.get(vaultId);
  if (!runtime) {
    runtime = { phase: 'idle', lastPulledAt: null, lastError: null, pendingMutations: 0, rejectedMutations: 0 };
    runtimes.set(vaultId, runtime);
  }
  return runtime;
}

function normalizeUrl(value: string): string {
  const clean = String(value ?? '').trim().replace(/\/+$/, '');
  let parsed: URL;
  try { parsed = new URL(clean); } catch { throw new Error('Introduce una URL válida del servidor.'); }
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('Nodus Server necesita HTTPS fuera de localhost.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Usa solo la dirección base del servidor, sin credenciales, parámetros ni fragmentos.');
  return parsed.toString().replace(/\/+$/, '');
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

function deviceName(): string {
  return `Nodus · ${os.hostname()}`;
}

// ── Sign-in, in two steps ───────────────────────────────────────────────────
// The user knows their URL, email and password; they do not know the space ids. The first
// call returns a short-lived single-use ticket plus the spaces the account can reach, so the
// app can show a picker without holding the password or sending it twice.

export interface RemoteSpaceOption {
  id: string;
  name: string;
  description: string;
  role: VaultRemoteRole;
  vault: { id: string; name: string; type: string } | null;
  updatedAt: string | null;
  hasSnapshot: boolean;
}

export interface RemoteSignInResult {
  ticket: string;
  url: string;
  serverName: string;
  userEmail: string;
  spaces: RemoteSpaceOption[];
}

export async function signInToNodusServer(urlValue: string, email: string, password: string): Promise<RemoteSignInResult> {
  const url = normalizeUrl(urlValue);
  const response = await request(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 401) throw new Error('El correo o la contraseña no son correctos.');
  if (response.status === 404) throw new Error('Ese servidor es anterior a los vaults conectados. Pide que lo actualicen.');
  if (!response.ok) throw new Error(`El servidor respondió con HTTP ${response.status}.`);
  const value = await response.json() as { ticket: string; spaces: RemoteSpaceOption[]; server?: { name?: string } };
  return {
    ticket: value.ticket,
    url,
    serverName: value.server?.name ?? 'Nodus Server',
    userEmail: String(email).trim().toLowerCase(),
    spaces: value.spaces ?? [],
  };
}

/**
 * Create the replica: a real, fully migrated SQLite that every repository reads normally.
 *
 * Not a proxy over HTTP. Making getDb() speak to a server would mean rewriting every one of
 * the ~70 repositories, the graph service and the MCP surface; replicating into a local
 * database means all of them work unchanged, and the vault stays readable on a train.
 */
export async function createConnectedVault(input: {
  url: string;
  ticket: string;
  space: RemoteSpaceOption;
  userEmail: string;
  serverName: string;
}): Promise<VaultSummary> {
  const url = normalizeUrl(input.url);
  const response = await request(`${url}/api/v1/auth/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket: input.ticket, spaceId: input.space.id, deviceName: deviceName() }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error_description?: string };
    throw new Error(detail.error_description || `El servidor rechazó la conexión (HTTP ${response.status}).`);
  }
  const session = await response.json() as { deviceToken: string; role: VaultRemoteRole; space: { id: string; name: string; vault?: { type?: string } | null } };

  const remote: VaultRemote = {
    url,
    spaceId: input.space.id,
    spaceName: input.space.name,
    serverName: input.serverName,
    userEmail: input.userEmail,
    role: session.role,
    state: 'active',
    lastPulledRevision: null,
    lastPulledAt: null,
  };
  // The vault type comes from the publication, not from the user: a connected academic vault
  // is an academic vault, and letting someone pick a different mode for it would show them a
  // navigation that does not match the data they are about to receive.
  const type: VaultType = normalizeVaultType(input.space.vault?.type ?? session.space.vault?.type ?? 'academic');
  const vault = createVault(input.space.name, type, { origin: 'connected', remote });

  try {
    setNodusServerTokenFor(vault.id, session.deviceToken);
    await pullReplica(vault.id, { force: true });
  } catch (error) {
    // A hydration that never completed leaves a vault that looks connected and holds
    // nothing. Roll it back rather than leave that behind.
    try { deleteVault(vault.id, true); } catch { /* the registry entry is already gone */ }
    throw error;
  }
  return getVault(vault.id) ?? vault;
}

// ── Pulling ─────────────────────────────────────────────────────────────────

function mayWrite(vault: VaultSummary): boolean {
  return vault.remote?.state === 'active' && (vault.remote.role === 'writer' || vault.remote.role === 'owner');
}

function openReplicaDb(vault: VaultSummary): Database.Database | null {
  if (vault.active) return getDb();
  const cached = readonlyPool.get(vault.path);
  if (cached) {
    try {
      cached.prepare('SELECT 1').get();
      // The role can change between ticks, so the gate is re-evaluated on every use rather
      // than only when the handle was first opened.
      ensureOutboxTriggers(cached, mayWrite(vault));
      return cached;
    } catch { readonlyPool.delete(vault.path); }
  }
  try {
    // Writable, unlike the publisher's read-only siblings: applying a publication is a write.
    const db = new Database(vault.path, { fileMustExist: true });
    // A non-active replica never goes through openDatabase(), which is where the gate
    // normally lives — without this, a writer's queue would silently never be populated.
    ensureOutboxTriggers(db, mayWrite(vault));
    readonlyPool.set(vault.path, db);
    return db;
  } catch { return null; }
}

function closeReplicaPool(): void {
  for (const db of readonlyPool.values()) { try { db.close(); } catch { /* ignore */ } }
  readonlyPool.clear();
}

/**
 * A 401 or 403 from the server.
 *
 * The publisher's answer is to drop its token and ask for a fresh pairing code. For a
 * replica that answer would be wrong: the vault stays, its data stays, and the user is told
 * they can sign in again or keep it as a local vault.
 */
function handleRevocation(vaultId: string, runtime: ReplicaRuntime): void {
  updateVaultRemote(vaultId, { state: 'revoked' });
  clearNodusServerTokenFor(vaultId);
  runtime.phase = 'revoked';
  runtime.lastError = 'El servidor ha revocado tu acceso a este espacio. La réplica sigue en este equipo y puedes seguir consultándola o convertirla en un vault local.';
}

export async function pullReplica(vaultId: string, options: { force?: boolean } = {}): Promise<void> {
  const vault = getVault(vaultId);
  if (!vault || vault.origin !== 'connected' || !vault.remote) return;
  const runtime = runtimeFor(vaultId);
  if (vault.remote.state === 'revoked') { runtime.phase = 'revoked'; return; }
  if (vault.remote.state === 'paused' && !options.force) { runtime.phase = 'paused'; return; }
  const token = getNodusServerTokenFor(vaultId);
  if (!token) { runtime.phase = 'error'; runtime.lastError = 'Falta la credencial de este vault conectado. Vuelve a iniciar sesión en el servidor.'; return; }

  const endpoint = `${normalizeUrl(vault.remote.url)}/api/v1/spaces/${encodeURIComponent(vault.remote.spaceId)}`;
  runtime.phase = 'syncing';
  try {
    // Refresh the role first: a downgrade has to reach ensureOutboxTriggers before anything
    // else runs, or a demoted account keeps queueing until its next restart.
    await refreshRole(vault, token);

    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (vault.remote.lastPulledRevision && !options.force) headers['if-none-match'] = `W/"${vault.remote.lastPulledRevision}"`;
    const response = await request(`${endpoint}/snapshot`, { headers });

    if (response.status === 401 || response.status === 403) { handleRevocation(vaultId, runtime); return; }
    if (response.status === 304) {
      runtime.phase = 'ok';
      runtime.lastError = null;
      await drainOutbox(vaultId);
      return;
    }
    if (response.status === 409) {
      runtime.phase = 'ok';
      runtime.lastError = 'El espacio remoto todavía no ha recibido ninguna publicación.';
      return;
    }
    if (!response.ok) throw new Error(`El servidor respondió con HTTP ${response.status}.`);

    const raw = Buffer.from(await response.arrayBuffer());
    // fetch() transparently decompresses, but a proxy may hand the bytes over untouched.
    const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    const snapshot = JSON.parse(text) as { schemaVersion?: number; revision?: string; tables?: Record<string, unknown> };

    if (Number(snapshot.schemaVersion) > SCHEMA_VERSION) {
      throw new Error(`Este espacio se publica con un esquema más reciente (v${snapshot.schemaVersion}) que el de esta instalación (v${SCHEMA_VERSION}). Actualiza Nodus para recibirlo.`);
    }

    const db = openReplicaDb(vault);
    if (!db) throw new Error('No se ha podido abrir la base de datos de la réplica.');
    applySnapshotToReplica(db, snapshot);

    const revision = response.headers.get('x-nodus-revision') || snapshot.revision || null;
    updateVaultRemote(vaultId, { lastPulledRevision: revision, lastPulledAt: new Date().toISOString() });
    runtime.phase = 'ok';
    runtime.lastError = null;
    runtime.lastPulledAt = new Date().toISOString();

    await drainOutbox(vaultId);
  } catch (error) {
    runtime.phase = 'error';
    runtime.lastError = error instanceof Error ? error.message : String(error);
  }
}

async function refreshRole(vault: VaultSummary, token: string): Promise<void> {
  try {
    const response = await request(`${normalizeUrl(vault.remote!.url)}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const value = await response.json() as { spaces?: { id: string; role: VaultRemoteRole }[] };
    const match = value.spaces?.find((space) => space.id === vault.remote!.spaceId);
    if (match && match.role !== vault.remote!.role) updateVaultRemote(vault.id, { role: match.role });
  } catch {
    // Offline: the stored role is advisory anyway, and the server re-checks every request.
  }
}

// ── Draining the outgoing queue ─────────────────────────────────────────────

/** Read the live row a queued entry points at, so what is sent is never a stale copy. */
function readRow(db: Database.Database, table: string, rowKey: string): Record<string, unknown> | null {
  let key: unknown[];
  try { key = JSON.parse(rowKey) as unknown[]; } catch { return null; }
  const identity = identityColumns(table, undefined, db);
  if (identity.length !== key.length) return null;
  const where = identity.map((column) => `${quoteIdentifier(column)} IS ?`).join(' AND ');
  const row = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} WHERE ${where}`).get(...key) as Record<string, unknown> | undefined;
  if (!row) return null;
  // Exactly the filter a publication uses. The server checks an incoming row against the
  // shape of the last snapshot, so sending the raw SELECT * — embeddings, blobs and all —
  // would be refused for naming columns that deliberately never travel.
  return stripUnpublishableColumns(row);
}

export async function drainOutbox(vaultId: string): Promise<void> {
  const vault = getVault(vaultId);
  if (!vault || vault.origin !== 'connected' || !vault.remote) return;
  const runtime = runtimeFor(vaultId);
  // Second of the three layers that stop a reader from sending. The first is the absence of
  // triggers in their database; the third is the server's own 403.
  if (vault.remote.role === 'reader' || vault.remote.state !== 'active') return;
  const token = getNodusServerTokenFor(vaultId);
  if (!token) return;

  const db = openReplicaDb(vault);
  if (!db) return;
  const pending = listPendingOutbox(db, OUTBOX_BATCH);
  const counts = countOutbox(db);
  runtime.pendingMutations = counts.pending;
  runtime.rejectedMutations = counts.rejected;
  if (pending.length === 0) return;

  const mutations = [];
  const sendable: string[] = [];
  for (const entry of pending) {
    let key: unknown[];
    try { key = JSON.parse(entry.row_key) as unknown[]; } catch { continue; }
    const row = entry.op === 'upsert' ? readRow(db, entry.table_name, entry.row_key) : null;
    // An upsert whose row is gone was deleted after being queued; the delete entry that
    // replaced it carries the truth, so this one is simply dropped.
    if (entry.op === 'upsert' && !row) { markOutboxSent(db, [entry.id]); continue; }
    mutations.push({
      id: entry.id,
      clientId: clientIdFor(vaultId),
      kind: entry.op,
      table: entry.table_name,
      key,
      ...(entry.op === 'upsert' ? { row } : {}),
      schemaVersion: entry.schema_version,
      createdAt: entry.created_at,
    });
    sendable.push(entry.id);
  }
  if (mutations.length === 0) return;

  try {
    const response = await request(
      `${normalizeUrl(vault.remote.url)}/api/v1/spaces/${encodeURIComponent(vault.remote.spaceId)}/mutations`,
      { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ mutations }) },
    );
    if (response.status === 401) { handleRevocation(vaultId, runtime); return; }
    if (response.status === 403) {
      // Downgraded mid-flight. The queue is kept and marked, never discarded: this is a
      // colleague's unsent work, and losing it silently is the failure to avoid.
      markOutboxRejected(db, sendable, 'Esta cuenta ya no tiene permiso de escritura en el espacio remoto.');
      updateVaultRemote(vaultId, { role: 'reader' });
      runtime.lastError = 'El servidor ha retirado el permiso de escritura. Tus cambios se conservan en este equipo, sin enviar.';
      return;
    }
    if (response.status === 409) {
      // Images referenced before their bytes arrived. Retried on the next tick.
      runtime.lastError = 'Faltan imágenes por subir antes de enviar estos cambios.';
      return;
    }
    if (!response.ok) throw new Error(`El servidor respondió con HTTP ${response.status}.`);
    const value = await response.json() as { accepted?: string[]; duplicate?: string[]; rejected?: { id: string; reason: string }[] };
    markOutboxSent(db, [...(value.accepted ?? []), ...(value.duplicate ?? [])]);
    for (const rejection of value.rejected ?? []) markOutboxRejected(db, [rejection.id], rejection.reason);
    pruneSentOutbox(db);
    const after = countOutbox(db);
    runtime.pendingMutations = after.pending;
    runtime.rejectedMutations = after.rejected;
  } catch (error) {
    runtime.lastError = error instanceof Error ? error.message : String(error);
  }
}

const clientIds = new Map<string, string>();

/** Stable per installation and vault, so the server can attribute a batch to one replica. */
function clientIdFor(vaultId: string): string {
  let id = clientIds.get(vaultId);
  if (!id) { id = randomUUID(); clientIds.set(vaultId, id); }
  return id;
}

// ── Service lifecycle ───────────────────────────────────────────────────────

function connectedVaults(): VaultSummary[] {
  try { return listVaults().filter((vault) => vault.origin === 'connected' && vault.remote); }
  catch { return []; }
}

async function tick(): Promise<void> {
  if (working) return;
  working = true;
  try {
    for (const vault of connectedVaults()) {
      if (vault.remote?.state !== 'active') continue;
      await pullReplica(vault.id);
    }
  } finally {
    working = false;
  }
}

export function startReplicaSync(): void {
  stopReplicaSync();
  if (connectedVaults().length === 0) return;
  firstTimer = setTimeout(() => void tick(), FIRST_TICK_MS);
  firstTimer.unref?.();
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function stopReplicaSync(): void {
  if (timer) clearInterval(timer);
  if (firstTimer) clearTimeout(firstTimer);
  timer = null;
  firstTimer = null;
  closeReplicaPool();
}

export function restartReplicaSync(): void {
  startReplicaSync();
}

export interface ReplicaConnection {
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  isActiveVault: boolean;
  url: string;
  spaceName: string;
  serverName: string;
  userEmail: string;
  role: VaultRemoteRole;
  state: VaultRemote['state'];
  phase: ReplicaPhase;
  lastPulledAt: string | null;
  lastError: string | null;
  pendingMutations: number;
  rejectedMutations: number;
}

export function getReplicaOverview(): ReplicaConnection[] {
  return connectedVaults().map((vault) => {
    const runtime = runtimeFor(vault.id);
    return {
      vaultId: vault.id,
      vaultName: vault.name,
      vaultType: vault.type,
      isActiveVault: vault.active,
      url: vault.remote!.url,
      spaceName: vault.remote!.spaceName,
      serverName: vault.remote!.serverName,
      userEmail: vault.remote!.userEmail,
      role: vault.remote!.role,
      state: vault.remote!.state,
      phase: runtime.phase,
      lastPulledAt: vault.remote!.lastPulledAt ?? runtime.lastPulledAt,
      lastError: runtime.lastError,
      pendingMutations: runtime.pendingMutations,
      rejectedMutations: runtime.rejectedMutations,
    };
  });
}

export async function syncReplicaNow(vaultId: string): Promise<ReplicaConnection[]> {
  await pullReplica(vaultId, { force: true });
  return getReplicaOverview();
}

/**
 * Cut a replica loose and keep it as an ordinary local vault.
 *
 * The offer that makes a revocation survivable: the data is already here and already
 * complete, so all that has to happen is that it stops being a replica.
 */
export function detachReplica(vaultId: string): ReplicaConnection[] {
  const vault = getVault(vaultId);
  if (vault?.origin === 'connected') {
    clearNodusServerTokenFor(vaultId);
    updateVaultRemote(vaultId, { state: 'paused' });
    runtimeFor(vaultId).phase = 'paused';
  }
  return getReplicaOverview();
}

export { MUTABLE_TABLES };
