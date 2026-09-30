// Drift owns its visual workspace; the window-level provider still owns all playback.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DRIFT_CATEGORIES, MAX_SELECTED_SOUNDS, normalizeDriftSearch, type DriftCatalogEntry } from '@shared/drift';
import type { AppSettings } from '@shared/types';
import { Icon } from '../components/ui';
import { DriftSoundCard, DriftStatus, DriftVoiceControls } from '../components/drift/DriftSoundCard';
import { DriftMeditatingNodi } from '../components/drift/DriftMeditatingNodi';
import { DriftPresets, DriftPresetEditor } from '../components/drift/DriftPresets';
import { DriftSortMenu } from '../components/drift/DriftSortMenu';
import { sortDriftItems } from '../components/drift/driftSort';
import { driftVoiceCount } from '../components/drift/DriftMiniPlayer';
import { useDrift, type DriftVoiceView } from '../components/drift/DriftProvider';
import { MAX_DRIFT_PRESETS, type DriftFilter, type DriftPreset } from '../components/drift/driftState';
import { getActiveLang, t, tx } from '../i18n';
import '../components/drift/drift.css';

const CATEGORY_BY_ID = new Map<string, (typeof DRIFT_CATEGORIES)[number]>(DRIFT_CATEGORIES.map((category) => [category.id, category]));
function categoryLabel(id: string): string {
  const category = CATEGORY_BY_ID.get(id);
  return category ? t(category.nameKey) : '';
}

