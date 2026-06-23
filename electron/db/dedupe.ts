// Duplicate-work detection and merge — pure logic over an injected SQLite
// connection so it can be unit-tested against a throwaway database copy without
// booting Electron.
//
// What counts as a duplicate:
//   • the SAME Zotero item in several collections does NOT duplicate — its key is
//     unique, so it is never grouped here;
//   • a duplicate is a *different* Zotero item (distinct key) for the same work,
//     identified by an identical DOI, or — when no DOI exists — by an identical
//     normalized title + year + authors. Generic/sentinel titles are excluded so
//     unrelated untitled items never group together.
import type Database from 'better-sqlite3';
import type { DuplicateWorkGroup, DuplicateWorkMember, LightStatus, DeepStatus } from '@shared/types';

const SENTINEL_TITLE = '(sin título)';

interface WorkRow {
  nodus_id: string;
  zotero_key: string | null;
  title: string | null;
  authors_json: string | null;
  year: number | null;
  doi: string | null;
  light_status: LightStatus;
  deep_status: DeepStatus;
  idea_count: number;
}

function parseAuthors(json: string | null): string[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.map((a) => String(a)) : [];
  } catch {
    return [];
  }
}

function groupKey(row: WorkRow): string | null {
  const doi = (row.doi ?? '').trim().toLowerCase();
  if (doi) return `doi:${doi}`;
  const title = (row.title ?? '').trim();
  if (!title || title === SENTINEL_TITLE) return null; // not a reliable signal
  const normTitle = title.toLowerCase().replace(/\s+/g, ' ');
  const authors = (row.authors_json ?? '').trim().toLowerCase();
  return `meta:${normTitle}|${row.year ?? ''}|${authors}`;
}

/** Higher = richer (more analysis); the richest member is suggested as canonical. */
function richness(row: WorkRow): number {
  let score = 0;
  if (row.deep_status === 'done') score += 1_000_000;
  if (row.light_status === 'done') score += 100_000;
  score += row.idea_count * 1_000;
  if (row.doi && row.doi.trim()) score += 100;
  return score;
}

export function findDuplicateWorkGroups(db: Database.Database): DuplicateWorkGroup[] {
  const rows = db
    .prepare(
      `SELECT w.nodus_id, w.zotero_key, w.title, w.authors_json, w.year, w.doi,
              w.light_status, w.deep_status,
              (SELECT COUNT(*) FROM idea_occurrences io WHERE io.nodus_id = w.nodus_id) AS idea_count
         FROM works w
        WHERE w.archived = 0`
    )
    .all() as WorkRow[];

  // Union-find over works: two works are unified when they share a content key
  // (DOI, or title+year+authors) OR when one's key is already an alias of the
  // other — the latter catches duplicates a sync resurrected after a merge.
  const parent = new Map<string, string>();
  for (const r of rows) parent.set(r.nodus_id, r.nodus_id);
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Content-key unification.
  const keyToFirst = new Map<string, string>();
  for (const row of rows) {
    const key = groupKey(row);
    if (!key) continue;
    const first = keyToFirst.get(key);
    if (first) union(row.nodus_id, first);
    else keyToFirst.set(key, row.nodus_id);
  }

  // Alias-link unification: a live work whose Zotero key points (via work_aliases)
  // to another live work is the same work resurrected by a resync.
  const aliasLinks = db
    .prepare(
      `SELECT w.nodus_id AS dup, a.nodus_id AS canon
         FROM work_aliases a
         JOIN works w ON w.zotero_key = a.zotero_key
        WHERE w.nodus_id <> a.nodus_id AND w.archived = 0`
    )
    .all() as { dup: string; canon: string }[];
  for (const link of aliasLinks) union(link.dup, link.canon);

  const byRoot = new Map<string, WorkRow[]>();
  for (const row of rows) {
    const root = find(row.nodus_id);
    const list = byRoot.get(root) ?? [];
    list.push(row);
    byRoot.set(root, list);
  }

  const normDoi = (row: WorkRow): string => (row.doi ?? '').trim().toLowerCase();

  const groups: DuplicateWorkGroup[] = [];
  for (const [root, list] of byRoot) {
    if (list.length < 2) continue;
    const best = list.reduce((a, b) => (richness(b) > richness(a) ? b : a));
    // 'doi' when at least two members share an identical DOI; else 'metadata'.
    const doiCounts = new Map<string, number>();
    for (const r of list) {
      const d = normDoi(r);
      if (d) doiCounts.set(d, (doiCounts.get(d) ?? 0) + 1);
    }
    const reason: 'doi' | 'metadata' = [...doiCounts.values()].some((c) => c >= 2) ? 'doi' : 'metadata';
    const members: DuplicateWorkMember[] = list
      .map((row) => ({
        nodus_id: row.nodus_id,
        zotero_key: row.zotero_key,
        title: row.title ?? '',
        authors: parseAuthors(row.authors_json),
        year: row.year,
        doi: row.doi,
        light_status: row.light_status,
        deep_status: row.deep_status,
        ideaCount: row.idea_count,
        suggestedCanonical: row.nodus_id === best.nodus_id,
      }))
      .sort(
        (a, b) =>
          Number(b.suggestedCanonical) - Number(a.suggestedCanonical) ||
          b.ideaCount - a.ideaCount ||
          (a.zotero_key ?? '').localeCompare(b.zotero_key ?? '') ||
          a.nodus_id.localeCompare(b.nodus_id)
      );
    groups.push({ reason, key: `g:${root}`, members });
  }

  // Most-populous groups first so the worst offenders surface at the top.
  groups.sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key));
  return groups;
}

