import { useEffect, useMemo, useState } from 'react';
import type { VaultSummary } from '@shared/types';
import { t } from '../i18n';
import { Icon, PROVIDER_LABELS } from './ui';

interface VaultSwitcherProps {
  vaults: VaultSummary[];
  activeVault: VaultSummary | null;
  onVaultsChanged: () => Promise<unknown>;
  onActiveVaultChanged: () => Promise<unknown>;
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

  useEffect(() => {
    if (!activeVault) return;
    setCopySourceId(activeVault.id);
    setRenameValue(activeVault.name);
    setDuplicateName(`${activeVault.name} copia`);
  }, [activeVault?.id, activeVault?.name]);

  const otherVaults = useMemo(
    () => vaults.filter((vault) => vault.id !== activeVault?.id),
    [activeVault?.id, vaults]
  );

  useEffect(() => {
    if (!copyIntoActiveSourceId && otherVaults[0]) setCopyIntoActiveSourceId(otherVaults[0].id);
  }, [copyIntoActiveSourceId, otherVaults]);

  const copyOptions = copyOnLoad && copySourceId ? { copyApiKeysFromVaultId: copySourceId } : undefined;

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
      const result = await window.nodus.switchVault(vaultId, copyOptions);
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
      const result = await window.nodus.switchVault(created.vault.id, copyOptions);
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

  const providerList = (vault: VaultSummary) =>
    vault.apiKeyProviders.length
      ? vault.apiKeyProviders.map((provider) => PROVIDER_LABELS[provider]).join(', ')
      : t('sin claves');

  return (
    <div className="relative">
      <button
        className="btn btn-ghost gap-1.5 max-w-[260px]"
        title={t('Bóveda activa')}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="archive" />
        <span className="truncate">{activeVault?.name ?? t('Bóveda')}</span>
        <Icon name="chevronDown" size={14} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl">
          <div className="max-h-[78vh] overflow-y-auto p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-neutral-200">{t('Bóvedas')}</div>
                <div className="text-xs text-neutral-500">
                  {activeVault ? `${t('Activa')}: ${activeVault.name}` : t('Sin bóveda activa')}
                </div>
              </div>
              <button className="btn btn-ghost px-2 py-1" onClick={() => setOpen(false)} title={t('Cerrar')}>
                <Icon name="x" />
              </button>
            </div>

            <div className="rounded-md border border-neutral-800 p-2 space-y-2">
              <label className="flex items-center gap-2 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={copyOnLoad}
                  onChange={(event) => setCopyOnLoad(event.target.checked)}
                />
                {t('Al cargar, copiar claves API desde')}
              </label>
              <select
                className="input w-full text-xs"
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
                  className="flex items-center gap-2 rounded-md border border-neutral-800 px-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-neutral-200">{vault.name}</div>
                    <div className="truncate text-xs text-neutral-500">{providerList(vault)}</div>
                  </div>
                  {vault.active ? (
                    <span className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white">{t('Activa')}</span>
                  ) : (
                    <button className="btn btn-primary py-1 text-xs" onClick={() => void loadVault(vault.id)} disabled={busy}>
                      {t('Cargar')}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className="input text-sm"
                value={newVaultName}
                onChange={(event) => setNewVaultName(event.target.value)}
                placeholder={t('Nueva bóveda')}
              />
              <button className="btn btn-primary gap-1.5" onClick={() => void createAndLoad()} disabled={busy}>
                <Icon name="plus" /> {t('Crear')}
              </button>
            </div>

            {activeVault && (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  className="input text-sm"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
                <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => void renameActive()} disabled={busy}>
                  <Icon name="edit" /> {t('Renombrar')}
                </button>
              </div>
            )}

            {activeVault && (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  className="input text-sm"
                  value={duplicateName}
                  onChange={(event) => setDuplicateName(event.target.value)}
                />
                <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => void duplicateActive()} disabled={busy}>
                  <Icon name="copy" /> {t('Duplicar')}
                </button>
              </div>
            )}

            {activeVault && otherVaults.length > 0 && (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  className="input text-sm"
                  value={copyIntoActiveSourceId}
                  onChange={(event) => setCopyIntoActiveSourceId(event.target.value)}
                >
                  {otherVaults.map((vault) => (
                    <option key={vault.id} value={vault.id}>
                      {vault.name} · {providerList(vault)}
                    </option>
                  ))}
                </select>
                <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={() => void copyKeysIntoActive()} disabled={busy}>
                  <Icon name="key" /> {t('Cargar claves')}
                </button>
              </div>
            )}

            {message && <div className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-300">{message}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

