import type {
  DeepResearchApproach,
} from '@shared/deepResearchApproaches';
import {
  normalizeDeepResearchApproach,
} from '@shared/deepResearchApproaches';
import type {
  ModelRef,
  PromptLanguage,
  WritingWorkshopIdeaCandidate,
  WritingWorkshopSnapshot,
} from '@shared/types';
import { completeJson } from './aiClient';
import { getDb } from '../db/database';

export type DeepResearchApproachVariant = 'academic' | 'genealogy' | 'study' | 'unit' | 'client';

interface VariantRules {
  retrieval?: string[];
  planner?: string[];
  writer?: string[];
  finalizer?: string[];
}

export interface DeepResearchApproachProfile {
  id: DeepResearchApproach;
  retrievalRules: string[];
  plannerRules: string[];
  writerRules: string[];
  finalizerRules: string[];
  retrievalFacets: string[];
  variants?: Partial<Record<DeepResearchApproachVariant, VariantRules>>;
}

const GENERAL: DeepResearchApproachProfile = {
  id: 'general',
  retrievalRules: [],
  plannerRules: [],
  writerRules: [],
  finalizerRules: [],
  retrievalFacets: [],
};

const PROFILES: Record<DeepResearchApproach, DeepResearchApproachProfile> = {
  general: GENERAL,
  literature_review: {
    id: 'literature_review',
    retrievalRules: [
      'Amplía la recuperación hacia las principales interpretaciones, marcos, métodos, acuerdos y desacuerdos pertinentes al objetivo.',
      'Busca diversidad de obras y autores. No dejes que una sola obra domine cuando el corpus ofrece alternativas relevantes.',
      'Incluye cambios de interpretación entre publicaciones cuando las fechas disponibles permiten sostenerlos.',
    ],
    plannerRules: [
      'Organiza el informe por problemas, escuelas, enfoques, interpretaciones o temas. Nunca crees una sección por autor.',
      'El plan debe hacer visibles las grandes líneas interpretativas, la convergencia, el desacuerdo, las diferencias metodológicas, la evolución respaldada por fechas y las cuestiones no resueltas.',
    ],
    writerRules: [
      'Sintetiza las fuentes unas contra otras. Evita una sucesión del tipo «A dice, B dice, C dice».',
      'Distingue explícitamente los acuerdos amplios de las afirmaciones aisladas y explica cómo difieren las razones, métodos o énfasis de las fuentes.',
    ],
    finalizerRules: [
      'El resumen y la conclusión deben explicar la estructura de la literatura, sus líneas interpretativas, acuerdos, desacuerdos y preguntas no resueltas.',
      'Nunca presentes el corpus disponible en Nodus como si equivaliera a todo el campo académico.',
    ],
    retrievalFacets: ['principales enfoques', 'interpretaciones', 'diferencias metodológicas', 'acuerdos', 'desacuerdos'],
    variants: {
      genealogy: {
        retrieval: ['Da peso adicional a la bibliografía secundaria y a sus interpretaciones, manteniéndola claramente separada de la prueba archivística primaria.'],
        planner: ['Contrasta interpretaciones de la bibliografía secundaria sin convertirlas en hechos familiares probados.'],
      },
      study: {
        planner: ['Presenta como líneas interpretativas las perspectivas realmente representadas en los materiales de estudio.'],
        writer: [
          'Mantén claridad pedagógica al sintetizar perspectivas y métodos.',
          'Da por establecidos los conceptos ya explicados en previousSections. No vuelvas a definirlos ni reconstruyas su explicación; enlaza con una sola frase y dedica esta sección exclusivamente a su problema interpretativo nuevo.',
        ],
        finalizer: ['Resume únicamente perspectivas, acuerdos o desacuerdos representados en los materiales; si solo hay una perspectiva, dilo en vez de inventar un debate.'],
      },
      unit: {
        planner: ['La unidad debe enseñar las perspectivas y métodos representados en los materiales. La estructura fijada por el docente sigue teniendo prioridad absoluta.'],
      },
    },
  },
  state_of_art: {
    id: 'state_of_art',
    retrievalRules: [
      'Enriquece material sobre hallazgos establecidos, convergencia entre obras, controversias, huecos, limitaciones y métodos.',
      'Usa las fechas como contexto de desarrollo, nunca como una puntuación automática de calidad.',
      'Da peso a las ideas con respaldo en varias obras y conserva material débil o contradictorio para poder calificarlo con honestidad.',
    ],
    plannerRules: [
      'Organiza el informe en conocimiento establecido, convergencia, cuestiones discutidas, limitaciones metodológicas o probatorias y problemas abiertos.',
    ],
    writerRules: [
      'Diferencia con claridad entre lo sólidamente apoyado en el corpus, lo apoyado de forma limitada, lo discutido, lo no resuelto y lo ausente o infrarrepresentado.',
      'Nunca conviertas «Nodus no recuperó evidencia» en «el campo nunca lo ha estudiado». Usa «en el corpus disponible» cuando corresponda.',
    ],
    finalizerRules: [
      'Explicita qué puede concluirse actualmente a partir del corpus y qué no puede concluirse.',
    ],
    retrievalFacets: ['hallazgos establecidos', 'preguntas sin resolver', 'controversias actuales', 'limitaciones metodológicas', 'evidencia débil o fragmentaria'],
    variants: {
      genealogy: {
        planner: ['Distingue hechos familiares establecidos, hechos inciertos, registros conflictivos, pruebas ausentes y relaciones no resueltas.'],
        writer: ['Nunca eleves una identidad o parentesco no probado a hecho establecido.'],
      },
      study: { writer: ['Explica al estudiante el grado de respaldo de cada idea y por qué algunas respuestas siguen abiertas.'] },
      unit: { planner: ['Convierte los distintos grados de certeza en objetivos y actividades de evaluación, sin alterar la estructura fijada por el docente.'] },
    },
  },
  scholarly_debate: {
    id: 'scholarly_debate',
    retrievalRules: [
      'Trata las contradicciones como material de primera clase. Recupera evidencia de cada posición, posturas intermedias y diferencias metodológicas que expliquen el desacuerdo.',
      'No fabriques oposición. Si el corpus solo respalda un lado, registra la asimetría en lugar de equilibrarla artificialmente.',
    ],
    plannerRules: [
      'Estructura el informe alrededor de desacuerdos reales. Para cada uno identifica posiciones, alternativas intermedias, evidencia, supuestos y métodos.',
      'Distingue el desacuerdo genuino de diferencias aparentes y no fuerces todos los problemas a una oposición binaria.',
    ],
    writerRules: [
      'Atribuye cada posición de forma explícita y explica por qué discrepan las fuentes, no solo que discrepan.',
      'Un desacuerdo entre autores no es una contradicción interna del informe.',
    ],
    finalizerRules: [
      'Explica qué desacuerdos siguen abiertos, cuáles podrían reconciliarse y qué evidencia permitiría hacer avanzar el debate.',
    ],
    retrievalFacets: ['argumentos a favor', 'argumentos en contra', 'posiciones intermedias', 'supuestos en disputa', 'métodos que explican el desacuerdo'],
    variants: {
      genealogy: {
        retrieval: ['Busca registros conflictivos o interpretaciones documentadas. No conviertas una laguna probatoria en debate.'],
        writer: ['Habla de conflicto solo cuando registros o interpretaciones reales sean incompatibles, y conserva el estándar de prueba genealógico.'],
      },
      study: { planner: ['Organiza una explicación pedagógica de las explicaciones competidoras y de la evidencia usada por cada una.'] },
      unit: { planner: ['Diseña una unidad que enseñe el debate mediante evidencia y comparación de argumentos. El esquema manual del docente manda.'] },
    },
  },
  comparative: {
    id: 'comparative',
    retrievalRules: [
      'Identifica primero los comparandos dados por el objetivo. No inventes otros si ya están especificados.',
      'Recupera material por comparando y por eje importante para evitar que el lado semánticamente más próximo a la consulta domine el corpus.',
      'Si el objetivo es amplio, deriva comparandos defendibles del corpus y conserva visible cualquier asimetría de fuentes.',
    ],
    plannerRules: [
      'Usa ejes de comparación estables. Prefiere secciones que comparen directamente los casos bajo el mismo criterio antes que describir todo A y después todo B.',
    ],
    writerRules: [
      'Toda comparación importante debe indicar comparandos, criterio, similitud, diferencia, significado y fuerza probatoria de cada lado.',
      'Nunca afirmes simetría cuando la base de fuentes es asimétrica.',
    ],
    finalizerRules: [
      'Sintetiza las similitudes, diferencias y consecuencias explicativas más importantes.',
    ],
    retrievalFacets: ['comparandos', 'cronología comparada', 'conceptos', 'metodología', 'explicación causal', 'evidencia', 'contexto', 'resultados'],
    variants: {
      genealogy: { planner: ['Compara personas, ramas, hogares, migraciones o generaciones exigidos por el objetivo y nunca presupongas parentescos no probados.'] },
      study: { writer: ['Haz que los criterios de comparación sean explícitos y reutilizables como estructura de aprendizaje.'] },
      unit: { planner: ['Organiza la enseñanza mediante ejes comparativos estables sin sustituir ni reordenar un esquema fijado por el docente.'] },
    },
  },
  chronological: {
    id: 'chronological',
    retrievalRules: [
      'Prioriza obras, ideas, eventos y pasajes con información temporal explícita, además de antecedentes, transiciones, continuidades, rupturas y consecuencias.',
      'Usa únicamente fechas presentes en metadatos o contenido. Nunca inventes fechas para limpiar la periodización.',
    ],
    plannerRules: [
      'Deriva una periodización defendible de la evidencia e incluye antecedentes, emergencia, fases, puntos de inflexión, continuidades, rupturas y consecuencias.',
      'No reduzcas el informe a una cronología ni presentes resultados posteriores como inevitables.',
    ],
    writerRules: [
      'Explica por qué cambia lo que cambia y qué permanece estable. Conecta secuencia con causas, actores, estructuras e interpretaciones.',
    ],
    finalizerRules: [
      'Explicita las principales continuidades, rupturas y puntos de inflexión respaldados por el corpus.',
    ],
    retrievalFacets: ['antecedentes', 'emergencia', 'fases históricas', 'transiciones', 'puntos de inflexión', 'continuidades', 'rupturas', 'consecuencias'],
    variants: {
      genealogy: {
        retrieval: ['Prioriza eventos fechados, etapas vitales, desplazamientos y cronología documental.'],
        writer: ['Distingue la fecha del documento, la fecha del acontecimiento y cualquier fecha inferida. No inventes ninguna.'],
      },
      study: {
        planner: [
          'Convierte el desarrollo temporal en una progresión didáctica que explique causas y persistencias.',
          'Incluye únicamente materiales que formen parte de una misma secuencia temporal defendible. No unas escalas o procesos ajenos solo para usar todo el pool. Si no hay fechas, declara que se explica una secuencia de proceso —prerrequisitos, transición y consecuencias— y no una cronología histórica.',
        ],
        writer: ['Da por explicados los procesos de previousSections. No repitas sus definiciones; empieza desde el cambio o transición que corresponde a esta sección y explica qué la causa.'],
        finalizer: ['No presentes como evolución histórica una secuencia de procesos sin fechas. Nombra con precisión cuál de las dos permite sostener el material.'],
      },
      unit: { planner: ['Organiza el aprendizaje en torno al desarrollo histórico sin alterar la secuencia manual del docente.'] },
    },
  },
  conceptual: {
    id: 'conceptual',
    retrievalRules: [
      'Prioriza marcos, constructos, definiciones, afirmaciones conceptuales, conceptos metodológicos, relaciones, refinamientos, extensiones y conceptualizaciones incompatibles.',
      'Usa activamente las relaciones del grafo cuando estén disponibles para recuperar conceptos vecinos, límites y dependencias.',
    ],
    plannerRules: [
      'Organiza por problemas conceptuales y relaciones teóricas. No organices principalmente por autor o cronología salvo que sea necesario para explicar desarrollo conceptual.',
    ],
    writerRules: [
      'Para cada concepto importante explica definición, usos entre fuentes, acuerdos y diferencias, relaciones con conceptos adyacentes y consecuencias teóricas y metodológicas.',
      'No colapses conceptos parecidos pero distintos.',
    ],
    finalizerRules: [
      'Construye en prosa un mapa conceptual coherente e identifica tensiones teóricas no resueltas.',
    ],
    retrievalFacets: ['definiciones', 'orígenes teóricos', 'conceptualizaciones rivales', 'conceptos relacionados', 'límites conceptuales', 'implicaciones metodológicas'],
    variants: {
      genealogy: { planner: ['Sintetiza únicamente conceptos sociales, de parentesco, ocupación o migración respaldados por el archivo y la bibliografía. No los uses para probar vínculos familiares.'] },
      study: {
        planner: [
          'Ordena definiciones, prerrequisitos, marcos y dependencias conceptuales para facilitar su aprendizaje.',
          'No incorpores un material conceptualmente ajeno solo para aumentar el número de fuentes. Si el objetivo pertinente descansa en un solo material, acota el plan a lo que ese material permite sostener.',
        ],
        writer: ['Da por establecidas las definiciones de previousSections y haz avanzar una relación conceptual distinta en cada sección. No añadas reglas, porcentajes ni marcos que no aparezcan en allowedSources.'],
        finalizer: ['Si el objetivo se sostiene con un solo material, decláralo expresamente como limitación. Los próximos pasos no pueden introducir reglas, cifras o teorías ausentes de la evidencia recibida.'],
      },
      unit: { planner: ['Organiza la enseñanza alrededor de conceptos y relaciones, siempre dentro del esquema que haya fijado el docente.'] },
    },
  },
};

