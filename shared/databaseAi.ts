/**
 * Pure helpers for AI columns: building the row context an AI cell is computed from,
 * and a small library of preconfigured prompts. Dependency-free so the context
 * assembly is unit-tested without a database or an AI provider.
 */

import { decodeCheckbox, decodeMultiSelect } from './databases';
import type { DatabaseColumn, DatabaseRow } from './databases';

/** A preset the user can drop into an AI column's prompt. */
export interface AiColumnPreset {
  id: string;
  label: string;
  prompt: string;
  /** Hints the preset works over an attached image (vision). */
  needsImage?: boolean;
}

export const AI_COLUMN_PRESETS: AiColumnPreset[] = [
  { id: 'summary', label: 'Resumen', prompt: 'Resume el contenido de esta fila en una o dos frases claras.' },
  { id: 'classify', label: 'Clasificar', prompt: 'Clasifica esta fila en una categoría breve (una o dos palabras). Devuelve solo la categoría.' },
  { id: 'keywords', label: 'Palabras clave', prompt: 'Extrae de 3 a 5 palabras clave separadas por comas. Devuelve solo las palabras clave.' },
  { id: 'sentiment', label: 'Sentimiento', prompt: 'Indica el sentimiento del contenido: positivo, negativo o neutro. Devuelve solo una palabra.' },
  { id: 'translate_en', label: 'Traducir al inglés', prompt: 'Traduce el contenido principal de esta fila al inglés. Devuelve solo la traducción.' },
  { id: 'describe_image', label: 'Describir imagen', prompt: 'Describe en 40-60 palabras la imagen adjunta a esta fila.', needsImage: true },
  { id: 'ocr', label: 'Transcribir (OCR)', prompt: 'Transcribe literalmente todo el texto que aparezca en la imagen o archivo adjunto. Devuelve solo la transcripción.', needsImage: true },
];

/**
 * A plain-text block describing a row, fed to the AI cell's prompt as context. Skips
 * the AI column being computed (and other AI columns, to avoid feeding derived values
 * back in). Resolves select/multi-select option labels and folds in the extracted text
 * of any attachments so a summary/OCR prompt has something to work with.
 */
export function buildAiRowContext(
  columns: DatabaseColumn[],
  row: DatabaseRow,
  opts: { excludeColumnId?: string } = {}
): string {
  const lines: string[] = [];
  for (const col of columns) {
    if (col.id === opts.excludeColumnId || col.type === 'ai') continue;
    const raw = row.cells[col.id] ?? null;
    let value = '';
    switch (col.type) {
      case 'select':
        value = col.options.find((o) => o.id === raw)?.label ?? '';
        break;
      case 'multi_select':
        value = decodeMultiSelect(raw)
          .map((id) => col.options.find((o) => o.id === id)?.label ?? '')
          .filter(Boolean)
          .join(', ');
        break;
      case 'checkbox':
        value = decodeCheckbox(raw) ? 'sí' : 'no';
        break;
      case 'attachment': {
        const atts = row.attachments?.[col.id] ?? [];
        const names = atts.map((a) => a.fileName ?? '').filter(Boolean).join(', ');
        const texts = atts.map((a) => a.extractedText).filter((x): x is string => Boolean(x && x.trim()));
        value = [names, ...texts].filter(Boolean).join('\n');
        break;
      }
      default:
        value = raw ?? '';
    }
    if (value && value.trim()) lines.push(`${col.name}: ${value.trim()}`);
  }
  return lines.join('\n');
}

export const AI_COLUMN_SYSTEM = `Eres un asistente que rellena UNA celda de una base de datos a partir de los datos de su fila. Sigue exactamente la instrucción del usuario y responde SOLO con el valor de la celda: sin preámbulos, sin explicaciones, sin comillas ni formato adicional, salvo que la instrucción pida lo contrario. Básate únicamente en los datos proporcionados; si faltan datos para responder, deja la respuesta vacía.`;

/** Compose the user message for an AI cell: the user's instruction + the row context. */
export function buildAiCellPrompt(prompt: string, context: string): string {
  return `${prompt.trim()}\n\n=== DATOS DE LA FILA ===\n${context || '(fila vacía)'}`;
}

/**
 * Compose the final text-to-image prompt for an 'ai_image' column: the user's image
 * instruction, enriched with the row's own data so the picture reflects that record.
 * Kept pure so the generation logic is unit-tested without a provider.
 */
export function buildAiImagePrompt(prompt: string, context: string): string {
  const base = prompt.trim();
  if (!context.trim()) return base;
  return `${base}\n\nContexto de la fila (úsalo para ilustrar este registro concreto): ${context.replace(/\s+/g, ' ').trim().slice(0, 900)}`;
}
