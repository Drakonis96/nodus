import type { DeepResearchProgress, DeepResearchReport, DeepResearchRequest, ModelRef } from '@shared/types';
import { completeJson, completeText } from './aiClient';
import { buildWritingWorkshopSnapshot } from './writingWorkshop';
import {
  orchestrateDeepResearch,
  type DeepResearchDeps,
  type DeepResearchPlan,
  type DeepResearchPlanSection,
  type FinalizeInput,
  type FinalizeResult,
  type PlanInput,
  type SectionInput,
} from './deepResearchCore';

// ─────────────────────────────────────────────────────────────────────────────
// AI + DB wiring for Deep Research. The control flow (planning, coverage, budget
// caps, citation policy, assembly) lives in the pure ./deepResearchCore module;
// here we only bind the injected dependencies to real provider/DB calls.
// ─────────────────────────────────────────────────────────────────────────────

export async function generateDeepResearchReport(
  request: DeepResearchRequest,
  onProgress?: (p: DeepResearchProgress) => void
): Promise<DeepResearchReport> {
  return orchestrateDeepResearch(request, realDeps(request.model ?? null), onProgress);
}

function realDeps(model: ModelRef | null): DeepResearchDeps {
  return {
    buildSnapshot: (brief) => buildWritingWorkshopSnapshot(brief),
    planReport: (input) => aiPlanReport(input, model),
    writeSection: (input) => aiWriteSection(input, model),
    finalize: (input) => aiFinalize(input, model),
  };
}

interface AiPlan {
  title?: string;
  abstract?: string;
  sections?: Array<Partial<DeepResearchPlanSection>>;
}

function isAiPlan(v: unknown): v is AiPlan {
  return typeof v === 'object' && v !== null && Array.isArray((v as AiPlan).sections);
}

async function aiPlanReport(input: PlanInput, model: ModelRef | null): Promise<DeepResearchPlan> {
  const system = [
    'Eres el planificador del modo Deep Research de Nodus.',
    'Diseñas el esqueleto de un informe académico riguroso y bien referenciado a partir de un grafo local de ideas, obras, huecos y contradicciones.',
    `El informe debe ocupar entre ${input.targetPages.min} y ${input.targetPages.max} páginas, así que planifica alrededor de ${input.sectionCount} secciones sustantivas (introducción, cuerpo por líneas argumentales, y síntesis/conclusión).`,
    'Reparte TODAS las ideas relevantes entre las secciones (cada idea en su sección principal). Asigna huecos y contradicciones donde aporten tensión.',
    'Usa EXCLUSIVAMENTE los identificadores que se te dan. No inventes ideas, obras ni ids.',
    'Devuelve SOLO JSON válido con la forma:',
    '{"title":"...","abstract":"...","sections":[{"id":"s1","title":"...","purpose":"...","keyClaims":["..."],"ideaIds":["..."],"workIds":["..."],"gapIds":["..."],"contradictionIds":["..."],"passageIds":["..."]}]}',
  ].join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      audiencia: input.audience ?? null,
      secciones_objetivo: input.sectionCount,
      paginas_objetivo: input.targetPages,
      ideas: input.ideas,
      temas: input.themes,
      huecos: input.gaps,
      contradicciones: input.contradictions,
      obras: input.works,
    },
    null,
    2
  );
  const ai = await completeJson<AiPlan>({ system, user, temperature: 0.2, maxTokens: 6000 }, isAiPlan, model);
  return {
    title: ai.title ?? '',
    abstract: ai.abstract ?? '',
    sections: (ai.sections ?? []).map((s, i) => ({
      id: s.id ?? `s${i + 1}`,
      title: s.title ?? `Sección ${i + 1}`,
      purpose: s.purpose ?? '',
      keyClaims: Array.isArray(s.keyClaims) ? s.keyClaims : [],
      ideaIds: Array.isArray(s.ideaIds) ? s.ideaIds : [],
      workIds: Array.isArray(s.workIds) ? s.workIds : [],
      gapIds: Array.isArray(s.gapIds) ? s.gapIds : [],
      contradictionIds: Array.isArray(s.contradictionIds) ? s.contradictionIds : [],
      passageIds: Array.isArray(s.passageIds) ? s.passageIds : [],
    })),
  };
}

async function aiWriteSection(input: SectionInput, model: ModelRef | null): Promise<string> {
  const system = [
    'Eres el redactor del modo Deep Research de Nodus: escribes UNA sección de un informe académico de nivel profesional.',
    'Escribe en español salvo que el idioma indicado pida otra lengua.',
    'Usa SOLO los materiales y las citas del menú proporcionado. No inventes obras, autores, datos ni páginas.',
    'Cada afirmación sustantiva debe ir respaldada por una cita del menú, colocada ENTRE PARÉNTESIS y en formato enlace Markdown nodus:// exactamente como aparece en el menú.',
    `Extensión objetivo: ~${input.targetWords} palabras, en 2-4 párrafos desarrollados. Nada de listas salvo que sean imprescindibles.`,
    'Relaciona las ideas entre sí: continuidad, diferencias, niveles de abstracción, consecuencias metodológicas, tensiones y huecos.',
    'No repitas lo ya dicho en secciones anteriores (se te da un resumen). Aporta desarrollo nuevo.',
    input.isConclusion
      ? 'Esta es la sección de cierre: integra las líneas del informe, nombra los huecos y perfila la contribución.'
      : 'Desarrolla la línea argumental de esta sección con profundidad.',
    'Empieza la sección con un encabezado Markdown "## " y el título dado. Devuelve solo el Markdown de la sección, sin JSON ni vallas de código.',
  ].join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      seccion: { titulo: input.section.title, proposito: input.section.purpose, afirmaciones_clave: input.section.keyClaims },
      menu_de_citas: input.citationMenu,
      resumen_secciones_previas: input.priorSummary || '(esta es la primera sección)',
    },
    null,
    2
  );
  return completeText({ system, user, temperature: 0.3, maxTokens: 3600 }, model);
}

interface AiFinal {
  title?: string;
  abstract?: string;
  limitations?: string[];
  nextSteps?: string[];
}
function isAiFinal(v: unknown): v is AiFinal {
  return typeof v === 'object' && v !== null;
}

async function aiFinalize(input: FinalizeInput, model: ModelRef | null): Promise<FinalizeResult> {
  const system = [
    'Cierras un informe académico de Deep Research de Nodus.',
    'Escribe en español salvo que el idioma pida otra lengua.',
    'Devuelve SOLO JSON válido: {"title":"título académico breve","abstract":"resumen de 6-10 líneas con la tesis del informe","limitations":["..."],"nextSteps":["..."]}',
    'El resumen debe reflejar el objetivo y las líneas del informe. Las limitaciones deben ser honestas (p. ej. ideas del corpus no desarrolladas).',
  ].join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      titulo_provisional: input.planTitle,
      secciones: input.sectionTitles,
      ideas_cubiertas: input.ideasCovered,
      ideas_consideradas: input.ideasConsidered,
      ideas_sin_cubrir_ejemplos: input.uncoveredSamples,
    },
    null,
    2
  );
  const ai = await completeJson<AiFinal>({ system, user, temperature: 0.2, maxTokens: 2000 }, isAiFinal, model);
  return {
    title: ai.title ?? input.planTitle,
    abstract: ai.abstract ?? '',
    limitations: Array.isArray(ai.limitations) ? ai.limitations : [],
    nextSteps: Array.isArray(ai.nextSteps) ? ai.nextSteps : [],
  };
}
