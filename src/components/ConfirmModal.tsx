import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { t } from '../i18n';

/**
 * Small centred confirmation dialog. Closes on Escape or backdrop click; the
 * confirm button is autofocused so Enter confirms. Use `danger` for destructive
 * actions to tint the confirm button red. Passing `rememberLabel` + `onRemember`
 * adds a third "accept and don't ask again" button between cancel and confirm.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  rememberLabel,
  danger = false,
  zIndex = 120,
  onConfirm,
  onCancel,
  onRemember,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  rememberLabel?: string;
  danger?: boolean;
  zIndex?: number;
  onConfirm: () => void;
  onCancel: () => void;
  onRemember?: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-6" style={{ zIndex }} onClick={onCancel}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card w-full max-w-sm p-5"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold mb-2">{title}</h2>
        <div className="text-sm text-neutral-400 mb-5">{message}</div>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel ?? t('Cancelar')}
          </button>
          {rememberLabel && onRemember && (
            <button
              className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
              onClick={onRemember}
            >
              {rememberLabel}
            </button>
          )}
          <button
            className={`btn ${danger ? 'bg-red-600 hover:bg-red-500 text-white' : 'btn-primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel ?? t('Confirmar')}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
