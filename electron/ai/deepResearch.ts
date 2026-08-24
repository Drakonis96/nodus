import type { DeepResearchProgress, DeepResearchReport, DeepResearchRequest, ModelRef } from '@shared/types';
import type { DeepResearchApproach } from '@shared/deepResearchApproaches';
import { normalizeDeepResearchApproach } from '@shared/deepResearchApproaches';
import { completeJson, completeText } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { generateGenealogyDeepResearchReport } from './genealogyDeepResearch';
import { generateStudyDeepResearchReport } from './studyDeepResearch';
import { buildWritingWorkshopSnapshot, retrieveSectionMaterial } from './writingWorkshop';
import {
  academicRelationshipContext,
  approachRules,
  mergeApproachSnapshots,
  planApproachRetrieval,
  type ApproachRetrievalPlan,
} from './deepResearchApproaches';
import {
  orchestrateDeepResearch,
  type DeepResearchDeps,
  type DeepResearchPlan,
  type DeepResearchPlanSection,
  type CitationClaim,
  type CitationVerdict,
  type CoherenceIssue,
  countWords,
  DEEP_RESEARCH_NARRATIVE_RULES,
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
  const settings = getSettings();
  const model = request.model ?? settings.deepResearchModel ?? settings.synthesisModel ?? null;
  const approach = normalizeDeepResearchApproach(request.approach);
  let report: DeepResearchReport;
  // Study and teaching share one pipeline over the local study_* corpus. Teaching adds
  // the extracted idea network and the unit prompts, selected by `unitMode`; the vault
  // type sets it for anything that reaches here without the flag (MCP, a stale queue).
  if (request.unitMode || getActiveVault().type === 'docencia') {
    report = await generateStudyDeepResearchReport({ ...request, unitMode: true }, model, onProgress);
    return withGenerationMetadata(report, approach, model);
  }
  if (request.studyMode || getActiveVault().type === 'estudio') {
    report = await generateStudyDeepResearchReport(request, model, onProgress);
    return withGenerationMetadata(report, approach, model);
  }
  // A genealogy vault has no idea graph; its Deep Research writes a family-history
  // report over the embedding-indexed archive + library instead (own pipeline).
  if (getActiveVault().type === 'genealogy') {
    report = await generateGenealogyDeepResearchReport(request, onProgress);
    return withGenerationMetadata(report, approach, model);
  }
  // Characterization boundary: General (including old requests with no approach)
  // still receives the exact historical request/dependency path. Specialized modes
  // alone enter the additive retrieval and prompt adapter below.
  report = deepResearchApproachPath(approach) === 'general'
    ? await orchestrateDeepResearch({ ...request, model }, realDeps(model), onProgress)
    : await orchestrateDeepResearch({ ...request, model }, specializedAcademicDeps(model, approach, request), onProgress);
  return withGenerationMetadata(report, approach, model);
}

/** Pure characterization seam used by CI to lock old/undefined requests to General. */
export function deepResearchApproachPath(value: unknown): 'general' | 'specialized' {
  return normalizeDeepResearchApproach(value) === 'general' ? 'general' : 'specialized';
}

function withGenerationMetadata(
  report: DeepResearchReport,
  approach: DeepResearchApproach,
  model: ModelRef | null,
): DeepResearchReport {
  return {
    ...report,
    draft: {
      ...report.draft,
      brief: { ...report.draft.brief, deepResearchApproach: approach },
      deepResearchApproach: approach,
      generationModel: model ? { ...model } : null,
    },
  };
}

function realDeps(model: ModelRef | null): DeepResearchDeps {
  return {
    // Single probe by default. Decomposing the objective into sub-questions was
    // measured on the real corpus and did NOT pay: without a relevance floor it
    // tripled unsupported citations (3% → 9%), and with one it changed only 5–10%
    // of the pool while slightly reducing the distinct works behind it. This corpus
    // is already concentrated on one domain, so every sub-question lands in the same
    // neighbourhood. `buildWritingWorkshopSnapshot` still takes extra probes, so a
    // broader corpus can switch this on by passing them here.
    buildSnapshot: (brief) => buildWritingWorkshopSnapshot(brief),
    planReport: (input) => aiPlanReport(input, model),
    writeSection: (input) => aiWriteSection(input, model),
    finalize: (input) => aiFinalize(input, model),
    retrieveForSection: (input) => retrieveSectionMaterial(input),
    expandSection: (input) => aiExpandSection(input, model),
    verifyCitations: (claims) => aiVerifyCitations(claims, model),
    checkCoherence: (sections) => aiCheckCoherence(sections, model),
  };
}

