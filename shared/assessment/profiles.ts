/**
 * Assessment presets — starting points, not rules.
 *
 * A preset seeds a new plan's `PlanRules` with values that are typical for a kind of
 * institution. **Every one of them is editable afterwards**, because the arithmetic of
 * grading is not fixed by any state norm: what binds a teacher is their own published
 * programación didáctica or guía docente, and those differ from centre to centre and
 * from university to university.
 *
 * Where an institutional limit is well documented (a cap on how high a
 * "nota mínima para ponderar" may be set, a requirement that sibling criteria carry
 * equal weight), it is seeded as an **advisory**: the plan editor shows a warning
 * quoting its source and lets the teacher proceed anyway. Anything stricter would
 * make the tool wrong for the next institution along.
 *
 * The comments name the norms the defaults were read from so a user can check whether
 * their own centre matches — they are provenance, not authority.
 */
import type { PlanRules, QualitativeBand } from './model';

export interface AssessmentProfile {
  id: string;
  /** Shown in the preset picker. */
  label: string;
  /** One line explaining who this fits. */
  hint: string;
  rules: PlanRules;
}

/** 0–10 with one decimal and the four bands used across Spanish higher education. */
const UNIVERSITY_BANDS: QualitativeBand[] = [
  { code: 'SS', label: 'Suspenso', min: 0 },
  { code: 'AP', label: 'Aprobado', min: 0.5 },
  { code: 'NT', label: 'Notable', min: 0.7 },
  { code: 'SB', label: 'Sobresaliente', min: 0.9 },
];

/** The five-term scale used to record compulsory secondary education. */
const SECONDARY_BANDS: QualitativeBand[] = [
  { code: 'IN', label: 'Insuficiente', min: 0 },
  { code: 'SU', label: 'Suficiente', min: 0.5 },
  { code: 'BI', label: 'Bien', min: 0.6 },
  { code: 'NT', label: 'Notable', min: 0.7 },
  { code: 'SB', label: 'Sobresaliente', min: 0.9 },
];

/** Progress levels, as used by criterion-native official gradebooks. */
const COMPETENCY_BANDS: QualitativeBand[] = [
  { code: 'NI', label: 'No iniciado', min: 0 },
  { code: 'EP', label: 'En proceso', min: 0.25 },
  { code: 'C', label: 'Conseguido', min: 0.5 },
  { code: 'R', label: 'Rendimiento alto', min: 0.7 },
  { code: 'E', label: 'Excelente', min: 0.9 },
];

function baseRules(): PlanRules {
  return {
    scaleMin: 0,
    scaleMax: 10,
    passAt: 0.5,
    decimals: 1,
    rounding: 'halfUp',
    roundingThreshold: 0.5,
    keepRealForAverage: true,
    record: 'numeric',
    qualitativeBands: UNIVERSITY_BANDS,
    notSubmittedValue: 0,
    // An item nobody has assessed yet is dropped and the rest renormalised, so a
    // mid-term grade reflects what has actually been taught.
    notAssessedPenalizes: false,
    minNotMet: { mode: 'raw', capAt: 4.9 },
    np: { enabled: true, label: 'NP', value: null, triggerPct: null },
    honours: null,
    ratchet: false,
    advisories: {
      maxMinToAverage: null,
      maxNonRecoverablePct: null,
      equalSiblingWeights: false,
      source: '',
    },
  };
}

