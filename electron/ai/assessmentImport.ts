/** AI may structure a teacher-authored assessment plan, but never student data. */
import { completeJson } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';
import { getAssessmentPlan } from '../db/teachingGradesRepo';
import { isProposedPlan, type ProposedPlan } from '@shared/assessmentImport';

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
