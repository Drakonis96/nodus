import { jsonrepair } from 'jsonrepair';
import type { ModelRef } from '@shared/types';
import type { StudySynonymAlternative, StudySynonymRequest, StudySynonymResult } from '@shared/studySynonyms';
import { resolveStudySynonymTarget } from '@shared/studySynonyms';
import { completeTextNeutral } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';
import { getSettings } from '../db/settingsRepo';
import { normalizePromptLanguage, synonymSystem } from '@shared/editorAiPrompts';

const MAX_SENTENCE_CHARS = 4_000;
const ALTERNATIVE_COUNT = 5;
const CANDIDATE_COUNT = 8;

interface SynonymPayload {
  alternatives: Array<{ target?: string; replacement: string }>;
}

function parsePayload(value: string): SynonymPayload {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const objectStart = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const opening = trimmed[start];
  const end = opening === '[' ? trimmed.lastIndexOf(']') : trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('La IA no devolvió alternativas válidas.');
  const parsed = JSON.parse(jsonrepair(trimmed.slice(start, end + 1))) as Partial<SynonymPayload> | unknown[];
  const candidates = Array.isArray(parsed) ? parsed : parsed.alternatives;
  if (!Array.isArray(candidates)) throw new Error('La IA no devolvió alternativas válidas.');
  return {
    alternatives: candidates.flatMap((item) => {
      if (typeof item === 'string') return [{ replacement: item }];
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const candidate = item as { target?: unknown; replacement?: unknown };
      if (typeof candidate.replacement !== 'string') return [];
      return [{
        ...(typeof candidate.target === 'string' ? { target: candidate.target } : {}),
        replacement: candidate.replacement,
      }];
    }),
  };
}

function comparisonKey(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase();
}

function normalizeAlternatives(
  request: StudySynonymRequest,
  payload: SynonymPayload,
): StudySynonymAlternative[] {
  const previous = new Set((request.previousAlternatives ?? []).map(comparisonKey).filter(Boolean));
  const seen = new Set<string>();
  const alternatives: StudySynonymAlternative[] = [];
  for (const candidate of payload.alternatives) {
    // Smaller/less strict models sometimes copy the selection markers into
    // `target`, or return a bare replacement string. Both still have an
    // unambiguous, safe range: the exact selection supplied by the caller.
    const target = (candidate.target ?? request.selectedText)
      .replace(/<<<(?:SELECCIÓN|FIN_SELECCIÓN)>>>/giu, '')
      .trim();
    const replacement = candidate.replacement.trim();
    const range = resolveStudySynonymTarget(request.sentence, target, request.selectionFrom, request.selectionTo);
    const key = comparisonKey(replacement);
    if (!range || !replacement || key === comparisonKey(target) || previous.has(key) || seen.has(key)) continue;
    seen.add(key);
    alternatives.push({ target, replacement, ...range });
    if (alternatives.length === ALTERNATIVE_COUNT) break;
  }
  return alternatives;
}

export function buildStudySynonymPrompt(request: StudySynonymRequest): { system: string; user: string } {
  const markedSentence = `${request.sentence.slice(0, request.selectionFrom)}<<<SELECCIÓN>>>${request.selectedText}<<<FIN_SELECCIÓN>>>${request.sentence.slice(request.selectionTo)}`;
  const excluded = (request.previousAlternatives ?? []).slice(-50);
  return {
    system: synonymSystem(getPromptLanguage(), CANDIDATE_COUNT),
    user: JSON.stringify({
      originalSentence: request.sentence,
      sentenceWithSelection: markedSentence,
      selectedText: request.selectedText,
      excludedAlternatives: excluded,
    }),
  };
}

function getPromptLanguage() {
  try { return normalizePromptLanguage(getSettings().promptLanguage); } catch { return 'en' as const; }
}

function normalizedSynonymRequest(request: StudySynonymRequest): StudySynonymRequest {
  const sentence = request.sentence.replace(/\r\n/g, '\n');
  const selectedText = request.selectedText;
  if (!selectedText.trim()) throw new Error('Selecciona una palabra, expresión o frase.');
  if (sentence.length > MAX_SENTENCE_CHARS) throw new Error(`La frase supera el límite de ${MAX_SENTENCE_CHARS.toLocaleString('es-ES')} caracteres.`);
  if (request.selectionFrom < 0 || request.selectionTo > sentence.length || request.selectionFrom >= request.selectionTo
    || sentence.slice(request.selectionFrom, request.selectionTo) !== selectedText) {
    throw new Error('La selección ya no coincide con la frase. Vuelve a seleccionar el texto.');
  }
  return { ...request, sentence };
}

async function generateAlternatives(request: StudySynonymRequest, model: ModelRef): Promise<StudySynonymAlternative[]> {
  const prompt = buildStudySynonymPrompt(request);
  const raw = await completeTextNeutral({
    system: prompt.system,
    user: prompt.user,
    temperature: 0.65,
    maxTokens: 1_200,
    reasoning: 'off',
    plainContext: true,
  }, model);
  const alternatives = normalizeAlternatives(request, parsePayload(raw));
  if (alternatives.length !== ALTERNATIVE_COUNT) {
    throw new Error('La IA no pudo proponer cinco alternativas distintas. Regenera para intentarlo de nuevo.');
  }
  return alternatives;
}

export async function suggestStudySynonyms(request: StudySynonymRequest): Promise<StudySynonymResult> {
  const normalizedRequest = normalizedSynonymRequest(request);
  const initialPrompt = buildStudySynonymPrompt(normalizedRequest);
  const completed = await runStudyAiTask({
    task: 'improve',
    explicitModel: request.model as ModelRef | null | undefined,
    subjectId: request.subjectId,
    inputChars: initialPrompt.system.length + initialPrompt.user.length,
    outputChars: (value: StudySynonymAlternative[]) => JSON.stringify(value).length,
    externalConsentModelKey: '*',
  }, (model) => generateAlternatives(normalizedRequest, model));
  return {
    alternatives: completed.value,
    modelProvider: completed.model.provider,
    modelName: completed.model.model,
  };
}

/**
 * Word's AI Edition is an explicit, user-triggered writing action and talks to
 * its selected model directly. Alternatives follow that same contract instead
 * of being blocked by the separate Study-AI enablement, budget and subject
 * policy; only their structured five-option output differs.
 */
export async function suggestCopilotAlternatives(
  request: StudySynonymRequest & { model: ModelRef },
): Promise<StudySynonymResult> {
  const normalizedRequest = normalizedSynonymRequest(request);
  if (!request.model?.provider || !request.model.model) {
    throw new Error('No hay un modelo de IA configurado. Elige uno en Ajustes de Nodus.');
  }
  const alternatives = await generateAlternatives(normalizedRequest, request.model);
  return {
    alternatives,
    modelProvider: request.model.provider,
    modelName: request.model.model,
  };
}
