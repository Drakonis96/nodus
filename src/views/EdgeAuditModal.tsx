import { useCallback, useEffect, useState } from 'react';
import type { EdgeFeedbackView } from '@shared/types';
import { EDGE_LABELS, Badge, Icon } from '../components/ui';
import { t } from '../i18n';

/**
 * Audit ledger for relation verdicts. Every confirm/reject issued from the
 * edge detail panel lands here, so an accidental rejection is never invisible:
 * the list shows both groups and lets the user undo any verdict (the edge
 * returns to its derived state and, if rejected, reappears in the graph).
 */
export function EdgeAuditModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<EdgeFeedbackView[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await window.nodus.listEdgeFeedback());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const undo = async (row: EdgeFeedbackView) => {
    const key = `${row.from_id}|${row.to_id}|${row.type}`;
    setBusyKey(key);
    try {
      await window.nodus.setEdgeFeedback(row.from_id, row.to_id, row.type, null);
      await load();
      onChanged();
    } finally {
      setBusyKey(null);
    }
  };

  const rejected = (rows ?? []).filter((r) => r.verdict === 'rejected');
  const confirmed = (rows ?? []).filter((r) => r.verdict === 'confirmed');

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl max-h-[88vh] bg-neutral-950 border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <Icon name="check" className="text-emerald-300" />
            {t('Auditoría de relaciones')}
          </div>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose} title={t('Cerrar')}>
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
          {rows === null && <p className="text-neutral-500">{t('Cargando…')}</p>}
          {rows !== null && rows.length === 0 && (
            <p className="text-neutral-400">
              {t('Aún no has auditado ninguna relación. Abre una arista en el grafo y usa «Confirmar» o «Marcar como incorrecta».')}
            </p>
          )}
          {rejected.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs uppercase text-red-400">
                {t('Rechazadas (ocultas del grafo y de los análisis)')} · {rejected.length}
              </h3>
              {rejected.map((row) => (
                <AuditRow key={rowKey(row)} row={row} busy={busyKey === rowKey(row)} onUndo={() => void undo(row)} />
              ))}
            </section>
          )}
          {confirmed.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs uppercase text-emerald-400">
                {t('Confirmadas por ti')} · {confirmed.length}
              </h3>
              {confirmed.map((row) => (
                <AuditRow key={rowKey(row)} row={row} busy={busyKey === rowKey(row)} onUndo={() => void undo(row)} />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function rowKey(row: EdgeFeedbackView): string {
  return `${row.from_id}|${row.to_id}|${row.type}`;
}

function AuditRow({ row, busy, onUndo }: { row: EdgeFeedbackView; busy: boolean; onUndo: () => void }) {
  return (
    <div className="card mb-2 flex items-start gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="leading-snug">
          <span className="text-neutral-200">{row.from_label}</span>
          <span className="mx-1.5 text-neutral-500">→</span>
          <span className="text-neutral-200">{row.to_label}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
          <Badge color={row.verdict === 'rejected' ? 'red' : 'green'}>
            {t(EDGE_LABELS[row.type as keyof typeof EDGE_LABELS]) ?? row.type}
          </Badge>
          <span>{new Date(row.created_at).toLocaleString()}</span>
          {row.note && <span className="italic">“{row.note}”</span>}
        </div>
      </div>
      <button
        className="card shrink-0 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        disabled={busy}
        title={t('Quitar el veredicto y volver al estado derivado')}
        onClick={onUndo}
      >
        {t('Deshacer')}
      </button>
    </div>
  );
}
