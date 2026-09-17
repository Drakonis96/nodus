// The right-click menu of a log line: copy this line, copy it as JSON, download it, or act on
// the whole filtered view.
//
// Hand-rolled on purpose — the project has no menu primitive, and every other menu in the app
// is the same three things: a portal to the body, fixed geometry, and dismissal on
// outside-mousedown plus Escape (see `useDismissableLayer` for the panel-shaped version).
// Escape is captured here so it closes the menu without closing the modal behind it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';
import { Icon } from '../ui';

export interface LogContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  /** A destructive entry is drawn in red and goes last. */
  danger?: boolean;
}

export function LogContextMenu({
  x,
  y,
  items,
  onSelect,
  onClose,
  testId = 'pipeline-log-context-menu',
}: {
  x: number;
  y: number;
  items: LogContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
  testId?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu inside the viewport: a right-click near the bottom edge would otherwise
  // open a menu whose last entry — usually the destructive one — is unreachable.
  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 220;
    const height = rect?.height ?? items.length * 32;
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [items.length, x, y]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [close]);

  const normal = items.filter((item) => !item.danger);
  const dangerous = items.filter((item) => item.danger);

  const renderItem = (item: LogContextMenuItem) => (
    <button
      key={item.id}
      type="button"
      data-testid={`${testId}-${item.id}`}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
        item.danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
      }`}
      onClick={() => { onSelect(item.id); close(); }}
    >
      {item.icon && <Icon name={item.icon} size={13} className="shrink-0 opacity-70" />}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: 'fixed', ...position, zIndex: 260 }}
      // Part of the modal layer, like the filter popovers: the queue panel behind must not
      // treat a click on the menu as an outside click and close the modal being used.
      data-modal-layer="logs-menu"
      className="min-w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
      role="menu"
      data-testid={testId}
      onContextMenu={(event) => event.preventDefault()}
    >
      {normal.map(renderItem)}
      {dangerous.length > 0 && <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />}
      {dangerous.map(renderItem)}
      <div className="mt-1 border-t border-neutral-200 px-2 pt-1 text-[10px] text-neutral-500 dark:border-neutral-700">
        {t('Cerrar')} · Esc
      </div>
    </div>,
    document.body,
  );
}
