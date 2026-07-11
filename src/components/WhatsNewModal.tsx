import { useState } from 'react';
import { releaseNotesSince } from '@shared/releaseNotes';
import { Icon } from './ui';
import { t } from '../i18n';

// Shown once after the app updates: the release notes for every version newer than
// the one last seen on this machine. "Last seen" lives in localStorage (a pure
// renderer concern — no DB migration), and is advanced to the current version when
// the user dismisses the modal, so it never reappears for the same version.

const LAST_SEEN_KEY = 'nodus.lastSeenVersion';

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* storage unavailable — the modal simply shows again next launch */
  }
}

export function WhatsNewModal({ uiLanguage }: { uiLanguage: 'es' | 'en' }) {
  const current = __APP_VERSION__;
  // Compute once on mount: the notes to show, based on what this machine last saw.
  const [notes] = useState(() => {
    const lastSeen = readLastSeen();
    if (lastSeen === current) return [];
    return releaseNotesSince(lastSeen, current);
  });
  const [open, setOpen] = useState(notes.length > 0);

  if (!open || notes.length === 0) return null;

  const close = () => {
    writeLastSeen(current);
    setOpen(false);
  };

  const lang = uiLanguage === 'en' ? 'en' : 'es';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onMouseDown={close}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Novedades')}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="star" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Novedades')}</h2>
            <p className="text-xs text-neutral-500">{t('Esto es lo nuevo en esta versión de Nodus.')}</p>
          </div>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
            v{current}
          </span>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {notes.map((note) => (
            <div key={note.version}>
              {notes.length > 1 && (
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">v{note.version}</div>
              )}
              <ul className="space-y-2">
                {note.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-6 text-neutral-700 dark:text-neutral-300">
                    <Icon name="check" size={15} className="mt-0.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
                    <span>{h[lang]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <footer className="flex items-center justify-end border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button className="btn btn-primary" onClick={close}>{t('¡Entendido!')}</button>
        </footer>
      </section>
    </div>
  );
}
