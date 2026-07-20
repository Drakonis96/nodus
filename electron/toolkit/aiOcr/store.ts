// Nodus AI OCR — the working library on disk. Electron-free: takes a root directory
// (the wiring points it at userData/ai-ocr) and owns the filesystem-per-document layout
//
//   {root}/index.json                     lightweight summary list (a rebuildable cache)
//   {root}/{docId}/source.<ext>           the copied source file
//   {root}/{docId}/metadata.json          the OcrDoc (source of truth)
//   {root}/{docId}/page_0001.jpg          rendered page images
//   {root}/{docId}/page_0001.json         per-page OcrPageResult
//   {root}/{docId}/transcript.md          the reconstructed Markdown
//
// metadata.json is the source of truth; index.json is a derived cache rebuilt by
// scanning when missing. All writes go through a temp-file + rename so a crash never
// leaves a half-written file. No schema/DB involvement — nothing here touches SQLite.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { summarizeDoc, type OcrDoc, type OcrDocSummary, type OcrPageResult } from '@shared/aiOcrTypes';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function assertId(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`ID de documento OCR no válido: ${id}`);
}

/** Write bytes to a sibling temp file, then rename into place (atomic on the same fs). */
function writeAtomic(target: string, data: Uint8Array | string): void {
  const tmp = `${target}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw error;
  }
}

function pageStem(index: number): string {
  return `page_${String(index + 1).padStart(4, '0')}`;
}

export interface OcrStore {
  readonly root: string;
  /** Persist a document snapshot (metadata.json) and refresh its index entry. */
  putDoc(doc: OcrDoc): void;
  readDoc(id: string): OcrDoc | null;
  listDocs(): OcrDocSummary[];
  deleteDoc(id: string): void;
  writeSource(id: string, filename: string, bytes: Uint8Array): void;
  writePageImage(id: string, filename: string, bytes: Uint8Array): void;
  readPageImage(id: string, filename: string): Buffer | null;
  pageImageAbsPath(id: string, filename: string): string;
  sourceAbsPath(id: string, filename: string): string;
  writePageResult(id: string, index: number, result: OcrPageResult): void;
  readPageResult(id: string, index: number): OcrPageResult | null;
  writeTranscript(id: string, markdown: string): void;
  readTranscript(id: string): string | null;
  /** Rebuild index.json by scanning every doc dir; returns the fresh summaries. */
  rebuildIndex(): OcrDocSummary[];
}

export function createOcrStore(rootDir: string): OcrStore {
  fs.mkdirSync(rootDir, { recursive: true });
  const indexPath = path.join(rootDir, 'index.json');

  const dirFor = (id: string): string => {
    assertId(id);
    return path.join(rootDir, id);
  };
  const ensureDir = (id: string): string => {
    const dir = dirFor(id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  const readJson = <T>(file: string): T | null => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return null;
    }
  };

  const readIndex = (): OcrDocSummary[] => {
    const list = readJson<OcrDocSummary[]>(indexPath);
    return Array.isArray(list) ? list : rebuildIndex();
  };

  const writeIndex = (list: OcrDocSummary[]): void => {
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    writeAtomic(indexPath, JSON.stringify(list, null, 2));
  };

  function rebuildIndex(): OcrDocSummary[] {
    const summaries: OcrDocSummary[] = [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
      const doc = readJson<OcrDoc>(path.join(rootDir, entry.name, 'metadata.json'));
      if (doc && doc.id === entry.name) summaries.push(summarizeDoc(doc));
    }
    writeIndex(summaries);
    return summaries;
  }

  return {
    root: rootDir,

    putDoc(doc: OcrDoc): void {
      const dir = ensureDir(doc.id);
      writeAtomic(path.join(dir, 'metadata.json'), JSON.stringify(doc, null, 2));
      const list = readIndex().filter((s) => s.id !== doc.id);
      list.push(summarizeDoc(doc));
      writeIndex(list);
    },

    readDoc(id: string): OcrDoc | null {
      return readJson<OcrDoc>(path.join(dirFor(id), 'metadata.json'));
    },

    listDocs(): OcrDocSummary[] {
      return readIndex();
    },

    deleteDoc(id: string): void {
      fs.rmSync(dirFor(id), { recursive: true, force: true });
      writeIndex(readIndex().filter((s) => s.id !== id));
    },

    writeSource(id: string, filename: string, bytes: Uint8Array): void {
      writeAtomic(path.join(ensureDir(id), path.basename(filename)), bytes);
    },

    writePageImage(id: string, filename: string, bytes: Uint8Array): void {
      writeAtomic(path.join(ensureDir(id), path.basename(filename)), bytes);
    },

    readPageImage(id: string, filename: string): Buffer | null {
      try {
        return fs.readFileSync(path.join(dirFor(id), path.basename(filename)));
      } catch {
        return null;
      }
    },

    pageImageAbsPath(id: string, filename: string): string {
      return path.join(dirFor(id), path.basename(filename));
    },

    sourceAbsPath(id: string, filename: string): string {
      return path.join(dirFor(id), path.basename(filename));
    },

    writePageResult(id: string, index: number, result: OcrPageResult): void {
      writeAtomic(path.join(ensureDir(id), `${pageStem(index)}.json`), JSON.stringify(result));
    },

    readPageResult(id: string, index: number): OcrPageResult | null {
      return readJson<OcrPageResult>(path.join(dirFor(id), `${pageStem(index)}.json`));
    },

    writeTranscript(id: string, markdown: string): void {
      writeAtomic(path.join(ensureDir(id), 'transcript.md'), markdown);
    },

    readTranscript(id: string): string | null {
      try {
        return fs.readFileSync(path.join(dirFor(id), 'transcript.md'), 'utf8');
      } catch {
        return null;
      }
    },

    rebuildIndex,
  };
}
