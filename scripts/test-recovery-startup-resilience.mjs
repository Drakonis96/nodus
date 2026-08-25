import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const source = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
let forkRecoveryUtility = () => { throw new Error('unexpected recovery utility launch'); };
installRuntimeHooks(os.tmpdir(), { utilityProcess: { fork: (...args) => forkRecoveryUtility(...args) } });

test('cached recovery probes never open unindexed cloud archives', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-recovery-index-'));
  try {
    const paths = require(path.join(repoRoot, 'electron/recovery/recoveryPaths.ts'));
    const probe = require(path.join(repoRoot, 'electron/recovery/recoveryFolderProbe.ts'));
    paths.writeRecoveryManifest(root, paths.createRecoveryManifest());
    const snapshotsDir = paths.recoverySnapshotsDir(root);
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const indexedPath = path.join(snapshotsDir, 'indexed.nodus');
    fs.writeFileSync(indexedPath, 'index owns startup metadata');
    probe.recordVerifiedRecoverySnapshot(root, {
      fileName: 'indexed.nodus', path: indexedPath, date: '2026-08-25T08:42:12.583Z',
      appVersion: '4.2.5', schemaVersion: 154, vaultCount: 2, bytes: 26, includesSecrets: true,
    });
    fs.writeFileSync(path.join(snapshotsDir, 'cloud-placeholder.nodus'), 'not a zip');

    const cached = probe.probeRecoveryFolder(root, 'cached');
    assert.equal(cached.kind, 'recovery');
    assert.deepEqual(cached.snapshots.map((item) => item.fileName), ['indexed.nodus']);
    assert.equal(cached.snapshots[0].path, indexedPath, 'paths are rebuilt safely from the selected root');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a non-responsive recovery utility is killed at its deadline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-recovery-timeout-'));
  const worker = path.join(root, 'recoveryProbeUtilityWorker.js');
  fs.writeFileSync(worker, '// existence sentinel');
  let kills = 0;
  class SilentChild extends EventEmitter {
    postMessage() { /* intentionally never answers */ }
    kill() { kills += 1; return true; }
  }
  forkRecoveryUtility = () => new SilentChild();
  process.env.NODUS_RECOVERY_PROBE_UTILITY_FILE = worker;
  const keepAlive = setInterval(() => {}, 100);
  try {
    const host = require(path.join(repoRoot, 'electron/recovery/recoveryProbeUtilityHost.ts'));
    const started = Date.now();
    await assert.rejects(
      host.probeRecoveryFolderInUtility('/cloud/placeholder', 'cached', 25),
      /exceeded 25 ms/,
    );
    assert.ok(Date.now() - started < 1_000, 'the main process receives a bounded answer');
    assert.equal(kills, 1, 'the wedged child is reaped without awaiting its filesystem call');
  } finally {
    clearInterval(keepAlive);
    delete process.env.NODUS_RECOVERY_PROBE_UTILITY_FILE;
    forkRecoveryUtility = () => { throw new Error('unexpected recovery utility launch'); };
    await rm(root, { recursive: true, force: true });
  }
});

test('startup and interactive folder reads both cross the utility boundary', () => {
  const manager = source('electron/recovery/recoveryManager.ts');
  const ipc = source('electron/ipc.ts');
  const vite = source('vite.config.ts');
  assert.match(manager, /export async function getRecoveryStatus\(\): Promise<RecoveryStatus>/);
  assert.match(manager, /'cached',[\s\S]{0,100}STARTUP_RECOVERY_PROBE_TIMEOUT_MS/);
  assert.match(manager, /\.catch\(\(\) => null\)/, 'startup degrades to last-known health instead of rejecting');
  assert.match(ipc, /inspectRecoveryFolderSafely\(filePaths\[0\], language, 'deep'\)/);
  assert.match(vite, /utilityBuild\('recoveryProbeUtilityWorker'/);
});

test('the protection loading mark cycles through vault colours without JavaScript work', () => {
  const component = source('src/components/RecoveryStatusLoading.tsx');
  const startup = source('src/app/StartupGate.tsx');
  const css = source('src/index.css');
  assert.match(startup, /render: \(\) => <RecoveryStatusLoading \/>/);
  assert.match(component, />NODUS RESEARCH<\/span>/);
  assert.match(component, /import nodusLogo from '\.\.\/assets\/nodus-logo\.svg'/);
  assert.match(component, /nodusLogoGold/);
  assert.match(component, /nodusLogoCrimson/);
  assert.match(component, /nodusLogoTeal/);
  assert.match(component, /nodusLogoOrange/);
  assert.match(component, /nodusLogoViolet/);
  assert.match(component, /nodusLogoCyan/);
  assert.match(component, /VAULT_LOGOS\.map\(\(src\) => <img/);
  assert.doesNotMatch(component, /<svg|<path|<circle/, 'the official assets are used without recreating their geometry');
  assert.doesNotMatch(component, /requestAnimationFrame|setInterval|canvas|WebGL/i);
  assert.match(css, /contain: layout paint/);
  assert.match(css, /animation: startup-protection-vault-logos 7s linear infinite/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css.match(/\/\* Startup protection probe:[\s\S]*?\.reduce-motion \.startup-protection-logo-stack img:first-child \{[^}]+\}/)?.[0] ?? '', /filter|box-shadow/);
});
