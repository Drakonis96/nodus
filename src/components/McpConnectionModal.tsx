import { useEffect, useMemo, useState } from 'react';
import type { McpTunnelErrorCode, McpTunnelStatus } from '@shared/types';
import { isValidMcpTunnelId } from '@shared/mcpTunnel';
import { confirm } from './feedback';
import { Icon } from './ui';
import { errorText, t } from '../i18n';

const OPENAI_TUNNELS_URL = 'https://platform.openai.com/settings/organization/tunnels';
const OPENAI_RUNTIME_KEYS_URL = 'https://platform.openai.com/settings/organization/api-keys';
const CHATGPT_PLUGINS_URL = 'https://chatgpt.com/plugins';

const EMPTY_TUNNEL_STATUS: McpTunnelStatus = {
  configured: false,
  enabled: false,
  hasApiKey: false,
  phase: 'not_configured',
  tunnelId: null,
  clientVersion: null,
  installProgress: null,
  uiUrl: null,
  errorCode: null,
  errorDetail: null,
};

function tunnelErrorLabel(code: McpTunnelErrorCode | null): string {
  const labels: Record<McpTunnelErrorCode, string> = {
    invalid_tunnel_id: 'El ID debe empezar por tunnel_ y contener los 32 caracteres que muestra OpenAI.',
    missing_api_key: 'Falta la clave de ejecución de OpenAI.',
    unsupported_platform: 'OpenAI todavía no ofrece el cliente de túnel para este sistema.',
    download_failed: 'No se pudo descargar el cliente oficial. Comprueba la conexión a Internet e inténtalo de nuevo.',
    integrity_failed: 'La descarga no superó la comprobación de seguridad y no se ha ejecutado.',
    api_key_rejected: 'OpenAI rechazó la clave. Crea una clave de ejecución nueva y vuelve a pegarla.',
    permission_denied: 'Tu cuenta necesita permisos Tunnels Read + Use en la organización de OpenAI.',
    tunnel_not_found: 'OpenAI no encuentra ese túnel en la organización asociada a la clave.',
    network: 'No se puede alcanzar OpenAI. Revisa la conexión, el proxy o el cortafuegos.',
    local_server: 'Nodus no pudo conectar el túnel con su servidor MCP local.',
    client_stopped: 'El cliente del túnel se detuvo. Pulsa Volver a conectar.',
    unknown: 'No se pudo completar la conexión. Abre el detalle técnico o inténtalo de nuevo.',
  };
  return code ? t(labels[code]) : '';
}

function phaseLabel(status: McpTunnelStatus): string {
  if (status.phase === 'installing') return t('Descargando el cliente oficial…');
  if (status.phase === 'checking') return t('Comprobando permisos y conexión…');
  if (status.phase === 'connecting') return t('Abriendo el túnel seguro…');
  if (status.phase === 'connected') return t('Conectado');
  if (status.phase === 'error') return t('Necesita atención');
  return t('Sin conectar');
}

