import { Icon } from '../ui';
import { compassT } from '../../i18n.compass';
import { COMPASS_PROVIDERS, type CompassFilters as Filters } from './types';

export function CompassFilters({ filters, onChange, open, onToggle, onClear }: {
  filters: Filters; onChange: (patch: Partial<Filters>) => void; open: boolean; onToggle: () => void; onClear: () => void;
}) {
  return <section className="border-t border-neutral-200 pt-3 dark:border-neutral-800" aria-label={compassT('Filtros')}>
    <div className="flex items-center gap-2">
      <button type="button" className="btn btn-ghost h-8 gap-1.5 text-xs" aria-expanded={open} onClick={onToggle}><Icon name="filter" size={14} /> {compassT('Filtros')}</button>
      {open && <button type="button" className="text-xs text-indigo-600 hover:underline dark:text-indigo-300" onClick={onClear}>{compassT('Limpiar filtros')}</button>}
    </div>
    {open && <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
      <label className="text-xs text-neutral-500">{compassT('Desde')}<input className="input mt-1 h-8 w-full text-xs" inputMode="numeric" value={filters.fromYear ?? ''} onChange={(e) => onChange({ fromYear: e.target.value ? Number(e.target.value.replace(/[^0-9]/g, '').slice(0, 4)) : undefined })} /></label>
      <label className="text-xs text-neutral-500">{compassT('Hasta')}<input className="input mt-1 h-8 w-full text-xs" inputMode="numeric" value={filters.toYear ?? ''} onChange={(e) => onChange({ toYear: e.target.value ? Number(e.target.value.replace(/[^0-9]/g, '').slice(0, 4)) : undefined })} /></label>
      <label className="text-xs text-neutral-500">{compassT('Idioma')}<select className="input mt-1 h-8 w-full text-xs" value={filters.languages?.[0] ?? ''} onChange={(e) => onChange({ languages: e.target.value ? [e.target.value] : undefined })}><option value="" />{['en', 'es', 'fr', 'de', 'it', 'pt', 'ca', 'ar'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <label className="text-xs text-neutral-500">{compassT('Tipo')}<select className="input mt-1 h-8 w-full text-xs" value={filters.types?.[0] ?? ''} onChange={(e) => onChange({ types: e.target.value ? [e.target.value as NonNullable<Filters['types']>[number]] : undefined })}><option value="" />{['article', 'book', 'chapter', 'thesis', 'report', 'dataset', 'preprint'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      <label className="text-xs text-neutral-500">{compassT('Disciplina')}<input className="input mt-1 h-8 w-full text-xs" value={filters.disciplines?.[0] ?? ''} onChange={(e) => onChange({ disciplines: e.target.value ? [e.target.value] : undefined })} /></label>
      <label className="text-xs text-neutral-500">{compassT('Proveedor')}<select className="input mt-1 h-8 w-full text-xs" value={filters.providers?.[0] ?? ''} onChange={(e) => onChange({ providers: e.target.value ? [e.target.value as NonNullable<Filters['providers']>[number]] : undefined })}><option value="" />{COMPASS_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
      <label className="flex items-end gap-2 pb-1 text-xs text-neutral-600 dark:text-neutral-300"><input type="checkbox" checked={filters.openAccessOnly ?? false} onChange={(e) => onChange({ openAccessOnly: e.target.checked })} /> {compassT('Solo acceso abierto')}</label>
    </div>}
  </section>;
}
