import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const LAST_DOCK_ICON = 'last-dock-icon.png';

function persistedIconPath(): string {
  return path.join(app.getPath('userData'), LAST_DOCK_ICON);
}

function applyPngBuffer(buffer: Buffer): boolean {
  if (process.platform !== 'darwin' || !app.dock) return false;
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) return false;
  app.dock.setIcon(image);
  return true;
}

/** Restore the last vault/theme icon before the renderer has finished loading. */
export function restorePersistedDockIcon(): void {
  if (process.platform !== 'darwin') return;
  try {
    const iconPath = persistedIconPath();
    const buffer = fs.readFileSync(iconPath);
    applyPngBuffer(buffer);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[dock-icon] Could not restore the previous icon: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}

/** Apply and persist the current vault/theme icon received from the renderer. */
export function setPersistentDockIcon(pngDataUrl: string): void {
  if (process.platform !== 'darwin' || !app.dock) return;
  if (typeof pngDataUrl !== 'string' || !pngDataUrl.startsWith('data:image/png')) return;
  const image = nativeImage.createFromDataURL(pngDataUrl);
  if (image.isEmpty()) return;
  const buffer = image.toPNG();
  const iconPath = persistedIconPath();
  try {
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    const previous = fs.existsSync(iconPath) ? fs.readFileSync(iconPath) : null;
    if (!previous?.equals(buffer)) {
      const temporaryPath = `${iconPath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, buffer);
      fs.renameSync(temporaryPath, iconPath);
    }
    app.dock.setIcon(image);
  } catch (cause) {
    // The live Dock icon should still change even if an unusual read-only
    // installation prevents persistence.
    app.dock.setIcon(image);
    console.warn(`[dock-icon] Could not save the current icon: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
