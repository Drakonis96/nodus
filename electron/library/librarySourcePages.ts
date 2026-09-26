import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { LibrarySourceMap } from '@shared/libraryTypes';

/** The extraction's source map, read only from inside its own folder. */
export function readDocumentarySourceMap(folder: string, relativePath = 'source-map.json'): LibrarySourceMap | null {
  try {
    const root = fs.realpathSync(folder);
    const target = fs.realpathSync(path.resolve(folder, relativePath));
    if (!target.startsWith(`${root}${path.sep}`)) return null;
    const result = JSON.parse(fs.readFileSync(target, 'utf8')) as LibrarySourceMap;
    return result.version === 1 && Array.isArray(result.blocks) && result.reader?.sha256 ? result : null;
  } catch { return null; }
}

/** The Library's clean Markdown with a `[[p. N]]` marker wherever the physical page
 * changes, taken from the source map that describes exactly these bytes. The clean
 * copy itself carries no page markers, so without this every consumer of it (deep
 * scans, and the documentary index they republish) lost the page of each passage.
 * With no map, or a map for other bytes, the Markdown is returned unchanged: a page
 * is never guessed. */
export function libraryMarkdownWithPageMarkers(markdown: string, map: LibrarySourceMap | null): string {
  if (!map || map.reader.sha256 !== createHash('sha256').update(markdown).digest('hex')) return markdown;
  let position = 0;
  let current: number | null = null;
  const parts: string[] = [];
  for (const block of [...map.blocks].sort((a, b) => a.markdown.start - b.markdown.start)) {
    const start = block.markdown.start;
    const page = block.anchors[0]?.page;
    if (!Number.isInteger(start) || start < position || start > markdown.length || !Number.isInteger(page) || page < 1 || page === current) continue;
    parts.push(markdown.slice(position, start), `${start > 0 ? '\n' : ''}[[p. ${page}]]\n`);
    position = start;
    current = page;
  }
  parts.push(markdown.slice(position));
  return parts.join('');
}
