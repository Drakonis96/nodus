import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-backup-password-policy-'));

try {
  const output = path.join(scratch, 'backup-password-policy.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/backupPasswordPolicy.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const policy = await import(pathToFileURL(output).href);

  assert.equal(policy.MIN_BACKUP_PASSWORD_LENGTH, 8);
  assert.equal(policy.validateBackupPassword('').valid, false);
  assert.equal(policy.validateBackupPassword('1234567').valid, false);
  assert.equal(policy.validateBackupPassword('12345678').valid, true);
  assert.deepEqual(
    policy.validateBackupPassword(' 1234567 '),
    { normalized: '1234567', length: 7, valid: false },
    'spaces discarded by encryption cannot satisfy the visible minimum',
  );
  assert.equal(policy.validateBackupPassword('abcdefgh').valid, true,
    'numbers and symbols are not silently required');
  assert.equal(policy.validateBackupPassword('🌱'.repeat(7)).valid, false,
    'the UI counts user-visible Unicode code points, not UTF-16 code units');
  assert.equal(policy.validateBackupPassword('🌱'.repeat(8)).valid, true);
  assert.equal(policy.backupPasswordsMatch(' secret-pass ', 'secret-pass'), true,
    'confirmation follows the same normalization as encryption');
  assert.equal(policy.backupPasswordsMatch('secret-pass', 'Secret-pass'), false);

  const [wizard, settings, ipc, recovery, crypto] = await Promise.all([
    readFile(path.join(repoRoot, 'src/views/RecoverySetupWizard.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/Settings.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/ipc.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/recovery/recoveryManager.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/export/backupCrypto.ts'), 'utf8'),
  ]);
  assert.match(wizard, /data-testid="recovery-password-requirement"/);
  assert.match(wizard, /setValidationAttempted\(true\);\s*\n\s*if \(!folder \|\| !canSubmit\) return;/,
    'submitting an invalid credential reveals the explanation before stopping');
  assert.match(wizard, /disabled=\{!canAttemptSubmit \|\| busy\}/,
    'the action remains clickable once its folder is ready, so validation is not silent');
  assert.match(wizard, /aria-invalid=\{invalid\}/);
  assert.match(settings, /settings-backup-password-requirement/);
  assert.doesNotMatch(settings, /disabled=\{autoBackupPasswordInput\.trim\(\)\.length < 8\}/,
    'Settings no longer hides the backend explanation behind an inert button');
  assert.match(ipc, /validateBackupPassword\(password\)/,
    'IPC independently rejects a bypassed renderer');
  assert.match(recovery, /validateBackupPassword\(password\)/,
    'recovery initialization validates before touching the selected folder');
  assert.match(crypto, /export const MIN_BACKUP_PASSWORD_LENGTH = 8;/,
    'the legacy decryption floor stays aligned without rejecting existing backup credentials');

  console.log('Backup password policy and feedback tests passed!');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
