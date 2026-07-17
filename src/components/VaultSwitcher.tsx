import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { VaultSummary, VaultType } from '@shared/types';
import { isPreviewVaultType, VAULT_TYPE_COLORS, VAULT_TYPES } from '@shared/vaultTypes';
import { t, tx } from '../i18n';
import { ConfirmModal } from './ConfirmModal';
import { Icon } from './ui';

interface VaultSwitcherProps {
  /** Trigger element the panel anchors under (centre badge or right-rail icon);
   *  null when the panel is closed. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  vaults: VaultSummary[];
  onVaultsChanged: () => Promise<unknown>;
  onActiveVaultChanged: () => Promise<unknown>;
}

type DestructiveKind = 'delete' | 'reset';
type DestructiveStep = 'intro' | 'code' | 'final';
type SortKey = 'recent' | 'created' | 'name';

interface PendingDestructiveAction {
  kind: DestructiveKind;
  vault: VaultSummary;
}

/** Vault types offered when creating a vault, each with its accent colour. */
const NEW_VAULT_TYPES: VaultType[] = VAULT_TYPES.filter((type) => type.available).map((type) => type.id);
/** Shown in the create grid but not yet selectable — flagged "Próximamente". */
const COMING_SOON_VAULT_TYPES: VaultType[] = VAULT_TYPES.filter((type) => !type.available).map((type) => type.id);
/** Product order in the three-column creation grid, read row by row. */
const CREATE_VAULT_TYPES: VaultType[] = [
  'academic', 'primary_sources', 'testimonios',
  'databases', 'docencia', 'estudio',
  'genealogy', 'worldbuilding',
];
const isComingSoonVaultType = (type: VaultType) => COMING_SOON_VAULT_TYPES.includes(type);
const VAULT_TYPE_COLOR = VAULT_TYPE_COLORS;

type VaultPhase = 'pre-alpha' | 'alpha' | 'beta';

function generateFourDigitCode(): string {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join('');
}

/** Human label for a vault type. Literal t() calls keep the strings extractable. */
export function vaultTypeLabel(type: VaultType): string {
  switch (type) {
    case 'estudio':
      return t('Estudio');
    case 'primary_sources':
      return t('Fuentes primarias');
    case 'genealogy':
      return t('Genealogía');
    case 'databases':
      return t('Bases de datos');
    case 'testimonios':
      return t('Testimonios');
    case 'worldbuilding':
      return t('Worldbuilding');
    case 'docencia':
      return t('Docencia');
    case 'academic':
    default:
      return t('Académico');
  }
}

/** A stable, recognisable glyph for each workspace mode. */
export function vaultTypeIcon(type: VaultType): string {
  switch (type) {
    case 'estudio': return 'graduation';
    case 'primary_sources': return 'archive';
    case 'genealogy': return 'tree';
    case 'databases': return 'table';
    case 'testimonios': return 'microphone';
    case 'worldbuilding': return 'globe';
    case 'docencia': return 'presentation';
    case 'academic':
    default: return 'network';
  }
}

function vaultTypePhase(type: VaultType): VaultPhase | null {
  if (type === 'estudio') return 'pre-alpha';
  if (type === 'genealogy') return 'alpha';
  if (type === 'databases') return 'beta';
  return null;
}

function vaultTypeDescription(type: VaultType): string {
  switch (type) {
    case 'academic': return t('Investigación, análisis y escritura.');
    case 'genealogy': return t('Historia familiar y archivos.');
    case 'estudio': return t('Aprendizaje y materiales de estudio.');
    case 'databases': return t('Tablas, datos y análisis.');
    case 'primary_sources': return t('Archivos y fuentes históricas.');
    case 'testimonios': return t('Entrevistas, historia oral y periodismo.');
    case 'worldbuilding': return t('Mundos, personajes y narrativas.');
    case 'docencia': return t('Cursos, evaluación y materiales.');
  }
}

export function VaultSwitcher({ anchorEl, onClose, vaults, onVaultsChanged, onActiveVaultChanged }: VaultSwitcherProps) {
  const open = anchorEl != null;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Fixed-position placement computed from the trigger's rect so the panel unfolds
  // directly under whichever trigger opened it (centre badge or right-rail icon).
  const [pos, setPos] = useState<{ left: number; top: number; width: number; originX: number } | null>(null);

  // Panel filters.
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<VaultType | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('recent');

  // Add-vault modal.
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addNameError, setAddNameError] = useState<string | null>(null);
  const [addType, setAddType] = useState<VaultType>('academic');
  const [addError, setAddError] = useState<string | null>(null);

