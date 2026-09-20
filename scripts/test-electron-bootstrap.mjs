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

test('local and CI test commands prepare Electron before launching parallel test workers', () => {
  assert.equal(packageJson.scripts.pretest, 'node scripts/prepare-electron-tests.mjs');
  assert.equal(packageJson.scripts['pretest:ci'], packageJson.scripts.pretest);
  const result = bootstrap();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Electron ${require('electron/package.json').version} is installed and can start.`));
});

test('npm run test:ci stops before the test runner when Electron preparation fails', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-electron-ci-lifecycle-'));
  try {
    // Exercise npm's lifecycle ordering without launching the entire suite or
    // modifying the shared Electron installation used by other test workers.
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ scripts: {
      'pretest:ci': packageJson.scripts['pretest:ci'],
      'test:ci': 'node -e "console.log(\'TEST_RUNNER_STARTED\')"',
    } }));
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.writeFileSync(path.join(fixture, 'scripts/prepare-electron-tests.mjs'),
      `import ${JSON.stringify(new URL('./prepare-electron-tests.mjs', import.meta.url).href)};`);
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:ci'], {
      cwd: fixture, encoding: 'utf8', timeout: 30_000,
      shell: process.platform === 'win32',
      env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: fixture, npm_config_ignore_scripts: 'false' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOENT/);
    assert.doesNotMatch(result.stdout, /TEST_RUNNER_STARTED/);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
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
