import { useCallback, useEffect, useState } from 'react';
import {
  TRANSLATION_LANGUAGES,
  type ContentTranslation,
  type ContentTranslationSummary,
  type ModelRef,
  type TranslationEntityKind,
} from '@shared/types';
import { Icon } from './ui';
import { Markdown, type MarkdownCitation } from './Markdown';
import { confirm } from './feedback';
import { t, tx } from '../i18n';

/**
 * A compact "extra button + modal" for AI translations of a Deep Research report
 * or an immersion. It lists existing translations (one per language), lets the
 * user generate a new one from a language dropdown, and opens any translation as a
 * rendered, citation-aware reader. Regenerate replaces the stored copy; delete
 * removes it. The source Markdown is assembled by the caller so this component
 * stays agnostic of how each entity is laid out.
 */
export function TranslationModal({
  entityKind,
  entityId,
  sourceTitle,
  sourceMarkdown,
  model,
  onCitation,
  onClose,
}: {
  entityKind: TranslationEntityKind;
  entityId: string;
  sourceTitle: string;
  sourceMarkdown: string;
  model: ModelRef | null;
  onCitation?: (citation: MarkdownCitation) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<ContentTranslationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<string>('en');
  const [busyLanguage, setBusyLanguage] = useState<string | null>(null);
  const [openReading, setOpenReading] = useState<ContentTranslation | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generating = busyLanguage != null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setList(await window.nodus.listContentTranslations(entityKind, entityId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [entityKind, entityId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Default the picker to the first language not translated yet.
  useEffect(() => {
    const taken = new Set(list.map((tr) => tr.language));
    const firstFree = TRANSLATION_LANGUAGES.find((l) => !taken.has(l.code));
    if (firstFree) setLanguage((cur) => (taken.has(cur) ? firstFree.code : cur));
  }, [list]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openReading) setOpenReading(null);
      else if (!generating) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, openReading, generating]);

  const generate = async (code: string) => {
    setError(null);
    setBusyLanguage(code);
    try {
      const summary = await window.nodus.generateContentTranslation({
        entityKind,
        entityId,
        language: code,
        sourceTitle,
        sourceMarkdown,
        model,
      });
      await refresh();
      // Open the freshly generated translation right away.
      const full = await window.nodus.getContentTranslation(summary.id);
      if (full) setOpenReading(full);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLanguage(null);
    }
  };

  const openReader = async (summary: ContentTranslationSummary) => {
    setLoadingId(summary.id);
    setError(null);
    try {
      const full = await window.nodus.getContentTranslation(summary.id);
      if (full) setOpenReading(full);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingId(null);
    }
  };

  const remove = async (summary: ContentTranslationSummary) => {
    const ok = await confirm({
      title: t('Eliminar traducción'),
      message: tx('¿Eliminar la traducción a {lang}? Esta acción no se puede deshacer.', { lang: summary.languageLabel }),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    try {
      await window.nodus.deleteContentTranslation(summary.id);
      if (openReading?.id === summary.id) setOpenReading(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async () => {
    if (!openReading) return;
    await navigator.clipboard.writeText(openReading.markdown);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Traducciones')}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          {openReading ? (
            <button className="btn btn-ghost gap-1.5 px-2" onClick={() => setOpenReading(null)}>
              <Icon name="chevronLeft" /> {t('Traducciones')}
            </button>
          ) : (
            <Icon name="languages" className="text-indigo-500 dark:text-indigo-300" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {openReading ? openReading.title : t('Traducciones con IA')}
            </h2>
            <p className="truncate text-xs text-neutral-500">
              {openReading ? openReading.languageLabel : t('Traduce este contenido a otro idioma. Cada idioma se guarda y puede regenerarse o eliminarse.')}
            </p>
          </div>
          {openReading && (
            <button className="btn btn-ghost gap-1.5 border border-neutral-300 text-xs dark:border-neutral-700" onClick={() => void copy()}>
              <Icon name="copy" size={13} /> {t('Copiar')}
            </button>
          )}
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        {error && !openReading && (
          <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        {openReading ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="mx-auto max-w-2xl">
              <Markdown
                content={openReading.markdown}
                className="text-[15px] leading-7"
                onCitation={onCitation ? (c) => onCitation(c) : undefined}
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
              <div className="min-w-[12rem] flex-1">
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">{t('Idioma')}</label>
                <select
                  className="input w-full text-sm"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={generating}
                >
                  {TRANSLATION_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.nativeName} — {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn btn-primary gap-1.5"
                onClick={() => void generate(language)}
                disabled={generating}
                title={t('Genera la traducción con el modelo de IA configurado')}
              >
                <Icon name={generating ? 'sync' : 'languages'} className={generating ? 'animate-spin' : ''} size={15} />
                {generating ? t('Traduciendo…') : t('Generar traducción')}
              </button>
            </div>

            {generating && (
              <p className="mt-2 text-xs text-indigo-500 dark:text-indigo-300">
                {t('La traducción de un texto largo puede tardar. Puedes cerrar esta ventana: se guardará y aparecerá aquí al volver.')}
              </p>
            )}

            <div className="mt-4">
              {loading ? (
                <div className="py-8 text-center text-sm text-neutral-500">{t('Cargando traducciones…')}</div>
              ) : list.length === 0 ? (
                <div className="py-8 text-center text-sm text-neutral-500">
                  {t('Aún no hay traducciones. Elige un idioma y genera la primera.')}
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((tr) => {
                    const busy = busyLanguage === tr.language;
                    return (
                      <li
                        key={tr.id}
                        className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 transition-colors hover:border-indigo-400/60 dark:border-neutral-800 dark:hover:border-indigo-700/60"
                      >
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => void openReader(tr)}
                          disabled={loadingId === tr.id}
                        >
                          <Icon name={loadingId === tr.id ? 'sync' : 'book'} size={14} className={`shrink-0 text-neutral-400 ${loadingId === tr.id ? 'animate-spin' : ''}`} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{tr.languageLabel}</div>
                            <div className="truncate text-[11px] text-neutral-500" title={tr.title}>{tr.title}</div>
                          </div>
                        </button>
                        <button
                          className="btn btn-ghost !py-1 gap-1 border border-neutral-300 text-xs dark:border-neutral-700"
                          onClick={() => void generate(tr.language)}
                          disabled={generating}
                          title={t('Regenerar esta traducción')}
                        >
                          <Icon name={busy ? 'sync' : 'refresh'} size={12} className={busy ? 'animate-spin' : ''} />
                        </button>
                        <button
                          className="btn btn-ghost !py-1 text-xs text-neutral-500 hover:text-red-400"
                          onClick={() => void remove(tr)}
                          disabled={generating}
                          title={t('Eliminar traducción')}
                        >
                          <Icon name="trash" size={12} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
