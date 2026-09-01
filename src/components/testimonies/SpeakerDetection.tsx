import { useState } from 'react';
import type { TestimonyTranscriptSegment } from '@shared/types';
import {
  proposalImpact,
  proposeSpeakers,
  voiceLabel,
  type DiarizationResult,
  type SpeakerProposal,
} from '@shared/testimonyDiarization';
import { formatTimecode } from '@shared/testimonies';
import { diarizeAudio, isDiarizationModelReady } from '../../lib/diarize';
import { Icon } from '../ui';
import { localizeRuntimeError } from '@shared/uiLanguage';
import { getActiveLang, t, tx } from '../../i18n';

/**
 * Detectar cuántas voces hay en la grabación y dónde habla cada una.
 *
 * Lo que esta pantalla NO hace es tan importante como lo que hace: no dice quién es nadie.
 * Devuelve «Voz 1» y «Voz 2» con el tiempo que ocupa cada una, y la atribución a personas
 * sigue siendo del entrevistador, en el paso siguiente. Un vault de historia oral no puede
 * poner un nombre propio encima de una frase porque un modelo lo haya sugerido.
 *
 * Tampoco aplica nada por su cuenta. Antes de escribir enseña el impacto en tres números
 * —cuántos tramos rellena, cuántos CAMBIA y cuántos deja en blanco—, porque cambiar una
 * atribución que alguien ya revisó a mano es lo único aquí que puede destruir trabajo.
 */
export function SpeakerDetection({
  transcriptId,
  segments,
  blob,
  editable,
  onApplied,
}: {
  transcriptId: string;
  segments: TestimonyTranscriptSegment[];
  blob: () => Promise<Blob | null>;
  editable: boolean;
  onApplied: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DiarizationResult | null>(null);
  const [proposals, setProposals] = useState<SpeakerProposal[]>([]);

  const detect = async () => {
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      const audio = await blob();
      if (!audio) throw new Error(t('Esta sesión ya no conserva el audio original.'));
      const detected = await diarizeAudio(audio, setProgress);
      setResult(detected);
      setProposals(proposeSpeakers(
        segments.map((segment) => ({ id: segment.id, tStart: segment.tStart, tEnd: segment.tEnd })),
        detected.turns,
      ));
    } catch (cause) {
      setError(localizeRuntimeError(cause instanceof Error ? cause.message : String(cause), getActiveLang()));
      setResult(null);
      setProposals([]);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      await window.nodus.applyDetectedTestimonySpeakers(
        transcriptId,
        proposals.map((proposal) => ({
          segmentId: proposal.segmentId,
          label: proposal.voice == null ? null : voiceLabel(proposal.voice),
        })),
      );
      setResult(null);
      setProposals([]);
      await onApplied();
    } catch (cause) {
      setError(localizeRuntimeError(cause instanceof Error ? cause.message : String(cause), getActiveLang()));
    } finally {
      setBusy(false);
    }
  };

  const impact = result
    ? proposalImpact(
      proposals,
      new Map(segments.map((segment) => [segment.id, segment.speakerLabel])),
      new Map(result.voices.map((voice) => [voice.voice, voiceLabel(voice.voice)])),
    )
    : null;

  /** Una frase de ejemplo por voz: es lo que permite reconocerla sin escuchar el audio. */
  const sampleFor = (voice: number): string => {
    const proposal = proposals.find((item) => item.voice === voice);
    const segment = segments.find((item) => item.id === proposal?.segmentId);
    return segment ? segment.text.slice(0, 90) : '';
  };

  return (
    <div className="border-t border-neutral-200 p-3 dark:border-neutral-800" data-testid="testimony-speaker-detection">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-secondary h-8 px-2.5 text-xs"
          data-testid="testimony-detect-speakers"
          disabled={busy || !editable || segments.length === 0}
          onClick={() => void detect()}
        >
          <Icon name={busy ? 'sync' : 'users'} size={13} className={busy ? 'animate-spin' : ''} />
          {t('Detectar hablantes')}
        </button>
        <span className="text-[11px] leading-4 text-neutral-500">
          {isDiarizationModelReady()
            ? t('Se analiza el audio en este equipo para separar las voces. No sale de aquí y no se identifica a nadie: eso lo decides tú.')
            : t('La primera vez descarga un modelo de unos 6 MB. Después funciona sin conexión.')}
        </span>
      </div>

      {busy && progress > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
          <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">{error}</p>}

      {result && impact && (
        <div className="mt-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" data-testid="testimony-detection-result">
          <p className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
            {tx('{n} voces distintas en {duration} de habla', {
              n: result.voices.length,
              duration: formatTimecode(result.speechSeconds),
            })}
          </p>
          <ul className="mt-2 space-y-1.5">
            {result.voices.map((voice) => (
              <li key={voice.voice} className="flex flex-wrap items-baseline gap-2 text-[11px]" data-testid={`testimony-voice-${voice.voice}`}>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  {voiceLabel(voice.voice)}
                </span>
                <span className="text-neutral-500">
                  {tx('{percent}% del habla · {n} turnos', { percent: Math.round(voice.share * 100), n: voice.turns })}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-400">«{sampleFor(voice.voice)}»</span>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-[11px] leading-5 text-neutral-500" data-testid="testimony-detection-impact">
            {tx('Se rellenarían {filled} tramos sin hablante y se CAMBIARÍAN {changed} que ya lo tienen. {blank} quedan en blanco por dudosos.', {
              filled: impact.filled,
              changed: impact.changed,
              blank: impact.leftBlank,
            })}
          </p>
          {impact.changed > 0 && (
            <p className="mt-1 text-[11px] leading-5 text-amber-600 dark:text-amber-400">
              {t('Revisa esos tramos antes de aplicar: alguien ya los había atribuido a mano.')}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-primary h-8 px-3 text-xs" data-testid="testimony-apply-speakers" disabled={busy} onClick={() => void apply()}>
              {t('Aplicar las voces detectadas')}
            </button>
            <button className="btn btn-ghost h-8 px-3 text-xs" onClick={() => { setResult(null); setProposals([]); }}>
              {t('Descartar')}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-neutral-500">
            {t('Después podrás decir quién es cada voz. Nodus no reconoce personas: separa voces.')}
          </p>
        </div>
      )}
    </div>
  );
}
