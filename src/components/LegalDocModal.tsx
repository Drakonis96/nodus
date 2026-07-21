import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import type { AppLanguage } from '@shared/types';
import { legalDocContent, type LegalDoc } from '../legalDocs';
import { Icon } from './ui';
import { t } from '../i18n';

/**
 * In-app viewer for the About "legal" cards (privacy, GDPR, licenses). Renders a
 * localized summary — never opening an external markdown file — with a link to
 * the authoritative full document on GitHub. Closes on Escape or backdrop click.
 */
export function LegalDocModal({
  doc,
  language,
  onClose,
}: {
  doc: LegalDoc;
  language: AppLanguage;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const content = legalDocContent(doc, language);

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4 sm:p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="card flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden p-0"
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        data-testid={`legal-doc-modal-${doc.id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-neutral-200 p-5 dark:border-neutral-800">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${doc.badgeClass}`}>
            <Icon name={doc.icon} size={20} />
          </div>
          <h2 className="mt-1 flex-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {content.title}
          </h2>
          <button
            className="shrink-0 rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            onClick={onClose}
            aria-label={t('Cerrar')}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-sm leading-6 text-neutral-700 dark:text-neutral-300">{content.intro}</p>
          <div className="mt-5 space-y-5">
            {content.sections.map((section, index) => (
              <section key={index}>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{section.heading}</h3>
                <ul className="mt-2 space-y-1.5">
                  {section.bullets.map((bullet, bulletIndex) => (
                    <li
                      key={bulletIndex}
                      className="flex gap-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400"
                    >
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400 dark:bg-neutral-600" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-neutral-200 p-5 dark:border-neutral-800 sm:flex-row sm:justify-end">
          <button
            className="btn btn-ghost w-full justify-center border border-neutral-300 dark:border-neutral-700 sm:w-auto"
            data-testid={`legal-doc-canonical-${doc.id}`}
            onClick={() => void window.nodus.openExternal(doc.canonicalUrl)}
          >
            <Icon name="external" /> {content.canonicalLabel}
          </button>
          <button
            className="btn btn-primary w-full justify-center sm:w-auto"
            data-testid={`legal-doc-close-${doc.id}`}
            onClick={onClose}
          >
            {t('Cerrar')}
          </button>
        </footer>
      </motion.div>
    </div>,
    document.body,
  );
}
