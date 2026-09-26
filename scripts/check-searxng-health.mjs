#!/usr/bin/env node
/** Two questions about the managed SearXNG runtime, answered together because they
 * are the same maintenance problem: is our pinned upstream still current, and do the
 * engines still answer?
 *
 * The version half is a plain GitHub API read. The engine half boots the staged
 * runtime exactly as the application does and fires three fixed queries — one
 * humanities, one current affairs, one scholarly — then reports, per engine, how
 * many results it contributed and why it was unresponsive. It exits non-zero only on
 * a hard signal: the runtime does not boot, no engine at all answers, or fewer than
 * `--min-engines` engines answer (which is how a maintainer runs it locally, where
 * the address is the one real users search from).
 *
 * A runner in a datacenter is treated as a hostile address by the scraped engines,
 * so the CI job runs this with the loose default and keeps the JSON as the signal;
 * run it on a real machine with `--min-engines 3` before bumping the pin.
 *
 *   node scripts/check-searxng-health.mjs [--json <path>] [--min-engines N] [--disposable-ci]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at >= 0 && args[at + 1] ? args[at + 1] : fallback; };
const disposable = args.includes('--disposable-ci');
const minimumEngines = Number(option('--min-engines', '1'));
const jsonPath = option('--json', '');
const runtime = process.env.NODUS_RUNTIME_ROOT ? path.resolve(process.env.NODUS_RUNTIME_ROOT) : path.join(repoRoot, 'build/zotero-mcp');
const python = path.join(runtime, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
const serve = path.join(runtime, 'searxng', 'serve.py');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'runtime/searxng/manifest.json'), 'utf8'));

/** Fixed, boring queries: one per kind of question the web step has to answer. */
const PROBES = [
  { query: 'factores de la represión franquista en la posguerra', category: 'general' },
  { query: 'plazos de aplicación del Reglamento europeo de inteligencia artificial', category: 'general' },
  { query: 'historiografía memoria colectiva Halbwachs', category: 'science' },
];

const failures = [];
const fail = (message) => { failures.push(message); console.log(`FAIL  ${message}`); };
const note = (message) => console.log(`      ${message}`);

/** Is the pinned commit still the tip of upstream's default branch? */
async function upstreamDrift() {
  try {
    const response = await fetch('https://api.github.com/repos/searxng/searxng/commits?per_page=1', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nodus-searxng-health' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return { checked: false, reason: `GitHub answered ${response.status}` };
    const [latest] = await response.json();
    const head = latest?.sha ?? '';
    return { checked: true, head, date: latest?.commit?.committer?.date ?? '', current: head === manifest.upstreamCommit, compare: head && head !== manifest.upstreamCommit ? `https://github.com/searxng/searxng/compare/${manifest.upstreamCommit}...${head}` : '' };
  } catch (error) {
    return { checked: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function launch(directory) {
  const secret = randomBytes(32).toString('hex');
  const child = spawn(python, ['-I', '-B', serve], {
    cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, TEMP: directory, TMP: directory, NODUS_SEARXNG_TOKEN: secret, LANG: 'C.UTF-8' },
  });
  const ready = new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('the runtime never reported ready')), 45_000);
    child.stdout.on('data', chunk => {
      buffer += String(chunk);
      const line = buffer.split('\n').find(entry => entry.includes('"ready"'));
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line).port);
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`the runtime exited with ${code}`)); });
  });
  return { child, secret, ready };
}

