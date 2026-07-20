import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  StudyAssistantCitation,
  StudyAssistantConversation,
  StudyAssistantConversationInput,
  StudyAssistantConversationPatch,
  StudyAssistantConversationSummary,
  StudyAssistantRequest,
  StudyAssistantResponse,
  StudyAssistantSelection,
  StudyAssistantSourceOption,
} from '@shared/studyAssistant';
import {
  DEFAULT_STUDY_ASSISTANT_SELECTION,
  compressStudyAssistantEvidence,
  studyAssistantSourceKey,
  titleFromStudyQuestion,
  validateStudyAssistantAnswer,
} from '@shared/studyAssistant';
import type { StudySearchIndexEntry, StudySearchOptions } from '@shared/studySearch';
import { getSettings } from '../db/settingsRepo';
import { activeVaultDir } from '../vaults/vaultRegistry';
import { completeTextStream, resolveModelRef } from './aiClient';
import { listStudyAssistantSourceOptions, retrieveStudyAssistantEntries } from './studySearch';

interface StudyAssistantStore { version: 1; conversations: StudyAssistantConversation[] }

const EMPTY_STORE: StudyAssistantStore = { version: 1, conversations: [] };
const MAX_HISTORY_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 52_000;
const MAX_SOURCE_CHARS = 3_600;
const DEMO_CONVERSATION_ID = 'demo-study-chat-membrane';

const INSUFFICIENT_INFORMATION: Record<string, string> = {
  es: 'No hay información suficiente en las fuentes seleccionadas para responder con seguridad. Añade materiales, amplía el ámbito o selecciona otras fuentes.',
  en: 'There is not enough information in the selected sources to answer safely. Add materials, broaden the scope, or select other sources.',
  fr: 'Les sources sélectionnées ne contiennent pas assez d’informations pour répondre de façon fiable. Ajoutez des documents, élargissez le périmètre ou choisissez d’autres sources.',
  de: 'Die ausgewählten Quellen enthalten nicht genügend Informationen für eine verlässliche Antwort. Füge Material hinzu, erweitere den Bereich oder wähle andere Quellen aus.',
  pt: 'As fontes selecionadas não contêm informação suficiente para responder com segurança. Adicione materiais, alargue o âmbito ou selecione outras fontes.',
  'pt-BR': 'As fontes selecionadas não contêm informações suficientes para responder com segurança. Adicione materiais, amplie o escopo ou selecione outras fontes.',
  tr: 'Seçilen kaynaklarda güvenilir bir yanıt vermek için yeterli bilgi yok. Materyal ekleyin, kapsamı genişletin veya başka kaynaklar seçin.',
};

function now(): string { return new Date().toISOString(); }
function storePath(): string { return path.join(activeVaultDir(), 'study-chat-history.json'); }

function normalizeSelection(selection?: Partial<StudyAssistantSelection> | null): StudyAssistantSelection {
  return {
    ...DEFAULT_STUDY_ASSISTANT_SELECTION,
    ...selection,
    sourceKeys: Array.isArray(selection?.sourceKeys) ? [...new Set(selection.sourceKeys.filter(Boolean))] : [],
  };
}

function readStore(): StudyAssistantStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as Partial<StudyAssistantStore>;
    return { version: 1, conversations: Array.isArray(parsed.conversations) ? parsed.conversations.map((conversation) => ({ ...conversation, selection: normalizeSelection(conversation.selection), messages: Array.isArray(conversation.messages) ? conversation.messages : [] })) : [] };
  } catch { return { ...EMPTY_STORE, conversations: [] }; }
}

function writeStore(store: StudyAssistantStore): void {
  const target = storePath(); const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(store), 'utf8');
  fs.renameSync(temporary, target);
}

function summary(conversation: StudyAssistantConversation): StudyAssistantConversationSummary {
  const { messages, task: _task, level: _level, tone: _tone, language: _language, allowExternalKnowledge: _external, ...rest } = conversation;
  return { ...rest, messageCount: messages.length };
}

