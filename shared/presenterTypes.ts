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
// (JSON object keys are strings). Legacy tags are migrated to folders on read.

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

/** One imported deck, stored internally as PDF, and everything attached to it. */
export interface Presentation {
  id: string;
  /** Display name (defaults to the file name without extension; user-editable). */
  name: string;
  /** Original file name (PDF or source presentation), kept for reference. */
  fileName: string;
  /** ISO timestamp of import. */
  createdAt: string;
  /** ISO timestamp of the last time it was opened; drives "recent-opened" sort. */
  lastOpenedAt?: string;
  /** Containing folder; null or undefined means the main library. */
  folderId?: string | null;
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
  parentId: string | null;
  icon: string;
  color: string;
}

export type PresenterFolderDeleteMode = 'move-to-root' | 'delete-presentations';

/** The whole on-disk library; folder hierarchy is stored through parentId. */
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

/** File types accepted by the presenter import picker. Every non-PDF format is
 * converted locally to the presenter's internal PDF representation. */
export type PresenterImportFormat =
  | 'pdf'
  | 'pptx'
  | 'ppt'
  | 'pptm'
  | 'ppsx'
  | 'pps'
  | 'odp'
  | 'key';

/** A file explicitly chosen by the user. The path is returned only after the
 * native picker succeeds, then sent back to Electron if the user confirms. */
export interface PresenterImportSelection {
  /** Opaque, short-lived handle; the renderer never receives the local path. */
  token: string;
  fileName: string;
  format: PresenterImportFormat;
  needsConversion: boolean;
}

export type PresenterConverter = 'libreoffice' | 'powerpoint' | 'keynote';
export type PresenterImportErrorCode = 'invalid-file' | 'unsupported-format' | 'no-converter' | 'conversion-failed';

export type PresenterImportResult =
  | {
      ok: true;
      presentation: Presentation;
      converted: boolean;
      converter?: PresenterConverter;
      importedNotes: number;
    }
  | { ok: false; code: PresenterImportErrorCode };

export type PresenterSortMode = 'recent-added' | 'recent-opened' | 'name-asc' | 'name-desc';

export interface PresenterListQuery {
  /** Folder id, or null for the main library. Omitted searches every folder. */
  folderId?: string | null;
  /** Include descendants of the selected folder; at root, include every folder. */
  recursive?: boolean;
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
 * compat), migrates `tags`/`tag` and older `folders`/`folder` fields, and
 * fills missing sub-objects so callers never guard for undefined.
 */
export function normalizeLibrary(raw: unknown): PresenterLibrary {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const source = Array.isArray(obj.folders) ? obj.folders : Array.isArray(obj.tags) ? obj.tags : [];
  const folders: PresenterFolder[] = [];
  const ids = new Set<string>();
  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue;
    const f = entry as Partial<PresenterFolder>;
    if (typeof f.id !== 'string' || !f.id || ids.has(f.id)) continue;
    ids.add(f.id);
    folders.push({
      id: f.id, name: String(f.name ?? '').trim() || 'Carpeta', createdAt: String(f.createdAt ?? ''),
      parentId: typeof f.parentId === 'string' && f.parentId ? f.parentId : null,
      icon: typeof f.icon === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(f.icon) ? f.icon : 'folder',
      color: typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#6366f1',
    });
  }
  const byId = new Map(folders.map(f => [f.id, f]));
  for (const folder of folders) {
    const seen = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId) {
      if (!byId.has(parentId) || seen.has(parentId)) { folder.parentId = null; break; }
      seen.add(parentId);
      parentId = byId.get(parentId)!.parentId;
    }
  }
  const presentations = (Array.isArray(raw) ? raw : Array.isArray(obj.presentations) ? obj.presentations : []).map(normalizePresentation);
  return { folders, presentations: presentations.map(p => ({ ...p, folderId: p.folderId && ids.has(p.folderId) ? p.folderId : null })) };
}

