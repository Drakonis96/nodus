import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import type { GraphData, IdeaType, IdeaDetail, EdgeDetail, GraphNodeType, WorkView, WorkMeta } from '@shared/types';
import { NODE_COLORS, NODE_LABELS, EDGE_LABELS, Badge, Icon } from '../components/ui';
import { useScanComplete } from '../hooks';

const IDEA_TYPES: IdeaType[] = ['claim', 'finding', 'construct', 'method', 'framework'];
const GRAPH_NODE_TYPES: Exclude<GraphNodeType, 'author'>[] = ['theme', ...IDEA_TYPES];
const EDGE_TYPES = Object.keys(EDGE_LABELS);

// Force-directed layout tuned to keep nodes and their (bottom-aligned) labels from
// overlapping: strong repulsion, generous component spacing so disconnected nodes
// don't pile on top of each other, and enough iterations to settle.
const COSE_LAYOUT = {
  name: 'cose',
  animate: false,
  randomize: true,
  fit: true,
  padding: 60,
  nodeRepulsion: () => 24000,
  nodeOverlap: 32,
  idealEdgeLength: () => 130,
  edgeElasticity: () => 120,
  componentSpacing: 170,
  gravity: 0.2,
  numIter: 1500,
  coolingFactor: 0.95,
  initialTemp: 220,
} as const;

/**
 * Deterministic radial layout: theme hubs sit in a regular polygon at the centre
 * (a circle for 1, a line for 2, a triangle for 3, a square for 4, …) and each
 * theme's ideas bloom outward in rings within its angular sector — a clean "tree".
 * Ideas with no theme go on an outer ring. Returns a positions map, or null when
 * there are no theme nodes (caller falls back to a force layout).
 */
