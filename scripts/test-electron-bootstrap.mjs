import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bootstrap = () => spawnSync(process.execPath, ['scripts/prepare-electron-tests.mjs'], {
  cwd: root, encoding: 'utf8', timeout: 60_000,
});

test('npm test prepares and verifies Electron before launching parallel test workers', () => {
  assert.equal(packageJson.scripts.pretest, 'node scripts/prepare-electron-tests.mjs');
  const result = bootstrap();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Electron ${require('electron/package.json').version} is installed and can start.`));
});

test('an unusable Electron distribution fails the prerequisite instead of starting tests', () => {
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-electron-bootstrap-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/prepare-electron-tests.mjs'], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: missing },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOENT/);
    assert.doesNotMatch(result.stdout, /installed and can start/);
  } finally { fs.rmSync(missing, { recursive: true, force: true }); }
});
