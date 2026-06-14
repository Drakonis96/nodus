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
} from '../db/worksRepo';
import { collectionItems, libraryVersion, getItem } from '../zotero/zoteroClient';
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

/** Ingest a single Zotero item into Nodus, returning whether a deep scan should be (re)queued. */
function ingestItem(item: ZoteroItem, readTagName: string): { nodusId: string; isNew: boolean; deepEligible: boolean } {
  const existing = getWorkByZoteroKey(item.key);

  // Duplicate detection by DOI: union under the same nodus_id via alias.
  if (!existing && item.doi) {
    const byDoi = getWorkByDoi(item.doi);
    if (byDoi) {
      addAlias(byDoi.nodus_id, item.key);
    }
  }

  const hasTag = item.tags.some((t) => t.toLowerCase() === readTagName.toLowerCase());
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
  });

  const trigger = recomputeDeepTrigger(nodusId);
  return { nodusId, isNew: !existing, deepEligible: trigger !== null };
}

export interface SyncResult {
  added: number;
  changed: number;
  deepQueued: number;
}

/** Full sync over all monitored collections. */
export async function fullSync(mode: 'manual' | 'realtime'): Promise<SyncLogEntry> {
  const settings = getSettings();
  const userId = settings.zoteroUserId;
  let added = 0;
  let changed = 0;
  let deepQueued = 0;

  const seen = new Set<string>();

  for (const collectionKey of settings.monitoredCollections) {
    let items: ZoteroItem[] = [];
    try {
      items = await collectionItems(userId, collectionKey);
    } catch {
      continue; // collection unavailable; skip without aborting the whole sync
    }
    for (const item of items) {
      seen.add(item.key);
      const before = getWorkByZoteroKey(item.key);
      const { nodusId, isNew, deepEligible } = ingestItem(item, settings.readTag);
      if (isNew) {
        added++;
        scanQueue.enqueue(nodusId, item.title, 'light');
      } else if (before && before.zotero_version !== item.version) {
        changed++;
        scanQueue.enqueue(nodusId, item.title, 'light');
      }
      if (deepEligible) {
        markDeepPending(nodusId);
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

  const summary = `${added} altas, ${changed} cambios, ${deepQueued} profundos encolados`;
  return addSyncLog(mode, summary);
}

function markDeepPending(nodusId: string): void {
  getDb()
    .prepare("UPDATE works SET deep_status = 'pending' WHERE nodus_id = ? AND deep_status IN ('none','failed')")
    .run(nodusId);
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
