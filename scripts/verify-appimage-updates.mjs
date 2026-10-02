// Linux integration check using the real electron-builder runtime/blockmap,
// zsync client, and electron-updater differential downloader and installer.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { dump, load } from 'js-yaml';
import { APPIMAGE_NAME, LEGACY_APPIMAGE_NAME, finalizeLinuxAppImage, updateInformation, verifyAppImage } from './finalize-linux-appimage.mjs';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Run this verification on x86_64 Linux with zsync and libfuse2 installed');
const require = createRequire(import.meta.url);
const { Arch, NodeHttpExecutor } = require('builder-util');
const { CancellationToken } = require('builder-util-runtime');
const { buildLegacyFuse2AppImage } = require('app-builder-lib/out/targets/appimage/appImageUtil.js');
const { FileWithEmbeddedBlockMapDifferentialDownloader } = require('electron-updater/out/differentialDownloader/FileWithEmbeddedBlockMapDifferentialDownloader.js');
const { AppImageUpdater } = require('electron-updater/out/AppImageUpdater.js');
const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-appimage-integration-'));
const logger = { info: console.log, warn: console.warn, error: console.error };
// AppImage's AI magic in the ELF padding is not recognized by Docker's binfmt
// handler on an ARM Mac. An explicit qemu path allows the same check there.
const runImage = (image, args, options) => process.env.NODUS_APPIMAGE_EMULATOR
  ? execFileSync(process.env.NODUS_APPIMAGE_EMULATOR, [image, ...args], options)
  : execFileSync(image, args, options);

async function build(directory, version) {
  const appDir = path.join(directory, 'app');
  const stageDir = path.join(directory, 'stage');
  await mkdir(appDir, { recursive: true });
  await mkdir(stageDir);
  await writeFile(path.join(appDir, 'nodus'), `#!/bin/sh\nprintf 'Nodus fixture ${version}\\n'\n`, { mode: 0o755 });
  // An unchanged payload makes both delta clients prove that they reuse bytes.
  await writeFile(path.join(appDir, 'payload'), Buffer.alloc(512 * 1024, 'Nodus compatibility fixture\n'));
  const info = await buildLegacyFuse2AppImage({ appDir, stageDir, arch: Arch.x64, output: path.join(directory, APPIMAGE_NAME), options: {
    executableName: 'nodus', productName: 'Nodus', productFilename: 'Nodus', desktopBaseName: 'nodus',
    desktopEntry: '[Desktop Entry]\nName=Nodus\nExec=AppRun\nIcon=nodus\nType=Application\nCategories=Office;\n',
    icons: [{ file: path.join(repoRoot, 'build/icon.png'), size: 512 }], fileAssociations: [],
  } });
  const channel = version.includes('-beta.') ? 'beta' : 'latest';
  const manifest = { version, files: [{ url: APPIMAGE_NAME, ...info }], path: APPIMAGE_NAME, sha512: info.sha512, releaseDate: new Date().toISOString() };
  await writeFile(path.join(directory, `${channel}-linux.yml`), dump(manifest));
  return { info, manifest, channel };
}

