// PDF Presenter — the per-slide YouTube overlay. A single iframe positioned over the
// slide at the stored percentage box; play/pause/seek are driven from the app via the
// YouTube iframe postMessage API (the app's own controls, not the video's chrome).
// This is the only presenter feature that needs the internet — everything else is
// offline. Used by the audience window (unmuted); the presenter/mobile only toggle it.
import type { PresenterVideo } from '@shared/presenterTypes';

export function extractYouTubeId(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube(?:-nocookie)?\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export class YouTubeOverlayController {
  private readonly overlay: HTMLDivElement;
  private readonly iframe: HTMLIFrameElement;

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
  }

  /** Show (and position) the overlay for a slide's video, or hide if the URL is bad. */
  show(video: PresenterVideo): void {
    const id = extractYouTubeId(video.url);
    if (!id) {
      this.hide();
      return;
    }
    Object.assign(this.overlay.style, {
      left: `${video.x}%`,
      top: `${video.y}%`,
      width: `${video.w}%`,
      height: `${video.h}%`,
      display: 'block',
    } as CSSStyleDeclaration);
    const origin = encodeURIComponent(location.origin);
    this.iframe.src = `https://www.youtube-nocookie.com/embed/${id}?rel=0&enablejsapi=1&playsinline=1${this.muted ? '&mute=1' : ''}&origin=${origin}`;
  }

  hide(): void {
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
    try {
      this.iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    } catch {
      /* iframe not ready */
    }
  }

  destroy(): void {
    this.overlay.remove();
  }
}
