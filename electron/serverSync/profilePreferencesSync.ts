import { createHash } from 'node:crypto';
import type { AppSettings, VaultSummary } from '@shared/types';
import {
  extractServerProfilePreferences,
  type ServerProfilePreferences,
} from '../../shared/serverProfilePreferences.mjs';
import { getSettings } from '../db/settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getNodusServerTokenFor } from '../secrets/secretStore';
import { normalizeServerUrl } from './serverNetwork';

const PROFILE_ENDPOINT = '/api/v2/me/preferences';
const RETRY_AFTER_MS = 5 * 60_000;
const accepted = new Map<string, { digest: string; at: number }>();
const unsupported = new Set<string>();

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
): Promise<'updated' | 'unchanged' | 'unsupported' | 'skipped'> {
  if (vault.origin !== 'connected' || !vault.remote || vault.remote.state !== 'active') return 'skipped';
  const token = getNodusServerTokenFor(vault.id);
  if (!token) return 'skipped';
  const key = connectionKey(vault);
  if (unsupported.has(key)) return 'unsupported';

  const preferences = extractServerProfilePreferences(settings);
  const digest = payloadDigest(preferences);
  const previous = accepted.get(key);
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
  const result = await response.json() as { unchanged?: boolean };
  accepted.set(key, { digest, at: Date.now() });
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
