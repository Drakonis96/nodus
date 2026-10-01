import { useRef, type PointerEvent, type RefObject } from 'react';

/** A keyboard- and pointer-operated divider; sizes are percentages of its parent. */
export function PresenterDivider({ orientation, containerRef, value, min, max, defaultValue, label, onChange }: {
  orientation: 'vertical' | 'horizontal';
  containerRef: RefObject<HTMLDivElement | null>;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ point: number; value: number; extent: number } | null>(null);
  const vertical = orientation === 'vertical';
  const change = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      title={label}
      style={{ touchAction: 'none' }}
      className={`group flex shrink-0 items-center justify-center bg-neutral-950 transition-colors hover:bg-amber-500/15 focus-visible:bg-amber-500/15 focus-visible:outline-none ${vertical ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize'}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { point: vertical ? event.clientX : event.clientY, value, extent: vertical ? rect.width : rect.height };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || !start.extent) return;
        const point = vertical ? event.clientX : event.clientY;
        // The right sidebar grows leftward; the next-slide panel grows downward.
        change(start.value + (point - start.point) / start.extent * 100 * (vertical ? -1 : 1));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => change(defaultValue)}
      onKeyDown={(event) => {
        const decrease = vertical ? 'ArrowRight' : 'ArrowUp';
        const increase = vertical ? 'ArrowLeft' : 'ArrowDown';
        if (![decrease, increase, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        change(event.key === 'Home' ? min : event.key === 'End' ? max : value + (event.key === increase ? 2 : -2));
      }}
    >
      <span className={`rounded-full bg-white/20 group-hover:bg-amber-400 group-focus-visible:bg-amber-400 ${vertical ? 'h-8 w-0.5' : 'h-0.5 w-8'}`} />
    </div>
  );
}