export function listStudyAssistantConversations(includeArchived = false): StudyAssistantConversationSummary[] {
  return readStore().conversations.filter((conversation) => includeArchived || !conversation.archived)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || b.updatedAt.localeCompare(a.updatedAt)).map(summary);
}

export function getStudyAssistantConversation(id: string): StudyAssistantConversation | null {
  return readStore().conversations.find((conversation) => conversation.id === id) ?? null;
}

export function createStudyAssistantConversation(input: StudyAssistantConversationInput = {}): StudyAssistantConversation {
  const timestamp = now();
  const conversation: StudyAssistantConversation = {
    id: crypto.randomUUID(), title: input.title?.trim() || 'Conversación de estudio', createdAt: timestamp, updatedAt: timestamp,
    archived: false, selection: normalizeSelection(input.selection), model: input.model ?? null, messageCount: 0,
    task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: false, messages: [],
  };
  const store = readStore(); store.conversations.unshift(conversation); writeStore(store); return conversation;
}

export function updateStudyAssistantConversation(id: string, patch: StudyAssistantConversationPatch): StudyAssistantConversation | null {
  const store = readStore(); const index = store.conversations.findIndex((conversation) => conversation.id === id); if (index < 0) return null;
  const current = store.conversations[index];
  const next: StudyAssistantConversation = {
    ...current, ...patch,
    title: patch.title !== undefined ? (patch.title.trim().slice(0, 120) || 'Conversación de estudio') : current.title,
    selection: patch.selection ? normalizeSelection(patch.selection) : current.selection,
    messages: patch.messages ? patch.messages.slice(-100) : current.messages,
    updatedAt: now(),
    messageCount: patch.messages?.length ?? current.messages.length,
  };
  store.conversations[index] = next; writeStore(store); return next;
}

export function deleteStudyAssistantConversation(id: string): void {
  const store = readStore(); store.conversations = store.conversations.filter((conversation) => conversation.id !== id); writeStore(store);
}

/** Add one fully local conversation so the demo chat is useful before an AI key is configured. */
export function seedStudyAssistantDemoConversation(): void {
  const store = readStore();
  if (store.conversations.some((conversation) => conversation.id === DEMO_CONVERSATION_ID)) return;
  const timestamp = now();
  const sourceKey = 'document:demo-study-doc-cell';
  const citation: StudyAssistantCitation = {
    id: 'S1', sourceKey, indexId: 'demo-study-chat-evidence', kind: 'document', sourceId: 'demo-study-doc-cell',
    title: 'Membrana plasmática · resumen', subtitle: 'Biología celular',
    quote: 'El transporte activo mueve solutos contra gradiente y requiere energía.',
    location: { documentId: 'demo-study-doc-cell', from: 190, to: 260 },
    scope: { courseId: 'demo-study-course-biology', subjectId: 'demo-study-subject-cell', folderId: 'demo-study-folder-cell', topicId: 'demo-study-topic-membrane' },
  };
  const conversation: StudyAssistantConversation = {
    id: DEMO_CONVERSATION_ID, title: 'Dudas sobre la membrana plasmática', createdAt: timestamp, updatedAt: timestamp,
    archived: false,
    selection: { scope: 'subject', courseId: 'demo-study-course-biology', subjectId: 'demo-study-subject-cell', topicId: null, sourceKeys: [sourceKey] },
    model: null, messageCount: 2, task: 'explain', level: 'standard', tone: 'guided', language: 'es', allowExternalKnowledge: false,
    messages: [
      { id: 'demo-study-chat-user', role: 'user', content: '¿En qué se diferencian el transporte pasivo y el activo?', createdAt: timestamp },
      { id: 'demo-study-chat-assistant', role: 'assistant', content: 'El transporte pasivo ocurre a favor del gradiente y no consume ATP. El transporte activo desplaza sustancias contra el gradiente y necesita energía [S1](nodus://study/evidence/S1).', createdAt: timestamp, citations: [citation] },
    ],
  };
  store.conversations.unshift(conversation); writeStore(store);
}

