// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import AdmZip from 'adm-zip';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'browser-extension');
const outputDir = path.join(root, 'dist-browser');
const output = path.join(outputDir, 'nodus-connector-chrome.zip');

const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('The Chrome connector must use Manifest V3.');
if (manifest.version !== pkg.version) throw new Error(`Connector ${manifest.version} does not match Nodus ${pkg.version}.`);
if (manifest.background?.scripts || manifest.content_security_policy?.extension_pages?.includes('http')) {
  throw new Error('Remote or legacy extension code is not permitted.');
}

const zip = new AdmZip();
async function addDirectory(directory, prefix = '') {
  const names = (await readdir(directory)).sort();
  for (const name of names) {
    if (name === '.DS_Store') continue;
    const absolute = path.join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const info = await stat(absolute);
    if (info.isDirectory()) await addDirectory(absolute, relative);
    else zip.addFile(relative, await readFile(absolute));
  }
}
await addDirectory(source);
for (const [name, archiveName] of [
  ['LICENSE', 'LICENSE'],
  ['SOURCE_CODE.md', 'SOURCE_CODE.md'],
  ['PRIVACY.md', 'NODUS_PRIVACY.md'],
]) zip.addFile(archiveName, await readFile(path.join(root, name)));

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
zip.writeZip(output);
console.log(`[browser-extension] Built ${path.relative(root, output)} (${zip.getEntries().length} files)`);
