import { Icon } from '../ui';
import { t, tx } from '../../i18n';
import { useDrift } from './DriftProvider';

/** "Mezcla vacía", "1 sonido en la mezcla", "3 sonidos en la mezcla". */
export function driftVoiceCount(n: number): string {
  if (n === 0) return t('Mezcla vacía');
  if (n === 1) return t('1 sonido en la mezcla');
  return tx('{n} sonidos en la mezcla', { n });
}

/**
 * The header's quick controls for Nodus Drift: a remote control, not a second app.
 *
 * Title, how many voices, play/pause for the whole mix, the master volume, clear, and a way
 * into the tool. The catalogue and the per-voice mixer stay on the Tools page; this panel
 * has no selection logic of its own, it only calls the same actions the page does. Its
 * volume slider moves the Drift master bus and nothing else: not the system volume, not
 * the Browser's.
 */
export function DriftMiniPlayer({ onOpenDrift }: { onOpenDrift: () => void }) {
  const drift = useDrift();
  const count = drift.selection.length;
  const active = drift.playing || drift.loading;
  const names = drift.voices.map((voice) => t(voice.nameKey));

  return (
    <div data-testid="drift-mini-player" className="flex flex-col gap-2 p-1.5">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
          <Icon name="drift" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-neutral-100">Nodus Drift</div>
          <div data-testid="drift-mini-count" role="status" className="truncate text-[11px] text-neutral-400">
            {driftVoiceCount(count)}
            {count > 0 && (
              <>
                {' · '}
                {drift.playing ? t('Reproduciendo') : drift.loading ? t('Cargando…') : t('En pausa')}
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          data-testid="drift-mini-toggle"
          aria-pressed={active}
          aria-label={active ? t('Pausar') : t('Reproducir')}
          title={active ? t('Pausar') : t('Reproducir')}
          disabled={count === 0}
          onClick={drift.togglePlayback}
          className="shrink-0 rounded p-1.5 text-neutral-300 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name={active ? 'pause' : 'play'} size={15} className={drift.loading && !drift.playing ? 'animate-pulse' : ''} />
        </button>
      </div>

      {names.length > 0 && (
        <p data-testid="drift-mini-voices" className="truncate px-1 text-[11px] text-neutral-500" title={names.join(' · ')}>
          {names.join(' · ')}
        </p>
      )}

      <label className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-1 text-xs text-neutral-300">
        <Icon name="volume" size={14} className="text-neutral-400" />
        <span className="sr-only">{t('Volumen general')}</span>
        <input
          type="range"
          data-testid="drift-mini-master"
          min={0}
          max={100}
          step={1}
          aria-label={t('Volumen general')}
          value={Math.round(drift.master * 100)}
          onChange={(event) => drift.setMaster(Number(event.currentTarget.value) / 100)}
          className="w-full accent-indigo-500"
        />
        <output className="w-9 text-right tabular-nums text-neutral-400">{Math.round(drift.master * 100)}%</output>
      </label>

      {/* Wrapping the row, not the labels: two buttons side by side when both fit, one under the other when a language is longer. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="drift-mini-clear"
          disabled={count === 0}
          onClick={drift.clear}
          className="btn btn-ghost flex-1 justify-center whitespace-nowrap border border-neutral-700 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="trash" size={13} />
          {t('Limpiar mezcla')}
        </button>
        <button
          type="button"
          data-testid="drift-mini-open"
          onClick={onOpenDrift}
          className="btn btn-ghost flex-1 justify-center whitespace-nowrap border border-neutral-700 py-1 text-xs"
        >
          <Icon name="external" size={13} />
          {t('Abrir Nodus Drift')}
        </button>
      </div>
    </div>
  );
}
