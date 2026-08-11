import { jsonrepair } from 'jsonrepair';
import type { ModelRef } from '@shared/types';
import type { StudySynonymAlternative, StudySynonymRequest, StudySynonymResult } from '@shared/studySynonyms';
import { resolveStudySynonymTarget } from '@shared/studySynonyms';
import { completeTextNeutral } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';

const MAX_SENTENCE_CHARS = 4_000;
const ALTERNATIVE_COUNT = 5;

interface SynonymPayload {
  alternatives: Array<{ target: string; replacement: string }>;
}

function parsePayload(value: string): SynonymPayload {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('La IA no devolvió alternativas válidas.');
  const parsed = JSON.parse(jsonrepair(trimmed.slice(start, end + 1))) as Partial<SynonymPayload>;
  if (!Array.isArray(parsed.alternatives)) throw new Error('La IA no devolvió alternativas válidas.');
  return {
    alternatives: parsed.alternatives.filter((item): item is { target: string; replacement: string } => (
      Boolean(item) && typeof item.target === 'string' && typeof item.replacement === 'string'
    )),
  };
}

function normalizeAlternatives(request: StudySynonymRequest, payload: SynonymPayload): StudySynonymAlternative[] {
  const previous = new Set((request.previousAlternatives ?? []).map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const alternatives: StudySynonymAlternative[] = [];
  for (const candidate of payload.alternatives) {
    const target = candidate.target.trim();
    const replacement = candidate.replacement.trim();
    const range = resolveStudySynonymTarget(request.sentence, target, request.selectionFrom, request.selectionTo);
    const key = replacement.toLocaleLowerCase();
    if (!range || !replacement || replacement === target || previous.has(key) || seen.has(key)) continue;
    seen.add(key);
    alternatives.push({ target, replacement, ...range });
    if (alternatives.length === ALTERNATIVE_COUNT) break;
  }
  if (alternatives.length !== ALTERNATIVE_COUNT) {
    throw new Error('La IA no pudo proponer cinco alternativas distintas. Regenera para intentarlo de nuevo.');
  }
  return alternatives;
}

export function buildStudySynonymPrompt(request: StudySynonymRequest): { system: string; user: string } {
  const markedSentence = `${request.sentence.slice(0, request.selectionFrom)}<<<SELECCIÓN>>>${request.selectedText}<<<FIN_SELECCIÓN>>>${request.sentence.slice(request.selectionTo)}`;
  const excluded = (request.previousAlternatives ?? []).slice(-50);
  return {
    system: `Actúas como tesauro contextual y asistente de redacción de Nodus.

Devuelve exclusivamente JSON válido con esta forma exacta:
{"alternatives":[{"target":"fragmento original exacto","replacement":"alternativa"}]}

REGLAS:
- Devuelve exactamente cinco alternativas naturales, distintas entre sí y distintas del original.
- Detecta el idioma de la frase y escribe TODAS las alternativas en ese mismo idioma. Nunca traduzcas.
- Conserva significado, registro, género, número, tiempo verbal, datos, citas y fuerza de la afirmación.
- "target" debe ser una subcadena literal y contigua de la frase original que contenga toda la selección.
- Usa la selección exacta como "target" siempre que el reemplazo encaje gramaticalmente.
- Solo amplía "target" a la porción mínima necesaria de la frase si una reformulación más amplia evita discordancias o resulta claramente más natural.
- No incluyas explicaciones, notas, Markdown envolvente ni alternativas ya excluidas.`,
    user: JSON.stringify({
      sentenceWithSelection: markedSentence,
      selectedText: request.selectedText,
      excludedAlternatives: excluded,
    }),
  };
}

export async function suggestStudySynonyms(request: StudySynonymRequest): Promise<StudySynonymResult> {
  const sentence = request.sentence.replace(/\r\n/g, '\n');
  const selectedText = request.selectedText;
  if (!selectedText.trim()) throw new Error('Selecciona una o varias palabras.');
  if (sentence.length > MAX_SENTENCE_CHARS) throw new Error(`La frase supera el límite de ${MAX_SENTENCE_CHARS.toLocaleString('es-ES')} caracteres.`);
  if (request.selectionFrom < 0 || request.selectionTo > sentence.length || request.selectionFrom >= request.selectionTo
    || sentence.slice(request.selectionFrom, request.selectionTo) !== selectedText) {
    throw new Error('La selección ya no coincide con la frase. Vuelve a seleccionar el texto.');
  }
  const normalizedRequest = { ...request, sentence };
  const prompt = buildStudySynonymPrompt(normalizedRequest);
  const completed = await runStudyAiTask({
    task: 'improve',
    explicitModel: request.model as ModelRef | null | undefined,
    subjectId: request.subjectId,
    inputChars: prompt.system.length + prompt.user.length,
    outputChars: (value: StudySynonymAlternative[]) => JSON.stringify(value).length,
    externalConsentModelKey: '*',
  }, async (model) => {
    const raw = await completeTextNeutral({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.65,
      maxTokens: 900,
      reasoning: 'off',
      plainContext: true,
    }, model);
    return normalizeAlternatives(normalizedRequest, parsePayload(raw));
  });
  return {
    alternatives: completed.value,
    modelProvider: completed.model.provider,
    modelName: completed.model.model,
  };
}