interface AcademicApproachContext {
  approach: DeepResearchApproach;
  rules: ReturnType<typeof approachRules>;
  retrieval: ApproachRetrievalPlan;
  relationships: ReturnType<typeof academicRelationshipContext>;
}

/** Specialized Academic adapter. It is intentionally unreachable from General. */
function specializedAcademicDeps(
  model: ModelRef | null,
  approach: DeepResearchApproach,
  request: DeepResearchRequest,
): DeepResearchDeps {
  let context: AcademicApproachContext = {
    approach,
    rules: approachRules(approach, 'academic'),
    retrieval: { probes: [], comparands: [], axes: [], phases: [] },
    relationships: [],
  };
  return {
    buildSnapshot: async (brief) => {
      // Keep the complete ordinary pool, then union/dedupe specialized retrieval.
      const ordinary = await buildWritingWorkshopSnapshot(brief);
      const retrieval = await planApproachRetrieval({
        approach,
        variant: 'academic',
        objective: request.objective,
        language: request.language ?? 'es',
        model,
        corpusPreview: {
          themes: ordinary.themes.slice(0, 16).map((item) => item.label),
          works: ordinary.works.slice(0, 24).map((item) => ({ title: item.title, authors: item.authors, year: item.year })),
          contradictions: ordinary.contradictions.slice(0, 16).map((item) => item.summary),
          gaps: ordinary.gaps.slice(0, 16).map((item) => item.summary),
        },
      });
      const supplemental = await buildWritingWorkshopSnapshot(brief, retrieval.probes);
      const merged = mergeApproachSnapshots(ordinary, supplemental, approach);
      context = { ...context, retrieval, relationships: academicRelationshipContext(merged) };
      return merged;
    },
    planReport: (input) => aiPlanReport(input, model, context),
    writeSection: (input) => aiWriteSection(input, model, context),
    finalize: (input) => aiFinalize(input, model, context),
    retrieveForSection: async (input) => {
      const ordinary = await retrieveSectionMaterial(input);
      const facets = [...context.retrieval.axes, ...context.retrieval.phases, ...context.retrieval.comparands]
        .slice(0, 3);
      if (!facets.length) return ordinary;
      const supplemental = await retrieveSectionMaterial({
        ...input,
        purpose: `${input.purpose}. ${facets.join('. ')}`,
        keyClaims: [...input.keyClaims, ...facets],
        limits: { ideas: input.limits.ideas * 2, passages: input.limits.passages * 2 },
      });
      return {
        ideas: [...ordinary.ideas, ...supplemental.ideas].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index),
        passages: [...ordinary.passages, ...supplemental.passages].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index),
      };
    },
    expandSection: (input) => aiExpandSection(input, model, context),
    verifyCitations: (claims) => aiVerifyCitations(claims, model),
    checkCoherence: (sections) => aiCheckCoherence(sections, model),
  };
}

interface AiCoherence {
  tensiones?: { seccion_a?: string; cita_a?: string; seccion_b?: string; cita_b?: string; problema?: string }[];
}
function isAiCoherence(v: unknown): v is AiCoherence {
  return typeof v === 'object' && v !== null;
}

/**
 * Look for places where the report argues against itself.
 *
 * Read-only by design. Both sides must be quoted verbatim so the orchestrator can
 * confirm the sentences exist before believing the finding — a model asked to find
 * contradictions will happily invent one, and an invented tension printed in the
 * limitations of an academic report is worse than no check at all.
 */
