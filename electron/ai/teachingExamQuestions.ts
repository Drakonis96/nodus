import { completeJson } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';
import { retrieveStudyAssistantEntries } from './studySearch';
import { getSettings } from '../db/settingsRepo';
import {
  examQuestionTypeDef,
  isExamQuestionType,
  resizeExamOptions,
  type ExamQuestionGenerationRequest,
  type ExamQuestionGenerationResult,
  type ExamQuestionInput,
  type ExamQuestionType,
} from '@shared/teachingExams';
import { teachingPromptPack } from '@shared/teachingPromptPacks';

/**
 * Generates ONE exam question at a time, from the subject's own materials.
 *
 * Deliberately not `ai/studyQuestions.ts`: that pipeline is text-format, hard-gated to
 * three question types (it throws on true/false, matching…) and dedupes new items
 * against the whole question bank at 0.78 similarity — which would silently swallow
 * questions a teacher just asked for. Here every type has its own JSON shape, nothing
 * is deduped, and the teacher's own instruction drives the result.
 *
 * Model resolution, privacy gates (local-only / external-only / excluded subjects),
 * the monthly budget and the fallback model all come from `runStudyAiTask('questions')`,
 * so the exam builder honours the same settings as the rest of the study AI.
 */

interface RawQuestion {
  prompt?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  correct?: unknown;
  pairs?: unknown;
  items?: unknown;
  solution?: unknown;
  imageCaption?: unknown;
}

function isRawQuestion(value: unknown): value is RawQuestion {
  return typeof value === 'object' && value !== null && typeof (value as RawQuestion).prompt === 'string';
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toStringList(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.map(toText).filter(Boolean).slice(0, max) : [];
}

/** Map the model's JSON onto the exam question shape, enforcing each type's invariants. */
function buildQuestion(type: ExamQuestionType, raw: RawQuestion, optionCount: number, instruction: string, trueFalseLabels: { true: string; false: string }): ExamQuestionInput {
  const def = examQuestionTypeDef(type);
  const question: ExamQuestionInput = {
    type,
    prompt: toText(raw.prompt),
    points: def.defaultPoints,
    options: [],
    pairs: [],
    items: [],
    imageDataUrl: null,
    imageCaption: toText(raw.imageCaption),
    answerLines: null,
    solution: toText(raw.solution),
    aiPrompt: instruction,
    generatedBy: 'ai',
  };
  if (type === 'multiple_choice') {
    const texts = toStringList(raw.options, 10);
    const correct = Number(raw.correctIndex);
    question.options = resizeExamOptions(
      texts.map((text, index) => ({ id: `O${index + 1}`, text, correct: index === (Number.isFinite(correct) ? correct : 0) })),
      texts.length || optionCount
    );
  } else if (type === 'true_false') {
    // Rendered as two fixed choices; the model only decides which one is right.
    question.options = [
      { id: 'O1', text: trueFalseLabels.true, correct: raw.correct === true },
      { id: 'O2', text: trueFalseLabels.false, correct: raw.correct !== true },
    ];
  } else if (type === 'matching') {
    const pairs = Array.isArray(raw.pairs) ? raw.pairs : [];
    question.pairs = pairs
      .map((pair, index) => {
        const entry = (pair ?? {}) as { left?: unknown; right?: unknown };
        return { id: `P${index + 1}`, left: toText(entry.left), right: toText(entry.right) };
      })
      .filter((pair) => pair.left && pair.right)
      .slice(0, 8);
  } else if (type === 'ordering') {
    question.items = toStringList(raw.items, 8);
  }
  return question;
}

export async function generateExamQuestion(request: ExamQuestionGenerationRequest): Promise<ExamQuestionGenerationResult> {
  // Refuse an unknown type rather than quietly substituting another one: a caller that
  // asked for a multiple-choice question and silently received an essay would look
  // like a model failure and get debugged in the wrong place.
  if (!isExamQuestionType(request.type)) {
    throw new Error(`Tipo de pregunta desconocido: ${String(request.type)}.`);
  }
  const type = request.type;
  const instruction = request.instruction.trim();
  if (!instruction) throw new Error('Escribe qué quieres que genere la IA para esta pregunta.');
  const def = examQuestionTypeDef(type);
  const optionCount = Math.max(2, Math.min(10, Math.round(request.optionCount ?? def.defaultOptionCount ?? 4)));
  const settings = getSettings();
  const pack = teachingPromptPack(settings.promptLanguage ?? 'es').exam;

  // Evidence: the subject's own materials. An exam without a subject still works — the
  // model just writes from its own knowledge — but grounding is the whole point here.
  let entries: Awaited<ReturnType<typeof retrieveStudyAssistantEntries>> = [];
  if (request.subjectId || request.topicId || request.courseId) {
    try {
      entries = await retrieveStudyAssistantEntries(
        instruction,
        {
          courseId: request.courseId ?? undefined,
          subjectId: request.subjectId ?? undefined,
          topicId: request.topicId ?? undefined,
        },
        [],
        8
      );
    } catch {
      // Retrieval is best-effort: a missing embedding index must not block the teacher.
      entries = [];
    }
  }
  const evidence = entries
    .map((entry, index) => `[M${index + 1}] ${entry.title}\n${entry.text.slice(0, 1500)}`)
    .join('\n\n')
    .slice(0, 12000);

  const languageName = pack.languageNames[request.language] ?? pack.languageNames.es;
  const system = [
    pack.systemRole,
    `${pack.systemLanguage} ${languageName}.`,
    pack.systemJson,
    pack.systemFormat,
    evidence
      ? pack.systemEvidence
      : pack.systemNoEvidence,
  ].join(' ');

  const user = [
    `${pack.userQuestionType}: ${pack.typeLabels[type].label} — ${pack.typeLabels[type].description}`,
    pack.scopeHints[type] ?? '',
    `${pack.userTeacherInstruction}: ${instruction}`,
    request.avoidPrompt ? `${pack.userAvoid}\n${request.avoidPrompt}` : '',
    evidence ? `${pack.userMaterials}\n${evidence}` : '',
    `${pack.userExactJson}:\n${pack.shapeFor(type, optionCount)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const outcome = await runStudyAiTask<RawQuestion>(
    {
      task: 'questions',
      explicitModel: request.model,
      subjectId: request.subjectId ?? null,
      inputChars: system.length + user.length,
      outputChars: (value) => JSON.stringify(value).length,
      externalPurpose: 'generar una pregunta de examen',
    },
    (model) =>
      completeJson<RawQuestion>(
        {
          system,
          user,
          temperature: settings.studyAiTemperature,
          maxTokens: Math.max(700, Math.min(settings.studyAiMaxOutputTokens, 1800)),
          reasoning: 'off',
        },
        isRawQuestion,
        model
      )
  );

  const outputLabels = teachingPromptPack(request.language).exam.trueFalseLabels;
  const question = buildQuestion(type, outcome.value, optionCount, instruction, outputLabels);
  if (!question.prompt) throw new Error('La IA no devolvió un enunciado utilizable. Vuelve a intentarlo o escribe la pregunta a mano.');
  return { question, model: outcome.model, sourceCount: entries.length };
}
