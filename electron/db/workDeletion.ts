// Deleting a work is a multi-table operation, and the tables it has to reach are not
// the obvious ones.
//
// SQLite cascades only the tables that declare a FOREIGN KEY to `works` (passages,
// work_summaries, the document-profile family, …). The derived graph is deliberately
// NOT cascaded, because `ideas` rows are global: the same idea can occur in several
// works, carries the shared embedding, and must survive any single work's removal. So
// the graph is cleaned by hand, under one rule:
//
//   Delete what names this work; never delete what several works share.
//
// That rule is why `purgeDeepData` is reused instead of re-implemented: it removes the
// occurrences, evidence, edges and theme links that name the work and then marks the
// ideas left without any occurrence as dormant (`orphaned_at`) rather than deleting
// them. A dormant idea keeps its global_id and its embedding, so a rescan of another
// work re-attaches the same row, and an idea shared with a surviving work is not even
// dormant — it still has that work's occurrence.
//
// The inventory below is data rather than inline SQL so `scripts/test-work-deletion`
// can prove, against the live schema, that every column which can hold a work id is
// either cascaded by its own foreign key, deleted here, or listed with a reason in
// WORK_REFERENCE_EXCEPTIONS. Adding a table that names works without deciding which of
// those it is fails that test.
import { getDb } from './database';
import { purgeDeepData } from './ideasRepo';

/** One statement that removes a work's own rows from a table SQLite does not cascade. */
interface WorkScopedDelete {
  /** Table the statement deletes from. */
  table: string;
  /** The column that carries the work id, for the schema-coverage test. */
  column: string;
  sql: string;
  /** Bind order differs per statement, so each one spells out how it binds. */
  args: (workId: string, vaultId: string | null) => unknown[];
}

/**
 * Every work-naming column without a cascading foreign key, and the exact predicate
 * that reaches only that work's rows.
 *
 * The predicates are deliberately narrow. `target_vault_id IS NULL` (or the current
 * vault) appears wherever a polymorphic row may point at a work in ANOTHER vault:
 * those rows belong to that other vault and are not ours to delete.
 */
export const WORK_SCOPED_DELETES: readonly WorkScopedDelete[] = [
  { table: 'work_themes', column: 'nodus_id', sql: 'DELETE FROM work_themes WHERE nodus_id = ?', args: (id) => [id] },
  { table: 'work_aliases', column: 'nodus_id', sql: 'DELETE FROM work_aliases WHERE nodus_id = ?', args: (id) => [id] },
  { table: 'work_text_sources', column: 'nodus_id', sql: 'DELETE FROM work_text_sources WHERE nodus_id = ?', args: (id) => [id] },
  { table: 'scan_checkpoints', column: 'nodus_id', sql: 'DELETE FROM scan_checkpoints WHERE nodus_id = ?', args: (id) => [id] },
  {
    table: 'library_analysis_freshness', column: 'work_id',
    sql: 'DELETE FROM library_analysis_freshness WHERE work_id = ?', args: (id) => [id],
  },
  {
    // Rows OWNED by this work. Rows where it is only `source_work_id` belong to the
    // work that imported the analysis and are that work's provenance, not ours.
    table: 'library_analysis_provenance', column: 'work_id',
    sql: 'DELETE FROM library_analysis_provenance WHERE work_id = ?', args: (id) => [id],
  },
  {
    // `scope='vault'` is what makes `library_item_id` a work id; the same string under
    // `scope='global'` names a Global Library item and must not be touched.
    table: 'workspace_library_links', column: 'library_item_id',
    sql: "DELETE FROM workspace_library_links WHERE scope = 'vault' AND library_item_id = ?", args: (id) => [id],
  },
  {
    // `work_id` is the work an entry's evidence came from; `works_json` is a display
    // list, so a row that also lists other works still goes with its own work.
    table: 'dictionary_evidence', column: 'work_id',
    sql: 'DELETE FROM dictionary_evidence WHERE work_id = ?', args: (id) => [id],
  },
  {
    table: 'db_relations', column: 'target_id',
    sql: "DELETE FROM db_relations WHERE target_kind = 'work' AND target_id = ? AND target_vault_id IS NULL",
    args: (id) => [id],
  },
  {
    table: 'project_links', column: 'ref_id',
    sql: "DELETE FROM project_links WHERE kind = 'work' AND ref_id = ?", args: (id) => [id],
  },
  {
    table: 'project_chapter_idea_relations', column: 'target_id',
    sql: "DELETE FROM project_chapter_idea_relations WHERE target_kind = 'work' AND target_id = ?", args: (id) => [id],
  },
  {
    table: 'project_insertion_suggestions', column: 'ref_id',
    sql: "DELETE FROM project_insertion_suggestions WHERE kind = 'work' AND ref_id = ?", args: (id) => [id],
  },
  {
    table: 'research_coverage_links', column: 'ref_id',
    sql: "DELETE FROM research_coverage_links WHERE kind = 'work' AND ref_id = ?", args: (id) => [id],
  },
  {
    table: 'study_progress', column: 'target_id',
    sql: "DELETE FROM study_progress WHERE target_kind = 'work' AND target_id = ?", args: (id) => [id],
  },
  {
    // `source_kind='work'` is what makes `nodus_id` a work; with 'archive' it is an
    // archive item id, which the archive branch of the app cleans up on its own.
    table: 'record_evidence', column: 'nodus_id',
    sql: "DELETE FROM record_evidence WHERE source_kind = 'work' AND nodus_id = ?", args: (id) => [id],
  },
  {
    table: 'kinship_suggestion_evidence', column: 'nodus_id',
    sql: "DELETE FROM kinship_suggestion_evidence WHERE source_kind = 'work' AND nodus_id = ?", args: (id) => [id],
  },
  {
    // Defensive: nothing writes 'work' targets here yet, but an imported row could.
    table: 'note_links', column: 'target_id',
    sql: "DELETE FROM note_links WHERE target_kind = 'work' AND target_id = ? AND target_vault_id IS NULL",
    args: (id) => [id],
  },
  {
    table: 'prosop_sources', column: 'target_id',
    sql: "DELETE FROM prosop_sources WHERE target_kind = 'work' AND target_id = ? AND (target_vault_id IS NULL OR target_vault_id = ?)",
    args: (id, vaultId) => [id, vaultId],
  },
  // FTS mirrors. `passages_fts` keeps itself in step through a delete trigger, but the
  // two document tables have no trigger at all, and a virtual table has no foreign key
  // to cascade from — leaving them behind would keep deleted works in document search.
  { table: 'document_profiles_fts', column: 'nodus_id', sql: 'DELETE FROM document_profiles_fts WHERE nodus_id = ?', args: (id) => [id] },
  { table: 'document_sections_fts', column: 'nodus_id', sql: 'DELETE FROM document_sections_fts WHERE nodus_id = ?', args: (id) => [id] },
  { table: 'passages_fts', column: 'nodus_id', sql: 'DELETE FROM passages_fts WHERE nodus_id = ?', args: (id) => [id] },
];

