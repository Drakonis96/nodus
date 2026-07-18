import { completeJson, completeText } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';
import { retrieveStudyAssistantEntries } from './studySearch';
import { getSettings } from '../db/settingsRepo';
import { getTeachingRubric } from '../db/teachingRubricsRepo';
import { extractFromPath } from '../extraction/textExtractor';
import {
  buildRubricLevels,
  describeRubricCell,
  distributeLevelScores,
  equaliseRubricWeights,
  rubricToMarkdown,
  MAX_RUBRIC_CRITERIA,
  MAX_RUBRIC_LEVELS,
  type RubricCellFillRequest,
  type RubricCellFillResult,
  type RubricCriterion,
  type RubricGenerationRequest,
  type RubricGenerationResult,
  type RubricLanguage,
  type RubricLevel,
} from '@shared/teachingRubrics';

/**
 * Rubric AI, in two shapes the teacher actually asks for:
 *
 *  - `fillRubricCell` — one descriptor at a time. The WHOLE table goes into the prompt
 *    as markdown, because the thing that makes a descriptor good is being parallel to
 *    its neighbours: same dimension, same voice, only the quality level changing.
 *  - `generateRubric` — a whole rubric from the task instructions, which may be a
 *    material already in the subject, a file the teacher just picked, or nothing but
 *    their own description.
 *
 * Both run through `runStudyAiTask('questions')`, inheriting the study vault's model
 * choice, privacy gates, monthly budget and fallback model.
 */

const LANGUAGE_NAMES: Record<RubricLanguage, string> = {
  es: 'español',
  en: 'inglés',
  fr: 'francés',
  de: 'alemán',
  pt: 'portugués de Portugal',
  'pt-BR': 'portugués de Brasil',
};

/** The rules that separate a usable descriptor from a vague one. */
const DESCRIPTOR_RULES = [
  'Describe conductas OBSERVABLES y evaluables, no actitudes internas.',
  'Mantén la estructura paralela entre niveles: cambia el GRADO de calidad, no el tema ni la redacción.',
  'Un solo aspecto por criterio; si mezclas dos, sepáralos en criterios distintos.',
  'Evita negaciones vagas ("no está mal") y cuantificadores imprecisos ("algunos", "bastante"); concreta cantidad o alcance cuando proceda.',
  'Describe calidad, no frecuencia de entrega ni esfuerzo.',
].join(' ');

