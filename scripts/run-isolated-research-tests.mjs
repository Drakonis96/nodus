import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';
const repo = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const files = args.includes('--all') ? fs.readdirSync(path.join(repo, 'scripts')).filter(name => /^test-.*\.mjs$/.test(name)) : args;
if (!files.length || files.some(name => !/^test-[a-z0-9-]+\.mjs$/.test(name))) throw new Error('Pass test script basenames or --all');
const root = createResearchTestRoot();
const policy = macResearchSandbox(root);
const proof = verifyResearchSandbox(root, policy);
const log = fs.openSync(path.join(root, 'artifacts/tests.log'), 'w');
const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, process.execPath, '--test', '--test-concurrency=2', ...files.map(file => path.join(repo, 'scripts', file))], {
  cwd: repo, env: researchTestEnvironment(root), stdio: ['ignore', log, log],
});
console.log(JSON.stringify({ root, proof, pid: child.pid, workers: 2, tests: files.length }));
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
fs.closeSync(log);
fs.writeFileSync(path.join(root, 'artifacts/tests.json'), JSON.stringify({ root, proof, pid: child.pid, workers: 2, tests: files, exitCode: code }, null, 2));
console.log(JSON.stringify({ root, exitCode: code }));
process.exitCode = code ?? 1;
