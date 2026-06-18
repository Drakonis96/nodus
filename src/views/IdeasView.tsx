import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GraphData, GraphEdge, IdeaDetail, IdeaType, EdgeDetail } from '@shared/types';
import { Badge, EDGE_LABELS, NODE_LABELS, Icon, TypeDot } from '../components/ui';
import { OccurrenceCard } from '../components/NodeDetailPanel';
import { VirtualList } from '../components/VirtualList';
import { useScanComplete } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';

type SortKey = 'label' | 'type' | 'works' | 'confidence';
const IDEA_ROW_HEIGHT = 116;

export function IdeasView({
  onOpenGraph,
  onOpenAssistant,
}: {
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
}) {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<IdeaType | ''>('');
  const [sortKey, setSortKey] = useState<SortKey>('label');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IdeaDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [connectedDetail, setConnectedDetail] = useState<IdeaDetail | null>(null);
  const [connectedEdge, setConnectedEdge] = useState<EdgeDetail | null>(null);
  const [connectedLoading, setConnectedLoading] = useState(false);

  const reload = useCallback(() => {
    void window.nodus.getGraph('ideas').then(setData);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useScanComplete(reload);

  const ideaNodes = useMemo(() => data.nodes.filter((n) => n.type !== 'theme' && n.type !== 'author'), [data.nodes]);

  const edgesByNode = useMemo(() => {
    const map = new Map<string, GraphEdge[]>();
    for (const edge of data.edges) {
      if (edge.type === 'contains') continue;
      if (!map.has(edge.source)) map.set(edge.source, []);
      if (!map.has(edge.target)) map.set(edge.target, []);
      map.get(edge.source)!.push(edge);
      map.get(edge.target)!.push(edge);
    }
    return map;
  }, [data.edges]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = ideaNodes.filter((n) => {
      if (typeFilter && n.type !== typeFilter) return false;
      if (q && !n.label.toLowerCase().includes(q) && !(n.statement ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'label':
          return a.label.localeCompare(b.label, 'es');
        case 'type':
          return a.type.localeCompare(b.type) || a.label.localeCompare(b.label, 'es');
        case 'works':
          return b.workCount - a.workCount || a.label.localeCompare(b.label, 'es');
        case 'confidence':
          return b.maxConfidence - a.maxConfidence || a.label.localeCompare(b.label, 'es');
      }
    });
    return list;
  }, [ideaNodes, search, typeFilter, sortKey]);

  const connectedIdeas = useMemo(() => {
    if (!selectedId) return [];
    const edges = edgesByNode.get(selectedId) ?? [];
    return edges.map((e) => {
      const otherId = e.source === selectedId ? e.target : e.source;
      const otherNode = data.nodes.find((n) => n.id === otherId);
      return { edge: e, node: otherNode };
    }).filter((c) => c.node && c.node.type !== 'theme' && c.node.type !== 'author');
  }, [selectedId, edgesByNode, data.nodes]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setConnectedDetail(null);
      setConnectedEdge(null);
      return;
    }
    setDetailLoading(true);
    setConnectedDetail(null);
    setConnectedEdge(null);
    let on = true;
    void window.nodus.getIdeaDetail(selectedId).then((d) => {
      if (on) {
        setDetail(d);
        setDetailLoading(false);
      }
    });
    return () => {
      on = false;
    };
  }, [selectedId]);

  const openConnected = useCallback(async (edgeId: string, ideaId: string) => {
    setConnectedLoading(true);
    setConnectedDetail(null);
    setConnectedEdge(null);
    const [ideaD, edgeD] = await Promise.all([
      window.nodus.getIdeaDetail(ideaId),
      window.nodus.getEdgeDetail(edgeId),
    ]);
    setConnectedDetail(ideaD);
    setConnectedEdge(edgeD);
    setConnectedLoading(false);
  }, []);

  const selectedNode = selectedId ? data.nodes.find((n) => n.id === selectedId) : null;

  return (
    <div className="h-full flex min-h-0">
      {/* List */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <Icon name="bulb" size={22} className="text-indigo-300" />
            <h1 className="text-xl font-semibold">Ideas</h1>
            <span className="text-sm text-neutral-500">{ideaNodes.length} ideas extraídas</span>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input text-sm w-60"
              placeholder="Buscar ideas…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input text-sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as IdeaType | '')}
            >
              <option value="">Todos los tipos</option>
              {(['claim', 'finding', 'construct', 'method', 'framework'] as IdeaType[]).map((t) => (
                <option key={t} value={t}>{NODE_LABELS[t]}</option>
              ))}
            </select>
            <select
              className="input text-sm"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="label">Ordenar: nombre</option>
              <option value="type">Ordenar: tipo</option>
              <option value="works">Ordenar: obras</option>
              <option value="confidence">Ordenar: confianza</option>
            </select>
          </div>
        </div>

        {/* Idea cards */}
        <VirtualList
          items={filtered}
          itemHeight={IDEA_ROW_HEIGHT}
          getKey={(node) => node.id}
          className="flex-1 min-h-0 px-6 pb-6"
          empty={
            <div className="text-neutral-500 text-sm">
              {ideaNodes.length === 0
                ? 'Aún no hay ideas. Ejecuta escaneos profundos para extraer ideas de tus obras.'
                : 'Sin resultados para los filtros actuales.'}
            </div>
          }
          renderItem={(node) => {
            const degree = (edgesByNode.get(node.id) ?? []).length;
            const isSelected = node.id === selectedId;
            return (
              <button
                key={node.id}
                className={`card p-3 w-full h-[104px] text-left transition-colors ${
                  isSelected ? 'ring-1 ring-indigo-500 bg-neutral-800/80' : 'hover:bg-neutral-800/50'
                }`}
                onClick={() => setSelectedId(node.id)}
              >
                <div className="flex items-start gap-2">
                  <TypeDot type={node.type} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{node.label}</span>
                      <Badge color="indigo">{NODE_LABELS[node.type as IdeaType] ?? node.type}</Badge>
                    </div>
                    {node.statement && (
                      <p className="text-xs text-neutral-400 mt-1 line-clamp-2">{node.statement}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-neutral-500">
                      <span>{node.workCount} obra(s)</span>
                      <span>{degree} conexión(es)</span>
                      <span>conf {node.maxConfidence.toFixed(2)}</span>
                      {node.themes.length > 0 && (
                        <span className="min-w-0 truncate text-neutral-600">{node.themes.join(', ')}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          }}
        />
      </div>

      {/* Detail panel */}
      {selectedId && (
        <div className="w-[420px] shrink-0 border-l border-neutral-800 bg-neutral-900/95 overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm text-neutral-300">Detalle</h2>
            <button className="text-neutral-500 hover:text-white text-sm" onClick={() => setSelectedId(null)}>
              ✕
            </button>
          </div>

          {detailLoading && !detail && (
            <div className="space-y-3 animate-pulse">
              <div className="h-3 bg-neutral-800 rounded w-3/4" />
              <div className="h-3 bg-neutral-800 rounded w-full" />
              <div className="h-3 bg-neutral-800 rounded w-5/6" />
            </div>
          )}

          {detail && (
            <div className="space-y-4">
              {/* Idea info */}
              <div>
                <Badge color="indigo">{NODE_LABELS[detail.idea.type as IdeaType] ?? detail.idea.type}</Badge>
                <h3 className="font-semibold mt-2">{detail.idea.label}</h3>
                <p className="text-neutral-400 text-sm mt-1">{detail.idea.statement}</p>
                {selectedNode && selectedNode.themes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedNode.themes.map((t) => (
                      <Badge key={t} color="amber">{t}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                    onClick={() => onOpenGraph({ preset: 'overview', nodeId: detail.idea.global_id, label: `Idea: ${detail.idea.label}` })}
                  >
                    <Icon name="layers" size={13} /> Grafo
                  </button>
                  <button
                    className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                    onClick={() =>
                      onOpenAssistant({
                        title: `Idea: ${detail.idea.label}`,
                        selection: ASSISTANT_CONTEXTS.idea,
                        prompt:
                          `Analiza esta idea dentro del corpus y resume sus conexiones, tensiones y lecturas prioritarias.\n\n` +
                          `Idea: ${detail.idea.label}\n${detail.idea.statement}`,
                      })
                    }
                  >
                    <Icon name="wand" size={13} /> Asistente
                  </button>
                </div>
              </div>

              {/* Occurrences */}
              {detail.occurrences.length > 0 && (
                <div>
                  <div className="text-xs uppercase text-neutral-500 mb-1">Obras que la desarrollan</div>
                  {detail.occurrences.map((o) => (
                    <OccurrenceCard key={o.nodus_id} occurrence={o} />
                  ))}
                </div>
              )}

              {/* Evidence */}
              {detail.evidence.length > 0 && (
                <div>
                  <div className="text-xs uppercase text-neutral-500 mb-1">Evidencia anclada</div>
                  {detail.evidence.map((ev) => (
                    <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-3 py-2 my-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md">
                      "{ev.quote}" <span className="text-neutral-500 not-italic">{ev.location ?? ''} · {ev.kind}</span>
                    </blockquote>
                  ))}
                </div>
              )}

              {/* Connected ideas */}
              {connectedIdeas.length > 0 && (
                <div>
                  <div className="text-xs uppercase text-neutral-500 mb-1">
                    Ideas conectadas ({connectedIdeas.length})
                  </div>
                  <div className="space-y-1.5">
                    {connectedIdeas.map(({ edge, node }) => {
                      if (!node) return null;
                      const edgeLabel = EDGE_LABELS[edge.type as keyof typeof EDGE_LABELS] ?? edge.type;
                      return (
                        <button
                          key={edge.id}
                          className="card p-2.5 w-full text-left hover:bg-neutral-800/60 transition-colors"
                          onClick={() => openConnected(edge.id, node.id)}
                        >
                          <div className="flex items-center gap-2">
                            <TypeDot type={node.type} />
                            <span className="text-sm font-medium truncate">{node.label}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge color={edge.basis === 'explicit' ? 'green' : 'amber'}>{edgeLabel}</Badge>
                            <span className="text-[11px] text-neutral-500">conf {edge.confidence.toFixed(2)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Connected idea sub-detail */}
          {connectedLoading && (
            <div className="mt-4 pt-4 border-t border-neutral-800 animate-pulse">
              <div className="h-3 bg-neutral-800 rounded w-2/3" />
              <div className="h-3 bg-neutral-800 rounded w-full mt-2" />
            </div>
          )}
          {connectedDetail && (
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <div className="text-xs uppercase text-neutral-500 mb-2">Idea conectada</div>
              {connectedEdge && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge color="indigo">
                      {EDGE_LABELS[connectedEdge.edge.type as keyof typeof EDGE_LABELS] ?? connectedEdge.edge.type}
                    </Badge>
                    <Badge color={connectedEdge.edge.basis === 'explicit' ? 'green' : 'amber'}>
                      {connectedEdge.edge.basis}
                    </Badge>
                    <Badge>conf {connectedEdge.edge.confidence.toFixed(2)}</Badge>
                  </div>
                  {connectedEdge.explanation && (
                    <p className="text-xs text-neutral-400 mb-2">{connectedEdge.explanation}</p>
                  )}
                  <div className="text-xs text-neutral-500">
                    <span className="text-neutral-300">{connectedEdge.fromLabel}</span> →{' '}
                    <span className="text-neutral-300">{connectedEdge.toLabel}</span>
                  </div>
                  {connectedEdge.evidence.length > 0 && connectedEdge.evidence.map((ev) => (
                    <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-2 mt-1 text-xs italic text-neutral-400">
                      "{ev.quote}" {ev.location ?? ''}
                    </blockquote>
                  ))}
                </div>
              )}
              <Badge color="indigo">{NODE_LABELS[connectedDetail.idea.type as IdeaType] ?? connectedDetail.idea.type}</Badge>
              <h4 className="font-semibold mt-1">{connectedDetail.idea.label}</h4>
              <p className="text-neutral-400 text-xs mt-1">{connectedDetail.idea.statement}</p>
              {connectedDetail.occurrences.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] uppercase text-neutral-500 mb-1">Obras</div>
                  {connectedDetail.occurrences.slice(0, 3).map((o) => (
                    <OccurrenceCard key={o.nodus_id} occurrence={o} />
                  ))}
                  {connectedDetail.occurrences.length > 3 && (
                    <div className="text-[11px] text-neutral-500 mt-1">
                      +{connectedDetail.occurrences.length - 3} más
                    </div>
                  )}
                </div>
              )}
              <button
                className="btn btn-ghost text-xs mt-3 gap-1"
                onClick={() => setSelectedId(connectedDetail.idea.global_id)}
              >
                <Icon name="bulb" size={12} /> Ver detalle completo
              </button>
              <button
                className="btn btn-ghost text-xs mt-3 ml-2 gap-1"
                onClick={() => onOpenGraph({ preset: 'overview', nodeId: connectedDetail.idea.global_id, label: `Idea: ${connectedDetail.idea.label}` })}
              >
                <Icon name="layers" size={12} /> Ver en grafo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
