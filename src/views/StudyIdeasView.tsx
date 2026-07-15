import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudyIdeaDetail, StudyIdeaSummary, StudyKnowledgeJob, StudyWorkspace } from '@shared/types';
import { Badge, Icon, Spinner } from '../components/ui';
import { DETAIL_MAX_WIDTH, DETAIL_MIN_WIDTH, loadNumber } from '../components/NodeDetailPanel';
import { VirtualList } from '../components/VirtualList';
import { t, tx } from '../i18n';

const SUBJECT_KEY = 'nodus.studyKnowledgeSubjectId';
const DETAIL_WIDTH_KEY = 'nodus.studyIdeas.detailWidth';
const DETAIL_DEFAULT_WIDTH = 420;
const IDEA_ROW_HEIGHT = 116;
const TYPE_LABEL: Record<string, string> = {
  concept: 'Concepto', definition: 'Definición', principle: 'Principio', process: 'Proceso', cause: 'Causa',
  consequence: 'Consecuencia', example: 'Ejemplo', debate: 'Debate',
};
const IDEA_TYPES = Object.keys(TYPE_LABEL);
type SortKey = 'label' | 'type' | 'sources' | 'connections' | 'evidence';

export function StudyIdeasView({ onOpenGraph }: { onOpenGraph: () => void }) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [subjectId, setSubjectId] = useState(() => localStorage.getItem(SUBJECT_KEY) ?? '');
  const [ideas, setIdeas] = useState<StudyIdeaSummary[]>([]);
  const [jobs, setJobs] = useState<StudyKnowledgeJob[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('label');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudyIdeaDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailWidth, setDetailWidth] = useState(() => loadNumber(
    DETAIL_WIDTH_KEY, DETAIL_DEFAULT_WIDTH, DETAIL_MIN_WIDTH, DETAIL_MAX_WIDTH,
  ));

  useEffect(() => { void window.nodus.getStudyWorkspace().then(setWorkspace); }, []);
  useEffect(() => {
    if (!workspace?.subjects.length) return;
    if (!workspace.subjects.some((subject) => subject.id === subjectId)) setSubjectId(workspace.subjects[0].id);
  }, [workspace, subjectId]);
  useEffect(() => { if (subjectId) localStorage.setItem(SUBJECT_KEY, subjectId); }, [subjectId]);

  const load = useCallback(async () => {
    if (!subjectId) { setIdeas([]); setJobs([]); setLoading(false); return; }
    setLoading(true);
    const [nextIdeas, nextJobs] = await Promise.all([
      window.nodus.listStudyIdeas(subjectId, query),
      window.nodus.listStudyKnowledgeJobs(subjectId),
    ]);
    setIdeas(nextIdeas); setJobs(nextJobs); setLoading(false);
  }, [subjectId, query]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 120); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => window.nodus.onStudyKnowledgeChanged(() => void load()), [load]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailLoading(false); return; }
    let active = true;
    setDetail(null); setDetailLoading(true);
    void window.nodus.getStudyIdeaDetail(selectedId).then((next) => {
      if (active) { setDetail(next); setDetailLoading(false); }
    });
    return () => { active = false; };
  }, [selectedId, ideas]);

  const subject = workspace?.subjects.find((item) => item.id === subjectId);
  const filtered = useMemo(() => ideas
    .filter((idea) => !typeFilter || idea.type === typeFilter)
    .sort((a, b) => {
      if (sortKey === 'type') return a.type.localeCompare(b.type) || a.label.localeCompare(b.label, 'es');
      if (sortKey === 'sources') return b.sourceCount - a.sourceCount || a.label.localeCompare(b.label, 'es');
      if (sortKey === 'connections') return b.connectionCount - a.connectionCount || a.label.localeCompare(b.label, 'es');
      if (sortKey === 'evidence') return b.evidenceCount - a.evidenceCount || a.label.localeCompare(b.label, 'es');
      return a.label.localeCompare(b.label, 'es');
    }), [ideas, sortKey, typeFilter]);
  const running = jobs.some((job) => job.status === 'analyzing' || job.status === 'relating');

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = detailWidth;
    const onMove = (nextEvent: PointerEvent) => setDetailWidth(Math.min(
      DETAIL_MAX_WIDTH, Math.max(DETAIL_MIN_WIDTH, startWidth + startX - nextEvent.clientX),
    ));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDetailWidth((width) => { localStorage.setItem(DETAIL_WIDTH_KEY, String(width)); return width; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }, [detailWidth]);

  return <div className="flex h-full min-h-0 bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="study-ideas-view">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="px-6 pb-4 pt-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Icon name="bulb" size={22} className="text-teal-600 dark:text-teal-300" />
          <h1 className="text-xl font-semibold">{t('Ideas')}</h1>
          <span className="text-sm text-neutral-500">{tx('{n} ideas extraídas', { n: ideas.length })}</span>
          {subject && <Badge color="green">{subject.name}</Badge>}
          <button className="btn btn-ghost ml-auto border border-neutral-300 text-xs dark:border-neutral-700" onClick={onOpenGraph}><Icon name="layers" size={13} />{t('Abrir grafo')}</button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-60"><Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={13} /><input className="input input-with-leading-icon w-full text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar ideas…')} /></div>
          <select data-testid="study-ideas-subject" className="input min-w-48 text-sm" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setSelectedId(null); }} aria-label={t('Asignatura')}>
            {(workspace?.subjects ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className="input text-sm" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label={t('Todos los tipos')}>
            <option value="">{t('Todos los tipos')}</option>
            {IDEA_TYPES.map((type) => <option key={type} value={type}>{t(TYPE_LABEL[type])}</option>)}
          </select>
          <select className="input text-sm" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="label">{t('Ordenar: nombre')}</option>
            <option value="type">{t('Ordenar: tipo')}</option>
            <option value="sources">{t('Ordenar: fuentes')}</option>
            <option value="connections">{t('Ordenar: conexiones')}</option>
            <option value="evidence">{t('Ordenar: evidencias')}</option>
          </select>
        </div>
      </header>

      {!workspace?.subjects.length ? <Empty text={t('Crea una asignatura y añade materiales para construir su mapa de ideas.')} /> : loading ? <div className="px-6"><Spinner label={t('Cargando ideas…')} /></div> : <VirtualList
        items={filtered}
        itemHeight={IDEA_ROW_HEIGHT}
        getKey={(idea) => idea.id}
        className="min-h-0 flex-1 px-6 pb-6"
        empty={<div className="text-sm text-neutral-500">{running ? t('La IA está construyendo las ideas de esta asignatura…') : ideas.length ? t('Sin resultados para los filtros actuales.') : t('Todavía no hay ideas. Añade material o vuelve a analizar una fuente.')}</div>}
        renderItem={(idea) => <button key={idea.id} data-testid="study-idea-card" onClick={() => setSelectedId(idea.id)} className={`card h-[104px] w-full p-3 text-left transition-colors ${selectedId === idea.id ? 'border-teal-500 bg-teal-50 ring-1 ring-teal-500 dark:bg-neutral-800/80' : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40 dark:hover:bg-neutral-800/50'}`}>
          <div className="flex items-start gap-2">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-teal-500" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{idea.label}</span><Badge color="indigo">{t(TYPE_LABEL[idea.type] ?? idea.type)}</Badge></div>
              <p className="mt-1 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">{idea.statement}</p>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-neutral-500"><span>{tx('{n} fuente(s)', { n: idea.sourceCount })}</span><span>{tx('{n} evidencia(s)', { n: idea.evidenceCount })}</span><span>{tx('{n} conexión(es)', { n: idea.connectionCount })}</span></div>
            </div>
          </div>
        </button>}
      />}
    </div>

    {selectedId && <aside className="relative shrink-0 overflow-y-auto border-l border-neutral-200 bg-neutral-50/95 p-4 dark:border-neutral-800 dark:bg-neutral-900/95" style={{ width: detailWidth }}>
      <div className="absolute left-0 top-0 z-10 h-full w-2 -translate-x-1/2 cursor-col-resize hover:bg-teal-500/25" role="separator" aria-orientation="vertical" title={t('Ajustar ancho')} onPointerDown={startResize} />
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">{t('Detalle')}</h2><button className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white" onClick={() => setSelectedId(null)} aria-label={t('Cerrar')}>✕</button></div>
      {detailLoading && <div className="animate-pulse space-y-3"><div className="h-3 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" /><div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-800" /><div className="h-3 w-5/6 rounded bg-neutral-200 dark:bg-neutral-800" /></div>}
      {detail && <IdeaDetail detail={detail} onOpenGraph={onOpenGraph} onSelect={setSelectedId} onReanalyze={async (kind, id) => { await window.nodus.reanalyzeStudyKnowledgeSource(kind, id); }} />}
    </aside>}
  </div>;
}

function IdeaDetail({ detail, onOpenGraph, onSelect, onReanalyze }: {
  detail: StudyIdeaDetail;
  onOpenGraph: () => void;
  onSelect: (id: string) => void;
  onReanalyze: (kind: 'material' | 'document', id: string) => Promise<void>;
}) {
  return <article className="space-y-4" data-testid="study-idea-detail">
    <div><Badge color="indigo">{t(TYPE_LABEL[detail.type] ?? detail.type)}</Badge><h3 className="mt-2 font-semibold">{detail.label}</h3><p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{detail.statement}</p><button className="btn btn-ghost mt-3 border border-neutral-300 text-xs dark:border-neutral-700" onClick={onOpenGraph}><Icon name="layers" size={13} />{t('Grafo')}</button></div>
    {detail.evidence.length > 0 && <section><h4 className="mb-1 text-xs uppercase text-neutral-500">{t('Evidencia anclada')}</h4>{detail.evidence.map((item) => <blockquote key={item.id} className="my-2 rounded-r-md border-l-2 border-teal-600 bg-white/60 py-2 pl-3 text-xs italic text-neutral-700 dark:bg-neutral-950/35 dark:text-neutral-300">“{item.quote}”<footer className="mt-1 not-italic text-neutral-500"><span>{item.sourceTitle}{item.location ? ` · ${item.location}` : ''}</span><button className="ml-2 text-teal-700 hover:underline dark:text-teal-400" onClick={() => void onReanalyze(item.sourceKind, item.sourceId)}>{t('Reanalizar')}</button></footer></blockquote>)}</section>}
    {detail.connections.length > 0 && <section><h4 className="mb-1 text-xs uppercase text-neutral-500">{tx('Ideas conectadas ({n})', { n: detail.connections.length })}</h4><div className="space-y-1.5">{detail.connections.map((edge) => <button key={edge.id} className="card w-full p-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800/60" onClick={() => edge.otherId && onSelect(edge.otherId)} disabled={!edge.otherId}><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-teal-500" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{edge.otherLabel}</span><Icon name="chevronRight" size={13} className="text-neutral-500" /></div><div className="mt-1 flex items-center gap-2"><Badge color={edge.type === 'supports' ? 'green' : edge.type === 'contrasts' ? 'amber' : 'indigo'}>{edge.type}</Badge><span className="text-[11px] text-neutral-500">{t('conf')} {edge.confidence.toFixed(2)}</span></div>{edge.basis && <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{edge.basis}</p>}</button>)}</div></section>}
  </article>;
}

function Empty({ text }: { text: string }) { return <div className="flex h-full min-h-52 items-center justify-center p-8 text-center text-sm text-neutral-500">{text}</div>; }
