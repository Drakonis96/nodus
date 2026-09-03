// The installer filenames are a PUBLIC CONTRACT, and nothing used to hold them.
//
// https://github.com/Drakonis96/nodus/releases/latest/download/Nodus-mac-arm64.dmg
// is what the site's download buttons, the README and every electron-updater
// manifest resolve. Those URLs outlive any one release: an install from a year
// ago auto-updates through them.
//
// electron-builder derives each filename from `build.artifactName`. That template
// used to interpolate ${productName}, so renaming the product to "Nodus Research"
// in 4.2.4 silently renamed every artifact — `Nodus Research-linux-amd64.deb` —
// and the v4.2.4 release failed at upload on all three platforms. Nothing had
// connected the template to the names the rest of the project depends on, so the
// break was invisible until the release ran.
//
// This file is that connection. The displayed product name is free to change;
// these filenames are not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');
const pkg = JSON.parse(read('package.json'));

/** What electron-builder would name each artifact, from the real template. */
function artifactName(template, { os, arch, ext }) {
  return template
    .replaceAll('${productName}', pkg.build.productName)
    .replaceAll('${name}', pkg.name)
    .replaceAll('${version}', pkg.version)
    .replaceAll('${os}', os)
    .replaceAll('${arch}', arch)
    .replaceAll('${ext}', ext);
}

const PUBLISHED = [
  { os: 'mac', arch: 'arm64', ext: 'dmg', name: 'Nodus-mac-arm64.dmg' },
  { os: 'mac', arch: 'arm64', ext: 'zip', name: 'Nodus-mac-arm64.zip' },
  { os: 'mac', arch: 'x64', ext: 'dmg', name: 'Nodus-mac-x64.dmg' },
  { os: 'mac', arch: 'x64', ext: 'zip', name: 'Nodus-mac-x64.zip' },
  { os: 'win', arch: 'x64', ext: 'exe', name: 'Nodus-win-x64.exe' },
  { os: 'linux', arch: 'amd64', ext: 'deb', name: 'Nodus-linux-amd64.deb' },
  { os: 'linux', arch: 'x86_64', ext: 'AppImage', name: 'Nodus-linux-x86_64.AppImage' },
];

test('THE REGRESSION: the artifact template does not interpolate the product name', () => {
  // The whole failure in one line. A display name can be rebranded at any time,
  // and doing so must not touch a single published URL.
  assert.doesNotMatch(pkg.build.artifactName, /\$\{productName\}/,
    'artifactName must not depend on productName: renaming the product would rename every download URL');
  assert.ok(pkg.build.artifactName.startsWith('Nodus-'),
    `artifactName must start with the literal "Nodus-", got ${pkg.build.artifactName}`);
});

test('every artifact electron-builder builds is named exactly what is published', () => {
  for (const target of PUBLISHED) {
    assert.equal(artifactName(pkg.build.artifactName, target), target.name);
  }
});

test('renaming the product cannot move a single download URL', () => {
  // Proves the property rather than the current value: pretend the product is
  // called something else entirely and check the filenames do not budge.
  const rebranded = { ...pkg, build: { ...pkg.build, productName: 'Something Else Entirely' } };
  for (const target of PUBLISHED) {
    const name = rebranded.build.artifactName
      .replaceAll('${os}', target.os).replaceAll('${arch}', target.arch).replaceAll('${ext}', target.ext);
    assert.equal(name, target.name);
  }
});

test('no artifact filename contains a space', () => {
  // A space becomes %20 in a download URL and breaks hand-written links and
  // shell one-liners alike. "Nodus Research-linux-amd64.deb" was exactly this.
  for (const target of PUBLISHED) {
    assert.doesNotMatch(artifactName(pkg.build.artifactName, target), /\s/, target.name);
  }
});

test('the uploader expects the names the builder produces', () => {
  const uploader = read('scripts/upload-release-assets.mjs');
  for (const target of PUBLISHED) {
    assert.ok(uploader.includes(`'${target.name}'`),
      `upload-release-assets.mjs must expect ${target.name}`);
  }
  // And it selects by literal prefixes of the same pinned template, never by a
  // pattern derived from the product name.
  for (const prefix of ['Nodus-mac-arm64', 'Nodus-mac-x64', 'Nodus-win', 'Nodus-linux']) {
    assert.ok(uploader.includes(`'${prefix}'`), `upload-release-assets.mjs must select by ${prefix}`);
  }
});

test('the release workflow verifies the same names before publishing', () => {
  const workflow = read('.github/workflows/release-build.yml');
  for (const name of ['Nodus-mac-arm64.dmg', 'Nodus-mac-x64.dmg', 'Nodus-win-x64.exe', 'Nodus-linux-amd64.deb', 'Nodus-linux-x86_64.AppImage']) {
    assert.ok(workflow.includes(name), `the release workflow must verify ${name}`);
  }
});

test('the download links the public actually clicks resolve to these names', () => {
  const base = 'https://github.com/Drakonis96/nodus/releases/latest/download/';
  const page = read('site/app/index.html');
  for (const name of ['Nodus-mac-arm64.dmg', 'Nodus-mac-x64.dmg', 'Nodus-win-x64.exe', 'Nodus-linux-amd64.deb', 'Nodus-linux-x86_64.AppImage']) {
    assert.ok(page.includes(`${base}${name}`), `site/app/index.html links ${name}`);
  }
  const readme = read('README.md');
  for (const name of ['Nodus-mac-arm64.dmg', 'Nodus-mac-x64.dmg']) {
    assert.ok(readme.includes(`${base}${name}`), `README.md links ${name}`);
  }
});
