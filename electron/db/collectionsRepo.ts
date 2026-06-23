import { getDb } from './database';
import type { CollectionFacet, ZoteroCollection } from '@shared/types';

/** Replace a work's direct collection membership (used on the normal ingest path). */
export function setWorkCollections(nodusId: string, collectionKeys: string[]): void {
  const db = getDb();
  const keys = Array.from(new Set(collectionKeys.filter((k): k is string => typeof k === 'string' && !!k)));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM work_collections WHERE nodus_id = ?').run(nodusId);
    const insert = db.prepare('INSERT OR IGNORE INTO work_collections (nodus_id, collection_key) VALUES (?, ?)');
    for (const key of keys) insert.run(nodusId, key);
  });
  tx();
}

/** Add to a work's collection membership without dropping what's already there
 *  (used when an alias/duplicate item is folded into its canonical work). */
export function addWorkCollections(nodusId: string, collectionKeys: string[]): void {
  const db = getDb();
  const insert = db.prepare('INSERT OR IGNORE INTO work_collections (nodus_id, collection_key) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const key of collectionKeys) {
      if (typeof key === 'string' && key) insert.run(nodusId, key);
    }
  });
  tx();
}

/** Upsert the collection tree (key → name, parent) so filters can show names and
 *  expand a parent to its subcollections. */
export function upsertCollections(collections: ZoteroCollection[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO collections (collection_key, name, parent_key) VALUES (@key, @name, @parent)
       ON CONFLICT(collection_key) DO UPDATE SET name = excluded.name, parent_key = excluded.parent_key`
  );
  const tx = db.transaction(() => {
    for (const c of collections) {
      stmt.run({ key: c.key, name: c.name, parent: c.parentCollection ? String(c.parentCollection) : null });
    }
  });
  tx();
}

/** Collections that currently hold at least one work, with their work counts and
 *  hierarchy depth, ordered as a flattened tree for the filter dropdown. */
export function listCollectionFacets(): CollectionFacet[] {
  const db = getDb();
  const cols = db.prepare('SELECT collection_key, name, parent_key FROM collections').all() as {
    collection_key: string;
    name: string | null;
    parent_key: string | null;
  }[];
  const counts = db
    .prepare(
      `SELECT wc.collection_key AS key, COUNT(DISTINCT wc.nodus_id) AS c
         FROM work_collections wc JOIN works w ON w.nodus_id = wc.nodus_id
        WHERE w.archived = 0
        GROUP BY wc.collection_key`
    )
    .all() as { key: string; c: number }[];
  const countByKey = new Map(counts.map((r) => [r.key, r.c]));

  const byKey = new Map(cols.map((c) => [c.collection_key, c]));
  const childrenOf = new Map<string | null, typeof cols>();
  for (const c of cols) {
    const parent = c.parent_key && byKey.has(c.parent_key) ? c.parent_key : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(c);
    childrenOf.set(parent, list);
  }

  // Subtree count: a parent should report works in itself and its descendants.
  const subtreeCount = (key: string): number => {
    let total = countByKey.get(key) ?? 0;
    for (const child of childrenOf.get(key) ?? []) total += subtreeCount(child.collection_key);
    return total;
  };

  const out: CollectionFacet[] = [];
  const walk = (parent: string | null, depth: number): void => {
    const list = (childrenOf.get(parent) ?? []).slice().sort((a, b) =>
      (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
    );
    for (const c of list) {
      out.push({
        key: c.collection_key,
        name: c.name ?? c.collection_key,
        parentKey: c.parent_key && byKey.has(c.parent_key) ? c.parent_key : null,
        depth,
        workCount: subtreeCount(c.collection_key),
      });
      walk(c.collection_key, depth + 1);
    }
  };
  walk(null, 0);
  return out.filter((f) => f.workCount > 0);
}

/** Expand selected collection keys to include every descendant subcollection, so
 *  selecting a parent shows the works of its subcollections too. */
export function expandCollectionKeys(keys: string[]): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT collection_key, parent_key FROM collections').all() as {
    collection_key: string;
    parent_key: string | null;
  }[];
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parent_key) continue;
    const list = childrenOf.get(r.parent_key) ?? [];
    list.push(r.collection_key);
    childrenOf.set(r.parent_key, list);
  }
  const result = new Set<string>();
  const stack = [...keys];
  while (stack.length) {
    const key = stack.pop()!;
    if (result.has(key)) continue;
    result.add(key);
    for (const child of childrenOf.get(key) ?? []) stack.push(child);
  }
  return Array.from(result);
}
