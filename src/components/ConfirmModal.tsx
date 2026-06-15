import { useEffect } from 'react';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Small centred confirmation dialog. Closes on Escape or backdrop click; the
 * confirm button is autofocused so Enter confirms. Use `danger` for destructive
 * actions to tint the confirm button red.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-6" onClick={onCancel}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card w-full max-w-sm p-5"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold mb-2">{title}</h2>
        <div className="text-sm text-neutral-400 mb-5">{message}</div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? 'bg-red-600 hover:bg-red-500 text-white' : 'btn-primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
