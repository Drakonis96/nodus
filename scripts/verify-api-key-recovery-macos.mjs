// Real macOS integration check for the 2.3.0 -> 2.3.1 Safe Storage migration.
// It creates only a throwaway profile and uses a synthetic value. No real Nodus
// profile or API key is read. This is intentionally separate from `npm test`
// because macOS may ask the user to authorize the historical Keychain item.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin') {
  console.log('[api-key-recovery] skipped: macOS-only Safe Storage migration');
  process.exit(0);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-api-key-recovery-'));
const seedProject = path.join(userData, 'legacy-app');
const seedApp = path.join(seedProject, 'main.cjs');
const packagedNodus = path.join(repoRoot, 'release/mac-arm64/Nodus.app/Contents/MacOS/Nodus');
const syntheticKey = `nodus-recovery-smoke-${process.pid}-${Date.now()}`;
let app = null;

try {
  assert.ok(existsSync(packagedNodus), 'package Nodus first with `npx electron-builder --mac --dir --arm64`');
  await mkdir(path.join(userData, 'secrets'), { recursive: true });
  await mkdir(seedProject, { recursive: true });
  await writeFile(path.join(seedProject, 'package.json'), JSON.stringify({
    name: 'nodus-legacy-safe-storage-smoke',
    version: '1.0.0',
    main: 'main.cjs',
    build: {
      appId: 'app.nodus.desktop',
      productName: 'nodus',
      electronVersion: '33.4.11',
      files: ['main.cjs', 'package.json'],
      directories: { output: 'out' },
      mac: { target: [{ target: 'dir', arch: ['arm64'] }] },
    },
  }, null, 2), 'utf8');
  await writeFile(seedApp, `
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setName('nodus');
app.setPath('userData', process.env.NODUS_USERDATA);
app.whenReady().then(() => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Safe Storage unavailable');
  const target = path.join(app.getPath('userData'), 'secrets', 'ai_key_gemini.bin');
  fs.writeFileSync(target, safeStorage.encryptString(process.env.NODUS_SYNTHETIC_KEY), { mode: 0o600 });
  app.quit();
}).catch((error) => { console.error(error.message); app.exit(1); });
`, 'utf8');

  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron-builder'), ['--projectDir', seedProject, '--mac', '--dir', '--arm64'], {
    cwd: repoRoot,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    stdio: 'inherit',
  });
  const legacyExecutable = path.join(seedProject, 'out/mac-arm64/nodus.app/Contents/MacOS/nodus');
  assert.ok(existsSync(legacyExecutable), 'legacy lowercase app bundle was built');
  const seedEnv = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_SYNTHETIC_KEY: syntheticKey,
  };
  delete seedEnv.ELECTRON_RUN_AS_NODE;
  execFileSync(legacyExecutable, [], { cwd: repoRoot, env: seedEnv, stdio: 'inherit' });

  const appEnv = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
  };
  delete appEnv.ELECTRON_RUN_AS_NODE;
  delete appEnv.NODUS_SYNTHETIC_KEY;
  app = await electron.launch({ executablePath: packagedNodus, env: appEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(120_000);
  await page.waitForFunction(() => typeof window.nodus?.getSettings === 'function');
  // Startup performs the same recovery automatically. Invoke the public retry
  // once as well so this check covers the Settings button path and remains
  // deterministic if a first Keychain authorization prompt was dismissed.
  const initialSettings = await page.evaluate(() => window.nodus.getSettings());
  if (!initialSettings.providerKeys.gemini) await page.evaluate(() => window.nodus.recoverApiKeys());
  await page.waitForFunction(async () => {
    if (typeof window.nodus?.getSettings !== 'function') return false;
    const settings = await window.nodus.getSettings();
    return settings.providerKeys.gemini === true && !settings.lockedProviderKeys.includes('gemini');
  });

  const archiveDir = path.join(userData, 'secrets', 'locked-archive');
  const archived = await readdir(archiveDir);
  assert.ok(archived.some((name) => name.startsWith('ai_key_gemini-')), 'the original locked blob is archived');

  for (const file of [path.join(userData, 'secrets', 'ai_key_gemini.bin'), ...archived.map((name) => path.join(archiveDir, name))]) {
    assert.equal((await readFile(file)).includes(Buffer.from(syntheticKey)), false, `${path.basename(file)} does not contain plaintext`);
  }
  console.log('[api-key-recovery] legacy key recovered, re-encrypted and archived safely');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true });
}
