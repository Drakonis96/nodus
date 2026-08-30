import { useEffect, useState } from 'react';
import type { BrowserConnectorPairingPrompt } from '@shared/browserConnector';
import { t } from '../i18n';
import { ConfirmModal } from './ConfirmModal';
import { Icon } from './ui';

/** Hosts the renderer-native replacement for Electron's browser-pairing message box. */
export function BrowserConnectorPairingRequestHost() {
  const [request, setRequest] = useState<BrowserConnectorPairingPrompt | null>(null);

  useEffect(() => window.nodus.onBrowserConnectorPairingRequest(setRequest), []);

  if (!request) return null;
  const settle = (allow: boolean) => {
    const requestId = request.requestId;
    setRequest(null);
    void window.nodus.resolveBrowserConnectorPairingRequest(requestId, allow);
  };

  return (
    <ConfirmModal
      title={t('Conectar Nodus Research Connector')}
      message={(
        <div className="space-y-3 text-left" data-testid="browser-connector-pairing-modal">
          <p className="text-sm leading-5 text-neutral-700 dark:text-neutral-300">
            {t('¿Quieres permitir que esta extensión envíe páginas a Nodus?')}
          </p>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950/60">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('Origen')}</p>
            <code className="mt-1 block break-all text-xs text-neutral-700 dark:text-neutral-300">{request.origin}</code>
          </div>
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5 ${request.official ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-300' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-300'}`}>
            <Icon name={request.official ? 'check' : 'alert'} className="mt-0.5 shrink-0" />
            <span>{t(request.official
              ? 'Extensión oficial de Nodus Research desde Chrome Web Store.'
              : 'Extensión de desarrollo (descomprimida) u otra instalación local.')}</span>
          </div>
        </div>
      )}
      confirmLabel={t('Permitir')}
      cancelLabel={t('Cancelar')}
      autoFocusConfirm={false}
      zIndex={230}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
}
