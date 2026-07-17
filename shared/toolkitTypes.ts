// Nodus Toolkit — shared type surface and the pure operation catalogue.
//
// This module is imported by BOTH the renderer (to build the Nodus Convert UI:
// which categories/operations exist, which target formats and options an
// operation offers) and the main process (to validate + dispatch a job). It is
// therefore pure metadata: no operation implementation, no Node/Electron
// imports, no heavy libraries. Labels are Spanish i18n keys (like navigation.ts
// labels), wrapped with `t()` by the renderer.

/** Top-level tabs in the Nodus Convert sidebar, in render order. */
export type ToolkitCategory = 'documents' | 'pdf' | 'ocr' | 'images' | 'text';

/** Stable identifier for every operation. Persisted in "recent jobs", so never rename. */
export type ToolkitOpId =
  // A — documents
  | 'pdf-to-txt'
  | 'pdf-to-md'
  | 'docx-to-text'
  | 'text-to-docx'
  | 'text-to-pdf'
  | 'epub-to-text'
  | 'md-to-epub'
  // B — PDF utilities
  | 'pdf-merge'
  | 'pdf-split'
  | 'pdf-rotate'
  | 'pdf-reorder'
  | 'pdf-extract-images'
  | 'images-to-pdf'
  | 'pdf-metadata'
  | 'pdf-to-images'
  | 'pdf-compress'
  | 'pdf-grayscale'
  | 'pdf-page-numbers'
  | 'pdf-watermark'
  | 'pdf-crop'
  // C — OCR
  | 'ocr-image-to-txt'
  | 'ocr-pdf-to-txt'
  | 'ocr-pdf-searchable'
  | 'image-preprocess'
  // D — images
  | 'image-convert'
  | 'heic-convert'
  | 'image-resize'
  | 'image-compress'
  | 'image-crop'
  | 'image-rotate'
  | 'image-watermark'
  // E — text
  | 'text-clean-pdf-paste'
  | 'text-change-case'
  | 'subtitles-to-txt'
  | 'file-checksum';

/** A concrete output target of an operation. When an operation offers more than
 *  one, the UI shows a "target format" select. `ext` is the file extension
 *  (without the dot) the produced file carries. */
export interface ToolkitOutput {
  format: string;
  ext: string;
  /** Short i18n label shown in the target-format select, e.g. "Markdown". */
  label: string;
}

export type ToolkitOptionType = 'select' | 'text' | 'number' | 'boolean';

/** A single user-facing option for an operation, rendered generically by the UI. */
export interface ToolkitOptionField {
  key: string;
  /** ES i18n key for the field label. */
  label: string;
  type: ToolkitOptionType;
  default: string | number | boolean;
  /** For `select` — value is stored, label is an ES i18n key. */
  choices?: Array<{ value: string; label: string }>;
  /** ES i18n key for a placeholder / helper hint. */
  placeholder?: string;
  min?: number;
  max?: number;
}

/**
 * How an operation maps inputs to outputs:
 *  - `each`  — N inputs → N (or more) outputs, one run per input (bulk).
 *  - `merge` — N inputs → a single named output (e.g. merge PDFs, images→PDF).
 */
export type ToolkitArity = 'each' | 'merge';

/** Pure descriptor of one operation. No implementation lives here. */
export interface ToolkitOp {
  id: ToolkitOpId;
  category: ToolkitCategory;
  /** Short ES i18n key, a "De → A" phrase, e.g. "PDF → texto". */
  label: string;
  /** Optional longer ES i18n description shown under the operation. */
  description?: string;
  /** Accepted input extensions (lowercase, no dot). Empty = any file. */
  inputExts: string[];
  /** At least one; more than one → the UI offers a target-format choice. */
  outputs: ToolkitOutput[];
  arity: ToolkitArity;
  /** Minimum number of inputs (default 1; merge operations usually 2). */
  minInputs?: number;
  options?: ToolkitOptionField[];
  /** When true this operation reaches the network (Tesseract language download). */
  usesNetwork?: boolean;
}

/** A produced output file, returned by an operation implementation. The job
 *  engine — not the operation — decides the final path (destination folder,
 *  base name, anti-collision suffix) and writes it atomically. */
