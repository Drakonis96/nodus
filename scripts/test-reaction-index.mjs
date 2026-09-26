import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { readSource } from './ipc-channel-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-reaction-index-'));

async function bundle(entry, name) {
  const outfile = path.join(tmp, name);
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

try {
  // --- descriptor integrity ---
  const { REACTION_INDEX, reactionIndexTotalBytes } = await bundle('shared/reactionIndex.ts', 'descriptor.mjs');
  assert.equal(REACTION_INDEX.formatVersion, 3);
  assert.equal(REACTION_INDEX.licence, 'CC-BY-SA-4.0');
  assert.match(REACTION_INDEX.revision, /^[a-f0-9]{40}$/, 'the ORD revision is pinned');
  assert.deepEqual(REACTION_INDEX.files.map((file) => file.name), [
    'exact.tsv.zst', 'templates.tsv.zst', 'products.tsv.zst', 'reaction-smiles.tsv.zst', 'reactions.faiss.zst', 'reaction-keys.txt.zst',
  ]);
  assert.ok(REACTION_INDEX.files.every((file) => Number.isInteger(file.bytes) && file.bytes > 0), 'every file has a byte size');
  assert.ok(REACTION_INDEX.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), 'every file is pinned by SHA-256');
  assert.equal(reactionIndexTotalBytes(), 263231224, 'total size matches the built artifact');

  // --- downloader: fresh, resume (Range), and corruption ---
  const { downloadAsset } = await bundle('electron/network/assetDownload.ts', 'assetDownload.mjs');
  const body = Buffer.alloc(200000, 7);
  const sha = createHash('sha256').update(body).digest('hex');
  let sawRange = null;
  const server = http.createServer((req, res) => {
    const range = req.headers.range;
    if (range) {
      sawRange = range;
      const start = Number(/bytes=(\d+)-/.exec(range)[1]);
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${body.length - 1}/${body.length}`);
      res.end(body.subarray(start));
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Length', String(body.length));
    res.end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/asset`;

  // fresh
  const full = path.join(tmp, 'a.bin');
  await downloadAsset({ url, target: full, bytes: body.length, sha256: sha });
  assert.deepEqual(await readFile(full), body, 'a verified download lands intact');

  // resume from a partial
  const resumed = path.join(tmp, 'b.bin');
  await writeFile(`${resumed}.download`, body.subarray(0, 40000));
  await downloadAsset({ url, target: resumed, bytes: body.length, sha256: sha });
  assert.equal(sawRange, `bytes=40000-`, 'an interrupted transfer resumes with HTTP Range');
  assert.deepEqual(await readFile(resumed), body, 'the resumed file is complete');

  // corruption is rejected and the target is not created
  const corrupt = path.join(tmp, 'c.bin');
  await assert.rejects(
    () => downloadAsset({ url, target: corrupt, bytes: body.length, sha256: 'f'.repeat(64) }),
    /SHA-256/,
    'a digest mismatch is refused',
  );
  await assert.rejects(() => readFile(corrupt), 'no unverified target is left behind');
  server.close();

  // --- wiring ---
  const [service, download, ipc, preload, sharedApi] = await Promise.all([
    Promise.resolve(readSource('electron/reactionIndex/index.ts')),
    Promise.resolve(readSource('electron/network/assetDownload.ts')),
    Promise.resolve(readSource('electron/ipc/reactionIndex.ts')),
    Promise.resolve(readSource('electron/preload/reactionIndex.ts')),
    Promise.resolve(readSource('shared/api/reactionIndex.ts')),
  ]);
  assert.match(download, /createHash\('sha256'\)/, 'the downloader verifies SHA-256');
  assert.match(download, /Range: `bytes=\$\{resumedBytes\}-`/, 'the downloader resumes with a Range header');
  assert.match(download, /received !== expectedBytes/, 'the downloader enforces the exact byte count');
  assert.match(service, /NODUS_REACTION_INDEX_DIR/, 'the service has a developer override for a local build');
  assert.match(service, /descriptor\.json/, 'the service writes a verification descriptor after download');
  assert.match(ipc, /reactionIndex:download/, 'the download is exposed over IPC');
  assert.match(preload, /reactionIndex:progress/, 'progress is pushed to the renderer');
  assert.match(sharedApi, /getReactionIndexStatus/, 'the renderer API is declared');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
