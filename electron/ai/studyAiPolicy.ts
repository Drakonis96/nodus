import type { ModelRef } from '@shared/types';
import type { StudyAiTask } from '@shared/studyAi';
import { isLocalStudyModel } from '@shared/studyAi';
import { getSettings } from '../db/settingsRepo';
import { getStudyAiUsageSummary, recordStudyAiUsage } from '../db/studyAiUsageRepo';

const primaryKey: Record<StudyAiTask, 'chatModel' | 'improveModel' | 'questionGenModel' | 'gradingModel' | 'flashcardModel'> = { chat: 'chatModel', improve: 'improveModel', questions: 'questionGenModel', grading: 'gradingModel', flashcards: 'flashcardModel' };

export function resolveStudyAiTaskModel(task: StudyAiTask, explicit?: ModelRef | null, subjectId?: string | null): ModelRef {
  const settings = getSettings(); const scoped = subjectId ? settings.studyAiSubjectModels[subjectId]?.[task] : null;
  const primary = explicit ?? scoped ?? settings[primaryKey[task]] ?? settings.studyModel ?? settings.synthesisModel;
  if (!primary?.provider || !primary.model) throw new Error('No hay un modelo de IA configurado. Elige uno en Ajustes.');
  const model = primary;
  if (settings.studyAiLocalOnly && !isLocalStudyModel(model)) throw new Error(`El modo «solo modelos locales» impide usar ${model.provider}.`);
  return model;
}

export async function runStudyAiTask<T>(input: { task: StudyAiTask; explicitModel?: ModelRef | null; subjectId?: string | null; inputChars: number; outputChars?: (value: T) => number; allowFallback?: () => boolean }, operation: (model: ModelRef) => Promise<T>): Promise<{ value: T; model: ModelRef; fallbackUsed: boolean }> {
  const settings = getSettings(); if (input.inputChars > settings.studyAiMaxInputChars) throw new Error(`La solicitud supera el límite configurado de ${settings.studyAiMaxInputChars.toLocaleString('es-ES')} caracteres.`);
  const summary = getStudyAiUsageSummary(); if (summary.budgetUsd > 0 && summary.knownCostUsd >= summary.budgetUsd) throw new Error('Se ha alcanzado el presupuesto mensual de IA para estudio.');
  const primary = resolveStudyAiTaskModel(input.task, input.explicitModel, input.subjectId); const fallback = settings.studyAiFallbackModels[input.task];
  const candidates: Array<{ model: ModelRef; fallback: boolean }> = [{ model: primary, fallback: false }];
  if (fallback?.provider && fallback.model && (fallback.provider !== primary.provider || fallback.model !== primary.model)) candidates.push({ model: fallback, fallback: true });
  let lastError: unknown;
  for (const candidate of candidates) {
    if (candidate.fallback && input.allowFallback && !input.allowFallback()) break;
    if (settings.studyAiLocalOnly && !isLocalStudyModel(candidate.model)) continue;
    const attempts = Math.max(1, Math.min(3, settings.studyAiRetryCount + 1));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const startedAt = new Date().toISOString();
      try { const value=await operation(candidate.model);recordStudyAiUsage({task:input.task,model:candidate.model,inputChars:input.inputChars,outputChars:input.outputChars?.(value)??JSON.stringify(value).length,status:'ok',fallbackUsed:candidate.fallback,startedAt});return {value,model:candidate.model,fallbackUsed:candidate.fallback}; }
      catch (cause) { lastError=cause;recordStudyAiUsage({task:input.task,model:candidate.model,inputChars:input.inputChars,outputChars:0,status:cause instanceof Error&&cause.name==='AbortError'?'cancelled':'error',fallbackUsed:candidate.fallback,error:cause instanceof Error?cause.message:String(cause),startedAt});if (input.allowFallback && !input.allowFallback()) throw cause; }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No fue posible completar la tarea de IA.');
}
