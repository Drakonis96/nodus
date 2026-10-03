import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const code = buildSync({ entryPoints: ['electron/toolkit/presenter/native.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false, external: ['electron'] }).outputFiles[0].text;
function presenter(multipeer) {
  const writes = [], launches = [];
  const child = new EventEmitter();
  child.stdin = { destroyed: false, write: text => writes.push(JSON.parse(text)), on() {}, end() {} };
  child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
  child.stderr = { resume() {} }; child.kill = () => {};
  const state = { pdfId: null, currentSlide: 1, toolMode: 'pointer', totalSlides: 3 };
  const context = { module: { exports: {} }, exports: {}, URL, URLSearchParams, console,
    process: { platform: 'darwin', arch: 'arm64', env: multipeer ? { NODUS_PRESENTER_TRANSPORT: 'multipeer' } : {} },
    setTimeout: () => ({ unref() {} }),
    require(name) {
      if (name === 'electron') return { app: { isPackaged: false, getAppPath: () => '/test/nodus' } };
      if (name === 'node:child_process') return { spawn: (...args) => { launches.push(args); return child; } };
      if (name === 'node:fs') return { existsSync: () => true, readFileSync: () => '{"presentations":[],"folders":[]}' };
      return require(name);
    },
  };
  vm.runInNewContext(code, context);
  const api = context.module.exports;
  api.startNativePresenter({ libraryDir: () => '/test/library', getState: () => state,
    onAction() {}, getVolume: () => 50, setVolume() {} });
  return { api, writes, launches, child, state };
}
test('Multipeer movement echoes are compact and retain the sender identity', () => {
  const { api, writes } = presenter(true);
  const action = { type: 'toolData', data: { tool: 'pointer', x: 23, y: 65, size: 20 } };
  api.broadcastNativePresenter(action, 'test-device');
  const echo = writes.at(-1).message;
  assert.equal(echo.kind, 'tool'); assert.equal(echo.origin, 'test-device');
  assert.deepEqual(echo.action, action);
  assert.equal(echo.state, undefined); assert.equal(echo.deck, undefined);
  api.broadcastNativePresenter({ type: 'setToolColor', color: '#abcdef' });
  assert.equal(writes.at(-1).message.kind, 'update');
  assert.equal(writes.at(-1).message.state.currentSlide, 1);
  api.stopNativePresenter();
});
test('drawing retains every start, point and end in compact delivery and reconnect replay', async () => {
  const { api, writes, child } = presenter(true);
  const events = [ { type: 'toolData', data: { tool: 'draw', action: 'start', x: 0, y: 50 } },
    ...Array.from({ length: 300 }, (_, i) => ({ type: 'toolData', data: { tool: 'draw', action: 'move', x: i / 3, y: 50 } })),
    { type: 'toolData', data: { tool: 'draw', action: 'end', x: 100, y: 50 } } ];
  for (const action of events) api.broadcastNativePresenter(action, 'test-device');
  const streamed = writes.filter(w => w.message?.kind === 'tool');
  assert.equal(streamed.length, events.length);
  assert.deepEqual(streamed.map(w => w.message.action), events);
  child.stdout.emit('data', JSON.stringify({ kind: 'client', channel: 'control', id: 'test-client' }) + '\n');
  await Promise.resolve();
  const snapshot = writes.find(w => w.id === 'test-client' && w.message?.kind === 'update');
  assert.deepEqual(Array.from(snapshot.message.overlay), events);
  api.stopNativePresenter();
});
test('the default Network route retains its existing state echo and startup arguments', () => {
  const { api, writes, launches } = presenter(false);
  assert.equal(launches[0][1].length, 0);
  api.broadcastNativePresenter({ type: 'toolData', data: { tool: 'pointer', x: 10, y: 20 } }, 'test-device');
  assert.equal(writes.at(-1).message.kind, 'update');
  assert.equal(writes.at(-1).message.state.currentSlide, 1);
  api.stopNativePresenter();
});
