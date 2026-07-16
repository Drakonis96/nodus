import { useEffect, useMemo, useState } from 'react';
import type { AiProvider, AppSettings, EmbeddingProvider, ModelInfo } from '@shared/types';
import {
  AI_PROVIDERS,
  DEFAULT_EMBEDDING_MODELS,
  EMBEDDING_PROVIDERS,
  PROVIDER_LABELS,
} from '@shared/providers';
import {
  NODUS_LOCAL_MODELS,
  nodusLocalModelBytes,
  type NodusLocalAiStatus,
  type NodusLocalModelDefinition,
} from '@shared/localAiModels';
import { t } from '../i18n';
import { Icon } from './ui';

const AI_PROVIDER_OPTIONS: AiProvider[] = ['nodus', ...AI_PROVIDERS];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
  return `${Math.round(bytes / 1024 ** 2).toLocaleString()} MB`;
}

function LocalModelSelect({
  kind,
  value,
  onChange,
  status,
  disabled,
}: {
  kind: NodusLocalModelDefinition['kind'];
  value: string;
  onChange: (model: string) => void;
  status: NodusLocalAiStatus | null;
  disabled?: boolean;
}) {
  const models = NODUS_LOCAL_MODELS.filter((model) => model.kind === kind);
  const selected = models.find((model) => model.id === value) ?? models[0];
  const downloaded = Boolean(status?.models.find((model) => model.id === selected?.id)?.downloaded);
  return (
    <div className="space-y-1.5">
      <select
        className="input w-full"
        data-testid={`vault-${kind}-local-model`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label} · {model.quantization} · {formatBytes(nodusLocalModelBytes(model))}
          </option>
        ))}
      </select>
      {selected && (
        <p className={`flex items-center gap-1 text-[11px] ${downloaded ? 'text-emerald-400' : 'text-amber-400'}`}>
          <Icon name={downloaded ? 'check' : 'download'} size={11} />
          {downloaded
            ? t('Ya está descargado y listo para usar.')
            : t('Se descargará al crear la bóveda. La creación terminará cuando el modelo esté listo.')}
        </p>
      )}
    </div>
  );
}

