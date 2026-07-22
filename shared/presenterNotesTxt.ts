// PDF Presenter — stable, human-editable TXT interchange for speaker notes.
//
// Every slide gets an explicit section, including slides without notes. Lines that
// begin with a backslash are escaped so delimiter-looking note text round-trips
// without being interpreted as format structure.
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

/** Parse a TXT export, rejecting partial, reordered, or unsupported files. */
export function parsePresenterNotesTxt(source: string): PptxNotes {
  if (typeof source !== 'string' || source.length > MAX_TEXT_LENGTH) {
    throw new Error('Presenter notes TXT is too large');
  }

  const lines = normalizedLines(source.replace(/^\uFEFF/, ''));
  if (lines[0] !== MAGIC || lines[1] !== VERSION) {
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
