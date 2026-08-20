import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleaseChannel } from './verify-release-channel.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-update-channels-'));
const bundle = path.join(outDir, 'updateChannel.cjs');

execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'electron/updateChannel.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=es2022',
  `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'inherit' });

const { applyUpdateChannel, isPrereleaseVersion } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

test('stable is the default preference and the beta choice is app-wide', async () => {
  const [types, defaults, prefs] = await Promise.all([
    read('shared/types.ts'),
    read('electron/db/settingsRepo.ts'),
    read('electron/db/appPrefs.ts'),
  ]);
  assert.match(types, /betaUpdates: boolean/);
  assert.match(defaults, /betaUpdates: false/);
  assert.match(prefs, /'betaUpdates'/);
});

test('selecting either feed keeps downgrades disabled', () => {
  for (const betaUpdates of [false, true]) {
    const updater = { channel: null, allowPrerelease: false, allowDowngrade: true };
    const channel = applyUpdateChannel(updater, betaUpdates);
    assert.equal(channel, betaUpdates ? 'beta' : 'latest');
    assert.equal(updater.channel, channel);
    assert.equal(updater.allowPrerelease, betaUpdates);
    assert.equal(updater.allowDowngrade, false);
  }
  assert.equal(isPrereleaseVersion('3.3.0-beta.1'), true);
  assert.equal(isPrereleaseVersion('3.3.0'), false);
});

test('opting out cancels a pending prerelease and blocks its installation', async () => {
  const [main, ipc] = await Promise.all([read('electron/main.ts'), read('electron/ipc.ts')]);
  assert.match(main, /activeUpdateCancellationToken\?\.cancel\(\)/);
  assert.match(main, /suppressAutoInstallOnQuitUntilRestart = true/);
  assert.match(main, /isPrereleaseVersion\(downloadedUpdateVersion\) && !getSettings\(\)\.betaUpdates/);
  assert.match(ipc, /updateChannelChanged\(next\.betaUpdates\)/);
});

test('beta installation is fail-closed behind a verified pre-update snapshot', async () => {
  const [main, backups, types] = await Promise.all([
    read('electron/main.ts'),
    read('electron/export/autoBackup.ts'),
    read('shared/types.ts'),
  ]);
  assert.match(main, /prerelease && !recoveryReady/);
  assert.match(main, /errorCode: 'pre-update-backup-required'/);
  assert.match(main, /await runPreUpdateBackupNow\(app\.getVersion\(\), targetVersion\)/);
  assert.match(main, /if \(!backup\.ok\)[\s\S]*if \(prerelease\)[\s\S]*pre-update-backup-failed/);
  assert.match(main, /if \(prerelease \|\| recoveryConfigured\)/, 'stable attempts the snapshot whenever a Recovery folder is configured');
  assert.match(main, /stable pre-update backup failed; continuing without blocking stable/, 'stable preserves its non-blocking contract');
  assert.match(main, /autoUpdater\.autoInstallOnAppQuit = false/);
  assert.match(backups, /await verifyBackupFileInUtility\(target, password\)/, 'pre-update verification uses the backup utility process');
  assert.match(backups, /selectPreUpdateBackupsToPrune/);
  assert.match(types, /'backing-up'/);
});

test('the Settings opt-in is confirmed and checks immediately after acceptance', async () => {
  const settings = await read('src/views/Settings.tsx');
  assert.match(settings, /data-testid="toggle-beta-updates"/);
  assert.match(settings, /if \(event\.target\.checked\) setConfirmBetaUpdates\(true\)/);
  assert.match(settings, /await patch\(\{ betaUpdates: true \}\);\s*await checkForUpdates\(\);/);
  assert.match(settings, /recomendado únicamente para testers/);
  assert.match(settings, /pueden contener errores o ser inestables/);
  assert.match(settings, /Si Recuperación no está configurada o la copia falla, la beta no se instalará/);
});

test('stable and beta publication have isolated entry points and shared build logic', async () => {
  const [stable, beta, shared, pkgText] = await Promise.all([
    read('.github/workflows/release.yml'),
    read('.github/workflows/release-beta.yml'),
    read('.github/workflows/release-build.yml'),
    read('package.json'),
  ]);
  const pkg = JSON.parse(pkgText);
  assert.match(stable, /'!v\*-\*'/, 'stable tags explicitly exclude prereleases');
  assert.match(stable, /channel: latest/);
  assert.match(beta, /v\*-beta\.\*/);
  assert.match(beta, /channel: beta/);
  assert.match(stable, /uses: \.\/\.github\/workflows\/release-build\.yml/);
  assert.match(beta, /uses: \.\/\.github\/workflows\/release-build\.yml/);
  assert.equal(pkg.build.publish[0].channel, 'latest');
  assert.match(shared, /beta-mac\.yml beta\.yml beta-linux\.yml/);
  assert.match(shared, /Beta release contains stable update manifest/);
  assert.match(shared, /--prerelease --latest=false/);
  assert.match(shared, /os: macos-15-intel/, 'macOS packaging stays on the explicit Intel runner used for cross-building');
  assert.doesNotMatch(shared, /- os: macos-latest/, 'release packaging does not depend on the moving macOS runner alias');
  assert.match(shared, /node node_modules\/electron\/install\.js/, 'release runners install Electron legal files before packaging');

  const lock = JSON.parse(await read('package-lock.json'));
  const nativePackages = [
    '@esbuild/darwin-x64',
    '@esbuild/linux-x64',
    '@esbuild/win32-x64',
    '@github/copilot-darwin-x64',
    '@github/copilot-linux-x64',
    '@github/copilot-win32-x64',
    '@img/sharp-darwin-x64',
    '@img/sharp-linux-x64',
    '@img/sharp-win32-x64',
    '@koromix/koffi-darwin-x64',
    '@koromix/koffi-linux-x64',
    '@koromix/koffi-win32-x64',
    '@napi-rs/canvas-darwin-x64',
    '@napi-rs/canvas-linux-x64-gnu',
    '@napi-rs/canvas-win32-x64-msvc',
    '@openai/codex-darwin-x64',
    '@openai/codex-linux-x64',
    '@openai/codex-win32-x64',
    '@rollup/rollup-darwin-x64',
    '@rollup/rollup-linux-x64-gnu',
    '@rollup/rollup-win32-x64-msvc',
  ];
  for (const packageName of nativePackages) {
    assert.ok(lock.packages[`node_modules/${packageName}`], `${packageName} is locked for release runners`);
  }
  assert.equal(lock.packages['node_modules/@koromix/koffi-darwin-x64'].version, '3.1.1');
  assert.equal(lock.packages['node_modules/@rollup/rollup-darwin-x64'].version, '4.62.0');

  const configPath = require.resolve(path.join(repoRoot, 'build/electron-builder.release.cjs'));
  const previousChannel = process.env.NODUS_RELEASE_CHANNEL;
  process.env.NODUS_RELEASE_CHANNEL = 'beta';
  delete require.cache[configPath];
  const betaConfig = require(configPath);
  assert.equal(betaConfig.publish[0].channel, 'beta');
  if (previousChannel === undefined) delete process.env.NODUS_RELEASE_CHANNEL;
  else process.env.NODUS_RELEASE_CHANNEL = previousChannel;
});

test('release version validation cannot cross channels', () => {
  assert.doesNotThrow(() => validateReleaseChannel('latest', 'v3.3.0', '3.3.0'));
  assert.doesNotThrow(() => validateReleaseChannel('beta', 'v3.3.0-beta.2', '3.3.0-beta.2'));
  assert.throws(() => validateReleaseChannel('latest', 'v3.3.0-beta.2', '3.3.0-beta.2'));
  assert.throws(() => validateReleaseChannel('beta', 'v3.3.0', '3.3.0'));
  assert.throws(() => validateReleaseChannel('beta', 'v3.3.0-beta.3', '3.3.0-beta.2'));
});
