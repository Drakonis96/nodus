import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { capabilityRegistry, type CapabilityProvider } from './registry';

/** Results a conversation already holds, written before any of this existed.
 *
 *  A 5.3.1 reply saved a discipline's answer as its own fenced block, sometimes pointing
 *  at a file beside the chat. Those replies are not rewritten — an answer the user
 *  received is not the migration's to edit — so they are read where they lie and handed
 *  back to whichever package now claims that fence.
 *
 *  Nothing here knows what a chemistry document or a prediction is. The core knows the
 *  fence a package claimed, the artifact type that fence maps to, and which on-disk
 *  formats that type says it can decode. The parsing is the package's. */

const ASSET = /\bnodus-([a-z][a-z0-9-]{1,30}):\/\/chat\/([a-f0-9]{64})\/([a-f0-9-]{36})\b/;
/** The same ceiling the artifact store applies when it reads a result back. */
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_PAYLOAD_CHARS = 256 * 1024;

export interface LegacyResultRequest {
  provider: CapabilityProvider;
  fence: string;
  artifactType: string;
  artifactVersion: number;
  payload: string;
  asset?: string;
}

/** Finds the package that claimed a fence as a legacy result, and what it maps to. */
export function legacyResultClaim(fence: string): { provider: CapabilityProvider; artifactType: string; artifactVersion: number } | null {
  const claim = capabilityRegistry().fences.get(fence);
  if (!claim || claim.kind !== 'legacy' || claim.provider.source !== 'plugin') return null;
  const legacy = claim.provider.chat?.legacyResults.find(entry => entry.fence === fence);
  if (!legacy) return null;
  return { provider: claim.provider, artifactType: legacy.artifactType, artifactVersion: legacy.artifactVersion };
}

/** The file an old block pointed at, when the package's artifact type says it can read
 *  that format. A scheme no declared type claims is not opened at all: the decoder list
 *  is what stops one package from reading another discipline's leftovers. */
export function legacyAsset(provider: CapabilityProvider, artifactType: string, payload: string): string | undefined {
  const match = ASSET.exec(payload);
  if (!match) return undefined;
  const [, format, owner, id] = match;
  const declared = provider.artifacts.find(entry => entry.type === artifactType);
  if (!declared?.decodes?.includes(format)) return undefined;

  const file = path.join(app.getPath('userData'), 'chat-assets', owner, `${id}.${format}`);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ASSET_BYTES) return undefined;
    return fs.readFileSync(file, 'utf8');
  } catch { return undefined; }
}

/** Everything a worker needs to render one historical block, or null when no installed
 *  package claims it. The caller decides what to say when that is the answer. */
export function legacyResultRequest(fence: string, payload: string): LegacyResultRequest | null {
  const claim = legacyResultClaim(fence);
  if (!claim) return null;
  if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD_CHARS) throw new Error('That saved result is too large to read.');
  const asset = legacyAsset(claim.provider, claim.artifactType, payload);
  return { ...claim, fence, payload, ...(asset !== undefined ? { asset } : {}) };
}