export function deepResearchApproachProfile(value: unknown): DeepResearchApproachProfile {
  return PROFILES[normalizeDeepResearchApproach(value)];
}

export function approachRules(
  value: unknown,
  variant: DeepResearchApproachVariant,
): { retrieval: string[]; planner: string[]; writer: string[]; finalizer: string[] } {
  const profile = deepResearchApproachProfile(value);
  const extra = profile.variants?.[variant];
  return {
    retrieval: [...profile.retrievalRules, ...(extra?.retrieval ?? [])],
    planner: [...profile.plannerRules, ...(extra?.planner ?? [])],
    writer: [...profile.writerRules, ...(extra?.writer ?? [])],
    finalizer: [...profile.finalizerRules, ...(extra?.finalizer ?? [])],
  };
}

export interface ApproachRetrievalPlan {
  probes: string[];
  comparands: string[];
  axes: string[];
  phases: string[];
}

/** Specialized Genealogy citation syntax guard. It repairs only a known source id;
 * an unknown malformed id is removed instead of being allowed into the report. */
export function repairMalformedGenealogyCitations(
  markdown: string,
  sources: Array<{ id: string; title: string; label: string }>,
): string {
  const allowed = new Map(sources.map((source) => {
    const kind = source.id.startsWith('doc:') ? 'archive' : 'work';
    return [`${kind}:${source.id.replace(/^(?:doc|work):/, '')}`, { kind, source }];
  }));
  return markdown.replace(/\]?\(nodus:\/\/(archive|work)\/([^\s\])]+)\]/g, (_full, kind: string, rawId: string) => {
    let id = rawId;
    try { id = decodeURIComponent(rawId); } catch { /* keep raw */ }
    const match = allowed.get(`${kind}:${id}`);
    if (!match) return '';
    const label = match.kind === 'archive' ? match.source.title : match.source.label || match.source.title;
    return `[${label}](nodus://${kind}/${encodeURIComponent(id)})`;
  });
}

