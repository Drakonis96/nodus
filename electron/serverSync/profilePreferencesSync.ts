import { createHash } from 'node:crypto';
import type { AppSettings, VaultSummary } from '@shared/types';
import {
  desktopSettingsPatchFromServerProfile,
  extractServerProfilePreferences,
  isLocalServerModel,
  type ServerProfilePreferences,
} from '../../shared/serverProfilePreferences.mjs';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getNodusServerTokenFor } from '../secrets/secretStore';
import { normalizeServerUrl } from './serverNetwork';

const PROFILE_ENDPOINT = '/api/v2/me/preferences';
const RETRY_AFTER_MS = 5 * 60_000;
const accepted = new Map<string, { digest: string; at: number; revision: number }>();
const unsupported = new Set<string>();
let appliedHandler: ((settings: AppSettings) => void) | null = null;

/** Main-process UI bridge installed by IPC registration. Keeping the callback
 * here avoids importing BrowserWindow into the sync/data layer. */
export function setServerProfilePreferencesAppliedHandler(handler: ((settings: AppSettings) => void) | null): void {
  appliedHandler = handler;
}

function connectionKey(vault: VaultSummary): string {
  return `${normalizeServerUrl(vault.remote?.url ?? '')}\u0000${String(vault.remote?.userEmail ?? '').toLowerCase()}`;
}

function payloadDigest(value: ServerProfilePreferences): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Upload a portable profile through the token already bound to this authenticated user.
 * API keys never enter `settings`, and the extractor is an allowlist: local URLs, tokens,
 * paths, backup options and embedding configuration have no representation in the payload.
 */
export async function syncServerProfilePreferencesForVault(
  vault: VaultSummary,
  settings: AppSettings = getSettings(),
  options: { pull?: boolean } = {},
): Promise<'updated' | 'pulled' | 'unchanged' | 'unsupported' | 'skipped'> {
  if (vault.origin !== 'connected' || !vault.remote || vault.remote.state !== 'active') return 'skipped';
  const token = getNodusServerTokenFor(vault.id);
  if (!token) return 'skipped';
  const key = connectionKey(vault);
  if (unsupported.has(key)) return 'unsupported';

  const previous = accepted.get(key);

  if (options.pull) {
    const response = await fetch(`${normalizeServerUrl(vault.remote.url)}${PROFILE_ENDPOINT}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404 || response.status === 405) {
      unsupported.add(key);
      return 'unsupported';
    }
    if (!response.ok) throw new Error(`Server profile preferences returned HTTP ${response.status}.`);
    const body = await response.json() as {
      profile?: { revision?: number; source?: { kind?: string } | null; values?: ServerProfilePreferences | null };
    };
    const remote = body.profile;
    const revision = Math.max(0, Number(remote?.revision) || 0);
    // A Server-Web/API edit is authoritative on a freshly started Desktop. Once this
    // process has observed a revision, any later account revision is likewise pulled.
    // A legacy Desktop-authored value seen for the first time keeps the old inheritance
    // behaviour, avoiding an old server snapshot overwriting newer offline local prefs.
    const shouldPull = Boolean(remote?.values)
      && revision > 0
      && revision !== previous?.revision
      && (Boolean(previous) || remote?.source?.kind === 'server-web' || remote?.source?.kind === 'api');
    if (shouldPull && remote?.values) {
      const patch = desktopSettingsPatchFromServerProfile(remote.values);
      // Portable favourites are inherited account-wide, while local/downloaded
      // favourites remain on this device and must survive a Server pull.
      const localFavorites = (getSettings().favorites || []).filter((entry) => isLocalServerModel(entry.provider, entry.model));
      const remoteFavorites = Array.isArray(patch.favorites) ? patch.favorites : [];
      patch.favorites = [...new Map([...remoteFavorites, ...localFavorites].map((entry) => [`${entry.provider}\u0000${entry.model}`, entry])).values()];
      const next = updateSettings(patch);
      const preferences = extractServerProfilePreferences(next);
      accepted.set(key, { digest: payloadDigest(preferences), at: Date.now(), revision });
      appliedHandler?.(next);
      return 'pulled';
    }
  }

  const preferences = extractServerProfilePreferences(settings);
  const digest = payloadDigest(preferences);
  if (previous?.digest === digest && Date.now() - previous.at < RETRY_AFTER_MS) return 'unchanged';

  const response = await fetch(`${normalizeServerUrl(vault.remote.url)}${PROFILE_ENDPOINT}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(preferences),
    signal: AbortSignal.timeout(10_000),
  });
  // Classic/basic and older servers do not expose the advanced profile API. Connecting
  // the vault remains fully backwards-compatible and we do not retry every sync tick.
  if (response.status === 404 || response.status === 405) {
    unsupported.add(key);
    return 'unsupported';
  }
  if (!response.ok) throw new Error(`Server profile preferences returned HTTP ${response.status}.`);
  const result = await response.json() as { unchanged?: boolean; profile?: { revision?: number } };
  accepted.set(key, { digest, at: Date.now(), revision: Math.max(0, Number(result.profile?.revision) || previous?.revision || 0) });
  return result.unchanged ? 'unchanged' : 'updated';
}

/** Sync only the active connected vault, whose per-vault model selectors are loaded. */
export async function syncActiveServerProfilePreferences(settings: AppSettings = getSettings()): Promise<void> {
  const active = getActiveVault();
  if (active.origin !== 'connected' || !active.remote) return;
  await syncServerProfilePreferencesForVault(active, settings);
}

/** Used by tests and account removal so a newly available/upgraded server is retried. */
export function resetServerProfilePreferenceSync(vault?: VaultSummary): void {
  if (!vault) { accepted.clear(); unsupported.clear(); return; }
  const key = connectionKey(vault);
  accepted.delete(key);
  unsupported.delete(key);
}
