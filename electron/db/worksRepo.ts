import { getDb } from './database';
import { expandCollectionKeys } from './collectionsRepo';
import type { Work, WorkView, WorkFilter, DeepTrigger, ZoteroTag, SummaryStatus } from '@shared/types';

function normalizeZoteroTag(tag: string): string {
  return tag.trim().normalize('NFC').toLowerCase();
}

function toView(row: Work, themes: string[], zoteroTags: string[]): WorkView {
  const { authors_json, ...rest } = row;
  let authors: string[] = [];
  try {
    authors = JSON.parse(authors_json || '[]');
  } catch {
    authors = [];
  }
  return { ...rest, authors, themes, zoteroTags };
}

export function getWork(nodusId: string): WorkView | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM works WHERE nodus_id = ?').get(nodusId) as Work | undefined;
  if (!row) return null;
  return toView(row, themesFor(nodusId), zoteroTagsFor(nodusId));
}

/**
 * Fetch many works by id in two queries (works + themes) instead of N+1.
 * Returns a Map keyed by nodus_id for O(1) lookup by callers.
 */
export function getWorksByIds(nodusIds: string[]): Map<string, WorkView> {
  const db = getDb();
  const result = new Map<string, WorkView>();
  if (nodusIds.length === 0) return result;
  const placeholders = nodusIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM works WHERE nodus_id IN (${placeholders})`).all(...nodusIds) as Work[];
  if (rows.length === 0) return result;
  // Batch-load themes for all works in one query.
  const themeRows = db
    .prepare(
      `SELECT wt.nodus_id, t.label
         FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id
        WHERE wt.nodus_id IN (${placeholders})
        ORDER BY wt.nodus_id, t.label`
    )
    .all(...nodusIds) as { nodus_id: string; label: string }[];
  const themesByWork = groupLabels(themeRows);
  const zoteroTagsByWork = zoteroTagsForWorks(nodusIds);
  for (const row of rows) {
    result.set(row.nodus_id, toView(row, themesByWork.get(row.nodus_id) ?? [], zoteroTagsByWork.get(row.nodus_id) ?? []));
  }
  return result;
}

export function getWorkByZoteroKey(zoteroKey: string): Work | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM works WHERE zotero_key = ?').get(zoteroKey) as Work) ?? null;
}

export function getWorkByDoi(doi: string): Work | null {
  const db = getDb();
  if (!doi) return null;
  return (db.prepare('SELECT * FROM works WHERE doi = ? AND doi IS NOT NULL').get(doi) as Work) ?? null;
}

/**
 * Resolve a Zotero key that was previously merged into another work. Once a
 * duplicate is merged its key lives in work_aliases, so a later sync must route
 * the item back to the canonical work instead of re-creating the duplicate.
 */
export function getWorkByAliasKey(zoteroKey: string): Work | null {
  const db = getDb();
  if (!zoteroKey) return null;
  return (
    (db
      .prepare('SELECT w.* FROM work_aliases a JOIN works w ON w.nodus_id = a.nodus_id WHERE a.zotero_key = ?')
      .get(zoteroKey) as Work) ?? null
  );
}

function themesFor(nodusId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.label FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id WHERE wt.nodus_id = ? ORDER BY t.label`
    )
    .all(nodusId) as { label: string }[];
  return rows.map((r) => r.label);
}

function zoteroTagsFor(nodusId: string): string[] {
  return zoteroTagsForWorks([nodusId]).get(nodusId) ?? [];
}