interface AiRetrievalPlan {
  probes?: unknown;
  comparands?: unknown;
  axes?: unknown;
  phases?: unknown;
}

function isAiRetrievalPlan(value: unknown): value is AiRetrievalPlan {
  return Boolean(value && typeof value === 'object');
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter((item) => item.length > 8))].slice(0, max)
    : [];
}

export function deterministicApproachRetrievalPlan(
  approachValue: unknown,
  objective: string,
): ApproachRetrievalPlan {
  const profile = deepResearchApproachProfile(approachValue);
  if (profile.id === 'general') return { probes: [], comparands: [], axes: [], phases: [] };
  return {
    probes: profile.retrievalFacets.slice(0, 6).map((facet) => `${objective}. ${facet}`),
    comparands: [],
    axes: profile.id === 'comparative' ? profile.retrievalFacets.slice(1, 6) : [],
    phases: profile.id === 'chronological' ? profile.retrievalFacets.slice(0, 6) : [],
  };
}

/**
 * Specialized-only retrieval planning. General never calls this function.
 * The model receives a compact view of the normal pool, so it can derive comparands,
 * phases and useful supplemental queries without inventing material outside it.
 */
export async function planApproachRetrieval(input: {
  approach: DeepResearchApproach;
  variant: DeepResearchApproachVariant;
  objective: string;
  language: PromptLanguage;
  corpusPreview: unknown;
  model: ModelRef | null;
}): Promise<ApproachRetrievalPlan> {
  const fallback = deterministicApproachRetrievalPlan(input.approach, input.objective);
  if (input.approach === 'general') return fallback;
  const rules = approachRules(input.approach, input.variant).retrieval;
  const system = [
    'Planificas la RECUPERACIÓN suplementaria de Deep Research de Nodus. No escribes el informe.',
    'La consulta ordinaria ya se ha ejecutado y se conservará. Propón consultas adicionales que cubran material pertinente que podría faltar.',
    'No inventes fuentes, personas, fechas, comparandos ni posiciones. Derívalos del objetivo y de la vista del corpus.',
    'Cada consulta debe ser autónoma y buscable. Evita duplicar literalmente el objetivo.',
    ...rules,
    'Devuelve SOLO JSON: {"probes":["..."],"comparands":["..."],"axes":["..."],"phases":["..."]}. Máximo 7 probes y 6 elementos en las demás listas.',
  ].join('\n');
  try {
    const result = await completeJson<AiRetrievalPlan>({
      system,
      user: JSON.stringify({ objective: input.objective, language: input.language, approach: input.approach, corpus: input.corpusPreview }, null, 2),
      temperature: 0.1,
      maxTokens: 1_400,
    }, isAiRetrievalPlan, input.model);
    return {
      probes: strings(result.probes, 7).length ? strings(result.probes, 7) : fallback.probes,
      comparands: strings(result.comparands, 6),
      axes: strings(result.axes, 6),
      phases: strings(result.phases, 6),
    };
  } catch {
    return fallback;
  }
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
}

