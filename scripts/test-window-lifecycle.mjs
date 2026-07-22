// Regression coverage for macOS window reactivation. Closing Nodus destroys both
// the main window and Nodi's always-on-top window while the process keeps running;
// reopening must recreate the main window and then restore Nodi from settings.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-window-lifecycle-test-'));

try {
  const outfile = path.join(tmp, 'windowLifecycle.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/windowLifecycle.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { restoreAppWindows } = await import(pathToFileURL(outfile).href);

  test('recreates the main window before restoring the floating mascot', () => {
    const calls = [];
    restoreAppWindows(null, () => calls.push('main'), () => calls.push('mascot'));
    assert.deepEqual(calls, ['main', 'mascot']);
  });

  test('recreates a destroyed main window before restoring the floating mascot', () => {
    const calls = [];
    restoreAppWindows(
      { isDestroyed: () => true },
      () => calls.push('main'),
      () => calls.push('mascot'),
    );
    assert.deepEqual(calls, ['main', 'mascot']);
  });

  test('restores the floating mascot without duplicating a live main window', () => {
    const calls = [];
    restoreAppWindows(
      { isDestroyed: () => false },
      () => calls.push('main'),
      () => calls.push('mascot'),
    );
    assert.deepEqual(calls, ['mascot']);
  });

  test('both process reactivation paths restore the persisted mascot state', async () => {
    const main = await readFile(path.join(repoRoot, 'electron/main.ts'), 'utf8');
    assert.match(
      main,
      /app\.on\('second-instance',[\s\S]*?restoreAppWindows\(mainWindow, createWindow, applyMascotWindow\)/,
    );
    assert.match(
      main,
      /app\.on\('activate',[\s\S]*?restoreAppWindows\(mainWindow, createWindow, applyMascotWindow\)/,
    );
    assert.doesNotMatch(
      main,
      /app\.on\('activate',[\s\S]*?BrowserWindow\.getAllWindows\(\)\.length === 0/,
      'activation must key off the main window, not all windows, because Nodi is a BrowserWindow too',
    );
  });
} finally {
  await rm(tmp, { recursive: true, force: true });
}