function computeRadialPositions(cy: Core): Record<string, { x: number; y: number }> | null {
  const themeNodes = cy.nodes().filter((n) => n.data('type') === 'theme');
  const N = themeNodes.length;
  if (N === 0) return null;

  const ideaNodes = cy.nodes().filter((n) => n.data('type') !== 'theme');
  const pos: Record<string, { x: number; y: number }> = {};
  const themeAngle: Record<string, number> = {};

  const Rt = N === 1 ? 0 : 160 + N * 18; // central polygon radius grows with theme count
  themeNodes.forEach((t, i) => {
    const ang = ((-90 + (i * 360) / N) * Math.PI) / 180;
    themeAngle[t.id()] = ang;
    pos[t.id()] = { x: Rt * Math.cos(ang), y: Rt * Math.sin(ang) };
  });

  // Which themes contain each idea (theme→idea "contains" edges).
  const ideaThemes: Record<string, string[]> = {};
  cy.edges().forEach((e) => {
    if (e.data('type') !== 'contains') return;
    const src = cy.getElementById(e.data('source'));
    const tgt = cy.getElementById(e.data('target'));
    if (src.nonempty() && src.data('type') === 'theme' && tgt.nonempty() && tgt.data('type') !== 'theme') {
      (ideaThemes[tgt.id()] ??= []).push(src.id());
    }
  });

  const groups: Record<string, string[]> = {};
  themeNodes.forEach((t) => {
    groups[t.id()] = [];
  });
  const orphans: string[] = [];
  ideaNodes.forEach((n) => {
    const ts = (ideaThemes[n.id()] || []).filter((id) => themeAngle[id] !== undefined);
    if (ts.length) groups[ts[0]].push(n.id());
    else orphans.push(n.id());
  });

  const ringStep = 135;
  const baseR = Rt + 165;
  const minSpacing = 135;
  const half = ((N === 1 ? 175 : (360 / N) / 2 * 0.82) * Math.PI) / 180;
  let maxR = baseR;

  for (const [themeId, list] of Object.entries(groups)) {
    const A = themeAngle[themeId];
    let placed = 0;
    let ring = 0;
    while (placed < list.length) {
      const ringR = baseR + ring * ringStep;
      const cap = Math.max(1, Math.floor((2 * half * ringR) / minSpacing));
      const count = Math.min(cap, list.length - placed);
      for (let m = 0; m < count; m++) {
        const frac = count === 1 ? 0.5 : m / (count - 1);
        const ang = A - half + frac * (2 * half);
        pos[list[placed + m]] = { x: ringR * Math.cos(ang), y: ringR * Math.sin(ang) };
      }
      maxR = Math.max(maxR, ringR);
      placed += count;
      ring++;
    }
  }

  if (orphans.length) {
    let placed = 0;
    let ring = 0;
    while (placed < orphans.length) {
      const ringR = maxR + ringStep * (ring + 1);
      const cap = Math.max(1, Math.floor((2 * Math.PI * ringR) / minSpacing));
      const count = Math.min(cap, orphans.length - placed);
      for (let m = 0; m < count; m++) {
        const ang = (m / count) * 2 * Math.PI;
        pos[orphans[placed + m]] = { x: ringR * Math.cos(ang), y: ringR * Math.sin(ang) };
      }
      placed += count;
      ring++;
    }
  }

  return pos;
}

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
  const clearFocusRef = useRef<() => void>(() => {});
  const [lens, setLens] = useState<'ideas' | 'authors'>('ideas');
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [themes, setThemes] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [ideaDetail, setIdeaDetail] = useState<IdeaDetail | null>(null);
  const [edgeDetail, setEdgeDetail] = useState<EdgeDetail | null>(null);

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  }, [filters]);

  const reload = useCallback(() => {
    void window.nodus.getGraph(lens).then(setData);
    void window.nodus.getThemes().then((t) => setThemes(t.map((x) => x.label)));
  }, [lens]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Refresh the graph when scans finish so freshly analysed works appear without
  // having to leave and re-open the view.
  useScanComplete(reload);

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
              color: '#ededed',
              'font-size': (ele: any) => (ele.data('type') === 'theme' ? 12 : 9),
              'font-weight': (ele: any) => (ele.data('type') === 'theme' ? 700 : 400),
              'text-wrap': 'wrap',
              'text-max-width': '92px',
              'text-valign': 'bottom',
              'text-margin-y': 4,
              'min-zoomed-font-size': 5,
              // Dark outline keeps labels legible where they cross edges or other nodes.
              'text-outline-width': 2.5,
              'text-outline-color': '#0a0a0a',
              'text-outline-opacity': 0.9,
              width: 'data(size)',
              height: 'data(size)',
              'border-width': (ele: any) => (ele.data('read') ? 0 : 2),
              'border-color': '#737373',
              'border-style': 'dashed',
              'transition-property': 'opacity, border-width, border-color',
              'transition-duration': '0.2s',
              'transition-timing-function': 'ease-in-out',
            } as any,
          },
          // Theme hubs get a soft solid halo so the centre reads as the backbone.
          {
            selector: 'node[type="theme"]',
            style: { 'border-width': 3, 'border-color': '#f9b069', 'border-style': 'solid', 'border-opacity': 0.5 } as any,
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
              'transition-property': 'opacity, line-color, width',
              'transition-duration': '0.2s',
              'transition-timing-function': 'ease-in-out',
            } as any,
          },
          // Theme→idea "contains" links are structural branches: faint, solid, no arrow.
          {
            selector: 'edge[type="contains"]',
            style: {
              'line-style': 'solid',
              'line-color': '#3f3f46',
              width: 1.2,
              opacity: 0.22,
              'target-arrow-shape': 'none',
            } as any,
          },
          { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#818cf8', 'border-style': 'solid', 'border-opacity': 1 } as any },
          // Focus mode: everything not in the tapped node's neighbourhood fades back.
          { selector: '.faded', style: { opacity: 0.08, 'text-opacity': 0.05 } as any },
          { selector: 'node.spotlight', style: { 'border-width': 4, 'border-color': '#818cf8', 'border-style': 'solid', 'border-opacity': 1 } as any },
        ],
        layout: COSE_LAYOUT as any,
      });

      const focusOn = (eles: any) => {
        const cy = cyRef.current!;
        const keep = eles.closedNeighborhood ? eles.closedNeighborhood() : eles.connectedNodes().add(eles);
        cy.batch(() => {
          cy.elements().addClass('faded');
          keep.removeClass('faded');
          cy.nodes().removeClass('spotlight');
          eles.nodes && eles.nodes().addClass('spotlight');
        });
      };
      const clearFocus = () => {
        cyRef.current?.batch(() => {
          cyRef.current!.elements().removeClass('faded');
          cyRef.current!.nodes().removeClass('spotlight');
        });
      };
      clearFocusRef.current = clearFocus;

      cyRef.current.on('tap', 'node', async (evt) => {
        const node = evt.target;
        focusOn(node);
        setEdgeDetail(null);
        if (lens === 'ideas' && !node.id().startsWith('theme:')) {
          setIdeaDetail(await window.nodus.getIdeaDetail(node.id()));
        } else {
          setIdeaDetail(null);
        }
      });
      cyRef.current.on('tap', 'edge', async (evt) => {
        const edge = evt.target;
        cyRef.current?.batch(() => {
          cyRef.current!.elements().addClass('faded');
          edge.connectedNodes().add(edge).removeClass('faded');
          cyRef.current!.nodes().removeClass('spotlight');
        });
        setIdeaDetail(null);
        setEdgeDetail(await window.nodus.getEdgeDetail(edge.id()));
      });
      cyRef.current.on('tap', (evt) => {
        if (evt.target === cyRef.current) {
          clearFocus();
          setIdeaDetail(null);
          setEdgeDetail(null);
        }
      });
    }
    const cy = cyRef.current;
    cy.elements().remove();
    cy.add(elements);
    // Always frame the whole graph after laying out, so it neither overflows the
    // viewport nor sits as a tiny clump regardless of how cose spread the nodes.
    cy.one('layoutstop', () => cy.fit(undefined, 60));
    // Ideas lens with theme hubs → deterministic radial tree (themes centred in a
    // polygon, ideas blooming outward). Otherwise (authors, or no themes) → force.
    const positions = lens === 'ideas' ? computeRadialPositions(cy) : null;
    if (positions) {
      cy.layout({
        name: 'preset',
        positions,
        fit: true,
        padding: 60,
        animate: true,
        animationDuration: 600,
        animationEasing: 'ease-in-out-cubic',
      } as any).run();
    } else {
      cy.layout(COSE_LAYOUT as any).run();
    }
  }, [elements, lens]);

  // Keep the graph framed when the window or panels resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (!cy || cy.elements().length === 0) return;
      cy.resize();
      cy.fit(undefined, 48);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };
  const fitGraph = () => cyRef.current?.fit(undefined, 48);

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

        {/* Zoom / fit controls */}
        <div className="absolute top-3 right-3 flex flex-col gap-1">
          <button className="card bg-neutral-900/90 p-1.5 hover:bg-neutral-800" title="Acercar" onClick={() => zoomBy(1.25)}>
            <Icon name="plus" size={16} />
          </button>
          <button className="card bg-neutral-900/90 p-1.5 hover:bg-neutral-800" title="Alejar" onClick={() => zoomBy(0.8)}>
            <Icon name="minus" size={16} />
          </button>
          <button className="card bg-neutral-900/90 p-1.5 hover:bg-neutral-800" title="Ajustar a la pantalla" onClick={fitGraph}>
            <Icon name="fit" size={16} />
          </button>
        </div>

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
              clearFocusRef.current();
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
                  <button
                    className="inline-flex items-center gap-1 text-indigo-400 text-xs shrink-0"
                    onClick={() => window.nodus.openInZotero(o.work.zotero_key)}
                  >
                    <Icon name="external" size={12} /> Zotero
                  </button>
                </div>
                <OccurrenceMeta work={o.work} />
                <div className="text-[11px] text-neutral-500 mt-1">
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

