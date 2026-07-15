import { useEffect, useMemo, useState } from 'react';
import type { StudyIdeaDetail, StudyKnowledgeGraph, StudyWorkspace } from '@shared/types';
import { Icon, Spinner } from '../components/ui';
import { t } from '../i18n';

const SUBJECT_KEY = 'nodus.studyKnowledgeSubjectId';
const EMPTY_GRAPH: StudyKnowledgeGraph = { subjectId: '', nodes: [], edges: [] };

export function StudyGraphView({ onOpenIdeas }: { onOpenIdeas: () => void }) {
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [subjectId, setSubjectId] = useState(() => localStorage.getItem(SUBJECT_KEY) ?? '');
  const [graph, setGraph] = useState<StudyKnowledgeGraph>(EMPTY_GRAPH);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudyIdeaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void window.nodus.getStudyWorkspace().then(setWorkspace); }, []);
  useEffect(() => { if (workspace?.subjects.length && !workspace.subjects.some((item) => item.id === subjectId)) setSubjectId(workspace.subjects[0].id); }, [workspace, subjectId]);
  useEffect(() => { if (subjectId) localStorage.setItem(SUBJECT_KEY, subjectId); }, [subjectId]);
  const load = async () => { if (!subjectId) { setGraph(EMPTY_GRAPH); setLoading(false); return; } setLoading(true); setGraph(await window.nodus.getStudyKnowledgeGraph(subjectId)); setLoading(false); };
  useEffect(() => { void load(); }, [subjectId]);
  useEffect(() => window.nodus.onStudyKnowledgeChanged(() => void load()), [subjectId]);
  useEffect(() => { if (selectedId) void window.nodus.getStudyIdeaDetail(selectedId).then(setDetail); else setDetail(null); }, [selectedId, graph]);
  const layout = useMemo(() => circularLayout(graph), [graph]);
  return <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="study-graph-view">
    <header className="flex flex-wrap items-end gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
      <div className="mr-auto"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-teal-600 dark:text-teal-400">{t('Conocimiento por asignatura')}</p><h1 className="mt-1 text-2xl font-semibold">{t('Grafo')}</h1></div>
      <label className="text-xs text-neutral-600 dark:text-neutral-400">{t('Asignatura')}<select data-testid="study-graph-subject" className="input ml-2 min-w-56" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setSelectedId(null); }}>
        {(workspace?.subjects ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="btn btn-secondary" onClick={onOpenIdeas}><Icon name="bulb" />{t('Ver ideas')}</button>
    </header>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
      <main className="relative min-h-0 overflow-hidden bg-neutral-50 dark:bg-neutral-950">
        {loading ? <div className="flex h-full items-center justify-center"><Spinner label={t('Construyendo grafo…')} /></div> : !graph.nodes.length ? <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">{t('Todavía no hay conexiones. Analiza materiales de una asignatura para construir el grafo.')}</div> :
          <svg className="h-full w-full" viewBox="0 0 1000 720" role="img" aria-label={t('Grafo de ideas de la asignatura')}>
            <g>{graph.edges.map((edge) => { const source = layout.get(edge.source); const target = layout.get(edge.target); if (!source || !target) return null; return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="stroke-neutral-300 dark:stroke-neutral-700" strokeWidth={Math.max(1, edge.confidence * 3)} opacity={0.75} />; })}</g>
            <g>{graph.nodes.map((node) => { const point = layout.get(node.id)!; const active = selectedId === node.id; const radius = Math.min(36, 18 + node.evidenceCount * 1.8 + node.connectionCount); return <g key={node.id} data-testid="study-graph-node" className="cursor-pointer" onClick={() => setSelectedId(node.id)} tabIndex={0} role="button" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedId(node.id); }}>
              <circle cx={point.x} cy={point.y} r={radius} className={active ? 'fill-indigo-200 stroke-indigo-600 dark:fill-indigo-900 dark:stroke-indigo-300' : 'fill-white stroke-teal-500 dark:fill-neutral-900 dark:stroke-teal-400'} strokeWidth={active ? 4 : 2} />
              <text x={point.x} y={point.y + radius + 16} textAnchor="middle" className="fill-neutral-700 text-[12px] font-medium dark:fill-neutral-200">{clip(node.label, 28)}</text>
            </g>; })}</g>
          </svg>}
        <div className="absolute bottom-3 left-3 rounded-lg border border-neutral-200 bg-white/90 px-3 py-2 text-[10px] text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/90">{graph.nodes.length} {t('ideas')} · {graph.edges.length} {t('conexiones')}</div>
      </main>
      <aside className="min-h-0 overflow-y-auto border-l border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        {detail ? <><span className="text-[10px] uppercase tracking-wider text-teal-600 dark:text-teal-400">{detail.type}</span><h2 className="mt-2 text-xl font-semibold">{detail.label}</h2><p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-400">{detail.statement}</p>
          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Conexiones')}</h3><div className="mt-2 space-y-2">{detail.connections.map((edge) => <button key={edge.id} className="w-full rounded-lg border border-neutral-200 p-3 text-left dark:border-neutral-800" onClick={() => edge.otherId && setSelectedId(edge.otherId)}><b className="text-sm">{edge.otherLabel}</b><span className="ml-2 text-[10px] text-teal-600 dark:text-teal-400">{edge.type}</span><p className="mt-1 text-xs text-neutral-500">{edge.basis}</p></button>)}</div></> : <div className="flex h-full items-center justify-center text-center text-sm text-neutral-500">{t('Selecciona un nodo para explorar sus evidencias y conexiones.')}</div>}
      </aside>
    </div>
  </div>;
}

function circularLayout(graph: StudyKnowledgeGraph): Map<string, { x: number; y: number }> {
  const sorted = [...graph.nodes].sort((a, b) => b.connectionCount - a.connectionCount || a.label.localeCompare(b.label)); const result = new Map<string, { x: number; y: number }>();
  sorted.forEach((node, index) => { const ring = index < 1 ? 0 : index < 9 ? 1 : 2 + Math.floor((index - 9) / 18); const within = ring === 0 ? 0 : ring === 1 ? index - 1 : (index - 9) % 18; const count = ring === 0 ? 1 : ring === 1 ? Math.min(8, sorted.length - 1) : Math.min(18, sorted.length - 9 - (ring - 2) * 18); const angle = count ? within / count * Math.PI * 2 - Math.PI / 2 : 0; const radius = ring === 0 ? 0 : 150 + (ring - 1) * 125; result.set(node.id, { x: 500 + Math.cos(angle) * radius, y: 350 + Math.sin(angle) * radius }); });
  return result;
}
function clip(value: string, max: number) { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
