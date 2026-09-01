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
import type { PromptLanguage } from '@shared/types';
import { studyAssistantDemoSourceTitle, studyAssistantPromptPack } from '../../shared/studyAssistantPromptPacks';
import { getSettings } from '../db/settingsRepo';
import { activeVaultDir } from '../vaults/vaultRegistry';
import { completeTextStream, resolveModelRef } from './aiClient';
import { listStudyAssistantSourceOptions, retrieveStudyAssistantEntries } from './studySearch';

interface StudyAssistantStore { version: 1; conversations: StudyAssistantConversation[] }

const EMPTY_STORE: StudyAssistantStore = { version: 1, conversations: [] };
const MAX_HISTORY_MESSAGES = 12;
const MAX_CONTEXT_CHARS = 52_000;
const MAX_SOURCE_CHARS = 3_600;
/** One seeded conversation per demo vault; the id prefix is what `clear` matches on. */
const DEMO_CONVERSATION_IDS = { study: 'demo-study-chat-membrane', teaching: 'demo-teaching-chat-commentary' } as const;
type StudyChatDemoVariant = keyof typeof DEMO_CONVERSATION_IDS;

function promptLanguage(value: unknown): PromptLanguage {
  return value === 'en' || value === 'fr' || value === 'de' || value === 'pt' || value === 'pt-BR' || value === 'it' || value === 'tr' ? value : 'es';
}

