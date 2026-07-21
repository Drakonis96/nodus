// Nodus AI OCR — the Electron wiring. The ONLY module here that touches Electron /
// aiClient / settings; everything it drives (store, manager, engine, rasterize) stays
// Electron-free and unit-tested. It binds the engine's model call to the app's existing
// multimodal aiClient (completeJson / completeTextNeutral — no new provider code),
// resolves the effective vision model from settings, points the store at userData, and
// pushes progress to the renderer.
import crypto from 'node:crypto';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { completeJson, completeTextNeutral } from '../../ai/aiClient';
import { getSettings } from '../../db/settingsRepo';
import { createNote } from '../../db/notesRepo';
import {
  DEFAULT_OCR_OPTIONS,
  type AiOcrCreateRequest,
  type OcrDoc,
  type OcrDocSummary,
  type OcrOptions,
  type OcrSourceKind,
} from '@shared/aiOcrTypes';
import type { ModelRef } from '@shared/types';
import type { AiOcrExportFormat } from '@shared/aiOcrTypes';
import { pageToMarkdown } from '@shared/aiOcrReconstruct';
import { htmlToPdfBytes } from '../../export/htmlToPdf';
import { buildZip, type ZipEntry } from '../zip';
import { AI_OCR_EXPORT_EXT, exportTranscriptBytes, transcriptToHtml } from './export';

/** Alias kept for the IPC layer; the shape lives in shared/aiOcrTypes. */
export type AiOcrCreateInput = AiOcrCreateRequest;
import { ocrPageImage, type OcrModelCall } from './engine';
import { detectAndCropColumns } from './columns';
import { rasterizeImage, rasterizePdf } from './rasterize';
import { createOcrStore, type OcrStore } from './store';
import { createOcrManager, type OcrManager } from './manager';

/** Bind the engine's model calls to the app's multimodal AI client. completeTextNeutral
 *  is used for the verbatim/fallback path so OCR output isn't steered by the UI output
 *  language (a transcription must keep the document's own language). */
const modelCall: OcrModelCall = {
  completeJson: (opts, guard, model) => completeJson(opts, guard, model),
  completeText: (opts, model) => completeTextNeutral(opts, model),
};

const PDF_EXTENSIONS = new Set(['.pdf']);

function sourceKindFor(filePath: string): OcrSourceKind {
  return PDF_EXTENSIONS.has(path.extname(filePath).toLowerCase()) ? 'pdf' : 'image';
}

/** The effective vision model: an explicit choice, else the configured vision model,
 *  falling back to extraction/synthesis (same chain the archive/database features use). */
function resolveOcrModel(explicit?: ModelRef | null): ModelRef | null {
  if (explicit?.provider && explicit.model) return explicit;
  const s = getSettings();
  return s.visionModel ?? s.extractionModel ?? s.synthesisModel ?? null;
}

function mergeOptions(partial?: Partial<OcrOptions>): OcrOptions {
  return { ...DEFAULT_OCR_OPTIONS, ...(partial ?? {}) };
}

let store: OcrStore | null = null;
let manager: OcrManager | null = null;
let windowProvider: (() => BrowserWindow | null) | null = null;

/** Create the store + manager once, wiring progress to the given window provider. */
export function initAiOcr(getWindow: () => BrowserWindow | null): void {
  windowProvider = getWindow;
  if (manager) return;
  store = createOcrStore(path.join(app.getPath('userData'), 'ai-ocr'));
  manager = createOcrManager({
    store,
    rasterizePdf,
    rasterizeImage,
    ocrPage: (image, options, model) => ocrPageImage(image, options, model, modelCall),
    splitColumns: (buffer, mediaType) => detectAndCropColumns(buffer, mediaType),
    emit: (progress) => {
      const win = windowProvider?.();
      if (win && !win.isDestroyed()) win.webContents.send('aiOcr:event', progress.docId, progress);
    },
  });
}

function requireManager(): OcrManager {
  if (!manager) throw new Error('AI OCR no está inicializado.');
  return manager;
}
function requireStore(): OcrStore {
  if (!store) throw new Error('AI OCR no está inicializado.');
  return store;
}

/** Resume any document left unfinished by a previous session. */
export async function resumeAiOcr(): Promise<void> {
  if (!manager) return;
  await manager.resume();
}

/** Start OCR for one or more source files (one document each). */
export async function createOcrDocs(input: AiOcrCreateInput): Promise<OcrDoc[]> {
  const mgr = requireManager();
  const model = resolveOcrModel(input.model);
  if (!model) {
    throw new Error('No hay un modelo de visión configurado. Elige uno en Ajustes › Modelos (Visión y OCR de imágenes).');
  }
  const options = mergeOptions(input.options);
  const created: OcrDoc[] = [];
  for (const sourcePath of input.sourcePaths) {
    const doc = await mgr.createDocument({
      id: crypto.randomUUID(),
      name: path.basename(sourcePath, path.extname(sourcePath)) || 'Documento',
      sourcePath,
      sourceKind: sourceKindFor(sourcePath),
      model,
      options,
    });
    created.push(doc);
  }
  return created;
}

export function listOcrDocs(): OcrDocSummary[] {
  return requireStore().listDocs();
}

/** IDs of documents whose name OR transcribed text contains `query` (case-insensitive).
 *  Empty query returns every document. Content search reads the stored transcript, so it
 *  matches the actual OCR output, not just the filename. */
