import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';
import { t } from '../../i18n';
import type { BrowserMediaState } from '@shared/browser';

/**
 * The header's media control.
 *
 * The rule the whole thing hangs on: the icon is shown when a media SESSION
 * exists, never when sound happens to be audible. Chromium reports audio state
 * changing on pause, so an audibility-driven icon would disappear the moment the
 * user pressed Pause — removing the Play button they need to resume.
 *
 * There is no Previous/Next, and that is not an omission. Nothing in the Media
 * Session API or in Electron can tell us whether a page registered those
 * handlers (`setActionHandler` has no getter), so the buttons would be dead on
 * most pages and there is no way to know which.
 */

const MediaContext = createContext<BrowserMediaState[]>([]);

export function useBrowserMedia(): BrowserMediaState[] {
  return useContext(MediaContext);
}

export function BrowserMediaProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<BrowserMediaState[]>([]);

  useEffect(() => {
    // Subscribe before reading: a change landing between the two would be lost.
    const stop = window.nodus.onBrowserMediaChanged(setStates);
    void window.nodus.getBrowserMedia().then(setStates).catch(() => undefined);
    return stop;
  }, []);

  return <MediaContext.Provider value={states}>{children}</MediaContext.Provider>;
}

/**
 * The popover, anchored to the header button.
 *
 * Same anchoring pattern as the notifications panel. It calls
 * `setBrowserOverlayVisible(true)` while open, because the browser page is a
 * native view that paints above this HTML — without that, opening this popover
 * while the browser section is on screen would draw it underneath the page.
 */
export function BrowserMediaPopover({
  anchorEl, onClose, onOpenTab,
}: { anchorEl: HTMLElement | null; onClose: () => void; onOpenTab: (tabId: string) => void }) {
  const states = useBrowserMedia();

  useEffect(() => {
    if (!anchorEl) return;
    void window.nodus.setBrowserOverlayVisible(true);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      void window.nodus.setBrowserOverlayVisible(false);
    };
  }, [anchorEl, onClose]);

  if (!anchorEl || states.length === 0) return null;
  const rect = anchorEl.getBoundingClientRect();

  return createPortal(
    <>
      <div className="fixed inset-0 z-[130]" onClick={onClose} />
      <div
        data-testid="browser-media-popover"
        className="fixed z-[131] w-80 rounded-xl border border-neutral-700 bg-neutral-900 p-2 shadow-xl"
        style={{ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) }}
      >
        <div className="flex flex-col gap-1">
          {states.map((state) => (
            <MediaRow key={state.tabId} state={state} onOpenTab={onOpenTab} />
          ))}
        </div>
        {states.length > 1 && (
          <button
            type="button"
            className="btn btn-ghost mt-1 w-full justify-center border border-neutral-700 py-1 text-xs"
            onClick={() => states.forEach((state) => void window.nodus.browserMediaCommand(state.tabId, 'pause'))}
          >
            {t('Pausar todo')}
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}

function MediaRow({
  state, onOpenTab,
}: { state: BrowserMediaState; onOpenTab: (tabId: string) => void }) {
  return (
    <div data-testid="browser-media-row" className="flex items-center gap-2 rounded-lg p-2 hover:bg-neutral-800/60">
      {state.faviconDataUrl
        ? <img src={state.faviconDataUrl} alt="" className="h-4 w-4 shrink-0" />
        : <Icon name="globe" size={15} className="shrink-0 text-neutral-500" />}

      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenTab(state.tabId)}>
        <div className="truncate text-xs text-neutral-200">{state.title || state.url}</div>
        <div className="truncate text-[11px] text-neutral-500">{hostOf(state.origin || state.url)}</div>
      </button>

      <button
        type="button"
        aria-label={state.playing ? t('Pausar') : t('Reproducir')}
        title={state.playing ? t('Pausar') : t('Reproducir')}
        className="shrink-0 rounded p-1 text-neutral-300 hover:bg-neutral-700"
        onClick={() => void window.nodus.browserMediaCommand(state.tabId, state.playing ? 'pause' : 'play')}
      >
        <Icon name={state.playing ? 'pause' : 'play'} size={14} />
      </button>

      <button
        type="button"
        aria-label={state.muted ? t('Activar sonido') : t('Silenciar')}
        title={state.muted ? t('Activar sonido') : t('Silenciar')}
        className={`shrink-0 rounded p-1 hover:bg-neutral-700 ${state.muted ? 'text-neutral-600' : 'text-neutral-300'}`}
        onClick={() => void window.nodus.setBrowserTabMuted(state.tabId, !state.muted)}
      >
        <Icon name="volume" size={14} />
      </button>
    </div>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}
