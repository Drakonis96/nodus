#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readdirSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyMacApp } = require('./verify-macos-code-signing.cjs');

function fail(message) {
  throw new Error(`[macOS artifact verification] ${message}`);
}

function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    fail(`${file} ${args.join(' ')} failed\n${error?.stdout ?? ''}${error?.stderr ?? ''}`.trim());
  }
}

function findApp(directory) {
  const direct = path.join(directory, 'Nodus.app');
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const found = findApp(path.join(directory, entry.name));
    if (found) return found;
  }
  return null;
}

function assertSameApp(candidate, expected, label) {
  const verified = verifyMacApp(candidate, { verifyEveryComponent: false });
  if (verified.teamId !== expected.teamId || verified.cdHash !== expected.cdHash) {
    fail(`${label} does not contain the exact signed Nodus.app that was verified before packaging`);
  }
}

function verifyRelease(releaseDirectory) {
  if (process.platform !== 'darwin') fail('artifact verification must run on macOS');
  const releaseDir = path.resolve(releaseDirectory);
  const appPath = findApp(releaseDir);
  const dmgPath = path.join(releaseDir, 'Nodus-mac-arm64.dmg');
  const zipPath = path.join(releaseDir, 'Nodus-mac-arm64.zip');
  for (const required of [appPath, dmgPath, zipPath]) {
    if (!required || !existsSync(required)) fail(`missing release output: ${required ?? 'Nodus.app'}`);
  }

  const expected = verifyMacApp(appPath, { verifyEveryComponent: true });
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'nodus-macos-release-'));
  const zipOutput = path.join(scratch, 'zip');
  const mountPoint = path.join(scratch, 'dmg');
  let mounted = false;
  try {
    run('/bin/mkdir', ['-p', zipOutput, mountPoint]);
    run('/usr/bin/ditto', ['-x', '-k', zipPath, zipOutput]);
    const zippedApp = findApp(zipOutput);
    if (!zippedApp) fail('the ZIP does not contain Nodus.app');
    assertSameApp(zippedApp, expected, 'ZIP');

    run('/usr/bin/hdiutil', ['attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mountPoint]);
    mounted = true;
    const dmgApp = findApp(mountPoint);
    if (!dmgApp) fail('the DMG does not contain Nodus.app');
    assertSameApp(dmgApp, expected, 'DMG');
  } finally {
    if (mounted) {
      try { run('/usr/bin/hdiutil', ['detach', mountPoint]); } catch { run('/usr/bin/hdiutil', ['detach', '-force', mountPoint]); }
    }
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log('[macOS release] Verified app, ZIP and DMG; publication may proceed');
}

if (require.main === module) verifyRelease(process.argv[2] ?? path.join(__dirname, '..', 'release'));

module.exports = { verifyRelease };
