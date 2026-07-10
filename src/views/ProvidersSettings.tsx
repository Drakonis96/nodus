import { useState } from 'react';
import type { AiProvider, AppSettings, ModelInfo, ModelRef, VaultSummary } from '@shared/types';
import { VaultApiKeyImporter } from '../components/VaultApiKeyImporter';
import { AI_PROVIDERS, PROVIDER_LABELS, modelLabel, sameModel } from '../components/ui';
import { t, tx } from '../i18n';

export function ProvidersSettings({
  settings,
  vaults,
  activeVault,
  onChange,
  onVaultsChanged,
}: {
  settings: AppSettings;
  vaults: VaultSummary[];
  activeVault: VaultSummary | null;
  onChange: () => Promise<unknown>;
  onVaultsChanged: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState<AiProvider | null>(null);

  const favorites = settings.favorites ?? [];
  const isFav = (m: ModelRef) => favorites.some((f) => sameModel(f, m));

  const toggleFav = async (m: ModelRef) => {
    const currentlyFav = isFav(m);
    const next = currentlyFav ? favorites.filter((f) => !sameModel(f, m)) : [...favorites, m];
    await window.nodus.updateSettings({ favorites: next });
    await onChange();
  };

  return (
    <section className="card p-4 mb-4">
      <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-3">{t('Proveedores de IA y modelos')}</h2>
      <VaultApiKeyImporter
        vaults={vaults}
        activeVault={activeVault}
        onImported={async () => {
          await onVaultsChanged();
          await onChange();
        }}
        className="mb-4"
      />

      {/* Favorites feed every independent workload/feature selector. */}
      <div className="mb-4 text-sm">
        <div className="text-neutral-400">{t('Modelos favoritos para los selectores independientes')}</div>
        {favorites.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {favorites.map((m) => (
              <span
                key={`${m.provider}::${m.model}`}
                className="text-xs px-2 py-0.5 rounded flex items-center gap-1 bg-neutral-800 text-neutral-300"
              >
                ⭐ {modelLabel(m)}
                <button className="text-neutral-500 hover:text-red-400" title={t('Quitar de favoritos')} onClick={() => toggleFav(m)}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {AI_PROVIDERS.map((p) => (
          <ProviderRow
            key={p}
            provider={p}
            settings={settings}
            expanded={open === p}
            onToggle={() => setOpen(open === p ? null : p)}
            onChange={onChange}
            isFav={isFav}
            toggleFav={toggleFav}
          />
        ))}
      </div>
    </section>
  );
}

function ProviderRow({
  provider,
  settings,
  expanded,
  onToggle,
  onChange,
  isFav,
  toggleFav,
}: {
  provider: AiProvider;
  settings: AppSettings;
  expanded: boolean;
  onToggle: () => void;
  onChange: () => Promise<unknown>;
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
}) {
  const [keyInput, setKeyInput] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const hasKey = settings.providerKeys?.[provider];

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    await window.nodus.setApiKey(provider, keyInput.trim());
    setKeyInput('');
    await onChange();
  };

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      setModels(await window.nodus.listModels(provider));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const filtered = (models ?? []).filter((m) => {
    const q = search.toLowerCase();
    return !q || m.id.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q);
  });
  const shown = filtered.slice(0, 300);

  return (
    <div className="border border-neutral-800 rounded-lg">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm" onClick={onToggle}>
        <span className="text-neutral-500">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">{PROVIDER_LABELS[provider]}</span>
        <span className={hasKey ? 'text-emerald-400 text-xs' : 'text-neutral-600 text-xs'}>
          {hasKey ? `● ${t('clave guardada')}` : `○ ${t('sin clave')}`}
        </span>
        {provider === 'openrouter' && <span className="text-neutral-600 text-xs">{t('(modelos públicos)')}</span>}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex gap-2 items-center">
            <input
              type="password"
              className="input flex-1"
              placeholder={hasKey ? t('•••••••• (guardada)') : t('clave del proveedor')}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button className="btn btn-primary" onClick={saveKey}>
              {t('Guardar')}
            </button>
            {hasKey && (
              <button className="btn btn-ghost text-red-400" onClick={() => window.nodus.clearApiKey(provider).then(onChange)}>
                {t('Borrar')}
              </button>
            )}
          </div>

          <div className="flex gap-2 items-center">
            <button className="btn btn-ghost border border-neutral-700" onClick={loadModels} disabled={loading}>
              {loading ? t('Cargando…') : t('Cargar modelos')}
            </button>
            {models && (
              <input className="input flex-1" placeholder={t('Buscar modelo…')} value={search} onChange={(e) => setSearch(e.target.value)} />
            )}
            {models && <span className="text-xs text-neutral-500">{filtered.length}</span>}
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}

          {models && (
            <div className="max-h-64 overflow-y-auto border border-neutral-800 rounded">
              <ModelList provider={provider} models={shown} isFav={isFav} toggleFav={toggleFav} />
              {filtered.length > shown.length && (
                <div className="text-xs text-neutral-600 p-2">{tx('Mostrando {n}; refina la búsqueda para ver más.', { n: shown.length })}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModelList({
  provider,
  models,
  isFav,
  toggleFav,
}: {
  provider: AiProvider;
  models: ModelInfo[];
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
}) {
  // OpenRouter: render grouped by upstream provider.
  const rows: JSX.Element[] = [];
  let lastGroup: string | null = null;
  for (const m of models) {
    const ref: ModelRef = { provider, model: m.id };
    if (provider === 'openrouter' && m.group && m.group !== lastGroup) {
      lastGroup = m.group;
      rows.push(
        <div key={`g-${m.group}`} className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-500 bg-neutral-900 sticky top-0">
          {m.group}
        </div>
      );
    }
    const fav = isFav(ref);
    rows.push(
      <div key={m.id} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-neutral-900/60">
        <button className={fav ? 'text-amber-400' : 'text-neutral-600 hover:text-amber-300'} title={t('Favorito')} onClick={() => toggleFav(ref)}>
          {fav ? '⭐' : '☆'}
        </button>
        <span className="flex-1 truncate" title={m.name ?? m.id}>
          {m.name ? `${m.id}` : m.id}
        </span>
        {m.reasoning && (
          <span
            className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-700 dark:bg-amber-950/60 dark:text-amber-400/90"
            title={t('Modelo de razonamiento: más lento para escanear.')}
          >
            {t('razona')}
          </span>
        )}
      </div>
    );
  }
  return <div>{rows}</div>;
}