function interleaveSupplemental<T extends { id: string }>(ordinary: T[], supplemental: T[]): T[] {
  const baseIds = new Set(ordinary.map((item) => item.id));
  const additions = supplemental.filter((item) => !baseIds.has(item.id));
  const result: T[] = [];
  const length = Math.max(ordinary.length, additions.length);
  for (let index = 0; index < length; index += 1) {
    if (ordinary[index]) result.push(ordinary[index]);
    if (additions[index]) result.push(additions[index]);
  }
  return result;
}

function primaryAuthor(idea: WritingWorkshopIdeaCandidate): string {
  return (idea.works[0]?.authors[0] ?? idea.works[0]?.title ?? idea.id).toLocaleLowerCase();
}

function diversifyIdeas(items: WritingWorkshopIdeaCandidate[]): WritingWorkshopIdeaCandidate[] {
  const buckets = new Map<string, WritingWorkshopIdeaCandidate[]>();
  for (const item of items) {
    const key = primaryAuthor(item);
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  const result: WritingWorkshopIdeaCandidate[] = [];
  while (buckets.size) {
    for (const [key, bucket] of [...buckets]) {
      const next = bucket.shift();
      if (next) result.push(next);
      if (!bucket.length) buckets.delete(key);
    }
  }
  return result;
}

function diversifyWorks<T extends { id: string; authors: string[]; title: string }>(items: T[]): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = (item.authors[0] ?? item.title ?? item.id).toLocaleLowerCase();
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  const result: T[] = [];
  while (buckets.size) {
    for (const [key, bucket] of [...buckets]) {
      const next = bucket.shift();
      if (next) result.push(next);
      if (!bucket.length) buckets.delete(key);
    }
  }
  return result;
}

