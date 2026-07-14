import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  StudyAssistantCitation,
  StudyAssistantConversation,
  StudyAssistantConversationSummary,
  StudyAssistantLanguage,
  StudyAssistantLevel,
  StudyAssistantMessage,
  StudyAssistantSelection,
  StudyAssistantSourceOption,
  StudyAssistantTask,
  StudyAssistantTone,
  StudyWorkspace,
} from '@shared/types';
import { DEFAULT_STUDY_ASSISTANT_SELECTION, titleFromStudyQuestion } from '@shared/studyAssistant';
import { formatStudyTimestamp } from '@shared/studyRecordings';
import { Icon } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ModelPicker } from '../components/ModelPicker';
import { useFeatureModel } from '../hooks/useFeatureModel';
import { t } from '../i18n';

const TASKS: Array<{ id: StudyAssistantTask; label: string }> = [
  { id: 'answer', label: 'Responder' }, { id: 'summary', label: 'Resumir' }, { id: 'explain', label: 'Explicar' },
  { id: 'compare', label: 'Comparar' }, { id: 'outline', label: 'Esquema' }, { id: 'timeline', label: 'Cronología' },
  { id: 'table', label: 'Tabla' }, { id: 'concept-map', label: 'Mapa conceptual' }, { id: 'glossary', label: 'Glosario' },
  { id: 'critique', label: 'Detectar lagunas' }, { id: 'review-questions', label: 'Preguntas de repaso' },
];

const STARTERS = [
  'Resume las ideas esenciales y señala qué debería recordar.',
  'Compara los conceptos centrales de estas fuentes.',
  '¿Qué contradicciones o puntos incompletos aparecen en el material?',
  'Explícamelo paso a paso como si fuera la primera vez que lo estudio.',
];

const KIND_LABEL = { document: 'Apunte', material: 'Material', transcript: 'Transcripción', question: 'Pregunta', exam: 'Examen' } as const;

function emptySelection(): StudyAssistantSelection { return { ...DEFAULT_STUDY_ASSISTANT_SELECTION, sourceKeys: [] }; }
function message(role: StudyAssistantMessage['role'], content: string): StudyAssistantMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() };
}

function evidenceLocation(citation: StudyAssistantCitation): string {
  if (citation.location.pageNumber) return `p. ${citation.location.pageNumber}`;
  if (citation.location.slideNumber) return `${t('Diapositiva')} ${citation.location.slideNumber}`;
  if (citation.location.timestampSeconds != null) return formatStudyTimestamp(citation.location.timestampSeconds);
  return '';
}

