import type { CSSProperties } from 'react';
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
      : status === 'error' ? t('Error') : t('En pausa');
  const icon = status === 'playing' ? 'volume' : status === 'loading' ? 'refresh' : status === 'error' ? 'alert' : 'pause';
  return <span className="drift-status"><Icon name={icon} size={11} className={status === 'loading' ? 'animate-spin' : ''} />{label}</span>;
}

/** Shared by selected catalogue tiles and the Active filter, including restored voices
 * whose catalogue entry is missing. Volume and retry never sit inside the sound toggle. */
export function DriftVoiceControls({ voice, onVolume, onRetry }: {
  voice: DriftVoiceView;
  onVolume: (value: number) => void;
  onRetry: () => void;
}) {
  const name = t(voice.nameKey);
  const percent = Math.round(voice.volume * 100);
  return (
    <div className="drift-voice-controls">
      <label className="drift-volume">
        <span className="sr-only">{tx('Volumen de {name}', { name })}</span>
        <input type="range" data-testid={`drift-volume-${voice.id}`} min={0} max={100} step={1}
          aria-label={tx('Volumen de {name}', { name })} value={percent} style={{ '--drift-volume': `${percent}%` } as CSSProperties}
          onChange={(event) => onVolume(Number(event.currentTarget.value) / 100)} />
        <output>{percent}%</output>
      </label>
      {voice.status === 'error' && (
        <div data-testid={`drift-error-${voice.id}`} role="alert" className="drift-voice-error">
          <Icon name="alert" size={13} />
          <span>{driftErrorText(voice.error ?? 'unknown')}</span>
          <button type="button" data-testid={`drift-retry-${voice.id}`} aria-label={tx('Reintentar {name}', { name })} onClick={onRetry}>{t('Reintentar')}</button>
        </div>
      )}
    </div>
  );
}

interface DriftSoundCardProps {
  sound: DriftCatalogEntry;
  categoryLabel: string;
  selected: boolean;
  favorite: boolean;
  voice: DriftVoiceView | undefined;
  onToggle: () => void;
  onToggleFavorite: () => void;
  onVolume: (value: number) => void;
  onRetry: () => void;
}

/** Independent sibling buttons keep favourite, volume and retry from toggling a sound. */
export function DriftSoundCard({ sound, categoryLabel, selected, favorite, voice, onToggle, onToggleFavorite, onVolume, onRetry }: DriftSoundCardProps) {
  const name = t(sound.nameKey);
  const operative = sound.availability === 'available';
  const reason = sound.availability === 'license-unresolved' ? t('Pendiente de revisión de licencia') : t('No se encuentra el archivo');
  const body = <>
    <Icon name={sound.icon} size={30} className="drift-sound-icon" />
    <span className="drift-sound-name">{name}</span>
    <span className="sr-only">{t(sound.descriptionKey)} · {categoryLabel}</span>
    {selected && voice && <span data-testid={`drift-card-${sound.id}-status`} className="drift-sound-status">
      <span className="sr-only">{t('En la mezcla')}</span><DriftStatus status={voice.status} />
    </span>}
    {!operative && <span data-testid={`drift-card-${sound.id}-reason`} className="drift-sound-unavailable"><Icon name="lock" size={11} />{reason}</span>}
  </>;
  return (
    <div className="drift-sound-card" data-testid={`drift-card-${sound.id}`} data-selected={selected} data-unavailable={!operative}>
      {operative ? <button type="button" aria-pressed={selected} onClick={onToggle} title={`${name} · ${t(sound.descriptionKey)}`} className="drift-sound-toggle">{body}</button>
        : <div role="group" aria-label={name} aria-disabled="true" className="drift-sound-toggle">{body}</div>}
      <button type="button" data-testid={`drift-card-${sound.id}-favorite`} aria-pressed={favorite}
        aria-label={tx(favorite ? 'Quitar {name} de favoritos' : 'Añadir {name} a favoritos', { name })}
        title={t(favorite ? 'Quitar de favoritos' : 'Añadir a favoritos')} onClick={onToggleFavorite} className="drift-favorite">
        <Icon name="star" size={14} className={favorite ? 'fill-current' : ''} />
      </button>
      {selected && voice && <DriftVoiceControls voice={voice} onVolume={onVolume} onRetry={onRetry} />}
    </div>
  );
}
