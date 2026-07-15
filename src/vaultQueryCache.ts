const MAX_VAULTS = 4;
const MAX_ENTRIES_PER_VAULT = 48;

interface VaultCache {
  revision: number;
  touchedAt: number;
  values: Map<string, unknown>;
}

const caches = new Map<string, VaultCache>();
let activeVaultId: string | null = null;

function scope(vaultId: string): VaultCache {
  let cache = caches.get(vaultId);
  if (!cache) {
    cache = { revision: 0, touchedAt: Date.now(), values: new Map() };
    caches.set(vaultId, cache);
  }
  cache.touchedAt = Date.now();
  if (caches.size > MAX_VAULTS) {
    const oldest = [...caches.entries()]
      .filter(([id]) => id !== vaultId)
      .sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
    if (oldest) caches.delete(oldest[0]);
  }
  return cache;
}

export function setActiveVaultQueryScope(vaultId: string | null): void {
  activeVaultId = vaultId;
  if (vaultId) scope(vaultId);
}

export function getVaultQueryCache<T>(vaultId: string | null | undefined, key: string): T | undefined {
  if (!vaultId) return undefined;
  const cache = caches.get(vaultId);
  if (!cache) return undefined;
  cache.touchedAt = Date.now();
  const value = cache.values.get(key) as T | undefined;
  if (value !== undefined) {
    cache.values.delete(key);
    cache.values.set(key, value);
  }
  return value;
}

export function setVaultQueryCache<T>(vaultId: string | null | undefined, key: string, value: T): void {
  if (!vaultId) return;
  const cache = scope(vaultId);
  cache.values.delete(key);
  cache.values.set(key, value);
  while (cache.values.size > MAX_ENTRIES_PER_VAULT) {
    const oldestKey = cache.values.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    cache.values.delete(oldestKey);
  }
}

/** Increment the vault revision and discard every value derived from its old data. */
export function invalidateVaultQueryCache(vaultId: string | null = activeVaultId): number {
  if (!vaultId) return 0;
  const cache = scope(vaultId);
  cache.revision += 1;
  cache.values.clear();
  return cache.revision;
}

export function getVaultQueryRevision(vaultId: string | null | undefined): number {
  return vaultId ? caches.get(vaultId)?.revision ?? 0 : 0;
}
