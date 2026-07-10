import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { Icon } from './ui';
import { ConfirmModal } from './ConfirmModal';
import { t } from '../i18n';

/**
 * App-wide, imperative feedback: styled toasts and a promise-based confirm that
 * replace the native `window.alert` / `window.confirm` dialogs (which ignore the
 * theme, block the thread and break the visual language). Both are driven from a
 * tiny module-level store — mirroring the event pattern in `hooks.ts` — so any
 * module can call `toast(...)` or `await confirm(...)` without prop-drilling. A
 * single {@link FeedbackHost} mounted in `App` renders whatever is queued.
 */

export type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
}

interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let toasts: ToastItem[] = [];
let confirmReq: ConfirmRequest | null = null;
const listeners = new Set<() => void>();
let seq = 0;

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Show a transient toast. Defaults to a success tone that auto-dismisses. */
export function toast(message: string, opts?: { tone?: ToastTone; duration?: number }): void {
  const item: ToastItem = {
    id: ++seq,
    message,
    tone: opts?.tone ?? 'success',
    duration: opts?.duration ?? 4200,
  };
  toasts = [...toasts, item];
  emit();
}

function dismissToast(id: number): void {
  toasts = toasts.filter((toastItem) => toastItem.id !== id);
  emit();
}

/**
 * Styled replacement for `window.confirm`. Resolves `true` when confirmed and
 * `false` on cancel/Escape/backdrop, so callers keep their existing control flow:
 * `if (!(await confirm({ ... }))) return;`.
 */
export function confirm(opts: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    // Only one confirm is shown at a time; cancel any stale pending request.
    if (confirmReq) confirmReq.resolve(false);
    confirmReq = { ...opts, resolve };
    emit();
  });
}

function resolveConfirm(ok: boolean): void {
  const req = confirmReq;
  confirmReq = null;
  emit();
  req?.resolve(ok);
}

const TONE: Record<ToastTone, { icon: string; accent: string; iconClass: string }> = {
  success: { icon: 'check', accent: 'border-l-emerald-500', iconClass: 'text-emerald-400' },
  error: { icon: 'alert', accent: 'border-l-red-500', iconClass: 'text-red-400' },
  info: { icon: 'info', accent: 'border-l-indigo-500', iconClass: 'text-indigo-400' },
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.duration, onDismiss]);
  const tone = TONE[item.tone];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      className={`card pointer-events-auto flex items-start gap-2.5 border-l-2 ${tone.accent} px-3.5 py-2.5 shadow-lg max-w-sm`}
      role="status"
    >
      <Icon name={tone.icon} className={`mt-0.5 shrink-0 ${tone.iconClass}`} />
      <span className="min-w-0 flex-1 text-sm text-neutral-200">{item.message}</span>
      <button
        className="shrink-0 text-neutral-500 hover:text-neutral-300 transition-colors"
        onClick={() => onDismiss(item.id)}
        aria-label={t('Cerrar')}
      >
        <Icon name="x" size={14} />
      </button>
    </motion.div>
  );
}

export function FeedbackHost() {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);

  return (
    <>
      {createPortal(
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2 pointer-events-none">
          <AnimatePresence initial={false}>
            {toasts.map((item) => (
              <ToastCard key={item.id} item={item} onDismiss={dismissToast} />
            ))}
          </AnimatePresence>
        </div>,
        document.body
      )}
      {confirmReq && (
        <ConfirmModal
          title={confirmReq.title}
          message={confirmReq.message}
          confirmLabel={confirmReq.confirmLabel}
          cancelLabel={confirmReq.cancelLabel}
          danger={confirmReq.danger}
          onConfirm={() => resolveConfirm(true)}
          onCancel={() => resolveConfirm(false)}
        />
      )}
    </>
  );
}
