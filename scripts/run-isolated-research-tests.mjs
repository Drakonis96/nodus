import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';
const repo = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const shard = args.find(argument => argument.startsWith('--shard='))?.slice('--shard='.length);
if (shard && !/^[1-9]\d*\/[1-9]\d*$/.test(shard)) throw new Error('Invalid test shard');
if (args.some(argument => argument.startsWith('--') && !['--all', '--workspace'].includes(argument) && !argument.startsWith('--shard='))) throw new Error('Unknown test option');
const files = args.includes('--all') ? fs.readdirSync(path.join(repo, 'scripts')).filter(name => /^test-.*\.mjs$/.test(name)).sort() : args.filter(argument => !argument.startsWith('--'));
if (!files.length || files.some(name => !/^test-[a-z0-9-]+\.mjs$/.test(name))) throw new Error('Pass test script basenames or --all');
for (const file of files) if (!fs.existsSync(path.join(repo, 'scripts', file))) throw new Error(`Unknown test script: ${file}`);
const root = createResearchTestRoot();
// This test proves Seatbelt itself with its own negative probes. macOS cannot
// nest Seatbelt profiles, so run the harness test before the inherited boundary.
if (files.includes('test-research-isolation.mjs')) {
  execFileSync(process.execPath, ['--test', path.join(repo, 'scripts/test-research-isolation.mjs')], { cwd: repo, stdio: 'inherit' });
  files.splice(files.indexOf('test-research-isolation.mjs'), 1);
}
let testRepo = repo;
if (args.includes('--all') || args.includes('--workspace')) {
  // Some established tests create bundles beside node_modules for ESM package
  // resolution. Give them a disposable checkout rather than weakening Seatbelt.
  testRepo = path.join(root, 'workspace');
  execFileSync('git', ['clone', '--local', '--no-hardlinks', repo, testRepo], { stdio: 'ignore' });
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo }).toString().split('\0').filter(Boolean);
  for (const name of names) {
    const from = path.join(repo, name), to = path.join(testRepo, name);
    if (!fs.existsSync(from)) { fs.rmSync(to, { force: true }); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE);
  }
  for (const name of ['node_modules', 'dist', 'server/dist/web', 'dist-electron', 'build/zotero-mcp']) {
    if (!fs.existsSync(path.join(repo, name))) continue;
    fs.mkdirSync(path.dirname(path.join(testRepo, name)), { recursive: true });
    execFileSync('/bin/cp', ['-cR', path.join(repo, name), path.join(testRepo, name)]);
  }
  if (process.env.NODUS_RESEARCH_TESSDATA) {
    const source = fs.realpathSync(process.env.NODUS_RESEARCH_TESSDATA);
    const target = path.join(testRepo, 'scripts/.cache/tessdata');
    fs.mkdirSync(target, { recursive: true });
    const assets = [];
    for (const name of fs.readdirSync(source).filter(name => /^[a-z_]+\.traineddata$/.test(name))) {
      const filename = path.join(source, name);
      if (fs.realpathSync(filename) !== filename || !fs.statSync(filename).isFile()) throw new Error('Invalid OCR fixture data');
      fs.copyFileSync(filename, path.join(target, name));
      assets.push({ name, source: filename, sha256: createHash('sha256').update(fs.readFileSync(filename)).digest('hex') });
    }
    fs.writeFileSync(path.join(root, 'artifacts/ocr-assets.json'), JSON.stringify(assets, null, 2));
  }
}
const policy = macResearchSandbox(root);
const proof = verifyResearchSandbox(root, policy);
const environment = { ...researchTestEnvironment(root), HOME: root };
if (process.env.CHROME_BIN) environment.CHROME_BIN = fs.realpathSync(process.env.CHROME_BIN);
const [part, total] = (shard ?? '1/1').split('/').map(Number);
if (part > total) throw new Error('Test shard exceeds count');
const selected = files.filter((_, index) => index % total === part - 1);
const results = [];
const owned = new Set();
const signals = [];
let stopped = false, next = 0;
const forwardSignal = signal => {
  stopped = true;
  signals.push({ signal, at: new Date().toISOString() });
  for (const child of owned) {
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
};
const interrupt = () => forwardSignal('SIGINT');
const terminate = () => forwardSignal('SIGTERM');
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
const persist = () => fs.writeFileSync(path.join(root, 'artifacts/tests.json'), JSON.stringify({
  root, proof, workers: 2, tests: selected, shard, results, signals,
  exitCode: results.length === selected.length && results.every(result => result.exitCode === 0) ? 0 : 1,
}, null, 2));
console.log(JSON.stringify({ root, proof, workers: 2, tests: selected.length, shard }));
// Own two independent single-file runners. A terminated test cannot discard all
// subsequent cases through Node's shared test-runner pending-promise teardown.
async function worker() {
  while (!stopped && next < selected.length) {
    const file = selected[next++];
    const output = path.join(root, 'artifacts', `${file}.log`);
    const log = fs.openSync(output, 'w');
    const started = Date.now();
    let childPolicy = policy;
    const childEnvironment = { ...environment };
    if (['test-research-provider-proxy.mjs', 'test-research-reasoning-transport.mjs', 'test-research-attachment-transport.mjs'].includes(file)) {
      const reservation = http.createServer();
      await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
      const port = reservation.address().port;
      await new Promise(resolve => reservation.close(resolve));
      childPolicy = macResearchSandbox(root, [port]);
      const networkProof = verifyResearchSandbox(root, childPolicy);
      fs.writeFileSync(path.join(root, 'artifacts', `${file}.network.json`), JSON.stringify({ port, ...networkProof }));
      childEnvironment.NODUS_TEST_FIXTURE_PORT = String(port);
    }
    const child = spawn('/usr/bin/sandbox-exec', ['-p', childPolicy, process.execPath, '--test', '--test-concurrency=1', path.join(testRepo, 'scripts', file)], {
      cwd: testRepo, env: childEnvironment, stdio: ['ignore', log, log], detached: true,
    });
    owned.add(child);
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; process.kill(-child.pid, 'SIGKILL'); }, 600000);
    const outcome = await new Promise(resolve => {
      child.once('error', error => resolve({ exitCode: 1, error: String(error) }));
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    clearTimeout(deadline); owned.delete(child); fs.closeSync(log);
    const result = { file, ...outcome, timedOut, pid: child.pid, durationMs: Date.now() - started, output };
    results.push(result); persist();
    fs.appendFileSync(path.join(root, 'artifacts/tests.log'), JSON.stringify(result) + '\n');
  }
}
await Promise.all([worker(), worker()]);
process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
persist();
const code = results.length === selected.length && results.every(result => result.exitCode === 0) ? 0 : 1;
console.log(JSON.stringify({ root, exitCode: code, passed: results.filter(result => result.exitCode === 0).length, total: selected.length }));
process.exitCode = code;
