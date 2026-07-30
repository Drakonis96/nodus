// Measures what a *completely idle* Nodus costs, per helper process.
//
// It launches the built app against NODUS_USERDATA, lets it settle, then reads
// each process's cumulative CPU time twice and reports the delta over the window.
// Cumulative CPU time is the right metric here: unlike a %CPU snapshot it does not
// depend on what else the machine happens to be doing during the sample.
//
// BENCH_MASCOT=0|1 rewrites `mascotEnabled` in the profile before launching, so
// the two runs differ in exactly one thing.
//
//   node scripts/bench-idle-cpu.mjs
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const userData = process.env.NODUS_USERDATA;
if (!userData) throw new Error('NODUS_USERDATA is required');
const settleMs = Number(process.env.BENCH_SETTLE_MS ?? 25_000);
const windowMs = Number(process.env.BENCH_WINDOW_MS ?? 15_000);
const mascot = process.env.BENCH_MASCOT !== '0';

const prefsPath = path.join(userData, 'app-prefs.json');
const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
prefs.mascotEnabled = mascot;
fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
console.log(`perfil: ${userData}\nmascota Nodi: ${mascot ? 'ACTIVADA' : 'desactivada'}`);

const electron = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const child = spawn(electron, ['.'], {
  cwd: process.cwd(),
  env: { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});

/** Every process in the launched app's tree, with its cumulative CPU seconds. */
function tree() {
  const out = execSync(
    `ps -Ao pid=,ppid=,time=,command= | grep -F "${userData}" | grep -v grep || true`,
    { encoding: 'utf8', maxBuffer: 8 << 20 }
  );
  const rows = new Map();
  for (const line of out.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, , time, command] = match;
    const parts = time.split(':').map(Number);
    const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    const type = /--type=([a-z-]+)/.exec(command)?.[1] ?? 'main';
    const sub = /--utility-sub-type=([^ ]+)/.exec(command)?.[1];
    rows.set(pid, { seconds, label: sub ? `${type} (${sub.split('.').pop()})` : type });
  }
  return rows;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await sleep(settleMs);
const before = tree();
if (before.size === 0) {
  console.error('la app no arranco (ningun proceso encontrado)');
  child.kill('SIGKILL');
  process.exit(1);
}
await sleep(windowMs);
const after = tree();

const rows = [];
let total = 0;
for (const [pid, entry] of after) {
  const start = before.get(pid);
  if (!start) continue;
  const cpuMs = (entry.seconds - start.seconds) * 1000;
  total += cpuMs;
  rows.push({ pid, label: entry.label, pct: (cpuMs / windowMs) * 100 });
}
rows.sort((a, b) => b.pct - a.pct);

console.log(`\nventana en reposo: ${windowMs / 1000} s\n`);
console.log(`${'proceso'.padEnd(30)}  ${'%CPU'.padStart(7)}`);
console.log('-'.repeat(40));
for (const row of rows) console.log(`${row.label.padEnd(30)}  ${row.pct.toFixed(1).padStart(6)}%`);
console.log('-'.repeat(40));
console.log(`${'TOTAL'.padEnd(30)}  ${((total / windowMs) * 100).toFixed(1).padStart(6)}%`);

child.kill('SIGKILL');
await sleep(1500);
try {
  execSync(`pkill -f "${userData}" || true`);
} catch {
  /* already gone */
}
process.exit(0);
