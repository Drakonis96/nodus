// PDF Presenter — import speaker notes from a PowerPoint (.pptx) file. Electron-free
// (adm-zip + string parsing, no xml2js) so it is unit-tested directly against a real
// .pptx fixture (scripts/test-presenter-notes.mjs). A .pptx is a ZIP of XML parts;
// the notes for slide N live in ppt/notesSlides/notesSlideM.xml, linked from the
// slide's relationships file. We resolve that link (rather than assuming N===M),
// then pull the text out of the notes body placeholder.
import AdmZip from 'adm-zip';
import type { PptxNotes } from '@shared/presenterTypes';

export type { PptxNotes };

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** Extract speaker notes from the raw bytes of a .pptx file. */
export function extractPptxNotes(buffer: Buffer): PptxNotes {
  const zip = new AdmZip(buffer);
  const entries = new Map(zip.getEntries().map((e) => [e.entryName, e]));

  const slideNames = [...entries.keys()]
    .filter((name) => SLIDE_RE.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const notes: Record<string, string> = {};
  slideNames.forEach((slideName, index) => {
    const slideNum = index + 1;
    const relsName = `ppt/slides/_rels/${basename(slideName)}.rels`;
    const relsEntry = entries.get(relsName);
    if (!relsEntry) return;

    const notesTarget = findNotesTarget(relsEntry.getData().toString('utf-8'));
    if (!notesTarget) return;

    // Targets are relative to ppt/slides/ (e.g. "../notesSlides/notesSlide1.xml")
    // or absolute ("/ppt/notesSlides/…"); normalise either to a zip entry name.
    const notesName = notesTarget.startsWith('/')
      ? notesTarget.slice(1)
      : normalize(`ppt/slides/${notesTarget}`);
    const notesEntry = entries.get(notesName);
    if (!notesEntry) return;

    const text = extractNoteText(notesEntry.getData().toString('utf-8'));
    if (text.trim()) notes[String(slideNum)] = text.trim();
  });

  return { notes, totalSlides: slideNames.length };
}

function slideNumber(name: string): number {
  const m = name.match(/slide(\d+)\.xml$/);
  return m ? Number(m[1]) : 0;
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** Collapse `..`/`.` segments in a posix path (no allocation-heavy path module). */
function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

/** Find the notesSlide relationship target in a slide's .rels XML. */
function findNotesTarget(relsXml: string): string | null {
  // <Relationship Id=".." Type="…/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
  const relRe = /<Relationship\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(relsXml))) {
    const tag = m[0];
    if (/Type="[^"]*notesSlide"/.test(tag)) {
      const target = tag.match(/Target="([^"]+)"/);
      if (target) return decodeXml(target[1]);
    }
  }
  return null;
}

/**
 * Pull the speaker-note text out of a notesSlide XML. The note lives in the shape
 * whose placeholder is `type="body"`; other shapes (the slide-image placeholder,
 * the slide-number field) are ignored. Falls back to the first non-numeric text
 * body so a deck authored without an explicit body placeholder still yields notes.
 */
function extractNoteText(noteXml: string): string {
  const shapes = noteXml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) ?? [];

  for (const sp of shapes) {
    if (/<p:ph\b[^>]*type="body"/.test(sp)) {
      const text = paragraphsFrom(sp);
      if (text.trim()) return text;
    }
  }
  // Fallback: any text body that is not just a slide number.
  for (const sp of shapes) {
    const text = paragraphsFrom(sp);
    if (text.trim() && !/^\d+$/.test(text.trim())) return text;
  }
  return '';
}

/** Join every `<a:p>` paragraph in a shape, preserving `<a:br/>` line breaks. */
function paragraphsFrom(sp: string): string {
  const paras = sp.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
  return paras
    .map((para) => {
      // Turn each break into a text run carrying a newline, so it survives the
      // run extraction below (a bare space would corrupt every real space).
      const withBreaks = para.replace(/<a:br\b[^>]*\/>|<a:br\b[\s\S]*?<\/a:br>/g, '<a:t>\n</a:t>');
      const runs = [...withBreaks.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
      return runs.join('');
    })
    .join('\n');
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
