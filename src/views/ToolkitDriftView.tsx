// Nodus Drift: the full page inside Nodus Tools. Ambient sounds, layered into one mix, that
// work offline. The mix itself lives in DriftProvider (one per window), so leaving this page
// neither stops nor duplicates it; this view only shows it and sends it orders.
import { useEffect, useMemo, useState } from 'react';
import { DRIFT_CATEGORIES, MAX_SELECTED_SOUNDS, normalizeDriftSearch, type DriftCatalogEntry } from '@shared/drift';
import { ToolkitAppHero } from '../components/ToolkitAppHero';
import { Icon } from '../components/ui';
import { DriftSoundCard, DriftStatus, driftErrorText } from '../components/drift/DriftSoundCard';
import { driftVoiceCount } from '../components/drift/DriftMiniPlayer';
import { useDrift, type DriftVoiceView } from '../components/drift/DriftProvider';
import type { DriftFilter } from '../components/drift/driftState';
import { t, tx } from '../i18n';

const CATEGORY_BY_ID = new Map<string, (typeof DRIFT_CATEGORIES)[number]>(DRIFT_CATEGORIES.map((category) => [category.id, category]));

function categoryLabel(id: string): string {
  const category = CATEGORY_BY_ID.get(id);
  return category ? t(category.nameKey) : '';
}

