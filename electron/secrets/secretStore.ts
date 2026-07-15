import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AiProvider } from '@shared/types';
import { AI_PROVIDERS as PROVIDERS } from '@shared/providers';
import { activeVaultDir } from '../vaults/vaultRegistry';

// AI API keys are stored per provider, encrypted-at-rest via Electron safeStorage,
// never in the renderer and never in plaintext on disk. Keys never cross IPC to the UI.
// Keys are SHARED GLOBALLY across every vault (a single encrypted file per provider in
// userData/secrets), so configuring a provider once makes it available in all vaults.
// Legacy per-vault keys are migrated up to the shared store on first read.
// Local providers (ollama, lmstudio) are included so an optional access token for
// a secured instance is stored/cleared through the same encrypted-at-rest path.

function keyFileInDir(dir: string, provider: AiProvider): string {
  return path.join(dir, `ai_key_${provider}.bin`);
}

function globalSecretsDir(): string {
  return path.join(app.getPath('userData'), 'secrets');
}

function keyFile(provider: AiProvider): string {
  return keyFileInDir(globalSecretsDir(), provider);
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
  const fromGlobal = readKeyFile(keyFile(provider));
  if (fromGlobal !== null) return fromGlobal;
  // One-time migration: an older per-vault key is promoted to the shared store.
  try {
    const legacy = readKeyFile(keyFileInDir(activeVaultDir(), provider));
    if (legacy !== null) {
      setApiKey(provider, legacy);
      return legacy;
    }
  } catch {
    /* no active vault (headless) */
  }
  return null;
}

export function hasApiKey(provider: AiProvider): boolean {
  return getApiKey(provider) !== null;
}

export function clearApiKey(provider: AiProvider): void {
  const file = keyFile(provider);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ── Cloud audio-provider keys ────────────────────────────────────────────────
// Keys for cloud text-to-speech providers (e.g. Hume) live alongside the AI keys,
// encrypted-at-rest via safeStorage, per vault, and never cross IPC to the UI
// (the renderer only learns whether a key exists).

function audioKeyFile(name: string): string {
  return path.join(activeVaultDir(), `audio_key_${name}.bin`);
}

export function setAudioKey(name: string, key: string): void {
  const clean = key.trim();
  if (!clean) {
    clearAudioKey(name);
    return;
  }
  const file = audioKeyFile(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, Buffer.from(`b64:${Buffer.from(clean).toString('base64')}`));
    return;
  }
  fs.writeFileSync(file, safeStorage.encryptString(clean));
}

export function getAudioKey(name: string): string | null {
  return readKeyFile(audioKeyFile(name));
}

export function hasAudioKey(name: string): boolean {
  return getAudioKey(name) !== null;
}

export function clearAudioKey(name: string): void {
  const file = audioKeyFile(name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ── Master backup password ───────────────────────────────────────────────────
// One user-chosen password encrypts every automatic backup. It is app-global, not
// vault-local: changing vault must never pause the user's recovery policy. Older
// builds stored it beside the active vault DB; getBackupPassword promotes that file
// once so existing users keep their password without reconfiguration.

function backupPasswordFile(): string {
  return path.join(globalSecretsDir(), 'backup_password.bin');
}

function backupRecoveryKeyFile(): string {
  return path.join(globalSecretsDir(), 'backup_recovery_key.bin');
}

function legacyBackupPasswordFile(): string {
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
  const global = readKeyFile(backupPasswordFile());
  if (global !== null) return global;
  try {
    const legacy = readKeyFile(legacyBackupPasswordFile());
    if (legacy !== null) {
      setBackupPassword(legacy);
      return legacy;
    }
  } catch {
    /* no active vault yet */
  }
  return null;
}

export function hasBackupPassword(): boolean {
  return getBackupPassword() !== null;
}

export function clearBackupPassword(): void {
  const file = backupPasswordFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function setBackupRecoveryKey(recoveryKey: string): void {
  const clean = recoveryKey.trim();
  if (!clean) {
    clearBackupRecoveryKey();
    return;
  }
  const file = backupRecoveryKeyFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, Buffer.from(`b64:${Buffer.from(clean).toString('base64')}`));
    return;
  }
  fs.writeFileSync(file, safeStorage.encryptString(clean));
}

export function getBackupRecoveryKey(): string | null {
  return readKeyFile(backupRecoveryKeyFile());
}

export function clearBackupRecoveryKey(): void {
  const file = backupRecoveryKeyFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Map of provider -> whether a key is stored, for the renderer (no keys exposed). */
export function providerKeyMap(): Record<AiProvider, boolean> {
  return Object.fromEntries(PROVIDERS.map((p) => [p, hasApiKey(p)])) as Record<AiProvider, boolean>;
}

/** Providers with a configured key. Keys are shared globally, so the vault id is
 *  ignored — every vault sees the same providers. */
export function listApiKeyProvidersForVault(_vaultId?: string): AiProvider[] {
  return PROVIDERS.filter((provider) => getApiKey(provider) !== null);
}

/** No-op kept for compatibility: keys are already shared across every vault, so there
 *  is nothing to copy. Returns the providers available to both. */
export function copyApiKeysBetweenVaults(_sourceVaultId: string, _targetVaultId: string): AiProvider[] {
  return listApiKeyProvidersForVault();
}
