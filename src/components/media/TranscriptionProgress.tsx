import type { MediaAccent } from './mediaFormat';
import { t } from '../../i18n';

/**
 * El progreso de una transcripción local, con lo que va saliendo.
 *
 * El texto parcial no es decoración: transcribir una entrevista de hora y media en local
 * tarda minutos, y ver aparecer las primeras frases es la única prueba de que el modelo
 * está funcionando y no colgado. Sin ella, el usuario cancela y vuelve a empezar.
 */
export function TranscriptionProgress({
  accent,
  progress,
  partial,
  note,
  testid = 'transcription-progress',
}: {
  accent: MediaAccent;
  progress: number;
  partial?: string;
  note?: string;
  testid?: string;
}) {
  return (
    <div className={`rounded-lg border p-2 ${accent.panel}`} data-testid={testid}>
      <div className={`mb-1 flex justify-between text-[10px] ${accent.text}`}>
        <span>{note ?? t('La transcripción se procesa en segundo plano')}</span>
        <span>{Math.round(progress * 100)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
        <div className={`h-full ${accent.bar}`} style={{ width: `${progress * 100}%` }} />
      </div>
      {partial && (
        <p
          className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-neutral-700 dark:text-neutral-300"
          data-testid={`${testid}-stream`}
        >
          {partial}
        </p>
      )}
    </div>
  );
}
