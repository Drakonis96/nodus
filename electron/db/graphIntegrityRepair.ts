import { getDb } from './database';
import { pruneOrphanThemes } from './themesRepo';

const REPAIR_FLAG = 'graph_integrity_repair_v1';

export interface GraphIntegrityRepair {
  danglingThemeLinks: number;
  danglingWorkThemes: number;
  sleptIdeas: number;
  danglingEdges: number;
  orphanTraces: number;
  prunedThemes: number;
  /** Works whose last deep analysis failed the integrity check. Listed, never requeued. */
  integrityFailedWorks: Array<{ nodus_id: string; title: string | null }>;
}

/**
 * Bring an existing vault back to the invariants the scans now keep:
 *
 * - Theme links point at themes that exist. Before 5.6.0 the orphan-theme sweep ignored
 *   idea_theme_links, so every scan could delete a theme that only idea links used. The
 *   links were left pointing at nothing, and an idea whose links all dangle drops out of
 *   every theme on the map instead of falling back to its work's themes.
 * - An idea is active only while a work holds an occurrence of it or a note owns it.
 *   Unreleased builds revived link targets and kept any idea with an edge awake. Edges
 *   into a sleeping idea are expected: `visible_edges` hides them.
 * - Edges have both endpoints and every trace has its edge. assertDeepDataIntegrity
 *   checks orphan traces across the whole vault, so one fails every later deep scan.
 *
 * Pure SQL, no model calls. Everything it removes points at rows that no longer exist.
 */
export function repairGraphIntegrity(now = new Date().toISOString()): GraphIntegrityRepair {
  const db = getDb();
  const run = db.transaction((): GraphIntegrityRepair => {
    const danglingThemeLinks = db.prepare(
      `DELETE FROM idea_theme_links
        WHERE NOT EXISTS (SELECT 1 FROM themes t WHERE t.theme_id = idea_theme_links.theme_id)`
    ).run().changes;
    const danglingWorkThemes = db.prepare(
      `DELETE FROM work_themes
        WHERE theme_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM themes t WHERE t.theme_id = work_themes.theme_id)`
    ).run().changes;
    // Same test as purgeDeepData's dormancy sweep, limited to ideas an edge touches:
    // those are the only ones the unreleased builds could have kept awake.
    const sleptIdeas = db.prepare(
      `WITH manual(ref) AS (
         SELECT json_extract(doc, '$.ref') FROM (
           SELECT CASE WHEN json_valid(source_json) THEN source_json END AS doc FROM notes
         ) WHERE json_extract(doc, '$.note') = 'manual-idea'
       )
       UPDATE ideas SET orphaned_at = ?
        WHERE orphaned_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = ideas.global_id)
          AND global_id NOT IN (SELECT ref FROM manual WHERE ref IS NOT NULL)
          AND (EXISTS (SELECT 1 FROM edges e WHERE e.from_id = ideas.global_id)
            OR EXISTS (SELECT 1 FROM edges e WHERE e.to_id = ideas.global_id))`
    ).run(now).changes;
    const danglingEdges = db.prepare(
      `DELETE FROM edges
        WHERE NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = edges.from_id)
           OR NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = edges.to_id)`
    ).run().changes;
    const orphanTraces = db.prepare(
      'DELETE FROM edge_traces WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.id = edge_traces.edge_id)'
    ).run().changes;
    const themesBefore = (db.prepare('SELECT COUNT(*) AS n FROM themes').get() as { n: number }).n;
    pruneOrphanThemes();
    const prunedThemes = themesBefore - (db.prepare('SELECT COUNT(*) AS n FROM themes').get() as { n: number }).n;
    const integrityFailedWorks = db.prepare(
      `SELECT nodus_id, title FROM works
        WHERE deep_status = 'error' AND deep_error LIKE '%integrity check failed%'
        ORDER BY title`
    ).all() as Array<{ nodus_id: string; title: string | null }>;
    return { danglingThemeLinks, danglingWorkThemes, sleptIdeas, danglingEdges, orphanTraces, prunedThemes, integrityFailedWorks };
  });
  return run();
}

/**
 * Run `repairGraphIntegrity` once per vault; later calls return null. It runs while the
 * app starts or switches vault, so a failure is logged and retried next time instead of
 * stopping either.
 */
export function repairGraphIntegrityOnce(): GraphIntegrityRepair | null {
  const db = getDb();
  const done = db.prepare('SELECT value FROM settings WHERE key = ?').get(REPAIR_FLAG) as { value: string } | undefined;
  if (done?.value === '1') return null;
  let result: GraphIntegrityRepair;
  try {
    result = db.transaction(() => {
      const repair = repairGraphIntegrity();
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(REPAIR_FLAG, '1');
      return repair;
    })();
  } catch (error) {
    console.error(`[graph] integrity repair failed, will retry on next start: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const { integrityFailedWorks, ...counts } = result;
  if (Object.values(counts).some((n) => n > 0)) {
    console.log(`[graph] integrity repair: ${Object.entries(counts).map(([key, n]) => `${key}=${n}`).join(', ')}`);
  }
  if (integrityFailedWorks.length > 0) {
    console.log(
      `[graph] ${integrityFailedWorks.length} work(s) last failed the deep-analysis integrity check; a retry reuses their checkpoints and no longer fails on links to dormant ideas: ${integrityFailedWorks.map((work) => work.title ?? work.nodus_id).join('; ')}`
    );
  }
  return result;
}