/**
 * Columns cleaned by `ideasRepo.purgeDeepData`, which every deleted work runs through.
 * The SQL stays with the graph it maintains (it also prunes edges left dangling when an
 * idea goes dormant); this list exists so the schema-coverage test sees the whole
 * inventory in one place instead of having to read through another module.
 */
export const GRAPH_PURGED_COLUMNS: readonly { table: string; column: string }[] = [
  { table: 'idea_occurrences', column: 'nodus_id' },
  { table: 'evidence', column: 'nodus_id' },
  { table: 'edges', column: 'source_work' },
  { table: 'idea_theme_links', column: 'nodus_id' },
  { table: 'gaps', column: 'nodus_id' },
  { table: 'external_refs', column: 'nodus_id' },
  { table: 'work_authors', column: 'nodus_id' },
];

/**
 * Work-naming columns this deletion deliberately leaves alone, and why. Kept next to
 * the statements above so the two lists are read together, and asserted by the
 * schema-coverage test so a new one cannot be added silently.
 *
 * Most entries are polymorphic columns whose id is only a work id for one particular
 * kind: the same column holds a note, person, idea, passage or archive item id.
 */
export const WORK_REFERENCE_EXCEPTIONS: readonly { table: string; column: string; why: string }[] = [
  // Ids that name something other than a work.
  { table: 'dictionary_evidence', column: 'ref_id', why: "Names an idea (global_id) or a passage id; the work is the table's work_id column." },
  { table: 'document_idea_links', column: 'target_id', why: 'Names a document profile field or section, not a work.' },
  { table: 'document_profile_support', column: 'target_id', why: 'Names a document profile field or section, not a work.' },
  { table: 'library_analysis_provenance', column: 'library_item_id', why: 'Names a Global Library item, in the Global Library database.' },
  { table: 'note_links', column: 'nodus_id', why: 'Is the NOTE id in this table; a work only ever appears as target_id.' },
  { table: 'prosop_proposals', column: 'target_id', why: 'Names a prosopography entity; nothing writes a work target here.' },
  { table: 'record_evidence', column: 'target_id', why: 'Names the person, place or event the evidence supports; a work is only ever the source (nodus_id).' },
  { table: 'social_relations', column: 'target_id', why: 'Names a contact or a person.' },
  { table: 'study_style_associations', column: 'target_id', why: 'Names a subject or a document kind.' },
  { table: 'testimony_note_links', column: 'target_id', why: 'Names a testimony interview, annotation, participant or code.' },
  {
    table: 'dictionary_corpus_changes', column: 'work_id',
    why: 'Append-only change log consumed by sequence number: it records that a change happened, including the deletes this operation performs. Nothing filters or joins it by work.',
  },
  {
    table: 'dictionary_corpus_changes', column: 'ref_id',
    why: 'Same log; for entity_kind="work" rows ref_id is the work id the change was about.',
  },
  {
    table: 'library_analysis_provenance', column: 'source_work_id',
    why: 'Names the work an analysis was imported FROM. Those rows are owned (work_id) by the importing work; deleting them would rewrite another work\'s provenance.',
  },
  {
    table: 'dictionary_evidence', column: 'works_json',
    why: 'A display list of the works an entry draws on. The row goes with its own work_id; the list of a surviving work\'s row is never rewritten.',
  },
];