export interface ToolkitProduced {
  data: Uint8Array;
  /** Output extension without the dot; overrides the op's declared output ext. */
  ext: string;
  /** Overrides the base name derived from the input file. */
  suggestedBaseName?: string;
  /** Appended to the base name before the extension, e.g. "-p03" or " (texto)". */
  suffix?: string;
}

export type ToolkitFileStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled';

export interface ToolkitFileProgress {
  inputPath: string;
  status: ToolkitFileStatus;
  /** Within-file progress 0..1 when known (e.g. OCR page k/n), else null. */
  pct: number | null;
  /** Paths written for this input, once done. */
  outputPaths: string[];
  /** Human-readable, already-localised error (never a stack trace). */
  error: string | null;
}

export interface ToolkitJobRequest {
  opId: ToolkitOpId;
  inputPaths: string[];
  /** Which of the operation's `outputs` the user picked; null when single. */
  outputFormat: string | null;
  options: Record<string, string | number | boolean>;
  /** Destination folder, or null to write beside each original. */
  outputDir: string | null;
  /** Base name for a `merge` operation's single output (without extension). */
  mergedName: string | null;
  /** Package every produced output into one .zip instead of writing loose files. */
  zipOutput: boolean;
  /** Base name (without extension) for the packaged zip. */
  zipName: string | null;
  openFolderOnDone: boolean;
}

export interface ToolkitJobProgress {
  jobId: string;
  files: ToolkitFileProgress[];
  /** Index into `files` currently processing, or -1. */
  activeIndex: number;
  done: number;
  total: number;
  cancelled: boolean;
  finished: boolean;
}

export interface ToolkitJobResult {
  jobId: string;
  files: ToolkitFileProgress[];
  cancelled: boolean;
  /** Path of the packaged zip when the job requested zipOutput; else null. */
  zipPath: string | null;
}

// ── Catalogue ────────────────────────────────────────────────────────────────
//
// The single source of truth for which operations exist and how the UI renders
// them. Implementations are wired in electron/toolkit/convert/index.ts, keyed by
// the same ids. Operations are added here phase by phase.

const OCR_LANG_OPTION: ToolkitOptionField = {
  key: 'languages',
  label: 'Idiomas de OCR',
  type: 'text',
  default: 'spa+eng',
  placeholder: 'p. ej. spa+eng',
};

