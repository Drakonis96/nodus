/**
 * Derive the concise fallback used when a Nodi quick note has no explicit title.
 * Markdown decoration is ignored and words may span lines, but the stored title
 * never grows beyond the first three meaningful words.
 */
export function deriveNodiNoteTitle(content: string): string {
  const plain = String(content ?? '')
    .split('\n')
    .map((raw) => raw
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}[-*+>]\s+/, '')
      .replace(/[*_`~]/g, '')
      .trim())
    .filter(Boolean)
    .join(' ');
  return plain.split(/\s+/u).filter(Boolean).slice(0, 3).join(' ').slice(0, 100);
}
