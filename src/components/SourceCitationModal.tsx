import { useEffect, useState } from 'react';
import type { EdgeDetail, GapDetail, GapKind, IdeaDetail, IdeaType, WorkMeta, WorkSummary, WorkView } from '@shared/types';
import type { PendingGraphNavigationTarget } from '../navigation';
import { Badge, EDGE_LABELS, Icon, NODE_LABELS } from './ui';
import { OccurrenceCard } from './NodeDetailPanel';
import { t } from '../i18n';

export type CitationTarget =
  | { kind: 'idea'; id: string }
  | { kind: 'work'; id: string }
  | { kind: 'gap'; id: string }
  | { kind: 'contradiction'; id: string }
  | null;

const GAP_LABELS: Record<GapKind, string> = {
  future_work: 'trabajo futuro',
  limitation: 'limitación',
  open_question: 'pregunta abierta',
  unresolved_contradiction: 'contradicción sin resolver',
};

const GAP_COLORS: Record<GapKind, 'amber' | 'red' | 'cyan' | 'indigo'> = {
  future_work: 'cyan',
  limitation: 'amber',
  open_question: 'indigo',
  unresolved_contradiction: 'red',
};

/**
 * NotebookLM-style source modal opened from inline citations in the research
 * assistant. For ideas it reproduces the graph sidebar detail (label, statement,
 * developing works with their Zotero link, anchored evidence); for documents it
 * shows the bibliographic metadata and a Zotero open action.
 */
export function SourceCitationModal({
  target,
  onClose,
  onOpenGraph,
}: {
  target: CitationTarget;
  onClose: () => void;
  onOpenGraph?: (target: PendingGraphNavigationTarget) => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 p-4 flex items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl max-h-[86vh] bg-neutral-950 border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
          <Icon name="book" className="text-indigo-300" />
          <span className="font-semibold text-sm">{t('Fuente citada')}</span>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose} title={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {target?.kind === 'idea' && <IdeaBody globalId={target.id} onClose={onClose} onOpenGraph={onOpenGraph} />}
          {target?.kind === 'work' && <WorkBody nodusId={target.id} onClose={onClose} onOpenGraph={onOpenGraph} />}
          {target?.kind === 'gap' && <GapBody gapId={target.id} onClose={onClose} onOpenGraph={onOpenGraph} />}
          {target?.kind === 'contradiction' && (
            <ContradictionBody edgeId={target.id} onClose={onClose} onOpenGraph={onOpenGraph} />
          )}
        </div>
      </div>
    </div>
  );
}

