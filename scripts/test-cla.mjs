import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  STATUS, SIGNATURE_BRANCH, acceptance, agreement, connection, contributors,
  isAiAttribution, run, signaturePath,
} from './cla.mjs';

const document = await readFile(new URL('../CLA.md', import.meta.url), 'utf8');
const cla = agreement(document);
const alice = { __typename: 'User', id: 'user-1', login: 'alice' };
const bob = { __typename: 'User', id: 'user-2', login: 'bob' };
const bot = { __typename: 'Bot', id: 'bot-1', login: 'automation' };
const commit = (...users) => ({
  oid: 'a'.repeat(40), authors: { totalCount: users.length, nodes: users.map(user => ({ user })) },
});
const signingComment = (author = alice, overrides = {}) => ({
  id: `comment-${author.id}`, author, body: cla.statement, lastEditedAt: null,
  url: `https://github.com/example/nodus/pull/1#issuecomment-${author.id}`,
  createdAt: '2026-09-05T12:00:00Z', ...overrides,
});
const fixture = (number = 1, author = alice) => ({
  number, author, comments: [], commits: [commit(author)],
  head: { sha: String(number).repeat(40) },
  html_url: `https://github.com/example/nodus/pull/${number}`, state: 'open',
});

function harness(prs, options = {}) {
  const statuses = [];
  const writes = [];
  const files = options.files ?? new Map();
  const errors = [];
  let summary = '';
  const notFound = () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
  const github = {
    paginate: async () => prs,
    graphql: async (query, args) => {
      if (options.apiError) throw new Error('GitHub unavailable');
      const pr = prs.find(item => item.number === args.number);
      const field = query.includes('comments(first:') ? 'comments' : 'commits';
      const nodes = field === 'comments' ? pr.comments : pr.commits.map(c => ({ commit: c }));
      return { repository: { pullRequest: {
        headRefOid: pr.head.sha, author: pr.author,
        [field]: { nodes, totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null } },
      } } };
    },
    rest: {
      pulls: {
        list() {},
        get: async ({ pull_number }) => ({ data: {
          ...prs.find(pr => pr.number === pull_number),
          ...(options.changedHead ? { head: { sha: 'changed' } } : {}),
        } }),
      },
      git: { getRef: async () => ({ data: {} }) },
      repos: {
        createCommitStatus: async args => { statuses.push(args); },
        getContent: async args => {
          assert.equal(args.ref, SIGNATURE_BRANCH);
          const content = files.get(args.path);
          return content ? { data: { content } } : notFound();
        },
        createOrUpdateFileContents: async args => {
          assert.equal(args.branch, SIGNATURE_BRANCH);
          assert.equal(args.sha, undefined, 'records must be create-only');
          if (options.storageError) throw new Error('Cannot persist acceptance');
          assert.ok(!files.has(args.path), 'must never overwrite an existing record');
          files.set(args.path, args.content);
          writes.push(args);
        },
      },
    },
  };
  const core = {
    summary: { addRaw(text) { summary += text; return this; }, async write() {} },
    setFailed(message) { errors.push(message); },
  };
  return {
    statuses, writes, files, errors, github, core,
    summary: () => summary,
    execute: () => run({ github, core, document, context: { repo: { owner: 'example', repo: 'nodus' }, runId: 123 } }),
  };
}

test('only a new, exact acceptance from the actual human account is a signature', () => {
  assert.equal(acceptance(signingComment(), cla), true);
  assert.equal(acceptance(signingComment(alice, { body: `  ${cla.statement}\n` }), cla), true);
  for (const comment of [
    signingComment(bot),
    signingComment(alice, { lastEditedAt: '2026-09-05T13:00:00Z' }),
    signingComment(alice, { body: `> ${cla.statement}` }),
    signingComment(alice, { body: `- [x] ${cla.statement}` }),
    signingComment(alice, { body: `${cla.statement} on behalf of bob` }),
    signingComment(alice, { author: null }),
    signingComment(alice, { body: 'I agree' }),
  ]) assert.equal(acceptance(comment, cla), false);
});

