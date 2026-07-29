import { useState } from 'react';
import type { TestimonyCode, TestimonyInterviewAnalysis, TestimonyTranscriptSegment } from '@shared/types';
import { sameCode } from '@shared/testimonies';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

/**
 * Lo que la IA propone para una entrevista, y lo que hay que hacer con ello.
 *
 * La pantalla está montada sobre una desconfianza deliberada: el modelo no crea códigos ni
 * fija fragmentos: los SUGIERE, uno a uno, y cada uno se acepta a mano. Un análisis
 * cualitativo aceptado en bloque no es análisis, es una etiqueta puesta por una máquina
 * sobre el testimonio de alguien.
 *
 * Y lo que el modelo se inventó se enseña igual de grande que lo que acertó. `discarded`
 * son las citas que dijo que estaban y no estaban: esconderlas dejaría al investigador con
 * la impresión de que todo lo que ve es fiable, cuando lo que hace fiable a lo que ve es
 * justamente que lo otro se ha caído por el camino.
 */
export function AnalysisProposal({
  interviewId,
  segments,
  codes,
  onChanged,
}: {
  interviewId: string;
  segments: TestimonyTranscriptSegment[];
  codes: TestimonyCode[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<TestimonyInterviewAnalysis | null>(null);
  const [used, setUsed] = useState<Set<string>>(new Set());

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setAnalysis(await window.nodus.analyzeTestimonyInterview(interviewId));
      setUsed(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setAnalysis(null);
    } finally {
      setBusy(false);
    }
  };

  const createCode = async (label: string, note: string) => {
    const existing = codes.find((code) => sameCode(code.label, label));
    if (!existing) await window.nodus.createTestimonyCode({ label, description: note || null });
    setUsed((current) => new Set(current).add(`code:${label}`));
    await onChanged();
  };

  const pin = async (index: number) => {
    if (!analysis) return;
    const passage = analysis.passages[index];
    const segment = segments.find((item) => item.id === passage.segmentId);
    if (!segment) return;
    let codeId: string | null = null;
    if (passage.code) {
      const existing = codes.find((code) => sameCode(code.label, passage.code));
      codeId = existing ? existing.id : (await window.nodus.createTestimonyCode({ label: passage.code })).id;
    }
    await window.nodus.createTestimonyAnnotation({
      interviewId,
      transcriptId: analysis.transcriptId,
      segmentId: passage.segmentId,
      tStart: passage.tStart,
      tEnd: segment.tEnd,
      quoteSnapshot: passage.quote,
      memo: passage.why || null,
      codeIds: codeId ? [codeId] : [],
    });
    setUsed((current) => new Set(current).add(`passage:${index}`));
    await onChanged();
  };

  return (
    <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800" data-testid="testimony-analysis-proposal">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-secondary h-8 px-2.5 text-xs"
          data-testid="testimony-analyze"
          disabled={busy}
          onClick={() => void run()}
        >
          <Icon name={busy ? 'sync' : 'sparkles'} size={13} className={busy ? 'animate-spin' : ''} />
          {t('Proponer análisis')}
        </button>
        <span className="text-[11px] leading-4 text-neutral-500">
          {t('Propone códigos y pasajes citables. No aprueba la transcripción, no juzga lo que se cuenta y no guarda nada por su cuenta.')}
        </span>
      </div>

      {error && <p className="mt-2 text-[11px] leading-5 text-amber-600 dark:text-amber-400" data-testid="testimony-analysis-error">{error}</p>}

      {analysis && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-200">{t('Códigos propuestos')}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {analysis.codes.map((code) => {
                const exists = codes.some((item) => sameCode(item.label, code.label));
                const done = used.has(`code:${code.label}`) || exists;
                return (
                  <button
                    key={code.label}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      done
                        ? 'border-neutral-300 text-neutral-400 dark:border-neutral-700'
                        : 'border-indigo-500 text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/30'
                    }`}
                    disabled={done}
                    title={code.note}
                    data-testid={`testimony-proposed-code-${code.label.replace(/\s+/g, '-')}`}
                    onClick={() => void createCode(code.label, code.note)}
                  >
                    {done ? <Icon name="check" size={11} /> : <Icon name="plus" size={11} />} {code.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-200">{t('Pasajes propuestos')}</p>
            <ul className="mt-1.5 space-y-1.5">
              {analysis.passages.map((passage, index) => (
                <li
                  key={`${passage.segmentId}-${index}`}
                  className="rounded-lg border border-neutral-200 p-2 text-[11px] dark:border-neutral-800"
                  data-testid="testimony-proposed-passage"
                >
                  <div className="flex flex-wrap items-center gap-2 text-neutral-500">
                    <span className="font-mono">{passage.at}</span>
                    {passage.code && <span className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-neutral-900">{passage.code}</span>}
                    <button
                      className="ml-auto btn btn-ghost h-6 px-2 text-[11px]"
                      disabled={used.has(`passage:${index}`)}
                      onClick={() => void pin(index)}
                    >
                      {used.has(`passage:${index}`) ? t('Fijado') : t('Fijar como fragmento')}
                    </button>
                  </div>
                  <p className="mt-1 leading-5 text-neutral-700 dark:text-neutral-300">«{passage.quote}»</p>
                  {passage.why && <p className="mt-0.5 leading-5 text-neutral-500">{passage.why}</p>}
                </li>
              ))}
            </ul>
          </div>

          {analysis.discarded.length > 0 && (
            <div
              className="rounded-lg border border-amber-400 bg-amber-50 p-2 text-[11px] leading-5 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-300"
              data-testid="testimony-analysis-discarded"
            >
              <p className="font-medium">
                {tx('{n} citas descartadas: no aparecen en la transcripción.', { n: analysis.discarded.length })}
              </p>
              <ul className="mt-1 space-y-0.5">
                {analysis.discarded.map((item) => (
                  <li key={item.quote}>«{item.quote.slice(0, 120)}» — {tx('{percent}% de parecido', { percent: Math.round(item.coverage * 100) })}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-neutral-500">{tx('Propuesto por {model}.', { model: analysis.model })}</p>
        </div>
      )}
    </section>
  );
}
