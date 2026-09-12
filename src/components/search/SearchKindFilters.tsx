import { Icon } from '../ui';
import { t } from '../../i18n';

export interface SearchKindOption<K extends string> { kind: K; label: string; icon: string }
export function toggleSearchKind<K extends string>(selected: ReadonlySet<K>, kind: K): Set<K> {
  const next = new Set(selected);
  if (next.has(kind)) next.delete(kind); else next.add(kind);
  return next;
}
/** The same always-visible, multi-select filter bar in every vault. Empty means no types. */
export function SearchKindFilters<K extends string>({ options, selected, onChange, disabled = false }: {
  options: readonly SearchKindOption<K>[]; selected: ReadonlySet<K>;
  onChange: (next: Set<K>) => void; disabled?: boolean;
}) {
  return <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('Tipo de contenido')}>
    {options.map(({ kind, label, icon }) => <button key={kind} type="button" aria-pressed={selected.has(kind)} disabled={disabled}
      onClick={() => onChange(toggleSearchKind(selected, kind))}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${selected.has(kind)
        ? 'border-indigo-600 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
        : 'border-neutral-300 text-neutral-500 hover:text-neutral-700 dark:border-neutral-700 dark:hover:text-neutral-300'}`}>
      <Icon name={icon} size={12} />{t(label)}
    </button>)}
  </div>;
}
