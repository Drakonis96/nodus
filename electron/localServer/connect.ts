// Connecting the open vault to the server running on this computer.
//
// In advanced mode a person signs in to the server's web administration, creates a space, asks
// for a pairing code and types it into the desktop. That dance exists because the server belongs
// to somebody else. Here it belongs to this application, on this machine, so all of it is done
// for them: Nodus asks its own server for a space and a code over loopback, and pairs.
//
// It is the same pairing endpoint an advanced-mode connection uses. Nothing about the trust model
// is loosened — the code is still single-use and still expires — it is simply typed by the
// program that generated it instead of by a person copying it between two windows.
import type { NodusServerPairResult } from '@shared/types';
import type { VaultType } from '@shared/vaultTypes';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getSettings } from '../db/settingsRepo';
import { pairNodusServer } from '../serverSync/serverSyncService';
import { isLocalServerRunning, readProvisionSecret, startLocalServer } from './process';

interface ProvisionResult {
  spaceId: string;
  spaceName: string;
  code: string;
}

/**
 * Ask the local server for this vault's space and a fresh pairing code.
 *
 * Authenticated by a secret only readable by this operating-system user, over loopback only —
 * the server refuses this route from anywhere else even with the right secret.
 */
async function provision(loopbackUrl: string, vaultId: string, vaultName: string, vaultType: VaultType): Promise<ProvisionResult> {
  const secret = readProvisionSecret();
  if (!secret) throw new Error('El servidor local todavía no ha escrito su secreto de aprovisionamiento.');
  const settings = getSettings() as unknown as Record<string, unknown>;
  const response = await fetch(`${loopbackUrl}/api/v1/local/provision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    // The local server is provisioned by the same process that owns these settings. Carry
    // the explicit publication choices with the one-shot, loopback-only request so the
    // very first snapshot is evaluated against the policy the user selected. Previously a
    // fresh local space started with the restrictive server default and silently removed
    // Deep Research, Library and passages before the first publication.
    body: JSON.stringify({
      vaultId,
      vaultName,
      vaultType,
      publicationPolicy: {
        allowUserContent: settings.nodusServerIncludeUserContent === true,
        allowLibraryDocuments: settings.nodusServerIncludeLibraryDocuments === true,
        allowPassages: settings.nodusServerIncludePassages === true,
        allowVectors: settings.nodusServerIncludeVectors !== false,
        allowPrimarySources: settings.nodusServerIncludePrimarySources === true,
        allowTestimonies: settings.nodusServerIncludeTestimonies === true,
        allowPersonalImports: settings.nodusServerIncludePersonalImports !== false,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({})) as Partial<ProvisionResult> & { error_description?: string; error?: string };
  if (!response.ok || !result.spaceId || !result.code) {
    throw new Error(result.error_description || result.error || `El servidor local respondió con HTTP ${response.status}.`);
  }
  return { spaceId: result.spaceId, spaceName: result.spaceName || vaultName, code: result.code };
}

/** Connect the vault that is open right now to the local server, starting it if needed. */
export async function connectActiveVaultToLocalServer(): Promise<NodusServerPairResult> {
  if (!isLocalServerRunning()) {
    const status = await startLocalServer();
    if (status.phase !== 'running') {
      throw new Error(status.error || 'No se ha podido arrancar el servidor local.');
    }
  }
  const loopbackUrl = `http://127.0.0.1:${getSettings().localServerPort}`;
  const vault = getActiveVault();
  const { code } = await provision(loopbackUrl, vault.id, vault.name, vault.type);
  return pairNodusServer(loopbackUrl, code);
}