  // Rename / duplicate modals.
  const [renameTarget, setRenameTarget] = useState<VaultSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dupTarget, setDupTarget] = useState<VaultSummary | null>(null);
  const [dupName, setDupName] = useState('');

  // Delete / reset (two-step confirmation + manual code).
  const [pendingAction, setPendingAction] = useState<PendingDestructiveAction | null>(null);
  const [destructiveStep, setDestructiveStep] = useState<DestructiveStep>('intro');
  const [destructiveCode, setDestructiveCode] = useState('');
  const [destructiveEntry, setDestructiveEntry] = useState('');
  const [destructiveError, setDestructiveError] = useState<string | null>(null);

  // Position the popover under its anchor, clamped to the viewport, and keep it
  // pinned on resize/scroll. `originX` points the unfold animation at the anchor.
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

  // Dismiss on outside click / Escape. Clicks on a trigger (`data-vault-trigger`)
  // or inside an open child modal (`[role="dialog"]`) are ignored so they can
  // toggle or interact without the panel yanking closed underneath them.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-vault-trigger],[role="dialog"]')) return;
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

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  // Filtered + sorted vault list for the panel.
  const shownVaults = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = vaults.filter(
      (v) => (typeFilter === 'all' || v.type === typeFilter) && (!q || v.name.toLowerCase().includes(q))
    );
    const byRecent = (a: VaultSummary, b: VaultSummary) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || '');
    const byCreated = (a: VaultSummary, b: VaultSummary) => (b.createdAt || '').localeCompare(a.createdAt || '');
    const byName = (a: VaultSummary, b: VaultSummary) => a.name.localeCompare(b.name);
    return [...filtered].sort(sortKey === 'created' ? byCreated : sortKey === 'name' ? byName : byRecent);
  }, [vaults, query, typeFilter, sortKey]);

  const openAddVault = () => {
    setAddNameError(null);
    setAddError(null);
    setAddOpen(true);
  };

  const loadVault = (vaultId: string) =>
    run(async () => {
      const result = await window.nodus.switchVault(vaultId);
      setMessage(result.message);
      if (result.ok) {
        await onActiveVaultChanged();
        onClose();
      } else {
        await onVaultsChanged();
      }
    });

  const createVault = async () => {
    if (busy) return;
    let createdVaultId: string | null = null;
    setAddError(null);
    setBusy(true);
    try {
      const name = addName.trim();
      if (!name) {
        setAddNameError(t('Escribe un nombre para la bóveda.'));
        return;
      }
      setAddNameError(null);
      // The vault is created bare: its AI and embedding models are chosen in the
      // setup wizard that opens right after, where Nodus can discover them from
      // the keys already stored instead of asking here.
      const created = await window.nodus.createVault({ name, type: addType });
      createdVaultId = created.vault.id;
      const result = await window.nodus.switchVault(created.vault.id);
      if (!result.ok) throw new Error(result.message);
      createdVaultId = null;
      setAddOpen(false);
      setAddName('');
      setAddType('academic');
      setMessage(result.message);
      await onActiveVaultChanged();
      onClose();
    } catch (error) {
      if (createdVaultId) {
        await window.nodus.deleteVault(createdVaultId, true).catch(() => undefined);
      }
      setAddError(error instanceof Error ? error.message : String(error));
      await onVaultsChanged();
    } finally {
      setBusy(false);
    }
  };

  const confirmRename = () =>
    run(async () => {
      if (!renameTarget) return;
      const name = renameValue.trim();
      if (!name) {
        setMessage(t('Escribe un nombre para la bóveda.'));
        return;
      }
      await window.nodus.renameVault(renameTarget.id, name);
      setRenameTarget(null);
      await onVaultsChanged();
      setMessage(t('Bóveda renombrada.'));
    });

  const confirmDuplicate = () =>
    run(async () => {
      if (!dupTarget) return;
      const name = dupName.trim();
      if (!name) {
        setMessage(t('Escribe un nombre para la bóveda.'));
        return;
      }
      await window.nodus.duplicateVault(dupTarget.id, name);
      setDupTarget(null);
      await onVaultsChanged();
      setMessage(t('Bóveda duplicada.'));
    });

  const startDestructiveAction = (kind: DestructiveKind, vault: VaultSummary) => {
    setPendingAction({ kind, vault });
    setDestructiveStep('intro');
    setDestructiveCode(generateFourDigitCode());
    setDestructiveEntry('');
    setDestructiveError(null);
  };
  const closeDestructiveAction = () => {
    setPendingAction(null);
    setDestructiveEntry('');
    setDestructiveError(null);
  };
  const confirmDestructiveCode = () => {
    if (destructiveEntry !== destructiveCode) {
      setDestructiveError(destructiveEntry.length === 4 ? t('Código incorrecto.') : t('Escribe las cuatro cifras para continuar.'));
      return;
    }
    setDestructiveError(null);
    setDestructiveStep('final');
  };
  const executeDestructiveAction = () => {
    if (!pendingAction) return;
    const action = pendingAction;
    closeDestructiveAction();
    void run(async () => {
      if (action.kind === 'delete') {
        await window.nodus.deleteVault(action.vault.id, true);
        await onVaultsChanged();
        setMessage(t('Bóveda eliminada.'));
        return;
      }
      await window.nodus.resetVault(action.vault.id);
      if (action.vault.active) {
        await onActiveVaultChanged();
        onClose();
      } else {
        await onVaultsChanged();
      }
      setMessage(t('Bóveda reinicializada.'));
    });
  };

  const deleteDisabledReason = (v: VaultSummary) =>
    v.active
      ? t('La bóveda activa no se puede eliminar. Carga otra bóveda antes.')
      : v.legacy
        ? t('La bóveda principal no se puede eliminar; puedes reinicializarla.')
        : null;

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={panelRef}
              key="vault-panel"
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
            >
          <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
            <div className="text-sm font-semibold text-neutral-200">{tx('Bóvedas ({n})', { n: vaults.length })}</div>
            <div className="flex items-center gap-1">
              <button className="btn btn-primary gap-1.5 px-2 py-1 text-xs" onClick={openAddVault} title={t('Añadir bóveda')}>
                <Icon name="plus" size={14} /> {t('Añadir')}
              </button>
              <button className="btn btn-ghost px-2 py-1" onClick={() => onClose()} title={t('Cerrar')}>
                <Icon name="x" />
              </button>
            </div>
          </div>

          {/* Search + type filter + sort */}
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
            <div className="relative min-w-0 flex-1">
              <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                className="input input-with-leading-icon h-8 w-full py-1 text-xs"
                placeholder={t('Buscar bóvedas…')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              className="input h-8 w-auto min-w-0 py-1 text-xs"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as VaultType | 'all')}
              title={t('Filtrar por tipo')}
            >
              <option value="all">{t('Todos los tipos')}</option>
              {NEW_VAULT_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {vaultTypeLabel(tp)}
                </option>
              ))}
            </select>
            <select
              className="input h-8 w-auto min-w-0 py-1 text-xs"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              title={t('Ordenar')}
            >
              <option value="recent">{t('Último uso')}</option>
              <option value="created">{t('Fecha de creación')}</option>
              <option value="name">{t('Nombre')}</option>
            </select>
          </div>

          <div className="max-h-[62vh] space-y-1.5 overflow-y-auto p-3">
            {shownVaults.length === 0 && <p className="px-1 py-2 text-xs text-neutral-500">{t('Sin coincidencias.')}</p>}
            {shownVaults.map((vault) => {
              const delReason = deleteDisabledReason(vault);
              return (
                <div key={vault.id} className="flex min-w-0 items-center gap-2 rounded-md border border-neutral-800 px-2 py-2">
                  <span data-testid={`vault-type-icon-${vault.type}`} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-white" style={{ backgroundColor: VAULT_TYPE_COLOR[vault.type] ?? '#6366f1' }}>
                    <Icon name={vaultTypeIcon(vault.type)} size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm text-neutral-200">{vault.name}</span>
                      {vault.active && <span className="shrink-0 rounded bg-indigo-600 px-1 py-0.5 text-[9px] font-semibold uppercase text-white">{t('Activa')}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <span className="truncate">{vaultTypeLabel(vault.type)}</span>
                      {vaultTypePhase(vault.type) && <VaultPhaseBadge phase={vaultTypePhase(vault.type)!} compact />}
                      {isPreviewVaultType(vault.type) && <PreviewBadge compact />}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconBtn
                      icon={vault.active ? 'check' : 'play'}
                      title={vault.active ? t('Bóveda activa') : t('Cargar')}
                      onClick={() => !vault.active && void loadVault(vault.id)}
                      disabled={busy || vault.active}
                    />
                    <IconBtn
                      icon="edit"
                      title={t('Renombrar')}
                      onClick={() => {
                        setRenameTarget(vault);
                        setRenameValue(vault.name);
                      }}
                      disabled={busy}
                    />
                    <IconBtn
                      icon="copy"
                      title={t('Duplicar')}
                      onClick={() => {
                        setDupTarget(vault);
                        setDupName(tx('{name} copia', { name: vault.name }));
                      }}
                      disabled={busy}
                    />
                    <IconBtn
                      icon="trash"
                      title={delReason ?? t('Eliminar')}
                      danger
                      onClick={() => startDestructiveAction('delete', vault)}
                      disabled={busy || Boolean(delReason)}
                    />
                  </div>
                </div>
              );
            })}

            {message && <div className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-300">{message}</div>}
          </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Add-vault modal */}
      {addOpen &&
        createPortal(
          <ModalShell title={t('Añadir bóveda')} onCancel={() => { if (!busy) setAddOpen(false); }} wide>
            <label className="block text-sm">
              {t('Nombre de la bóveda')}
              <input
                className="input mt-1 w-full"
                autoFocus
                aria-invalid={Boolean(addNameError)}
                aria-describedby={addNameError ? 'vault-name-error' : undefined}
                value={addName}
                onChange={(e) => { setAddName(e.target.value); if (addNameError) setAddNameError(null); }}
                placeholder={t('Nombre de la bóveda')}
              />
              {addNameError && <span id="vault-name-error" data-testid="vault-name-error" role="alert" className="mt-1 block text-xs text-red-400">{addNameError}</span>}
            </label>
            <div className="mt-3">
              <div className="mb-1.5 text-xs text-neutral-500">{t('Tipo de bóveda')}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CREATE_VAULT_TYPES.map((tp) => {
                  const soon = isComingSoonVaultType(tp);
                  return (
                    <button
                      key={tp}
                      type="button"
                      disabled={soon}
                      title={soon ? `${t('Próximamente')}: ${vaultTypeDescription(tp)}` : undefined}
                      className={`relative flex h-28 flex-col items-center justify-center gap-1.5 rounded-lg border p-3 text-center transition-colors ${
                        soon
                          ? 'cursor-not-allowed border-neutral-800/70 opacity-50'
                          : addType === tp
                            ? 'border-transparent ring-2'
                            : 'border-neutral-800 hover:border-neutral-600'
                      }`}
                      style={!soon && addType === tp ? { boxShadow: `inset 0 0 0 1px ${VAULT_TYPE_COLOR[tp]}`, ['--tw-ring-color' as string]: VAULT_TYPE_COLOR[tp] } : undefined}
                      onClick={() => !soon && setAddType(tp)}
                    >
                      {soon ? (
                        <span className="absolute right-1 top-1 rounded border border-neutral-600/60 bg-neutral-500/10 px-1 text-[9px] font-semibold uppercase text-neutral-400">
                          {t('Pronto')}
                        </span>
                      ) : isPreviewVaultType(tp) ? (
                        <PreviewBadge />
                      ) : (
                        vaultTypePhase(tp) && <VaultPhaseBadge phase={vaultTypePhase(tp)!} />
                      )}
                      <span data-testid={`new-vault-type-icon-${tp}`} className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ backgroundColor: VAULT_TYPE_COLOR[tp] }}>
                        <Icon name={vaultTypeIcon(tp)} size={18} />
                      </span>
                      <span className="text-xs font-medium text-neutral-200">{vaultTypeLabel(tp)}</span>
                      <span className="line-clamp-2 min-h-[2.5em] max-w-44 text-[10px] leading-tight text-neutral-500">{vaultTypeDescription(tp)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {vaultTypePhase(addType) && <VaultPhaseNotice phase={vaultTypePhase(addType)!} />}
            {isPreviewVaultType(addType) && <PreviewNotice />}
            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-neutral-500" data-testid="vault-models-next-step">
              <Icon name="info" size={14} className="mt-0.5 shrink-0" />
              <span>{t('Al crear la bóveda, el asistente te llevará a elegir su modelo de IA y su modelo de embeddings, con los modelos de tus proveedores ya cargados.')}</span>
            </p>
            {addError && <p role="alert" data-testid="vault-creation-error" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">{addError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setAddOpen(false)} disabled={busy}>
                {t('Cancelar')}
              </button>
              <button className="btn btn-primary gap-1.5" onClick={() => void createVault()} disabled={busy}>
                <Icon name={busy ? 'sync' : 'plus'} className={busy ? 'animate-spin' : ''} /> {busy ? t('Preparando…') : t('Crear')}
              </button>
            </div>
          </ModalShell>,
          document.body
        )}

      {/* Rename modal */}
      {renameTarget &&
        createPortal(
          <ModalShell title={t('Renombrar bóveda')} onCancel={() => setRenameTarget(null)}>
            <input
              className="input w-full"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmRename();
                if (e.key === 'Escape') setRenameTarget(null);
              }}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setRenameTarget(null)}>
                {t('Cancelar')}
              </button>
              <button className="btn btn-primary" onClick={() => void confirmRename()} disabled={busy}>
                {t('Renombrar')}
              </button>
            </div>
          </ModalShell>,
          document.body
        )}

      {/* Duplicate modal (with confirmation) */}
      {dupTarget &&
        createPortal(
          <ModalShell title={t('Duplicar bóveda')} onCancel={() => setDupTarget(null)}>
            <p className="mb-3 text-sm text-neutral-400">
              {tx('Se creará una copia de «{name}» con todos sus datos.', { name: dupTarget.name })}
            </p>
            <label className="block text-sm">
              {t('Nombre de la copia')}
              <input className="input mt-1 w-full" autoFocus value={dupName} onChange={(e) => setDupName(e.target.value)} />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setDupTarget(null)}>
                {t('Cancelar')}
              </button>
              <button className="btn btn-primary gap-1.5" onClick={() => void confirmDuplicate()} disabled={busy}>
                <Icon name="copy" /> {t('Duplicar')}
              </button>
            </div>
          </ModalShell>,
          document.body
        )}

      {renderDestructiveModal({
        pendingAction,
        step: destructiveStep,
        code: destructiveCode,
        entry: destructiveEntry,
        error: destructiveError,
        setEntry: setDestructiveEntry,
        setError: setDestructiveError,
        onCancel: closeDestructiveAction,
        onIntroConfirm: () => setDestructiveStep('code'),
        onCodeConfirm: confirmDestructiveCode,
        onFinalConfirm: executeDestructiveAction,
      })}
    </>
  );
}

