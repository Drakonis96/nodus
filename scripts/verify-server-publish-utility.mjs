// Launch the real Electron utility-process acceptance fixture. A small app directory is
// used because Electron treats a direct .mjs path inconsistently across CLI/platform builds.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/electron'),
  [path.join(repoRoot, 'scripts/fixtures/server-publish-utility-app')],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, NODUS_REPO_ROOT: repoRoot, NODUS_DISABLE_AUTO_UPDATE: '1' },
  },
);
