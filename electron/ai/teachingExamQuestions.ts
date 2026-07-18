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
  type ExamLanguage,
} from '@shared/teachingExams';

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

const LANGUAGE_NAMES: Record<ExamLanguage, string> = {
  es: 'español',
  en: 'inglés',
  fr: 'francés',
  de: 'alemán',
  pt: 'portugués de Portugal',
  'pt-BR': 'portugués de Brasil',
};

/** The JSON contract the model must satisfy, per question type. */
function shapeFor(type: ExamQuestionType, optionCount: number): string {
  switch (type) {
    case 'section':
      // A statement asks nothing by itself: the sub-questions do. Asking the model for a
      // "solution" here would print an answer to a question nobody was asked.
      return `{"prompt": "texto, fuente o caso práctico común, listo para imprimir", "solution": ""}
- NO formules ninguna pregunta: esto es solo el material del que colgarán varias preguntas.
- Entre 80 y 200 palabras, autocontenido y comprensible sin contexto adicional.`;
    case 'multiple_choice':
      return `{"prompt": "enunciado", "options": [${Array.from({ length: optionCount }, (_, i) => `"opción ${i + 1}"`).join(', ')}], "correctIndex": 0, "solution": "por qué esa es la correcta"}
- Exactamente ${optionCount} opciones, todas verosímiles y mutuamente excluyentes.
- "correctIndex" es el índice (empezando en 0) de la única opción correcta.`;
    case 'true_false':
      return `{"prompt": "afirmación que se evalúa como verdadera o falsa", "correct": true, "solution": "justificación breve"}
- "prompt" debe ser una AFIRMACIÓN, nunca una pregunta.`;
    case 'matching':
      return `{"prompt": "instrucción para relacionar", "pairs": [{"left": "elemento", "right": "elemento correspondiente"}], "solution": "criterio de corrección"}
- Entre 4 y 6 parejas inequívocas.`;
    case 'ordering':
      return `{"prompt": "instrucción para ordenar", "items": ["elemento 1", "elemento 2"], "solution": "orden correcto"}
- Entre 4 y 6 elementos, en "items" ya en el ORDEN CORRECTO (la app los barajará al imprimir).`;
    case 'fill_blank':
      return `{"prompt": "texto con huecos marcados como ______", "solution": "palabras que completan cada hueco, en orden"}
- Entre 2 y 5 huecos marcados con ______ (guiones bajos).`;
    case 'image_comment':
      return `{"prompt": "enunciado que pide comentar la imagen", "imageCaption": "pie de imagen sugerido", "solution": "qué debe aparecer en un buen comentario"}
- No describas una imagen concreta: el enunciado debe funcionar con la imagen que el profesor insertará.`;
    case 'definition':
      return `{"prompt": "término o concepto que hay que definir", "solution": "definición de referencia"}`;
    case 'problem':
      return `{"prompt": "supuesto práctico completo con los datos necesarios", "solution": "resolución razonada"}`;
    default:
      // short_answer and the three essay lengths share the open-response shape.
      return `{"prompt": "enunciado de la pregunta", "solution": "respuesta modelo o criterios de corrección"}`;
  }
}

/** How long the expected answer is, so the model calibrates the question's scope. */
function scopeHint(type: ExamQuestionType): string {
  switch (type) {
    case 'short_essay': return 'Debe poder responderse en unas 5 líneas.';
    case 'medium_essay': return 'Debe poder responderse en media página.';
    case 'long_essay': return 'Es un tema para desarrollar en una página completa.';
    case 'short_answer': return 'Debe poder responderse en una sola línea.';
    default: return '';
  }
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toStringList(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.map(toText).filter(Boolean).slice(0, max) : [];
}

/** Map the model's JSON onto the exam question shape, enforcing each type's invariants. */
function buildQuestion(type: ExamQuestionType, raw: RawQuestion, optionCount: number, instruction: string): ExamQuestionInput {
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
      { id: 'O1', text: 'Verdadero', correct: raw.correct === true },
      { id: 'O2', text: 'Falso', correct: raw.correct !== true },
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

  const languageName = LANGUAGE_NAMES[request.language] ?? LANGUAGE_NAMES.es;
  const system = [
    'Eres un docente experto que redacta preguntas de examen claras, inequívocas y evaluables.',
    `Redacta la pregunta ÍNTEGRAMENTE en ${languageName}.`,
    'Devuelve solo JSON válido con la forma indicada, sin texto adicional ni markdown.',
    'No numeres la pregunta ni añadas la puntuación: la aplicación se encarga del formato.',
    evidence
      ? 'Basa la pregunta en los MATERIALES aportados. Si los materiales no cubren lo pedido, redáctala igualmente pero sin inventar datos concretos atribuidos a ellos.'
      : 'No hay materiales de referencia: redacta la pregunta con conocimiento general de la materia.',
  ].join(' ');

  const user = [
    `TIPO DE PREGUNTA: ${def.label} — ${def.description}`,
    scopeHint(type),
    `INSTRUCCIÓN DEL PROFESOR: ${instruction}`,
    request.avoidPrompt ? `EVITA repetir esta pregunta anterior, propón algo claramente distinto:\n${request.avoidPrompt}` : '',
    evidence ? `MATERIALES DE LA ASIGNATURA:\n${evidence}` : '',
    `FORMATO JSON EXACTO:\n${shapeFor(type, optionCount)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const settings = getSettings();
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

  const question = buildQuestion(type, outcome.value, optionCount, instruction);
  if (!question.prompt) throw new Error('La IA no devolvió un enunciado utilizable. Vuelve a intentarlo o escribe la pregunta a mano.');
  return { question, model: outcome.model, sourceCount: entries.length };
}