export function ToolkitDriftView({ onBack, settings }: { onBack: () => void; settings?: AppSettings | null }) {
  const drift = useDrift();
  const [query, setQuery] = useState('');
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [presetEditor, setPresetEditor] = useState<DriftPreset | 'new' | null>(null);
  const { loadCatalog } = drift;
  useEffect(() => { void loadCatalog().catch(() => undefined); }, [loadCatalog]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    const update = () => setFullscreen(document.fullscreenElement === workspace);
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.fullscreenElement !== workspace) return;
      if (workspace?.querySelector('.drift-preset-editor,[data-testid="drift-sort-menu"]')) return;
      event.preventDefault();
      event.stopPropagation();
      void document.exitFullscreen().catch(() => setFullscreenError(true));
    };
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('keydown', exitOnEscape, true);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('keydown', exitOnEscape, true);
      if (document.fullscreenElement === workspace) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const toggleFullscreen = async () => {
    setFullscreenError(false);
    try {
      if (document.fullscreenElement === workspaceRef.current) await document.exitFullscreen();
      else await workspaceRef.current?.requestFullscreen();
    } catch { setFullscreenError(true); }
  };

  const favorites = useMemo(() => new Set(drift.favorites), [drift.favorites]);
  const voiceById = useMemo(() => new Map(drift.voices.map((voice) => [voice.id, voice])), [drift.voices]);
  const selected = useMemo(() => new Set(drift.selection), [drift.selection]);
  const search = normalizeDriftSearch(query);
  const language = getActiveLang();
  const visible = useMemo(() => sortDriftItems(drift.sounds.filter((sound) => {
    if (drift.filter === 'active' || drift.filter === 'presets') return false;
    if (drift.filter === 'favorites' && !favorites.has(sound.id)) return false;
    if (drift.filter !== 'all' && drift.filter !== 'favorites' && sound.categoryId !== drift.filter) return false;
    return !search || normalizeDriftSearch(`${t(sound.nameKey)} ${t(sound.descriptionKey)} ${categoryLabel(sound.categoryId)}`).includes(search);
  }), drift.sort, { language, name: (sound) => t(sound.nameKey), type: (sound) => categoryLabel(sound.categoryId), uses: (sound) => drift.usage[sound.id] ?? 0 }),
  [drift.sounds, drift.filter, drift.sort, drift.usage, favorites, search, language]);
  // Read voices, not catalogue availability: paused, failed and restored sounds remain manageable.
  const activeVoices = sortDriftItems(drift.voices.filter((voice) => !search || normalizeDriftSearch(`${t(voice.nameKey)} ${categoryLabel(voice.categoryId ?? '')}`).includes(search)),
    drift.sort, { language, name: (voice) => t(voice.nameKey), type: (voice) => categoryLabel(voice.categoryId ?? ''), uses: (voice) => drift.usage[voice.id] ?? 0 });
  const operative = visible.filter((sound) => sound.availability === 'available');
  const unavailable = visible.filter((sound) => sound.availability !== 'available');
  const anyRecordingAvailable = drift.sounds.some((sound) => sound.source.kind === 'file' && sound.availability === 'available');
  const anyPending = drift.sounds.some((sound) => sound.availability === 'license-unresolved');
  const showBinauralHelp = drift.filter === 'binaural' || drift.voices.some((voice) => voice.kind === 'binaural');
  const renderCard = (sound: DriftCatalogEntry) => <li key={sound.id}>
    <DriftSoundCard sound={sound} categoryLabel={categoryLabel(sound.categoryId)} selected={selected.has(sound.id)}
      favorite={favorites.has(sound.id)} voice={voiceById.get(sound.id)} onToggle={() => drift.toggleSound(sound.id)}
      onToggleFavorite={() => drift.toggleFavorite(sound.id)} onVolume={(value) => drift.setVolume(sound.id, value)} onRetry={() => drift.retrySound(sound.id)} />
  </li>;
  const filters: Array<{ id: DriftFilter; label: string }> = [
    { id: 'all', label: t('Todos') }, { id: 'active', label: t('Activos') }, { id: 'presets', label: t('Predefinidos') }, { id: 'favorites', label: t('Favoritos') },
    ...DRIFT_CATEGORIES.map((category) => ({ id: category.id as DriftFilter, label: t(category.nameKey) })),
  ];

  return (
    <div ref={workspaceRef} data-testid="toolkit-drift" className="drift-workspace theme-workspace-surface" data-fullscreen={fullscreen}>
      <header className="drift-header">
        <button type="button" data-testid="toolkit-drift-back" onClick={onBack} title={t('Volver a herramientas')}>
          <Icon name="arrowLeft" size={19} /><span>{t('Herramientas')}</span>
        </button>
        <span className="drift-header-brand">Nodus Drift</span>
        <button type="button" className="drift-fullscreen-toggle" data-testid="drift-fullscreen-toggle" aria-label={fullscreen ? t('Salir de pantalla completa') : t('Pantalla completa')} aria-pressed={fullscreen} onClick={() => void toggleFullscreen()}>
          <Icon name={fullscreen ? 'minimize' : 'maximize'} size={17} />
          <span>{fullscreen ? t('Salir de pantalla completa') : t('Pantalla completa')}</span>{fullscreen && <kbd>Esc</kbd>}
        </button>
      </header>
      <div className="drift-scroll">
        <div className="drift-content">
          <section className="drift-hero" data-testid="toolkit-drift-hero" aria-label="Nodus Drift">
            <DriftMeditatingNodi reduceMotion={settings?.reduceMotion} />
            <h1>Nodus Drift</h1>
            <p>{t('Sonidos para leer, estudiar y descansar')}</p>
          </section>
          <section className="drift-catalog" aria-label={t('Sonidos')}>
            <div className="drift-search-row">
            <div className="drift-search">
              <Icon name="search" size={17} />
              <input type="search" data-testid="drift-search" aria-label={drift.filter === 'presets' ? t('Buscar predefinidos') : t('Buscar sonidos')} placeholder={drift.filter === 'presets' ? t('Buscar predefinidos') : t('Buscar sonidos')}
                value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }} />
              {query && <button type="button" aria-label={t('Limpiar búsqueda')} title={t('Limpiar búsqueda')} onClick={() => setQuery('')}><Icon name="x" size={16} /></button>}
            </div>
            <DriftSortMenu />
            </div>
            <div role="group" aria-label={t('Filtrar sonidos')} className="drift-filters">
              {filters.map((filter) => <button key={filter.id} type="button" data-testid={`drift-filter-${filter.id}`}
                aria-pressed={drift.filter === filter.id} onClick={() => { drift.setFilter(filter.id); if (filter.id === 'active') setQuery(''); }}>
                {filter.label}{filter.id === 'active' && <span className="drift-active-count">{drift.voices.length}</span>}
              </button>)}
            </div>
            {fullscreenError && <p role="alert" className="drift-fullscreen-error">{t('No se pudo activar la pantalla completa.')}</p>}
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

          {drift.catalogStatus !== 'loading' && drift.filter !== 'active' && drift.filter !== 'presets' && drift.sounds.length > 0 && visible.length === 0 && (
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

            {drift.filter === 'presets' ? <DriftPresets query={query} onEdit={setPresetEditor} onApplied={() => setQuery('')} /> : drift.filter === 'active' ? (
              activeVoices.length > 0 ? <ul data-testid="drift-active-grid" className="drift-grid drift-active-grid">{activeVoices.map((voice) => <DriftActiveVoice key={voice.id} voice={voice} />)}</ul>
                : <p role="status" data-testid="drift-active-empty" className="drift-empty">{search ? t('Sin resultados') : t('Elige uno o varios sonidos para crear tu mezcla.')}</p>
            ) : operative.length > 0 && <ul data-testid="drift-grid" className="drift-grid">{operative.map(renderCard)}</ul>}
            {unavailable.length > 0 && <details data-testid="drift-unavailable" className="drift-unavailable">
              <summary>{tx('{n} sonidos no disponibles', { n: unavailable.length })}</summary>
              <ul className="drift-grid">{unavailable.map(renderCard)}</ul>
            </details>}
          </section>

        </div>
      </div>
      <footer className="drift-attribution">
        <button type="button" data-testid="drift-moodist-credit" onClick={() => void window.nodus.openExternal('https://github.com/remvze/moodist')}
          title={t('Moodist: código MIT; grabaciones bajo Pixabay Content License o CC0.')}>
          Powered by <strong>remvze/moodist</strong> (MIT)<Icon name="external" size={11} />
        </button>
      </footer>
      <DriftMixDock onOpenActive={() => { drift.setFilter('active'); setQuery(''); }} onSave={() => setPresetEditor('new')} />
      {presetEditor && <DriftPresetEditor preset={presetEditor === 'new' ? undefined : presetEditor} onClose={() => setPresetEditor(null)} />}
    </div>
  );
}

