import keyFile from './trustedKeys.json';
import type { TrustedPublicKey } from '../../packages/capability-api/src/signature';

/** The publishing keys this build trusts.
 *
 *  Fails closed on purpose: with no key, no v2 package installs at all. A build that
 *  cannot verify a signature must refuse the package, never fall back to installing it
 *  unverified, so an empty list is a safe state rather than an open one. */

const SPKI = /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/;

let cached: TrustedPublicKey[] | null = null;

export function trustedPublishingKeys(): TrustedPublicKey[] {
  if (cached) return cached;
  const raw = (keyFile as { keys?: unknown }).keys;
  const keys = Array.isArray(raw) ? raw : [];
  cached = keys.flatMap(entry => {
    const key = entry as TrustedPublicKey;
    if (!key || typeof key.keyId !== 'string' || !/^[a-z0-9]{4,32}$/.test(key.keyId) || typeof key.publicKeyPem !== 'string' || !SPKI.test(key.publicKeyPem)) return [];
    if (key.retiredAt !== undefined && Number.isNaN(Date.parse(key.retiredAt))) return [];
    return [{ keyId: key.keyId, publicKeyPem: key.publicKeyPem, ...(key.retiredAt ? { retiredAt: key.retiredAt } : {}) }];
  });
  return cached;
}

export function assertPublishingKeysConfigured(): void {
  if (!trustedPublishingKeys().length) {
    throw new Error('This build carries no capability publishing key, so signed plugins cannot be verified or installed.');
  }
}
