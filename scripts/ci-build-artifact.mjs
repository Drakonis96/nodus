// Transfer only this run's build, preserving native helper permissions in tar.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitAt } from './ci-test-shards.mjs';

const directories = ['dist', 'dist-electron', 'server/dist/web', 'cloudflare/dist'];
const required = ['dist/index.html', 'dist-electron/main.js', 'server/dist/web/index.html', 'cloudflare/dist/worker.mjs'];
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = (root, folder) => fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
  const name = `${folder}/${entry.name}`;
  assert.ok(!entry.isSymbolicLink(), `Unexpected build symlink: ${name}`);
  return entry.isDirectory() ? walk(root, name) : [name];
}).sort();

export function createBuildManifest(root, commit, folders = directories) {
  for (const file of required) assert.ok(fs.existsSync(path.join(root, file)), `Build output missing: ${file}`);
  return { schemaVersion: 1, commit, files: Object.fromEntries(folders.flatMap(folder => walk(root, folder)).map(file => [file, hash(path.join(root, file))])) };
}

export function verifyBuildManifest(root, commit, manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.commit, commit, 'Build belongs to a different commit');
  for (const file of required) assert.ok(manifest.files[file], `Build output missing: ${file}`);
  for (const [file, digest] of Object.entries(manifest.files)) {
    assert.ok(!path.isAbsolute(file) && !file.split('/').includes('..'), 'Invalid artifact path');
    assert.equal(hash(path.join(root, file)), digest, `Build hash mismatch: ${file}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const manifestFile = path.join(root, '.ci/build-manifest.json');
  if (process.argv[2] === 'pack') {
    const folders = [...directories];
    if (process.platform === 'darwin') folders.push(`build/apple-calendar/${process.arch}`);
    fs.mkdirSync(path.join(root, '.ci'), { recursive: true });
    fs.writeFileSync(manifestFile, `${JSON.stringify(createBuildManifest(root, commitAt(root), folders), null, 2)}\n`);
    execFileSync('tar', ['-czf', '.ci/build.tgz', ...folders], { cwd: root, stdio: 'inherit' });
  } else if (process.argv[2] === 'verify') {
    verifyBuildManifest(root, commitAt(root), JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
    console.log('The build manifest matches this commit and every transferred file.');
  } else throw new Error('Usage: node scripts/ci-build-artifact.mjs pack|verify');
}
