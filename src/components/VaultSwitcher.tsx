import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { VaultSummary } from '@shared/types';
import { t, tx } from '../i18n';
import { ConfirmModal } from './ConfirmModal';
import { Icon, PROVIDER_LABELS } from './ui';

interface VaultSwitcherProps {
  vaults: VaultSummary[];
  activeVault: VaultSummary | null;
  onVaultsChanged: () => Promise<unknown>;
  onActiveVaultChanged: () => Promise<unknown>;
}

type DestructiveKind = 'delete' | 'reset';
type DestructiveStep = 'intro' | 'code' | 'final';

interface PendingDestructiveAction {
  kind: DestructiveKind;
  vault: VaultSummary;
}

function generateFourDigitCode(): string {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join('');
}

export function VaultSwitcher({
  vaults,
  activeVault,
  onVaultsChanged,
  onActiveVaultChanged,
}: VaultSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copyOnLoad, setCopyOnLoad] = useState(false);
  const [copySourceId, setCopySourceId] = useState('');
  const [newVaultName, setNewVaultName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [duplicateName, setDuplicateName] = useState('');
  const [copyIntoActiveSourceId, setCopyIntoActiveSourceId] = useState('');
  const [dangerVaultId, setDangerVaultId] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingDestructiveAction | null>(null);
  const [destructiveStep, setDestructiveStep] = useState<DestructiveStep>('intro');
  const [destructiveCode, setDestructiveCode] = useState('');
  const [destructiveEntry, setDestructiveEntry] = useState('');
  const [destructiveError, setDestructiveError] = useState<string | null>(null);

  const otherVaults = useMemo(
    () => vaults.filter((vault) => vault.id !== activeVault?.id),
    [activeVault?.id, vaults]
  );

  const dangerVault = useMemo(
    () => vaults.find((vault) => vault.id === dangerVaultId) ?? activeVault ?? vaults[0] ?? null,
    [activeVault, dangerVaultId, vaults]
  );

  const switchOptions = copyOnLoad && copySourceId ? { copyApiKeysFromVaultId: copySourceId } : undefined;

  useEffect(() => {
    if (!activeVault) return;
    setCopySourceId((current) => current || activeVault.id);
    setRenameValue(activeVault.name);
    setDuplicateName(`${activeVault.name} copia`);
  }, [activeVault?.id, activeVault?.name]);

  useEffect(() => {
    if (!activeVault && vaults[0]) setDangerVaultId(vaults[0].id);
    if (activeVault && (!dangerVaultId || !vaults.some((vault) => vault.id === dangerVaultId))) {
      setDangerVaultId(activeVault.id);
    }
  }, [activeVault, dangerVaultId, vaults]);

  useEffect(() => {
    if (!copyIntoActiveSourceId && otherVaults[0]) setCopyIntoActiveSourceId(otherVaults[0].id);
  }, [copyIntoActiveSourceId, otherVaults]);

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

  const loadVault = (vaultId: string) =>
    run(async () => {
      const result = await window.nodus.switchVault(vaultId, switchOptions);
      setMessage(result.message);
      if (result.ok) {
        await onActiveVaultChanged();
        setOpen(false);
      } else {
        await onVaultsChanged();
      }
    });

  const createAndLoad = () =>
    run(async () => {
      const name = newVaultName.trim();
      if (!name) {
        setMessage(t('Escribe un nombre para la bóveda.'));
        return;
      }
      const created = await window.nodus.createVault({ name });
      const result = await window.nodus.switchVault(created.vault.id, switchOptions);
      setMessage(result.message);
      setNewVaultName('');
      if (result.ok) {
        await onActiveVaultChanged();
        setOpen(false);
      } else {
        await onVaultsChanged();
      }
    });

  const renameActive = () =>
    run(async () => {
      if (!activeVault) return;
      const name = renameValue.trim();
      if (!name) {
        setMessage(t('Escribe un nombre para la bóveda.'));
        return;
      }
      await window.nodus.renameVault(activeVault.id, name);
      await onVaultsChanged();
      setMessage(t('Bóveda renombrada.'));
    });

  const duplicateActive = () =>
    run(async () => {
      if (!activeVault) return;
      const name = duplicateName.trim();
      if (!name) {
        setMessage(t('Escribe un nombre para la bóveda.'));
        return;
      }
      await window.nodus.duplicateVault(activeVault.id, name);
      await onVaultsChanged();
      setMessage(t('Bóveda duplicada con sus datos y claves API.'));
    });

  const copyKeysIntoActive = () =>
    run(async () => {
      if (!activeVault || !copyIntoActiveSourceId) return;
      const result = await window.nodus.copyVaultApiKeys(copyIntoActiveSourceId, activeVault.id);
      await onVaultsChanged();
      setMessage(
        result.copiedProviders.length
          ? t('Claves API cargadas en la bóveda activa.')
          : t('La bóveda seleccionada no tiene claves API guardadas.')
      );
    });

  const startDestructiveAction = (kind: DestructiveKind) => {
    if (!dangerVault) return;
    setPendingAction({ kind, vault: dangerVault });
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
      setDestructiveError(
        destructiveEntry.length === 4 ? t('Código incorrecto.') : t('Escribe las cuatro cifras para continuar.')
      );
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
        setOpen(false);
      } else {
        await onVaultsChanged();
      }
      setMessage(t('Bóveda reinicializada.'));
    });
  };

  const providerList = (vault: VaultSummary) =>
    vault.apiKeyProviders.length
      ? vault.apiKeyProviders.map((provider) => PROVIDER_LABELS[provider]).join(', ')
      : t('sin claves');

  const deleteDisabledReason =
    dangerVault?.active
      ? t('La bóveda activa no se puede eliminar. Carga otra bóveda antes.')
      : dangerVault?.legacy
        ? t('La bóveda principal no se puede eliminar; puedes reinicializarla.')
        : null;

  return (
    <div className="relative min-w-0">
      <button
        data-tour="vaults"
        className="btn btn-ghost min-w-0 max-w-[260px] gap-1.5"
        title={t('Bóveda activa')}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="archive" />
        <span className="min-w-0 truncate">{activeVault?.name ?? t('Bóveda')}</span>
        <Icon name="chevronDown" size={14} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl">
          <div className="max-h-[78vh] space-y-3 overflow-y-auto overflow-x-hidden p-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-neutral-200">{t('Bóvedas')}</div>
                <div className="truncate text-xs text-neutral-500">
                  {activeVault ? `${t('Activa')}: ${activeVault.name}` : t('Sin bóveda activa')}
                </div>
              </div>
              <button className="btn btn-ghost shrink-0 px-2 py-1" onClick={() => setOpen(false)} title={t('Cerrar')}>
                <Icon name="x" />
              </button>
            </div>

            <div className="space-y-2 rounded-md border border-neutral-800 p-2">
              <label className="flex min-w-0 items-center gap-2 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={copyOnLoad}
                  onChange={(event) => setCopyOnLoad(event.target.checked)}
                />
                <span className="min-w-0">{t('Al cargar, copiar claves API desde')}</span>
              </label>
              <select
                className="input w-full min-w-0 text-xs"
                value={copySourceId}
                onChange={(event) => setCopySourceId(event.target.value)}
                disabled={!copyOnLoad}
              >
                {vaults.map((vault) => (
                  <option key={vault.id} value={vault.id}>
                    {vault.name} · {providerList(vault)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              {vaults.map((vault) => (
                <div
                  key={vault.id}
                  className="flex min-w-0 items-center gap-2 rounded-md border border-neutral-800 px-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-neutral-200">{vault.name}</div>
                    <div className="truncate text-xs text-neutral-500">{providerList(vault)}</div>
                  </div>
                  {vault.active ? (
                    <span className="shrink-0 rounded-md bg-indigo-600 px-2 py-1 text-xs text-white">{t('Activa')}</span>
                  ) : (
                    <button
                      className="btn btn-primary shrink-0 py-1 text-xs"
                      onClick={() => void loadVault(vault.id)}
                      disabled={busy}
                    >
                      {t('Cargar')}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                className="input min-w-0 text-sm"
                value={newVaultName}
                onChange={(event) => setNewVaultName(event.target.value)}
                placeholder={t('Nueva bóveda')}
              />
              <button className="btn btn-primary w-full gap-1.5 sm:w-auto" onClick={() => void createAndLoad()} disabled={busy}>
                <Icon name="plus" /> {t('Crear')}
              </button>
            </div>

            {activeVault && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  className="input min-w-0 text-sm"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
                <button className="btn btn-ghost w-full gap-1.5 border border-neutral-700 sm:w-auto" onClick={() => void renameActive()} disabled={busy}>
                  <Icon name="edit" /> {t('Renombrar')}
                </button>
              </div>
            )}

            {activeVault && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  className="input min-w-0 text-sm"
                  value={duplicateName}
                  onChange={(event) => setDuplicateName(event.target.value)}
                />
                <button className="btn btn-ghost w-full gap-1.5 border border-neutral-700 sm:w-auto" onClick={() => void duplicateActive()} disabled={busy}>
                  <Icon name="copy" /> {t('Duplicar')}
                </button>
              </div>
            )}

            {activeVault && otherVaults.length > 0 && (
              <div className="space-y-2 rounded-md border border-neutral-800 p-2">
                <div className="text-xs font-medium text-neutral-300">{t('Traer claves a la bóveda activa')}</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    className="input min-w-0 text-sm"
                    value={copyIntoActiveSourceId}
                    onChange={(event) => setCopyIntoActiveSourceId(event.target.value)}
                  >
                    {otherVaults.map((vault) => (
                      <option key={vault.id} value={vault.id}>
                        {vault.name} · {providerList(vault)}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-ghost w-full gap-1.5 border border-neutral-700 sm:w-auto" onClick={() => void copyKeysIntoActive()} disabled={busy}>
                    <Icon name="key" /> {t('Cargar claves')}
                  </button>
                </div>
              </div>
            )}

            {dangerVault && (
              <div className="space-y-2 rounded-md border border-red-900/60 bg-red-950/20 p-2">
                <div className="text-xs font-medium text-red-300">{t('Zona peligrosa')}</div>
                <label className="block space-y-1">
                  <span className="text-xs text-neutral-500">{t('Vault objetivo')}</span>
                  <select
                    className="input w-full min-w-0 text-sm"
                    value={dangerVault.id}
                    onChange={(event) => setDangerVaultId(event.target.value)}
                  >
                    {vaults.map((vault) => (
                      <option key={vault.id} value={vault.id}>
                        {vault.active ? `${vault.name} · ${t('Activa')}` : vault.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    className="btn w-full gap-1.5 border border-red-800 text-red-300 hover:bg-red-950/50"
                    onClick={() => startDestructiveAction('reset')}
                    disabled={busy}
                  >
                    <Icon name="refresh" /> {t('Reinicializar')}
                  </button>
                  <button
                    className="btn w-full gap-1.5 border border-red-800 text-red-300 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => startDestructiveAction('delete')}
                    disabled={busy || Boolean(deleteDisabledReason)}
                    title={deleteDisabledReason ?? undefined}
                  >
                    <Icon name="trash" /> {t('Eliminar')}
                  </button>
                </div>
                {deleteDisabledReason && <p className="text-xs leading-5 text-neutral-500">{deleteDisabledReason}</p>}
              </div>
            )}

            {message && <div className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-300">{message}</div>}
          </div>
        </div>
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
      ? tx('Esta acción eliminará la bóveda "{name}" y sus archivos locales. No afecta a otras bóvedas.', {
          name: pendingAction.vault.name,
        })
      : tx('Esta acción borrará el contenido de "{name}" y recreará su base de datos vacía. No afecta a otras bóvedas.', {
          name: pendingAction.vault.name,
        });
  const finalLabel =
    pendingAction.kind === 'delete' ? t('Eliminar definitivamente') : t('Reinicializar definitivamente');

  if (step === 'intro') {
    return (
      <ConfirmModal
        title={title}
        message={introMessage}
        confirmLabel={t('Continuar')}
        danger
        onConfirm={onIntroConfirm}
        onCancel={onCancel}
      />
    );
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
      <div
        className="card w-full max-w-sm p-5"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-2 font-semibold">{t('Código de seguridad')}</h2>
        <p className="mb-4 text-sm text-neutral-400">{t('Introduce este código manualmente')}</p>
        <div
          className="mb-4 flex select-none justify-center gap-2 text-2xl font-semibold tracking-[0.25em] text-neutral-100"
          onCopy={(event) => event.preventDefault()}
        >
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
