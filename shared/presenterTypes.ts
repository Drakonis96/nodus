// PDF Presenter — shared, Electron-free data model and pure reducers.
//
// The presenter's library is a global Toolkit resource (one shelf of
// presentations + folders, independent of the active vault, like Convert and
// Protect). Everything here is a pure function over plain data so it can be
// unit-tested directly (scripts/test-presenter-library.mjs) — the filesystem side
// (copying the PDF, reading/writing the JSON) lives in electron/toolkit/presenter.
//
// Field names deliberately mirror the reference app's meta.json so the audience,
// presenter and mobile views can consume a presentation without a translation
// layer: `notes`/`videos` are keyed by the 1-based slide number as a string
// (JSON object keys are strings), `folder` is the containing folder id ('' or
// undefined = root).

/** A YouTube overlay pinned to one slide, positioned in percentages of the slide. */
export interface PresenterVideo {
  url: string;
  /** Left/top of the overlay as a percentage (0–100) of the slide box. */
  x: number;
  y: number;
  /** Width/height of the overlay as a percentage (0–100) of the slide box. */
  w: number;
  h: number;
}

/** One imported PDF and everything the user has attached to it. */
export interface Presentation {
  id: string;
  /** Display name (defaults to the file name without extension; user-editable). */
  name: string;
  /** Original file name, kept for reference. */
  fileName: string;
  /** ISO timestamp of import. */
  createdAt: string;
  /** ISO timestamp of the last time it was opened; drives "recent-opened" sort. */
  lastOpenedAt?: string;
  /** Containing folder id; '' or undefined means the library root. */
  folder?: string;
  /** Page count, filled in the first time the PDF is opened and its pages counted. */
  totalPages: number;
  /** Presenter notes, keyed by 1-based slide number (as a string). */
  notes: Record<string, string>;
  /** YouTube overlays, keyed by 1-based slide number (as a string). */
  videos: Record<string, PresenterVideo>;
}

export interface PresenterFolder {
  id: string;
  name: string;
  createdAt: string;
}

/** The whole on-disk library: the flat list of presentations plus the folders. */
export interface PresenterLibrary {
  presentations: Presentation[];
  folders: PresenterFolder[];
}

/** Speaker notes extracted from a .pptx (the parser lives in electron/toolkit). */
export interface PptxNotes {
  /** Notes keyed by 1-based slide number (as a string); empty ones omitted. */
  notes: Record<string, string>;
  /** Slide count in the deck, validated against the PDF page count on import. */
  totalSlides: number;
}

export type PresenterSortMode = 'recent-added' | 'recent-opened' | 'name-asc' | 'name-desc';

export interface PresenterListQuery {
  /** Folder id to restrict to; '' means the root (all presentations). */
  folder?: string;
  /** Case/accent-insensitive name substring. */
  search?: string;
  sort?: PresenterSortMode;
}

export function emptyLibrary(): PresenterLibrary {
  return { presentations: [], folders: [] };
}

/**
 * Coerce whatever is on disk into a well-formed {@link PresenterLibrary}. Tolerates
 * a legacy bare array of presentations (mirrors the reference's meta.json backward
 * compat) and fills missing sub-objects so callers never guard for undefined.
 */
export function normalizeLibrary(raw: unknown): PresenterLibrary {
  if (Array.isArray(raw)) {
    return { presentations: raw.map(normalizePresentation), folders: [] };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Partial<PresenterLibrary>;
    return {
      presentations: Array.isArray(obj.presentations) ? obj.presentations.map(normalizePresentation) : [],
      folders: Array.isArray(obj.folders) ? obj.folders : [],
    };
  }
  return emptyLibrary();
}

