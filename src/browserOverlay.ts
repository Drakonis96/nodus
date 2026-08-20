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
 * Individual Browser features can still use setBrowserOverlayVisible when they
 * need snapshots or custom timing. This guard is the backstop for global Nodus
 * UI and recalculates after each React commit, so closing one of two overlapping
 * dialogs cannot accidentally reveal the native page over the remaining one.
 */
export function useBrowserNativeOverlayGuard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;

    let animationFrame = 0;
    const synchronize = () => {
      animationFrame = 0;
      void setBrowserOverlayVisible(hasVisibleTrustedOverlay()).catch(() => undefined);
    };
    const schedule = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(synchronize);
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
      observer.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      void setBrowserOverlayVisible(false).catch(() => undefined);
    };
  }, [enabled]);
}
