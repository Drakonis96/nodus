import { useEffect, useMemo, useState } from 'react';
import type { StoredToolkitApp, ToolkitAppSessionInfo, ToolkitAppSessionSnapshot } from '@shared/toolkitApps';
import { Icon } from '../components/ui';
import { errorText, t } from '../i18n';
import { ToolkitAppPreview } from './AppPreview';

const EMPTY_SNAPSHOT: ToolkitAppSessionSnapshot = { participants: [], messages: [] };

export function ToolkitAppSession({ app }: { app: StoredToolkitApp }) {
  const [info, setInfo] = useState<ToolkitAppSessionInfo | null>(null);
  const [snapshot, setSnapshot] = useState<ToolkitAppSessionSnapshot>(EMPTY_SNAPSHOT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([window.nodus.getToolkitAppSessionInfo(), window.nodus.getToolkitAppSessionSnapshot()]).then(([currentInfo, currentSnapshot]) => {
      if (!active || !currentInfo || currentInfo.appTitle !== app.manifest.title) return;
      setInfo(currentInfo); setSnapshot(currentSnapshot);
    });
    const unsubscribe = window.nodus.onToolkitAppSessionEvent((event) => {
      if (event.type === 'snapshot') setSnapshot(event.snapshot);
      else { setInfo(null); setSnapshot(EMPTY_SNAPSHOT); }
    });
    return () => { active = false; unsubscribe(); };
  }, [app.manifest.title]);

  const start = async () => {
    setBusy(true); setError('');
    try { setInfo(await window.nodus.startToolkitAppSession(app.manifest)); setSnapshot(EMPTY_SNAPSHOT); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    await window.nodus.stopToolkitAppSession(); setInfo(null); setSnapshot(EMPTY_SNAPSHOT);
  };

  const runtimeSession = useMemo(() => info && app.manifest.capabilities.multiplayer ? {
    role: 'host' as const,
    participant: { id: 0, name: t('Anfitrión') },
    messages: snapshot.messages,
    send: (channel: string, payload: Parameters<typeof window.nodus.sendToolkitAppSessionMessage>[1]) => window.nodus.sendToolkitAppSessionMessage(channel, payload),
  } : null, [app.manifest.capabilities.multiplayer, info, snapshot.messages]);

  if (!info) return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-7 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mx-auto max-w-2xl text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"><Icon name="share" size={24} /></span><h3 className="mt-4 text-xl font-semibold">{t('Comparte la app por QR')}</h3><p className="mt-2 text-sm leading-relaxed text-neutral-500">{t('Las personas conectadas a tu misma red podrán abrir esta app en su navegador.')} {t(app.manifest.capabilities.multiplayer ? 'Esta app comparte cambios en directo.' : 'Cada persona utilizará su propia copia independiente.')}</p><button data-testid="toolkit-app-session-start" type="button" className="btn btn-primary mt-5 h-11 px-5" disabled={busy} onClick={() => void start()}>{busy ? <Icon name="sync" className="animate-spin" /> : <Icon name="cast" />} {t(busy ? 'Abriendo…' : 'Crear enlace y QR')}</button>{error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}<p className="mt-4 text-[10px] leading-relaxed text-neutral-400">{t('La conexión solo existe mientras Nodus está abierto y no se publica en Internet.')} {app.manifest.capabilities.storage && t('Los datos que guarde la app permanecen en este ordenador.')}</p></div>
    </section>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]" data-testid="toolkit-app-session-live">
      <aside className="space-y-4">
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 text-center dark:border-neutral-800 dark:bg-neutral-900"><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t('En directo')}</span><img src={info.qr} alt={t('Código QR para abrir la app')} className="mx-auto mt-4 w-52 rounded-xl bg-white p-2" /><p className="mt-3 text-[10px] uppercase tracking-wider text-neutral-400">{t('Código')}</p><p className="mt-1 font-mono text-3xl font-semibold tracking-[0.18em]">{info.pin}</p><button type="button" className="btn btn-secondary mt-4 w-full" onClick={() => void navigator.clipboard.writeText(info.url)}><Icon name="copy" size={13} />{t('Copiar enlace')}</button><a className="mt-2 block truncate text-[10px] text-neutral-400 underline" href={info.url} target="_blank" rel="noreferrer">{info.url}</a></section>
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"><div className="grid grid-cols-2 gap-3 text-center"><div className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-950/50"><strong className="block text-xl">{snapshot.participants.length}</strong><span className="text-[10px] text-neutral-500">{t('Conectadas')}</span></div><div className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-950/50"><strong className="block text-xl">{snapshot.messages.length}</strong><span className="text-[10px] text-neutral-500">{t('Eventos')}</span></div></div>{snapshot.participants.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{snapshot.participants.map((participant) => <span key={participant.id} className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] dark:bg-neutral-800">{participant.name}</span>)}</div>}<button type="button" className="btn mt-4 w-full text-rose-600" onClick={() => void stop()}><Icon name="stop" size={13} />{t('Cerrar sesión')}</button></section>
      </aside>
      <main className="min-w-0"><div className="mb-3"><h3 className="font-semibold">{t('Vista del anfitrión')}</h3><p className="text-xs text-neutral-500">{t('La misma app, conectada a la sesión compartida.')}</p></div><ToolkitAppPreview manifest={app.manifest} appId={app.id} session={runtimeSession} /></main>
    </div>
  );
}