function normalizePresentation(raw: unknown): Presentation {
  const p = (raw ?? {}) as Partial<Presentation>;
  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    fileName: String(p.fileName ?? ''),
    createdAt: String(p.createdAt ?? ''),
    lastOpenedAt: p.lastOpenedAt,
    folder: p.folder ?? '',
    totalPages: Number(p.totalPages ?? 0) || 0,
    notes: p.notes && typeof p.notes === 'object' ? p.notes : {},
    videos: p.videos && typeof p.videos === 'object' ? p.videos : {},
  };
}

/** Accent- and case-insensitive fold, so "cancion" matches "Canción". */
function fold(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Filter by folder + search and sort, returning a new array (never mutates).
 * Sorting is stable-enough for the UI: locale name compare, ISO-string time
 * compare (lexicographic works because the timestamps are ISO-8601).
 */
export function queryPresentations(lib: PresenterLibrary, q: PresenterListQuery = {}): Presentation[] {
  let list = [...lib.presentations];
  if (q.folder) list = list.filter((p) => (p.folder || '') === q.folder);
  if (q.search && q.search.trim()) {
    const needle = fold(q.search.trim());
    list = list.filter((p) => fold(p.name).includes(needle));
  }
  switch (q.sort ?? 'recent-added') {
    case 'recent-opened':
      list.sort((a, b) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || ''));
      break;
    case 'name-asc':
      list.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      list.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'recent-added':
    default:
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      break;
  }
  return list;
}

/** How many presentations sit directly in a folder (for the sidebar count). */
export function folderCount(lib: PresenterLibrary, folderId: string): number {
  return lib.presentations.filter((p) => (p.folder || '') === folderId).length;
}

// ── Pure reducers: each returns a NEW library, never mutating the input. ──────

export function upsertPresentation(lib: PresenterLibrary, p: Presentation): PresenterLibrary {
  const idx = lib.presentations.findIndex((x) => x.id === p.id);
  const presentations = [...lib.presentations];
  if (idx >= 0) presentations[idx] = p;
  else presentations.push(p);
  return { ...lib, presentations };
}

export function removePresentation(lib: PresenterLibrary, id: string): PresenterLibrary {
  return { ...lib, presentations: lib.presentations.filter((p) => p.id !== id) };
}

export function renamePresentation(lib: PresenterLibrary, id: string, name: string): PresenterLibrary {
  const trimmed = name.trim();
  if (!trimmed) return lib;
  return {
    ...lib,
    presentations: lib.presentations.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
  };
}

export function moveToFolder(lib: PresenterLibrary, id: string, folderId: string): PresenterLibrary {
  return {
    ...lib,
    presentations: lib.presentations.map((p) => (p.id === id ? { ...p, folder: folderId || '' } : p)),
  };
}

export function addFolder(lib: PresenterLibrary, folder: PresenterFolder): PresenterLibrary {
  return { ...lib, folders: [...lib.folders, folder] };
}

/** Remove a folder; its presentations fall back to the root (never deleted). */
export function removeFolder(lib: PresenterLibrary, folderId: string): PresenterLibrary {
  return {
    folders: lib.folders.filter((f) => f.id !== folderId),
    presentations: lib.presentations.map((p) => (p.folder === folderId ? { ...p, folder: '' } : p)),
  };
}

/** Set (or clear, with the empty string) the note for a 1-based slide number. */
export function setNote(p: Presentation, slide: number, text: string): Presentation {
  const notes = { ...p.notes };
  const key = String(slide);
  if (text.trim()) notes[key] = text;
  else delete notes[key];
  return { ...p, notes };
}

/** Set (or clear, with null) the YouTube overlay for a 1-based slide number. */
export function setVideo(p: Presentation, slide: number, video: PresenterVideo | null): Presentation {
  const videos = { ...p.videos };
  const key = String(slide);
  if (video && video.url.trim()) videos[key] = video;
  else delete videos[key];
  return { ...p, videos };
}

export function noteCount(p: Presentation): number {
  return Object.keys(p.notes || {}).length;
}

export function videoCount(p: Presentation): number {
  return Object.keys(p.videos || {}).length;
}
