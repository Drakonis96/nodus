import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { researchWebFixture } from '../qa/researchWebFixture';

/** One SearXNG result as Nodus consumes it. Everything is untrusted remote text. */
export interface SearxngResult {
  url: string;
  title: string;
  content: string;
  engines: string[];
  positions: number[];
  score: number;
  category: string;
  publishedDate: string | null;
}
export interface SearxngResponse {
  query: string;
  results: SearxngResult[];
  /** Engines that did not answer, with SearXNG's reason (timeout, CAPTCHA, …). */
  unresponsive: Array<[string, string]>;
}
export interface SearxngSearchOptions {
  categories?: 'general' | 'science';
  language?: string;
  pageno?: number;
  timeoutMs?: number;
}

interface Running { child: ChildProcess; base: string; token: string; session: string; idle?: NodeJS.Timeout }

const IDLE_STOP_MS = 10 * 60_000;
const READY_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT = 3;
let running: Running | null = null;
let starting: Promise<Running> | null = null;
let failures = 0;
let inFlight = 0;
const waiting: Array<() => void> = [];

/** The packaged runtime lives beside the app resources, never inside the asar. */
export function managedRuntimeRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'zotero-mcp') : path.join(app.getAppPath(), 'build/zotero-mcp');
}

function runtimeFiles() {
  const root = managedRuntimeRoot();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8')) as { platform?: string; searxng?: { upstreamCommit?: string } };
  if (manifest.platform !== `${process.platform}-${process.arch}` || !manifest.searxng?.upstreamCommit) throw new Error('web_search_runtime_unavailable');
  return {
    python: path.join(root, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'),
    serve: path.join(root, 'searxng', 'serve.py'),
  };
}

function sessionsRoot(): string { return path.join(app.getPath('userData'), 'websearch'); }

/** Sessions of a previous run hold only a generated settings file and SearXNG's
 * disposable result cache; none can belong to a live process of this profile. */
function clearStaleSessions(): void {
  const root = sessionsRoot();
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) if (name.startsWith('session-')) fs.rmSync(path.join(root, name), { recursive: true, force: true });
}

function start(): Promise<Running> {
  const { python, serve } = runtimeFiles();
  if (!fs.existsSync(python) || !fs.existsSync(serve)) throw new Error('web_search_runtime_unavailable');
  if (!running) clearStaleSessions();
  const session = fs.mkdtempSync(path.join((fs.mkdirSync(sessionsRoot(), { recursive: true }), sessionsRoot()), 'session-'));
  const token = randomBytes(32).toString('hex');
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '', HOME: session, USERPROFILE: session, TMPDIR: session, TEMP: session, TMP: session,
    XDG_CACHE_HOME: session, XDG_CONFIG_HOME: session, NODUS_SEARXNG_TOKEN: token, LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8',
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } : {}),
  };
  const child = spawn(python, ['-I', '-B', serve], { cwd: session, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  return new Promise<Running>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const fail = (error: Error) => { clearTimeout(timer); if (child.exitCode == null) child.kill('SIGKILL'); reject(error); };
    const timer = setTimeout(() => fail(new Error('web_search_start_timeout')), READY_TIMEOUT_MS);
    child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.stdout!.on('data', chunk => {
      stdout += chunk;
      const line = stdout.split('\n').find(entry => entry.includes('"ready"'));
      if (!line) return;
      clearTimeout(timer);
      try {
        const { port } = JSON.parse(line) as { port: number };
        if (!Number.isInteger(port) || port <= 0) throw new Error('invalid port');
        resolve({ child, base: `http://127.0.0.1:${port}`, token, session });
      } catch { fail(new Error('web_search_start_failed')); }
    });
    child.once('error', error => fail(error));
    child.once('exit', code => {
      if (running?.child === child) running = null;
      fs.rm(session, { recursive: true, force: true }, () => {});
      fail(new Error(`web_search_start_failed: exit ${code}${stderr ? ` · ${stderr.trim().split('\n').at(-1)}` : ''}`));
    });
  });
}

/** Starts SearXNG the first time Research Chat needs it and reuses it after. */
export async function ensureSearxng(): Promise<{ base: string; token: string }> {
  const fixture = researchWebFixture();
  if (fixture) return { base: fixture.searchBase, token: fixture.token };
  if (running && running.child.exitCode == null) { touch(running); return running; }
  if (failures >= 3) throw new Error('web_search_runtime_failed');
  starting ??= start().then(value => { running = value; failures = 0; touch(value); return value; })
    .catch(error => { failures++; throw error; }).finally(() => { starting = null; });
  return starting;
}

