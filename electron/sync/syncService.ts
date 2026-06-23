import { v4 as uuid } from 'uuid';
import { getSettings } from '../db/settingsRepo';
import { addSyncLog } from '../db/syncRepo';
import {
  upsertWork,
  getWorkByZoteroKey,
  getWorkByDoi,
  addAlias,
  setReadTag,
  recomputeDeepTrigger,
  setLightPending,
  setDeepPending,
} from '../db/worksRepo';
import { collectionItemsRecursive, libraryVersion } from '../zotero/zoteroClient';
import { scanQueue } from '../pipeline/scanQueue';
import type { SyncLogEntry, ZoteroItem } from '@shared/types';
import { getDb } from '../db/database';

function authorsOf(item: ZoteroItem): string[] {
  return item.creators.map((c) => {
    if (c.name) return c.name;
    const last = c.lastName ?? '';
    const initial = c.firstName ? `, ${c.firstName.charAt(0)}.` : '';
    return `${last}${initial}`;
  });
}

/** Ingest a single Zotero item into Nodus. Analysis is enqueued separately by explicit settings. */
export function ingestZoteroItem(item: ZoteroItem, readTagName: string): { nodusId: string; isNew: boolean; hasReadTag: boolean } {
  const existing = getWorkByZoteroKey(item.key);
  const hasTag = item.tags.some((t) => t.toLowerCase() === readTagName.toLowerCase());

  // The SAME Zotero item (same key) belonging to several collections never
  // duplicates — its key is unique, so the branch below just updates it once.
  // A *different* Zotero item that shares an existing work's DOI is a true
  // duplicate: unify it under that work's nodus_id as an alias instead of
  // inserting a second works row (which is what previously leaked duplicates).
  if (!existing && item.doi) {
    const byDoi = getWorkByDoi(item.doi);
    if (byDoi) {
      addAlias(byDoi.nodus_id, item.key);
      // Carry the read tag over so the canonical work stays deep-eligible.
      if (hasTag) setReadTag(byDoi.nodus_id, true);
      const trigger = recomputeDeepTrigger(byDoi.nodus_id);
      return { nodusId: byDoi.nodus_id, isNew: false, hasReadTag: trigger === 'tag' || trigger === 'both' };
    }
  }

  const nodusId = existing?.nodus_id ?? uuid();

  upsertWork({
    nodus_id: nodusId,
    zotero_key: item.key,
    zotero_version: item.version,
    title: item.title,
    authors: authorsOf(item),
    year: item.year,
    item_type: item.itemType,
    doi: item.doi,
    read_tag: hasTag,
    zoteroTags: item.tags,
  });

  const trigger = recomputeDeepTrigger(nodusId);
  return { nodusId, isNew: !existing, hasReadTag: trigger === 'tag' || trigger === 'both' };
}

export interface SyncResult {
  added: number;
  changed: number;
  lightQueued: number;
  deepQueued: number;
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
      const needsDeep =
        !!after &&
        (isNew ||
          didChange ||
          after.deep_status === 'none' ||
          after.deep_status === 'failed' ||
          after.deep_status === 'skipped_no_text');
      if (settings.autoDeepScanOnReadTag && hasReadTag && needsDeep) {
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
