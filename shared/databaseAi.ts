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
  'zh-Hans': { system: '你负责根据某一行的数据填充数据库中的一个单元格。请严格遵循用户的指令，只返回单元格的值：除非指令另有要求，否则不要添加前言、解释、引号或额外格式。仅依据所提供的数据作答；若数据不足以回答，则返回空响应。', yes: '是', no: '否', rowData: '行数据', emptyRow: '空行', rowContext: '行上下文（用来说明这条具体记录）' },
  'zh-Hant': { system: '你負責根據某一列的資料填充資料庫中的一個儲存格。請嚴格遵循使用者的指令，只傳回儲存格的值：除非指令另有要求，否則不要添加前言、解釋、引號或額外格式。僅依據所提供的資料作答；若資料不足以回答，則傳回空回應。', yes: '是', no: '否', rowData: '列資料', emptyRow: '空列', rowContext: '列脈絡（用於說明這筆具體紀錄）' },
  vi: { system: 'Bạn điền MỘT ô của cơ sở dữ liệu từ dữ liệu trong hàng của ô đó. Hãy tuân thủ chính xác chỉ dẫn của người dùng và chỉ trả về giá trị của ô: không mở đầu, không giải thích, không dấu ngoặc kép hay định dạng thêm, trừ khi chỉ dẫn yêu cầu khác. Chỉ dựa trên dữ liệu được cung cấp; nếu không đủ dữ liệu để trả lời, hãy trả về phản hồi trống.', yes: 'có', no: 'không', rowData: 'DỮ LIỆU HÀNG', emptyRow: 'hàng trống', rowContext: 'Ngữ cảnh của hàng (dùng để minh họa bản ghi cụ thể này)' },
  ja: { system: 'あなたは行のデータからデータベースの 1 つのセルを埋めます。ユーザーの指示に正確に従い、セルの値のみを返してください。指示に別段の要求がない限り、前書き・説明・引用符・追加の書式は付けないでください。提供されたデータのみに基づいてください。回答に十分なデータがない場合は、空の応答を返してください。', yes: 'はい', no: 'いいえ', rowData: '行データ', emptyRow: '空の行', rowContext: '行のコンテキスト（この特定のレコードを描写するために使用してください）' },
  ru: { system: 'Вы заполняете ОДНУ ячейку базы данных на основе данных её строки. Точно следуйте инструкции пользователя и возвращайте ТОЛЬКО значение ячейки: без вступления, объяснений, кавычек и дополнительного форматирования, если инструкция не требует иного. Используйте только предоставленные данные; если данных для ответа недостаточно, верните пустой ответ.', yes: 'да', no: 'нет', rowData: 'ДАННЫЕ СТРОКИ', emptyRow: 'пустая строка', rowContext: 'Контекст строки (используйте его для иллюстрации этой конкретной записи)' },
  uk: { system: 'Ви заповнюєте ОДНУ клітинку бази даних на основі даних її рядка. Точно дотримуйтеся інструкції користувача й повертайте ЛИШЕ значення клітинки: без вступу, пояснень, лапок чи додаткового форматування, якщо інструкція не вимагає іншого. Використовуйте лише надані дані; якщо даних для відповіді бракує, поверніть порожню відповідь.', yes: 'так', no: 'ні', rowData: 'ДАНІ РЯДКА', emptyRow: 'порожній рядок', rowContext: 'Контекст рядка (використовуйте його для ілюстрації цього конкретного запису)' },
  ko: { system: '당신은 행의 데이터로 데이터베이스의 셀 하나를 채웁니다. 사용자의 지시를 정확히 따르고 셀 값만 반환하십시오. 지시가 달리 요구하지 않는 한 서두, 설명, 따옴표 또는 추가 서식을 넣지 마십시오. 제공된 데이터만 사용하고, 답변에 데이터가 부족하면 빈 응답을 반환하십시오.', yes: '예', no: '아니오', rowData: '행 데이터', emptyRow: '빈 행', rowContext: '행 컨텍스트(이 특정 레코드를 설명하는 데 사용하십시오)' },
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
