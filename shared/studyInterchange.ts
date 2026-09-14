import type { StudyQuestion, StudyQuestionInput, StudyQuestionType } from './studyQuestions';
import type { StudyFlashcard, StudyFlashcardInput } from './studyFlashcards';

/**
 * Portable interchange for the question bank and the flashcard deck.
 *
 * Everything in this module is pure string work so the parsers can be exercised by the
 * Electron-free test harness. Binary packages (Anki `.apkg`) live in the main process
 * because they need SQLite and ZIP; the text formats here are shared with it.
 */

export const STUDY_INTERCHANGE_FORMATS = ['nodus', 'csv', 'anki-tsv', 'anki-apkg', 'moodle-xml', 'gift'] as const;
export type StudyInterchangeFormat = typeof STUDY_INTERCHANGE_FORMATS[number];
export type StudyInterchangeKind = 'questions' | 'flashcards';

export interface StudyImportLocation {
  courseId?: string | null;
  subjectId?: string | null;
  folderId?: string | null;
  topicId?: string | null;
  materialId?: string | null;
}

export interface StudyInterchangeParseResult {
  questions: StudyQuestionInput[];
  cards: StudyFlashcardInput[];
  skipped: number;
  warnings: string[];
  categories: string[];
}

export interface StudyInterchangeSummary {
  kind: StudyInterchangeKind;
  format: StudyInterchangeFormat;
  imported: number;
  skipped: number;
  warnings: string[];
  file: string;
  path: string | null;
}

export interface StudyInterchangeExportOptions {
  ids?: string[];
  deckName?: string;
  category?: string;
  courseId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  folderId?: string | null;
}

export interface StudyInterchangeImportOptions {
  location?: StudyImportLocation;
  format?: StudyInterchangeFormat;
}

export function emptyInterchangeResult(): StudyInterchangeParseResult {
  return { questions: [], cards: [], skipped: 0, warnings: [], categories: [] };
}

export function extensionForInterchange(format: StudyInterchangeFormat, kind: StudyInterchangeKind): string {
  if (format === 'nodus') return 'json';
  if (format === 'anki-apkg') return 'apkg';
  if (format === 'anki-tsv') return kind === 'flashcards' ? 'txt' : 'txt';
  if (format === 'moodle-xml') return 'xml';
  if (format === 'gift') return 'txt';
  return 'csv';
}

export function interchangeFormatFromFileName(fileName: string): StudyInterchangeFormat | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.apkg') || lower.endsWith('.colpkg')) return 'anki-apkg';
  if (lower.endsWith('.json')) return 'nodus';
  if (lower.endsWith('.xml')) return 'moodle-xml';
  if (lower.endsWith('.gift')) return 'gift';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.txt') || lower.endsWith('.tsv')) return 'anki-tsv';
  return null;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
};

export function decodeStudyEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? match);
}

