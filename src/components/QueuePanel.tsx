import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import type { QueueActivity } from '../queueActivity';
export { useQueueActivity } from '../queueActivity';
import { AdditionalQueueTasks } from './AdditionalQueueTasks';
import { t } from '../i18n';
import { Icon } from './ui';
import { QueueBar } from './QueueBar';
import { ZoteroImportProgressBar } from './ZoteroImportProgressBar';
import { DocumentIndexProgressBar } from './DocumentIndexProgressBar';
import { EmbeddingProgressBar } from './EmbeddingProgressBar';
import { PassageProgressBar } from './PassageProgressBar';
import { ConfirmModal } from './ConfirmModal';

interface QueuePanelProps {
  activity: QueueActivity;
  /** The button the panel hangs from; null when closed. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  captureBrowserOverlaySnapshot: () => Promise<string | null>;
  setBrowserOverlayVisible: (visible: boolean) => Promise<void>;
}

/**
 * The queue and task progress dropdown, modelled on NotificationsPanel: same
 * anchor placement, same Escape/outside-click ownership split with App, same
 * browser-overlay freeze. Progress is owned by App, independently of this panel;
 * all task surfaces inherit the active theme, including portalled confirmations.
 */
export function QueuePanel({
  activity,
  anchorEl,
  onClose,
  captureBrowserOverlaySnapshot,
  setBrowserOverlayVisible,
}: QueuePanelProps) {
  const open = anchorEl != null;
  const [confirmClear, setConfirmClear] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; originX: number } | null>(null);
  const [browserSnapshot, setBrowserSnapshot] = useState<{
    dataUrl: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const { visible } = activity;
  useEffect(() => { if (!open) setConfirmClear(false); }, [open]);

  // Placement, Escape and outside-click are ServerInbox's, deliberately: the panels
  // hanging off the header behave identically, and that one already solved it.
  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const compute = () => {
      const r = anchorEl.getBoundingClientRect();
      const width = Math.min(520, window.innerWidth - 32);
      const rawLeft = r.left + r.width / 2 - width / 2;
      const left = Math.max(16, Math.min(rawLeft, window.innerWidth - width - 16));
      setPos({ left, top: r.bottom + 8, width, originX: r.left + r.width / 2 - left });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, anchorEl]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-queue-trigger], [aria-modal="true"]')) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      // ConfirmModal is portalled beside this panel and owns Escape while open.
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // A browser tab is a native WebContentsView, so z-index cannot put this React
  // panel above it. Freeze the page into React first, wait until that frame has
  // painted, and only then hide the native child.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const prepare = async () => {
      const dataUrl = await captureBrowserOverlaySnapshot().catch(() => null);
      if (cancelled) return;
      const viewport = document.querySelector<HTMLElement>('[data-browser-viewport]');
      const rect = viewport?.getBoundingClientRect();
      if (dataUrl && rect && rect.width > 0 && rect.height > 0) {
        setBrowserSnapshot({
          dataUrl,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      }
      if (!cancelled) await setBrowserOverlayVisible(true);
    };
    void prepare();
    return () => {
      cancelled = true;
      setBrowserSnapshot(null);
      void setBrowserOverlayVisible(false);
    };
  }, [captureBrowserOverlaySnapshot, open, setBrowserOverlayVisible]);

  return createPortal(
    <AnimatePresence>
      {open && pos && [
        browserSnapshot && (
          <img
            key="queue-browser-snapshot"
            data-testid="header-queue-browser-snapshot"
            src={browserSnapshot.dataUrl}
            alt=""
            aria-hidden="true"
            className="pointer-events-none fixed z-[53] object-fill"
            style={{
              left: browserSnapshot.left,
              top: browserSnapshot.top,
              width: browserSnapshot.width,
              height: browserSnapshot.height,
            }}
          />
        ),
        <motion.div
          key="queue-backdrop"
          data-testid="header-queue-backdrop"
          className="fixed inset-0 z-[54]"
          aria-hidden="true"
          onMouseDown={onClose}
        />,
        <motion.div
          ref={panelRef}
          key="queue-panel"
          data-testid="header-queue-panel"
          initial={{ opacity: 0, scaleY: 0.8, y: -8 }}
          animate={{ opacity: 1, scaleY: 1, y: 0 }}
          exit={{ opacity: 0, scaleY: 0.85, y: -8 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            width: pos.width,
            transformOrigin: `${pos.originX}px top`,
            zIndex: 55,
          }}
          className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl"
          role="dialog"
          aria-label={t('Cola y tareas')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
            <div className="min-w-0 flex-1 text-sm font-semibold text-neutral-200">{t('Cola y tareas')}</div>
            <button className="btn btn-ghost shrink-0 px-2 py-1 text-xs" disabled={!activity.canClearFinished} onClick={() => setConfirmClear(true)}>
              {t('Limpiar terminadas')}
            </button>
            <button className="btn btn-ghost px-2 py-1" onClick={onClose} title={t('Cerrar')}>
              <Icon name="x" />
            </button>
          </div>
          <div className="max-h-[min(70vh,32rem)] overflow-y-auto [overflow-wrap:anywhere]">
            <QueueBar progress={activity.queue} />
            <ZoteroImportProgressBar progress={activity.zotero} onDismiss={() => {
              if (activity.zotero) activity.dismiss('zotero', `${activity.zotero.requestId}:${activity.zotero.phase}`);
            }} />
            <DocumentIndexProgressBar progress={activity.documents} />
            <EmbeddingProgressBar progress={activity.embeddings} />
            <PassageProgressBar progress={activity.passages} />
            <AdditionalQueueTasks activity={activity} />
            {visible === 0 && (
              <p data-testid="header-queue-empty" className="px-3 py-6 text-center text-xs text-neutral-500">
                {t('Sin tareas ni colas en curso.')}
              </p>
            )}
          </div>
          {confirmClear && <ConfirmModal
            title={t('Limpiar tareas terminadas')}
            message={t('Se ocultarán de la cola las tareas completadas, canceladas o fallidas. Se conservarán las tareas en curso, pendientes o en pausa y los documentos generados.')}
            confirmLabel={t('Limpiar terminadas')}
            onConfirm={() => { activity.clearFinished(); setConfirmClear(false); }}
            onCancel={() => setConfirmClear(false)}
          />}
        </motion.div>,
      ]}
    </AnimatePresence>,
    document.body
  );
}
