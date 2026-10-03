import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { APPIMAGE_NAME, LEGACY_APPIMAGE_NAME, updateInformation, updateInfoSection, readEmbeddedBlockmap } from './finalize-linux-appimage.mjs';
import { releaseAssetUploadBatches, selectReleaseAssets } from './upload-release-assets.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');
const { Arch, Platform } = require('electron-builder');
const { PlatformPackager } = require('app-builder-lib/out/platformPackager.js');
const pkg = require('../package.json');

function runtime() {
  const buffer = Buffer.alloc(2048);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(buffer);
  Buffer.from([0x41, 0x49, 2]).copy(buffer, 8);
  buffer.writeUInt16LE(62, 18);
  buffer.writeBigUInt64LE(1024n, 40);
  buffer.writeUInt16LE(64, 58);
  buffer.writeUInt16LE(3, 60);
  buffer.writeUInt16LE(1, 62);
  Buffer.from('\0.shstrtab\0.upd_info\0').copy(buffer, 128);
  buffer.writeUInt32LE(1, 1088);
  buffer.writeBigUInt64LE(128n, 1088 + 24);
  buffer.writeBigUInt64LE(21n, 1088 + 32);
  buffer.writeUInt32LE(11, 1152);
  buffer.writeUInt32LE(1, 1152 + 4);
  buffer.writeBigUInt64LE(256n, 1152 + 24);
  buffer.writeBigUInt64LE(512n, 1152 + 32);
  return buffer;
}

async function withFile(buffer, action) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-appimage-test-'));
  const filename = path.join(root, APPIMAGE_NAME);
  await writeFile(filename, buffer);
  const file = await open(filename, 'r+');
  try { await action(file, filename); }
  finally { await file.close(); await rm(root, { recursive: true, force: true }); }
}

test('stable excludes prereleases and beta follows newer stable releases too', () => {
  assert.equal(updateInformation('latest'), `gh-releases-zsync|jorgepb96|nodus|latest|${APPIMAGE_NAME}.zsync`);
  assert.equal(updateInformation('beta'), `gh-releases-zsync|jorgepb96|nodus|latest-all|${APPIMAGE_NAME}.zsync`);
  assert.throws(() => updateInformation('nightly'), /Unsupported release channel/);
});

test('electron-builder resolves the AppImage-specific template to the canonical x86_64 name', () => {
  const packager = {
    config: pkg.build, platformSpecificBuildOptions: pkg.build.linux, platform: Platform.LINUX,
    appInfo: { name: pkg.name, productName: 'A Different Display Name', productFilename: 'Different', version: pkg.version },
    artifactPatternConfig: PlatformPackager.prototype.artifactPatternConfig,
    computeArtifactName: PlatformPackager.prototype.computeArtifactName,
    expandMacro: PlatformPackager.prototype.expandMacro,
  };
  assert.equal(PlatformPackager.prototype.expandArtifactNamePattern.call(packager, pkg.build.appImage, 'AppImage', Arch.x64), APPIMAGE_NAME);
});

test('locates only the reserved update section in a type-2 x86_64 runtime', async () => {
  await withFile(runtime(), async (file) => assert.deepEqual(await updateInfoSection(file), { offset: 256, size: 512 }));
  for (const mutate of [
    (buffer) => buffer.writeUInt8(1, 4),
    (buffer) => buffer.writeUInt8(0, 8),
    (buffer) => buffer.writeBigUInt64LE(5000n, 40),
    (buffer) => buffer.writeBigUInt64LE(2048n, 1152 + 24),
    (buffer) => buffer.writeUInt32LE(8, 1152 + 4),
    (buffer) => buffer.fill(0, 139, 149),
  ]) {
    const buffer = runtime();
    mutate(buffer);
    await withFile(buffer, async (file) => assert.rejects(updateInfoSection(file)));
  }
});

test('recognizes the real builder blockmap and refuses a truncated footer', async () => {
  await withFile(runtime(), async (file, filename) => {
    const info = await buildBlockMap(filename, 'deflate');
    const result = await readEmbeddedBlockmap(file);
    assert.equal(result.offset, 2048);
    assert.equal(result.blockMapSize, info.blockMapSize);
    await file.truncate(info.size - 2);
    await assert.rejects(readEmbeddedBlockmap(file));
  });
});

test('Linux cannot upload without the canonical image, zsync, alias and channel manifest', () => {
  for (const channel of ['latest', 'beta']) {
    const entries = ['Nodus-linux-amd64.deb', 'Nodus-linux-x86_64.rpm', APPIMAGE_NAME, `${APPIMAGE_NAME}.zsync`, LEGACY_APPIMAGE_NAME, `${channel}-linux.yml`];
    assert.deepEqual(selectReleaseAssets('linux', channel, entries), [...entries].sort());
    for (const required of [APPIMAGE_NAME, `${APPIMAGE_NAME}.zsync`, LEGACY_APPIMAGE_NAME, `${channel}-linux.yml`]) {
      assert.throws(() => selectReleaseAssets('linux', channel, entries.filter((entry) => entry !== required)), /Missing linux release asset/);
    }
  }
});

test('the compatibility alias is uploaded before the canonical image so the catalogue selects the new name', () => {
  const assets = [APPIMAGE_NAME, `${APPIMAGE_NAME}.zsync`, LEGACY_APPIMAGE_NAME, 'latest-linux.yml'].map((name) => path.join('/release', name));
  const batches = releaseAssetUploadBatches('linux', assets);
  assert.deepEqual(batches[0], [path.join('/release', LEGACY_APPIMAGE_NAME)]);
  assert.ok(batches[1].includes(path.join('/release', APPIMAGE_NAME)));
  assert.equal(batches.flat().length, assets.length);
  assert.deepEqual(releaseAssetUploadBatches('win', ['Nodus-win-x64.exe', 'latest.yml']), [['Nodus-win-x64.exe', 'latest.yml']]);
});