function normalizePresentation(raw: unknown): Presentation {
  const p = (raw ?? {}) as Partial<Presentation> & { folder?: string; tag?: string };
  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    fileName: String(p.fileName ?? ''),
    createdAt: String(p.createdAt ?? ''),
    lastOpenedAt: p.lastOpenedAt,
    folderId: p.folderId !== undefined ? p.folderId || null : p.tag || p.folder || null,
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
  if (q.folderId !== undefined) {
    if (q.recursive && q.folderId) {
      const ids = folderSubtreeIds(lib, q.folderId);
      list = list.filter(p => ids.has(p.folderId || ''));
    } else if (!q.recursive) {
      list = list.filter(p => (p.folderId || null) === (q.folderId || null));
    }
  }
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

/** A folder and its descendants, for search, counts and recursive deletion. */
export function folderSubtreeIds(lib: PresenterLibrary, folderId: string): Set<string> {
  if (!lib.folders.some(f => f.id === folderId)) return new Set();
  const ids = new Set([folderId]);
  const queue = [folderId];
  const children = new Map<string, string[]>();
  for (const folder of lib.folders) {
    if (folder.parentId) children.set(folder.parentId, [...children.get(folder.parentId) ?? [], folder.id]);
  }
  for (let i = 0; i < queue.length; i++) {
    for (const id of children.get(queue[i]) ?? []) if (!ids.has(id)) { ids.add(id); queue.push(id); }
  }
  return ids;
}

export function folderCount(lib: PresenterLibrary, folderId: string | null, recursive = false): number {
  const ids = folderId && recursive ? folderSubtreeIds(lib, folderId) : null;
  return lib.presentations.filter(p => ids ? ids.has(p.folderId || '') : (p.folderId || null) === folderId).length;
}

export function folderPath(lib: PresenterLibrary, folderId: string | null): PresenterFolder[] {
  const path: PresenterFolder[] = [];
  const seen = new Set<string>();
  while (folderId && !seen.has(folderId)) {
    seen.add(folderId);
    const folder = lib.folders.find(f => f.id === folderId);
    if (!folder) break;
    path.unshift(folder);
    folderId = folder.parentId;
  }
  return path;
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

export function assignFolder(lib: PresenterLibrary, id: string, folderId: string | null): PresenterLibrary {
  if (folderId && !lib.folders.some(f => f.id === folderId)) return lib;
  return {
    ...lib,
    presentations: lib.presentations.map((p) => (p.id === id ? { ...p, folderId: folderId || null } : p)),
  };
}

export function addFolder(lib: PresenterLibrary, folder: PresenterFolder): PresenterLibrary {
  if (!folder.id || !folder.name.trim() || lib.folders.some(f => f.id === folder.id) || (folder.parentId && !lib.folders.some(f => f.id === folder.parentId))) return lib;
  return { ...lib, folders: [...lib.folders, { ...folder, name: folder.name.trim() }] };
}

export function updateFolder(lib: PresenterLibrary, id: string, patch: Partial<Pick<PresenterFolder, 'name' | 'icon' | 'color' | 'parentId'>>): PresenterLibrary {
  if (patch.name !== undefined && !patch.name.trim()) return lib;
  if (patch.parentId && (!lib.folders.some(f => f.id === patch.parentId) || folderSubtreeIds(lib, id).has(patch.parentId))) return lib;
  return { ...lib, folders: lib.folders.map(f => f.id === id ? { ...f, ...patch, name: patch.name?.trim() ?? f.name } : f) };
}

/** Remove a subtree, explicitly keeping its decks at root or deleting them. */
export function removeFolder(lib: PresenterLibrary, folderId: string, mode: PresenterFolderDeleteMode): PresenterLibrary {
  const ids = folderSubtreeIds(lib, folderId);
  if (!ids.size) return lib;
  return {
    folders: lib.folders.filter(f => !ids.has(f.id)),
    presentations: mode === 'delete-presentations'
      ? lib.presentations.filter(p => !ids.has(p.folderId || ''))
      : lib.presentations.map(p => ids.has(p.folderId || '') ? { ...p, folderId: null } : p),
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
