import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

// ELECTRON_RUN_AS_NODE is useful for scripts that intentionally run the Electron
// binary as plain Node, but it also propagates into vite-plugin-electron's child
// process. In that mode Electron exposes Node's module loader instead of its
// runtime API, so imports such as `app` fail and the dev server exits. Keep the
// parent environment unchanged and remove the flag only from the Vite process.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const viteCli = path.resolve('node_modules/vite/bin/vite.js');
const viteArgs = process.argv.slice(2);
// Rebuild Vite's dependency cache on each dev start. This prevents an old
// optimized Milkdown/editor chunk from being served as a 504 after switching
// branches or reinstalling dependencies.
if (!viteArgs.includes('--force')) viteArgs.unshift('--force');

const child = spawn(process.execPath, [viteCli, ...viteArgs], {
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('error', (error) => {
  console.error('[dev] failed to start Vite:', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
