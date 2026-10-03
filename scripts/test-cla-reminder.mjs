import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  REMINDER_MARKER, acceptedBody, reminderBody, syncClaReminders, syncReminderComment,
} from './cla-reminder.mjs';
import { agreement, compatibleAgreements, signaturePath } from './cla.mjs';

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

test('reminder scans recognize original signatures and keep future changes and unsigned coauthors pending', async () => {
  const document = await readFile(new URL('../CLA.md', import.meta.url), 'utf8');
  const current = agreement(document);
  const [, previous] = compatibleAgreements(current);
  const author = { __typename: 'User', id: 'alice-id', login: 'alice-renamed' };
  const coauthor = { __typename: 'User', id: 'bob-id', login: 'bob' };
  const originalRecord = {
    user: { id: author.id, login: 'alice' },
    statement: previous.statement,
    document: { version: previous.version, sha256: previous.digest, text: previous.text },
    comment: { id: 'original-comment', url: 'https://github.com/example/nodus/pull/1#issuecomment-1', createdAt: '2026-09-05T12:00:00Z' },
  };
  const existing = [{ id: 100, user: { type: 'Bot', login: 'github-actions[bot]' }, body: `${REMINDER_MARKER}\nPlease sign` }];
  for (const mode of ['compatible', 'coauthor', 'future-edit', 'corrupt', 'api-error']) {
    const h = harness(existing);
    const warnings = [];
    const record = structuredClone(originalRecord);
    if (mode === 'corrupt') record.statement = current.statement;
    const pr = { number: 42, head: { sha: 'head' }, state: 'open' };
    h.github.rest.pulls = { list() {}, get: async () => ({ data: pr }) };
    h.github.paginate = async method => method === h.github.rest.pulls.list ? [pr] : existing;
    h.github.graphql = async () => ({ repository: { pullRequest: {
      headRefOid: 'head', author,
      commits: {
        totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{ commit: { oid: 'head', authors: {
          totalCount: mode === 'coauthor' ? 2 : 1,
          nodes: (mode === 'coauthor' ? [author, coauthor] : [author]).map(user => ({ user })),
        } } }],
      },
    } } });
    h.github.rest.repos = { getContent: async args => {
      if (args.path === signaturePath(previous, author.id)) {
        if (mode === 'api-error') throw Object.assign(new Error('Unavailable'), { status: 503 });
        return { data: { content: Buffer.from(JSON.stringify(record)).toString('base64') } };
      }
      throw Object.assign(new Error('Not found'), { status: 404 });
    } };
    await syncClaReminders({ github: h.github, repo, context: { repo },
      core: { warning: message => warnings.push(message) },
      document: mode === 'future-edit' ? `${document}\nChanged terms.\n` : document,
    });
    if (mode === 'corrupt' || mode === 'api-error') {
      assert.equal(h.actions.length, 0, 'errors must never resolve a reminder');
      assert.equal(warnings.length, 1);
    } else {
      assert.deepEqual(warnings, []);
      assert.equal(h.actions.length, 1);
      assert.equal(h.actions[0].type, 'update');
      if (mode === 'compatible') assert.equal(h.actions[0].body, acceptedBody());
      if (mode === 'coauthor') {
        assert.match(h.actions[0].body, /@bob/);
        assert.doesNotMatch(h.actions[0].body, /@alice-renamed/);
      }
      if (mode === 'future-edit') assert.match(h.actions[0].body, /@alice-renamed/);
    }
  }
});

test('CLA workflow grants the permissions required for managed PR comments', async () => {
  const workflow = await readFile(new URL('../.github/workflows/cla.yml', import.meta.url), 'utf8');
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /scripts\/cla-reminder\.mjs/);
});