function DiscoverableModelField({
  kind,
  provider,
  value,
  onChange,
  settings,
  disabled,
}: {
  kind: 'ai' | 'embedding';
  provider: AiProvider | EmbeddingProvider;
  value: string;
  onChange: (model: string) => void;
  settings: AppSettings;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const datalistId = `vault-${kind}-${provider}-models`;
  const favorites = useMemo(
    () => settings.favorites.filter((model) => model.provider === provider),
    [provider, settings.favorites]
  );

  useEffect(() => {
    setModels(null);
    setError('');
  }, [provider]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const next = kind === 'ai'
        ? await window.nodus.listModels(provider as AiProvider)
        : await window.nodus.listEmbeddingModels(provider as EmbeddingProvider);
      setModels(next);
      if (!value && next[0]) onChange(next[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          className="input min-w-0 w-full"
          data-testid={`vault-${kind}-model-input`}
          list={datalistId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={kind === 'embedding' ? DEFAULT_EMBEDDING_MODELS[provider as EmbeddingProvider] : t('ID del modelo')}
        />
        <button type="button" className="btn btn-ghost justify-center border border-neutral-700" disabled={disabled || loading} onClick={() => void load()}>
          <Icon name="refresh" size={13} /> {loading ? t('Cargando…') : t('Consultar modelos')}
        </button>
      </div>
      <datalist id={datalistId}>
        {favorites.map((model) => <option key={`favorite-${model.model}`} value={model.model} />)}
        {(models ?? []).slice(0, 300).map((model) => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}
      </datalist>
      {models && (
        <select className="input w-full text-xs" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {value && !models.some((model) => model.id === value) && <option value={value}>{value}</option>}
          {!value && <option value="">{t('Selecciona un modelo')}</option>}
          {models.slice(0, 300).map((model) => (
            <option key={model.id} value={model.id}>{model.name ? `${model.name} · ${model.id}` : model.id}</option>
          ))}
        </select>
      )}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {!models && favorites.length > 0 && <p className="text-[11px] text-neutral-500">{t('Puedes escribir un ID o elegir uno de tus modelos favoritos.')}</p>}
    </div>
  );
}

export function VaultCreationModels({
  settings,
  aiProvider,
  aiModel,
  embeddingProvider,
  embeddingModel,
  localStatus,
  disabled,
  onAiChange,
  onEmbeddingChange,
}: {
  settings: AppSettings;
  aiProvider: AiProvider | '';
  aiModel: string;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  localStatus: NodusLocalAiStatus | null;
  disabled?: boolean;
  onAiChange: (provider: AiProvider | '', model: string) => void;
  onEmbeddingChange: (provider: EmbeddingProvider, model: string) => void;
}) {
  const changeAiProvider = (provider: AiProvider | '') => {
    if (!provider) return onAiChange('', '');
    if (provider === 'nodus') {
      const first = NODUS_LOCAL_MODELS.find((model) => model.kind === 'chat');
      return onAiChange(provider, first?.id ?? '');
    }
    const favorite = settings.favorites.find((model) => model.provider === provider);
    onAiChange(provider, favorite?.model ?? '');
  };
  const changeEmbeddingProvider = (provider: EmbeddingProvider) => {
    if (provider === 'nodus') {
      const first = NODUS_LOCAL_MODELS.find((model) => model.kind === 'embedding');
      onEmbeddingChange(provider, first?.id ?? '');
      return;
    }
    onEmbeddingChange(provider, DEFAULT_EMBEDDING_MODELS[provider]);
  };

  return (
    <section className="mt-4 space-y-3 rounded-xl border border-neutral-800 bg-neutral-950/35 p-3" data-testid="vault-creation-models">
      <div>
        <h3 className="text-sm font-semibold text-neutral-200">{t('Modelos iniciales')}</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-500">
          {t('Elige por separado el modelo de IA y el modelo que creará los embeddings del vault. Ambos son obligatorios.')}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-neutral-800 p-3">
          <label className="block text-xs font-medium text-neutral-300">
            {t('Modelo de IA')}
            <select
              className="input mt-1 w-full"
              data-testid="vault-ai-provider"
              value={aiProvider}
              disabled={disabled}
              onChange={(event) => changeAiProvider(event.target.value as AiProvider | '')}
            >
              <option value="">{t('Elige local o nube')}</option>
              {AI_PROVIDER_OPTIONS.map((provider) => (
                <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
              ))}
            </select>
          </label>
          {aiProvider === 'nodus'
            ? <LocalModelSelect kind="chat" value={aiModel} onChange={(model) => onAiChange(aiProvider, model)} status={localStatus} disabled={disabled} />
            : aiProvider
              ? <DiscoverableModelField kind="ai" provider={aiProvider} value={aiModel} onChange={(model) => onAiChange(aiProvider, model)} settings={settings} disabled={disabled} />
              : <p className="text-[11px] text-amber-400">{t('Selecciona primero dónde se ejecutará la IA.')}</p>}
        </div>
        <div className="space-y-2 rounded-lg border border-neutral-800 p-3">
          <label className="block text-xs font-medium text-neutral-300">
            {t('Modelo de embeddings')}
            <select
              className="input mt-1 w-full"
              data-testid="vault-embedding-provider"
              value={embeddingProvider}
              disabled={disabled}
              onChange={(event) => changeEmbeddingProvider(event.target.value as EmbeddingProvider)}
            >
              {EMBEDDING_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
              ))}
            </select>
          </label>
          {embeddingProvider === 'nodus'
            ? <LocalModelSelect kind="embedding" value={embeddingModel} onChange={(model) => onEmbeddingChange(embeddingProvider, model)} status={localStatus} disabled={disabled} />
            : <DiscoverableModelField kind="embedding" provider={embeddingProvider} value={embeddingModel} onChange={(model) => onEmbeddingChange(embeddingProvider, model)} settings={settings} disabled={disabled} />}
        </div>
      </div>
      <p className="text-[11px] leading-5 text-neutral-500">
        {t('Los proveedores en la nube usan las claves configuradas en Nodus. Ollama y LM Studio usan tu servidor local; Nodus local descarga el modelo en este equipo.')}
      </p>
    </section>
  );
}
