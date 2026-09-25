import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-notebooks')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-notebooks-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const db = load('electron/db/database.ts').getDb();
  const repo = load('electron/db/researchNotebooksRepo.ts');
  const scopeApi = load('electron/ai/researchCorpusScope.ts');
  const contracts = load('shared/researchCorpus.ts');
  const docs = ['a', 'b', 'c'].map(id => ({ id, workId: `work-${id}`, libraryItemId: `item-${id}`, title: id, authors: [], year: null,
    revision: 'r1', permissionRevision: 'p1', attachmentId: null, origin: { kind: 'nodus', id }, coverage: 'fulltext' }));
  const reference = id => ({ kind: 'zotero-collection', libraryType: 'user', libraryId: '1', id });
  const collections = [
    { reference: reference('one'), name: 'One', parentId: null, documentIds: ['a'] },
    { reference: reference('two'), name: 'Two', parentId: 'one', documentIds: ['b'] },
    { reference: { ...reference('one'), libraryType: 'group' }, name: 'Other library', parentId: null, documentIds: ['c'] },
  ];
  const select = (sources, exclusions = []) => scopeApi.selectResearchDocuments(sources, exclusions, docs, collections);
  assert.deepEqual(select([]), []);
  assert.deepEqual(select([reference('one')]), ['a']);
  assert.deepEqual(select([{ ...reference('one'), includeDescendants: true }], ['a']), ['b']);
  assert.deepEqual(select([reference('one'), { kind: 'work', id: 'work-c' }]), ['a', 'c']);
  assert.deepEqual(select([{ ...reference('one'), libraryType: 'group' }]), ['c']);
  const notebook = repo.saveResearchNotebook({ name: 'Fixed', sources: [reference('one')], exclusions: [], mode: 'fixed' }, ['a']);
  const fixed = scopeApi.resolveNotebookScope('vault', notebook, docs, collections);
  assert.equal(fixed.documents.length, 1);
  collections[0].documentIds.push('b');
  assert.equal(scopeApi.resolveNotebookScope('vault', notebook, docs, collections).id, fixed.id);
  const linked = repo.saveResearchNotebook({ ...notebook, mode: 'linked' }, ['a']);
  assert.deepEqual(scopeApi.resolveNotebookScope('vault', linked, docs, collections).changes.added, ['b']);
  assert.throws(() => scopeApi.assertResearchDocument(fixed, 'b', docs[1]), /not_authorized/);
  assert.throws(() => scopeApi.assertResearchDocument(fixed, 'a', { ...docs[0], permissionRevision: 'p2' }), /not_authorized/);
  assert.throws(() => scopeApi.assertResearchDocument(fixed, 'a', { ...docs[0], revision: 'r2' }), /revision_changed/);
  assert.equal(scopeApi.assertResearchDocumentPermission(fixed, 'a', { ...docs[0], revision: 'r2' }).revision, docs[0].revision);
  assert.throws(() => scopeApi.assertResearchDocumentPermission(fixed, 'a', { ...docs[0], permissionRevision: 'p2' }), /not_authorized/);
  const attached = { ...docs[0], attachments: [{ id: 'file-a', revision: 'r1' }] };
  const attachedScope = { ...fixed, documents: [attached] };
  assert.throws(() => scopeApi.assertResearchDocumentPermission(attachedScope, 'a', { ...attached, attachments: [] }), /not_authorized/);
  assert.equal(scopeApi.assertResearchDocumentPermission(attachedScope, 'a', { ...attached, attachments: [{ id: 'file-a', revision: 'r2' }] }).attachments[0].revision, 'r1');
  assert.notEqual(scopeApi.resolveNotebookScope('vault', notebook, [{ ...docs[0], revision: 'r2' }], collections).id, fixed.id);
  const identity = { documentId: 'a', revision: 'r1', attachmentId: 'pdf1', textFingerprint: 'text', chunkerVersion: '280-60/1', processingVersion: '1',
    embedding: { model: 'model', provider: 'provider', dimensions: 1024, metric: 'cosine', parameters: {} } };
  assert.notEqual(scopeApi.documentaryIndexKey(identity), scopeApi.documentaryIndexKey({ ...identity, embedding: { ...identity.embedding, dimensions: 512 } }));
  assert.throws(() => contracts.validateRetrievalSettings({ ...contracts.RETRIEVAL_PRESETS.balanced, candidates: 0 }));
  assert.throws(() => contracts.validateRetrievalSettings({ ...contracts.RETRIEVAL_PRESETS.balanced, threshold: { mode: 'manual', value: .2 } }));
  // How a notebook looks is not what it reads: restyling keeps its revision.
  assert.equal(notebook.icon, 'notebook', 'a notebook starts with the notebook icon');
  const styled = repo.updateResearchNotebookAppearance(notebook.id, { name: 'Renamed', icon: 'flask', color: '#EF4444' });
  assert.deepEqual([styled.name, styled.icon, styled.color, styled.revision], ['Renamed', 'flask', '#ef4444', notebook.revision]);
  assert.throws(() => repo.updateResearchNotebookAppearance(notebook.id, { color: 'red' }), /invalid_color/);
  assert.throws(() => repo.updateResearchNotebookAppearance(notebook.id, { icon: '<svg>' }), /invalid_icon/);
  assert.equal(repo.saveResearchNotebook({ ...styled, sources: [reference('two')] }, ['b']).icon, 'flask', 'saving the selection keeps the look');
  const conversation = load('electron/db/chatRepo.ts').createConversation({ title: 'Preserve me' });
  repo.associateNotebookConversation(notebook.id, conversation.id);
  repo.recordResearchScope(fixed);
  repo.deleteResearchNotebook(notebook.id);
  assert.equal(repo.notebookForConversation(conversation.id), null);
  assert.ok(load('electron/db/chatRepo.ts').getConversation(conversation.id));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM research_run_scopes').get().n, 1);
  console.log('Notebook persistence, union/exclusion, fixed/linked collections, namespace isolation, pinned revisions, permissions, vector identity and non-destructive deletion passed.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
