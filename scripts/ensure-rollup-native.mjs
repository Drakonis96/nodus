// npm may omit Rollup's platform-specific optional package when package-lock.json
// was generated on another operating system. Release builds need a deterministic,
// cross-platform repair that does not rewrite either dependency manifest.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = new Map([
  ['darwin-arm64', '@rollup/rollup-darwin-arm64'],
  ['darwin-x64', '@rollup/rollup-darwin-x64'],
  ['linux-x64', '@rollup/rollup-linux-x64-gnu'],
  ['win32-x64', '@rollup/rollup-win32-x64-msvc'],
]);
const target = targets.get(`${process.platform}-${process.arch}`);
if (!target) throw new Error(`Unsupported Rollup release platform: ${process.platform}-${process.arch}`);

const targetRoot = path.join(root, 'node_modules', ...target.split('/'));
if (existsSync(path.join(targetRoot, 'package.json'))) {
  console.log(`Rollup native package is present: ${target}`);
  process.exit(0);
}

const rollup = JSON.parse(readFileSync(path.join(root, 'node_modules', 'rollup', 'package.json'), 'utf8'));
const spec = `${target}@${rollup.version}`;
console.log(`Installing missing Rollup native package: ${spec}`);
execFileSync('npm', ['install', '--no-save', '--package-lock=false', '--ignore-scripts', spec], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (!existsSync(path.join(targetRoot, 'package.json'))) {
  throw new Error(`npm did not install the required Rollup native package: ${spec}`);
}
