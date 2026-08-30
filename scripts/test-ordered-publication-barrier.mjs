import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';

const file = new URL('../electron/ai/orderedPublicationBarrier.ts', import.meta.url);
const source = fs.readFileSync(file, 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, DOMException, AbortController });
const { OrderedPublicationBarrier } = module.exports;

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('publications apply exactly once in ticket order although inference finishes out of order', async () => {
  const barrier = new OrderedPublicationBarrier();
  const tickets = [barrier.issue(), barrier.issue(), barrier.issue()];
  const releases = tickets.map(() => deferred());
  const applied = [];
  const runs = tickets.map((ticket, index) => (async () => {
    await releases[index].promise;
    await barrier.publish(ticket, async () => { applied.push(index); });
  })());

  releases[2].resolve();
  releases[1].resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(applied, []);
  releases[0].resolve();
  await Promise.all(runs);
  assert.deepEqual(applied, [0, 1, 2]);
  assert.equal(JSON.stringify(barrier.snapshot()), JSON.stringify({ issued: 3, next: 3, terminal: [], waiting: [] }));
});

test('a failed earlier ticket is terminal and cannot strand later publications', async () => {
  const barrier = new OrderedPublicationBarrier();
  const first = barrier.issue();
  const second = barrier.issue();
  const applied = [];
  const later = barrier.publish(second, async () => { applied.push('second'); });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(applied, []);
  barrier.finish(first);
  await later;
  assert.deepEqual(applied, ['second']);
});

test('cancelled waiters never publish and a later terminal signal still advances the barrier', async () => {
  const barrier = new OrderedPublicationBarrier();
  const first = barrier.issue();
  const second = barrier.issue();
  const controller = new AbortController();
  const waiting = barrier.publish(second, async () => assert.fail('cancelled task ran'), controller.signal);
  controller.abort(new Error('cancelled'));
  await assert.rejects(waiting, /cancelled/);
  barrier.finish(second);
  barrier.finish(first);
  assert.equal(barrier.snapshot().next, 2);
});
