// Per-work analysis breakdown, opened from the Library's status pill.
//
// The library row answers "can I use this work yet?"; this answers "what exactly
// is done, what is missing, and how do I fix just that". Each step can be retried
// on its own so a reader never has to re-run a whole analysis to repair one index.
import { useEffect, useState } from 'react';
import type { WorkView } from '@shared/types';
import { Icon } from '../components/ui';
import { notifyDataChanged } from '../hooks';
import { STEP_ORDER, type StepId, type StepState, type WorkStatus } from '../libraryStatus';
import { localizeRuntimeError } from '@shared/uiLanguage';
import { getActiveLang, t, tx } from '../i18n';

/**
 * The five steps, in pipeline order. Kept in this file with display-shaped values
 * so the i18n coverage scan follows it from the `t()` call below.
 */
const STEP_LABEL: Record<StepId, string> = {
  themes: 'Temas',
  ideas: 'Ideas',
  summary: 'Resumen',
  semantic: 'Búsqueda semántica',
  citable: 'Texto citable',
};

const STATE_LABEL: Record<StepState, string> = {
  done: 'Hecho',
  partial: 'Incompleto',
  missing: 'Pendiente',
  running: 'En curso',
  failed: 'Falló',
  blocked: 'No disponible',
  na: 'No aplica',
};

const STATE_TONE: Record<StepState, string> = {
  done: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-300',
  partial: 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300',
  missing: 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400',
  running: 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300',
  failed: 'border-red-300 bg-red-50 text-red-700 dark:border-red-700/60 dark:bg-red-900/20 dark:text-red-300',
  blocked: 'border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-500',
  na: 'border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-600',
};

/** States a reader can act on. `blocked` and `na` are terminal by definition. */
const RETRYABLE: StepState[] = ['partial', 'missing', 'failed'];