export async function fillRubricCell(request: RubricCellFillRequest): Promise<RubricCellFillResult> {
  const rubric = getTeachingRubric(request.rubricId);
  const target = describeRubricCell(rubric, request.criterionId, request.levelId);
  if (!target) throw new Error('La casilla indicada ya no existe en la rúbrica.');
  const level = rubric.levels.find((entry) => entry.id === request.levelId)!;
  const criterion = rubric.criteria.find((entry) => entry.id === request.criterionId)!;
  if (!criterion.name.trim()) throw new Error('Escribe primero el nombre del criterio para que la IA sepa qué describir.');

  const table = rubricToMarkdown(rubric);
  const system = [
    'Eres un docente experto en evaluación por criterios que redacta descriptores de rúbrica.',
    `Escribe ÍNTEGRAMENTE en ${LANGUAGE_NAMES[rubric.language] ?? LANGUAGE_NAMES.es}.`,
    DESCRIPTOR_RULES,
    'Devuelve SOLO el texto del descriptor pedido: una o dos frases, sin comillas, sin el nombre del nivel ni del criterio, sin markdown.',
  ].join(' ');

  const user = [
    `RÚBRICA COMPLETA (para que el nuevo descriptor encaje con los demás):\n\n${table}`,
    `CRITERIO: ${criterion.name}${criterion.description.trim() ? ` — ${criterion.description}` : ''}`,
    `NIVEL A REDACTAR: "${level.label}" (${level.score} de ${rubric.scaleMax} puntos).`,
    `Es ${levelPosition(rubric.levels, level)} de ${rubric.levels.length} niveles, ordenados de mayor a menor desempeño.`,
    request.instruction?.trim() ? `INDICACIÓN DEL PROFESOR: ${request.instruction.trim()}` : '',
    'Redacta el descriptor de ESA casilla.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const settings = getSettings();
  const outcome = await runStudyAiTask<string>(
    {
      task: 'questions',
      explicitModel: request.model,
      subjectId: rubric.subjectId,
      inputChars: system.length + user.length,
      outputChars: (value) => value.length,
      externalPurpose: 'redactar un descriptor de rúbrica',
    },
    (model) =>
      completeText(
        { system, user, temperature: settings.studyAiTemperature, maxTokens: 400, reasoning: 'off' },
        model
      )
  );

  // Models like to wrap a single value in quotes or a bullet; strip that back off.
  const text = outcome.value
    .trim()
    .replace(/^["'«»\-*\s]+/, '')
    .replace(/["'«»\s]+$/, '')
    .trim();
  if (!text) throw new Error('La IA no devolvió un descriptor utilizable. Vuelve a intentarlo o escríbelo a mano.');
  return { text, model: outcome.model };
}

function levelPosition(levels: RubricLevel[], level: RubricLevel): string {
  const index = levels.findIndex((entry) => entry.id === level.id);
  if (index === 0) return 'el nivel MÁS ALTO';
  if (index === levels.length - 1) return 'el nivel MÁS BAJO';
  return `el nivel ${index + 1}`;
}

interface RawRubric {
  title?: unknown;
  description?: unknown;
  levels?: unknown;
  criteria?: unknown;
}

function isRawRubric(value: unknown): value is RawRubric {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as RawRubric;
  return Array.isArray(raw.criteria) && Array.isArray(raw.levels);
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Read the task instructions the rubric must assess, from wherever they live. */
async function loadSourceText(request: RubricGenerationRequest): Promise<string> {
  if (request.source.kind === 'file') {
    const extracted = await extractFromPath(request.source.filePath);
    return (extracted.text ?? '').slice(0, 20000);
  }
  if (request.source.kind === 'material') {
    try {
      const entries = await retrieveStudyAssistantEntries(
        request.instruction || 'criterios de evaluación de la tarea',
        { subjectId: request.subjectId ?? undefined },
        [`material:${request.source.materialId}`],
        10
      );
      return entries.map((entry) => entry.text).join('\n\n').slice(0, 20000);
    } catch {
      // Retrieval is best-effort: a missing embedding index must not block the teacher.
      return '';
    }
  }
  return '';
}

export async function generateRubric(request: RubricGenerationRequest): Promise<RubricGenerationResult> {
  const instruction = request.instruction.trim();
  if (!instruction && request.source.kind === 'prompt') {
    throw new Error('Describe la tarea que quieres evaluar para que la IA genere la rúbrica.');
  }
  const language = request.language;
  const levelCount = Math.max(2, Math.min(MAX_RUBRIC_LEVELS, Math.round(request.levelCount || 4)));
  const criteriaCount = Math.max(1, Math.min(MAX_RUBRIC_CRITERIA, Math.round(request.criteriaCount || 4)));
  const sourceText = await loadSourceText(request);

  const system = [
    'Eres un docente experto en evaluación que diseña rúbricas analíticas.',
    `Redacta TODO en ${LANGUAGE_NAMES[language] ?? LANGUAGE_NAMES.es}.`,
    DESCRIPTOR_RULES,
    'Los criterios deben ser independientes entre sí y cubrir la tarea sin solaparse.',
    'Devuelve solo JSON válido, sin markdown ni texto adicional.',
  ].join(' ');

  const user = [
    `TAREA A EVALUAR: ${instruction || 'la tarea descrita en el documento adjunto'}`,
    sourceText ? `INSTRUCCIONES / MATERIAL DE LA TAREA:\n${sourceText}` : '',
    `Genera EXACTAMENTE ${criteriaCount} criterios y ${levelCount} niveles de desempeño, ordenados de MAYOR a MENOR.`,
    request.weighted ? 'Asigna a cada criterio un "weight" en porcentaje; los pesos deben sumar 100.' : '',
    `FORMATO JSON EXACTO:
{
  "title": "título de la rúbrica",
  "description": "una frase sobre qué evalúa",
  "levels": ["nombre del nivel más alto", "…", "nombre del nivel más bajo"],
  "criteria": [
    { "name": "nombre del criterio", "description": "qué se observa"${request.weighted ? ', "weight": 25' : ''}, "descriptors": ["descriptor del nivel más alto", "…", "descriptor del nivel más bajo"] }
  ]
}
- "descriptors" debe tener exactamente ${levelCount} elementos, en el MISMO orden que "levels".`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const settings = getSettings();
  const outcome = await runStudyAiTask<RawRubric>(
    {
      task: 'questions',
      explicitModel: request.model,
      subjectId: request.subjectId ?? null,
      inputChars: system.length + user.length,
      outputChars: (value) => JSON.stringify(value).length,
      externalPurpose: 'generar una rúbrica de evaluación',
    },
    (model) =>
      completeJson<RawRubric>(
        {
          system,
          user,
          temperature: settings.studyAiTemperature,
          maxTokens: Math.max(1500, Math.min(settings.studyAiMaxOutputTokens, 4000)),
          reasoning: 'off',
        },
        isRawRubric,
        model
      )
  );

  const raw = outcome.value;
  // Trust the model for prose, never for structure: level count, ids, scores and
  // weights are rebuilt here so the rubric is always internally consistent.
  const rawLevels = (raw.levels as unknown[]).map(asText).filter(Boolean).slice(0, MAX_RUBRIC_LEVELS);
  const labels = rawLevels.length >= 2 ? rawLevels : buildRubricLevels('achievement4', language, request.scaleMax).map((level) => level.label);
  const scores = distributeLevelScores(labels.length, request.scaleMax);
  const levels: RubricLevel[] = labels.map((label, index) => ({ id: `L${index + 1}`, label, score: scores[index] }));

  const rawCriteria = (raw.criteria as unknown[]).slice(0, MAX_RUBRIC_CRITERIA);
  let criteria: RubricCriterion[] = rawCriteria.map((entry, index) => {
    const item = (entry ?? {}) as { name?: unknown; description?: unknown; weight?: unknown; descriptors?: unknown };
    const descriptors = Array.isArray(item.descriptors) ? item.descriptors.map(asText) : [];
    const cells: Record<string, string> = {};
    levels.forEach((level, levelIndex) => {
      cells[level.id] = descriptors[levelIndex] ?? '';
    });
    return {
      id: `C${index + 1}`,
      name: asText(item.name) || `Criterio ${index + 1}`,
      description: asText(item.description),
      weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0,
      cells,
    };
  });
  if (!criteria.length) throw new Error('La IA no devolvió criterios utilizables. Vuelve a intentarlo.');
  // A weighted rubric whose column doesn't total 100 is worse than no weights at all.
  if (request.weighted) {
    const total = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (Math.abs(total - 100) > 0.5) criteria = equaliseRubricWeights(criteria);
  }

  return {
    rubric: {
      title: asText(raw.title) || instruction.slice(0, 80) || 'Rúbrica',
      description: asText(raw.description),
      subjectId: request.subjectId ?? null,
      courseId: request.courseId ?? null,
      language,
      scaleMax: request.scaleMax,
      weighted: request.weighted ?? false,
      levels,
      criteria,
    },
    model: outcome.model,
    sourceChars: sourceText.length,
  };
}
