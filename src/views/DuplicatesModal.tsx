// Review-and-merge UI for duplicate works. Nothing is deleted without an explicit
// click: each group is merged only when the user confirms which copy to keep.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DuplicateWorkGroup } from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { notifyDataChanged } from '../hooks';
import { t, tx } from '../i18n';

export function DuplicatesModal({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<DuplicateWorkGroup[] | null>(null);
  const [canonical, setCanonical] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null); // group key being merged, or 'all'
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    const result = await window.nodus.listDuplicateWorks();
    setGroups(result);
    setCanonical((prev) => {
      const next = { ...prev };
      for (const group of result) {
        if (!next[group.key]) {
          next[group.key] = (group.members.find((m) => m.suggestedCanonical) ?? group.members[0]).nodus_id;
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const surplus = useMemo(
    () => (groups ?? []).reduce((sum, g) => sum + g.members.length - 1, 0),
    [groups]
  );

  const mergeGroup = useCallback(
    async (group: DuplicateWorkGroup) => {
      const canonicalId = canonical[group.key] ?? group.members[0].nodus_id;
      const duplicateIds = group.members.map((m) => m.nodus_id).filter((id) => id !== canonicalId);
      if (duplicateIds.length === 0) return;
      setBusy(group.key);
      try {
        await window.nodus.mergeWorks(canonicalId, duplicateIds);
        setGroups((prev) => (prev ? prev.filter((g) => g.key !== group.key) : prev));
        notifyDataChanged();
      } finally {
        setBusy(null);
      }
    },
    [canonical]
  );

  const mergeAll = useCallback(async () => {
    setConfirmAll(false);
    const pending = groups ?? [];
    if (pending.length === 0) return;
    setBusy('all');
    try {
      for (const group of pending) {
        const canonicalId = canonical[group.key] ?? group.members[0].nodus_id;
        const duplicateIds = group.members.map((m) => m.nodus_id).filter((id) => id !== canonicalId);
        if (duplicateIds.length > 0) await window.nodus.mergeWorks(canonicalId, duplicateIds);
      }
      setGroups([]);
      notifyDataChanged();
    } finally {
      setBusy(null);
    }
  }, [groups, canonical]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={t('Duplicados en la biblioteca')}
      onClick={() => !busy && onClose()}
    >
      <div
        className="card relative flex h-full w-full max-w-[900px] flex-col overflow-hidden border border-neutral-700 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
          <Icon name="copy" size={18} className="text-amber-300" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t('Duplicados en la biblioteca')}</h2>
            <p className="text-xs text-neutral-500">
              {groups == null
                ? t('Buscando duplicados…')
                : groups.length === 0
                  ? t('No se han encontrado duplicados.')
                  : tx('{g} grupo(s) · {n} obra(s) duplicadas a fusionar', { g: groups.length, n: surplus })}
            </p>
          </div>
          <div className="flex-1" />
          {groups && groups.length > 0 && (
            <button
              className="btn btn-ghost border border-neutral-700 gap-1.5 text-xs"
              onClick={() => setConfirmAll(true)}
              disabled={busy != null}
            >
              <Icon name="layers" size={13} /> {t('Fusionar todos')}
            </button>
          )}
          <button className="ml-1 text-neutral-400 hover:text-white" title={t('Cerrar')} onClick={onClose} disabled={busy != null}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {groups == null && (
            <div className="flex items-center justify-center py-12 text-sm text-neutral-500">
              <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-amber-400" />
              {t('Buscando duplicados…')}
            </div>
          )}

          {groups && groups.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-neutral-400">
              <Icon name="check" size={28} className="text-green-500" />
              <p>{t('No se han encontrado duplicados.')}</p>
              <p className="text-xs text-neutral-500">{t('La misma obra en varias colecciones de Zotero no se duplica.')}</p>
            </div>
          )}

          <div className="space-y-4">
            {(groups ?? []).map((group) => {
              const chosen = canonical[group.key] ?? group.members[0].nodus_id;
              return (
                <section key={group.key} className="rounded-lg border border-neutral-800 bg-neutral-900/40">
                  <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
                    <Badge color={group.reason === 'doi' ? 'green' : 'amber'}>
                      {group.reason === 'doi' ? t('Mismo DOI') : t('Mismos metadatos')}
                    </Badge>
                    <span className="text-xs text-neutral-500">{tx('{n} copias', { n: group.members.length })}</span>
                    <div className="flex-1" />
                    <button
                      className="btn btn-primary gap-1.5 text-xs"
                      onClick={() => void mergeGroup(group)}
                      disabled={busy != null}
                    >
                      {busy === group.key ? (
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      ) : (
                        <Icon name="layers" size={13} />
                      )}
                      {t('Fusionar')}
                    </button>
                  </div>
                  <div className="divide-y divide-neutral-800/70">
                    {group.members.map((m) => {
                      const isCanonical = m.nodus_id === chosen;
                      return (
                        <label
                          key={m.nodus_id}
                          className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 ${
                            isCanonical ? 'bg-indigo-950/20' : 'hover:bg-neutral-800/40'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`canonical-${group.key}`}
                            className="mt-1"
                            checked={isCanonical}
                            disabled={busy != null}
                            onChange={() => setCanonical((prev) => ({ ...prev, [group.key]: m.nodus_id }))}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{m.title || t('(sin título)')}</span>
                              {isCanonical && <Badge color="indigo">{t('Se conserva')}</Badge>}
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-400">
                              {m.authors[0] ?? t('Autor desconocido')}
                              {m.authors.length > 1 ? ' et al.' : ''}
                              {m.year ? ` · ${m.year}` : ''}
                              {m.doi ? ` · doi:${m.doi}` : ''}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                              <span className="font-mono">{m.zotero_key ?? '—'}</span>
                              {m.deep_status === 'done' && <Badge color="indigo">{t('profundo')} ✓</Badge>}
                              {m.light_status === 'done' && <Badge color="green">{t('ligero')} ✓</Badge>}
                              <span>{tx('{n} idea(s)', { n: m.ideaCount })}</span>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>

      {confirmAll && (
        <ConfirmModal
          title={t('Fusionar todos los duplicados')}
          message={tx(
            'Se fusionarán {g} grupo(s), conservando en cada uno la copia marcada y reasignando sus ideas, evidencia y etiquetas. Las {n} copias sobrantes se eliminarán de la biblioteca de Nodus (Zotero no se modifica). ¿Continuar?',
            { g: (groups ?? []).length, n: surplus }
          )}
          confirmLabel={t('Fusionar todos')}
          danger
          onConfirm={() => void mergeAll()}
          onCancel={() => setConfirmAll(false)}
        />
      )}
    </div>
  );
}
