/** Stable research approaches persisted on Deep Research requests and reports. */
export const DEEP_RESEARCH_APPROACHES = [
  'general',
  'literature_review',
  'state_of_art',
  'scholarly_debate',
  'comparative',
  'chronological',
  'conceptual',
] as const;

export type DeepResearchApproach = (typeof DEEP_RESEARCH_APPROACHES)[number];

const APPROACH_SET = new Set<string>(DEEP_RESEARCH_APPROACHES);

/** Missing/unknown metadata is deliberately General for old reports and jobs. */
export function normalizeDeepResearchApproach(value: unknown): DeepResearchApproach {
  return typeof value === 'string' && APPROACH_SET.has(value)
    ? value as DeepResearchApproach
    : 'general';
}

export function isSpecializedDeepResearchApproach(value: unknown): boolean {
  return normalizeDeepResearchApproach(value) !== 'general';
}

/** Spanish source strings are translation keys in the renderer. */
export const DEEP_RESEARCH_APPROACH_OPTIONS: ReadonlyArray<{
  id: DeepResearchApproach;
  label: string;
  description: string;
}> = [
  {
    id: 'general',
    label: 'Investigación general',
    description: 'El Deep Research actual, con su recuperación y estructura general sin cambios.',
  },
  {
    id: 'literature_review',
    label: 'Revisión de la literatura',
    description: 'Sintetiza líneas de interpretación, métodos, acuerdos y desacuerdos entre obras.',
  },
  {
    id: 'state_of_art',
    label: 'Estado de la cuestión',
    description: 'Distingue lo establecido, lo discutido, las limitaciones y las preguntas abiertas del corpus.',
  },
  {
    id: 'scholarly_debate',
    label: 'Debate académico',
    description: 'Reconstruye desacuerdos reales, sus evidencias, supuestos y posiciones intermedias.',
  },
  {
    id: 'comparative',
    label: 'Análisis comparativo',
    description: 'Compara casos, obras o conceptos mediante criterios estables y evidencia equilibrada.',
  },
  {
    id: 'chronological',
    label: 'Análisis cronológico',
    description: 'Explica antecedentes, fases, continuidades, cambios y puntos de inflexión documentados.',
  },
  {
    id: 'conceptual',
    label: 'Síntesis conceptual o teórica',
    description: 'Reconstruye definiciones, marcos y relaciones entre conceptos sin confundirlos.',
  },
] as const;

export function deepResearchApproachOption(value: unknown) {
  const approach = normalizeDeepResearchApproach(value);
  return DEEP_RESEARCH_APPROACH_OPTIONS.find((option) => option.id === approach)
    ?? DEEP_RESEARCH_APPROACH_OPTIONS[0];
}