export function ToolkitDriftView({ onBack }: { onBack: () => void }) {
  const drift = useDrift();
  const [query, setQuery] = useState('');

  // Asked once when the page opens (and again from the retry button), never at start-up.
  const { loadCatalog } = drift;
  useEffect(() => { void loadCatalog().catch(() => undefined); }, [loadCatalog]);

  const active = drift.playing || drift.loading;
  const favorites = useMemo(() => new Set(drift.favorites), [drift.favorites]);
  const voiceById = useMemo(() => new Map(drift.voices.map((voice) => [voice.id, voice])), [drift.voices]);
  const selected = useMemo(() => new Set(drift.selection), [drift.selection]);

  const search = normalizeDriftSearch(query);
  const visible = useMemo(() => drift.sounds.filter((sound) => {
    if (drift.filter === 'favorites' && !favorites.has(sound.id)) return false;
    if (drift.filter !== 'all' && drift.filter !== 'favorites' && sound.categoryId !== drift.filter) return false;
    if (!search) return true;
    const haystack = normalizeDriftSearch(`${t(sound.nameKey)} ${t(sound.descriptionKey)} ${categoryLabel(sound.categoryId)}`);
    return haystack.includes(search);
  }), [drift.sounds, drift.filter, favorites, search]);

  const operative = visible.filter((sound) => sound.availability === 'available');
  const unavailable = visible.filter((sound) => sound.availability !== 'available');
  const anyRecordingAvailable = drift.sounds.some((sound) => sound.source.kind === 'file' && sound.availability === 'available');
  const anyPending = drift.sounds.some((sound) => sound.availability === 'license-unresolved');
  const showBinauralHelp = drift.filter === 'binaural' || drift.voices.some((voice) => voice.kind === 'binaural');

  const renderCard = (sound: DriftCatalogEntry) => (
    <li key={sound.id} className="min-w-0">
      <DriftSoundCard
        sound={sound}
        categoryLabel={categoryLabel(sound.categoryId)}
        selected={selected.has(sound.id)}
        favorite={favorites.has(sound.id)}
        voice={voiceById.get(sound.id)}
        onToggle={() => drift.toggleSound(sound.id)}
        onToggleFavorite={() => drift.toggleFavorite(sound.id)}
      />
    </li>
  );

  const filters: Array<{ id: DriftFilter; label: string }> = [
    { id: 'all', label: t('Todos') },
    { id: 'favorites', label: t('Favoritos') },
    ...DRIFT_CATEGORIES.map((category) => ({ id: category.id as DriftFilter, label: t(category.nameKey) })),
  ];

  return (
    <div data-testid="toolkit-drift" className="mx-auto max-w-7xl space-y-6">
      <ToolkitAppHero
        badge="Nodus Toolkit"
        title="Nodus Drift"
        description={t('Combina sonidos ambiente para acompañar la lectura, el estudio y el descanso, sin conexión.')}
        icon="drift"
        actionLabel={drift.loading && !drift.playing ? t('Cargando…') : active ? t('Pausar') : t('Reproducir')}
        actionIcon={active ? 'pause' : 'play'}
        onAction={drift.togglePlayback}
        onBack={onBack}
        heroTestId="toolkit-drift-hero"
        actionTestId="drift-play-toggle"
        backTestId="toolkit-drift-back"
        backLabel={t('Volver a herramientas')}
        actionDisabled={drift.selection.length === 0}
        actionClassName="disabled:cursor-not-allowed disabled:opacity-50"
        actionBusy={drift.loading && !drift.playing}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <section aria-label={t('Sonidos')} className="min-w-0 space-y-4">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
              <Icon name="search" size={18} />
            </span>
            <input
              type="search"
              data-testid="drift-search"
              aria-label={t('Buscar sonidos')}
              placeholder={t('Buscar sonidos')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }}
              className="w-full rounded-xl border border-neutral-200 bg-white py-3 pl-10 pr-12 text-sm text-neutral-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-100 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label={t('Limpiar búsqueda')}
                title={t('Limpiar búsqueda')}
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <Icon name="x" size={16} />
              </button>
            )}
          </div>

          <div role="group" aria-label={t('Filtrar sonidos')} className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                data-testid={`drift-filter-${filter.id}`}
                aria-pressed={drift.filter === filter.id}
                onClick={() => drift.setFilter(filter.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${
                  drift.filter === filter.id
                    ? 'border-amber-400 bg-amber-100 font-semibold text-amber-800 dark:border-amber-500/60 dark:bg-amber-500/20 dark:text-amber-200'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-amber-300 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-300 dark:hover:border-amber-500/50'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {drift.catalogStatus === 'error' && (
            <div data-testid="drift-catalog-error" role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <Icon name="alert" size={16} />
              <span className="min-w-0 flex-1">{t('No se pudo cargar el catálogo de sonidos.')}</span>
              <button type="button" data-testid="drift-catalog-retry" className="btn btn-ghost border border-red-300 px-3 py-1 text-xs dark:border-red-900/60" onClick={() => void drift.loadCatalog(true).catch(() => undefined)}>
                <Icon name="refresh" size={13} />
                {t('Reintentar')}
              </button>
            </div>
          )}

          {drift.catalogStatus === 'ready' && anyPending && (
            <p data-testid="drift-license-note" className="flex items-start gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-400">
              <Icon name="info" size={14} className="mt-0.5" />
              <span>
                {anyRecordingAvailable
                  ? t('Algunas grabaciones todavía no están incluidas: falta confirmar su licencia de distribución.')
                  : t('Las grabaciones ambientales todavía no están incluidas: falta confirmar su licencia de distribución. El ruido y los tonos binaurales se generan en tu equipo y funcionan sin conexión.')}
              </span>
            </p>
          )}

          {drift.limitNotice !== null && (
            <div data-testid="drift-limit-notice" role="status" className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <Icon name="warning" size={16} />
              <span className="min-w-0 flex-1">{tx('La mezcla admite como máximo {max} sonidos. Quita uno para añadir otro.', { max: MAX_SELECTED_SOUNDS })}</span>
              <button type="button" aria-label={t('Cerrar')} title={t('Cerrar')} className="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-500/20" onClick={drift.dismissNotice}>
                <Icon name="x" size={14} />
              </button>
            </div>
          )}

          {drift.catalogStatus === 'loading' && drift.sounds.length === 0 && (
            <p role="status" className="py-8 text-center text-sm text-neutral-500">{t('Cargando…')}</p>
          )}

          {drift.catalogStatus !== 'loading' && drift.sounds.length > 0 && visible.length === 0 && (
            <p role="status" data-testid="drift-no-results" className="py-10 text-center text-sm text-neutral-500">
              {drift.filter === 'favorites' && !search ? t('Aún no tienes sonidos favoritos.') : t('Sin resultados')}
            </p>
          )}

          {showBinauralHelp && (
            <p data-testid="drift-binaural-help" className="flex items-start gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <Icon name="drift" size={14} className="mt-0.5" />
              {t('Usa auriculares estéreo para percibir la separación entre canales.')}
            </p>
          )}

          {operative.length > 0 && (
            <ul data-testid="drift-grid" className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
              {operative.map(renderCard)}
            </ul>
          )}

          {unavailable.length > 0 && (
            <details data-testid="drift-unavailable" className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <summary className="cursor-pointer select-none text-sm font-medium text-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 dark:text-neutral-300">
                {tx('{n} sonidos no disponibles', { n: unavailable.length })}
              </summary>
              <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                {unavailable.map(renderCard)}
              </ul>
            </details>
          )}
        </section>

        <DriftMixPanel />
      </div>
    </div>
  );
}

