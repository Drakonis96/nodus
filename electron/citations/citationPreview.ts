// Pure formatting for citation hover-cards. Kept free of DB/Electron imports so
// it can be unit-tested in isolation (see scripts/test-citation-preview.mjs);
// the DB-backed lookups that feed it live in ./verifyCitations.
import type { CitationKind, CitationPreview } from '@shared/types';

export const CITATION_PREVIEW_TITLE_MAX = 140;
export const CITATION_PREVIEW_SUBTITLE_MAX = 120;
export const CITATION_PREVIEW_SNIPPET_MAX = 240;

/** Collapse runs of whitespace and cap length with an ellipsis so cards stay compact. */
export function truncate(text: string | null | undefined, max: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Normalize raw corpus fields into a compact preview: trims/truncates every
 * field and drops empty subtitle/snippet so the card never renders blank rows.
 * The title always survives (falls back to an em dash) so a card is never empty.
 */
export function buildCitationPreview(
  kind: CitationKind,
  fields: { title: string | null | undefined; subtitle?: string | null; snippet?: string | null }
): CitationPreview {
  const preview: CitationPreview = { kind, title: truncate(fields.title, CITATION_PREVIEW_TITLE_MAX) || '—' };
  const subtitle = truncate(fields.subtitle, CITATION_PREVIEW_SUBTITLE_MAX);
  if (subtitle) preview.subtitle = subtitle;
  const snippet = truncate(fields.snippet, CITATION_PREVIEW_SNIPPET_MAX);
  if (snippet) preview.snippet = snippet;
  return preview;
}