export function searchOcrDocs(query: string): string[] {
  const store = requireStore();
  const q = query.trim().toLowerCase();
  const all = store.listDocs();
  if (!q) return all.map((d) => d.id);
  const ids: string[] = [];
  for (const summary of all) {
    if (summary.name.toLowerCase().includes(q)) {
      ids.push(summary.id);
      continue;
    }
    const transcript = store.readTranscript(summary.id);
    if (transcript && transcript.toLowerCase().includes(q)) ids.push(summary.id);
  }
  return ids;
}

export function getOcrDoc(id: string): OcrDoc | null {
  return requireStore().readDoc(id);
}

export function deleteOcrDoc(id: string): void {
  requireManager().cancel(id);
  requireStore().deleteDoc(id);
}

export function cancelOcrDoc(id: string): void {
  requireManager().cancel(id);
}

export async function reprocessOcrPage(
  id: string,
  index: number,
  patch?: { model?: ModelRef | null },
): Promise<void> {
  const resolved = patch && patch.model !== undefined ? { model: resolveOcrModel(patch.model) } : undefined;
  await requireManager().reprocessPage(id, index, resolved);
}

export async function reprocessOcrDocument(
  id: string,
  patch?: { model?: ModelRef | null; options?: Partial<OcrOptions> },
): Promise<void> {
  const resolvedPatch = patch
    ? {
        model: patch.model === undefined ? undefined : resolveOcrModel(patch.model),
        options: patch.options ? mergeOptions(patch.options) : undefined,
      }
    : undefined;
  await requireManager().reprocessDocument(id, resolvedPatch);
}

/** A page image as a data URL, for the renderer's page-by-page review (F3). */
export function ocrPageImageDataUrl(id: string, index: number): string | null {
  const s = requireStore();
  const doc = s.readDoc(id);
  const page = doc?.pages.find((p) => p.index === index);
  if (!page) return null;
  const bytes = s.readPageImage(id, page.imageFile);
  if (!bytes) return null;
  return `data:${page.mediaType};base64,${bytes.toString('base64')}`;
}

export function ocrTranscript(id: string): string | null {
  return requireStore().readTranscript(id);
}

/** The current Markdown of one page: the manual edit if present, else the OCR
 *  reconstruction of that page's blocks. Empty string when there is nothing yet. */
export function ocrPageText(id: string, index: number): string {
  const s = requireStore();
  const doc = s.readDoc(id);
  const page = doc?.pages.find((p) => p.index === index);
  if (!page) return '';
  if (page.editedText != null) return page.editedText;
  const result = s.readPageResult(id, index);
  return result ? pageToMarkdown(result) : '';
}

/** Save a manual edit of one page (null reverts to the OCR reconstruction). */
export async function updateOcrPage(id: string, index: number, text: string | null): Promise<void> {
  await requireManager().editPage(id, index, text);
}

// ── Export ──────────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'documento';
}

async function transcriptBytes(id: string, format: AiOcrExportFormat, title: string): Promise<Uint8Array> {
  const md = requireStore().readTranscript(id) ?? '';
  if (format === 'pdf') {
    const pdf = await htmlToPdfBytes(transcriptToHtml(md, title), { margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
    return new Uint8Array(pdf);
  }
  return exportTranscriptBytes(md, format, title);
}

/** Produce the bytes + suggested filename for exporting one document. */
export async function buildOcrExport(id: string, format: AiOcrExportFormat): Promise<{ filename: string; data: Uint8Array }> {
  const doc = requireStore().readDoc(id);
  if (!doc) throw new Error('Documento OCR no encontrado.');
  const title = doc.name || 'documento';
  const data = await transcriptBytes(id, format, title);
  return { filename: `${sanitizeFilename(title)}.${AI_OCR_EXPORT_EXT[format]}`, data };
}

/** Save a document's transcript into the active vault as a Markdown note. Notes exist in
 *  every vault type, so this is the universal "save to vault" path. */
export function saveOcrToVault(id: string): { noteId: string; title: string } {
  const store = requireStore();
  const doc = store.readDoc(id);
  if (!doc) throw new Error('Documento OCR no encontrado.');
  const transcript = store.readTranscript(id) ?? '';
  if (!transcript.trim()) throw new Error('No hay transcripción que guardar todavía.');
  const title = doc.name || 'Transcripción OCR';
  const note = createNote({ title, content: transcript, kind: 'markdown' });
  return { noteId: note.id, title: note.title };
}

/** Bundle every completed document's transcript into one ZIP in the chosen format. */
export async function buildOcrExportZip(ids: string[], format: AiOcrExportFormat): Promise<{ filename: string; data: Uint8Array }> {
  const store = requireStore();
  const entries: ZipEntry[] = [];
  const taken = new Set<string>();
  const ext = AI_OCR_EXPORT_EXT[format];
  for (const id of ids) {
    const doc = store.readDoc(id);
    if (!doc || doc.status !== 'done') continue;
    const base = sanitizeFilename(doc.name || 'documento');
    let name = `${base}.${ext}`;
    let n = 2;
    while (taken.has(name)) name = `${base} (${n++}).${ext}`;
    taken.add(name);
    entries.push({ name, data: Buffer.from(await transcriptBytes(id, format, doc.name || 'documento')), store: false });
  }
  if (entries.length === 0) throw new Error('No hay documentos completados para exportar.');
  return { filename: 'ocr-export.zip', data: new Uint8Array(buildZip(entries)) };
}
