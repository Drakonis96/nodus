import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/ui';
import { t } from '../i18n';
import { MAX_BROWSER_TABS } from '@shared/browser';
import type { BrowserState, BrowserTabState, PendingBrowserPermission } from '@shared/browser';

/**
 * Nodus Browser.
 *
 * This component renders CHROME ONLY. The page itself is a native
 * WebContentsView owned by the main process, positioned over the empty
 * `data-browser-viewport` div below. That division is the whole architecture:
 * the renderer never holds a WebContents, so a website cannot reach Nodus
 * through it.
 *
 * The consequence to keep in mind while editing: a native view paints ABOVE this
 * HTML. Anything that must appear over the page — modals, the command palette,
 * Nodi — has to hide the view first (window.nodus.setBrowserOverlayVisible), and
 * the error panes below are drawn while the view is hidden for that reason.
 */
export function NodusBrowserView() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<BrowserState>({ tabs: [], activeTabId: null });
  const [omnibox, setOmnibox] = useState('');
  const [omniboxFocused, setOmniboxFocused] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingBrowserPermission | null>(null);

  const active: BrowserTabState | null =
    state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;

  // Subscribe first, then read: doing it the other way round drops any change
  // that lands between the read and the subscription.
  useEffect(() => {
    const stop = window.nodus.onBrowserStateChanged(setState);
    void window.nodus.getBrowserState().then(setState);
    return stop;
  }, []);

  useEffect(() => {
    const stop = window.nodus.onBrowserPermissionRequest(setPermission);
    void window.nodus.getPendingBrowserPermission().then(setPermission);
    // Leaving the section must not strand a page waiting on a prompt it can no
    // longer see: every pending request is denied on the way out.
    return () => {
      stop();
      void window.nodus.cancelBrowserPermissions();
    };
  }, []);

  // Follow the URL of whatever tab is active, unless the user is editing.
  useEffect(() => {
    if (omniboxFocused) return;
    setOmnibox(active?.url ?? '');
  }, [active?.url, omniboxFocused]);

  /**
   * Report the rectangle the page should occupy.
   *
   * getBoundingClientRect() is already in CSS pixels, which is what setBounds
   * expects, so no scaling is needed — but the values are rounded in the main
   * process, because a fractional rectangle leaves a sub-pixel seam.
   */
  const publishViewport = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    void window.nodus.setBrowserViewport({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  useEffect(() => {
    publishViewport();
    const element = viewportRef.current;
    if (!element) return;
    // rAF-coalesced: a drag-resize fires these dozens of times per second, and
    // forwarding each one is how a browser section starts dropping frames.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        publishViewport();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [publishViewport]);

  // Open the first tab once, when the section is first shown.
  useEffect(() => {
    if (state.tabs.length === 0) void window.nodus.openBrowserTab('about:blank');
    // Deliberately runs on mount only: re-running on every state change would
    // reopen a tab the moment the user closed the last one.
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setRefusal(null);
    const result = await window.nodus.submitBrowserOmnibox(omnibox);
    if (result.kind === 'blocked') {
      setRefusal(t('Nodus Browser no abre direcciones de tipo «{scheme}».').replace('{scheme}', result.scheme));
    } else if (result.kind === 'external') {
      setRefusal(t('Esa dirección se abre fuera de Nodus.'));
    }
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const busy = Boolean(active?.loading);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="nodus-browser">
      <BrowserTabStrip
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onSelect={(id) => void window.nodus.activateBrowserTab(id)}
        onClose={(id) => void window.nodus.closeBrowserTab(id)}
        onNew={() => void window.nodus.openBrowserTab('about:blank')}
      />

      <div className="flex items-center gap-1 border-b border-neutral-800 px-2 py-1.5">
        <ToolbarButton
          icon="chevronLeft"
          label={t('Atrás')}
          disabled={!active?.canGoBack}
          onClick={() => void window.nodus.browserGoBack()}
        />
        <ToolbarButton
          icon="chevronRight"
          label={t('Adelante')}
          disabled={!active?.canGoForward}
          onClick={() => void window.nodus.browserGoForward()}
        />
        <ToolbarButton
          icon={busy ? 'stop' : 'refresh'}
          label={busy ? t('Detener') : t('Recargar')}
          onClick={() => void (busy ? window.nodus.browserStop() : window.nodus.browserReload())}
        />
        <ToolbarButton
          icon="home"
          label={t('Inicio')}
          onClick={() => void window.nodus.submitBrowserOmnibox('about:blank')}
        />

        <form className="flex min-w-0 flex-1 items-center" onSubmit={submit}>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1">
            <SecurityIndicator url={active?.url ?? ''} error={Boolean(active?.error)} />
            <input
              data-testid="browser-omnibox"
              className="min-w-0 flex-1 bg-transparent text-sm text-neutral-200 outline-none"
              value={omnibox}
              spellCheck={false}
              placeholder={t('Busca o escribe una dirección')}
              onChange={(event) => setOmnibox(event.target.value)}
              onFocus={(event) => { setOmniboxFocused(true); event.target.select(); }}
              onBlur={() => setOmniboxFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOmnibox(active?.url ?? '');
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
        </form>
      </div>

      {refusal && (
        <div
          data-testid="browser-refusal"
          className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300"
        >
          {refusal}
        </div>
      )}

      {permission && (
        <PermissionBar
          request={permission}
          onDecide={(granted, remember) =>
            void window.nodus.resolveBrowserPermission(permission.id, granted, remember)}
        />
      )}

      {/* The page goes here. This div is deliberately empty and never painted
          into: the main process positions the native view over its rectangle. */}
      <div ref={viewportRef} data-browser-viewport className="relative min-h-0 flex-1">
        {active?.error && (active.error.kind === 'certificate'
          ? <CertificateInterstitial tab={active} />
          : <BrowserErrorPane tab={active} />)}
      </div>
    </div>
  );
}

/**
 * The permission prompt.
 *
 * Rendered as a BAR in the browser chrome, not as an overlay, and deliberately
 * so: it takes its own vertical space, which shrinks the rectangle reported to
 * the main process, so the page is moved down rather than covered. A page can
 * therefore neither hide this bar nor draw a convincing copy of it in the space
 * where it would appear.
 */
function PermissionBar({
  request, onDecide,
}: { request: PendingBrowserPermission; onDecide: (granted: boolean, remember: boolean) => void }) {
  const what = permissionLabel(request);
  return (
    <div
      data-testid="browser-permission-bar"
      className="flex flex-wrap items-center gap-2 border-b border-indigo-500/30 bg-indigo-950/40 px-3 py-2 text-xs text-indigo-100"
    >
      <Icon name="alert" size={14} className="shrink-0 opacity-70" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{request.origin}</span>{' '}{what}
      </span>
      {/* Deny comes first, and is the button that reads as the safe default. */}
      <button type="button" className="btn btn-ghost border border-neutral-700 py-0.5" onClick={() => onDecide(false, false)}>
        {t('Denegar')}
      </button>
      <button type="button" className="btn btn-ghost border border-neutral-700 py-0.5" onClick={() => onDecide(false, true)}>
        {t('Denegar siempre')}
      </button>
      <button type="button" className="btn btn-ghost border border-indigo-500/60 py-0.5" onClick={() => onDecide(true, false)}>
        {t('Permitir')}
      </button>
      <button type="button" className="btn btn-ghost border border-indigo-500/60 py-0.5" onClick={() => onDecide(true, true)}>
        {t('Permitir siempre')}
      </button>
    </div>
  );
}

/** Plain language for what the site is asking for. */
function permissionLabel(request: PendingBrowserPermission): string {
  if (request.permission === 'media') {
    const wantsVideo = request.mediaTypes.includes('video');
    const wantsAudio = request.mediaTypes.includes('audio');
    if (wantsVideo && wantsAudio) return t('quiere usar la cámara y el micrófono.');
    if (wantsVideo) return t('quiere usar la cámara.');
    if (wantsAudio) return t('quiere usar el micrófono.');
    return t('quiere usar la cámara o el micrófono.');
  }
  if (request.permission === 'geolocation') return t('quiere conocer tu ubicación.');
  return t('pide un permiso adicional.');
}

function ToolbarButton({
  icon, label, onClick, disabled,
}: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

/**
 * The padlock.
 *
 * Chromium validates certificates; Nodus only reflects the verdict. The tooltip
 * says exactly that, because a padlock drawn by the application implies the
 * application checked something, and this one did not.
 */
function SecurityIndicator({ url, error }: { url: string; error: boolean }) {
  const secure = url.startsWith('https://');
  const tone = error ? 'text-red-400' : secure ? 'text-emerald-500' : 'text-neutral-500';
  const label = error
    ? t('La conexión no es segura')
    : secure
      ? t('Conexión cifrada, verificada por Chromium')
      : t('Sin cifrar');
  return (
    <span title={`${label} · ${t('Nodus no valida certificados por su cuenta.')}`} className={`shrink-0 ${tone}`}>
      <Icon name={secure && !error ? 'lock' : 'alert'} size={13} />
    </span>
  );
}

/**
 * The tab strip.
 *
 * Tabs are cheap because only the ACTIVE one is attached to the window's content
 * view: the rest keep their WebContents — so a login, a scroll position and
 * playing audio all survive — but are detached, so Chromium neither composites
 * nor paints them. Closing one destroys its WebContents outright.
 *
 * The cap is deliberate and visible. Each tab is a renderer process, and this is
 * a research browser rather than a replacement for one.
 */
function BrowserTabStrip({
  tabs, activeTabId, onSelect, onClose, onNew,
}: {
  tabs: BrowserTabState[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  if (tabs.length === 0) return null;
  const full = tabs.length >= MAX_BROWSER_TABS;
  return (
    <div
      role="tablist"
      data-testid="browser-tab-strip"
      className="flex items-center gap-1 overflow-x-auto border-b border-neutral-800 px-2 py-1"
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={selected}
            data-testid="browser-tab"
            className={`group flex min-w-0 max-w-52 shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors ${
              selected ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-900'
            }`}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              onClick={() => onSelect(tab.id)}
              title={tab.url || tab.title}
            >
              {tab.faviconDataUrl
                ? <img src={tab.faviconDataUrl} alt="" className="h-3.5 w-3.5 shrink-0" />
                : <Icon name="globe" size={13} className="shrink-0 opacity-50" />}
              <span className="truncate">{tab.title || tab.url || t('Pestaña nueva')}</span>
              {/* A muted-but-playing tab is otherwise invisible in the strip. */}
              {tab.audible && <Icon name="volume" size={11} className="shrink-0 opacity-60" />}
            </button>
            <button
              type="button"
              aria-label={t('Cerrar pestaña')}
              title={t('Cerrar pestaña')}
              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-neutral-700 group-hover:opacity-70 focus:opacity-100"
              onClick={() => onClose(tab.id)}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label={t('Pestaña nueva')}
        title={full ? t('Nodus Browser admite hasta {n} pestañas.').replace('{n}', String(MAX_BROWSER_TABS)) : t('Pestaña nueva')}
        disabled={full}
        onClick={onNew}
        data-testid="browser-new-tab"
        className="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

/**
 * A certificate failure, told apart from every other kind.
 *
 * This is a separate component rather than another row in the heading map
 * because it means something categorically different. "Site not found" is an
 * accident; an invalid certificate can mean the connection is being intercepted,
 * and a user who reads the two in the same grey pane will treat them the same.
 *
 * There is no "proceed anyway", by design. Nodus performs no certificate
 * validation of its own — Chromium does — and offering a bypass here would be
 * offering to overrule a verdict Nodus is in no position to second-guess.
 */
function CertificateInterstitial({ tab }: { tab: BrowserTabState }) {
  const error = tab.error;
  if (!error) return null;
  let host = error.url;
  try { host = new URL(error.url).host || error.url; } catch { /* show the raw target */ }
  return (
    <div
      data-testid="browser-certificate-interstitial"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-950/25 px-8 text-center"
    >
      <Icon name="lock" size={28} className="text-red-400" />
      <h2 className="text-base font-semibold text-red-200">{t('La conexión con este sitio no es privada')}</h2>
      <p className="max-w-md text-sm text-neutral-300">
        {t('Chromium no pudo verificar que «{host}» sea quien dice ser. Puede tratarse de un certificado caducado o mal configurado, o de que alguien esté interceptando la conexión.').replace('{host}', host)}
      </p>
      {error.description && (
        <p className="max-w-md font-mono text-[11px] text-neutral-500">{error.description}</p>
      )}
      <p className="max-w-md text-xs text-neutral-500">
        {t('Nodus Browser no ofrece continuar de todos modos: no valida certificados por su cuenta, así que no puede contradecir ese veredicto.')}
      </p>
      <button
        type="button"
        className="btn btn-ghost border border-neutral-700"
        onClick={() => void window.nodus.browserGoBack()}
      >
        {t('Volver atrás')}
      </button>
    </div>
  );
}

/** Rendered by React, over the hidden native view, when a navigation failed. */
function BrowserErrorPane({ tab }: { tab: BrowserTabState }) {
  const error = tab.error;
  if (!error) return null;
  const heading: Record<string, string> = {
    dns: t('No se encontró el sitio'),
    offline: t('Sin conexión a internet'),
    refused: t('El sitio rechazó la conexión'),
    timeout: t('El sitio tardó demasiado en responder'),
    'blocked-scheme': t('Nodus Browser no abre este tipo de dirección'),
    crashed: t('Esta página dejó de responder'),
    unknown: t('No se pudo cargar la página'),
    none: '',
  };
  return (
    <div
      data-testid="browser-error"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950 px-8 text-center"
    >
      <Icon name="alert" size={28} className="text-neutral-600" />
      <h2 className="text-base font-semibold text-neutral-200">{heading[error.kind] ?? heading.unknown}</h2>
      <p className="max-w-md break-all text-xs text-neutral-500">{error.url}</p>
      {error.description && <p className="max-w-md text-xs text-neutral-600">{error.description}</p>}
      <button
        type="button"
        className="btn btn-ghost border border-neutral-700"
        onClick={() => void window.nodus.browserReload()}
      >
        {t('Reintentar')}
      </button>
    </div>
  );
}
