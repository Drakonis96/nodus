import type { ModelRef } from '@shared/types';
import type { StudyImproveRequest } from '@shared/studyImprove';
import {
  missingProtectedSpans,
  protectStudyText,
  restoreProtectedSpans,
  studyImprovementWarnings,
} from '@shared/studyImprove';
import { getStudyStyle } from '../db/studyStylesRepo';
import { getSettings } from '../db/settingsRepo';
import { completeText } from './aiClient';
import { buildStudyImprovePrompt } from './studyImprove';

const MAX_WORD_SELECTION_CHARS = 48_000;

function stripWrappingFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1] : trimmed;
}

/**
 * Apply one of the workspace's saved AI writing styles without mutating the
 * Office document. The task pane owns the explicit review/copy/paste step, so
 * this deliberately does not create an editor provenance row with a fake Nodus
 * document id.
 */
export async function applyCopilotPromptStyle(input: {
  text: string;
  styleId: string;
  model?: ModelRef | null;
}): Promise<{
  text: string;
  warnings: string[];
  styleId: string;
  model: ModelRef;
}> {
  const original = String(input.text ?? '').replace(/\r\n/g, '\n');
  if (!original.trim()) throw new Error('Selecciona texto en Word para transformarlo.');
  if (original.length > MAX_WORD_SELECTION_CHARS) {
    throw new Error(`La selección supera el límite de ${MAX_WORD_SELECTION_CHARS.toLocaleString('es-ES')} caracteres.`);
  }

  const style = getStudyStyle(input.styleId);
  if (!style || !style.active || style.archivedAt) throw new Error('El estilo seleccionado no está disponible.');

  const settings = getSettings();
  const model = input.model
    ?? (style.modelProvider && style.modelName
      ? { provider: style.modelProvider as ModelRef['provider'], model: style.modelName }
      : null)
    ?? settings.improveModel
    ?? settings.writingModel
    ?? settings.studyModel
    ?? settings.synthesisModel;
  if (!model?.provider || !model.model) {
    throw new Error('No hay un modelo de IA configurado. Elige uno en Ajustes de Nodus.');
  }

  const protectedValue = protectStudyText(original, []);
  const request: StudyImproveRequest = {
    text: original,
    styleId: style.id,
    scope: 'selection',
    level: style.level,
    length: style.length,
    mode: 'preserve',
    variables: {
      language: style.language,
      documentType: 'Microsoft Word',
      selectedText: protectedValue.text,
    },
    model,
  };
  const prompt = buildStudyImprovePrompt(request, style, protectedValue.text);
  const raw = await completeText({
    system: prompt.system,
    user: prompt.user,
    temperature: Math.min(style.temperature, 0.45),
    maxTokens: Math.min(style.maxOutputTokens, settings.studyAiMaxOutputTokens),
    plainContext: true,
  }, model);
  const protectedResult = stripWrappingFence(raw);
  if (!protectedResult) throw new Error('La IA no devolvió texto insertable.');

  const missing = missingProtectedSpans(protectedResult, protectedValue.spans)
    .filter((span) => !protectedResult.includes(span.value));
  if (missing.length) {
    throw new Error(`La mejora alteró ${missing.length} fragmento(s) protegido(s). El original no se ha modificado.`);
  }

  const text = restoreProtectedSpans(protectedResult, protectedValue.spans).trim();
  if (!text) throw new Error('La IA no devolvió texto insertable.');
  return {
    text,
    warnings: studyImprovementWarnings(original, text, protectedValue.spans, 'preserve'),
    styleId: style.id,
    model,
  };
}
