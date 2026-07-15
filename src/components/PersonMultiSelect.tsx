import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Person } from '@shared/types';
import { Icon } from './ui';
import { t } from '../i18n';

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

export function PersonMultiSelect({
  persons,
  selectedIds,
  onChange,
  placeholder,
  maxSelected,
  testId,
}: {
  persons: Person[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  maxSelected?: number;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const personById = useMemo(() => new Map(persons.map((person) => [person.personId, person])), [persons]);
  const selected = selectedIds.map((id) => personById.get(id)).filter((person): person is Person => Boolean(person));
  const filtered = useMemo(() => {
    const normalized = normalizeSearch(query.trim());
    return persons.filter((person) => !normalized || normalizeSearch(person.displayName).includes(normalized));
  }, [persons, query]);
  const atLimit = maxSelected != null && selectedIds.length >= maxSelected;

  const updatePopoverPosition = useCallback(() => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const width = Math.max(240, rect.width);
    const estimatedHeight = 310;
    const openAbove = window.innerHeight - rect.bottom < estimatedHeight && rect.top > window.innerHeight - rect.bottom;
    const top = openAbove ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4;
    const availableHeight = openAbove ? rect.top - top - 4 : window.innerHeight - top - 8;
    setPopoverStyle({
      position: 'fixed',
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top,
      width,
      maxHeight: Math.max(96, availableHeight),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open, updatePopoverPosition]);

  const toggle = (personId: string) => {
    if (selectedIds.includes(personId)) onChange(selectedIds.filter((id) => id !== personId));
    else if (!atLimit) onChange([...selectedIds, personId]);
  };

  return (
    <div ref={rootRef} className="person-multi-select relative" data-testid={testId}>
      <button
        type="button"
        className="input flex min-h-9 w-full items-center gap-1.5 px-2 py-1 text-left text-sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`min-w-0 flex-1 truncate ${selected.length === 0 ? 'text-neutral-500' : 'text-neutral-200'}`}>
          {selected.length === 0 ? placeholder : selected.map((person) => person.displayName).join(', ')}
        </span>
        {selected.length > 1 && <span className="shrink-0 rounded-full bg-indigo-600/20 px-1.5 text-[10px] text-indigo-300">{selected.length}</span>}
        <Icon name="chevronDown" size={13} className="shrink-0 text-neutral-500" />
      </button>
      {open && createPortal(
        <div ref={popoverRef} style={popoverStyle} className="person-multi-select-popover z-[80] flex flex-col rounded-md border border-neutral-800 bg-neutral-950 p-2 shadow-2xl">
          <div className="relative mb-1.5">
            <Icon name="search" size={13} className="pointer-events-none absolute left-2 top-2 text-neutral-500" />
            <input
              className="input h-8 w-full text-xs"
              style={{ paddingLeft: '1.9rem' }}
              placeholder={t('Buscar familiar…')}
              value={query}
              autoFocus
              data-testid={testId ? `${testId}-search` : undefined}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="min-h-0 max-h-56 flex-1 space-y-0.5 overflow-y-auto" role="listbox" aria-multiselectable="true">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-neutral-600">{t('Sin coincidencias')}</p>
            ) : filtered.map((person) => {
              const checked = selectedIds.includes(person.personId);
              const disabled = atLimit && !checked;
              return (
                <label
                  key={person.personId}
                  role="option"
                  aria-selected={checked}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-neutral-900'}`}
                >
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(person.personId)} />
                  <span className="min-w-0 flex-1 truncate text-neutral-200">{person.displayName}</span>
                  {person.birthDate && <span className="shrink-0 text-[10px] text-neutral-600">{person.birthDate}</span>}
                </label>
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-neutral-800 pt-1.5">
            <span className="text-[10px] text-neutral-600">
              {maxSelected != null ? t('{count} de {max} seleccionados').replace('{count}', String(selectedIds.length)).replace('{max}', String(maxSelected)) : t('{count} seleccionados').replace('{count}', String(selectedIds.length))}
            </span>
            {selectedIds.length > 0 && <button type="button" className="text-[11px] text-neutral-500 hover:underline" onClick={() => onChange([])}>{t('Limpiar')}</button>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