function DriftMixPanel() {
  const drift = useDrift();
  const count = drift.voices.length;
  const active = drift.playing || drift.loading;

  return (
    <aside
      data-testid="drift-mix"
      aria-label={t('Mezcla')}
      className="toolkit-workspace-card min-w-0 space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40 lg:sticky lg:top-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Mezcla')}</h2>
        <span data-testid="drift-mix-count" role="status" className="text-xs text-neutral-500 dark:text-neutral-400">
          {tx('{n} de {max} sonidos', { n: count, max: MAX_SELECTED_SOUNDS })}
        </span>
      </div>

      {count === 0 ? (
        <p data-testid="drift-mix-empty" className="rounded-xl border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {t('Elige uno o varios sonidos para crear tu mezcla.')}
        </p>
      ) : (
        <ul className="space-y-3">
          {drift.voices.map((voice) => (
            <DriftMixVoice key={voice.id} voice={voice} />
          ))}
        </ul>
      )}

      <div className="space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <label className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
          <Icon name="volume" size={15} className="text-neutral-400" />
          <span className="sr-only">{t('Volumen general')}</span>
          <input
            type="range"
            data-testid="drift-master"
            min={0}
            max={100}
            step={1}
            aria-label={t('Volumen general')}
            value={Math.round(drift.master * 100)}
            onChange={(event) => drift.setMaster(Number(event.currentTarget.value) / 100)}
            className="w-full accent-amber-500"
          />
          <output className="w-9 text-right tabular-nums text-neutral-500">{Math.round(drift.master * 100)}%</output>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="drift-mix-toggle"
            aria-pressed={active}
            disabled={count === 0}
            onClick={drift.togglePlayback}
            className="btn btn-primary flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name={active ? 'pause' : 'play'} size={15} />
            {active ? t('Pausar') : t('Reproducir')}
          </button>
          <button
            type="button"
            data-testid="drift-clear"
            disabled={count === 0}
            onClick={drift.clear}
            className="btn btn-ghost border border-neutral-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          >
            <Icon name="trash" size={14} />
            {t('Limpiar mezcla')}
          </button>
        </div>
        <p className="sr-only" role="status">{driftVoiceCount(count)}</p>
      </div>
    </aside>
  );
}

function DriftMixVoice({ voice }: { voice: DriftVoiceView }) {
  const drift = useDrift();
  const name = t(voice.nameKey);
  const percent = Math.round(voice.volume * 100);
  return (
    <li data-testid={`drift-mix-voice-${voice.id}`} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Icon name={voice.icon} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{name}</span>
          <span data-testid={`drift-mix-voice-${voice.id}-status`} className="block text-[11px] text-neutral-500 dark:text-neutral-400">
            <DriftStatus status={voice.status} />
          </span>
        </span>
        <button
          type="button"
          data-testid={`drift-remove-${voice.id}`}
          aria-label={tx('Quitar {name} de la mezcla', { name })}
          title={tx('Quitar {name} de la mezcla', { name })}
          onClick={() => drift.removeSound(voice.id)}
          className="shrink-0 rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 dark:hover:bg-neutral-800"
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      <label className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
        <span className="sr-only">{tx('Volumen de {name}', { name })}</span>
        <input
          type="range"
          data-testid={`drift-volume-${voice.id}`}
          min={0}
          max={100}
          step={1}
          aria-label={tx('Volumen de {name}', { name })}
          value={percent}
          onChange={(event) => drift.setVolume(voice.id, Number(event.currentTarget.value) / 100)}
          className="w-full accent-amber-500"
        />
        <output className="w-9 text-right tabular-nums text-neutral-500">{percent}%</output>
      </label>
      {voice.status === 'error' && (
        <div data-testid={`drift-error-${voice.id}`} role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">
          <Icon name="alert" size={13} className="mt-0.5" />
          <span className="min-w-0 flex-1">{driftErrorText(voice.error ?? 'unknown')}</span>
          <button
            type="button"
            data-testid={`drift-retry-${voice.id}`}
            aria-label={tx('Reintentar {name}', { name })}
            onClick={() => drift.retrySound(voice.id)}
            className="rounded border border-red-300 px-2 py-0.5 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 dark:border-red-900/60 dark:hover:bg-red-900/30"
          >
            {t('Reintentar')}
          </button>
        </div>
      )}
    </li>
  );
}
