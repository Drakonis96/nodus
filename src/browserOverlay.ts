/** Main-window-only Browser overlay bridge helpers. */
export function setBrowserOverlayVisible(visible: boolean): Promise<void> {
  return window.nodus.setBrowserOverlayVisible(visible);
}
