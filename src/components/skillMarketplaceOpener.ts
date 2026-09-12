/**
 * The one way into the global Skills modal.
 *
 * The activation popover lives in seven chat surfaces and inside the standalone Nodi
 * overlay window, and only the main window mounts the modal. A module-level opener,
 * registered by the App that owns the modal, therefore answers both questions at once:
 * how to open it, and — because the overlay is a different renderer with its own module
 * instance, where nothing ever registers — whether this window can open it at all. A
 * window that cannot simply does not offer the button, instead of offering one that
 * does nothing.
 */
let opener: (() => void) | null = null;

/** Called by the window that mounts the modal. Returns the unregister function. */
export function registerSkillMarketplace(open: () => void): () => void {
  opener = open;
  return () => { if (opener === open) opener = null; };
}

/** Whether this window mounts the modal. Read at render time, not cached. */
export function canOpenSkillMarketplace(): boolean {
  return !!opener;
}

/** Open the Skills modal; a no-op in windows that do not have one. */
export function openSkillMarketplace(): void {
  opener?.();
}
