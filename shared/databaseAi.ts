/**
 * Pure helpers for AI columns: building the row context an AI cell is computed from,
 * and a small library of preconfigured prompts. Dependency-free so the context
 * assembly is unit-tested without a database or an AI provider.
 */

import { decodeCheckbox, decodeMultiSelect } from './databases';
import type { DatabaseColumn, DatabaseRow } from './databases';
import type { PromptLanguage } from './types';
import { databasePropertyPlainText } from './databaseProperties';

/** A preset the user can drop into an AI column's prompt. */
export interface AiColumnPreset {
  id: string;
  label: string;
  prompt: string;
  /** Hints the preset works over an attached image (vision). */
  needsImage?: boolean;
}

interface AiColumnPromptCopy {
  system: string;
  yes: string;
  no: string;
  rowData: string;
  emptyRow: string;
  rowContext: string;
}

const AI_COLUMN_PROMPT_COPY: Record<PromptLanguage, AiColumnPromptCopy> = {
  es: { system: 'Eres un asistente que rellena UNA celda de una base de datos a partir de los datos de su fila. Sigue exactamente la instrucción del usuario y responde SOLO con el valor de la celda: sin preámbulos, sin explicaciones, sin comillas ni formato adicional, salvo que la instrucción pida lo contrario. Básate únicamente en los datos proporcionados; si faltan datos para responder, deja la respuesta vacía.', yes: 'sí', no: 'no', rowData: 'DATOS DE LA FILA', emptyRow: 'fila vacía', rowContext: 'Contexto de la fila (úsalo para ilustrar este registro concreto)' },
  en: { system: 'You fill ONE database cell from the data in its row. Follow the user’s instruction exactly and return ONLY the cell value: no preamble, explanation, quotation marks, or extra formatting unless the instruction requests otherwise. Use only the supplied data; if there is not enough data to answer, return an empty response.', yes: 'yes', no: 'no', rowData: 'ROW DATA', emptyRow: 'empty row', rowContext: 'Row context (use it to illustrate this specific record)' },
  fr: { system: 'Vous remplissez UNE cellule de base de données à partir des données de sa ligne. Suivez exactement l’instruction de l’utilisateur et renvoyez UNIQUEMENT la valeur de la cellule : sans préambule, explication, guillemets ni mise en forme supplémentaire, sauf demande contraire. Utilisez seulement les données fournies ; si elles ne suffisent pas, renvoyez une réponse vide.', yes: 'oui', no: 'non', rowData: 'DONNÉES DE LA LIGNE', emptyRow: 'ligne vide', rowContext: 'Contexte de la ligne (utilisez-le pour illustrer cet enregistrement précis)' },
  de: { system: 'Du füllst EINE Datenbankzelle anhand der Daten ihrer Zeile aus. Befolge die Anweisung der nutzenden Person genau und gib NUR den Zellwert zurück: keine Einleitung, Erklärung, Anführungszeichen oder zusätzliche Formatierung, sofern nicht anders verlangt. Verwende ausschließlich die bereitgestellten Daten; reichen sie nicht aus, gib eine leere Antwort zurück.', yes: 'ja', no: 'nein', rowData: 'ZEILENDATEN', emptyRow: 'leere Zeile', rowContext: 'Zeilenkontext (verwende ihn zur Darstellung dieses konkreten Datensatzes)' },
  pt: { system: 'Preenches UMA célula de uma base de dados a partir dos dados da respetiva linha. Segue exatamente a instrução do utilizador e devolve APENAS o valor da célula: sem preâmbulo, explicações, aspas ou formatação adicional, salvo indicação em contrário. Usa apenas os dados fornecidos; se forem insuficientes, devolve uma resposta vazia.', yes: 'sim', no: 'não', rowData: 'DADOS DA LINHA', emptyRow: 'linha vazia', rowContext: 'Contexto da linha (usa-o para ilustrar este registo concreto)' },
  'pt-BR': { system: 'Você preenche UMA célula de banco de dados a partir dos dados da respectiva linha. Siga exatamente a instrução do usuário e retorne SOMENTE o valor da célula: sem preâmbulo, explicações, aspas ou formatação adicional, salvo indicação em contrário. Use apenas os dados fornecidos; se forem insuficientes, retorne uma resposta vazia.', yes: 'sim', no: 'não', rowData: 'DADOS DA LINHA', emptyRow: 'linha vazia', rowContext: 'Contexto da linha (use-o para ilustrar este registro específico)' },
  it: { system: 'Compili UNA cella di un database a partire dai dati della sua riga. Segui esattamente l’istruzione dell’utente e restituisci SOLO il valore della cella: senza preamboli, spiegazioni, virgolette o formattazione aggiuntiva, salvo richiesta contraria. Usa esclusivamente i dati forniti; se non bastano, restituisci una risposta vuota.', yes: 'sì', no: 'no', rowData: 'DATI DELLA RIGA', emptyRow: 'riga vuota', rowContext: 'Contesto della riga (usalo per illustrare questo specifico record)' },
  tr: { system: 'Bir veritabanı satırındaki verilerden TEK bir hücreyi doldurursun. Kullanıcının talimatını aynen uygula ve YALNIZCA hücre değerini döndür: aksi istenmedikçe giriş, açıklama, tırnak veya ek biçimlendirme kullanma. Yalnızca sağlanan verilere dayan; yanıt için veri yetersizse boş yanıt döndür.', yes: 'evet', no: 'hayır', rowData: 'SATIR VERİLERİ', emptyRow: 'boş satır', rowContext: 'Satır bağlamı (bu belirli kaydı betimlemek için kullan)' },
};