function IdeaBody({
  globalId,
  onClose,
  onOpenGraph,
}: {
  globalId: string;
  onClose: () => void;
  onOpenGraph?: (target: PendingGraphNavigationTarget) => void;
}) {
  const [detail, setDetail] = useState<IdeaDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let on = true;
    setDetail(null);
    setMissing(false);
    void window.nodus.getIdeaDetail(globalId).then((d) => {
      if (!on) return;
      if (d) setDetail(d);
      else setMissing(true);
    });
    return () => {
      on = false;
    };
  }, [globalId]);

  if (missing) {
    return <p className="text-sm text-neutral-400">{t('No se encontró la idea citada en el grafo actual.')}</p>;
  }
  if (!detail) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 bg-neutral-800 rounded w-1/3" />
        <div className="h-3 bg-neutral-800 rounded w-3/4" />
        <div className="h-3 bg-neutral-800 rounded w-full" />
        <div className="card p-3 mt-2">
          <div className="h-3 bg-neutral-800 rounded w-2/3" />
          <div className="h-2.5 bg-neutral-800 rounded mt-2 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Badge color="indigo">{t(NODE_LABELS[detail.idea.type as IdeaType]) ?? detail.idea.type}</Badge>
        <h3 className="font-semibold mt-2">{detail.idea.label}</h3>
        <p className="text-neutral-400 mt-1">{detail.idea.statement}</p>
        {onOpenGraph && (
          <button
            className="btn btn-primary gap-1.5 mt-3"
            onClick={() => {
              onClose();
              onOpenGraph({ preset: 'overview', nodeId: detail.idea.global_id, label: `${t('Idea:')} ${detail.idea.label}` });
            }}
          >
            <Icon name="layers" size={14} /> {t('Ver conexiones en grafo')}
          </button>
        )}
      </div>
      <div>
        <div className="text-xs uppercase text-neutral-500 mb-1">{t('Obras que la desarrollan')}</div>
        {detail.occurrences.length === 0 && <p className="text-xs text-neutral-500">{t('Sin obras vinculadas.')}</p>}
        {detail.occurrences.map((o) => (
          <OccurrenceCard key={o.nodus_id} occurrence={o} />
        ))}
      </div>
      {detail.evidence.length > 0 && (
        <div>
          <div className="text-xs uppercase text-neutral-500 mb-1">{t('Evidencia anclada')}</div>
          {detail.evidence.map((ev) => (
            <blockquote
              key={ev.id}
              className="border-l-2 border-indigo-700 pl-3 py-2 my-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md"
            >
              “{ev.quote}” <span className="text-neutral-500 not-italic">{ev.location ?? ''} · {ev.kind}</span>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}

function GapBody({
  gapId,
  onClose,
  onOpenGraph,
}: {
  gapId: string;
  onClose: () => void;
  onOpenGraph?: (target: PendingGraphNavigationTarget) => void;
}) {
  const [detail, setDetail] = useState<GapDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let on = true;
    setDetail(null);
    setMissing(false);
    void window.nodus.getGapDetail(gapId).then((d) => {
      if (!on) return;
      if (d) setDetail(d);
      else setMissing(true);
    });
    return () => {
      on = false;
    };
  }, [gapId]);

  if (missing) return <p className="text-sm text-neutral-400">{t('No se encontró el hueco citado.')}</p>;
  if (!detail) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 bg-neutral-800 rounded w-1/3" />
        <div className="h-3 bg-neutral-800 rounded w-full" />
        <div className="h-3 bg-neutral-800 rounded w-2/3" />
      </div>
    );
  }

  const authors = detail.work.authors.length ? detail.work.authors.join('; ') : t('Autoría no disponible');
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={GAP_COLORS[detail.gap.kind]}>{t(GAP_LABELS[detail.gap.kind])}</Badge>
          <Badge>{t('conf')} {detail.gap.confidence.toFixed(2)}</Badge>
        </div>
        <h3 className="font-semibold mt-2">{t('Hueco de investigación')}</h3>
        <p className="text-neutral-300 mt-1">{detail.gap.statement}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {onOpenGraph && (
            <button
              className="btn btn-primary gap-1.5"
              onClick={() => {
                onClose();
                onOpenGraph({ preset: 'gaps', label: `${t('Hueco:')} ${t(GAP_LABELS[detail.gap.kind])}` });
              }}
            >
              <Icon name="layers" size={14} /> {t('Ver en grafo')}
            </button>
          )}
          <button
            className="btn btn-ghost border border-neutral-700 gap-1.5"
            onClick={() => void window.nodus.openInZotero(detail.work.zotero_key)}
          >
            <Icon name="external" size={14} /> {t('Abrir obra')}
          </button>
        </div>
      </div>

      <div className="card p-3">
        <div className="text-xs uppercase text-neutral-500 mb-1">{t('Obra')}</div>
        <div className="text-sm font-medium">{detail.work.title}</div>
        <div className="text-xs text-neutral-400 mt-1">
          {authors}
          {detail.work.year ? ` · ${detail.work.year}` : ''}
        </div>
      </div>

      {detail.relatedIdea && (
        <div>
          <div className="text-xs uppercase text-neutral-500 mb-1">{t('Idea relacionada')}</div>
          <div className="card p-3">
            <Badge color="indigo">{t(NODE_LABELS[detail.relatedIdea.type as IdeaType]) ?? detail.relatedIdea.type}</Badge>
            <div className="font-medium mt-2">{detail.relatedIdea.label}</div>
            <p className="text-sm text-neutral-400 mt-1">{detail.relatedIdea.statement}</p>
            {onOpenGraph && (
              <button
                className="btn btn-ghost border border-neutral-700 text-xs gap-1.5 mt-3"
                onClick={() => {
                  onClose();
                  onOpenGraph({
                    preset: 'overview',
                    nodeId: detail.relatedIdea?.global_id,
                    label: `${t('Idea:')} ${detail.relatedIdea?.label ?? t('relacionada')}`,
                  });
                }}
              >
                <Icon name="layers" size={13} /> {t('Conexiones de la idea')}
              </button>
            )}
          </div>
        </div>
      )}

      {detail.evidence && (
        <div>
          <div className="text-xs uppercase text-neutral-500 mb-1">{t('Evidencia anclada')}</div>
          <blockquote className="border-l-2 border-amber-700 pl-3 py-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md">
            “{detail.evidence.quote}”{' '}
            <span className="text-neutral-500 not-italic">
              {detail.evidence.location ?? ''} · {detail.evidence.kind}
            </span>
          </blockquote>
        </div>
      )}
    </div>
  );
}

