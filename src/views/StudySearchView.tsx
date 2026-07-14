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
    <div className="flex h-full min-h-0 flex-col bg-neutral-950" data-testid="study-search-view">
      <header className="border-b border-neutral-800 px-5 py-4">
        <div className="flex flex-wrap items-start gap-3"><div><h1 className="text-lg font-semibold">{t('Buscar en el estudio')}</h1><p className="text-xs text-neutral-500">{t('Coincidencia literal, relevancia textual, proximidad y similitud semántica en un único ranking.')}</p></div>
          <button className="btn btn-secondary ml-auto" onClick={() => setShowIndex((value) => !value)}><Icon name="settings" size={13} />{t('Índice')} · {index?.indexedEntries ?? 0}</button>
        </div>
        <div className="relative mx-auto mt-4 max-w-4xl"><Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input data-testid="study-search-input" className="input input-with-leading-icon h-11 w-full pr-28 text-base" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('¿Dónde explico la diferencia entre X e Y?')} />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">{busy && <Spinner />}<kbd className="rounded border border-neutral-700 px-1.5 py-0.5 text-[9px] text-neutral-600">⌘ K</kbd></div>
        </div>
        <div className="mx-auto mt-3 grid max-w-6xl gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <select className="input h-8 text-xs" value={kind} onChange={(event) => setKind(event.target.value as StudySearchKind | 'all')}><option value="all">{t('Todos los tipos')}</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
          <select className="input h-8 text-xs" value={courseId} onChange={(event) => { setCourseId(event.target.value); setSubjectId(''); setTopicId(''); }}><option value="">{t('Todos los cursos')}</option>{workspace?.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select>
          <select className="input h-8 text-xs" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(''); }}><option value="">{t('Todas las asignaturas')}</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
          <select className="input h-8 text-xs" value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">{t('Todos los temas')}</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select>
          <select className="input h-8 text-xs" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="relevance">{t('Relevancia')}</option><option value="date">{t('Fecha')}</option><option value="title">{t('Título')}</option></select>
          <button className="btn btn-ghost h-8 text-xs" disabled={!query.trim()} onClick={() => setSaveDialog(true)}><Icon name="save" size={12} />{t('Guardar búsqueda')}</button>
        </div>
        {message && <p className="mx-auto mt-2 max-w-6xl text-xs text-amber-300">{message}</p>}
      </header>

      {showIndex && <section className="border-b border-neutral-800 bg-neutral-900/45 px-5 py-3" data-testid="study-search-index-panel"><div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 text-xs">
        <span className="font-medium text-neutral-300">{t('Estado del índice')}: {t(index?.state ?? 'empty')}</span><span className="text-neutral-600">{index?.embeddedEntries ?? 0}/{index?.indexedEntries ?? 0} {t('fragmentos semánticos')}</span><span className="text-neutral-600">{index?.pendingEntries ?? 0} {t('pendientes')}</span>
        {index?.state === 'indexing' || index?.state === 'paused' ? <><div className="h-1.5 min-w-40 flex-1 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-teal-400" style={{ width: `${index.totalEntries ? index.processedEntries / index.totalEntries * 100 : 0}%` }} /></div><span className="max-w-40 truncate text-neutral-500">{index.currentTitle}</span>
          <button className="btn btn-ghost h-7 px-2" onClick={() => void (index.state === 'paused' ? window.nodus.resumeStudySearchIndex() : window.nodus.pauseStudySearchIndex())}>{index.state === 'paused' ? t('Reanudar') : t('Pausar')}</button><button className="btn btn-ghost h-7 px-2" onClick={() => void window.nodus.stopStudySearchIndex()}>{t('Detener')}</button></> : <button className="btn btn-primary ml-auto h-8" onClick={() => void rebuild()}><Icon name="refresh" size={12} />{t('Reconstruir índice')}</button>}
        <button className="btn btn-ghost h-8 text-red-400" onClick={() => void window.nodus.deleteStudySearchIndex().then(loadMeta)}>{t('Borrar caché')}</button>
      </div></section>}

      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-6xl">
          {!response && <div className="grid gap-5 lg:grid-cols-2">
            <section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">{t('Búsquedas guardadas')}</h2><div className="space-y-2">{saved.map((item) => <div key={item.id} className="flex items-center rounded-lg border border-neutral-800 bg-neutral-900/30"><button className="min-w-0 flex-1 px-3 py-2 text-left text-sm text-neutral-300" onClick={() => applySearch(item)}><span className="block truncate font-medium">{item.name}</span><span className="block truncate text-[10px] text-neutral-600">{item.query}</span></button><button className="px-3 text-neutral-600 hover:text-red-400" onClick={() => void window.nodus.deleteStudySavedSearch(item.id).then(loadMeta)}>×</button></div>)}{!saved.length && <p className="text-sm text-neutral-700">{t('Todavía no has guardado ninguna búsqueda.')}</p>}</div></section>
            <section><div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-600">{t('Historial')}</h2>{history.length > 0 && <button className="text-[10px] text-neutral-600 hover:text-red-400" onClick={() => void window.nodus.clearStudySearchHistory().then(loadMeta)}>{t('Borrar historial')}</button>}</div><div className="flex flex-wrap gap-2">{history.slice(0, 15).map((item) => <button key={item.id} className="rounded-full border border-neutral-800 px-3 py-1.5 text-xs text-neutral-500 hover:border-teal-800 hover:text-teal-300" onClick={() => applySearch(item)}>{item.query} <span className="text-neutral-700">({item.resultCount})</span></button>)}{!history.length && <p className="text-sm text-neutral-700">{t('Tus búsquedas recientes aparecerán aquí.')}</p>}</div></section>
          </div>}

          {response && <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-600"><span>{response.results.length} {t('resultados')} · {Math.round(response.elapsedMs)} ms</span><span className={`rounded-full px-2 py-0.5 ${response.semanticAvailable ? 'bg-teal-950 text-teal-300' : 'bg-neutral-900 text-neutral-600'}`}>{response.semanticAvailable ? t('Ranking híbrido semántico') : t('Ranking textual local')}</span>
              {response.correctedQuery && <button className="text-amber-300" onClick={() => setQuery(response.correctedQuery!)}>{t('¿Querías decir')} “{response.correctedQuery}”?</button>}
            </div>
            <div className="space-y-2">{response.results.map((result) => <article key={result.indexId} className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4 hover:border-teal-900" data-testid="study-search-result">
              <button className="w-full text-left" onClick={() => openResult(result)}><div className="flex flex-wrap items-start gap-2"><span className="rounded bg-teal-950 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-teal-300">{t(KIND_LABELS[result.kind])}</span><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-neutral-200">{result.title}</h3><p className="text-[10px] text-neutral-600">{[result.subtitle, locationLabel(result)].filter(Boolean).join(' · ')}</p></div><span className="text-[10px] tabular-nums text-neutral-700">{Math.round(result.score.fusion * 100)}%</span></div><p className="mt-2 text-xs leading-5 text-neutral-400"><HighlightedSnippet result={result} /></p></button>
              <div className="mt-2 flex items-center gap-2 border-t border-neutral-800/70 pt-2"><span className="text-[9px] text-neutral-700">L {Math.round(result.score.exact * 100)} · T {Math.round(result.score.text * 100)} · S {Math.round(result.score.semantic * 100)} · P {Math.round(result.score.proximity * 100)}</span><button className="ml-auto text-[10px] text-neutral-600 hover:text-red-400" onClick={() => void window.nodus.setStudySearchSourceExcluded(result.sourceId, true).then(() => window.nodus.searchStudyCorpus(query, options)).then(setResponse)}>{t('Excluir del índice')}</button></div>
            </article>)}</div>
            {!response.results.length && <div className="rounded-xl border border-dashed border-neutral-800 p-12 text-center"><Icon name="search" size={28} className="text-neutral-700" /><h2 className="mt-3 text-sm font-medium text-neutral-400">{t('No encontramos resultados')}</h2><p className="mt-1 text-xs text-neutral-600">{t('Prueba otros términos, revisa los filtros o reconstruye el índice.')}</p>{response.suggestions.length > 0 && <div className="mt-3 flex justify-center gap-2">{response.suggestions.map((suggestion) => <button key={suggestion} className="rounded-full border border-neutral-700 px-2 py-1 text-xs text-amber-300" onClick={() => setQuery(suggestion)}>{suggestion}</button>)}</div>}</div>}
          </>}
        </div>
      </main>
      {saveDialog && <TextInputModal title={t('Guardar búsqueda')} label={t('Nombre de la búsqueda')} placeholder={query} submitLabel={t('Guardar')} onCancel={() => setSaveDialog(false)} onSubmit={async (name) => { await window.nodus.saveStudySearch(name, query, options); setSaveDialog(false); await loadMeta(); }} />}
    </div>
  );
}
