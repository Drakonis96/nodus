import fs from 'node:fs';
import path from 'node:path';
import { activeVaultDir } from '../vaults/vaultRegistry';

/**
 * Directory that holds generated narration files for the active vault. It lives
 * inside the vault directory but NOT in the database, so it is automatically
 * excluded from backups, exports and .nodussync (all of which carry only the
 * SQLite file). Audio is fully regenerable, so this is by design.
 */
export function audioDir(): string {
  const dir = path.join(activeVaultDir(), 'audio');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function audioFilePath(fileName: string): string {
  return path.join(audioDir(), fileName);
}

export function audioFileExists(fileName: string): boolean {
  try {
    return fs.existsSync(audioFilePath(fileName));
  } catch {
    return false;
  }
}
