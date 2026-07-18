/**
 * Rubric builder (teaching vault).
 *
 * An ANALYTIC rubric: a table whose rows are the criteria being assessed and whose
 * columns are performance levels, with a descriptor in every cell. That is the shape
 * schools and universities actually use, and the only one that supports per-criterion
 * feedback and weighting; holistic rubrics (one paragraph per level, no criteria) and
 * single-point rubrics (one "proficient" column plus blank space either side) are
 * expressible here as a 1-criterion and a 3-level rubric respectively.
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ title                                                │  ← row 1
 *   ├────────────┬───────────┬───────────┬─────────────────┤
 *   │ Criterio   │ Level(5)  │ Level(3)  │ Level(1)        │  ← row 2: level headers + scores
 *   ├────────────┼───────────┼───────────┼─────────────────┤
 *   │ criterion  │ descriptor│ descriptor│ descriptor      │  ← one row per criterion
 *   └────────────┴───────────┴───────────┴─────────────────┘
 *
 * Everything is pure and dependency-free: the renderer (grid editor), the main process
 * (export) and the AI generator all share it, and it is unit-tested on its own.
 */

export const RUBRIC_LANGUAGES = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR'] as const;
export type RubricLanguage = (typeof RUBRIC_LANGUAGES)[number];

export function normalizeRubricLanguage(value: unknown): RubricLanguage {
  return (RUBRIC_LANGUAGES as readonly string[]).includes(value as string) ? (value as RubricLanguage) : 'es';
}

export interface RubricLevel {
  id: string;
  /** Column header, e.g. "Excelente". */
  label: string;
  /** Points this level awards for a criterion, on the rubric's scale. */
  score: number;
}

export interface RubricCriterion {
  id: string;
  /** Row header — what is being assessed. */
  name: string;
  /** Optional clarification shown under the criterion name. */
  description: string;
  /**
   * Relative importance. Only meaningful when the rubric is `weighted`; percentages
   * across criteria are expected to total 100.
   */
  weight: number;
  /** Descriptor per level id. A missing key is an empty cell. */
  cells: Record<string, string>;
}

export interface TeachingRubric {
  id: string;
  shortId: string;
  title: string;
  description: string;
  subjectId: string | null;
  courseId: string | null;
  language: RubricLanguage;
  /** Points awarded by the best level; the scale the teacher chose (5, 10, 20…). */
  scaleMax: number;
  /** When true the total is a weighted average instead of a plain sum. */
  weighted: boolean;
  levels: RubricLevel[];
  criteria: RubricCriterion[];
  createdAt: string;
  updatedAt: string;
}

export interface TeachingRubricInput {
  title?: string;
  description?: string;
  subjectId?: string | null;
  courseId?: string | null;
  language?: RubricLanguage;
  scaleMax?: number;
  weighted?: boolean;
  levels?: RubricLevel[];
  criteria?: RubricCriterion[];
}

/** Scales offered in the picker; `custom` lets the teacher type any maximum. */
export const RUBRIC_SCALES = [4, 5, 10, 20, 100] as const;
export const MAX_RUBRIC_LEVELS = 6;
export const MAX_RUBRIC_CRITERIA = 20;

export interface RubricLevelPreset {
  id: string;
  /** Spanish source label for the preset itself, translated through t() in the UI. */
  label: string;
  /** Level names per language, best level FIRST. */
  levels: Record<RubricLanguage, string[]>;
}

/**
 * Ready-made level sets. Four levels is the practical default: it gives enough
 * discrimination to be useful while avoiding the "safe middle" that an odd number
 * invites, which is why most institutional templates use four.
 */
