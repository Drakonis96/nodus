// Verifiable citations: resolve each inline `nodus://` citation against the local
// graph/corpus so the UI can flag any that no longer point to a real source
// (a reindex removed them, or the model invented an id). Existence-only — we
// reuse the detail getters and just check for a non-null result. Citation counts
// per answer are small, and refs are de-duplicated before lookup.
import type { CitationPreview, CitationRef } from '@shared/types';
import { getIdeaDetail, getEdgeDetail } from '../db/ideasRepo';
import { getWork } from '../db/worksRepo';
import { getGapDetail } from '../db/gapsRepo';
import { getPassageDetail } from '../db/passagesRepo';
import { buildCitationPreview } from './citationPreview';

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

/**
 * Resolve a single citation into the compact preview shown in its hover-card
 * (title + subtitle + snippet). Reuses the same detail getters as verification;
 * returns null when the source no longer resolves. All strings come from the
 * corpus (Spanish); the renderer prepends the localized kind label.
 */
export function previewCitation(ref: CitationRef): CitationPreview | null {
  try {
    switch (ref.kind) {
      case 'idea': {
        const detail = getIdeaDetail(ref.id);
        if (!detail) return null;
        return buildCitationPreview('idea', { title: detail.idea.label, snippet: detail.idea.statement });
      }
      case 'work': {
        const work = getWork(ref.id);
        if (!work) return null;
        const authors = work.authors.slice(0, 3).join('; ');
        const subtitle = [authors, work.year ? String(work.year) : ''].filter(Boolean).join(' · ');
        return buildCitationPreview('work', { title: work.title, subtitle });
      }
      case 'gap': {
        const detail = getGapDetail(ref.id);
        if (!detail) return null;
        const authors = detail.work.authors.slice(0, 2).join('; ');
        const subtitle = [authors, detail.work.year ? String(detail.work.year) : ''].filter(Boolean).join(' · ');
        return buildCitationPreview('gap', { title: detail.work.title, subtitle, snippet: detail.gap.statement });
      }
      case 'contradiction': {
        const detail = getEdgeDetail(ref.id);
        if (!detail) return null;
        return buildCitationPreview('contradiction', {
          title: `${detail.fromLabel} × ${detail.toLabel}`,
          snippet: detail.explanation,
        });
      }
      case 'passage': {
        const detail = getPassageDetail(ref.id);
        if (!detail) return null;
        const subtitle = [detail.work.authors.slice(0, 2).join('; '), detail.page_label ?? '']
          .filter(Boolean)
          .join(' · ');
        return buildCitationPreview('passage', { title: detail.work.title, subtitle, snippet: detail.text });
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
