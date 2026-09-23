import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-activity-'));
const require = createRequire(import.meta.url);
try {
  for (const [name, source] of [['activity', 'electron/ai/researchActivity.ts'], ['state', 'shared/researchActivity.ts']]) {
    await build({ entryPoints: [source], outfile: path.join(root, `${name}.cjs`), bundle: true, platform: 'node', format: 'cjs' });
  }
  const { withResearchActivity, startResearchActivity, researchActivityStep, researchActivityEnabled } = require(path.join(root, 'activity.cjs'));
  const { updateResearchActivities, settleResearchActivities } = require(path.join(root, 'state.cjs'));
  const first = [], second = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const a = withResearchActivity(event => first.push(event), undefined, async () => {
    assert.equal(researchActivityEnabled(), true);
    return researchActivityStep('nodus', 'lexical', async () => { await gate; return ['a', 'b']; }, 'a'.repeat(500));
  });
  const b = withResearchActivity(event => second.push(event), undefined, async () => {
    const finish = startResearchActivity('zotero', 'metadata', 'Synthetic source');
    release(); await gate; finish(); finish('failed');
  });
  await Promise.all([a, b]);
  assert.equal(first.length, 2); assert.equal(second.length, 2);
  assert.ok(first.every(event => event.layer === 'nodus'));
  assert.ok(second.every(event => event.layer === 'zotero'));
  assert.notEqual(first[0].id, second[0].id);
  assert.equal(first[1].count, 2); assert.equal(first[0].subject.length, 240);
  assert.equal(first[0].status, 'active'); assert.equal(first[1].status, 'completed');
  assert.ok(first[1].finishedAt >= first[0].startedAt);
  assert.equal(researchActivityEnabled(), false);
  await withResearchActivity(undefined, undefined, async () => {
    assert.equal(researchActivityEnabled(), false);
    await researchActivityStep('ideas', 'search', () => []);
  });
  assert.equal(first.length, 2, 'shared Deep Research helpers do not emit without a chat context');
  const events = [], abort = new AbortController(); let late;
  await withResearchActivity(event => events.push(event), abort.signal, async () => {
    late = startResearchActivity('profiles', 'semantic');
    await assert.rejects(() => researchActivityStep('nodus', 'search', () => { throw new Error('fixture'); }), /fixture/);
    await researchActivityStep('scope', 'embed', () => [1, 2, 3]);
    abort.abort();
  });
  late();
  assert.equal(events.find(event => event.layer === 'nodus' && event.status !== 'active').status, 'failed');
  assert.equal(events.find(event => event.layer === 'scope' && event.status !== 'active').count, undefined);
  assert.equal(events.at(-1).status, 'cancelled');
  assert.equal(events.length, 6, 'late completion cannot reopen a cancelled operation');
  let lateTask;
  await withResearchActivity(event => events.push(event), undefined, async () => {
    lateTask = new Promise(resolve => setTimeout(() => {
      assert.equal(researchActivityEnabled(), false);
      startResearchActivity('graph', 'read')(); resolve();
    }, 10));
  });
  await lateTask; assert.equal(events.length, 6, 'detached work cannot append to a settled request');
  assert.equal(await withResearchActivity(() => { throw new Error('observer'); }, undefined,
    () => researchActivityStep('response', 'write', () => 'answer')), 'answer');
  let state = [];
  for (const event of [first[0], second[0], second[1], first[1]]) state = updateResearchActivities(state, event);
  assert.deepEqual(state.map(event => event.id), [first[0].id, second[0].id], 'completion preserves start order');
  const active = { ...first[0], id: 'still-active' };
  state = [active];
  for (let i = 0; i < 150; i++) state = updateResearchActivities(state, { ...first[1], id: String(i) });
  assert.equal(state.length, 120); assert.equal(state[0], active, 'history cap never discards active operations');
  assert.equal(settleResearchActivities(state, 'completed')[0].status, 'failed', 'missing terminal events cannot invent success');
  assert.equal(settleResearchActivities(state, 'cancelled')[0].status, 'cancelled');
  assert.equal(state[0].status, 'active', 'state updates are immutable');
  await build({ entryPoints: ['src/i18n.researchActivity.ts'], outfile: path.join(root, 'translations.cjs'), bundle: true, platform: 'node', format: 'cjs' });
  const translations = require(path.join(root, 'translations.cjs')).RESEARCH_ACTIVITY_TRANSLATIONS;
  const keys = Object.keys(translations.en).sort();
  for (const [language, dictionary] of Object.entries(translations)) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys, `${language}: complete activity translations`);
    assert.ok(Object.values(dictionary).every(value => typeof value === 'string' && value.trim()));
    assert.ok(fs.readFileSync(`src/i18n.${language}.ts`, 'utf8').includes('...RESEARCH_ACTIVITY_TRANSLATIONS'), `${language}: translations are registered`);
  }
  console.log('Research activity: concurrent request isolation, real outcomes, cancellation, late events, no-context silence and ordered UI state passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
