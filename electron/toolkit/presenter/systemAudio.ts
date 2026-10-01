// PDF Presenter — system volume + AirPlay/Screen-Mirroring helpers (macOS only).
// The audience's audio (a YouTube overlay) is system audio, so the presenter and
// the mobile remote can nudge the output volume; casting opens the macOS Screen
// Mirroring picker. Everything is a no-op on other platforms so callers stay simple.
import { execFile } from 'node:child_process';
import { SystemVolume } from './systemVolume';
import { nativeSystemAudio } from './nativeSystemAudio';

const isMac = process.platform === 'darwin';

const systemVolume = new SystemVolume(
  () => new Promise<number>((resolve, reject) => {
    try {
      const native = nativeSystemAudio();
      if (native) { resolve(native.getVolume()); return; }
    } catch { /* An unsupported output device keeps the serialized fallback. */ }
    execFile('osascript', ['-e', 'output volume of (get volume settings)'], { timeout: 2_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(parseInt(stdout.trim(), 10) || 0);
    });
  }),
  (volume) => new Promise<void>((resolve, reject) => {
    try {
      const native = nativeSystemAudio();
      if (native) { native.setVolume(volume); resolve(); return; }
    } catch { /* An unsupported output device keeps the serialized fallback. */ }
    execFile('osascript', ['-e', `set volume output volume ${volume}`], { timeout: 2_000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  }),
);

export function getSystemVolume(): Promise<number> {
  return isMac ? systemVolume.get() : Promise.resolve(50);
}

export function setSystemVolume(volume: number): Promise<void> {
  return isMac ? systemVolume.set(volume) : Promise.resolve();
}

/** Open the macOS Control Center "Screen Mirroring" panel; falls back to Displays. */
export function openCastPicker(): Promise<boolean> {
  if (!isMac) return Promise.resolve(false);
  const script = `
    tell application "System Events"
      tell process "ControlCenter"
        set found to false
        repeat with item_i in menu bar items of menu bar 1
          try
            set d to description of item_i
            if d contains "Screen Mirroring" or d contains "Duplicar" or d contains "Pantalla" then
              click item_i
              set found to true
              exit repeat
            end if
          end try
        end repeat
        if not found then error "not found"
      end tell
    end tell`;
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], (err) => {
      if (!err) {
        resolve(true);
        return;
      }
      execFile('open', ['x-apple.systempreferences:com.apple.Displays-Settings.extension'], () => resolve(false));
    });
  });
}
