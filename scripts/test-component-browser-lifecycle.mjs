import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeComponentBrowser, launchComponentBrowser } from './lib/component-test-browser.mjs';

const exited = () => ({ exitCode: 0, signalCode: null });
const deadlines = { timeoutMs: 20, killTimeoutMs: 1000, diagnostic: () => {} };

test('a graceful shutdown finishes without forcing the browser', async () => {
  let closed = false;
  await closeComponentBrowser({
    close: async () => { closed = true; },
    kill: async () => { assert.fail('a closed browser must not be killed'); },
    process: exited,
  }, deadlines);
  assert.equal(closed, true);
});

test('a stalled shutdown kills only the owned process and waits for its exit', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  const exit = once(child, 'exit');
  const messages = [];
  let killed = false;
  try {
    await closeComponentBrowser({
      close: () => new Promise(() => {}),
      kill: async () => { killed = true; child.kill('SIGKILL'); await exit; },
      process: () => child,
    }, { ...deadlines, diagnostic: message => messages.push(message) });
    assert.equal(killed, true);
    assert.match(messages[0], /shutdown exceeded.*terminating the owned browser/);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.throws(() => process.kill(child.pid, 0), error => error.code === 'ESRCH');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exit;
  }
});

test('shutdown errors trigger cleanup but assertion failures still propagate', async () => {
  let killed = false;
  const server = {
    close: async () => { throw new Error('Chrome disconnected'); },
    kill: async () => { killed = true; },
    process: exited,
  };
  await assert.rejects(async () => {
    try { assert.equal('wrong model', 'expected model'); }
    finally { await closeComponentBrowser(server, deadlines); }
  }, { code: 'ERR_ASSERTION' });
  assert.equal(killed, true);
});

test('a failed or stalled force termination cannot pass cleanup', async () => {
  for (const kill of [
    async () => { throw new Error('owned process cannot be killed'); },
    () => new Promise(() => {}),
  ]) {
    await assert.rejects(closeComponentBrowser({
      close: () => new Promise(() => {}), kill, process: exited,
    }, { ...deadlines, killTimeoutMs: 20 }), /termination failed/);
  }
  await assert.rejects(closeComponentBrowser({
    close: async () => {}, kill: async () => {},
    process: () => ({ exitCode: null, signalCode: null }),
  }, deadlines), /process did not exit/);
});

test('a connection failure still closes the launched browser', async () => {
  let closed = false;
  await assert.rejects(launchComponentBrowser({
    launchServer: async options => {
      assert.equal(options.host, '127.0.0.1');
      return { wsEndpoint: () => 'ws://127.0.0.1/test', close: async () => { closed = true; }, process: exited };
    },
    connect: async () => { throw new Error('fixture connection failed'); },
  }, { headless: true }), /fixture connection failed/);
  assert.equal(closed, true);
});

test('closing a fixture twice shares the same owned-process cleanup', async () => {
  let closes = 0;
  const fixture = await launchComponentBrowser({
    launchServer: async () => ({ wsEndpoint: () => 'ws://127.0.0.1/test', close: async () => { closes++; }, process: exited }),
    connect: async () => ({}),
  }, {});
  await Promise.all([fixture.close(), fixture.close()]);
  assert.equal(closes, 1);
});
