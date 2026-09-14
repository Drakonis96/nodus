import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

/**
 * CJK text support for the main process's PDF stamping.
 *
 * pdf-lib's built-in fonts are the WinAnsi StandardFonts, which cannot encode a single Han
 * character. The desktop report body is rendered by Chromium, so it is unaffected — but the
 * text pdf-lib draws on top of that result (the report's kind label, watermarks, OCR text
 * layers, study annotations) can be Chinese, and drawing it with Helvetica either throws or
 * strips it to nothing. This embeds a bundled Noto Sans SC (SIL OFL 1.1) subset covering the
 * BMP CJK blocks, Latin and punctuation, shrunk further with HarfBuzz to the glyphs the
 * document actually uses.
 *
 * pdf-lib's own `subset: true` is not usable for this font: it mis-maps glyph ids on large
 * CJK fonts, so the font is subset before pdf-lib sees it.
 */
const FONT_FILE = 'NodusCJK-Regular.ttf';

/**
 * Where the bundled font can live, packaged first.
 *
 * `process.resourcesPath` is the packaged app's resource directory (where the embedded
 * `nodus-server` copy ships), and the working directory is the repository root during
 * development and tests. Both are read from globals rather than from `electron`, so this
 * module stays importable from plain Node — a bundler that only stubs part of the Electron
 * surface can still load the exporters that use it.
 */
function fontCandidates(): string[] {
  const relative = path.join('lib', 'assets', 'fonts', FONT_FILE);
  const candidates: string[] = [];
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources) candidates.push(path.join(resources, 'nodus-server', relative));
  candidates.push(path.join(process.cwd(), 'server', relative));
  return candidates;
}

let cachedFont: Buffer | null = null;

/** The bundled CJK font, read once. */
export function cjkFontBytes(): Buffer {
  if (cachedFont) return cachedFont;
  const candidates = fontCandidates();
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedFont = fs.readFileSync(candidate);
      return cachedFont;
    }
  }
  throw new Error(`Nodus CJK font not found. Looked in:\n${candidates.join('\n')}`);
}

/** Whether `value` needs the CJK font (Han characters, kana, CJK punctuation or fullwidth forms). */
export function hasCjk(value: unknown): boolean {
  return /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u3000-\u303F]/.test(String(value ?? ''));
}

/**
 * Strip only what a PDF text run cannot carry (control characters), keeping every printable
 * script intact — unlike the WinAnsi path, which folds accents and typographic punctuation
 * down to ASCII.
 */
export function cjkSafe(value: string): string {
  return String(value ?? '')
    // Unicode's Control category covers C0/C1 and DEL without spelling them in the pattern;
    // line breaks survive so multi-line copy still splits the way the callers expect.
    .replace(/[\p{Cc}]/gu, (character) => (character === '\n' ? character : ''))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Subset the bundled font to the glyphs `text` needs. Resolves to TrueType bytes. */
export async function subsetCjkFont(text: string): Promise<Uint8Array> {
  return subsetFont(cjkFontBytes(), String(text ?? ''), { targetFormat: 'truetype' });
}