function IconBtn({ icon, title, onClick, disabled, danger }: { icon: string; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      className={`rounded p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        danger
          ? 'text-neutral-500 hover:bg-red-100 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950/40 dark:hover:text-red-400'
          : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
      }`}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

function PreviewBadge({ compact = false }: { compact?: boolean }) {
  const description = t('Vista previa navegable. Puedes crear el vault y consultar sus secciones, pero todavía no contienen funciones.');
  return <span className={`${compact ? '' : 'absolute right-1 top-1'} shrink-0 rounded border border-violet-500/50 bg-violet-500/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-violet-300`} title={description} aria-label={`PREVIEW. ${description}`}>PREVIEW</span>;
}

function PreviewNotice() {
  return <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-700/50 bg-violet-500/10 px-3 py-2 text-xs text-violet-200" data-testid="vault-preview-notice"><Icon name="info" size={14} className="mt-0.5 shrink-0" /><span>{t('Este vault es una preview navegable: se creará normalmente, pero por ahora sus secciones son solo una muestra y no permiten realizar acciones.')}</span></div>;
}

/** A small centered modal shell used by the add / rename / duplicate dialogs. */
function VaultPhaseBadge({ phase, compact = false }: { phase: VaultPhase; compact?: boolean }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const label = phase === 'pre-alpha' ? 'PRE-ALPHA' : phase === 'alpha' ? 'ALPHA' : 'BETA';
  const summary = phase === 'pre-alpha'
    ? t('Desarrollo muy temprano; solo recomendable para testers.')
    : phase === 'alpha'
      ? t('Funciones principales aún en prueba; solo recomendable para testers.')
      : t('Funcional, pero aún necesita feedback y corrección de errores.');

  useLayoutEffect(() => {
    if (!tooltipOpen) {
      setTooltipPos(null);
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(272, window.innerWidth - 16);
      const height = tooltipRef.current?.offsetHeight ?? 124;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - height - 6);
      setTooltipPos({ left, top, width });
    };
    update();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [tooltipOpen]);

  return (
    <span
      ref={triggerRef}
      className={`${compact ? 'relative' : 'absolute right-1 top-1'} z-10 shrink-0`}
      tabIndex={compact ? 0 : undefined}
      aria-label={`${label}. ${summary}`}
      onMouseEnter={() => setTooltipOpen(true)}
      onMouseLeave={() => setTooltipOpen(false)}
      onFocus={() => setTooltipOpen(true)}
      onBlur={() => setTooltipOpen(false)}
    >
      <span className="block rounded border border-amber-600/50 bg-amber-500/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-400">{label}</span>
      {tooltipOpen && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          data-testid="vault-phase-tooltip"
          className="pointer-events-none fixed z-[90] rounded-lg border border-neutral-700 bg-neutral-950 p-2 text-left text-[10px] font-normal normal-case leading-snug tracking-normal text-neutral-300 opacity-100 shadow-xl"
          style={tooltipPos ? { left: tooltipPos.left, top: tooltipPos.top, width: tooltipPos.width } : { left: -9999, top: -9999, width: 272 }}
        >
          <strong className="text-neutral-100">{label}</strong> · {summary}<br />
          {t('La fase avanzará cuando haya suficiente feedback y pulido.')}<br />
          <span className="mt-1 flex items-center gap-1 text-amber-300"><Icon name="bug" size={11} />{t('Reporta los errores desde el botón superior.')}</span>
        </div>,
        document.body
      )}
    </span>
  );
}

function VaultPhaseNotice({ phase }: { phase: VaultPhase }) {
  const early = phase === 'pre-alpha' || phase === 'alpha';
  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-300" data-testid="vault-phase-notice">
      <Icon name={early ? 'alert' : 'bug'} size={14} className="mt-0.5 shrink-0" />
      <span>{early
        ? t('Versión experimental recomendada solo para testers. Guarda copias de seguridad y reporta cualquier error desde el botón superior.')
        : t('Versión beta: ayúdanos con sugerencias y reportando errores desde el botón superior.')}</span>
    </div>
  );
}

