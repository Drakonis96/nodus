import { useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryCitationStyle, LibraryCitationStyleRecord } from '@shared/libraryTypes';
import { t, tx } from '../../i18n';
import { Icon } from '../ui';

export function normalizeCitationStyleSearch(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function matchesCitationStyleQuery(style: Pick<LibraryCitationStyleRecord, 'id' | 'title'>, rawQuery: string): boolean {
  const tokens = normalizeCitationStyleSearch(rawQuery).split(' ').filter(Boolean);
  const haystack = normalizeCitationStyleSearch(`${style.title} ${style.id}`);
  return tokens.every((token) => haystack.includes(token));
}

export function CitationStylePicker({ styles, value, onChange, disabled, testId = 'library-citation-style' }: {
  styles: LibraryCitationStyleRecord[];
  value: LibraryCitationStyle;
  onChange: (style: LibraryCitationStyle) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = styles.find((entry) => entry.id === value);
  const filtered = useMemo(() => styles.filter((entry) => matchesCitationStyleQuery(entry, query)), [query, styles]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return <div className="relative mt-2" ref={rootRef} data-testid={testId}>
    <button type="button" data-testid={`${testId}-trigger`} className="input flex w-full items-center justify-between gap-2 text-left" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="min-w-0 flex-1 truncate">{selected?.title ?? value}{selected && !selected.availableOffline ? ` · ${t('se descargará')}` : ''}</span>
      <Icon name="chevronDown" size={14} />
    </button>
    {open && <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
      <div className="relative border-b border-neutral-200 p-2 dark:border-neutral-800">
        <Icon name="search" size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input autoFocus data-testid={`${testId}-search`} className="input input-with-leading-icon h-8 w-full py-1 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar estilos de cita…')} />
      </div>
      <div className="max-h-60 overflow-y-auto" role="listbox" aria-label={t('Estilo de cita')}>
        {filtered.map((entry) => <button key={`${entry.source}:${entry.id}`} type="button" role="option" aria-selected={entry.id === value} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${entry.id === value ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`} onClick={() => { onChange(entry.id); setOpen(false); }}>
          <span className="min-w-0 flex-1"><b className="block truncate font-medium">{entry.title}</b><span className="block truncate text-[10px] text-neutral-500">{entry.id}{entry.availableOffline ? '' : ` · ${t('se descargará')}`}</span></span>
          {entry.id === value && <Icon name="check" size={13} />}
        </button>)}
        {!filtered.length && <p className="px-3 py-4 text-xs text-neutral-500">{tx('Ningún estilo coincide con «{query}».', { query })}</p>}
      </div>
    </div>}
  </div>;
}
