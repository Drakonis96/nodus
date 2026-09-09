// Electron 43 downloads its binary lazily. Resolve and launch it once, before
// node --test starts parallel workers that would otherwise extract the same app.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const expectedVersion = require('electron/package.json').version;
const executable = require('electron');
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
