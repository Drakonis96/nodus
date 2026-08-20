import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-radar-test-'));
const userData = path.join(temp, 'profile');
process.env.NODUS_TEST_USERDATA = userData;
test.after(() => rm(temp, { recursive: true, force: true }));

const bundle = path.join(temp, 'radar-service.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'electron/radar/radarService.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
  `--alias:electron=${path.join(root, 'scripts/stub-electron.mjs')}`, `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });
const { RadarService } = createRequire(import.meta.url)(bundle);

const types = ['topic', 'search', 'author', 'journal', 'paper', 'rss', 'website'];
const values = {
  topic: 'AI and scholarly communication',
  search: 'knowledge graphs AND humanities',
  author: '0000-0002-1825-0097',
  journal: 'Journal of Informetrics',
  paper: '10.1145/3589334.3645492',
  rss: 'https://example.org/feed.xml',
  website: 'https://example.org/research',
};

function candidate(follow) {
  return [{
    source: follow.type === 'rss' ? 'RSS' : follow.type === 'website' ? 'Web monitor' : follow.type === 'journal' ? 'Crossref' : follow.type === 'author' ? 'ORCID' : follow.type === 'search' ? 'Semantic Scholar' : 'OpenAlex',
    externalId: `${follow.type}-fixture-1`,
    title: `${follow.type} update`,
    authors: 'Researcher One · Example Journal',
    summary: `A deterministic ${follow.type} result.`,
    url: `https://example.org/results/${follow.type}`,
    ...(follow.type === 'paper' ? { doi: values.paper } : {}),
    signal: 'Relevant',
  }];
}

test('all seven follow types persist, check, deduplicate, pause, edit, read, and remove', async () => {
  let now = Date.parse('2026-08-20T08:00:00Z');
  const storeFile = path.join(userData, 'radar-store.json');
  const service = new RadarService({ storeFile, now: () => now, fixtureProvider: async (follow) => candidate(follow) });

  for (const type of types) service.createFollow({ type, value: values[type], title: `${type} follow`, cadence: 'daily' });
  let snapshot = service.snapshot();
  assert.equal(snapshot.follows.length, 7);
  assert.equal(snapshot.nextCheckAt, now);
  assert.equal(snapshot.sources.find((source) => source.name === 'RSS').followCount, 1);
  assert.equal(snapshot.sources.find((source) => source.name === 'Web monitor').followCount, 1);

  const first = await service.check({ reason: 'manual' });
  assert.deepEqual({ checked: first.checked, newItems: first.newItems, errors: first.errors }, { checked: 7, newItems: 7, errors: 0 });
  assert.equal(first.snapshot.unreadCount, 7);
  assert.equal(first.snapshot.updates.length, 7);
  assert.ok(first.snapshot.follows.every((follow) => follow.lastCheckedAt === now));

  now += 60_000;
  const duplicate = await service.check({ reason: 'manual' });
  assert.equal(duplicate.newItems, 0, 'the same external results must not re-enter Inbox');
  assert.equal(duplicate.snapshot.updates.length, 7);

  const [firstFollow] = duplicate.snapshot.follows;
  const updated = service.updateFollow(firstFollow.id, { title: 'Edited title', cadence: 'weekly', paused: true });
  assert.equal(updated.title, 'Edited title');
  assert.equal(updated.cadence, 'weekly');
  assert.equal(updated.paused, true);
  assert.equal(updated.nextCheckAt, null);
  assert.equal((await service.check({ followIds: [updated.id] })).checked, 0, 'paused follows must never be checked');

  const firstUpdate = service.snapshot().updates[0];
  assert.equal(service.markUpdateRead(firstUpdate.id).unreadCount, 6);
  assert.equal(service.markUpdateRead(firstUpdate.id, false).unreadCount, 7);
  assert.equal(service.markAllRead().unreadCount, 0);

  const beforeRemove = service.snapshot().updates.filter((update) => update.followId === updated.id).length;
  assert.equal(beforeRemove, 1);
  snapshot = service.removeFollow(updated.id);
  assert.equal(snapshot.follows.length, 6);
  assert.equal(snapshot.updates.some((update) => update.followId === updated.id), false, 'removal clears that follow’s Inbox records');

  const reloaded = new RadarService({ storeFile, now: () => now, fixtureProvider: async (follow) => candidate(follow) }).snapshot();
  assert.equal(reloaded.follows.length, 6, 'Radar is install-global and durable');
  assert.equal(reloaded.updates.length, 6);
  const stored = JSON.parse(await readFile(storeFile, 'utf8'));
  assert.equal(stored.version, 1);

  const notifications = JSON.parse(await readFile(path.join(userData, 'nodi-notifications.json'), 'utf8'));
  const radarNotification = notifications.find((notification) => notification.action?.type === 'radar');
  assert.ok(radarNotification, 'a check with new results must reach the global/Nodi notification store');
  assert.equal(radarNotification.titleText.id, 'radarUpdatesTitle');
});

test('invalid URLs and duplicate follows are rejected without corrupting the store', () => {
  const storeFile = path.join(temp, 'validation-store.json');
  const service = new RadarService({ storeFile, fixtureProvider: async () => [] });
  assert.throws(() => service.createFollow({ type: 'rss', value: 'example.org/feed' }), /complete HTTP/);
  service.createFollow({ type: 'website', value: 'https://example.org/page' });
  assert.throws(() => service.createFollow({ type: 'website', value: 'https://example.org/page' }), /already following/);
  assert.equal(service.snapshot().follows.length, 1);
});
