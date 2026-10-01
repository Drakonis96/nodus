import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { closeComponentBrowser, launchComponentBrowser } from './lib/component-test-browser.mjs';

const exited = () => Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null, stdio: [] });
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
    process: () => Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, stdio: [] }),
  }, deadlines), /process did not exit/);
});

test('inherited pipes cannot block cleanup after the owned process exits', { timeout: 10_000 }, async () => {
  for (const alreadyExited of [false, true]) {
    // The helper inherits stdout/stderr but outlives the parent. Node's close
    // event stays pending even though exitCode is already zero: the CI failure.
    const child = spawn(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 1, 2] });
      helper.unref();
      process.on('message', () => process.exit(0));
      process.send(helper.pid);
    `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const closed = once(child, 'close');
    const exit = once(child, 'exit');
    const [helperPid] = await once(child, 'message');
    try {
      if (alreadyExited) {
        child.send('exit');
        await exit;
        assert.equal(child.exitCode, 0);
        assert.equal(child.stdout.destroyed, false, 'the inherited output pipe is still open');
      }
      await closeComponentBrowser({
        close: () => {
          if (!alreadyExited) {
            assert.equal(child.exitCode, null);
            assert.equal(child.stdout.destroyed, false, 'a live browser must keep its pipes');
            child.send('exit');
          }
          return closed;
        },
        kill: async () => { assert.fail('an exited browser must finish cleanup without force termination'); },
        process: () => child,
      }, { ...deadlines, timeoutMs: 2000 });
      assert.equal(child.exitCode, 0);
      assert.equal(child.stdout.destroyed, true);
      assert.equal(child.stderr.destroyed, true);
      assert.equal(child.listenerCount('exit'), 0);
    } finally {
      // Only the explicitly spawned fixture helper is terminated.
      try { process.kill(helperPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      child.stdio.forEach(stream => stream?.destroy?.());
      await closed;
    }
  }
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
