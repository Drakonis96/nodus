import os from 'node:os';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { getDb, withVaultDatabase } from '../db/database';
import { getActiveVault, getVault, listVaults } from '../vaults/vaultRegistry';
import { getSettings, updateSettings } from '../db/settingsRepo';
import {
  clearNodusServerTokenFor,
  getNodusServerTokenFor,
  hasNodusServerTokenFor,
  setNodusServerToken,
} from '../secrets/secretStore';
import type {
  AppLanguage,
  AppSettings,
  NodusServerConnection,
  NodusServerOverview,
  NodusServerPairResult,
  NodusServerSyncPhase,
  VaultSummary,
} from '@shared/types';
import { normalizeUiLanguage } from '@shared/uiLanguage';
import { buildServerSnapshot, lightweightVaultRevision } from './serverSnapshot';

// A Nodus Server pairing belongs to ONE vault and one remote space. Unlike the old
// single-active-vault publisher, every paired vault keeps publishing in the background
// no matter which vault is open: the timer walks all connected vaults, publishes the
// active one on change and refreshes the rest once per run. Connections are surfaced
// together so Settings shows them from any vault instead of pretending the current
// vault is "unconfigured".

const CHECK_INTERVAL_MS = 30_000;
const QUIET_PERIOD_MS = 60_000;
const MIN_UPLOAD_INTERVAL_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;
const FIRST_TICK_MS = 5_000;

interface VaultRuntime {
  /** Last lightweight revision observed for the active vault (change detection). */
  observed: string | null;
  /** Timestamp the active vault first looked dirty; 0 when clean. */
  dirtySince: number;
  lastUploadStartedAt: number;
  /** The vault wants a publish attempt on the next tick. */
  pending: boolean;
  /** Content hash last actually uploaded this session; skips redundant network. */
  lastRevision: string | null;
  phase: NodusServerSyncPhase;
  lastSyncAt: string | null;
  lastError: string | null;
  lastBytes: number | null;
}

const runtimes = new Map<string, VaultRuntime>();
const readonlyPool = new Map<string, Database.Database>();
let timer: ReturnType<typeof setInterval> | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;
let publishing = false;

function ensureRuntime(vaultId: string): VaultRuntime {
  let rt = runtimes.get(vaultId);
  if (!rt) {
    rt = {
      observed: null, dirtySince: 0, lastUploadStartedAt: 0, pending: false,
      lastRevision: null, phase: 'idle', lastSyncAt: null, lastError: null, lastBytes: null,
    };
    runtimes.set(vaultId, rt);
  }
  return rt;
}

function normalizeUrl(value: string): string {
  const clean = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try { parsed = new URL(clean); } catch { throw new Error('Introduce una URL válida del servidor.'); }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('Nodus Server necesita HTTPS fuera de localhost.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Usa solo la dirección base del servidor, sin credenciales, parámetros ni fragmentos.');
  return parsed.toString().replace(/\/+$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

// ── Per-vault configuration reads ───────────────────────────────────────────
// The server URL/space/flags live in each vault's own settings blob (per-vault, not
// global). The active vault is read through the live connection; siblings are read
// through a cached read-only handle, exactly like cross-vault relation lookups.

interface VaultServerConfig {
  vaultId: string;
  vaultName: string;
  vaultType: VaultSummary['type'];
  isActiveVault: boolean;
  url: string;
  spaceId: string;
  spaceName: string;
  language: AppLanguage;
  enabled: boolean;
  autoSync: boolean;
  includeUserContent: boolean;
  includePassages: boolean;
  hasToken: boolean;
  configured: boolean;
}

function openReadOnly(dbPath: string): Database.Database | null {
  const cached = readonlyPool.get(dbPath);
  if (cached) {
    try { cached.prepare('SELECT 1').get(); return cached; }
    catch { readonlyPool.delete(dbPath); }
  }
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    readonlyPool.set(dbPath, db);
    return db;
  } catch { return null; }
}

function closeReadOnlyPool(): void {
  for (const db of readonlyPool.values()) { try { db.close(); } catch { /* ignore */ } }
  readonlyPool.clear();
}

function readSiblingServerBlob(vaultPath: string): Partial<AppSettings> {
  const db = openReadOnly(vaultPath);
  if (!db) return {};
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    if (!row?.value) return {};
    return JSON.parse(row.value) as Partial<AppSettings>;
  } catch { return {}; }
}

