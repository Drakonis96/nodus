import { useEffect } from 'react';

/** Main-window-only Browser overlay bridge helpers. */
export function setBrowserOverlayVisible(visible: boolean): Promise<void> {
  return window.nodus.setBrowserOverlayVisible(visible);
}

/**
 * Trusted app surfaces which must paint above an untrusted native Browser view.
 *
 * WebContentsView is composited outside the renderer DOM, so CSS z-index alone
 * cannot put a React modal in front of it. Most true modals already expose an
 * accessible dialog role; fixed full-window backdrops cover tours and legacy
 * overlays. Anchored non-modal popovers can opt in with the data attribute.
 */
const TRUSTED_OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-browser-native-overlay="true"]',
  '.fixed.inset-0',
].join(',');

function hasVisibleTrustedOverlay(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(TRUSTED_OVERLAY_SELECTOR)).some((element) => {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  });
}

/**
 * Keeps every trusted app overlay above Browser-owned native content.
 *
 * Freeze the page in its viewport before hiding the native view. The backing
 * image belongs to the viewport, so it follows sidebar and window resizes and
 * stays below every app overlay. Keep it until the last overlay closes.
 */
export function observeBrowserNativeOverlays(): () => void {
  let disposed = false;
  let scheduled = false;
  let open = false;
  let ready = false;
  let revision = 0;
  let snapshot: HTMLImageElement | null = null;
  const removeSnapshot = () => {
    snapshot?.remove();
    snapshot = null;
  };
  const freezePage = async (currentRevision: number) => {
    const viewport = document.querySelector<HTMLElement>('[data-browser-viewport]');
    const dataUrl = await window.nodus.captureBrowserOverlaySnapshot().catch(() => null);
    if (disposed || revision !== currentRevision) return;
    if (dataUrl && viewport?.isConnected) {
      const image = document.createElement('img');
      image.src = dataUrl;
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.dataset.testid = 'browser-native-overlay-snapshot';
      Object.assign(image.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        objectFit: 'fill', pointerEvents: 'none',
      });
      // A committed but undecoded image still exposes a blank background.
      await image.decode().catch(() => undefined);
      if (disposed || revision !== currentRevision || !viewport.isConnected) return;
      removeSnapshot();
      snapshot = image;
      viewport.append(image);
    }
    if (!disposed && revision === currentRevision) {
      ready = true;
      await setBrowserOverlayVisible(true).catch(() => undefined);
    }
  };
  const synchronize = () => {
    scheduled = false;
    if (disposed) return;
    const visible = hasVisibleTrustedOverlay();
    if (visible === open) {
      // A child dialog's cleanup may have revealed the page while its parent
      // is still open. Reconcile against the whole DOM, not that one dialog.
      if (open && ready) void setBrowserOverlayVisible(true).catch(() => undefined);
      return;
    }
    open = visible;
    ready = false;
    const currentRevision = ++revision;
    if (open) {
      void freezePage(currentRevision);
    } else {
      // Restore the native page before dropping the backing image. A quick
      // reopen must also invalidate both a pending capture and this cleanup.
      void setBrowserOverlayVisible(false).catch(() => undefined).then(() => {
        if (!disposed && revision === currentRevision) removeSnapshot();
      });
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    // Settle after the React commit without adding another frame of delay.
    queueMicrotask(synchronize);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['role', 'aria-hidden', 'hidden', 'class', 'style', 'data-browser-native-overlay'],
  });
  schedule();

  return () => {
    disposed = true;
    ++revision;
    observer.disconnect();
    removeSnapshot();
    void setBrowserOverlayVisible(false).catch(() => undefined);
  };
}

export function useBrowserNativeOverlayGuard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    return observeBrowserNativeOverlays();
  }, [enabled]);
}
