import type { LocalServerAccess, LocalServerPowerStatus, LocalServerStatus } from '@shared/types';
import { Icon } from './ui';
import { t } from '../i18n';

/**
 * Nodus Server running on this computer — the basic mode.
 *
 * Its own component rather than another six hundred lines inside Settings, and for the same
 * reason ConnectedVaultsPanel is: this screen has to be renderable on its own so a test can
 * put it through every state it can reach. See scripts/test-local-server-panel.mjs.
 *
 * The interface carries most of the weight of this feature. Someone turning it on is being
 * asked to make their own machine reachable, and the difference between the safe way and the
 * careless way is not obvious from the outside — so each access path states plainly what it
 * does, what it costs, and who can reach the vault as a result.
 */
export interface LocalServerPanelProps {
  status: LocalServerStatus;
  power: LocalServerPowerStatus;
  busy: boolean;
  /** Whether the open vault already publishes to this local server. */
  vaultConnected: boolean;
  /**
   * The generated administration password, once the server has been started at least once.
   *
   * Passed in rather than read here, so this component stays renderable from a test. Null means
   * the server has never run and there is no account yet — the block that shows it is hidden.
   */
  adminPassword: string | null;
  onStart: () => void;
  onStop: () => void;
  onChooseAccess: (access: LocalServerAccess) => void;
  onTailscaleServe: (enable: boolean) => void;
  onConnectVault: () => void;
  onKeepAwake: (enable: boolean) => void;
  onLidServing: (enable: boolean) => void;
  onCopy: (value: string) => void;
  onOpenExternal: (url: string) => void;
}

const ACCESS_CARDS: { id: LocalServerAccess; icon: string; title: string; body: string }[] = [
  {
    id: 'loopback',
    icon: 'lock',
    title: 'Solo este ordenador',
    body: 'Nadie más puede conectarse. El servidor escucha únicamente en este equipo, así que ni siquiera un dispositivo de tu propia casa lo ve. Empieza por aquí y amplía cuando lo necesites.',
  },
  {
    id: 'tailscale',
    icon: 'shield',
    title: 'Tailscale · el más seguro',
    body: 'Tus dispositivos se ven entre sí a través de una red privada cifrada, estés donde estés. Tailscale pone un certificado real, así que no hay avisos que aceptar, y no se abre ningún puerto en tu router.',
  },
  {
    id: 'lan',
    icon: 'globe',
    title: 'Red local · por la IP del ordenador',
    body: 'Sirve por HTTPS a los dispositivos conectados a tu misma red, con un certificado que genera Nodus. Solo funciona en casa o en la oficina, y la primera vez cada dispositivo mostrará un aviso que tendrás que aceptar.',
  },
];

