// SPDX-License-Identifier: AGPL-3.0-only
// Run only from the trusted default branch via .github/workflows/cla.yml.
import { readFile } from 'node:fs/promises';
import {
  SIGNATURE_BRANCH, agreement, connection, contributors, signaturePath, validateRecord,
} from './cla.mjs';

export const REMINDER_MARKER = '<!-- nodus-cla-reminder -->';

function githubActionsBot(comment) {
  return comment.user?.type === 'Bot'
    && /^github-actions(?:\[bot\])?$/.test(comment.user.login ?? '');
}

export function reminderBody(cla, missing, repo, defaultBranch = 'main') {
  const mentions = missing.map(user => `@${user.login}`).join(', ');
  const claUrl = `https://github.com/${repo.owner}/${repo.repo}/blob/${encodeURIComponent(defaultBranch)}/CLA.md`;
  return `${REMINDER_MARKER}\nHi ${mentions} — thanks for contributing to Nodus!\n\n`
    + `Before this PR can be merged, all human contributors need to accept the [Nodus Research Contributor License Agreement](${claUrl}). Please read it first, and if you agree, post the following **exact statement as a new comment on this PR**:\n\n`
    + `\`\`\`text\n${cla.statement}\n\`\`\`\n\n`
    + 'The CLA check will detect your acceptance automatically. You only need to accept this exact CLA version once; the acceptance is reused for later covered contributions while the agreement remains unchanged.';
}

export function acceptedBody() {
  return `${REMINDER_MARKER}\n✅ The required CLA acceptance for the currently identified contributors has been recorded. Thank you!`;
}

export async function syncReminderComment({ github, repo, prNumber, cla, missing, defaultBranch = 'main' }) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...repo, issue_number: prNumber, per_page: 100,
  });
  const existing = comments.find(comment => githubActionsBot(comment)
    && comment.body?.includes(REMINDER_MARKER));

  if (!missing.length && !existing) return 'none';
  const body = missing.length
    ? reminderBody(cla, missing, repo, defaultBranch)
    : acceptedBody();

  if (!existing) {
    await github.rest.issues.createComment({ ...repo, issue_number: prNumber, body });
    return 'created';
  }
  if (existing.body === body) return 'unchanged';
  await github.rest.issues.updateComment({ ...repo, comment_id: existing.id, body });
  return 'updated';
}

export async function syncClaReminders({ github, context, core, document }) {
  const repo = context.repo;
  const cla = agreement(document ?? await readFile(new URL('../CLA.md', import.meta.url), 'utf8'));
  const defaultBranch = context.payload?.repository?.default_branch ?? 'main';
  const records = new Map();
  const prs = await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', per_page: 100 });

  const getRecord = async (userId) => {
    if (records.has(userId)) return records.get(userId);
    try {
      const { data } = await github.rest.repos.getContent({
        ...repo, path: signaturePath(cla, userId), ref: SIGNATURE_BRANCH,
      });
      const record = validateRecord(
        JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')),
        cla,
        userId,
      );
      records.set(userId, record);
      return record;
    } catch (error) {
      if (error.status !== 404) throw error;
      records.set(userId, null);
      return null;
    }
  };

  for (const pr of prs) {
    try {
      const { pr: details, nodes } = await connection(github, repo, pr.number, 'commits');
      if (details.headRefOid !== pr.head.sha) throw new Error('PR head changed while preparing the CLA reminder.');
      const result = contributors(details, nodes.map(node => node.commit));
      const missing = [];
      for (const user of result.users) if (!await getRecord(user.id)) missing.push(user);

      const { data: latest } = await github.rest.pulls.get({ ...repo, pull_number: pr.number });
      if (latest.state !== 'open' || latest.head.sha !== pr.head.sha) continue;
      await syncReminderComment({ github, repo, prNumber: pr.number, cla, missing, defaultBranch });
    } catch (error) {
      core.warning(`CLA reminder for PR #${pr.number} could not be updated: ${error.message}`);
    }
  }
}