function toConfig(vault: VaultSummary, blob: Partial<AppSettings>): VaultServerConfig {
  const url = String(blob.nodusServerUrl || '');
  const spaceId = String(blob.nodusServerSpaceId || '');
  const hasToken = hasNodusServerTokenFor(vault.id);
  return {
    vaultId: vault.id,
    vaultName: vault.name,
    vaultType: vault.type,
    isActiveVault: vault.active,
    url,
    spaceId,
    spaceName: String(blob.nodusServerSpaceName || ''),
    language: normalizeUiLanguage((blob.nodusServerLanguage as AppLanguage) ?? 'en'),
    enabled: Boolean(blob.nodusServerEnabled),
    autoSync: blob.nodusServerAutoSync !== false,
    includeUserContent: Boolean(blob.nodusServerIncludeUserContent),
    includePassages: Boolean(blob.nodusServerIncludePassages),
    hasToken,
    configured: Boolean(url && spaceId && hasToken),
  };
}

function readVaultConfig(vault: VaultSummary): VaultServerConfig {
  if (vault.active) {
    const s = getSettings();
    return toConfig(vault, {
      nodusServerUrl: s.nodusServerUrl,
      nodusServerSpaceId: s.nodusServerSpaceId,
      nodusServerSpaceName: s.nodusServerSpaceName,
      nodusServerLanguage: s.nodusServerLanguage,
      nodusServerEnabled: s.nodusServerEnabled,
      nodusServerAutoSync: s.nodusServerAutoSync,
      nodusServerIncludeUserContent: s.nodusServerIncludeUserContent,
      nodusServerIncludePassages: s.nodusServerIncludePassages,
    });
  }
  // A sibling connection always has a device token, so skip opening its database (and
  // caching a read-only handle to it) when there is none — most vaults are not shared.
  if (!hasNodusServerTokenFor(vault.id)) return toConfig(vault, {});
  return toConfig(vault, readSiblingServerBlob(vault.path));
}

function listVaultConfigs(): VaultServerConfig[] {
  let vaults: VaultSummary[] = [];
  try { vaults = listVaults(); } catch { vaults = []; }
  return vaults.map((vault) => readVaultConfig(vault));
}

// ── Overview surfaced to the renderer ───────────────────────────────────────

function connectionFrom(config: VaultServerConfig): NodusServerConnection {
  const rt = runtimes.get(config.vaultId);
  const phase: NodusServerSyncPhase = rt?.phase ?? (config.enabled ? 'idle' : 'disconnected');
  return {
    vaultId: config.vaultId,
    vaultName: config.vaultName,
    vaultType: config.vaultType,
    isActiveVault: config.isActiveVault,
    url: config.url,
    spaceId: config.spaceId,
    spaceName: config.spaceName,
    language: config.language,
    enabled: config.enabled,
    autoSync: config.autoSync,
    includeUserContent: config.includeUserContent,
    includePassages: config.includePassages,
    phase,
    lastSyncAt: rt?.lastSyncAt ?? null,
    lastError: rt?.lastError ?? null,
    lastBytes: rt?.lastBytes ?? null,
  };
}

export function getNodusServerOverview(): NodusServerOverview {
  const configs = listVaultConfigs();
  const connections = configs
    .filter((config) => config.configured)
    .map((config) => connectionFrom(config));
  let active: VaultSummary | null = null;
  try { active = getActiveVault(); } catch { active = null; }
  const activeConfig = configs.find((config) => config.isActiveVault);
  return {
    connections,
    activeVault: {
      id: active?.id ?? '',
      name: active?.name ?? '',
      type: active?.type ?? 'academic',
      connected: Boolean(activeConfig?.configured),
    },
    transport: 'outbound-https',
  };
}

// ── Publishing ──────────────────────────────────────────────────────────────

