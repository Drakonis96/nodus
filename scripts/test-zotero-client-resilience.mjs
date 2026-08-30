import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-resilience-'));
let mode = 'retry';
let requests = 0;
const server = createServer((request, response) => {
  requests += 1;
  assert.equal(request.headers['zotero-allowed-request'], '1', 'the browser-safety opt-in reaches Zotero');
  assert.equal(request.headers['zotero-api-version'], '3', 'the local API response contract is explicit');
  if (mode === 'closed') {
    request.socket.destroy();
    return;
  }
  if (mode === 'unauthorized') {
    response.statusCode = 401;
    response.end('{}');
    return;
  }
  if (requests < 3) {
    response.statusCode = 429;
    response.setHeader('Retry-After', '0');
    response.end('{}');
    return;
  }
  response.statusCode = 200;
  response.setHeader('Last-Modified-Version', '91');
  response.end('[]');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const output = path.join(scratch, 'zotero-client.mjs');
  await build({ entryPoints: [path.resolve('electron/zotero/zoteroClient.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm' });

  const originalBase = process.env.NODUS_ZOTERO_API_BASE;
  delete process.env.NODUS_ZOTERO_API_BASE;
  const defaultClient = await import(`${pathToFileURL(output).href}?default=${Date.now()}`);
  assert.equal(
    defaultClient.ZOTERO_API_BASE,
    'http://127.0.0.1:23119/api',
    'the default matches the IPv4 loopback address Zotero actually binds',
  );

  process.env.NODUS_ZOTERO_API_BASE = `http://127.0.0.1:${server.address().port}/api`;
  const client = await import(`${pathToFileURL(output).href}?resilience=${Date.now()}`);

  assert.equal(await client.libraryVersion('0'), 91);
  assert.equal(requests, 3, 'rate limits are retried before the sync is reported as partial');

  mode = 'unauthorized'; requests = 0;
  await assert.rejects(client.libraryVersion('0'), (error) => error.code === 'credentials-expired' && error.retryable === false);
  assert.equal(requests, 1, 'expired credentials are not retried');
  requests = 0;
  await assert.rejects(client.libraries(), (error) => error.code === 'credentials-expired' && error.retryable === false);
  assert.equal(requests, 1, 'a failed group-library inventory never degrades to a falsely complete personal-only list');

  mode = 'closed'; requests = 0;
  await assert.rejects(client.libraryVersion('0'), (error) => error.code === 'zotero-closed' && error.retryable === true);
  assert.equal(requests, 3, 'a temporarily closed Zotero receives bounded retries');
  if (originalBase === undefined) delete process.env.NODUS_ZOTERO_API_BASE;
  else process.env.NODUS_ZOTERO_API_BASE = originalBase;
  console.log('Zotero retry and structured failure tests passed!');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
