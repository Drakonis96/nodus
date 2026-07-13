import { useEffect, useMemo, useState } from 'react';
import type {
  AiProvider,
  AppSettings,
  ImageModelInfo,
  LocalProvider,
  LocalProviderTestResult,
  ModelInfo,
  ModelRef,
} from '@shared/types';
import { DECORATIVE_IMAGE_STYLES } from '@shared/imageStyles';
import { DEFAULT_LOCAL_BASE_URLS } from '@shared/providers';
import { AudioGenerationSettings } from './AudioGenerationSettings';
import { AI_PROVIDERS, PROVIDER_LABELS, isLocalAiProvider, modelLabel, sameModel } from '../components/ui';
import { t, tx } from '../i18n';

export function ProvidersSettings({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: () => Promise<unknown>;
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
    <>
    <section className="card p-4 mb-4">
      <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-3">{t('Proveedores de IA y modelos')}</h2>
      <p className="mb-4 text-xs leading-5 text-neutral-500">
        {t('Las claves de API y los modelos configurados se comparten entre todas tus bóvedas.')}
      </p>

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
        {AI_PROVIDERS.map((p) =>
          isLocalAiProvider(p) ? (
            <LocalProviderRow
              key={p}
              provider={p as LocalProvider}
              settings={settings}
              expanded={open === p}
              onToggle={() => setOpen(open === p ? null : p)}
              onChange={onChange}
              isFav={isFav}
              toggleFav={toggleFav}
            />
          ) : (
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
          )
        )}
      </div>
    </section>
    <ImageGenerationSettings settings={settings} onChange={onChange} />
    <AudioGenerationSettings settings={settings} onChange={onChange} />
    </>
  );
}

type ImageSort = 'provider' | 'alpha' | 'price_asc' | 'price_desc';
const IMAGE_PROVIDER_LABELS: Record<ImageModelInfo['provider'], string> = {
  google: 'Google',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
};

