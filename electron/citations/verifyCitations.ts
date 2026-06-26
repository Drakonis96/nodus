// Verifiable citations: resolve each inline `nodus://` citation against the local
// graph/corpus so the UI can flag any that no longer point to a real source
// (a reindex removed them, or the model invented an id). Existence-only — we
// reuse the detail getters and just check for a non-null result. Citation counts
// per answer are small, and refs are de-duplicated before lookup.
import type { CitationRef } from '@shared/types';
import { getIdeaDetail, getEdgeDetail } from '../db/ideasRepo';
import { getWork } from '../db/worksRepo';
import { getGapDetail } from '../db/gapsRepo';
import { getPassageDetail } from '../db/passagesRepo';

function exists(ref: CitationRef): boolean {
  try {
    switch (ref.kind) {
      case 'idea':
        return Boolean(getIdeaDetail(ref.id));
      case 'work':
        return Boolean(getWork(ref.id));
      case 'gap':
        return Boolean(getGapDetail(ref.id));
      case 'contradiction':
        return Boolean(getEdgeDetail(ref.id));
      case 'passage':
        return Boolean(getPassageDetail(ref.id));
      default:
        return false;
    }
  } catch {
    // A lookup failure means we can't vouch for the source → treat as unverified
    // rather than crash the whole batch.
    return false;
  }
}

/** Returns a map keyed by `${kind}:${id}` → whether the cited source resolves. */
export function verifyCitations(refs: CitationRef[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (key in out) continue;
    out[key] = exists(ref);
  }
  return out;
}
