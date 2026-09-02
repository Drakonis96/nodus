import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import type {
  DocumentIndexCampaign,
  DocumentIndexProgress,
  EmbeddingPipelineProgress,
  PassageEmbeddingProgress,
  QueueProgress,
} from '@shared/types';
import type { ZoteroImportProgress } from '@shared/libraryTypes';
import { t } from '../i18n';
import { Icon } from './ui';
import { QueueBar } from './QueueBar';
import { ZoteroImportProgressBar } from './ZoteroImportProgressBar';
import { DocumentIndexProgressBar } from './DocumentIndexProgressBar';
import { EmbeddingProgressBar } from './EmbeddingProgressBar';
import { PassageProgressBar } from './PassageProgressBar';

const ZOTERO_FINISHED: ZoteroImportProgress['phase'][] = ['complete', 'canceled', 'failed'];
const DOC_INDEX_LIVE = new Set<DocumentIndexCampaign['status']>(['queued', 'running', 'paused']);

function queueLive(queue: QueueProgress | null): boolean {
  return Boolean(queue && (
    queue.maintenanceRunning
    || queue.items.some((item) => item.state === 'queued' || item.state === 'running' || item.state === 'paused')
  ));
}

/**
 * How many of the queue readouts would currently render, and how many carry live
 * work. Each progress surface owns its own subscription, so this hook re-reads the
 * same channels in parallel: the header badge and the panel's empty state cannot
 * reach into the bars' internal state, and duplicating a broadcast subscription is
 * cheaper than lifting five progress states into App.
 */
export function useQueueActivity(): { visible: number; live: number } {
  const [queue, setQueue] = useState<QueueProgress | null>(null);
  const [zotero, setZotero] = useState<ZoteroImportProgress | null>(null);
  const [docIndex, setDocIndex] = useState<DocumentIndexProgress | null>(null);
  const [embeddings, setEmbeddings] = useState<EmbeddingPipelineProgress | null>(null);
  const [passages, setPassages] = useState<PassageEmbeddingProgress | null>(null);

  useEffect(() => {
    void window.nodus.getQueue().then(setQueue);
    void window.nodus.getDocumentIndexProgress().then(setDocIndex);
    void window.nodus.getEmbeddingStatus().then(setEmbeddings);
    void window.nodus.getPassageStatus().then(setPassages);
    const offQueue = window.nodus.onQueueProgress(setQueue);
    const offZotero = window.nodus.onZoteroImportProgress(setZotero);
    const offDocIndex = window.nodus.onDocumentIndexProgress(setDocIndex);
    const offEmbeddings = window.nodus.onEmbeddingProgress(setEmbeddings);
    const offPassages = window.nodus.onPassageProgress(setPassages);
    return () => {
      offQueue();
      offZotero();
      offDocIndex();
      offEmbeddings();
      offPassages();
    };
  }, []);

  const zoteroVisible = zotero !== null;
  const docIndexVisible = docIndex !== null && docIndex.campaigns.some((campaign) => DOC_INDEX_LIVE.has(campaign.status));
  const embeddingsVisible = embeddings !== null && (embeddings.running || embeddings.totalIdeas > 0 || Boolean(embeddings.error));
  const passagesVisible = passages !== null && (passages.running || passages.totalPassages > 0 || Boolean(passages.error));
  const visible = (queue !== null && !(queue.total === 0 && !queue.maintenanceError && !queue.maintenanceRunning) ? 1 : 0)
    + (zoteroVisible ? 1 : 0)
    + (docIndexVisible ? 1 : 0)
    + (embeddingsVisible ? 1 : 0)
    + (passagesVisible ? 1 : 0);

  const live = (queueLive(queue) ? 1 : 0)
    + (zotero !== null && !ZOTERO_FINISHED.includes(zotero.phase) ? 1 : 0)
    + (docIndexVisible ? 1 : 0)
    + (embeddings !== null && (embeddings.running || embeddings.paused) ? 1 : 0)
    + (passages !== null && (passages.running || passages.paused) ? 1 : 0);

  return { visible, live };
}

interface QueuePanelProps {
  /** The button the panel hangs from; null when closed. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  captureBrowserOverlaySnapshot: () => Promise<string | null>;
  setBrowserOverlayVisible: (visible: boolean) => Promise<void>;
}

/**
 * The queue and task progress dropdown, modelled on NotificationsPanel: same
 * anchor placement, same Escape/outside-click ownership split with App, same
 * browser-overlay freeze. The five progress surfaces render unchanged inside;
 * the `dark` wrapper forces their dark strip styling even in the light theme,
 * because the panel itself is dark regardless of theme, like the inbox panels.
 */
export function QueuePanel({
  anchorEl,
  onClose,
  captureBrowserOverlaySnapshot,
  setBrowserOverlayVisible,
}: QueuePanelProps) {
  const open = anchorEl != null;
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; originX: number } | null>(null);
  const [browserSnapshot, setBrowserSnapshot] = useState<{
    dataUrl: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const { visible } = useQueueActivity();

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
      if (target instanceof Element && target.closest('[data-queue-trigger]')) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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
            <div className="text-sm font-semibold text-neutral-200">{t('Cola y tareas')}</div>
            <button className="btn btn-ghost px-2 py-1" onClick={onClose} title={t('Cerrar')}>
              <Icon name="x" />
            </button>
          </div>
          <div className="dark max-h-[min(70vh,32rem)] overflow-y-auto">
            <QueueBar />
            <ZoteroImportProgressBar />
            <DocumentIndexProgressBar />
            <EmbeddingProgressBar />
            <PassageProgressBar />
            {visible === 0 && (
              <p data-testid="header-queue-empty" className="px-3 py-6 text-center text-xs text-neutral-500">
                {t('Sin tareas ni colas en curso.')}
              </p>
            )}
          </div>
        </motion.div>,
      ]}
    </AnimatePresence>,
    document.body
  );
}
