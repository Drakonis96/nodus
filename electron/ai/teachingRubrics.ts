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
  type RubricLevel,
} from '@shared/teachingRubrics';
import { teachingPromptPack } from '@shared/teachingPromptPacks';

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

export async function fillRubricCell(request: RubricCellFillRequest): Promise<RubricCellFillResult> {
  const rubric = getTeachingRubric(request.rubricId);
  const target = describeRubricCell(rubric, request.criterionId, request.levelId);
  if (!target) throw new Error('La casilla indicada ya no existe en la rúbrica.');
  const level = rubric.levels.find((entry) => entry.id === request.levelId)!;
  const criterion = rubric.criteria.find((entry) => entry.id === request.criterionId)!;
  if (!criterion.name.trim()) throw new Error('Escribe primero el nombre del criterio para que la IA sepa qué describir.');

  const settings = getSettings();
  const pack = teachingPromptPack(settings.promptLanguage ?? 'es').rubric;
  const table = rubricToMarkdown(rubric);
  const system = [
    pack.systemRole,
    `${pack.systemLanguage} ${pack.languageNames[rubric.language] ?? pack.languageNames.es}.`,
    pack.descriptorRules,
    pack.systemDescriptorOutput,
  ].join(' ');

  const user = [
    `${pack.rubricComplete}\n\n${table}`,
    `${pack.criterion} ${criterion.name}${criterion.description.trim() ? ` — ${criterion.description}` : ''}`,
    `${pack.level} "${level.label}" (${level.score} de ${rubric.scaleMax} puntos).`,
    pack.levelsPosition(rubric.levels.findIndex((entry) => entry.id === level.id), rubric.levels.length),
    request.instruction?.trim() ? `${pack.teacherInstruction} ${request.instruction.trim()}` : '',
    pack.writeCell,
  ]
    .filter(Boolean)
    .join('\n\n');

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

interface RawRubric {
  title?: unknown;
  description?: unknown;
  levels?: unknown;
  criteria?: unknown;
}

/**
 * Guard for a generated rubric, built for the SHAPE THAT WAS ASKED FOR.
 *
 * A guard that only checks "are these arrays?" accepts a rubric with one criterion
 * when the teacher asked for four — and because completeJson only retries when the
 * guard fails, the retry machinery that exists precisely to recover from a weak first
 * answer never fires. The teacher gets a visibly wrong rubric instead of a second
 * attempt at a right one.
 *
 * So the guard demands the requested counts and non-empty descriptors. When a model
 * cannot manage it after the retries, failing loudly beats returning a rubric the
 * teacher has to rebuild by hand.
 */
function makeRubricGuard(criteriaCount: number, levelCount: number) {
  return (value: unknown): value is RawRubric => {
    if (typeof value !== 'object' || value === null) return false;
    const raw = value as RawRubric;
    if (!Array.isArray(raw.criteria) || !Array.isArray(raw.levels)) return false;
    if (raw.levels.length !== levelCount) return false;
    if (raw.criteria.length !== criteriaCount) return false;
    return raw.criteria.every((criterion) => {
      if (typeof criterion !== 'object' || criterion === null) return false;
      const item = criterion as { name?: unknown; descriptors?: unknown };
      if (typeof item.name !== 'string' || !item.name.trim()) return false;
      // The descriptors ARE the rubric: one per level, none blank.
      if (!Array.isArray(item.descriptors) || item.descriptors.length !== levelCount) return false;
      return item.descriptors.every((d) => typeof d === 'string' && d.trim().length > 0);
    });
  };
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Read the task instructions the rubric must assess, from wherever they live. */
async function loadSourceText(request: RubricGenerationRequest, sourceSearchFallback: string): Promise<string> {
  if (request.source.kind === 'file') {
    const extracted = await extractFromPath(request.source.filePath);
    return (extracted.text ?? '').slice(0, 20000);
  }
  if (request.source.kind === 'material') {
    try {
      const entries = await retrieveStudyAssistantEntries(
        request.instruction || sourceSearchFallback,
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
  const settings = getSettings();
  const pack = teachingPromptPack(settings.promptLanguage ?? 'es').rubric;
  const sourceText = await loadSourceText(request, pack.sourceSearchFallback);

  const system = [
    pack.taskSystemRole,
    `${pack.taskSystemLanguage} ${pack.languageNames[language] ?? pack.languageNames.es}.`,
    pack.descriptorRules,
    pack.independentCriteria,
    pack.taskSystemJson,
  ].join(' ');

  const user = [
    `${pack.task}: ${instruction || pack.attachedTask}`,
    sourceText ? `${pack.sourceMaterial}\n${sourceText}` : '',
    pack.exactCounts(criteriaCount, levelCount),
    request.weighted ? pack.weighted : '',
    `${pack.exactJson}\n${pack.jsonFormat(Boolean(request.weighted))}\n${pack.descriptorCount(levelCount)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

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
        makeRubricGuard(criteriaCount, levelCount),
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
      name: asText(item.name) || `${teachingPromptPack(language).rubric.criterionFallback} ${index + 1}`,
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
      title: asText(raw.title) || instruction.slice(0, 80) || teachingPromptPack(language).rubric.rubricFallback,
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
