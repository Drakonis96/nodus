import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  REMINDER_MARKER, acceptedBody, reminderBody, syncReminderComment,
} from './cla-reminder.mjs';

const cla = {
  version: '1',
  digest: 'abc123',
  statement: 'I have read and agree to the Nodus Research CLA v1 (SHA-256: abc123).',
};
const repo = { owner: 'example', repo: 'nodus' };
const alice = { login: 'alice' };
const bob = { login: 'bob' };

function harness(existing = []) {
  const actions = [];
  const github = {
    paginate: async () => existing,
    rest: {
      issues: {
        listComments() {},
        createComment: async args => { actions.push({ type: 'create', ...args }); },
        updateComment: async args => { actions.push({ type: 'update', ...args }); },
      },
    },
  };
  return { github, actions };
}

test('reminder names missing contributors, links the CLA, and gives the exact current statement', () => {
  const body = reminderBody(cla, [alice, bob], repo, 'main');
  assert.match(body, /@alice, @bob/);
  assert.match(body, /https:\/\/github\.com\/example\/nodus\/blob\/main\/CLA\.md/);
  assert.ok(body.includes(cla.statement));
  assert.ok(body.startsWith(REMINDER_MARKER));
  assert.match(body, /only need to accept this exact CLA version once/);
});

test('an unsigned PR gets one managed reminder comment', async () => {
  const h = harness();
  const result = await syncReminderComment({
    github: h.github, repo, prNumber: 42, cla, missing: [alice], defaultBranch: 'main',
  });
  assert.equal(result, 'created');
  assert.equal(h.actions.length, 1);
  assert.equal(h.actions[0].type, 'create');
  assert.equal(h.actions[0].issue_number, 42);
  assert.match(h.actions[0].body, /@alice/);
});

test('the workflow updates its own reminder instead of posting duplicates', async () => {
  const existing = [{
    id: 99,
    user: { type: 'Bot', login: 'github-actions[bot]' },
    body: `${REMINDER_MARKER}\nOld reminder`,
  }];
  const h = harness(existing);
  const result = await syncReminderComment({
    github: h.github, repo, prNumber: 42, cla, missing: [bob], defaultBranch: 'main',
  });
  assert.equal(result, 'updated');
  assert.deepEqual(h.actions.map(action => action.type), ['update']);
  assert.equal(h.actions[0].comment_id, 99);
  assert.match(h.actions[0].body, /@bob/);
  assert.doesNotMatch(h.actions[0].body, /@alice/);
});

test('a resolved reminder is updated to a short acceptance confirmation', async () => {
  const existing = [{
    id: 100,
    user: { type: 'Bot', login: 'github-actions[bot]' },
    body: `${REMINDER_MARKER}\nPlease sign`,
  }];
  const h = harness(existing);
  const result = await syncReminderComment({ github: h.github, repo, prNumber: 42, cla, missing: [] });
  assert.equal(result, 'updated');
  assert.equal(h.actions[0].body, acceptedBody());

  const clean = harness();
  assert.equal(await syncReminderComment({ github: clean.github, repo, prNumber: 42, cla, missing: [] }), 'none');
  assert.equal(clean.actions.length, 0, 'do not create success-only comments on already compliant PRs');
});

test('CLA workflow grants only the extra issue permission needed for managed comments', async () => {
  const workflow = await readFile(new URL('../.github/workflows/cla.yml', import.meta.url), 'utf8');
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /scripts\/cla-reminder\.mjs/);
});
