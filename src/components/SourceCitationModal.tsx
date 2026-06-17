import { useEffect, useState } from 'react';
import type { IdeaDetail, WorkMeta, WorkView } from '@shared/types';
import { Badge, Icon } from './ui';
import { OccurrenceCard } from './NodeDetailPanel';

export type CitationTarget =
  | { kind: 'idea'; id: string }
  | { kind: 'work'; id: string }
  | null;

/**
 * NotebookLM-style source modal opened from inline citations in the research
 * assistant. For ideas it reproduces the graph sidebar detail (label, statement,
 * developing works with their Zotero link, anchored evidence); for documents it
 * shows the bibliographic metadata and a Zotero open action.
 */
export function SourceCitationModal({ target, onClose }: { target: CitationTarget; onClose: () => void }) {
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
          <span className="font-semibold text-sm">Fuente citada</span>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose} title="Cerrar">
            <Icon name="x" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {target?.kind === 'idea' && <IdeaBody globalId={target.id} />}
          {target?.kind === 'work' && <WorkBody nodusId={target.id} />}
        </div>
      </div>
    </div>
  );
}

function IdeaBody({ globalId }: { globalId: string }) {
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
    return <p className="text-sm text-neutral-400">No se encontró la idea citada en el grafo actual.</p>;
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
        <Badge color="indigo">{detail.idea.type}</Badge>
        <h3 className="font-semibold mt-2">{detail.idea.label}</h3>
        <p className="text-neutral-400 mt-1">{detail.idea.statement}</p>
      </div>
      <div>
        <div className="text-xs uppercase text-neutral-500 mb-1">Obras que la desarrollan</div>
        {detail.occurrences.length === 0 && <p className="text-xs text-neutral-500">Sin obras vinculadas.</p>}
        {detail.occurrences.map((o) => (
          <OccurrenceCard key={o.nodus_id} occurrence={o} />
        ))}
      </div>
      {detail.evidence.length > 0 && (
        <div>
          <div className="text-xs uppercase text-neutral-500 mb-1">Evidencia anclada</div>
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

function WorkBody({ nodusId }: { nodusId: string }) {
  const [work, setWork] = useState<WorkView | null>(null);
  const [meta, setMeta] = useState<WorkMeta | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let on = true;
    setWork(null);
    setMeta(null);
    setMissing(false);
    void window.nodus.getWork(nodusId).then((w) => {
      if (!on) return;
      if (w) {
        setWork(w);
        void window.nodus.getWorkMeta(nodusId).then((m) => {
          if (on) setMeta(m);
        });
      } else {
        setMissing(true);
      }
    });
    return () => {
      on = false;
    };
  }, [nodusId]);

  if (missing) return <p className="text-sm text-neutral-400">No se encontró el documento citado.</p>;
  if (!work) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 bg-neutral-800 rounded w-3/4" />
        <div className="h-3 bg-neutral-800 rounded w-1/2" />
      </div>
    );
  }

  const authors = meta?.authors?.length ? meta.authors : work.authors;
  const type = ITEM_TYPE_ES[meta?.itemType ?? work.item_type] ?? meta?.itemType ?? work.item_type;
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
      </div>
      <button
        className="btn btn-primary gap-1.5 self-start"
        onClick={() => void window.nodus.openInZotero(work.zotero_key)}
      >
        <Icon name="external" size={14} /> Abrir en Zotero
      </button>
    </div>
  );
}
