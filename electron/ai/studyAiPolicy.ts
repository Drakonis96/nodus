import type { ModelRef } from '@shared/types';
import { dialog } from 'electron';
import type { StudyAiTask } from '@shared/studyAi';
import { isLocalStudyModel } from '@shared/studyAi';
import { getSettings } from '../db/settingsRepo';
import { getStudyAiUsageSummary, recordStudyAiUsage } from '../db/studyAiUsageRepo';

const primaryKey: Record<StudyAiTask, 'chatModel' | 'improveModel' | 'questionGenModel' | 'gradingModel' | 'flashcardModel'> = { chat: 'chatModel', improve: 'improveModel', questions: 'questionGenModel', grading: 'gradingModel', flashcards: 'flashcardModel' };
// A background pipeline may split one source into several AI calls. The optional
// request key lets those calls share one confirmation without suppressing consent
// for a later, genuinely separate user action.
const confirmedExternalRequests = new Set<string>();

export function resolveStudyAiTaskModel(task: StudyAiTask, explicit?: ModelRef | null, subjectId?: string | null): ModelRef {
  const settings = getSettings(); const scoped = subjectId ? settings.studyAiSubjectModels[subjectId]?.[task] : null;
  if (!settings.studyAiEnabled) throw new Error('Las funciones de IA del vault de estudio están desactivadas en Ajustes.');
  const primary = explicit ?? scoped ?? settings[primaryKey[task]] ?? settings.studyModel ?? settings.synthesisModel;
  if (!primary?.provider || !primary.model) throw new Error('No hay un modelo de IA configurado. Elige uno en Ajustes.');
  const model = primary;
  if ((settings.studyAiPrivacyMode === 'local' || settings.studyAiLocalOnly) && !isLocalStudyModel(model)) throw new Error(`El modo local («solo modelos locales») impide usar ${model.provider}.`);
  if (settings.studyAiPrivacyMode === 'external' && isLocalStudyModel(model)) throw new Error(`El modo externo requiere un proveedor remoto; ${model.provider} es local.`);
  if (subjectId && settings.studyAiExcludedSubjectIds.includes(subjectId) && !isLocalStudyModel(model)) throw new Error('Esta asignatura está excluida del procesamiento externo. Usa un modelo local o elimina la exclusión en Ajustes.');
  return model;
}

export async function runStudyAiTask<T>(input: { task: StudyAiTask; explicitModel?: ModelRef | null; subjectId?: string | null; inputChars: number; outputChars?: (value: T) => number; allowFallback?: () => boolean; externalPurpose?: string; externalConsentKey?: string }, operation: (model: ModelRef) => Promise<T>): Promise<{ value: T; model: ModelRef; fallbackUsed: boolean }> {
  const settings = getSettings(); if (input.inputChars > settings.studyAiMaxInputChars) throw new Error(`La solicitud supera el límite configurado de ${settings.studyAiMaxInputChars.toLocaleString('es-ES')} caracteres.`);
  const summary = getStudyAiUsageSummary(); if (summary.budgetUsd > 0 && summary.knownCostUsd >= summary.budgetUsd) throw new Error('Se ha alcanzado el presupuesto mensual de IA para estudio.');
  const primary = resolveStudyAiTaskModel(input.task, input.explicitModel, input.subjectId);
  if (process.env.NODUS_E2E_FORCE_STUDY_AI_FAILURE === '1') {
    const error = new Error('E2E: proveedor de IA no disponible.');
    recordStudyAiUsage({ task: input.task, model: primary, inputChars: input.inputChars, outputChars: 0, status: 'error', fallbackUsed: false, error: error.message, startedAt: new Date().toISOString() });
    throw error;
  }
  const fallback = settings.studyAiFallbackModels[input.task];
  const candidates: Array<{ model: ModelRef; fallback: boolean }> = [{ model: primary, fallback: false }];
  if (fallback?.provider && fallback.model && (fallback.provider !== primary.provider || fallback.model !== primary.model)) candidates.push({ model: fallback, fallback: true });
  let lastError: unknown;
  const confirmedExternal = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.fallback && input.allowFallback && !input.allowFallback()) break;
    if ((settings.studyAiPrivacyMode === 'local' || settings.studyAiLocalOnly) && !isLocalStudyModel(candidate.model)) continue;
    if (settings.studyAiPrivacyMode === 'external' && isLocalStudyModel(candidate.model)) continue;
    if (input.subjectId && settings.studyAiExcludedSubjectIds.includes(input.subjectId) && !isLocalStudyModel(candidate.model)) continue;
    const externalKey = `${candidate.model.provider}:${candidate.model.model}`;
    const requestConsentKey = input.externalConsentKey ? `${externalKey}:${input.externalConsentKey}` : null;
    if (!isLocalStudyModel(candidate.model) && settings.studyAiConfirmExternal && !confirmedExternal.has(externalKey) && !(requestConsentKey && confirmedExternalRequests.has(requestConsentKey))) {
      const response = dialog.showMessageBoxSync({
        type: 'warning', title: 'Datos fuera del dispositivo',
        message: `Nodus enviará esta solicitud de estudio a ${candidate.model.provider} (${candidate.model.model}).`,
        detail: `Finalidad: ${input.externalPurpose ?? input.task}. Se enviarán hasta ${input.inputChars.toLocaleString('es-ES')} caracteres según tus límites.`,
        buttons: ['Cancelar', 'Continuar'], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (response !== 1) throw new Error('Envío externo cancelado por el usuario.');
      confirmedExternal.add(externalKey);
      if (requestConsentKey) confirmedExternalRequests.add(requestConsentKey);
    }
    const attempts = Math.max(1, Math.min(3, settings.studyAiRetryCount + 1));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const startedAt = new Date().toISOString();
      try { const value=await operation(candidate.model);recordStudyAiUsage({task:input.task,model:candidate.model,inputChars:input.inputChars,outputChars:input.outputChars?.(value)??JSON.stringify(value).length,status:'ok',fallbackUsed:candidate.fallback,startedAt});return {value,model:candidate.model,fallbackUsed:candidate.fallback}; }
      catch (cause) { lastError=cause;recordStudyAiUsage({task:input.task,model:candidate.model,inputChars:input.inputChars,outputChars:0,status:cause instanceof Error&&cause.name==='AbortError'?'cancelled':'error',fallbackUsed:candidate.fallback,error:cause instanceof Error?cause.message:String(cause),startedAt});if (input.allowFallback && !input.allowFallback()) throw cause; }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No fue posible completar la tarea de IA.');
}
