/** AI may structure a teacher-authored assessment plan, but never student data. */
import { completeJson } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';
import { getAssessmentPlan } from '../db/teachingGradesRepo';
import { getSettings } from '../db/settingsRepo';
import { isProposedPlan, type ProposedPlan } from '@shared/assessmentImport';
import type { PromptLanguage } from '@shared/types';
import { assessmentPromptPack } from '@shared/academicPromptPacks';

export interface ImportPlanRequest {
  planId: string;
  /** The pasted evaluation table or section. */
  text: string;
  language?: PromptLanguage;
}

export async function importAssessmentPlan(request: ImportPlanRequest): Promise<ProposedPlan> {
  const { plan } = getAssessmentPlan(request.planId);
  const language = request.language ?? getSettings().promptLanguage ?? 'es';
  const copy = assessmentPromptPack(language);
  const text = request.text.trim();
  if (!text) throw new Error(copy.emptyInput);

  // No roster data here, so no pseudonymisation scope: a guía docente describes the
  // assessment, not the students.
  const outcome = await runStudyAiTask(
    {
      task: 'chat',
      subjectId: plan.subjectId,
      inputChars: text.length + copy.system.length,
      externalPurpose: copy.purpose,
      externalConsentKey: `assessment-import:${plan.id}`,
    },
    (model) => completeJson<ProposedPlan>({ system: copy.system, user: text, temperature: 0 }, isProposedPlan, model),
  );
  return outcome.value;
}
