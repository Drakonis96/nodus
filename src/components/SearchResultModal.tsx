import { useEffect, useState } from 'react';
import type { GlobalSearchResult, SearchResultDetail } from '@shared/types';
import { Icon } from './ui';
import { t } from '../i18n';

export function SearchResultModal({
  result,
  onClose,
  onLocate,
}: {
  result: GlobalSearchResult;
  onClose: () => void;
  onLocate: (result: GlobalSearchResult) => void;
}) {
  const [detail, setDetail] = useState<SearchResultDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void window.nodus
      .getSearchResultDetail(result.kind, result.id)
      .then((value) => {
        if (!active) return;
        setDetail(value);
        if (!value) setError(t('El elemento ya no está disponible.'));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [result.kind, result.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const locateLabel = result.kind === 'note'
    ? t('Abrir nota')
    : result.kind === 'gap'
      ? t('Abrir en Huecos')
      : t('Localizar en el grafo');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={detail?.title ?? result.title}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-neutral-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-400">{t(result.kind)}</div>
            <h2 className="mt-1 break-words text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {detail?.title ?? result.title}
            </h2>
            {(detail?.subtitle ?? result.subtitle) && (
              <p className="mt-1 text-xs text-neutral-500">{detail?.subtitle ?? result.subtitle}</p>
            )}
          </div>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && <div className="flex items-center gap-2 text-sm text-neutral-500"><Icon name="sync" className="animate-spin" /> {t('Cargando detalle…')}</div>}
          {error && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
          {detail && (
            <div className="space-y-5">
              {detail.metadata.length > 0 && (
                <dl className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                  {detail.metadata.map((entry) => (
                    <div key={`${entry.label}:${entry.value}`} className="rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{t(entry.label)}</dt>
                      <dd className="mt-0.5 break-words text-sm text-neutral-800 dark:text-neutral-200">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {detail.description && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Contenido')}</h3>
                  <div className="whitespace-pre-wrap break-words text-sm leading-6 text-neutral-700 dark:text-neutral-300">
                    {detail.description}
                  </div>
                </section>
              )}
              {detail.sections.map((section, index) => (
                <section key={`${section.title}:${index}`} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                  <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t(section.title)}</h3>
                  <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                    {section.content}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-800 px-5 py-3">
          <button className="btn btn-ghost gap-1.5 border border-neutral-300 dark:border-neutral-700" onClick={() => onLocate(result)}>
            <Icon name={result.kind === 'note' ? 'notebook' : result.kind === 'gap' ? 'gap' : 'network'} />
            {locateLabel}
          </button>
          <button className="btn btn-primary" onClick={onClose}>{t('Cerrar')}</button>
        </footer>
      </section>
    </div>
  );
}
