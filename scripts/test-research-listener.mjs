import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-listener')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-listener-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const foreign = http.createServer(), owned = http.createServer();
try {
  const { listenLoopback } = require(path.join(repoRoot, 'electron/listenLoopback.ts'));
  const preferred = await listenLoopback(foreign, 0);
  const effective = await listenLoopback(owned, preferred);
  assert.notEqual(effective, preferred);
  assert.equal(owned.address().address, '127.0.0.1');
  assert.equal(foreign.address().port, preferred, 'a foreign listener is never stopped or reassigned');
  await new Promise(resolve => owned.close(resolve));
  assert.ok(foreign.listening);
  console.log('Occupied preferred port selects a free loopback listener and preserves the foreign owner.');
} finally {
  if (owned.listening) await new Promise(resolve => owned.close(resolve));
  if (foreign.listening) await new Promise(resolve => foreign.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
