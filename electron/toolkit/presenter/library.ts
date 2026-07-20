// PDF Presenter — the filesystem side of the global library. Electron-free (only
// node fs/path/crypto) so it is unit-tested directly against a temp dir
// (scripts/test-presenter-library.mjs); the IPC layer in electron/ipc.ts wires
// these to `app.getPath('userData')/toolkit/presenter`.
//
// Golden rule of the Toolkit: the original file is never touched. Importing COPIES
// the PDF into the library dir as `<id>.pdf`; deleting removes only the copy.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  normalizeLibrary,
  removePresentation,
  type Presentation,
  type PresenterLibrary,
} from '@shared/presenterTypes';

const META_FILE = 'library.json';

export interface PresenterPaths {
  /** Root dir that holds `library.json` and the `<id>.pdf` copies. */
  dir: string;
  metaFile: string;
}

export function presenterPaths(baseDir: string): PresenterPaths {
  return { dir: baseDir, metaFile: path.join(baseDir, META_FILE) };
}

function ensureDir(baseDir: string): void {
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
}

/** A short, collision-resistant, filesystem-safe id (base36 time + random). */
export function makeId(): string {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/** Read the library, tolerating a missing or legacy-shaped file. */
export function readLibrary(baseDir: string): PresenterLibrary {
  ensureDir(baseDir);
  const { metaFile } = presenterPaths(baseDir);
  if (!fs.existsSync(metaFile)) return normalizeLibrary(null);
  try {
    return normalizeLibrary(JSON.parse(fs.readFileSync(metaFile, 'utf-8')));
  } catch {
    // A corrupt/half-written meta must not brick the whole tool — start clean.
    return normalizeLibrary(null);
  }
}

/** Persist the library atomically (write-temp-then-rename avoids torn files). */
export function writeLibrary(baseDir: string, lib: PresenterLibrary): void {
  ensureDir(baseDir);
  const { metaFile } = presenterPaths(baseDir);
  const tmp = `${metaFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lib, null, 2));
  fs.renameSync(tmp, metaFile);
}

/** Absolute path of a presentation's copied PDF. */
export function pdfPath(baseDir: string, id: string): string {
  // `path.basename` strips any traversal in the id before it reaches the FS.
  return path.join(baseDir, `${path.basename(id)}.pdf`);
}

/**
 * Copy a PDF into the library and register it. Returns the new {@link Presentation}
 * (already appended to the persisted library). `srcPath` is the user-chosen file;
 * it is only read, never moved.
 */
export function importPdf(baseDir: string, srcPath: string, now = new Date()): Presentation {
  ensureDir(baseDir);
  const id = makeId();
  const fileName = path.basename(srcPath);
  fs.copyFileSync(srcPath, pdfPath(baseDir, id));

  const presentation: Presentation = {
    id,
    name: fileName.replace(/\.pdf$/i, ''),
    fileName,
    createdAt: now.toISOString(),
    folder: '',
    totalPages: 0,
    notes: {},
    videos: {},
  };

  const lib = readLibrary(baseDir);
  lib.presentations.push(presentation);
  writeLibrary(baseDir, lib);
  return presentation;
}

/** Read the raw PDF bytes for a presentation, or null if the copy is gone. */
export function readPdfBytes(baseDir: string, id: string): Buffer | null {
  const file = pdfPath(baseDir, id);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

/** Remove a presentation's entry and its copied PDF. Idempotent. */
export function deletePresentation(baseDir: string, id: string): void {
  const lib = readLibrary(baseDir);
  writeLibrary(baseDir, removePresentation(lib, id));
  const file = pdfPath(baseDir, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