function zoteroTagsForWorks(nodusIds: string[]): Map<string, string[]> {
  const tagsByWork = new Map<string, string[]>();
  if (nodusIds.length === 0) return tagsByWork;
  const placeholders = nodusIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT wzt.nodus_id, zt.label
         FROM work_zotero_tags wzt JOIN zotero_tags zt ON zt.tag_id = wzt.tag_id
        WHERE wzt.nodus_id IN (${placeholders})
        ORDER BY wzt.nodus_id, zt.label COLLATE NOCASE`
    )
    .all(...nodusIds) as { nodus_id: string; label: string }[];
  return groupLabels(rows);
}

function groupLabels(rows: { nodus_id: string; label: string }[]): Map<string, string[]> {
  const labelsByWork = new Map<string, string[]>();
  for (const row of rows) {
    const labels = labelsByWork.get(row.nodus_id) ?? [];
    labels.push(row.label);
    labelsByWork.set(row.nodus_id, labels);
  }
  return labelsByWork;
}

export function listZoteroTags(): ZoteroTag[] {
  const rows = getDb()
    .prepare(
      `SELECT zt.label, COUNT(*) AS work_count
         FROM zotero_tags zt
         JOIN work_zotero_tags wzt ON wzt.tag_id = zt.tag_id
         JOIN works w ON w.nodus_id = wzt.nodus_id
        WHERE w.archived = 0
        GROUP BY zt.tag_id, zt.label
        ORDER BY work_count DESC, zt.label COLLATE NOCASE`
    )
    .all() as { label: string; work_count: number }[];
  return rows.map((row) => ({ label: row.label, workCount: row.work_count }));
}

export function listWorks(filter: WorkFilter = {}): WorkView[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (!filter.includeArchived) clauses.push('archived = 0');
  if (filter.lightStatus && filter.lightStatus !== 'all') {
    clauses.push('light_status = @lightStatus');
    params.lightStatus = filter.lightStatus;
  }
  if (filter.deepStatus && filter.deepStatus !== 'all') {
    clauses.push('deep_status = @deepStatus');
    params.deepStatus = filter.deepStatus;
  }
  if (filter.summaryStatus && filter.summaryStatus !== 'all') {
    clauses.push('summary_status = @summaryStatus');
    params.summaryStatus = filter.summaryStatus;
  }
  if (filter.yearMin != null) {
    clauses.push('year >= @yearMin');
    params.yearMin = filter.yearMin;
  }
  if (filter.yearMax != null) {
    clauses.push('year <= @yearMax');
    params.yearMax = filter.yearMax;
  }
  if (filter.search) {
    clauses.push('(LOWER(title) LIKE @q OR LOWER(authors_json) LIKE @q)');
    params.q = `%${filter.search.toLowerCase()}%`;
  }
  if (filter.theme) {
    clauses.push(
      'nodus_id IN (SELECT wt.nodus_id FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id WHERE t.label = @theme)'
    );
    params.theme = filter.theme;
  }
  const zoteroTags = Array.from(
    new Set((filter.zoteroTags ?? []).map(normalizeZoteroTag).filter(Boolean))
  );
  if (zoteroTags.length > 0) {
    const tagParams = zoteroTags.map((tag, index) => {
      const name = `zoteroTag${index}`;
      params[name] = tag;
      return `@${name}`;
    });
    const tagWhere = `zt.normalized_label IN (${tagParams.join(', ')})`;
    if (filter.zoteroTagMode === 'all') {
      clauses.push(
        `nodus_id IN (
          SELECT wzt.nodus_id
            FROM work_zotero_tags wzt JOIN zotero_tags zt ON zt.tag_id = wzt.tag_id
           WHERE ${tagWhere}
           GROUP BY wzt.nodus_id
          HAVING COUNT(DISTINCT zt.normalized_label) = ${zoteroTags.length}
        )`
      );
    } else {
      clauses.push(
        `nodus_id IN (
          SELECT wzt.nodus_id
            FROM work_zotero_tags wzt JOIN zotero_tags zt ON zt.tag_id = wzt.tag_id
           WHERE ${tagWhere}
        )`
      );
    }
  }

  const collections = Array.from(new Set((filter.collections ?? []).filter((k): k is string => !!k)));
  if (collections.length > 0) {
    let counter = 0;
    const inClause = (keys: string[]): string => {
      const names = keys.map((key) => {
        const name = `coll${counter++}`;
        params[name] = key;
        return `@${name}`;
      });
      return `nodus_id IN (SELECT nodus_id FROM work_collections WHERE collection_key IN (${names.join(', ')}))`;
    };
    if (filter.collectionMode === 'all') {
      // Every selected collection (each expanded to its own subtree) must match.
      for (const key of collections) clauses.push(inClause(expandCollectionKeys([key])));
    } else {
      // Any selected collection or its subcollections.
      clauses.push(inClause(expandCollectionKeys(collections)));
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM works ${where} ORDER BY year DESC, title ASC`).all(params) as Work[];
  if (rows.length === 0) return [];

  // Batch-load themes for all works in one query instead of N+1.
  const ids = rows.map((r) => r.nodus_id);
  const placeholders = ids.map(() => '?').join(',');
  const themeRows = db
    .prepare(
      `SELECT wt.nodus_id, t.label
         FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id
        WHERE wt.nodus_id IN (${placeholders})
        ORDER BY wt.nodus_id, t.label`
    )
    .all(...ids) as { nodus_id: string; label: string }[];
  const themesByWork = groupLabels(themeRows);
  const zoteroTagsByWork = zoteroTagsForWorks(ids);

  return rows.map((r) => toView(r, themesByWork.get(r.nodus_id) ?? [], zoteroTagsByWork.get(r.nodus_id) ?? []));
}

