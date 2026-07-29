// SQL predicates for the library's status presets.
//
// These MUST agree with `deriveWorkStatus` in src/libraryStatus.ts: the row shows
// a pill and the preset filters by the same word, so a reader who clicks
// "Incompleto" must get exactly the rows whose pill says "Incompleto".
//
// Two deliberate divergences, both forced:
//   * 'running' has no predicate. It lives only in the in-memory scan queue, so
//     a queued work matches whichever preset its persisted columns describe.
//   * the semantic-index step is not consulted. Whether an idea's embedding is
//     current depends on a text hash computed in JS (embeddingPipeline), which
//     SQL cannot evaluate — which is why it does not gate "ready" there either.
import type { WorkReadiness } from '@shared/types';
import { currentEmbeddingConfig } from './ideasRepo';

type Readiness = Exclude<WorkReadiness, 'running'>;

/** Any of the three AI passes reported a failure. Outranks everything below. */
const FAILED = `(w.light_status = 'failed' OR w.deep_status = 'failed' OR w.summary_status = 'failed')`;

/** Nothing has been attempted yet. */
const UNSTARTED = `(w.light_status = 'none' AND w.deep_status = 'none')`;

/** The deep pass finished, but it only ever saw the abstract. */
const ABSTRACT_ONLY = `(w.deep_status = 'done' AND w.source_type IN ('abstract_only', 'none'))`;

/** Extraction was attempted and there was nothing usable to read. */
const NO_TEXT = `(
  w.deep_status = 'skipped_no_text'
  OR w.summary_status = 'skipped_no_text'
  OR w.source_type IN ('none', 'abstract_only')
)`;

const HAS_IDEAS = `EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.nodus_id = w.nodus_id)`;

/**
 * Every passage of the work is embedded with the CURRENT provider/model and
 * still matches the text it was cut from. Mirrors passagesRepo's 'complete'.
 *
 * Phrased as "has passages, and none of them is stale" rather than the
 * SUM(...) = COUNT(*) form used elsewhere in this repo: a bare HAVING with no
 * GROUP BY is rejected by SQLite as a non-aggregate query.
 */
const PASSAGE_IS_CURRENT = `(
  p.embedding IS NOT NULL
  AND p.embedding_provider = @readyProv
  AND p.embedding_model    = @readyModel
  AND p.embedding_dim > 0
  AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)
)`;

const PASSAGES_COMPLETE = `(
  EXISTS (SELECT 1 FROM passages p WHERE p.nodus_id = w.nodus_id)
  AND NOT EXISTS (
    SELECT 1 FROM passages p
     WHERE p.nodus_id = w.nodus_id
       AND NOT ${PASSAGE_IS_CURRENT}
  )
)`;

/** Everything the JS precedence chain rules out before it considers ready/incomplete. */
const ANALYSABLE = `NOT ${FAILED} AND NOT ${UNSTARTED} AND NOT ${ABSTRACT_ONLY} AND NOT ${NO_TEXT}`;

/** Ready = themes + ideas + citable text, matching READY_STEPS. */
const READY_CORE = `w.light_status = 'done' AND w.deep_status = 'done' AND ${HAS_IDEAS} AND ${PASSAGES_COMPLETE}`;

/**
 * The WHERE fragment for a readiness preset, plus the bound parameters it needs.
 * Returns null for values with no SQL expression.
 */
export function readinessWhere(readiness: Readiness): { sql: string; params: Record<string, string> } | null {
  const needsPassages = readiness === 'ready' || readiness === 'incomplete';
  const params: Record<string, string> = {};
  if (needsPassages) {
    const config = currentEmbeddingConfig();
    params.readyProv = config.provider;
    params.readyModel = config.model;
  }

  switch (readiness) {
    case 'failed':
      return { sql: FAILED, params };
    case 'unstarted':
      return { sql: `NOT ${FAILED} AND ${UNSTARTED}`, params };
    case 'abstractOnly':
      return { sql: `NOT ${FAILED} AND NOT ${UNSTARTED} AND ${ABSTRACT_ONLY}`, params };
    case 'noText':
      return { sql: `NOT ${FAILED} AND NOT ${UNSTARTED} AND NOT ${ABSTRACT_ONLY} AND ${NO_TEXT}`, params };
    case 'ready':
      return { sql: `${ANALYSABLE} AND ${READY_CORE}`, params };
    case 'incomplete':
      return { sql: `${ANALYSABLE} AND NOT (${READY_CORE})`, params };
    default:
      return null;
  }
}