export const RUBRIC_LEVEL_PRESETS: RubricLevelPreset[] = [
  {
    // The most common instituto template (Excelente 9-10 / Bueno 7-8 / …).
    id: 'achievement4',
    label: 'Logro en cuatro niveles',
    levels: {
      es: ['Excelente', 'Bueno', 'Adecuado', 'Mejorable'],
      en: ['Excellent', 'Good', 'Adequate', 'Needs improvement'],
      fr: ['Excellent', 'Bien', 'Satisfaisant', 'À améliorer'],
      de: ['Ausgezeichnet', 'Gut', 'Angemessen', 'Verbesserungsbedürftig'],
      pt: ['Excelente', 'Bom', 'Adequado', 'A melhorar'],
      'pt-BR': ['Excelente', 'Bom', 'Adequado', 'A melhorar'],
    },
  },
  {
    // Canonical competencial set (CEDEC/INTEF); INTEF warns AGAINST the
    // Insuficiente/Suficiente/Notable/Sobresaliente ladder for competence assessment
    // because it drags grading logic into what should describe performance.
    id: 'mastery4',
    label: 'Competencial (experto / novel)',
    levels: {
      es: ['Experto', 'Avanzado', 'Aprendiz', 'Novel'],
      en: ['Expert', 'Practitioner', 'Apprentice', 'Novice'],
      fr: ['Expert', 'Confirmé', 'Apprenti', 'Débutant'],
      de: ['Experte', 'Fortgeschritten', 'Lernend', 'Anfänger'],
      pt: ['Especialista', 'Avançado', 'Aprendiz', 'Iniciante'],
      'pt-BR': ['Especialista', 'Avançado', 'Aprendiz', 'Iniciante'],
    },
  },
  {
    id: 'expectations4',
    label: 'Respecto a lo esperado',
    levels: {
      es: ['Supera lo esperado', 'Cumple lo esperado', 'Se aproxima', 'Por debajo'],
      en: ['Exceeds expectations', 'Meets expectations', 'Approaching', 'Below expectations'],
      fr: ['Dépasse les attentes', 'Conforme aux attentes', 'En approche', 'En deçà'],
      de: ['Übertrifft Erwartungen', 'Erfüllt Erwartungen', 'Annähernd', 'Darunter'],
      pt: ['Supera o esperado', 'Cumpre o esperado', 'Aproxima-se', 'Abaixo'],
      'pt-BR': ['Supera o esperado', 'Atende ao esperado', 'Aproxima-se', 'Abaixo'],
    },
  },
  {
    id: 'developmental4',
    label: 'Desarrollo (ejemplar / inicial)',
    levels: {
      es: ['Ejemplar', 'Competente', 'En desarrollo', 'Inicial'],
      en: ['Exemplary', 'Proficient', 'Developing', 'Beginning'],
      fr: ['Exemplaire', 'Compétent', 'En développement', 'Débutant'],
      de: ['Vorbildlich', 'Kompetent', 'In Entwicklung', 'Anfänglich'],
      pt: ['Exemplar', 'Competente', 'Em desenvolvimento', 'Inicial'],
      'pt-BR': ['Exemplar', 'Competente', 'Em desenvolvimento', 'Inicial'],
    },
  },
  {
    // The LOMLOE workhorse, most used in Infantil/Primaria and qualitative reports.
    id: 'competence3',
    label: 'LOMLOE (conseguido / en proceso)',
    levels: {
      es: ['Conseguido', 'En proceso', 'No conseguido'],
      en: ['Achieved', 'In progress', 'Not achieved'],
      fr: ['Acquis', 'En cours', 'Non acquis'],
      de: ['Erreicht', 'In Entwicklung', 'Nicht erreicht'],
      pt: ['Conseguido', 'Em progresso', 'Não conseguido'],
      'pt-BR': ['Alcançado', 'Em progresso', 'Não alcançado'],
    },
  },
  {
    // Maps 1:1 onto the Spanish report-card scale (SB 9-10 · NT 7-8 · BI 6 · SU 5 · IN 1-4).
    id: 'achievement5',
    label: 'Boletín (sobresaliente / insuficiente)',
    levels: {
      es: ['Sobresaliente', 'Notable', 'Bien', 'Suficiente', 'Insuficiente'],
      en: ['Outstanding', 'Very good', 'Good', 'Satisfactory', 'Insufficient'],
      fr: ['Excellent', 'Très bien', 'Bien', 'Passable', 'Insuffisant'],
      de: ['Sehr gut', 'Gut', 'Befriedigend', 'Ausreichend', 'Ungenügend'],
      pt: ['Excelente', 'Muito bom', 'Bom', 'Suficiente', 'Insuficiente'],
      'pt-BR': ['Excelente', 'Muito bom', 'Bom', 'Suficiente', 'Insuficiente'],
    },
  },
  {
    id: 'singlePoint',
    label: 'Un solo punto (mejora / logro / superación)',
    levels: {
      es: ['Supera lo esperado', 'Criterio esperado', 'Necesita mejorar'],
      en: ['Exceeds expectations', 'Expected criterion', 'Needs improvement'],
      fr: ['Dépasse les attentes', 'Critère attendu', 'À améliorer'],
      de: ['Übertrifft Erwartungen', 'Erwartetes Kriterium', 'Verbesserung nötig'],
      pt: ['Supera o esperado', 'Critério esperado', 'Precisa melhorar'],
      'pt-BR': ['Supera o esperado', 'Critério esperado', 'Precisa melhorar'],
    },
  },
];

