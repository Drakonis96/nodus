// Assembles the signed capability packages that ship inside the application.
//
// A profile upgrading from 5.3.1 has to be able to adopt its three disciplines with no
// network at all, so the packages travel in the build. They are inert: nothing is
// registered, extracted or loaded on a clean install, and only the one a profile actually
// asked for is ever opened — and then verified exactly like a download, because bytes
// that arrived with the application are not thereby trusted.
//
// Two sources, in order: the pinned GitHub release (what a real build uses), or a local
// marketplace checkout (what a development build uses, so the migration can be exercised
// before a release exists).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'build', 'capability-bootstrap');
const pinned = JSON.parse(fs.readFileSync(path.join(root, 'electron/capabilities/bootstrap.json'), 'utf8'));

function findMarketplace() {
  if (process.env.NODUS_MARKETPLACE_DIR) return process.env.NODUS_MARKETPLACE_DIR;
  for (let current = root; ; current = path.dirname(current)) {
    const candidate = path.join(path.dirname(current), 'nodus-research-skill-marketplace');
    if (fs.existsSync(path.join(candidate, '.git'))) return candidate;
    if (path.dirname(current) === current) return null;
  }
}

async function download(url, limit) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error(`${url} is larger than the pinned size`);
  return bytes;
}

const target = `${process.platform}-${process.arch}`;
fs.rmSync(out, { recursive: true, force: true });

// Before a release exists there is nothing to pin against, so a development build reads
// what the marketplace checkout actually produced. A published build never does: its
// entries carry a releaseUrl and a digest, and anything else is refused.
const marketplace = findMarketplace();
const built = (() => {
  const index = marketplace && path.join(marketplace, 'build', 'index.json');
  try { return JSON.parse(fs.readFileSync(index, 'utf8')); } catch { return []; }
})();

let written = 0;
for (const entry of pinned.packages) {
  const local = built.filter(candidate => candidate.manifest.id === entry.id)
    .map(candidate => ({ target: candidate.target, asset: candidate.asset, bytes: candidate.bytes, sha256: candidate.sha256 }));
  const assets = entry.assets.length ? entry.assets : local;
  const asset = assets.find(candidate => candidate.target === target) ?? assets.find(candidate => candidate.target === 'any');
  if (!asset) {
    console.warn(`No ${entry.id} package for ${target}; the migration will fall back to the catalogue.`);
    continue;
  }
  const dir = path.join(out, entry.id);
  fs.mkdirSync(dir, { recursive: true });

  let archive, manifest, signature;
  if (entry.releaseUrl) {
    archive = await download(`${entry.releaseUrl}/${asset.asset}`, asset.bytes);
    manifest = await download(`${entry.releaseUrl}/release-manifest.json`, 256 * 1024);
    signature = await download(`${entry.releaseUrl}/release-manifest.sig`, 4096);
    if (createHash('sha256').update(archive).digest('hex') !== asset.sha256) throw new Error(`${entry.id} does not match its pinned digest`);
  } else {
    const archivePath = marketplace && path.join(marketplace, 'build', asset.asset);
    if (!archivePath || !fs.existsSync(archivePath)) {
      console.warn(`${entry.id} is not published and not built locally; skipping. The migration will use the catalogue.`);
      fs.rmSync(dir, { recursive: true, force: true });
      continue;
    }
    // A development build has no signed release to pin against, so the package is taken
    // as built and the absence of a signature is what stops it being installed.
    archive = fs.readFileSync(archivePath);
    const manifestPath = path.join(marketplace, 'build', 'release-manifest.json');
    const signaturePath = path.join(marketplace, 'build', 'release-manifest.sig');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(signaturePath)) {
      console.warn(`${entry.id} was built but not signed; it is not bundled. Sign a release to include it.`);
      fs.rmSync(dir, { recursive: true, force: true });
      continue;
    }
    manifest = fs.readFileSync(manifestPath);
    signature = fs.readFileSync(signaturePath);
  }

  fs.writeFileSync(path.join(dir, asset.asset), archive);
  fs.writeFileSync(path.join(dir, 'release-manifest.json'), manifest);
  fs.writeFileSync(path.join(dir, 'release-manifest.sig'), signature);
  written++;
}

fs.mkdirSync(out, { recursive: true });
console.log(`Bundled ${written} bootstrap package(s) for ${target}.`);