test('an agreement change requires a new acceptance even if someone forgets to bump the version', () => {
  const changed = agreement(`${document}\nChanged terms.\n`);
  assert.notEqual(changed.digest, cla.digest);
  assert.notEqual(signaturePath(changed, alice.id), signaturePath(cla, alice.id));
  assert.equal(acceptance(signingComment(), changed), false);
});

test('PR authors, commit authors, and human coauthors all need acceptance', () => {
  const result = contributors({ author: alice }, [commit(alice, bob), commit(bob)]);
  assert.deepEqual(result.users, [alice, bob]);
  assert.deepEqual(result.problems, []);
  assert.equal(contributors({ author: bot }, [commit(alice)]).problems.length, 1);
  assert.equal(contributors({ author: alice }, [commit(null)]).problems.length, 1);
  assert.equal(contributors({ author: alice }, []).problems.length, 1);
  const truncated = commit(alice);
  truncated.authors.totalCount = 101;
  assert.equal(contributors({ author: alice }, [truncated]).problems.length, 1);
});

test('recognized AI attributions are allowed but never exempt the human submitter', () => {
  const ai = { name: 'Claude Sonnet 5', email: 'noreply@anthropic.com', user: bob };
  assert.equal(isAiAttribution(ai), true);
  assert.equal(isAiAttribution({ name: 'Codex', email: 'codex@openai.com' }), true);
  assert.equal(isAiAttribution({ ...ai, email: 'another@example.org' }), false);
  assert.equal(isAiAttribution({ ...ai, name: 'A human' }), false);
  const result = contributors({ author: alice }, [{
    ...commit(alice), authors: { totalCount: 2, nodes: [{ user: alice }, ai] },
  }]);
  assert.deepEqual(result.users, [alice]);
  assert.deepEqual(result.problems, []);
  assert.equal(contributors({ author: bot }, [{
    ...commit(alice), authors: { totalCount: 1, nodes: [ai] },
  }]).problems.length, 1);
});

test('unsigned PRs fail with signing instructions and the exact agreement', async () => {
  const h = harness([fixture()]);
  await h.execute();
  assert.deepEqual(h.statuses.map(s => s.state), ['pending', 'failure']);
  assert.ok(h.statuses.every(s => s.context === STATUS && s.sha === '1'.repeat(40)));
  assert.match(h.statuses.at(-1).description, /@alice/);
  assert.ok(h.summary().includes(cla.statement));
  assert.ok(h.summary().includes(document));
});

test('a persisted signature unblocks every open PR and survives deleted comments and account renames', async () => {
  const first = fixture();
  first.comments = [signingComment()];
  const second = fixture(2);
  const h = harness([first, second]);
  await h.execute();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.statuses.slice(-2).map(s => s.state), ['success', 'success']);
  const record = JSON.parse(Buffer.from(h.writes[0].content, 'base64').toString());
  assert.equal(record.document.text, document);
  assert.equal(record.comment.id, signingComment().id);
  assert.equal(record.user.id, alice.id);
  const renamed = fixture(3, { ...alice, login: 'alice-renamed' });
  const next = harness([renamed], { files: h.files });
  await next.execute();
  assert.equal(next.writes.length, 0);
  assert.equal(next.statuses.at(-1).state, 'success');
});

test('one signed author cannot cover an unsigned human coauthor', async () => {
  const pr = fixture();
  pr.comments = [signingComment()];
  pr.commits = [commit(alice, bob)];
  const h = harness([pr]);
  await h.execute();
  assert.equal(h.statuses.at(-1).state, 'failure');
  assert.match(h.statuses.at(-1).description, /@bob/);
});

