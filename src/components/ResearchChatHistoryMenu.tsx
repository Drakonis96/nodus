import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { useDismissableLayer } from '../hooks';
import { t } from '../i18n';

/* The research chat history's floating menu, its items and the inline rename field,
 * shared by the history's rows and the project folder tree. */

/** An inline name field. Enter or leaving it confirms the trimmed text, which may be
 * empty; Escape cancels with null. */
export function RenameField({ value, onDone }: { value: string; onDone: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const done = useRef(false);
  const finish = (next: string | null) => { if (done.current) return; done.current = true; onDone(next); };
  return <input className="research-history-rename" autoFocus value={draft} aria-label={t('Nuevo nombre')}
    onFocus={event => event.currentTarget.select()}
    onClick={event => event.stopPropagation()}
    onChange={event => setDraft(event.target.value)}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(draft.trim());
      if (event.key === 'Escape') finish(null);
    }}
    onBlur={() => finish(draft.trim())} />;
}

export function FloatingMenu({ anchor, label, onClose, children }: { anchor: DOMRect; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useDismissableLayer<HTMLDivElement>({ open: true, onDismiss: onClose, group: 'research-history-menu' });
  // Placed before the first paint and hidden until then: measured after painting, the menu
  // showed for a frame hanging to the right of its button and then jumped to the left.
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const top = anchor.bottom + 4 + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 4) : anchor.bottom + 4;
    const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
    // Re-measured when the content changes (the project list), set only when it moved.
    setPosition(current => current && current.top === top && current.left === left ? current : { top, left });
  }, [anchor, children, ref]);
  useLayoutEffect(() => { ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [ref]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className="research-history-menu" style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: 'hidden' }} onKeyDown={onKeyDown}>{children}</div>,
    document.body,
  );
}

export function MenuItem({ icon, label, onSelect, danger = false, checked = false, color, trailing, keepOpen = false }: {
  icon: string; label: string; onSelect: () => void; danger?: boolean; checked?: boolean; color?: string | null; trailing?: ReactNode; keepOpen?: boolean;
}) {
  return <button type="button" role="menuitem" data-keep-open={keepOpen || undefined} className={`research-history-menu-item ${danger ? 'is-danger' : ''}`} onClick={onSelect}>
    <span className="shrink-0" style={{ color: color ?? undefined }}><Icon name={icon} size={15} /></span>
    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    {checked && <Icon name="check" size={13} className="shrink-0" />}
    {trailing}
  </button>;
}
