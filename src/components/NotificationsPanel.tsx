import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { NodiNotification } from '@shared/types';
import { announcementCopyFor, type AnnouncementEntry, type AnnouncementRefreshResult } from '@shared/announcements';
import { notificationLine, t } from '../i18n';
import { ConfirmModal } from './ConfirmModal';
import { Icon } from './ui';

/**
 * The notification centre, in the header.
 *
 * Nodi has shown the same two lists since it existed, but Nodi is optional: turn the
 * mascot off in Settings and the notification centre goes with it, which is how an
 * announcement could reach an install and never be seen. This panel is the way in that
 * does not depend on a mascot, anchored under its own header button exactly as
 * ServerInbox is under the inbox one.
 *
 * Two lists, not one, because they are not the same kind of thing:
 *
 *  • Avisos — published between releases, kept in their own store, read one at a time.
 *    A survey link that got buried under fifty "queue finished" lines would be a survey
 *    nobody answered, so they sit on top and stay until they are explicitly cleared or expire.
 *  • Actividad — what the app has been doing. Ephemeral, capped at 50, and marked read
 *    in bulk when the panel opens, because "I have seen these" is all it ever means.
 */

/** Announcement text arrives over the network; the dot is the only thing it colours. */
const SEVERITY_DOT: Record<AnnouncementEntry['severity'], string> = {
  info: 'bg-indigo-600 dark:bg-indigo-400',
  warning: 'bg-amber-500 dark:bg-amber-400',
};

/**
 * Published announcements plus this install's read marks, live.
 *
 * Shared by the header panel and by Nodi so the two can never disagree about what is
 * unread — the count in the header is the count behind the mascot.
 */
export function useAnnouncements(): {
  announcements: AnnouncementEntry[];
  unread: number;
  markRead: (id: string) => void;
  refresh: () => ReturnType<typeof window.nodus.refreshNotifications>;
} {
  const [announcements, setAnnouncements] = useState<AnnouncementEntry[]>([]);

  useEffect(() => {
    window.nodus.listAnnouncements().then(setAnnouncements).catch(() => {});
    return window.nodus.onAnnouncementsChanged(setAnnouncements);
  }, []);

  const markRead = useCallback((id: string) => {
    window.nodus.markAnnouncementRead(id).then(setAnnouncements).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    const snapshot = await window.nodus.refreshNotifications();
    setAnnouncements(snapshot.announcements);
    return snapshot;
  }, []);

  return {
    announcements,
    unread: announcements.reduce((total, entry) => total + (entry.read ? 0 : 1), 0),
    markRead,
    refresh,
  };
}

export function announcementRefreshMessage(result: AnnouncementRefreshResult): string {
  switch (result.status) {
    case 'updated': return t('Notificaciones actualizadas.');
    case 'not-modified': return t('Sin novedades.');
    case 'disabled': return t('Los avisos están desactivados.');
    case 'error': return t('No se pudieron actualizar las notificaciones.');
  }
}

/** A published date, in the reader's locale rather than the ISO the file carries. */
function announcementDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString();
}