/** Minimal HTML-to-text for Moodle/GIFT rich fields: keeps line structure, drops markup. */
export function stripStudyHtml(value: string): string {
  return decodeStudyEntities(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeStudyXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const QUESTION_TYPE_ALIASES: Record<string, StudyQuestionType> = {
  short: 'short', shortanswer: 'short', breves: 'short', 'respuesta breve': 'short', 'respuesta corta': 'short',
  essay: 'essay', desarrollo: 'essay', 'respuesta larga': 'essay',
  definition: 'definition', definicion: 'definition', 'definición': 'definition',
  relation: 'relation', relacion: 'relation', 'relación': 'relation',
  comparison: 'comparison', comparacion: 'comparison', 'comparación': 'comparison',
  commentary: 'commentary', comentario: 'commentary',
  case: 'case', 'caso practico': 'case', 'caso práctico': 'case',
  truefalse: 'true_false', true_false: 'true_false', 'verdadero falso': 'true_false', 'verdadero/falso': 'true_false',
  multichoice: 'single_choice', single_choice: 'single_choice', 'eleccion simple': 'single_choice', 'elección simple': 'single_choice',
  multiple_choice: 'multiple_choice', 'respuesta multiple': 'multiple_choice', 'respuesta múltiple': 'multiple_choice',
  fill_blank: 'fill_blank', completar: 'fill_blank', cloze: 'fill_blank',
  ordering: 'ordering', ordenar: 'ordering',
  matching: 'matching', match: 'matching', relacionar: 'matching',
};

export function studyQuestionTypeFromLabel(value: string): StudyQuestionType | null {
  const key = value.trim().toLowerCase().replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ');
  if (QUESTION_TYPE_ALIASES[key]) return QUESTION_TYPE_ALIASES[key];
  const packed = key.replace(/\s+/g, '_');
  if (QUESTION_TYPE_ALIASES[packed]) return QUESTION_TYPE_ALIASES[packed];
  return null;
}

function cleanPrompt(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function answerTextOf(question: StudyQuestion | StudyQuestionInput): string {
  const answer = question.answer ?? {};
  if (answer.text?.trim()) return answer.text.trim();
  if (answer.value == null) return '';
  if (Array.isArray(answer.value)) return answer.value.join(' · ');
  return String(answer.value);
}

/**
 * Builds a question that survives `validateStudyQuestionInput` no matter how thin the
 * source format was: short prompts are extended with the answer, and every import gets
 * an explanatory excerpt so the persistence boundary still sees source grounding.
 */
export function studyQuestionFromImport(input: Partial<StudyQuestionInput> & { prompt: string; answerText?: string }, origin: string): StudyQuestionInput | null {
  const rawPrompt = cleanPrompt(input.prompt ?? '');
  const answerText = cleanPrompt(input.answerText ?? answerTextOf(input as StudyQuestionInput));
  const prompt = rawPrompt.length >= 8 ? rawPrompt : cleanPrompt(`${rawPrompt} ${answerText}`.trim());
  if (prompt.replace(/[^\p{L}\p{N}]/gu, '').length < 4) return null;
  const type = input.type ?? 'short';
  const options = (input.options ?? []).filter((option) => option.text.trim());
  const correct = options.filter((option) => option.correct);
  const answer = input.answer && Object.keys(input.answer).length
    ? input.answer
    : type === 'true_false'
      ? { value: /^(t|true|verdadero|v|1)$/i.test(answerText) }
      : { text: answerText, value: correct[0]?.id };
  const explanation = cleanPrompt(input.explanation ?? '');
  const excerpt = cleanPrompt(input.source?.excerpt ?? '') || explanation || answerText || prompt;
  return {
    prompt,
    type,
    difficulty: input.difficulty ?? 'medium',
    cognitiveLevel: input.cognitiveLevel ?? 'understand',
    status: input.status ?? 'pending',
    answer,
    options,
    explanation: explanation || `${origin}: ${excerpt}`.slice(0, 400),
    tags: [...new Set((input.tags ?? []).map((tag) => cleanPrompt(tag)).filter(Boolean))],
    competence: input.competence ?? '',
    source: { title: input.source?.title?.trim() || origin, excerpt },
  };
}

export function studyFlashcardToQuestionInput(card: StudyFlashcardInput, origin: string): StudyQuestionInput | null {
  const front = cleanPrompt(card.front);
  const back = cleanPrompt(card.back);
  if (card.type === 'cloze') {
    const text = front || back;
    const answers = [...text.matchAll(/\{\{c\d+::(.+?)\}\}/g)].map((match) => match[1]);
    const prompt = text.replace(/\{\{c\d+::(.+?)\}\}/g, '_____');
    return studyQuestionFromImport({
      prompt: prompt.length >= 8 ? prompt : `Completa: ${prompt}`,
      type: 'fill_blank', answerText: answers.join(' · ') || back, explanation: card.sourceExcerpt,
      tags: card.tags, difficulty: card.difficulty, source: { title: origin, excerpt: card.sourceExcerpt || text },
    }, origin);
  }
  return studyQuestionFromImport({
    prompt: front, type: 'short', answerText: back, explanation: card.sourceExcerpt, tags: card.tags,
    difficulty: card.difficulty, source: { title: origin, excerpt: card.sourceExcerpt || back || front },
  }, origin);
}

export function studyQuestionToFlashcardInput(question: StudyQuestion | StudyQuestionInput, _origin: string): StudyFlashcardInput {
  const answer = answerTextOf(question);
  return {
    type: question.type === 'fill_blank' ? 'cloze' : 'front_back',
    front: cleanPrompt(question.prompt),
    back: answer,
    hint: '',
    tags: [...new Set(question.tags ?? [])],
    difficulty: question.difficulty ?? 'medium',
    courseId: question.courseId ?? null,
    subjectId: question.subjectId ?? null,
    topicId: question.topicId ?? null,
    documentId: question.documentId ?? null,
    materialId: question.materialId ?? null,
    transcriptId: question.transcriptId ?? null,
    questionId: 'id' in question ? String((question as StudyQuestion).id ?? '') || null : null,
    sourceExcerpt: question.source?.excerpt ?? '',
    favorite: false,
  };
}

/* ------------------------------------------------------------------ CSV -- */

/** RFC 4180-ish reader with delimiter detection (comma, semicolon, tab). */
export function parseStudyCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = clean.split('\n').find((line) => line.trim().length) ?? '';
  const candidates: Array<',' | ';' | '\t'> = [',', ';', '\t'];
  const delimiter = candidates.map((value) => ({ value, count: firstLine.split(value).length }))
    .sort((left, right) => right.count - left.count)[0]?.value ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const character = clean[index];
    if (quoted) {
      if (character === '"') {
        if (clean[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += character;
    } else if (character === '"') quoted = true;
    else if (character === delimiter) { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((entry) => entry.some((value) => value.trim().length));
}

export function serializeStudyCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (value: string | number | null | undefined) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${rows.map((row) => row.map(escape).join(',')).join('\n')}\n`;
}

const QUESTION_CSV_HEADERS = ['tipo', 'enunciado', 'dificultad', 'estado', 'respuesta', 'explicacion', 'etiquetas', 'fuente', 'opciones'] as const;
const FLASHCARD_CSV_HEADERS = ['tipo', 'anverso', 'reverso', 'pista', 'dificultad', 'etiquetas', 'fuente'] as const;

export function serializeStudyQuestionsCsv(questions: StudyQuestionInput[]): string {
  return serializeStudyCsv([
    [...QUESTION_CSV_HEADERS],
    ...questions.map((question) => [
      question.type,
      question.prompt,
      question.difficulty ?? 'medium',
      question.status ?? 'pending',
      answerTextOf(question),
      question.explanation ?? '',
      (question.tags ?? []).join(' | '),
      question.source?.title ?? '',
      (question.options ?? []).map((option) => `${option.correct ? '*' : ''}${option.text}`).join(' | '),
    ]),
  ]);
}

export function serializeStudyFlashcardsCsv(cards: StudyFlashcardInput[]): string {
  return serializeStudyCsv([
    [...FLASHCARD_CSV_HEADERS],
    ...cards.map((card) => [
      card.type ?? 'front_back',
      card.front,
      card.back,
      card.hint ?? '',
      card.difficulty ?? 'medium',
      (card.tags ?? []).join(' | '),
      card.sourceExcerpt ?? '',
    ]),
  ]);
}

function headerIndex(header: string[], ...names: string[]): number {
  const normalized = header.map((value) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  return normalized.findIndex((value) => names.some((name) => value === name));
}

export function parseStudyQuestionsCsv(text: string, origin = 'CSV'): StudyInterchangeParseResult {
  const rows = parseStudyCsv(text);
  const result = emptyInterchangeResult();
  if (rows.length < 2) return result;
  const header = rows[0];
  const promptIndex = headerIndex(header, 'enunciado', 'pregunta', 'prompt', 'question', 'front', 'anverso');
  const answerIndex = headerIndex(header, 'respuesta', 'answer', 'back', 'reverso', 'solucion', 'solución');
  if (promptIndex < 0) { result.warnings.push(`${origin}: no se encontró la columna de enunciado.`); return result; }
  const typeIndex = headerIndex(header, 'tipo', 'type');
  const difficultyIndex = headerIndex(header, 'dificultad', 'difficulty');
  const statusIndex = headerIndex(header, 'estado', 'status');
  const explanationIndex = headerIndex(header, 'explicacion', 'explicación', 'explanation', 'feedback', 'justificacion', 'justificación');
  const tagsIndex = headerIndex(header, 'etiquetas', 'tags');
  const sourceIndex = headerIndex(header, 'fuente', 'source');
  const optionsIndex = headerIndex(header, 'opciones', 'options', 'alternativas');
  for (const row of rows.slice(1)) {
    const prompt = cleanPrompt(row[promptIndex] ?? '');
    if (!prompt) { result.skipped += 1; continue; }
    const options = optionsIndex >= 0
      ? (row[optionsIndex] ?? '').split(/\s*\|\s*/).map((entry, index) => ({
        id: `O${index + 1}`, text: entry.replace(/^\*/, '').trim(), correct: entry.trim().startsWith('*'),
      })).filter((option) => option.text)
      : [];
    const type = (typeIndex >= 0 ? studyQuestionTypeFromLabel(row[typeIndex] ?? '') : null)
      ?? (options.length ? (options.filter((option) => option.correct).length > 1 ? 'multiple_choice' : 'single_choice') : 'short');
    const question = studyQuestionFromImport({
      prompt,
      type,
      options,
      answer: { text: cleanPrompt(row[answerIndex] ?? '') || options.find((option) => option.correct)?.text || '', value: options.find((option) => option.correct)?.id },
      explanation: explanationIndex >= 0 ? row[explanationIndex] : '',
      tags: tagsIndex >= 0 ? (row[tagsIndex] ?? '').split(/[|,;]/).map((tag) => tag.trim()).filter(Boolean) : [],
      difficulty: difficultyIndex >= 0 && ['easy', 'medium', 'hard'].includes(cleanPrompt(row[difficultyIndex] ?? '').toLowerCase())
        ? cleanPrompt(row[difficultyIndex]).toLowerCase() as StudyQuestion['difficulty'] : 'medium',
      status: statusIndex >= 0 && ['pending', 'approved', 'problematic', 'discarded'].includes(cleanPrompt(row[statusIndex] ?? '').toLowerCase())
        ? cleanPrompt(row[statusIndex]).toLowerCase() as StudyQuestion['status'] : 'pending',
      source: { title: sourceIndex >= 0 ? cleanPrompt(row[sourceIndex] ?? '') : origin, excerpt: explanationIndex >= 0 ? row[explanationIndex] : '' },
    }, origin);
    if (question) result.questions.push(question); else result.skipped += 1;
  }
  return result;
}

export function parseStudyFlashcardsCsv(text: string, origin = 'CSV'): StudyInterchangeParseResult {
  const rows = parseStudyCsv(text);
  const result = emptyInterchangeResult();
  if (rows.length < 2) return result;
  const header = rows[0];
  const frontIndex = headerIndex(header, 'anverso', 'front', 'pregunta', 'enunciado', 'front');
  const backIndex = headerIndex(header, 'reverso', 'back', 'respuesta', 'answer');
  if (frontIndex < 0 || backIndex < 0) { result.warnings.push(`${origin}: faltan las columnas de anverso y reverso.`); return result; }
  const typeIndex = headerIndex(header, 'tipo', 'type');
  const hintIndex = headerIndex(header, 'pista', 'hint');
  const difficultyIndex = headerIndex(header, 'dificultad', 'difficulty');
  const tagsIndex = headerIndex(header, 'etiquetas', 'tags');
  const sourceIndex = headerIndex(header, 'fuente', 'source', 'excerpt');
  for (const row of rows.slice(1)) {
    const front = cleanPrompt(row[frontIndex] ?? '');
    const back = cleanPrompt(row[backIndex] ?? '');
    if (!front || !back) { result.skipped += 1; continue; }
    const rawType = typeIndex >= 0 ? cleanPrompt(row[typeIndex] ?? '').toLowerCase() : '';
    const type = (['front_back', 'term_definition', 'image_explanation', 'cloze'].includes(rawType) ? rawType : front.includes('{{c') ? 'cloze' : 'front_back') as StudyFlashcardInput['type'];
    result.cards.push({
      type, front, back,
      hint: hintIndex >= 0 ? cleanPrompt(row[hintIndex] ?? '') : '',
      difficulty: difficultyIndex >= 0 && ['easy', 'medium', 'hard'].includes(cleanPrompt(row[difficultyIndex] ?? '').toLowerCase())
        ? cleanPrompt(row[difficultyIndex]).toLowerCase() as StudyFlashcard['difficulty'] : 'medium',
      tags: tagsIndex >= 0 ? (row[tagsIndex] ?? '').split(/[|,;]/).map((tag) => tag.trim()).filter(Boolean) : [],
      sourceExcerpt: sourceIndex >= 0 ? cleanPrompt(row[sourceIndex] ?? '') : '',
    });
  }
  return result;
}

/* --------------------------------------------------------------- Anki -- */

export function serializeAnkiTsv(cards: Array<StudyFlashcardInput | StudyFlashcard>): string {
  const lines = cards.map((card) => {
    const front = card.front.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    const back = card.back.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    const tags = (card.tags ?? []).join(' ');
    return [front, back, tags].join('\t');
  });
  return ['#separator:tab', '#html:true', '#tags column:3', ...lines].join('\n');
}

export function parseAnkiTsv(text: string, origin = 'Anki'): StudyInterchangeParseResult {
  const result = emptyInterchangeResult();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let separator = '\t';
  let tagsColumn = 2;
  const body: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('#')) {
      if (/^#separator:(.+)/i.test(line)) {
        const value = line.replace(/^#separator:/i, '').trim().toLowerCase();
        separator = value === 'comma' ? ',' : value === 'semicolon' ? ';' : value === 'space' ? ' ' : '\t';
      }
      if (/^#tags column:(\d+)/i.test(line)) tagsColumn = Number(line.replace(/^#tags column:/i, '')) - 1;
      continue;
    }
    body.push(line);
  }
  for (const line of body) {
    const fields = line.split(separator).map((field) => stripStudyHtml(field.replace(/<br\s*\/?>/gi, '\n')));
    if (fields.length < 2 || !fields[0] || !fields[1]) { result.skipped += 1; continue; }
    const tags = (fields[tagsColumn] ?? '').split(/\s+/).filter(Boolean);
    result.cards.push({ type: fields[0].includes('{{c') ? 'cloze' : 'front_back', front: fields[0], back: fields[1], tags, sourceExcerpt: '' });
  }
  if (!result.cards.length && body.length) result.warnings.push(`${origin}: no se reconoció ninguna tarjeta.`);
  return result;
}

/* ------------------------------------------------------------ Moodle -- */

function moodleAnswerText(block: string): string {
  const text = /<text[^>]*>([\s\S]*?)<\/text>/i.exec(block)?.[1] ?? '';
  return stripStudyHtml(text);
}

export function serializeMoodleXml(questions: StudyQuestionInput[], options: { category?: string } = {}): string {
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<quiz>'];
  if (options.category?.trim()) {
    parts.push(`  <question type="category"><category><text>${escapeStudyXml(options.category.trim())}</text></category></question>`);
  }
  for (const question of questions) {
    const name = escapeStudyXml(cleanPrompt(question.prompt).slice(0, 80));
    const text = escapeStudyXml(question.prompt);
    const feedback = escapeStudyXml(question.explanation ?? '');
    const answerText = answerTextOf(question);
    const head = (type: string) => `  <question type="${type}">\n    <name><text>${name}</text></name>\n    <questiontext format="html"><text>${text}</text></questiontext>\n    <generalfeedback format="html"><text>${feedback}</text></generalfeedback>\n    <defaultgrade>1.0000000</defaultgrade>\n`;
    if (question.type === 'single_choice' || question.type === 'multiple_choice') {
      const single = question.type === 'single_choice';
      const answers = (question.options ?? []).map((option) => `    <answer fraction="${option.correct ? (single ? 100 : Math.round(100 / Math.max(1, (question.options ?? []).filter((entry) => entry.correct).length))) : 0}" format="html"><text>${escapeStudyXml(option.text)}</text>${option.feedback ? `<feedback format="html"><text>${escapeStudyXml(option.feedback)}</text></feedback>` : ''}</answer>`).join('\n');
      parts.push(`${head('multichoice')}${answers}\n    <single>${single}</single>\n    <shuffleanswers>true</shuffleanswers>\n    <answernumbering>abc</answernumbering>\n  </question>`);
    } else if (question.type === 'true_false') {
      const value = question.answer?.value === true || /^(true|verdadero|v)$/i.test(String(question.answer?.value ?? ''));
      parts.push(`${head('truefalse')}    <answer fraction="${value ? 100 : 0}" format="html"><text>true</text></answer>\n    <answer fraction="${value ? 0 : 100}" format="html"><text>false</text></answer>\n  </question>`);
    } else if (question.type === 'matching' && question.answer?.pairs?.length) {
      const subquestions = question.answer.pairs.map(([left, right]) => `    <subquestion format="html"><text>${escapeStudyXml(left)}</text><answer><text>${escapeStudyXml(right)}</text></answer></subquestion>`).join('\n');
      parts.push(`${head('match')}${subquestions}\n  </question>`);
    } else if (question.type === 'essay' || question.type === 'commentary' || question.type === 'case' || question.type === 'relation' || question.type === 'comparison' || question.type === 'ordering') {
      parts.push(`${head('essay')}    <responseformat>editor</responseformat>\n    <responserequired>1</responserequired>\n    <responsefieldlines>15</responsefieldlines>\n    <attachments>0</attachments>\n  </question>`);
    } else {
      parts.push(`${head('shortanswer')}    <answer fraction="100" format="html"><text>${escapeStudyXml(answerText)}</text></answer>\n  </question>`);
    }
  }
  parts.push('</quiz>');
  return parts.join('\n');
}

function xmlBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi');
  const close = new RegExp(`</${tag}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = open.exec(xml))) {
    close.lastIndex = match.index + match[0].length;
    const end = close.exec(xml);
    if (!end) break;
    blocks.push(xml.slice(match.index, end.index + end[0].length));
    open.lastIndex = end.index + end[0].length;
  }
  return blocks;
}

function xmlFirst(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return match ? match[2] : null;
}

export function parseMoodleXml(text: string, origin = 'Moodle XML'): StudyInterchangeParseResult {
  const result = emptyInterchangeResult();
  const questions = xmlBlocks(text, 'question');
  if (!questions.length) { result.warnings.push(`${origin}: no se encontraron preguntas.`); return result; }
  let currentCategory = '';
  for (const block of questions) {
    const type = /type="([^"]+)"/i.exec(block)?.[1]?.toLowerCase() ?? '';
    if (type === 'category') {
      currentCategory = stripStudyHtml(xmlFirst(block, 'category') ?? '');
      if (currentCategory) result.categories.push(currentCategory);
      continue;
    }
    const prompt = stripStudyHtml(xmlFirst(block, 'questiontext') ?? '');
    const feedback = stripStudyHtml(xmlFirst(block, 'generalfeedback') ?? '');
    const tags = currentCategory ? [currentCategory] : [];
    const make = (input: Partial<StudyQuestionInput> & { prompt: string; answerText?: string }) => {
      const question = studyQuestionFromImport({ ...input, tags: [...tags, ...(input.tags ?? [])] }, origin);
      if (question) result.questions.push(question); else result.skipped += 1;
    };
    if (type === 'multichoice' || type === 'multichoice') {
      const answers = xmlBlocks(block, 'answer').map((answer) => ({
        fraction: Number(/fraction="([^"]+)"/i.exec(answer)?.[1] ?? '0'),
        text: moodleAnswerText(answer),
      })).filter((answer) => answer.text);
      if (!answers.length) { result.skipped += 1; continue; }
      const single = !/<single>\s*false\s*<\/single>/i.test(block);
      const correct = answers.filter((answer) => answer.fraction > 0);
      if (!correct.length) { result.skipped += 1; continue; }
      const options = answers.map((answer, index) => ({ id: `O${index + 1}`, text: answer.text, correct: answer.fraction > 0 }));
      make({
        prompt, type: single ? 'single_choice' : 'multiple_choice', options,
        answer: { text: correct[0].text, value: options.find((option) => option.correct)?.id }, explanation: feedback,
        source: { title: origin, excerpt: correct[0].text },
      });
    } else if (type === 'truefalse') {
      const answer = xmlBlocks(block, 'answer').find((entry) => Number(/fraction="([^"]+)"/i.exec(entry)?.[1] ?? '0') > 0);
      const value = /true/i.test(moodleAnswerText(answer ?? '')) || /true/i.test(answer ?? '');
      make({ prompt, type: 'true_false', answer: { value }, explanation: feedback, source: { title: origin, excerpt: String(value) } });
    } else if (type === 'shortanswer' || type === 'numerical') {
      const answer = xmlBlocks(block, 'answer').find((entry) => Number(/fraction="([^"]+)"/i.exec(entry)?.[1] ?? '0') > 0) ?? xmlBlocks(block, 'answer')[0] ?? '';
      const value = moodleAnswerText(answer) || /<text[^>]*>([\s\S]*?)<\/text>/i.exec(answer)?.[1] || '';
      make({ prompt, type: 'short', answerText: value, explanation: feedback, source: { title: origin, excerpt: value } });
    } else if (type === 'match' || type === 'match') {
      const pairs = xmlBlocks(block, 'subquestion').map((sub) => [stripStudyHtml(xmlFirst(sub, 'text') ?? ''), moodleAnswerText(xmlFirst(sub, 'answer') ?? '')] as [string, string]).filter((pair) => pair[0] && pair[1]);
      if (pairs.length < 2) { result.skipped += 1; continue; }
      make({ prompt, type: 'matching', answer: { pairs, items: pairs.map((pair) => pair[0]) }, explanation: feedback, source: { title: origin, excerpt: pairs.map((pair) => pair.join(' → ')).join('; ') } });
    } else if (type === 'essay' || type === 'description') {
      if (type === 'description') { result.skipped += 1; continue; }
      make({ prompt, type: 'essay', answerText: feedback, explanation: feedback, source: { title: origin, excerpt: feedback || prompt } });
    } else if (type === 'cloze') {
      make({ prompt, type: 'fill_blank', answerText: feedback, explanation: feedback, source: { title: origin, excerpt: feedback || prompt } });
    } else {
      const answer = xmlBlocks(block, 'answer').map(moodleAnswerText).filter(Boolean)[0] ?? '';
      make({ prompt, type: 'short', answerText: answer, explanation: feedback, source: { title: origin, excerpt: answer || prompt } });
    }
  }
  return result;
}

