import { v4 as uuid } from 'uuid';
import { getSettings } from '../db/settingsRepo';
import { addSyncLog, getSyncLog } from '../db/syncRepo';
import {
  upsertWork,
  getWorkByZoteroKey,
  getWorkByDoi,
  getWorkByAliasKey,
  addAlias,
  setReadTag,
  recomputeDeepTrigger,
  setLightPending,
  setDeepPending,
} from '../db/worksRepo';
import { setWorkCollections, addWorkCollections, upsertCollections, expandCollectionKeys } from '../db/collectionsRepo';
import { collectionItems, libraries as zoteroLibraries, libraryVersion, topCollections, childCollections } from '../zotero/zoteroClient';
import type { ZoteroCollection, ZoteroLibrary } from '@shared/types';
import { scanQueue } from '../pipeline/scanQueue';
import type { SyncLogEntry, WorkCreator, ZoteroItem } from '@shared/types';
import { bylineFromCreators, linkZoteroAuthors } from '../db/authorsRepo';
import { getDb } from '../db/database';
import { probeWorkTextAvailability } from '../extraction/textExtractor';
import { getActiveVault } from '../vaults/vaultRegistry';
import { documentIndexQueue } from '../pipeline/documentIndexQueue';
import { DOCUMENT_INDEX_CONTINUOUS_AVAILABLE } from '@shared/documentIndexPolicy';
import type { ZoteroSyncOptions } from '@shared/types';
import {
  classifyZoteroItemChange,
  persistedZoteroVersion,
  shouldAutomateAnalysisAfterSync,
  zoteroItemFingerprint,
  zoteroLibraryVersionsChanged,
  type ZoteroSyncMode,
} from './zoteroSyncPolicy';


/** Structured creators kept for building canonical author identity. Only authors
 *  and editors feed the author layer (translators, series editors, … are ignored). */
function creatorsOf(item: ZoteroItem): WorkCreator[] {
  const out: WorkCreator[] = [];
  for (const c of item.creators) {
    const type = (c.creatorType ?? 'author').toLowerCase();
    const role: 'author' | 'editor' | null =
      type === 'author' ? 'author' : type === 'editor' ? 'editor' : null;
    if (!role) continue;
    out.push({ lastName: c.lastName ?? '', firstName: c.firstName ?? '', name: c.name ?? null, role });
  }
  return out;
}

/** Ingest a single Zotero item into Nodus. Analysis is enqueued separately by explicit settings. */
export function ingestZoteroItem(item: ZoteroItem, readTagName: string): { nodusId: string; isNew: boolean; hasReadTag: boolean } {
  const existing = getWorkByZoteroKey(item.key);
  const hasTag = item.tags.some((t) => t.toLowerCase() === readTagName.toLowerCase());

  if (!existing) {
    // (1) This key was previously merged into another work: keep it merged so a
    // resync never resurrects a duplicate the user already cleaned up.
    const aliased = getWorkByAliasKey(item.key);
    if (aliased) {
      if (hasTag) setReadTag(aliased.nodus_id, true);
      addWorkCollections(aliased.nodus_id, item.collections);
      const trigger = recomputeDeepTrigger(aliased.nodus_id);
      return { nodusId: aliased.nodus_id, isNew: false, hasReadTag: trigger === 'tag' || trigger === 'both' };
    }
    // (2) A *different* Zotero item that shares an existing work's DOI is a true
    // duplicate: unify it under that work's nodus_id as an alias instead of
    // inserting a second works row (which previously leaked duplicates).
    if (item.doi) {
      const byDoi = getWorkByDoi(item.doi);
      if (byDoi) {
        addAlias(byDoi.nodus_id, item.key);
        if (hasTag) setReadTag(byDoi.nodus_id, true);
        addWorkCollections(byDoi.nodus_id, item.collections);
        const trigger = recomputeDeepTrigger(byDoi.nodus_id);
        return { nodusId: byDoi.nodus_id, isNew: false, hasReadTag: trigger === 'tag' || trigger === 'both' };
      }
    }
  }

  // The SAME Zotero item (same key) belonging to several collections never
  // duplicates — its key is unique, so this path just updates the one row.
  const nodusId = existing?.nodus_id ?? uuid();

  upsertWork({
    nodus_id: nodusId,
    zotero_key: item.key,
    zotero_version: persistedZoteroVersion(existing, item.version),
    zotero_fingerprint: zoteroItemFingerprint(item),
    title: item.title,
    zotero_title_markup: item.titleMarkup ?? null,
    // Byline and structured creators are derived from the same filtered list, so
    // the display string can never disagree with the roles stored beside it.
    authors: bylineFromCreators(creatorsOf(item)),
    creators: creatorsOf(item),
    year: item.year,
    item_type: item.itemType,
    doi: item.doi,
    read_tag: hasTag,
    zoteroTags: item.tags,
  });
  setWorkCollections(nodusId, item.collections);
  // Refresh the canonical author layer from Zotero for works that already have
  // author nodes (i.e. were analysed): re-key to canonical identity, apply
  // editor roles, drop stale name variants. Un-analysed works are left untouched.
  linkZoteroAuthors(nodusId, { createIfMissing: false });

  const trigger = recomputeDeepTrigger(nodusId);
  return { nodusId, isNew: !existing, hasReadTag: trigger === 'tag' || trigger === 'both' };
}

