import { useEffect, useState } from 'react';
import { Icon } from '../ui';
import { compassT } from '../../i18n.compass';

export function CompassSearchBar({ value, busy, onSearch, onCancel, ai, onAiChange }: {
  value: string; busy: boolean; onSearch: (value: string) => void; onCancel: () => void; ai: boolean; onAiChange: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); onSearch(draft.trim()); }}>
      <label className="sr-only" htmlFor="compass-query">{compassT('Buscar literatura')}</label>
      <div className="relative min-w-[16rem] flex-1">
        <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400" />
        <input id="compass-query" data-testid="compass-query" value={draft} onChange={(event) => setDraft(event.target.value)}
          placeholder={compassT('Buscar literatura')} className="input input-with-leading-icon h-10 w-full" style={{ paddingLeft: '2.75rem' }} autoComplete="off" />
      </div>
      <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-neutral-200 px-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
        <input type="checkbox" checked={ai} onChange={(event) => onAiChange(event.target.checked)} /> {compassT('Interpretar con IA')}
      </label>
      {busy ? <button type="button" className="btn btn-ghost h-10" onClick={onCancel}><Icon name="stop" size={14} /> {compassT('Cancelar')}</button>
        : <button type="submit" data-testid="compass-search" className="btn btn-primary h-10 gap-1.5 bg-indigo-600 px-4 text-white hover:bg-indigo-500"><Icon name="search" size={14} /> {compassT('Buscar')}</button>}
    </form>
  );
}
