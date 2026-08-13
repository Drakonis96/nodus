import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { ServerInboxEntry } from '@shared/types';
import { t, tx } from '../i18n';
import { groupServerInboxEntries, type ServerInboxGroup } from '../serverInboxGrouping';
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
  onClearOne: (id: string) => void | Promise<void>;
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
 *
 * Coloured light-first with `dark:` overrides, the same way Settings writes its status
 * chips. Dark-first utilities plus the `.light` remaps left these pale-on-pale and barely
 * legible in the light theme — checked on screen, not assumed.
 */
function OutcomeChip({ outcome }: { outcome: ServerInboxEntry['outcome'] }) {
  let label: string;
  let tone: string;
  if (outcome === 'applied') {
    label = t('Aplicado');
    tone = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
  } else if (outcome === 'deleted') {
    label = t('Eliminado');
    tone = 'bg-neutral-200 text-neutral-600 dark:bg-neutral-500/15 dark:text-neutral-300';
  } else if (outcome === 'kept_local') {
    label = t('Se conservó tu versión');
    tone = 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
  } else {
    label = t('Rechazado');
    tone = 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300';
  }
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>{label}</span>
  );
}

function InboxEntryRow({
  entry,
  nested = false,
  onOpenEntry,
  onClearOne,
}: {
  entry: ServerInboxEntry;
  nested?: boolean;
  onOpenEntry: (entry: ServerInboxEntry) => void;
  onClearOne: (id: string) => void | Promise<void>;
}) {
  const device = shortDevice(entry.clientId);
  const openable = entry.entityKind === 'deep_research' && entry.outcome === 'applied';
  return (
    <li
      data-testid="server-inbox-entry"
      className={`group/entry flex items-start gap-2 border-b border-neutral-900 px-3 py-2 last:border-b-0 hover:bg-neutral-900/60 ${nested ? 'bg-neutral-950/55 pl-7' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${entry.read ? 'bg-transparent' : 'bg-indigo-600 dark:bg-indigo-400'}`}
      />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        title={openable ? t('Abrir el informe') : undefined}
        onClick={() => onOpenEntry(entry)}
      >
        <div className="flex items-start gap-1.5">
          <span className={`line-clamp-2 min-w-0 flex-1 text-xs ${entry.read ? 'text-neutral-400' : 'font-semibold text-neutral-100'}`}>
            {entry.title || `${entry.table} · ${entry.key.map((part) => String(part)).join(', ')}`}
          </span>
          <OutcomeChip outcome={entry.outcome} />
        </div>
        {entry.entityKind === 'deep_research' && (
          <p className="mt-0.5 text-[11px] text-indigo-600 dark:text-indigo-300">{t('Informe de Deep Research')}</p>
        )}
        <p
          className="mt-0.5 truncate text-[11px] text-neutral-500"
          title={tx('Llegó el {when}', { when: new Date(entry.arrivedAt).toLocaleString() })}
        >
          {device ? `${tx('Desde {device}', { device })} · ` : ''}
          {relativeTime(entry.arrivedAt)}
        </p>
        {entry.reason && <p className="mt-0.5 text-[11px] text-red-700 dark:text-red-300">{entry.reason}</p>}
      </button>
      <button
        type="button"
        className="btn btn-ghost shrink-0 px-1.5 py-0.5 opacity-0 transition-opacity group-hover/entry:opacity-100 focus-visible:opacity-100"
        title={t('Quitar de la bandeja')}
        aria-label={t('Quitar de la bandeja')}
        onClick={() => void onClearOne(entry.id)}
      >
        <Icon name="x" size={13} />
      </button>
    </li>
  );
}

function InboxParentGroup({
  group,
  expanded,
  onToggle,
  onOpenEntry,
  onClearOne,
}: {
  group: ServerInboxGroup;
  expanded: boolean;
  onToggle: () => void;
  onOpenEntry: (entry: ServerInboxEntry) => void;
  onClearOne: (id: string) => void | Promise<void>;
}) {
  const latest = group.entries[0];
  const device = shortDevice(latest?.clientId ?? null);
  const fallbackTitle = group.parentKind === 'deep_research' ? t('Informe de Deep Research') : t('Documento');
  const label = group.entries.length === 1
    ? t('1 cambio')
    : tx('{n} cambios', { n: String(group.entries.length) });
  const clearGroup = async () => {
    // Sequential IPC keeps every returned list newer than the previous one. Parallel
    // dismissals can finish out of order and briefly resurrect an already-cleared child.
    for (const entry of group.entries) await onClearOne(entry.id);
  };
  return (
    <li data-testid="server-inbox-group" className="border-b border-neutral-900 last:border-b-0">
      <div className="group/header flex items-start gap-2 px-3 py-2.5 hover:bg-neutral-900/60">
        <span
          aria-hidden="true"
          className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${group.unreadCount > 0 ? 'bg-indigo-600 dark:bg-indigo-400' : 'bg-transparent'}`}
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-indigo-500/10 text-indigo-300">
            <Icon name={group.parentKind === 'deep_research' ? 'telescope' : 'book'} size={13} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-xs ${group.unreadCount > 0 ? 'font-semibold text-neutral-100' : 'text-neutral-300'}`}>
              {group.title || fallbackTitle}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-neutral-500">
              {label}{device ? ` · ${tx('Desde {device}', { device })}` : ''} · {relativeTime(group.arrivedAt)}
            </span>
          </span>
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-neutral-300">
            {group.unreadCount > 0 && <span className="text-indigo-300">{group.unreadCount}</span>}
            <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={11} />
          </span>
        </button>
        <button
          type="button"
          className="btn btn-ghost shrink-0 px-1.5 py-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 focus-visible:opacity-100"
          title={t('Quitar de la bandeja')}
          aria-label={t('Quitar de la bandeja')}
          onClick={() => void clearGroup()}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
      {expanded && (
        <ul data-testid="server-inbox-group-details" className="border-t border-neutral-900/80">
          {group.entries.map((entry) => (
            <InboxEntryRow
              key={entry.id}
              entry={entry}
              nested
              onOpenEntry={onOpenEntry}
              onClearOne={onClearOne}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ServerInbox({ anchorEl, onClose, entries, onMarkRead, onClearOne, onClearAll, onOpenEntry }: ServerInboxProps) {
  const open = anchorEl != null;
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; originX: number } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => groupServerInboxEntries(entries), [entries]);

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

  useEffect(() => {
    if (!open) setExpandedGroups(new Set());
  }, [open]);

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
                {groups.map((group) => {
                  const hasChildMetadata = group.entries.some((entry) => entry.parentEntityId != null);
                  const grouped = group.entries.length > 1 || hasChildMetadata;
                  if (!grouped) {
                    const entry = group.entries[0];
                    return entry ? (
                      <InboxEntryRow key={entry.id} entry={entry} onOpenEntry={onOpenEntry} onClearOne={onClearOne} />
                    ) : null;
                  }
                  return (
                    <InboxParentGroup
                      key={group.id}
                      group={group}
                      expanded={expandedGroups.has(group.id)}
                      onToggle={() => setExpandedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                        return next;
                      })}
                      onOpenEntry={onOpenEntry}
                      onClearOne={onClearOne}
                    />
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
                <button className="btn btn-ghost px-2 py-1 text-xs text-red-700 dark:text-red-300" onClick={onClearAll}>
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
