import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FOCUS_TIMER_TRIGGER_ATTRIBUTE, OPEN_FOCUS_TIMER_EVENT, openFocusLayout, useStudyFocus } from './StudyFocusContext';
import { FOCUS_CYCLE_LENGTH, FocusControls, focusClock, phaseName } from './FocusControls';
import { Icon } from '../ui';
import { t } from '../../i18n';

const portalTarget = () => document.querySelector('[data-testid="app-shell"]') ?? document.body;

/**
 * The timer panel, opened from the header's focus button (or the palette and the rail),
 * plus the running counter. The counter lives on the LEFT of the header and only while
 * a session is open outside the focus mode; inside the mode the rail shows the clock.
 */
export function FocusHeader({ onProgress }: { onProgress: () => void }) {
  const focus = useStudyFocus();
  const [open, setOpen] = useState(false);
  // Whatever had focus before the panel opened gets it back on close: the counter may
  // not be on screen, and the header button is not the only way in.
  const returnFocus = useRef<HTMLElement | null>(null);
  const close = () => { setOpen(false); returnFocus.current?.focus?.(); };
  useEffect(() => {
    const show = (event: Event) => setOpen(value => (event instanceof CustomEvent && event.detail === 'toggle') ? !value : true);
    window.addEventListener(OPEN_FOCUS_TIMER_EVENT, show);
    return () => window.removeEventListener(OPEN_FOCUS_TIMER_EVENT, show);
  }, []);
  const [browserSnapshot, setBrowserSnapshot] = useState<{ dataUrl: string; left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const freeze = async () => {
      const dataUrl = await window.nodus.captureBrowserOverlaySnapshot().catch(() => null);
      if (cancelled) return;
      const rect = document.querySelector('[data-browser-viewport]')?.getBoundingClientRect();
      if (dataUrl && rect && rect.width > 0) {
        setBrowserSnapshot({ dataUrl, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      if (!cancelled) await window.nodus.setBrowserOverlayVisible(true);
    };
    void freeze().catch(() => {});
    return () => { cancelled = true; setBrowserSnapshot(null); void window.nodus.setBrowserOverlayVisible(false); };
  }, [open]);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const state = focus?.snapshot?.state;
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); returnFocus.current?.focus?.(); }
      if (event.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button, input, select, summary, a[href]');
        const visible = [...(elements ?? [])].filter(el => el.getClientRects().length > 0);
        const first = visible[0]; const last = visible[visible.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(`[${FOCUS_TIMER_TRIGGER_ATTRIBUTE}]`)) return;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  if (!focus) return null;
  const showCounter = Boolean(state && state.status !== 'ready' && !focus.reduced);
  return <>
    <div className="focus-header-counter" data-testid="focus-header-slot">
      {showCounter && state && <button ref={trigger} data-testid="focus-header" data-status={state.status} className="focus-header-button" aria-expanded={open} aria-haspopup="dialog" title={state.task ? `${t('Temporizador de concentración')} · ${state.task}` : t('Temporizador de concentración')} onClick={() => setOpen(value => !value)}>
        <span className={`focus-dot ${state.status === 'running' ? 'active' : ''}`} />
        <span className="focus-header-phase">{state.status === 'paused' ? t('En pausa') : phaseName(state.phase)}</span>
        <strong>{focusClock(state.durationMs - state.elapsedMs)}</strong>
      </button>}
    </div>
    {open && browserSnapshot && createPortal(<img alt="" aria-hidden="true" src={browserSnapshot.dataUrl} style={{ position: 'fixed', zIndex: 10000, pointerEvents: 'none', left: browserSnapshot.left, top: browserSnapshot.top, width: browserSnapshot.width, height: browserSnapshot.height }} />, portalTarget())}
    {open && createPortal(<div ref={panel} className="focus-popover" role="dialog" aria-label={t('Temporizador de concentración')}><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{t('Tu momento de concentración')}</h2><span className="flex items-center gap-1"><button data-testid="focus-timer-settings" aria-label={t('Personalizar el modo concentración')} title={t('Personalizar el modo concentración')} className="btn btn-ghost" onClick={() => { setOpen(false); openFocusLayout(); }}><Icon name="settings" size={16} /></button><button aria-label={t('Cerrar temporizador')} className="btn btn-ghost" onClick={close}><Icon name="x" size={16} /></button></span></div><FocusControls compact /><button className="btn btn-ghost w-full mt-3" onClick={() => { setOpen(false); onProgress(); }}>{t('Ver progreso de concentración')} <Icon name="chevronRight" size={14} /></button></div>, portalTarget())}
  </>;
}

export function FocusCompletionNotice() {
  const focus = useStudyFocus();
  if (!focus?.notice) return null;
  const state = focus.snapshot?.state;
  const afterWork = focus.notice === 'work';
  // Starting from here keeps the subject and intention of the block that just ended.
  const next = !afterWork ? t('Comenzar bloque') : state && state.cycleBlocks % FOCUS_CYCLE_LENGTH === 0 ? t('Comenzar descanso largo') : t('Comenzar descanso');
  return <div className="focus-notice" role="status" data-testid="focus-notice"><Icon name="focus" size={15} /><span>{afterWork ? t('Bloque completado. Tu descanso está listo.') : t('Descanso completado. Puedes comenzar otro bloque.')}</span><button className="btn btn-primary" onClick={() => void focus.act('start')}>{next}</button><button className="btn btn-ghost" onClick={focus.dismissNotice} aria-label={t('Cerrar aviso de concentración')}>{t('Cerrar')}</button></div>;
}
