import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { AppLanguage } from '@shared/types';
import { Icon } from './ui';
import { NodiAvatar } from './nodi/NodiAvatar';

/**
 * "Nodus has a new website" — the one-time notice, and nothing more than a notice.
 *
 * The other update tours explain a feature that shipped inside the app, so they carry
 * chapters, screenshots or an embedded catalogue. This one points outwards: the whole
 * message is a title, one line, and the address. Anything else it could list — the wiki,
 * the videos, the blog — is one click away on the site itself, and listing it here would
 * only make the modal a worse version of the home page.
 *
 * It is NOT pinned to a release. A version-gated notice retires itself the moment the
 * next version ships, which is right for something that was only true of one build; a
 * website is true from now on, so the sentinel alone decides, and it shows exactly once.
 * `previousTutorialVersion` keeps it off the screen of someone still inside the
 * essential guide, who has not yet reached the app it is talking about.
 */

const SEEN_KEY = 'nodus.websiteLaunchSeen.2026-08';
export const NODUS_WEBSITE_URL = 'https://nodusresearch.com/';

type LaunchCopy = {
  badge: string;
  title: string;
  summary: string;
  visit: string;
  finish: string;
};

const COPY: Record<AppLanguage, LaunchCopy> = {
  es: {
    badge: 'NUEVO · NODUSRESEARCH.COM',
    title: 'Nodus estrena nueva web',
    summary: 'Wiki, tutoriales y blog en un mismo sitio.',
    visit: 'Visitar nodusresearch.com',
    finish: 'Entendido',
  },
  en: {
    badge: 'NEW · NODUSRESEARCH.COM',
    title: 'Nodus has a new website',
    summary: 'Wiki, tutorials and blog in one place.',
    visit: 'Visit nodusresearch.com',
    finish: 'Got it',
  },
  fr: {
    badge: 'NOUVEAU · NODUSRESEARCH.COM',
    title: 'Nodus a un nouveau site web',
    summary: 'Wiki, tutoriels et blog au même endroit.',
    visit: 'Visiter nodusresearch.com',
    finish: 'J’ai compris',
  },
  de: {
    badge: 'NEU · NODUSRESEARCH.COM',
    title: 'Nodus hat eine neue Website',
    summary: 'Wiki, Tutorials und Blog an einem Ort.',
    visit: 'nodusresearch.com besuchen',
    finish: 'Verstanden',
  },
  pt: {
    badge: 'NOVO · NODUSRESEARCH.COM',
    title: 'O Nodus estreia novo site',
    summary: 'Wiki, tutoriais e blogue num só sítio.',
    visit: 'Visitar nodusresearch.com',
    finish: 'Entendido',
  },
  'pt-BR': {
    badge: 'NOVO · NODUSRESEARCH.COM',
    title: 'O Nodus estreia um novo site',
    summary: 'Wiki, tutoriais e blog em um só lugar.',
    visit: 'Visitar nodusresearch.com',
    finish: 'Entendi',
  },
  it: {
    badge: 'NUOVO · NODUSRESEARCH.COM',
    title: 'Nodus ha un nuovo sito',
    summary: 'Wiki, tutorial e blog in un unico posto.',
    visit: 'Visita nodusresearch.com',
    finish: 'Ho capito',
  },
  tr: {
    badge: 'YENİ · NODUSRESEARCH.COM',
    title: 'Nodus’un yeni web sitesi yayında',
    summary: 'Wiki, eğitim videoları ve blog tek bir yerde.',
    visit: 'nodusresearch.com adresini ziyaret et',
    finish: 'Anlaşıldı',
  },
};

function shouldPresent(previousTutorialVersion: number): boolean {
  if (previousTutorialVersion <= 0) return false;
  try { return localStorage.getItem(SEEN_KEY) !== '1'; } catch { return true; }
}

function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable: show again next launch */ }
}

export function WebsiteLaunchGuide({
  uiLanguage,
  previousTutorialVersion,
  onSettled,
}: {
  uiLanguage: AppLanguage;
  previousTutorialVersion: number;
  onSettled: () => void;
}) {
  const [eligible] = useState(() => shouldPresent(previousTutorialVersion));
  const copy = COPY[uiLanguage] ?? COPY.en;

  useEffect(() => { if (!eligible) onSettled(); }, [eligible, onSettled]);
  if (!eligible) return null;

  const finish = () => { markSeen(); onSettled(); };

  return <motion.div className="toolkit-guide-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .22 }}>
    <motion.section
      className="toolkit-guide-cinema website-launch-guide"
      data-testid="website-launch-guide"
      role="dialog"
      aria-modal="true"
      aria-labelledby="website-launch-title"
      initial={{ opacity: 0, y: 26, scale: .97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: .44, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <header className="toolkit-guide-hero">
        <div className="toolkit-guide-aurora" aria-hidden="true" />
        <div className="toolkit-guide-hero-copy">
          <div className="toolkit-guide-kicker"><Icon name="sparkles" size={14} /> {copy.badge}</div>
          <h2 id="website-launch-title">{copy.title}</h2>
          <p>{copy.summary}</p>
        </div>
        <div className="toolkit-guide-nodi"><NodiAvatar state="discovering" height={168} /></div>
      </header>

      <footer className="toolkit-guide-footer website-launch-footer">
        {/*
          The link is the point of the modal, so it does not close it: opening the site
          hands the screen to the browser, and Nodus is still behind it with the notice
          in place. Dismissing it is the other button's job, and only that marks it seen.
        */}
        <button
          type="button"
          data-testid="website-launch-visit"
          onClick={() => void window.nodus.openExternal(NODUS_WEBSITE_URL)}
        >
          <Icon name="external" size={14} /> {copy.visit}
        </button>
        <button className="primary" data-testid="website-launch-complete" onClick={finish}>
          {copy.finish} <Icon name="check" size={14} />
        </button>
      </footer>
    </motion.section>
  </motion.div>;
}