const run = async () => {
  console.log(`pinned upstream: ${manifest.upstreamCommit.slice(0, 12)} (${manifest.upstreamDate})`);
  const drift = await upstreamDrift();
  if (!drift.checked) note(`upstream check skipped: ${drift.reason}`);
  else if (drift.current) console.log('ok    the pin is the tip of upstream\'s default branch');
  else { console.log(`note  upstream has moved to ${drift.head.slice(0, 12)} (${drift.date.slice(0, 10)})`); note(drift.compare); note('the bump is a reviewed change: manifest.json, then npm run research:runtime, then this check on a real machine'); }

  if (!fs.existsSync(python) || !fs.existsSync(serve)) { fail(`the staged runtime is missing at ${runtime}: run npm run research:runtime`); return; }
  const sessionRoot = fs.mkdtempSync(path.join(disposable ? os.tmpdir() : repoRoot, disposable ? 'nodus-searxng-health-' : '.nodus-searxng-health-'));
  const engines = new Map();
  const record = (engine, field, amount = 1) => {
    const entry = engines.get(engine) ?? { results: 0, complaints: {} };
    if (field === 'results') entry.results += amount; else entry.complaints[field] = (entry.complaints[field] ?? 0) + amount;
    engines.set(engine, entry);
  };
  try {
    const { child, secret, ready } = launch(fs.mkdtempSync(path.join(sessionRoot, 'session-')));
    const port = await ready;
    for (const probe of PROBES) {
      const url = new URL(`http://127.0.0.1:${port}/search`);
      for (const [key, value] of Object.entries({ q: probe.query, format: 'json', categories: probe.category, language: 'auto', safesearch: '0' })) url.searchParams.set(key, value);
      const response = await fetch(url, { headers: { 'X-Nodus-Token': secret }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) { fail(`the runtime answered ${response.status} for a ${probe.category} query`); continue; }
      const body = await response.json();
      for (const [engine, reason] of body.unresponsive_engines ?? []) record(engine, reason);
      for (const item of body.results ?? []) for (const engine of item.engines ?? []) record(engine, 'results');
      console.log(`      ${probe.category.padEnd(7)} "${probe.query.slice(0, 46)}" → ${(body.results ?? []).length} results`);
    }
    child.stdin.end();
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 8_000))]);
    child.kill('SIGKILL');
  } finally {
    fs.rmSync(sessionRoot, { recursive: true, force: true });
  }

  const answering = [...engines].filter(([, entry]) => entry.results > 0).sort((a, b) => b[1].results - a[1].results);
  const silent = [...engines].filter(([, entry]) => entry.results === 0);
  console.log(`\nengines that answered (${answering.length}):`);
  for (const [engine, entry] of answering) console.log(`  ${engine.padEnd(18)} ${String(entry.results).padStart(4)} results${Object.keys(entry.complaints).length ? `   also reported: ${Object.entries(entry.complaints).map(([reason, count]) => `${reason}×${count}`).join(', ')}` : ''}`);
  if (silent.length) {
    console.log(`engines that answered nothing (${silent.length}):`);
    for (const [engine, entry] of silent) console.log(`  ${engine.padEnd(18)} ${Object.entries(entry.complaints).map(([reason, count]) => `${reason}×${count}`).join(', ') || 'no report'}`);
  }
  const parsing = [...engines].filter(([, entry]) => Object.keys(entry.complaints).some(reason => /parsing/i.test(reason)));
  if (parsing.length) note(`parser rot signal: ${parsing.map(([engine]) => engine).join(', ')} reported a parsing error — that is what an upstream bump fixes`);

  if (!answering.length) fail('no engine answered any query');
  else if (answering.length < minimumEngines) fail(`only ${answering.length} engine(s) answered, fewer than the ${minimumEngines} required`);

  if (jsonPath) {
    fs.writeFileSync(path.resolve(jsonPath), JSON.stringify({
      checkedAt: new Date().toISOString(), upstream: { pinned: manifest.upstreamCommit, ...drift },
      engines: Object.fromEntries([...engines].map(([engine, entry]) => [engine, entry])), answered: answering.length, required: minimumEngines, failures,
    }, null, 2));
    note(`report written to ${jsonPath}`);
  }
};

try {
  await run();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
console.log(failures.length ? `\n${failures.length} hard signal(s)` : '\nthe runtime answers and the pin is accounted for');
process.exit(failures.length ? 1 : 0);