async function aiCheckCoherence(
  sections: { title: string; text: string }[],
  model: ModelRef | null
): Promise<CoherenceIssue[]> {
  const system = [
    'Revisas la coherencia interna de un informe académico ya redactado.',
    'Busca ÚNICAMENTE lugares donde el informe se contradice a sí mismo: dos pasajes que no pueden ser ciertos a la vez, o donde una sección afirma algo que otra niega o matiza hasta el punto de resultar incompatible.',
    'No señales repeticiones, cambios de énfasis, matices compatibles ni cuestiones de estilo. Un desacuerdo ENTRE AUTORES citados no es una contradicción del informe: eso es un debate y es correcto que aparezca.',
    'Cita ambos pasajes LITERALMENTE, copiando una frase completa de cada uno tal y como aparece en el texto. Si no puedes copiarlas literalmente, no incluyas la tensión.',
    'Si el informe es coherente, devuelve una lista vacía. Es la respuesta esperada la mayoría de las veces.',
    'Devuelve SOLO JSON válido: {"tensiones":[{"seccion_a":"...","cita_a":"...","seccion_b":"...","cita_b":"...","problema":"en una frase, qué es incompatible"}]}',
  ].join('\n');
  const user = JSON.stringify(
    { secciones: sections.map((s) => ({ titulo: s.title, texto: s.text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') })) },
    null,
    2
  );
  try {
    const ai = await completeJson<AiCoherence>({ system, user, temperature: 0, maxTokens: 1400 }, isAiCoherence, model);
    return (ai.tensiones ?? [])
      .filter((t) => t && typeof t.cita_a === 'string' && typeof t.cita_b === 'string')
      .slice(0, 5)
      .map((t) => ({
        sectionA: String(t.seccion_a ?? ''),
        quoteA: String(t.cita_a ?? ''),
        sectionB: String(t.seccion_b ?? ''),
        quoteB: String(t.cita_b ?? ''),
        issue: String(t.problema ?? '').trim() || 'Afirmaciones incompatibles entre secciones.',
      }));
  } catch {
    return [];
  }
}

interface AiProbes {
  subpreguntas?: string[];
}
function isAiProbes(v: unknown): v is AiProbes {
  return typeof v === 'object' && v !== null;
}

/**
 * Break the objective into the questions a researcher would actually go looking for.
 *
 * The corpus is searched by semantic similarity, so a single probe reaches only what
 * resembles the objective *as a whole sentence*. An objective spanning several axes
 * retrieves the intersection and misses what each axis would surface on its own —
 * with ~10,000 ideas indexed, a report was being built on the neighbourhood of one
 * query. Each sub-question becomes an independent probe. Failure is harmless: the
 * objective alone still works exactly as before.
 */
async function aiDecomposeObjective(objective: string, language: string | undefined, model: ModelRef | null): Promise<string[]> {
  const system = [
    'Descompones un objetivo de investigación en las preguntas concretas que habría que buscar por separado en una biblioteca académica.',
    'Cada subpregunta debe ser autónoma y buscable por sí sola, formulada como una frase con contenido (no una etiqueta de dos palabras).',
    'Cubre ejes distintos del objetivo: sus conceptos, sus actores, sus periodos, sus métodos y sus controversias. No repitas el objetivo con otras palabras.',
    'Entre 5 y 7 subpreguntas. Devuelve SOLO JSON válido: {"subpreguntas":["...","..."]}',
  ].join('\n');
  try {
    const ai = await completeJson<AiProbes>(
      { system, user: JSON.stringify({ objetivo: objective, idioma: language ?? 'es' }), temperature: 0.2, maxTokens: 700 },
      isAiProbes,
      model
    );
    return (ai.subpreguntas ?? [])
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 12)
      .slice(0, 7);
  } catch {
    return [];
  }
}

/** Exposed for `scripts/measure-retrieval-breadth.mjs`. */
export const __decomposeObjectiveForTesting = aiDecomposeObjective;

/** How many claims are judged per call. Small enough that the judge reads each one. */
const VERIFY_BATCH = 12;

/**
 * Exposed for `scripts/verify-citation-judge.mjs`, which feeds the judge deliberately
 * false citations to check it rejects them. A verifier nobody audits can quietly
 * approve everything and still look like it is working.
 */
export const __verifyCitationsForTesting = aiVerifyCitations;

interface AiVerdicts {
  veredictos?: { i?: number; veredicto?: string }[];
}
function isAiVerdicts(v: unknown): v is AiVerdicts {
  return typeof v === 'object' && v !== null && Array.isArray((v as AiVerdicts).veredictos);
}

/**
 * Judge whether each cited source really supports the sentence it was attached to.
 *
 * The citation policy already proves the source exists in the corpus; this is the
 * only thing standing between "the report cites something real" and "the report
 * cites something that says what the report claims it says". A claim whose judgement
 * cannot be obtained defaults to `supports`, because deleting a citation on the
 * strength of a failed API call would silently damage a correct report.
 */
export async function aiVerifyCitations(claims: CitationClaim[], model: ModelRef | null): Promise<CitationVerdict[]> {
  const verdicts: CitationVerdict[] = new Array(claims.length).fill('supports');
  const system = [
    'Eres el verificador de citas del modo Deep Research de Nodus.',
    'Para cada par recibes UNA afirmación tal como aparece en un informe académico y el CONTENIDO de la fuente que se ha citado para sostenerla.',
    'Tu única tarea es decidir si esa fuente sostiene esa afirmación. No juzgues si la afirmación es cierta en el mundo, ni si está bien escrita, ni si la fuente es buena.',
    'Veredictos posibles:',
    '- "sostiene": el contenido afirma, implica o documenta directamente lo que dice la frase.',
    '- "parcial": el contenido sostiene una parte de la frase, o una versión más débil o más limitada de lo que afirma.',
    '- "no_sostiene": el contenido trata de otra cosa, dice algo distinto, o no permite afirmar lo que la frase sostiene.',
    'Una frase puede citar varias fuentes: juzga SOLO la que se te da en cada par, aunque otra fuente distinta pudiera sostener la frase.',
    'Ante la duda razonable entre "sostiene" y "parcial", elige "parcial". Reserva "no_sostiene" para cuando la relación sea realmente inexistente.',
    'Devuelve SOLO JSON válido: {"veredictos":[{"i":0,"veredicto":"sostiene|parcial|no_sostiene"}]} con una entrada por par y el mismo índice que recibiste.',
  ].join('\n');

  for (let start = 0; start < claims.length; start += VERIFY_BATCH) {
    const batch = claims.slice(start, start + VERIFY_BATCH);
    const user = JSON.stringify(
      {
        pares: batch.map((claim, offset) => ({
          i: offset,
          afirmacion: claim.sentence,
          tipo_de_fuente: claim.kind,
          contenido_de_la_fuente: claim.content,
        })),
      },
      null,
      2
    );
    try {
      const ai = await completeJson<AiVerdicts>({ system, user, temperature: 0, maxTokens: 1400 }, isAiVerdicts, model);
      for (const entry of ai.veredictos ?? []) {
        const at = start + (typeof entry.i === 'number' ? entry.i : -1);
        if (at < start || at >= start + batch.length) continue;
        const raw = String(entry.veredicto ?? '').toLowerCase();
        verdicts[at] = raw.includes('no_sostiene') ? 'unsupported' : raw.includes('parcial') ? 'partial' : 'supports';
      }
    } catch {
      /* this batch keeps its optimistic default */
    }
  }
  return verdicts;
}

/**
 * Rewrite a section that came back too short. Writers under-deliver against a word
 * target, and accepting that silently is what kept reports pinned to the floor of
 * their page range. The model is given its own draft and told to deepen it with the
 * material it already had, never to pad.
 */
async function aiExpandSection(
  input: SectionInput & { draft: string; missingWords: number },
  model: ModelRef | null,
  approach?: AcademicApproachContext,
): Promise<string> {
  const system = [
    'Eres el redactor del modo Deep Research de Nodus. Recibes un borrador PROPIO de una sección que se ha quedado corto y debes desarrollarlo.',
    'Escribe en español salvo que el idioma indicado pida otra lengua.',
    `El borrador tiene unas ${countWords(input.draft)} palabras y la sección debía tener ~${input.targetWords}. Faltan del orden de ${input.missingWords} palabras.`,
    'NO rellenes. Desarrolla: recupera del menú de citas el material que el borrador dejó sin usar, contrasta ideas que quedaron sueltas, desarrolla las contradicciones como debates entre autores y explica los huecos en vez de nombrarlos.',
    'Conserva íntegro lo que ya estaba bien, incluidas TODAS las citas nodus:// tal cual aparecen. Puedes reordenar y reescribir para integrar lo nuevo, pero no elimines citas existentes.',
    'Cada afirmación nueva necesita su cita del menú, entre paréntesis y en el formato exacto del menú.',
    ...(approach?.rules.writer ?? []),
    ...DEEP_RESEARCH_NARRATIVE_RULES,
    'Empieza con el encabezado Markdown "## " y el título dado. Devuelve solo el Markdown completo de la sección ampliada, sin JSON ni vallas de código.',
  ].join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      seccion: { titulo: input.section.title, proposito: input.section.purpose, afirmaciones_clave: input.section.keyClaims },
      menu_de_citas: input.citationMenu,
      borrador_actual: input.draft,
      afirmaciones_ya_desarrolladas_en_otras_secciones: input.alreadyDeveloped,
      ...(approach ? { enfoque_de_investigacion: approach.approach, estrategia_de_recuperacion: approach.retrieval } : {}),
    },
    null,
    2
  );
  return completeText({ system, user, temperature: 0.3, maxTokens: 6500 }, model);
}

interface AiPlan {
  title?: string;
  abstract?: string;
  sections?: Array<Partial<DeepResearchPlanSection>>;
}

function isAiPlan(v: unknown): v is AiPlan {
  return typeof v === 'object' && v !== null && Array.isArray((v as AiPlan).sections);
}

async function aiPlanReport(input: PlanInput, model: ModelRef | null, approach?: AcademicApproachContext): Promise<DeepResearchPlan> {
  const countRule =
    input.sectionMode === 'user'
      ? `El usuario ha fijado un máximo de ${input.sectionCount} secciones. No tienes que agotarlo. Usa menos si el argumento gana continuidad y nunca lo superes en el plan inicial.`
      : `Planifica en torno a ${input.sectionCount} secciones amplias y nunca superes esa cifra en el plan inicial. Usa menos si el material no justifica un corte argumental independiente.`;
  const system = [
    'Eres el planificador del modo Deep Research de Nodus.',
    'Diseñas el esqueleto de un informe académico riguroso y bien referenciado a partir de un grafo local de ideas, obras, huecos y contradicciones.',
    'PRINCIPIO CLAVE: prefiere POCAS secciones LARGAS y de gran profundidad antes que muchas secciones cortas. Cada sección debe agrupar varias ideas afines y desarrollarlas relacionándolas entre sí, no una idea por sección.',
    'Cada título debe nombrar una línea argumental amplia. Evita títulos partidos por dos puntos, punto y coma o guion largo.',
    countRule,
    `El cuerpo del informe debe ocupar entre ${input.targetPages.min} y ${input.targetPages.max} páginas repartidas entre esas pocas secciones (introducción, cuerpo por líneas argumentales amplias y síntesis/conclusión). La bibliografía final NO cuenta para esa extensión.`,
    'Agrupa las ideas por afinidad temática o argumental: cada sección reúne un CONJUNTO de ideas relacionadas, no una sola. Reparte TODAS las ideas relevantes entre las secciones. Asigna huecos y contradicciones donde aporten tensión.',
    // Order is planned, not left to the order the sections happen to be emitted in.
    'ORDEN DEL ARGUMENTO: el informe debe leerse como un razonamiento que progresa, no como una lista de temas. Marca `role` con "intro" para el planteamiento, "body" para el desarrollo y "synthesis" para el cierre, y usa `dependsOn` para declarar de qué secciones previas depende cada una porque dan por establecido algo que necesita.',
    'Ordena de modo que ninguna sección presuponga algo que solo se establece más adelante. Si el material tiene una dimensión histórica, respétala: lo que explica el origen va antes que lo que explica su consecuencia.',
    'Reparte las obras entre secciones: evita que una sección dependa casi entera de una sola obra o de un solo autor cuando el corpus ofrece alternativas.',
    ...(approach?.rules.planner ?? []),
    'Usa EXCLUSIVAMENTE los identificadores que se te dan. No inventes ideas, obras ni ids.',
    'Devuelve SOLO JSON válido con la forma:',
    '{"title":"...","abstract":"...","sections":[{"id":"s1","role":"intro|body|synthesis","dependsOn":["s2"],"title":"...","purpose":"...","keyClaims":["..."],"ideaIds":["..."],"workIds":["..."],"gapIds":["..."],"contradictionIds":["..."],"passageIds":["..."]}]}',
  ].join('\n');
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      audiencia: input.audience ?? null,
      secciones_objetivo: input.sectionCount,
      secciones_maximo_absoluto: input.sectionHardCap,
      numero_secciones: input.sectionMode === 'user' ? 'fijado_por_usuario' : 'a_decidir_por_ti',
      paginas_objetivo: input.targetPages,
      ideas: input.ideas,
      temas: input.themes,
      huecos: input.gaps,
      contradicciones: input.contradictions,
      obras: input.works,
      ...(approach ? {
        enfoque_de_investigacion: approach.approach,
        plan_de_recuperacion: approach.retrieval,
        relaciones_del_grafo: approach.relationships,
      } : {}),
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
      role: s.role,
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
    })),
  };
}