export interface WorkDeletionResult {
  /** Work ids whose row (and derived data) was removed. */
  deleted: string[];
  /** Ids that had no row in this vault, so there was nothing to remove. */
  missing: string[];
  /**
   * Global ideas this deletion left without any occurrence. They are kept and marked
   * dormant (never deleted here) so their global_id and embedding survive for a rescan.
   */
  dormantIdeas: number;
}

/**
 * Delete works from the vault that is currently open.
 *
 * One transaction for the whole batch: a failure anywhere leaves every work intact
 * rather than half-removing a corpus. Works that do not exist are reported as
 * `missing` instead of failing the batch, so a stale selection still deletes the rest.
 *
 * Callers must make sure no scan for these works is running: a deep analysis publishes
 * idea occurrences and evidence after its provider call returns, and those tables have
 * no foreign key to `works`, so a publication racing this delete would re-create rows
 * for a work that no longer exists. See `worksRunningNow`.
 */
export function deleteWorks(nodusIds: readonly string[], options: { vaultId?: string | null } = {}): WorkDeletionResult {
  const db = getDb();
  const vaultId = options.vaultId ?? null;
  const ids = [...new Set(nodusIds.filter((id) => typeof id === 'string' && id.length > 0))];
  const deleted: string[] = [];
  const missing: string[] = [];
  if (ids.length === 0) return { deleted, missing, dormantIdeas: 0 };

  // Ideas left dormant anywhere in the corpus, before and after: the difference is
  // exactly what this deletion made dormant, without guessing from occurrences.
  const countDormant = (): number => Number((db.prepare(
    `SELECT COUNT(*) AS n FROM ideas i
      WHERE i.orphaned_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = i.global_id)`
  ).get() as { n: number }).n);

  const run = db.transaction(() => {
    const dormantBefore = countDormant();
    const exists = db.prepare('SELECT 1 AS found FROM works WHERE nodus_id = ?');
    const removeWork = db.prepare('DELETE FROM works WHERE nodus_id = ?');
    for (const id of ids) {
      if (!exists.get(id)) {
        missing.push(id);
        continue;
      }
      // The derived graph first: occurrences, evidence, edges, theme links, gaps,
      // external refs, authors, synthesis — plus the dormancy marking of the ideas
      // left without a work. Then the per-work stragglers, and finally the row itself,
      // whose cascades take passages, summaries, collections, tags and the document
      // profile family with it.
      purgeDeepData(id);
      for (const statement of WORK_SCOPED_DELETES) {
        db.prepare(statement.sql).run(...statement.args(id, vaultId));
      }
      removeWork.run(id);
      deleted.push(id);
    }
    return countDormant() - dormantBefore;
  });

  const dormantIdeas = run();
  return { deleted, missing, dormantIdeas };
}

/**
 * Which of these works the scan queue is analysing right now.
 *
 * A running job blocks deletion because its analysis is published after the provider
 * call returns — writing idea occurrences and evidence, which carry no foreign key to
 * `works` — so it could resurrect rows for a work that was just deleted. Pending jobs
 * do not block: `removeItem` drops them before the delete runs.
 */
export function worksRunningNow(
  nodusIds: readonly string[],
  items: readonly { nodus_id: string; state: string }[]
): string[] {
  const wanted = new Set(nodusIds);
  const running = new Set<string>();
  for (const item of items) {
    if (item.state === 'running' && wanted.has(item.nodus_id)) running.add(item.nodus_id);
  }
  return [...running];
}
