import type { AppSettings, ModelRef } from '@shared/types';
import { modelLabel, sameModel, sortModelRefs } from './ui';
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
}: {
  settings: AppSettings;
  value: ModelRef | null;
  onChange: (m: ModelRef | null) => void;
  compact?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const favorites = sortModelRefs(settings.favorites ?? []);
  const serialize = (m: ModelRef) => `${m.provider}::${m.model}`;
  const valueIsFavorite = value ? favorites.some((model) => sameModel(model, value)) : false;

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
      <option value="">{emptyLabel ? t(emptyLabel) : t('Sin modelo seleccionado')}</option>
      {value && !valueIsFavorite && <option value={serialize(value)}>{modelLabel(value)}</option>}
      {favorites.map((m) => (
        <option key={serialize(m)} value={serialize(m)}>
          {modelLabel(m)}
        </option>
      ))}
    </select>
  );
}