export function McpConnectionModal({
  url,
  token,
  copied,
  onCopy,
  onSettingsChanged,
  onClose,
}: {
  url: string;
  token: string;
  copied: 'url' | 'token' | null;
  onCopy: (kind: 'url' | 'token', value: string) => Promise<void>;
  onSettingsChanged: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'chatgpt' | 'claude' | 'generic'>('chatgpt');
  const [tunnel, setTunnel] = useState<McpTunnelStatus>(EMPTY_TUNNEL_STATUS);
  const [tunnelId, setTunnelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const next = await window.nodus.getMcpTunnelStatus();
      if (!active) return;
      setTunnel(next);
      setTunnelId((current) => current || next.tunnelId || '');
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  const connect = async () => {
    setBusy(true);
    setActionError('');
    try {
      const next = await window.nodus.connectMcpTunnel({ tunnelId, apiKey: apiKey || undefined });
      setTunnel(next);
      if (next.hasApiKey) setApiKey('');
      await onSettingsChanged();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setActionError('');
    try { setTunnel(await window.nodus.disconnectMcpTunnel()); }
    catch (error) { setActionError(errorText(error)); }
    finally { setBusy(false); }
  };

  const forget = async () => {
    const ok = await confirm({
      title: t('Borrar conexión con ChatGPT'),
      message: t('Nodus eliminará de este equipo el ID del túnel y la clave de ejecución guardada. Podrás configurarlos otra vez cuando quieras.'),
      confirmLabel: t('Borrar conexión'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      setTunnel(await window.nodus.forgetMcpTunnel());
      setTunnelId('');
      setApiKey('');
    } finally {
      setBusy(false);
    }
  };

  const auth = `Authorization: Bearer ${token || '<token>'}`;
  const claudeConfig = useMemo(() => JSON.stringify({
    mcpServers: { nodus: { command: 'npx', args: ['mcp-remote', url, '--header', auth] } },
  }, null, 2), [auth, url]);
  const isWorking = busy || ['installing', 'checking', 'connecting'].includes(tunnel.phase);
  const isConnected = tunnel.phase === 'connected';
  const tunnelIdValid = isValidMcpTunnelId(tunnelId);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-5" role="dialog" aria-modal="true" aria-label={t('Conectar Nodus')} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">{t('Conectar Nodus')}</h2>
            <p className="mt-1 text-sm text-neutral-400">{t('Usa tus contenidos de Nodus desde tu asistente preferido.')}</p>
          </div>
          <button className="btn btn-ghost" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="mt-5 flex gap-1 rounded-xl border border-neutral-800 bg-neutral-950/40 p-1">
          {([
            ['chatgpt', 'ChatGPT'],
            ['claude', 'Claude Desktop'],
            ['generic', t('Otro cliente')],
          ] as const).map(([id, label]) => (
            <button key={id} className={`flex-1 rounded-lg px-3 py-2 text-sm ${tab === id ? 'bg-neutral-800 font-medium text-white' : 'text-neutral-400 hover:text-neutral-200'}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === 'chatgpt' && (
          <div className="mt-5 space-y-4">
            <div className={`rounded-xl border p-4 ${isConnected ? 'border-emerald-800/70 bg-emerald-950/20' : tunnel.phase === 'error' ? 'border-red-900/70 bg-red-950/20' : 'border-indigo-900/70 bg-indigo-950/20'}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${isConnected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-indigo-500/15 text-indigo-300'}`}><Icon name={isConnected ? 'check' : 'lock'} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium text-neutral-100">{isConnected ? t('Conectado a ChatGPT') : t('Túnel seguro de OpenAI')}</h3>
                    <span className={`text-xs ${isConnected ? 'text-emerald-400' : tunnel.phase === 'error' ? 'text-red-400' : 'text-indigo-300'}`}>{phaseLabel(tunnel)}</span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-400">{t('Conecta ChatGPT sin publicar tu servidor ni abrir puertos. Nodus usa el túnel seguro oficial de OpenAI.')}</p>
                  {tunnel.clientVersion && <p className="mt-1 text-[11px] text-neutral-500">tunnel-client {tunnel.clientVersion}</p>}
                </div>
              </div>
              {tunnel.installProgress != null && tunnel.phase === 'installing' && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-800"><div className="h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${Math.round(tunnel.installProgress * 100)}%` }} /></div>
              )}
            </div>

            {isConnected ? (
              <div className="space-y-4">
                <Step number="1" title={t('Último paso: añade Nodus en ChatGPT')}>
                  <p>{t('Abre la configuración de ChatGPT, crea una app, elige «Tunnel» como conexión y selecciona el túnel que acabas de configurar.')}</p>
                  <button className="btn btn-primary mt-3" onClick={() => void window.nodus.openExternal(CHATGPT_PLUGINS_URL)}><Icon name="external" />{t('Abrir configuración de ChatGPT')}</button>
                </Step>
                <div className="flex flex-wrap gap-2">
                  {tunnel.uiUrl && <button className="btn btn-ghost border border-neutral-700" onClick={() => void window.nodus.openExternal(tunnel.uiUrl!)}><Icon name="settings" />{t('Abrir diagnóstico')}</button>}
                  <button className="btn btn-ghost border border-neutral-700" disabled={busy} onClick={() => void disconnect()}><Icon name="stop" />{t('Desconectar')}</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Step number="1" title={t('Crea un túnel en OpenAI')}>
                  <p>{t('Abre la página de túneles, pulsa Create y copia el identificador que empieza por tunnel_.')}</p>
                  <button className="btn btn-ghost mt-3 border border-neutral-700" onClick={() => void window.nodus.openExternal(OPENAI_TUNNELS_URL)}><Icon name="external" />{t('Abrir túneles de OpenAI')}</button>
                  <label className="mt-3 block text-xs font-medium text-neutral-400">{t('ID del túnel')}
                    <input className={`input mt-1 w-full font-mono text-xs ${tunnelId && !tunnelIdValid ? 'border-red-800' : ''}`} spellCheck={false} placeholder="tunnel_0123456789abcdef0123456789abcdef" value={tunnelId} onChange={(event) => setTunnelId(event.target.value.trim())} />
                  </label>
                  {tunnelId && !tunnelIdValid && <p className="mt-1 text-xs text-red-400">{t('El ID debe empezar por tunnel_ y contener los 32 caracteres que muestra OpenAI.')}</p>}
                </Step>

                <Step number="2" title={t('Crea una clave de ejecución')}>
                  <p>{t('La clave necesita permisos Tunnels Read + Use. Nodus la guarda en el almacén protegido de este dispositivo y nunca vuelve a mostrarla.')}</p>
                  <button className="btn btn-ghost mt-3 border border-neutral-700" onClick={() => void window.nodus.openExternal(OPENAI_RUNTIME_KEYS_URL)}><Icon name="external" />{t('Crear clave de ejecución')}</button>
                  <label className="mt-3 block text-xs font-medium text-neutral-400">{t('Clave de ejecución')}
                    <div className="mt-1 flex gap-2">
                      <input className="input min-w-0 flex-1 font-mono text-xs" type={showApiKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder={tunnel.hasApiKey ? t('Ya hay una clave guardada; déjalo vacío para conservarla.') : t('Pega aquí la clave nueva')} value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
                      <button className="btn btn-ghost border border-neutral-700" type="button" onClick={() => setShowApiKey((value) => !value)}><Icon name={showApiKey ? 'eyeOff' : 'eye'} />{showApiKey ? t('Ocultar') : t('Mostrar')}</button>
                    </div>
                  </label>
                </Step>

                <Step number="3" title={t('Conecta Nodus')}>
                  <p>{t('Nodus activará MCP, descargará y verificará el cliente oficial y mantendrá la conexión mientras la aplicación esté abierta.')}</p>
                  <button data-testid="mcp-tunnel-connect" className="btn btn-primary mt-3" disabled={isWorking || !tunnelIdValid || (!apiKey && !tunnel.hasApiKey)} onClick={() => void connect()}>
                    <Icon name={isWorking ? 'sync' : 'link'} className={isWorking ? 'animate-spin' : ''} />{isWorking ? phaseLabel(tunnel) : tunnel.configured ? t('Volver a conectar') : t('Conectar con ChatGPT')}
                  </button>
                </Step>
              </div>
            )}

            {(tunnel.errorCode || actionError) && (
              <div className="rounded-xl border border-red-900/70 bg-red-950/20 p-3 text-sm text-red-200">
                <p>{actionError || tunnelErrorLabel(tunnel.errorCode)}</p>
                {tunnel.errorDetail && <details className="mt-2 text-xs text-red-300/70"><summary className="cursor-pointer">{t('Ver detalle técnico')}</summary><pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-black/20 p-2">{tunnel.errorDetail}</pre></details>}
              </div>
            )}

            <div className="rounded-xl border border-amber-900/50 bg-amber-950/15 p-3 text-xs leading-5 text-amber-200/80">
              <Icon name="shield" size={13} className="mr-1" />
              {t('Cuando uses Nodus desde ChatGPT, OpenAI recibirá las consultas y los resultados que ChatGPT solicite. Las bóvedas permanecen en este equipo y el servidor local no se publica en Internet.')}
            </div>

            {tunnel.configured && !isConnected && (
              <div className="flex justify-end"><button className="text-xs text-red-400 hover:text-red-300" disabled={busy} onClick={() => void forget()}>{t('Borrar conexión guardada')}</button></div>
            )}
          </div>
        )}

        {tab === 'claude' && (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-neutral-400">{t('Claude Desktop puede conectar directamente con el servidor local de Nodus mediante este puente stdio:')}</p>
            <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{claudeConfig}</pre>
            <p className="text-xs text-neutral-500">{t('Copia esta configuración en Claude Desktop y reinicia la aplicación.')}</p>
          </div>
        )}

        {tab === 'generic' && (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-neutral-400">{t('Usa Streamable HTTP con la URL local y la cabecera bearer siguientes.')}</p>
            <ConnectionValue label={t('URL del servidor')} value={url} copied={copied === 'url'} onCopy={() => void onCopy('url', url)} />
            <ConnectionValue label={t('Bearer token')} value={token || t('Activa el servidor para generar un token.')} copied={copied === 'token'} onCopy={() => void onCopy('token', token)} />
          </div>
        )}

        <div className="mt-6 flex justify-end"><button className="btn btn-ghost" onClick={onClose}>{t('Cerrar')}</button></div>
      </div>
    </div>
  );
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-800 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-xs font-semibold text-indigo-300">{number}</span>
        <div className="min-w-0 flex-1 text-sm text-neutral-400"><h3 className="font-medium text-neutral-100">{title}</h3><div className="mt-1">{children}</div></div>
      </div>
    </section>
  );
}

function ConnectionValue({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
        <code className="min-w-0 flex-1 break-all text-xs text-neutral-200">{value}</code>
        <button className="btn btn-ghost shrink-0" disabled={!value} onClick={onCopy}><Icon name={copied ? 'check' : 'copy'} />{copied ? t('Copiado') : t('Copiar')}</button>
      </div>
    </div>
  );
}
