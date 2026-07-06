// Review-and-merge UI for duplicate ideas (Phase 1: identical label + type).
// Nothing is merged without an explicit click, and a full-database backup is
// taken automatically before the first merge of the session, so the whole
// operation can be undone by restoring one file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DuplicateIdeaGroup } from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { notifyDataChanged } from '../hooks';
import { t, tx } from '../i18n';

export function IdeaDuplicatesModal({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<DuplicateIdeaGroup[] | null>(null);
  const [canonical, setCanonical] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null); // group key being merged, or 'all'
  const [confirmAll, setConfirmAll] = useState(false);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backupPending = useRef(false);

  const load = useCallback(async () => {
    const result = await window.nodus.listDuplicateIdeas();
    setGroups(result);
    setCanonical((prev) => {
      const next = { ...prev };
      for (const group of result) {
        if (!next[group.key]) {
          next[group.key] = (group.members.find((m) => m.suggestedCanonical) ?? group.members[0]).global_id;
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

  // Snapshot the database once, before the first merge of the session.
  const ensureBackup = useCallback(async () => {
    if (backupPath || backupPending.current) return;
    backupPending.current = true;
    const path = await window.nodus.backupDatabase();
    setBackupPath(path);
  }, [backupPath]);

  const mergeGroup = useCallback(
    async (group: DuplicateIdeaGroup) => {
      const canonicalId = canonical[group.key] ?? group.members[0].global_id;
      const duplicateIds = group.members.map((m) => m.global_id).filter((id) => id !== canonicalId);
      if (duplicateIds.length === 0) return;
      setBusy(group.key);
      setError(null);
      try {
        await ensureBackup();
        await window.nodus.mergeIdeas(canonicalId, duplicateIds);
        setGroups((prev) => (prev ? prev.filter((g) => g.key !== group.key) : prev));
        notifyDataChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [canonical, ensureBackup]
  );

  const mergeAll = useCallback(async () => {
    setConfirmAll(false);
    const pending = groups ?? [];
    if (pending.length === 0) return;
    setBusy('all');
    setError(null);
    try {
      await ensureBackup();
      for (const group of pending) {
        const canonicalId = canonical[group.key] ?? group.members[0].global_id;
        const duplicateIds = group.members.map((m) => m.global_id).filter((id) => id !== canonicalId);
        if (duplicateIds.length > 0) await window.nodus.mergeIdeas(canonicalId, duplicateIds);
      }
      setGroups([]);
      notifyDataChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [groups, canonical, ensureBackup]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={t('Ideas duplicadas')}
      onClick={() => !busy && onClose()}
    >
      <div
        className="card relative flex h-full w-full max-w-[900px] flex-col overflow-hidden border border-neutral-700 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
          <Icon name="copy" size={18} className="text-amber-300" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t('Ideas duplicadas')}</h2>
            <p className="text-xs text-neutral-500">
              {groups == null
                ? t('Buscando ideas duplicadas…')
                : groups.length === 0
                  ? t('No se han encontrado ideas duplicadas.')
                  : tx('{g} grupo(s) · {n} idea(s) duplicadas a fusionar', { g: groups.length, n: surplus })}
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

        {backupPath && (
          <div className="flex items-start gap-2 border-b border-emerald-900/50 bg-emerald-950/30 px-4 py-2 text-xs text-emerald-300">
            <Icon name="save" size={13} className="mt-0.5" />
            <span className="min-w-0 break-all">
              {t('Copia de seguridad creada antes de fusionar:')} <span className="font-mono">{backupPath}</span>
            </span>
          </div>
        )}
        {error && (
          <div className="border-b border-red-900/60 bg-red-950/40 px-4 py-2 text-xs text-red-300">{error}</div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {groups == null && (
            <div className="flex items-center justify-center py-12 text-sm text-neutral-500">
              <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-amber-400" />
              {t('Buscando ideas duplicadas…')}
            </div>
          )}

          {groups && groups.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-neutral-400">
              <Icon name="check" size={28} className="text-green-500" />
              <p>{t('No se han encontrado ideas duplicadas.')}</p>
              <p className="text-xs text-neutral-500">
                {t('Solo se agrupan ideas con la misma etiqueta y el mismo tipo. La evidencia se conserva íntegra al fusionar.')}
              </p>
            </div>
          )}

          <div className="space-y-4">
            {(groups ?? []).map((group) => {
              const chosen = canonical[group.key] ?? group.members[0].global_id;
              return (
                <section key={group.key} className="rounded-lg border border-neutral-800 bg-neutral-900/40">
                  <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
                    <Badge color="amber">{t('Misma etiqueta')}</Badge>
                    <span className="truncate text-xs font-medium text-neutral-300">{group.members[0].label}</span>
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
                      const isCanonical = m.global_id === chosen;
                      return (
                        <label
                          key={m.global_id}
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
                            onChange={() => setCanonical((prev) => ({ ...prev, [group.key]: m.global_id }))}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge color="neutral">{m.type}</Badge>
                              <span className="text-sm font-medium">{m.label}</span>
                              {isCanonical && <Badge color="indigo">{t('Se conserva')}</Badge>}
                            </div>
                            {m.statement && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-400">{m.statement}</p>}
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                              <span>{tx('{n} evidencia(s)', { n: m.evidenceCount })}</span>
                              <span>·</span>
                              <span>{tx('{n} obra(s)', { n: m.workCount })}</span>
                              <span>·</span>
                              <span>{tx('{n} conexión(es)', { n: m.edgeCount })}</span>
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
          title={t('Fusionar todas las ideas duplicadas')}
          message={tx(
            'Se hará primero una copia de seguridad completa de la base de datos. Después se fusionarán {g} grupo(s), conservando en cada uno la idea marcada y reasignándole toda la evidencia, ocurrencias, temas y conexiones del grafo de las {n} copias sobrantes, que se eliminarán. La evidencia no se pierde. ¿Continuar?',
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
