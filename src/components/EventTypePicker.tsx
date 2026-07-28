import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CustomHistoricalEventType,
  EventTypeValue,
  EventTypeVocabularyScope,
  HistoricalEventType,
} from '@shared/types';
import {
  createCustomEventType,
  customEventTypeLabel,
  eventTypeLabel,
} from '@shared/eventTypes';
import { Icon } from './ui';
import { confirm } from './feedback';
import { ViewportPopover } from './world/ViewportPopover';
import { t, tx } from '../i18n';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

export function EventTypePicker({
  value,
  onChange,
  scope,
  builtInTypes,
  builtInLabels,
  disabled = false,
}: {
  value: EventTypeValue;
  onChange: (value: EventTypeValue) => void;
  scope: EventTypeVocabularyScope;
  builtInTypes: HistoricalEventType[];
  builtInLabels: Record<string, string>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [customTypes, setCustomTypes] = useState<CustomHistoricalEventType[]>([]);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const settings = await window.nodus.getSettings();
    setCustomTypes(settings.customEventTypes[scope]);
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const options = useMemo(() => [
    ...builtInTypes.map((id) => ({ id: id as EventTypeValue, label: t(builtInLabels[id] ?? id), custom: false })),
    ...customTypes.map((id) => ({ id: id as EventTypeValue, label: customEventTypeLabel(id), custom: true })),
  ], [builtInLabels, builtInTypes, customTypes]);
  const normalizedQuery = normalize(query);
  const filtered = options.filter((option) => !normalizedQuery || normalize(option.label).includes(normalizedQuery));
  const exactMatch = options.some((option) => normalize(option.label) === normalizedQuery);
  const canCreate = query.trim().length > 0 && query.trim().length <= 60 && !exactMatch;

  const choose = (next: EventTypeValue) => {
    onChange(next);
    setQuery('');
    setOpen(false);
  };

  const addCustom = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      const custom = createCustomEventType(query);
      const settings = await window.nodus.getSettings();
      const current = settings.customEventTypes[scope];
      const next = [...current, custom];
      await window.nodus.updateSettings({
        customEventTypes: { ...settings.customEventTypes, [scope]: next },
      });
      setCustomTypes(next);
      choose(custom);
    } finally {
      setBusy(false);
    }
  };

  const removeCustom = async (custom: CustomHistoricalEventType) => {
    const label = customEventTypeLabel(custom);
    const ok = await confirm({
      title: tx('Eliminar «{name}»', { name: label }),
      message: t('El tipo desaparecerá del selector. Los hechos existentes conservarán su nombre.'),
      confirmLabel: t('Eliminar tipo'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const settings = await window.nodus.getSettings();
      const next = settings.customEventTypes[scope].filter((entry) => entry !== custom);
      await window.nodus.updateSettings({
        customEventTypes: { ...settings.customEventTypes, [scope]: next },
      });
      setCustomTypes(next);
      if (value === custom) onChange(builtInTypes[0]);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    if (disabled || busy) return;
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        className="input flex h-9 w-full items-center gap-2 px-2 text-left text-sm"
        aria-label={t('Tipo de hecho')}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
      >
        <span className="min-w-0 flex-1 truncate text-neutral-200">
          {t(eventTypeLabel(value, builtInLabels))}
        </span>
        <Icon name="chevronDown" size={13} className="shrink-0 text-neutral-500" />
      </button>
      <ViewportPopover
        anchorRef={rootRef}
        open={open}
        onDismiss={() => setOpen(false)}
        width={300}
        estimatedHeight={320}
        className="z-[130] flex flex-col overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 p-2 shadow-2xl"
        testId="event-type-picker-popover"
      >
          <div className="relative mb-1.5 shrink-0">
            <Icon name="search" size={13} className="pointer-events-none absolute left-2 top-2.5 text-neutral-500" />
            <input
              className="input h-8 w-full text-xs"
              style={{ paddingLeft: '1.9rem' }}
              value={query}
              maxLength={60}
              autoFocus
              placeholder={t('Buscar o crear tipo de hecho…')}
              aria-label={t('Buscar tipo de hecho')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canCreate) {
                  event.preventDefault();
                  void addCustom();
                }
              }}
            />
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" role="listbox">
            {filtered.map((option) => (
              <div
                key={option.id}
                role="option"
                aria-selected={option.id === value}
                className={`flex items-center rounded px-2 text-xs ${
                  option.id === value ? 'bg-indigo-950/60 text-indigo-200' : 'text-neutral-200 hover:bg-neutral-900'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate py-2 text-left"
                  onClick={() => choose(option.id)}
                >
                  {option.label}
                </button>
                {option.custom && (
                  <button
                    type="button"
                    className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-red-950/50 hover:text-red-300"
                    aria-label={tx('Eliminar tipo «{name}»', { name: option.label })}
                    title={t('Eliminar tipo personalizado')}
                    disabled={busy}
                    onClick={() => void removeCustom(option.id as CustomHistoricalEventType)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
            ))}
            {canCreate && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-indigo-300 hover:bg-indigo-950/50"
                disabled={busy}
                onClick={() => void addCustom()}
              >
                <Icon name="plus" size={13} />
                <span className="truncate">{tx('Añadir «{name}»', { name: query.trim() })}</span>
              </button>
            )}
            {filtered.length === 0 && !canCreate && (
              <p className="px-2 py-3 text-center text-xs text-neutral-600">{t('Sin coincidencias')}</p>
            )}
          </div>
          <p className="mt-1.5 shrink-0 border-t border-neutral-800 px-1 pt-1.5 text-[10px] text-neutral-600">
            {t('Los tipos incorporados no se pueden eliminar.')}
          </p>
      </ViewportPopover>
    </div>
  );
}