/** Union/deduplicate the ordinary pool with supplemental retrieval and then apply
 * approach-aware ordering. Nothing from the ordinary snapshot is deleted. */
export function mergeApproachSnapshots(
  ordinary: WritingWorkshopSnapshot,
  supplemental: WritingWorkshopSnapshot,
  approachValue: unknown,
): WritingWorkshopSnapshot {
  const approach = normalizeDeepResearchApproach(approachValue);
  const ideas = uniqueById([...ordinary.ideas, ...supplemental.ideas]);
  const works = uniqueById([...ordinary.works, ...supplemental.works]);
  const passages = uniqueById([...ordinary.passages, ...supplemental.passages]);
  const gaps = uniqueById([...ordinary.gaps, ...supplemental.gaps]);
  const contradictions = uniqueById([...ordinary.contradictions, ...supplemental.contradictions]);
  const themes = uniqueById([...ordinary.themes, ...supplemental.themes]);

  let orderedIdeas = ideas;
  let orderedWorks = works;
  if (approach === 'literature_review') {
    orderedIdeas = diversifyIdeas(ideas);
    orderedWorks = diversifyWorks(works);
  } else if (approach === 'state_of_art') {
    orderedIdeas = [...ideas].sort((a, b) => (b.workCount + b.evidenceCount) - (a.workCount + a.evidenceCount) || b.score - a.score);
    orderedWorks = [...works].sort((a, b) => b.ideaCount - a.ideaCount || (b.year ?? 0) - (a.year ?? 0) || b.score - a.score);
  } else if (approach === 'chronological') {
    orderedIdeas = [...ideas].sort((a, b) => Math.max(...b.works.map((w) => w.year ?? 0), 0) - Math.max(...a.works.map((w) => w.year ?? 0), 0) || b.score - a.score);
    orderedWorks = [...works].sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || b.score - a.score);
  } else if (approach === 'conceptual') {
    const weight = (type: string) => type === 'framework' ? 4 : type === 'construct' ? 3 : type === 'method' ? 2 : 0;
    orderedIdeas = [...ideas].sort((a, b) => weight(b.type) - weight(a.type) || b.score - a.score);
  } else if (approach === 'comparative') {
    orderedIdeas = interleaveSupplemental(ordinary.ideas, supplemental.ideas);
    orderedWorks = interleaveSupplemental(ordinary.works, supplemental.works);
  }

  return {
    ...ordinary,
    ideas: orderedIdeas,
    themes,
    gaps: approach === 'state_of_art' ? [...gaps].sort((a, b) => b.confidence - a.confidence || b.score - a.score) : gaps,
    contradictions: approach === 'scholarly_debate' ? [...contradictions].sort((a, b) => b.confidence - a.confidence || b.score - a.score) : contradictions,
    works: orderedWorks,
    passages: approach === 'comparative'
      ? interleaveSupplemental(ordinary.passages, supplemental.passages)
      : passages,
    tutorRoutes: uniqueById([...ordinary.tutorRoutes, ...supplemental.tutorRoutes]),
  };
}

/** Relationships are supplied only to specialized Academic prompts. General never
 * performs this query, preserving its planning input byte-for-byte. */
export function academicRelationshipContext(snapshot: WritingWorkshopSnapshot): Array<{
  from: string;
  relation: string;
  to: string;
  confidence: number;
}> {
  const ids = snapshot.ideas.slice(0, 100).map((idea) => idea.id);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT source.label AS from_label, e.type, target.label AS to_label, e.confidence
       FROM edges e
       JOIN ideas source ON source.global_id = e.from_id
       JOIN ideas target ON target.global_id = e.to_id
      WHERE e.from_id IN (${placeholders}) OR e.to_id IN (${placeholders})
      ORDER BY e.confidence DESC
      LIMIT 80`
  ).all(...ids, ...ids) as Array<{ from_label: string; type: string; to_label: string; confidence: number }>;
  return rows.map((row) => ({ from: row.from_label, relation: row.type, to: row.to_label, confidence: row.confidence }));
}
