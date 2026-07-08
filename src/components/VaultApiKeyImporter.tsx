import { useEffect, useMemo, useState } from 'react';
import type { VaultSummary } from '@shared/types';
import { t } from '../i18n';
import { Icon, PROVIDER_LABELS } from './ui';

interface VaultApiKeyImporterProps {
  vaults: VaultSummary[];
  activeVault: VaultSummary | null;
  onImported?: () => Promise<unknown> | unknown;
  className?: string;
}

function providerList(vault: VaultSummary): string {
  return vault.apiKeyProviders.length
    ? vault.apiKeyProviders.map((provider) => PROVIDER_LABELS[provider]).join(', ')
    : t('sin claves');
}

export function VaultApiKeyImporter({
  vaults,
  activeVault,
  onImported,
  className = '',
}: VaultApiKeyImporterProps) {
  const [sourceVaultId, setSourceVaultId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sourceVaults = useMemo(
    () => vaults.filter((vault) => vault.id !== activeVault?.id && vault.apiKeyProviders.length > 0),
    [activeVault?.id, vaults]
  );

  useEffect(() => {
    if (sourceVaults.length === 0) {
      setSourceVaultId('');
      return;
    }
    if (!sourceVaultId || !sourceVaults.some((vault) => vault.id === sourceVaultId)) {
      setSourceVaultId(sourceVaults[0].id);
    }
  }, [sourceVaultId, sourceVaults]);

  if (!activeVault || sourceVaults.length === 0) return null;

  const importKeys = async () => {
    if (!sourceVaultId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.nodus.copyVaultApiKeys(sourceVaultId, activeVault.id);
      await onImported?.();
      setMessage(
        result.copiedProviders.length
          ? t('Claves API cargadas en la bóveda activa.')
          : t('La bóveda seleccionada no tiene claves API guardadas.')
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 ${className}`}>
      <div className="mb-2 flex items-start gap-2">
        <Icon name="key" className="mt-0.5 text-neutral-500" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-neutral-200">{t('¿Deseas cargar claves API desde otra bóveda?')}</div>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {t('Elige una bóveda previa para traer sus claves cifradas a la bóveda activa.')}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <select
          className="input min-w-0 text-sm"
          value={sourceVaultId}
          onChange={(event) => setSourceVaultId(event.target.value)}
        >
          {sourceVaults.map((vault) => (
            <option key={vault.id} value={vault.id}>
              {vault.name} · {providerList(vault)}
            </option>
          ))}
        </select>
        <button
          className="btn btn-ghost w-full gap-1.5 border border-neutral-700 sm:w-auto"
          onClick={() => void importKeys()}
          disabled={busy || !sourceVaultId}
        >
          <Icon name={busy ? 'sync' : 'key'} className={busy ? 'animate-spin' : ''} />{' '}
          {busy ? t('Cargando…') : t('Cargar claves')}
        </button>
      </div>
      {message && <div className="mt-2 text-xs text-neutral-400">{message}</div>}
    </div>
  );
}
