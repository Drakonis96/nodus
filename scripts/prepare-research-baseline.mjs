/** Build the audited base with isolation/transport instrumentation only. No
 * notebook, retrieval, migration or documentary implementation is backported. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const base = 'f54995e7';
const root = createResearchTestRoot();
const workspace = path.join(root, 'workspace');
execFileSync('git', ['clone', '--local', '--no-hardlinks', repo, workspace], { stdio: 'ignore' });
execFileSync('git', ['checkout', '--detach', base], { cwd: workspace, stdio: 'ignore' });
const isolationFiles = ['electron/main.ts', 'electron/bootstrap.ts', 'electron/qa/isolatedProfile.ts', 'vite.config.ts'];
const patch = execFileSync('git', ['diff', base, '866c447b', '--', ...isolationFiles], { cwd: repo });
execFileSync('git', ['apply', '-'], { cwd: workspace, input: patch });
fs.copyFileSync(path.join(repo, 'electron/qa/researchProviderProxy.ts'), path.join(workspace, 'electron/qa/researchProviderProxy.ts'));
const providerFile = path.join(workspace, 'electron/ai/providers.ts');
let provider = fs.readFileSync(providerFile, 'utf8');
provider = "import { researchTestProviderBase } from '../qa/researchProviderProxy';\n" + provider;
const declaration = 'export function openAiCompatBase(provider: AiProvider): string | null {';
if (!provider.includes(declaration)) throw new Error('Audited provider entry changed');
provider = provider.replace(declaration, `${declaration}\n  const proxy = researchTestProviderBase(provider);\n  if (proxy) return proxy;`);
fs.writeFileSync(providerFile, provider);
execFileSync('/bin/cp', ['-cR', path.join(repo, 'node_modules'), path.join(workspace, 'node_modules')]);
const policy = macResearchSandbox(root);
const proof = verifyResearchSandbox(root, policy);
fs.writeFileSync(path.join(root, 'isolation.sb'), policy);
const log = fs.openSync(path.join(root, 'artifacts/build.log'), 'w');
const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, '/usr/bin/env', 'npm', 'run', 'build'], {
  cwd: workspace, env: researchTestEnvironment(root), stdio: ['ignore', log, log],
});
console.log(JSON.stringify({ root, workspace, base, proof, pid: child.pid }));
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
fs.closeSync(log);
const applied = execFileSync('git', ['diff', '--', ...isolationFiles, 'electron/ai/providers.ts'], { cwd: workspace });
fs.writeFileSync(path.join(root, 'artifacts/instrumentation.patch'), applied);
const instrumentation = [...isolationFiles, 'electron/ai/providers.ts', 'electron/qa/researchProviderProxy.ts'].map(file => ({
  file, sha256: createHash('sha256').update(fs.readFileSync(path.join(workspace, file))).digest('hex'),
}));
fs.writeFileSync(path.join(root, 'artifacts/baseline.json'), JSON.stringify({ root, workspace, base, exitCode: code, proof,
  instrumentation, isolationFiles, providerRouting: 'researchTestProviderBase', patchSha256: createHash('sha256').update(applied).digest('hex') }, null, 2));
console.log(JSON.stringify({ root, exitCode: code }));
process.exitCode = code ?? 1;