/* --------------------------------------------------------------- GIFT -- */

export function serializeGift(questions: StudyQuestionInput[], options: { category?: string } = {}): string {
  const escape = (value: string) => value.replace(/[{}~=#:\\]/g, (character) => `\\${character}`).replace(/\n/g, ' ');
  const parts: string[] = [];
  if (options.category?.trim()) parts.push(`$CATEGORY: ${options.category.trim()}`, '');
  for (const question of questions) {
    const title = cleanPrompt(question.prompt).slice(0, 40).replace(/[:\n]/g, ' ');
    const body = escape(question.prompt);
    const feedback = question.explanation ? `####${escape(question.explanation)}` : '';
    if (question.type === 'single_choice' || question.type === 'multiple_choice') {
      const optionsText = (question.options ?? []).map((option) => `${option.correct ? '=' : '~'}${escape(option.text)}`).join(' ');
      parts.push(`::${title}:: ${body} { ${optionsText} }${feedback}`);
    } else if (question.type === 'true_false') {
      parts.push(`::${title}:: ${body} {${question.answer?.value === true || /^true/i.test(String(question.answer?.value)) ? 'TRUE' : 'FALSE'}}${feedback}`);
    } else if (question.type === 'matching' && question.answer?.pairs?.length) {
      const pairs = question.answer.pairs.map(([left, right]) => `=${escape(left)} -> ${escape(right)}`).join(' ');
      parts.push(`::${title}:: ${body} { ${pairs} }${feedback}`);
    } else if (question.type === 'essay' || question.type === 'commentary' || question.type === 'case' || question.type === 'relation' || question.type === 'comparison' || question.type === 'ordering') {
      parts.push(`::${title}:: ${body} {}${feedback}`);
    } else {
      parts.push(`::${title}:: ${body} {=${escape(answerTextOf(question))}}${feedback}`);
    }
    parts.push('');
  }
  return parts.join('\n').trim() + '\n';
}

/** Brace-balanced extraction so `{ =1 {x} ~2 }` options survive nested braces. */
function giftBraces(block: string): string | null {
  const start = block.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let index = start; index < block.length; index += 1) {
    if (block[index] === '{') depth += 1;
    else if (block[index] === '}') {
      depth -= 1;
      if (depth === 0) return block.slice(start + 1, index);
    }
  }
  return block.slice(start + 1);
}

function splitGiftOptions(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '{') depth += 1;
    if (character === '}') depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) { if (current) parts.push(current); current = ''; continue; }
    current += character;
  }
  if (current) parts.push(current);
  return parts;
}