/** Upload one vault's filtered snapshot. Serialized: at most one publish at a time. */
async function publishVault(vaultId: string): Promise<void> {
  if (publishing) return;
  const vault = getVault(vaultId);
  if (!vault) { runtimes.delete(vaultId); return; }
  const config = readVaultConfig(vault);
  const token = getNodusServerTokenFor(vaultId);
  if (!config.configured || !config.enabled || !token) return;

  const db = vault.active ? getDb() : openReadOnly(vault.path);
  if (!db) return;

  publishing = true;
  const rt = ensureRuntime(vaultId);
  rt.lastUploadStartedAt = Date.now();
  rt.phase = 'syncing';
  try {
    const snapshot = buildServerSnapshot(
      { ...vault },
      { nodusServerIncludeUserContent: config.includeUserContent, nodusServerIncludePassages: config.includePassages },
      db,
    );
    // Nothing changed since our last upload this session: keep the server as-is and
    // avoid the round-trip. The very first publish after launch always runs (no cache).
    if (rt.lastRevision && rt.lastRevision === snapshot.revision) {
      rt.phase = 'ok';
      rt.pending = false;
      rt.dirtySince = 0;
      if (vault.active) rt.observed = lightweightVaultRevision(db);
      return;
    }
    // Level 1 deliberately trades a little bandwidth for very low desktop CPU usage.
    const compressed = gzipSync(snapshot.buffer, { level: 1 });
    const response = await fetchWithTimeout(
      `${normalizeUrl(config.url)}/api/v1/spaces/${encodeURIComponent(config.spaceId)}/snapshot`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/vnd.nodus.snapshot+json',
          'content-encoding': 'gzip',
          'x-nodus-revision': snapshot.revision,
        },
        body: compressed,
      },
    );
    const result = await response.json().catch(() => ({})) as { updatedAt?: string; error?: string };
    if (response.status === 401 || response.status === 403) {
      // The server revoked this device. Drop only the token so the vault stops trying
      // and shows as needing a fresh pairing; leave its settings for a quick reconnect.
      clearNodusServerTokenFor(vaultId);
      rt.phase = 'error';
      rt.lastError = 'El servidor ha revocado este dispositivo. Genera un código nuevo y vuelve a emparejar el vault.';
      rt.pending = false;
      return;
    }
    if (!response.ok) throw new Error(result.error || `El servidor respondió con HTTP ${response.status}.`);
    rt.lastRevision = snapshot.revision;
    rt.dirtySince = 0;
    rt.pending = false;
    rt.phase = 'ok';
    rt.lastSyncAt = result.updatedAt || new Date().toISOString();
    rt.lastBytes = compressed.length;
    if (vault.active) rt.observed = lightweightVaultRevision(db);
  } catch (error) {
    rt.phase = 'error';
    rt.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    publishing = false;
  }
}

async function tick(): Promise<void> {
  if (publishing) return;
  const configs = listVaultConfigs().filter((config) => config.configured && config.enabled);
  if (configs.length === 0) return;

  // 1) The active vault is the only one whose contents change while the app runs.
  //    Detect a change cheaply and, after the quiet + min-interval windows, flag it.
  const active = configs.find((config) => config.isActiveVault);
  if (active && active.autoSync) {
    const rt = ensureRuntime(active.vaultId);
    try {
      const revision = lightweightVaultRevision(getDb());
      if (rt.observed === null) rt.observed = revision;
      else if (revision !== rt.observed) { rt.observed = revision; rt.dirtySince ||= Date.now(); }
      if (
        rt.dirtySince &&
        Date.now() - rt.dirtySince >= QUIET_PERIOD_MS &&
        Date.now() - rt.lastUploadStartedAt >= MIN_UPLOAD_INTERVAL_MS
      ) {
        rt.pending = true;
      }
    } catch { /* the active DB may be mid-switch */ }
  }

  // 2) Publish one pending vault per tick (active-first so edits win over refreshes).
  const target = [active, ...configs.filter((config) => !config.isActiveVault)]
    .find((config) => config && config.autoSync && ensureRuntime(config.vaultId).pending);
  if (target) await publishVault(target.vaultId);
}

