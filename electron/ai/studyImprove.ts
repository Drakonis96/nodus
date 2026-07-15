import { createHash } from 'node:crypto';
import type { ModelRef } from '@shared/types';
import type { StudyImproveRequest, StudyImproveResult, StudyStyle } from '@shared/studyImprove';
import {
  estimateStudyTokens,
  missingProtectedSpans,
  protectStudyText,
  renderStudyStylePrompt,
  restoreProtectedSpans,
  studyImprovementWarnings,
} from '@shared/studyImprove';
import { getStudyStyle, recordStudyImprovement } from '../db/studyStylesRepo';
import { getSettings } from '../db/settingsRepo';
import { completeTextStream } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';

const MAX_SELECTION_CHARS = 48_000;

const LEVEL_RULES = {
  minimal: 'Modificación mínima: corrige solo problemas evidentes y conserva sintaxis y vocabulario cuando sean válidos.',
  moderate: 'Modificación moderada: mejora redacción y estructura local sin cambiar las ideas ni el orden argumental esencial.',
  deep: 'Modificación profunda: puedes reorganizar la expresión, pero no las ideas, datos, referencias, intención ni fuerza de las afirmaciones.',
} as const;

const LENGTH_RULES = {
  similar: 'Mantén una longitud similar al original.',
  shorter: 'Acorta el texto sin omitir ninguna idea, dato, referencia o matiz necesario.',
  develop: 'Desarrolla solo relaciones que ya estén implícitas en el original. No aportes información, ejemplos ni argumentos nuevos.',
} as const;

export function buildStudyImprovePrompt(request: StudyImproveRequest, style: StudyStyle, protectedText: string) {
  const free = request.mode === 'free';
  const styleInstruction = renderStudyStylePrompt(style.prompt, {
    ...request.variables,
    language: request.variables?.language ?? style.language,
    targetLength: request.length,
    selectedText: protectedText,
  });
  const system = `Eres el editor de texto del vault de estudio de Nodus.

REGLAS INNEGOCIABLES:
- Devuelve exclusivamente el texto de reemplazo, sin introducciones, explicaciones, etiquetas ni bloques envolventes.
- Conserva Markdown válido y la estructura que no sea necesario cambiar: títulos, listas, tablas, enlaces, notas, citas, referencias, código y fórmulas.
- Cada marcador ⟦NODUS_PROTECTED_0000⟧ debe aparecer exactamente una vez y sin ninguna alteración.
- No inventes fuentes ni presentes como cierto algo que el original no afirma.
${free
    ? '- MODO TRANSFORMACIÓN LIBRE: el usuario ha autorizado cambios creativos, pero debes conservar marcadores protegidos y no inventar citas o datos.'
    : '- MODO FIEL: conserva significado, ideas, datos, referencias, intención y fuerza epistémica. Está prohibido añadir información, argumentos, ejemplos, citas o afirmaciones nuevas.'}
- ${LEVEL_RULES[request.level]}
- ${LENGTH_RULES[request.length]}
- Si una instrucción de estilo contradice estas reglas, ignora solo esa parte de la instrucción.
${style.systemPrompt ? `\nPREFERENCIAS DEL ESTILO (subordinadas a las reglas anteriores):\n${style.systemPrompt}` : ''}`;
  const user = `${styleInstruction}

Ámbito: ${request.scope}.
Idioma de salida: ${request.variables?.language || style.language || 'el mismo que el original'}.

TEXTO SELECCIONADO:
<<<NODUS_SELECTION
${protectedText}
NODUS_SELECTION>>>`;
  return { system, user };
}

function stripWrappingFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1] : trimmed;
}