function unescapeGift(value: string): string {
  return value.replace(/\\([{}~=#:\\])/g, '$1').trim();
}

export function parseGift(text: string, origin = 'GIFT'): StudyInterchangeParseResult {
  const result = emptyInterchangeResult();
  const body = text.replace(/\r\n?/g, '\n');
  const blocks = body.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  for (const block of blocks) {
    if (block.startsWith('$CATEGORY:')) { result.categories.push(block.replace(/^\$CATEGORY:\s*/i, '').trim()); continue; }
    if (block.startsWith('//')) continue;
    let working = block;
    const titleMatch = /^::([^:]*?)::\s*/.exec(working);
    working = titleMatch ? working.slice(titleMatch[0].length) : working;
    const feedbackIndex = working.lastIndexOf('####');
    const feedback = feedbackIndex >= 0 ? unescapeGift(working.slice(feedbackIndex + 4)) : '';
    if (feedbackIndex >= 0) working = working.slice(0, feedbackIndex);
    const brace = giftBraces(working);
    const prompt = unescapeGift(feedbackIndex >= 0 ? working.slice(0, working.indexOf('{')) : working.slice(0, working.indexOf('{')));
    if (!brace || !prompt) { result.skipped += 1; continue; }
    const make = (input: Partial<StudyQuestionInput> & { prompt: string; answerText?: string }) => {
      const question = studyQuestionFromImport({ ...input, explanation: feedback || input.explanation }, origin);
      if (question) result.questions.push(question); else result.skipped += 1;
    };
    if (/^(T|TRUE|F|FALSE)$/i.test(brace.trim())) {
      make({ prompt, type: 'true_false', answer: { value: /^(T|TRUE)$/i.test(brace.trim()) }, source: { title: origin, excerpt: brace.trim() } });
      continue;
    }
    const options = splitGiftOptions(brace);
    const correct = options.filter((option) => option.startsWith('=')).map((option) => unescapeGift(option.slice(1).split('#')[0]));
    const incorrect = options.filter((option) => option.startsWith('~')).map((option) => unescapeGift(option.slice(1).split('#')[0]));
    const matching = options.filter((option) => option.includes('->'));
    if (matching.length >= 2) {
      const pairs = matching.map((option) => option.replace(/^[=~]/, '').split('->').map((part) => unescapeGift(part)) as [string, string]);
      make({ prompt, type: 'matching', answer: { pairs, items: pairs.map((pair) => pair[0]) }, source: { title: origin, excerpt: pairs.map((pair) => pair.join(' → ')).join('; ') } });
    } else if (correct.length && !incorrect.length) {
      make({ prompt, type: 'short', answerText: correct[0], source: { title: origin, excerpt: correct[0] } });
    } else if (correct.length && incorrect.length) {
      const all = [...correct.map((text) => ({ text, correct: true })), ...incorrect.map((text) => ({ text, correct: false }))];
      const mapped = all.map((option, index) => ({ id: `O${index + 1}`, text: option.text, correct: option.correct }));
      make({
        prompt, type: correct.length > 1 ? 'multiple_choice' : 'single_choice', options: mapped,
        answer: { text: correct[0], value: mapped.find((option) => option.correct)?.id }, source: { title: origin, excerpt: correct[0] },
      });
    } else {
      make({ prompt, type: 'essay', answerText: feedback, source: { title: origin, excerpt: feedback || prompt } });
    }
  }
  if (!result.questions.length) result.warnings.push(`${origin}: no se encontraron preguntas.`);
  return result;
}