export function WorkStatusModal({
  work,
  status,
  onClose,
  onChanged,
}: {
  work: WorkView;
  status: WorkStatus;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<StepId | 'all' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [citableQueued, setCitableQueued] = useState(false);

  const retryable = STEP_ORDER.filter((id) => RETRYABLE.includes(status.steps[id].state) && !(id === 'citable' && citableQueued));

  useEffect(() => {
    if (!citableQueued) return;
    return window.nodus.onPassageProgress((progress) => {
      if (progress.running) return;
      setCitableQueued(false);
      if (progress.error) setActionError(progress.error);
      else void onChanged();
    });
  }, [citableQueued, onChanged]);

  const runStep = async (id: StepId) => {
    switch (id) {
      case 'themes':
        return window.nodus.rescan(work.nodus_id, 'light');
      case 'ideas':
        // Re-running a finished deep pass purges its data first; when it never
        // ran, setManualDeep also queues the light pass it depends on.
        return work.deep_status === 'done'
          ? window.nodus.rescan(work.nodus_id, 'deep')
          : window.nodus.setManualDeep(work.nodus_id, true);
      case 'summary':
        return window.nodus.summarizeWork(work.nodus_id);
      case 'semantic':
        return window.nodus.startEmbedding([work.nodus_id]);
      case 'citable':
        await window.nodus.startPassageEmbedding([work.nodus_id]);
        // The passage pipeline keeps provider failures in its progress state so
        // the global rail can show them. Surface the same error here instead of
        // making a failed retry look like a successful no-op.
        {
          const progress = await window.nodus.getPassageStatus();
          if (progress.error) throw new Error(progress.error);
          if (progress.running) setCitableQueued(true);
        }
        return;
    }
  };

  const retryOne = async (id: StepId) => {
    setBusy(id);
    setActionError(null);
    try {
      await runStep(id);
      notifyDataChanged();
      await onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Repair everything the table shows as unfinished.
   *
   * When the ideas (or themes) step is among them, this defers to the full chain
   * instead of firing each step: the indexes are built FROM the ideas, so
   * starting them in parallel would index nothing. When the ideas are already
   * done, the individual steps run directly — re-running the deep pass would
   * purge good analysis and spend tokens rebuilding it for nothing.
   */
  const retryMissing = async () => {
    setBusy('all');
    setActionError(null);
    try {
      if (retryable.includes('themes') || retryable.includes('ideas')) {
        await window.nodus.processFull(work.nodus_id);
      } else {
        for (const id of retryable) await runStep(id);
      }
      notifyDataChanged();
      await onChanged();
      onClose();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const detailFor = (id: StepId): string => {
    const step = status.steps[id];
    if (step.state === 'blocked') return t('Necesita el texto completo de la obra.');
    switch (id) {
      case 'themes':
        // The light scan persists its own failure into `notes` (worksRepo.setLightResult),
        // so this step can name a cause instead of showing the same dash it shows for
        // "not run yet" — which read as "no information exists" when there always was some.
        if (step.state === 'failed') return work.notes ? localizeRuntimeError(work.notes, getActiveLang()) : t('El paso falló sin dejar un motivo. Reintenta; si vuelve a fallar, revisa el modelo en Ajustes → Modelos de IA.');
        return work.themes.length > 0 ? work.themes.join(', ') : '—';
      case 'ideas':
        // Stored in Spanish by the main process, and `deep_error` is not one of the
        // `message`/`error` field names `localizeIpcPayload` sweeps — so it arrived here
        // untouched while every neighbouring line went through t(). It read as Spanish
        // prose in the other seven interface languages, which is what the reader sees
        // most often, because a failed analysis repeats its sentence until it is retried.
        if (step.state === 'failed' && work.deep_error) return localizeRuntimeError(work.deep_error, getActiveLang());
        if (step.reason === 'analysis_text_changed') return t('Las ideas pertenecen a la versión anterior del texto. Vuelve a analizarlas para usar el texto actual.');
        if (step.state === 'partial') return t('El análisis solo pudo usar el abstract.');
        return work.ideaCount > 0 ? tx('{n} ideas extraídas', { n: work.ideaCount }) : '—';
      case 'summary':
        // No column stores a summary failure, so say that plainly rather than nothing.
        if (step.state === 'failed') return t('El paso falló sin dejar un motivo. Reintenta; si vuelve a fallar, revisa el modelo en Ajustes → Modelos de IA.');
        return step.state === 'done' ? t('Disponible en la obra.') : '—';
      case 'semantic':
        return step.total ? tx('{a}/{b} ideas indexadas', { a: step.done ?? 0, b: step.total }) : '—';
      case 'citable':
        if (work.text_block_reason === 'file_missing') return t('El adjunto existe en Zotero, pero el archivo ya no está en su ubicación original.');
        if (work.text_block_reason === 'scanned_no_ocr') return t('El PDF está escaneado y no tiene capa de texto. Activa OCR y vuelve a analizar.');
        if (work.text_block_reason === 'unreadable') return t('El adjunto no produjo texto utilizable. Revisa el archivo o activa OCR.');
        if (work.text_block_reason === 'unsupported') return t('El formato del adjunto no es compatible con la extracción de texto.');
        if (step.state === 'partial') {
          if (step.reason === 'text_changed') return t('El texto cambió; vuelve a indexar sus fragmentos.');
          if (step.reason === 'model_changed') return t('Los fragmentos se indexaron con otro modelo de embeddings.');
          if (step.reason === 'text_and_model_changed') return t('El texto y el modelo de embeddings cambiaron.');
          return t('Algunos fragmentos no tienen un embedding válido.');
        }
        return step.total ? tx('{n} fragmentos indexados', { n: step.total }) : '—';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={t('Estado del análisis')}
      onClick={() => busy == null && onClose()}
    >
      <div
        className="card relative flex max-h-full w-full max-w-[720px] flex-col overflow-hidden border border-neutral-200 bg-white text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <Icon name="list" size={18} className="shrink-0 text-indigo-600 dark:text-indigo-300" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{t('Estado del análisis')}</h2>
            <p className="truncate text-xs text-neutral-600 dark:text-neutral-500">{work.title}</p>
          </div>
          <div className="flex-1" />
          <button className="ml-1 text-neutral-500 hover:text-neutral-950 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-white" title={t('Cerrar')} aria-label={t('Cerrar')} disabled={busy != null} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {work.deep_hash && work.resolved_text_hash && work.deep_hash !== work.resolved_text_hash && (
            <p className="mb-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
              {t('El texto disponible ha cambiado. Se conserva el análisis anterior hasta completar un reescaneo.')}
            </p>
          )}
          {actionError && (
            <p className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300" role="alert">
              {actionError}
            </p>
          )}
          <div className="space-y-2">
            {STEP_ORDER.map((id) => {
              const step = status.steps[id];
              const displayedState = id === 'citable' && citableQueued ? 'running' : step.state;
              const canRetry = RETRYABLE.includes(displayedState) || displayedState === 'done';
              return (
                <section key={id} className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40" data-testid={`work-status-step-${id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-neutral-900 dark:text-neutral-200">{t(STEP_LABEL[id])}</span>
                      <span className={`work-step-state inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] ${STATE_TONE[displayedState]}`}>
                        {t(STATE_LABEL[displayedState])}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-500">{detailFor(id)}</p>
                  </div>
                  {canRetry && (
                    <button
                      className="btn btn-ghost shrink-0 border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
                      disabled={busy != null || displayedState === 'running'}
                      onClick={() => void retryOne(id)}
                      data-testid={`work-status-retry-${id}`}
                    >
                      {busy === id ? t('Enviando…') : displayedState === 'done' ? t('Rehacer') : t('Reintentar')}
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <p className="min-w-0 flex-1 text-xs text-neutral-600 dark:text-neutral-500">
            {retryable.length > 0
              ? tx('Faltan {n} paso(s). Se encolarán y verás el progreso en la cola.', { n: retryable.length })
              : t('No queda nada pendiente en esta obra.')}
          </p>
          <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" disabled={busy != null} onClick={onClose}>
            {t('Cerrar')}
          </button>
          <button
            className="btn btn-primary disabled:opacity-40"
            disabled={busy != null || retryable.length === 0}
            onClick={() => void retryMissing()}
          >
            <Icon name="compass" size={14} /> {busy === 'all' ? t('Enviando…') : t('Reintentar lo que falta')}
          </button>
        </div>
      </div>
    </div>
  );
}
