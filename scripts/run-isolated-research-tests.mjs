import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';
const repo = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const files = args.includes('--all') ? fs.readdirSync(path.join(repo, 'scripts')).filter(name => /^test-.*\.mjs$/.test(name)) : args;
if (!files.length || files.some(name => !/^test-[a-z0-9-]+\.mjs$/.test(name))) throw new Error('Pass test script basenames or --all');
const root = createResearchTestRoot();
// This test proves Seatbelt itself with its own negative probes. macOS cannot
// nest Seatbelt profiles, so run the harness test before the inherited boundary.
if (files.includes('test-research-isolation.mjs')) {
  execFileSync(process.execPath, ['--test', path.join(repo, 'scripts/test-research-isolation.mjs')], { cwd: repo, stdio: 'inherit' });
  files.splice(files.indexOf('test-research-isolation.mjs'), 1);
}
let testRepo = repo;
if (args.includes('--all')) {
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
  for (const name of ['node_modules', 'dist', 'dist-electron', 'build/zotero-mcp']) {
    if (!fs.existsSync(path.join(repo, name))) continue;
    fs.mkdirSync(path.dirname(path.join(testRepo, name)), { recursive: true });
    execFileSync('/bin/cp', ['-cR', path.join(repo, name), path.join(testRepo, name)]);
  }
}
const policy = macResearchSandbox(root);
const proof = verifyResearchSandbox(root, policy);
const log = fs.openSync(path.join(root, 'artifacts/tests.log'), 'w');
const environment = researchTestEnvironment(root);
if (process.env.CHROME_BIN) environment.CHROME_BIN = fs.realpathSync(process.env.CHROME_BIN);
const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, process.execPath, '--test', '--test-concurrency=2', ...files.map(file => path.join(testRepo, 'scripts', file))], {
  cwd: testRepo, env: environment, stdio: ['ignore', log, log],
});
console.log(JSON.stringify({ root, proof, pid: child.pid, workers: 2, tests: files.length }));
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
fs.closeSync(log);
fs.writeFileSync(path.join(root, 'artifacts/tests.json'), JSON.stringify({ root, proof, pid: child.pid, workers: 2, tests: files, exitCode: code }, null, 2));
console.log(JSON.stringify({ root, exitCode: code }));
process.exitCode = code ?? 1;