function effectivePromptLanguage(requestLanguage: unknown): PromptLanguage {
  return promptLanguage(requestLanguage === 'auto' ? getSettings().promptLanguage : requestLanguage);
}

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
  const defaultTitle = studyAssistantPromptPack(promptLanguage(getSettings().promptLanguage)).conversationTitle;
  const conversation: StudyAssistantConversation = {
    id: crypto.randomUUID(), title: input.title?.trim() || defaultTitle, createdAt: timestamp, updatedAt: timestamp,
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
    title: patch.title !== undefined ? (patch.title.trim().slice(0, 120) || studyAssistantPromptPack(promptLanguage(getSettings().promptLanguage)).conversationTitle) : current.title,
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

/**
 * One fully local conversation per demo vault, so the chat is useful before an AI key
 * is configured. The teaching variant exists because the study one cites a study-demo
 * document: seeded into a teaching vault its citation would resolve to nothing, which
 * is precisely the broken-evidence state the chat is built to avoid showing.
 */
function demoConversation(variant: StudyChatDemoVariant, timestamp: string): StudyAssistantConversation {
  const language = promptLanguage(getSettings().promptLanguage);
  const copy = studyAssistantPromptPack(language);
  if (variant === 'teaching') {
    const sourceKey = 'material:demo-teaching-material-guide';
    const citation: StudyAssistantCitation = {
      id: 'S1', sourceKey, indexId: 'demo-teaching-chat-evidence', kind: 'material', sourceId: 'demo-teaching-material-guide',
      title: studyAssistantDemoSourceTitle(language, 'teaching'), subtitle: copy.demo.teachingSubtitle, quote: copy.demo.teachingQuote,
      location: { materialId: 'demo-teaching-material-guide', from: 60, to: 150 },
      scope: { courseId: 'demo-teaching-course', subjectId: 'demo-teaching-subject-history', folderId: 'demo-teaching-folder-unit3', topicId: 'demo-teaching-topic-sources' },
    };
    return {
      id: DEMO_CONVERSATION_IDS.teaching,
      title: copy.demo.teachingTitle,
      createdAt: timestamp, updatedAt: timestamp, archived: false,
      selection: { scope: 'subject', courseId: 'demo-teaching-course', subjectId: 'demo-teaching-subject-history', topicId: null, sourceKeys: [sourceKey] },
      model: null, messageCount: 2, task: 'explain', level: 'standard', tone: 'clear', language: language as StudyAssistantConversation['language'], allowExternalKnowledge: false,
      messages: [
        {
          id: 'demo-teaching-chat-user', role: 'user', createdAt: timestamp,
          content: copy.demo.teachingQuestion,
        },
        {
          id: 'demo-teaching-chat-assistant', role: 'assistant', createdAt: timestamp, citations: [citation],
          content: copy.demo.teachingAnswer,
        },
      ],
    };
  }
  const sourceKey = 'document:demo-study-doc-cell';
  const citation: StudyAssistantCitation = {
    id: 'S1', sourceKey, indexId: 'demo-study-chat-evidence', kind: 'document', sourceId: 'demo-study-doc-cell',
    title: studyAssistantDemoSourceTitle(language, 'study'), subtitle: copy.demo.studySubtitle,
    quote: copy.demo.studyQuote,
    location: { documentId: 'demo-study-doc-cell', from: 190, to: 260 },
    scope: { courseId: 'demo-study-course-biology', subjectId: 'demo-study-subject-cell', folderId: 'demo-study-folder-cell', topicId: 'demo-study-topic-membrane' },
  };
  return {
    id: DEMO_CONVERSATION_IDS.study, title: copy.demo.studyTitle, createdAt: timestamp, updatedAt: timestamp,
    archived: false,
    selection: { scope: 'subject', courseId: 'demo-study-course-biology', subjectId: 'demo-study-subject-cell', topicId: null, sourceKeys: [sourceKey] },
    model: null, messageCount: 2, task: 'explain', level: 'standard', tone: 'guided', language: language as StudyAssistantConversation['language'], allowExternalKnowledge: false,
    messages: [
      { id: 'demo-study-chat-user', role: 'user', content: copy.demo.studyQuestion, createdAt: timestamp },
      { id: 'demo-study-chat-assistant', role: 'assistant', content: copy.demo.studyAnswer, createdAt: timestamp, citations: [citation] },
    ],
  };
}

export function seedStudyAssistantDemoConversation(variant: StudyChatDemoVariant = 'study'): void {
  const store = readStore();
  const id = DEMO_CONVERSATION_IDS[variant];
  if (store.conversations.some((conversation) => conversation.id === id)) return;
  store.conversations.unshift(demoConversation(variant, now())); writeStore(store);
}

export function clearStudyAssistantDemoConversation(variant: StudyChatDemoVariant = 'study'): void {
  const store = readStore();
  const id = DEMO_CONVERSATION_IDS[variant];
  const next = store.conversations.filter((conversation) => conversation.id !== id);
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

export function buildStudyAssistantPrompt(request: StudyAssistantRequest, citations: StudyAssistantCitation[]): { system: string; user: string } {
  const history = request.messages.filter((message) => message.content.trim()).slice(-MAX_HISTORY_MESSAGES);
  const sources = citations.map((citation) => ({
    id: citation.id, title: citation.title, type: citation.kind, location: citation.location, exact_fragment: citation.quote,
  }));
  const selectedLanguage = effectivePromptLanguage(request.language);
  const pack = studyAssistantPromptPack(selectedLanguage);
  const language = request.language === 'auto' ? pack.responseLanguage : selectedLanguage;
  const external = request.allowExternalKnowledge ? pack.system.externalAllowed : pack.system.externalForbidden;
  const system = [pack.system.intro, '', pack.system.rulesHeading, `- ${pack.system.corpus}`, `- ${pack.system.cite}`, `- ${pack.system.exact}`, `- ${external}`, `- ${pack.system.contradiction}`, `- ${pack.system.language(language, request.level, request.tone)}`, `- ${pack.system.markdown} ${pack.taskInstruction[request.task]}`].join('\n');
  const user = JSON.stringify({ fuentes_seleccionadas: sources, conversacion: history.map(({ role, content }) => ({ role, content })) }, null, 2);
  return { system, user };
}

export async function streamStudyAssistant(
  request: StudyAssistantRequest,
  onDelta: (delta: string, kind?: 'content' | 'reasoning') => void,
  signal?: AbortSignal,
): Promise<StudyAssistantResponse> {
  const lastUser = [...request.messages].reverse().find((message) => message.role === 'user' && message.content.trim());
  if (!lastUser) throw new Error(studyAssistantPromptPack(effectivePromptLanguage(request.language)).noQuestion);
  const settings = getSettings();
  const responseLanguage = effectivePromptLanguage(request.language);
  const insufficientAnswer = studyAssistantPromptPack(responseLanguage).insufficientInformation;
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
  const pack = studyAssistantPromptPack(effectivePromptLanguage(conversation.language));
  const header = `# ${conversation.title}\n\n${pack.exportHeader(conversation.updatedAt)}\n`;
  const messages = conversation.messages.map((message) => {
    const label = message.role === 'user' ? pack.labels.user : pack.labels.assistant;
    const sources = message.role === 'assistant' && message.citations?.length
      ? `\n\n${pack.labels.sources}: ${message.citations.map((citation) => `${citation.id} — ${citation.title}`).join('; ')}` : '';
    return `## ${label}\n\n${message.content}${sources}`;
  }).join('\n\n');
  return `${header}\n${messages}\n`;
}

export function titleForStudyAssistantConversation(messages: StudyAssistantRequest['messages']): string {
  return titleFromStudyQuestion(messages.find((message) => message.role === 'user')?.content ?? '');
}