function ImageGenerationSettings({ settings, onChange }: { settings: AppSettings; onChange: () => Promise<unknown> }) {
  const [models, setModels] = useState<ImageModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ImageSort>('provider');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setModels(await window.nodus.listImageModels());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = models.filter((model) =>
      !q || `${model.provider} ${model.name} ${model.id}`.toLowerCase().includes(q)
    );
    return [...filtered].sort((a, b) => {
      if (sort === 'provider') return a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name);
      if (sort === 'alpha') return a.name.localeCompare(b.name) || a.provider.localeCompare(b.provider);
      // Providers publish unlike sizes/units. Price order is therefore scoped
      // to one provider and never implies a false cross-provider comparison.
      const providerOrder = a.provider.localeCompare(b.provider);
      if (providerOrder !== 0) return providerOrder;
      const aPrice = a.imagePriceUsd;
      const bPrice = b.imagePriceUsd;
      if (aPrice == null && bPrice == null) return a.name.localeCompare(b.name);
      if (aPrice == null) return 1;
      if (bPrice == null) return -1;
      return sort === 'price_asc' ? aPrice - bPrice : bPrice - aPrice;
    });
  }, [models, search, sort]);

  const select = async (model: ImageModelInfo) => {
    await window.nodus.updateSettings({ imageProvider: model.provider, imageModel: model.id });
    await onChange();
  };

  const money = (value: number | null) => value == null ? t('No disponible') : `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} / 1M`;

  return (
    <section className="card p-4 mb-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">{t('Generación de imágenes')}</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {t('Configuración independiente para las imágenes decorativas opcionales. OpenAI usa su API oficial de imágenes y reutiliza la clave de OpenAI; Google reutiliza la clave de Gemini.')}
          </p>
        </div>
        <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => void load()} disabled={loading}>
          <span className={loading ? 'animate-spin' : ''}>↻</span> {t('Actualizar modelos')}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)] gap-3 max-md:grid-cols-1">
        <label className="text-xs text-neutral-500">
          {t('Estilo predeterminado')}
          <select
            className="input mt-1 w-full"
            value={settings.imageStyle}
            onChange={(event) => {
              void window.nodus.updateSettings({ imageStyle: event.target.value as AppSettings['imageStyle'] }).then(onChange);
            }}
          >
            {DECORATIVE_IMAGE_STYLES.map((style) => <option key={style.id} value={style.id}>{t(style.label)}</option>)}
          </select>
        </label>
        <div className="text-xs text-neutral-500">
          {t('Selección actual')}
          <div className="mt-1 rounded-md border border-neutral-800 px-3 py-2 text-sm text-neutral-300">
            {IMAGE_PROVIDER_LABELS[settings.imageProvider]} · {settings.imageModel}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          className="input min-w-[16rem] flex-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('Buscar por proveedor, nombre o identificador…')}
        />
        <select className="input" value={sort} onChange={(event) => setSort(event.target.value as ImageSort)}>
          <option value="provider">{t('Proveedor y nombre')}</option>
          <option value="alpha">{t('Orden alfabético')}</option>
          <option value="price_asc">{t('Precio por imagen: menor a mayor (por proveedor)')}</option>
          <option value="price_desc">{t('Precio por imagen: mayor a menor (por proveedor)')}</option>
        </select>
      </div>

      <p className="mt-2 text-[11px] leading-4 text-neutral-600">
        {t('Como los proveedores publican tamaños y métricas diferentes, la ordenación por precio se aplica por separado dentro de cada proveedor. Los modelos sin precio directo quedan al final; no se estiman costes.')}
      </p>
      {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
      {loading && <div className="mt-4 text-sm text-neutral-500">{t('Consultando catálogos oficiales…')}</div>}
      {!loading && (
        <div className="mt-3 max-h-[32rem] overflow-y-auto rounded-lg border border-neutral-800">
          {shown.map((model) => {
            const selected = settings.imageProvider === model.provider && settings.imageModel === model.id;
            return (
              <button
                key={`${model.provider}:${model.id}`}
                className={`grid w-full grid-cols-[minmax(14rem,1.5fr)_repeat(3,minmax(7rem,1fr))] gap-3 border-b border-neutral-800 px-3 py-3 text-left text-xs last:border-b-0 max-xl:grid-cols-2 ${selected ? 'bg-indigo-950/40' : 'hover:bg-neutral-900/60'}`}
                onClick={() => void select(model)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${selected ? 'bg-indigo-400' : 'bg-neutral-700'}`} />
                    <span className="font-medium text-neutral-200">{model.name}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-neutral-500" title={model.id}>{IMAGE_PROVIDER_LABELS[model.provider]} · {model.id}</div>
                </div>
                <PriceCell label={t('Entrada')} value={money(model.inputPriceUsdPerMillion)} />
                <PriceCell label={t('Salida')} value={money(model.outputPriceUsdPerMillion)} />
                <PriceCell label={t('Imagen')} value={model.imagePriceLabel ?? t('No disponible')} />
              </button>
            );
          })}
          {shown.length === 0 && <div className="p-4 text-sm text-neutral-500">{t('No hay modelos compatibles que coincidan.')}</div>}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-600">
        <span>{tx('{n} modelos compatibles con salida de imagen', { n: shown.length })}</span>
        <button className="hover:text-indigo-300" onClick={() => window.nodus.openExternal('https://openrouter.ai/models?output_modalities=image&order=pricing-low-to-high')}>{t('Ver catálogo de OpenRouter')}</button>
      </div>
    </section>
  );
}

function PriceCell({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] uppercase tracking-wide text-neutral-600">{label}</div><div className="mt-1 text-neutral-400">{value}</div></div>;
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

function LocalProviderRow({
  provider,
  settings,
  expanded,
  onToggle,
  onChange,
  isFav,
  toggleFav,
}: {
  provider: LocalProvider;
  settings: AppSettings;
  expanded: boolean;
  onToggle: () => void;
  onChange: () => Promise<unknown>;
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
}) {
  const savedUrl = settings.localProviders?.[provider]?.baseUrl ?? '';
  const [urlInput, setUrlInput] = useState(savedUrl);
  const [tokenInput, setTokenInput] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<LocalProviderTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const hasToken = settings.providerKeys?.[provider];

  // Keep the URL field in sync if the saved value changes elsewhere (e.g. vault switch).
  useEffect(() => setUrlInput(savedUrl), [savedUrl]);

  const persistUrl = async () => {
    const next = urlInput.trim() || DEFAULT_LOCAL_BASE_URLS[provider];
    if (next !== savedUrl) {
      await window.nodus.updateSettings({
        localProviders: { ...settings.localProviders, [provider]: { baseUrl: next } },
      });
      await onChange();
    }
  };

  const saveToken = async () => {
    if (!tokenInput.trim()) return;
    await window.nodus.setApiKey(provider, tokenInput.trim());
    setTokenInput('');
    await onChange();
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      await persistUrl();
      setTest(await window.nodus.testLocalProvider(provider));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      await persistUrl();
      setModels(await window.nodus.listModels(provider));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
        <span className="text-xs text-neutral-600">{t('(local)')}</span>
        <span className="ml-auto truncate font-mono text-[10px] text-neutral-500" title={savedUrl}>{savedUrl}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-xs leading-5 text-neutral-500">
            {provider === 'ollama'
              ? t('Ollama debe estar en marcha y los modelos descargados con "ollama pull". No requiere clave.')
              : t('Activa el servidor local en LM Studio (Developer → Start Server) y carga al menos un modelo. No requiere clave.')}
          </p>

          <label className="block text-xs text-neutral-500">
            {t('Dirección del servidor (IP y puerto)')}
            <div className="mt-1 flex gap-2 items-center">
              <input
                className="input flex-1 font-mono"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={() => void persistUrl()}
                placeholder={DEFAULT_LOCAL_BASE_URLS[provider]}
                spellCheck={false}
              />
              <button className="btn btn-ghost border border-neutral-700" onClick={() => void runTest()} disabled={testing}>
                {testing ? t('Probando…') : t('Probar conexión')}
              </button>
            </div>
          </label>

          {test && (
            <div className={`text-xs ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {test.ok
                ? tx('Conectado{version} · {n} modelos disponibles', {
                    version: test.version ? ` (v${test.version})` : '',
                    n: test.modelCount ?? 0,
                  })
                : tx('Sin conexión: {msg}', { msg: test.message ?? '' })}
            </div>
          )}

          <div className="flex gap-2 items-center">
            <input
              type="password"
              className="input flex-1"
              placeholder={hasToken ? t('•••••••• token guardado (opcional)') : t('token de acceso (opcional)')}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button className="btn btn-primary" onClick={saveToken}>{t('Guardar')}</button>
            {hasToken && (
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
              {models.length === 0 && (
                <div className="p-3 text-xs text-neutral-500">{t('El servidor no reporta modelos. Descarga o carga uno primero.')}</div>
              )}
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

function formatBytes(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

/** Secondary line for a local model row: params · quant · context · size. */
function modelMetaParts(m: ModelInfo): string[] {
  const parts: string[] = [];
  if (m.paramSize) parts.push(m.paramSize);
  if (m.quantization) parts.push(m.quantization);
  if (m.contextLength) parts.push(`${Math.round(m.contextLength / 1000)}K ctx`);
  const size = formatBytes(m.sizeBytes);
  if (size) parts.push(size);
  return parts;
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
    const meta = modelMetaParts(m);
    rows.push(
      <div key={m.id} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-neutral-900/60">
        <button className={fav ? 'text-amber-400' : 'text-neutral-600 hover:text-amber-300'} title={t('Favorito')} onClick={() => toggleFav(ref)}>
          {fav ? '⭐' : '☆'}
        </button>
        {m.loaded && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" title={t('Cargado en memoria')} />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate" title={m.name ?? m.id}>{m.id}</span>
          {meta.length > 0 && <span className="truncate text-[10px] text-neutral-500">{meta.join(' · ')}</span>}
        </span>
        {m.vision && (
          <span
            className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300/90"
            title={t('Acepta imágenes: apto como modelo de visión.')}
          >
            {t('visión')}
          </span>
        )}
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
