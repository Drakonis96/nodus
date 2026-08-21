// Build and run one of the headless smoke scripts in scripts/smoke-*.ts.
//
// They need better-sqlite3's Electron ABI, so they run under `electron` with
// ELECTRON_RUN_AS_NODE and the electron module stubbed. Native-only packages are
// left external because esbuild cannot bundle a .node binary.
//
//   npm run smoke:author-roles
//   NODUS_TEST_USERDATA=/path/to/vault-copy npm run smoke:author-roles:realcopy
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name) {
  console.error('usage: node scripts/run-smoke.mjs <smoke-script-name> [-- extra electron args]');
  process.exit(2);
}

// The bundle lives in the repo root, not a temp dir: the native packages left
// external are resolved relative to the bundle's own location.
const bundle = path.join(root, `.${name}.cjs`);
execFileSync(
  path.join(root, 'node_modules/.bin/esbuild'),
  [
    path.join(root, 'scripts', `${name}.ts`),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${bundle}`,
    '--external:better-sqlite3',
    '--external:onnxruntime-node',
    '--external:@napi-rs/canvas',
    `--alias:electron=${path.join(root, 'scripts/stub-electron.mjs')}`,
  ],
  { cwd: root, stdio: 'inherit' }
);

// A smoke run must never touch the live vault: without an explicit directory it
// gets a throwaway one.
const userData = process.env.NODUS_TEST_USERDATA || mkdtempSync(path.join(os.tmpdir(), 'nodus-smoke-userdata-'));
execFileSync(path.join(root, 'node_modules/.bin/electron'), [bundle], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODUS_TEST_USERDATA: userData },
  stdio: 'inherit',
});
