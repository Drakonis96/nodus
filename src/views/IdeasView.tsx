import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphData, GraphEdge, IdeaDetail, IdeaType, EdgeDetail } from '@shared/types';
import { Badge, EDGE_LABELS, NODE_LABELS, Icon, TypeDot } from '../components/ui';
import {
  OccurrenceCard,
  loadNumber,
  DETAIL_MIN_WIDTH,
  DETAIL_MAX_WIDTH,
} from '../components/NodeDetailPanel';
import { VirtualList } from '../components/VirtualList';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { buildIdeaNote } from '../notes';
import { useDataRefresh, useScanComplete } from '../hooks';
import {
  ASSISTANT_CONTEXTS,
  type PendingAssistantNavigationTarget,
  type PendingGraphNavigationTarget,
} from '../navigation';
import { t, tx } from '../i18n';

type SortKey = 'label' | 'type' | 'works' | 'connections' | 'confidence';
const IDEA_ROW_HEIGHT = 116;
const IDEAS_DETAIL_WIDTH_KEY = 'nodus.ideas.detailWidth';
const IDEAS_DETAIL_DEFAULT_WIDTH = 420;

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
  const [savingIdeaToNotes, setSavingIdeaToNotes] = useState(false);
  const [detailWidth, setDetailWidth] = useState(() =>
    loadNumber(IDEAS_DETAIL_WIDTH_KEY, IDEAS_DETAIL_DEFAULT_WIDTH, DETAIL_MIN_WIDTH, DETAIL_MAX_WIDTH)
  );

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = detailWidth;
      const onMove = (evt: PointerEvent) => {
        const next = Math.min(DETAIL_MAX_WIDTH, Math.max(DETAIL_MIN_WIDTH, startWidth + startX - evt.clientX));
        setDetailWidth(next);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setDetailWidth((w) => {
          localStorage.setItem(IDEAS_DETAIL_WIDTH_KEY, String(w));
          return w;
        });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    },
    [detailWidth]
  );

  const reload = useCallback(() => {
    void window.nodus.getGraph('ideas').then(setData);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useDataRefresh(reload);
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
        case 'connections':
          return (edgesByNode.get(b.id) ?? []).length - (edgesByNode.get(a.id) ?? []).length || a.label.localeCompare(b.label, 'es');
        case 'confidence':
          return b.maxConfidence - a.maxConfidence || a.label.localeCompare(b.label, 'es');
      }
    });
    return list;
  }, [ideaNodes, search, typeFilter, sortKey, edgesByNode]);

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
      return;
    }
    setDetailLoading(true);
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

  const selectedNode = selectedId ? data.nodes.find((n) => n.id === selectedId) : null;

  return (
    <div className="h-full flex min-h-0">
      {/* List */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <Icon name="bulb" size={22} className="text-indigo-300" />
            <h1 className="text-xl font-semibold">{t('Ideas')}</h1>
            <span className="text-sm text-neutral-500">{tx('{n} ideas extraídas', { n: ideaNodes.length })}</span>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input text-sm w-60"
              placeholder={t('Buscar ideas…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input text-sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as IdeaType | '')}
            >
              <option value="">{t('Todos los tipos')}</option>
              {(['claim', 'finding', 'construct', 'method', 'framework'] as IdeaType[]).map((tp) => (
                <option key={tp} value={tp}>{t(NODE_LABELS[tp])}</option>
              ))}
            </select>
            <select
              className="input text-sm"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="label">{t('Ordenar: nombre')}</option>
              <option value="type">{t('Ordenar: tipo')}</option>
              <option value="works">{t('Ordenar: obras')}</option>
              <option value="connections">{t('Ordenar: conexiones')}</option>
              <option value="confidence">{t('Ordenar: confianza')}</option>
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
                ? t('Aún no hay ideas. Ejecuta escaneos profundos para extraer ideas de tus obras.')
                : t('Sin resultados para los filtros actuales.')}
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
                      <Badge color="indigo">{t(NODE_LABELS[node.type as IdeaType]) ?? node.type}</Badge>
                    </div>
                    {node.statement && (
                      <p className="text-xs text-neutral-400 mt-1 line-clamp-2">{node.statement}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-neutral-500">
                      <span>{tx('{n} obra(s)', { n: node.workCount })}</span>
                      <span>{tx('{n} conexión(es)', { n: degree })}</span>
                      <span>{t('conf')} {node.maxConfidence.toFixed(2)}</span>
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
        <div
          className="relative shrink-0 border-l border-neutral-800 bg-neutral-900/95 overflow-y-auto p-4"
          style={{ width: detailWidth }}
        >
          <div
            className="absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize hover:bg-indigo-500/25 z-10"
            role="separator"
            aria-orientation="vertical"
            title={t('Ajustar ancho')}
            onPointerDown={startResize}
          />
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm text-neutral-300">{t('Detalle')}</h2>
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
                <Badge color="indigo">{t(NODE_LABELS[detail.idea.type as IdeaType]) ?? detail.idea.type}</Badge>
                <h3 className="font-semibold mt-2">{detail.idea.label}</h3>
                <p className="text-neutral-400 text-sm mt-1">{detail.idea.statement}</p>
                {selectedNode && selectedNode.themes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedNode.themes.map((theme) => (
                      <Badge key={theme} color="amber">{theme}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                    onClick={() => onOpenGraph({ preset: 'overview', nodeId: detail.idea.global_id, label: `${t('Idea:')} ${detail.idea.label}` })}
                  >
                    <Icon name="layers" size={13} /> {t('Grafo')}
                  </button>
                  <button
                    className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                    onClick={() =>
                      onOpenAssistant({
                        title: `${t('Idea:')} ${detail.idea.label}`,
                        selection: ASSISTANT_CONTEXTS.idea,
                        prompt:
                          `${t('Analiza esta idea dentro del corpus y resume sus conexiones, tensiones y lecturas prioritarias.')}\n\n` +
                          `${t('Idea:')} ${detail.idea.label}\n${detail.idea.statement}`,
                      })
                    }
                  >
                    <Icon name="wand" size={13} /> {t('Asistente')}
                  </button>
                  <button
                    className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                    onClick={() => setSavingIdeaToNotes(true)}
                  >
                    <Icon name="notebook" size={13} /> {t('Guardar en notas')}
                  </button>
                </div>
              </div>

              {/* Occurrences */}
              {detail.occurrences.length > 0 && (
                <div>
                  <div className="text-xs uppercase text-neutral-500 mb-1">{t('Obras que la desarrollan')}</div>
                  {detail.occurrences.map((o) => (
                    <OccurrenceCard key={o.nodus_id} occurrence={o} />
                  ))}
                </div>
              )}

              {/* Evidence */}
              {detail.evidence.length > 0 && (
                <div>
                  <div className="text-xs uppercase text-neutral-500 mb-1">{t('Evidencia anclada')}</div>
                  {detail.evidence.map((ev) => (
                    <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-3 py-2 my-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md">
                      "{ev.quote}" <span className="text-neutral-500 not-italic">{ev.location ?? ''} · {ev.kind}</span>
                    </blockquote>
                  ))}
                </div>
              )}

              {/* Connected ideas — each expands inline below its row */}
              {connectedIdeas.length > 0 && (
                <div>
                  <div className="text-xs uppercase text-neutral-500 mb-1">
                    {tx('Ideas conectadas ({n})', { n: connectedIdeas.length })}
                  </div>
                  <div className="space-y-1.5">
                    {connectedIdeas.map(({ edge, node }) =>
                      node ? (
                        <ConnectedIdeaRow
                          key={edge.id}
                          edge={edge}
                          node={node}
                          onSelectIdea={setSelectedId}
                          onOpenGraph={onOpenGraph}
                        />
                      ) : null
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {savingIdeaToNotes && detail && (
        <SaveToNotesModal
          content={buildIdeaNote(detail)}
          defaultTitle={detail.idea.label}
          kind="idea"
          source={{ origin: 'idea', ref: detail.idea.global_id }}
          onClose={() => setSavingIdeaToNotes(false)}
        />
      )}
    </div>
  );
}

/**
 * One row in the "connected ideas" list. Clicking the header expands the edge +
 * idea detail inline, just below this row, and folds it back on a second click.
 * Each row keeps its own open/loading state, so several can stay expanded at once
 * and the detail loads lazily only when first opened.
 */
function ConnectedIdeaRow({
  edge,
  node,
  onSelectIdea,
  onOpenGraph,
}: {
  edge: GraphEdge;
  node: NonNullable<GraphData['nodes'][number]>;
  onSelectIdea: (id: string) => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ideaDetail, setIdeaDetail] = useState<IdeaDetail | null>(null);
  const [edgeDetail, setEdgeDetail] = useState<EdgeDetail | null>(null);
  const loadedRef = useRef(false);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next && !loadedRef.current) {
        loadedRef.current = true;
        setLoading(true);
        void Promise.all([window.nodus.getIdeaDetail(node.id), window.nodus.getEdgeDetail(edge.id)]).then(
          ([ideaD, edgeD]) => {
            setIdeaDetail(ideaD);
            setEdgeDetail(edgeD);
            setLoading(false);
          }
        );
      }
      return next;
    });
  }, [edge.id, node.id]);

  const edgeLabel = t(EDGE_LABELS[edge.type as keyof typeof EDGE_LABELS]) ?? edge.type;

  return (
    <div className={`card overflow-hidden ${open ? 'ring-1 ring-indigo-500/40' : ''}`}>
      <button
        className="w-full text-left p-2.5 hover:bg-neutral-800/60 transition-colors"
        onClick={toggle}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <TypeDot type={node.type} />
          <span className="text-sm font-medium truncate flex-1 min-w-0">{node.label}</span>
          <Icon
            name="chevronRight"
            size={14}
            className={`shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Badge color={edge.basis === 'explicit' ? 'green' : 'amber'}>{edgeLabel}</Badge>
          <span className="text-[11px] text-neutral-500">{t('conf')} {edge.confidence.toFixed(2)}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-neutral-800 bg-neutral-950/40 p-2.5">
          {loading && (
            <div className="animate-pulse space-y-2">
              <div className="h-3 w-2/3 rounded bg-neutral-800" />
              <div className="h-3 w-full rounded bg-neutral-800" />
            </div>
          )}
          {!loading && (
            <>
              {edgeDetail && (edgeDetail.explanation || edgeDetail.evidence.length > 0) && (
                <div className="mb-3">
                  <div className="text-xs text-neutral-500">
                    <span className="text-neutral-300">{edgeDetail.fromLabel}</span> →{' '}
                    <span className="text-neutral-300">{edgeDetail.toLabel}</span>
                  </div>
                  {edgeDetail.explanation && (
                    <p className="text-xs text-neutral-400 mt-1">{edgeDetail.explanation}</p>
                  )}
                  {edgeDetail.evidence.map((ev) => (
                    <blockquote
                      key={ev.id}
                      className="border-l-2 border-indigo-700 pl-2 mt-1 text-xs italic text-neutral-400"
                    >
                      "{ev.quote}" {ev.location ?? ''}
                    </blockquote>
                  ))}
                </div>
              )}
              {ideaDetail && (
                <>
                  <Badge color="indigo">{t(NODE_LABELS[ideaDetail.idea.type as IdeaType]) ?? ideaDetail.idea.type}</Badge>
                  <p className="text-neutral-400 text-xs mt-1">{ideaDetail.idea.statement}</p>
                  {ideaDetail.occurrences.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] uppercase text-neutral-500 mb-1">{t('Obras')}</div>
                      {ideaDetail.occurrences.slice(0, 3).map((o) => (
                        <OccurrenceCard key={o.nodus_id} occurrence={o} />
                      ))}
                      {ideaDetail.occurrences.length > 3 && (
                        <div className="text-[11px] text-neutral-500 mt-1">
                          +{ideaDetail.occurrences.length - 3} {t('más')}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="btn btn-ghost text-xs gap-1"
                      onClick={() => onSelectIdea(ideaDetail.idea.global_id)}
                    >
                      <Icon name="bulb" size={12} /> {t('Ver detalle completo')}
                    </button>
                    <button
                      className="btn btn-ghost text-xs gap-1"
                      onClick={() =>
                        onOpenGraph({
                          preset: 'overview',
                          nodeId: ideaDetail.idea.global_id,
                          label: `${t('Idea:')} ${ideaDetail.idea.label}`,
                        })
                      }
                    >
                      <Icon name="layers" size={12} /> {t('Ver en grafo')}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
