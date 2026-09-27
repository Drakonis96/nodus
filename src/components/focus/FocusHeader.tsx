import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStudyFocus } from './StudyFocusContext';
import { FocusControls, focusClock, phaseName } from './FocusControls';
import { Icon } from '../ui';

export function FocusHeader({ onProgress, onNavigate }: { onProgress: () => void; onNavigate: () => void }) {
  const focus = useStudyFocus();
  const [open, setOpen] = useState(false);
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
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (event.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button, input, select, summary, a[href]');
        const visible = [...(elements ?? [])].filter(el => el.getClientRects().length > 0);
        const first = visible[0]; const last = visible[visible.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', close, true); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', close, true); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  useEffect(() => { setOpen(false); }, [focus?.snapshot?.vaultId]);
  if (!focus) return null;
  return <>
    <div className="focus-header-actions">
      {focus.reduced && <><button className="btn btn-ghost" onClick={onNavigate}>Navegar</button><button className="btn btn-ghost focus-exit" onClick={() => focus.setReduced(false)}>Salir de concentración</button></>}
      <button ref={trigger} data-testid="focus-header" className="btn btn-ghost focus-header-button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}><Icon name="focus" size={16} /><span>{state && state.status !== 'ready' ? `${phaseName(state.phase)} · ${focusClock(state.durationMs - state.elapsedMs)}` : 'Concentración'}</span>{state?.status === 'paused' && <span className="sr-only">En pausa</span>}</button>
    </div>
    {open && browserSnapshot && createPortal(<img alt="" aria-hidden="true" src={browserSnapshot.dataUrl} style={{ position: 'fixed', zIndex: 10000, pointerEvents: 'none', left: browserSnapshot.left, top: browserSnapshot.top, width: browserSnapshot.width, height: browserSnapshot.height }} />, trigger.current?.closest('[data-testid="app-shell"]') ?? document.body)}
    {open && createPortal(<div ref={panel} className="focus-popover" role="dialog" aria-label="Temporizador de concentración"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Tu momento de concentración</h2><button aria-label="Cerrar temporizador" className="btn btn-ghost" onClick={() => { setOpen(false); trigger.current?.focus(); }}><Icon name="x" size={16} /></button></div><FocusControls compact /><button className="btn btn-ghost w-full mt-3" onClick={() => { setOpen(false); onProgress(); }}>Ver progreso de concentración <Icon name="chevronRight" size={14} /></button></div>, trigger.current?.closest('[data-testid="app-shell"]') ?? document.body)}
  </>;
}

export function FocusCompletionNotice() {
  const focus = useStudyFocus();
  if (!focus?.notice) return null;
  return <div className="focus-notice" role="status"><span>{focus.notice}</span><button className="btn btn-primary" onClick={() => void focus.act('start')}>Comenzar siguiente tramo</button><button className="btn btn-ghost" onClick={focus.dismissNotice} aria-label="Cerrar aviso de concentración">Cerrar</button></div>;
}
