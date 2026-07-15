import { motion } from 'framer-motion';
import { useEffect, useState, type CSSProperties } from 'react';
import { releaseNotesSince } from '@shared/releaseNotes';
import { Icon } from './ui';
import { t } from '../i18n';
import { Nodi } from './nodi/Nodi';

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

export function hasPendingWhatsNew(): boolean {
  const current = __APP_VERSION__;
  const lastSeen = readLastSeen();
  return lastSeen !== current && releaseNotesSince(lastSeen, current).length > 0;
}

export function WhatsNewModal({ uiLanguage, onSettled }: { uiLanguage: 'es' | 'en'; onSettled?: () => void }) {
  const current = __APP_VERSION__;
  // Compute once on mount: the notes to show, based on what this machine last saw.
  const [notes] = useState(() => {
    const lastSeen = readLastSeen();
    if (lastSeen === current) return [];
    return releaseNotesSince(lastSeen, current);
  });
  const [open, setOpen] = useState(notes.length > 0);

  useEffect(() => {
    if (notes.length === 0) onSettled?.();
  }, [notes.length, onSettled]);

  if (!open || notes.length === 0) return null;

  const close = () => {
    writeLastSeen(current);
    setOpen(false);
    onSettled?.();
  };

  const lang = uiLanguage === 'en' ? 'en' : 'es';
  const confetti = Array.from({ length: 14 }, (_, index) => ({
    left: `${8 + ((index * 17) % 86)}%`,
    delay: `${(index % 7) * 0.18}s`,
    color: ['#2dd4bf', '#818cf8', '#fbbf24', '#f472b6'][index % 4],
  }));

  return (
    <motion.div className="whats-new-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .24 }} onMouseDown={close}>
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={t('Novedades')}
        className="whats-new-cinema"
        data-testid="whats-new-cinematic-modal"
        initial={{ opacity: 0, y: 28, scale: .96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: .46, ease: [0.2, 0.8, 0.2, 1] }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="whats-new-hero">
          <div className="whats-new-aurora" aria-hidden="true" />
          <div className="whats-new-stars" aria-hidden="true" />
          {confetti.map((piece, index) => <i key={index} className="whats-new-confetti" style={{ '--confetti-left': piece.left, '--confetti-delay': piece.delay, '--confetti-color': piece.color } as CSSProperties} />)}
          <button className="whats-new-close" onClick={close} aria-label={t('Cerrar')}><Icon name="x" size={16} /></button>
          <div className="whats-new-hero-copy">
            <div className="whats-new-kicker"><Icon name="star" size={14} /> {t('Novedades')}</div>
            <h2>{t('Nodus acaba de mejorar')}</h2>
            <p>{t('Hemos preparado nuevas funciones y mejoras para que sigas construyendo conocimiento con menos fricción.')}</p>
            <div className="whats-new-version"><span>{t('Nueva versión')}</span><b>v{current}</b></div>
          </div>
          <motion.div className="whats-new-nodi" initial={{ opacity: 0, scale: .7, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ delay: .18, duration: .5, type: 'spring', stiffness: 170 }}>
            <div className="whats-new-nodi-glow" />
            <Nodi state="celebrating" height={205} />
            <span>{t('¡Tenemos novedades!')}</span>
          </motion.div>
        </header>

        <div className="whats-new-scroll">
          <div className="whats-new-section-title"><span>{t('Lo más destacado')}</span><i /></div>
          {notes.map((note) => (
            <section key={note.version} className="whats-new-release-card">
              <div className="whats-new-release-version">v{note.version}</div>
              <ul>
                {note.highlights.map((h, i) => (
                  <li key={i}>
                    <span className="whats-new-check"><Icon name="check" size={13} /></span>
                    <span>{h[lang]}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <aside
            className="whats-new-support"
            data-testid="whats-new-paypal-support"
          >
            <div className="whats-new-support-icon">
              <Icon name="paypal" size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <span className="whats-new-support-label">OPEN SOURCE · {t('APOYO OPCIONAL')}</span>
              <h3>{t('Apoya el proyecto')}</h3>
              <p>
                {t('Si Nodus te ayuda a estudiar, investigar o escribir y quieres contribuir voluntariamente a su desarrollo, puedes apoyar el proyecto mediante PayPal. La donación es completamente opcional: no desbloquea funciones ni cambia el acceso a la aplicación.')}
              </p>
            </div>
            <button
              className="whats-new-paypal-button"
              data-testid="whats-new-support-paypal"
              onClick={() => void window.nodus.openExternal('https://paypal.me/Jorgepb96')}
            >
              <Icon name="paypal" size={16} /> {t('Apoyar')}
              <Icon name="external" size={12} className="opacity-75" />
            </button>
          </aside>
        </div>

        <footer className="whats-new-footer">
          <span><Icon name="network" size={13} /> NODUS · v{current}</span>
          <button
            className="whats-new-paypal-button whats-new-footer-support"
            data-testid="whats-new-footer-support-paypal"
            onClick={() => void window.nodus.openExternal('https://paypal.me/Jorgepb96')}
          >
            <Icon name="paypal" size={16} /> {t('Apoyar')}
          </button>
          <button onClick={close}>{t('Explorar las novedades')} <Icon name="chevronRight" size={14} /></button>
        </footer>
      </motion.section>
    </motion.div>
  );
}
