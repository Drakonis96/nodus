import { useEffect } from 'react';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { NODUS_ROADMAP } from '@shared/nodiDocumentation';

export function RoadmapModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={t('Roadmap de Nodus')} className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-950" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="route" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Roadmap de Nodus')}</h2>
            <p className="text-xs text-neutral-500">{t('Próximos pasos previstos, sin fechas cerradas y sujetos a feedback y pulido.')}</p>
          </div>
          <button className="btn btn-ghost p-1.5" onClick={onClose} title={t('Cerrar')}><Icon name="x" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" data-testid="roadmap-timeline">
          <ol className="relative ml-2 border-l border-neutral-200 pl-6 dark:border-neutral-800">
            {NODUS_ROADMAP.map((item, index) => (
              <li key={item.title} className={index === NODUS_ROADMAP.length - 1 ? '' : 'pb-5'}>
                <span className={`absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-semibold ${index === 0 ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-neutral-300 bg-white text-neutral-500 dark:border-neutral-700 dark:bg-neutral-950'}`}>{index + 1}</span>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t(item.title)}</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{t(item.detail)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
