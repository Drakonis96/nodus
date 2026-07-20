import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppSettings,
  StudyAssistantCitation,
  StudyAssistantConversation,
  StudyAssistantConversationSummary,
  StudyAssistantMessage,
  StudyAssistantSelection,
  StudyAssistantSourceOption,
} from '@shared/types';
import { DEFAULT_STUDY_ASSISTANT_SELECTION, titleFromStudyQuestion } from '@shared/studyAssistant';
import { ConfirmModal } from '../components/ConfirmModal';
import { Markdown } from '../components/Markdown';
import { ModelPicker } from '../components/ModelPicker';
import { Icon } from '../components/ui';
import { useFeatureModel } from '../hooks/useFeatureModel';
import { t } from '../i18n';

const STARTERS = [
  'Resume las ideas esenciales y señala qué debería recordar.',
  'Compara los conceptos centrales de estas fuentes.',
  '¿Qué contradicciones o puntos incompletos aparecen en el material?',
  'Explícamelo paso a paso como si fuera la primera vez que lo estudio.',
];

function newMessage(role: StudyAssistantMessage['role'], content: string): StudyAssistantMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() };
}

function blankSelection(): StudyAssistantSelection {
  return { ...DEFAULT_STUDY_ASSISTANT_SELECTION, sourceKeys: [] };
}

