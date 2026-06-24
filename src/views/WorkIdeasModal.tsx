// Per-work ideas browser, opened from the Library by clicking a work.
//
// Lists every idea a work develops; selecting one shows its full detail
// (statement, the works that develop it, anchored evidence) plus its
// connections to other ideas. From the detail you can jump into the graph
// — either the focused node in the global graph, or the work's idea graph.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EdgeDetail, IdeaByWork, IdeaDetail, IdeaType } from '@shared/types';
import { Badge, EDGE_LABELS, Icon, NODE_LABELS, TypeDot } from '../components/ui';
import { OccurrenceCard } from '../components/NodeDetailPanel';
import type { PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';

const PAGE_SIZE = 200;

function ideaTypeLabel(type: IdeaType): string {
  return t(NODE_LABELS[type]) ?? type;
}

function edgeTypeLabel(type: EdgeDetail['edge']['type']): string {
  return t(EDGE_LABELS[type]) ?? type;
}

export function WorkIdeasModal({
  work,
  onClose,
  onOpenGraph,
  onOpenWorkGraph,
}: {
  work: { nodus_id: string; title: string };
  onClose: () => void;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenWorkGraph: (work: { nodus_id: string; title: string }) => void;
}) {
  const [ideas, setIdeas] = useState<IdeaByWork[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IdeaDetail | null>(null);
  const [edges, setEdges] = useState<EdgeDetail[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Load the first page of ideas; auto-select the first so the panel is never empty.
  useEffect(() => {
    let on = true;
    setLoading(true);
    void window.nodus.getIdeasByWork(work.nodus_id, PAGE_SIZE, 0).then((page) => {
      if (!on) return;
      setIdeas(page.ideas);
      setTotal(page.total);
      setSelectedId((current) => current ?? page.ideas[0]?.global_id ?? null);
      setLoading(false);
    });
    return () => {
      on = false;
    };
  }, [work.nodus_id]);

  const loadMore = useCallback(async () => {
    const page = await window.nodus.getIdeasByWork(work.nodus_id, PAGE_SIZE, ideas.length);
    setIdeas((prev) => [...prev, ...page.ideas]);
    setTotal(page.total);
  }, [work.nodus_id, ideas.length]);

  // Load detail + connections for the selected idea (which may live outside this
  // work once the reader expands along a connection).
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setEdges([]);
      return;
    }
    let on = true;
    setDetailLoading(true);
    void Promise.all([window.nodus.getIdeaDetail(selectedId), window.nodus.getIdeaEdges(selectedId)]).then(
      ([d, e]) => {
        if (!on) return;
        setDetail(d);
        setEdges(e);
        setDetailLoading(false);
      }
    );
    return () => {
      on = false;
    };
  }, [selectedId]);

  // Esc closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const connections = useMemo(
    () =>
      edges.map((e) => {
        const outgoing = e.edge.from_id === selectedId;
        return {
          edgeId: e.edge.id,
          otherId: outgoing ? e.edge.to_id : e.edge.from_id,
          otherLabel: outgoing ? e.toLabel : e.fromLabel,
          type: e.edge.type,
          confidence: e.edge.confidence,
          outgoing,
        };
      }),
    [edges, selectedId]
  );

  const ideaHeader = detail?.idea ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={t('Ideas de la obra')}
      onClick={onClose}
    >
      <div
        className="card relative flex h-full w-full max-w-[1200px] flex-col overflow-hidden border border-neutral-700 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
          <Icon name="bulb" size={18} className="text-amber-300" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{tx('Ideas · {title}', { title: work.title })}</h2>
            <p className="truncate text-xs text-neutral-500">
              {loading
                ? t('Cargando ideas…')
                : tx('{n} idea(s) extraída(s) de esta obra', { n: total })}
            </p>
          </div>
          <div className="flex-1" />
          <button
            className="btn btn-ghost border border-neutral-700 gap-1.5 text-xs"
            title={t('Abrir el grafo de ideas de esta obra')}
            onClick={() => onOpenWorkGraph(work)}
          >
            <Icon name="network" size={13} /> {t('Grafo de la obra')}
          </button>
          <button className="ml-1 text-neutral-400 hover:text-white" title={t('Cerrar')} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Idea list */}
          <div className="flex w-2/5 min-w-[260px] max-w-[440px] flex-col border-r border-neutral-800">
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="p-3 text-sm text-neutral-500">{t('Cargando ideas…')}</div>
              ) : ideas.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-neutral-400">
                  <Icon name="bulb" size={26} className="text-neutral-600" />
                  <p>{t('Esta obra aún no tiene ideas extraídas.')}</p>
                  <p className="text-xs text-neutral-500">{t('Ejecuta un análisis profundo de la obra para extraer sus ideas.')}</p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {ideas.map((idea) => {
                    const active = idea.global_id === selectedId;
                    return (
                      <li key={idea.global_id}>
                        <button
                          className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                            active
                              ? 'border-indigo-700 bg-indigo-950/40'
                              : 'border-transparent hover:border-neutral-700 hover:bg-neutral-900/60'
                          }`}
                          onClick={() => setSelectedId(idea.global_id)}
                        >
                          <div className="flex items-center gap-1.5">
                            <TypeDot type={idea.type} />
                            <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                              {ideaTypeLabel(idea.type)}
                            </span>
                            {idea.role === 'principal' && (
                              <span className="text-[10px] text-amber-300/80">★</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-sm font-medium leading-snug text-neutral-100">{idea.label}</div>
                          <div className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{idea.statement}</div>
                        </button>
                      </li>
                    );
                  })}
                  {ideas.length < total && (
                    <li>
                      <button
                        className="btn btn-ghost w-full border border-neutral-700 text-xs"
                        onClick={() => void loadMore()}
                      >
                        {tx('Cargar más ({n} restantes)', { n: total - ideas.length })}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>

          {/* Idea detail */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {!selectedId ? (
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                {t('Selecciona una idea para ver su detalle y sus conexiones.')}
              </div>
            ) : detailLoading && !detail ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 w-1/3 rounded bg-neutral-800" />
                <div className="h-3 w-3/4 rounded bg-neutral-800" />
                <div className="h-3 w-full rounded bg-neutral-800" />
              </div>
            ) : detail && ideaHeader ? (
              <div className="space-y-4">
                <div>
                  <Badge color="indigo">{ideaTypeLabel(ideaHeader.type as IdeaType)}</Badge>
                  <h3 className="mt-2 text-base font-semibold leading-snug">{ideaHeader.label}</h3>
                  <p className="mt-1 text-sm text-neutral-400">{ideaHeader.statement}</p>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-primary gap-1.5 text-xs"
                    title={t('Ver este nodo y sus conexiones en el grafo')}
                    onClick={() => {
                      onOpenGraph({ preset: 'overview', nodeId: ideaHeader.global_id, label: ideaHeader.label });
                      onClose();
                    }}
                  >
                    <Icon name="compass" size={13} /> {t('Ver en el grafo')}
                  </button>
                  <button
                    className="btn btn-ghost gap-1.5 border border-neutral-700 text-xs"
                    title={t('Abrir el grafo de ideas de esta obra')}
                    onClick={() => onOpenWorkGraph(work)}
                  >
                    <Icon name="network" size={13} /> {t('Grafo de la obra')}
                  </button>
                </div>

                {/* Connections */}
                <div>
                  <div className="mb-1 text-xs uppercase text-neutral-500">
                    {tx('Conexiones ({n})', { n: connections.length })}
                  </div>
                  {connections.length === 0 ? (
                    <p className="text-xs text-neutral-500">{t('Esta idea aún no tiene conexiones con otras ideas.')}</p>
                  ) : (
                    <ul className="space-y-1">
                      {connections.map((c) => (
                        <li key={c.edgeId}>
                          <button
                            className="flex w-full items-center gap-2 rounded-md border border-neutral-800 px-3 py-2 text-left hover:border-neutral-700 hover:bg-neutral-900/60"
                            title={t('Ver esta idea conectada')}
                            onClick={() => setSelectedId(c.otherId)}
                          >
                            <Badge color="cyan">{edgeTypeLabel(c.type)}</Badge>
                            <Icon
                              name={c.outgoing ? 'arrowDown' : 'arrowUp'}
                              size={12}
                              className={c.outgoing ? 'text-neutral-500 rotate-90' : 'text-neutral-500 -rotate-90'}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{c.otherLabel}</span>
                            <span className="shrink-0 text-[10px] text-neutral-500">
                              {t('conf')} {c.confidence.toFixed(2)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Works that develop the idea */}
                {detail.occurrences.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs uppercase text-neutral-500">{t('Obras que la desarrollan')}</div>
                    {detail.occurrences.map((o) => (
                      <OccurrenceCard key={o.nodus_id} occurrence={o} />
                    ))}
                  </div>
                )}

                {/* Anchored evidence */}
                {detail.evidence.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs uppercase text-neutral-500">{t('Evidencia anclada')}</div>
                    {detail.evidence.map((ev) => (
                      <blockquote
                        key={ev.id}
                        className="my-2 rounded-r-md border-l-2 border-indigo-700 bg-neutral-950/35 py-2 pl-3 text-xs italic text-neutral-300"
                      >
                        “{ev.quote}”{' '}
                        <span className="not-italic text-neutral-500">
                          {ev.location ?? ''} · {ev.kind}
                        </span>
                      </blockquote>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                {t('No se pudo cargar el detalle de la idea.')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
