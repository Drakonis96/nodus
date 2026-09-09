// SPDX-License-Identifier: AGPL-3.0-only
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ALPHAGENOME_REVISION, ALPHAGENOME_TERMS_VERSION, ALPHAGENOME_NOTICE, ALPHAGENOME_CITATION, validateGenomicsResult, type GenomicsPlan, type GenomicsStatus, type GenomicsSettingsInput } from '@shared/genomics';

const directory = () => path.join(app.getPath('userData'), 'genomics');
const credentialsFile = () => path.join(directory(), 'credentials.bin');
const runtimeDirectory = () => path.join(directory(), `runtime-${ALPHAGENOME_REVISION}`);
const python = () => path.join(runtimeDirectory(), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const worker = () => app.isPackaged ? path.join(process.resourcesPath, 'genomics', 'alphagenome_worker.py') : path.join(app.getAppPath(), 'scripts', 'alphagenome_worker.py');
let installing = false;
let running = false;
let configurationVersion = 0;
const encryptionAvailable = () => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
function credentials(): { apiKey: string; terms: string } | null {
  if (!encryptionAvailable() || !fs.existsSync(credentialsFile())) return null;
  try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialsFile()))); } catch { return null; }
}
export function getGenomicsStatus(): GenomicsStatus {
  const c = credentials();
  return { hasKey: !!c?.apiKey, termsAccepted: c?.terms === ALPHAGENOME_TERMS_VERSION, runtimeReady: fs.existsSync(path.join(runtimeDirectory(), 'READY')), installing };
}
export function configureGenomics(input: GenomicsSettingsInput): GenomicsStatus {
  if (!input || input.acceptTerms !== true) throw new Error('AlphaGenome: accept the AlphaGenome terms and confirm eligible non-commercial use.');
  if (!encryptionAvailable()) throw new Error('AlphaGenome: the secure system credential store is unavailable.');
  const apiKey = input.apiKey === undefined ? credentials()?.apiKey : typeof input.apiKey === 'string' ? input.apiKey.trim() : null;
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(apiKey)) throw new Error('AlphaGenome: enter a valid personal API key in the skill configuration.');
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const temporary = credentialsFile() + '.tmp';
  fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify({ apiKey, terms: ALPHAGENOME_TERMS_VERSION })), { mode: 0o600 });
  fs.renameSync(temporary, credentialsFile());
  configurationVersion++;
  return getGenomicsStatus();
}
export function clearGenomicsConfiguration(): GenomicsStatus {
  configurationVersion++;
  fs.rmSync(credentialsFile(), { force: true });
  return getGenomicsStatus();
}
/** Fixed commands only; credentials go through stdin, never arguments, env or logs. */
function run(command: string, args: string[], input = '', signal?: AbortSignal, timeout = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTHONNOUSERSITE: '1', MPLBACKEND: 'Agg', PIP_DISABLE_PIP_VERSION_CHECK: '1' } });
    let stdout = ''; let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { child.kill('SIGKILL'); reject(error); } else resolve(stdout);
    };
    const abort = () => finish(new DOMException('AlphaGenome: cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('AlphaGenome: request timed out.')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 1_000_000) finish(new Error('AlphaGenome: response exceeds the size limit.')); });
    child.stderr.resume(); // SDK/server diagnostics can contain private data; never expose them.
    child.on('error', () => finish(new Error('AlphaGenome: Python 3.10 or newer is required. Install Python and retry runtime setup.')));
    child.on('close', code => finish(code === 0 ? undefined : new Error('AlphaGenome: runtime or API request failed. Check the runtime, personal key, access and query quota.')));
    child.stdin.on('error', () => { /* handled by process close */ });
    child.stdin.end(input);
  });
}
export async function installGenomicsRuntime(): Promise<GenomicsStatus> {
  if (installing || running) throw new Error('AlphaGenome: another operation is running.');
  installing = true;
  try {
    fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(python())) {
      const candidates: [string, string[]][] = process.platform === 'win32' ? [['py', ['-3']], ['python', []]]
        : [['python3', []], ['/opt/homebrew/bin/python3', []], ['/usr/local/bin/python3', []]];
      let selected: [string, string[]] | undefined;
      for (const candidate of candidates) {
        try { await run(candidate[0], [...candidate[1], '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], '', undefined, 10_000); selected = candidate; break; }
        catch { /* Try the next standard Python installation. */ }
      }
      if (!selected) throw new Error('AlphaGenome: Python 3.10 or newer is required. Install Python and retry runtime setup.');
      await run(selected[0], [...selected[1], '-m', 'venv', runtimeDirectory()], '', undefined, 120_000);
    }
    await run(python(), ['-I', '-m', 'pip', 'install', '--no-input', '--index-url', 'https://pypi.org/simple', `https://github.com/google-deepmind/alphagenome/archive/${ALPHAGENOME_REVISION}.zip`], '', undefined, 600_000);
    await run(python(), ['-I', worker(), '--check']);
    fs.writeFileSync(path.join(runtimeDirectory(), 'READY'), ALPHAGENOME_REVISION, { mode: 0o600 });
    installing = false;
    return getGenomicsStatus();
  } finally { installing = false; }
}
export async function predictGenomics(plan: GenomicsPlan, signal?: AbortSignal) {
  const c = credentials();
  if (!c?.apiKey || c.terms !== ALPHAGENOME_TERMS_VERSION) throw new Error('AlphaGenome: configure your personal API key and accept the current terms in this skill.');
  if (!getGenomicsStatus().runtimeReady) throw new Error('AlphaGenome: install the runtime from this skill configuration.');
  if (running || installing) throw new Error('AlphaGenome: another operation is running. Retry when it finishes.');
  const version = configurationVersion;
  running = true;
  try {
    const raw = await run(python(), ['-I', worker()], JSON.stringify({ apiKey: c.apiKey, plan }), signal);
    signal?.throwIfAborted();
    if (version !== configurationVersion) throw new DOMException('AlphaGenome: configuration changed.', 'AbortError');
    const data = JSON.parse(raw);
    return validateGenomicsResult({ ...data, version: 1, provider: 'Google DeepMind AlphaGenome', plan, createdAt: new Date().toISOString(), sdkRevision: ALPHAGENOME_REVISION, model: 'ALL_FOLDS', notice: ALPHAGENOME_NOTICE, citation: ALPHAGENOME_CITATION });
  } finally { running = false; }
}
