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
const inputFingerprint = digest(Buffer.concat([fs.readFileSync(import.meta.filename), ...['manifest.json', 'requirements.lock', 'build-requirements.lock', 'serve.py', 'license_inventory.py', 'license_overrides.json', ...fs.readdirSync(path.join(source, 'licenses')).sort().map(name => `licenses/${name}`)].map(name => fs.readFileSync(path.join(source, name)))]));
const ready = path.join(output, 'runtime.json');
if (fs.existsSync(ready) && JSON.parse(fs.readFileSync(ready, 'utf8')).inputFingerprint === inputFingerprint
    && JSON.parse(fs.readFileSync(ready, 'utf8')).platform === platform
    && JSON.parse(fs.readFileSync(ready, 'utf8')).files.every(file => fs.existsSync(path.join(output, file.path)) && (file.target ? fs.lstatSync(path.join(output, file.path)).isSymbolicLink() && fs.readlinkSync(path.join(output, file.path)) === file.target : digest(fs.readFileSync(path.join(output, file.path))) === file.sha256))) {
  console.log(`[zotero-mcp] verified build inputs unchanged (${platform})`);
  process.exit(0);
}

async function archive(url, expected, name) {
  const file = path.join(cache, name);
  if (fs.existsSync(file) && digest(fs.readFileSync(file)) === expected) return file;
  // A hosted runner closes the connection mid-download often enough that one attempt
  // turns a transient socket error into a failed job. A truncated body fails the hash
  // too, so both are retried; a 4xx is not, because a pinned asset that is missing or
  // moved will not appear on a second try.
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const error = new Error(`Artifact download failed (${response.status})`);
        if (response.status < 500) error.permanent = true;
        throw error;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (digest(bytes) !== expected) throw new Error(`Artifact integrity failed: ${name}`);
      fs.writeFileSync(file, bytes);
      return file;
    } catch (error) {
      if (attempt === 3 || error.permanent) throw error;
      console.warn(`[zotero-mcp] ${name}: ${error.message}. Retrying (${attempt + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, attempt * 5_000));
    }
  }
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
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
let nativeCrypto = null;
let buildEnvironment = { ...process.env, PIP_CACHE_DIR: path.join(cache, 'pip'), PYTHONNOUSERSITE: '1',
  PATH: `${path.dirname(python)}${path.delimiter}${process.env.PATH ?? ''}` };
if (platform === 'darwin-x64') {
  const cryptoBuild = manifest.nativeCryptoBuild;
  const opensslArchive = await archive(cryptoBuild.url, cryptoBuild.sha256, `openssl-${cryptoBuild.openssl}.tar.gz`);
  const buildRoot = path.join(cache, `native-crypto-${platform}`);
  fs.rmSync(buildRoot, { recursive: true, force: true });
  fs.mkdirSync(buildRoot, { recursive: true });
  execFileSync('tar', ['-xzf', opensslArchive, '-C', buildRoot], { stdio: 'inherit' });
  const opensslSource = path.join(buildRoot, `openssl-${cryptoBuild.openssl}`);
  const prefix = path.join(buildRoot, 'install');
  execFileSync('perl', ['Configure', 'darwin64-x86_64-cc', 'no-shared', 'no-tests', 'no-module', `--prefix=${prefix}`], { cwd: opensslSource, stdio: 'inherit' });
  // install_sw starts overlapping recursive build targets under parallel make.
  // Build once with two workers, then install serially to avoid duplicate writes.
  execFileSync('make', ['-j2', 'build_sw'], { cwd: opensslSource, stdio: 'inherit' });
  execFileSync('make', ['-j1', 'install_sw'], { cwd: opensslSource, stdio: 'inherit' });
  const rustVersion = execFileSync('rustc', [`+${cryptoBuild.rust}`, '--version'], { encoding: 'utf8' }).trim();
  if (!rustVersion.startsWith(`rustc ${cryptoBuild.rust} `)) throw new Error('Incorrect native crypto Rust toolchain');
  buildEnvironment = { ...buildEnvironment, OPENSSL_DIR: prefix, OPENSSL_STATIC: '1', RUSTUP_TOOLCHAIN: cryptoBuild.rust,
    CARGO_BUILD_JOBS: '2', CARGO_HOME: path.join(cache, 'native-crypto-cargo'), MATURIN_PEP517_ARGS: '--locked', MATURIN_NO_INSTALL_RUST: '1' };
  nativeCrypto = { source: opensslSource, ...cryptoBuild, rustVersion };
}
execFileSync(python, ['-I', '-m', 'pip', '--isolated', '--cache-dir', path.join(cache, 'pip'), 'install', '--disable-pip-version-check', '--only-binary=:all:', `--no-binary=${nativeCrypto ? 'bibtexparser,cryptography' : 'bibtexparser'}`, '--no-build-isolation',
  '--require-hashes', '--no-compile', '--target', dependencies, '-r', path.join(source, 'requirements.lock')], {
  cwd: cache, env: buildEnvironment, stdio: 'inherit',
});
fs.cpSync(path.join(upstreamRoot, 'src/zotero_mcp'), path.join(dependencies, 'zotero_mcp'), { recursive: true });
fs.copyFileSync(path.join(source, 'serve.py'), path.join(output, 'serve.py'));
const legal = path.join(output, 'legal');
fs.mkdirSync(legal, { recursive: true });
if (nativeCrypto) {
  fs.copyFileSync(path.join(nativeCrypto.source, 'LICENSE.txt'), path.join(legal, 'NATIVE_CRYPTO_OPENSSL_LICENSE.txt'));
  const { source: _source, ...provenance } = nativeCrypto;
  fs.writeFileSync(path.join(legal, 'native-crypto-build.json'), JSON.stringify(provenance, null, 2));
  // Retain the exact locked Rust dependency source archives with their embedded
  // notices. These are build sources, never importable runtime dependencies.
  const registry = path.join(buildEnvironment.CARGO_HOME, 'registry/cache');
  const rustSources = path.join(legal, 'rust-sources');
  fs.mkdirSync(rustSources, { recursive: true });
  const crates = [];
  for (const registryName of fs.readdirSync(registry)) for (const name of fs.readdirSync(path.join(registry, registryName))) {
    if (!name.endsWith('.crate')) continue;
    const bytes = fs.readFileSync(path.join(registry, registryName, name));
    fs.writeFileSync(path.join(rustSources, name), bytes);
    crates.push({ name, sha256: digest(bytes) });
  }
  fs.writeFileSync(path.join(rustSources, 'inventory.json'), JSON.stringify(crates, null, 2));
}
fs.copyFileSync(path.join(upstreamRoot, 'LICENSE'), path.join(legal, 'ZOTERO_MCP_LICENSE.txt'));
fs.copyFileSync(path.join(source, 'requirements.lock'), path.join(legal, 'requirements.lock'));
const fullName = `cpython-${manifest.python}+${manifest.pythonBuild}-${target.triple}-${target.fullBuild}-full.tar.zst`;
const fullArchive = await archive(`https://github.com/astral-sh/python-build-standalone/releases/download/${manifest.pythonBuild}/${encodeURIComponent(fullName)}`, target.fullSha256, fullName);
const licenseEntries = execFileSync('tar', ['-tf', fullArchive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n')
  .map(name => name.trim())
  .filter(name => name === 'python/PYTHON.json' || name.startsWith('python/licenses/'));
if (!licenseEntries.includes('python/PYTHON.json') || licenseEntries.some(name => name.includes('..'))) throw new Error('Invalid Python license archive');
execFileSync('tar', ['-xf', fullArchive, '-C', legal, ...licenseEntries]);
fs.cpSync(path.join(source, 'licenses'), path.join(legal, 'supplemental'), { recursive: true });
// The pinned standalone archive references zlib-ng's notice but omits the file.
fs.copyFileSync(path.join(source, 'licenses/LICENSE.zlib-ng.txt'), path.join(legal, 'python/licenses/LICENSE.zlib-ng.txt'));
fs.copyFileSync(path.join(source, 'license_overrides.json'), path.join(legal, 'license_overrides.json'));
execFileSync(python, ['-I', path.join(source, 'license_inventory.py'), output], { stdio: 'inherit' });
fs.rmSync(upstream, { recursive: true, force: true });
// Build tools are not runtime dependencies. Keep the private interpreter free of
// pip, setuptools and wheel after the hash-locked installation has completed.
const sitePackages = process.platform === 'win32' ? path.join(output, 'python/Lib/site-packages') : path.join(output, 'python/lib/python3.12/site-packages');
fs.rmSync(sitePackages, { recursive: true, force: true });
// Keep every installed wheel's .dist-info license and provenance in the shipped
// tree. CPython's own license tree is retained verbatim as part of python/.
const files = [];
function inventory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inventory(file);
    else if (entry.isSymbolicLink()) {
      if (!fs.realpathSync(file).startsWith(`${fs.realpathSync(output)}${path.sep}`)) throw new Error('Runtime symlink escapes bundle');
      files.push({ path: path.relative(output, file), target: fs.readlinkSync(file) });
    }
    else if (entry.isFile() && file !== ready) files.push({ path: path.relative(output, file), sha256: digest(fs.readFileSync(file)) });
  }
}
inventory(output);
fs.writeFileSync(ready, JSON.stringify({ ...manifest, platform, inputFingerprint, files }, null, 2));
console.log(`[zotero-mcp] prepared private runtime: ${platform}, ${files.length} files`);