const ITEM_TYPE_ES: Record<string, string> = {
  journalArticle: 'artículo de revista',
  magazineArticle: 'artículo de revista',
  newspaperArticle: 'artículo de periódico',
  bookSection: 'capítulo de libro',
  book: 'libro',
  conferencePaper: 'ponencia',
  thesis: 'tesis',
  report: 'informe',
  preprint: 'preprint',
  manuscript: 'manuscrito',
  webpage: 'página web',
  document: 'documento',
  encyclopediaArticle: 'entrada de enciclopedia',
};

function itemTypeEs(t?: string | null): string | null {
  return t ? ITEM_TYPE_ES[t] ?? t : null;
}

/** Bibliographic detail for one occurrence — authors, venue, pages — read live from Zotero. */
function OccurrenceMeta({ work }: { work: WorkView }) {
  const [meta, setMeta] = useState<WorkMeta | null>(null);
  useEffect(() => {
    let on = true;
    void window.nodus.getWorkMeta(work.nodus_id).then((m) => {
      if (on) setMeta(m);
    });
    return () => {
      on = false;
    };
  }, [work.nodus_id]);

  const authors = meta?.authors?.length ? meta.authors : work.authors;
  const type = itemTypeEs(meta?.itemType ?? work.item_type);
  const year = work.year ?? meta?.year ?? null;
  const venue: string[] = [];
  if (meta?.container) venue.push(meta.container);
  if (meta?.publisher) venue.push(meta.publisher);
  if (meta?.volume) venue.push(`vol. ${meta.volume}${meta.issue ? `(${meta.issue})` : ''}`);
  else if (meta?.issue) venue.push(`n.º ${meta.issue}`);
  if (meta?.pages) venue.push(`pp. ${meta.pages}`);
  else if (meta?.numPages) venue.push(`${meta.numPages} pp.`);
  if (meta?.place) venue.push(meta.place);

  return (
    <div className="text-[11px] text-neutral-500 mt-1 space-y-0.5">
      {authors.length > 0 && (
        <div className="text-neutral-400">
          {authors.slice(0, 4).join('; ')}
          {authors.length > 4 ? ' et al.' : ''}
        </div>
      )}
      {(type || year) && <div>{[type, year].filter(Boolean).join(' · ')}</div>}
      {venue.length > 0 && <div className="text-neutral-400">{venue.join(' · ')}</div>}
      {meta?.doi && <div className="font-mono truncate">doi:{meta.doi}</div>}
    </div>
  );
}
