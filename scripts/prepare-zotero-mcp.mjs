/** Build-time only: private runtime and hash-locked wheels, never a global install. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '..');
const source = path.join(repo, 'runtime/zotero-mcp');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
const platform = `${process.platform}-${process.arch}`;
const target = manifest.platforms[platform];
if (!target) throw new Error(`Unsupported managed runtime platform: ${platform}`);
const output = path.join(repo, 'build/zotero-mcp');
const cache = path.join(repo, 'artifacts/zotero-mcp-downloads');
fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(output, { recursive: true });
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inputFingerprint = digest(Buffer.concat(['manifest.json', 'requirements.lock', 'build-requirements.lock', 'serve.py'].map(name => fs.readFileSync(path.join(source, name)))));
const ready = path.join(output, 'runtime.json');
if (fs.existsSync(ready) && JSON.parse(fs.readFileSync(ready, 'utf8')).inputFingerprint === inputFingerprint
    && JSON.parse(fs.readFileSync(ready, 'utf8')).platform === platform
    && JSON.parse(fs.readFileSync(ready, 'utf8')).files.every(file => fs.existsSync(path.join(output, file.path)) && digest(fs.readFileSync(path.join(output, file.path))) === file.sha256)) {
  console.log(`[zotero-mcp] verified build inputs unchanged (${platform})`);
  process.exit(0);
}

async function archive(url, expected, name) {
  const file = path.join(cache, name);
  if (!fs.existsSync(file) || digest(fs.readFileSync(file)) !== expected) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Artifact download failed (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== expected) throw new Error(`Artifact integrity failed: ${name}`);
    fs.writeFileSync(file, bytes);
  }
  return file;
}

const pythonName = `cpython-${manifest.python}+${manifest.pythonBuild}-${target.triple}-install_only_stripped.tar.gz`;
const pythonArchive = await archive(`https://github.com/astral-sh/python-build-standalone/releases/download/${manifest.pythonBuild}/${encodeURIComponent(pythonName)}`, target.sha256, pythonName);
execFileSync('tar', ['-xzf', pythonArchive, '-C', output], { stdio: 'inherit' });
const python = path.join(output, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
const upstreamArchive = await archive(manifest.upstreamUrl, manifest.upstreamSha256, 'upstream.tar.gz');
const upstream = path.join(output, 'upstream');
fs.mkdirSync(upstream, { recursive: true });
execFileSync(python, ['-I', '-c',
  'import tarfile,sys; t=tarfile.open(sys.argv[1]); t.extractall(sys.argv[2],filter="data")', upstreamArchive, upstream]);
const upstreamRoot = path.join(upstream, fs.readdirSync(upstream)[0]);
const dependencies = path.join(output, 'dependencies');
fs.rmSync(dependencies, { recursive: true, force: true });
execFileSync(python, ['-I', '-m', 'pip', '--isolated', '--cache-dir', path.join(cache, 'pip'), 'install', '--disable-pip-version-check', '--only-binary=:all:',
  '--require-hashes', '--no-compile', '-r', path.join(source, 'build-requirements.lock')], { cwd: cache, stdio: 'inherit' });
execFileSync(python, ['-I', '-m', 'pip', '--isolated', '--cache-dir', path.join(cache, 'pip'), 'install', '--disable-pip-version-check', '--only-binary=:all:', '--no-binary=bibtexparser', '--no-build-isolation',
  '--require-hashes', '--no-compile', '--target', dependencies, '-r', path.join(source, 'requirements.lock')], {
  cwd: cache, env: { ...process.env, PIP_CACHE_DIR: path.join(cache, 'pip'), PYTHONNOUSERSITE: '1' }, stdio: 'inherit',
});
fs.cpSync(path.join(upstreamRoot, 'src/zotero_mcp'), path.join(dependencies, 'zotero_mcp'), { recursive: true });
fs.copyFileSync(path.join(source, 'serve.py'), path.join(output, 'serve.py'));
const legal = path.join(output, 'legal');
fs.mkdirSync(legal, { recursive: true });
fs.copyFileSync(path.join(upstreamRoot, 'LICENSE'), path.join(legal, 'ZOTERO_MCP_LICENSE.txt'));
fs.copyFileSync(path.join(source, 'requirements.lock'), path.join(legal, 'requirements.lock'));
// Keep every installed wheel's .dist-info license and provenance in the shipped
// tree. CPython's own license tree is retained verbatim as part of python/.
const files = [];
function inventory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inventory(file);
    else if (entry.isFile() && file !== ready) files.push({ path: path.relative(output, file), sha256: digest(fs.readFileSync(file)) });
  }
}
inventory(output);
fs.writeFileSync(ready, JSON.stringify({ ...manifest, platform, inputFingerprint, files }, null, 2));
console.log(`[zotero-mcp] prepared private runtime: ${platform}, ${files.length} files`);
