import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AiProvider } from '@shared/types';

// AI API keys are stored per provider, encrypted-at-rest via Electron safeStorage,
// never in the renderer and never in plaintext on disk. Keys never cross IPC to the UI.

const PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'openrouter', 'deepseek', 'gemini', 'xiaomi'];

function keyFile(provider: AiProvider): string {
  return path.join(app.getPath('userData'), `ai_key_${provider}.bin`);
}

export function setApiKey(provider: AiProvider, key: string): void {
  if (!key) {
    clearApiKey(provider);
    return;
  }
  const file = keyFile(provider);
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, Buffer.from(`b64:${Buffer.from(key).toString('base64')}`));
    return;
  }
  fs.writeFileSync(file, safeStorage.encryptString(key));
}

export function getApiKey(provider: AiProvider): string | null {
  const file = keyFile(provider);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const asStr = buf.toString('utf8');
  if (asStr.startsWith('b64:')) return Buffer.from(asStr.slice(4), 'base64').toString('utf8');
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export function hasApiKey(provider: AiProvider): boolean {
  return getApiKey(provider) !== null;
}

export function clearApiKey(provider: AiProvider): void {
  const file = keyFile(provider);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Map of provider -> whether a key is stored, for the renderer (no keys exposed). */
export function providerKeyMap(): Record<AiProvider, boolean> {
  return Object.fromEntries(PROVIDERS.map((p) => [p, hasApiKey(p)])) as Record<AiProvider, boolean>;
}
