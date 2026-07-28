import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { positionViewportPopover } from '@shared/viewportPopover';

export function ViewportPopover({
  anchorRef,
  open,
  onDismiss,
  children,
  className = '',
  width = 240,
  estimatedHeight = 300,
  backdrop = false,
  closeOnEscape = true,
  testId,
}: {
  anchorRef: RefObject<HTMLElement>;
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
  className?: string;
  width?: number;
  estimatedHeight?: number;
  backdrop?: boolean;
  closeOnEscape?: boolean;
  testId?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [, forcePositionUpdate] = useState(0);
  dismissRef.current = onDismiss;

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const measured = panelRef.current.scrollHeight;
    setPanelHeight((current) => current === measured ? current : measured);
  });

  useEffect(() => {
    if (!open) {
      setPanelHeight(null);
      return;
    }

    const reposition = () => forcePositionUpdate((revision) => revision + 1);
    const dismissOutside = (event: MouseEvent) => {
      if (backdrop) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!anchorRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        dismissRef.current();
      }
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') dismissRef.current();
    };

    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('mousedown', dismissOutside, true);
    window.addEventListener('keydown', dismissWithKeyboard);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('mousedown', dismissOutside, true);
      window.removeEventListener('keydown', dismissWithKeyboard);
    };
  }, [anchorRef, backdrop, closeOnEscape, open]);

  if (!open) return null;

  const anchor = anchorRef.current?.getBoundingClientRect();
  const position = anchor
    ? positionViewportPopover(
        anchor,
        { width, height: panelHeight ?? estimatedHeight },
        { width: window.innerWidth, height: window.innerHeight },
      )
    : null;

  return createPortal(
    <>
      {backdrop && (
        <div
          className="fixed inset-0 z-[110]"
          onMouseDown={(event) => {
            event.preventDefault();
            dismissRef.current();
          }}
        />
      )}
      <div
        ref={panelRef}
        className={`fixed z-[120] overflow-y-auto ${className}`}
        data-testid={testId}
        data-placement={position?.placement}
        style={position ? {
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
        } : { visibility: 'hidden' }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
