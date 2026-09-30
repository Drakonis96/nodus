// Whole-vault integrity of the idea graph: one audit and one repair, shared by the app
// (once per vault at startup, and on demand from Settings › Data) and by
// scripts/audit-graph-integrity.mjs. Pure SQL over an injected connection, so the script
// can run it read-only against a copy without Electron.
//
// assertDeepDataIntegrity checks one work inside the transaction that rewrites it; this
// checks the vault as it sits on disk, so two of its rules differ on purpose. An edge whose
// endpoint is dormant is expected: when a rescan drops an idea, the edges other works hold
// into it stay and `visible_edges` hides them. And an idea is active exactly while a work
// holds an occurrence of it or a note owns it, whatever edges touch it.
import type Database from 'better-sqlite3';
import type {
  GraphIntegrityCategory,
  GraphIntegrityCheck,
  GraphIntegrityCheckId,
  GraphIntegrityRepairCounts,
  GraphIntegrityReport,
  GraphIntegrityWork,
} from '@shared/types';
import { MANUAL_IDEA_REFS_SQL, sleepIdeasWithoutWorks, userIdeaReferencesSql, wakeIdeasWithWorks } from './ideaDormancy';

/** Settings key holding the works whose idea theme links a repair removed. */
export const THEME_REPAIR_WORKS_KEY = 'graph_theme_repair_works';

const STUCK_JOB_MINUTES = 30;
const MAX_WORKS_PER_CHECK = 50;

const workExists = (column: string): string => `EXISTS (SELECT 1 FROM works w WHERE w.nodus_id = ${column})`;

/**
 * Every table whose rows name a work, with the values that are not works: the `manual`
 * pseudo-work of manual ideas and the empty work of manual evidence. A row naming any other
 * work that no longer exists would have been deleted with that work (see workDeletion.ts).
 * Edges are not here: an edge whose owning work is gone but whose two ideas are still held
 * by other works is a relation the reader sees, and a vault started as a copy of another
 * one carries such edges by design. They are reported (edges_of_missing_works), not deleted.
 */
const WORK_NAMING_ROWS: ReadonlyArray<{ table: string; column: string; notAWork: string }> = [
  { table: 'idea_occurrences', column: 'nodus_id', notAWork: 'nodus_id IS NULL' },
  { table: 'evidence', column: 'nodus_id', notAWork: "nodus_id IS NULL OR nodus_id = ''" },
  { table: 'idea_theme_links', column: 'nodus_id', notAWork: "nodus_id = 'manual'" },
  { table: 'work_themes', column: 'nodus_id', notAWork: 'nodus_id IS NULL' },
  { table: 'gaps', column: 'nodus_id', notAWork: 'nodus_id IS NULL' },
  { table: 'external_refs', column: 'nodus_id', notAWork: 'nodus_id IS NULL' },
];

const ofMissingWork = (table: string, column: string, notAWork: string): string =>
  `SELECT ${column} AS nodus_id FROM ${table} WHERE NOT (${notAWork}) AND NOT ${workExists(`${table}.${column}`)}`;

/** An idea a row names is gone, or asleep with no work holding it (a repair cannot wake it). */
const deadIdea = (column: string): string => `(
  NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = ${column})
  OR EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = ${column} AND i.orphaned_at IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = i.global_id))
)`;

interface CheckDefinition {
  id: GraphIntegrityCheckId;
  category: GraphIntegrityCategory;
  /** Rows of the finding, one per affected row, with the work it belongs to (NULL when none). */
  rows: (db: Database.Database) => string;
}

