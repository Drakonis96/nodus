import type { StudyFlashcard, StudyFlashcardInput } from '@shared/studyFlashcards';
import type { StudyQuestion, StudyQuestionInput } from '@shared/studyQuestions';
import type {
  StudyImportLocation,
  StudyInterchangeFormat,
  StudyInterchangeKind,
  StudyInterchangeParseResult,
} from '@shared/studyInterchange';
import { emptyInterchangeResult } from '@shared/studyInterchange';
import {
  extensionForInterchange,
  interchangeFormatFromFileName,
  parseAnkiTsv,
  parseGift,
  parseMoodleXml,
  parseStudyFlashcardsCsv,
  parseStudyQuestionsCsv,
  serializeAnkiTsv,
  serializeGift,
  serializeMoodleXml,
  serializeStudyFlashcardsCsv,
  serializeStudyQuestionsCsv,
  studyFlashcardToQuestionInput,
  studyQuestionToFlashcardInput,
} from '@shared/studyInterchange';
import { buildAnkiApkg, parseAnkiApkg } from './import/ankiApkg';
import { createStudyQuestion, exportStudyQuestions, listStudyQuestions } from './db/studyQuestionsRepo';
import { createStudyFlashcard, exportStudyFlashcards, listStudyFlashcards } from './db/studyLearningRepo';

export type StudyInterchangePayload = string | Buffer;

export function detectStudyInterchangeFormat(fileName: string, bytes: StudyInterchangePayload): StudyInterchangeFormat {
  const byName = interchangeFormatFromFileName(fileName);
  if (byName) return byName;
  return typeof bytes === 'string' && bytes.trimStart().startsWith('{') ? 'nodus' : 'csv';
}

export function exportStudyInterchange(
  kind: StudyInterchangeKind,
  format: StudyInterchangeFormat,
  options: { ids?: string[]; deckName?: string; category?: string } = {},
): StudyInterchangePayload {
  if (format === 'nodus') {
    return JSON.stringify(kind === 'questions' ? exportStudyQuestions(options.ids) : exportStudyFlashcards(options.ids), null, 2);
  }
  const questions: Array<StudyQuestion | StudyQuestionInput> = kind === 'questions'
    ? selectedQuestions(options.ids)
    : [];
  const cards: Array<StudyFlashcard | StudyFlashcardInput> = kind === 'flashcards'
    ? selectedCards(options.ids)
    : kind === 'questions'
      ? questions.map((question) => studyQuestionToFlashcardInput(question, 'Nodus'))
      : [];
  const questionInputs: StudyQuestionInput[] = kind === 'flashcards'
    ? cards.map((card) => studyFlashcardToQuestionInput(card, 'Nodus')).filter((question): question is StudyQuestionInput => Boolean(question))
    : questions as StudyQuestionInput[];
  if (format === 'csv') return kind === 'questions' ? serializeStudyQuestionsCsv(questionInputs) : serializeStudyFlashcardsCsv(cards as StudyFlashcardInput[]);
  if (format === 'anki-tsv') return serializeAnkiTsv(cards as StudyFlashcardInput[]);
  if (format === 'anki-apkg') return buildAnkiApkg(cards as StudyFlashcardInput[], { deckName: options.deckName });
  if (format === 'moodle-xml') return serializeMoodleXml(questionInputs, { category: options.category });
  if (format === 'gift') return serializeGift(questionInputs, { category: options.category });
  throw new Error('Formato de exportación no soportado.');
}

function selectedQuestions(ids?: string[]): StudyQuestion[] {
  const all = listStudyQuestions({ archived: true });
  return ids?.length ? all.filter((question) => ids.includes(question.id)) : all;
}

function selectedCards(ids?: string[]): StudyFlashcard[] {
  const all = listStudyFlashcards({ includeArchived: true });
  return ids?.length ? all.filter((card) => ids.includes(card.id)) : all;
}