function StatusDot({ status }: { status: LocalServerStatus }) {
  const colour = status.phase === 'running'
    ? 'bg-emerald-500'
    : status.phase === 'starting'
      ? 'bg-indigo-500'
      : status.phase === 'error'
        ? 'bg-red-500'
        : 'bg-neutral-400';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${colour}`} />;
}

/** A long value the user has to read or compare, with a button to copy it. */
function CopyableValue({ value, onCopy, mono = true }: { value: string; onCopy: (value: string) => void; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <code className={`min-w-0 flex-1 break-all rounded-lg bg-neutral-100 px-2 py-1.5 text-xs dark:bg-neutral-900 ${mono ? '' : 'font-sans'}`}>{value}</code>
      <button className="btn btn-ghost shrink-0 border border-neutral-300 dark:border-neutral-700" onClick={() => onCopy(value)} title={t('Copiar')} aria-label={t('Copiar')}>
        <Icon name="copy" />
      </button>
    </div>
  );
}

export function LocalServerPanel(props: LocalServerPanelProps) {
  const { status, power, busy } = props;
  const running = status.phase === 'running';

  return (
    <div className="space-y-4" data-testid="local-server-panel">
      {/* ── What this is ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/20">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            <Icon name="home" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('Este ordenador es el servidor')}</h3>
            <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
              {t('No necesitas Docker, ni dominio, ni tocar el router. Nodus arranca aquí el mismo servidor y tú decides quién puede llegar a él. Mientras Nodus esté abierto y el ordenador despierto, tu móvil o tu tableta pueden consultar el vault.')}
            </p>
          </div>
        </div>
      </div>

      {/* ── On/off ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <StatusDot status={status} />
            <div className="min-w-0">
              <h4 className="text-sm font-medium">
                {running ? t('Servidor encendido') : status.phase === 'starting' ? t('Arrancando…') : status.phase === 'error' ? t('El servidor no ha podido arrancar') : t('Servidor apagado')}
              </h4>
              {running && status.localUrl && (
                <p className="mt-0.5 break-all text-xs text-neutral-500">{status.localUrl}</p>
              )}
            </div>
          </div>
          <button
            className={running ? 'btn btn-ghost border border-red-300 text-red-700 dark:border-red-900 dark:text-red-300' : 'btn btn-primary'}
            disabled={busy}
            onClick={running ? props.onStop : props.onStart}
            data-testid="local-server-toggle"
          >
            <Icon name={running ? 'stop' : 'play'} /> {running ? t('Apagar servidor') : t('Encender servidor')}
          </button>
        </div>
        {status.error && (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" data-testid="local-server-error">
            {status.error}
          </p>
        )}
      </div>

      {/* ── Who can reach it ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <div>
          <h4 className="text-sm font-medium">{t('¿Quién puede llegar a este servidor?')}</h4>
          <p className="mt-0.5 text-xs text-neutral-500">
            {t('Las dos formas de compartir van cifradas. Nodus no ofrece servir por HTTP sin cifrar: por una red wifi, la contraseña que protege tu trabajo viajaría a la vista de cualquiera.')}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {ACCESS_CARDS.map((card) => {
            const selected = status.access === card.id;
            const unavailable = card.id === 'tailscale' && !status.tailscale.installed;
            return (
              <button
                key={card.id}
                data-testid={`local-server-access-${card.id}`}
                disabled={busy}
                aria-pressed={selected}
                onClick={() => props.onChooseAccess(card.id)}
                className={`rounded-xl border p-3 text-left transition ${selected ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30' : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'}`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon name={card.icon} /> {t(card.title)}
                  {selected && <Icon name="check" size={12} className="text-indigo-600 dark:text-indigo-400" />}
                </span>
                <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t(card.body)}</span>
                {unavailable && (
                  <span className="mt-1.5 block text-xs font-medium text-amber-700 dark:text-amber-400">{t('Tailscale no está instalado en este ordenador.')}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tailscale ────────────────────────────────────────────────── */}
      {status.access === 'tailscale' && (
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800" data-testid="local-server-tailscale">
          {!status.tailscale.installed ? (
            <div className="space-y-2">
              <p className="text-sm">{t('Instala Tailscale y entra con tu cuenta en este ordenador y en los dispositivos desde los que quieras consultar el vault.')}</p>
              <p className="text-xs leading-5 text-neutral-500">
                {t('Es gratuito para uso personal. Crea una red privada entre tus propios aparatos: nadie más puede entrar en ella, ni siquiera sabiendo la dirección.')}
              </p>
              <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => props.onOpenExternal('https://tailscale.com/download')}>
                <Icon name="external" /> {t('Descargar Tailscale')}
              </button>
            </div>
          ) : !status.tailscale.connected ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t('Tailscale está instalado pero este ordenador no ha iniciado sesión en ninguna red. Ábrelo y entra con tu cuenta.')}
            </p>
          ) : !status.tailscale.httpsAvailable ? (
            <div className="space-y-2">
              <p className="text-sm text-amber-700 dark:text-amber-400">{t('Falta activar los certificados HTTPS de tu red de Tailscale.')}</p>
              <p className="text-xs leading-5 text-neutral-500">{t('Se activa una sola vez, desde la consola de administración de Tailscale, en la sección DNS.')}</p>
              <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={() => props.onOpenExternal('https://login.tailscale.com/admin/dns')}>
                <Icon name="external" /> {t('Abrir la consola de Tailscale')}
              </button>
            </div>
          ) : status.tailscale.servingOurPort && status.tailscale.url ? (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{t('Listo. Abre esta dirección desde tus dispositivos:')}</h4>
              <CopyableValue value={status.tailscale.url} onCopy={props.onCopy} />
              <p className="text-xs leading-5 text-neutral-500">
                {t('Funciona desde cualquier sitio, no solo desde casa, siempre que el dispositivo tenga Tailscale activo y tu ordenador esté despierto.')}
              </p>
              <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" disabled={busy} onClick={() => props.onTailscaleServe(false)}>
                <Icon name="x" /> {t('Dejar de compartir por Tailscale')}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">{t('Todo listo para publicar el servidor en tu red de Tailscale.')}</p>
              {status.tailscale.dnsName && (
                <p className="text-xs text-neutral-500">{t('Quedará disponible en')} <code className="break-all">{`https://${status.tailscale.dnsName}`}</code></p>
              )}
              <button className="btn btn-primary" disabled={busy || !running} onClick={() => props.onTailscaleServe(true)} data-testid="local-server-tailscale-serve">
                <Icon name="cast" /> {t('Compartir por Tailscale')}
              </button>
              {!running && <p className="text-xs text-neutral-500">{t('Enciende primero el servidor.')}</p>}
            </div>
          )}
        </div>
      )}

      {/* ── Local network ────────────────────────────────────────────── */}
      {status.access === 'lan' && (
        <div className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800" data-testid="local-server-lan">
          {status.lan.addresses.length === 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">{t('Este ordenador no está conectado a ninguna red local ahora mismo.')}</p>
          ) : (
            <>
              <div>
                <h4 className="text-sm font-medium">{t('Abre esta dirección en el otro dispositivo:')}</h4>
                <div className="mt-1.5">
                  <CopyableValue value={status.shareUrl ?? `https://${status.lan.addresses[0]}:${status.port}`} onCopy={props.onCopy} />
                </div>
              </div>
              {status.lan.addresses.length > 1 && (
                <p className="text-xs text-neutral-500">
                  {t('Otras direcciones de este ordenador:')} {status.lan.addresses.slice(1).map((address) => `https://${address}:${status.port}`).join(' · ')}
                </p>
              )}
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                <strong>{t('La primera vez verás un aviso de seguridad')}.</strong>{' '}
                {t('Es normal: el certificado lo ha creado Nodus, no una autoridad que el navegador conozca de antemano. Antes de continuar, comprueba que la huella que muestra el navegador coincide con esta:')}
                {status.lan.caFingerprint && (
                  <div className="mt-1.5">
                    <CopyableValue value={status.lan.caFingerprint} onCopy={props.onCopy} />
                  </div>
                )}
                <p className="mt-1.5">
                  {t('Si coincide, estás hablando con tu ordenador y la conexión va cifrada. Si no coincide, no continúes.')}
                </p>
              </div>
              <p className="text-xs leading-5 text-neutral-500">
                {t('Solo funciona dentro de esta red. Fuera de casa no hay nada que abrir, y eso es deliberado: no se expone nada a Internet.')}
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Connect this vault ───────────────────────────────────────── */}
      {running && (
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h4 className="text-sm font-medium">{vaultConnectedTitle(props.vaultConnected)}</h4>
              <p className="mt-0.5 text-xs leading-5 text-neutral-500">
                {props.vaultConnected
                  ? t('Este vault ya publica en el servidor de este ordenador. Los cambios se envían solos mientras Nodus esté abierto.')
                  : t('Nodus creará el espacio y hará el emparejamiento por ti. No hace falta copiar ningún código.')}
              </p>
            </div>
            {!props.vaultConnected && (
              <button className="btn btn-primary shrink-0" disabled={busy} onClick={props.onConnectVault} data-testid="local-server-connect-vault">
                <Icon name="plug" /> {t('Conectar este vault')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Sign-in details ──────────────────────────────────────────── */}
      {running && status.adminEmail && (
        <details className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <summary className="cursor-pointer text-sm font-medium">{t('Datos para entrar en la administración web')}</summary>
          <p className="mt-2 text-xs leading-5 text-neutral-500">
            {t('Los necesitas para crear cuentas de lectura para otras personas. Nodus ha generado la contraseña por ti; puedes verla y copiarla desde aquí.')}
          </p>
          <div className="mt-2 space-y-2">
            <div>
              <span className="text-xs text-neutral-500">{t('Correo')}</span>
              <CopyableValue value={status.adminEmail} onCopy={props.onCopy} mono={false} />
            </div>
            {props.adminPassword && (
              <div data-testid="local-server-admin-password">
                <span className="text-xs text-neutral-500">{t('Contraseña')}</span>
                <CopyableValue value={props.adminPassword} onCopy={props.onCopy} />
              </div>
            )}
          </div>
          {status.localUrl && (
            <button
              className="btn btn-ghost mt-2 border border-neutral-300 dark:border-neutral-700"
              onClick={() => props.onOpenExternal(status.localUrl as string)}
            >
              <Icon name="external" /> {t('Abrir la administración web')}
            </button>
          )}
        </details>
      )}

      {/* ── Power ────────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800" data-testid="local-server-power">
        <div>
          <h4 className="text-sm font-medium">{t('Que el ordenador aguante despierto')}</h4>
          <p className="mt-0.5 text-xs leading-5 text-neutral-500">
            {t('Un ordenador dormido no responde. Si quieres consultar el vault desde el móvil mientras no estás delante, deja al menos el primer interruptor puesto.')}
          </p>
        </div>

        <label className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-sm">{t('Mantener el ordenador despierto')}</span>
            <span className="mt-0.5 block text-xs leading-5 text-neutral-500">
              {t('Evita que se duerma por inactividad. La pantalla sí puede apagarse. No pide contraseña y se suelta en cuanto lo apagas o cierras Nodus.')}
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            checked={power.awake}
            disabled={busy}
            onChange={(event) => props.onKeepAwake(event.target.checked)}
            data-testid="local-server-keep-awake"
          />
        </label>

        <label className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-sm">{t('Seguir sirviendo con la tapa cerrada')}</span>
            <span className="mt-0.5 block text-xs leading-5 text-neutral-500">
              {power.lidSupported
                ? t('El sistema te pedirá tu contraseña de administrador en su propia ventana; Nodus no la ve. Desactiva el sueño de todo el equipo, así que enciéndelo solo mientras lo necesites.')
                : t('En Linux esto se configura en /etc/systemd/logind.conf con HandleLidSwitch=ignore y reiniciando systemd-logind.')}
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            checked={power.lidOpenServing}
            disabled={busy || !power.lidSupported || (power.onBattery && !power.lidOpenServing)}
            onChange={(event) => props.onLidServing(event.target.checked)}
            data-testid="local-server-lid"
          />
        </label>

        {power.onBattery && power.lidSupported && !power.lidOpenServing && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            {t('Conecta el cargador antes de activarlo. Un portátil que no puede dormir y no está enchufado se queda sin batería, y cerrado dentro de una mochila se calienta.')}
          </p>
        )}
        {power.orphaned && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300" data-testid="local-server-power-orphaned">
            {t('El sueño del sistema sigue desactivado de una sesión anterior de Nodus que no llegó a cerrarse bien. Activa y desactiva el interruptor para dejarlo como estaba.')}
          </p>
        )}
        {power.error && (
          <p className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            {power.error}
          </p>
        )}
      </div>

      <p className="text-xs leading-5 text-neutral-500">
        {t('El servidor se apaga cuando cierras Nodus. Es a propósito: no queda nada corriendo en segundo plano sin que lo sepas.')}
      </p>
    </div>
  );
}

function vaultConnectedTitle(connected: boolean): string {
  return connected ? t('Este vault ya está conectado') : t('Conectar el vault abierto a este servidor');
}
