import { useMemo } from 'react';
import { VirtualList } from '../VirtualList';
import { formatMediaTimestamp, type MediaAccent } from './mediaFormat';
import { t } from '../../i18n';

/**
 * La lista de tramos de una transcripción, editable y saltable al audio.
 *
 * VIRTUALIZADA, y no por elegancia: una entrevista de hora y media son varios miles de
 * tramos, y pintarlos todos a la vez congela la pestaña justo cuando el investigador
 * lleva veinte minutos corrigiendo. `VirtualList` mantiene en el DOM solo lo que se ve.
 *
 * EL BOTÓN DE TIEMPO ES UN BOTÓN DE VERDAD, con nombre accesible, porque saltar al audio
 * es la acción principal de esta pantalla y tiene que poder hacerse con el teclado (17
 * del plan). Editar un tramo no roba el foco al reproductor: el `onBlur` guarda, no un
 * guardado por tecla que reconstruiría la lista bajo el cursor.
 */
export interface EditableSegment {
  id: string;
  tStart: number;
  tEnd: number;
  text: string;
  /** Etiqueta provisional («Hablante 1») o el nombre ya resuelto de la persona. */
  speakerLabel: string | null;
  speakerPersonId?: string | null;
}

export function TranscriptSegmentEditor({
  segments,
  accent,
  readOnly = false,
  speakerOptions,
  onJump,
  onSaveText,
  onSaveSpeaker,
  renderExtra,
  className = '',
  testid = 'transcript-segments',
}: {
  segments: EditableSegment[];
  accent: MediaAccent;
  /** El literal y la versión aprobada no se editan: se derivan. */
  readOnly?: boolean;
  /** Personas a las que se puede atribuir un tramo. Vacío = campo de texto libre. */
  speakerOptions?: { id: string; label: string }[];
  onJump: (seconds: number) => void;
  onSaveText: (segmentId: string, text: string) => void | Promise<void>;
  onSaveSpeaker: (segmentId: string, value: { personId?: string | null; label?: string | null }) => void | Promise<void>;
  /** Contenido adicional por tramo (los códigos aplicados, por ejemplo). */
  renderExtra?: (segment: EditableSegment) => React.ReactNode;
  className?: string;
  testid?: string;
}) {
  // Una estimación por tramo, no una altura fija: un tramo de tres líneas y otro de media
  // no pueden compartir alto sin dejar huecos o recortar texto.
  const heightOf = useMemo(
    () => (segment: EditableSegment) => {
      const lines = Math.max(1, Math.ceil(segment.text.length / 70));
      return 42 + Math.min(6, lines) * 18;
    },
    [],
  );

  if (segments.length === 0) {
    return (
      <p className={`p-4 text-center text-xs text-neutral-500 ${className}`} data-testid={`${testid}-empty`}>
        {t('Esta versión todavía no tiene tramos.')}
      </p>
    );
  }

  return (
    <div data-testid={testid} className="flex min-h-0 flex-col">
      <VirtualList
        className={`overflow-x-hidden ${className}`}
        items={segments}
        itemHeight={heightOf}
        getKey={(segment) => segment.id}
        renderItem={(segment) => (
          <div
            className="grid gap-2 border-b border-neutral-200 p-2 dark:border-neutral-800/80 md:grid-cols-[76px_150px_1fr]"
            data-testid={`${testid}-row`}
            data-segment-id={segment.id}
          >
            <button
              type="button"
              className={`self-start text-left text-xs font-medium ${accent.text}`}
              aria-label={t('Reproducir desde este punto')}
              title={t('Reproducir desde este punto')}
              onClick={() => onJump(segment.tStart)}
            >
              {formatMediaTimestamp(segment.tStart)}
            </button>
            {speakerOptions && speakerOptions.length > 0 ? (
              <select
                className="input h-7 self-start py-0 text-xs"
                aria-label={t('Hablante')}
                disabled={readOnly}
                value={segment.speakerPersonId ?? ''}
                onChange={(event) => void onSaveSpeaker(segment.id, { personId: event.target.value || null })}
              >
                <option value="">{segment.speakerLabel || t('Sin identificar')}</option>
                {speakerOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            ) : (
              <input
                className="input h-7 self-start py-0 text-xs"
                aria-label={t('Hablante')}
                readOnly={readOnly}
                defaultValue={segment.speakerLabel ?? ''}
                placeholder={t('Hablante')}
                onBlur={(event) => void onSaveSpeaker(segment.id, { label: event.target.value || null })}
      />
          )}
          <div className="min-w-0">
            <textarea
              className="min-h-7 w-full resize-y bg-transparent text-xs leading-5 text-neutral-700 outline-none dark:text-neutral-300"
              aria-label={t('Texto del tramo')}
              readOnly={readOnly}
              defaultValue={segment.text}
              onBlur={(event) => {
                if (event.target.value !== segment.text) void onSaveText(segment.id, event.target.value);
              }}
            />
            {renderExtra?.(segment)}
          </div>
        </div>
      )}
    />
    </div>
  );
}
