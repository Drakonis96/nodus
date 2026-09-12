// PDF Presenter — stable, human-editable TXT interchange for speaker notes.
//
// Two shapes are read; only the first is written.
//
// 1. The native export. Every slide gets an explicit section, including slides
//    without notes, delimited at both ends. Lines that begin with a backslash are
//    escaped so delimiter-looking note text round-trips without being interpreted
//    as format structure.
//
// 2. "Recovered notes" dumps: a `KEY: value` header, then one open-ended section
//    per slide that HAS a note (`===== DIAPOSITIVA 7 =====`, running to the next
//    marker or to the end of the file), with silent slides simply absent and no
//    escaping. That shape carries no version line, so it is recognised by its own
//    structure and parsed leniently — its whole point is rescuing notes from a
//    file nobody designed for this importer.
import type { PptxNotes } from './presenterTypes';

const MAGIC = 'NODUS PDF PRESENTER NOTES';
const VERSION = 'Version: 1';
const MAX_SLIDES = 100_000;
const MAX_TEXT_LENGTH = 10 * 1024 * 1024;

function startMarker(slide: number): string {
  return `===== SLIDE ${slide} =====`;
}

function endMarker(slide: number): string {
  return `===== END SLIDE ${slide} =====`;
}

function normalizedLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

// ── Recovered-notes dumps ────────────────────────────────────────────────────

/** `===== DIAPOSITIVA 7 =====` / `===== SLIDE 7 =====`, in either interface
 *  language, with no closing marker. */
const RECOVERED_SLIDE_MARKER = /^=+ *(?:DIAPOSITIVA|SLIDE) *(\d+) *=+$/;
/** The native format's closing marker, which this shape never has. */
const NATIVE_END_MARKER = /^=+ *END +SLIDE *\d+ *=+$/;
/** A `KEY: value` header line, e.g. `PÁGINAS: 140`. */
const HEADER_FIELD = /^([^:]{1,80}): *(.*)$/;
/** Header keys that declare the deck's length, in either interface language. */
const SLIDE_COUNT_KEYS = ['PÁGINAS', 'PAGINAS', 'PAGES', 'DIAPOSITIVAS', 'SLIDES'];

/**
 * Does this look like a recovered-notes dump? It must carry at least one slide
 * marker and no native closing marker — a file with closing markers but no magic
 * line is a damaged native export, and quietly folding its `===== END SLIDE n =====`
 * lines into the note text would be worse than refusing it.
 */
function looksRecovered(lines: string[]): boolean {
  return lines.some((line) => RECOVERED_SLIDE_MARKER.test(line)) && !lines.some((line) => NATIVE_END_MARKER.test(line));
}

/** Strip leading and trailing blank lines, keeping the blank lines between
 *  paragraphs — they are how these dumps separate one thought from the next. */
function trimBlankEdges(body: string[]): string[] {
  let start = 0;
  let end = body.length;
  while (start < end && body[start].trim() === '') start += 1;
  while (end > start && body[end - 1].trim() === '') end -= 1;
  return body.slice(start, end);
}

/**
 * Parse a recovered-notes dump. The declared page count wins when the header
 * carries one; otherwise the highest slide that has a note is the best floor
 * available, and the caller compares whatever comes back against the real PDF.
 */
