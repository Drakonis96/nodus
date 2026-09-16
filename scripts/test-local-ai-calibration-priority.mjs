import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRuntimeModule, until } from './local-ai-runtime-test-utils.mjs';

test('foreground work cancels active AND queued calibration and waits for cleanup only', async (t) => {
  const { LocalCalibrationQueue } = await loadRuntimeModule(t, 'electron/ai/localAiCalibration.ts');
  const queue = new LocalCalibrationQueue();
  const events = [];
  const first = queue.schedule('first', async (signal) => {
    events.push('first-start');
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    events.push('first-cleaned');
    signal.throwIfAborted();
  });
  const second = queue.schedule('second', async () => { events.push('second-start'); });
  await until(() => queue.activeKey === 'first');
  await queue.runForeground(async () => {
    events.push('foreground');
    await queue.schedule('third', async () => events.push('third-start'));
  });
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-cleaned', 'foreground']);
  assert.equal(queue.activeKey, null);
  await queue.schedule('later', async () => events.push('later-start'));
  assert.equal(events.at(-1), 'later-start', 'future idle calibration is still possible');
});

test('failed calibration cannot poison future requests, and foreground work is never cancelled by calibration', async (t) => {
  const { LocalCalibrationQueue } = await loadRuntimeModule(t, 'electron/ai/localAiCalibration.ts');
  const queue = new LocalCalibrationQueue();
  const failure = queue.schedule('broken', async () => { throw new Error('fixture failure'); });
  await assert.rejects(failure, /fixture failure/);
  let release;
  let entered = false;
  const foreground = queue.runForeground(async () => {
    entered = true;
    await new Promise((resolve) => { release = resolve; });
    return 42;
  });
  await until(() => entered);
  await queue.schedule('must-not-run', async () => assert.fail('calibration preempted user work'));
  release();
  assert.equal(await foreground, 42);
});
