// Electron 43 downloads its binary lazily. Resolve and launch it once, before
// node --test starts parallel workers that would otherwise extract the same app.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const expectedVersion = require('electron/package.json').version;
// The lazy download fetches a GitHub release asset, which answers 500 now and
// then; one hiccup should not fail a job whose whole purpose is to warm it up.
let executable;
for (let attempt = 1; ; attempt++) {
  try {
    executable = require('electron');
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    console.warn(`[test setup] Electron binary is not available yet (${String(error.message).split('\n')[0]}). Retrying (${attempt + 1}/3)`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
  }
}
const actualVersion = execFileSync(executable, ['-p', 'process.versions.electron'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
  timeout: 30_000,
}).trim();
if (actualVersion !== expectedVersion) {
  throw new Error(`Electron runtime mismatch: expected ${expectedVersion}, received ${actualVersion}. Reinstall the Electron binary before running tests.`);
}
console.log(`[test setup] Electron ${actualVersion} is installed and can start.`);
