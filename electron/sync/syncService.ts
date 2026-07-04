import { v4 as uuid } from 'uuid';
import { getSettings } from '../db/settingsRepo';
import { addSyncLog } from '../db/syncRepo';
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
import { setWorkCollections, addWorkCollections, upsertCollections } from '../db/collectionsRepo';
import { collectionItemsRecursive, libraryVersion, topCollections, childCollections } from '../zotero/zoteroClient';
import type { ZoteroCollection } from '@shared/types';
import { scanQueue } from '../pipeline/scanQueue';
import type { SyncLogEntry, WorkCreator, ZoteroItem } from '@shared/types';
import { linkZoteroAuthors } from '../db/authorsRepo';
import { getDb } from '../db/database';
import { probeWorkTextAvailability } from '../extraction/textExtractor';

function authorsOf(item: ZoteroItem): string[] {
  return item.creators.map((c) => {
    if (c.name) return c.name;
    const last = c.lastName ?? '';
    const initial = c.firstName ? `, ${c.firstName.charAt(0)}.` : '';
    return `${last}${initial}`;
  });
}

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
    zotero_version: item.version,
    title: item.title,
    authors: authorsOf(item),
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
async function refreshCollectionTree(userId: string, monitored: string[]): Promise<void> {
  if (monitored.length === 0) return;
  const all = new Map<string, ZoteroCollection>();
  let top: ZoteroCollection[] = [];
  try {
    top = await topCollections(userId);
  } catch {
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
    } catch {
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

/** Full sync over all monitored collections. */
export async function fullSync(mode: 'manual' | 'realtime'): Promise<SyncLogEntry> {
  const settings = getSettings();
  const userId = settings.zoteroUserId;
  let added = 0;
  let changed = 0;
  let lightQueued = 0;
  let deepQueued = 0;

  const seen = new Set<string>();

  // Keep the collection tree current so the Library collection filter shows names
  // and can expand a parent to its subcollections.
  await refreshCollectionTree(userId, settings.monitoredCollections);

  for (const collectionKey of settings.monitoredCollections) {
    let items: ZoteroItem[] = [];
    try {
      // Recurse into subcollections so monitoring a parent captures everything under it.
      items = await collectionItemsRecursive(userId, collectionKey);
    } catch {
      continue; // collection unavailable; skip without aborting the whole sync
    }
    for (const item of items) {
      seen.add(item.key);
      const before = getWorkByZoteroKey(item.key);
      const { nodusId, isNew, hasReadTag } = ingestZoteroItem(item, settings.readTag);
      const didChange = !!before && before.zotero_version !== item.version;
      if (isNew) {
        added++;
      } else if (didChange) {
        changed++;
      }
      if (settings.autoLightScan && (isNew || didChange)) {
        setLightPending(nodusId);
        scanQueue.enqueue(nodusId, item.title, 'light');
        lightQueued++;
      }
      const after = getWorkByZoteroKey(item.key);
      let recoverableText = false;
      if (after?.deep_status === 'skipped_no_text') {
        const probe = await probeWorkTextAvailability(settings.zoteroUserId, item.key, settings.zoteroStoragePath, {
          preferZoteroFulltext: settings.preferZoteroFulltext,
          itemType: after.item_type,
        });
        recoverableText = probe.available;
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

  // Persist the library version so realtime polling can diff against it.
  try {
    const version = await libraryVersion(userId);
    setLibraryVersion(version);
  } catch {
    /* ignore */
  }

  const summary = `${added} altas, ${changed} cambios, ${lightQueued} temas encolados, ${deepQueued} profundos encolados`;
  return addSyncLog(mode, summary);
}

function setLibraryVersion(version: number): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES ('library_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(version));
}

function getLibraryVersion(): number {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'library_version'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

// ── Realtime polling ──────────────────────────────────────────────────────────

let pollTimer: NodeJS.Timeout | null = null;

export function startRealtimeSync(): void {
  stopRealtimeSync();
  const tick = async () => {
    const settings = getSettings();
    if (settings.syncMode !== 'realtime') return;
    try {
      const version = await libraryVersion(settings.zoteroUserId);
      if (version > getLibraryVersion()) {
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
