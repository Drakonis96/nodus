/** Shared, deterministic cleanup for extracted prose. Keep source/page markers
 * outside this function so provenance tokens can never be rewritten. */
export function cleanInlineText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\u00ad/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/[-‐‑‒–—]{2,}/g, '-')
    // NO LEXICAL REPAIR HERE, DELIBERATELY. Three rules used to guess at OCR damage —
    // rejoining a standalone `fi`/`fl`, and gluing an isolated accented vowel to its
    // neighbours. Measured over the raw text of a real 368-page Spanish book: 21 firings,
    // every single one of them corruption and not one repair. `nació y` became `nacióy`
    // (19 times, the rule never met a genuine split), `empezó á depender` became one
    // word, and `Wi fi network` became `Wi finetwork`. An accented vowel followed by a
    // lone consonant is ordinary Spanish — `y` is a word. Only line structure (see
    // dehyphenatingJoin) is evidence of a split; a guess about a word is not.
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
