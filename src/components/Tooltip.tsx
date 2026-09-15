import { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HTMLAttributes, ReactElement, Ref } from 'react';

/**
 * A styled tooltip that appears on hover or keyboard focus, replacing the native
 * `title` attribute (whose delay and look belong to the OS, not the app).
 *
 * Rendered through a portal with fixed positioning so a scroll container can never
 * clip it — the compact sidebar's overflow region and the header's overflow-hidden
 * rail are exactly where a clipped tooltip would die. The trigger keeps its own
 * `aria-label`; the tooltip is a visual duplicate, not the accessible name.
 *
 * `when={false}` renders the child untouched, so one call site can serve both the
 * expanded sidebar (labels visible, no tooltip) and the collapsed icon rail. A
 * `disabled` child swallows pointer events in every browser, so hover handlers
 * would never fire; there the label falls back to a native `title`, which disabled
 * controls still show.
 */
export function Tooltip({
  when = true,
  label,
  placement = 'right',
  disabled = false,
  children,
}: {
  when?: boolean;
  label: string;
  placement?: 'right' | 'bottom';
  disabled?: boolean;
  children: ReactElement;
}) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 350);
  }, []);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = tooltipRef.current?.offsetWidth ?? 160;
      const height = tooltipRef.current?.offsetHeight ?? 28;
      let left: number;
      let top: number;
      if (placement === 'right') {
        left = rect.right + 8;
        // Out of window on the right — flip to the left of the trigger.
        if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 8);
        top = rect.top + rect.height / 2 - height / 2;
      } else {
        left = Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8);
        top = rect.bottom + 8;
        // Off the bottom edge — flip above the trigger.
        if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
      }
      setPos({ left: Math.max(8, left), top: Math.max(8, Math.min(top, window.innerHeight - height - 8)) });
    };
    // First paint sits off-screen (unknown size); the layout effect runs before
    // paint and a frame later, once the portal has a measurable box.
    update();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, placement]);

  if (!isValidElement(children)) return children;
  if (!when) return children;
  if (disabled) return cloneElement(children as ReactElement<{ title?: string }>, { title: label });

  // The trigger may be any element; we only attach pointer/focus handlers and a ref.
  const trigger = children as ReactElement<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>;

  return (
    <>
      {cloneElement(trigger, {
        ref: triggerRef,
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: () => { window.clearTimeout(timer.current); setOpen(true); },
        onBlur: hide,
      })}
      {open && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          data-testid="tooltip"
          className="nodus-tooltip pointer-events-none fixed z-[90]"
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
        >
          {label}
        </div>,
        document.body,
      )}
    </>
  );
}
