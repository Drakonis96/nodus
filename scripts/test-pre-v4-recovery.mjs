// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-pre-v4-recovery-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-pre-v4-'));
const userData = path.join(scratch, 'profile');
const backupFolder = path.join(scratch, 'backups');
const libraryRoot = path.join(backupFolder, 'nodus-library');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function seedDatabase(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec('CREATE TABLE legacy_notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  db.prepare('INSERT INTO legacy_notes VALUES (?, ?)').run('note-1', value);
  db.pragma('user_version = 117');
  db.close();
}

try {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(libraryRoot, { recursive: true });
  const primaryDb = path.join(userData, 'nodus.sqlite');
  const secondaryDb = path.join(userData, 'vaults', 'ámbito-histórico', 'nodus.sqlite');
  seedDatabase(primaryDb, 'original primary');
  seedDatabase(secondaryDb, 'original secondary');
  fs.writeFileSync(path.join(userData, 'app-prefs.json'), JSON.stringify({ autoBackupFolder: backupFolder, libraryGlobalEnabled: false }));
  fs.writeFileSync(path.join(userData, 'vaults.json'), JSON.stringify({
    formatVersion: 1,
    activeVaultId: 'academic-history',
    vaults: [
      { id: 'default', path: primaryDb },
      { id: 'academic-history', path: secondaryDb },
    ],
  }));
  fs.writeFileSync(path.join(path.dirname(secondaryDb), 'manifest.json'), JSON.stringify({ id: 'academic-history', type: 'academic' }));
  fs.writeFileSync(path.join(libraryRoot, 'library.json'), JSON.stringify({ format: 'nodus.library', formatVersion: 1, createdAt: '2026-07-01T00:00:00.000Z' }));
  const itemDir = path.join(libraryRoot, 'garciafernandezEntreNormaDeseo2020');
  fs.mkdirSync(itemDir, { recursive: true });
  fs.writeFileSync(path.join(itemDir, 'reader.md'), '# Entre norma y deseo\n\nTexto limpio original.\n');
  fs.writeFileSync(path.join(itemDir, 'original.pdf'), '%PDF-1.4\nlegacy fixture\n');
  const outside = path.join(scratch, 'must-not-enter-backup.txt');
  fs.writeFileSync(outside, 'private outside bytes');
  try { fs.symlinkSync(outside, path.join(itemDir, 'external-link')); } catch { /* Windows without symlink permission */ }

  const { ensurePreV4Recovery, restorePreV4Recovery } = require(path.join(repoRoot, 'electron/recovery/preV4Recovery.ts'));

  // Fault injection: a full disk before completion leaves all v3 data untouched and no
  // trusted marker. The next launch retries instead of accepting the partial directory.
  let copies = 0;
  await assert.rejects(
    ensurePreV4Recovery({
      userDataDirectory: userData,
      targetVersion: '4.0.0',
      now: new Date('2026-08-10T12:00:00.000Z'),
      copyFile: async (source, target) => {
        if (++copies === 2) {
          const error = new Error('ENOSPC: simulated disk full');
          error.code = 'ENOSPC';
          throw error;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      },
    }),
    /ENOSPC/,
  );
  assert.equal(fs.existsSync(path.join(userData, '.nodus', 'pre-v4-recovery.json')), false, 'an incomplete snapshot is never trusted');
  assert.match(fs.readFileSync(path.join(itemDir, 'reader.md'), 'utf8'), /Texto limpio original/);
  assert.equal(new Database(primaryDb, { readonly: true }).pragma('user_version', { simple: true }), 117);

  const created = await ensurePreV4Recovery({
    userDataDirectory: userData,
    targetVersion: '4.0.0',
    now: new Date('2026-08-10T12:00:01.000Z'),
  });
  assert.equal(created.status, 'created');
  assert.ok(created.snapshotPath?.startsWith(path.join(libraryRoot, '.nodus', 'recovery', 'pre-v4')), 'the copy lives under nodus-library');
  assert.equal(created.manifest?.vaults.length, 2, 'every registered v3 vault is protected');
  assert.ok(created.manifest?.files.some((entry) => entry.archivePath.endsWith('reader.md')), 'clean Markdown is protected');
  assert.ok(created.manifest?.files.some((entry) => entry.archivePath.endsWith('original.pdf')), 'original attachments are protected');
  if (fs.existsSync(path.join(itemDir, 'external-link'))) {
    assert.equal(created.manifest?.skippedSymbolicLinks.includes(path.join(itemDir, 'external-link')), true, 'external symlinks are not followed');
  }
  for (const vault of created.manifest.vaults) {
    const snapshot = path.join(created.snapshotPath, ...vault.archivePath.split('/'));
    const probe = new Database(snapshot, { readonly: true, fileMustExist: true });
    assert.equal(probe.pragma('quick_check', { simple: true }), 'ok');
    assert.equal(probe.pragma('user_version', { simple: true }), 117, 'the snapshot precedes v4 migrations');
    probe.close();
  }

  const repeated = await ensurePreV4Recovery({ userDataDirectory: userData, targetVersion: '4.0.0' });
  assert.equal(repeated.status, 'already-created');
  assert.equal(repeated.snapshotPath, created.snapshotPath, 'the one-time copy is idempotent');

  // Simulate v4 migrations and prove the verified recovery helper can put the exact
  // v3 database and canonical files back without depending on a 3.x executable.
  let db = new Database(primaryDb);
  db.prepare('UPDATE legacy_notes SET body = ?').run('mutated by v4');
  db.pragma('user_version = 129');
  db.close();
  fs.writeFileSync(path.join(itemDir, 'reader.md'), '# Rewritten by v4\n');
  fs.writeFileSync(path.join(libraryRoot, 'library.json'), JSON.stringify({ format: 'nodus.library', formatVersion: 2 }));
  fs.writeFileSync(path.join(libraryRoot, 'v4-only-record.json'), '{"mustDisappear":true}');
  restorePreV4Recovery(created.snapshotPath);
  db = new Database(primaryDb, { readonly: true });
  assert.equal(db.pragma('user_version', { simple: true }), 117);
  assert.equal(db.prepare('SELECT body FROM legacy_notes WHERE id = ?').get('note-1').body, 'original primary');
  db.close();
  assert.match(fs.readFileSync(path.join(itemDir, 'reader.md'), 'utf8'), /Texto limpio original/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(libraryRoot, 'library.json'), 'utf8')).formatVersion, 1);
  assert.equal(fs.existsSync(path.join(libraryRoot, 'v4-only-record.json')), false, 'rollback restores the exact v3 Library tree');
  assert.equal(fs.existsSync(path.join(created.snapshotPath, 'recovery.json')), true, 'the recovery package remains available after rollback');

  // A signed snapshot must not turn a tampered manifest into an arbitrary write
  // destination. The profile source path is constrained to this profile before
  // any replacement is attempted.
  const manifestFile = path.join(created.snapshotPath, 'recovery.json');
  const originalManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const profileEntry = originalManifest.files.find((entry) => entry.archivePath === 'profile/app-prefs.json');
  if (profileEntry) {
    profileEntry.sourcePath = path.join(outside, 'should-not-be-overwritten.json');
    fs.writeFileSync(manifestFile, JSON.stringify(originalManifest));
    assert.throws(() => restorePreV4Recovery(created.snapshotPath), /profile destination is invalid/);
    fs.writeFileSync(manifestFile, JSON.stringify({ ...originalManifest, files: originalManifest.files.map((entry) => ({ ...entry, sourcePath: entry.archivePath === 'profile/app-prefs.json' ? path.join(userData, 'app-prefs.json') : entry.sourcePath })) }));
  }

  // Corruption is rejected before any live file changes.
  const protectedEntry = created.manifest.files.find((entry) => entry.archivePath.endsWith('reader.md'));
  const protectedFile = path.join(created.snapshotPath, ...protectedEntry.archivePath.split('/'));
  fs.appendFileSync(protectedFile, 'tampered');
  fs.writeFileSync(path.join(itemDir, 'reader.md'), 'current safe bytes');
  assert.throws(() => restorePreV4Recovery(created.snapshotPath), /did not verify/);
  assert.equal(fs.readFileSync(path.join(itemDir, 'reader.md'), 'utf8'), 'current safe bytes', 'verification fails before modifying live state');

  // A truly fresh v4 profile gets only a marker and no pointless empty archive.
  const fresh = path.join(scratch, 'fresh-profile');
  const freshResult = await ensurePreV4Recovery({ userDataDirectory: fresh, targetVersion: '4.0.0' });
  assert.equal(freshResult.status, 'fresh-profile');
  assert.equal(freshResult.snapshotPath, null);

  console.log('pre-v4 recovery, interruption, verification and restore test passed');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