function relativeDate(value: string): string {
  const date = new Date(value); const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return t('Ahora');
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} h`;
  return date.toLocaleDateString();
}

export function StudyChatView({ settings, onOpenDocument, onOpenMaterial, onOpenRecording, initialPrompt }: {
  settings: AppSettings;
  onOpenDocument: (id: string) => void;
  onOpenMaterial: (id: string) => void;
  onOpenRecording: (id: string, timestamp?: number | null) => void;
  initialPrompt?: string | null;
}) {
  const [conversation, setConversation] = useState<StudyAssistantConversation | null>(null);
  const [history, setHistory] = useState<StudyAssistantConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(() => localStorage.getItem('nodus.studyChatHistoryOpen') === '1');
  const [contextOpen, setContextOpen] = useState(() => localStorage.getItem('nodus.studyChatContextOpen') !== '0');
  const [sources, setSources] = useState<StudyAssistantSourceOption[]>([]);
  const [selection, setSelection] = useState<StudyAssistantSelection>(blankSelection);
  const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const [reasoning, setReasoning] = useState(''); const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<StudyAssistantConversationSummary | null>(null);
  const [model, setModel] = useFeatureModel(settings, 'studyModel');
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (initialPrompt?.trim()) setInput(initialPrompt.trim()); }, [initialPrompt]);

  const refreshHistory = useCallback(async () => setHistory(await window.nodus.listStudyAssistantConversations()), []);
  useEffect(() => { void Promise.all([refreshHistory(), window.nodus.listStudyAssistantSources().then(setSources)]); }, [refreshHistory]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [conversation?.messages, reasoning]);

  const toggleHistory = () => setHistoryOpen((open) => {
    localStorage.setItem('nodus.studyChatHistoryOpen', open ? '0' : '1'); return !open;
  });
  const toggleContext = () => setContextOpen((open) => {
    localStorage.setItem('nodus.studyChatContextOpen', open ? '0' : '1'); return !open;
  });
  const resetChat = () => { setConversation(null); setInput(''); setReasoning(''); setError(''); };
  const openConversation = async (id: string) => {
    const next = await window.nodus.getStudyAssistantConversation(id); if (!next) return;
    setConversation(next); setSelection(next.selection); if (next.model) setModel(next.model); setError(''); setReasoning('');
  };
  const removeConversation = async () => {
    if (!pendingDelete) return;
    await window.nodus.deleteStudyAssistantConversation(pendingDelete.id);
    if (conversation?.id === pendingDelete.id) resetChat();
    setPendingDelete(null); await refreshHistory();
  };

  const send = async (value = input) => {
    const question = value.trim(); if (!question || busy) return;
    let active = conversation;
    if (!active) active = await window.nodus.createStudyAssistantConversation({ selection, model, title: titleFromStudyQuestion(question) });
    const user = newMessage('user', question); const assistant = newMessage('assistant', ''); const base = [...active.messages, user];
    setInput(''); setBusy(true); setError(''); setReasoning(''); setConversation({ ...active, messages: [...base, assistant], messageCount: base.length + 1 });
    try {
      const response = await window.nodus.streamStudyAssistant({ messages: base, selection, task: 'answer', level: 'standard', tone: 'clear', language: 'auto', allowExternalKnowledge: false, model }, {
        onDelta: (delta) => setConversation((current) => current ? { ...current, messages: current.messages.map((item) => item.id === assistant.id ? { ...item, content: item.content + delta } : item) } : current),
        onReasoning: (delta) => setReasoning((current) => current + delta),
      });
      const finalAssistant = { ...assistant, content: response.answer, citations: response.citations, citationWarning: response.citationWarning, stats: response.stats, interrupted: response.interrupted };
      const next = await window.nodus.updateStudyAssistantConversation(active.id, { messages: [...base, finalAssistant], selection, model });
      if (next) setConversation(next);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause); setError(message);
      const failed = { ...assistant, content: message, error: true };
      const next = await window.nodus.updateStudyAssistantConversation(active.id, { messages: [...base, failed], selection, model });
      if (next) setConversation(next);
    } finally { setBusy(false); setReasoning(''); await refreshHistory(); }
  };

  const openCitation = (citation: StudyAssistantCitation) => {
    if (citation.kind === 'document' && citation.location.documentId) onOpenDocument(citation.location.documentId);
    else if (citation.kind === 'material' && citation.location.materialId) onOpenMaterial(citation.location.materialId);
    else if (citation.kind === 'transcript' && citation.location.recordingId) onOpenRecording(citation.location.recordingId, citation.location.timestampSeconds);
  };

  return <div className="flex h-full min-h-0 bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="study-chat-view">
    {historyOpen && <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950" data-testid="study-chat-history-sidebar">
      <div className="flex items-center gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800"><h2 className="text-sm font-semibold">{t('Historial de chats')}</h2><button className="btn btn-ghost ml-auto h-7 w-7 p-0" title={t('Ocultar historial')} onClick={toggleHistory}><Icon name="x" size={13} /></button></div>
      <div className="p-2"><button data-testid="study-chat-new" className="btn btn-primary w-full" onClick={resetChat}><Icon name="plus" size={13} />{t('Nuevo chat')}</button></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{history.map((item) => <article key={item.id} className={`group mb-1 flex items-center rounded-lg ${conversation?.id === item.id ? 'bg-teal-50 dark:bg-teal-950/40' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`} data-testid={`study-chat-history-${item.id}`}><button className="min-w-0 flex-1 px-2.5 py-2 text-left" onClick={() => void openConversation(item.id)}><span className="block truncate text-xs font-medium">{item.title}</span><span className="mt-0.5 block text-[9px] text-neutral-500">{item.messageCount} {t('mensajes')} · {relativeDate(item.updatedAt)}</span></button><button className="mr-1 grid h-7 w-7 place-items-center rounded text-neutral-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/40" title={t('Eliminar chat')} onClick={() => setPendingDelete(item)}><Icon name="trash" size={12} /></button></article>)}{!history.length && <p className="px-3 py-8 text-center text-xs leading-5 text-neutral-500">{t('Tus conversaciones de estudio aparecerán aquí.')}</p>}</div>
    </aside>}

    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-w-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950"><button data-testid="study-chat-history-toggle" className={`btn h-8 w-8 shrink-0 p-0 ${historyOpen ? 'btn-secondary' : 'btn-ghost'}`} aria-label={t('Historial de chats')} title={t('Historial de chats')} onClick={toggleHistory}><Icon name="clock" size={15} /></button><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300"><Icon name="chat" size={17} /></span><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">{conversation?.title ?? t('Chat de estudio')}</h1><p className="truncate text-[10px] text-neutral-500">{t('Pregunta a tus materiales y apuntes con citas verificables.')}</p></div><div className="w-56 min-w-0 max-w-[42%] shrink"><ModelPicker settings={settings} value={model} onChange={setModel} compact className="w-full min-w-0" /></div><button data-testid="study-chat-header-new" className="btn btn-ghost relative z-10 h-8 w-8 shrink-0 p-0" aria-label={t('Nuevo chat')} title={t('Nuevo chat')} onClick={resetChat}><Icon name="plus" size={13} /></button><button data-testid="study-chat-context-toggle" className={`btn relative z-10 h-8 w-8 shrink-0 p-0 ${contextOpen ? 'btn-secondary' : 'btn-ghost'}`} aria-label={t(contextOpen ? 'Ocultar ámbito y fuentes' : 'Mostrar ámbito y fuentes')} title={t(contextOpen ? 'Ocultar ámbito y fuentes' : 'Mostrar ámbito y fuentes')} onClick={toggleContext}><Icon name="columns" size={14} /></button></header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6"><div className="mx-auto flex max-w-3xl flex-col gap-4">
        {!conversation?.messages.length && <div className="py-14 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300"><Icon name="chat" size={25} /></span><h2 className="mt-4 text-lg font-semibold">{t('Pregunta a tus materiales')}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-500">{t('El chat usa los materiales, apuntes y transcripciones del ámbito elegido para responder con evidencia.')}</p><div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-2">{STARTERS.map((starter) => <button key={starter} className="rounded-xl border border-neutral-200 bg-white p-3 text-left text-xs leading-5 text-neutral-600 hover:border-teal-400 hover:bg-teal-50 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400 dark:hover:border-teal-800 dark:hover:bg-teal-950/20" onClick={() => void send(t(starter))}>{t(starter)}</button>)}</div></div>}
        {conversation?.messages.map((item) => item.role === 'user' ? <div key={item.id} className="ml-auto max-w-[82%] rounded-2xl rounded-br-sm bg-teal-600 px-4 py-3 text-sm leading-6 text-white">{item.content}</div> : <article key={item.id} className={`mr-auto max-w-[95%] rounded-2xl border bg-white px-4 py-3 shadow-sm dark:bg-neutral-900/45 ${item.error ? 'border-red-300 dark:border-red-900' : 'border-neutral-200 dark:border-neutral-800'}`} data-testid="study-chat-assistant-message"><Markdown content={item.content || (busy ? '…' : '')} verify={false} onStudyEvidence={(id) => { const citation = item.citations?.find((entry) => entry.id === id); if (citation) openCitation(citation); }} />{item.citations?.length ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-neutral-200 pt-3 dark:border-neutral-800">{item.citations.map((citation) => <button key={citation.id} className="rounded-full border border-teal-200 px-2 py-1 text-[10px] text-teal-700 hover:border-teal-500 dark:border-teal-900 dark:text-teal-300" onClick={() => openCitation(citation)}>{citation.id} · {citation.title}</button>)}</div> : null}</article>)}
        {reasoning && <details className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-500 dark:border-neutral-800"><summary>{t('Razonamiento del modelo')}</summary><pre className="mt-2 whitespace-pre-wrap">{reasoning}</pre></details>}
      </div></div>
      <footer className="border-t border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950"><div className="relative mx-auto flex h-10 max-w-3xl items-stretch gap-2">{error && <span className="absolute bottom-full left-0 mb-2 max-w-full truncate rounded-md bg-red-50 px-2 py-1 text-[10px] text-red-600 shadow-sm dark:bg-red-950 dark:text-red-300">{error}</span>}<div className="h-10 min-w-0 flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-2 focus-within:border-teal-500 dark:border-neutral-700 dark:bg-neutral-900"><textarea rows={1} data-testid="study-chat-input" aria-label={selection.scope === 'manual' ? `${selection.sourceKeys.length} ${t('fuentes elegidas')}` : t('Recuperación automática local')} className="block h-full w-full resize-none bg-transparent px-1 py-2.5 text-sm leading-5 outline-none" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={t('Pregunta, compara o resume tus materiales…')} /></div>{busy ? <button data-testid="study-chat-stop" className="btn btn-secondary h-10 shrink-0 self-stretch" onClick={() => void window.nodus.cancelStudyAssistant()}><Icon name="stop" size={12} />{t('Detener')}</button> : <button data-testid="study-chat-send" className="btn btn-primary h-10 shrink-0 self-stretch" disabled={!input.trim()} onClick={() => void send()}><Icon name="arrowUp" size={13} />{t('Enviar')}</button>}</div></footer>
    </main>

    {contextOpen && <aside className="w-72 shrink-0 overflow-y-auto border-l border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950" data-testid="study-chat-context-sidebar"><div className="flex items-center gap-2"><h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Ámbito y fuentes')}</h2><button className="btn btn-ghost ml-auto h-7 w-7 p-0" aria-label={t('Ocultar ámbito y fuentes')} title={t('Ocultar ámbito y fuentes')} onClick={toggleContext}><Icon name="x" size={13} /></button></div><label className="mt-3 block text-[10px] text-neutral-500">{t('Ámbito')}<select data-testid="study-chat-scope" className="input mt-1 w-full" value={selection.scope} onChange={(event) => setSelection((current) => ({ ...current, scope: event.target.value as StudyAssistantSelection['scope'], sourceKeys: [] }))}><option value="library">{t('Toda la biblioteca')}</option><option value="manual">{t('Selección manual')}</option></select></label>{selection.scope === 'manual' && <div className="mt-3 max-h-[calc(100vh-220px)] space-y-1 overflow-y-auto">{sources.map((source) => <label key={source.sourceKey} className="flex cursor-pointer gap-2 rounded-lg border border-neutral-200 p-2 text-xs hover:border-teal-400 dark:border-neutral-800 dark:hover:border-teal-800"><input type="checkbox" checked={selection.sourceKeys.includes(source.sourceKey)} onChange={(event) => setSelection((current) => ({ ...current, sourceKeys: event.target.checked ? [...current.sourceKeys, source.sourceKey] : current.sourceKeys.filter((key) => key !== source.sourceKey) }))} /><span className="min-w-0"><span className="block truncate font-medium">{source.title}</span><span className="block truncate text-[9px] text-neutral-500">{source.subtitle}</span></span></label>)}</div>}<p className="mt-4 rounded-lg bg-neutral-100 p-3 text-[10px] leading-5 text-neutral-500 dark:bg-neutral-900/60">{t('Las respuestas se fundamentan en el contenido del vault de estudio. Las citas abren la fuente original.')}</p></aside>}

    {pendingDelete && <ConfirmModal title={t('Eliminar chat')} message={t('Se eliminará «{title}» y todo su historial. Esta acción no se puede deshacer.').replace('{title}', pendingDelete.title)} confirmLabel={t('Eliminar')} danger onConfirm={() => void removeConversation()} onCancel={() => setPendingDelete(null)} />}
  </div>;
}
