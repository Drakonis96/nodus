// PDF Presenter — the per-slide YouTube overlay. A single iframe positioned over the
// slide at the stored percentage box; play/pause/seek are driven from the app via the
// YouTube iframe postMessage API (the app's own controls, not the video's chrome).
// This is the only presenter feature that needs the internet — everything else is
// offline. Used by the audience window (unmuted); the presenter/mobile only toggle it.
import type { PresenterVideo } from '@shared/presenterTypes';

const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com';
let nextWidgetId = 0;

export function extractYouTubeId(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube(?:-nocookie)?\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export class YouTubeOverlayController {
  private readonly overlay: HTMLDivElement;
  private readonly iframe: HTMLIFrameElement;
  private widgetId = '';
  private ready = false;
  private listening: ReturnType<typeof setInterval> | null = null;
  private pending: { func: string; args: unknown }[] = [];
  private readonly onLoad = () => this.listen();
  private readonly onMessage = (event: MessageEvent) => {
    if (event.origin !== PLAYER_ORIGIN || event.source !== this.iframe.contentWindow || !this.widgetId) return;
    let data: { id?: string; event?: string };
    try { data = JSON.parse(event.data); } catch { return; }
    if (!data || String(data.id) !== this.widgetId) return;
    if (data.event === 'readyToListen') this.listen();
    else if (data.event === 'initialDelivery' || data.event === 'alreadyInitialized' || data.event === 'onReady') {
      this.ready = true;
      this.stopListening();
      for (const command of this.pending) this.send({ event: 'command', ...command });
      this.pending = [];
    }
  };

  constructor(
    private readonly stage: HTMLElement,
    private readonly muted: boolean,
  ) {
    if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, { position: 'absolute', display: 'none', zIndex: '6', background: '#000' } as CSSStyleDeclaration);
    this.iframe = document.createElement('iframe');
    this.iframe.setAttribute('frameborder', '0');
    this.iframe.setAttribute('allow', 'autoplay; encrypted-media');
    this.iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    Object.assign(this.iframe.style, { width: '100%', height: '100%', border: '0', pointerEvents: 'none' } as CSSStyleDeclaration);
    this.overlay.appendChild(this.iframe);
    stage.appendChild(this.overlay);
    this.iframe.addEventListener('load', this.onLoad);
    window.addEventListener('message', this.onMessage);
  }

  /** Show (and position) the overlay for a slide's video, or hide if the URL is bad. */
  show(video: PresenterVideo): void {
    const id = extractYouTubeId(video.url);
    if (!id) {
      this.hide();
      return;
    }
    this.stopListening();
    this.ready = false;
    this.pending = [];
    this.widgetId = String(++nextWidgetId);
    Object.assign(this.overlay.style, {
      left: `${video.x}%`,
      top: `${video.y}%`,
      width: `${video.w}%`,
      height: `${video.h}%`,
      display: 'block',
    } as CSSStyleDeclaration);
    // YouTube's client supplies origin only for a page with an HTTP(S) host.
    // file:// has an opaque message origin and cannot use origin=file://.
    const origin = location.protocol === 'http:' || location.protocol === 'https:'
      ? `&origin=${encodeURIComponent(location.origin)}` : '';
    this.iframe.src = `${PLAYER_ORIGIN}/embed/${id}?rel=0&enablejsapi=1&playsinline=1${this.muted ? '&mute=1' : ''}&widgetid=${this.widgetId}${origin}`;
    this.listen();
    this.listening = setInterval(() => this.listen(), 250);
  }

  hide(): void {
    this.stopListening();
    this.ready = false;
    this.widgetId = '';
    this.pending = [];
    this.overlay.style.display = 'none';
    this.iframe.src = '';
  }

  play(): void {
    this.command('playVideo');
  }

  pause(): void {
    this.command('pauseVideo');
  }

  seek(time: number): void {
    this.command('seekTo', [time, true]);
  }

  private command(func: string, args: unknown = ''): void {
    if (!this.widgetId) return;
    if (this.ready) this.send({ event: 'command', func, args });
    else {
      // Retain the latest playback/seek intent while the iframe is loading.
      const isPlayback = (value: string) => value === 'playVideo' || value === 'pauseVideo';
      this.pending = this.pending.filter(command => isPlayback(func) ? !isPlayback(command.func) : command.func !== func);
      this.pending.push({ func, args });
      this.listen();
    }
  }

  private listen(): void {
    if (this.widgetId && !this.ready) this.send({ event: 'listening' });
  }

  private stopListening(): void {
    if (this.listening !== null) clearInterval(this.listening);
    this.listening = null;
  }

  private send(message: Record<string, unknown>): void {
    try {
      this.iframe.contentWindow?.postMessage(JSON.stringify({ ...message, id: this.widgetId, channel: 'widget' }), PLAYER_ORIGIN);
    } catch {
      /* iframe not ready */
    }
  }

  destroy(): void {
    this.hide();
    this.iframe.removeEventListener('load', this.onLoad);
    window.removeEventListener('message', this.onMessage);
    this.overlay.remove();
  }
}