function touch(value: Running): void {
  if (value.idle) clearTimeout(value.idle);
  value.idle = setTimeout(() => { if (running === value && !inFlight) void stopSearxng(); else touch(value); }, IDLE_STOP_MS);
  value.idle.unref?.();
}

async function slot(): Promise<() => void> {
  while (inFlight >= MAX_CONCURRENT) await new Promise<void>(resolve => waiting.push(resolve));
  inFlight++;
  return () => { inFlight--; waiting.shift()?.(); };
}

/** SearXNG query syntax (`!bang`, `:lang`, `<`/`>` tokens) could redirect a query
 * to an external site or change engines; model-written queries are plain text. */
export function plainSearchQuery(query: string): string {
  const printable = [...query].map(character => (character.codePointAt(0)! < 32 ? ' ' : character)).join('');
  return printable.split(/\s+/).filter(token => token && !/^[!:<>]/.test(token)).join(' ').slice(0, 300);
}

function text(value: unknown, limit: number): string { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''; }

export async function searchSearxng(query: string, options: SearxngSearchOptions = {}, signal?: AbortSignal): Promise<SearxngResponse> {
  const q = plainSearchQuery(query);
  if (!q) return { query, results: [], unresponsive: [] };
  const { base, token } = await ensureSearxng();
  const release = await slot();
  try {
    const url = new URL('search', base.endsWith('/') ? base : `${base}/`);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', options.categories ?? 'general');
    url.searchParams.set('language', options.language ?? 'auto');
    url.searchParams.set('safesearch', '0');
    if (options.pageno && options.pageno > 1) url.searchParams.set('pageno', String(options.pageno));
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
    const response = await fetch(url, { headers: { 'X-Nodus-Token': token, Accept: 'application/json' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error(`web_search_failed: ${response.status}`);
    const body = await response.json() as { results?: unknown[]; unresponsive_engines?: unknown[] };
    const results: SearxngResult[] = [];
    for (const raw of Array.isArray(body.results) ? body.results.slice(0, 60) : []) {
      const item = raw as Record<string, unknown>;
      const link = text(item.url, 2000);
      if (!/^https?:\/\//i.test(link)) continue;
      results.push({ url: link, title: text(item.title, 300), content: text(item.content, 800),
        engines: Array.isArray(item.engines) ? item.engines.filter((engine): engine is string => typeof engine === 'string').slice(0, 12) : [],
        positions: Array.isArray(item.positions) ? item.positions.filter((position): position is number => Number.isFinite(position)).slice(0, 12) : [],
        score: Number.isFinite(item.score) ? Number(item.score) : 0, category: text(item.category, 40),
        publishedDate: text(item.publishedDate, 40) || null });
    }
    const unresponsive = (Array.isArray(body.unresponsive_engines) ? body.unresponsive_engines : [])
      .filter((entry): entry is [string, string] => Array.isArray(entry) && typeof entry[0] === 'string').map(entry => [entry[0], String(entry[1] ?? '')] as [string, string]);
    if (running) touch(running);
    return { query: q, results, unresponsive };
  } finally { release(); }
}

export async function stopSearxng(): Promise<void> {
  const current = running;
  running = null;
  if (!current) return;
  if (current.idle) clearTimeout(current.idle);
  if (current.child.exitCode != null) return;
  // Closing stdin is the orderly stop the service watches for; a signal follows.
  current.child.stdin?.end();
  const exited = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 3000);
    current.child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
  if (!exited && current.child.exitCode == null) current.child.kill('SIGKILL');
}

/** Process-shutdown backstop: quit handlers cannot await. */
export function killSearxngSync(): void {
  const current = running;
  running = null;
  if (!current) return;
  if (current.idle) clearTimeout(current.idle);
  current.child.stdin?.destroy();
  if (current.child.exitCode == null) current.child.kill('SIGKILL');
  fs.rmSync(current.session, { recursive: true, force: true });
}

export function searxngStatus(): { running: boolean; pid: number | null } {
  return { running: !!running && running.child.exitCode == null, pid: running?.child.pid ?? null };
}