export function parseStudyInterchange(kind: StudyInterchangeKind, format: StudyInterchangeFormat, bytes: StudyInterchangePayload, fileName = ''): StudyInterchangeParseResult {
  if (format === 'anki-apkg') {
    const parsed = parseAnkiApkg(Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'binary'));
    const result = emptyInterchangeResult();
    result.cards = parsed.cards;
    result.warnings = parsed.warnings;
    if (kind === 'questions') {
      result.questions = parsed.cards.map((card) => studyFlashcardToQuestionInput(card, 'Anki')).filter((question): question is StudyQuestionInput => Boolean(question));
      result.cards = [];
    }
    return result;
  }
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  if (format === 'nodus' || /\.json$/i.test(fileName)) {
    const payload = JSON.parse(text) as { format?: string; questions?: StudyQuestionInput[]; cards?: StudyFlashcardInput[] };
    const result = emptyInterchangeResult();
    if (payload.format === 'nodus-study-questions' && Array.isArray(payload.questions)) {
      if (kind === 'flashcards') result.cards = payload.questions.map((question) => studyQuestionToFlashcardInput(question, 'Nodus'));
      else result.questions = payload.questions;
    } else if (payload.format === 'nodus-study-flashcards' && Array.isArray(payload.cards)) {
      if (kind === 'questions') result.questions = payload.cards.map((card) => studyFlashcardToQuestionInput(card, 'Nodus')).filter((question): question is StudyQuestionInput => Boolean(question));
      else result.cards = payload.cards;
    } else {
      throw new Error('El fichero JSON no es una exportación de Nodus reconocida.');
    }
    return result;
  }
  if (format === 'anki-tsv') {
    const parsed = parseAnkiTsv(text, 'Anki');
    if (kind === 'questions') {
      parsed.questions = parsed.cards.map((card) => studyFlashcardToQuestionInput(card, 'Anki')).filter((question): question is StudyQuestionInput => Boolean(question));
      parsed.cards = [];
    }
    return parsed;
  }
  if (format === 'moodle-xml') {
    const parsed = parseMoodleXml(text, 'Moodle XML');
    if (kind === 'flashcards') parsed.cards = parsed.questions.map((question) => studyQuestionToFlashcardInput(question, 'Moodle XML'));
    return parsed;
  }
  if (format === 'gift') {
    const parsed = parseGift(text, 'GIFT');
    if (kind === 'flashcards') parsed.cards = parsed.questions.map((question) => studyQuestionToFlashcardInput(question, 'GIFT'));
    return parsed;
  }
  const parsed = kind === 'questions' ? parseStudyQuestionsCsv(text, 'CSV') : parseStudyFlashcardsCsv(text, 'CSV');
  if (kind === 'questions') {
    parsed.cards = parsed.questions.map((question) => studyQuestionToFlashcardInput(question, 'CSV'));
  }
  return parsed;
}

export function applyImportLocation(location: StudyImportLocation | undefined, item: { courseId?: string | null; subjectId?: string | null; folderId?: string | null; topicId?: string | null; materialId?: string | null }): void {
  if (!location) return;
  if (location.courseId !== undefined) item.courseId = location.courseId;
  if (location.subjectId !== undefined) item.subjectId = location.subjectId;
  if (location.folderId !== undefined) item.folderId = location.folderId;
  if (location.topicId !== undefined) item.topicId = location.topicId;
  if (location.materialId !== undefined) item.materialId = location.materialId;
}

export interface StudyInterchangeWriteResult {
  imported: number;
  skipped: number;
  warnings: string[];
}

export function writeStudyInterchange(
  kind: StudyInterchangeKind,
  parsed: StudyInterchangeParseResult,
  location?: StudyImportLocation,
): StudyInterchangeWriteResult {
  let imported = 0; const warnings = [...parsed.warnings];
  const fallbackSubjectId = location?.subjectId ?? null;
  const fallbackTopicId = location?.topicId ?? null;
  if (kind === 'questions') {
    for (const question of parsed.questions) {
      const next = { ...question };
      applyImportLocation(location, next);
      if (!next.subjectId && fallbackSubjectId) next.subjectId = fallbackSubjectId;
      if (!next.topicId && fallbackTopicId) next.topicId = fallbackTopicId;
      try { createStudyQuestion(next, 'import', true); imported += 1; }
      catch (cause) { warnings.push(`Pregunta omitida: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
  } else {
    for (const card of parsed.cards) {
      const next = { ...card };
      applyImportLocation(location, next);
      if (!next.subjectId && fallbackSubjectId) next.subjectId = fallbackSubjectId;
      if (!next.topicId && fallbackTopicId) next.topicId = fallbackTopicId;
      try { createStudyFlashcard(next); imported += 1; }
      catch (cause) { warnings.push(`Tarjeta omitida: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
  }
  return { imported, skipped: parsed.skipped, warnings };
}

export function interchangeExtension(kind: StudyInterchangeKind, format: StudyInterchangeFormat): string {
  return extensionForInterchange(format, kind);
}

export function interchangeFileFilters(kind: StudyInterchangeKind): Array<{ name: string; extensions: string[] }> {
  const formats: StudyInterchangeFormat[] = kind === 'questions'
    ? ['nodus', 'csv', 'moodle-xml', 'gift', 'anki-apkg', 'anki-tsv']
    : ['nodus', 'csv', 'anki-apkg', 'anki-tsv', 'moodle-xml', 'gift'];
  const names: Record<StudyInterchangeFormat, string> = {
    nodus: 'Nodus', csv: 'CSV', 'anki-tsv': 'Anki (texto)', 'anki-apkg': 'Anki (paquete)', 'moodle-xml': 'Moodle XML', gift: 'Moodle GIFT',
  };
  const extensions = [...new Set(formats.map((format) => extensionForInterchange(format, kind)))];
  return [{ name: 'Formatos compatibles', extensions }, { name: `Nodus (${names.nodus})`, extensions: ['json'] }, { name: 'Todos', extensions: ['*'] }];
}
