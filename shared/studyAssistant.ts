import type { ModelRef } from './types';
import type { StudySearchKind, StudySearchLocation, StudySearchScope } from './studySearch';

export type StudyAssistantScopeKind = 'library' | 'course' | 'subject' | 'topic' | 'manual';
export type StudyAssistantTask = 'answer' | 'summary' | 'explain' | 'compare' | 'outline' | 'timeline' | 'table' | 'concept-map' | 'glossary' | 'critique' | 'review-questions';
export type StudyAssistantLevel = 'simple' | 'standard' | 'advanced';
export type StudyAssistantTone = 'clear' | 'academic' | 'concise' | 'guided';
export type StudyAssistantLanguage = 'auto' | 'es' | 'en' | 'fr';

export interface StudyAssistantSelection {
  scope: StudyAssistantScopeKind;
  courseId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  sourceKeys: string[];
}

export interface StudyAssistantSourceOption {
  sourceKey: string;
  kind: StudySearchKind;
  sourceId: string;
  title: string;
  subtitle: string;
  scope: StudySearchScope;
  chunks: number;
  updatedAt: string;
}

export interface StudyAssistantCitation {
  id: string;
  sourceKey: string;
  indexId: string;
  kind: StudySearchKind;
  sourceId: string;
  title: string;
  subtitle: string;
  quote: string;
  location: StudySearchLocation;
  scope: StudySearchScope;
}

export interface StudyAssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  citations?: StudyAssistantCitation[];
  error?: boolean;
  interrupted?: boolean;
  citationWarning?: boolean;
  stats?: StudyAssistantContextStats;
}

export interface StudyAssistantConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  selection: StudyAssistantSelection;
  model: ModelRef | null;
  messageCount: number;
}

export interface StudyAssistantConversation extends StudyAssistantConversationSummary {
  task: StudyAssistantTask;
  level: StudyAssistantLevel;
  tone: StudyAssistantTone;
  language: StudyAssistantLanguage;
  allowExternalKnowledge: boolean;
  messages: StudyAssistantMessage[];
}

export interface StudyAssistantConversationInput {
  title?: string;
  selection?: Partial<StudyAssistantSelection>;
  model?: ModelRef | null;
}

export interface StudyAssistantConversationPatch {
  title?: string;
  archived?: boolean;
  selection?: StudyAssistantSelection;
  model?: ModelRef | null;
  task?: StudyAssistantTask;
  level?: StudyAssistantLevel;
  tone?: StudyAssistantTone;
  language?: StudyAssistantLanguage;
  allowExternalKnowledge?: boolean;
  messages?: StudyAssistantMessage[];
}

export interface StudyAssistantRequest {
  messages: StudyAssistantMessage[];
  selection: StudyAssistantSelection;
  task: StudyAssistantTask;
  level: StudyAssistantLevel;
  tone: StudyAssistantTone;
  language: StudyAssistantLanguage;
  allowExternalKnowledge: boolean;
  model?: ModelRef | null;
}

export interface StudyAssistantContextStats {
  sourceCount: number;
  sourceChars: number;
  estimatedInputTokens: number;
  truncated: boolean;
  provider: string;
  model: string;
}

export interface StudyAssistantResponse {
  answer: string;
  citations: StudyAssistantCitation[];
  availableCitations: StudyAssistantCitation[];
  citationWarning: boolean;
  insufficientInformation: boolean;
  interrupted: boolean;
  stats: StudyAssistantContextStats;
}

export interface StudyAssistantStreamHandlers {
  onDelta: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}

export const DEFAULT_STUDY_ASSISTANT_SELECTION: StudyAssistantSelection = {
  scope: 'library', sourceKeys: [], courseId: null, subjectId: null, topicId: null,
};

export function studyAssistantSourceKey(kind: StudySearchKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

export function studyAssistantCitationLink(id: string): string {
  return `[${id}](nodus://study/evidence/${encodeURIComponent(id)})`;
}

/**
 * Accept the compact citation forms models commonly emit, turn known ids into
 * durable Nodus links, and remove invented ids. The returned citation list is
 * therefore always a subset of the exact evidence supplied to the model.
 */
export function validateStudyAssistantAnswer(
  answer: string,
  available: StudyAssistantCitation[],
  emptyAnswer = 'No hay información suficiente en las fuentes seleccionadas para responder con seguridad.',
): { answer: string; citations: StudyAssistantCitation[]; citationWarning: boolean } {
  const byId = new Map(available.map((citation) => [citation.id, citation]));
  const used = new Set<string>();
  const normalize = (_match: string, id: string) => {
    const citation = byId.get(id.toUpperCase());
    if (!citation) return '';
    used.add(citation.id);
    return studyAssistantCitationLink(citation.id);
  };
  let clean = answer
    .replace(/\[\[(S\d+)\]\]/gi, normalize)
    .replace(/\[(S\d+)\]\([^)]+\)/gi, normalize)
    .replace(/\[(S\d+)\](?!\()/gi, normalize)
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
  const citations = [...used].map((id) => byId.get(id)!).filter(Boolean);
  const citationWarning = available.length > 0 && citations.length === 0;
  if (!clean) clean = emptyAnswer;
  return { answer: clean, citations, citationWarning };
}

/** Query-focused, extractive compression. It never paraphrases evidence, so the
 * quote shown after opening a citation remains byte-for-byte present in source. */
export function compressStudyAssistantEvidence(text: string, query: string, maxChars = 3200): { text: string; truncated: boolean } {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return { text: clean, truncated: false };
  const terms = [...new Set(query.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 3))];
  const segments = clean.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const ranked = segments.map((segment, index) => {
    const normalized = segment.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return { segment, index, score: terms.reduce((sum, term) => sum + (normalized.includes(term) ? 1 : 0), 0) };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: typeof ranked = [];
  let used = 0;
  for (const item of ranked) {
    if (used + item.segment.length + 1 > maxChars && selected.length) continue;
    selected.push(item); used += item.segment.length + 1;
    if (used >= maxChars * 0.9) break;
  }
  return { text: selected.sort((a, b) => a.index - b.index).map((item) => item.segment).join(' ').slice(0, maxChars).trim(), truncated: true };
}

export function titleFromStudyQuestion(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  return clean.length <= 58 ? clean || 'Conversación de estudio' : `${clean.slice(0, 55).trim()}…`;
}
