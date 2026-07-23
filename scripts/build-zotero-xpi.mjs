// Package zotero-plugin/ into an installable .xpi and generate the matching
// Zotero auto-update manifest (updates.json). Single source of truth = the
// plugin's manifest.json (id, version, strict versions).
//
//   node scripts/build-zotero-xpi.mjs [--base <url>]
//
// --base (or env ZOTERO_XPI_BASE) is the public directory where the .xpi will
// be hosted. Releases override it with their immutable tag URL; local builds
// default to the stable latest-release URL used for direct downloads.
//
// Outputs to dist-zotero/:
//   nodus-zotero.xpi   — fixed-name packaged add-on (manifest.json at root)
//   updates.json       — served at manifest.update_url; points Zotero at the
//                        tagged .xpi with a sha256 integrity hash.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'zotero-plugin');
const outDir = path.join(repoRoot, 'dist-zotero');

function parseBase() {
  const arg = process.argv.find((a) => a.startsWith('--base='));
  if (arg) return arg.slice('--base='.length);
  const i = process.argv.indexOf('--base');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.ZOTERO_XPI_BASE || 'https://github.com/Drakonis96/nodus/releases/latest/download/';
}

// Files to include: the whole plugin tree, minus junk. manifest.json lands at
// the zip root (required by Zotero) because we add paths relative to pluginDir.
const SKIP = new Set(['.DS_Store', 'Thumbs.db']);
function collectFiles(dir, rel = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...collectFiles(abs, relPath));
    else out.push({ abs, relPath });
  }
  return out;
}

export function buildXpi() {
  const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
  const app = manifest.applications?.zotero ?? {};
  const id = app.id;
  const version = manifest.version;
  if (!id || !version) throw new Error('manifest.json missing applications.zotero.id or version');

  const files = collectFiles(pluginDir);
  if (!files.some((f) => f.relPath === 'manifest.json')) throw new Error('manifest.json not found at plugin root');

  const zip = new AdmZip();
  for (const f of files) {
    zip.addFile(f.relPath, readFileSync(f.abs)); // relPath keeps manifest.json at zip root
  }
  mkdirSync(outDir, { recursive: true });
  const xpiName = 'nodus-zotero.xpi';
  const xpiPath = path.join(outDir, xpiName);
  zip.writeZip(xpiPath);

  const buf = readFileSync(xpiPath);
  const sha256 = createHash('sha256').update(buf).digest('hex');

  const base = parseBase().endsWith('/') ? parseBase() : parseBase() + '/';
  const zoteroApp = {};
  if (app.strict_min_version) zoteroApp.strict_min_version = app.strict_min_version;
  if (app.strict_max_version) zoteroApp.strict_max_version = app.strict_max_version;
  const updates = {
    addons: {
      [id]: {
        updates: [
          {
            version,
            update_link: base + xpiName,
            update_hash: `sha256:${sha256}`,
            ...(Object.keys(zoteroApp).length ? { applications: { zotero: zoteroApp } } : {}),
          },
        ],
      },
    },
  };
  const updatesPath = path.join(outDir, 'updates.json');
  writeFileSync(updatesPath, JSON.stringify(updates, null, 2) + '\n');

  return { id, version, xpiName, xpiPath, updatesPath, sha256, base, updateUrl: manifest.applications?.zotero?.update_url, fileCount: files.length };
}

// Run as a script (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = buildXpi();
  console.log(`✔ Built ${r.xpiName} (${r.fileCount} files)`);
  console.log(`  ${r.xpiPath}`);
  console.log(`  sha256: ${r.sha256}`);
  console.log(`✔ Wrote updates.json → ${r.updatesPath}`);
  console.log('');
  console.log('Publish the XPI at the update_link base and updates.json at the manifest update_url:');
  console.log(`  update_url in manifest : ${r.updateUrl || '(none)'}`);
  console.log(`  XPI update_link base   : ${r.base}`);
  console.log('Zotero polls updates.json and offers the new version to installed users.');
}
