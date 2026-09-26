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

/** Every item a keyboard can reach: plain items and the radio items of a choice list. */
const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"]';

/**
 * A floating menu. It takes focus when it opens and gives it back to whatever had it when
 * it closes. Arrow keys, Home and End move between items; a submenu (an item with
 * `submenu`) opens with ArrowRight, and `onBack` returns from one with ArrowLeft. A menu
 * that swaps its content in place (a submenu) passes a new `focusKey` to focus its first
 * item again, so the keyboard never loses its place.
 */
export function FloatingMenu({ anchor, label, onClose, onBack, focusKey, children }: { anchor: DOMRect; label: string; onClose: () => void; onBack?: () => void; focusKey?: string; children: ReactNode }) {
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
  // Read while rendering for the first time, before the menu takes the focus.
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  // A hidden element cannot take the focus: it moves in once the menu is placed, and again
  // whenever the list changes in place. The frame that reveals the menu can still report
  // it hidden, so a focus that did not take is tried again on the next frames.
  const placed = position !== null;
  useLayoutEffect(() => {
    if (!placed) return;
    let frame = 0;
    const focusFirst = (tries: number) => {
      const item = ref.current?.querySelector<HTMLElement>(MENU_ITEMS);
      item?.focus();
      if (item && document.activeElement !== item && tries > 0) frame = requestAnimationFrame(() => focusFirst(tries - 1));
    };
    focusFirst(10);
    return () => cancelAnimationFrame(frame);
  }, [ref, focusKey, placed]);
  // Whatever opened the menu gets the focus back once it closes, unless the user moved on.
  useLayoutEffect(() => {
    const menu = ref.current;
    return () => {
      const focused = document.activeElement;
      if (opener?.isConnected && (!focused || focused === document.body || menu?.contains(focused))) opener.focus();
    };
  }, [ref, opener]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focus = (next: number) => { event.preventDefault(); items[(next + items.length) % items.length]?.focus(); };
    if (event.key === 'ArrowDown') focus(index + 1);
    else if (event.key === 'ArrowUp') focus(index < 0 ? -1 : index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(-1);
    else if (event.key === 'ArrowRight' && items[index]?.dataset.submenu) { event.preventDefault(); items[index].click(); }
    else if (event.key === 'ArrowLeft' && onBack) { event.preventDefault(); onBack(); }
  };
  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className="research-history-menu" style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: 'hidden' }} onKeyDown={onKeyDown}>{children}</div>,
    document.body,
  );
}

/**
 * One menu item. `radio` makes it one choice of a list (a project, a folder) and reads
 * `checked` out to assistive technology; `submenu` marks an item that opens another list
 * in place; `indent` nests it under the item above (a subfolder).
 */
export function MenuItem({ icon, label, onSelect, danger = false, checked = false, color, trailing, keepOpen = false, radio = false, submenu = false, indent = 0 }: {
  icon: string; label: string; onSelect: () => void; danger?: boolean; checked?: boolean; color?: string | null; trailing?: ReactNode; keepOpen?: boolean;
  radio?: boolean; submenu?: boolean; indent?: number;
}) {
  return <button type="button" role={radio ? 'menuitemradio' : 'menuitem'} aria-checked={radio ? checked : undefined} aria-haspopup={submenu ? 'menu' : undefined}
    data-submenu={submenu || undefined} data-keep-open={keepOpen || undefined} className={`research-history-menu-item ${danger ? 'is-danger' : ''}`}
    style={indent ? { paddingLeft: 10 + indent * 14 } : undefined} onClick={onSelect}>
    <span className="shrink-0" style={{ color: color ?? undefined }}><Icon name={icon} size={15} /></span>
    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    {checked && <Icon name="check" size={13} className="shrink-0" />}
    {trailing}
  </button>;
}