async function aiWriteSection(input: SectionInput, model: ModelRef | null, approach?: AcademicApproachContext): Promise<string> {
  const system = [
    'Eres el redactor del modo Deep Research de Nodus: escribes UNA sección de un informe académico de nivel profesional.',
    'Escribe en español salvo que el idioma indicado pida otra lengua.',
    'Usa SOLO los materiales y las citas del menú proporcionado. No inventes obras, autores, datos ni páginas.',
    'Cada afirmación sustantiva debe ir respaldada por una cita del menú, colocada ENTRE PARÉNTESIS y en formato enlace Markdown nodus:// exactamente como aparece en el menú.',
    // Every menu entry now carries its real content, so the writer can be held to it.
    'Cada entrada del menú incluye el contenido real de lo que cita en el campo "note". Apóyate en ese contenido: no cites nada cuyo "note" no sostenga lo que afirmas.',
    'Los pasajes ("kind":"passage") traen el texto literal de la obra entre comillas angulares. Úsalos como evidencia textual, parafrasea o cita con precisión y no extiendas su sentido más allá de lo que dicen.',
    'Los huecos ("kind":"gap") y las contradicciones ("kind":"contradiction") traen en "note" lo que realmente afirman. Arguméntalos por su contenido, no los menciones de pasada como etiquetas.',
    'Cuando el menú traiga una contradicción, conviértela en un debate explícito: nombra las dos posturas y, si el campo "source" dice quién las sostiene, atribúyelas a esos autores. Un desacuerdo entre investigadores es más informativo que una afirmación unánime.',
    'RIQUEZA DE FUENTES: no sostengas una sección con una sola obra ni con un solo autor. Alterna entre las fuentes del menú y, cuando varias sostengan lo mismo, dilo explícitamente porque la convergencia entre autores independientes es un argumento en sí. Si una afirmación descansa en una única fuente, deja constancia de ello en la prosa.',
    'Cuando cites un hueco, no te limites a constatar que falta investigación: explica qué impide concluir y qué haría falta para cerrarlo.',
    `Extensión objetivo: ~${input.targetWords} palabras (es una sección de fondo, extensa y desarrollada), en 4-7 párrafos densos. Nada de listas salvo que sean imprescindibles.`,
    'Desarrolla la sección con profundidad real: no te limites a enunciar cada idea; contrástalas, encadénalas y construye un argumento continuo que atraviese todas las ideas asignadas.',
    'Relaciona las ideas entre sí: continuidad, diferencias, niveles de abstracción, consecuencias metodológicas, tensiones y huecos.',
    'No repitas lo ya dicho en secciones anteriores. Se te dan el recorrido de cada sección previa y la lista de afirmaciones ya desarrolladas: puedes apoyarte en ellas y remitir a ellas, pero el desarrollo de esta sección debe ser nuevo.',
    ...(approach?.rules.writer ?? []),
    ...DEEP_RESEARCH_NARRATIVE_RULES,
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
      recorrido_secciones_previas: input.priorSummary || '(esta es la primera sección)',
      afirmaciones_ya_desarrolladas: input.alreadyDeveloped,
      ...(approach ? {
        enfoque_de_investigacion: approach.approach,
        comparandos: approach.retrieval.comparands,
        ejes: approach.retrieval.axes,
        fases: approach.retrieval.phases,
        relaciones_del_grafo: approach.relationships.slice(0, 40),
      } : {}),
    },
    null,
    2
  );
  return completeText({ system, user, temperature: 0.3, maxTokens: 5200 }, model);
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

async function aiFinalize(input: FinalizeInput, model: ModelRef | null, approach?: AcademicApproachContext): Promise<FinalizeResult> {
  const system = [
    'Cierras un informe académico de Deep Research de Nodus.',
    'Escribe en español salvo que el idioma pida otra lengua.',
    'Devuelve SOLO JSON válido: {"title":"título académico breve","abstract":"resumen de 6-10 líneas con la tesis del informe","limitations":["..."],"nextSteps":["..."]}',
    'El resumen debe reflejar el objetivo y las líneas del informe. Las limitaciones deben ser honestas (p. ej. ideas del corpus no desarrolladas).',
    'Redacta el título y el resumen como prosa fluida. Evita dos puntos, punto y coma y guion largo salvo necesidad estricta.',
    ...(approach?.rules.finalizer ?? []),
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
      ...(approach ? { enfoque_de_investigacion: approach.approach, plan_de_recuperacion: approach.retrieval } : {}),
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