/** Refresh the stored collection tree (key → name, parent) for every monitored
 *  collection and its descendants, so the Library collection filter shows names. */
async function refreshCollectionTree(userId: string, monitored: string[], failures: string[]): Promise<void> {
  if (monitored.length === 0) return;
  const all = new Map<string, ZoteroCollection>();
  let top: ZoteroCollection[] = [];
  try {
    const libs = await zoteroLibraries();
    top = (await Promise.all(libs.map(async (library) => {
      try { return await topCollections(userId, library); }
      catch (error) {
        failures.push(`${library.type}:${library.id}:top:${error instanceof Error ? error.message : 'unknown'}`);
        return [];
      }
    }))).flat();
  } catch (error) {
    failures.push(`libraries:${error instanceof Error ? error.message : 'unknown'}`);
    return;
  }
  for (const c of top) all.set(c.key, c);
  const visited = new Set<string>();
  const visit = async (key: string): Promise<void> => {
    if (visited.has(key)) return;
    visited.add(key);
    let children: ZoteroCollection[] = [];
    try {
      children = await childCollections(userId, key);
    } catch (error) {
      failures.push(`${key}:tree-children:${error instanceof Error ? error.message : 'unknown'}`);
      return;
    }
    for (const c of children) {
      all.set(c.key, c);
      await visit(c.key);
    }
  };
  // Walk from monitored roots (and any top collection, so names resolve fully).
  for (const c of top) await visit(c.key);
  for (const key of monitored) if (!visited.has(key)) await visit(key);
  if (all.size > 0) upsertCollections(Array.from(all.values()));
}

export interface SyncResult {
  added: number;
  changed: number;
  lightQueued: number;
  deepQueued: number;
}

export function shouldQueueDeepAfterSync(input: {
  autoDeepScanOnReadTag: boolean;
  hasReadTag: boolean;
  manualDeep: boolean;
  isNew: boolean;
  didChange: boolean;
  deepStatus: string | null;
  recoverableText: boolean;
}): boolean {
  const selectedForDeep = (input.autoDeepScanOnReadTag && input.hasReadTag) || input.manualDeep;
  if (!selectedForDeep) return false;
  if (input.isNew || input.didChange) return true;
  if (input.deepStatus === 'none' || input.deepStatus === 'failed') return true;
  if (input.deepStatus === 'skipped_no_text') return input.recoverableText;
  return false;
}

/** Works already requeued once via the text-availability probe this session
 *  (mirrors scanQueue.degradedRetryScheduled: at most one retry per session). */
const probeRequeuedThisSession = new Set<string>();

/** Traverse monitored collections while retaining diagnostics for a failed page or
 * child lookup.  The client helper intentionally degrades to an empty result for
 * compatibility; the legacy sync must not make that look like a clean collection. */
async function collectionItemsRecursiveObserved(
  userId: string,
  collectionKey: string,
  failures: string[],
): Promise<ZoteroItem[]> {
  const seen = new Map<string, ZoteroItem>();
  const visited = new Set<string>();
  const visit = async (key: string): Promise<void> => {
    if (visited.has(key)) return;
    visited.add(key);
    let items: ZoteroItem[] = [];
    try {
      items = await collectionItems(userId, key);
    } catch (error) {
      failures.push(`${key}:items:${error instanceof Error ? error.message : 'unknown'}`);
    }
    for (const item of items) if (!seen.has(item.key)) seen.set(item.key, item);
    let children: ZoteroCollection[] = [];
    try {
      children = await childCollections(userId, key);
    } catch (error) {
      failures.push(`${key}:children:${error instanceof Error ? error.message : 'unknown'}`);
    }
    for (const child of children) await visit(child.key);
  };
  await visit(collectionKey);
  return [...seen.values()];
}