function aiColumnPromptCopy(language: PromptLanguage = 'es'): AiColumnPromptCopy {
  return AI_COLUMN_PROMPT_COPY[language] ?? AI_COLUMN_PROMPT_COPY.es;
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
  opts: { excludeColumnId?: string; language?: PromptLanguage } = {}
): string {
  const copy = aiColumnPromptCopy(opts.language);
  const lines: string[] = [];
  for (const col of columns) {
    if (col.id === opts.excludeColumnId || col.type === 'ai') continue;
    const raw = row.cells[col.id] ?? null;
    let value = '';
    switch (col.type) {
      case 'select':
      case 'status':
        value = col.options.find((o) => o.id === raw)?.label ?? '';
        break;
      case 'multi_select':
        value = decodeMultiSelect(raw)
          .map((id) => col.options.find((o) => o.id === id)?.label ?? '')
          .filter(Boolean)
          .join(', ');
        break;
      case 'checkbox':
        value = decodeCheckbox(raw) ? copy.yes : copy.no;
        break;
      case 'attachment':
      case 'files': {
        const atts = row.attachments?.[col.id] ?? [];
        const names = atts.map((a) => a.fileName ?? '').filter(Boolean).join(', ');
        const texts = atts.map((a) => a.extractedText).filter((x): x is string => Boolean(x && x.trim()));
        value = [names, ...texts].filter(Boolean).join('\n');
        break;
      }
      default:
        value = databasePropertyPlainText(col.type, raw);
    }
    if (value && value.trim()) lines.push(`${col.name}: ${value.trim()}`);
  }
  return lines.join('\n');
}

export const AI_COLUMN_SYSTEM = `Eres un asistente que rellena UNA celda de una base de datos a partir de los datos de su fila. Sigue exactamente la instrucción del usuario y responde SOLO con el valor de la celda: sin preámbulos, sin explicaciones, sin comillas ni formato adicional, salvo que la instrucción pida lo contrario. Básate únicamente en los datos proporcionados; si faltan datos para responder, deja la respuesta vacía.`;

export function aiColumnSystem(language: PromptLanguage = 'es'): string {
  return aiColumnPromptCopy(language).system;
}

/** Compose the user message for an AI cell: the user's instruction + the row context. */
export function buildAiCellPrompt(prompt: string, context: string, language: PromptLanguage = 'es'): string {
  const copy = aiColumnPromptCopy(language);
  return `${prompt.trim()}\n\n=== ${copy.rowData} ===\n${context || `(${copy.emptyRow})`}`;
}

/**
 * Compose the final text-to-image prompt for an 'ai_image' column: the user's image
 * instruction, enriched with the row's own data so the picture reflects that record.
 * Kept pure so the generation logic is unit-tested without a provider.
 */
export function buildAiImagePrompt(prompt: string, context: string, language: PromptLanguage = 'es'): string {
  const base = prompt.trim();
  if (!context.trim()) return base;
  return `${base}\n\n${aiColumnPromptCopy(language).rowContext}: ${context.replace(/\s+/g, ' ').trim().slice(0, 900)}`;
}
