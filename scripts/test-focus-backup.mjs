import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
if (!process.versions.electron) {
  execFileSync(require('electron'), [process.argv[1]], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}
const root = mkdtempSync(path.join(os.tmpdir(), 'nodus-focus-backup-test-'));
globalThis.__focusRoot = root;
try {
  const bundle = path.join(root, 'runtime.cjs');
  await build({ entryPoints: ['electron/study/focusRuntime.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'isolated-profile', setup(build) {
      build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve('better-sqlite3'), external: true }));
      build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
      build.onResolve({ filter: /vaults\/vaultRegistry$/ }, () => ({ path: 'vaults', namespace: 'fixture' }));
      build.onResolve({ filter: /db\/database$/ }, () => ({ path: 'database', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'electron'
        ? 'export const app = { getPath: () => globalThis.__focusRoot };'
        : path === 'vaults' ? "export const getActiveVault = () => ({ id: 'a', name: 'A', type: 'academic' }); export const listVaults = () => [];"
          : "export function getDb() { throw new Error('A subject was requested outside its vault'); }" }));
    } }] });
  const runtime = require(bundle);
  const service = runtime.getGlobalFocusService();
  service.act('start', service.snapshot().revision, null, 'Backup');
  await new Promise(resolve => setTimeout(resolve, 30));
  const bytes = await runtime.snapshotGlobalFocusForBackup();
  assert.equal(service.snapshot().status, 'running', 'taking a backup never pauses Focus');
  assert.ok(bytes.subarray(0, 15).equals(Buffer.from('SQLite format 3')));
  const invalid = path.join(root, 'invalid.sqlite');
  writeFileSync(invalid, 'damaged');
  assert.throws(() => runtime.restoreGlobalFocusBackupFile(invalid));
  assert.equal(runtime.getGlobalFocusService(), service, 'an invalid backup leaves the live service intact');
  assert.equal(service.snapshot().status, 'running');
  const id = service.snapshot().sessionId;
  service.act('finish', service.snapshot().revision);
  const staged = path.join(root, 'staged.sqlite'); writeFileSync(staged, bytes);
  runtime.restoreGlobalFocusBackupFile(staged);
  const recovered = runtime.getGlobalFocusSnapshot();
  assert.equal(recovered.state.sessionId, id); assert.equal(recovered.state.status, 'paused');
  assert.equal(recovered.state.recovered, true); assert.ok(recovered.state.elapsedMs > 0);
  const stats = runtime.getGlobalFocusService().stats();
  assert.equal(stats.recent[0].vaults[0].vaultId, 'a');
  assert.equal(stats.recent[0].milliseconds, recovered.state.elapsedMs);
  runtime.closeGlobalFocusRuntime();
  console.log('Focus backup verified: consistent SQLite snapshot, uninterrupted timer, invalid restore protection and paused recovery.');
} finally { delete globalThis.__focusRoot; rmSync(root, { recursive: true, force: true }); }