export const ASSESSMENT_PROFILES: AssessmentProfile[] = [
  {
    id: 'universidad',
    label: 'Universidad',
    hint: 'Guía docente con actividades ponderadas, convocatoria ordinaria y extraordinaria.',
    rules: {
      ...baseRules(),
      // RD 1125/2003 art. 5.4: escala 0–10 "con expresión de un decimal"; la
      // calificación cualitativa es opcional ("podrá añadirse").
      decimals: 1,
      record: 'numeric',
      qualitativeBands: UNIVERSITY_BANDS,
      np: { enabled: true, label: 'NP', value: null, triggerPct: 0.5 },
      // RD 1125/2003 art. 5.6 fija el 9 y el 5%, pero NO dice sobre qué unidad se
      // cuenta ni cómo se redondea: cada universidad lo resuelve distinto (y alguna
      // se contradice a sí misma). De ahí que las tres cosas sean ajustables.
      honours: {
        enabled: true,
        threshold: 0.9,
        quotaPct: 0.05,
        unit: 'group',
        rounding: 'halfUp',
        minCohortForOne: 20,
      },
      minNotMet: { mode: 'cap', capAt: 4.9 },
      advisories: {
        // Algunos reglamentos limitan cuánto puede exigirse como mínimo para
        // compensar, y qué parte de la evaluación puede ser no recuperable.
        // Comprueba el de tu universidad: no es una regla nacional.
        maxMinToAverage: 0.4,
        maxNonRecoverablePct: 0.3,
        equalSiblingWeights: false,
        source:
          'Algunos reglamentos de evaluación limitan la nota mínima para compensar al 40 % de la nota máxima de la actividad, y las pruebas no recuperables al 30 % del total. Verifica el reglamento de tu universidad.',
      },
    },
  },
  {
    id: 'secundaria-cualitativa',
    label: 'Secundaria — registro cualitativo',
    hint: 'ESO en comunidades cuyo acta se expresa sin nota numérica (IN/SU/BI/NT/SB).',
    rules: {
      ...baseRules(),
      record: 'qualitative',
      decimals: 0,
      qualitativeBands: SECONDARY_BANDS,
      // La evaluación es continua y sumativa: lo ya conseguido no se pierde.
      ratchet: true,
      // Sin convocatoria extraordinaria en la etapa, "no presentado" no tiene sentido.
      np: { enabled: false, label: 'NP', value: null, triggerPct: null },
      honours: null,
      advisories: {
        maxMinToAverage: null,
        maxNonRecoverablePct: null,
        equalSiblingWeights: false,
        source: '',
      },
    },
  },
  {
    id: 'secundaria-criterios-iguales',
    label: 'Secundaria — criterios equiponderados',
    hint: 'Para normativas que exigen que todos los criterios de evaluación valgan lo mismo.',
    rules: {
      ...baseRules(),
      record: 'qualitative',
      decimals: 0,
      qualitativeBands: SECONDARY_BANDS,
      ratchet: true,
      np: { enabled: false, label: 'NP', value: null, triggerPct: null },
      honours: null,
      advisories: {
        maxMinToAverage: null,
        maxNonRecoverablePct: null,
        // Hay normativas autonómicas que declaran que los criterios contribuyen
        // "en la misma medida", lo que hace incorrecto ponderarlos entre sí.
        equalSiblingWeights: true,
        source:
          'Algunas normativas autonómicas establecen que los criterios de evaluación contribuyen en la misma medida y, por tanto, tienen el mismo valor. Si es tu caso, mantén pesos iguales entre criterios hermanos.',
      },
    },
  },
  {
    id: 'secundaria-mixta',
    label: 'Secundaria — cualitativa y numérica',
    hint: 'Para comunidades que acompañan el término cualitativo con una nota sin decimales.',
    rules: {
      ...baseRules(),
      record: 'both',
      decimals: 0,
      rounding: 'halfUp',
      qualitativeBands: SECONDARY_BANDS,
      ratchet: true,
      // Donde existe, el equivalente numérico de "no presentado" varía entre etapas
      // dentro de una misma comunidad, así que se configura aquí y no en el código.
      np: { enabled: true, label: 'NP', value: 1, triggerPct: null },
      honours: null,
      advisories: { maxMinToAverage: null, maxNonRecoverablePct: null, equalSiblingWeights: false, source: '' },
    },
  },
  {
    id: 'bachillerato',
    label: 'Bachillerato',
    hint: 'Numérica de 0 a 10 sin decimales, con convocatoria extraordinaria.',
    rules: {
      ...baseRules(),
      record: 'numeric',
      decimals: 0,
      rounding: 'halfUp',
      qualitativeBands: SECONDARY_BANDS,
      np: { enabled: true, label: 'NP', value: 0, triggerPct: null },
      honours: null,
      advisories: { maxMinToAverage: null, maxNonRecoverablePct: null, equalSiblingWeights: false, source: '' },
    },
  },
  {
    id: 'fp',
    label: 'Formación Profesional',
    hint: 'Módulos de 1 a 10 sin decimales; la nota final admite decimales.',
    rules: {
      ...baseRules(),
      scaleMin: 1,
      record: 'numeric',
      decimals: 0,
      rounding: 'halfUp',
      qualitativeBands: SECONDARY_BANDS,
      np: { enabled: true, label: 'RC', value: null, triggerPct: null },
      honours: null,
      advisories: { maxMinToAverage: null, maxNonRecoverablePct: null, equalSiblingWeights: false, source: '' },
    },
  },
  {
    id: 'libre',
    label: 'En blanco',
    hint: 'Empieza sin reglas predefinidas y configúralo todo tú.',
    rules: baseRules(),
  },
];

export function assessmentProfile(id: string): AssessmentProfile {
  return ASSESSMENT_PROFILES.find((p) => p.id === id) ?? ASSESSMENT_PROFILES[ASSESSMENT_PROFILES.length - 1];
}

export { UNIVERSITY_BANDS, SECONDARY_BANDS, COMPETENCY_BANDS };
