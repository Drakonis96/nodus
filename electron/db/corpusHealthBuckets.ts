// Single source of truth for the SQL predicate behind each work-level corpus
// health bucket. Both the health panel (corpusHealthRepo, which counts + samples
// each bucket) and the Library work list (worksRepo, which filters by bucket when
// the user clicks a health notice) build from these exact WHERE clauses, so the
// filtered list always matches the number shown in the notice.
//
// Kept dependency-free (only the shared type) so it can be imported from any repo
// without risking an import cycle.
import type { CorpusHealthBucketId } from '@shared/types';

/** Works with no usable full text: abstract-only, no source, or extraction skipped. */
const WITHOUT_TEXT_WHERE = `
  archived = 0 AND (
    deep_status = 'skipped_no_text'
    OR summary_status = 'skipped_no_text'
    OR source_type IN ('none', 'abstract_only')
  )`;

/** Light analysis done (themes) but never deep-analysed, and text is available. */
const LIGHT_ONLY_WHERE = `
  archived = 0
  AND light_status = 'done'
  AND deep_status NOT IN ('done', 'skipped_no_text')`;

/** Flagged important (read tag or manual) but still missing deep analysis. */
const DEEP_PRIORITY_WHERE = `
  archived = 0
  AND (read_tag = 1 OR manual_deep = 1)
  AND deep_status NOT IN ('done', 'skipped_no_text')`;

/** Text could not be extracted, but a recovery path exists (re-scan/OCR or a DOI to fetch). */
const PDFS_TO_RECOVER_WHERE = `
  archived = 0
  AND (
    deep_status = 'skipped_no_text'
    OR (source_type IN ('none', 'abstract_only') AND doi IS NOT NULL AND doi <> '')
  )`;

export const HEALTH_BUCKET_WHERE: Record<CorpusHealthBucketId, string> = {
  withoutText: WITHOUT_TEXT_WHERE,
  lightOnly: LIGHT_ONLY_WHERE,
  deepPriority: DEEP_PRIORITY_WHERE,
  pdfsToRecover: PDFS_TO_RECOVER_WHERE,
};
