import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TestimonyAnnotation, TestimonyCode, TestimonyTranscriptSegment } from '@shared/types';
import { formatTimecode } from '@shared/testimonies';
import { ANNOTATION_KIND_LABEL } from '@shared/testimonyLabels';
import { Icon } from '../ui';
import { CodePicker } from './CodePicker';
import { t, tx } from '../../i18n';

/**
 * La transcripción como superficie de codificación.
 *
 * SELECCIONAR TEXTO Y CODIFICARLO es el gesto central del análisis cualitativo, y tiene
 * que costar lo mismo que subrayar en papel: seleccionas, aparece la barra, eliges código,
 * listo. Cada paso que se añada entre la selección y el código es un fragmento que el
 * investigador no marcará.
 *
 * EL FRAGMENTO GUARDA UNA INSTANTÁNEA DEL TEXTO, no solo un rango. Es lo que permite que
 * la cita sobreviva a una versión nueva de la transcripción: `remapAnnotation` la busca
 * por texto dentro de su ventana temporal y, si no la encuentra con seguridad, la marca
 * como pendiente de revisar en vez de moverla. Una cita movida en silencio es
 * indistinguible de una cita correcta y falsa.
 */
export function TranscriptAnnotationLayer({
  interviewId,
  transcriptId,
  segments,
  annotations,
  codes,
  speakerNames,
  onJump,
  onChanged,
  onCatalogChanged,
}: {
  interviewId: string;
  transcriptId: string;
  segments: TestimonyTranscriptSegment[];
  annotations: TestimonyAnnotation[];
  codes: TestimonyCode[];
  /** personId → nombre mostrable, ya resuelto contra el acuerdo. */
  speakerNames: Map<string, string>;
  onJump: (seconds: number) => void;
  onChanged: () => Promise<void>;
  onCatalogChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<{ segmentId: string; text: string; tStart: number; tEnd: number } | null>(null);
  const [draftCodes, setDraftCodes] = useState<string[]>([]);
  const [draftMemo, setDraftMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const annotationsBySegment = useMemo(() => {
    const map = new Map<string, TestimonyAnnotation[]>();
    for (const annotation of annotations) {
      if (!annotation.segmentId) continue;
      const list = map.get(annotation.segmentId) ?? [];
      list.push(annotation);
      map.set(annotation.segmentId, list);
    }
    return map;
  }, [annotations]);

  /**
   * Capturar la selección del usuario dentro de un tramo.
   *
   * Se limita a UN tramo a propósito: una cita que cruza tramos no tiene un tiempo de
   * inicio honesto, y el investigador puede marcar los dos por separado. El offset dentro
   * del tramo se guarda además del texto, porque es lo que permite pintar el subrayado
   * exactamente donde está.
   */
  const captureSelection = useCallback((segment: TestimonyTranscriptSegment) => {
    const selection = window.getSelection();
    const value = selection?.toString().trim() ?? '';
    if (!value || value.length < 2) return;
    if (!segment.text.includes(value)) return;
    setDraft({ segmentId: segment.id, text: value, tStart: segment.tStart, tEnd: segment.tEnd });
    setDraftCodes([]);
    setDraftMemo('');
  }, []);

  useEffect(() => {
    setDraft(null);
  }, [transcriptId]);

  const save = async (kind: 'highlight' | 'redaction' = 'highlight'): Promise<void> => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const segment = segments.find((entry) => entry.id === draft.segmentId);
      const offset = segment ? segment.text.indexOf(draft.text) : -1;
      await window.nodus.createTestimonyAnnotation({
        interviewId,
        transcriptId,
        segmentId: draft.segmentId,
        kind,
        tStart: draft.tStart,
        tEnd: draft.tEnd,
        startOffset: offset >= 0 ? offset : null,
        endOffset: offset >= 0 ? offset + draft.text.length : null,
        quoteSnapshot: draft.text,
        memo: draftMemo.trim() || null,
        codeIds: draftCodes,
      });
      setDraft(null);
      setDraftCodes([]);
      setDraftMemo('');
      window.getSelection()?.removeAllRanges();
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col" ref={containerRef} data-testid="testimony-annotation-layer">
      {draft && (
        <div
          className="mb-3 rounded-xl border border-indigo-400 bg-indigo-50 p-3 dark:border-indigo-700/60 dark:bg-indigo-950/30"
          data-testid="testimony-annotation-draft"
        >
          <p className="text-xs italic leading-5 text-neutral-700 dark:text-neutral-200">«{draft.text}»</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">{formatTimecode(draft.tStart)}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <CodePicker
              codes={codes}
              selected={draftCodes}
              onChange={setDraftCodes}
              onCatalogChanged={onCatalogChanged}
              autoFocus
              testid="testimony-annotation-codes"
            />
            <input
              className="input w-full text-xs"
              placeholder={t('Memo breve (opcional)')}
              data-testid="testimony-annotation-memo"
              value={draftMemo}
              onChange={(event) => setDraftMemo(event.target.value)}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className="btn btn-primary h-7 px-2 text-xs" data-testid="testimony-annotation-save" disabled={saving} onClick={() => void save()}>
              <Icon name="highlighter" size={12} /> {t('Guardar fragmento')}
            </button>
            <button
              className="btn btn-ghost h-7 px-2 text-xs"
              data-testid="testimony-annotation-redact"
              disabled={saving}
              title={t('Marcar para que este pasaje se oculte en los derivados anonimizados')}
              onClick={() => void save('redaction')}
            >
              <Icon name="shield" size={12} /> {t('Marcar para anonimizar')}
            </button>
            <button className="btn btn-ghost h-7 px-2 text-xs" onClick={() => setDraft(null)}>{t('Cancelar')}</button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto" data-testid="testimony-coding-surface">
        {segments.length === 0 && (
          <p className="p-6 text-center text-sm text-neutral-500">
            {t('Esta entrevista todavía no tiene una transcripción con tramos que codificar.')}
          </p>
        )}
        {segments.map((segment) => {
          const marks = annotationsBySegment.get(segment.id) ?? [];
          const speaker = segment.speakerPersonId
            ? speakerNames.get(segment.speakerPersonId) ?? segment.speakerLabel
            : segment.speakerLabel;
          return (
            <div
              key={segment.id}
              className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-800"
              data-testid="testimony-coding-segment"
              data-segment-id={segment.id}
            >
              <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                <button
                  type="button"
                  className="text-indigo-400"
                  aria-label={t('Reproducir desde este punto')}
                  onClick={() => onJump(segment.tStart)}
                >
                  {formatTimecode(segment.tStart)}
                </button>
                <span className="font-medium">{speaker ?? t('Sin identificar')}</span>
              </div>
              <p
                className="mt-1 select-text text-sm leading-6 text-neutral-700 dark:text-neutral-200"
                onMouseUp={() => captureSelection(segment)}
              >
                {segment.text}
              </p>
              {marks.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {marks.map((annotation) => (
                    <li
                      key={annotation.id}
                      className="flex flex-wrap items-center gap-1.5 rounded border border-neutral-200 px-1.5 py-1 text-[11px] dark:border-neutral-800"
                      data-testid={`testimony-annotation-${annotation.shortId}`}
                    >
                      <Icon
                        name={annotation.kind === 'redaction' ? 'shield' : 'highlighter'}
                        size={11}
                        className={annotation.kind === 'redaction' ? 'text-amber-500' : 'text-indigo-400'}
                      />
                      <span className="min-w-0 flex-1 truncate italic text-neutral-600 dark:text-neutral-300">«{annotation.quoteSnapshot}»</span>
                      {annotation.linkStatus === 'needs_review' && (
                        <span
                          className="rounded-full border border-amber-400 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"
                          title={t('Una versión nueva de la transcripción cambió este pasaje. Comprueba que la cita sigue siendo la misma.')}
                        >
                          {t('Pendiente de revisar')}
                        </span>
                      )}
                      {annotation.codes.map((code) => (
                        <span
                          key={code.id}
                          className="rounded-full border px-1.5 text-[10px]"
                          style={code.color ? { borderColor: code.color, color: code.color } : undefined}
                        >
                          {code.label}
                        </span>
                      ))}
                      <span className="text-neutral-500">{t(ANNOTATION_KIND_LABEL[annotation.kind])}</span>
                      <button
                        className="btn btn-ghost h-5 px-1 text-[10px]"
                        title={t('Crear una nota desde este fragmento')}
                        data-testid={`testimony-note-from-${annotation.shortId}`}
                        onClick={async () => {
                          await window.nodus.createNoteFromFragment(annotation.id);
                          await onChanged();
                        }}
                      >
                        <Icon name="notebook" size={10} />
                      </button>
                      <button
                        className="btn btn-ghost h-5 px-1 text-[10px] text-rose-500"
                        title={t('Eliminar fragmento')}
                        onClick={async () => {
                          await window.nodus.deleteTestimonyAnnotation(annotation.id);
                          await onChanged();
                        }}
                      >
                        <Icon name="trash" size={10} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {segments.length > 0 && !draft && (
        <p className="mt-2 text-[11px] text-neutral-500" data-testid="testimony-coding-hint">
          {tx('Selecciona un pasaje para codificarlo. {n} fragmentos en esta entrevista.', { n: annotations.length })}
        </p>
      )}
    </div>
  );
}
