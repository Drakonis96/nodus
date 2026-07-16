import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelRef } from '@shared/types';
import { choiceKey, filterModelChoices, findChoice, refKey, type ModelChoice } from '@shared/onboardingModels';
import { t, tx } from '../i18n';
import { Icon } from './ui';

/**
 * Model dropdown with a searchbox. Provider listings run to hundreds of entries
 * (OpenRouter alone), so a plain <select> is unusable: the popup filters as the
 * user types and every option carries its provider, which is what makes a single
 * merged list across providers readable.
 */
export function SearchableModelSelect({
  testId,
  label,
  value,
  choices,
  onChange,
  disabled,
  loading,
  emptyLabel,
  noteFor,
}: {
  testId: string;
  label: string;
  value: ModelRef | null;
  choices: ModelChoice[];
  onChange: (ref: ModelRef) => void;
  disabled?: boolean;
  loading?: boolean;
  /** Shown instead of the list when discovery found nothing. */
  emptyLabel: string;
  /** Optional per-option note (e.g. "downloads on finish"). */
  noteFor?: (choice: ModelChoice) => string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = findChoice(choices, value);
  const filtered = useMemo(() => filterModelChoices(choices, query), [choices, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    setActive(Math.max(0, filtered.findIndex((choice) => choiceKey(choice) === refKey(value))));
  }, [open]);

  // Keep the highlighted row visible while arrowing through a long listing.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (choice: ModelChoice) => {
    onChange({ provider: choice.provider, model: choice.model });
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => {
        if (!filtered.length) return 0;
        const next = current + (event.key === 'ArrowDown' ? 1 : -1);
        return (next + filtered.length) % filtered.length;
      });
      return;
    }
    if (event.key === 'Enter' && filtered[active]) {
      event.preventDefault();
      choose(filtered[active]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={rootRef} data-testid={testId}>
      <button
        type="button"
        className="input flex w-full items-center justify-between gap-2 text-left"
        data-testid={`${testId}-trigger`}
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 flex-1 truncate">
          {loading ? (
            <span className="text-neutral-500">{t('Buscando modelos disponibles…')}</span>
          ) : selected ? (
            <>
              <span className="text-neutral-500">{selected.providerLabel} · </span>
              {selected.label}
            </>
          ) : value ? (
            <>
              <span className="text-neutral-500">{value.provider} · </span>
              {value.model}
            </>
          ) : (
            <span className="text-neutral-500">{choices.length ? t('Elige un modelo') : emptyLabel}</span>
          )}
        </span>
        <Icon name={loading ? 'sync' : 'chevronDown'} size={14} className={loading ? 'animate-spin' : ''} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
          <div className="relative border-b border-neutral-200 p-2 dark:border-neutral-800">
            <Icon name="search" size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              className="input input-with-leading-icon h-8 w-full py-1 text-xs"
              data-testid={`${testId}-search`}
              autoFocus
              value={query}
              placeholder={t('Buscar modelo…')}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="max-h-60 overflow-y-auto" role="listbox" aria-label={label} ref={listRef}>
            {filtered.map((choice, index) => {
              const note = noteFor?.(choice);
              const isSelected = choiceKey(choice) === refKey(value);
              return (
                <button
                  key={choiceKey(choice)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-active={index === active}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                    index === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(choice)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-neutral-800 dark:text-neutral-200">{choice.label}</span>
                    <span className="block truncate text-[10px] text-neutral-500">
                      {choice.providerLabel}
                      {choice.label !== choice.model ? ` · ${choice.model}` : ''}
                      {note ? ` · ${note}` : ''}
                    </span>
                  </span>
                  {choice.local && (
                    <span className="shrink-0 rounded border border-emerald-600/40 bg-emerald-500/10 px-1 text-[9px] font-semibold uppercase text-emerald-500">
                      {t('Local')}
                    </span>
                  )}
                  {isSelected && <Icon name="check" size={13} className="shrink-0 text-indigo-400" />}
                </button>
              );
            })}
            {!filtered.length && (
              <p className="px-3 py-3 text-xs text-neutral-500">
                {choices.length ? tx('Ningún modelo coincide con «{query}».', { query }) : emptyLabel}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
