/** Reconcile missing Zotero works without deleting local data or treating an unreadable
 * source as a deletion. The per-vault queue also drains after the library checkpoint advances. */
import type Database from 'better-sqlite3';
import { expandCollectionKeys } from '../db/collectionsRepo';
import { getDb, withDatabaseContext } from '../db/database';
import { setArchived } from '../db/worksRepo';
import { itemPresenceDetails, presenceLibrary, type ZoteroPresenceSession } from '../zotero/zoteroClient';

export const ZOTERO_REMOVAL_REQUEST_LIMIT = 300;
const QUEUE_KEY = 'zotero_removal_checks';
interface RemovalCheck {
  nodusId: string;
  identities: string[];
  absent: string[];
  versions: Record<string, number>;
}
interface RemovalOptions { monitored?: string[]; requestLimit?: number; signal?: AbortSignal }
const running = new WeakMap<Database.Database, Promise<number>>();

/** Select the entire backlog; the request budget belongs to the combined queue, not this list. */
export function unobservedUnmonitoredWorks(observedMemberships: Map<string, Set<string>>, monitored: string[], limit = Number.MAX_SAFE_INTEGER): string[] {
  const keys = expandCollectionKeys([...new Set(monitored.filter((key) => typeof key === 'string' && key))]);
  if (!keys.length || limit <= 0) return [];
  return (getDb().prepare(`
    SELECT w.nodus_id FROM works w
     WHERE w.archived = 0 AND w.zotero_key IS NOT NULL AND w.zotero_key NOT LIKE 'nodus-library:%'
       AND w.zotero_key NOT IN (SELECT value FROM json_each(@observed))
       AND NOT EXISTS (SELECT 1 FROM work_aliases a WHERE a.nodus_id = w.nodus_id
         AND (a.zotero_key LIKE 'nodus-library:%' OR a.zotero_key IN (SELECT value FROM json_each(@observed))))
       AND NOT EXISTS (SELECT 1 FROM work_collections wc WHERE wc.nodus_id = w.nodus_id
         AND wc.collection_key IN (SELECT value FROM json_each(@monitored)))
     ORDER BY w.rowid LIMIT @limit
  `).all({ observed: JSON.stringify([...observedMemberships.keys()]), monitored: JSON.stringify(keys), limit }) as { nodus_id: string }[])
    .map(row => row.nodus_id);
}

function readQueue(db: Database.Database): RemovalCheck[] {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(QUEUE_KEY) as { value: string } | undefined;
  try {
    const value = row ? JSON.parse(row.value) : [];
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is RemovalCheck => entry && typeof entry.nodusId === 'string'
      && Array.isArray(entry.identities) && entry.identities.every((key: unknown) => typeof key === 'string')
      && Array.isArray(entry.absent) && entry.absent.every((key: unknown) => typeof key === 'string' && entry.identities.includes(key))
      && entry.versions && typeof entry.versions === 'object' && !Array.isArray(entry.versions)
      && Object.values(entry.versions).every(version => Number.isSafeInteger(version) && Number(version) >= 0));
  } catch { return []; }
}

function saveQueue(db: Database.Database, queue: RemovalCheck[]): void {
  if (!queue.length) db.prepare('DELETE FROM settings WHERE key = ?').run(QUEUE_KEY);
  else db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(QUEUE_KEY, JSON.stringify(queue));
}

export function hasPendingZoteroRemovalChecks(): boolean { return readQueue(getDb()).length > 0; }

function identitiesFor(db: Database.Database, nodusId: string, monitored?: string[]): string[] {
  const row = db.prepare('SELECT zotero_key FROM works WHERE nodus_id = ? AND archived = 0').get(nodusId) as { zotero_key: string | null } | undefined;
  if (!row?.zotero_key || row.zotero_key.startsWith('nodus-library:')) return [];
  if (monitored) {
    if (!monitored.length || db.prepare(`SELECT 1 FROM work_collections WHERE nodus_id = ?
      AND collection_key IN (SELECT value FROM json_each(?)) LIMIT 1`).get(nodusId, JSON.stringify(monitored))) return [];
  }
  const aliases = (db.prepare('SELECT zotero_key FROM work_aliases WHERE nodus_id = ? ORDER BY zotero_key').all(nodusId) as { zotero_key: string }[])
    .map(alias => alias.zotero_key).filter(Boolean);
  // A merged local document remains a local source even if every Zotero identity disappears.
  if (aliases.some(key => key.startsWith('nodus-library:'))) return [];
  return [...new Set([row.zotero_key, ...aliases])];
}

