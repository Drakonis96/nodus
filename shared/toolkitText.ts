// Nodus Toolkit — pure text utilities (category E, the string parts). No Node or
// Electron imports, so this is unit-tested directly and could run anywhere. The
// file-level operations that touch bytes (checksums) live in the main-side
// textOps.ts; everything here is deterministic string → string.

/**
 * E1 — clean text pasted out of a PDF. PDFs wrap lines mid-sentence, hyphenate
 * across line breaks, and scatter double spaces. This rejoins wrapped lines,
 * de-hyphenates split words, preserves paragraph breaks (blank lines) and
 * collapses runs of spaces — turning a ragged paste into flowing prose.
 */
export function cleanPastedPdfText(input: string): string {
  const normalized = input.replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ');
  const paragraphs = normalized.split(/\n[ \t]*\n+/);
  const cleaned = paragraphs.map((para) => {
    // De-hyphenate a word split across a line break: "exam-\nple" → "example".
    const dehyphenated = para.replace(/([A-Za-zÀ-ÿ])-\n([a-zà-ÿ])/g, '$1$2');
    // Join the remaining intra-paragraph line breaks into spaces.
    return dehyphenated
      .replace(/\n+/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([,.;:!?])/g, '$1')
      .trim();
  });
  return cleaned.filter((p) => p.length > 0).join('\n\n') + '\n';
}

// Spanish minor words that Title Case leaves lowercase unless they lead the title.
const ES_MINOR_WORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'a', 'ante', 'con', 'en',
  'para', 'por', 'que', 'se', 'su', 'sus', 'un', 'una', 'unos', 'unas', 'al', 'lo',
]);

function capitalizeFirst(word: string): string {
  const match = word.match(/^([^A-Za-zÀ-ÿ]*)([A-Za-zÀ-ÿ])(.*)$/);
  if (!match) return word;
  return match[1] + match[2].toUpperCase() + match[3];
}

/** E2 — recase text: Sentence case / Title Case / UPPER / lower (Spanish rules). */
export function changeCase(input: string, mode: 'sentence' | 'title' | 'upper' | 'lower'): string {
  if (mode === 'upper') return input.toUpperCase();
  if (mode === 'lower') return input.toLowerCase();
  if (mode === 'title') {
    const words = input.toLowerCase().split(/(\s+)/);
    let wordIndex = 0;
    return words
      .map((token) => {
        if (/^\s+$/.test(token) || token === '') return token;
        const isMinor = ES_MINOR_WORDS.has(token.replace(/[^A-Za-zÀ-ÿ]/g, ''));
        const result = wordIndex > 0 && isMinor ? token : capitalizeFirst(token);
        wordIndex++;
        return result;
      })
      .join('');
  }
  // Sentence case: lowercase, then capitalize the first letter of each sentence.
  const lowered = input.toLowerCase();
  return lowered.replace(/(^|[.!?¡¿]\s+|\n\s*)([a-zà-ÿ])/g, (_m, lead, ch) => lead + ch.toUpperCase());
}

/**
 * E3 — SRT / VTT subtitles to clean text: strip the WEBVTT header, NOTE blocks,
 * numeric cue indices and timestamp lines, and join each cue's lines into one
 * line. The result is one line per cue, in order.
 */
export function subtitlesToText(input: string): string {
  const normalized = input.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const blocks = normalized.split(/\n[ \t]*\n+/);
  const lines: string[] = [];
  for (const rawBlock of blocks) {
    const blockLines = rawBlock.split('\n');
    const textLines: string[] = [];
    for (const line of blockLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^WEBVTT/i.test(trimmed)) continue;
      if (/^NOTE\b/.test(trimmed)) break; // skip a NOTE block entirely
      if (/-->/.test(trimmed)) continue; // timestamp line
      if (/^\d+$/.test(trimmed)) continue; // numeric cue index
      // Drop inline tags like <i> and cue positioning.
      textLines.push(trimmed.replace(/<[^>]+>/g, ''));
    }
    const joined = textLines.join(' ').replace(/[ \t]{2,}/g, ' ').trim();
    if (joined) lines.push(joined);
  }
  return lines.join('\n') + '\n';
}
