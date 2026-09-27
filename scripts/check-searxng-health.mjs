#!/usr/bin/env node
/** Two questions about the managed SearXNG runtime, answered together because they
 * are the same maintenance problem: is our pinned upstream still current, and do the
 * engines still answer?
 *
 * The version half is a plain GitHub API read. The engine half boots the staged
 * runtime exactly as the application does and fires three fixed queries — one
 * humanities, one current affairs, one scholarly — then reports, per engine, how many
 * results it contributed and why it was unresponsive.
 *
 * **An engine that refuses, throttles or CAPTCHAs is reported and is not an error.**
 * That is what engines do, the application already surfaces it per turn, and no
 * version bump fixes it. What alerts is the version signal and genuine breakage:
 *
 *   - the runtime does not boot, or none of the scholarly APIs answer at all;
 *   - an engine reports a parsing error, which is what an upstream bump fixes;
 *   - the pin has aged past `--max-pin-age-days` (default 90) while upstream has
 *     moved, so someone can decide to bump it.
 *
 * `--min-engines N` (default 0, off) is an opt-in gate for a maintainer who wants a
 * stricter local reading; a datacenter runner should leave it off, because a runner's
 * address is treated as hostile by the scraped engines and that is not actionable.
 *
 *   node scripts/check-searxng-health.mjs [--json <path>] [--min-engines N] [--max-pin-age-days N] [--disposable-ci]
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
const minimumEngines = Number(option('--min-engines', '0'));
const maxPinAgeDays = Number(option('--max-pin-age-days', '90'));
const jsonPath = option('--json', '');
const runtime = process.env.NODUS_RUNTIME_ROOT ? path.resolve(process.env.NODUS_RUNTIME_ROOT) : path.join(repoRoot, 'build/zotero-mcp');
const python = path.join(runtime, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
const serve = path.join(runtime, 'searxng', 'serve.py');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'runtime/searxng/manifest.json'), 'utf8'));
/** How long the runtime has been pinned, in whole days, when the date parses. */
const pinAgeDays = Number.isFinite(Date.parse(manifest.upstreamDate)) ? Math.floor((Date.now() - Date.parse(manifest.upstreamDate)) / 86_400_000) : null;

/** Engines reached through an API rather than by scraping. They do not block
 * datacenter addresses, so all of them going quiet means something is broken. */
const SCHOLARLY_APIS = ['arxiv', 'openalex', 'europepmc', 'pubmed', 'semantic scholar', 'crossref'];

/** Fixed, boring queries: one per kind of question the web step has to answer. */
const PROBES = [
  { query: 'factores de la represión franquista en la posguerra', category: 'general' },
  { query: 'plazos de aplicación del Reglamento europeo de inteligencia artificial', category: 'general' },
  { query: 'historiografía memoria colectiva Halbwachs', category: 'science' },
];

const failures = [];
const fail = (message) => { failures.push(message); console.log(`ALERT ${message}`); };
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

  // An engine that refuses, throttles or CAPTCHAs is doing what engines do, and it is
  // reported here without being an error: the application already surfaces it per turn
  // and it is not something a bump fixes. What does get an alert is the version signal.
  // A parsing error on one probe is a hiccup — Semantic Scholar's API returns records
  // its engine sometimes fails to read, and it does so intermittently — so rot is the
  // same engine failing to read its own results twice or more in one pass.
  const parsingCount = (entry) => Object.entries(entry.complaints).filter(([reason]) => /parsing/i.test(reason)).reduce((sum, [, count]) => sum + count, 0);
  const parsing = [...engines].filter(([, entry]) => parsingCount(entry) >= 2);
  if (parsing.length) fail(`parser rot: ${parsing.map(([engine, entry]) => `${engine}×${parsingCount(entry)}`).join(', ')} failed to read its own results more than once — an upstream bump is what fixes this${drift.checked && !drift.current ? `, and upstream has moved (${drift.compare})` : ''}`);
  else note(`no engine reported repeated parsing errors${[...engines].some(([, entry]) => parsingCount(entry) === 1) ? ' (a single hiccup was reported, which is not rot)' : ''}`);

  const scholarlyAnswering = SCHOLARLY_APIS.filter(name => (engines.get(name)?.results ?? 0) > 0);
  if (!scholarlyAnswering.length) fail(`none of the scholarly APIs answered (${SCHOLARLY_APIS.join(', ')}): that is not engine politics, the runtime or the network is broken`);
  if (minimumEngines > 0 && answering.length < minimumEngines) fail(`only ${answering.length} engine(s) answered, fewer than the ${minimumEngines} required by --min-engines`);
  if (pinAgeDays !== null && pinAgeDays > maxPinAgeDays) fail(`the pin is ${pinAgeDays} day${pinAgeDays === 1 ? '' : 's'} old (limit ${maxPinAgeDays}): consider bumping it — upstream is at ${drift.head ? drift.head.slice(0, 12) : 'unknown'}${drift.compare ? `, ${drift.compare}` : ''}`);

  if (jsonPath) {
    fs.writeFileSync(path.resolve(jsonPath), JSON.stringify({
      checkedAt: new Date().toISOString(),
      upstream: { pinned: manifest.upstreamCommit, pinnedDate: manifest.upstreamDate, pinAgeDays, ...drift },
      engines: Object.fromEntries([...engines].map(([engine, entry]) => [engine, entry])),
      answered: answering.length, scholarlyAnswering, minimumEngines, maxPinAgeDays,
      alerts: failures,
      note: 'Engines that refuse, throttle or CAPTCHA are reported here and are not errors: the application surfaces them per turn and no version bump fixes them.',
    }, null, 2));
    note(`report written to ${jsonPath}`);
  }
};

try {
  await run();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
console.log(failures.length ? `\n${failures.length} alert(s): ${failures.join(' | ')}` : '\nnothing to act on: the pin is accounted for and no engine is reporting a broken parser');
process.exit(failures.length ? 1 : 0);
