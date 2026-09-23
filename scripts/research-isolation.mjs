import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function createResearchTestRoot() {
  // Keep Unix socket paths below sockaddr_un's limit (the Darwin user temp
  // directory plus a profile suffix can already exceed it).
  const parent = process.env.NODUS_ISOLATED_ROOT
    ? path.join(fs.realpathSync(process.env.NODUS_ISOLATED_ROOT), 'tmp')
    : process.platform === 'darwin' ? '/private/tmp' : os.tmpdir();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(parent, 'nodus-research-')));
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({
    format: 'nodus.isolated-research-profile/1', root,
  }), { mode: 0o600 });
  for (const name of ['profile', 'tmp', 'library', 'fixtures', 'artifacts', 'zotero', 'mcp']) {
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  }
  return root;
}

/** Construct from an allowlist; never inherit provider keys, proxies or NODE_OPTIONS. */
export function researchTestEnvironment(root) {
  const env = {};
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'DISPLAY', 'XAUTHORITY', 'SystemRoot', 'WINDIR']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, XDG_CONFIG_HOME: path.join(root, 'profile/config'), XDG_CACHE_HOME: path.join(root, 'profile/cache'),
    NODUS_ISOLATED_ROOT: root, NODUS_USERDATA: path.join(root, 'profile'),
    NODUS_ZOTERO_SQLITE: path.join(root, 'fixtures/no-production-zotero.sqlite'),
    // No test may silently fall back to the user's running Zotero on 23119.
    NODUS_ZOTERO_API_BASE: 'http://127.0.0.1:1/api',
    NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available',
    TMPDIR: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TEMP: path.join(root, 'tmp') };
}

export function macResearchSandbox(root) {
  if (process.platform !== 'darwin') throw new Error('Use a disposable native test environment on this platform');
  const quoted = JSON.stringify(fs.realpathSync(root));
  const productionRoots = [
    path.join(os.homedir(), 'Library/Application Support/Nodus'),
    path.join(os.homedir(), 'Library/Application Support/nodus'),
    path.join(os.homedir(), 'Library/Application Support/Zotero'),
    path.join(os.homedir(), 'Zotero'),
    path.join(os.homedir(), '.config/zotero-mcp'),
    path.join(os.homedir(), '.cache/zotero-mcp'),
  ];
  // The descendants inherit the OS sandbox. /dev/null is the sole writable device.
  return `(version 1)\n(allow default)\n` +
    `(deny network-outbound (remote ip "localhost:23119"))\n` +
    `(deny file-write* (require-not (require-any (subpath ${quoted}) (literal "/dev/null"))))\n` +
    productionRoots.map(value => `(deny file-read* (subpath ${JSON.stringify(value)}))`).join('\n') + '\n' +
    '(deny network-outbound (require-not (remote ip "localhost:*")))\n';
}

export function verifyResearchSandbox(root, profile = macResearchSandbox(root)) {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-sandbox-sentinel-'));
  const canary = path.join(outside, 'sentinel');
  const inside = path.join(root, 'tmp', 'allowed');
  fs.writeFileSync(canary, 'unchanged');
  try {
    const result = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e',
      'const fs=require("node:fs");fs.writeFileSync(process.argv[1],"allowed");try{fs.writeFileSync(process.argv[2],"changed");process.exit(2)}catch(e){if(e.code!=="EPERM"&&e.code!=="EACCES")throw e}',
      inside, canary], { env: researchTestEnvironment(root), encoding: 'utf8' });
    if (result.status !== 0 || fs.readFileSync(canary, 'utf8') !== 'unchanged'
        || fs.readFileSync(inside, 'utf8') !== 'allowed') {
      throw new Error(`OS isolation verification failed: ${result.stderr || result.error || result.status}`);
    }
    return { writeInsideAllowed: true, writeOutsideDenied: true };
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
}