export interface UpsertWorkInput {
  nodus_id: string;
  zotero_key: string;
  zotero_version: number | null;
  title: string;
  authors: string[];
  year: number | null;
  item_type: string;
  doi: string | null;
  read_tag: boolean;
  zoteroTags: string[];
}

/** Insert a new work or update mutable Zotero-sourced fields of an existing one. */
export function upsertWork(input: UpsertWorkInput): void {
  const db = getDb();
  const existing = getWorkByZoteroKey(input.zotero_key);
  if (!existing) {
    db.prepare(
      `INSERT INTO works (nodus_id, zotero_key, zotero_version, title, authors_json, year, item_type, doi, read_tag, light_status)
       VALUES (@nodus_id, @zotero_key, @zotero_version, @title, @authors_json, @year, @item_type, @doi, @read_tag, 'none')`
    ).run({
      ...input,
      authors_json: JSON.stringify(input.authors),
      read_tag: input.read_tag ? 1 : 0,
    });
  } else {
    db.prepare(
      `UPDATE works SET zotero_version=@zotero_version, title=@title, authors_json=@authors_json,
       year=@year, item_type=@item_type, doi=@doi, read_tag=@read_tag, archived=0 WHERE zotero_key=@zotero_key`
    ).run({
      zotero_key: input.zotero_key,
      zotero_version: input.zotero_version,
      title: input.title,
      authors_json: JSON.stringify(input.authors),
      year: input.year,
      item_type: input.item_type,
      doi: input.doi,
      read_tag: input.read_tag ? 1 : 0,
    });
  }
  const nodusId = getWorkByZoteroKey(input.zotero_key)!.nodus_id;
  replaceZoteroTags(nodusId, input.zoteroTags);
  recomputeDeepTrigger(nodusId);
}

/** Replace one work's Zotero-sourced tags without affecting user-managed themes. */
function replaceZoteroTags(nodusId: string, tags: string[]): void {
  const labels = Array.from(
    new Map(
      tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => [normalizeZoteroTag(tag), tag])
    ).values()
  );
  const db = getDb();
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM work_zotero_tags WHERE nodus_id = ?').run(nodusId);
    const insertTag = db.prepare(
      'INSERT INTO zotero_tags (label, normalized_label) VALUES (?, ?) ON CONFLICT(normalized_label) DO NOTHING'
    );
    const findTag = db.prepare('SELECT tag_id FROM zotero_tags WHERE normalized_label = ?');
    const linkTag = db.prepare('INSERT INTO work_zotero_tags (nodus_id, tag_id) VALUES (?, ?)');
    for (const label of labels) {
      const normalizedLabel = normalizeZoteroTag(label);
      insertTag.run(label, normalizedLabel);
      const tag = findTag.get(normalizedLabel) as { tag_id: number };
      linkTag.run(nodusId, tag.tag_id);
    }
  });
  replace();
}

export function addAlias(nodusId: string, zoteroKey: string): void {
  getDb().prepare('INSERT OR IGNORE INTO work_aliases (nodus_id, zotero_key) VALUES (?, ?)').run(nodusId, zoteroKey);
}

export function setManualDeep(nodusId: string, value: boolean): void {
  getDb().prepare('UPDATE works SET manual_deep = ? WHERE nodus_id = ?').run(value ? 1 : 0, nodusId);
  recomputeDeepTrigger(nodusId);
}

