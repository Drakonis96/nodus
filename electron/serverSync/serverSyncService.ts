import os from 'node:os';
import { gzipSync } from 'node:zlib';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { clearNodusServerToken, getNodusServerToken, hasNodusServerToken, setNodusServerToken } from '../secrets/secretStore';
import type { AppLanguage, NodusServerPairResult, NodusServerSyncStatus } from '@shared/types';
import { normalizeUiLanguage } from '@shared/uiLanguage';
import { buildServerSnapshot, lightweightVaultRevision } from './serverSnapshot';

const CHECK_INTERVAL_MS = 30_000;
const QUIET_PERIOD_MS = 60_000;
const MIN_UPLOAD_INTERVAL_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let observedRevision: string | null = null;
let dirtySince = 0;
let lastUploadStartedAt = 0;
let status: NodusServerSyncStatus = emptyStatus();

function emptyStatus(): NodusServerSyncStatus {
  return {
    configured: false, enabled: false, autoSync: false, phase: 'disconnected',
    url: null, spaceId: null, spaceName: null, lastSyncAt: null, lastError: null,
    language: 'en',
    lastBytes: null, transport: 'outbound-https',
  };
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

function refreshConfiguredStatus(): void {
  const settings = getSettings();
  const configured = Boolean(settings.nodusServerUrl && settings.nodusServerSpaceId && hasNodusServerToken());
  status = {
    ...status,
    configured,
    enabled: configured && settings.nodusServerEnabled,
    autoSync: configured && settings.nodusServerAutoSync,
    phase: configured ? (status.phase === 'disconnected' ? 'idle' : status.phase) : 'disconnected',
    url: settings.nodusServerUrl || null,
    spaceId: settings.nodusServerSpaceId || null,
    spaceName: settings.nodusServerSpaceName || null,
    language: settings.nodusServerLanguage,
    ...(configured ? {} : { lastSyncAt: null, lastError: null, lastBytes: null }),
  };
}

export function getNodusServerStatus(): NodusServerSyncStatus {
  refreshConfiguredStatus();
  return { ...status };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

export async function pairNodusServer(urlValue: string, code: string): Promise<NodusServerPairResult> {
  const url = normalizeUrl(urlValue);
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode) throw new Error('Introduce el código temporal generado por Nodus Server.');
  if (cleanCode.length > 64) throw new Error('El código temporal no es válido.');
  status = { ...status, phase: 'checking', lastError: null, url };
  try {
    const response = await fetchWithTimeout(`${url}/api/v1/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: cleanCode, deviceName: `Nodus Desktop · ${os.hostname()}` }),
    });
    const result = await response.json().catch(() => ({})) as { accessToken?: string; error?: string; space?: { id: string; name: string }; server?: { name: string; publicUrl: string; language?: AppLanguage } };
    if (!response.ok || !result.accessToken || !result.space) throw new Error(result.error || `El servidor respondió con HTTP ${response.status}.`);
    const pairedUrl = normalizeUrl(result.server?.publicUrl || url);
    setNodusServerToken(result.accessToken);
    const language = normalizeUiLanguage(result.server?.language ?? 'en');
    updateSettings({ nodusServerUrl: pairedUrl, nodusServerSpaceId: result.space.id, nodusServerSpaceName: result.space.name, nodusServerLanguage: language, nodusServerEnabled: true });
    observedRevision = null; dirtySince = Date.now();
    status = { ...emptyStatus(), configured: true, enabled: true, autoSync: getSettings().nodusServerAutoSync, phase: 'idle', url: pairedUrl, spaceId: result.space.id, spaceName: result.space.name, language };
    startNodusServerSync();
    // The one explicit full publication happens immediately. Subsequent automatic
    // work is debounced and revision-gated by the lightweight timer below.
    await syncNodusServerNow();
    return { ok: true, serverName: result.server?.name || 'Nodus Server', spaceId: result.space.id, spaceName: result.space.name, language };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status = { ...status, phase: 'error', lastError: message };
    throw error;
  }
}

export async function setNodusServerLanguage(languageValue: AppLanguage): Promise<NodusServerSyncStatus> {
  const settings = getSettings();
  const accessToken = getNodusServerToken();
  if (!settings.nodusServerUrl || !settings.nodusServerSpaceId || !accessToken) {
    throw new Error('Conecta este vault a Nodus Server antes de cambiar su idioma.');
  }
  const language = normalizeUiLanguage(languageValue);
  const response = await fetchWithTimeout(`${normalizeUrl(settings.nodusServerUrl)}/api/v1/settings/language`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  const result = await response.json().catch(() => ({})) as { language?: AppLanguage; error?: string };
  if (!response.ok || !result.language) throw new Error(result.error || `El servidor respondió con HTTP ${response.status}.`);
  const accepted = normalizeUiLanguage(result.language);
  updateSettings({ nodusServerLanguage: accepted });
  status = { ...status, language: accepted, lastError: null };
  refreshConfiguredStatus();
  return { ...status };
}

export async function syncNodusServerNow(): Promise<NodusServerSyncStatus> {
  if (running) return getNodusServerStatus();
  const settings = getSettings();
  const accessToken = getNodusServerToken();
  if (!settings.nodusServerEnabled || !settings.nodusServerUrl || !settings.nodusServerSpaceId || !accessToken) {
    refreshConfiguredStatus();
    return status;
  }
  running = true;
  lastUploadStartedAt = Date.now();
  status = { ...status, configured: true, enabled: true, phase: 'syncing', lastError: null };
  try {
    const snapshot = buildServerSnapshot(getActiveVault(), settings);
    // Level 1 deliberately trades a little bandwidth for very low desktop CPU usage.
    const compressed = gzipSync(snapshot.buffer, { level: 1 });
    const response = await fetchWithTimeout(`${normalizeUrl(settings.nodusServerUrl)}/api/v1/spaces/${encodeURIComponent(settings.nodusServerSpaceId)}/snapshot`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/vnd.nodus.snapshot+json',
        'content-encoding': 'gzip',
        'x-nodus-revision': snapshot.revision,
      },
      body: compressed,
    });
    const result = await response.json().catch(() => ({})) as { updatedAt?: string; error?: string };
    if (response.status === 401 || response.status === 403) {
      const revokedMessage = 'El servidor ha revocado este dispositivo. Genera un código nuevo y vuelve a emparejar el vault.';
      clearNodusServerToken();
      updateSettings({ nodusServerEnabled: false, nodusServerSpaceId: '', nodusServerSpaceName: '' });
      status = {
        ...emptyStatus(),
        url: settings.nodusServerUrl || null,
        phase: 'error',
        lastError: revokedMessage,
      };
      throw new Error(revokedMessage);
    }
    if (!response.ok) throw new Error(result.error || `El servidor respondió con HTTP ${response.status}.`);
    observedRevision = lightweightVaultRevision(); dirtySince = 0;
    status = { ...status, phase: 'ok', lastSyncAt: result.updatedAt || new Date().toISOString(), lastError: null, lastBytes: compressed.length };
  } catch (error) {
    status = { ...status, phase: 'error', lastError: error instanceof Error ? error.message : String(error) };
  } finally {
    running = false;
  }
  return { ...status };
}

async function tick(): Promise<void> {
  const settings = getSettings();
  if (!settings.nodusServerEnabled || !settings.nodusServerAutoSync || !hasNodusServerToken() || running) return;
  const revision = lightweightVaultRevision();
  if (observedRevision === null) {
    observedRevision = revision;
    dirtySince = Date.now();
  } else if (revision !== observedRevision) {
    observedRevision = revision;
    dirtySince ||= Date.now();
  }
  if (!dirtySince || Date.now() - dirtySince < QUIET_PERIOD_MS || Date.now() - lastUploadStartedAt < MIN_UPLOAD_INTERVAL_MS) return;
  await syncNodusServerNow();
}

export function startNodusServerSync(): void {
  stopNodusServerSync();
  refreshConfiguredStatus();
  if (!status.configured || !status.enabled) return;
  observedRevision = null;
  firstTimer = setTimeout(() => void tick(), 10_000);
  firstTimer.unref?.();
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function stopNodusServerSync(): void {
  if (timer) clearInterval(timer);
  if (firstTimer) clearTimeout(firstTimer);
  timer = null; firstTimer = null; observedRevision = null; dirtySince = 0;
}

export function restartNodusServerSync(): void {
  startNodusServerSync();
}

export function disconnectNodusServer(): NodusServerSyncStatus {
  stopNodusServerSync();
  clearNodusServerToken();
  updateSettings({ nodusServerEnabled: false, nodusServerUrl: '', nodusServerSpaceId: '', nodusServerSpaceName: '' });
  status = emptyStatus();
  return { ...status };
}
