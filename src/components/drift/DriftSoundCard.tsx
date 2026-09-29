import type { DriftCatalogEntry, DriftVoiceErrorCode } from '@shared/drift';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';
import type { DriftVoiceView } from './DriftProvider';

/** The interface's own copy for why a voice failed; the raw error text never reaches the screen. */
export function driftErrorText(code: DriftVoiceErrorCode): string {
  switch (code) {
    case 'unavailable': return t('Este sonido no está disponible.');
    case 'missing': return t('No se encuentra el archivo de este sonido.');
    case 'corrupt': return t('El archivo de este sonido está dañado.');
    case 'too-large': return t('El archivo de este sonido es demasiado grande.');
    case 'decode': return t('No se pudo decodificar este sonido.');
    case 'capacity': return t('No hay memoria suficiente para añadir este sonido. Quita otro e inténtalo de nuevo.');
    default: return t('No se pudo cargar este sonido.');
  }
}

/** Activity is said in words and drawn as an icon, never carried by colour alone. */
export function DriftStatus({ status }: { status: DriftVoiceView['status'] }) {
  const label = status === 'playing' ? t('Reproduciendo')
    : status === 'loading' ? t('Cargando…')
      : status === 'error' ? t('Error')
        : t('En pausa');
  const icon = status === 'playing' ? 'volume' : status === 'loading' ? 'refresh' : status === 'error' ? 'alert' : 'pause';
  return (
    <span className="inline-flex items-center gap-1">
      <Icon name={icon} size={11} className={status === 'loading' ? 'animate-spin' : ''} />
      {label}
    </span>
  );
}

interface DriftSoundCardProps {
  sound: DriftCatalogEntry;
  categoryLabel: string;
  selected: boolean;
  favorite: boolean;
  /** The live voice, when the sound is in the mix. */
  voice: DriftVoiceView | undefined;
  onToggle: () => void;
  onToggleFavorite: () => void;
}

/**
 * One sound of the catalogue.
 *
 * The card is a single toggle button (nothing is nested inside a button) and the favourite
 * star is its SIBLING, positioned over its corner, so pressing the star can never also
 * activate the card. A sound that is pending a licence or has no file is not a button at
 * all: it explains itself and offers no way to play or download anything.
 */
export function DriftSoundCard({ sound, categoryLabel, selected, favorite, voice, onToggle, onToggleFavorite }: DriftSoundCardProps) {
  const name = t(sound.nameKey);
  const operative = sound.availability === 'available';
  const reason = sound.availability === 'license-unresolved'
    ? t('Pendiente de revisión de licencia')
    : t('No se encuentra el archivo');

  const body = (
    <>
      <span className="toolkit-card-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        <Icon name={sound.icon} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="toolkit-card-title block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{name}</span>
        <span className="toolkit-card-description block text-xs leading-snug text-neutral-500 dark:text-neutral-400">{t(sound.descriptionKey)}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span>{categoryLabel}</span>
          {operative && selected && voice && (
            // Two units that wrap as units: a narrow card moves the activity to its own line instead of
            // breaking "En la mezcla" in the middle.
            <span data-testid={`drift-card-${sound.id}-status`} className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium text-amber-700 dark:text-amber-300">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Icon name="check" size={11} />
                {t('En la mezcla')}
              </span>
              <span className="whitespace-nowrap"><DriftStatus status={voice.status} /></span>
            </span>
          )}
          {!operative && (
            <span data-testid={`drift-card-${sound.id}-reason`} className="inline-flex items-center gap-1">
              <Icon name="lock" size={11} />
              {reason}
            </span>
          )}
        </span>
      </span>
    </>
  );

  return (
    <div className="relative h-full" data-testid={`drift-card-${sound.id}`}>
      {operative ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={onToggle}
          className={`toolkit-card flex h-full w-full items-start gap-3 rounded-xl border p-4 pr-12 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${
            selected
              ? 'border-amber-400 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-500/10'
              : 'border-neutral-200 bg-white hover:border-amber-400 dark:border-neutral-800 dark:bg-neutral-900/40 dark:hover:border-amber-500/60'
          }`}
        >
          {body}
        </button>
      ) : (
        <div
          role="group"
          aria-label={name}
          aria-disabled="true"
          className="toolkit-card flex h-full w-full items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 pr-12 text-left opacity-70 dark:border-neutral-800 dark:bg-neutral-900/20"
        >
          {body}
        </div>
      )}
      <button
        type="button"
        data-testid={`drift-card-${sound.id}-favorite`}
        aria-pressed={favorite}
        aria-label={tx(favorite ? 'Quitar {name} de favoritos' : 'Añadir {name} a favoritos', { name })}
        title={t(favorite ? 'Quitar de favoritos' : 'Añadir a favoritos')}
        onClick={onToggleFavorite}
        className={`toolkit-pin-button absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${
          favorite
            ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-300'
            : 'border-neutral-200 bg-white/90 text-neutral-400 hover:border-amber-300 hover:text-amber-600 dark:border-neutral-700 dark:bg-neutral-900/90 dark:hover:border-amber-500/50 dark:hover:text-amber-300'
        }`}
      >
        <Icon name="star" size={15} className={favorite ? 'fill-current' : ''} />
      </button>
    </div>
  );
}
