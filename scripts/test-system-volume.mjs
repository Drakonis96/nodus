import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-volume-'));
await symlink(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'));
test.after(() => rm(dir, { recursive: true, force: true }));
const require = createRequire(import.meta.url);
function load(source) {
  const bundle = path.join(dir, `${path.basename(source)}.cjs`);
  execFileSync(path.join(repo, 'node_modules/.bin/esbuild'), [path.join(repo, source),
    '--bundle', '--platform=node', '--format=cjs', '--external:react', `--outfile=${bundle}`],
  { stdio: ['ignore', 'ignore', 'inherit'] });
  return require(bundle);
}
const { SystemVolume } = load('electron/toolkit/presenter/systemVolume.ts');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a slider burst writes only its latest value', async () => {
  const writes = [];
  const volume = new SystemVolume(async () => 60, async (v) => { writes.push(v); });
  await Promise.all([volume.set(40), volume.set(50), volume.set(60)]);
  assert.deepEqual(writes, [60]);
});

test('40 then 60 cannot finish out of order or replay intermediate inputs', async () => {
  const first = deferred();
  const last = deferred();
  const writes = [];
  let actual = 20;
  const volume = new SystemVolume(async () => actual, async (v) => {
    writes.push(v);
    await (v === 40 ? first.promise : last.promise);
    actual = v;
  });
  const forty = volume.set(40);
  await Promise.resolve();
  const fifty = volume.set(50);
  const sixty = volume.set(60);
  const read = volume.get();
  assert.deepEqual(writes, [40], 'only one system write may run at a time');
  first.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(writes, [40, 60]);
  last.resolve();
  await Promise.all([forty, fifty, sixty]);
  assert.equal(await read, 60, 'polls cannot report the intermediate 40');
});

test('a read already in flight is discarded after a new volume request', async () => {
  const stale = deferred();
  let reads = 0;
  const volume = new SystemVolume(() => ++reads === 1 ? stale.promise : Promise.resolve(60), async () => {});
  const read = volume.get();
  await Promise.resolve();
  await volume.set(60);
  stale.resolve(40);
  assert.equal(await read, 60);
});

test('a failed write does not strand the newer value queued behind it', async () => {
  const first = deferred();
  const writes = [];
  const volume = new SystemVolume(async () => 60, async (v) => {
    writes.push(v);
    if (v === 40) await first.promise;
  });
  const forty = volume.set(40);
  await Promise.resolve();
  const sixty = volume.set(60);
  first.reject(new Error('temporary system error'));
  await Promise.all([forty, sixty]);
  assert.deepEqual(writes, [40, 60]);
});

test('a final system failure rejects and subsequent changes still work', async () => {
  let fail = true;
  const volume = new SystemVolume(async () => 60, async () => { if (fail) throw new Error('system error'); });
  await assert.rejects(volume.set(40), /system error/);
  fail = false;
  await volume.set(60);
  assert.equal(await volume.get(), 60);
});

test('the rendered slider follows external changes and ignores stale polls during input', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://nodus.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const act = React.act ?? require('react-dom/test-utils').act;
  const { useDeviceVolume } = load('src/components/browser/useDeviceVolume.ts');
  let poll, probe;
  let actual = 20;
  let nextRead = null;
  const write = deferred();
  const writes = [];
  window.setInterval = (callback) => { poll = callback; return 1; };
  window.clearInterval = () => { poll = null; };
  window.nodus = {
    getBrowserDeviceVolume: () => nextRead ?? Promise.resolve(actual),
    setBrowserDeviceVolume: (v) => { writes.push(v); return write.promise; },
  };
  function Slider({ active }) {
    probe = useDeviceVolume(active);
    return React.createElement('input', { type: 'range', value: probe.volume, disabled: !probe.ready, readOnly: true });
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Slider, { active: true })));
    const slider = document.querySelector('input');
    assert.equal(slider.value, '20');
    assert.equal(slider.disabled, false);
    actual = 35;
    await act(async () => { poll(); });
    assert.equal(slider.value, '35', 'keyboard or Control Center changes reach the open slider');

    const stale = deferred();
    nextRead = stale.promise;
    await act(async () => { poll(); });
    await act(async () => { probe.changeVolume(40); probe.changeVolume(60); });
    await act(async () => { stale.resolve(35); });
    assert.equal(slider.value, '60', 'a pre-input poll cannot move the slider backwards');
    assert.deepEqual(writes, [40, 60]);
    nextRead = null;
    await act(async () => { poll(); });
    assert.equal(slider.value, '60', 'polling is suspended until system writes settle');
    actual = 60;
    await act(async () => { write.resolve(); });
    actual = 45;
    await act(async () => { poll(); });
    assert.equal(slider.value, '45', 'external synchronization resumes after the input');
    await act(async () => root.render(React.createElement(Slider, { active: false })));
    assert.equal(poll, null, 'closing the panel stops polling');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