function ContradictionBody({
  edgeId,
  onClose,
  onOpenGraph,
}: {
  edgeId: string;
  onClose: () => void;
  onOpenGraph?: (target: PendingGraphNavigationTarget) => void;
}) {
  const [detail, setDetail] = useState<EdgeDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let on = true;
    setDetail(null);
    setMissing(false);
    void window.nodus.getEdgeDetail(edgeId).then((d) => {
      if (!on) return;
      if (d) setDetail(d);
      else setMissing(true);
    });
    return () => {
      on = false;
    };
  }, [edgeId]);

  if (missing) return <p className="text-sm text-neutral-400">{t('No se encontró la contradicción citada.')}</p>;
  if (!detail) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 bg-neutral-800 rounded w-1/3" />
        <div className="h-3 bg-neutral-800 rounded w-full" />
        <div className="h-3 bg-neutral-800 rounded w-2/3" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge color="red">{t(EDGE_LABELS[detail.edge.type as keyof typeof EDGE_LABELS]) ?? detail.edge.type}</Badge>
          <Badge color={detail.edge.basis === 'explicit' ? 'green' : 'amber'}>{detail.edge.basis}</Badge>
          <Badge>{t('conf')} {detail.edge.confidence.toFixed(2)}</Badge>
        </div>
        <h3 className="font-semibold mt-2">{t('Contradicción citada')}</h3>
        {detail.explanation && <p className="text-neutral-400 mt-1">{detail.explanation}</p>}
        <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950/45 p-3 text-sm">
          <span className="text-neutral-200">{detail.fromLabel}</span>
          <span className="px-2 text-red-300">×</span>
          <span className="text-neutral-200">{detail.toLabel}</span>
        </div>
        {onOpenGraph && (
          <button
            className="btn btn-primary gap-1.5 mt-3"
            onClick={() => {
              onClose();
              onOpenGraph({ preset: 'contradictions', edgeId: detail.edge.id, label: t('Contradicción citada') });
            }}
          >
            <Icon name="layers" size={14} /> {t('Ver en grafo')}
          </button>
        )}
      </div>

      {detail.evidence.length > 0 && (
        <div>
          <div className="text-xs uppercase text-neutral-500 mb-1">{t('Evidencia')}</div>
          {detail.evidence.map((ev) => (
            <blockquote key={ev.id} className="border-l-2 border-red-700 pl-3 py-2 my-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md">
              “{ev.quote}” <span className="text-neutral-500 not-italic">{ev.location ?? ''} · {ev.kind}</span>
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

function WorkBody({
  nodusId,
  onClose,
  onOpenGraph,
}: {
  nodusId: string;
  onClose: () => void;
  onOpenGraph?: (target: PendingGraphNavigationTarget) => void;
}) {
  const [work, setWork] = useState<WorkView | null>(null);
  const [meta, setMeta] = useState<WorkMeta | null>(null);
  const [summary, setSummary] = useState<WorkSummary | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let on = true;
    setWork(null);
    setMeta(null);
    setSummary(null);
    setMissing(false);
    void window.nodus.getWork(nodusId).then((w) => {
      if (!on) return;
      if (w) {
        setWork(w);
        void window.nodus.getWorkMeta(nodusId).then((m) => {
          if (on) setMeta(m);
        });
        void window.nodus.getWorkSummary(nodusId).then((value) => {
          if (on) setSummary(value);
        });
      } else {
        setMissing(true);
      }
    });
    return () => {
      on = false;
    };
  }, [nodusId]);

  if (missing) return <p className="text-sm text-neutral-400">{t('No se encontró el documento citado.')}</p>;
  if (!work) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 bg-neutral-800 rounded w-3/4" />
        <div className="h-3 bg-neutral-800 rounded w-1/2" />
      </div>
    );
  }

  const authors = meta?.authors?.length ? meta.authors : work.authors;
  const rawType = ITEM_TYPE_ES[meta?.itemType ?? work.item_type] ?? meta?.itemType ?? work.item_type;
  const type = t(rawType);
  const year = work.year ?? meta?.year ?? null;
  const venue: string[] = [];
  if (meta?.container) venue.push(meta.container);
  if (meta?.publisher) venue.push(meta.publisher);
  if (meta?.volume) venue.push(`${t('vol.')} ${meta.volume}${meta.issue ? `(${meta.issue})` : ''}`);
  else if (meta?.issue) venue.push(`${t('n.º')} ${meta.issue}`);
  if (meta?.pages) venue.push(`pp. ${meta.pages}`);
  else if (meta?.numPages) venue.push(`${meta.numPages} pp.`);
  if (meta?.place) venue.push(meta.place);

  return (
    <div className="space-y-3">
      <div>
        <Badge color="indigo">{type}</Badge>
        <h3 className="font-semibold mt-2">{work.title}</h3>
        {authors.length > 0 && (
          <div className="text-sm text-neutral-300 mt-1">
            {authors.slice(0, 4).join('; ')}
            {authors.length > 4 ? ' et al.' : ''}
          </div>
        )}
        {year && <div className="text-xs text-neutral-500 mt-0.5">{year}</div>}
        {venue.length > 0 && <div className="text-xs text-neutral-400 mt-1">{venue.join(' · ')}</div>}
        {meta?.doi && <div className="text-xs font-mono text-neutral-500 mt-1 truncate">doi:{meta.doi}</div>}
        {work.themes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {work.themes.slice(0, 8).map((theme) => (
              <Badge key={theme}>{theme}</Badge>
            ))}
          </div>
        )}
      </div>
      {summary && (
        <section className="rounded-md border border-violet-900/60 bg-violet-950/15 p-3">
          <div className="text-xs font-medium text-violet-200">{t('Resumen (orientación)')}</div>
          <p className="mt-1 text-sm leading-relaxed text-neutral-300">{summary.summary}</p>
          <p className="mt-2 text-[11px] text-neutral-500">{t('No es evidencia citable; sirve para situar la obra en el corpus.')}</p>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary gap-1.5"
          onClick={() => void window.nodus.openInZotero(work.zotero_key)}
        >
          <Icon name="external" size={14} /> {t('Abrir en Zotero')}
        </button>
        {onOpenGraph && (
          <button
            className="btn btn-ghost border border-neutral-700 gap-1.5"
            onClick={() => {
              onClose();
              onOpenGraph({
                preset: 'reading',
                workId: work.nodus_id,
                workTitle: work.title,
                zoteroKey: work.zotero_key,
                label: `${t('Ideas y conexiones:')} ${work.title}`,
              });
            }}
          >
            <Icon name="layers" size={14} /> {t('Ver ideas y conexiones')}
          </button>
        )}
      </div>
    </div>
  );
}
