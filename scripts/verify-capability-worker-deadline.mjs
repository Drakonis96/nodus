// The worker readiness deadline must measure the worker, not the host's backlog.
//
// This is the 5.4.0 failure, reproduced. The capability migration runs inside
// `app.whenReady()`, which is the busiest moment of a launch, and the deadline was a
// `setTimeout` armed at `fork`. Timers and the child's messages share the main process's
// one event loop: while it is blocked neither runs, and when it frees libuv drains the
// timers phase before the I/O phase — so the deadline fired first and a worker that had
// not yet been given the chance to spawn was reported as one that would not start. The
// user saw "nodus:chemistry did not start." for a worker that handshakes in 136 ms.
//
// Electron exits 0 on SIGTERM, so a hang would otherwise read as a pass: the child reports
// through a verdict file, and its absence is the failure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-worker-deadline-'));

/** Long enough to blow the 20-second readiness budget several times over if the budget is
 *  still being spent on the host. Kept just over it so the check stays quick. */
const BLOCK_MS = 22_000;

try {
  // A capability that does nothing but answer. What is under test is the handshake, so the
  // module is deliberately trivial: any load cost of its own would muddy the measurement.
  const entry = path.join(temporary, 'worker.cjs');
  fs.writeFileSync(entry, `
    module.exports = async () => ({
      health: async () => ({ status: 'ready', dataVersion: 0 }),
      invoke: async () => ({}),
      renderArtifact: async () => ({}),
      shutdown: async () => {},
    });
  `);

  const bootstrap = path.join(temporary, 'capabilityWorkerBootstrap.js');
  await build({
    entryPoints: [path.join(root, 'electron/capabilities/workerBootstrap.ts')],
    outfile: bootstrap, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent',
  });

  const verdict = path.join(temporary, 'verdict.json');
  const outfile = path.join(temporary, 'main.cjs');
  await build({
    stdin: {
      contents: `
        import { app } from 'electron';
        import fs from 'node:fs';
        import { CapabilityWorkerHandle } from './electron/capabilities/workerHost';

        app.setPath('userData', ${JSON.stringify(temporary)});
        app.on('window-all-closed', () => {});

        const runtime = {
          capabilityId: 'nodus:test',
          plugin: { id: 'test', version: '1.0.0', digest: 'd'.repeat(64) },
          manifest: {},
          entryPath: ${JSON.stringify(entry)},
          permissions: {},
        };

        app.whenReady().then(async () => {
          const report = (value) => { fs.writeFileSync(${JSON.stringify(verdict)}, JSON.stringify(value)); app.exit(0); };
          const handle = new CapabilityWorkerHandle(runtime, {
            bootstrapPath: ${JSON.stringify(bootstrap)},
            services: async () => { throw new Error('the fixture asks the host for nothing'); },
          });
          try {
            const started = Date.now();
            // Forking happens synchronously inside the call, so the block below lands in
            // exactly the window the launch used to occupy.
            const pending = handle.call('health', {}, { timeoutMs: 60000 });
            const until = Date.now() + ${BLOCK_MS};
            while (Date.now() < until) { /* the main thread, busy, as at launch */ }
            const blocked = Date.now() - started;
            const health = await pending;
            await handle.stop();
            report({ ok: true, blocked, health });
          } catch (error) {
            report({ ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        });
      `,
      resolveDir: root, loader: 'ts',
    },
    outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent',
  });

  const electron = createRequire(path.join(root, 'package.json'))('electron');
  await promisify(execFile)(electron, [outfile], {
    env: { ...process.env, NODUS_DISABLE_AUTO_UPDATE: '1' },
    timeout: BLOCK_MS + 90_000,
  }).catch(error => { if (!fs.existsSync(verdict)) throw error; });

  assert.ok(fs.existsSync(verdict), 'the child never reported: the worker host hung');
  const result = JSON.parse(fs.readFileSync(verdict, 'utf8'));
  assert.ok(result.ok, `a healthy worker was refused after a busy main thread: ${result.error}`);
  assert.ok(result.blocked >= BLOCK_MS, `the main thread was not actually blocked (${result.blocked} ms)`);
  assert.equal(result.health.status, 'ready');
  console.log(`OK: the worker handshake survived ${Math.round(result.blocked / 1000)}s of a blocked main thread.`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
