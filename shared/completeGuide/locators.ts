/**
 * Citation labels and links of a complete study guide, built from the snapshot. The
 * link carries the exact locator so the reader opens the page, slide, heading or
 * minute; the label (`A1 · p. 12`) stays readable in a PDF or Word file.
 */
import type { CompleteGuideLabels } from './labels';
import type { CompleteGuideLocator, CompleteGuidePassage, CompleteGuideSnapshotSource } from './snapshot';
import { compactRanges } from './snapshot';

export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function locatorLabel(locator: CompleteGuideLocator, labels: Pick<CompleteGuideLabels, 'page' | 'slide'>): string {
  if (locator.kind === 'page') return `${labels.page} ${locator.page}`;
  if (locator.kind === 'slide') return `${labels.slide} ${locator.slide}`;
  if (locator.kind === 'time') return formatSeconds(locator.start);
  return locator.heading ? `§ ${locator.heading.length > 40 ? `${locator.heading.slice(0, 39)}…` : locator.heading}` : '§';
}

export function citationUrl(source: Pick<CompleteGuideSnapshotSource, 'kind' | 'sourceId' | 'recordingId'>, locator: CompleteGuideLocator, evidenceId?: string): string {
  const params = new URLSearchParams();
  if (locator.kind === 'page') params.set('page', String(locator.page));
  else if (locator.kind === 'slide') params.set('slide', String(locator.slide));
  else if (locator.kind === 'time') params.set('t', String(Math.max(0, Math.floor(locator.start))));
  else params.set('from', String(locator.from));
  if (evidenceId) params.set('e', evidenceId);
  const query = params.toString();
  if (source.kind === 'material') return `nodus://study/material/${encodeURIComponent(source.sourceId)}?${query}`;
  if (source.kind === 'document') return `nodus://study/doc/${encodeURIComponent(source.sourceId)}?${query}`;
  return `nodus://study/recording/${encodeURIComponent(source.recordingId ?? source.sourceId)}?${query}`;
}

/** `[A1 · p. 12](nodus://…)` — label and link both from data. */
export function citationLink(source: CompleteGuideSnapshotSource, passage: Pick<CompleteGuidePassage, 'locator'>, labels: Pick<CompleteGuideLabels, 'page' | 'slide'>, evidenceId?: string): string {
  return `[${source.alias} · ${locatorLabel(passage.locator, labels)}](${citationUrl(source, passage.locator, evidenceId)})`;
}

/**
 * "Para ampliar": the places a chapter drew on, grouped by source as ranges —
 * `A1 (pp. 3–7, 12)`, `A2 (diap. 1–4)`, `G1 (12:00–18:30)`.
 */
export function readMoreRanges(
  sources: CompleteGuideSnapshotSource[],
  passages: Array<Pick<CompleteGuidePassage, 'sourceKey' | 'locator'>>,
  labels: Pick<CompleteGuideLabels, 'page' | 'pages' | 'slide'>,
): Array<{ source: CompleteGuideSnapshotSource; ranges: string }> {
  const bySource = new Map<string, Array<Pick<CompleteGuidePassage, 'sourceKey' | 'locator'>>>();
  for (const passage of passages) bySource.set(passage.sourceKey, [...(bySource.get(passage.sourceKey) ?? []), passage]);
  const result: Array<{ source: CompleteGuideSnapshotSource; ranges: string }> = [];
  for (const source of sources) {
    const used = bySource.get(source.sourceKey);
    if (!used?.length) continue;
    const pages = used.flatMap((passage) => (passage.locator.kind === 'page' ? [passage.locator.page] : []));
    const slides = used.flatMap((passage) => (passage.locator.kind === 'slide' ? [passage.locator.slide] : []));
    const times = used.flatMap((passage) => (passage.locator.kind === 'time' ? [passage.locator] : []));
    const headings = [...new Set(used.flatMap((passage) => (passage.locator.kind === 'offset' && passage.locator.heading ? [passage.locator.heading] : [])))];
    const parts: string[] = [];
    if (pages.length) parts.push(`${new Set(pages).size > 1 ? labels.pages : labels.page} ${compactRanges(pages)}`);
    if (slides.length) parts.push(`${labels.slide} ${compactRanges(slides)}`);
    if (times.length) {
      const start = Math.min(...times.map((time) => time.start));
      const end = Math.max(...times.map((time) => time.end));
      parts.push(`${formatSeconds(start)}–${formatSeconds(end)}`);
    }
    if (headings.length) parts.push(headings.slice(0, 4).map((heading) => `§ ${heading}`).join(', '));
    result.push({ source, ranges: parts.join('; ') });
  }
  return result;
}
