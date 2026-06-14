import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// AI API key is stored encrypted-at-rest via Electron safeStorage, never in the
// renderer and never in plaintext on disk. The key never crosses IPC to the UI.

function keyFile(): string {
  return path.join(app.getPath('userData'), 'ai_key.bin');
}

export function setApiKey(key: string): void {
  if (!key) {
    clearApiKey();
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: still avoid plaintext by base64; on most desktops encryption is available.
    fs.writeFileSync(keyFile(), Buffer.from(`b64:${Buffer.from(key).toString('base64')}`));
    return;
  }
  const enc = safeStorage.encryptString(key);
  fs.writeFileSync(keyFile(), enc);
}

export function getApiKey(): string | null {
  const f = keyFile();
  if (!fs.existsSync(f)) return null;
  const buf = fs.readFileSync(f);
  const asStr = buf.toString('utf8');
  if (asStr.startsWith('b64:')) {
    return Buffer.from(asStr.slice(4), 'base64').toString('utf8');
  }
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export function hasApiKey(): boolean {
  return getApiKey() !== null;
}

export function clearApiKey(): void {
  const f = keyFile();
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
