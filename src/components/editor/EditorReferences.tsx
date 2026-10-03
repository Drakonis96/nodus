import { useEffect, useRef, useState } from 'react';
import type { SuggestionMenuProps } from '@blocknote/react';
import type { EditorReference, EditorReferenceKind } from '@shared/editorReferences';
import { Icon } from '../ui';
import { t } from '../../i18n';

const labels: Record<EditorReferenceKind, string> = { idea: 'Idea', author: 'Autor', work: 'Obra', note: 'Nota', studyDocument: 'Documento', studyMaterial: 'Material', passage:'Pasaje' };
const icons = { idea: 'bulb', author: 'graduation', work: 'book', note: 'notebook', studyDocument: 'notebook', studyMaterial: 'book', passage:'book' } as const;
export interface ReferenceSuggestion { reference?: EditorReference; message?: 'empty' | 'error'; query: string }

export function ReferenceSuggestionMenu({ items, selectedIndex, loadingState, onItemClick }: SuggestionMenuProps<ReferenceSuggestion>) {
  const [limit, setLimit] = useState(50);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setLimit(50), [items]);
  useEffect(() => {
    if (selectedIndex !== undefined && selectedIndex >= limit) setLimit(selectedIndex + 1);
    const list = root.current?.querySelector<HTMLElement>('.editorial-reference-results');
    const option = root.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list && option) {
      const bounds = list.getBoundingClientRect(), selected = option.getBoundingClientRect();
      if (selected.bottom > bounds.bottom) list.scrollTop += selected.bottom - bounds.bottom;
      else if (selected.top < bounds.top) list.scrollTop += selected.top - bounds.top;
    }
  }, [selectedIndex, limit, items]);
  const message = items[0]?.message;
  return <div ref={root} id="bn-suggestion-menu" role="listbox" aria-label={t('Enlazar con Nodus')} className="editorial-reference-menu" data-testid="editor-reference-menu">
    <header><Icon name="link" size={14} /><b>{t('Enlazar con Nodus')}</b><small>{!message && items.length || ''}</small></header>
    <div className="editorial-reference-results" onScroll={event => { const el = event.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) setLimit(value => Math.min(items.length, value + 50)); }}>
      {loadingState === 'loading-initial' ? <p role="status">{t('Cargando…')}</p> : message ? <p role="status">{t(message === 'error' ? 'No se pudieron cargar las referencias. Vuelve a escribir para reintentar.' : 'No hay referencias coincidentes.')}</p> : items.slice(0, limit).map((item, index) => {
        const reference = item.reference!;
        return <button type="button" role="option" key={reference.href} id={`bn-suggestion-menu-item-${index}`} aria-selected={index === selectedIndex} data-reference-href={reference.href} onClick={() => onItemClick?.(item)}>
          <Icon name={icons[reference.kind]} size={15} /><span><b>{reference.title}</b>{reference.subtitle && <small>{reference.subtitle}</small>}</span><em>{t(labels[reference.kind])}</em>
        </button>;
      })}
      {!message && limit < items.length && <button type="button" className="editorial-reference-more" onClick={() => setLimit(value => value + 50)}>{t('Mostrar más')}</button>}
    </div>
    <footer>{t('↑↓ elegir · Enter enlazar · Esc cerrar')}</footer>
  </div>;
}

export function EditorialReferences({ items, onOpen }: { items: EditorReference[]; onOpen(href: string): void }) {
  return <section className="editorial-linked-references" data-testid="editor-linked-references"><h3>{t('Referencias del texto')}</h3>{items.length ? items.map(item => <button type="button" key={item.href} onClick={() => onOpen(item.href)}><Icon name={icons[item.kind]} size={14} /><span>{item.title}</span><small>{t(labels[item.kind])}</small></button>) : <p>{t('Escribe [[ para enlazar ideas, autores, obras o documentos.')}</p>}</section>;
}
