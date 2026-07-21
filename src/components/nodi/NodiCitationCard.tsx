import { useEffect, useState } from 'react';
import type { MarkdownCitation } from '../Markdown';
import { Icon } from '../ui';
import { t } from '../../i18n';

/**
 * Compact source detail for a citation clicked inside a Nodi chat answer. It is the
 * companion's own take on the research assistant's SourceCitationModal: rendered as an
 * absolute overlay INSIDE the chat panel (never a viewport-fixed modal, so it works in the
 * transparent always-on-top overlay window too) and styled with `nodi-*` classes so it
 * inherits Nodi's light/dark theme and vault accent. It resolves the citation against the
 * corpus through the same read-only IPC the main app uses.
 */
interface CiteView {
  badge: string;
  title: string;
  statement?: string | null;
  quote?: string | null;
  meta?: string | null;
  location?: string | null;
  zoteroKey?: string | null;
}

function badgeFor(kind: MarkdownCitation['kind']): string {
  switch (kind) {
    case 'idea':
      return t('idea');
    case 'work':
      return t('documento');
    case 'gap':
      return t('hueco de investigación');
    case 'contradiction':
      return t('contradicción');
    case 'passage':
      return t('pasaje');
  }
}

function missingFor(kind: MarkdownCitation['kind']): string {
  switch (kind) {
    case 'idea':
      return t('No se encontró la idea citada en el grafo actual.');
    case 'work':
      return t('No se encontró el documento citado.');
    case 'gap':
      return t('No se encontró el hueco citado.');
    case 'contradiction':
      return t('No se encontró la contradicción citada.');
    case 'passage':
      return t('No se encontró el pasaje citado. Puede haberse reindexado.');
  }
}

function authorYear(authors: string[] | undefined, year: number | null | undefined): string {
  const who = authors && authors.length ? authors.slice(0, 3).join('; ') + (authors.length > 3 ? ' et al.' : '') : t('Autoría no disponible');
  return year ? `${who} · ${year}` : who;
}

export function NodiCitationCard({ citation, isOverlay, onClose }: { citation: MarkdownCitation; isOverlay: boolean; onClose: () => void }) {
  const [view, setView] = useState<CiteView | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let on = true;
    setView(null);
    setMissing(false);
    const settle = (value: CiteView | null) => {
      if (!on) return;
      if (value) setView(value);
      else setMissing(true);
    };
    const fail = () => on && setMissing(true);

    if (citation.kind === 'idea') {
      void window.nodus.getIdeaDetail(citation.id).then((d) => {
        if (!d) return settle(null);
        const work = d.occurrences[0]?.work;
        settle({
          badge: badgeFor('idea'),
          title: d.idea.label,
          statement: d.idea.statement,
          meta: work ? authorYear(work.authors, work.year) : null,
          zoteroKey: work?.zotero_key ?? null,
        });
      }).catch(fail);
    } else if (citation.kind === 'work') {
      void window.nodus.getWork(citation.id).then((w) => {
        if (!w) return settle(null);
        settle({
          badge: badgeFor('work'),
          title: w.title,
          meta: authorYear(w.authors, w.year),
          zoteroKey: w.zotero_key,
        });
      }).catch(fail);
    } else if (citation.kind === 'gap') {
      void window.nodus.getGapDetail(citation.id).then((d) => {
        if (!d) return settle(null);
        settle({
          badge: badgeFor('gap'),
          title: t('Hueco de investigación'),
          statement: d.gap.statement,
          quote: d.evidence?.quote ?? null,
          location: d.evidence?.location ?? null,
          meta: authorYear(d.work.authors, d.work.year),
          zoteroKey: d.work.zotero_key,
        });
      }).catch(fail);
    } else if (citation.kind === 'contradiction') {
      void window.nodus.getEdgeDetail(citation.id).then((d) => {
        if (!d) return settle(null);
        settle({
          badge: badgeFor('contradiction'),
          title: `${d.fromLabel} × ${d.toLabel}`,
          statement: d.explanation ?? null,
          quote: d.evidence[0]?.quote ?? null,
          location: d.evidence[0]?.location ?? null,
        });
      }).catch(fail);
    } else {
      void window.nodus.getPassage(citation.id).then((d) => {
        if (!d) return settle(null);
        settle({
          badge: badgeFor('passage'),
          title: d.work.title,
          quote: d.text,
          location: d.page_label,
          meta: authorYear(d.work.authors, d.work.year),
          zoteroKey: d.work.zotero_key,
        });
      }).catch(fail);
    }
    return () => {
      on = false;
    };
  }, [citation.kind, citation.id]);

  return (
    <div className="nodi-cite-overlay" onClick={onClose}>
      <div className="nodi-cite-card" role="dialog" aria-modal="true" aria-label={t('Fuente citada')} onClick={(e) => e.stopPropagation()}>
        <div className="nodi-cite-head">
          <Icon name="book" size={14} />
          <span>{t('Fuente citada')}</span>
          <span className="grow" />
          <button onClick={onClose} title={t('Cerrar')} aria-label={t('Cerrar')}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="nodi-cite-body">
          {missing ? (
            <p className="nodi-cite-missing">{missingFor(citation.kind)}</p>
          ) : !view ? (
            <div className="nodi-cite-loading">{t('Cargando…')}</div>
          ) : (
            <>
              <span className="nodi-cite-kind">{view.badge}</span>
              <h4 className="nodi-cite-title">{view.title}</h4>
              {view.meta && <div className="nodi-cite-meta">{view.meta}</div>}
              {view.statement && <p className="nodi-cite-text">{view.statement}</p>}
              {view.quote && (
                <blockquote className="nodi-cite-quote">
                  “{view.quote}”
                  {view.location && <span className="nodi-cite-loc"> · {view.location}</span>}
                </blockquote>
              )}
              {(view.zoteroKey || isOverlay) && (
                <div className="nodi-cite-actions">
                  {view.zoteroKey && (
                    <button className="nodi-cite-btn primary" onClick={() => void window.nodus.openInZotero(view.zoteroKey!)}>
                      <Icon name="external" size={13} /> {t('Abrir en Zotero')}
                    </button>
                  )}
                  {isOverlay && (
                    <button className="nodi-cite-btn" onClick={() => window.nodus.nodiOpenMainWindow()}>
                      <Icon name="external" size={13} /> {t('Abrir Nodus')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