const PRESETS_BY_ID = new Map(RUBRIC_LEVEL_PRESETS.map((preset) => [preset.id, preset]));

export function rubricLevelPreset(id: unknown): RubricLevelPreset {
  return PRESETS_BY_ID.get(String(id)) ?? RUBRIC_LEVEL_PRESETS[0];
}

/**
 * Spread `count` levels across the scale, best first: with scaleMax 5 and 4 levels you
 * get 5 / 3.3 / 1.7 / 0, rounded to two decimals. The lowest level is always 0 — a
 * criterion that is not met earns nothing.
 */
export function distributeLevelScores(count: number, scaleMax: number): number[] {
  const levels = Math.max(2, Math.min(MAX_RUBRIC_LEVELS, Math.round(count)));
  const max = Number.isFinite(scaleMax) && scaleMax > 0 ? scaleMax : 5;
  return Array.from({ length: levels }, (_, index) => Math.round((max * (levels - 1 - index)) / (levels - 1) * 100) / 100);
}

export function buildRubricLevels(presetId: string, language: RubricLanguage, scaleMax: number): RubricLevel[] {
  const preset = rubricLevelPreset(presetId);
  const labels = preset.levels[normalizeRubricLanguage(language)] ?? preset.levels.es;
  const scores = distributeLevelScores(labels.length, scaleMax);
  return labels.map((label, index) => ({ id: `L${index + 1}`, label, score: scores[index] }));
}

/**
 * The preset whose labels exactly match these levels, in the given language, or null
 * once the teacher has renamed any of them. Lets the builder re-label the columns when
 * the document language changes WITHOUT ever overwriting hand-written names.
 */
export function matchLevelPreset(levels: Array<Pick<RubricLevel, 'label'>>, language: RubricLanguage): string | null {
  const current = levels.map((level) => level.label.trim().toLowerCase());
  for (const preset of RUBRIC_LEVEL_PRESETS) {
    const labels = (preset.levels[language] ?? []).map((label) => label.trim().toLowerCase());
    if (labels.length === current.length && labels.every((label, index) => label === current[index])) return preset.id;
  }
  return null;
}

export function emptyRubricCriterion(id: string, name = ''): RubricCriterion {
  return { id, name, description: '', weight: 0, cells: {} };
}

/** A blank but usable rubric: four levels, three criteria, equal weights. */
export function defaultRubric(language: RubricLanguage = 'es', scaleMax = 5): Pick<TeachingRubricInput, 'levels' | 'criteria' | 'scaleMax' | 'language' | 'weighted'> {
  const levels = buildRubricLevels('achievement4', language, scaleMax);
  const criteria = Array.from({ length: 3 }, (_, index) => ({
    ...emptyRubricCriterion(`C${index + 1}`),
    weight: Math.round((100 / 3) * 100) / 100,
  }));
  return { levels, criteria, scaleMax, language, weighted: false };
}

/** Points a criterion contributes at its best level (its weight share of the scale). */
export function criterionMaxPoints(rubric: Pick<TeachingRubric, 'levels' | 'weighted' | 'scaleMax'>, criterion: Pick<RubricCriterion, 'weight'>): number {
  const best = Math.max(0, ...rubric.levels.map((level) => level.score));
  if (!rubric.weighted) return best;
  return Math.round(((rubric.scaleMax * criterion.weight) / 100) * 100) / 100;
}

/**
 * Highest achievable total. Unweighted rubrics sum the best level across criteria;
 * weighted ones normalise to the scale, so the maximum IS the scale.
 */
