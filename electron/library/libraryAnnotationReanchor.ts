import fs from 'node:fs';
import { atomicWriteJson } from './libraryPaths';

interface ReanchorableAnnotation {
  id: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
  updatedAt: string;
  anchorStatus?: 'current' | 'orphaned';
  contentFingerprint?: string | null;
  orphanReason?: string | null;
  [key: string]: unknown;
}

export interface LibraryAnnotationReanchorResult {
  current: number;
  orphaned: number;
}

function annotations(file: string): ReanchorableAnnotation[] {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is ReanchorableAnnotation => !!entry && typeof entry === 'object'
      && typeof entry.id === 'string' && Number.isInteger(entry.startOffset) && Number.isInteger(entry.endOffset)
      && typeof entry.selectedText === 'string' && typeof entry.prefix === 'string' && typeof entry.suffix === 'string');
  } catch {
    return [];
  }
}

function occurrences(text: string, needle: string): Array<{ start: number; end: number }> {
  if (!needle) return [];
  const exact: Array<{ start: number; end: number }> = [];
  let offset = 0;
  while (offset <= text.length - needle.length) {
    const start = text.indexOf(needle, offset);
    if (start < 0) break;
    exact.push({ start, end: start + needle.length });
    offset = start + Math.max(1, needle.length);
  }
  if (exact.length) return exact;
  const expression = needle.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  if (!expression) return [];
  return [...text.matchAll(new RegExp(expression, 'gu'))].flatMap((match) => (
    typeof match.index === 'number' ? [{ start: match.index, end: match.index + match[0].length }] : []
  ));
}

function bestAnchor(annotation: ReanchorableAnnotation, oldText: string, newText: string): { start: number; end: number } | null {
  const candidates = occurrences(newText, annotation.selectedText);
  if (!candidates.length) return null;
  const expectedRatio = oldText.length ? annotation.startOffset / oldText.length : 0;
  return candidates.sort((left, right) => {
    const score = (candidate: { start: number; end: number }): number => {
      const prefix = newText.slice(Math.max(0, candidate.start - annotation.prefix.length), candidate.start);
      const suffix = newText.slice(candidate.end, candidate.end + annotation.suffix.length);
      const context = (annotation.prefix && prefix.endsWith(annotation.prefix) ? 4 : 0)
        + (annotation.suffix && suffix.startsWith(annotation.suffix) ? 4 : 0);
      const distance = Math.abs((candidate.start / Math.max(1, newText.length)) - expectedRatio);
      return context - distance;
    };
    return score(right) - score(left) || left.start - right.start;
  })[0];
}

/** Reanchor annotations without deleting their original quote or context. Failed
 * anchors remain durable and are copied to a dedicated recovery inbox. */
export function reanchorLibraryAnnotations(options: {
  annotationsFile: string;
  orphanedFile: string;
  oldText: string;
  newText: string;
  contentFingerprint: string;
  now: string;
}): LibraryAnnotationReanchorResult {
  const current = annotations(options.annotationsFile);
  let anchored = 0;
  let orphaned = 0;
  const next = current.map((annotation) => {
    const anchor = bestAnchor(annotation, options.oldText, options.newText);
    if (!anchor) {
      orphaned += 1;
      return {
        ...annotation,
        anchorStatus: 'orphaned' as const,
        orphanReason: 'The quoted text could not be located in the new clean Markdown.',
        contentFingerprint: options.contentFingerprint,
        updatedAt: options.now,
      };
    }
    anchored += 1;
    return {
      ...annotation,
      startOffset: anchor.start,
      endOffset: anchor.end,
      selectedText: options.newText.slice(anchor.start, anchor.end),
      prefix: options.newText.slice(Math.max(0, anchor.start - 64), anchor.start),
      suffix: options.newText.slice(anchor.end, anchor.end + 64),
      anchorStatus: 'current' as const,
      orphanReason: null,
      contentFingerprint: options.contentFingerprint,
      updatedAt: options.now,
    };
  });
  atomicWriteJson(options.annotationsFile, next);
  atomicWriteJson(options.orphanedFile, next.filter((annotation) => annotation.anchorStatus === 'orphaned'));
  return { current: anchored, orphaned };
}
