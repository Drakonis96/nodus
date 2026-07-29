import { useEffect, useRef, useState } from 'react';
import { Spinner } from '../ui';
import { type MediaAccent } from './mediaFormat';
import { t } from '../../i18n';

/**
 * El reproductor de un archivo local, extraído de `StudyRecordingsView`.
 *
 * Recibe un CARGADOR y no una URL: los bytes viven dentro de la base de datos, así que
 * quien lo use tiene que pedirlos por IPC y crear un object URL — y revocarlo al salir,
 * que es lo que evita que una sesión larga acumule cientos de megabytes de blobs
 * huérfanos en el renderer.
 *
 * `onAudioRef` publica el elemento hacia arriba para que la transcripción pueda saltar a
 * un tiempo concreto. Esa es la operación que da sentido a todo el vertical: una cita que
 * no puede volver al audio es una cita que nadie puede comprobar.
 *
 * Velocidades de 0,5× a 2× (17 del plan): escuchar despacio es cómo se transcribe a mano
 * un acento cerrado, y escuchar rápido es cómo se localiza un pasaje.
 */
export function MediaPlayer({
  mediaId,
  accent,
  load,
  onAudioRef,
  initialTime,
  testid = 'media-player',
}: {
  /** Cambia el archivo cargado. Se usa como clave de recarga. */
  mediaId: string;
  accent: MediaAccent;
  load: (mediaId: string) => Promise<{ bytes: ArrayBuffer | Uint8Array; mimeType: string } | null>;
  onAudioRef: (audio: HTMLAudioElement | null) => void;
  initialTime?: number | null;
  testid?: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekConsumed = useRef(false);

  useEffect(() => {
    let active = true;
    let current = '';
    seekConsumed.current = false;
    setUrl('');
    void load(mediaId)
      .then((content) => {
        if (!active) return;
        if (!content) {
          // Un archivo cuyos bytes se soltaron a propósito para ahorrar espacio: la ficha
          // y la transcripción siguen ahí, y decirlo es más útil que un reproductor roto.
          setError(t('Este archivo ya no guarda su audio en la bóveda. Su ficha, su huella y sus transcripciones siguen aquí.'));
          return;
        }
        const bytes = content.bytes instanceof Uint8Array ? content.bytes : new Uint8Array(content.bytes);
        current = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: content.mimeType }));
        setUrl(current);
        setError('');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
      onAudioRef(null);
    };
    // Depende SOLO de `mediaId`: `load` y `onAudioRef` son cierres nuevos en cada render,
    // y depender de ellos recargaría el audio en cada pintado, perdiendo el punto de
    // reproducción justo mientras alguien transcribe.
  }, [mediaId]);

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
        {error}
      </div>
    );
  }
  if (!url) return <div className="flex h-20 items-center justify-center"><Spinner /></div>;

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/60" data-testid={testid}>
      <audio
        ref={(node) => {
          audioRef.current = node;
          onAudioRef(node);
          if (node && initialTime != null && !seekConsumed.current) {
            node.currentTime = initialTime;
            seekConsumed.current = true;
          }
        }}
        className="w-full"
        controls
        preload="metadata"
        src={url}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-ghost h-7 px-2 text-xs"
          aria-label={t('Retroceder diez segundos')}
          onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10); }}
        >
          −10 s
        </button>
        <button
          className="btn btn-ghost h-7 px-2 text-xs"
          aria-label={t('Avanzar diez segundos')}
          onClick={() => { if (audioRef.current) audioRef.current.currentTime += 10; }}
        >
          +10 s
        </button>
        <label className="ml-auto flex items-center gap-1 text-[10px] text-neutral-500">
          {t('Velocidad')}
          <select
            className="input h-7 w-20 py-0 text-xs"
            defaultValue="1"
            onChange={(event) => { if (audioRef.current) audioRef.current.playbackRate = Number(event.target.value); }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-neutral-500">
          {t('Volumen')}
          <input
            className={`w-20 ${accent.range}`}
            type="range"
            min="0"
            max="1"
            step="0.05"
            defaultValue="1"
            onChange={(event) => { if (audioRef.current) audioRef.current.volume = Number(event.target.value); }}
          />
        </label>
      </div>
    </div>
  );
}