/**
 * Reconcile only the legacy Zotero memberships observed by this complete pass.
 * A work row (and therefore its notes, analysis and local files) is never deleted:
 * when Zotero removes or moves an item out of every monitored collection, only the
 * stale membership edge is dropped. This must run only after every collection page
 * was observed successfully; an empty result caused by a failed request is not an
 * authoritative deletion.
 */
function reconcileMonitoredCollectionMemberships(
  observedMemberships: Map<string, Set<string>>,
  monitored: string[],
  previousScope: string[] = [],
): void {
  // Membership rows carry the direct child collection key, not necessarily the
  // monitored root. Expand the persisted hierarchy so a deletion/move from any
  // descendant is reconciled as well. Stale collection rows are intentionally
  // useful here: they let us remove the last edge after Zotero deletes that child.
  const keys = [...new Set([
    ...previousScope,
    ...expandCollectionKeys([...new Set(monitored.filter((key) => typeof key === 'string' && key))]),
  ])];
  if (keys.length === 0) return;
  const db = getDb();
  const placeholders = keys.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT wc.nodus_id, wc.collection_key, w.zotero_key
      FROM work_collections wc
      JOIN works w ON w.nodus_id = wc.nodus_id
     WHERE wc.collection_key IN (${placeholders})
  `).all(...keys) as { nodus_id: string; collection_key: string; zotero_key: string | null }[];
  const nodusIds = [...new Set(rows.map((row) => row.nodus_id))];
  const identitiesByWork = new Map<string, Set<string>>();
  for (const row of rows) {
    const identities = identitiesByWork.get(row.nodus_id) ?? new Set<string>();
    if (row.zotero_key) identities.add(row.zotero_key);
    identitiesByWork.set(row.nodus_id, identities);
  }
  if (nodusIds.length) {
    const aliases = db.prepare(`
      SELECT nodus_id, zotero_key
        FROM work_aliases
       WHERE nodus_id IN (${nodusIds.map(() => '?').join(',')})
    `).all(...nodusIds) as { nodus_id: string; zotero_key: string }[];
    for (const alias of aliases) {
      const identities = identitiesByWork.get(alias.nodus_id) ?? new Set<string>();
      identities.add(alias.zotero_key);
      identitiesByWork.set(alias.nodus_id, identities);
    }
  }
  // A DOI/explicit merge can put several Zotero identities behind one work. Keep
  // an edge iff at least one identity observed in this complete pass still claims
  // that exact direct collection; comparing only works.zotero_key either deletes a
  // valid alias edge or leaves an edge that an item has moved away from.
  const stale = rows.filter((row) => {
    const identities = [...(identitiesByWork.get(row.nodus_id) ?? [])];
    // A manual/non-Zotero work can legitimately use the same collection. Only a
    // canonical Zotero identity or alias authorizes this pass to prune its edge.
    return identities.length > 0
      && !identities.some((key) => observedMemberships.get(key)?.has(row.collection_key));
  });
  if (stale.length === 0) return;
  const remove = db.prepare('DELETE FROM work_collections WHERE nodus_id = ? AND collection_key = ?');
  db.transaction(() => {
    for (const row of stale) remove.run(row.nodus_id, row.collection_key);
  })();
}

/** Full sync over all monitored collections. */
export async function fullSync(mode: ZoteroSyncMode, options: ZoteroSyncOptions = {}): Promise<SyncLogEntry> {
  const settings = getSettings();
  const userId = settings.zoteroUserId;
  const catalogOnly = options.catalogOnly === true;
  const automateAnalysis = shouldAutomateAnalysisAfterSync(mode, options);
  const lastSuccessfulSyncAt = getSyncLog(1)[0]?.at ?? null;
  let added = 0;
  let changed = 0;
  let baselined = 0;
  let lightQueued = 0;
  let deepQueued = 0;
  const collectionFailures: string[] = [];
  let startingVersions: Record<string, number> | null = null;

  try {
    startingVersions = await fetchLibraryVersions(userId, settings.monitoredCollections);
  } catch (error) {
    collectionFailures.push(`versions:start:${error instanceof Error ? error.message : 'unknown'}`);
  }

  const observedMemberships = new Map<string, Set<string>>();
  const observedWorkMemberships = new Map<string, Set<string>>();
  // Capture the old subtree before refreshing parent links. If Zotero moves an
  // entire child collection outside a monitored root, that child is no longer a
  // descendant afterwards, but its historical membership edge is still in scope
  // for this reconciliation pass.
  const previousMonitoredScope = expandCollectionKeys(settings.monitoredCollections);

  // Keep the collection tree current so the Library collection filter shows names
  // and can expand a parent to its subcollections.
  await refreshCollectionTree(userId, settings.monitoredCollections, collectionFailures);

  for (const collectionKey of settings.monitoredCollections) {
    // Recurse into subcollections so monitoring a parent captures everything under it.
    // A failed child is recorded and skipped, instead of being silently treated as empty.
    const items = await collectionItemsRecursiveObserved(userId, collectionKey, collectionFailures);
    for (const item of items) {
      observedMemberships.set(item.key, new Set(item.collections));
      const directBefore = getWorkByZoteroKey(item.key);
      const before = directBefore
        ?? getWorkByAliasKey(item.key)
        ?? (item.doi ? getWorkByDoi(item.doi) : null);
      const incomingAuthors = bylineFromCreators(creatorsOf(item));
      const incomingHasReadTag = item.tags.some((tag) => tag.toLowerCase() === settings.readTag.toLowerCase());
      // Alias/DOI matches describe a second Zotero record attached to one canonical
      // work. Its metadata must not invalidate or reanalyse that canonical record.
      const changeState = directBefore
        ? classifyZoteroItemChange(directBefore, item, {
          authors: incomingAuthors,
          hasReadTag: incomingHasReadTag,
          lastSuccessfulSyncAt,
        })
        : before ? 'unchanged' : 'new';
      const { nodusId, isNew, hasReadTag } = ingestZoteroItem(item, settings.readTag);
      const workMemberships = observedWorkMemberships.get(nodusId) ?? new Set<string>();
      for (const collectionKey of item.collections) workMemberships.add(collectionKey);
      observedWorkMemberships.set(nodusId, workMemberships);
      const didChange = !isNew && changeState === 'changed';
      if (isNew) {
        added++;
      } else if (didChange) {
        changed++;
      } else if (changeState === 'baseline') {
        baselined++;
      }
      // A user-initiated refresh is deliberately catalog-only: it updates monitored
      // Zotero membership and metadata, and leaves every AI queue untouched. Automatic
      // analysis belongs exclusively to the opt-in realtime background path.
      if (automateAnalysis && settings.autoLightScan && (isNew || didChange)) {
        setLightPending(nodusId);
        scanQueue.enqueue(nodusId, item.title, 'light');
        lightQueued++;
      }
      if (automateAnalysis) {
        const after = getWorkByZoteroKey(item.key);
        let recoverableText = false;
        if (after?.deep_status === 'skipped_no_text' && !probeRequeuedThisSession.has(item.key)) {
          const probe = await probeWorkTextAvailability(settings.zoteroUserId, item.key, settings.zoteroStoragePath, {
            preferZoteroFulltext: settings.preferZoteroFulltext,
            itemType: after.item_type,
          });
          recoverableText = probe.available;
          // A present-but-unextractable file (e.g. a scanned PDF with OCR off) keeps
          // probing as available while every retry ends in skipped_no_text again. Cap
          // probe-driven requeues at one per work per session so each sync doesn't
          // re-parse the same stuck attachments. Real changes (new tag, new file
          // version) still requeue via isNew/didChange.
          if (recoverableText) probeRequeuedThisSession.add(item.key);
        }
        const needsDeep =
          !!after &&
          shouldQueueDeepAfterSync({
            autoDeepScanOnReadTag: settings.autoDeepScanOnReadTag,
            hasReadTag,
            manualDeep: after.manual_deep === 1,
            isNew,
            didChange,
            deepStatus: after.deep_status,
            recoverableText,
          });
        if (needsDeep) {
          setDeepPending(nodusId);
          scanQueue.enqueue(nodusId, item.title, 'deep');
          deepQueued++;
        }
      }
    }
  }

  // Persist every monitored library version so group-library edits also trigger realtime sync.
  if (collectionFailures.length === 0) {
    try {
      const endingVersions = await fetchLibraryVersions(userId, settings.monitoredCollections);
      const changedDuringRead = !startingVersions
        || [...new Set([...Object.keys(startingVersions), ...Object.keys(endingVersions)])]
          .some((key) => startingVersions?.[key] !== endingVersions[key]);
      if (changedDuringRead) {
        collectionFailures.push('versions: Zotero cambió durante el recorrido de colecciones');
      } else {
        // `ingestZoteroItem` replaces memberships for a canonical key and adds them
        // for an alias. Their traversal order is not stable, so restore the complete
        // observed union once per merged work before pruning stale in-scope edges.
        for (const [nodusId, memberships] of observedWorkMemberships) {
          addWorkCollections(nodusId, [...memberships]);
        }
        reconcileMonitoredCollectionMemberships(observedMemberships, settings.monitoredCollections, previousMonitoredScope);
        setLibraryVersions(endingVersions);
      }
    } catch (error) {
      collectionFailures.push(`versions:${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  // Continuous document understanding is opt-in. When enabled, reconcile now so
  // newly synced or changed works do not have to wait for the periodic safety poll.
  if (automateAnalysis && DOCUMENT_INDEX_CONTINUOUS_AVAILABLE && settings.documentIndexingEnabled && (added > 0 || changed > 0)) {
    await documentIndexQueue.refreshVault(getActiveVault().id).catch((error) => {
      console.error('[document-index] post-sync refresh failed', error);
    });
  }

  for (const failure of collectionFailures) console.warn(`[zotero-sync] collection traversal failed: ${failure}`);
  const failureSummary = collectionFailures.length ? `, ${collectionFailures.length} fallos de colección` : '';
  const baselineSummary = baselined > 0 ? `, ${baselined} revisiones locales adoptadas` : '';
  const summary = catalogOnly
    ? `${added} altas, ${changed} cambios${baselineSummary}; catálogo actualizado sin iniciar análisis${failureSummary}`
    : `${added} altas, ${changed} cambios${baselineSummary}, ${lightQueued} temas encolados, ${deepQueued} profundos encolados${failureSummary}`;
  const log = addSyncLog(mode, summary);
  if (collectionFailures.length) {
    throw new Error(`La sincronización de Zotero quedó incompleta: ${collectionFailures.length} lectura(s) fallaron. No se avanzó el checkpoint.`);
  }
  return log;
}

function monitoredLibraries(collections: string[]): ZoteroLibrary[] {
  const out = new Map<string, ZoteroLibrary>();
  out.set('user:0', { type: 'user', id: '0', name: 'Mi biblioteca' });
  for (const key of collections) {
    const match = /^groups:([^:]+):/.exec(key);
    if (match) out.set(`group:${match[1]}`, { type: 'group', id: match[1], name: `Grupo ${match[1]}` });
  }
  return [...out.values()];
}

async function fetchLibraryVersions(userId: string, collections: string[]): Promise<Record<string, number>> {
  const entries = await Promise.all(monitoredLibraries(collections).map(async (library) => [
    `${library.type}:${library.id}`,
    await libraryVersion(userId, library),
  ] as const));
  return Object.fromEntries(entries);
}

function setLibraryVersions(versions: Record<string, number>): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES ('library_versions', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(versions));
}

function getLibraryVersions(): Record<string, number> {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'library_versions'").get() as
    | { value: string }
    | undefined;
  if (!row) return {};
  try { return JSON.parse(row.value) as Record<string, number>; } catch { return {}; }
}

// ── Realtime polling ──────────────────────────────────────────────────────────

let pollTimer: NodeJS.Timeout | null = null;

export function startRealtimeSync(): void {
  stopRealtimeSync();
  const tick = async () => {
    const settings = getSettings();
    if (settings.syncMode !== 'realtime') return;
    try {
      const versions = await fetchLibraryVersions(settings.zoteroUserId, settings.monitoredCollections);
      const previous = getLibraryVersions();
      if (zoteroLibraryVersionsChanged(previous, versions)) {
        await fullSync('realtime');
      }
    } catch {
      /* Zotero offline; try again next tick */
    }
  };
  pollTimer = setInterval(tick, 25_000);
}

export function stopRealtimeSync(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