export function AnnouncementRow({
  entry,
  language,
  onMarkRead,
}: {
  entry: AnnouncementEntry;
  language: string;
  onMarkRead: (id: string) => void;
}) {
  const copy = announcementCopyFor(entry, language);
  return (
    <li className="flex items-start gap-2 border-b border-neutral-900 px-3 py-2.5 last:border-b-0">
      <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${entry.read ? 'bg-transparent' : SEVERITY_DOT[entry.severity]}`} />
      <div className="min-w-0 flex-1">
        {/* Plain text on purpose: this string came off the network, and the moment it is
            rendered as markup the published file becomes a way to inject into the app. */}
        <p className={`text-xs ${entry.read ? 'text-neutral-400' : 'font-semibold text-neutral-100'}`}>{copy.title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-neutral-400">{copy.body}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-neutral-500">{announcementDate(entry.date)}</span>
          {entry.url && (
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-0.5 text-[11px] text-indigo-600 dark:text-indigo-300"
              onClick={() => {
                // Engaging with the link is reading it; nobody should have to say so twice.
                onMarkRead(entry.id);
                void window.nodus.openExternal(entry.url!);
              }}
            >
              <Icon name="external" size={12} /> {copy.linkLabel ?? t('Abrir enlace')}
            </button>
          )}
          {!entry.read && (
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-0.5 text-[11px]"
              onClick={() => onMarkRead(entry.id)}
            >
              <Icon name="check" size={12} /> {t('Marcar como leído')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

interface NotificationsPanelProps {
  /** The button the panel hangs from; null when closed. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  notifications: NodiNotification[];
  announcements: AnnouncementEntry[];
  language: string;
  onMarkAnnouncementRead: (id: string) => void;
  onRefresh: () => Promise<AnnouncementRefreshResult>;
  refreshing: boolean;
  onClearAll: () => void;
}

export function NotificationsPanel({
  anchorEl,
  onClose,
  notifications,
  announcements,
  language,
  onMarkAnnouncementRead,
  onRefresh,
  refreshing,
  onClearAll,
}: NotificationsPanelProps) {
  const open = anchorEl != null;
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; originX: number } | null>(null);
  const [clearConfirmation, setClearConfirmation] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<AnnouncementRefreshResult | null>(null);

  const handleRefresh = async () => {
    setRefreshFeedback(null);
    try {
      setRefreshFeedback(await onRefresh());
    } catch {
      setRefreshFeedback({ status: 'error', checkedAt: Date.now() });
    }
  };

  // Placement, Escape and outside-click are ServerInbox's, deliberately: two panels
  // hanging off the same header should behave identically, and that one already solved it.
  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const compute = () => {
      const r = anchorEl.getBoundingClientRect();
      const width = Math.min(420, window.innerWidth - 32);
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
    if (!open || clearConfirmation) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-notifications-trigger]')) return;
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
  }, [clearConfirmation, open, onClose]);

  useEffect(() => {
    if (!open) setClearConfirmation(false);
  }, [open]);

  const empty = announcements.length === 0 && notifications.length === 0;

  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <motion.div
          ref={panelRef}
          key="notifications-panel"
          data-testid="header-notifications-panel"
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
          aria-label={t('Notificaciones')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
            <div className="text-sm font-semibold text-neutral-200">{t('Notificaciones')}</div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="header-notifications-refresh"
                className="btn btn-ghost px-2 py-1"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                title={t(refreshing ? 'Actualizando…' : 'Actualizar')}
                aria-label={t(refreshing ? 'Actualizando…' : 'Actualizar')}
              >
                <Icon name="refresh" className={refreshing ? 'animate-spin' : ''} />
              </button>
              {!empty && (
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setClearConfirmation(true)}>
                  {t('Limpiar')}
                </button>
              )}
              <button className="btn btn-ghost px-2 py-1" onClick={onClose} title={t('Cerrar')}>
                <Icon name="x" />
              </button>
            </div>
          </div>

          {refreshFeedback && (
            <div
              data-testid="header-notifications-refresh-status"
              data-status={refreshFeedback.status}
              role="status"
              className={`border-b border-neutral-900 px-3 py-1.5 text-[11px] ${refreshFeedback.status === 'error' ? 'text-red-300' : 'text-neutral-400'}`}
            >
              {announcementRefreshMessage(refreshFeedback)}
            </div>
          )}

          {empty ? (
            <p className="px-3 py-6 text-center text-xs text-neutral-500">{t('No hay notificaciones.')}</p>
          ) : (
            <div className="max-h-[min(60vh,26rem)] overflow-y-auto">
              {announcements.length > 0 && (
                <>
                  <div className="border-b border-neutral-900 bg-neutral-900/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    {t('Avisos de Nodus')}
                  </div>
                  <ul>
                    {announcements.map((entry) => (
                      <AnnouncementRow key={entry.id} entry={entry} language={language} onMarkRead={onMarkAnnouncementRead} />
                    ))}
                  </ul>
                </>
              )}

              {notifications.length > 0 && (
                <>
                  <div className="border-y border-neutral-900 bg-neutral-900/40 px-3 py-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Actividad')}</span>
                  </div>
                  <ul>
                    {notifications.map((notification) => (
                      <li key={notification.id} className="flex items-start gap-2 border-b border-neutral-900 px-3 py-2 last:border-b-0">
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                            notification.read
                              ? 'bg-transparent'
                              : notification.kind === 'warning'
                                ? 'bg-amber-500 dark:bg-amber-400'
                                : notification.kind === 'success'
                                  ? 'bg-emerald-600 dark:bg-emerald-400'
                                  : 'bg-indigo-600 dark:bg-indigo-400'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs ${notification.read ? 'text-neutral-400' : 'font-semibold text-neutral-100'}`}>
                            {notificationLine(notification.titleText, notification.title)}
                          </p>
                          {(notification.bodyText || notification.body) && (
                            <p className="mt-0.5 text-[11px] leading-4 text-neutral-400">
                              {notificationLine(notification.bodyText, notification.body)}
                            </p>
                          )}
                          <p className="mt-1 text-[10px] text-neutral-500">
                            {new Date(notification.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {clearConfirmation && (
            <ConfirmModal
              title={t('Limpiar notificaciones')}
              message={t('Se eliminarán todos los avisos de Nodus y la actividad reciente. Esta acción no se puede deshacer.')}
              confirmLabel={t('Limpiar')}
              danger
              onCancel={() => setClearConfirmation(false)}
              onConfirm={() => {
                setClearConfirmation(false);
                onClearAll();
              }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
