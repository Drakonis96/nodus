import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GraphEdge, IdeaConnection, IdeaDetail, IdeaListItem, IdeaType, EdgeDetail } from '@shared/types';
import { Badge, EDGE_LABELS, NODE_LABELS, Icon, TypeDot } from '../components/ui';
import {
  OccurrenceCard,
  EvidenceLocationLink,
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
import { getVaultQueryCache, setVaultQueryCache } from '../vaultQueryCache';
import { academicKnowledgeViewSource, type KnowledgeViewSource } from './knowledgeViewSource';

type SortKey = 'label' | 'type' | 'works' | 'connections' | 'confidence';
const IDEA_ROW_HEIGHT = 116;
const IDEAS_PAGE_SIZE = 150;
const IDEAS_DETAIL_WIDTH_KEY = 'nodus.ideas.detailWidth';
const IDEAS_DETAIL_DEFAULT_WIDTH = 420;

export function IdeasView({
  vaultId,
  onOpenGraph,
  onOpenAssistant,
  dataSource = academicKnowledgeViewSource,
  scopeControl,
  testId,
}: {
  vaultId: string | null;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenAssistant: (target?: PendingAssistantNavigationTarget) => void;
  dataSource?: KnowledgeViewSource;
  scopeControl?: ReactNode;
  testId?: string;
}) {
  const [ideas, setIdeas] = useState<IdeaListItem[]>([]);
  const [totalIdeas, setTotalIdeas] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<IdeaType | ''>('');
  const [sortKey, setSortKey] = useState<SortKey>('label');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IdeaDetail | null>(null);
  const [connections, setConnections] = useState<IdeaConnection[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingIdeaToNotes, setSavingIdeaToNotes] = useState(false);
  const [savingIdea, setSavingIdea] = useState(false);
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

  const reload = useCallback((force = true) => {
    const request = {
      offset: pageOffset,
      limit: IDEAS_PAGE_SIZE,
      search: searchQuery || undefined,
      type: typeFilter,
      sort: sortKey,
    } as const;
    const cacheKey = `${dataSource.key}:ideas:${JSON.stringify(request)}`;
    if (!force) {
      const cached = getVaultQueryCache<{ items: IdeaListItem[]; total: number }>(vaultId, cacheKey);
      if (cached) {
        setIdeas(cached.items);
        setTotalIdeas(cached.total);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    void dataSource
      .listIdeasPage(request)
      .then((page) => {
        if (page.total > 0 && page.items.length === 0 && pageOffset > 0) {
          setPageOffset(Math.max(0, Math.floor((page.total - 1) / IDEAS_PAGE_SIZE) * IDEAS_PAGE_SIZE));
          return;
        }
        setIdeas(page.items);
        setTotalIdeas(page.total);
        setVaultQueryCache(vaultId, cacheKey, { items: page.items, total: page.total });
      })
      .finally(() => setLoading(false));
  }, [dataSource, pageOffset, searchQuery, sortKey, typeFilter, vaultId]);

  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(search.trim()), 250);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setPageOffset(0);
  }, [searchQuery, sortKey, typeFilter]);

  useEffect(() => {
    reload(false);
  }, [reload]);
  useDataRefresh(reload);
  useScanComplete(reload);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setConnections([]);
      return;
    }
    setDetailLoading(true);
    let on = true;
    const cacheKey = `${dataSource.key}:idea-detail:${selectedId}`;
    const cached = getVaultQueryCache<{ detail: IdeaDetail | null; connections: IdeaConnection[] }>(vaultId, cacheKey);
    if (cached) {
      setDetail(cached.detail);
      setConnections(cached.connections);
      setDetailLoading(false);
      return;
    }
    void Promise.all([dataSource.getIdeaDetail(selectedId), dataSource.listIdeaConnections(selectedId)]).then(([d, linked]) => {
      if (on) {
        setDetail(d);
        setConnections(linked);
        setVaultQueryCache(vaultId, cacheKey, { detail: d, connections: linked });
        setDetailLoading(false);
      }
    });
    return () => {
      on = false;
    };
  }, [dataSource, selectedId, vaultId]);

  useEffect(() => dataSource.subscribe?.(() => reload(true)), [dataSource, reload]);

  const selectedNode = selectedId ? ideas.find((idea) => idea.id === selectedId) : null;

  return (
    <div className="h-full flex min-h-0 bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid={testId}>
      {/* List */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <Icon name="bulb" size={22} className="text-indigo-300" />
            <h1 className="text-xl font-semibold">{t('Ideas')}</h1>
            <span className="text-sm text-neutral-500">{tx('{n} ideas extraídas', { n: totalIdeas })}</span>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {scopeControl}
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
          items={ideas}
          itemHeight={IDEA_ROW_HEIGHT}
          getKey={(node) => node.id}
          className="flex-1 min-h-0 px-6 pb-6"
          empty={
            <div className="text-neutral-500 text-sm">
              {totalIdeas === 0
                ? t('Aún no hay ideas. Ejecuta escaneos profundos para extraer ideas de tus obras.')
                : t('Sin resultados para los filtros actuales.')}
            </div>
          }
          renderItem={(node) => {
            const degree = node.connectionCount;
            const isSelected = node.id === selectedId;
            return (
              <button
                key={node.id}
                data-testid={testId ? 'study-idea-card' : undefined}
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
        {!loading && totalIdeas > IDEAS_PAGE_SIZE && (
          <div className="mx-6 mb-4 flex items-center justify-between text-xs text-neutral-500">
            <span>{pageOffset + 1}–{Math.min(pageOffset + ideas.length, totalIdeas)} / {totalIdeas}</span>
            <div className="flex gap-2">
              <button className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs" disabled={pageOffset === 0} onClick={() => setPageOffset((offset) => Math.max(0, offset - IDEAS_PAGE_SIZE))}>
                <Icon name="arrowLeft" size={13} /> {t('Anterior')}
              </button>
              <button className="btn btn-ghost border border-neutral-700 px-2 py-1 text-xs" disabled={pageOffset + ideas.length >= totalIdeas} onClick={() => setPageOffset((offset) => offset + IDEAS_PAGE_SIZE)}>
                {t('Siguiente')} <Icon name="arrowRight" size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedId && (
        <div
          data-testid={testId ? 'study-idea-detail' : undefined}
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
                    <Icon name="chat" size={13} /> {t('Asistente')}
                  </button>
                  <button
                    className="btn btn-ghost border border-neutral-700 text-xs gap-1.5"
                    disabled={savingIdea}
                    onClick={() => {
                      if (!dataSource.saveIdea) { setSavingIdeaToNotes(true); return; }
                      setSavingIdea(true);
                      void dataSource.saveIdea(detail).finally(() => setSavingIdea(false));
                    }}
                  >
                    <Icon name="notebook" size={13} /> {t(savingIdea ? 'Guardando…' : 'Guardar en notas')}
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
                      "{ev.quote}" <EvidenceLocationLink nodusId={ev.nodus_id} location={ev.location} suffix={` · ${ev.kind}`} onOpen={dataSource.openEvidence} />
                    </blockquote>
                  ))}
                </div>
              )}

              {/* Connected ideas — each expands inline below its row */}
              {connections.length > 0 && (
                <div>
                  <div className="text-xs uppercase text-neutral-500 mb-1">
                    {tx('Ideas conectadas ({n})', { n: connections.length })}
                  </div>
                  <div className="space-y-1.5">
                    {connections.map(({ edge, node }) =>
                      (
                        <ConnectedIdeaRow
                          key={edge.id}
                          edge={edge}
                          node={node}
                          onSelectIdea={setSelectedId}
                          onOpenGraph={onOpenGraph}
                          dataSource={dataSource}
                        />
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {savingIdeaToNotes && detail && !dataSource.saveIdea && (
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
  dataSource,
}: {
  edge: GraphEdge;
  node: IdeaListItem;
  onSelectIdea: (id: string) => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  dataSource: KnowledgeViewSource;
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
        void Promise.all([dataSource.getIdeaDetail(node.id), dataSource.getEdgeDetail(edge.id)]).then(
          ([ideaD, edgeD]) => {
            setIdeaDetail(ideaD);
            setEdgeDetail(edgeD);
            setLoading(false);
          }
        );
      }
      return next;
    });
  }, [dataSource, edge.id, node.id]);

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
                      "{ev.quote}" <EvidenceLocationLink nodusId={ev.nodus_id} location={ev.location} onOpen={dataSource.openEvidence} />
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