export function clearStudyAssistantDemoConversation(): void {
  const store = readStore();
  const next = store.conversations.filter((conversation) => conversation.id !== DEMO_CONVERSATION_ID);
  if (next.length !== store.conversations.length) writeStore({ ...store, conversations: next });
}

export function getStudyAssistantSources(): StudyAssistantSourceOption[] { return listStudyAssistantSourceOptions(); }

function searchOptions(selection: StudyAssistantSelection): StudySearchOptions {
  if (selection.scope === 'course') return { courseId: selection.courseId || undefined };
  if (selection.scope === 'subject') return { subjectId: selection.subjectId || undefined };
  if (selection.scope === 'topic') return { topicId: selection.topicId || undefined };
  return {};
}

async function buildCitations(question: string, selection: StudyAssistantSelection): Promise<{ citations: StudyAssistantCitation[]; truncated: boolean }> {
  if (selection.scope === 'manual' && selection.sourceKeys.length === 0) return { citations: [], truncated: false };
  const manualKeys = selection.scope === 'manual' ? selection.sourceKeys : [];
  const entries = await retrieveStudyAssistantEntries(question, searchOptions(selection), manualKeys, 20);
  const citations: StudyAssistantCitation[] = [];
  let chars = 0; let truncated = entries.length >= 20;
  for (const entry of entries) {
    if (chars >= MAX_CONTEXT_CHARS) { truncated = true; break; }
    const compressed = compressStudyAssistantEvidence(entry.text, question, Math.min(MAX_SOURCE_CHARS, MAX_CONTEXT_CHARS - chars));
    if (!compressed.text) continue;
    const id = `S${citations.length + 1}`;
    citations.push(toCitation(id, entry, compressed.text));
    chars += compressed.text.length;
    truncated ||= compressed.truncated;
  }
  return { citations, truncated };
}

function toCitation(id: string, entry: StudySearchIndexEntry, quote: string): StudyAssistantCitation {
  return {
    id, sourceKey: studyAssistantSourceKey(entry.kind, entry.sourceId), indexId: entry.indexId, kind: entry.kind,
    sourceId: entry.sourceId, title: entry.title, subtitle: entry.subtitle, quote, location: entry.location, scope: entry.scope,
  };
}

const TASK_INSTRUCTION: Record<StudyAssistantRequest['task'], string> = {
  answer: 'Responde directamente a la pregunta.',
  summary: 'Sintetiza lo esencial sin perder matices ni condiciones.',
  explain: 'Explica paso a paso y define los conceptos necesarios.',
  compare: 'Compara autores, teorías, conceptos, eventos o fuentes en criterios explícitos.',
  outline: 'Crea un esquema jerárquico útil para estudiar.',
  timeline: 'Construye una cronología ordenada; no inventes fechas.',
  table: 'Usa una tabla Markdown comparativa cuando las fuentes lo permitan.',
  'concept-map': 'Crea un mapa conceptual textual con relaciones etiquetadas.',
  glossary: 'Crea un glosario breve con definiciones fundamentadas.',
  critique: 'Detecta contradicciones, información incompleta, conceptos sin explicar y zonas débiles.',
  'review-questions': 'Genera preguntas de repaso y añade respuestas separadas al final.',
};

