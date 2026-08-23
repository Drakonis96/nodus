import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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
 * Previous/Next route Chromium's standard media keys and also switch between
 * concrete audio/video elements on ordinary multi-track pages.
 */

const MediaContext = createContext<BrowserMediaState[]>([]);

const MEDIA_STATE_KEYS: (keyof BrowserMediaState)[] = [
  'tabId', 'title', 'url', 'origin', 'faviconDataUrl', 'hasMedia',
  'playing', 'audible', 'muted', 'canPlayPause', 'kind',
];

function sameMediaStates(current: BrowserMediaState[], next: BrowserMediaState[]): boolean {
  return current.length === next.length && current.every((state, index) =>
    MEDIA_STATE_KEYS.every((key) => state[key] === next[index]?.[key]));
}

export function useBrowserMedia(): BrowserMediaState[] {
  return useContext(MediaContext);
}

export function BrowserMediaProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<BrowserMediaState[]>([]);

  useEffect(() => {
    const update = (next: BrowserMediaState[]) => {
      setStates((current) => sameMediaStates(current, next) ? current : next);
    };
    // Subscribe before reading: a change landing between the two would be lost.
    const stop = window.nodus.onBrowserMediaChanged(update);
    void window.nodus.getBrowserMedia().then(update).catch(() => undefined);
    return stop;
  }, []);

  return <MediaContext.Provider value={states}>{children}</MediaContext.Provider>;
}

interface BrowserSnapshot {
  dataUrl: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The popover, anchored to the header button.
 *
 * Same anchoring pattern as the notifications panel, including the part that
 * used to be missing here. The browser page is a native WebContentsView that
 * paints above all this HTML, so the popover cannot be drawn over it — the page
 * has to be hidden. Hiding it on its own is what made clicking the media button
 * look like it made the website disappear: the popover opened over the window's
 * bare background.
 *
 * So the page is FROZEN first: main captures it, React paints that PNG in the
 * viewport's exact place, and only once that frame is on screen does the native
 * view go away. What the user sees is the page staying put behind the popover.
 */
export function BrowserMediaPopover({
  anchorEl, onClose, onOpenTab,
}: { anchorEl: HTMLElement | null; onClose: () => void; onOpenTab: (tabId: string) => void }) {
  const states = useBrowserMedia();
  const [deviceVolume, setDeviceVolume] = useState(50);
  const [deviceVolumeReady, setDeviceVolumeReady] = useState(false);
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!anchorEl) return;
    let cancelled = false;

    const freezeBrowserPage = async () => {
      const dataUrl = await window.nodus.captureBrowserOverlaySnapshot().catch(() => null);
      if (cancelled) return;
      const viewport = document.querySelector<HTMLElement>('[data-browser-viewport]');
      const rect = viewport?.getBoundingClientRect();
      if (dataUrl && rect && rect.width > 0 && rect.height > 0) {
        setSnapshot({ dataUrl, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        // Two frames: one for React to commit the image, one for the compositor
        // to have actually put it on screen. Hiding the native view any earlier
        // shows the bare window through the gap.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        if (cancelled) return;
      }
      await window.nodus.setBrowserOverlayVisible(true);
    };
    void freezeBrowserPage();

    void window.nodus.getBrowserDeviceVolume()
      .then((volume) => {
        setDeviceVolume(Math.max(0, Math.min(100, Math.round(volume))));
        setDeviceVolumeReady(true);
      })
      .catch(() => setDeviceVolumeReady(false));
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      setSnapshot(null);
      void window.nodus.setBrowserOverlayVisible(false);
    };
    // Media-state updates recreate the callback supplied by the header. They
    // must not restart this effect: doing so briefly disabled and repainted the
    // volume slider after Pause, Previous, Next or Mute.
  }, [anchorEl]);

  if (!anchorEl || states.length === 0) return null;
  const rect = anchorEl.getBoundingClientRect();

  return createPortal(
    <>
      {snapshot && (
        <img
          data-testid="browser-media-page-snapshot"
          src={snapshot.dataUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none fixed z-[129] object-fill"
          style={{ left: snapshot.left, top: snapshot.top, width: snapshot.width, height: snapshot.height }}
        />
      )}
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
        <label
          data-testid="browser-device-volume"
          className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-neutral-700 px-2 pt-3 text-xs text-neutral-300"
        >
          <Icon name="volume" size={14} className="text-neutral-400" />
          <span className="sr-only">{t('Volumen')}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            aria-label={t('Volumen')}
            disabled={!deviceVolumeReady}
            value={deviceVolume}
            onChange={(event) => {
              const volume = Number(event.currentTarget.value);
              setDeviceVolume(volume);
              void window.nodus.setBrowserDeviceVolume(volume);
            }}
            className="w-full accent-indigo-500 disabled:opacity-50"
          />
          <output className="w-9 text-right tabular-nums text-neutral-400">{deviceVolume}%</output>
        </label>
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
        aria-label={t('Anterior')}
        title={t('Anterior')}
        className="shrink-0 rounded p-1 text-neutral-300 hover:bg-neutral-700"
        onClick={() => void window.nodus.browserMediaCommand(state.tabId, 'previous')}
      >
        <Icon name="skipBack" size={14} />
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
        aria-label={t('Siguiente')}
        title={t('Siguiente')}
        className="shrink-0 rounded p-1 text-neutral-300 hover:bg-neutral-700"
        onClick={() => void window.nodus.browserMediaCommand(state.tabId, 'next')}
      >
        <Icon name="skipForward" size={14} />
      </button>

      <button
        type="button"
        data-testid="browser-media-mute"
        aria-pressed={state.muted}
        aria-label={state.muted ? t('Activar sonido') : t('Silenciar')}
        title={state.muted ? t('Activar sonido') : t('Silenciar')}
        className="shrink-0 rounded p-1 text-neutral-300 hover:bg-neutral-700"
        onClick={() => void window.nodus.setBrowserTabMuted(state.tabId, !state.muted)}
      >
        <Icon name={state.muted ? 'volumeOff' : 'volume'} size={14} />
      </button>
    </div>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}
