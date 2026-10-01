// Portable invocation: the same TLS implementation and native canvas as the shipped app.
const { spawnSync } = require('node:child_process');
const electron = require('electron');
const result = spawnSync(electron, ['--test', 'scripts/test-presenter-lan.mjs'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 120000,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