export function buildStudyAssistantPrompt(request: StudyAssistantRequest, citations: StudyAssistantCitation[]): { system: string; user: string } {
  const history = request.messages.filter((message) => message.content.trim()).slice(-MAX_HISTORY_MESSAGES);
  const sources = citations.map((citation) => ({
    id: citation.id, title: citation.title, type: citation.kind, location: citation.location, exact_fragment: citation.quote,
  }));
  const language = request.language === 'auto' ? 'el idioma de la pregunta' : request.language;
  const external = request.allowExternalKnowledge
    ? 'Puedes añadir conocimiento general, pero debes separarlo bajo el epígrafe "Conocimiento externo" y nunca atribuirle una cita del corpus.'
    : 'Está PROHIBIDO usar conocimiento externo. Si las fuentes no bastan, dilo con claridad y explica qué información falta.';
  const system = `Eres el asistente de estudio de Nodus. Trabajas con un corpus local seleccionado por el alumno.

REGLAS INNEGOCIABLES
- Fundamenta las afirmaciones sobre el corpus exclusivamente en FUENTES.
- Cita la evidencia inmediatamente después de la afirmación con [S1], [S2], etc. No inventes ids, títulos, páginas, marcas temporales ni citas.
- Cada cita debe corresponder exactamente a uno de los ids suministrados. No incluyas bibliografía no presente.
- ${external}
- Si hay versiones o fuentes contradictorias, descríbelas como tales; no las fusiones silenciosamente.
- Responde en ${language}, nivel ${request.level}, tono ${request.tone}.
- Conserva Markdown. ${TASK_INSTRUCTION[request.task]}`;
  const user = JSON.stringify({ fuentes_seleccionadas: sources, conversacion: history.map(({ role, content }) => ({ role, content })) }, null, 2);
  return { system, user };
}

export async function streamStudyAssistant(
  request: StudyAssistantRequest,
  onDelta: (delta: string, kind?: 'content' | 'reasoning') => void,
  signal?: AbortSignal,
): Promise<StudyAssistantResponse> {
  const lastUser = [...request.messages].reverse().find((message) => message.role === 'user' && message.content.trim());
  if (!lastUser) throw new Error('Escribe una pregunta antes de enviar.');
  const settings = getSettings();
  const responseLanguage = request.language === 'auto' ? settings.promptLanguage : request.language;
  const insufficientAnswer = INSUFFICIENT_INFORMATION[responseLanguage] ?? INSUFFICIENT_INFORMATION.en;
  const configuredModel = request.model ?? settings.studyModel ?? settings.chatModel ?? settings.synthesisModel ?? null;
  const { citations: availableCitations, truncated } = await buildCitations(lastUser.content, normalizeSelection(request.selection));
  const sourceChars = availableCitations.reduce((sum, citation) => sum + citation.quote.length, 0);
  const stats = {
    sourceCount: availableCitations.length, sourceChars,
    estimatedInputTokens: Math.ceil((sourceChars + request.messages.reduce((sum, message) => sum + message.content.length, 0)) / 3.5),
    truncated, provider: configuredModel?.provider ?? '', model: configuredModel?.model ?? '',
  };
  if (!availableCitations.length && !request.allowExternalKnowledge) {
    return { answer: insufficientAnswer, citations: [], availableCitations: [], citationWarning: false, insufficientInformation: true, interrupted: false, stats };
  }
  const effectiveModel = resolveModelRef(configuredModel);
  const prompt = buildStudyAssistantPrompt(request, availableCitations);
  const raw = await completeTextStream({ ...prompt, temperature: 0.18, maxTokens: 3200 }, onDelta, effectiveModel, signal);
  const validated = validateStudyAssistantAnswer(raw, availableCitations, insufficientAnswer);
  return {
    ...validated, availableCitations, insufficientInformation: !raw.trim(), interrupted: Boolean(signal?.aborted), stats,
  };
}

export function renderStudyAssistantConversation(conversation: StudyAssistantConversation): string {
  const header = `# ${conversation.title}\n\n_Exportado desde el chat de estudio de Nodus · ${conversation.updatedAt}_\n`;
  const messages = conversation.messages.map((message) => {
    const label = message.role === 'user' ? 'Alumno' : 'Asistente';
    const sources = message.role === 'assistant' && message.citations?.length
      ? `\n\nFuentes: ${message.citations.map((citation) => `${citation.id} — ${citation.title}`).join('; ')}` : '';
    return `## ${label}\n\n${message.content}${sources}`;
  }).join('\n\n');
  return `${header}\n${messages}\n`;
}

export function titleForStudyAssistantConversation(messages: StudyAssistantRequest['messages']): string {
  return titleFromStudyQuestion(messages.find((message) => message.role === 'user')?.content ?? '');
}
