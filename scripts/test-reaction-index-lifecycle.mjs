import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-reaction-lifecycle-'));
test.after(() => fs.rm(tmp, { recursive: true, force: true }));

for (const phase of ['open', 'write']) {
  test(`download rejects an asynchronous output ${phase} error without hanging`, { timeout: 10_000 }, async () => {
    const outfile = path.join(tmp, `download-${phase}.mjs`);
    await build({ entryPoints: [path.join(root, 'electron/network/assetDownload.ts')], outfile,
      bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
      plugins: [{ name: 'disk-failure', setup(api) {
        api.onResolve({ filter: /^node:fs$/ }, args => args.namespace === 'mock' ? undefined : { path: 'fs', namespace: 'mock' });
        api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
          export * from 'node:fs';
          import { Writable } from 'node:stream';
          export function createWriteStream() {
            const error = Object.assign(new Error('disk failure'), {code: ${JSON.stringify(phase === 'open' ? 'EACCES' : 'ENOSPC')}});
            const stream = new Writable({write(chunk, encoding, callback) { callback(error); }});
            ${phase === 'open' ? 'process.nextTick(() => stream.destroy(error));' : ''}
            return stream;
          }
        ` }));
      } }],
    });
    const { downloadAsset } = await import(pathToFileURL(outfile));
    const body = Buffer.alloc(200_000, 7);
    await assert.rejects(downloadAsset({
      url: `data:application/octet-stream;base64,${body.toString('base64')}`,
      target: path.join(tmp, `${phase}.bin`), bytes: body.length,
    }), { code: phase === 'open' ? 'EACCES' : 'ENOSPC' });
    await assert.rejects(fs.stat(path.join(tmp, `${phase}.bin`)), { code: 'ENOENT' });
  });
}

test('service emits an idle terminal status after success, failure and cancellation, and can retry', { timeout: 15_000 }, async t => {
  const body = Buffer.alloc(200_000, 9);
  let mode = 'success', requests = 0, signalStarted;
  const server = http.createServer((_req, res) => {
    requests++;
    if (mode === 'failure') { res.writeHead(500); res.end(); return; }
    res.setHeader('Content-Length', body.length);
    if (mode === 'cancel') { res.write(body.subarray(0, 100)); signalStarted(); return; }
    res.end(body);
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const profile = path.join(tmp, 'profile');
  const outfile = path.join(tmp, 'service.mjs');
  await build({ stdin: { contents: "export * from './electron/reactionIndex/index'; export * from './shared/reactionIndex';", resolveDir: root, loader: 'ts' },
    outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'profile', setup(api) {
      api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
      api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const app={getPath:()=>${JSON.stringify(profile)}};` }));
    } }],
  });
  const { reactionIndexService, REACTION_INDEX } = await import(pathToFileURL(outfile));
  REACTION_INDEX.releaseUrl = `http://127.0.0.1:${server.address().port}`;
  REACTION_INDEX.files = [{ name: 'index.bin', bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }];
  const service = reactionIndexService();
  const events = [];
  service.onChange(status => events.push(status));
  const [first, joined] = await Promise.all([service.ensure(), service.ensure()]);
  assert.equal(requests, 1, 'concurrent callers share the same download');
  for (const result of [first, joined, events.at(-1), await service.status()]) {
    assert.equal(result.downloading, false);
    assert.equal(result.available, true);
    assert.equal(result.progress, 1);
  }
  await service.remove();
  mode = 'failure';
  await assert.rejects(service.ensure(), /HTTP 500/);
  assert.equal(events.at(-1).downloading, false);
  assert.equal(events.at(-1).available, false);
  mode = 'cancel';
  const started = new Promise(resolve => { signalStarted = resolve; });
  const cancelled = assert.rejects(service.ensure(), { name: 'AbortError' });
  await started;
  service.cancel();
  await cancelled;
  assert.equal(events.at(-1).downloading, false);
  assert.equal(events.at(-1).available, false);
  mode = 'success';
  const retried = await service.ensure();
  assert.equal(retried.available, true);
  assert.equal(retried.downloading, false);
  assert.equal(events.at(-1).downloading, false);
});