function DriftActiveVoice({ voice }: { voice: DriftVoiceView }) {
  const drift = useDrift();
  const name = t(voice.nameKey);
  return <li className="drift-sound-card drift-active-card" data-testid={`drift-active-voice-${voice.id}`} data-selected="true">
    <Icon name={voice.icon} size={30} className="drift-sound-icon" />
    <strong className="drift-sound-name">{name}</strong>
    <DriftStatus status={voice.status} />
    <button type="button" className="drift-active-remove" data-testid={`drift-active-remove-${voice.id}`} aria-label={tx('Quitar {name} de la mezcla', { name })}
      title={tx('Quitar {name} de la mezcla', { name })} onClick={() => drift.removeSound(voice.id)}><Icon name="x" size={15} /></button>
    <DriftVoiceControls voice={voice} onVolume={(value) => drift.setVolume(voice.id, value)} onRetry={() => drift.retrySound(voice.id)} />
  </li>;
}

function DriftMixDock({ onOpenActive, onSave }: { onOpenActive: () => void; onSave: () => void }) {
  const drift = useDrift();
  const count = drift.voices.length;
  const active = drift.playing || drift.loading;
  return <aside data-testid="drift-mix" aria-label={t('Mezcla')} className="drift-dock">
    <button type="button" className="drift-mix-heading" onClick={onOpenActive} title={t('Activos')}>
      <strong>{t('Tu mezcla')}</strong><span data-testid="drift-mix-count" role="status" aria-label={tx('{n} de {max} sonidos', { n: count, max: MAX_SELECTED_SOUNDS })}>{count} / {MAX_SELECTED_SOUNDS}</span>
    </button>
    {count === 0 ? <p data-testid="drift-mix-empty" className="drift-dock-empty">{t('Elige uno o varios sonidos para crear tu mezcla.')}</p>
      : <ul className="drift-mix-chips">{drift.voices.map((voice) => {
        const name = t(voice.nameKey);
        return <li key={voice.id} data-testid={`drift-mix-voice-${voice.id}`} className="drift-mix-chip" data-error={voice.status === 'error'}>
          <button type="button" onClick={onOpenActive} title={`${name} · ${t('Activos')}`}><Icon name={voice.status === 'error' ? 'alert' : voice.icon} size={14} /><span>{name}</span></button>
          <span className="sr-only" data-testid={`drift-mix-voice-${voice.id}-status`}><DriftStatus status={voice.status} /></span>
          <button type="button" data-testid={`drift-remove-${voice.id}`} aria-label={tx('Quitar {name} de la mezcla', { name })} title={tx('Quitar {name} de la mezcla', { name })} onClick={() => drift.removeSound(voice.id)}><Icon name="x" size={12} /></button>
        </li>;
      })}</ul>}
    <button type="button" data-testid="drift-mix-toggle" className="drift-play" aria-pressed={active} disabled={count === 0} onClick={drift.togglePlayback}
      aria-label={active ? t('Pausar') : t('Reproducir')} title={active ? t('Pausar') : t('Reproducir')}>
      <Icon name={drift.loading && !drift.playing ? 'refresh' : active ? 'pause' : 'play'} size={24} className={drift.loading && !drift.playing ? 'animate-spin' : ''} />
    </button>
    <label className="drift-master drift-volume"><Icon name="volume" size={18} /><span className="sr-only">{t('Volumen general')}</span>
      <input type="range" data-testid="drift-master" min={0} max={100} step={1} aria-label={t('Volumen general')} value={Math.round(drift.master * 100)} style={{ '--drift-volume': `${Math.round(drift.master * 100)}%` } as CSSProperties} onChange={(event) => drift.setMaster(Number(event.currentTarget.value) / 100)} />
      <output>{Math.round(drift.master * 100)}%</output>
    </label>
    <button type="button" data-testid="drift-save-preset" className="drift-save" aria-label={t('Guardar predefinido')} title={t('Guardar predefinido')} disabled={count === 0 || drift.presets.length >= MAX_DRIFT_PRESETS} onClick={onSave}><Icon name="save" size={16} /><span>{t('Guardar predefinido')}</span></button>
    <button type="button" data-testid="drift-clear" className="drift-clear" aria-label={t('Limpiar mezcla')} disabled={count === 0} onClick={drift.clear}><Icon name="trash" size={16} /><span>{t('Limpiar mezcla')}</span></button>
    <p className="sr-only" role="status">{driftVoiceCount(count)}</p>
  </aside>;
}
