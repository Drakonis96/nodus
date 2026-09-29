/**
 * Works whose Zotero item left the library. Zotero's local API reports no deletions (`/deleted`
 * answers 404) and leaves trashed items out of collection listings, so a full sync that stops
 * seeing an item cannot tell "moved out of the monitored collections" from "trashed" or
 * "deleted". It asks Zotero about each such work instead, and archives the ones Zotero no longer
 * has; restoring the item in Zotero un-archives it on the next sync (ingesting resets `archived`).
 */
import { expandCollectionKeys } from '../db/collectionsRepo';
import { getDb } from '../db/database';
import { setArchived } from '../db/worksRepo';
import { itemPresence } from '../zotero/zoteroClient';

/** Non-archived Zotero works this pass did not see and no monitored collection holds. */
export function unobservedUnmonitoredWorks(observedMemberships: Map<string, Set<string>>, monitored: string[], limit: number): string[] {
  const keys = expandCollectionKeys([...new Set(monitored.filter((key) => typeof key === 'string' && key))]);
  if (!keys.length) return [];
  const rows = getDb().prepare(`
    SELECT w.nodus_id, w.zotero_key FROM works w
     WHERE w.archived = 0 AND w.zotero_key IS NOT NULL AND w.zotero_key NOT LIKE 'nodus-library:%'
       AND NOT EXISTS (SELECT 1 FROM work_collections wc WHERE wc.nodus_id = w.nodus_id AND wc.collection_key IN (${keys.map(() => '?').join(',')}))
  `).all(...keys) as { nodus_id: string; zotero_key: string }[];
  return rows.filter((row) => !observedMemberships.has(row.zotero_key)).slice(0, limit).map((row) => row.nodus_id);
}

/** Archive the works whose Zotero item is in Zotero's Trash or deleted outright. Zotero's local
 *  API reports no deletions and leaves trashed items out of collection listings, so such a work
 *  simply stopped being seen and stayed searchable and citable (a trashed, then deleted,
 *  McMurry 7th edition kept all 1,346 passages in chemistry evidence). Restoring the item in
 *  Zotero un-archives it on the next sync, since ingesting it resets `archived`. */
export async function archiveWorksRemovedFromZotero(userId: string, nodusIds: string[]): Promise<number> {
  let archived = 0;
  for (const nodusId of nodusIds) {
    const row = getDb().prepare('SELECT zotero_key FROM works WHERE nodus_id = ? AND archived = 0').get(nodusId) as { zotero_key: string | null } | undefined;
    if (!row?.zotero_key || row.zotero_key.startsWith('nodus-library:')) continue;
    const presence = await itemPresence(userId, row.zotero_key);
    if (presence === 'trashed' || presence === 'gone') {
      setArchived(nodusId, true);
      archived += 1;
    }
  }
  return archived;
}
