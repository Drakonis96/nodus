// CPU-profiles the renderer while one sidebar section opens.
//
// bench-section-render.mjs says *which* section blocks the window; this says what
// the renderer was doing while it did. It drives the real app over CDP, records a
// V8 profile across the click, and reports self time by function against the
// build's source map, so the names are the app's own rather than minified ones.
//
//   NODUS_USERDATA=<copy> BENCH_SECTION=Projects node scripts/bench-renderer-profile.mjs
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const userData = process.env.NODUS_USERDATA;
if (!userData) throw new Error('NODUS_USERDATA is required (point it at a COPY of the profile)');
const section = process.env.BENCH_SECTION ?? 'Projects';
const port = Number(process.env.BENCH_CDP_PORT ?? 9336);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, ['.', `--remote-debugging-port=${port}`], {
  cwd: process.cwd(),
  env: { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' },
  stdio: 'ignore',
});
function cleanup(code) {
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  try { execSync(`pkill -f "${userData}" || true`); } catch { /* gone */ }
  process.exit(code);
}

await sleep(Number(process.env.BENCH_BOOT_MS ?? 30_000));
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const main = targets.find((t) => t.url.includes('index.html'));
if (!main) { console.error('no se encontro la ventana principal'); cleanup(1); }

const ws = new WebSocket(main.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let nextId = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;

await evaluate(`(() => {
  for (const sel of ['.startup-update-primary', '.startup-update-close', '.whats-new-close']) {
    const el = document.querySelector(sel);
    if (el) { el.click(); return sel; }
  }
  return null;
})()`);
await sleep(2500);

const SECTION_BUTTONS = `[...document.querySelectorAll('nav[data-testid="resizable-sidebar"] button')].filter((b) => !b.hasAttribute('aria-expanded'))`;
const LABEL = `(b) => (b.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 26)`;
const click = () => evaluate(`(() => {
  const b = ${SECTION_BUTTONS}.find((x) => (${LABEL})(x) === ${JSON.stringify(section)});
  if (!b) return false;
  b.click();
  return true;
})()`);

// Visit once so the lazy chunk is loaded: the profile should show the section's
// steady-state cost, not a one-off module evaluation.
if (!(await click())) { console.error(`seccion "${section}" no encontrada`); cleanup(1); }
await sleep(3000);
await evaluate(`${SECTION_BUTTONS}.find((x) => (${LABEL})(x) === 'Home')?.click()`);
await sleep(2000);

await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 100 });
await send('Profiler.start');
await click();
await sleep(Number(process.env.BENCH_PROFILE_MS ?? 4000));
const { profile } = await send('Profiler.stop');

const outDir = process.env.BENCH_OUT_DIR ?? '.';
fs.writeFileSync(path.join(outDir, 'renderer.cpuprofile'), JSON.stringify(profile));

const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const delta = profile.timeDeltas[i] ?? 0;
  const id = profile.samples[i];
  self.set(id, (self.get(id) ?? 0) + Math.max(delta, 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const rows = [...self.entries()]
  .map(([id, us]) => {
    const frame = nodes.get(id).callFrame;
    const file = (frame.url || '').split('/').pop() || '';
    return { ms: us / 1000, label: `${frame.functionName || '(anon)'}  [${file}:${(frame.lineNumber ?? 0) + 1}]` };
  })
  .sort((a, b) => b.ms - a.ms);

console.log(`\nseccion: ${section}  ·  muestreado: ${(total / 1000).toFixed(0)} ms de CPU en el renderer\n`);
console.log(`${'self ms'.padStart(9)}  funcion`);
console.log('-'.repeat(92));
for (const row of rows.slice(0, 20)) {
  if (row.ms < 2) break;
  console.log(`${row.ms.toFixed(1).padStart(9)}  ${row.label.slice(0, 78)}`);
}

ws.close();
cleanup(0);
