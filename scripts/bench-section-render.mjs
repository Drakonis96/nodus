// Clicks through the sidebar in the real window and times what the user sees.
//
// The IPC bench measures the main process; this measures the renderer. They fail
// differently: a slow query makes the new section arrive late, while a long task
// in the renderer makes the whole window stop responding — the spinning beachball
// — even after the data is already there. So the headline number here is not the
// total but `peor tarea`: the longest single stretch the renderer's main thread
// went without yielding. Anything over ~50 ms drops frames; over ~200 ms feels
// like the app hung.
//
// Two passes: the first visit to a section also pays for its lazy-loaded chunk,
// the second is what navigating around actually costs.
//
//   NODUS_USERDATA=<copy> node scripts/bench-section-render.mjs
import { spawn, execSync } from 'node:child_process';
import WebSocket from 'ws';

const userData = process.env.NODUS_USERDATA;
if (!userData) throw new Error('NODUS_USERDATA is required (point it at a COPY of the profile)');
const port = Number(process.env.BENCH_CDP_PORT ?? 9333);
const settleMs = Number(process.env.BENCH_SETTLE_MS ?? 500);
const timeoutMs = Number(process.env.BENCH_TIMEOUT_MS ?? 12_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, ['.', `--remote-debugging-port=${port}`], {
  cwd: process.cwd(),
  env: { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' },
  stdio: 'ignore',
});

function cleanup(code) {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  try { execSync(`pkill -f "${userData}" || true`); } catch { /* already gone */ }
  process.exit(code);
}
process.on('SIGINT', () => cleanup(1));

await sleep(Number(process.env.BENCH_BOOT_MS ?? 30_000));

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const main = targets.find((t) => t.url.includes('index.html'));
if (!main) {
  console.error('no se encontro la ventana principal');
  cleanup(1);
}

const ws = new WebSocket(main.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let nextId = 0;
function evaluate(expression, awaitPromise = false) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const onMessage = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id !== id) return;
      ws.off('message', onMessage);
      if (msg.result?.exceptionDetails) reject(new Error(msg.result.exceptionDetails.text));
      else resolve(msg.result?.result?.value);
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise } }));
  });
}

// ── instrumentation, installed once in the page ─────────────────────────────
await evaluate(`
(() => {
  const bench = { longTasks: [], mutations: 0, lastMutation: 0, frames: 0, t0: 0 };
  window.__bench = bench;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) bench.longTasks.push({ start: entry.startTime, duration: entry.duration });
  }).observe({ entryTypes: ['longtask'] });
  new MutationObserver(() => { bench.mutations += 1; bench.lastMutation = performance.now(); })
    .observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  const tick = () => { bench.frames += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // A renderer long task and a blocked main process both show as a frozen window,
  // but only the first appears in PerformanceObserver: while the main process is
  // busy the renderer is simply idle, waiting for an IPC reply that is not coming.
  // So poll a trivial channel and record the worst round trip — that is the wait
  // the user actually sits through.
  bench.ipc = [];
  (async () => {
    for (;;) {
      const started = performance.now();
      try { await window.nodus.getQueue(); } catch { /* vault switching */ }
      bench.ipc.push({ start: started, rtt: performance.now() - started });
      if (bench.ipc.length > 4000) bench.ipc.splice(0, 2000);
      await new Promise((r) => setTimeout(r, 30));
    }
  })();
  window.__benchReset = () => {
    bench.longTasks.length = 0;
    bench.mutations = 0;
    bench.frames = 0;
    bench.ipc.length = 0;
    bench.t0 = performance.now();
    bench.lastMutation = bench.t0;
    return bench.t0;
  };
  window.__benchRead = () => ({
    now: performance.now(),
    t0: bench.t0,
    mutations: bench.mutations,
    lastMutation: bench.lastMutation,
    frames: bench.frames,
    longTasks: bench.longTasks.filter((t) => t.start >= bench.t0).map((t) => t.duration),
    ipc: bench.ipc.filter((s) => s.start >= bench.t0).map((s) => s.rtt),
  });
  return true;
})()
`);

