import { useEffect, useRef, useState } from 'react';
import type { AiProvider, AppSettings, ModelCatalogResult, ModelRef } from '@shared/types';
import { replaceModelPatch, staleFavorites, tasksUsingModel, type ModelCatalogues } from '@shared/staleModels';
import { Icon, modelLabel, PROVIDER_LABELS, sameModel } from './ui';
import { t, tx } from '../i18n';

const refKey = (model: ModelRef) => `${model.provider}::${model.model}`;

export function FavoriteModelAvailability({ settings, revision, toggleFav, onChange }: {
  settings: AppSettings;
  /** Changes even when a saved API key is rotated without changing providerKeys. */
  revision: number;
  toggleFav: (model: ModelRef) => Promise<void>;
  onChange: () => Promise<unknown>;
}) {
  const favorites = settings.favorites ?? [];
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ context: string; catalogues: ModelCatalogues } | null>(null);
  const [checking, setChecking] = useState(false);
  const request = useRef(0);
  const context = JSON.stringify([revision, runtimeRevision, favorites.map(refKey).sort(),
    settings.providerKeys, settings.lockedProviderKeys, settings.localProviders, settings.customProvider]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const catalogues = snapshot?.context === context ? snapshot.catalogues : null;
  const stale = catalogues ? staleFavorites(favorites, catalogues) : [];

  useEffect(() => {
    request.current += 1;
    setChecking(false);
    setSnapshot(null);
  }, [context]);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => {
    // Quota notifications leave evidence intact; an account/connection change invalidates it.
    let codexIdentity: string | undefined;
    let copilotIdentity: string | undefined;
    const offCodex = window.nodus.onChatGptSubscriptionStatusChanged((status) => {
      const identity = JSON.stringify([status.connected, status.email, status.planType]);
      if (identity !== codexIdentity) { codexIdentity = identity; setRuntimeRevision((value) => value + 1); }
    });
    const offCopilot = window.nodus.onGitHubCopilotSubscriptionStatusChanged((status) => {
      const identity = JSON.stringify([status.connected, status.login, status.authType]);
      if (identity !== copilotIdentity) { copilotIdentity = identity; setRuntimeRevision((value) => value + 1); }
    });
    return () => { offCodex(); offCopilot(); };
  }, []);

  const check = async () => {
    const id = ++request.current;
    setChecking(true);
    setSnapshot(null);
    const providers = [...new Set(favorites.map((model) => model.provider))];
    const results = await Promise.all(providers.map(async (provider) => {
      let result: ModelCatalogResult;
      try { result = await window.nodus.getModelCatalog(provider); }
      catch { result = { status: 'unreadable' }; }
      return [provider, result] as const;
    }));
    if (request.current === id && currentContext.current === context) {
      setSnapshot({ context, catalogues: new Map(results) });
      setChecking(false);
    }
  };

  return (
    <div className="mb-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-neutral-400">{t('Modelos favoritos para los selectores independientes')}</div>
        {favorites.length > 0 && (
          <button className="btn btn-ghost border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700" onClick={() => void check()} disabled={checking} data-testid="check-favorite-availability">
            {checking ? t('Comprobando…') : t('Comprobar catálogo')}
          </button>
        )}
      </div>
      {favorites.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {favorites.map((model) => {
            const unlisted = stale.some((candidate) => sameModel(candidate, model));
            return (
              <span key={refKey(model)} className={`flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300${unlisted ? ' ring-1 ring-amber-500' : ''}`}
                title={unlisted ? tx('{provider} no incluye este modelo en su catálogo; su disponibilidad no está confirmada.', { provider: PROVIDER_LABELS[model.provider] ?? model.provider }) : undefined}
                data-stale={unlisted ? 'true' : undefined}>
                <Icon name="star" size={12} className="shrink-0 fill-current text-amber-400" />
                <span>{modelLabel(model)}</span>
                <button className="ml-0.5 grid h-4 w-4 shrink-0 place-items-center rounded text-neutral-500 hover:bg-neutral-700 hover:text-red-400" title={t('Quitar de favoritos')} aria-label={t('Quitar de favoritos')} onClick={() => void toggleFav(model)}>
                  <Icon name="x" size={10} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {catalogues && <StaleFavoritesPanel settings={settings} stale={stale} catalogues={catalogues} favorites={favorites} onChange={onChange} />}
    </div>
  );
}

function selectable(catalogues: ModelCatalogues, provider: AiProvider): ModelRef[] {
  const catalog = catalogues.get(provider);
  return catalog?.status === 'read' ? catalog.selectableModels.map((model) => ({ provider, model: model.id })) : [];
}

function suggestedReplacement(model: ModelRef, options: ModelRef[], favorites: ModelRef[]): ModelRef | null {
  const live = options.filter((option) => option.provider === model.provider);
  const tail = model.model.split(/[-/:]/).filter(Boolean).pop() ?? '';
  return live.find((option) => tail && option.model.split(/[-/:]/).includes(tail))
    ?? live.find((option) => favorites.some((favorite) => sameModel(option, favorite))) ?? live[0] ?? options[0] ?? null;
}

function StaleFavoritesPanel({ settings, stale, catalogues, favorites, onChange }: {
  settings: AppSettings;
  stale: ModelRef[];
  catalogues: ModelCatalogues;
  favorites: ModelRef[];
  onChange: () => Promise<unknown>;
}) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unreadable = [...catalogues].filter(([, catalog]) => catalog.status === 'unreadable').map(([provider]) => PROVIDER_LABELS[provider as AiProvider] ?? provider);
  const apply = async (from: ModelRef, to: ModelRef | null) => {
    setApplying(true);
    setError(null);
    try {
      await window.nodus.updateSettings(replaceModelPatch(settings, from, to));
      await onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setApplying(false); }
  };
  return (
    <div className="mt-3 space-y-2 text-xs" data-testid="stale-favorites">
      {unreadable.length > 0 && <div className="text-neutral-500">{tx('No se pudo comprobar: {providers}', { providers: unreadable.join(', ') })}</div>}
      {stale.length === 0 ? (
        unreadable.length === 0
          ? <div className="text-emerald-600 dark:text-emerald-400">{t('Todos los favoritos aparecen en los catálogos comprobados.')}</div>
          : <div className="text-neutral-500">{t('La comprobación está incompleta; la disponibilidad de los modelos no comprobados sigue sin confirmar.')}</div>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-950/20">
          <div className="font-medium text-amber-900 dark:text-amber-200">{t('Favoritos que no aparecen en el catálogo')}</div>
          <p className="mt-1 leading-5 text-amber-800 dark:text-neutral-400">{t('Estos favoritos no aparecen en el catálogo de su proveedor, pero podrían seguir funcionando como alias. Su disponibilidad no está confirmada. Puedes sustituirlos en las tareas que los usan o quitarlos de favoritos.')}</p>
          <div className="mt-2 space-y-2">
            {stale.map((model) => {
              const key = refKey(model);
              const tasks = tasksUsingModel(settings, model).length;
              const options = [
                ...selectable(catalogues, model.provider).filter((option) => !stale.some((candidate) => sameModel(candidate, option))),
                ...favorites.filter((favorite) => favorite.provider !== model.provider
                  && selectable(catalogues, favorite.provider).some((option) => sameModel(option, favorite))
                  && !stale.some((candidate) => sameModel(candidate, favorite))),
              ];
              const suggested = suggestedReplacement(model, options, favorites);
              const selected = choice[key] ?? (suggested ? refKey(suggested) : '');
              const target = options.find((option) => refKey(option) === selected) ?? null;
              return (
                <div key={key} className="flex flex-wrap items-center gap-2" data-testid={`stale-favorite-${model.model}`}>
                  <span className="min-w-40 font-medium text-neutral-800 dark:text-neutral-200">{modelLabel(model)}</span>
                  <span className="text-neutral-500">{tasks ? tx('Lo usan {n} tareas', { n: tasks }) : t('Ninguna tarea lo usa')}</span>
                  {options.length > 0 && <select className="input py-0.5 text-xs" aria-label={t('Sustituir por…')} value={selected} disabled={applying} onChange={(event) => setChoice({ ...choice, [key]: event.target.value })}>
                    {options.map((option) => <option key={refKey(option)} value={refKey(option)}>{modelLabel(option)}</option>)}
                  </select>}
                  {target && <button className="btn btn-primary px-2 py-0.5 text-xs" disabled={applying} onClick={() => void apply(model, target)}>{t('Sustituir')}</button>}
                  <button className="btn btn-ghost px-2 py-0.5 text-xs text-red-600 dark:text-red-400" disabled={applying} onClick={() => void apply(model, null)}>{t('Quitar')}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {error && <div className="text-red-600 dark:text-red-400" role="alert">{error}</div>}
    </div>
  );
}
