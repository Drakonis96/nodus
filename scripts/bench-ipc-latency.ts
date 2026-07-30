// Measures how long each main-process IPC handler blocks, against whatever vault
// NODUS_TEST_USERDATA points at. Every handler runs on the single main-process
// event loop that also services the renderer's invokes, so a handler that takes
// N ms is N ms during which the UI cannot get an answer to anything.
//
// The `electron` module is aliased to a stub that captures ipcMain.handle instead
// of registering it, so the real handlers can be called directly here.
//
// Run via scripts/run-bench-ipc.mjs (it does the esbuild + Electron-node dance).
import { HANDLERS } from 'electron';
import { registerIpc } from '../electron/ipc';

interface Case {
  channel: string;
  args?: unknown[];
  label: string;
}

const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);

function stats(samples: number[]): { min: number; med: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    min: sorted[0],
    med: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
}

/**
 * The number that decides whether a slow handler is *felt*: a 10 ms heartbeat
 * records the longest gap between two ticks while the handler runs. That gap is
 * exactly how long the renderer's next `invoke` would sit unanswered — i.e. how
 * long the window is frozen. A handler that awaits between chunks keeps this
 * near 10 ms no matter how long it takes overall.
 */
function startLoopLagProbe(): () => { worst: number; ticks: number } {
  let last = process.hrtime.bigint();
  let worst = 0;
  let ticks = 0;
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const gap = Number(now - last) / 1e6;
    if (gap > worst) worst = gap;
    last = now;
    ticks += 1;
  }, 10);
  return () => {
    clearInterval(timer);
    // A fully blocking handler starves the timer so hard it never fires once, so
    // `worst` would stay 0 — the *opposite* of the truth. The stretch from the
    // last tick (or from the start) to right now is itself a gap, and it is the
    // one that matters. Fold it in before reporting.
    const tail = Number(process.hrtime.bigint() - last) / 1e6;
    return { worst: Math.max(worst, tail), ticks };
  };
}

async function main(): Promise<void> {
  registerIpc(
    () => null as never,
    async () => ({ status: 'idle' }) as never,
    () => undefined
  );
  console.log(`handlers registered: ${HANDLERS.size}\n`);
  if (process.env.BENCH_LIST) {
    for (const channel of [...HANDLERS.keys()].sort()) console.log(channel);
    return;
  }

  const requested = (process.env.BENCH_CHANNELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const cases: Case[] = requested.length
    ? requested.map((channel) => ({ channel, label: channel }))
    : JSON.parse(process.env.BENCH_CASES ?? '[]');

  const rows: { label: string; min: number; med: number; max: number; freeze: number; note: string }[] = [];

  // Controls that prove the probe discriminates: one handler that burns 250 ms of
  // CPU without yielding, one that waits 250 ms asynchronously. If these two do
  // not come out far apart, no other row in the table means anything.
  HANDLERS.set('__control:blocking', async () => {
    const until = Date.now() + 250;
    while (Date.now() < until) {
      /* deliberately starving the loop */
    }
  });
  HANDLERS.set('__control:yielding', async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  for (const testCase of cases) {
    const handler = HANDLERS.get(testCase.channel);
    if (!handler) {
      rows.push({ label: testCase.label, min: 0, med: 0, max: 0, freeze: 0, note: 'NO EXISTE' });
      continue;
    }
    const samples: number[] = [];
    let freeze = 0;
    let note = '';
    for (let i = 0; i < REPEATS; i++) {
      const stopProbe = startLoopLagProbe();
      const started = process.hrtime.bigint();
      try {
        await handler({} as never, ...(testCase.args ?? []));
      } catch (error) {
        note = `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 70);
      }
      samples.push(Number(process.hrtime.bigint() - started) / 1e6);
      const lag = stopProbe();
      if (lag.worst > freeze) freeze = lag.worst;
      if (note) break;
    }
    const s = stats(samples);
    rows.push({ label: testCase.label, ...s, freeze, note });
  }

  rows.sort((a, b) => b.freeze - a.freeze);
  const width = Math.max(...rows.map((r) => r.label.length), 10);
  console.log(
    `${'canal'.padEnd(width)}  ${'mediana'.padStart(10)}  ${'max'.padStart(9)}  ${'CONGELADO'.padStart(11)}  nota`
  );
  console.log('-'.repeat(width + 46));
  for (const row of rows) {
    console.log(
      `${row.label.padEnd(width)}  ${row.med.toFixed(1).padStart(8)}ms  ${row.max.toFixed(1).padStart(7)}ms  ${row.freeze.toFixed(1).padStart(9)}ms  ${row.note}`
    );
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