export function StudyChatView({
  settings,
  onOpenDocument,
  onOpenMaterial,
  onOpenRecording,
}: {
  settings: AppSettings;
  onOpenDocument: (id: string) => void;
  onOpenMaterial: (id: string) => void;
  onOpenRecording: (id: string, timestamp?: number | null) => void;
}) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [sources, setSources] = useState<StudyAssistantSourceOption[]>([]);
  const [conversations, setConversations] = useState<StudyAssistantConversationSummary[]>([]);
  const [conversation, setConversation] = useState<StudyAssistantConversation | null>(null);
  const [selection, setSelection] = useState<StudyAssistantSelection>(emptySelection);
  const [task, setTask] = useState<StudyAssistantTask>('answer');
  const [level, setLevel] = useState<StudyAssistantLevel>('standard');
  const [tone, setTone] = useState<StudyAssistantTone>('clear');
  const [language, setLanguage] = useState<StudyAssistantLanguage>('auto');
  const [allowExternal, setAllowExternal] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [input, setInput] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [error, setError] = useState('');
  const [activeCitation, setActiveCitation] = useState<StudyAssistantCitation | null>(null);
  const [noteTarget, setNoteTarget] = useState('');
  const [model, setModel] = useFeatureModel(settings, 'studyModel');
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshHistory = useCallback(async () => setConversations(await window.nodus.listStudyAssistantConversations(includeArchived)), [includeArchived]);
  useEffect(() => { void Promise.all([window.nodus.getStudyWorkspace(), window.nodus.listStudyAssistantSources()]).then(([nextWorkspace, nextSources]) => { setWorkspace(nextWorkspace); setSources(nextSources); }); }, []);
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [conversation?.messages, reasoning]);

  const applyConversation = (next: StudyAssistantConversation | null) => {
    setConversation(next); setError(''); setReasoning(''); setInput(''); setActiveCitation(null);
    if (!next) { setSelection(emptySelection()); setTask('answer'); setLevel('standard'); setTone('clear'); setLanguage('auto'); setAllowExternal(false); return; }
    setSelection(next.selection); setTask(next.task); setLevel(next.level); setTone(next.tone); setLanguage(next.language); setAllowExternal(next.allowExternalKnowledge);
    if (next.model) setModel(next.model);
  };

  const newConversation = async () => { const next = await window.nodus.createStudyAssistantConversation({ selection, model }); applyConversation(next); await refreshHistory(); };
  const openConversation = async (id: string) => applyConversation(await window.nodus.getStudyAssistantConversation(id));
  const persist = async (messages: StudyAssistantMessage[], title?: string) => {
    if (!conversation) return null;
    const next = await window.nodus.updateStudyAssistantConversation(conversation.id, {
      messages, selection, task, level, tone, language, allowExternalKnowledge: allowExternal, model,
      ...(title ? { title } : {}),
    });
    if (next) setConversation(next); await refreshHistory(); return next;
  };

  const runGeneration = async (baseMessages: StudyAssistantMessage[]) => {
    let active = conversation;
    if (!active) {
      active = await window.nodus.createStudyAssistantConversation({ selection, model });
      setConversation(active);
    }
    const assistant = message('assistant', '');
    const pending = [...baseMessages, assistant];
    setConversation({ ...active, messages: pending, messageCount: pending.length }); setBusy(true); setError(''); setReasoning('');
    try {
      const response = await window.nodus.streamStudyAssistant({
        messages: baseMessages, selection, task, level, tone, language, allowExternalKnowledge: allowExternal, model,
      }, {
        onDelta: (delta) => setConversation((current) => current ? ({ ...current, messages: current.messages.map((item) => item.id === assistant.id ? { ...item, content: item.content + delta } : item) }) : current),
        onReasoning: (delta) => setReasoning((current) => current + delta),
      });
      const finalAssistant: StudyAssistantMessage = {
        ...assistant, content: response.answer, citations: response.citations, interrupted: response.interrupted,
        citationWarning: response.citationWarning, stats: response.stats,
      };
      const finalMessages = [...baseMessages, finalAssistant];
      const firstQuestion = baseMessages.find((item) => item.role === 'user')?.content ?? '';
      const title = active.messages.length === 0 ? titleFromStudyQuestion(firstQuestion) : undefined;
      const next = await window.nodus.updateStudyAssistantConversation(active.id, {
        messages: finalMessages, selection, task, level, tone, language, allowExternalKnowledge: allowExternal, model,
        ...(title ? { title } : {}),
      });
      if (next) setConversation(next); await refreshHistory();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      const failed = [...baseMessages, { ...assistant, content: text, error: true }];
      setError(text);
      const next = await window.nodus.updateStudyAssistantConversation(active.id, { messages: failed, selection, task, level, tone, language, allowExternalKnowledge: allowExternal, model });
      if (next) setConversation(next); await refreshHistory();
    } finally { setBusy(false); setReasoning(''); }
  };

  const send = async () => {
    const clean = input.trim(); if (!clean || busy) return;
    const base = [...(conversation?.messages ?? []), message('user', clean)]; setInput(''); await runGeneration(base);
  };
  const regenerate = async () => {
    if (!conversation || busy) return;
    const lastAssistant = [...conversation.messages].reverse().findIndex((item) => item.role === 'assistant');
    if (lastAssistant < 0) return;
    const index = conversation.messages.length - 1 - lastAssistant; await runGeneration(conversation.messages.slice(0, index));
  };

  const openEvidence = (citation: StudyAssistantCitation) => {
    setActiveCitation(citation);
    if (citation.kind === 'document' && citation.location.documentId) onOpenDocument(citation.location.documentId);
    else if (citation.kind === 'material' && citation.location.materialId) onOpenMaterial(citation.location.materialId);
    else if (citation.kind === 'transcript' && citation.location.recordingId) onOpenRecording(citation.location.recordingId, citation.location.timestampSeconds);
  };
  const citationById = new Map((conversation?.messages.flatMap((item) => item.citations ?? []) ?? []).map((citation) => [citation.id, citation]));

  const scopeSources = useMemo(() => sources.filter((source) => {
    if (selection.courseId && source.scope.courseId !== selection.courseId) return false;
    if (selection.subjectId && source.scope.subjectId !== selection.subjectId) return false;
    if (selection.topicId && source.scope.topicId !== selection.topicId) return false;
    const query = sourceQuery.trim().toLocaleLowerCase(); return !query || `${source.title} ${source.subtitle}`.toLocaleLowerCase().includes(query);
  }), [sources, selection.courseId, selection.subjectId, selection.topicId, sourceQuery]);
  const subjects = workspace?.subjects.filter((item) => !selection.courseId || item.courseId === selection.courseId) ?? [];
  const topics = workspace?.topics.filter((item) => !selection.subjectId || item.subjectId === selection.subjectId) ?? [];

  const saveAnswerToNote = async (answer: StudyAssistantMessage, existing: boolean) => {
    const provenance = (answer.citations ?? []).map((citation) => `- ${citation.id}: ${citation.title}${evidenceLocation(citation) ? ` · ${evidenceLocation(citation)}` : ''}`).join('\n');
    const body = `${answer.content}${provenance ? `\n\n## Fuentes\n\n${provenance}` : ''}`;
    if (existing && noteTarget) {
      const target = workspace?.documents.find((document) => document.id === noteTarget);
      if (!target) return;
      await window.nodus.updateStudyDoc(noteTarget, { title: target.title, contentMarkdown: `${target.contentMarkdown}\n\n## Respuesta del asistente\n\n${body}` });
      onOpenDocument(noteTarget); return;
    }
    const title = `Respuesta · ${conversation?.title ?? 'Chat de estudio'}`;
    const placement = selection.courseId || selection.subjectId || selection.topicId ? {
      courseId: selection.courseId || undefined, subjectId: selection.subjectId || undefined, topicId: selection.topicId || undefined,
    } : undefined;
    const document = await window.nodus.createStudyDocument({ title, kind: 'apunte', contentMarkdown: `# ${title}\n\n${body}`, placement });
    onOpenDocument(document.id);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[230px_minmax(0,1fr)_300px] bg-neutral-950" data-testid="study-chat-view">
      <aside className="flex min-h-0 flex-col border-r border-neutral-800 bg-neutral-950/90">
        <div className="border-b border-neutral-800 p-3"><button data-testid="study-chat-new" className="btn btn-primary w-full" onClick={() => void newConversation()}><Icon name="plus" />{t('Nueva conversación')}</button></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {conversations.map((item) => <div key={item.id} className={`group mb-1 rounded-lg border ${conversation?.id === item.id ? 'border-teal-800 bg-teal-950/25' : 'border-transparent hover:bg-neutral-900'}`}>
            <button className="w-full px-2.5 py-2 text-left" onClick={() => void openConversation(item.id)}><span className="block truncate text-xs font-medium text-neutral-300">{item.title}</span><span className="mt-0.5 block text-[9px] text-neutral-600">{item.messageCount} {t('mensajes')}{item.archived ? ` · ${t('Archivada')}` : ''}</span></button>
            <div className="hidden items-center gap-1 px-2 pb-2 group-hover:flex">
              <button title={t('Renombrar')} className="text-neutral-600 hover:text-neutral-300" onClick={() => { const title = window.prompt(t('Nombre de la conversación'), item.title); if (title) void window.nodus.updateStudyAssistantConversation(item.id, { title }).then(refreshHistory); }}><Icon name="edit" size={12} /></button>
              <button title={item.archived ? t('Restaurar') : t('Archivar')} className="text-neutral-600 hover:text-neutral-300" onClick={() => void window.nodus.updateStudyAssistantConversation(item.id, { archived: !item.archived }).then(refreshHistory)}><Icon name="archive" size={12} /></button>
              <button title={t('Exportar')} className="text-neutral-600 hover:text-neutral-300" onClick={() => void window.nodus.exportStudyAssistantConversation(item.id)}><Icon name="download" size={12} /></button>
              <button title={t('Eliminar')} className="ml-auto text-neutral-600 hover:text-red-400" onClick={() => { if (window.confirm(t('¿Eliminar esta conversación?'))) void window.nodus.deleteStudyAssistantConversation(item.id).then(() => { if (conversation?.id === item.id) applyConversation(null); return refreshHistory(); }); }}><Icon name="trash" size={12} /></button>
            </div>
          </div>)}
          {!conversations.length && <p className="p-3 text-xs leading-5 text-neutral-700">{t('Tus conversaciones de estudio aparecerán aquí.')}</p>}
        </div>
        <label className="flex items-center gap-2 border-t border-neutral-800 p-3 text-[10px] text-neutral-600"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />{t('Mostrar archivadas')}</label>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="border-b border-neutral-800 px-4 py-3"><div className="flex items-center gap-3"><div><h1 className="text-sm font-semibold">{conversation?.title ?? t('Chat de estudio')}</h1><p className="text-[10px] text-neutral-600">{t('Respuestas fundamentadas con enlaces a la evidencia exacta.')}</p></div><div className="ml-auto w-64"><ModelPicker settings={settings} value={model} onChange={setModel} compact /></div></div>
          <div className="mt-2 flex gap-1 overflow-x-auto">{TASKS.map((item) => <button key={item.id} className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] ${task === item.id ? 'border-teal-700 bg-teal-950 text-teal-300' : 'border-neutral-800 text-neutral-600 hover:text-neutral-300'}`} onClick={() => setTask(item.id)}>{t(item.label)}</button>)}</div>
        </header>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto max-w-3xl space-y-5">
            {!conversation?.messages.length && <div className="py-16 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-950 text-teal-300"><Icon name="chat" size={24} /></div><h2 className="mt-4 text-lg font-semibold">{t('Pregunta a tus materiales')}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-500">{t('El asistente recupera fragmentos del ámbito elegido y sólo enlaza citas que existen realmente en tu bóveda.')}</p><div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-2">{STARTERS.map((starter) => <button key={starter} className="rounded-xl border border-neutral-800 p-3 text-left text-xs leading-5 text-neutral-400 hover:border-teal-900 hover:text-neutral-200" onClick={() => setInput(starter)}>{t(starter)}</button>)}</div></div>}
            {conversation?.messages.map((item, index) => <article key={item.id} className={item.role === 'user' ? 'ml-auto max-w-[82%]' : 'mr-auto max-w-full'} data-testid={`study-chat-message-${item.role}`}>
              {item.role === 'user' ? <div className="rounded-2xl rounded-br-sm bg-teal-900/45 px-4 py-3 text-sm leading-6 text-teal-50">{item.content}<button className="ml-2 align-middle text-teal-500 hover:text-teal-200" title={t('Editar y reenviar')} onClick={() => { setInput(item.content); if (conversation) void persist(conversation.messages.slice(0, index)); }}><Icon name="edit" size={11} /></button></div>
                : <div className={`rounded-xl border p-4 ${item.error ? 'border-red-900 bg-red-950/20' : 'border-neutral-800 bg-neutral-900/30'}`}><Markdown content={item.content || (busy ? '…' : '')} verify={false} onStudyEvidence={(id) => { const citation = item.citations?.find((candidate) => candidate.id === id) ?? citationById.get(id); if (citation) openEvidence(citation); }} />
                  {item.citationWarning && <p className="mt-3 rounded border border-amber-900/60 bg-amber-950/20 p-2 text-[10px] text-amber-300">{t('La respuesta no incluyó citas verificables. Revísala o vuelve a generarla con otro ámbito.')}</p>}
                  {item.citations?.length ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-neutral-800 pt-3">{item.citations.map((citation) => <button key={`${item.id}-${citation.id}`} className="rounded-full border border-teal-900 px-2 py-1 text-[10px] text-teal-400 hover:border-teal-600" onClick={() => openEvidence(citation)}>{citation.id} · {citation.title}{evidenceLocation(citation) ? ` · ${evidenceLocation(citation)}` : ''}</button>)}</div> : null}
                  {item.stats && <p className="mt-2 text-[9px] text-neutral-700">{item.stats.sourceCount} {t('fuentes')} · ≈{item.stats.estimatedInputTokens.toLocaleString()} tokens · {[item.stats.provider, item.stats.model].filter(Boolean).join(' / ')}{item.stats.truncated ? ` · ${t('contexto comprimido')}` : ''}</p>}
                  {!item.error && item.content && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-2"><button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void navigator.clipboard.writeText(item.content)}><Icon name="copy" size={11} />{t('Copiar')}</button><button className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void saveAnswerToNote(item, false)}><Icon name="notebook" size={11} />{t('Crear apunte nuevo')}</button><select className="input ml-auto h-7 max-w-44 text-[10px]" value={noteTarget} onChange={(event) => setNoteTarget(event.target.value)}><option value="">{t('Elegir apunte…')}</option>{workspace?.documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select><button disabled={!noteTarget} className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void saveAnswerToNote(item, true)}>{t('Añadir al apunte')}</button></div>}
                </div>}
            </article>)}
            {reasoning && <details className="rounded-lg border border-neutral-800 p-3 text-[10px] text-neutral-600"><summary>{t('Razonamiento del modelo')}</summary><pre className="mt-2 whitespace-pre-wrap">{reasoning}</pre></details>}
          </div>
        </div>
        <footer className="border-t border-neutral-800 bg-neutral-950 p-4"><div className="mx-auto max-w-3xl"><div className="rounded-2xl border border-neutral-700 bg-neutral-900 p-2 focus-within:border-teal-700"><textarea data-testid="study-chat-input" className="min-h-20 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-neutral-700" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={t('Pregunta, compara, resume o crea material de repaso…')} /><div className="flex items-center gap-2 px-1"><span className="text-[9px] text-neutral-700">{selection.scope === 'manual' ? `${selection.sourceKeys.length} ${t('fuentes elegidas')}` : t('Recuperación automática local')}</span>{error && <span className="truncate text-[9px] text-red-400">{error}</span>}<button className="btn btn-ghost ml-auto h-8" disabled={!conversation?.messages.some((item) => item.role === 'user') || busy} onClick={() => void regenerate()}><Icon name="refresh" size={12} />{t('Regenerar')}</button>{busy ? <button data-testid="study-chat-stop" className="btn btn-secondary h-8" onClick={() => void window.nodus.cancelStudyAssistant()}><Icon name="stop" size={12} />{t('Detener')}</button> : <button data-testid="study-chat-send" className="btn btn-primary h-8" disabled={!input.trim()} onClick={() => void send()}><Icon name="arrowUp" size={13} />{t('Enviar')}</button>}</div></div></div></footer>
      </main>

      <aside className="min-h-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950/80 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Ámbito y fuentes')}</h2>
        <label className="mt-3 block text-[10px] text-neutral-600">{t('Ámbito')}<select data-testid="study-chat-scope" className="input mt-1 w-full" value={selection.scope} onChange={(event) => setSelection((current) => ({ ...current, scope: event.target.value as StudyAssistantSelection['scope'] }))}><option value="library">{t('Toda la biblioteca')}</option><option value="course">{t('Curso')}</option><option value="subject">{t('Asignatura')}</option><option value="topic">{t('Tema')}</option><option value="manual">{t('Selección manual')}</option></select></label>
        {(selection.scope === 'course' || selection.scope === 'subject' || selection.scope === 'topic' || selection.scope === 'manual') && <select className="input mt-2 w-full" value={selection.courseId ?? ''} onChange={(event) => setSelection((current) => ({ ...current, courseId: event.target.value || null, subjectId: null, topicId: null }))}><option value="">{t('Todos los cursos')}</option>{workspace?.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select>}
        {(selection.scope === 'subject' || selection.scope === 'topic' || selection.scope === 'manual') && <select className="input mt-2 w-full" value={selection.subjectId ?? ''} onChange={(event) => setSelection((current) => ({ ...current, subjectId: event.target.value || null, topicId: null }))}><option value="">{t('Todas las asignaturas')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>}
        {(selection.scope === 'topic' || selection.scope === 'manual') && <select className="input mt-2 w-full" value={selection.topicId ?? ''} onChange={(event) => setSelection((current) => ({ ...current, topicId: event.target.value || null }))}><option value="">{t('Todos los temas')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select>}
        {selection.scope === 'manual' && <div className="mt-3"><div className="relative"><Icon name="search" size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" /><input data-testid="study-chat-source-search" className="input input-with-leading-icon w-full text-xs" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder={t('Buscar fuentes…')} /></div><div className="mt-2 max-h-64 space-y-1 overflow-y-auto">{scopeSources.map((source) => <label key={source.sourceKey} className="flex cursor-pointer gap-2 rounded-lg border border-neutral-800 p-2 hover:border-teal-900"><input type="checkbox" checked={selection.sourceKeys.includes(source.sourceKey)} onChange={(event) => setSelection((current) => ({ ...current, sourceKeys: event.target.checked ? [...current.sourceKeys, source.sourceKey] : current.sourceKeys.filter((key) => key !== source.sourceKey) }))} /><span className="min-w-0"><span className="block truncate text-[10px] font-medium text-neutral-300">{source.title}</span><span className="block truncate text-[9px] text-neutral-600">{t(KIND_LABEL[source.kind])} · {source.chunks} {t('fragmentos')}</span></span></label>)}</div></div>}
        <div className="mt-5 border-t border-neutral-800 pt-4"><h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Respuesta')}</h2><div className="mt-2 grid grid-cols-2 gap-2"><select className="input text-xs" value={level} onChange={(event) => setLevel(event.target.value as StudyAssistantLevel)}><option value="simple">{t('Sencillo')}</option><option value="standard">{t('Estándar')}</option><option value="advanced">{t('Avanzado')}</option></select><select className="input text-xs" value={tone} onChange={(event) => setTone(event.target.value as StudyAssistantTone)}><option value="clear">{t('Claro')}</option><option value="academic">{t('Académico')}</option><option value="concise">{t('Conciso')}</option><option value="guided">{t('Guiado')}</option></select></div><select className="input mt-2 w-full text-xs" value={language} onChange={(event) => setLanguage(event.target.value as StudyAssistantLanguage)}><option value="auto">{t('Idioma de la pregunta')}</option><option value="es">Español</option><option value="en">English</option><option value="fr">Français</option></select>
          <label className={`mt-3 flex gap-2 rounded-lg border p-3 text-[10px] leading-4 ${allowExternal ? 'border-amber-800 bg-amber-950/20 text-amber-200' : 'border-neutral-800 text-neutral-500'}`}><input type="checkbox" checked={allowExternal} onChange={(event) => setAllowExternal(event.target.checked)} /><span><strong className="block">{t('Permitir conocimiento externo')}</strong>{t('Se mostrará separado y nunca recibirá una cita del corpus.')}</span></label>
        </div>
        {activeCitation && <section className="mt-5 rounded-xl border border-teal-900 bg-teal-950/15 p-3" data-testid="study-chat-evidence"><div className="flex items-start gap-2"><span className="rounded bg-teal-900 px-1.5 py-0.5 text-[9px] text-teal-200">{activeCitation.id}</span><div className="min-w-0"><h3 className="truncate text-xs font-medium">{activeCitation.title}</h3><p className="text-[9px] text-neutral-600">{evidenceLocation(activeCitation)}</p></div></div><blockquote className="mt-2 max-h-44 overflow-y-auto border-l-2 border-teal-800 pl-2 text-[10px] leading-5 text-neutral-400">{activeCitation.quote}</blockquote><button className="btn btn-ghost mt-2 h-7 w-full text-[10px]" onClick={() => openEvidence(activeCitation)}>{t('Abrir evidencia exacta')}</button></section>}
      </aside>
    </div>
  );
}