export function rubricMaxScore(rubric: Pick<TeachingRubric, 'levels' | 'criteria' | 'weighted' | 'scaleMax'>): number {
  if (rubric.weighted) return Math.round(rubric.scaleMax * 100) / 100;
  const best = Math.max(0, ...rubric.levels.map((level) => level.score));
  return Math.round(best * rubric.criteria.length * 100) / 100;
}

export function rubricWeightTotal(criteria: Array<Pick<RubricCriterion, 'weight'>>): number {
  return Math.round(criteria.reduce((sum, criterion) => sum + (Number.isFinite(criterion.weight) ? criterion.weight : 0), 0) * 100) / 100;
}

/** Reset every criterion to an equal share of 100%. */
export function equaliseRubricWeights(criteria: RubricCriterion[]): RubricCriterion[] {
  if (!criteria.length) return criteria;
  const share = Math.round((100 / criteria.length) * 100) / 100;
  return criteria.map((criterion, index) => ({
    ...criterion,
    // The last row absorbs the rounding drift so the column still totals exactly 100.
    weight: index === criteria.length - 1 ? Math.round((100 - share * (criteria.length - 1)) * 100) / 100 : share,
  }));
}

export interface RubricIssue {
  criterionId?: string;
  levelId?: string;
  severity: 'error' | 'warning';
  /** Spanish source string, translated through t() in the UI. */
  message: string;
}

/**
 * Errors block export; warnings are the pitfalls that make a rubric unusable in
 * practice even though it "works" — empty descriptor cells (the marker has nothing to
 * judge against), levels that don't actually differ in score, and weights that don't
 * add up.
 */
export function validateRubric(rubric: TeachingRubric): RubricIssue[] {
  const issues: RubricIssue[] = [];
  if (!rubric.title.trim()) issues.push({ severity: 'error', message: 'Ponle un título a la rúbrica.' });
  if (rubric.levels.length < 2) issues.push({ severity: 'error', message: 'Una rúbrica necesita al menos dos niveles de desempeño.' });
  if (!rubric.criteria.length) issues.push({ severity: 'error', message: 'Añade al menos un criterio de evaluación.' });

  for (const level of rubric.levels) {
    if (!level.label.trim()) issues.push({ levelId: level.id, severity: 'error', message: 'Cada nivel necesita un nombre.' });
  }
  const scores = rubric.levels.map((level) => level.score);
  if (new Set(scores).size !== scores.length) {
    issues.push({ severity: 'warning', message: 'Hay niveles con la misma puntuación: no se podrán distinguir al calificar.' });
  }

  for (const criterion of rubric.criteria) {
    if (!criterion.name.trim()) issues.push({ criterionId: criterion.id, severity: 'error', message: 'Cada criterio necesita un nombre.' });
    const empty = rubric.levels.filter((level) => !(criterion.cells[level.id] ?? '').trim()).length;
    if (empty === rubric.levels.length) {
      issues.push({ criterionId: criterion.id, severity: 'warning', message: 'Este criterio no tiene ningún descriptor escrito.' });
    } else if (empty > 0) {
      issues.push({ criterionId: criterion.id, severity: 'warning', message: 'Faltan descriptores en algunos niveles de este criterio.' });
    }
  }

  if (rubric.weighted) {
    const total = rubricWeightTotal(rubric.criteria);
    if (Math.abs(total - 100) > 0.5) {
      issues.push({ severity: 'warning', message: 'Los pesos de los criterios no suman 100 %.' });
    }
  }
  issues.push(...rubricQualityWarnings(rubric));
  return issues;
}

/* ------------------------------------------------- rubric quality checks ---- */
// The pitfalls that make a rubric unusable even when it is structurally "valid".
// Audits of real institutional rubrics find these are the least-respected rules:
// positive framing, genuine qualitative differentiation between levels, and criteria
// that describe QUALITY rather than submission compliance. All are nudges, never
// blocks — the heuristics are good, not infallible.