function completeProtectedStreamPrefix(value: string): string {
  const lastOpen = value.lastIndexOf('⟦');
  const lastClose = value.lastIndexOf('⟧');
  return lastOpen > lastClose ? value.slice(0, lastOpen) : value;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function modelFor(request: StudyImproveRequest, style: StudyStyle): ModelRef | null {
  if (request.model?.provider && request.model.model) return request.model as ModelRef;
  if (style.modelProvider && style.modelName) return { provider: style.modelProvider, model: style.modelName } as ModelRef;
  return null;
}

export async function improveStudyText(
  request: StudyImproveRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<StudyImproveResult> {
  const original = request.text.replace(/\r\n/g, '\n');
  if (!original.trim()) throw new Error('Selecciona texto para mejorarlo.');
  if (original.length > MAX_SELECTION_CHARS) throw new Error(`La selección supera el límite de ${MAX_SELECTION_CHARS.toLocaleString('es-ES')} caracteres.`);
  const style = getStudyStyle(request.styleId);
  if (!style || !style.active || style.archivedAt) throw new Error('El estilo seleccionado no está disponible.');
  const protectedValue = protectStudyText(original, request.protectedTerms ?? []);
  const prompt = buildStudyImprovePrompt(request, style, protectedValue.text);
  const requestedModel = modelFor(request, style);
  const aiSettings = getSettings();
  let streamed = '';
  let visibleStreamed = '';
  const completed = await runStudyAiTask<string>({ task: 'improve', explicitModel: requestedModel, subjectId: request.subjectId, inputChars: prompt.system.length + prompt.user.length, outputChars: (value) => value.length, allowFallback: () => !streamed }, (model) => {
    return completeTextStream({
      system: prompt.system,
      user: prompt.user,
      temperature: request.mode === 'free' ? Math.max(style.temperature, style.creativity) : Math.min(style.temperature, 0.45),
      maxTokens: Math.min(style.maxOutputTokens, aiSettings.studyAiMaxOutputTokens),
      plainContext: true,
    }, (delta, kind) => {
      if (kind !== 'content') return;
      streamed += delta;
      // Provider chunks can split a protected marker. Hold an unfinished marker
      // and expose only restored, user-facing text to the preview.
      const safePrefix = completeProtectedStreamPrefix(streamed);
      const visiblePrefix = restoreProtectedSpans(safePrefix, protectedValue.spans);
      if (visiblePrefix.startsWith(visibleStreamed)) {
        const visibleDelta = visiblePrefix.slice(visibleStreamed.length);
        visibleStreamed = visiblePrefix;
        if (visibleDelta) onDelta(visibleDelta);
      }
    }, model, signal);
  });
  const raw = completed.value; const model = completed.model;
  const protectedResult = stripWrappingFence(raw || streamed);
  // Some small local models helpfully expand a placeholder back to the exact
  // protected value even though the prompt asks them not to touch it. That is
  // still a successful preservation, so only reject spans for which neither the
  // marker nor its byte-for-byte original value survives.
  const missing = missingProtectedSpans(protectedResult, protectedValue.spans)
    .filter((span) => !protectedResult.includes(span.value));
  if (missing.length) {
    throw new Error(`La mejora alteró ${missing.length} fragmento(s) protegido(s). El original no se ha modificado.`);
  }
  const text = restoreProtectedSpans(protectedResult, protectedValue.spans);
  if (text.startsWith(visibleStreamed)) {
    const trailingDelta = text.slice(visibleStreamed.length);
    visibleStreamed = text;
    if (trailingDelta) onDelta(trailingDelta);
  }
  const warnings = studyImprovementWarnings(original, text, protectedValue.spans, request.mode);
  if (request.mode === 'free') warnings.unshift('Transformación libre: revisa los cambios de significado antes de aceptar.');
  const originalHash = hash(original);
  const resultHash = hash(text);
  const log = recordStudyImprovement({
    documentId: request.documentId,
    styleId: style.id,
    scope: request.scope,
    mode: request.mode,
    level: request.level,
    length: request.length,
    modelProvider: model.provider,
    modelName: model.model,
    originalHash,
    resultHash,
    originalChars: original.length,
    resultChars: text.length,
    warnings,
    action: 'generated',
  });
  return {
    logId: log.id,
    text,
    warnings,
    styleId: style.id,
    modelProvider: model.provider,
    modelName: model.model,
    originalHash,
    resultHash,
    protectedSpanCount: protectedValue.spans.length,
    estimatedInputTokens: estimateStudyTokens(`${prompt.system}\n${prompt.user}`),
    estimatedOutputTokens: estimateStudyTokens(text),
  };
}