test('a signed responsible human can merge an AI-assisted contribution', async () => {
  const pr = fixture();
  pr.comments = [signingComment()];
  pr.commits[0].authors.nodes.push({ name: 'Claude Sonnet 5', email: 'noreply@anthropic.com', user: bob });
  pr.commits[0].authors.totalCount = 2;
  const h = harness([pr]);
  await h.execute();
  assert.equal(h.statuses.at(-1).state, 'success');
  assert.equal(h.writes.length, 1);
});

test('PRs sharing a SHA cannot overwrite a missing signature with success', async () => {
  const unsigned = fixture(1, bob);
  const signed = fixture(2);
  signed.comments = [signingComment()];
  signed.head.sha = unsigned.head.sha;
  const h = harness([unsigned, signed]);
  await h.execute();
  assert.equal(h.statuses.at(-1).state, 'failure');
  assert.match(h.statuses.at(-1).description, /@bob/);
});

test('API failures, persistence failures, corrupt records, and changed heads fail closed', async () => {
  for (const options of [{ apiError: true }, { storageError: true }, { changedHead: true }, {
    files: new Map([[signaturePath(cla, alice.id), Buffer.from('{}').toString('base64')]]),
  }]) {
    const pr = fixture();
    pr.comments = [signingComment()];
    const h = harness([pr], options);
    await h.execute();
    assert.equal(h.statuses[0].state, 'pending');
    assert.equal(h.statuses.at(-1).state, 'failure');
    assert.ok(h.errors.length);
  }
});

test('pagination includes late coauthors/comments and rejects incomplete or changing data', async () => {
  const calls = [];
  const github = { graphql: async (_query, { cursor }) => {
    calls.push(cursor);
    return { repository: { pullRequest: {
      headRefOid: 'head', author: alice,
      comments: { totalCount: 2, nodes: [cursor ? signingComment(bob) : signingComment()],
        pageInfo: { hasNextPage: !cursor, endCursor: cursor ? null : 'page-2' } },
    } } };
  } };
  const result = await connection(github, {}, 1, 'comments');
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(calls, [null, 'page-2']);
  for (const mode of ['head-change', 'truncated', 'stuck']) {
    const broken = { graphql: async (...args) => {
      const result = await github.graphql(...args);
      const pr = result.repository.pullRequest;
      if (mode === 'head-change' && args[1].cursor) pr.headRefOid = 'changed';
      if (mode === 'truncated') pr.comments.totalCount = 10;
      if (mode === 'stuck') pr.comments.pageInfo = { hasNextPage: true, endCursor: null };
      return result;
    } };
    await assert.rejects(connection(broken, {}, 1, 'comments'));
  }
});

test('signature storage initializes as an independent branch without repository source', async () => {
  const h = harness([fixture()]);
  const writes = [];
  h.github.rest.git = {
    getRef: async () => { throw Object.assign(new Error('missing'), { status: 404 }); },
    createTree: async args => { writes.push(args); return { data: { sha: 'tree' } }; },
    createCommit: async args => { writes.push(args); return { data: { sha: 'commit' } }; },
    createRef: async args => { writes.push(args); },
  };
  await h.execute();
  assert.equal(writes[0].tree.length, 1);
  assert.equal(writes[0].tree[0].path, 'README.md');
  assert.deepEqual(writes[1].parents, []);
  assert.equal(writes[2].ref, `refs/heads/${SIGNATURE_BRANCH}`);
});

test('workflow runs trusted code without installing PR dependencies or using PR text as code', async () => {
  const workflow = await readFile(new URL('../.github/workflows/cla.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /head\.sha|head\.ref|npm (?:ci|install)|pull_request\.body/);
});

test('website refreshes its deployed cache without bypassing main protection', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /git push|git commit|contents: write/);
  const refresh = workflow.slice(workflow.indexOf('- name: Refresh shared release download totals'), workflow.indexOf('- name: Configure GitHub Pages'));
  assert.match(refresh, /run: node scripts\/github-release-downloads.mjs/);
  assert.doesNotMatch(refresh, /\bif:/, 'push deployments must not restore an older cache');
});
