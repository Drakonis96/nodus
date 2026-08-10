import type Database from 'better-sqlite3';
import type {
  LibraryAnalysisComponent,
  LibraryContentRevision,
  LibraryItemRecord,
  LibraryPendingInvalidation,
  LibraryVaultLink,
} from '@shared/libraryTypes';
import { getDb } from '../db/database';
import { getActiveVault } from '../vaults/vaultRegistry';
import { LibraryCatalog } from './libraryCatalog';
import { LibraryDiskStore } from './libraryStorage';

function writableActiveVault(): boolean {
  const vault = getActiveVault();
  if (vault.origin !== 'connected') return true;
  return vault.remote?.state === 'active' && (vault.remote.role === 'writer' || vault.remote.role === 'owner');
}

function uniqueComponents(components: LibraryAnalysisComponent[]): LibraryAnalysisComponent[] {
  return [...new Set(components)];
}

function applyToWork(
  db: Database.Database,
  link: LibraryVaultLink,
  entries: LibraryPendingInvalidation[],
  revision: LibraryContentRevision,
): LibraryVaultLink | null {
  const exists = db.prepare('SELECT 1 FROM works WHERE nodus_id=?').get(link.workId);
  if (!exists) return null;
  const components = uniqueComponents(entries.flatMap((entry) => entry.components));
  const now = entries.map((entry) => entry.requestedAt).sort().at(-1) ?? revision.updatedAt;
  const reasons = [...new Set(entries.map((entry) => entry.reason))].join(', ');
  db.transaction(() => {
    if (components.includes('light')) db.prepare("UPDATE works SET light_status='pending' WHERE nodus_id=?").run(link.workId);
    if (components.some((component) => ['deep', 'passages', 'ideas', 'embeddings'].includes(component))) {
      db.prepare("UPDATE works SET deep_status='pending' WHERE nodus_id=?").run(link.workId);
    }
    if (components.includes('summary')) db.prepare("UPDATE works SET summary_status='pending' WHERE nodus_id=?").run(link.workId);
    const statement = db.prepare(`
      INSERT INTO library_analysis_freshness (work_id, component, freshness, fingerprint, reason, updated_at)
      VALUES (?, ?, 'stale', ?, ?, ?)
      ON CONFLICT(work_id, component) DO UPDATE SET
        freshness='stale', fingerprint=excluded.fingerprint, reason=excluded.reason, updated_at=excluded.updated_at
    `);
    for (const component of components) {
      statement.run(link.workId, component, revision.components[component].fingerprint, reasons, now);
    }
  })();
  return {
    ...link,
    analysis: {
      ...link.analysis,
      lightStatus: components.includes('light') ? 'pending' : link.analysis.lightStatus,
      deepStatus: components.some((component) => ['deep', 'passages', 'ideas', 'embeddings'].includes(component)) ? 'pending' : link.analysis.deepStatus,
      summaryStatus: components.includes('summary') ? 'pending' : link.analysis.summaryStatus,
    },
  };
}

function expandedPending(item: LibraryItemRecord, links: LibraryVaultLink[]): LibraryPendingInvalidation[] {
  const pending = item.contentRevision?.pendingInvalidations ?? [];
  const explicit = pending.filter((entry) => entry.vaultId !== '*');
  const wildcard = pending.filter((entry) => entry.vaultId === '*');
  for (const link of links) for (const entry of wildcard) explicit.push({ ...entry, vaultId: link.vaultId });
  const merged = new Map<string, LibraryPendingInvalidation>();
  for (const entry of explicit) {
    const key = `${entry.vaultId}\0${entry.reason}`;
    const prior = merged.get(key);
    merged.set(key, prior ? { ...entry, components: uniqueComponents([...prior.components, ...entry.components]) } : entry);
  }
  return [...merged.values()];
}

/** Apply invalidation transactionally to the active writable vault. Closed,
 * disconnected and read-only vaults retain explicit pending records in the manifest. */
export function propagateLibraryInvalidations(
  item: LibraryItemRecord,
  store: LibraryDiskStore,
  catalog: LibraryCatalog,
): LibraryItemRecord {
  if (!item.contentRevision?.pendingInvalidations.length) return item;
  const links = catalog.listVaultLinks(item.id);
  const pending = expandedPending(item, links);
  const active = getActiveVault();
  const activeEntries = pending.filter((entry) => entry.vaultId === active.id);
  let remaining = pending;
  if (activeEntries.length && writableActiveVault()) {
    const link = links.find((candidate) => candidate.vaultId === active.id);
    if (link) {
      const updatedLink = applyToWork(getDb(), link, activeEntries, item.contentRevision);
      if (updatedLink) {
        catalog.upsertVaultLinks([updatedLink]);
        remaining = pending.filter((entry) => entry.vaultId !== active.id);
      }
    }
  }
  if (JSON.stringify(remaining) === JSON.stringify(item.contentRevision.pendingInvalidations)) return item;
  const now = new Date().toISOString();
  return store.upsertItem({
    ...item,
    contentRevision: {
      ...item.contentRevision,
      revision: item.contentRevision.revision + 1,
      pendingInvalidations: remaining,
      updatedAt: now,
    },
  }, item.clock.revision, now);
}

export function settleActiveVaultLibraryInvalidations(store: LibraryDiskStore, catalog: LibraryCatalog): number {
  let settled = 0;
  for (const item of store.scanMaterializedItems().records) {
    if (item.deletedAt || !item.contentRevision?.pendingInvalidations.length) continue;
    const next = propagateLibraryInvalidations(item, store, catalog);
    if (next.clock.revision !== item.clock.revision) settled += 1;
  }
  if (settled) catalog.rebuild(store);
  return settled;
}
