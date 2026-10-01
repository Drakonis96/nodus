/**
 * Removes a page's scheme lines (reaction-scheme fragments, figure labels, tables) and margin
 * lines (running heads) from a passage cut from that page, using the lines the PDF layout
 * pass recorded (electron/extraction/schemeLayout.ts). The book text itself never changes;
 * only the passage built from it is cleaned, so passage ids, quotes and hashes stay valid.
 *
 * Matching ignores whitespace: extraction joins a page's lines into paragraphs and tidies
 * spacing around punctuation, so a recorded line is found by its characters, in page order,
 * and only as whole tokens. A one-token line ("CH3", "2", "+") is removed only next to another
 * removed line, so the same token in prose stays.
 */

export interface PageLayoutLines {
  scheme: string[];
  margin: string[];
}

export const SCHEME_PLACEHOLDER = '[scheme]';

interface Token { value: string; start: number; end: number }

function tokens(text: string): Token[] {
  const out: Token[] = [];
  let cursor = 0;
  for (const value of text.split(/\s+/).filter(Boolean)) {
    const start = cursor;
    cursor += value.length;
    out.push({ value, start, end: cursor });
  }
  return out;
}

const squash = (line: string) => line.replace(/\s+/g, '');

/** The passage with the page's recorded lines removed: a scheme becomes one placeholder, a
 *  margin line disappears. Returns the text unchanged when nothing matched. */
export function removeLayoutLines(passage: string, lines: PageLayoutLines): string {
  const list = tokens(passage);
  if (!list.length) return passage;
  const stream = list.map((token) => token.value).join('');
  const starts = new Set(list.map((token) => token.start));
  const ends = new Set(list.map((token) => token.end));
  const removed: Array<'scheme' | 'margin' | null> = list.map(() => null);
  const mark = (start: number, end: number, kind: 'scheme' | 'margin') => {
    list.forEach((token, index) => { if (token.start >= start && token.end <= end) removed[index] = kind; });
  };
  const find = (needle: string, from: number): number => {
    for (let at = stream.indexOf(needle, from); at >= 0; at = stream.indexOf(needle, at + 1)) {
      if (starts.has(at) && ends.has(at + needle.length)) return at;
    }
    return -1;
  };

  for (const line of lines.margin.map(squash).filter(Boolean)) {
    const at = find(line, 0);
    if (at >= 0) mark(at, at + line.length, 'margin');
  }
  // Lines of several tokens are distinctive: found in page order, a line not in this passage
  // (the passage starts mid-page) skipped without moving the cursor. A one-token line ("CH3",
  // "2", "+") could be prose, so it is removed only where it touches a removed stretch.
  const schemeLines = lines.scheme.filter((line) => line.trim());
  let cursor = 0;
  for (const line of schemeLines.filter((entry) => /\S\s+\S/.test(entry.trim())).map(squash)) {
    const at = find(line, cursor);
    if (at < 0) continue;
    mark(at, at + line.length, 'scheme');
    cursor = at + line.length;
  }
  const single = schemeLines.filter((entry) => !/\S\s+\S/.test(entry.trim())).map(squash);
  for (let grew = true; grew && single.length;) {
    grew = false;
    list.forEach((token, index) => {
      if (removed[index] || !single.includes(token.value)) return;
      if (removed[index - 1] === 'scheme' || removed[index + 1] === 'scheme') { removed[index] = 'scheme'; grew = true; }
    });
  }
  if (!removed.some(Boolean)) return passage;

  const out: string[] = [];
  list.forEach((token, index) => {
    const kind = removed[index];
    if (!kind) out.push(token.value);
    else if (kind === 'scheme' && out.at(-1) !== SCHEME_PLACEHOLDER) out.push(SCHEME_PLACEHOLDER);
  });
  return out.join(' ');
}

/** Removes each covered page's lines from a chunk. `pageStarts` (offsets into the chunk text)
 *  splits a chunk that crosses pages; otherwise the whole chunk is `pageNumber`. */
export function cleanChunkText(
  text: string,
  pageNumber: number | null,
  pageStarts: Array<{ page: number; offset: number }> | undefined,
  linesFor: (page: number) => PageLayoutLines | null,
): string {
  const segments = pageStarts?.length
    ? pageStarts.map((start, index) => ({ page: start.page, text: text.slice(start.offset, pageStarts[index + 1]?.offset ?? text.length) }))
    : [{ page: pageNumber, text }];
  if (pageStarts?.length && pageStarts[0].offset > 0) segments.unshift({ page: pageNumber, text: text.slice(0, pageStarts[0].offset) });
  let changed = false;
  const cleaned = segments.map((segment) => {
    const lines = segment.page == null ? null : linesFor(segment.page);
    if (!lines) return segment.text.trim();
    const result = removeLayoutLines(segment.text, lines);
    if (result !== segment.text) changed = true;
    return result.trim();
  });
  return changed ? cleaned.filter(Boolean).join(' ') : text;
}
