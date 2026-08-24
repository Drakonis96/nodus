/** Shared, deterministic cleanup for extracted prose. Keep source/page markers
 * outside this function so provenance tokens can never be rewritten. */
export function cleanInlineText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\u00ad/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/[-‐‑‒–—]{2,}/g, '-')
    .replace(/\b(fi|fl)\s+(?=\p{Ll}{2,})/gu, '$1')
    .replace(/(\p{L}+)\s+([áéíóúü])\s+(\p{L}+)/giu, (_whole, left: string, vowel: string, right: string) => `${left}${vowel}${right.length > 1 ? right : ` ${right}`}`)
    .replace(/(\p{L}{2,}[áéíóúü])\s+([bcdfghjklmnñpqrstvwxyz])(?=\s|[,.;:!?)]|$)/giu, '$1$2')
    .replace(/\s+([,.;:!?%)\]}»”])/g, '$1')
    .replace(/([¿¡([{«“])\s+/g, '$1')
    .trim();
}

export function dehyphenatingJoin(left: string, right: string): string {
  const first = left.trimEnd();
  const second = right.trimStart();
  if (!first) return cleanInlineText(second);
  if (!second) return cleanInlineText(first);
  if (/\d-$/u.test(first) && /^\d/u.test(second)) return cleanInlineText(`${first}${second}`);
  if (/\p{L}{2,}-$/u.test(first) && /^\p{Ll}/u.test(second)) return cleanInlineText(`${first.slice(0, -1)}${second}`);
  return cleanInlineText(`${first} ${second}`);
}

export function cleanExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.split('\n').reduce(dehyphenatingJoin, ''))
    .map(cleanInlineText)
    .filter(Boolean)
    .join('\n\n');
}
