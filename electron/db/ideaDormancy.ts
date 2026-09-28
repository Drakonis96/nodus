// The one rule for when an idea is awake: while some work holds an occurrence of it, or a
// note owns it as a manual idea. Every writer that adds or removes occurrences goes
// through these helpers — the rescan purge, work deletion, idea and work merges, the
// analysis import between vaults, the long-dormancy prune and the graph repair — so the
// rule cannot drift between them. Pure SQL over an injected connection: the vault import
// works on a handle of its own, and the audit script runs outside the app.
import type Database from 'better-sqlite3';

/**
 * Ideas a note owns as a manual idea. `json_valid` first, because one malformed
 * `source_json` would otherwise make `json_extract` throw and abort every purge; and
 * `ref IS NOT NULL`, because a single NULL in a `NOT IN` list makes the test NULL for
 * every idea, which silently stopped every idea from ever going dormant.
 */
export const MANUAL_IDEA_REFS_SQL = `SELECT json_extract(doc, '$.ref') FROM (
    SELECT CASE WHEN json_valid(source_json) THEN source_json END AS doc FROM notes
  ) WHERE json_extract(doc, '$.note') = 'manual-idea' AND json_extract(doc, '$.ref') IS NOT NULL`;

/** A column of user-authored content that can point at an idea. */
export interface UserIdeaReference {
  table: string;
  column: string;
  /** Extra condition that selects the rows whose column holds an idea id. */
  where?: string;
}

/**
 * User-authored content that points at ideas by id. A dormant idea one of these still
 * points at is never pruned: the reference keeps resolving to the same idea, which is
 * the reason dormancy exists. `scripts/test-idea-dormancy.mjs` checks this inventory
 * against the live schema, so a new table that can name an idea has to be classified.
 */
export const USER_IDEA_REFERENCES: readonly UserIdeaReference[] = [
  { table: 'project_chapter_idea_relations', column: 'target_id', where: "target_kind = 'idea'" },
  { table: 'project_links', column: 'ref_id', where: "kind = 'idea'" },
  { table: 'project_insertion_suggestions', column: 'ref_id', where: "kind = 'idea'" },
  { table: 'research_coverage_links', column: 'ref_id', where: "kind = 'idea'" },
  { table: 'db_relations', column: 'target_id', where: "target_kind = 'idea' AND target_vault_id IS NULL" },
  { table: 'study_progress', column: 'target_id', where: "target_kind = 'idea'" },
  { table: 'note_links', column: 'target_id', where: "target_kind = 'idea'" },
  { table: 'edge_feedback', column: 'from_id' },
  { table: 'edge_feedback', column: 'to_id' },
];

/** `SELECT` of every idea id user content points at (tables missing from this schema are skipped). */
export function userIdeaReferencesSql(db: Database.Database): string {
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
  );
  const parts = USER_IDEA_REFERENCES
    .filter((ref) => tables.has(ref.table))
    .map((ref) => `SELECT ${ref.column} AS id FROM ${ref.table} WHERE ${ref.column} IS NOT NULL${ref.where ? ` AND ${ref.where}` : ''}`);
  return parts.length ? parts.join(' UNION ') : 'SELECT NULL AS id WHERE 0';
}

/** Put to sleep every active idea no work holds and no note owns. Returns how many. */
export function sleepIdeasWithoutWorks(db: Database.Database, now: string): number {
  return db.prepare(
    `UPDATE ideas SET orphaned_at = ?
      WHERE orphaned_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = ideas.global_id)
        AND global_id NOT IN (${MANUAL_IDEA_REFS_SQL})`
  ).run(now).changes;
}

/** Wake every dormant idea a work holds; with `ideaIds`, only those. Returns how many. */
export function wakeIdeasWithWorks(db: Database.Database, ideaIds?: readonly string[]): number {
  if (ideaIds && ideaIds.length === 0) return 0;
  const scope = ideaIds ? 'AND global_id IN (SELECT value FROM json_each(?))' : '';
  const statement = db.prepare(
    `UPDATE ideas SET orphaned_at = NULL
      WHERE orphaned_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = ideas.global_id)
        ${scope}`
  );
  return (ideaIds ? statement.run(JSON.stringify(ideaIds)) : statement.run()).changes;
}
