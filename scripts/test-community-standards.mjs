import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

const issueForms = [
  ['bug_report.yml', 'Bug report', 'bug'],
  ['feature_request.yml', 'Feature request', 'enhancement'],
  ['vault_type_request.yml', 'New vault type', 'enhancement'],
];

test('GitHub Community Standards files are present and actionable', async () => {
  const [conduct, contributing, security, pullRequest] = await Promise.all([
    read('CODE_OF_CONDUCT.md'),
    read('CONTRIBUTING.md'),
    read('SECURITY.md'),
    read('.github/pull_request_template.md'),
  ]);

  assert.match(conduct, /Contributor Covenant Code of Conduct/);
  assert.match(conduct, /version 2\.1/);
  assert.match(conduct, /confidential reporting form/);
  assert.match(contributing, /Suggest \/ Report/);
  assert.match(contributing, /npm run lint/);
  assert.match(contributing, /npm run test:e2e/);
  assert.match(security, /private vulnerability reporting form/);
  assert.match(security, /Do not report security vulnerabilities through a public GitHub issue/);
  assert.match(security, /shared feedback thread/);
  assert.match(pullRequest, /## Privacy and data review/);
  assert.match(pullRequest, /## Contributor checklist/);
});

test('issue forms and contact links mirror every Suggest / Report path', async () => {
  for (const [filename, name, label] of issueForms) {
    const source = await read(`.github/ISSUE_TEMPLATE/${filename}`);
    assert.match(source, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(source, /^description: .+$/m);
    assert.match(source, new RegExp(`^  - ${label}$`, 'm'));
    assert.match(source, /^body:$/m);
  }

  const [config, feedbackModal] = await Promise.all([
    read('.github/ISSUE_TEMPLATE/config.yml'),
    read('src/views/FeedbackModal.tsx'),
  ]);

  assert.match(config, /^blank_issues_enabled: true$/m);
  assert.match(config, /security\/advisories\/new/);
  assert.match(config, /^ {2}- name: Product feedback$/m);
  assert.match(config, /issues\/272#new_comment_field/);
  await assert.rejects(read('.github/ISSUE_TEMPLATE/product_feedback.yml'), { code: 'ENOENT' });

  for (const label of ["'bug'", "'enhancement'"]) {
    assert.ok(feedbackModal.includes(label), `${label} is used by Suggest / Report`);
  }
  assert.match(feedbackModal, /const PRODUCT_FEEDBACK_THREAD = 272/);
  assert.match(feedbackModal, /navigator\.clipboard\.writeText\(body\)/);
  assert.match(feedbackModal, /issues\/\$\{PRODUCT_FEEDBACK_THREAD\}/);
  assert.match(feedbackModal, /#new_comment_field/);
  assert.doesNotMatch(feedbackModal, /kind === 'feedback' \? 'feedback'/);
});
