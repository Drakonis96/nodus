import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-hlc-'));
try {
  const output = path.join(root, 'hlc.mjs');
  await build({ entryPoints: [path.resolve('shared/syncOperations.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm' });
  const hlc = await import(pathToFileURL(output));
  const first = hlc.tickHlc(null, 'device-a', 1_700_000_000_000);
  const second = hlc.tickHlc(first, 'device-a', 1_699_999_999_999);
  assert.equal(first, '1700000000000-000000-device-a');
  assert.equal(second, '1700000000000-000001-device-a', 'clock rollback advances the logical counter');
  const remote = '1700000001000-000004-device-b';
  assert.equal(hlc.mergeHlc(second, remote, 'device-a', 1_700_000_000_500), '1700000001000-000005-device-a');
  assert.equal(hlc.compareHlc(remote, second) > 0, true);
  assert.equal(hlc.compareHlc('1700000001000-000004-device-a', remote) < 0, true, 'device id is a stable final tie-break');
  assert.equal(hlc.parseHlc('bad'), null);
  assert.throws(() => hlc.formatHlc({ wallTime: 1, counter: 1_000_000, deviceId: 'x' }), /Invalid/);
  console.log('Hybrid logical clock test passed!');
} finally { await rm(root, { recursive: true, force: true }); }