/** Degree adverbs that let two levels differ without saying anything different. */
const DEGREE_WORDS = /\b(muy|bastante|poco|algo|apenas|casi|claramente|parcialmente|totalmente|completamente|correctamente|adecuadamente|suficientemente|a veces|siempre|nunca|generalmente|frecuentemente|clearly|mostly|partly|partially|sometimes|always|never|fully|somewhat|adequately|correctly|generally|frequently)\b/gi;
/** Evaluative adjectives that judge without describing. */
const VAGUE_WORDS = /\b(excelente|bueno|buena|malo|mala|regular|adecuado|adecuada|correcto|correcta|aceptable|deficiente|pobre|notable|insuficiente|excellent|good|bad|poor|adequate|acceptable|fair|weak|strong)\b/gi;
/** Framing that describes absence instead of what the work does. */
const NEGATIVE_WORDS = /(\bno\s|\bsin\s|carece|falta[n]?\b|ausencia|no logra|incapaz|lacks?\b|fails? to|does not|doesn't|missing|absent|unable)/gi;
/** Criterion names that describe a submission requirement, not a quality. */
const COMPLIANCE_WORDS = /\b(número de páginas|n[úu]mero de palabras|extensi[óo]n|formato|tipograf[íi]a|fuente|m[áa]rgenes|plazo|fecha de entrega|entrega a tiempo|portada|word count|page count|number of sources|citation format|font|margins|deadline|on time|length)\b/i;

const contentWords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(DEGREE_WORDS, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3);

function overlapRatio(a: string, b: string): number {
  const left = new Set(contentWords(a));
  const right = new Set(contentWords(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export function rubricQualityWarnings(rubric: TeachingRubric): RubricIssue[] {
  const issues: RubricIssue[] = [];

  // Size bounds: below 3 criteria there is nothing to discriminate, above 6 the rubric
  // stops being used in full. Levels behave the same between 3 and 5.
  if (rubric.criteria.length > 6) {
    issues.push({ severity: 'warning', message: 'Con más de 6 criterios la rúbrica se vuelve difícil de aplicar en clase.' });
  }
  if (rubric.levels.length > 5) {
    issues.push({ severity: 'warning', message: 'Más de 5 niveles aparenta una precisión que no se sostiene al corregir.' });
  }

  for (const criterion of rubric.criteria) {
    if (COMPLIANCE_WORDS.test(criterion.name)) {
      issues.push({ criterionId: criterion.id, severity: 'warning', message: 'Este criterio parece un requisito de entrega, no una cualidad del trabajo.' });
    }
    // "Gramática y organización" hides two independent dimensions in one row.
    if (/\S+\s+(y|e|and)\s+\S+/i.test(criterion.name) && criterion.name.trim().split(/\s+/).length >= 3) {
      issues.push({ criterionId: criterion.id, severity: 'warning', message: 'Este criterio junta dos aspectos: sepáralos para poder evaluarlos por separado.' });
    }

    const filled = rubric.levels.map((level) => (criterion.cells[level.id] ?? '').trim()).filter(Boolean);

    for (const level of rubric.levels) {
      const cell = (criterion.cells[level.id] ?? '').trim();
      if (!cell) continue;
      const words = cell.split(/\s+/).length;
      const vague = (cell.match(VAGUE_WORDS) ?? []).length;
      // A cell that is only a verdict ("Excelente") gives the marker nothing to observe.
      if (words <= 4 && vague > 0) {
        issues.push({ criterionId: criterion.id, levelId: level.id, severity: 'warning', message: 'Este descriptor solo emite un juicio: describe qué hace el trabajo.' });
      }
      if ((cell.match(NEGATIVE_WORDS) ?? []).length >= 2) {
        issues.push({ criterionId: criterion.id, levelId: level.id, severity: 'warning', message: 'Este descriptor describe carencias: redáctalo en positivo, por lo que el trabajo sí hace.' });
      }
    }

    // Adjacent levels that say the same thing with different adverbs.
    for (let index = 0; index < rubric.levels.length - 1; index += 1) {
      const current = (criterion.cells[rubric.levels[index].id] ?? '').trim();
      const next = (criterion.cells[rubric.levels[index + 1].id] ?? '').trim();
      if (!current || !next) continue;
      if (current.toLowerCase() === next.toLowerCase()) {
        issues.push({ criterionId: criterion.id, levelId: rubric.levels[index + 1].id, severity: 'warning', message: 'Dos niveles repiten el mismo descriptor.' });
      } else if (overlapRatio(current, next) >= 0.8) {
        issues.push({ criterionId: criterion.id, levelId: rubric.levels[index + 1].id, severity: 'warning', message: 'Estos dos niveles solo se diferencian en matices: ¿qué hace distinto el trabajo?' });
      }
    }

    if (filled.length >= 2) {
      const lengths = filled.map((cell) => cell.split(/\s+/).length);
      // Parallel structure: a two-word cell next to a forty-word one is not a level.
      if (Math.max(...lengths) >= 5 * Math.min(...lengths)) {
        issues.push({ criterionId: criterion.id, severity: 'warning', message: 'Los descriptores de este criterio tienen longitudes muy dispares: mantén una estructura paralela.' });
      }
    }
  }

  // Points must fall as the level falls, or the grid contradicts itself.
  for (let index = 0; index < rubric.levels.length - 1; index += 1) {
    if (rubric.levels[index].score <= rubric.levels[index + 1].score) {
      issues.push({ levelId: rubric.levels[index + 1].id, severity: 'warning', message: 'Las puntuaciones no descienden de mayor a menor desempeño.' });
      break;
    }
  }
  return issues;
}

/**
 * The rubric as a markdown table. This is what gets handed to the model when the
 * teacher asks it to fill a single cell: the surrounding table IS the context that
 * keeps the new descriptor parallel to its neighbours, so it must be rendered exactly
 * as the teacher sees it, gaps included.
 */
export function rubricToMarkdown(rubric: Pick<TeachingRubric, 'title' | 'levels' | 'criteria' | 'scaleMax'>): string {
  const header = ['Criterio', ...rubric.levels.map((level) => `${level.label} (${level.score})`)];
  const rows = rubric.criteria.map((criterion) => [
    criterion.name || '—',
    ...rubric.levels.map((level) => (criterion.cells[level.id] ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim() || '—'),
  ]);
  const escape = (cell: string) => cell.replace(/\|/g, '\\|');
  return [
    `# ${rubric.title || 'Rúbrica'}`,
    '',
    `| ${header.map(escape).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n');
}

/** Human coordinates of a cell, for the AI prompt and for error messages. */
export function describeRubricCell(rubric: Pick<TeachingRubric, 'levels' | 'criteria'>, criterionId: string, levelId: string): { criterion: string; level: string } | null {
  const criterion = rubric.criteria.find((entry) => entry.id === criterionId);
  const level = rubric.levels.find((entry) => entry.id === levelId);
  if (!criterion || !level) return null;
  return { criterion: criterion.name, level: level.label };
}

/* --------------------------------------------------- AI + export contracts ---- */
// Type-only import: erased at runtime, so this module stays dependency-free.
import type { ModelRef } from './types';

export interface RubricCellFillRequest {
  rubricId: string;
  criterionId: string;
  levelId: string;
  /** Extra steer from the teacher for this specific cell. */
  instruction?: string;
  model?: ModelRef | null;
}

export interface RubricCellFillResult {
  text: string;
  model: ModelRef;
}

export type RubricGenerationSource =
  /** A material already imported into the subject. */
  | { kind: 'material'; materialId: string }
  /** A file the teacher picks right now (task instructions as PDF/Word/text). */
  | { kind: 'file'; filePath: string }
  /** Nothing but the teacher's own description of the task. */
  | { kind: 'prompt' };

export interface RubricGenerationRequest {
  source: RubricGenerationSource;
  /** What is being assessed, in the teacher's words. */
  instruction: string;
  subjectId?: string | null;
  courseId?: string | null;
  language: RubricLanguage;
  scaleMax: number;
  levelCount: number;
  criteriaCount: number;
  weighted?: boolean;
  model?: ModelRef | null;
}

export interface RubricGenerationResult {
  rubric: TeachingRubricInput;
  model: ModelRef;
  /** Characters of source material the model actually saw; 0 = wrote from scratch. */
  sourceChars: number;
}

export interface RubricExportOptions {
  /** Print the points each level awards next to its header. */
  includeScores?: boolean;
  /** Add an empty column for the marker to tick / write the awarded score. */
  includeScoreColumn?: boolean;
}

export type RubricExportFormat = 'docx' | 'pdf';
