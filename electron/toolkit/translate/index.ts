// Nodus Translate — Electron/main-process orchestration.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { app } from 'electron';
import { completeJson, completeTextNeutral } from '../../ai/aiClient';
import { getSettings } from '../../db/settingsRepo';
import { htmlToPdfBytes } from '../../export/htmlToPdf';
import * as zotero from '../../zotero/zoteroClient';
import { markdownToHtml, escapeHtml } from '@shared/toolkitMarkdown';
import { TRANSLATION_LANGUAGES, type ModelRef } from '@shared/types';
import type {
  TranslateJobProgress,
  TranslateJobRequest,
  TranslateJobResult,
  TranslateOutputFormat,
  TranslateOutputResult,
  TranslateSegment,
  TranslateSegmentResult,
} from '@shared/toolkitTranslateTypes';
import { DEFAULT_OCR_OPTIONS, type OcrPageResult } from '@shared/aiOcrTypes';
import { ocrPageImage, type OcrModelCall } from '../aiOcr/engine';
import { rasterizePdf } from '../aiOcr/rasterize';
import { pageToMarkdown } from '@shared/aiOcrReconstruct';
import { buildFacsimilePdf, extractPdfMarkdown } from './facsimile';
import {
  translateDocxBytes,
  translateEpubBytes,
  translateHtmlDocument,
  translateMarkdownDocument,
  translatePlainDocument,
  type StructuredTranslateOptions,
} from './documents';
import { translateSegments } from './segments';
import { addTranslateHistory } from './history';

export interface TranslateSignal { cancelled: boolean }

export interface RunTranslateOptions {
  signal?: TranslateSignal;
  onProgress?: (progress: TranslateJobProgress) => void;
}

interface TranslatedFile {
  data: Uint8Array;
  ext: Exclude<TranslateOutputFormat, 'same'>;
  pageCount?: number;
  overflowPages: number[];
  warnings: string[];
}

const ACCEPTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.html', '.htm', '.docx', '.epub', '.pdf']);

function resolveModel(explicit: ModelRef | null): ModelRef {
  if (explicit?.provider && explicit.model) return explicit;
  const settings = getSettings();
  const fallback = settings.synthesisModel;
  if (fallback?.provider && fallback.model) return fallback;
  if (process.env.NODUS_E2E_TRANSLATE_FAKE === '1') return { provider: 'lmstudio', model: 'nodus-e2e-translate' };
  throw new Error('No hay un modelo de traducción configurado. Elige un modelo antes de continuar.');
}

function fakeTranslateResponse(user: string): string {
  // Deterministic offline translation for the E2E harness only. Sentinels and markup
  // remain untouched so the test exercises the exact production parser and adapters.
  return user
    .replace(/Título Principal/g, 'Main Title')
    .replace(/Titulo Principal/g, 'Main Title')
    .replace(/Introducción/g, 'Introduction')
    .replace(/Introduccion/g, 'Introduction')
    .replace(/Este es un documento de prueba\./g, 'This is a test document.')
    .replace(/Un párrafo con texto para traducir\./g, 'A paragraph with text to translate.')
    .replace(/Un parrafo con texto para traducir\./g, 'A paragraph with text to translate.')
    .replace(/Página/g, 'Page')
    .replace(/Pagina/g, 'Page');
}