export const TOOLKIT_OPS: ToolkitOp[] = [
  // ── A. Documents ───────────────────────────────────────────────────────────
  {
    id: 'pdf-to-txt',
    category: 'documents',
    label: 'PDF → texto',
    inputExts: ['pdf'],
    outputs: [{ format: 'txt', ext: 'txt', label: 'Texto (.txt)' }],
    arity: 'each',
  },
  {
    id: 'pdf-to-md',
    category: 'documents',
    label: 'PDF → Markdown',
    inputExts: ['pdf'],
    outputs: [{ format: 'md', ext: 'md', label: 'Markdown (.md)' }],
    arity: 'each',
  },
  {
    id: 'docx-to-text',
    category: 'documents',
    label: 'DOCX → Markdown, HTML o texto',
    inputExts: ['docx'],
    outputs: [
      { format: 'md', ext: 'md', label: 'Markdown (.md)' },
      { format: 'html', ext: 'html', label: 'HTML (.html)' },
      { format: 'txt', ext: 'txt', label: 'Texto (.txt)' },
    ],
    arity: 'each',
  },
  {
    id: 'text-to-docx',
    category: 'documents',
    label: 'Markdown o HTML → DOCX',
    inputExts: ['md', 'markdown', 'html', 'htm'],
    outputs: [{ format: 'docx', ext: 'docx', label: 'Word (.docx)' }],
    arity: 'each',
  },
  {
    id: 'text-to-pdf',
    category: 'documents',
    label: 'Markdown o HTML → PDF',
    description: 'Re-maquetación con el estilo de Nodus (no reproduce el formato original de Word).',
    inputExts: ['md', 'markdown', 'html', 'htm'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'each',
  },
  {
    id: 'epub-to-text',
    category: 'documents',
    label: 'EPUB → Markdown o texto',
    inputExts: ['epub'],
    outputs: [
      { format: 'md', ext: 'md', label: 'Markdown (.md)' },
      { format: 'txt', ext: 'txt', label: 'Texto (.txt)' },
    ],
    arity: 'each',
  },
  {
    id: 'md-to-epub',
    category: 'documents',
    label: 'Markdown → EPUB',
    inputExts: ['md', 'markdown'],
    outputs: [{ format: 'epub', ext: 'epub', label: 'EPUB (.epub)' }],
    arity: 'each',
  },

  // ── B. PDF utilities ─────────────────────────────────────────────────────────
  {
    id: 'pdf-merge',
    category: 'pdf',
    label: 'Unir PDFs',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'merge',
    minInputs: 2,
  },
  {
    id: 'pdf-split',
    category: 'pdf',
    label: 'Dividir o extraer páginas',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'each',
    options: [
      {
        key: 'ranges',
        label: 'Páginas o rangos',
        type: 'text',
        default: '',
        placeholder: 'p. ej. 1-3,5,8-10 (vacío = todas)',
      },
      {
        key: 'mode',
        label: 'Salida',
        type: 'select',
        default: 'single',
        choices: [
          { value: 'single', label: 'Un solo PDF con las páginas elegidas' },
          { value: 'perPage', label: 'Un PDF por página' },
        ],
      },
    ],
  },
  {
    id: 'pdf-rotate',
    category: 'pdf',
    label: 'Rotar páginas',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'each',
    options: [
      {
        key: 'angle',
        label: 'Grados',
        type: 'select',
        default: '90',
        choices: [
          { value: '90', label: '90° a la derecha' },
          { value: '180', label: '180°' },
          { value: '270', label: '90° a la izquierda' },
        ],
      },
      {
        key: 'ranges',
        label: 'Páginas o rangos',
        type: 'text',
        default: '',
        placeholder: 'p. ej. 1-3,5 (vacío = todas)',
      },
    ],
  },
  {
    id: 'pdf-reorder',
    category: 'pdf',
    label: 'Reordenar o eliminar páginas',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'each',
    options: [
      {
        key: 'order',
        label: 'Nuevo orden de páginas',
        type: 'text',
        default: '',
        placeholder: 'p. ej. 3,1,2 (omite las que no aparezcan)',
      },
    ],
  },
  {
    id: 'pdf-extract-images',
    category: 'pdf',
    label: 'Extraer imágenes incrustadas',
    inputExts: ['pdf'],
    outputs: [{ format: 'png', ext: 'png', label: 'PNG (.png)' }],
    arity: 'each',
  },
  {
    id: 'images-to-pdf',
    category: 'pdf',
    label: 'Imágenes → PDF',
    inputExts: ['png', 'jpg', 'jpeg'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'merge',
    minInputs: 1,
    options: [
      {
        key: 'pageSize',
        label: 'Tamaño de página',
        type: 'select',
        default: 'fit',
        choices: [
          { value: 'fit', label: 'Ajustar a la imagen' },
          { value: 'a4', label: 'A4' },
          { value: 'letter', label: 'Carta (Letter)' },
        ],
      },
      {
        key: 'orientation',
        label: 'Orientación',
        type: 'select',
        default: 'auto',
        choices: [
          { value: 'auto', label: 'Automática' },
          { value: 'portrait', label: 'Vertical' },
          { value: 'landscape', label: 'Horizontal' },
        ],
      },
      { key: 'margin', label: 'Margen (pt)', type: 'number', default: 0, min: 0, max: 200 },
    ],
  },
  {
    id: 'pdf-to-images',
    category: 'pdf',
    label: 'PDF → imágenes (una por página)',
    inputExts: ['pdf'],
    outputs: [
      { format: 'jpeg', ext: 'jpg', label: 'JPEG (.jpg)' },
      { format: 'png', ext: 'png', label: 'PNG (.png)' },
    ],
    arity: 'each',
    options: [
      { key: 'dpi', label: 'Resolución (ppp)', type: 'number', default: 150, min: 36, max: 600 },
      { key: 'quality', label: 'Calidad (JPEG)', type: 'number', default: 90, min: 1, max: 100 },
    ],
  },
  {
    id: 'pdf-compress',
    category: 'pdf',
    label: 'Comprimir PDF',
    description: 'Rasteriza cada página a JPEG (con pérdida). Ideal para PDF escaneados.',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'each',
    options: [
      {
        key: 'quality',
        label: 'Nivel',
        type: 'select',
        default: '70',
        choices: [
          { value: '40', label: 'Compresión alta' },
          { value: '70', label: 'Compresión media' },
          { value: '85', label: 'Compresión baja' },
        ],
      },
      { key: 'dpi', label: 'Resolución (ppp)', type: 'number', default: 150, min: 36, max: 400 },
    ],
  },
  {
    id: 'pdf-grayscale',
    category: 'pdf',
    label: 'PDF a escala de grises',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'each',
    options: [{ key: 'dpi', label: 'Resolución (ppp)', type: 'number', default: 150, min: 36, max: 400 }],
  },
  {
    id: 'pdf-page-numbers',
    category: 'pdf',
    label: 'Añadir números de página',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'each',
    options: [
      {
        key: 'position',
        label: 'Posición',
        type: 'select',
        default: 'bottom-center',
        choices: [
          { value: 'bottom-center', label: 'Abajo centro' },
          { value: 'bottom-right', label: 'Abajo derecha' },
          { value: 'bottom-left', label: 'Abajo izquierda' },
          { value: 'top-center', label: 'Arriba centro' },
          { value: 'top-right', label: 'Arriba derecha' },
          { value: 'top-left', label: 'Arriba izquierda' },
        ],
      },
      { key: 'start', label: 'Empezar en', type: 'number', default: 1, min: 0, max: 100000 },
      { key: 'fontSize', label: 'Tamaño', type: 'number', default: 11, min: 6, max: 48 },
    ],
  },
  {
    id: 'pdf-watermark',
    category: 'pdf',
    label: 'Marca de agua',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'each',
    options: [
      { key: 'text', label: 'Texto', type: 'text', default: 'BORRADOR', placeholder: 'p. ej. CONFIDENCIAL' },
      { key: 'opacity', label: 'Opacidad', type: 'number', default: 0.2, min: 0.05, max: 0.9 },
      { key: 'angle', label: 'Ángulo', type: 'number', default: 45, min: -90, max: 90 },
    ],
  },
  {
    id: 'pdf-crop',
    category: 'pdf',
    label: 'Recortar márgenes',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'each',
    options: [{ key: 'margin', label: 'Margen a recortar (pt)', type: 'number', default: 20, min: 0, max: 400 }],
  },
  {
    id: 'pdf-metadata',
    category: 'pdf',
    label: 'Editar metadatos',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF (.pdf)' }],
    arity: 'each',
    options: [
      { key: 'title', label: 'Título', type: 'text', default: '', placeholder: 'Dejar vacío para no cambiar' },
      { key: 'author', label: 'Autor', type: 'text', default: '', placeholder: 'Dejar vacío para no cambiar' },
      { key: 'subject', label: 'Tema', type: 'text', default: '', placeholder: 'Dejar vacío para no cambiar' },
      { key: 'keywords', label: 'Palabras clave', type: 'text', default: '', placeholder: 'Separadas por comas' },
    ],
  },

  // ── C. OCR ───────────────────────────────────────────────────────────────────
  {
    id: 'ocr-image-to-txt',
    category: 'ocr',
    label: 'Imagen → texto (OCR)',
    inputExts: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp'],
    outputs: [{ format: 'txt', ext: 'txt', label: 'Texto (.txt)' }],
    arity: 'each',
    usesNetwork: true,
    options: [OCR_LANG_OPTION],
  },
  {
    id: 'ocr-pdf-to-txt',
    category: 'ocr',
    label: 'PDF escaneado → texto (OCR)',
    inputExts: ['pdf'],
    outputs: [{ format: 'txt', ext: 'txt', label: 'Texto (.txt)' }],
    arity: 'each',
    usesNetwork: true,
    options: [OCR_LANG_OPTION],
  },
  {
    id: 'ocr-pdf-searchable',
    category: 'ocr',
    label: 'PDF escaneado → PDF buscable',
    description: 'Añade una capa de texto invisible sobre el escaneado, sin alterar su aspecto.',
    inputExts: ['pdf'],
    outputs: [{ format: 'pdf', ext: 'pdf', label: 'PDF buscable (.pdf)' }],
    arity: 'each',
    usesNetwork: true,
    options: [OCR_LANG_OPTION],
  },
  {
    id: 'image-preprocess',
    category: 'ocr',
    label: 'Preprocesar imagen para OCR',
    inputExts: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp'],
    outputs: [{ format: 'png', ext: 'png', label: 'PNG (.png)' }],
    arity: 'each',
    options: [
      {
        key: 'mode',
        label: 'Método',
        type: 'select',
        default: 'grayscale',
        choices: [
          { value: 'grayscale', label: 'Escala de grises' },
          { value: 'binarize', label: 'Binarizar (Otsu)' },
        ],
      },
    ],
  },

  // ── D. Images ────────────────────────────────────────────────────────────────
  {
    id: 'image-convert',
    category: 'images',
    label: 'Convertir formato de imagen',
    inputExts: ['png', 'jpg', 'jpeg', 'webp'],
    outputs: [
      { format: 'png', ext: 'png', label: 'PNG (.png)' },
      { format: 'jpeg', ext: 'jpg', label: 'JPEG (.jpg)' },
      { format: 'webp', ext: 'webp', label: 'WebP (.webp)' },
    ],
    arity: 'each',
    options: [
      { key: 'quality', label: 'Calidad (JPEG/WebP)', type: 'number', default: 90, min: 1, max: 100 },
    ],
  },
  {
    id: 'heic-convert',
    category: 'images',
    label: 'HEIC → JPEG o PNG',
    inputExts: ['heic', 'heif'],
    outputs: [
      { format: 'jpeg', ext: 'jpg', label: 'JPEG (.jpg)' },
      { format: 'png', ext: 'png', label: 'PNG (.png)' },
    ],
    arity: 'each',
    options: [
      { key: 'quality', label: 'Calidad (JPEG)', type: 'number', default: 90, min: 1, max: 100 },
    ],
  },
  {
    id: 'image-resize',
    category: 'images',
    label: 'Redimensionar imágenes',
    inputExts: ['png', 'jpg', 'jpeg', 'webp'],
    outputs: [{ format: 'same', ext: 'png', label: 'Mismo formato' }],
    arity: 'each',
    options: [
      {
        key: 'mode',
        label: 'Ajuste',
        type: 'select',
        default: 'maxSide',
        choices: [
          { value: 'maxSide', label: 'Lado máximo (px)' },
          { value: 'percent', label: 'Porcentaje (%)' },
        ],
      },
      { key: 'value', label: 'Valor', type: 'number', default: 1600, min: 1, max: 20000 },
    ],
  },
  {
    id: 'image-compress',
    category: 'images',
    label: 'Comprimir imágenes',
    inputExts: ['png', 'jpg', 'jpeg', 'webp'],
    outputs: [
      { format: 'jpeg', ext: 'jpg', label: 'JPEG (.jpg)' },
      { format: 'webp', ext: 'webp', label: 'WebP (.webp)' },
    ],
    arity: 'each',
    options: [
      { key: 'quality', label: 'Calidad', type: 'number', default: 70, min: 1, max: 100 },
    ],
  },
  {
    id: 'image-crop',
    category: 'images',
    label: 'Recortar imagen (proporción)',
    inputExts: ['png', 'jpg', 'jpeg', 'webp'],
    outputs: [{ format: 'same', ext: 'png', label: 'Mismo formato' }],
    arity: 'each',
    options: [
      {
        key: 'aspect',
        label: 'Proporción',
        type: 'select',
        default: '1:1',
        choices: [
          { value: '1:1', label: 'Cuadrado (1:1)' },
          { value: '4:3', label: '4:3' },
          { value: '3:2', label: '3:2' },
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: 'Vertical (9:16)' },
        ],
      },
    ],
  },
  {
    id: 'image-rotate',
    category: 'images',
    label: 'Rotar o voltear imagen',
    inputExts: ['png', 'jpg', 'jpeg', 'webp'],
    outputs: [{ format: 'same', ext: 'png', label: 'Mismo formato' }],
    arity: 'each',
    options: [
      {
        key: 'transform',
        label: 'Transformación',
        type: 'select',
        default: 'rotate90',
        choices: [
          { value: 'rotate90', label: '90° a la derecha' },
          { value: 'rotate270', label: '90° a la izquierda' },
          { value: 'rotate180', label: '180°' },
          { value: 'flipH', label: 'Voltear horizontal' },
          { value: 'flipV', label: 'Voltear vertical' },
        ],
      },
    ],
  },
  {
    id: 'image-watermark',
    category: 'images',
    label: 'Marca de agua en imagen',
    inputExts: ['png', 'jpg', 'jpeg', 'webp'],
    outputs: [{ format: 'same', ext: 'png', label: 'Mismo formato' }],
    arity: 'each',
    options: [
      { key: 'text', label: 'Texto', type: 'text', default: 'BORRADOR', placeholder: 'p. ej. © Mi Nombre' },
      { key: 'opacity', label: 'Opacidad', type: 'number', default: 0.35, min: 0.05, max: 0.9 },
      {
        key: 'position',
        label: 'Posición',
        type: 'select',
        default: 'bottom-right',
        choices: [
          { value: 'bottom-right', label: 'Abajo derecha' },
          { value: 'top-left', label: 'Arriba izquierda' },
          { value: 'center', label: 'Centro' },
          { value: 'tile', label: 'Mosaico' },
        ],
      },
    ],
  },

  // ── E. Text ──────────────────────────────────────────────────────────────────
  {
    id: 'text-clean-pdf-paste',
    category: 'text',
    label: 'Limpiar texto pegado de PDF',
    inputExts: ['txt', 'md', 'markdown'],
    outputs: [{ format: 'txt', ext: 'txt', label: 'Texto (.txt)' }],
    arity: 'each',
  },
  {
    id: 'text-change-case',
    category: 'text',
    label: 'Cambiar mayúsculas y minúsculas',
    inputExts: ['txt', 'md', 'markdown'],
    outputs: [{ format: 'txt', ext: 'txt', label: 'Texto (.txt)' }],
    arity: 'each',
    options: [
      {
        key: 'mode',
        label: 'Formato',
        type: 'select',
        default: 'sentence',
        choices: [
          { value: 'sentence', label: 'Tipo oración' },
          { value: 'title', label: 'Tipo título' },
          { value: 'upper', label: 'MAYÚSCULAS' },
          { value: 'lower', label: 'minúsculas' },
        ],
      },
    ],
  },
  {
    id: 'subtitles-to-txt',
    category: 'text',
    label: 'Subtítulos (SRT/VTT) → texto',
    inputExts: ['srt', 'vtt'],
    outputs: [{ format: 'txt', ext: 'txt', label: 'Texto (.txt)' }],
    arity: 'each',
  },
  {
    id: 'file-checksum',
    category: 'text',
    label: 'Calcular checksum (SHA-256 / MD5)',
    inputExts: [],
    outputs: [{ format: 'txt', ext: 'txt', label: 'Checksums (.txt)' }],
    arity: 'each',
    options: [
      {
        key: 'algorithm',
        label: 'Algoritmo',
        type: 'select',
        default: 'sha256',
        choices: [
          { value: 'sha256', label: 'SHA-256' },
          { value: 'md5', label: 'MD5' },
          { value: 'both', label: 'Ambos' },
        ],
      },
    ],
  },
];

export const TOOLKIT_CATEGORIES: Array<{ id: ToolkitCategory; label: string }> = [
  { id: 'documents', label: 'Documentos' },
  { id: 'pdf', label: 'PDF' },
  { id: 'ocr', label: 'OCR' },
  { id: 'images', label: 'Imágenes' },
  { id: 'text', label: 'Texto' },
];

export function toolkitOp(id: ToolkitOpId): ToolkitOp | undefined {
  return TOOLKIT_OPS.find((op) => op.id === id);
}

/** Lowercase extension without the dot, e.g. "foo.PDF" → "pdf". */
export function fileExtLower(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (dot <= slash + 1) return '';
  return filePath.slice(dot + 1).toLowerCase();
}

/**
 * Operations applicable to a set of already-added files. An operation matches
 * when EVERY input file's extension is accepted (or the op accepts any file).
 * With no files, nothing is offered. This drives the "De → A" select.
 */
export function opsForInputs(inputPaths: string[], category?: ToolkitCategory): ToolkitOp[] {
  if (inputPaths.length === 0) return [];
  const exts = inputPaths.map(fileExtLower);
  return TOOLKIT_OPS.filter((op) => {
    if (category && op.category !== category) return false;
    if ((op.minInputs ?? 1) > inputPaths.length) return false;
    if (op.inputExts.length === 0) return true;
    return exts.every((ext) => op.inputExts.includes(ext));
  });
}

/** Default option values for an operation, ready to seed the UI state. */
export function defaultOptions(op: ToolkitOp): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const field of op.options ?? []) out[field.key] = field.default;
  return out;
}
