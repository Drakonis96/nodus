import { Icon } from '../ui';
import { compassT } from '../../i18n.compass';
import { VirtualList } from '../VirtualList';
import type { CompassResult } from './types';

function creatorLine(item: CompassResult): string {
  const names = item.authors?.map((author) => author.name).filter(Boolean) ?? [];
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
}
function typeLabel(type: CompassResult['type']): string { return compassT(({ article: 'Artículo', book: 'Libro', chapter: 'Capítulo', thesis: 'Tesis', report: 'Informe', dataset: 'Conjunto de datos', preprint: 'Prepublicación', other: 'Otro' } as const)[type]); }

export function CompassResultList({ results, selected, saved, dismissed, onToggle, onOpen, onSave, onDismiss, onSimilar, anchorId, onAnchorChange }: {
  results: CompassResult[]; selected: Set<string>; saved: Set<string>; dismissed: Set<string>; onToggle: (item: CompassResult) => void; onOpen: (item: CompassResult) => void;
  onSave: (item: CompassResult) => void; onDismiss: (item: CompassResult) => void; onSimilar: (item: CompassResult) => void;
  anchorId: string | null; onAnchorChange: (id: string | null) => void;
}) {
  return <VirtualList
    items={results}
    itemHeight={108}
    overscan={8}
    anchorKey={anchorId}
    onAnchorChange={(key) => onAnchorChange(key == null ? null : String(key))}
    getKey={(item) => item.canonicalKey}
    className="compass-results-list min-h-0 flex-1"
    empty={<div className="grid min-h-[18rem] place-items-center rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700"><div><Icon name="search" size={22} className="mx-auto mb-2" /><p>{compassT('Sin resultados')}</p><p className="mt-1 text-xs">{compassT('Prueba otra consulta o quita algún filtro.')}</p></div></div>}
    renderItem={(item) => <article className={`h-[100px] overflow-hidden rounded-xl border bg-white px-3 py-2.5 dark:bg-neutral-900/60 ${selected.has(item.canonicalKey) ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-neutral-200 dark:border-neutral-800'}`}>
      <div className="flex h-full items-start gap-2">
        <input type="checkbox" aria-label={`${compassT('Seleccionar')} ${item.title}`} checked={selected.has(item.canonicalKey)} onChange={() => onToggle(item)} className="mt-1" />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(item)}>
          <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{item.title || compassT('Sin título')}</h3>
          <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{creatorLine(item)}{item.issuedYear ? ` · ${item.issuedYear}` : ''} · {typeLabel(item.type)}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-4 text-neutral-600 dark:text-neutral-300">{item.provenance.map((source) => source.provider).join(', ')}{item.openAccess ? ` · ${compassT('Acceso abierto')}` : ''}</p>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" className="icon-btn h-7 w-7" aria-label={saved.has(item.canonicalKey) ? compassT('Guardado') : compassT('Guardar')} title={saved.has(item.canonicalKey) ? compassT('Guardado') : compassT('Guardar')} onClick={() => onSave(item)}><Icon name={saved.has(item.canonicalKey) ? 'bookmarkFill' : 'bookmark'} size={14} /></button>
          <button type="button" className="icon-btn h-7 w-7" aria-label={dismissed.has(item.canonicalKey) ? compassT('Restaurar') : compassT('Descartar')} title={dismissed.has(item.canonicalKey) ? compassT('Restaurar') : compassT('Descartar')} onClick={() => onDismiss(item)}><Icon name={dismissed.has(item.canonicalKey) ? 'undo' : 'x'} size={14} /></button>
          <button type="button" className="icon-btn h-7 w-7" aria-label={compassT('Similar')} title={compassT('Similar')} onClick={() => onSimilar(item)}><Icon name="sparkles" size={14} /></button>
        </div>
      </div>
    </article>}
  />;
}
