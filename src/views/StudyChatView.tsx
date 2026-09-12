import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, StudyAssistantCitation, StudyAssistantSelection, StudyAssistantSourceOption } from '@shared/types';
import { DEFAULT_STUDY_ASSISTANT_SELECTION } from '@shared/studyAssistant';
import { ChatMarkdown } from '../components/ChatMarkdown';
import { t } from '../i18n';
import { ResearchAssistantModal } from './ResearchAssistantModal';
import { nativeSummary, type ResearchChatAdapter, type ResearchUiMessage } from './researchChatAdapter';

export type StudyChatVariant = 'study' | 'teaching';

const COPY: Record<StudyChatVariant, {
  title: string;
  subtitle: string;
  historyEmpty: string;
  scopeNote: string;
  starters: string[];
}> = {
  study: {
    title: 'Research chat',
    subtitle: 'Pregunta a tus materiales y apuntes con citas verificables.',
    historyEmpty: 'Tus conversaciones de estudio aparecerán aquí.',
    scopeNote: 'Las respuestas se fundamentan en el contenido del vault de estudio. Las citas abren la fuente original.',
    starters: [
      'Resume las ideas esenciales y señala qué debería recordar.',
      'Compara los conceptos centrales de estas fuentes.',
      '¿Qué contradicciones o puntos incompletos aparecen en el material?',
      'Explícamelo paso a paso como si fuera la primera vez que lo estudio.',
    ],
  },
  teaching: {
    title: 'Research chat',
    subtitle: 'Pregunta a tus materiales de clase con citas verificables.',
    historyEmpty: 'Tus conversaciones aparecerán aquí.',
    scopeNote: 'Las respuestas se fundamentan en el contenido del vault de docencia. Las citas abren la fuente original.',
    starters: [
      'Resume las ideas esenciales de este material para preparar la clase.',
      'Compara los conceptos centrales de estas fuentes.',
      '¿Qué contradicciones o puntos incompletos aparecen en el material?',
      'Propón una explicación paso a paso para el alumnado.',
    ],
  },
};

