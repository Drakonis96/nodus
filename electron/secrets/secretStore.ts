import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AiProvider } from '@shared/types';
import { AI_PROVIDERS, SECRET_PROVIDERS as PROVIDERS } from '@shared/providers';
import { activeVaultDir, listVaults } from '../vaults/vaultRegistry';

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

function legacyRootKeyFile(provider: AiProvider): string {
  return keyFileInDir(app.getPath('userData'), provider);
}

/** Every location used by released Nodus versions. The global file remains the
 * canonical target; the others are read-only recovery candidates. */
export function apiKeyCandidateFiles(provider: AiProvider): string[] {
  const candidates = [keyFile(provider), legacyRootKeyFile(provider)];
  const currentRoot = app.getPath('userData');
  const parent = path.dirname(currentRoot);
  // app.setName('Nodus') also changed the default userData casing on
  // case-sensitive systems. Scan both released roots on every platform;
  // inode/path deduplication below makes this harmless on Windows and macOS.
  const roots = [currentRoot, path.join(parent, 'nodus'), path.join(parent, 'Nodus')];
  for (const root of [...new Set(roots)]) {
    candidates.push(keyFileInDir(path.join(root, 'secrets'), provider), keyFileInDir(root, provider));
    const vaultsRoot = path.join(root, 'vaults');
    try {
      for (const name of fs.readdirSync(vaultsRoot)) candidates.push(keyFileInDir(path.join(vaultsRoot, name), provider));
    } catch { /* no historical vault directory */ }
  }
  try {
    candidates.push(...listVaults().map((vault) => keyFileInDir(path.dirname(vault.path), provider)));
  } catch {
    try { candidates.push(keyFileInDir(activeVaultDir(), provider)); } catch { /* no registry yet */ }
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    let identity = path.resolve(candidate);
    try {
      const stat = fs.statSync(candidate);
      identity = `${stat.dev}:${stat.ino}`;
    } catch { /* keep the resolved path identity */ }
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(path.resolve(candidate));
  }
  return unique;
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
  if (provider === 'codex') throw new Error('ChatGPT usa acceso gestionado; Nodus no almacena una clave para este proveedor.');
  if (provider === 'github-copilot') throw new Error('GitHub Copilot usa el acceso oficial de GitHub; Nodus no almacena una clave para este proveedor.');
  if (!key) {
    clearApiKey(provider);
    return;
  }
  const file = keyFile(provider);
  const historicalFiles = apiKeyCandidateFiles(provider).filter((candidate) => !sameFile(candidate, file));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  preserveLockedFile(file);
  const write = (data: Buffer) => writeSecretAtomically(file, data);
  if (!safeStorage.isEncryptionAvailable()) {
    write(Buffer.from(`b64:${Buffer.from(key).toString('base64')}`));
  } else {
    write(safeStorage.encryptString(key));
  }
  // Once the canonical write is verified, retire exact-name copies from older
  // roots/vaults so a future recovery can never resurrect a stale credential.
  if (readKeyFile(file) === key) historicalFiles.forEach(retireHistoricalFile);
}

export function getApiKey(provider: AiProvider): string | null {
  if (provider === 'codex' || provider === 'github-copilot') return null;
  const canonical = keyFile(provider);
  const fromGlobal = readKeyFile(canonical);
  if (fromGlobal !== null) return fromGlobal;
  // One-time migration: any readable key from a released root/vault location
  // is promoted to the current global store. This also covers Windows/Linux
  // userData casing changes, where the OS credential itself remains readable.
  for (const candidate of apiKeyCandidateFiles(provider)) {
    if (sameFile(candidate, canonical)) continue;
    const legacy = readKeyFile(candidate);
    if (legacy !== null) {
      setApiKey(provider, legacy);
      return legacy;
    }
  }
  return null;
}

export function hasApiKey(provider: AiProvider): boolean {
  return getApiKey(provider) !== null;
}

export function clearApiKey(provider: AiProvider): void {
  if (provider === 'codex' || provider === 'github-copilot') return;
  // An explicit delete applies to every released storage location; otherwise an
  // old per-vault copy could silently recreate the key on the next read.
  for (const file of apiKeyCandidateFiles(provider)) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    const left = fs.statSync(a);
    const right = fs.statSync(b);
    return left.dev === right.dev && left.ino === right.ino;
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function writeSecretAtomically(file: string, data: Buffer): void {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, data, { mode: 0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort on Windows */ }
}

/** Never overwrite the only copy of a blob that exists but the current OS
 * credential cannot decrypt. This archive is still OS-bound and is not treated
 * as a portable backup; it is only an emergency rollback for the migration. */
function preserveLockedFile(file: string): void {
  if (!fs.existsSync(file) || readKeyFile(file) !== null) return;
  archiveEncryptedFile(file);
}

function archiveEncryptedFile(file: string): void {
  const contents = fs.readFileSync(file);
  if (contents.toString('utf8').startsWith('b64:')) return;
  const archiveDir = path.join(globalSecretsDir(), 'locked-archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sourceHint = Buffer.from(path.dirname(file)).toString('base64url').slice(-8);
  const target = path.join(archiveDir, `${path.basename(file, '.bin')}-${stamp}-${sourceHint}.bin`);
  fs.writeFileSync(target, contents, { flag: 'wx', mode: 0o600 });
  try { fs.chmodSync(target, 0o600); } catch { /* best effort on Windows */ }
}

function retireHistoricalFile(file: string): void {
  try {
    archiveEncryptedFile(file);
    fs.unlinkSync(file);
  } catch {
    // The verified canonical key remains available; retry cleanup next time.
  }
}

export type ApiKeyStorageState = 'available' | 'locked' | 'missing';

export function apiKeyStorageState(provider: AiProvider): ApiKeyStorageState {
  if (getApiKey(provider) !== null) return 'available';
  return apiKeyCandidateFiles(provider).length > 0 ? 'locked' : 'missing';
}

export function lockedApiKeyProviders(): AiProvider[] {
  return PROVIDERS.filter((provider) => apiKeyStorageState(provider) === 'locked');
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
  return Object.fromEntries(AI_PROVIDERS.map((p) => [p, p === 'codex' || p === 'github-copilot' ? false : hasApiKey(p)])) as Record<AiProvider, boolean>;
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
