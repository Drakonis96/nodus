import { useEffect, useMemo, useRef, useState } from 'react';
import { buildToolkitAppDocument, buildToolkitAppRuntimeScript } from '@shared/toolkitAppRuntime';
import { isToolkitAppJsonValue, type ToolkitAppJsonValue, type ToolkitAppManifest, type ToolkitAppSessionMessage } from '@shared/toolkitApps';
import { Icon } from '../components/ui';
import { getActiveLang, t, tx } from '../i18n';

interface RuntimeSession {
  role: 'host' | 'participant';
  participant: { id: number; name: string } | null;
  messages: ToolkitAppSessionMessage[];
  send(channel: string, payload: ToolkitAppJsonValue): Promise<void> | void;
}

function storageKey(appId: string): string {
  return `nodus.toolkit.miniapp.state.v2.${appId}`;
}

export function clearToolkitAppPersistedState(appId: string): void {
  localStorage.removeItem(storageKey(appId));
}

function readState(appId: string): Record<string, ToolkitAppJsonValue> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(appId)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key.length <= 100 && isToolkitAppJsonValue(value)));
  } catch { return {}; }
}

function writeState(appId: string, state: Record<string, ToolkitAppJsonValue>): void {
  const encoded = JSON.stringify(state);
  if (encoded.length > 256_000) throw new Error('La app ha alcanzado su límite de almacenamiento (256 KB).');
  localStorage.setItem(storageKey(appId), encoded);
}

function scriptDataUrl(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8_192) binary += String.fromCharCode(...bytes.subarray(index, index + 8_192));
  return `data:text/javascript;base64,${btoa(binary)}`;
}

export function ToolkitAppPreview({
  manifest,
  appId = 'unsaved-preview',
  session = null,
  className = '',
  fill = false,
  onRequestRepair,
}: {
  manifest: ToolkitAppManifest;
  appId?: string;
  session?: RuntimeSession | null;
  className?: string;
  fill?: boolean;
  onRequestRepair?: (message: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const deliveredRef = useRef(new Set<string>());
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const token = useMemo(() => crypto.randomUUID().replaceAll('-', ''), [manifest]);
  const participantId = session?.participant?.id ?? null;
  const participantName = session?.participant?.name ?? '';
  const sessionRole = session?.role ?? 'host';
  const sessionAvailable = Boolean(session && manifest.capabilities.multiplayer);
  const language = getActiveLang();
  const documentBundle = useMemo(() => {
    const config = {
      token,
      language,
      storage: manifest.capabilities.storage,
      session: {
        available: sessionAvailable,
        role: sessionRole,
        participant: participantId === null ? null : { id: participantId, name: participantName },
      },
    } as const;
    const runtimeScriptUrl = scriptDataUrl(buildToolkitAppRuntimeScript(config));
    const appScriptUrl = scriptDataUrl(manifest.files.javascript);
    return {
      text: buildToolkitAppDocument(manifest, config, { runtimeScriptUrl, appScriptUrl }),
    };
  }, [language, manifest, participantId, participantName, sessionAvailable, sessionRole, token]);
  const documentText = documentBundle.text;

  useEffect(() => {
    setRuntimeReady(false); setRuntimeError(''); deliveredRef.current.clear();
  }, [documentText]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data as Record<string, unknown> | null;
      if (!message || message.source !== 'nodus-miniapp' || message.token !== token || typeof message.type !== 'string') return;
      const target = event.source as Window;
      const respond = (ok: boolean, value: ToolkitAppJsonValue = null, error = '') => {
        target.postMessage({ source: 'nodus-host', token, type: 'response', id: message.id, ok, value, error }, '*');
      };
      try {
        if (message.type === 'runtime:ready') { setRuntimeReady(true); return; }
        if (message.type === 'runtime:error') { setRuntimeError(String(message.message ?? t('Error dentro de la app.')).slice(0, 500)); return; }
        if (message.type === 'session:send') {
          if (!session || !manifest.capabilities.multiplayer || typeof message.channel !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(message.channel) || !isToolkitAppJsonValue(message.payload)) return;
          void session.send(message.channel, message.payload);
          return;
        }
        if (!manifest.capabilities.storage) return respond(false, null, 'El almacenamiento no está activado.');
        const key = typeof message.key === 'string' ? message.key.trim().slice(0, 100) : '';
        const state = readState(appId);
        if (message.type === 'storage:get') return respond(true, key ? state[key] ?? null : null);
        if (message.type === 'storage:set') {
          if (!key || !isToolkitAppJsonValue(message.value) || JSON.stringify(message.value).length > 64_000) throw new Error('La clave o el dato no son válidos.');
          state[key] = message.value; writeState(appId, state); return respond(true, true);
        }
        if (message.type === 'storage:remove') { if (key) delete state[key]; writeState(appId, state); return respond(true, true); }
        if (message.type === 'storage:clear') { localStorage.removeItem(storageKey(appId)); return respond(true, true); }
      } catch (cause) {
        respond(false, null, cause instanceof Error ? cause.message : String(cause));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [appId, manifest.capabilities.multiplayer, manifest.capabilities.storage, session, token]);

  useEffect(() => {
    if (!runtimeReady || !session) return;
    for (const message of session.messages) {
      if (deliveredRef.current.has(message.id)) continue;
      deliveredRef.current.add(message.id);
      iframeRef.current?.contentWindow?.postMessage({ source: 'nodus-host', token, type: 'session:message', message }, '*');
    }
  }, [runtimeReady, session, token]);

  const viewportClass = manifest.viewport === 'mobile' ? 'mx-auto max-w-[430px]' : manifest.viewport === 'desktop' ? 'min-w-[760px]' : '';
  return (
    <div className={`relative ${fill ? 'h-full min-h-0' : 'min-h-[560px]'} overflow-auto rounded-2xl border border-neutral-200 bg-neutral-100 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 ${className}`} data-testid="toolkit-app-runtime" data-runtime-ready={runtimeReady ? 'true' : 'false'}>
      <div className={`${viewportClass} ${fill ? 'h-full min-h-0' : 'h-[min(72vh,760px)] min-h-[560px]'} overflow-hidden bg-white ${manifest.viewport === 'mobile' ? 'border-x border-neutral-200 shadow-2xl dark:border-neutral-800' : ''}`}>
        <iframe
          ref={iframeRef}
          title={tx('App: {name}', { name: manifest.title })}
          srcDoc={documentText}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          onLoad={() => setRuntimeReady(true)}
          className="h-full w-full border-0 bg-white"
          data-testid="toolkit-app-iframe"
        />
      </div>
      {runtimeError && <div className="absolute bottom-3 right-3 flex max-w-md items-start gap-2 rounded-xl bg-rose-700 px-3 py-2 text-xs text-white shadow-lg"><Icon name="warning" size={14} className="mt-0.5 shrink-0" /><div className="min-w-0 flex-1"><strong className="block">{t('La app ha encontrado un problema')}</strong><span className="mt-0.5 block break-words text-white/80">{runtimeError}</span>{onRequestRepair && <button data-testid="toolkit-app-repair" type="button" className="mt-2 rounded-lg bg-white px-2.5 py-1.5 font-medium text-rose-700" onClick={() => onRequestRepair(runtimeError)}>{t('Reparar con IA')}</button>}</div><button type="button" aria-label={t('Cerrar')} onClick={() => setRuntimeError('')}><Icon name="x" size={12} /></button></div>}
    </div>
  );
}
