// Nodus Translate — shared IPC and renderer contracts.
//
// The translation workspace is deliberately separate from Nodus Convert: AI work is
// long-running, cancellable and source-aware (plain text, disk files or a Zotero
// attachment). Keeping this file dependency-free lets both Electron and React use the
// same validation-friendly shapes without exposing Node primitives to the renderer.
import type { ModelRef } from './types';

export type TranslateInputKind = 'text' | 'files' | 'zotero';
export type TranslatePdfMode = 'reflow' | 'facsimile';
export type TranslateOutputFormat = 'same' | 'txt' | 'md' | 'html' | 'docx' | 'epub' | 'pdf';
export type TranslateMarkupKind = 'plain' | 'markdown' | 'html' | 'xml';

export interface TranslateZoteroSource {
  itemKey: string;
  attachmentKey: string;
  libraryType: 'user' | 'group';
  libraryId: string;
  title: string;
}

export interface TranslateJobRequest {
  inputKind: TranslateInputKind;
  text?: string;
  inputPaths?: string[];
  zotero?: TranslateZoteroSource;
  /** Empty/undefined means automatic source-language detection by the model. */
  sourceLanguage?: string | null;
  /** Stable language code from TRANSLATION_LANGUAGES. */
  targetLanguage: string;
  model: ModelRef | null;
  outputFormat: TranslateOutputFormat;
  pdfMode: TranslatePdfMode;
  /** Use page vision for scanned PDFs and text baked into images. */
  translateImageText: boolean;
  /** A user-maintained term list, one source=target pair per line. */
  glossary?: string;
  /** null writes beside each disk source; Zotero defaults to Downloads. */
  outputDir: string | null;
  openFolderOnDone: boolean;
}

export type TranslateJobStage =
  | 'resolving'
  | 'extracting'
  | 'translating'
  | 'rendering'
  | 'writing'
  | 'done';

export interface TranslateJobProgress {
  jobId: string;
  stage: TranslateJobStage;
  currentFile: string | null;
  fileIndex: number;
  fileTotal: number;
  unitDone: number;
  unitTotal: number;
  /** Monotonic overall progress (0..1). */
  pct: number;
  message: string;
  cancelled: boolean;
}

export interface TranslateOutputResult {
  sourcePath: string | null;
  outputPath: string;
  format: Exclude<TranslateOutputFormat, 'same'>;
  pageCount?: number;
  /** 1-based pages whose translated text needed aggressive fitting or clipping. */
  overflowPages: number[];
  warnings: string[];
}

export interface TranslateJobResult {
  jobId: string;
  cancelled: boolean;
  /** Only populated for a pasted-text job. */
  translatedText: string | null;
  outputs: TranslateOutputResult[];
  warnings: string[];
}

/** One locally persisted result in the Translate history. Source text is never
 * stored; pasted-text entries keep only the translated result so they can be
 * copied again. File entries point at their generated output on disk. */
export interface TranslateHistoryEntry {
  id: string;
  createdAt: string;
  inputKind: TranslateInputKind;
  sourceLabel: string;
  sourcePath: string | null;
  targetLanguage: string;
  targetLanguageLabel: string;
  model: ModelRef;
  pdfMode: TranslatePdfMode | null;
  outputPath: string | null;
  outputExists: boolean;
  format: Exclude<TranslateOutputFormat, 'same'> | null;
  pageCount?: number;
  overflowPages: number[];
  warnings: string[];
  translatedText: string | null;
}

/** Internal segment shape is exported so the deterministic test harness can drive
 * the exact batching/parser code with a fake model. */
export interface TranslateSegment {
  id: string;
  text: string;
  kind: TranslateMarkupKind;
}

export interface TranslateSegmentResult extends TranslateSegment {
  translated: string;
}