function resetEvidence(check: RemovalCheck): void { check.absent = []; check.versions = {}; }

async function drainQueue(db: Database.Database, userId: string, nodusIds: string[], options: RemovalOptions): Promise<number> {
  const queue = readQueue(db);
  const queued = new Set(queue.map(check => check.nodusId));
  for (const nodusId of nodusIds) if (!queued.has(nodusId)) {
    queue.push({ nodusId, identities: [], absent: [], versions: {} }); queued.add(nodusId);
  }
  // Persist before any await so a restart cannot lose the remainder of a bounded pass.
  saveQueue(db, queue);
  const monitored = options.monitored ? expandCollectionKeys(options.monitored) : undefined;
  const requestedLimit = options.requestLimit ?? ZOTERO_REMOVAL_REQUEST_LIMIT;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(ZOTERO_REMOVAL_REQUEST_LIMIT, Math.floor(requestedLimit))) : ZOTERO_REMOVAL_REQUEST_LIMIT;
  const session: ZoteroPresenceSession = { budget: { remaining: limit }, libraries: new Map(),
    signal: options.signal ?? AbortSignal.timeout(15_000) };
  let archived = 0;
  // A failed work goes to the tail and is attempted only once in this pass. New work can advance.
  const count = queue.length;
  for (let index = 0; index < count && session.budget.remaining > 0 && !session.signal?.aborted; index += 1) {
    const check = queue.shift()!;
    const identities = identitiesFor(db, check.nodusId, monitored);
    if (!identities.length) continue;
    if (JSON.stringify(identities) !== JSON.stringify(check.identities)) {
      check.identities = identities; resetEvidence(check);
    }
    if (check.absent.some(key => check.versions[key.startsWith('groups:') ? `group:${key.split(':')[1]}` : `user:${userId}`] === undefined)) resetEvidence(check);
    // Partial evidence is retained to advance even very large merges. Every recorded
    // source revision is validated below before any archive decision can use it.
    let uncertain = false;
    let present = false;
    if (!uncertain) {
      for (const key of identities) {
        if (check.absent.includes(key)) continue;
        if (session.budget.remaining <= 0 || session.signal?.aborted) { uncertain = true; break; }
        const result = await itemPresenceDetails(userId, key, session);
        if (result.presence === 'present') { present = true; break; }
        if (result.presence === 'unknown') { uncertain = true; continue; }
        const version = result.version ?? (await presenceLibrary(userId, key, session))?.version;
        if (version === undefined) { uncertain = true; continue; }
        if (check.versions[result.library] !== undefined && check.versions[result.library] !== version) resetEvidence(check);
        check.versions[result.library] = version;
        check.absent.push(key);
      }
    }
    if (present) continue;
    if (!uncertain && identities.every(key => check.absent.includes(key))) {
      // Zotero may change during a long probe or between batches. Validate every source
      // again before archiving; a version change restarts the evidence, never archives.
      const versions = Object.entries(check.versions);
      if (session.budget.remaining < versions.length) uncertain = true;
      for (const [library, version] of uncertain ? [] : versions) {
        const key = identities.find(identity => (identity.startsWith('groups:') ? `group:${identity.split(':')[1]}` : `user:${userId}`) === library);
        if (!key) { resetEvidence(check); uncertain = true; break; }
        const current = await presenceLibrary(userId, key, session, true);
        if (!current) { uncertain = true; break; }
        if (current.version !== version) { resetEvidence(check); uncertain = true; break; }
      }
      // A merge or restored membership during an await invalidates this decision as well.
      if (!uncertain && JSON.stringify(identitiesFor(db, check.nodusId, monitored)) === JSON.stringify(identities)) {
        setArchived(check.nodusId, true); archived += 1; continue;
      }
    }
    queue.push(check);
  }
  saveQueue(db, queue);
  return archived;
}

/** Shared budget includes canonical keys, aliases, source validation and HTTP retries.
 * Pending checks survive checkpoints/restarts; an observed alias or DOI reactivates on ingest. */
export async function archiveWorksRemovedFromZotero(userId: string, nodusIds: string[], options: RemovalOptions = {}): Promise<number> {
  const db = getDb();
  const previous = running.get(db);
  const current = (async () => {
    if (previous) await previous.catch(() => {});
    return withDatabaseContext(db, () => drainQueue(db, userId, nodusIds, options));
  })();
  running.set(db, current);
  try { return await current; }
  finally { if (running.get(db) === current) running.delete(db); }
}
