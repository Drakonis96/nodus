/**
 * AI over the gradebook.
 *
 * Two features, and the split between them is the point:
 *
 *  · `importAssessmentPlan` reads a teacher's own guía docente or programación and
 *    proposes a STRUCTURE. It never computes a grade — the engine does that. This is
 *    the same division the database vault already uses for analysis, and it is what
 *    keeps the arithmetic auditable.
 *
 *  · `draftStudentFeedback` is the first production consumer of the student
 *    pseudonymisation layer. Names are replaced with opaque codes before anything
 *    leaves the machine and restored on the way back, so a model drafting a comment
 *    about a minor never learns who they are.
 *
 * The privacy scope is opened OUTSIDE `runStudyAiTask`, never inside: the policy layer
 * retries and can switch to a fallback model, and a map rebuilt mid-flight would make
 * two attempts disagree about who `STU_7K3Q` is.
 */
import { completeJson, completeText } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';
import { withStudentPseudonyms, privacyConsentDetail } from './studentPrivacyContext';
import { pseudonymStudentsForGroup } from '../db/teachingGroupsRepo';
import { getAssessmentPlan } from '../db/teachingGradesRepo';
import { isProposedPlan, type ProposedPlan } from '@shared/assessmentImport';
import { labelFor, buildPseudonymScope } from '@shared/studentPseudonyms';

const IMPORT_SYSTEM = [
  'Eres un asistente que convierte la tabla de evaluación de una guía docente o de una',
  'programación didáctica en una estructura de bloques ponderados.',
  '',
  'Devuelve SOLO JSON con esta forma:',
  '{"items":[{"name":"...","weight":50,"minToAverage":0.4,"isMandatory":true,',
  '"evidence":"fragmento literal","children":[{"name":"...","weight":30}]}],"notes":"..."}',
  '',
  'Reglas estrictas:',
  '- "weight" es el porcentaje tal y como aparece en el documento. No lo inventes ni lo',
  '  reescales: si los porcentajes no suman 100, respétalos y dilo en "notes".',
  '- "minToAverage" solo si el texto exige una nota mínima para promediar, expresada',
  '  como fracción de la nota máxima (un "4 sobre 10" es 0.4).',
  '- "isMandatory" solo si el texto dice que hay que superar esa parte.',
  '- "isRecoverable": false solo si el texto dice que esa parte no se recupera.',
  '- "evidence" es una cita LITERAL y breve del documento. No la parafrasees.',
  '- No añadas bloques que no aparezcan en el texto. Si algo no se puede expresar como',
  '  estructura, resúmelo en "notes".',
].join('\n');

export interface ImportPlanRequest {
  planId: string;
  /** The pasted evaluation table or section. */
  text: string;
}

export async function importAssessmentPlan(request: ImportPlanRequest): Promise<ProposedPlan> {
  const { plan } = getAssessmentPlan(request.planId);
  const text = request.text.trim();
  if (!text) throw new Error('Pega el apartado de evaluación de tu guía docente o programación.');

  // No roster data here, so no pseudonymisation scope: a guía docente describes the
  // assessment, not the students.
  const outcome = await runStudyAiTask(
    {
      task: 'chat',
      subjectId: plan.subjectId,
      inputChars: text.length + IMPORT_SYSTEM.length,
      externalPurpose: 'Convertir la tabla de evaluación de una guía docente en bloques ponderados.',
      externalConsentKey: `assessment-import:${plan.id}`,
    },
    (model) => completeJson<ProposedPlan>({ system: IMPORT_SYSTEM, user: text, temperature: 0 }, isProposedPlan, model),
  );
  return outcome.value;
}

export interface FeedbackRequest {
  planId: string;
  groupId: string;
  studentId: string;
  /** Pre-rendered summary of the marks, already in code space where names would be. */
  summary: string;
}

/**
 * Drafts a short comment about one student's performance.
 *
 * Everything the model sees refers to the student by their opaque code; the reply is
 * mapped back before the teacher reads it. If pseudonymisation is switched off the
 * scope is simply not opened and the names go as they are — that is the user's choice,
 * made explicitly in Settings.
 */
export async function draftStudentFeedback(request: FeedbackRequest): Promise<{ text: string; warnings: string[] }> {
  const { plan } = getAssessmentPlan(request.planId);
  const students = pseudonymStudentsForGroup(request.groupId);
  const scope = buildPseudonymScope(students);
  const label = labelFor(scope, request.studentId);

  const system = [
    'Eres un docente redactando un comentario breve y constructivo sobre el rendimiento',
    'de un estudiante, dirigido a la familia. Dos o tres frases, en el idioma del texto.',
    'Refiérete al estudiante SIEMPRE por el identificador que aparece en los datos.',
    'No inventes datos que no estén en el resumen.',
  ].join('\n');
  const user = `Estudiante: ${label}\n\n${request.summary}`;

  return withStudentPseudonyms({ groupId: request.groupId, students }, async (privacy) => {
    const outcome = await runStudyAiTask(
      {
        task: 'chat',
        subjectId: plan.subjectId,
        inputChars: user.length + system.length,
        externalPurpose: 'Redactar un comentario sobre el rendimiento de un estudiante.',
        externalDetail: privacyConsentDetail(privacy),
        externalConsentKey: `feedback:${plan.id}`,
      },
      (model) => completeText({ system, user, temperature: 0.3 }, model),
    );
    const text = outcome.value;
    // Drained after the call: warnings are raised while the payload is rewritten.
    const warnings = (privacy?.warnings ?? []).map((warning) =>
      warning.kind === 'ambiguous'
        ? `«${warning.token}» puede referirse a ${warning.candidateCount} estudiantes: se ha enviado sin sustituir.`
        : warning.kind === 'common-word'
          ? `«${warning.token}» es también una palabra corriente: se ha enviado sin sustituir.`
          : `Identificador no reconocido: ${warning.code}.`,
    );
    return { text, warnings };
  });
}
