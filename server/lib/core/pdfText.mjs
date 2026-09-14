import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

/**
 * CJK text support for the server-side PDF path.
 *
 * pdf-lib's built-in fonts are the WinAnsi StandardFonts, which cannot encode a single
 * Han character: drawing Chinese text with Helvetica throws. The server therefore embeds
 * a bundled Noto Sans SC (SIL OFL 1.1) subset covering the BMP CJK blocks, Latin and
 * punctuation, and subsets it again with HarfBuzz to just the glyphs a document uses so
 * the exported PDF stays small.
 *
 * pdf-lib's own `subset: true` is not usable here: it mis-maps glyph ids for large CJK
 * fonts, so the font is subset before it is handed to pdf-lib.
 */
const FONT_URL = new URL('../assets/fonts/NodusCJK-Regular.ttf', import.meta.url);

let cachedFont = null;

/** The bundled CJK font, read once. */
export function cjkFontBytes() {
  if (!cachedFont) cachedFont = readFileSync(fileURLToPath(FONT_URL));
  return cachedFont;
}

/** Whether `value` needs the CJK font (Han characters, kana, CJK punctuation or fullwidth forms). */
export function hasCjk(value) {
  return /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F]/.test(String(value ?? ''));
}

/**
 * Strip only what a PDF text run cannot carry (control characters), keeping every
 * printable script intact — unlike the WinAnsi path, which has to fold accents and
 * typographic punctuation down to ASCII.
 */
export function cjkSafe(value) {
  return String(value ?? '')
    // Unicode's Control category covers C0/C1 and DEL without spelling them in the pattern;
    // line breaks survive so callers that split on them still see the same shape.
    .replace(/[\p{Cc}]/gu, (character) => (character === '\n' ? character : ''))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Subset the bundled font to the glyphs `text` needs. Resolves to TrueType bytes. */
export async function subsetCjkFont(text) {
  return subsetFont(cjkFontBytes(), String(text ?? ''), { targetFormat: 'truetype' });
}

/**
 * Break a line into tokens, one CJK character at a time so it can wrap without spaces,
 * and whole words for every other script. Mirrors how a reader would break the line.
 */
export function cjkTokens(value) {
  const tokens = [];
  let word = '';
  const flush = () => { if (word) { tokens.push(word); word = ''; } };
  for (const char of String(value ?? '')) {
    if (/\s/.test(char)) { flush(); tokens.push(' '); continue; }
    const isolated = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F\u3001-\u3002]/.test(char);
    if (isolated) { flush(); tokens.push(char); } else word += char;
  }
  flush();
  return tokens;
}