// Any startup modal sits over the sidebar and would swallow the clicks.
await evaluate(`(() => {
  for (const sel of ['.startup-update-primary', '.startup-update-close', '.whats-new-close', '.roadmap-close']) {
    const el = document.querySelector(sel);
    if (el) { el.click(); return sel; }
  }
  return null;
})()`);
await sleep(2500);

// A sidebar button is either a section or a group toggle; only the toggles carry
// aria-expanded. Clicking a toggle reshuffles everything below it, which is why
// this matches on label rather than position and skips the toggles entirely.
const SECTION_BUTTONS = `[...document.querySelectorAll('nav[data-testid="resizable-sidebar"] button')].filter((b) => !b.hasAttribute('aria-expanded'))`;
const LABEL = `(b) => (b.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 26)`;

const listSections = () => evaluate(`JSON.stringify(${SECTION_BUTTONS}.map(${LABEL}).filter(Boolean))`).then((s) => JSON.parse(s || '[]'));

// Expand every collapsed group first, so the list is stable for both passes and a
// click never lands on a header that reshuffles everything below it.
for (let round = 0; round < 4; round++) {
  const before = (await listSections()).length;
  for (const label of await listSections()) {
    await evaluate(`(() => {
      for (const b of document.querySelectorAll('nav[data-testid="resizable-sidebar"] button[aria-expanded="false"]')) b.click();
      return true;
    })()`);
  }
  await sleep(300);
  if ((await listSections()).length === before) break;
}
const items = (await listSections()).map((label) => ({ label }));
console.log(`secciones encontradas en la barra lateral: ${items.length}\n`);

async function visit(item) {
  await evaluate(`window.__benchReset()`);
  const clicked = await evaluate(`(() => {
    const b = ${SECTION_BUTTONS}.find((x) => (${LABEL})(x) === ${JSON.stringify(item.label)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!clicked) return null;

  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(150);
    last = await evaluate(`JSON.stringify(window.__benchRead())`).then((s) => JSON.parse(s));
    if (last.mutations > 0 && last.now - last.lastMutation >= settleMs) break;
  }
  if (!last) return null;
  // Proof the click navigated rather than, say, being swallowed by an overlay: the
  // sidebar paints the active section. Without this check a row of zeros reads as
  // "instant" when it really means "nothing happened".
  const active = await evaluate(`(() => {
    const b = ${SECTION_BUTTONS}.find((x) => x.className.includes('bg-indigo'));
    return b ? (${LABEL})(b) : null;
  })()`);
  const total = Math.max(0, last.lastMutation - last.t0);
  const tasks = last.longTasks;
  return {
    label: item.label,
    total,
    blocked: tasks.reduce((sum, d) => sum + d, 0),
    worst: tasks.length ? Math.max(...tasks) : 0,
    tasks: tasks.length,
    ipcWorst: last.ipc.length ? Math.max(...last.ipc) : 0,
    mutations: last.mutations,
    landed: active === item.label,
    timedOut: last.now - last.lastMutation < settleMs,
  };
}

function table(title, rows) {
  console.log(`\n${title}`);
  const width = Math.max(...rows.map((r) => r.label.length), 12);
  console.log(`${'seccion'.padEnd(width)}  ${'render'.padStart(9)}  ${'peor tarea UI'.padStart(14)}  ${'peor espera IPC'.padStart(16)}`);
  console.log('-'.repeat(width + 48));
  for (const r of [...rows].sort((a, b) => Math.max(b.worst, b.ipcWorst) - Math.max(a.worst, a.ipcWorst))) {
    console.log(
      `${r.label.padEnd(width)}  ${r.total.toFixed(0).padStart(7)}ms  ${r.worst.toFixed(0).padStart(12)}ms  ${r.ipcWorst.toFixed(0).padStart(14)}ms${r.landed ? '' : '   (NO navego)'}${r.timedOut ? '   (no se estabiliza)' : ''}`
    );
  }
}

const first = [];
for (const item of items) {
  const result = await visit(item);
  if (result) first.push(result);
}
table('PRIMERA visita (incluye la carga del chunk de la vista)', first);

const second = [];
for (const item of items) {
  const result = await visit(item);
  if (result) second.push(result);
}
table('SEGUNDA visita (navegacion normal)', second);

ws.close();
cleanup(0);
