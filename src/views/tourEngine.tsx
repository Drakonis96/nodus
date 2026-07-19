import { useEffect, useLayoutEffect, useState } from 'react';
import { t } from '../i18n';

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
  onClose,
  onNavigate,
}: {
  steps: TourStep[];
  label?: string;
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
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[i];
  const isFirst = i === 0;
  const isLast = i === steps.length - 1;

  // Switch view first so the target element exists when we measure.
  useEffect(() => {
    if (step.view) onNavigate(step.view);
  }, [i, step.view, onNavigate]);

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
    if (!step.target) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let timer = 0;
    const deadline = Date.now() + 5_000;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
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
  }, [i, step.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') setI((n) => Math.min(steps.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, steps.length]);

  const pad = 6;
  const spotlight: Rect | null = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  const TT_W = 360;
  let ttStyle: React.CSSProperties;
  if (spotlight) {
    const below = spotlight.top + spotlight.height + 12;
    const placeBelow = below + 180 < window.innerHeight;
    const top = placeBelow ? below : Math.max(12, spotlight.top - 12 - 180);
    let left = spotlight.left + spotlight.width / 2 - TT_W / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - TT_W - 12));
    ttStyle = { position: 'fixed', top, left, width: TT_W };
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

      <div data-testid="tour-card" style={ttStyle} className="card bg-neutral-900 border border-neutral-700 p-4 shadow-2xl text-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-wide text-indigo-400">
            {t(label)} · {i + 1}/{steps.length}
          </div>
          <button className="text-neutral-500 hover:text-white text-xs" onClick={onClose}>
            {t('Saltar')} ✕
          </button>
        </div>
        <h3 className="font-semibold text-base mb-1">{t(step.title)}</h3>
        <p className="text-neutral-300 leading-relaxed">{t(step.body)}</p>

        <div className="flex items-center justify-between mt-4">
          <div className="flex gap-1">
            {steps.map((_, n) => (
              <span
                key={n}
                className={`h-1.5 rounded-full transition-all ${n === i ? 'w-4 bg-indigo-500' : 'w-1.5 bg-neutral-700'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {!isFirst && (
              <button className="btn btn-ghost" onClick={() => setI((n) => Math.max(0, n - 1))}>
                {t('Atrás')}
              </button>
            )}
            {isFirst ? (
              <>
                <button className="btn btn-ghost" onClick={onClose}>
                  {t('Ahora no')}
                </button>
                <button className="btn btn-primary" onClick={() => setI(1)}>
                  {t('Sí, enséñame')}
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
    </div>
  );
}
