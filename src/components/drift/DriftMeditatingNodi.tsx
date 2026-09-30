import { memo, useEffect, useRef } from 'react';
import { Nodi } from '../nodi/Nodi';

/** The classic mascot keeps its own identity. Only this instance wears the lotus pose.
 * Pointer updates touch two CSS properties instead of rebuilding the filtered SVG. */
export const DriftMeditatingNodi = memo(function DriftMeditatingNodi({ reduceMotion = false }: { reduceMotion?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    let restTimer = 0;
    let pointer = { x: 0, y: 0 };
    const rest = () => {
      host.dataset.awake = 'false';
      host.style.setProperty('--nodi-gaze-x', '0px');
      host.style.setProperty('--nodi-gaze-y', '0px');
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY };
      host.dataset.awake = 'true';
      window.clearTimeout(restTimer);
      restTimer = window.setTimeout(rest, 2500);
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = host.querySelector('svg')?.getBoundingClientRect();
        if (!rect) return;
        const dx = pointer.x - (rect.left + rect.width * 130 / 270);
        const dy = pointer.y - (rect.top + rect.height * 140 / 300);
        host.style.setProperty('--nodi-gaze-x', `${Math.tanh(dx / 180) * 3.5}px`);
        host.style.setProperty('--nodi-gaze-y', `${Math.tanh(dy / 180) * 2.5}px`);
      });
    };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) rest(); };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', leave);
    window.addEventListener('blur', rest);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', leave);
      window.removeEventListener('blur', rest);
      window.clearTimeout(restTimer);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={hostRef} className="drift-nodi" data-testid="drift-nodi" data-awake="false" data-reduced-motion={reduceMotion}>
      <div className="drift-nodi-float"><Nodi height={270} className="drift-nodi-character" /></div>
      <span className="drift-nodi-ripple" aria-hidden="true" />
    </div>
  );
});
