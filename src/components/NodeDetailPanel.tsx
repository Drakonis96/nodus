import { useEffect, useState } from 'react';
import type { EdgeDetail, IdeaDetail, IdeaType, WorkMeta, WorkView } from '@shared/types';
import { EDGE_LABELS, NODE_LABELS, Badge, Icon } from './ui';

// Persisted detail-panel sizing, shared by the graph view and the argument map.
export const DETAIL_WIDTH_KEY = 'nodus.graph.detailWidth';
export const DETAIL_FONT_KEY = 'nodus.graph.detailFontSize';

export const DETAIL_MIN_WIDTH = 320;
export const DETAIL_MAX_WIDTH = 720;
export const DETAIL_DEFAULT_WIDTH = 384;
export const DETAIL_MIN_FONT = 12;
export const DETAIL_MAX_FONT = 20;
export const DETAIL_DEFAULT_FONT = 14;

export function loadNumber(key: string, fallback: number, min: number, max: number): number {
  const parsed = Number(localStorage.getItem(key));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export interface DetailLoading {
  kind: 'idea' | 'edge';
  id: string;
  label: string;
  type?: string;
}

/**
 * Right-hand detail panel. Opens instantly with a loading skeleton when
 * `loading` is set (so taps/selections never feel frozen), then fills with the
 * idea or edge detail. Reused by the graph view and the argument map.
 */
export function NodeDetailPanel({
  ideaDetail,
  edgeDetail,
  loading,
  width,
  fontSize,
  onWidthChange,
  onFontChange,
  onClose,
}: {
  ideaDetail: IdeaDetail | null;
  edgeDetail: EdgeDetail | null;
  loading: DetailLoading | null;
  width: number;
  fontSize: number;
  onWidthChange: (width: number) => void;
  onFontChange: (delta: number) => void;
  onClose: () => void;
}) {
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (evt: PointerEvent) => {
      onWidthChange(Math.min(DETAIL_MAX_WIDTH, Math.max(DETAIL_MIN_WIDTH, startWidth + startX - evt.clientX)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  return (
    <div className="relative shrink-0 border-l border-neutral-800 bg-neutral-900/95 overflow-y-auto p-4 graph-detail-panel" style={{ width, '--detail-font-size': `${fontSize}px` } as React.CSSProperties}>
      <div
        className="absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize hover:bg-indigo-500/25"
        role="separator"
        aria-orientation="vertical"
        title="Ajustar ancho"
        onPointerDown={startResize}
      />
      <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-3 flex items-center justify-end gap-1 border-b border-neutral-800 bg-neutral-900/95 px-4 py-2">
        <button className="card bg-neutral-900 px-2 py-1 hover:bg-neutral-800 text-xs" title="Disminuir texto" onClick={() => onFontChange(-1)}>
          a
        </button>
        <button className="card bg-neutral-900 px-2 py-1 hover:bg-neutral-800 text-sm font-semibold" title="Aumentar texto" onClick={() => onFontChange(1)}>
          A
        </button>
        <button className="ml-2 text-neutral-500 hover:text-white" title="Cerrar" onClick={onClose}>
          ✕
        </button>
      </div>
      {loading && !ideaDetail && !edgeDetail && (
        <div className="space-y-3 animate-pulse">
          {loading.kind === 'idea' ? (
            <>
              <div>
                <Badge color="indigo">{NODE_LABELS[loading.type as IdeaType] ?? loading.type ?? ''}</Badge>
                <h3 className="font-semibold mt-2">{loading.label}</h3>
                <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
                <div className="h-3 bg-neutral-800 rounded mt-1.5 w-full" />
                <div className="h-3 bg-neutral-800 rounded mt-1.5 w-5/6" />
              </div>
              <div>
                <div className="text-xs uppercase text-neutral-500 mb-1">Obras que la desarrollan</div>
                <div className="card p-3 mb-2">
                  <div className="h-3 bg-neutral-800 rounded w-2/3" />
                  <div className="h-2.5 bg-neutral-800 rounded mt-2 w-1/2" />
                </div>
                <div className="card p-3 mb-2">
                  <div className="h-3 bg-neutral-800 rounded w-3/4" />
                  <div className="h-2.5 bg-neutral-800 rounded mt-2 w-2/5" />
                </div>
              </div>
            </>
          ) : (
            <>
              <h3 className="font-semibold">{EDGE_LABELS[loading.label as keyof typeof EDGE_LABELS] ?? loading.label}</h3>
              <div className="h-3 bg-neutral-800 rounded w-1/2" />
              <div className="h-3 bg-neutral-800 rounded mt-2 w-3/4" />
            </>
          )}
        </div>
      )}
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
              <OccurrenceCard key={o.nodus_id} occurrence={o} />
            ))}
          </div>
          {ideaDetail.evidence.length > 0 && (
            <div>
              <div className="text-xs uppercase text-neutral-500 mb-1">Evidencia anclada</div>
              {ideaDetail.evidence.map((ev) => (
                <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-3 py-2 my-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md">
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
          {edgeDetail.explanation && <p className="text-neutral-300">{edgeDetail.explanation}</p>}
          <div className="text-neutral-400">
            <span className="text-neutral-200">{edgeDetail.fromLabel}</span> → <span className="text-neutral-200">{edgeDetail.toLabel}</span>
          </div>
          <div className="flex gap-2">
            <Badge color={edgeDetail.edge.basis === 'explicit' ? 'green' : 'amber'}>{edgeDetail.edge.basis}</Badge>
            <Badge>conf {edgeDetail.edge.confidence.toFixed(2)}</Badge>
          </div>
          {edgeDetail.evidence.map((ev) => (
            <blockquote key={ev.id} className="border-l-2 border-indigo-700 pl-3 py-2 my-2 text-xs text-neutral-300 italic bg-neutral-950/35 rounded-r-md">
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

export function OccurrenceCard({ occurrence }: { occurrence: IdeaDetail['occurrences'][number] }) {
  const [open, setOpen] = useState(false);
  const work = occurrence.work;
  const author = work.authors[0] ?? 'Autor desconocido';
  const year = work.year ?? 's.f.';

  return (
    <div className="card p-3 mb-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-xs truncate">{work.title}</div>
          <div className="text-[11px] text-neutral-400 mt-0.5">
            {author}
            {work.authors.length > 1 ? ' et al.' : ''} ({year})
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            className="inline-flex items-center justify-center text-neutral-500 hover:text-neutral-200 p-1"
            title={open ? 'Ocultar metadatos' : 'Mostrar metadatos'}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name="info" size={14} />
          </button>
          <button
            className="inline-flex items-center gap-1 text-indigo-400 text-xs p-1 hover:text-indigo-300"
            title="Abrir en Zotero"
            onClick={() => window.nodus.openInZotero(work.zotero_key)}
          >
            <Icon name="external" size={13} /> Zotero
          </button>
        </div>
      </div>
      {open && <OccurrenceMeta work={work} />}
      <div className="text-[11px] text-neutral-500 mt-2">
        {occurrence.role} · conf {occurrence.confidence.toFixed(2)}
      </div>
      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">{occurrence.development}</p>
    </div>
  );
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
