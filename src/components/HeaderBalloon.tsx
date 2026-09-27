import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { t } from '../i18n';
import './headerBalloon.css';

/**
 * The one balloon the chat header's buttons open: Context, Sources, System prompt, Skills
 * and Concilium. Anchored under its button (above it when there is no room), with the same
 * header — icon, title, a short count — and the same close, Escape and click-outside
 * behaviour, so the header reads as one control set rather than five.
 *
 * It portals to <body> so no clipped header can cut it, and carries the vault accent and
 * the light theme of the button that opened it. A dialog opened from inside (an editor,
 * a confirmation) marks itself with data-balloon-layer and does not close the balloon.
 */
export function HeaderBalloon({ open, anchor, onClose, icon, title, meta, children, footer, width = 420, testId, className = '', bodyClassName = '' }: {
  open: boolean;
  anchor: RefObject<HTMLElement>;
  onClose: () => void;
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  testId?: string;
  className?: string;
  bodyClassName?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const [theme, setTheme] = useState<{ light: boolean; accent: string }>({ light: false, accent: 'var(--a-500)' });
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = anchor.current;
    if (trigger) setTheme({
      light: !!trigger.closest('.light, .nodi-theme-light'),
      accent: getComputedStyle(trigger).getPropertyValue('--vault-accent').trim() || 'var(--a-500)',
    });
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const size = Math.min(width, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const upwards = below < 360 && above > below;
      setStyle({
        position: 'fixed', width: size, zIndex: 10050,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - size - 12)),
        top: upwards ? 'auto' : rect.bottom + 8,
        bottom: upwards ? window.innerHeight - rect.top + 8 : 'auto',
        maxHeight: Math.min(720, Math.max(220, upwards ? above : below)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchor, width]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => target instanceof Node && (
      !!panel.current?.contains(target) || !!anchor.current?.contains(target)
      || (target instanceof Element && !!target.closest('[data-balloon-layer]')));
    const pointer = (event: MouseEvent) => { if (!inside(event.target)) close.current(); };
    // Bubble phase, after anything inside: a nested dropdown or a dialog opened from the
    // balloon answers its own Escape first, and the balloon closes only on an Escape
    // nobody else handled. Then the event stops here, so the chat behind stays open.
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[data-balloon-layer]')) return;
      event.stopPropagation();
      close.current();
      anchor.current?.focus();
    };
    document.addEventListener('mousedown', pointer);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', pointer); document.removeEventListener('keydown', key); };
  }, [open, anchor]);

  useEffect(() => { if (open) panel.current?.focus({ preventScroll: true }); }, [open]);

  if (!open) return null;
  return createPortal(
    <div className={theme.light ? 'light' : ''} style={{ '--vault-accent': theme.accent } as CSSProperties}>
      <div ref={panel} role="dialog" aria-label={title} tabIndex={-1} data-testid={testId} className={`header-balloon ${className}`} style={style}>
        <header className="header-balloon-head">
          <span className="header-balloon-icon" aria-hidden="true">{icon}</span>
          <span className="header-balloon-title">{title}</span>
          {meta != null && <span className="header-balloon-meta">{meta}</span>}
          <span className="flex-1" />
          <button type="button" className="header-balloon-close" aria-label={t('Cerrar')} title={t('Cerrar')} onClick={() => { onClose(); anchor.current?.focus(); }}><Icon name="x" size={16} /></button>
        </header>
        <div className={`header-balloon-body ${bodyClassName}`}>{children}</div>
        {footer && <footer className="header-balloon-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