export function StudyChatView({ settings, onOpenDocument, onOpenMaterial, onOpenRecording, initialPrompt, variant = 'study' }: {
  settings: AppSettings; onOpenDocument: (id: string) => void; onOpenMaterial: (id: string) => void;
  onOpenRecording: (id: string, timestamp?: number | null) => void; initialPrompt?: string | null; variant?: StudyChatVariant;
}) {
  const copy = COPY[variant];
  const [sources, setSources] = useState<StudyAssistantSourceOption[]>([]);
  const [selection, setSelection] = useState<StudyAssistantSelection>(() => ({ ...DEFAULT_STUDY_ASSISTANT_SELECTION, sourceKeys: [] }));
  useEffect(() => { void window.nodus.listStudyAssistantSources().then(setSources); }, []);
  const initialTarget = useMemo(() => initialPrompt ? { prompt: initialPrompt, nonce: Date.now() } : null, [initialPrompt]);
  const openCitation = (citation: StudyAssistantCitation) => {
    if (citation.kind === 'document' && citation.location.documentId) onOpenDocument(citation.location.documentId);
    else if (citation.kind === 'material' && citation.location.materialId) onOpenMaterial(citation.location.materialId);
    else if (citation.kind === 'transcript' && citation.location.recordingId) onOpenRecording(citation.location.recordingId, citation.location.timestampSeconds);
  };
  const toNative = (message: ResearchUiMessage) => ({ ...message.study, id: message.id, role: message.role, content: message.content, createdAt: message.study?.createdAt ?? new Date().toISOString(), error: message.error, interrupted: message.interrupted, selectionKey: message.selectionKey });
  const adapter: ResearchChatAdapter = {
    id: 'study', modelFeature: 'studyModel', contextKey: JSON.stringify(selection), subtitle: copy.subtitle, suggestions: copy.starters,
    canSend: selection.scope !== 'manual' || selection.sourceKeys.length > 0,
    contextPanel: <><label className="mt-3 block text-[10px] text-neutral-500">{t('Ámbito')}<select data-testid="study-chat-scope" className="input mt-1 w-full" value={selection.scope} onChange={(event) => setSelection((current) => ({ ...current, scope: event.target.value as StudyAssistantSelection['scope'], sourceKeys: [] }))}><option value="library">{t('Toda la biblioteca')}</option><option value="manual">{t('Selección manual')}</option></select></label>{selection.scope === 'manual' && <div className="mt-3 max-h-[calc(100vh-220px)] space-y-1 overflow-y-auto">{sources.map((source) => <label key={source.sourceKey} className="flex cursor-pointer gap-2 rounded-lg border border-neutral-200 p-2 text-xs research-source-option dark:border-neutral-800"><input type="checkbox" checked={selection.sourceKeys.includes(source.sourceKey)} onChange={(event) => setSelection((current) => ({ ...current, sourceKeys: event.target.checked ? [...current.sourceKeys, source.sourceKey] : current.sourceKeys.filter((key) => key !== source.sourceKey) }))} /><span className="min-w-0"><span className="block truncate font-medium">{source.title}</span><span className="block truncate text-[9px] text-neutral-500">{source.subtitle}</span></span></label>)}</div>}<p className="mt-4 rounded-lg bg-neutral-100 p-3 text-[10px] leading-5 text-neutral-500 dark:bg-neutral-900/60">{t(copy.scopeNote)}</p></>,
    listConversations: async includeArchived => (await window.nodus.listStudyAssistantConversations(includeArchived)).map(nativeSummary),
    getConversation: async id => { const chat = await window.nodus.getStudyAssistantConversation(id); if (!chat) return null; setSelection(chat.selection); return { ...nativeSummary(chat), selection: null, messages: chat.messages.map(message => ({ id: message.id, role: message.role, content: message.content, error: message.error, interrupted: message.interrupted, study: message, selectionKey: message.selectionKey ?? JSON.stringify(chat.selection) })) }; },
    createConversation: input => window.nodus.createStudyAssistantConversation({ title: input.title, model: input.model, selection }),
    saveConversationMessages: (id, messages, options) => window.nodus.updateStudyAssistantConversation(id, { messages: messages.map(toNative), selection, model: options.model }),
    deleteConversation: id => window.nodus.deleteStudyAssistantConversation(id),
    archiveConversation: (id, archived) => window.nodus.updateStudyAssistantConversation(id, { archived }),
    researchChatStream: async (request, handlers) => { const result = await window.nodus.streamStudyAssistant({ conversationId: request.conversationId, messages: request.messages.map(message => toNative({ ...message, id: crypto.randomUUID() })), selection, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: false, model: request.model, thinkingEffort: request.thinkingEffort, systemPromptId: request.systemPromptId }, handlers); return { answer: result.answer, aborted: result.interrupted, message: { study: { id: '', role: 'assistant', content: result.answer, createdAt: new Date().toISOString(), citations: result.citations, citationWarning: result.citationWarning, stats: result.stats, interrupted: result.interrupted } } }; },
    cancelResearchChat: () => window.nodus.cancelStudyAssistant(),
    renderMessage: (message, streaming) => <><ChatMarkdown content={message.content} streaming={streaming} verify={false} onStudyEvidence={id => { const citation = message.study?.citations?.find(item => item.id === id); if (citation) openCitation(citation); }} />{message.study?.citations?.length ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-neutral-800 pt-3">{message.study.citations.map(citation => <button key={citation.id} className="suggestion-chip text-xs" onClick={() => openCitation(citation)}>{citation.id} · {citation.title}</button>)}</div> : null}</>,
  };
  return <ResearchAssistantModal settings={settings} embedded adapter={adapter} initialTarget={initialTarget} />;
}