try {
  const oldDir = path.join(root, 'old');
  const newDir = path.join(root, 'new');
  const betaDir = path.join(root, 'beta');
  await build(oldDir, '5.7.4');
  for (const [directory, version] of [[newDir, '5.7.5'], [betaDir, '5.7.6-beta.1']]) {
    const { channel } = await build(directory, version);
    const image = path.join(directory, APPIMAGE_NAME);
    const before = path.join(directory, 'before');
    const after = path.join(directory, 'after');
    await mkdir(before);
    await mkdir(after);
    runImage(image, ['--appimage-extract'], { cwd: before, stdio: 'pipe' });
    await finalizeLinuxAppImage(directory, channel);
    assert.equal(runImage(image, ['--appimage-updateinformation'], { encoding: 'utf8' }).trim(), updateInformation(channel));
    runImage(image, ['--appimage-extract'], { cwd: after, stdio: 'pipe' });
    for (const name of ['AppRun', 'nodus', 'payload', 'nodus.desktop']) {
      assert.deepEqual(await readFile(path.join(before, 'squashfs-root', name)), await readFile(path.join(after, 'squashfs-root', name)));
    }
    assert.match(execFileSync(path.join(after, 'squashfs-root/AppRun'), [], { encoding: 'utf8', env: { ...process.env, APPDIR: path.join(after, 'squashfs-root') } }), new RegExp(version.replaceAll('.', '\\.')));
    assert.deepEqual(await readFile(image), await readFile(path.join(directory, LEGACY_APPIMAGE_NAME)));
    // Rerunning a release job must not accumulate multiple embedded blockmaps.
    const finalized = await readFile(image);
    await finalizeLinuxAppImage(directory, channel);
    assert.deepEqual(await readFile(image), finalized);
    console.log(`[appimage-test] ${channel}: runtime reads metadata; payload/launcher preserved; alias identical; rerun idempotent`);
  }
  const image = path.join(newDir, APPIMAGE_NAME);
  const manifest = load(await readFile(path.join(newDir, 'latest-linux.yml'), 'utf8'));
  const entry = manifest.files[0];
  const imageBytes = await readFile(image);
  let transferred = 0;
  const server = createServer((request, response) => {
    response.setHeader('Connection', 'close');
    const size = imageBytes.length;
    const ranges = request.headers.range?.replace(/^bytes=/, '').split(',').map((range) => {
      const [start, end] = range.trim().split('-');
      return { start: Number(start), end: end ? Math.min(Number(end), size - 1) : size - 1 };
    });
    if (!ranges) { transferred += size; response.writeHead(200, { 'Content-Length': size }); response.end(imageBytes); return; }
    for (const range of ranges) transferred += range.end - range.start + 1;
    if (ranges.length === 1) {
      const { start, end } = ranges[0];
      response.writeHead(206, { 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
      response.end(imageBytes.subarray(start, end + 1));
    } else {
      const boundary = 'nodus_appimage_ranges';
      // zsync 0.6.2 expects an empty MIME preamble before the first boundary.
      const parts = [Buffer.from('\r\n'), ...ranges.flatMap(({ start, end }) => [Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes ${start}-${end}/${size}\r\n\r\n`), imageBytes.subarray(start, end + 1), Buffer.from('\r\n')])];
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      const body = Buffer.concat(parts);
      response.writeHead(206, { 'Content-Type': `multipart/byteranges; boundary=${boundary}`, 'Content-Length': body.length });
      response.end(body);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/${APPIMAGE_NAME}`;
    const downloaded = path.join(root, 'electron-download.AppImage');
    await new FileWithEmbeddedBlockMapDifferentialDownloader(entry, new NodeHttpExecutor(), {
      oldFile: path.join(oldDir, APPIMAGE_NAME), newFile: downloaded, newUrl: new URL(url), logger,
      isUseMultipleRangeRequest: false, cancellationToken: new CancellationToken(),
    }).download();
    assert.deepEqual(await readFile(downloaded), await readFile(image));
    assert.ok(transferred < entry.size, 'Electron must reuse old bytes, with no full-download fallback');
    console.log(`[appimage-test] electron-updater reconstructed exact final bytes with ${transferred}/${entry.size} bytes transferred`);
    const zsync = await readFile(`${image}.zsync`);
    const split = zsync.indexOf('\n\n') + 2;
    const control = path.join(root, 'local.zsync');
    await writeFile(control, Buffer.concat([Buffer.from(zsync.subarray(0, split).toString().replace(/^URL: .*$/m, `URL: ${url}`)), zsync.subarray(split)]));
    transferred = 0;
    const zsyncOutput = path.join(root, 'zsync-download.AppImage');
    const result = await run('zsync', ['-q', '-i', path.join(oldDir, APPIMAGE_NAME), '-o', zsyncOutput, control], { cwd: root, timeout: 60_000 });
    assert.deepEqual(await readFile(zsyncOutput), await readFile(image));
    assert.ok(transferred < entry.size, 'zsync must reuse old bytes');
    console.log(`[appimage-test] zsync reconstructed exact final bytes with ${transferred}/${entry.size} bytes transferred`);
    console.log(result.stdout.trim());
    // Exercise the real installer's rename behavior with a disposable legacy
    // filename. Capture the restart request instead of starting a GUI process.
    const installed = path.join(root, LEGACY_APPIMAGE_NAME);
    await copyFile(path.join(oldDir, APPIMAGE_NAME), installed);
    process.env.APPIMAGE = installed;
    let restart;
    assert.equal(AppImageUpdater.prototype.doInstall.call({ installerPath: downloaded, spawnLog: (file) => { restart = file; }, emit: () => { throw new Error('Unexpected filename change'); } }, { isForceRunAfter: true }), true);
    assert.equal(restart, installed);
    assert.deepEqual(await readFile(installed), await readFile(image));
    delete process.env.APPIMAGE;
    await verifyAppImage(image, manifest, 'latest');
    console.log('[appimage-test] legacy installation keeps its filename and requests restart with the finalized image');
  } finally { await new Promise((resolve) => server.close(resolve)); }
} finally { await rm(root, { recursive: true, force: true }); }
