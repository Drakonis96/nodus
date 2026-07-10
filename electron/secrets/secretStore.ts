import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AiProvider } from '@shared/types';
import { activeVaultDir, vaultDir } from '../vaults/vaultRegistry';

// AI API keys are stored per provider, encrypted-at-rest via Electron safeStorage,
// never in the renderer and never in plaintext on disk. Keys never cross IPC to the UI.

const PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'openrouter', 'deepseek', 'gemini', 'xiaomi'];

function keyFileInDir(dir: string, provider: AiProvider): string {
  return path.join(dir, `ai_key_${provider}.bin`);
}

function keyFile(provider: AiProvider): string {
  return keyFileInDir(activeVaultDir(), provider);
}

function readKeyFile(file: string): string | null {
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

export function setApiKey(provider: AiProvider, key: string): void {
  if (!key) {
    clearApiKey(provider);
    return;
  }
  const file = keyFile(provider);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, Buffer.from(`b64:${Buffer.from(key).toString('base64')}`));
    return;
  }
  fs.writeFileSync(file, safeStorage.encryptString(key));
}

export function getApiKey(provider: AiProvider): string | null {
  return readKeyFile(keyFile(provider));
}

export function hasApiKey(provider: AiProvider): boolean {
  return getApiKey(provider) !== null;
}

export function clearApiKey(provider: AiProvider): void {
  const file = keyFile(provider);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ── Master backup password ───────────────────────────────────────────────────
// One user-chosen password encrypts every automatic backup. Stored like the AI
// keys: encrypted-at-rest via safeStorage in the active vault dir, never sent
// to the renderer (the UI only learns whether one exists).

function backupPasswordFile(): string {
  return path.join(activeVaultDir(), 'backup_password.bin');
}

export function setBackupPassword(password: string): void {
  const clean = password.trim();
  if (!clean) {
    clearBackupPassword();
    return;
  }
  const file = backupPasswordFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, Buffer.from(`b64:${Buffer.from(clean).toString('base64')}`));
    return;
  }
  fs.writeFileSync(file, safeStorage.encryptString(clean));
}

export function getBackupPassword(): string | null {
  return readKeyFile(backupPasswordFile());
}

export function hasBackupPassword(): boolean {
  return getBackupPassword() !== null;
}

export function clearBackupPassword(): void {
  const file = backupPasswordFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Map of provider -> whether a key is stored, for the renderer (no keys exposed). */
export function providerKeyMap(): Record<AiProvider, boolean> {
  return Object.fromEntries(PROVIDERS.map((p) => [p, hasApiKey(p)])) as Record<AiProvider, boolean>;
}

export function listApiKeyProvidersForVault(vaultId: string): AiProvider[] {
  const dir = vaultDir(vaultId);
  if (!dir) return [];
  return PROVIDERS.filter((provider) => readKeyFile(keyFileInDir(dir, provider)) !== null);
}

export function copyApiKeysBetweenVaults(sourceVaultId: string, targetVaultId: string): AiProvider[] {
  const sourceDir = vaultDir(sourceVaultId);
  const targetDir = vaultDir(targetVaultId);
  if (!sourceDir || !targetDir) throw new Error('Bóveda no encontrada.');
  fs.mkdirSync(targetDir, { recursive: true });
  const copied: AiProvider[] = [];
  for (const provider of PROVIDERS) {
    const source = keyFileInDir(sourceDir, provider);
    if (!fs.existsSync(source) || readKeyFile(source) === null) continue;
    fs.copyFileSync(source, keyFileInDir(targetDir, provider));
    copied.push(provider);
  }
  return copied;
}
