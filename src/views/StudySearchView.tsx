import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  StudySavedSearch,
  StudySearchHistoryEntry,
  StudySearchKind,
  StudySearchOptions,
  StudySearchProgress,
  StudySearchResponse,
  StudySearchResult,
  StudyWorkspace,
} from '@shared/types';
import { Icon, Spinner } from '../components/ui';
import { TextInputModal } from '../components/TextInputModal';
import { formatStudyTimestamp } from '@shared/studyRecordings';
import { t } from '../i18n';

const KIND_LABELS: Record<StudySearchKind, string> = {
  document: 'Apunte', material: 'Material', transcript: 'Transcripción', question: 'Pregunta', exam: 'Examen',
};

const INDEX_STATE_LABELS: Record<StudySearchProgress['state'], string> = {
  empty: 'vacío', ready: 'listo', indexing: 'indexando', paused: 'en pausa', error: 'error',
};

function HighlightedSnippet({ result }: { result: StudySearchResult }) {
  const terms = result.highlightedTerms.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{result.snippet}</>;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = result.snippet.split(new RegExp(`(${escaped.join('|')})`, 'giu'));
  return <>{parts.map((part, index) => terms.some((term) => part.localeCompare(term, undefined, { sensitivity: 'base' }) === 0)
    ? <mark key={index} className="rounded bg-teal-500/25 px-0.5 text-teal-100">{part}</mark>
    : <span key={index}>{part}</span>)}</>;
}

function locationLabel(result: StudySearchResult): string {
  if (result.location.pageNumber) return `p. ${result.location.pageNumber}`;
  if (result.location.slideNumber) return `${t('Diapositiva')} ${result.location.slideNumber}`;
  if (result.location.timestampSeconds != null) return formatStudyTimestamp(result.location.timestampSeconds);
  return '';
}

