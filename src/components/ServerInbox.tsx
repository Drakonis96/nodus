import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { ServerInboxEntry } from '@shared/types';
import { t, tx } from '../i18n';
import { Icon } from './ui';

/**
 * What has arrived from other devices, anchored under the header's Inbox button.
 *
 * Anchored rather than modal, and that is a judgement about weight: an inbox is a list you
 * glance at from an icon, not a task. ModalBackdrop renders `fixed inset-0 grid
 * place-items-center`, and a centred dialog asking "what arrived?" costs more attention
 * than the answer is worth. Placement, Escape and outside-click are lifted from
 * VaultSwitcher, which solved the same problem for the same header.
 *
 * Opening the panel marks NOTHING as read. Read state is per entry because that is what it
 * is for: the point is to be able to say "I have dealt with this one".
 */

interface ServerInboxProps {
  /** The button the panel hangs from; null when closed. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  entries: ServerInboxEntry[];
  onMarkRead: (id?: string) => void;
  onClearOne: (id: string) => void;
  onClearAll: () => void;
  onOpenEntry: (entry: ServerInboxEntry) => void;
}

/** "hace 4 min", "hace 2 h" — a relative time nobody has to parse. */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return t('hace un momento');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return tx('hace {n} min', { n: String(minutes) });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tx('hace {n} h', { n: String(hours) });
  return tx('hace {n} d', { n: String(Math.round(hours / 24)) });
}

/**
 * A device id is a long opaque string; only its ends carry any recognition value.
 * Shortened here rather than at the source because the full value is what identifies the
 * device to the server, and the inbox is only naming it for a person.
 */
function shortDevice(clientId: string | null): string | null {
  if (!clientId) return null;
  return clientId.length <= 12 ? clientId : `${clientId.slice(0, 6)}…${clientId.slice(-4)}`;
}

/**
 * The outcome chip.
 *
 * Written as a chain of literal t() calls and not as t(LABEL[outcome]), because
 * scripts/test-i18n-coverage.mjs walks the source for literals and cannot see a key
 * reached through a variable — which is exactly how the sidebar labels once shipped
 * untranslated.
 */
function OutcomeChip({ outcome }: { outcome: ServerInboxEntry['outcome'] }) {
  let label: string;
  let tone: string;
  if (outcome === 'applied') {
    label = t('Aplicado');
    tone = 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300';
  } else if (outcome === 'deleted') {
    label = t('Eliminado');
    tone = 'border-neutral-700 bg-neutral-900 text-neutral-300';
  } else if (outcome === 'kept_local') {
    label = t('Se conservó tu versión');
    tone = 'border-amber-700/60 bg-amber-950/40 text-amber-300';
  } else {
    label = t('Rechazado');
    tone = 'border-red-800/70 bg-red-950/40 text-red-300';
  }
  return (
    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{label}</span>
  );
}

export function ServerInbox({ anchorEl, onClose, entries, onMarkRead, onClearOne, onClearAll, onOpenEntry }: ServerInboxProps) {
  const open = anchorEl != null;
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; originX: number } | null>(null);

  // Placed from the trigger's rect and clamped to the viewport, then kept pinned on
  // resize/scroll. `originX` points the unfold at the button it came from.
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

  // Dismiss on outside click / Escape. A click on the trigger itself is ignored so it can
  // toggle, exactly as `data-vault-trigger` does for the vault panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-inbox-trigger]')) return;
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

  const unread = entries.reduce((n, entry) => n + (entry.read ? 0 : 1), 0);

  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <motion.div
          ref={panelRef}
          key="server-inbox-panel"
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
          aria-label={t('Bandeja')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
            <div className="text-sm font-semibold text-neutral-200">{t('Bandeja')}</div>
            <button className="btn btn-ghost px-2 py-1" onClick={onClose} title={t('Cerrar')}>
              <Icon name="x" />
            </button>
          </div>

          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-neutral-500">{t('Nada ha llegado todavía.')}</p>
          ) : (
            <>
              <ul className="max-h-[min(60vh,26rem)] overflow-y-auto">
                {entries.map((entry) => {
                  const device = shortDevice(entry.clientId);
                  const openable = entry.entityKind === 'deep_research' && entry.outcome === 'applied';
                  return (
                    <li
                      key={entry.id}
                      className="group flex items-start gap-2 border-b border-neutral-900 px-3 py-2 last:border-b-0 hover:bg-neutral-900/60"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${entry.read ? 'bg-transparent' : 'bg-indigo-400'}`}
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        title={openable ? t('Abrir el informe') : undefined}
                        onClick={() => onOpenEntry(entry)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`truncate text-xs ${entry.read ? 'text-neutral-400' : 'font-semibold text-neutral-100'}`}>
                            {entry.title || `${entry.table} · ${entry.key.map((part) => String(part)).join(', ')}`}
                          </span>
                          <OutcomeChip outcome={entry.outcome} />
                        </div>
                        {entry.entityKind === 'deep_research' && (
                          <p className="mt-0.5 text-[11px] text-indigo-300">{t('Informe de Deep Research')}</p>
                        )}
                        <p
                          className="mt-0.5 truncate text-[11px] text-neutral-500"
                          title={tx('Llegó el {when}', { when: new Date(entry.arrivedAt).toLocaleString() })}
                        >
                          {device ? `${tx('Desde {device}', { device })} · ` : ''}
                          {relativeTime(entry.arrivedAt)}
                        </p>
                        {entry.reason && <p className="mt-0.5 text-[11px] text-red-300">{entry.reason}</p>}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost shrink-0 px-1.5 py-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        title={t('Quitar de la bandeja')}
                        aria-label={t('Quitar de la bandeja')}
                        onClick={() => onClearOne(entry.id)}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between gap-2 border-t border-neutral-800 px-3 py-2">
                <button
                  className="btn btn-ghost px-2 py-1 text-xs"
                  disabled={unread === 0}
                  onClick={() => onMarkRead()}
                >
                  {t('Marcar todo como leído')}
                </button>
                <button className="btn btn-ghost px-2 py-1 text-xs text-red-300" onClick={onClearAll}>
                  {t('Vaciar la bandeja')}
                </button>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
