import type { ReplicaConnectionView } from '@shared/types';
import { t } from '../i18n';

/**
 * The state of every vault this machine replicates from a Nodus Server.
 *
 * Its own component rather than eighty lines inside a three-thousand-line Settings view,
 * for one concrete reason: this is the screen a user sees when a server has revoked their
 * access, and it is the only place that says the data is still theirs. It has to be
 * renderable on its own so a test can actually run it — see
 * scripts/test-connected-vaults-panel.mjs, which renders every state this can be in.
 */
export interface ConnectedVaultsPanelProps {
  replicas: ReplicaConnectionView[];
  /** The vault whose button is mid-request, if any. */
  busyVaultId: string | null;
  onSync: (vaultId: string) => void;
  onDetach: (vaultId: string, vaultName: string) => void;
}

export function ConnectedVaultsPanel({ replicas, busyVaultId, onSync, onDetach }: ConnectedVaultsPanelProps) {
  if (replicas.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="connected-vault-panel">
                <div>
                  <h3 className="text-sm font-medium">{t('Bóvedas conectadas a un servidor')}</h3>
                  <p className="mt-1 text-xs text-neutral-500">{t('Réplicas de espacios de Nodus Server. Se actualizan solas; lo que puedas hacer en cada una depende del nivel que te haya dado quien administra el servidor.')}</p>
                </div>
                {replicas.map((replica) => (
                  <div key={replica.vaultId} data-testid={`replica-${replica.vaultId}`} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${replica.state === 'revoked' ? 'bg-red-500' : replica.state === 'paused' ? 'bg-neutral-400' : replica.phase === 'ok' ? 'bg-emerald-500' : replica.phase === 'error' ? 'bg-red-500' : replica.phase === 'syncing' ? 'bg-indigo-500' : 'bg-neutral-400'}`} />
                          <h4 className="text-sm font-medium">{replica.vaultName}</h4>
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                            {replica.role === 'reader' ? t('Solo lectura') : replica.role === 'writer' ? t('Escritura') : t('Propietario')}
                          </span>
                          {replica.isActiveVault && (
                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">{t('Vault actual')}</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-neutral-500">{replica.spaceName} · {replica.serverName}</p>
                        <p className="mt-0.5 break-all text-xs text-neutral-500">{replica.url} · {replica.userEmail}</p>
                        <p className="mt-0.5 text-xs text-neutral-500">
                          {replica.lastPulledAt
                            ? t('Última actualización: {date}').replace('{date}', new Date(replica.lastPulledAt).toLocaleString())
                            : t('Todavía sin actualizar.')}
                          {replica.lastImages && replica.lastImages.downloaded > 0
                            ? ` · ${t('{n} imágenes descargadas').replace('{n}', String(replica.lastImages.downloaded))}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button className="btn btn-ghost text-xs" disabled={busyVaultId === replica.vaultId || replica.state === 'revoked'} onClick={() => onSync(replica.vaultId)}>
                          {busyVaultId === replica.vaultId ? t('Sincronizando…') : t('Actualizar ahora')}
                        </button>
                        <button className="btn btn-ghost text-xs" disabled={busyVaultId === replica.vaultId} onClick={() => onDetach(replica.vaultId, replica.vaultName)}>
                          {t('Desconectar')}
                        </button>
                      </div>
                    </div>

                    {replica.role === 'reader' && replica.state === 'active' && (
                      <p className="mt-3 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800">
                        {t('Con acceso de solo lectura, todo lo que escribas o generes aquí se queda en este equipo y nunca se envía al vault principal.')}
                      </p>
                    )}

                    {replica.role !== 'reader' && replica.state === 'active' && replica.pendingMutations > 0 && (
                      <p className="mt-3 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-200">
                        {t('{n} cambios tuyos esperan a que el propietario del vault se conecte.').replace('{n}', String(replica.pendingMutations))}
                      </p>
                    )}

                    {replica.rejectedMutations > 0 && (
                      <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                        {t('{n} cambios no se han podido enviar y se conservan solo en este equipo.').replace('{n}', String(replica.rejectedMutations))}
                      </p>
                    )}

                    {replica.state === 'revoked' && (
                      <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200" data-testid="replica-revoked-notice">
                        <p className="font-medium">{t('El servidor ha revocado tu acceso a este espacio.')}</p>
                        <p className="mt-1">{t('La bóveda sigue completa en este equipo y puedes seguir consultándola sin conexión. Ya no recibirá actualizaciones. Si quieres conservarla como bóveda local, desconéctala.')}</p>
                      </div>
                    )}

                    {replica.state === 'paused' && (
                      <p className="mt-3 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800">
                        {t('Desconectada del servidor. Es una bóveda local normal.')}
                      </p>
                    )}

                    {replica.lastError && replica.state === 'active' && (
                      <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">{replica.lastError}</p>
                    )}
                  </div>
                ))}
              </div>
  );
}