export function StudySearchView({
  onOpenDocument,
  onOpenMaterial,
  onOpenRecording,
}: {
  onOpenDocument: (id: string) => void;
  onOpenMaterial: (id: string) => void;
  onOpenRecording: (id: string, timestamp?: number | null) => void;
}) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<StudySearchResponse | null>(null);
  const [kind, setKind] = useState<StudySearchKind | 'all'>('all');
  const [courseId, setCourseId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [sort, setSort] = useState<NonNullable<StudySearchOptions['sort']>>('relevance');
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState<StudySearchProgress | null>(null);
  const [saved, setSaved] = useState<StudySavedSearch[]>([]);
  const [history, setHistory] = useState<StudySearchHistoryEntry[]>([]);
  const [showIndex, setShowIndex] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [saveDialog, setSaveDialog] = useState(false);
  const [message, setMessage] = useState('');

  const options = useMemo<StudySearchOptions>(() => ({
    kinds: kind === 'all' ? undefined : [kind], courseId: courseId || undefined, subjectId: subjectId || undefined,
    topicId: topicId || undefined, sort, limit: 80,
  }), [kind, courseId, subjectId, topicId, sort]);

  const loadMeta = useCallback(async () => {
    const [nextWorkspace, nextIndex, nextSaved, nextHistory] = await Promise.all([
      window.nodus.getStudyWorkspace(), window.nodus.getStudySearchIndexStatus(), window.nodus.listStudySavedSearches(), window.nodus.listStudySearchHistory(),
    ]);
    setWorkspace(nextWorkspace); setIndex(nextIndex); setSaved(nextSaved); setHistory(nextHistory);
  }, []);

  useEffect(() => { void loadMeta(); return window.nodus.onStudySearchProgress(setIndex); }, [loadMeta]);
  useEffect(() => {
    if (query.trim().length < 2) { setResponse(null); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void window.nodus.searchStudyCorpus(query, options).then((next) => { if (active) { setResponse(next); void window.nodus.listStudySearchHistory().then(setHistory); } })
        .catch((cause) => { if (active) setMessage(cause instanceof Error ? cause.message : String(cause)); })
        .finally(() => { if (active) setBusy(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, options]);

  const subjects = workspace?.subjects.filter((subject) => !courseId || subject.courseId === courseId) ?? [];
  const topics = workspace?.topics.filter((topic) => !subjectId || topic.subjectId === subjectId) ?? [];
  const openResult = (result: StudySearchResult) => {
    if (result.kind === 'document' && result.location.documentId) onOpenDocument(result.location.documentId);
    else if (result.kind === 'material' && result.location.materialId) onOpenMaterial(result.location.materialId);
    else if (result.kind === 'transcript' && result.location.recordingId) onOpenRecording(result.location.recordingId, result.location.timestampSeconds);
  };
  const applySearch = (item: { query: string; options: StudySearchOptions }) => {
    setQuery(item.query); setKind(item.options.kinds?.[0] ?? 'all'); setCourseId(item.options.courseId ?? '');
    setSubjectId(item.options.subjectId ?? ''); setTopicId(item.options.topicId ?? ''); setSort(item.options.sort ?? 'relevance');
  };
  const rebuild = async () => {
    setMessage(''); setShowIndex(true);
    const next = await window.nodus.rebuildStudySearchIndex(); setIndex(next);
    if (next.error) setMessage(next.error); else setMessage(t('Índice de estudio actualizado.'));
    if (query.trim().length >= 2) setResponse(await window.nodus.searchStudyCorpus(query, options));
  };

  return (
    <div className="flex h-full min-h-0 flex-col p-6" data-testid="study-search-view">
      <div className="mx-auto w-full max-w-3xl shrink-0">
        <div className="mb-4 flex items-center gap-3"><Icon name="search" size={22} className="text-teal-300" /><h1 className="text-xl font-semibold">{t('Buscar en el estudio')}</h1><div className="ml-auto flex items-center gap-1"><button className={`btn btn-ghost h-8 px-2 text-xs ${showFilters ? 'text-teal-300' : ''}`} onClick={() => setShowFilters((value) => !value)}><Icon name="settings" size={13} />{t('Filtros')}</button><button className={`btn btn-ghost h-8 px-2 text-xs ${showIndex ? 'text-teal-300' : ''}`} onClick={() => setShowIndex((value) => !value)}>{t('Índice')}</button></div></div>
        <div className="relative"><Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" /><input autoFocus data-testid="study-search-input" className="input input-with-leading-icon w-full pr-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Busca en apuntes, materiales, transcripciones, preguntas y exámenes…')} />{busy && <span className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner /></span>}</div>
        {showFilters && <div className="study-search-panel mt-3 grid gap-2 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="study-search-filters"><select aria-label={t('Tipo de contenido')} className="input study-search-filter h-9 text-xs" value={kind} onChange={(event) => setKind(event.target.value as StudySearchKind | 'all')}><option value="all">{t('Todos los tipos')}</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select><select aria-label={t('Curso')} className="input study-search-filter h-9 text-xs" value={courseId} onChange={(event) => { setCourseId(event.target.value); setSubjectId(''); setTopicId(''); }}><option value="">{t('Todos los cursos')}</option>{workspace?.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select><select aria-label={t('Asignatura')} className="input study-search-filter h-9 text-xs" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(''); }}><option value="">{t('Todas las asignaturas')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><select aria-label={t('Tema')} className="input study-search-filter h-9 text-xs" value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">{t('Todos los temas')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select><select aria-label={t('Ordenar por')} className="input study-search-filter h-9 text-xs" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="relevance">{t('Relevancia')}</option><option value="date">{t('Fecha')}</option><option value="title">{t('Título')}</option></select></div>}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">{saved.map((item) => <span key={item.id} className="group inline-flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900/50 py-1 pl-2.5 pr-1 text-xs text-neutral-300"><button className="max-w-40 truncate hover:text-neutral-100" onClick={() => applySearch(item)}><Icon name="search" size={11} /> {item.name}</button><button className="text-neutral-600 hover:text-red-400" onClick={() => void window.nodus.deleteStudySavedSearch(item.id).then(loadMeta)}><Icon name="x" size={11} /></button></span>)}{query.trim().length >= 2 && <button className="ml-auto inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200" onClick={() => setSaveDialog(true)}><Icon name="star" size={11} />{t('Guardar')}</button>}</div>
        {showIndex && <section className="study-search-panel mt-3 rounded-lg border p-3" data-testid="study-search-index-panel"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium text-neutral-300">{t('Índice')} · {t(INDEX_STATE_LABELS[index?.state ?? 'empty'])}</span><span className="text-neutral-600">{index?.embeddedEntries ?? 0}/{index?.indexedEntries ?? 0} {t('fragmentos semánticos')}</span>{index?.state === 'indexing' || index?.state === 'paused' ? <><div className="h-1.5 min-w-32 flex-1 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-teal-400" style={{ width: `${index.totalEntries ? index.processedEntries / index.totalEntries * 100 : 0}%` }} /></div><button className="btn btn-ghost h-7 px-2" onClick={() => void (index.state === 'paused' ? window.nodus.resumeStudySearchIndex() : window.nodus.pauseStudySearchIndex())}>{index.state === 'paused' ? t('Reanudar') : t('Pausar')}</button><button className="btn btn-ghost h-7 px-2" onClick={() => void window.nodus.stopStudySearchIndex()}>{t('Detener')}</button></> : <button className="btn btn-ghost ml-auto h-7 px-2" onClick={() => void rebuild()}><Icon name="refresh" size={12} />{t('Reconstruir')}</button>}<button className="btn btn-ghost h-7 px-2 text-red-400" onClick={() => void window.nodus.deleteStudySearchIndex().then(loadMeta)}>{t('Borrar caché')}</button></div></section>}
        {message && <p className="mt-2 text-xs text-amber-300">{message}</p>}
        {response && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500"><span>{response.results.length} {t('resultados')} · {Math.round(response.elapsedMs)} ms</span>{response.correctedQuery && <button className="text-amber-300" onClick={() => setQuery(response.correctedQuery!)}>{t('¿Querías decir')} “{response.correctedQuery}”?</button>}</div>}
      </div>

      <main className="mt-4 min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-3xl">
        {!response && <div className="py-10 text-center">{history.length ? <><p className="mb-3 text-xs text-neutral-600">{t('Búsquedas recientes')}</p><div className="flex flex-wrap justify-center gap-2">{history.slice(0, 12).map((item) => <button key={item.id} className="rounded-full border border-neutral-800 px-3 py-1.5 text-xs text-neutral-500 hover:border-teal-800 hover:text-teal-300" onClick={() => applySearch(item)}>{item.query}</button>)}</div><button className="mt-4 text-[10px] text-neutral-600 hover:text-red-400" onClick={() => void window.nodus.clearStudySearchHistory().then(loadMeta)}>{t('Borrar historial')}</button></> : <p className="text-sm text-neutral-600">{t('Escribe al menos dos caracteres para buscar en todo el espacio de estudio.')}</p>}</div>}
        {response && <div className="space-y-1">{response.results.map((result) => <article key={result.indexId} className="group flex items-start gap-3 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 transition-colors hover:border-neutral-700 hover:bg-neutral-900" data-testid="study-search-result"><button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => openResult(result)}><Icon name={result.kind === 'document' ? 'notebook' : result.kind === 'material' ? 'book' : result.kind === 'transcript' ? 'microphone' : result.kind === 'question' ? 'help' : 'notebook'} size={15} className="mt-0.5 text-neutral-500" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm text-neutral-100">{result.title}</span><span className="shrink-0 text-[10px] text-teal-400">{t(KIND_LABELS[result.kind])}</span><span className="shrink-0 text-[10px] tabular-nums text-neutral-600">{Math.round(result.score.fusion * 100)}%</span></span><span className="block truncate text-[10px] text-neutral-600">{[result.subtitle, locationLabel(result)].filter(Boolean).join(' · ')}</span><span className="mt-0.5 line-clamp-2 block text-xs text-neutral-500"><HighlightedSnippet result={result} /></span></span></button><button className="mt-0.5 text-neutral-600 opacity-0 hover:text-red-400 group-hover:opacity-100" title={t('Excluir del índice')} onClick={() => void window.nodus.setStudySearchSourceExcluded(result.sourceId, true).then(() => window.nodus.searchStudyCorpus(query, options)).then(setResponse)}><Icon name="x" size={13} /></button></article>)}{!response.results.length && <p className="py-10 text-center text-sm text-neutral-500">{t('Sin resultados.')}</p>}</div>}
      </div></main>
      {saveDialog && <TextInputModal title={t('Guardar búsqueda')} label={t('Nombre de la búsqueda')} placeholder={query} submitLabel={t('Guardar')} onCancel={() => setSaveDialog(false)} onSubmit={async (name) => { await window.nodus.saveStudySearch(name, query, options); setSaveDialog(false); await loadMeta(); }} />}
    </div>
  );
}
