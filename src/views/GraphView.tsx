import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import type { GraphData, IdeaType, IdeaDetail, EdgeDetail, GraphNodeType } from '@shared/types';
import { NODE_COLORS, NODE_LABELS, EDGE_LABELS, Badge } from '../components/ui';

const IDEA_TYPES: IdeaType[] = ['claim', 'finding', 'construct', 'method', 'framework'];
const GRAPH_NODE_TYPES: Exclude<GraphNodeType, 'author'>[] = ['theme', ...IDEA_TYPES];
const EDGE_TYPES = Object.keys(EDGE_LABELS);

interface Filters {
  search: string;
  nodeTypes: string[];
  edgeTypes: string[];
  theme: string;
  authors: string[];
  yearMin: number | null;
  yearMax: number | null;
  readState: 'all' | 'read' | 'unread';
  minConfidence: number;
  basis: 'all' | 'explicit';
}

const DEFAULT_FILTERS: Filters = {
  search: '',
  nodeTypes: [...GRAPH_NODE_TYPES],
  edgeTypes: [...EDGE_TYPES],
  theme: '',
  authors: [],
  yearMin: null,
  yearMax: null,
  readState: 'all',
  minConfidence: 0,
  basis: 'all',
};

const FILTER_KEY = 'nodus.graph.filters';