const CHECKS: readonly CheckDefinition[] = [
  {
    id: 'rows_of_missing_works',
    category: 'repairable',
    rows: () => WORK_NAMING_ROWS.map((ref) => ofMissingWork(ref.table, ref.column, ref.notAWork)).join(' UNION ALL '),
  },
  {
    id: 'theme_links_missing_theme',
    category: 'repairable',
    rows: () => `SELECT l.nodus_id FROM idea_theme_links l
      WHERE NOT EXISTS (SELECT 1 FROM themes t WHERE t.theme_id = l.theme_id)`,
  },
  {
    id: 'work_themes_missing_theme',
    category: 'repairable',
    rows: () => `SELECT wt.nodus_id FROM work_themes wt
      WHERE wt.theme_id IS NULL OR NOT EXISTS (SELECT 1 FROM themes t WHERE t.theme_id = wt.theme_id)`,
  },
  {
    id: 'dormant_ideas_with_works',
    category: 'repairable',
    rows: () => `SELECT MIN(io.nodus_id) AS nodus_id FROM idea_occurrences io
      JOIN ideas i ON i.global_id = io.global_id AND i.orphaned_at IS NOT NULL
      GROUP BY io.global_id`,
  },
  {
    id: 'active_ideas_without_works',
    category: 'repairable',
    rows: () => `SELECT NULL AS nodus_id FROM ideas i
      WHERE i.orphaned_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = i.global_id)
        AND i.global_id NOT IN (${MANUAL_IDEA_REFS_SQL})`,
  },
  {
    id: 'edges_missing_endpoint',
    category: 'repairable',
    rows: () => `SELECT e.source_work AS nodus_id FROM edges e
      WHERE NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = e.from_id)
         OR NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = e.to_id)`,
  },
  {
    // An idea related to itself: fusion mapped two labels of one scan onto the same idea
    // and the scan stored the relation between them. addEdge now refuses them.
    id: 'self_loop_edges',
    category: 'repairable',
    rows: () => 'SELECT e.source_work AS nodus_id FROM edges e WHERE e.from_id = e.to_id',
  },
  {
    id: 'orphan_edge_traces',
    category: 'repairable',
    rows: () => `SELECT NULL AS nodus_id FROM edge_traces et
      WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.id = et.edge_id)`,
  },
  {
    id: 'unused_themes',
    category: 'repairable',
    rows: () => `SELECT NULL AS nodus_id FROM themes t
      WHERE t.pinned = 0
        AND NOT EXISTS (SELECT 1 FROM work_themes wt WHERE wt.theme_id = t.theme_id)
        AND NOT EXISTS (SELECT 1 FROM idea_theme_links l WHERE l.theme_id = t.theme_id)`,
  },
  {
    // What only a new analysis can rebuild: a work's own rows naming an idea that no
    // longer exists, or that sleeps with no work to wake it. Rows of deleted works are
    // repaired above instead, and manual content is never stale.
    id: 'rows_missing_idea',
    category: 'rescan',
    rows: () => [
      `SELECT io.nodus_id FROM idea_occurrences io WHERE NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = io.global_id) AND ${workExists('io.nodus_id')}`,
      `SELECT ev.nodus_id FROM evidence ev WHERE ev.global_id <> '' AND ${deadIdea('ev.global_id')} AND ${workExists('ev.nodus_id')}`,
      `SELECT l.nodus_id FROM idea_theme_links l WHERE ${deadIdea('l.global_id')} AND ${workExists('l.nodus_id')}`,
      `SELECT g.nodus_id FROM gaps g WHERE g.related_idea IS NOT NULL AND ${deadIdea('g.related_idea')} AND ${workExists('g.nodus_id')}`,
      `SELECT r.nodus_id FROM external_refs r WHERE ${deadIdea('r.from_idea')} AND ${workExists('r.nodus_id')}`,
    ].join(' UNION ALL '),
  },
  {
    id: 'rows_missing_evidence',
    category: 'rescan',
    rows: () => [
      `SELECT g.nodus_id FROM gaps g WHERE g.evidence_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence ev WHERE ev.id = g.evidence_id) AND ${workExists('g.nodus_id')}`,
      `SELECT r.nodus_id FROM external_refs r WHERE r.evidence_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence ev WHERE ev.id = r.evidence_id) AND ${workExists('r.nodus_id')}`,
    ].join(' UNION ALL '),
  },
  {
    // Owned by a work this vault no longer has (deleted by older code, merged before merges
    // moved edge ownership, or living in the vault this one was copied from). Both ideas
    // still exist, so the relation stays; it is simply never replaced by a rescan.
    id: 'edges_of_missing_works',
    category: 'info',
    rows: () => `SELECT e.source_work AS nodus_id FROM edges e
      WHERE e.source_work IS NOT NULL AND e.source_work <> 'manual' AND NOT ${workExists('e.source_work')}
        AND EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = e.from_id)
        AND EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = e.to_id)`,
  },
  {
    // By design: the next scan that re-attaches the idea shows them again.
    id: 'hidden_edges',
    category: 'info',
    rows: () => `SELECT e.source_work AS nodus_id FROM edges e
      JOIN ideas src ON src.global_id = e.from_id
      JOIN ideas dst ON dst.global_id = e.to_id
      WHERE src.orphaned_at IS NOT NULL OR dst.orphaned_at IS NOT NULL`,
  },
  {
    // Before 2026-09-02 a gap in a work with no ideas stored its evidence under the idea
    // id ''. The gap still shows the quote, and the work's next rescan replaces it.
    id: 'legacy_gap_evidence',
    category: 'info',
    rows: () => "SELECT ev.nodus_id FROM evidence ev WHERE ev.global_id = ''",
  },
  {
    // User content pointing at an idea pruned before pruning spared referenced ideas.
    // Never deleted automatically: it is the user's own content.
    id: 'user_refs_missing_idea',
    category: 'info',
    rows: (db) => `SELECT NULL AS nodus_id FROM (${userIdeaReferencesSql(db)}) AS ref
      WHERE NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = ref.id)`,
  },
  {
    id: 'stuck_document_jobs',
    category: 'info',
    rows: () => `SELECT j.nodus_id FROM document_index_jobs j
      WHERE j.status = 'running' AND j.updated_at < datetime('now', '-${STUCK_JOB_MINUTES} minutes')`,
  },
];

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function titles(db: Database.Database, ids: readonly string[]): GraphIntegrityWork[] {
  if (ids.length === 0) return [];
  const byId = new Map(
    (db.prepare('SELECT nodus_id, title FROM works WHERE nodus_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as GraphIntegrityWork[])
      .map((row) => [row.nodus_id, row.title])
  );
  return ids.map((nodus_id) => ({ nodus_id, title: byId.get(nodus_id) ?? null }));
}

/** Read-only audit of the whole vault. */
export function auditGraphIntegrity(db: Database.Database, now = new Date().toISOString()): GraphIntegrityReport {
  const checks: GraphIntegrityCheck[] = [];
  const totals: Record<GraphIntegrityCategory, number> = { repairable: 0, rescan: 0, info: 0 };
  const rescanIds = new Set<string>();
  const documentJobs = hasTable(db, 'document_index_jobs');
  for (const check of CHECKS) {
    if (check.id === 'stuck_document_jobs' && !documentJobs) {
      checks.push({ id: check.id, category: check.category, count: 0, works: [] });
      continue;
    }
    const perWork = db.prepare(
      `SELECT nodus_id, COUNT(*) AS n FROM (${check.rows(db)}) GROUP BY nodus_id ORDER BY n DESC`
    ).all() as Array<{ nodus_id: string | null; n: number }>;
    const count = perWork.reduce((sum, row) => sum + row.n, 0);
    const named = perWork.filter((row): row is { nodus_id: string; n: number } => Boolean(row.nodus_id));
    const workTitles = titles(db, named.slice(0, MAX_WORKS_PER_CHECK).map((row) => row.nodus_id));
    checks.push({
      id: check.id,
      category: check.category,
      count,
      works: workTitles.map((work, index) => ({ ...work, count: named[index].n })),
    });
    totals[check.category] += count;
    if (check.category === 'rescan') for (const row of named) rescanIds.add(row.nodus_id);
  }
  return {
    checks,
    totals,
    rescanWorks: titles(db, [...rescanIds]),
    pendingThemeWorks: titles(db, pendingThemeRepairWorkIds(db)),
    checkedAt: now,
  };
}

/** Drop themes that are neither pinned nor referenced by any work or idea link. */
export function pruneOrphanThemesIn(db: Database.Database): number {
  return db.prepare(
    `DELETE FROM themes
      WHERE pinned = 0
        AND NOT EXISTS (SELECT 1 FROM work_themes wt WHERE wt.theme_id = themes.theme_id)
        AND NOT EXISTS (SELECT 1 FROM idea_theme_links l WHERE l.theme_id = themes.theme_id)`
  ).run().changes;
}

/** Works still waiting for their idea themes to be reassigned (existing works only). */
export function pendingThemeRepairWorkIds(db: Database.Database): string[] {
  const raw = (db.prepare('SELECT value FROM settings WHERE key = ?').get(THEME_REPAIR_WORKS_KEY) as { value: string } | undefined)?.value;
  let ids: unknown = [];
  try { ids = raw ? JSON.parse(raw) : []; } catch { ids = []; }
  if (!Array.isArray(ids)) return [];
  const wanted = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (wanted.length === 0) return [];
  const existing = new Set(
    (db.prepare('SELECT nodus_id FROM works WHERE nodus_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(wanted)) as Array<{ nodus_id: string }>)
      .map((row) => row.nodus_id)
  );
  return [...new Set(wanted.filter((id) => existing.has(id)))];
}

export function setPendingThemeRepairWorkIds(db: Database.Database, ids: readonly string[]): void {
  if (ids.length === 0) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(THEME_REPAIR_WORKS_KEY);
    return;
  }
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(THEME_REPAIR_WORKS_KEY, JSON.stringify([...new Set(ids)]));
}

export interface GraphIntegrityRepair {
  counts: GraphIntegrityRepairCounts;
  integrityFailedWorks: GraphIntegrityWork[];
  /** Works whose idea theme links this repair removed. */
  themeWorks: string[];
}

/**
 * Repair everything the audit files as `repairable`, in one transaction, in the order that
 * lets each step see the previous one's result. Everything it deletes points at rows that
 * no longer exist; nothing a work or the user still references is touched.
 */
export function repairGraphIntegrity(db: Database.Database, now = new Date().toISOString()): GraphIntegrityRepair {
  const run = db.transaction((): GraphIntegrityRepair => {
    // 1. Rows of works that no longer exist, as deleting those works would have removed.
    let rowsOfMissingWorks = 0;
    for (const ref of WORK_NAMING_ROWS) {
      const doomed = `NOT (${ref.notAWork}) AND NOT ${workExists(`${ref.table}.${ref.column}`)}`;
      rowsOfMissingWorks += db.prepare(`DELETE FROM ${ref.table} WHERE ${doomed}`).run().changes;
    }
    // 2. Theme references to themes that no longer exist (the sweep before 5.6.0).
    const themeWorks = (db.prepare(
      `SELECT DISTINCT l.nodus_id FROM idea_theme_links l
        WHERE NOT EXISTS (SELECT 1 FROM themes t WHERE t.theme_id = l.theme_id)
          AND l.nodus_id <> 'manual' AND ${workExists('l.nodus_id')}`
    ).all() as Array<{ nodus_id: string }>).map((row) => row.nodus_id);
    const danglingThemeLinks = db.prepare(
      'DELETE FROM idea_theme_links WHERE NOT EXISTS (SELECT 1 FROM themes t WHERE t.theme_id = idea_theme_links.theme_id)'
    ).run().changes;
    const danglingWorkThemes = db.prepare(
      'DELETE FROM work_themes WHERE theme_id IS NULL OR NOT EXISTS (SELECT 1 FROM themes t WHERE t.theme_id = work_themes.theme_id)'
    ).run().changes;
    // 3–4. An idea is active exactly while a work holds it or a note owns it.
    const wokenIdeas = wakeIdeasWithWorks(db);
    const sleptIdeas = sleepIdeasWithoutWorks(db, now);
    // 5. Edges with a missing endpoint or relating an idea to itself, then traces without an edge. One orphan trace
    //    fails every later deep analysis, since assertDeepDataIntegrity checks them all.
    const danglingEdges = db.prepare(
      `DELETE FROM edges
        WHERE NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = edges.from_id)
           OR NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = edges.to_id)`
    ).run().changes;
    const selfLoopEdges = db.prepare('DELETE FROM edges WHERE from_id = to_id').run().changes;
    const orphanTraces = db.prepare(
      'DELETE FROM edge_traces WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.id = edge_traces.edge_id)'
    ).run().changes;
    // 6. Themes nothing references any more.
    const prunedThemes = pruneOrphanThemesIn(db);

    if (themeWorks.length > 0) {
      setPendingThemeRepairWorkIds(db, [...pendingThemeRepairWorkIds(db), ...themeWorks]);
    }
    const integrityFailedWorks = db.prepare(
      `SELECT nodus_id, title FROM works
        WHERE deep_status = 'error' AND deep_error LIKE '%integrity check failed%'
        ORDER BY title`
    ).all() as GraphIntegrityWork[];
    return {
      counts: { rowsOfMissingWorks, danglingThemeLinks, danglingWorkThemes, wokenIdeas, sleptIdeas, danglingEdges, selfLoopEdges, orphanTraces, prunedThemes },
      integrityFailedWorks,
      themeWorks,
    };
  });
  return run();
}
