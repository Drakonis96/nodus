import { useEffect, useRef, useState } from 'react';
import type { AppSettings, ModelRef } from '@shared/types';
import { modelLabel, sameModel, sortModelRefs } from './ui';
import { Icon } from './ui';
import { t } from '../i18n';

/**
 * Shared selector over favorite models plus the currently persisted value.
 * Null means no explicit choice (the owning workload may define its own fallback).
 */
export function ModelPicker({
  settings,
  value,
  onChange,
  compact,
  disabled,
  emptyLabel,
  allowEmpty = true,
  menu = false,
}: {
  settings: AppSettings;
  value: ModelRef | null;
  onChange: (m: ModelRef | null) => void;
  compact?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  allowEmpty?: boolean;
  menu?: boolean;
}) {
  const favorites = sortModelRefs(settings.favorites ?? []);
  const serialize = (m: ModelRef) => `${m.provider}::${m.model}`;
  const valueIsFavorite = value ? favorites.some((model) => sameModel(model, value)) : false;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (menu) {
    const models = value && !valueIsFavorite ? [value, ...favorites] : favorites;
    const choose = (model: ModelRef | null) => { onChange(model); setOpen(false); };
    return <div ref={rootRef} className={`model-picker-menu${compact ? ' compact' : ''}`}>
      <button type="button" className="model-picker-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} title={t('Seleccionar modelo')}>
        <span>{value ? modelLabel(value) : emptyLabel ? t(emptyLabel) : t('Sin modelo seleccionado')}</span><Icon name="chevronDown" size={14} />
      </button>
      {open && <div className="model-picker-options" role="listbox">
        {allowEmpty && <button type="button" role="option" aria-selected={!value} className={!value ? 'selected' : ''} onClick={() => choose(null)}>{emptyLabel ? t(emptyLabel) : t('Sin modelo seleccionado')}</button>}
        {models.map((model) => <button type="button" role="option" aria-selected={sameModel(model, value)} className={sameModel(model, value) ? 'selected' : ''} key={serialize(model)} onClick={() => choose(model)}><span>{modelLabel(model)}</span>{sameModel(model, value) && <Icon name="check" size={13} />}</button>)}
        {!models.length && !allowEmpty && <span className="model-picker-empty">{t('No hay modelos favoritos configurados.')}</span>}
      </div>}
    </div>;
  }

  return (
    <select
      className={`input ${compact ? 'text-xs py-1' : ''}`}
      disabled={disabled}
      value={value ? serialize(value) : ''}
      onChange={(e) => {
        if (!e.target.value) return onChange(null);
        const [provider, model] = e.target.value.split('::');
        onChange({ provider: provider as ModelRef['provider'], model });
      }}
      title={t('Seleccionar modelo')}
    >
      <option value="" disabled={!allowEmpty}>{emptyLabel ? t(emptyLabel) : t('Sin modelo seleccionado')}</option>
      {value && !valueIsFavorite && <option value={serialize(value)}>{modelLabel(value)}</option>}
      {favorites.map((m) => (
        <option key={serialize(m)} value={serialize(m)}>
          {modelLabel(m)}
        </option>
      ))}
    </select>
  );
}
