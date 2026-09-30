// Reuse this run's Electron rebuild on identical runners, then let the normal
// rebuild command discover any additional native dependencies. Never share a
// node_modules tree or restore native binaries from another workflow/commit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitAt } from './ci-test-shards.mjs';

const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = (root, folder) => fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
  const name = `${folder}/${entry.name}`;
  if (entry.isSymbolicLink()) return [];
  return entry.isDirectory() ? walk(root, name) : [name];
});
const safePath = file => typeof file === 'string' && file.startsWith('node_modules/')
  && !file.split('/').some(part => part === '..' || part === '.' || !part);

export function nativeFiles(root) {
  const markers = walk(root, 'node_modules').filter(file => /\/build\/(Release|Debug)\/\.forge-meta$/.test(file));
  assert.ok(markers.length, 'No Electron rebuild metadata found');
  return [...new Set(markers.flatMap(marker => {
    const folder = path.posix.dirname(path.posix.dirname(path.posix.dirname(marker)));
    const binaries = walk(root, folder).filter(file => file.endsWith('.node'));
    assert.ok(binaries.length, `No rebuilt binary in ${folder}`);
    return [marker, `${folder}/package.json`, ...binaries];
  }))].sort();
}

export function createNativeManifest(root, runtime) {
  const files = nativeFiles(root);
  for (const file of files.filter(file => file.endsWith('/.forge-meta'))) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), `${runtime.arch}--${runtime.abi}`, 'Native rebuild ABI mismatch');
  }
  return { schemaVersion: 1, runtime, files: Object.fromEntries(files.map(file => [file, hash(path.join(root, file))])) };
}

export function verifyNativeManifest(root, runtime, manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.runtime, runtime, 'Native artifact commit, lockfile or runtime mismatch');
  const files = Object.keys(manifest.files);
  assert.ok(files.every(safePath), 'Invalid native artifact path');
  assert.deepEqual(files.sort(), nativeFiles(root), 'Incomplete native rebuild inventory');
  for (const file of files) {
    assert.ok(!fs.lstatSync(path.join(root, file)).isSymbolicLink(), 'Native artifact must contain regular files');
    assert.equal(hash(path.join(root, file)), manifest.files[file], `Native hash mismatch: ${file}`);
  }
  for (const file of files.filter(file => file.endsWith('/.forge-meta'))) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), `${runtime.arch}--${runtime.abi}`, 'Native rebuild ABI mismatch');
  }
}

function electronCommand(root, code) {
  const require = createRequire(path.join(root, 'package.json'));
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_TEST_CONTEXT;
  return execFileSync(require('electron'), ['-e', code], { cwd: root, env, encoding: 'utf8', timeout: 30_000 }).trim();
}

function runtimeAt(root) {
  const actual = JSON.parse(electronCommand(root, 'console.log(JSON.stringify({ electron: process.versions.electron, abi: process.versions.modules }))'));
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
  assert.equal(actual.electron, expected, 'Electron executable differs from the locked package');
  return { commit: commitAt(root), lockHash: hash(path.join(root, 'package-lock.json')),
    platform: process.platform, arch: process.arch, node: process.versions.node, ...actual };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const manifestFile = path.join(root, '.ci/native-manifest.json');
  const runtime = runtimeAt(root);
  if (process.argv[2] === 'pack') {
    const manifest = createNativeManifest(root, runtime);
    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    execFileSync('tar', ['-czf', '.ci/native.tgz', ...Object.keys(manifest.files)], { cwd: root, stdio: 'inherit' });
  } else if (process.argv[2] === 'verify') {
    verifyNativeManifest(root, runtime, JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
    // Opening a real in-memory database proves the restored addon loads under
    // this executable's ABI; a marker alone is insufficient evidence.
    electronCommand(root, "const Database = require('better-sqlite3'); const db = new Database(':memory:'); if (db.prepare('select 42 as value').get().value !== 42) throw Error('SQLite probe failed'); db.close();");
    console.log('Native hashes, exact commit/lockfile/runtime and Electron SQLite load verified.');
  } else throw new Error('Usage: node scripts/ci-native-artifact.mjs pack|verify');
}