function parseRecoveredNotesTxt(lines: string[]): PptxNotes {
  let declaredSlides = 0;
  for (const line of lines) {
    if (RECOVERED_SLIDE_MARKER.test(line)) break; // the header ends at the first slide
    const field = line.match(HEADER_FIELD);
    if (!field) continue;
    const key = field[1].trim().toUpperCase();
    const value = field[2].trim();
    if (SLIDE_COUNT_KEYS.includes(key) && /^[1-9]\d*$/.test(value)) {
      declaredSlides = Number(value);
      break;
    }
  }
  if (declaredSlides > MAX_SLIDES) throw new Error('Invalid presenter notes slide count');

  const notes: Record<string, string> = {};
  let highestSlide = 0;
  let slide = 0;
  let body: string[] = [];

  const flush = () => {
    if (!slide) return;
    const note = trimBlankEdges(body).join('\n');
    if (note.trim()) notes[String(slide)] = note;
  };

  for (const line of lines) {
    const marker = line.match(RECOVERED_SLIDE_MARKER);
    if (!marker) {
      if (slide) body.push(line);
      continue;
    }
    flush();
    const next = Number(marker[1]);
    if (!Number.isSafeInteger(next) || next < 1 || next > MAX_SLIDES) {
      throw new Error('Invalid presenter notes slide number');
    }
    // Two sections for the same slide would make one of them disappear without
    // a word, so say so instead.
    if (notes[String(next)]) throw new Error(`Duplicate presenter notes section for slide ${next}`);
    slide = next;
    highestSlide = Math.max(highestSlide, next);
    body = [];
  }
  flush();

  const totalSlides = declaredSlides || highestSlide;
  if (!totalSlides) throw new Error('Unsupported presenter notes TXT format');
  if (highestSlide > totalSlides) {
    throw new Error(`Presenter notes name slide ${highestSlide} in a deck of ${totalSlides}`);
  }
  return { notes, totalSlides };
}

function escapeNoteLine(line: string): string {
  return line.startsWith('\\') || /^===== (?:END )?SLIDE \d+ =====$/.test(line) ? `\\${line}` : line;
}

/** Serialize all slide notes to the versioned TXT format. */
export function serializePresenterNotesTxt(notes: Record<string, string>, totalSlides: number): string {
  if (!Number.isSafeInteger(totalSlides) || totalSlides < 1 || totalSlides > MAX_SLIDES) {
    throw new Error('Invalid presenter slide count');
  }

  const lines = [MAGIC, VERSION, `Slides: ${totalSlides}`, ''];
  for (let slide = 1; slide <= totalSlides; slide += 1) {
    lines.push(startMarker(slide));
    const note = String(notes[String(slide)] ?? '').replace(/\r\n?/g, '\n');
    if (note) {
      lines.push(...note.split('\n').map(escapeNoteLine));
    }
    lines.push(endMarker(slide));
    if (slide < totalSlides) lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Parse a TXT export. The native format is held to the letter — partial,
 * reordered or unsupported files are rejected — while a recovered-notes dump,
 * recognised by its own structure, is read leniently.
 */
export function parsePresenterNotesTxt(source: string): PptxNotes {
  if (typeof source !== 'string' || source.length > MAX_TEXT_LENGTH) {
    throw new Error('Presenter notes TXT is too large');
  }

  const lines = normalizedLines(source.replace(/^\uFEFF/, ''));
  if (lines[0] !== MAGIC || lines[1] !== VERSION) {
    if (looksRecovered(lines)) return parseRecoveredNotesTxt(lines);
    throw new Error('Unsupported presenter notes TXT format');
  }

  const countMatch = lines[2]?.match(/^Slides: ([1-9]\d*)$/);
  const totalSlides = countMatch ? Number(countMatch[1]) : 0;
  if (!Number.isSafeInteger(totalSlides) || totalSlides < 1 || totalSlides > MAX_SLIDES) {
    throw new Error('Invalid presenter notes slide count');
  }

  const notes: Record<string, string> = {};
  let index = 3;
  for (let slide = 1; slide <= totalSlides; slide += 1) {
    while (lines[index] === '') index += 1;
    if (lines[index] !== startMarker(slide)) {
      throw new Error(`Missing presenter notes section for slide ${slide}`);
    }
    index += 1;

    const body: string[] = [];
    const close = endMarker(slide);
    while (index < lines.length && lines[index] !== close) {
      const line = lines[index];
      body.push(line.startsWith('\\') ? line.slice(1) : line);
      index += 1;
    }
    if (lines[index] !== close) {
      throw new Error(`Unclosed presenter notes section for slide ${slide}`);
    }
    index += 1;

    const note = body.join('\n');
    if (note.trim()) notes[String(slide)] = note;
  }

  while (lines[index] === '') index += 1;
  if (index < lines.length) throw new Error('Unexpected content after presenter notes sections');
  return { notes, totalSlides };
}