export function setReadTag(nodusId: string, value: boolean): void {
  getDb().prepare('UPDATE works SET read_tag = ? WHERE nodus_id = ?').run(value ? 1 : 0, nodusId);
  recomputeDeepTrigger(nodusId);
}

/** Derive deep_trigger from the two triggers, and downgrade deep_status if no longer eligible. */
export function recomputeDeepTrigger(nodusId: string): DeepTrigger {
  const db = getDb();
  const w = db.prepare('SELECT read_tag, manual_deep, deep_status FROM works WHERE nodus_id = ?').get(nodusId) as
    | { read_tag: number; manual_deep: number; deep_status: string }
    | undefined;
  if (!w) return null;
  let trigger: DeepTrigger = null;
  if (w.read_tag && w.manual_deep) trigger = 'both';
  else if (w.read_tag) trigger = 'tag';
  else if (w.manual_deep) trigger = 'manual';
  db.prepare('UPDATE works SET deep_trigger = ? WHERE nodus_id = ?').run(trigger, nodusId);
  return trigger;
}

export function setLightPending(nodusId: string): void {
  getDb().prepare("UPDATE works SET light_status = 'pending' WHERE nodus_id = ?").run(nodusId);
}

export function setDeepPending(nodusId: string): void {
  getDb().prepare("UPDATE works SET deep_status = 'pending' WHERE nodus_id = ?").run(nodusId);
}

export function setSummaryPending(nodusId: string): void {
  getDb().prepare("UPDATE works SET summary_status = 'pending' WHERE nodus_id = ?").run(nodusId);
}

export function setLightResult(nodusId: string, status: string, hash: string | null, notes?: string | null): void {
  const db = getDb();
  const previous = db.prepare('SELECT light_hash FROM works WHERE nodus_id = ?').get(nodusId) as { light_hash: string | null } | undefined;
  if (status === 'done' && previous?.light_hash !== hash) invalidateSummary(nodusId);
  db
    .prepare('UPDATE works SET light_status=?, light_at=?, light_hash=?, notes=COALESCE(?, notes) WHERE nodus_id=?')
    .run(status, new Date().toISOString(), hash, notes ?? null, nodusId);
}

export function setDeepResult(
  nodusId: string,
  status: string,
  hash: string | null,
  sourceType: string | null,
  notes?: string | null
): void {
  const db = getDb();
  const previous = db.prepare('SELECT deep_hash FROM works WHERE nodus_id = ?').get(nodusId) as { deep_hash: string | null } | undefined;
  if ((status === 'done' || status === 'skipped_no_text') && previous?.deep_hash !== hash) invalidateSummary(nodusId);
  db
    .prepare(
      'UPDATE works SET deep_status=?, deep_at=?, deep_hash=?, source_type=COALESCE(?, source_type), notes=COALESCE(?, notes) WHERE nodus_id=?'
    )
    .run(status, new Date().toISOString(), hash, sourceType ?? null, notes ?? null, nodusId);
}

export function setSummaryResult(nodusId: string, status: SummaryStatus, hash: string | null): void {
  getDb()
    .prepare('UPDATE works SET summary_status = ?, summary_at = ?, summary_hash = ? WHERE nodus_id = ?')
    .run(status, new Date().toISOString(), hash, nodusId);
}

/** Underlying light/deep material changed, so its orientation summary is no longer current. */
export function invalidateSummary(nodusId: string): void {
  getDb()
    .prepare("UPDATE works SET summary_status = 'none', summary_at = NULL, summary_hash = NULL WHERE nodus_id = ?")
    .run(nodusId);
}

export function setArchived(nodusId: string, value: boolean): void {
  getDb().prepare('UPDATE works SET archived = ? WHERE nodus_id = ?').run(value ? 1 : 0, nodusId);
}

/** Works eligible for deep scan: tag OR manual, not archived. */
export function deepEligible(): Work[] {
  return getDb()
    .prepare('SELECT * FROM works WHERE archived = 0 AND (read_tag = 1 OR manual_deep = 1)')
    .all() as Work[];
}

export function pendingLight(): Work[] {
  return getDb()
    .prepare("SELECT * FROM works WHERE archived = 0 AND light_status = 'pending'")
    .all() as Work[];
}
