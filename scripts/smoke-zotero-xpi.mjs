#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Opt-in live Zotero smoke test. It launches the real Zotero binary with a
// disposable profile, enables foreign-extension scanning only in that profile,
// and proves that the built XPI is registered, active and actually reaches its
// bootstrap startup. The user's Zotero profile and library are never opened.
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argValue = (name) => {
  const exact = process.argv.indexOf(name);
  if (exact >= 0) return process.argv[exact + 1];
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
};
const keepProfile = process.argv.includes('--keep-profile');
const timeoutMs = Number(argValue('--timeout-ms') || process.env.ZOTERO_SMOKE_TIMEOUT_MS || 90_000);
const xpiPath = path.resolve(argValue('--xpi') || path.join(repoRoot, 'dist-zotero', 'nodus-zotero.xpi'));
const defaultBins = {
  darwin: '/Applications/Zotero.app/Contents/MacOS/zotero',
  win32: 'C:\\Program Files\\Zotero\\zotero.exe',
  linux: '/usr/bin/zotero',
};
const zoteroBin = argValue('--zotero-bin') || process.env.ZOTERO_BIN || defaultBins[process.platform];

if (!zoteroBin || !existsSync(zoteroBin)) throw new Error(`Zotero binary not found: ${zoteroBin || '(unset)'}`);
if (!existsSync(xpiPath)) throw new Error(`XPI not found: ${xpiPath}`);
if (!Number.isFinite(timeoutMs) || timeoutMs < 5_000) throw new Error('--timeout-ms must be at least 5000');

const zip = new AdmZip(xpiPath);
for (const entry of zip.getEntries()) if (!entry.isDirectory) entry.getData();
const manifest = JSON.parse(zip.readAsText('manifest.json'));
const addon = manifest.applications?.zotero ?? {};
if (!addon.id || !manifest.version || !/^https:\/\//.test(addon.update_url ?? '')) {
  throw new Error('XPI manifest must include version, applications.zotero.id and the Zotero-required HTTPS update_url');
}

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'nodus-zotero-live-smoke-'));
const dataDir = path.join(profileDir, 'data');
const extensionsDir = path.join(profileDir, 'extensions');
const installedXpi = path.join(extensionsDir, `${addon.id}.xpi`);
mkdirSync(dataDir, { recursive: true });
mkdirSync(extensionsDir, { recursive: true });
cpSync(xpiPath, installedXpi);
writeFileSync(path.join(profileDir, 'prefs.js'), [
  'user_pref("extensions.startupScanScopes", 15);',
  'user_pref("extensions.autoDisableScopes", 0);',
  'user_pref("extensions.update.enabled", false);',
  'user_pref("extensions.zotero.httpServer.enabled", false);',
  'user_pref("extensions.zotero.useDataDir", true);',
  `user_pref("extensions.zotero.dataDir", ${JSON.stringify(dataDir)});`,
  '',
].join('\n'));

let output = '';
let child;
let succeeded = false;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readState = () => {
  const statePath = path.join(profileDir, 'extensions.json');
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return state.addons?.find((entry) => entry.id === addon.id) ?? null;
  } catch {
    return null;
  }
};
const startZotero = () => {
  output = '';
  const process = spawn(zoteroBin, ['-profile', profileDir, '-no-remote', '-ZoteroDebugText'], {
    env: { ...globalThis.process.env, MOZ_NO_REMOTE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => { output = (output + chunk.toString()).slice(-2_000_000); };
  process.stdout.on('data', append);
  process.stderr.on('data', append);
  return process;
};
const stopZotero = async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(2_000)]);
  }
};
const diagnostic = () => output.split('\n')
  .filter((line) => /nodus|extension is invalid|update_url|bootstrap|error/i.test(line))
  .slice(-80)
  .join('\n');

try {
  // Phase 1: let a completely fresh Zotero profile discover and register the
  // XPI. Zotero can finish first-run profile setup before invoking bootstrap,
  // so registration and runtime startup are intentionally separate gates.
  child = startZotero();
  const registrationDeadline = Date.now() + Math.max(15_000, Math.floor(timeoutMs / 2));
  let registered = false;
  while (Date.now() < registrationDeadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Zotero exited during registration with code ${child.exitCode}`);
    const state = readState();
    if (
      state?.version === manifest.version
      && state.active === true
      && state.appDisabled === false
      && state.userDisabled === false
      && state.seen === true
    ) {
      registered = true;
      break;
    }
    await wait(250);
  }
  if (!registered) {
    throw new Error(`Zotero did not register the XPI\nstate=${JSON.stringify(readState())}\n${diagnostic()}`);
  }
  await stopZotero();

  // Phase 2: prove that the registered add-on really executes bootstrap on a
  // normal subsequent launch and persists the per-add-on update opt-out.
  child = startZotero();
  const startupDeadline = Date.now() + timeoutMs;
  while (Date.now() < startupDeadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Zotero exited during startup with code ${child.exitCode}`);
    const state = readState();
    if (
      state?.version === manifest.version
      && state.active === true
      && state.appDisabled === false
      && state.userDisabled === false
      && state.applyBackgroundUpdates === 0
      && output.includes(`[Nodus] startup complete v${manifest.version}`)
    ) {
      succeeded = true;
      console.log(`Zotero live smoke passed: ${addon.id} v${manifest.version}`);
      console.log('registered=true active=true appDisabled=false userDisabled=false backgroundUpdates=disabled startup=true');
      break;
    }
    await wait(250);
  }
  if (!succeeded) {
    throw new Error(`Zotero did not start the registered add-on within ${timeoutMs} ms\nstate=${JSON.stringify(readState())}\n${diagnostic()}`);
  }
} finally {
  await stopZotero();
  if (keepProfile || !succeeded) console.error(`Live-smoke profile kept at ${profileDir}`);
  else rmSync(profileDir, { recursive: true, force: true });
}
