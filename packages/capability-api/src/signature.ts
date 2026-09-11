import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { TRUSTED_PUBLISHER } from './limits';
import { SEMVER, SLUG, compareSemver, exactKeys } from './json';
import type { PluginManifestV2, PluginTarget } from './manifest';

/** The signature covers a manifest of hashes, not the archives themselves: one small
 *  signed document pins every target, so a download can be verified before it is opened. */

export interface ReleaseTarget {
  target: PluginTarget;
  asset: string;
  bytes: number;
  sha256: string;
}

export interface PluginReleaseManifest {
  schemaVersion: 1;
  plugin: string;
  version: string;
  publisher: { id: typeof TRUSTED_PUBLISHER; keyId: string };
  createdAt: string;
  targets: ReleaseTarget[];
}

export interface TrustedPublicKey {
  keyId: string;
  /** SPKI PEM. Ed25519 only. */
  publicKeyPem: string;
  /** Set once a key is rotated out: it still verifies old releases, never new ones. */
  retiredAt?: string;
}

const ASSET = /^[a-z0-9][a-z0-9._-]{0,120}\.nodus-plugin$/;
const KEY_ID = /^[a-z0-9]{4,32}$/;
const TARGET = /^(?:any|(?:darwin|win32|linux)-(?:x64|arm64))$/;

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export function parseReleaseManifest(input: unknown): PluginReleaseManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !exactKeys(input, ['schemaVersion', 'plugin', 'version', 'publisher', 'createdAt', 'targets'])) throw new Error('Invalid release manifest.');
  const value = input as PluginReleaseManifest;
  if (value.schemaVersion !== 1 || !SLUG.test(value.plugin) || !SEMVER.test(value.version)
    || !value.publisher || !exactKeys(value.publisher, ['id', 'keyId'])
    || value.publisher.id !== TRUSTED_PUBLISHER || !KEY_ID.test(String(value.publisher.keyId))
    || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))
    || !Array.isArray(value.targets) || !value.targets.length || value.targets.length > 8) throw new Error('Invalid release manifest.');
  const seen = new Set<string>();
  for (const target of value.targets) {
    if (!target || !exactKeys(target, ['target', 'asset', 'bytes', 'sha256'])
      || !TARGET.test(String(target.target)) || seen.has(target.target)
      || !ASSET.test(String(target.asset))
      || !Number.isInteger(target.bytes) || target.bytes < 1 || target.bytes > 512 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(String(target.sha256))) throw new Error('Invalid release target.');
    seen.add(target.target);
  }
  return structuredClone(value);
}

/** Verifies the signature over the exact bytes that were signed, then parses. Parsing a
 *  re-serialized copy would let a whitespace difference change what was actually signed. */
export function verifyReleaseManifest(
  manifestBytes: Uint8Array,
  signature: Uint8Array,
  keys: readonly TrustedPublicKey[],
  now = new Date(),
): PluginReleaseManifest {
  let parsed: PluginReleaseManifest;
  try { parsed = parseReleaseManifest(JSON.parse(Buffer.from(manifestBytes).toString('utf8'))); }
  catch (error) { throw new Error(`Release manifest is not readable: ${error instanceof Error ? error.message : String(error)}`); }

  const key = keys.find(candidate => candidate.keyId === parsed.publisher.keyId);
  if (!key) throw new Error(`Release manifest is signed by an unknown key: ${parsed.publisher.keyId}.`);
  if (key.retiredAt && Date.parse(parsed.createdAt) >= Date.parse(key.retiredAt)) throw new Error(`Release manifest uses a retired key: ${key.keyId}.`);
  if (Date.parse(parsed.createdAt) > now.getTime() + 24 * 60 * 60 * 1_000) throw new Error('Release manifest is dated in the future.');

  let publicKey;
  try { publicKey = createPublicKey(key.publicKeyPem); }
  catch { throw new Error(`Trusted key ${key.keyId} is not a readable public key.`); }
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error(`Trusted key ${key.keyId} is not Ed25519.`);
  // Ed25519 hashes internally, so the algorithm argument is null by design.
  if (!verifySignature(null, manifestBytes, publicKey, signature)) throw new Error('Release manifest signature does not verify.');
  return parsed;
}

/** Second half of the check: the bytes actually downloaded are the ones the manifest
 *  pinned, and the package inside agrees about who it is. */
export function assertPackageMatchesRelease(
  release: PluginReleaseManifest,
  target: PluginTarget,
  archive: Uint8Array,
  inner: PluginManifestV2,
): ReleaseTarget {
  const entry = release.targets.find(candidate => candidate.target === target);
  if (!entry) throw new Error(`The release has no ${target} package.`);
  if (archive.byteLength !== entry.bytes) throw new Error('Downloaded package size does not match the signed manifest.');
  const digest = sha256Hex(archive);
  if (digest !== entry.sha256) throw new Error('Downloaded package digest does not match the signed manifest.');
  if (inner.id !== release.plugin) throw new Error('Package identifier does not match the signed manifest.');
  if (inner.version !== release.version) throw new Error('Package version does not match the signed manifest.');
  if (inner.publisher.id !== release.publisher.id || inner.publisher.keyId !== release.publisher.keyId) throw new Error('Package publisher does not match the signed manifest.');
  if (!inner.compatibility.targets.includes(target)) throw new Error('Package does not declare the target it was published for.');
  return entry;
}

/** Installing over a newer version is only ever a deliberate rollback, never an update. */
export function assertNotDowngrade(installedVersion: string | undefined, next: string): void {
  if (installedVersion && compareSemver(next, installedVersion) < 0) throw new Error(`Refusing to install ${next} over the newer ${installedVersion}.`);
}

/** Same version, different bytes: either the release was rewritten or something is
 *  serving a substitute. Both are rejected without asking the user to adjudicate. */
export function assertStableDigest(installed: { version: string; digest: string } | undefined, next: { version: string; digest: string }): void {
  if (installed && installed.version === next.version && installed.digest !== next.digest) {
    throw new Error(`Version ${next.version} was published with different content than the copy already installed.`);
  }
}
