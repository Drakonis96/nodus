import type { AppLanguage, ModelRef } from '@shared/types';
import { dialog } from 'electron';
import type { StudyAiTask } from '@shared/studyAi';
import { isLocalStudyModel } from '@shared/studyAi';
import { getSettings } from '../db/settingsRepo';
import { getStudyAiUsageSummary, recordStudyAiUsage } from '../db/studyAiUsageRepo';

const primaryKey: Record<StudyAiTask, 'chatModel' | 'improveModel' | 'questionGenModel' | 'flashcardModel'> = { chat: 'chatModel', improve: 'improveModel', questions: 'questionGenModel', flashcards: 'flashcardModel' };
// A background pipeline may split one source into several AI calls. The optional
// request key lets those calls share one confirmation without suppressing consent
// for a later, genuinely separate user action.
const confirmedExternalRequests = new Set<string>();

function formatCount(value: number, language: AppLanguage): string {
  return value.toLocaleString(language === 'pt-BR' ? 'pt-BR' : language);
}

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

export async function runStudyAiTask<T>(input: { task: StudyAiTask; explicitModel?: ModelRef | null; subjectId?: string | null; inputChars: number; outputChars?: (value: T) => number; allowFallback?: () => boolean; externalPurpose?: string; externalDetail?: string; externalConsentKey?: string; externalConsentModelKey?: string }, operation: (model: ModelRef) => Promise<T>): Promise<{ value: T; model: ModelRef; fallbackUsed: boolean }> {
  const settings = getSettings(); const language = settings.uiLanguage; if (input.inputChars > settings.studyAiMaxInputChars) throw new Error(`La solicitud supera el límite configurado de ${formatCount(settings.studyAiMaxInputChars, language)} caracteres.`);
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
    const externallyApproved = input.externalConsentModelKey === '*' || input.externalConsentModelKey === externalKey;
    if (!isLocalStudyModel(candidate.model) && settings.studyAiConfirmExternal && !externallyApproved && !confirmedExternal.has(externalKey) && !(requestConsentKey && confirmedExternalRequests.has(requestConsentKey))) {
      const copy = {
        es: { title: 'Datos fuera del dispositivo', message: 'Nodus enviará esta solicitud de estudio a', purpose: 'Finalidad', detail: 'Se enviarán hasta', chars: 'caracteres según tus límites.', cancel: 'Cancelar', continue: 'Continuar' },
        en: { title: 'Data leaving this device', message: 'Nodus will send this study request to', purpose: 'Purpose', detail: 'Up to', chars: 'characters will be sent within your limits.', cancel: 'Cancel', continue: 'Continue' },
        fr: { title: 'Données hors de l’appareil', message: 'Nodus enverra cette demande d’étude à', purpose: 'Finalité', detail: 'Jusqu’à', chars: 'caractères seront envoyés dans vos limites.', cancel: 'Annuler', continue: 'Continuer' },
        de: { title: 'Daten verlassen dieses Gerät', message: 'Nodus sendet diese Studienanfrage an', purpose: 'Zweck', detail: 'Bis zu', chars: 'Zeichen werden innerhalb Ihrer Limits gesendet.', cancel: 'Abbrechen', continue: 'Weiter' },
        pt: { title: 'Dados fora do dispositivo', message: 'O Nodus enviará este pedido de estudo para', purpose: 'Finalidade', detail: 'Serão enviados até', chars: 'caracteres dentro dos seus limites.', cancel: 'Cancelar', continue: 'Continuar' },
        'pt-BR': { title: 'Dados fora do dispositivo', message: 'O Nodus enviará esta solicitação de estudo para', purpose: 'Finalidade', detail: 'Até', chars: 'caracteres serão enviados dentro dos seus limites.', cancel: 'Cancelar', continue: 'Continuar' },
        it: { title: 'Dati fuori dal dispositivo', message: 'Nodus invierà questa richiesta di studio a', purpose: 'Finalità', detail: 'Verranno inviati fino a', chars: 'caratteri entro i tuoi limiti.', cancel: 'Annulla', continue: 'Continua' },
        tr: { title: 'Veriler cihazdan çıkacak', message: 'Nodus bu çalışma isteğini şu sağlayıcıya gönderecek:', purpose: 'Amaç', detail: 'Sınırlarınız dahilinde en fazla', chars: 'karakter gönderilecek.', cancel: 'İptal', continue: 'Devam' },
      }[language] ?? null;
      const localized = copy ?? {
        title: 'Data leaving this device', message: 'Nodus will send this study request to', purpose: 'Purpose', detail: 'Up to', chars: 'characters will be sent within your limits.', cancel: 'Cancel', continue: 'Continue',
      };
      const response = dialog.showMessageBoxSync({
        type: 'warning', title: localized.title,
        message: `${localized.message} ${candidate.model.provider} (${candidate.model.model}).`,
        // externalDetail is where a caller states what its own privacy layer does and
        // does NOT cover. This dialog is the moment the user authorises the send, so it
        // is the only honest place to say it.
        detail: [
          `${localized.purpose}: ${input.externalPurpose ?? input.task}. ${localized.detail} ${formatCount(input.inputChars, language)} ${localized.chars}`,
          input.externalDetail,
        ].filter(Boolean).join('\n\n'),
        buttons: [localized.cancel, localized.continue], defaultId: 0, cancelId: 0, noLink: true,
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
