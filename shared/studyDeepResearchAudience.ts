/**
 * The two pedagogical products offered by Deep Research.
 *
 * Values stay language-neutral because they are persisted with the generated draft
 * and may be reused after the interface language changes.
 */
export type StudyDeepResearchAudience = 'teacher' | 'students';

export function normalizeStudyDeepResearchAudience(
  value: string | undefined,
  fallback: StudyDeepResearchAudience = 'students',
): StudyDeepResearchAudience {
  if (value === 'teacher' || value === 'students') return value;
  return fallback;
}
