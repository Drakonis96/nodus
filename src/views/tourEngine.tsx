import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VaultType } from '@shared/types';
import { tutorialVideoCopy, tutorialVideoForVault, type TutorialVideo } from '@shared/tutorialVideos';
import { TutorialVideoPlayer } from '../components/TutorialVideos';
import { Icon } from '../components/ui';
import { getActiveLang, t } from '../i18n';

export interface TourStep {
  /** A `data-tour="…"` value to spotlight. Omit for a centered, target-less step. */
  target?: string;
  title: string;
  body: string;
  /** Switch the app to this view before showing the step. */
  view?: string;
}

/** Tailwind indigo-400 — what every tour used before the accent became a prop. */
const DEFAULT_ACCENT = '#818cf8';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Reusable guided-tour overlay: a dimmed layer with a spotlight over a live element
 * tagged `data-tour`, plus a tooltip card. Target-less steps center. Shared by the
 * first-run usage Tour and the genealogy-specific tour.
 */
export function TourOverlay({
  steps,
  label = 'Tutorial',
  accent = DEFAULT_ACCENT,
  vaultType,
  showUnavailableVideo = false,
  onClose,
  onNavigate,
}: {
  steps: TourStep[];
  label?: string;
  /**
   * The vault this tour teaches. If a video covers it, the opening step offers it as the
   * recommended third option next to the in-app walkthrough and "not now"; watching it
   * counts as having taken the tour, which is why the player closing also closes the
   * tour (Settings can replay either at any time). The video is looked up in the
   * published catalogue, so a vault gains the option the day its video ships — no
   * release required, and no change to this component.
   */
  vaultType?: VaultType;
  /** Keep the future video route visible, but inert, before a tutorial is published. */
  showUnavailableVideo?: boolean;
  /**
   * Spotlight colour. The eyebrow and the progress dots are Tailwind `indigo-*`
   * utilities, which the per-vault `.<type>` blocks in index.css already remap; the
   * spotlight outline is an inline style, so no CSS rule can reach it and the vault
   * accent has to be passed in explicitly.
   */
  accent?: string;
  onClose: () => void;
  onNavigate: (view: string) => void;
}) {
  const [i, setI] = useState(0);
  const [started, setStarted] = useState(false);
  const [watchingVideo, setWatchingVideo] = useState(false);
  const [video, setVideo] = useState<TutorialVideo | undefined>(() => tutorialVideoForVault(vaultType));
  const [rect, setRect] = useState<Rect | null>(null);
  // The card node lives in state rather than a ref so the first measurement happens as
  // soon as it mounts; a plain ref is still null on the pass that positions it.
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState(180);
  const previousFocus = useRef<HTMLElement | null>(null);
  const step = steps[i];
  const isFirst = i === 0;
  const isLast = i === steps.length - 1;
  const isInvitation = isFirst && !started;
  const activeTarget = isInvitation ? undefined : step.target;

  // The invitation is deliberately inert and centred. It must not move the app or
  // point at anything until the user explicitly chooses the in-app walkthrough.
  useEffect(() => {
    if (isInvitation) return;
    if (step.view) onNavigate(step.view);
  }, [isInvitation, step.view, onNavigate]);

  // A video published after this build still reaches the opening step.
  useEffect(() => {
    if (!vaultType) return;
    let cancelled = false;
    void window.nodus.getTutorialCatalogue().then((catalogue) => {
      if (cancelled || !Array.isArray(catalogue)) return;
      setVideo(tutorialVideoForVault(vaultType, catalogue));
    }).catch(() => { /* keep whatever this build knows */ });
    return () => { cancelled = true; };
  }, [vaultType]);

  /**
   * Measure the target, RETRYING until it appears.
   *
   * A single measurement after two frames is not enough: `step.view` only asks the app
   * to switch, and several sections replace their whole body with a spinner while their
   * first IPC round-trip is in flight (the gradebook is one). Measuring once caught the
   * spinner, found no anchor, and fell back to the centred card — which looks like a
   * deliberately target-less step, so the tour silently stopped pointing at anything.
   * Polling to a deadline keeps the fallback for genuinely absent anchors while letting
   * a slow view catch up.
   */
  useLayoutEffect(() => {
    if (!activeTarget) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let timer = 0;
    const deadline = Date.now() + 5_000;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${activeTarget}"]`);
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        return; // found — the resize listener keeps it fresh from here
      }
      setRect(null); // absent or not laid out yet → centre, and keep looking
      if (Date.now() < deadline) timer = window.setTimeout(measure, 100);
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    window.addEventListener('resize', measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [i, activeTarget]);

  // Re-measure whenever the step changes the copy, or the window resizes and reflows it.
  useLayoutEffect(() => {
    if (!card) return;
    const measure = () => setCardHeight(card.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [card, i]);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return () => previousFocus.current?.focus();
  }, []);

  useEffect(() => {
    card?.focus();
  }, [card, i]);

  useEffect(() => {
    // While the video plays, the keyboard belongs to the player: Escape has to leave
    // fullscreen or close it, not dismiss the tour underneath.
    if (watchingVideo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab' && card) {
        const focusable = [...card.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )];
        if (focusable.length === 0) {
          e.preventDefault();
          card.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable.at(-1)!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      } else if (e.key === 'ArrowRight') {
        if (isInvitation) return;
        e.preventDefault();
        setI((n) => Math.min(steps.length - 1, n + 1));
      } else if (e.key === 'ArrowLeft') {
        if (isInvitation) return;
        e.preventDefault();
        setI((n) => Math.max(0, n - 1));
      } else if (
        e.key === 'Enter'
        && !isInvitation
        && !(e.target instanceof HTMLButtonElement)
        && !(e.target instanceof HTMLAnchorElement)
      ) {
        e.preventDefault();
        setI((n) => Math.min(steps.length - 1, n + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, isInvitation, onClose, steps.length, watchingVideo]);

  const pad = 6;
  const spotlight: Rect | null = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  const TT_W = 360;
  let ttStyle: React.CSSProperties;
  if (spotlight) {
    // Clamp against the card's MEASURED height, not a guessed 180px. A step whose body
    // runs longer than the guess produced a card taller than the space reserved for it,
    // so on a short window it hung off the bottom of the viewport with "Siguiente"
    // out of reach — the tour became impossible to advance rather than merely ugly.
    const below = spotlight.top + spotlight.height + 12;
    const placeBelow = below + cardHeight + 12 <= window.innerHeight;
    const desired = placeBelow ? below : spotlight.top - 12 - cardHeight;
    const maxTop = Math.max(12, window.innerHeight - cardHeight - 12);
    const top = Math.min(Math.max(12, desired), maxTop);
    let left = spotlight.left + spotlight.width / 2 - TT_W / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - TT_W - 12));
    ttStyle = { position: 'fixed', top, left, width: TT_W, maxHeight: `calc(100vh - 24px)`, overflowY: 'auto' };
  } else {
    ttStyle = { position: 'fixed', top: '50%', left: '50%', width: TT_W, transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className="fixed inset-0 z-[100]">
      {spotlight ? (
        <div
          data-testid="tour-spotlight"
          className="fixed rounded-lg transition-all duration-200 pointer-events-none"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.66)',
            outline: `2px solid ${accent}`,
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/70" />
      )}

      <div
        ref={setCard}
        data-testid="tour-card"
        style={ttStyle}
        className="card bg-neutral-900 border border-neutral-700 p-4 shadow-2xl text-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nodus-tour-title"
        aria-describedby="nodus-tour-body"
        tabIndex={-1}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-wide text-indigo-400" aria-live="polite">
            {t(label)} · {i + 1}/{steps.length}
          </div>
          <button
            className="text-neutral-500 hover:text-white text-xs"
            onClick={onClose}
            aria-label={t('Cerrar tutorial')}
          >
            {t('Saltar')} ✕
          </button>
        </div>
        <h3 id="nodus-tour-title" className="font-semibold text-base mb-1">{t(step.title)}</h3>
        <p id="nodus-tour-body" className="text-neutral-300 leading-relaxed">{t(step.body)}</p>

        {/* The opening step offers up to three ways in, and the card is only 360px wide:
            side by side they overflowed it and each label broke into three lines. They
            are stacked full-width instead — which is also the shape every other vault
            gets the day its own video is published. Later steps keep the compact row. */}
        <div className={`mt-4 ${isInvitation ? 'flex flex-col gap-3' : 'flex items-center justify-between'}`}>
          <div className="flex gap-1" aria-hidden="true">
            {steps.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${n === i ? 'w-4 bg-indigo-500' : 'w-1.5 bg-neutral-700'}`}
              />
            ))}
          </div>
          <div className={isInvitation ? 'flex flex-col gap-2' : 'flex gap-2'}>
            {!isInvitation && !isFirst && (
              <button className="btn btn-ghost" onClick={() => setI((n) => Math.max(0, n - 1))}>
                {t('Atrás')}
              </button>
            )}
            {isInvitation ? (
              <>
                {(video || showUnavailableVideo) && (
                  <button
                    className={`btn w-full ${video ? 'btn-primary' : 'cursor-not-allowed border border-neutral-700 bg-neutral-800 text-neutral-500'}`}
                    data-testid="tour-watch-video"
                    disabled={!video}
                    onClick={() => setWatchingVideo(true)}
                  >
                    <Icon name="play" size={14} />
                    {tutorialVideoCopy(getActiveLang()).tourVideo}
                    {!video && ` (${t('Próximamente')})`}
                  </button>
                )}
                <button
                  className={`w-full ${video ? 'btn btn-ghost border border-neutral-700' : 'btn btn-primary'}`}
                  onClick={() => {
                    setStarted(true);
                    if (!step.target && !step.view) setI(1);
                  }}
                >
                  {t('Sí, enséñame')}
                </button>
                <button className="btn btn-ghost w-full" onClick={onClose}>
                  {t('Ahora no')}
                </button>
              </>
            ) : isLast ? (
              <button className="btn btn-primary" onClick={onClose}>
                {t('Empezar')}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => setI((n) => n + 1)}>
                {t('Siguiente')}
              </button>
            )}
          </div>
        </div>
      </div>

      {watchingVideo && video && (
        <TutorialVideoPlayer
          video={video}
          language={getActiveLang()}
          onClose={() => { setWatchingVideo(false); onClose(); }}
        />
      )}
    </div>
  );
}