// Child tables whose primary key includes nodus_id: re-point what doesn't collide
// with the canonical, then drop whatever remained on the duplicate.
const COMPOSITE_PK_TABLES = [
  'work_themes',
  'idea_occurrences',
  'work_authors',
  'idea_theme_links',
  'work_zotero_tags',
  'work_summaries',
  'work_aliases',
];

// Child tables keyed by their own id (nodus_id is a plain column): re-point all.
const PLAIN_REPOINT_TABLES = ['evidence', 'gaps', 'external_refs'];

function recomputeDeepTrigger(db: Database.Database, nodusId: string): void {
  const w = db.prepare('SELECT read_tag, manual_deep FROM works WHERE nodus_id = ?').get(nodusId) as
    | { read_tag: number; manual_deep: number }
    | undefined;
  if (!w) return;
  let trigger: string | null = null;
  if (w.read_tag && w.manual_deep) trigger = 'both';
  else if (w.read_tag) trigger = 'tag';
  else if (w.manual_deep) trigger = 'manual';
  db.prepare('UPDATE works SET deep_trigger = ? WHERE nodus_id = ?').run(trigger, nodusId);
}

/**
 * Merge `duplicateIds` into `canonicalId`: re-point every piece of derived data,
 * record each duplicate's Zotero key as an alias of the canonical work, then
 * delete the duplicate rows. Runs in a single transaction.
 */
export function mergeWorks(db: Database.Database, canonicalId: string, duplicateIds: string[]): number {
  const canonical = db.prepare('SELECT nodus_id FROM works WHERE nodus_id = ?').get(canonicalId) as
    | { nodus_id: string }
    | undefined;
  if (!canonical) throw new Error(`Canonical work ${canonicalId} not found`);

  const dups = Array.from(new Set(duplicateIds)).filter((id) => id && id !== canonicalId);

  const run = db.transaction(() => {
    let merged = 0;
    for (const dup of dups) {
      const dupRow = db.prepare('SELECT nodus_id, zotero_key FROM works WHERE nodus_id = ?').get(dup) as
        | { nodus_id: string; zotero_key: string | null }
        | undefined;
      if (!dupRow) continue;

      for (const table of COMPOSITE_PK_TABLES) {
        db.prepare(`UPDATE OR IGNORE ${table} SET nodus_id = ? WHERE nodus_id = ?`).run(canonicalId, dup);
        db.prepare(`DELETE FROM ${table} WHERE nodus_id = ?`).run(dup);
      }
      for (const table of PLAIN_REPOINT_TABLES) {
        db.prepare(`UPDATE ${table} SET nodus_id = ? WHERE nodus_id = ?`).run(canonicalId, dup);
      }
      // Scan checkpoints are resumption caches tied to the old id — just drop them.
      db.prepare('DELETE FROM scan_checkpoints WHERE nodus_id = ?').run(dup);

      // Preserve the duplicate's Zotero key so the work still resolves from it.
      if (dupRow.zotero_key) {
        db.prepare('INSERT OR IGNORE INTO work_aliases (nodus_id, zotero_key) VALUES (?, ?)').run(
          canonicalId,
          dupRow.zotero_key
        );
      }
      db.prepare('DELETE FROM works WHERE nodus_id = ?').run(dup);
      merged++;
    }
    if (merged > 0) recomputeDeepTrigger(db, canonicalId);
    return merged;
  });

  return run();
}