function loadFilters(): Filters {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') as Partial<Filters>;
    const merged = { ...DEFAULT_FILTERS, ...parsed };
    merged.nodeTypes = Array.from(new Set([...(merged.nodeTypes ?? []), 'theme']));
    merged.edgeTypes = Array.from(new Set([...(merged.edgeTypes ?? []), 'contains']));
    return merged;
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [lens, setLens] = useState<'ideas' | 'authors'>('ideas');
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [themes, setThemes] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [ideaDetail, setIdeaDetail] = useState<IdeaDetail | null>(null);
  const [edgeDetail, setEdgeDetail] = useState<EdgeDetail | null>(null);

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    void window.nodus.getGraph(lens).then(setData);
    void window.nodus.getThemes().then((t) => setThemes(t.map((x) => x.label)));
  }, [lens]);

  const allAuthors = useMemo(() => {
    const set = new Set<string>();
    for (const n of data.nodes) for (const a of n.authors) set.add(a);
    return Array.from(set).sort();
  }, [data]);

  const elements = useMemo<ElementDefinition[]>(() => {
    const f = filters;
    const q = f.search.toLowerCase();
    const visibleNodes = data.nodes.filter((n) => {
      if (lens === 'ideas' && !f.nodeTypes.includes(n.type)) return false;
      if (f.theme && !n.themes.includes(f.theme)) return false;
      if (f.readState === 'read' && !n.read) return false;
      if (f.readState === 'unread' && n.read) return false;
      if (f.minConfidence > 0 && n.maxConfidence < f.minConfidence) return false;
      if (f.authors.length && !n.authors.some((a) => f.authors.includes(a))) return false;
      if (f.yearMin != null && !n.years.some((y) => y >= f.yearMin!)) return false;
      if (f.yearMax != null && !n.years.some((y) => y <= f.yearMax!)) return false;
      if (q && !(n.label.toLowerCase().includes(q) || (n.statement ?? '').toLowerCase().includes(q) || n.authors.some((a) => a.toLowerCase().includes(q)))) {
        return false;
      }
      return true;
    });
    const nodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = data.edges.filter((e) => {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return false;
      if (lens === 'ideas' && !f.edgeTypes.includes(e.type)) return false;
      if (f.minConfidence > 0 && e.confidence < f.minConfidence) return false;
      if (f.basis === 'explicit' && e.basis !== 'explicit') return false;
      return true;
    });
    return [
      ...visibleNodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label,
          type: n.type,
          size: n.type === 'theme' ? 38 + Math.min(56, n.workCount * 10) : 18 + Math.min(40, n.workCount * 6),
          read: n.read,
        },
      })),
      ...visibleEdges.map((e) => ({
        data: { id: e.id, source: e.source, target: e.target, type: e.type, basis: e.basis, confidence: e.confidence },
      })),
    ];
  }, [data, filters, lens]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!cyRef.current) {
      cyRef.current = cytoscape({
        container: containerRef.current,
        elements: [],
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (ele: any) =>
                ele.data('type') === 'author' ? '#a3a3a3' : NODE_COLORS[ele.data('type') as Exclude<GraphNodeType, 'author'>] ?? '#888',
              label: 'data(label)',
              color: '#e5e5e5',
              'font-size': 9,
              'text-wrap': 'wrap',
              'text-max-width': '90px',
              'text-valign': 'bottom',
              width: 'data(size)',
              height: 'data(size)',
              'border-width': (ele: any) => (ele.data('read') ? 0 : 2),
              'border-color': '#737373',
              'border-style': 'dashed',
            },
          },
          {
            selector: 'edge',
            style: {
              width: (ele: any) => 1 + ele.data('confidence') * 2,
              'line-color': (ele: any) => (ele.data('type') === 'contradicts' || ele.data('type') === 'refutes' ? '#ef4444' : '#525252'),
              'line-style': (ele: any) => (ele.data('basis') === 'inferred' ? 'dashed' : 'solid'),
              opacity: (ele: any) => 0.3 + ele.data('confidence') * 0.6,
              'target-arrow-shape': 'triangle',
              'target-arrow-color': (ele: any) => (ele.data('type') === 'contradicts' ? '#ef4444' : '#525252'),
              'curve-style': 'bezier',
            },
          },
          { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#818cf8', 'border-style': 'solid' } },
        ],
        layout: { name: 'cose', animate: false },
      });

      cyRef.current.on('tap', 'node', async (evt) => {
        setIdeaDetail(null);
        setEdgeDetail(null);
        if (lens === 'ideas' && !evt.target.id().startsWith('theme:')) {
          setIdeaDetail(await window.nodus.getIdeaDetail(evt.target.id()));
        }
      });
      cyRef.current.on('dbltap', 'node', (evt) => {
        const neighborhood = evt.target.closedNeighborhood();
        cyRef.current?.elements().not(neighborhood).style('opacity', 0.08);
        neighborhood.style('opacity', 1);
      });
      cyRef.current.on('tap', 'edge', async (evt) => {
        setIdeaDetail(null);
        setEdgeDetail(await window.nodus.getEdgeDetail(evt.target.id()));
      });
      cyRef.current.on('tap', (evt) => {
        if (evt.target === cyRef.current) cyRef.current?.elements().style('opacity', '');
      });
    }
    const cy = cyRef.current;
    cy.elements().remove();
    cy.add(elements);
    cy.layout({ name: 'cose', animate: false, nodeRepulsion: () => 8000 } as any).run();
  }, [elements, lens]);

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleIn = (key: 'nodeTypes' | 'edgeTypes' | 'authors', val: string) =>
    setFilters((f) => {
      const arr = f[key];
      return { ...f, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
    });

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Filter bar */}
      <div className="border-b border-neutral-800 p-2 flex flex-wrap gap-2 items-center text-xs">
        <div className="flex rounded-lg overflow-hidden border border-neutral-700">
          <button className={`px-3 py-1 ${lens === 'ideas' ? 'bg-indigo-600 text-white' : ''}`} onClick={() => setLens('ideas')}>
            Ideas
          </button>
          <button className={`px-3 py-1 ${lens === 'authors' ? 'bg-indigo-600 text-white' : ''}`} onClick={() => setLens('authors')}>
            Autores
          </button>
        </div>
        <input className="input" placeholder="Buscar…" value={filters.search} onChange={(e) => setF({ search: e.target.value })} />
        {lens === 'ideas' && (
          <div className="flex gap-1">
            {GRAPH_NODE_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => toggleIn('nodeTypes', t)}
                className="px-2 py-0.5 rounded flex items-center gap-1"
                style={{
                  backgroundColor: filters.nodeTypes.includes(t) ? NODE_COLORS[t] : '#262626',
                  color: filters.nodeTypes.includes(t) ? 'white' : '#a3a3a3',
                }}
              >
                {NODE_LABELS[t]}
              </button>
            ))}
          </div>
        )}
        <select className="input" value={filters.theme} onChange={(e) => setF({ theme: e.target.value })}>
          <option value="">Todos los temas</option>
          {themes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className="input" value={filters.readState} onChange={(e) => setF({ readState: e.target.value as any })}>
          <option value="all">Leído + no leído</option>
          <option value="read">Solo leído (profundo)</option>
          <option value="unread">Solo no leído</option>
        </select>
        <select className="input" value={filters.basis} onChange={(e) => setF({ basis: e.target.value as any })}>
          <option value="all">Explícito + inferido</option>
          <option value="explicit">Solo explícito</option>
        </select>
        <label className="flex items-center gap-1 text-neutral-400">
          conf ≥ {filters.minConfidence.toFixed(1)}
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={filters.minConfidence}
            onChange={(e) => setF({ minConfidence: parseFloat(e.target.value) })}
          />
        </label>
        <input className="input w-16" placeholder="año≥" onChange={(e) => setF({ yearMin: e.target.value ? +e.target.value : null })} />
        <input className="input w-16" placeholder="año≤" onChange={(e) => setF({ yearMax: e.target.value ? +e.target.value : null })} />
        <button className="btn btn-ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
          Limpiar filtros
        </button>
        <div className="flex-1" />
        <span className="text-neutral-500">{elements.filter((e) => !(e.data as any).source).length} nodos</span>
      </div>

      <div className="flex-1 flex min-h-0 relative">
        <div ref={containerRef} className="flex-1 min-w-0" />

        {/* Legend */}
        <div className="absolute bottom-3 left-3 card p-2 text-[10px] space-y-1 bg-neutral-900/90">
          {GRAPH_NODE_TYPES.map((t) => (
            <div key={t} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: NODE_COLORS[t] }} />
              {NODE_LABELS[t]}
            </div>
          ))}
          <div className="pt-1 border-t border-neutral-800 text-neutral-500">— sólida: explícita · ·· punteada: inferida</div>
          <div className="text-neutral-500">○ borde punteado: no leída</div>
        </div>

        {/* Detail panel */}
        {(ideaDetail || edgeDetail) && (
          <DetailPanel
            ideaDetail={ideaDetail}
            edgeDetail={edgeDetail}
            onClose={() => {
              setIdeaDetail(null);
              setEdgeDetail(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function DetailPanel({
  ideaDetail,
  edgeDetail,
  onClose,
}: {
  ideaDetail: IdeaDetail | null;
  edgeDetail: EdgeDetail | null;
  onClose: () => void;
}) {
  return (
    <div className="w-96 border-l border-neutral-800 bg-neutral-900/95 overflow-y-auto p-4 text-sm">
      <button className="float-right text-neutral-500 hover:text-white" onClick={onClose}>
        ✕
      </button>
      {ideaDetail && (
        <div className="space-y-3">
          <div>
            <Badge color="indigo">{NODE_LABELS[ideaDetail.idea.type as IdeaType] ?? ideaDetail.idea.type}</Badge>
            <h3 className="font-semibold mt-2">{ideaDetail.idea.label}</h3>
            <p className="text-neutral-400 mt-1">{ideaDetail.idea.statement}</p>
          </div>
          <div>
            <div className="text-xs uppercase text-neutral-500 mb-1">Obras que la desarrollan</div>
            {ideaDetail.occurrences.map((o) => (
              <div key={o.nodus_id} className="card p-2 mb-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="font-medium text-xs">{o.work.title}</div>
                  <button className="text-indigo-400 text-xs" onClick={() => window.nodus.openInZotero(o.work.zotero_key)}>
                    Zotero
                  </button>
                </div>
                <div className="text-xs text-neutral-500">
                  {o.role} · conf {o.confidence.toFixed(2)}
                </div>
                <p className="text-xs text-neutral-400 mt-1">{o.development}</p>
              </div>
            ))}
          </div>
          {ideaDetail.evidence.length > 0 && (
            <div>
              <div className="text-xs uppercase text-neutral-500 mb-1">Evidencia anclada</div>
              {ideaDetail.evidence.map((ev) => (
                <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-2 my-1 text-xs text-neutral-300 italic">
                  “{ev.quote}” <span className="text-neutral-500 not-italic">{ev.location ?? ''} · {ev.kind}</span>
                </blockquote>
              ))}
            </div>
          )}
        </div>
      )}
      {edgeDetail && (
        <div className="space-y-3">
          <h3 className="font-semibold">
            {EDGE_LABELS[edgeDetail.edge.type as keyof typeof EDGE_LABELS] ?? edgeDetail.edge.type}
          </h3>
          <div className="text-neutral-400">
            <span className="text-neutral-200">{edgeDetail.fromLabel}</span> → <span className="text-neutral-200">{edgeDetail.toLabel}</span>
          </div>
          <div className="flex gap-2">
            <Badge color={edgeDetail.edge.basis === 'explicit' ? 'green' : 'amber'}>{edgeDetail.edge.basis}</Badge>
            <Badge>conf {edgeDetail.edge.confidence.toFixed(2)}</Badge>
          </div>
          {edgeDetail.evidence.map((ev) => (
            <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-2 my-1 text-xs text-neutral-300 italic">
              “{ev.quote}” <span className="text-neutral-500">{ev.location ?? ''}</span>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}
