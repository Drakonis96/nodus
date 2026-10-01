import { app } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';

interface SystemAudioBridge {
  getVolume(): number;
  setVolume(volume: number): void;
}
let bridge: SystemAudioBridge | null | undefined;

export function nativeSystemAudio(): SystemAudioBridge | null {
  if (bridge !== undefined) return bridge;
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'system-audio', 'nodus-system-audio.node')
    : path.join(app.getAppPath(), 'build', 'system-audio', process.arch, 'nodus-system-audio.node');
  try { bridge = createRequire(import.meta.url)(file) as SystemAudioBridge; }
  catch { bridge = null; }
  return bridge;
}