function ModalShell({ title, children, onCancel, wide = false }: { title: string; children: React.ReactNode; onCancel: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div className={`card-modal max-h-[90vh] w-full overflow-y-auto p-5 ${wide ? 'max-w-2xl' : 'max-w-md'}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function renderDestructiveModal({
  pendingAction,
  step,
  code,
  entry,
  error,
  setEntry,
  setError,
  onCancel,
  onIntroConfirm,
  onCodeConfirm,
  onFinalConfirm,
}: {
  pendingAction: PendingDestructiveAction | null;
  step: DestructiveStep;
  code: string;
  entry: string;
  error: string | null;
  setEntry: (value: string) => void;
  setError: (value: string | null) => void;
  onCancel: () => void;
  onIntroConfirm: () => void;
  onCodeConfirm: () => void;
  onFinalConfirm: () => void;
}) {
  if (!pendingAction) return null;

  const title = pendingAction.kind === 'delete' ? t('Eliminar bóveda') : t('Reinicializar bóveda');
  const introMessage =
    pendingAction.kind === 'delete'
      ? tx('Esta acción eliminará la bóveda "{name}" y sus archivos locales. No afecta a otras bóvedas.', { name: pendingAction.vault.name })
      : tx('Esta acción borrará el contenido de "{name}" y recreará su base de datos vacía. No afecta a otras bóvedas.', { name: pendingAction.vault.name });
  const finalLabel = pendingAction.kind === 'delete' ? t('Eliminar definitivamente') : t('Reinicializar definitivamente');

  if (step === 'intro') {
    return <ConfirmModal title={title} message={introMessage} confirmLabel={t('Continuar')} danger onConfirm={onIntroConfirm} onCancel={onCancel} />;
  }

  if (step === 'final') {
    return (
      <ConfirmModal
        title={t('Confirmación final')}
        message={t('Código correcto. Confirma una última vez para ejecutar la acción.')}
        confirmLabel={finalLabel}
        danger
        onConfirm={onFinalConfirm}
        onCancel={onCancel}
      />
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div className="card w-full max-w-sm p-5" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h2 className="mb-2 font-semibold">{t('Código de seguridad')}</h2>
        <p className="mb-4 text-sm text-neutral-400">{t('Introduce este código manualmente')}</p>
        <div className="mb-4 flex select-none justify-center gap-2 text-2xl font-semibold tracking-[0.25em] text-neutral-100" onCopy={(event) => event.preventDefault()}>
          {code.split('').map((digit, index) => (
            <span key={`${digit}-${index}`} className="rounded-md border border-neutral-700 px-3 py-2">
              {digit}
            </span>
          ))}
        </div>
        <input
          className="input w-full text-center text-lg tracking-[0.3em]"
          value={entry}
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={4}
          autoFocus
          onChange={(event) => {
            setEntry(event.target.value.replace(/\D/g, '').slice(0, 4));
            setError(null);
          }}
          onPaste={(event) => {
            event.preventDefault();
            setError(t('No se puede pegar aquí. Escribe las cuatro cifras manualmente.'));
          }}
          onDrop={(event) => {
            event.preventDefault();
            setError(t('No se puede pegar aquí. Escribe las cuatro cifras manualmente.'));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCodeConfirm();
            if (event.key === 'Escape') onCancel();
          }}
        />
        {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel}>
            {t('Cancelar')}
          </button>
          <button className="btn bg-red-600 text-white hover:bg-red-500" onClick={onCodeConfirm}>
            {t('Continuar')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
