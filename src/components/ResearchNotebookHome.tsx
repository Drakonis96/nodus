import { useEffect, useState } from 'react';
import type { ResearchCorpusCollection, ResearchNotebook, ResearchNotebookPreparation, ResearchSourceReference } from '@shared/researchCorpus';
import { CollectionSourceIcon } from './CollectionSourceIcon';
import { openResearchPreparationQueue } from './ResearchPreparationWelcome';
import { Icon } from './ui';
import { t, tx } from '../i18n';

const referenceKey = (source: ResearchSourceReference) => JSON.stringify([source.kind, source.id, source.libraryType, source.libraryId]);

/** A notebook's page heading: its icon and name, and the collections it reads. */
export function NotebookHomeHeader({ notebook, onEdit }: { notebook: ResearchNotebook; onEdit: () => void }) {
  const [collections, setCollections] = useState<Map<string, ResearchCorpusCollection> | null>(null);
  useEffect(() => {
    let active = true;
    void window.nodus.getResearchCorpusSources().then(sources => {
      if (active) setCollections(new Map(sources.collections.map(collection => [referenceKey(collection.reference), collection])));
    }).catch(() => { if (active) setCollections(new Map()); });
    return () => { active = false; };
  }, [notebook.id, notebook.revision]);
  const chosen = notebook.sources.filter(source => source.kind === 'library-collection' || source.kind === 'zotero-collection');
  return <header className="research-project-title research-notebook-title" data-testid="research-notebook-title">
    <div className="research-notebook-title-row">
      <span style={{ color: notebook.color ?? undefined }}><Icon name={notebook.icon ?? 'notebook'} size={30} /></span>
      <h2>{notebook.name}</h2>
    </div>
    <div className="research-notebook-sources" aria-label={t('Colecciones')}>
      {chosen.map(source => {
        const collection = collections?.get(referenceKey(source));
        const origin = collection?.origin ?? (source.kind === 'zotero-collection' ? 'zotero' : 'nodus');
        return <span key={referenceKey(source)} className="research-notebook-source">
          <CollectionSourceIcon origin={origin} size={15} />
          <span>{collection?.name ?? (collections ? t('Colección no disponible') : '…')}</span>
        </span>;
      })}
      <button type="button" className="research-notebook-edit" onClick={onEdit}><Icon name="edit" size={13} />{t('Editar colecciones')}</button>
    </div>
  </header>;
}

/** While a notebook's collections are being indexed, it says so and points at the queue. */
export function NotebookIndexingBanner({ preparation }: { preparation: ResearchNotebookPreparation | null }) {
  if (!preparation) return <p className="research-notebook-banner" role="status" data-testid="research-notebook-banner" data-state="checking"><Icon name="clock" size={15} />{t('Comprobando las colecciones del cuaderno…')}</p>;
  const failed = preparation.failed.length;
  if (!preparation.pending && !failed && preparation.total) return null;
  const openQueue = <button type="button" className="research-notebook-banner-action" onClick={() => openResearchPreparationQueue()}>{t('Ver cola')}</button>;
  if (!preparation.total) return <p className="research-notebook-banner" role="status" data-testid="research-notebook-banner" data-state="empty"><Icon name="info" size={15} />{t('Las colecciones de este cuaderno aún no tienen documentos.')}</p>;
  return <div className="research-notebook-banner" role="status" data-testid="research-notebook-banner" data-state={preparation.pending ? 'indexing' : 'partial'}>
    {preparation.pending > 0 && <p>
      <Icon name={preparation.paused ? 'pause' : 'refresh'} size={15} className={preparation.paused ? '' : 'research-notebook-spin'} />
      <span>{preparation.paused
        ? tx('La indexación está en pausa: {ready} de {total} documentos listos.', { ready: preparation.ready, total: preparation.total })
        : tx('Indexando tus colecciones: {ready} de {total} documentos listos. Podrás usar el cuaderno cuando termine.', { ready: preparation.ready, total: preparation.total })}</span>
      {openQueue}
    </p>}
    {failed > 0 && <p className="is-warning" title={preparation.failed.map(item => item.title).join('\n')}>
      <Icon name="warning" size={15} />
      <span>{tx('{n} documento(s) no se pudieron indexar y no se consultarán.', { n: failed })}</span>
      {!preparation.pending && openQueue}
    </p>}
  </div>;
}
