import { t, tx } from './i18n';
import type { StudyQuestionGenerationResult } from '@shared/studyQuestions';

/**
 * Why a generation run produced no questions.
 *
 * generateStudyQuestions throws outright when the model returns nothing parseable, so an
 * empty result that reaches the UI has always passed through the duplicate filter — the
 * questions were generated, then discarded because near-identical ones already sit in the
 * bank. Reporting that as "no valid questions could be generated" blames the model for a
 * full bank and leaves the reader retrying into the same wall with no way out; the counts
 * behind it were computed and then dropped on the floor. Name the real cause and the exits.
 */
export function studyQuestionGenerationEmptyMessage(
  result: Pick<StudyQuestionGenerationResult, 'rejectedDuplicates'>
): string {
  if (result.rejectedDuplicates <= 0) return t('No se pudo generar ninguna pregunta válida.');
  return tx(
    'Las {count} preguntas generadas ya estaban en tu banco y se descartaron por duplicadas. Añade o cambia las fuentes, pide más preguntas, o elimina o archiva las anteriores.',
    { count: result.rejectedDuplicates }
  );
}
