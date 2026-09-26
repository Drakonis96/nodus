import { useMemo, useState } from 'react';
import { Icon } from '../ui';
import { useDismissableLayer } from '../../hooks';
import { t } from '../../i18n';

export interface MultiSelectOption { value: string; label: string; count?: number }

/** A styled dropdown whose options are checkboxes: none selected means no cut, and an
 * item matches when it matches any selected option. Long lists get a search box. */
export function MultiSelectDropdown({ label, icon, options, selected, onChange, testId }: {
  label: string;
  icon?: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useDismissableLayer<HTMLDivElement>({ open, onDismiss: () => setOpen(false), group: 'global-library-filter-dropdown' });
  // Keep a selected value listed even when the current catalogue no longer offers it.
  const all = useMemo<MultiSelectOption[]>(() => [...options, ...selected.filter(value => !options.some(option => option.value === value)).map(value => ({ value, label: value }))], [options, selected]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = needle ? all.filter(option => option.label.toLocaleLowerCase().includes(needle)) : all;
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter(entry => entry !== value) : [...selected, value]);
  const summary = selected.length === 0 ? t('Todos')
    : selected.map(value => all.find(option => option.value === value)?.label ?? value).join(', ');
  return (
    <div className="relative min-w-0" ref={ref} data-testid={testId}>
      <span className="mb-1 block text-[11px] font-medium text-neutral-500">{label}</span>
      <button
        type="button"
        className={`library-multiselect-trigger flex h-9 w-full items-center gap-2 rounded-lg border px-2.5 text-left text-xs ${selected.length ? 'is-active border-indigo-500/60 bg-indigo-500/10 text-indigo-100' : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-600'}`}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {icon && <Icon name={icon} size={13} className="shrink-0 opacity-70" />}
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {selected.length > 1 && <span className="rounded bg-indigo-500/25 px-1.5 text-[10px] font-semibold tabular-nums">{selected.length}</span>}
        <Icon name="chevronDown" size={13} className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" aria-label={label} className="library-multiselect-menu absolute left-0 z-50 mt-1 w-full min-w-[14rem] rounded-lg border border-neutral-700 bg-neutral-950 p-1.5 shadow-2xl">
          {all.length > 8 && <input autoFocus className="input mb-1.5 w-full py-1 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar…')} />}
          <div className="max-h-60 overflow-y-auto">
            {visible.map(option => {
              const checked = selected.includes(option.value);
              return (
                <button key={option.value} type="button" role="option" aria-selected={checked}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-800 ${checked ? 'bg-indigo-950/50 text-indigo-100' : 'text-neutral-300'}`}
                  onClick={() => toggle(option.value)}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-neutral-600'}`}>
                    {checked && <Icon name="check" size={12} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.count !== undefined && <span className="tabular-nums text-neutral-500">{option.count}</span>}
                </button>
              );
            })}
            {visible.length === 0 && <p className="px-2 py-2 text-xs text-neutral-500">{t('Sin resultados')}</p>}
          </div>
          {selected.length > 0 && <div className="mt-1 border-t border-neutral-800 pt-1"><button type="button" className="btn btn-ghost w-full justify-center py-1 text-xs" onClick={() => onChange([])}>{t('Limpiar')}</button></div>}
        </div>
      )}
    </div>
  );
}
