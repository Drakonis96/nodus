import type { AppSettings, ModelRef } from '@shared/types';
import { modelLabel, sameModel } from './ui';
import { t, tx } from '../i18n';

/**
 * Lets the user pick which model a scan should use: the default, or any favorite.
 * Returns null to mean "use the configured default model".
 */
export function ModelPicker({
  settings,
  value,
  onChange,
  compact,
  disabled,
}: {
  settings: AppSettings;
  value: ModelRef | null;
  onChange: (m: ModelRef | null) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const favorites = settings.favorites ?? [];
  const serialize = (m: ModelRef) => `${m.provider}::${m.model}`;

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
      title={t('Modelo para el escaneo')}
    >
      <option value="">
        {settings.defaultModel ? tx('Predeterminado ({model})', { model: modelLabel(settings.defaultModel) }) : t('Predeterminado (sin configurar)')}
      </option>
      {favorites.map((m) => (
        <option key={serialize(m)} value={serialize(m)} disabled={sameModel(m, settings.defaultModel)}>
          {modelLabel(m)}
        </option>
      ))}
    </select>
  );
}
