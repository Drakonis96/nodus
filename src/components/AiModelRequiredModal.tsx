import { Icon } from './ui';
import { t } from '../i18n';

export function AiModelRequiredModal({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-neutral-950/55 p-5 backdrop-blur-[2px]"
      data-testid="ai-model-required-backdrop"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-model-required-title"
        aria-describedby="ai-model-required-description"
        className="w-full max-w-[25rem] overflow-hidden rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-2xl shadow-neutral-950/30 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-black/60"
        data-testid="ai-model-required-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3.5 p-5 pb-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
            <Icon name="wand" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="ai-model-required-title" className="pr-7 text-base font-semibold leading-6">
              {t('Configura un modelo de IA')}
            </h2>
            <p id="ai-model-required-description" className="mt-1.5 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              {t('Configura un modelo en Ajustes → Modelos IA antes de volver a intentarlo. Puedes usar la configuración básica o la avanzada.')}
            </p>
          </div>
          <button
            type="button"
            className="-ml-9 -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            aria-label={t('Cerrar')}
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        <footer className="flex justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950/45">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('Ahora no')}</button>
          <button type="button" className="btn btn-primary !text-white" data-testid="ai-model-required-open-settings" onClick={onOpenSettings}>
            <Icon name="settings" size={14} /> {t('Ir a Ajustes y Modelos')}
          </button>
        </footer>
      </section>
    </div>
  );
}
