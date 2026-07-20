// PDF Presenter — shared bootstrap for the audience and presenter windows: read
// the launch parameters and load the deck (pdfjs doc + its library entry for name
// and notes). Both windows are opened by electron/toolkit/presenter/windows.ts with
// ?pdfId=&startSlide= query params.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPresenterPdf } from '../lib/presenter/pdf';
import type { Presentation } from '@shared/presenterTypes';

export interface DeckParams {
  pdfId: string;
  startSlide: number;
  role: string;
}

export function readDeckParams(): DeckParams {
  const params = new URLSearchParams(window.location.search);
  return {
    pdfId: params.get('pdfId') ?? '',
    startSlide: Math.max(1, parseInt(params.get('startSlide') ?? '1', 10) || 1),
    role: params.get('role') ?? 'audience',
  };
}

export interface LoadedDeck {
  doc: PDFDocumentProxy;
  presentation: Presentation | null;
}

export async function loadDeck(pdfId: string): Promise<LoadedDeck | null> {
  const [doc, library] = await Promise.all([loadPresenterPdf(pdfId), window.nodus.getPresenterLibrary()]);
  if (!doc) return null;
  const presentation = library.presentations.find((p) => p.id === pdfId) ?? null;
  return { doc, presentation };
}

/** Split a note into paragraphs for display (blank-line separated). */
export function noteParagraphs(note: string | undefined): string[] {
  if (!note || !note.trim()) return [];
  return note
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