function printableHtml(body: string, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4; margin: 18mm 18mm 20mm; }
    body { margin: 0; color: #171717; font: 11.5pt/1.55 Georgia, 'Times New Roman', serif; }
    h1,h2,h3,h4,h5,h6 { break-after: avoid; color: #111827; font-family: Arial, sans-serif; line-height: 1.2; }
    h1 { font-size: 24pt; } h2 { font-size: 18pt; } h3 { font-size: 14pt; }
    p, li, blockquote { orphans: 3; widows: 3; }
    img, svg { max-width: 100%; height: auto; break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; break-inside: avoid; }
    th, td { border: 1px solid #aaa; padding: 5px 7px; vertical-align: top; }
    blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid #cbd5e1; color: #475569; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  </style></head><body>${body}</body></html>`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function epubHtml(bytes: Uint8Array): string {
  const zip = new AdmZip(Buffer.from(bytes));
  return zip.getEntries()
    .filter((entry) => !entry.isDirectory && /\.(xhtml|html?)$/i.test(entry.entryName))
    .map((entry) => entry.getData().toString('utf8').replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, ''))
    .join('\n<hr>\n');
}

function safeStem(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/[\\/:*?"<>|]/g, '_').trim() || 'documento';
}

function targetPath(sourcePath: string, outputDir: string, targetLanguage: string, ext: string): string {
  const base = `${safeStem(sourcePath)} (${targetLanguage})`;
  let candidate = path.join(outputDir, `${base}.${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) candidate = path.join(outputDir, `${base} (${index++}).${ext}`);
  return candidate;
}

function writeAtomic(target: string, data: Uint8Array): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${crypto.randomBytes(5).toString('hex')}`;
  try {
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

async function resolveInputs(request: TranslateJobRequest): Promise<string[]> {
  if (request.inputKind === 'files') return [...new Set(request.inputPaths ?? [])];
  if (request.inputKind !== 'zotero' || !request.zotero) return [];
  const source = request.zotero;
  const file = await zotero.attachmentFilePath(getSettings().zoteroUserId, source.attachmentKey);
  if (!file) throw new Error('Zotero no devolvió una ruta local para el adjunto seleccionado. Comprueba que el archivo esté descargado.');
  return [file];
}

function translatedExt(sourceExt: string, requested: TranslateOutputFormat, pdfMode: TranslateJobRequest['pdfMode']): Exclude<TranslateOutputFormat, 'same'> {
  if (requested !== 'same') return requested;
  if (sourceExt === '.markdown') return 'md';
  if (sourceExt === '.htm') return 'html';
  if (sourceExt === '.pdf' && pdfMode === 'reflow') return 'pdf';
  return sourceExt.slice(1) as Exclude<TranslateOutputFormat, 'same'>;
}

async function translatedDocxConversions(bytes: Uint8Array, ext: Exclude<TranslateOutputFormat, 'same'>, title: string): Promise<Uint8Array> {
  if (ext === 'docx') return bytes;
  const mammoth: any = await import('mammoth');
  if (ext === 'txt') return new TextEncoder().encode(String((await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value ?? ''));
  const html = String((await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value ?? '');
  if (ext === 'html') return new TextEncoder().encode(printableHtml(html, title));
  if (ext === 'md') return new TextEncoder().encode(stripHtml(html));
  if (ext === 'pdf') return new Uint8Array(await htmlToPdfBytes(printableHtml(html, title)));
  throw new Error(`No se puede exportar un DOCX traducido como .${ext}.`);
}

async function translatedEpubConversions(bytes: Uint8Array, ext: Exclude<TranslateOutputFormat, 'same'>, title: string): Promise<Uint8Array> {
  if (ext === 'epub') return bytes;
  const html = epubHtml(bytes);
  if (ext === 'html') return new TextEncoder().encode(printableHtml(html, title));
  if (ext === 'txt' || ext === 'md') return new TextEncoder().encode(stripHtml(html));
  if (ext === 'pdf') return new Uint8Array(await htmlToPdfBytes(printableHtml(html, title)));
  throw new Error(`No se puede exportar un EPUB traducido como .${ext}.`);
}

async function translatedTextConversions(
  translated: string,
  sourceKind: 'plain' | 'markdown' | 'html',
  ext: Exclude<TranslateOutputFormat, 'same'>,
  title: string,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  if (ext === 'txt') return enc.encode(sourceKind === 'html' ? stripHtml(translated) : translated);
  if (ext === 'md') return enc.encode(sourceKind === 'html' ? stripHtml(translated) : translated);
  if (sourceKind === 'html' && ext === 'html') return enc.encode(translated);
  if (sourceKind === 'html' && ext === 'pdf') return new Uint8Array(await htmlToPdfBytes(translated));
  const body = sourceKind === 'html' ? translated : sourceKind === 'markdown' ? markdownToHtml(translated) : `<p>${escapeHtml(translated).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
  if (ext === 'html') return enc.encode(printableHtml(body, title));
  if (ext === 'pdf') return new Uint8Array(await htmlToPdfBytes(printableHtml(body, title)));
  throw new Error(`La conversión de texto traducido a .${ext} no está disponible.`);
}

async function translateFile(
  inputPath: string,
  request: TranslateJobRequest,
  structured: StructuredTranslateOptions,
  translate: (segments: TranslateSegment[]) => Promise<TranslateSegmentResult[]>,
  vision: (page: { buffer: Buffer; mediaType: string; width: number; height: number; pageNumber: number }) => Promise<OcrPageResult>,
  signal: TranslateSignal,
  onStage: (stage: TranslateJobProgress['stage'], done?: number, total?: number) => void,
): Promise<TranslatedFile> {
  const sourceExt = path.extname(inputPath).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.has(sourceExt)) throw new Error(`Formato no compatible: ${sourceExt || '(sin extensión)'}.`);
  const ext = translatedExt(sourceExt, request.outputFormat, request.pdfMode);
  const title = safeStem(inputPath);
  const bytes = new Uint8Array(fs.readFileSync(inputPath));
  const warnings: string[] = [];
  const withWarning = { ...structured, onWarning: (message: string) => { warnings.push(message); structured.onWarning?.(message); } };

  if (sourceExt === '.pdf' && request.pdfMode === 'facsimile') {
    if (ext !== 'pdf') throw new Error('El modo facsímil solo puede exportarse como PDF.');
    const result = await buildFacsimilePdf(inputPath, {
      translate,
      translatePageImage: vision,
      translateImageText: request.translateImageText,
      signal,
      onProgress: (progress) => onStage(progress.stage, progress.done, progress.total),
    });
    return { data: result.data, ext, pageCount: result.pageCount, overflowPages: result.overflowPages, warnings: [...warnings, ...result.warnings] };
  }

  onStage('extracting');
  if (sourceExt === '.docx') {
    const translated = await translateDocxBytes(bytes, withWarning);
    return { data: await translatedDocxConversions(translated, ext, title), ext, overflowPages: [], warnings };
  }
  if (sourceExt === '.epub') {
    const translated = await translateEpubBytes(bytes, withWarning);
    return { data: await translatedEpubConversions(translated, ext, title), ext, overflowPages: [], warnings };
  }
  if (sourceExt === '.pdf') {
    let markdown = request.translateImageText ? '' : await extractPdfMarkdown(inputPath, signal, (done, total) => onStage('extracting', done, total));
    let alreadyTranslated = false;
    if (!markdown.trim()) {
      const pages = await rasterizePdf(inputPath, {}, undefined, signal);
      const translatedPages: string[] = [];
      for (let index = 0; index < pages.length; index++) {
        if (signal.cancelled) break;
        translatedPages.push(pageToMarkdown(await vision(pages[index])));
        onStage('translating', index + 1, pages.length);
      }
      markdown = translatedPages.join('\n\n---\n\n');
      alreadyTranslated = true;
    }
    if (!markdown.trim()) throw new Error('No se pudo obtener texto traducible del PDF. Prueba con otro modelo de visión.');
    const translated = alreadyTranslated ? markdown : await translateMarkdownDocument(markdown, withWarning);
    return { data: await translatedTextConversions(translated, 'markdown', ext, title), ext, overflowPages: [], warnings: [...warnings, 'El modo refluido conserva la jerarquía textual, pero puede cambiar los saltos de página del PDF original.'] };
  }
  const raw = Buffer.from(bytes).toString('utf8');
  if (sourceExt === '.html' || sourceExt === '.htm') {
    const translated = await translateHtmlDocument(raw, withWarning);
    return { data: await translatedTextConversions(translated, 'html', ext, title), ext, overflowPages: [], warnings };
  }
  if (sourceExt === '.md' || sourceExt === '.markdown') {
    const translated = await translateMarkdownDocument(raw, withWarning);
    return { data: await translatedTextConversions(translated, 'markdown', ext, title), ext, overflowPages: [], warnings };
  }
  const translated = await translatePlainDocument(raw, withWarning);
  return { data: await translatedTextConversions(translated, 'plain', ext, title), ext, overflowPages: [], warnings };
}

export async function runTranslateJob(jobId: string, request: TranslateJobRequest, options: RunTranslateOptions = {}): Promise<TranslateJobResult> {
  const signal = options.signal ?? { cancelled: false };
  const language = TRANSLATION_LANGUAGES.find((item) => item.code === request.targetLanguage);
  if (!language) throw new Error(`Idioma de destino no soportado: ${request.targetLanguage}.`);
  const model = resolveModel(request.model);
  let currentFile: string | null = null;
  let fileIndex = 0;
  let fileTotal = request.inputKind === 'text' ? 1 : Math.max(1, request.inputPaths?.length ?? 1);
  let lastPct = 0;
  const emit = (stage: TranslateJobProgress['stage'], pct: number, message: string, done = 0, total = 0) => {
    lastPct = Math.max(lastPct, clampProgress(pct));
    options.onProgress?.({ jobId, stage, currentFile, fileIndex, fileTotal, unitDone: done, unitTotal: total, pct: lastPct, message, cancelled: signal.cancelled });
  };
  emit('resolving', 0.01, 'Preparando las fuentes…');

  const modelCall = async (input: { system: string; user: string; maxTokens: number; temperature: number }): Promise<string> => {
    if (signal.cancelled) return input.user;
    if (process.env.NODUS_E2E_TRANSLATE_FAKE === '1') return fakeTranslateResponse(input.user);
    return completeTextNeutral({ ...input, plainContext: true }, model);
  };
  const translateWithProgress = async (
    segments: TranslateSegment[],
    onBatchProgress: (done: number, total: number) => void,
  ): Promise<TranslateSegmentResult[]> => {
    if (!segments.length) return [];
    return translateSegments(segments, {
      targetLanguage: `${language.name} (${language.nativeName})`,
      sourceLanguage: request.sourceLanguage,
      glossary: request.glossary,
      signal,
      onProgress: onBatchProgress,
    }, modelCall);
  };
  const visionCall: OcrModelCall = {
    completeJson: (input, guard, chosen) => completeJson(input, guard, chosen),
    completeText: (input, chosen) => completeTextNeutral(input, chosen),
  };
  const vision = async (page: { buffer: Buffer; mediaType: string; width: number; height: number; pageNumber: number }): Promise<OcrPageResult> => {
    if (process.env.NODUS_E2E_TRANSLATE_FAKE === '1') return { blankPage: false, blocks: [] };
    const outcome = await ocrPageImage(
      { base64: page.buffer.toString('base64'), mediaType: page.mediaType },
      { ...DEFAULT_OCR_OPTIONS, processingMode: 'translation', targetLanguage: `${language.name} (${language.nativeName})`, removeReferences: false },
      model,
      visionCall,
    );
    return outcome.result;
  };
  if (request.inputKind === 'text') {
    const source = request.text?.trim() ?? '';
    if (!source) throw new Error('Escribe o pega un texto antes de traducir.');
    currentFile = 'Texto';
    emit('translating', 0.1, 'Traduciendo el texto…');
    const translateText = (segments: TranslateSegment[]) => translateWithProgress(segments, (done, total) =>
      emit('translating', 0.22 + 0.54 * (done / Math.max(1, total)), `Traduciendo ${done} de ${total} fragmentos…`, done, total));
    const translatedText = await translateMarkdownDocument(source, { translate: translateText });
    if (!signal.cancelled) {
      addTranslateHistory({
        inputKind: 'text', sourceLabel: 'Texto pegado', sourcePath: null,
        targetLanguage: language.code, targetLanguageLabel: language.nativeName,
        model, pdfMode: null, outputPath: null, format: 'txt', translatedText,
      });
    }
    emit('done', 1, 'Traducción completada.');
    return { jobId, cancelled: signal.cancelled, translatedText: signal.cancelled ? null : translatedText, outputs: [], warnings: [] };
  }

  const inputs = await resolveInputs(request);
  if (!inputs.length) throw new Error('Añade al menos un archivo para traducir.');
  fileTotal = inputs.length;
  const outputs: TranslateOutputResult[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < inputs.length; index++) {
    if (signal.cancelled) break;
    fileIndex = index + 1;
    currentFile = path.basename(inputs[index]);
    const fileBase = index / inputs.length;
    const fileWeight = 1 / inputs.length;
    const onStage = (stage: TranslateJobProgress['stage'], done = 0, total = 0) => {
      const stageFraction = stage === 'extracting' ? 0.12 : stage === 'translating' ? 0.55 : stage === 'rendering' ? 0.82 : 0.9;
      const unit = total > 0 ? Math.min(1, done / total) * 0.12 : 0;
      emit(stage, fileBase + fileWeight * Math.min(0.94, stageFraction + unit), `${currentFile}: ${stage === 'extracting' ? 'analizando' : stage === 'rendering' ? 'reconstruyendo' : 'traduciendo'}…`, done, total);
    };
    const translateFileSegments = (segments: TranslateSegment[]) => translateWithProgress(segments, (done, total) => onStage('translating', done, total));
    const translated = await translateFile(inputs[index], request, { translate: translateFileSegments }, translateFileSegments, vision, signal, onStage);
    if (signal.cancelled) break;
    emit('writing', fileBase + fileWeight * 0.96, `${currentFile}: guardando…`);
    const outputDir = request.outputDir || (request.inputKind === 'zotero' ? app.getPath('downloads') : path.dirname(inputs[index]));
    const outputPath = targetPath(inputs[index], outputDir, language.nativeName, translated.ext);
    writeAtomic(outputPath, translated.data);
    outputs.push({ sourcePath: inputs[index], outputPath, format: translated.ext, pageCount: translated.pageCount, overflowPages: translated.overflowPages, warnings: translated.warnings });
    addTranslateHistory({
      inputKind: request.inputKind,
      sourceLabel: request.inputKind === 'zotero' ? request.zotero?.title || currentFile : currentFile,
      sourcePath: inputs[index],
      targetLanguage: language.code,
      targetLanguageLabel: language.nativeName,
      model,
      pdfMode: path.extname(inputs[index]).toLowerCase() === '.pdf' && translated.ext === 'pdf' ? request.pdfMode : null,
      outputPath,
      format: translated.ext,
      pageCount: translated.pageCount,
      overflowPages: translated.overflowPages,
      warnings: translated.warnings,
    });
    warnings.push(...translated.warnings.map((warning) => `${path.basename(inputs[index])}: ${warning}`));
  }
  emit('done', 1, signal.cancelled ? 'Trabajo cancelado.' : 'Traducción completada.');
  return { jobId, cancelled: signal.cancelled, translatedText: null, outputs, warnings };
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export const TRANSLATE_INPUT_EXTENSIONS = ['txt', 'md', 'markdown', 'html', 'htm', 'docx', 'epub', 'pdf'] as const;

export function suggestedTextFilename(targetLanguage: string, ext = 'txt'): string {
  const safe = targetLanguage.replace(/[\\/:*?"<>|]/g, '_').trim() || 'traduccion';
  return `traduccion-${safe}.${ext}`;
}

export function tempTranslatePath(ext: string): string {
  return path.join(os.tmpdir(), `nodus-translate-${crypto.randomUUID()}.${ext.replace(/^\./, '')}`);
}
