import { useState } from 'react';
import type { TestimonyTranscript, TestimonyTranscriptImprovement } from '@shared/types';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

/**
 * Corregir una transcripción automática con ayuda de la IA.
 *
 * Dos decisiones sostienen esta pantalla:
 *
 *   · La corrección NO se escribe encima del literal. Crea una VERSIÓN DERIVADA, porque el
 *     literal es la única prueba de qué oyó la máquina y borrarlo hace imposible saber
 *     después si una frase rara la dijo el narrador o la inventó el reconocedor.
 *   · Los tramos que el modelo reescribió de más se conservan TAL CUAL y se cuentan. Lo
 *     que se enseña antes de aceptar no es «se corrigieron 40 tramos», es «40 corregidos y
 *     3 rechazados porque cambiaban palabras», que es la única cifra que importa.
 */
export function TranscriptImprove({
  transcript,
  onCreated,
}: {
  transcript: TestimonyTranscript;
  onCreated: (transcriptId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TestimonyTranscriptImprovement | null>(null);

  const propose = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await window.nodus.improveTestimonyTranscript(transcript.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    setBusy(true);
    setError('');
    try {
      const { transcript: derived } = await window.nodus.deriveTestimonyTranscript(transcript.id, 'corrected', {});
      const segments = await window.nodus.listTestimonySegments(derived.id);
      // Los tramos derivados llegan en el mismo orden que los de origen, así que la
      // corrección de cada uno se aplica por posición, no por identificador.
      for (const [index, segment] of segments.entries()) {
        const proposal = result.segments[index];
        if (!proposal || !proposal.accepted || proposal.after === segment.text) continue;
        await window.nodus.updateTestimonySegment(segment.id, { text: proposal.after });
      }
      setResult(null);
      await onCreated(derived.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const changed = result?.segments.filter((segment) => segment.accepted && segment.after !== segment.before) ?? [];
  const rejected = result?.segments.filter((segment) => !segment.accepted) ?? [];

  return (
    <div className="border-t border-neutral-200 p-3 dark:border-neutral-800" data-testid="testimony-improve">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-secondary h-8 px-2.5 text-xs"
          data-testid="testimony-improve-run"
          disabled={busy}
          onClick={() => void propose()}
        >
          <Icon name={busy ? 'sync' : 'wand'} size={13} className={busy ? 'animate-spin' : ''} />
          {t('Corregir con IA')}
        </button>
        <span className="text-[11px] leading-4 text-neutral-500">
          {t('Puntúa, acentúa y separa frases. No quita muletillas ni cambia palabras: lo que lo intente se rechaza y se queda como estaba.')}
        </span>
      </div>

      {error && <p className="mt-2 text-[11px] leading-5 text-amber-600 dark:text-amber-400">{error}</p>}

      {result && (
        <div className="mt-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" data-testid="testimony-improve-result">
          <p className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
            {tx('{changed} tramos corregidos · {rejected} rechazados por cambiar palabras', {
              changed: changed.length,
              rejected: rejected.length,
            })}
          </p>

          <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
            {changed.slice(0, 12).map((segment) => (
              <li key={segment.segmentId} className="text-[11px] leading-5">
                <span className="block text-neutral-400 line-through">{segment.before}</span>
                <span className="block text-neutral-700 dark:text-neutral-300">{segment.after}</span>
              </li>
            ))}
          </ul>

          {rejected.length > 0 && (
            <div className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-[11px] leading-5 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-300">
              <p>{t('Rechazados porque cambiaban lo que se dijo:')}</p>
              <ul className="mt-1 space-y-0.5">
                {rejected.slice(0, 5).map((segment) => (
                  <li key={segment.segmentId}>
                    {segment.removed.length > 0 && <span>−{segment.removed.join(', ')} </span>}
                    {segment.added.length > 0 && <span>+{segment.added.join(', ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-primary h-8 px-3 text-xs" data-testid="testimony-improve-apply" disabled={busy} onClick={() => void apply()}>
              {t('Crear versión corregida')}
            </button>
            <button className="btn btn-ghost h-8 px-3 text-xs" onClick={() => setResult(null)}>{t('Descartar')}</button>
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">
            {tx('El literal no se toca: esto crea una versión nueva. Propuesto por {model}.', { model: result.model })}
          </p>
        </div>
      )}
    </div>
  );
}
