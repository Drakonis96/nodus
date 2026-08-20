import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const scriptPath = fileURLToPath(import.meta.url);
if (!requireElectronRuntime(scriptPath, '--electron-page-comments-test')) process.exit(0);
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-page-comments-'));
installRuntimeHooks(root); const require = createRequire(import.meta.url);

try {
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const pages = require(path.join(repoRoot, 'electron/db/pagesRepo.ts'));
  const comments = require(path.join(repoRoot, 'electron/db/pageCommentsRepo.ts'));
  const db = getDb(); assert.ok(SCHEMA_VERSION >= 147);
  const page = pages.createPage({ title: 'Debate QA', blocks: [{ id: 'comment-block', type: 'paragraph', content: { text: 'Texto comentable' } }] });
  const ada = comments.createWorkspaceActor({ displayName: 'Ada', email: 'ada@example.test' });
  const linus = comments.createWorkspaceActor({ displayName: 'Linus', kind: 'guest' });
  assert.equal(comments.listWorkspaceActors().length, 3);

  const rootComment = comments.createPageComment({ pageId: page.page.id, blockId: 'comment-block', actorId: ada.id,
    body: `Revisa esto @[actor:${linus.id}]` });
  assert.deepEqual(rootComment.mentionedActorIds, [linus.id]);
  assert.equal(comments.listWorkspaceNotifications(linus.id, true).length, 1);
  const reply = comments.createPageComment({ pageId: page.page.id, parentCommentId: rootComment.id, actorId: linus.id,
    body: `De acuerdo @[actor:${ada.id}]` });
  assert.equal(reply.parentCommentId, rootComment.id);
  assert.equal(comments.listWorkspaceNotifications(ada.id, true).length, 2, 'reply and explicit mention are distinct inbox events');
  assert.throws(() => comments.createPageComment({ pageId: page.page.id, blockId: 'foreign', body: 'No' }), /bloque/i);

  let reacted = comments.setPageCommentReaction(rootComment.id, '👍', true, linus.id);
  reacted = comments.setPageCommentReaction(rootComment.id, '👍', true, ada.id);
  assert.equal(reacted.reactions[0].count, 2);
  reacted = comments.setPageCommentReaction(rootComment.id, '👍', false, ada.id);
  assert.deepEqual(reacted.reactions[0].actorIds, [linus.id]);
  const edited = comments.updatePageComment(rootComment.id, `Actualizado @[actor:${linus.id}]`, rootComment.revision, ada.id);
  assert.equal(edited.revision, 2);
  assert.throws(() => comments.updatePageComment(rootComment.id, 'Obsoleto', rootComment.revision, ada.id), /cambió/i);
  const resolved = comments.resolvePageComment(rootComment.id, true, edited.revision, 'local');
  assert.ok(resolved.resolvedAt);
  assert.ok(comments.listWorkspaceNotifications(ada.id, true).some((item) => item.kind === 'comment_resolved'));
  assert.equal(comments.listPageComments(page.page.id).length, 0, 'resolving a root hides its complete thread');
  assert.equal(comments.listPageComments(page.page.id, true).length, 2);
  const notice = comments.listWorkspaceNotifications(linus.id, true)[0];
  comments.markWorkspaceNotificationRead(notice.id, true, linus.id);
  assert.equal(comments.listWorkspaceNotifications(linus.id, true).length, 0);
  assert.equal(comments.listWorkspaceNotifications(linus.id, false)[0].read, true);
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  closeDb(); console.log('Page comments and inbox test passed!');
} finally { await rm(root, { recursive: true, force: true }); }
