import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const scriptPath = fileURLToPath(import.meta.url);
if (!requireElectronRuntime(scriptPath, '--electron-page-acl-test')) process.exit(0);
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-page-acl-'));
installRuntimeHooks(root); const require = createRequire(import.meta.url);

try {
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const pages = require(path.join(repoRoot, 'electron/db/pagesRepo.ts'));
  const comments = require(path.join(repoRoot, 'electron/db/pageCommentsRepo.ts'));
  const databases = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const acl = require(path.join(repoRoot, 'electron/db/aclRepo.ts'));
  const db = getDb(); assert.ok(SCHEMA_VERSION >= 148);

  const rootPage = pages.createPage({ title: 'Proyecto reservado' });
  const childPage = pages.createPage({ title: 'Anexo', parentPageId: rootPage.page.id });
  const unrelated = pages.createPage({ title: 'Secreto no compartido' });
  const ada = comments.createWorkspaceActor({ displayName: 'Ada' });
  const grace = comments.createWorkspaceActor({ displayName: 'Grace', kind: 'guest' });
  const outsider = comments.createWorkspaceActor({ displayName: 'Sin acceso', kind: 'guest' });
  let editors = acl.createWorkspaceGroup('Equipo editorial');
  editors = acl.setWorkspaceGroupMembers(editors.id, [ada.id, grace.id], editors.revision);

  acl.setAclEntry({ resourceType: 'page', resourceId: rootPage.page.id, principalType: 'group', principalId: editors.id, role: 'edit_content' });
  const inherited = acl.getEffectiveAcl('page', childPage.page.id, ada.id);
  assert.equal(inherited.role, 'edit_content'); assert.equal(inherited.inherited, true); assert.equal(inherited.sourceResourceId, rootPage.page.id);
  const direct = acl.setAclEntry({ resourceType: 'page', resourceId: childPage.page.id, principalType: 'actor', principalId: ada.id, role: 'view' });
  assert.equal(acl.getEffectiveAcl('page', childPage.page.id, ada.id).role, 'view', 'a child override can narrow inherited access');
  assert.throws(() => acl.assertAcl('page', childPage.page.id, ada.id, 'comment'), /permiso/i);
  assert.equal(acl.getEffectiveAcl('page', unrelated.page.id, outsider.id).role, null);
  assert.throws(() => acl.setAclEntry({ resourceType: 'page', resourceId: rootPage.page.id, principalType: 'actor', principalId: 'missing', role: 'view' }), /does not exist|no existe/i);

  const database = databases.createDatabase('ACL relacional');
  const row = databases.createRow(database.id);
  const view = databases.createView(database.id, { name: 'Tabla segura', layout: 'table', filter: { conjunction: 'and', conditions: [] }, sorts: [] });
  acl.setAclEntry({ resourceType: 'database', resourceId: database.id, principalType: 'actor', principalId: grace.id, role: 'comment' });
  assert.equal(acl.getEffectiveAcl('row', row.id, grace.id).role, 'comment');
  assert.equal(acl.getEffectiveAcl('view', view.id, grace.id).role, 'comment');

  const link = acl.createWorkspaceShareLink({ resourceType: 'page', resourceId: rootPage.page.id, role: 'comment', password: 'correct-horse', allowIndexing: false });
  assert.ok(link.token); assert.equal(acl.authorizeWorkspaceShareLink(link.token, 'incorrecta'), null);
  assert.deepEqual(acl.authorizeWorkspaceShareLink(link.token, 'correct-horse'), {
    resourceType: 'page', resourceId: rootPage.page.id, role: 'comment', allowIndexing: false,
  });
  assert.equal(acl.listWorkspaceShareLinks('page', rootPage.page.id)[0].token, null, 'tokens are never returned by listings');
  acl.revokeWorkspaceShareLink(link.id, link.revision);
  assert.equal(acl.authorizeWorkspaceShareLink(link.token, 'correct-horse'), null);
  const expired = acl.createWorkspaceShareLink({ resourceType: 'page', resourceId: rootPage.page.id, role: 'view', expiresAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(acl.authorizeWorkspaceShareLink(expired.token), null);

  const vaultOwner = acl.listAclEntries('vault', 'vault').find((entry) => entry.role === 'owner');
  assert.throws(() => acl.deleteAclEntry(vaultOwner.id, vaultOwner.revision), /al menos una/i);
  acl.deleteAclEntry(direct.id, direct.revision);
  assert.equal(acl.getEffectiveAcl('page', childPage.page.id, ada.id).role, 'edit_content');
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  closeDb(); console.log('Page ACL, groups and share links test passed!');
} finally { await rm(root, { recursive: true, force: true }); }
