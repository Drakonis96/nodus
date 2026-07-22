export type MainWindowState = {
  isDestroyed(): boolean;
};

/**
 * Restore the windows that belong to a running Nodus process.
 *
 * On macOS, closing the main window does not quit the application. The close
 * handler also tears down Nodi's always-on-top window, so every path that later
 * recreates the main window must re-apply the persisted mascot preference too.
 */
export function restoreAppWindows(
  mainWindow: MainWindowState | null,
  createMainWindow: () => void,
  restoreMascotWindow: () => void,
): void {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  restoreMascotWindow();
}
