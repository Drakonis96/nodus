// The styled multi-select the log filters use: checkbox rows, a count per option, a search
// box and an any/none footer.
//
// It is its own component rather than a reuse of `SearchableMultiSelect` for two reasons: that
// one speaks Spanish internally (`t('Limpiar')`, `t('Sin coincidencias')`), and the log surface
// must not mix languages; and its popover is pinned to z-120, which would slide under the log
// modal. Here the popover is portalled to the body with an explicit z-index above the modal, so
// a filter can never be drawn behind the sheet that owns it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';
import { Icon } from '../ui';

export interface LogMultiSelectOption {
  id: string;
  label: string;
  /** How many entries this option would match, shown right-aligned. */
  count?: number;
}

export function LogMultiSelect({
  options,
  selectedIds,
  onChange,
  placeholder,
  searchPlaceholder,
  testId,
  zIndex = 200,
}: {
  options: LogMultiSelectOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  searchPlaceholder?: string;
  testId?: string;
  zIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [style, setStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const optionById = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const selected = selectedIds.map((id) => optionById.get(id)).filter((option): option is LogMultiSelectOption => Boolean(option));

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return options;
    return options.filter((option) => normalize(`${option.label} ${option.count ?? ''}`).includes(needle));
  }, [options, query]);

  const reposition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(240, rect.width);
    const estimated = 300;
    const openAbove = window.innerHeight - rect.bottom < estimated && rect.top > window.innerHeight - rect.bottom;
    setStyle({
      position: 'fixed',
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + 4, maxHeight: Math.max(120, rect.top - 12) }
        : { top: rect.bottom + 4, maxHeight: Math.max(120, window.innerHeight - rect.bottom - 12) }),
      width,
      zIndex,
    });
  }, [zIndex]);

  const togglePopover = () => {
    if (open) {
      setOpen(false);
      return;
    }
    // Seed the portaled panel with its final geometry before mounting it: mounting it
    // unpositioned for one frame changes the layout and flashes the whole renderer.
    reposition();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape closes this popover and must not also close the modal behind it.
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, reposition]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((value) => value !== id));
    else onChange([...selectedIds, id]);
  };

  return (
    <div ref={rootRef} className="relative min-w-0" data-testid={testId}>
      <button
        type="button"
        className="input flex h-9 min-w-0 w-full items-center gap-1.5 px-2 py-1 text-left text-xs"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={togglePopover}
      >
        <span className={`min-w-0 flex-1 truncate ${selected.length === 0 ? 'text-neutral-500' : 'text-neutral-800 dark:text-neutral-200'}`}>
          {selected.length === 0 ? placeholder : selected.map((option) => option.label).join(', ')}
        </span>
        {selected.length > 1 && (
          <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
            {selected.length}
          </span>
        )}
        <Icon name="chevronDown" size={13} className="shrink-0 text-neutral-500" />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          style={style}
          // Marks this popover as part of a modal layer: the queue panel's outside-click
          // handler ignores it, so choosing a filter cannot close the panel and the modal.
          data-modal-layer="logs-filter"
          className="flex flex-col rounded-lg border border-neutral-200 bg-white p-2 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
          data-testid={testId ? `${testId}-popover` : undefined}
        >
          <div className="relative mb-1.5">
            <Icon name="search" size={13} className="pointer-events-none absolute left-2 top-2.5 text-neutral-500" />
            <input
              className="input h-8 w-full text-xs"
              style={{ paddingLeft: '1.9rem' }}
              placeholder={searchPlaceholder ?? t('Buscar')}
              value={query}
              autoFocus
              data-testid={testId ? `${testId}-search` : undefined}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="min-h-0 max-h-60 flex-1 space-y-0.5 overflow-y-auto" role="listbox" aria-multiselectable="true">
            {filtered.length === 0
              ? <p className="px-2 py-3 text-center text-xs text-neutral-500">{t('Sin coincidencias')}</p>
              : filtered.map((option) => {
                const checked = selectedIds.includes(option.id);
                return (
                  <label
                    key={option.id}
                    role="option"
                    aria-selected={checked}
                    data-testid={testId ? `${testId}-option-${option.id}` : undefined}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(option.id)} />
                    <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{option.label}</span>
                    {option.count != null && (
                      <span className="shrink-0 rounded bg-neutral-100 px-1.5 text-[10px] tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                        {option.count}
                      </span>
                    )}
                  </label>
                );
              })}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-neutral-200 pt-1.5 dark:border-neutral-700">
            <button
              type="button"
              className="text-[11px] text-neutral-500 hover:text-neutral-800 hover:underline dark:hover:text-neutral-200"
              onClick={() => onChange(options.map((option) => option.id))}
            >
              {t('Todos')}
            </button>
            <span className="text-[10px] text-neutral-500">
              {t('{count} seleccionados').replace('{count}', String(selectedIds.length))}
            </span>
            <button
              type="button"
              className="text-[11px] text-neutral-500 hover:text-neutral-800 hover:underline dark:hover:text-neutral-200"
              disabled={selectedIds.length === 0}
              onClick={() => onChange([])}
            >
              {t('Limpiar')}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}
