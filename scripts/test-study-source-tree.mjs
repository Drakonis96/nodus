import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
const built = buildSync({ entryPoints: ['shared/studySourceTree.ts'], bundle: true, write: false, format: 'cjs' });
const module = { exports: {} }; new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports);
const { buildStudySourceTree, toggleStudySourceKeys, studyOrganizationPaths } = module.exports;
const scope = { courseId: null, subjectId: null, folderId: null, topicId: null };
const workspace = { courses: [{ id: 'c', name: 'Ciencias' }], subjects: [{ id: 's', courseId: 'c', name: 'Química' }, { id: 'b', courseId: 'c', name: 'Biología' }],
  folders: [{ id: 'f', name: 'Orgánica', courseId: 'c', subjectId: 's', parentId: null }, { id: 'nested', name: 'Exámenes', courseId: 'c', subjectId: 's', parentId: 'f' }, { id: 'global', name: 'General', courseId: null, subjectId: null, parentId: null }], topics: [] };
const source = (id, placements = [], extra = {}) => ({ sourceKey: `material:${id}`, sourceId: id, kind: 'material', title: id, scope, placements, available: true, ...extra });
const sources = [source('m', [{ ...scope, folderId: 'nested' }, { ...scope, subjectId: 'b' }], { title: 'Manual', fileName: 'átomos.pdf', tags: ['Reacción'] }), source('loose'), source('empty', [{ ...scope, folderId: 'global' }], { available: false })];
const options = { query: '', kind: 'all', onlySelected: false, selected: new Set(), unplacedLabel: 'Sin ubicación' };
const find = (tree, id) => tree.id === id ? tree : tree.groups.map((g) => find(g, id)).find(Boolean);
test('all placements, nested and global folders, unfiled and unique group counts', () => {
  const tree = buildStudySourceTree(sources, workspace, options);
  assert.deepEqual(tree.sourceKeys.sort(), ['material:loose', 'material:m']);
  assert.equal(find(tree, 'folder:nested').sources[0].sourceKey, 'material:m');
  assert.equal(find(tree, 'subject:b').sources[0].sourceKey, 'material:m');
  assert.deepEqual(find(tree, 'course:c').sourceKeys, ['material:m']);
  assert.equal(find(tree, 'folder:global').sources[0].available, false);
  assert.deepEqual(find(tree, 'folder:global').sourceKeys, []);
  assert.equal(find(tree, 'unplaced').sources[0].sourceId, 'loose');
});
test('search is accent/case insensitive and includes ancestor paths, filenames and tags', () => {
  for (const query of ['QUIMICA', 'examenes', 'ATOMOS', 'reaccion', 'manual']) {
    const tree = buildStudySourceTree(sources, workspace, { ...options, query });
    assert.deepEqual(tree.sourceKeys, ['material:m'], query);
  }
  const tree = buildStudySourceTree(sources, workspace, { ...options, query: 'quimica' });
  assert.equal(find(tree, 'subject:b'), undefined, 'path matching does not show unrelated placements');
  assert.deepEqual(buildStudySourceTree(sources, workspace, { ...options, kind: 'document' }).sourceKeys, []);
});
test('group toggles affect only matching sources and preserve hidden selections', () => {
  const selected = ['material:loose'];
  const filtered = buildStudySourceTree(sources, workspace, { ...options, query: 'manual', selected: new Set(selected) });
  const next = toggleStudySourceKeys(selected, filtered.sourceKeys);
  assert.deepEqual(next.sort(), ['material:loose', 'material:m']);
  assert.deepEqual(toggleStudySourceKeys(next, filtered.sourceKeys), ['material:loose']);
  const onlySelected = buildStudySourceTree(sources, workspace, { ...options, onlySelected: true, selected: new Set(['material:m']) });
  assert.deepEqual(onlySelected.sourceKeys, ['material:m']);
});
test('thousands of sources build with unique counts and defensive cycle handling', () => {
  const many = Array.from({ length: 5000 }, (_, i) => source(String(i), [{ ...scope, folderId: 'nested' }, { ...scope, subjectId: 'b' }]));
  const start = performance.now();
  const tree = buildStudySourceTree(many, workspace, options);
  assert.equal(tree.sourceKeys.length, 5000);
  assert.ok(performance.now() - start < 2000, 'building the tree should remain interactive');
  const cyclic = { ...workspace, folders: [{ ...workspace.folders[0], parentId: 'nested' }, workspace.folders[1]] };
  assert.equal(buildStudySourceTree(many, cyclic, options).sourceKeys.length, 5000);
});

test('location labels disambiguate nested folders and identically named subtopics', () => {
  const topics = [
    { id: 't', name: 'Unidad 1', subjectId: 's', folderId: 'nested', parentId: null },
    { id: 'child', name: 'Resumen', subjectId: 's', folderId: 'nested', parentId: 't' },
    { id: 't2', name: 'Unidad 2', subjectId: 's', folderId: 'nested', parentId: null },
    { id: 'child2', name: 'Resumen', subjectId: 's', folderId: 'nested', parentId: 't2' },
  ];
  const paths = studyOrganizationPaths({ ...workspace, topics });
  assert.equal(paths.label({ ...scope, topicId: 'child' }), 'Ciencias / Química / Orgánica / Exámenes / Unidad 1 / Resumen');
  assert.notEqual(paths.label({ ...scope, topicId: 'child' }), paths.label({ ...scope, topicId: 'child2' }));
});