export function startNodusServerSync(): void {
  stopNodusServerSync();
  const configs = listVaultConfigs().filter((config) => config.configured);
  // Queue a refresh publish for every enabled connection: this reflects any change made
  // while the app was closed or while another vault was open, and flips their status to
  // "ok" on startup instead of leaving them stuck at idle. Content-hash caching in
  // publishVault keeps unchanged vaults from re-uploading beyond the first launch pass.
  for (const config of configs) {
    const rt = ensureRuntime(config.vaultId);
    if (config.enabled && config.autoSync) rt.pending = true;
    if (config.isActiveVault) rt.observed = null;
  }
  // Prune runtime for vaults that are no longer connected.
  const live = new Set(configs.map((config) => config.vaultId));
  for (const id of [...runtimes.keys()]) if (!live.has(id)) runtimes.delete(id);

  if (configs.length === 0) return;
  firstTimer = setTimeout(() => void tick(), FIRST_TICK_MS);
  firstTimer.unref?.();
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function stopNodusServerSync(): void {
  if (timer) clearInterval(timer);
  if (firstTimer) clearTimeout(firstTimer);
  timer = null; firstTimer = null;
  closeReadOnlyPool();
}

export function restartNodusServerSync(): void {
  startNodusServerSync();
}

// ── User actions ────────────────────────────────────────────────────────────

export async function pairNodusServer(urlValue: string, code: string): Promise<NodusServerPairResult> {
  const url = normalizeUrl(urlValue);
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode) throw new Error('Introduce el código temporal generado por Nodus Server.');
  if (cleanCode.length > 64) throw new Error('El código temporal no es válido.');
  const active = getActiveVault();
  const rt = ensureRuntime(active.id);
  rt.phase = 'checking';
  rt.lastError = null;
  try {
    const response = await fetchWithTimeout(`${url}/api/v1/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: cleanCode, deviceName: `Nodus Desktop · ${os.hostname()}` }),
    });
    const result = await response.json().catch(() => ({})) as { accessToken?: string; error?: string; space?: { id: string; name: string }; server?: { name: string; publicUrl: string; language?: AppLanguage } };
    if (!response.ok || !result.accessToken || !result.space) throw new Error(result.error || `El servidor respondió con HTTP ${response.status}.`);
    const pairedUrl = normalizeUrl(result.server?.publicUrl || url);
    // Pairing always targets the currently open vault, so the active-vault token wrapper
    // and updateSettings both write to the right place.
    setNodusServerToken(result.accessToken);
    const language = normalizeUiLanguage(result.server?.language ?? 'en');
    updateSettings({ nodusServerUrl: pairedUrl, nodusServerSpaceId: result.space.id, nodusServerSpaceName: result.space.name, nodusServerLanguage: language, nodusServerEnabled: true });
    runtimes.delete(active.id);
    startNodusServerSync();
    // The one explicit full publication happens immediately; later work is debounced.
    await publishVault(active.id);
    return { ok: true, serverName: result.server?.name || 'Nodus Server', spaceId: result.space.id, spaceName: result.space.name, language };
  } catch (error) {
    rt.phase = 'error';
    rt.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/** Publish one vault right now (ignores the debounce and autoSync, honors the pause switch). */
export async function syncNodusServerVaultNow(vaultId: string): Promise<NodusServerOverview> {
  await publishVault(vaultId);
  return getNodusServerOverview();
}

export async function setNodusServerLanguage(languageValue: AppLanguage, vaultId?: string): Promise<NodusServerOverview> {
  const targetId = vaultId || getActiveVault().id;
  const vault = getVault(targetId);
  if (!vault) throw new Error('Bóveda no encontrada.');
  const config = readVaultConfig(vault);
  const token = getNodusServerTokenFor(targetId);
  if (!config.url || !config.spaceId || !token) {
    throw new Error('Conecta este vault a Nodus Server antes de cambiar su idioma.');
  }
  const language = normalizeUiLanguage(languageValue);
  const response = await fetchWithTimeout(`${normalizeUrl(config.url)}/api/v1/settings/language`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  const result = await response.json().catch(() => ({})) as { language?: AppLanguage; error?: string };
  if (!response.ok || !result.language) throw new Error(result.error || `El servidor respondió con HTTP ${response.status}.`);
  const accepted = normalizeUiLanguage(result.language);
  if (vault.active) updateSettings({ nodusServerLanguage: accepted });
  else await withVaultDatabase(targetId, () => { updateSettings({ nodusServerLanguage: accepted }); });
  const rt = runtimes.get(targetId);
  if (rt) rt.lastError = null;
  return getNodusServerOverview();
}

export async function disconnectNodusServerVault(vaultId: string): Promise<NodusServerOverview> {
  const vault = getVault(vaultId);
  const clearBlob = () => updateSettings({ nodusServerEnabled: false, nodusServerUrl: '', nodusServerSpaceId: '', nodusServerSpaceName: '' });
  if (vault?.active) clearBlob();
  else if (vault) await withVaultDatabase(vaultId, clearBlob);
  clearNodusServerTokenFor(vaultId);
  runtimes.delete(vaultId);
  startNodusServerSync();
  return getNodusServerOverview();
}
