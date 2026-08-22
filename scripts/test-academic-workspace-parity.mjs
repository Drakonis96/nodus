import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  visibleAcademicEdges,
  workspaceArgumentRoutes,
  workspaceAuthorDossier,
  workspaceAuthorPage,
  workspaceIdeaPage,
  workspaceSynthesisMatrix,
} from '../server/lib/core/academicWorkspace.mjs';

const hash = (value) => createHash('sha1').update(value).digest('hex').slice(0, 16);

const fixture = {
  works: [
    { nodus_id: 'w1', title: 'Written work', authors_json: '["Ada Lovelace"]', year: 1843, archived: 0, deep_status: 'done', read_tag: 1 },
    { nodus_id: 'w2', title: 'Edited volume', authors_json: '["Ada Lovelace"]', year: 1844, archived: 0, deep_status: 'done', read_tag: 0 },
  ],
  authors: [
    { author_id: 'a1', name: 'Lovelace, Ada', affiliation: 'Analytical Society' },
    { author_id: 'a2', name: 'Babbage, Charles', affiliation: null },
  ],
  work_authors: [
    { nodus_id: 'w1', author_id: 'a1', role: 'author' },
    { nodus_id: 'w2', author_id: 'a1', role: 'editor' },
  ],
  ideas: [
    { global_id: 'i1', type: 'claim', label: 'Machines manipulate symbols', statement: 'A machine can operate on more than quantities.' },
    { global_id: 'i2', type: 'method', label: 'Describe operations as a sequence', statement: 'Programs make operations explicit.' },
    { global_id: 'i3', type: 'claim', label: 'Rejected neighbour', statement: 'This edge is vetoed.' },
  ],
  idea_occurrences: [
    { global_id: 'i1', nodus_id: 'w1', role: 'principal', development: 'Central claim', confidence: 0.9 },
    { global_id: 'i2', nodus_id: 'w2', role: 'principal', development: 'Editor-only attribution', confidence: 0.8 },
    { global_id: 'i3', nodus_id: 'w1', role: 'secondary', development: '', confidence: 0.4 },
  ],
  themes: [{ theme_id: 't1', label: 'Computation' }],
  idea_theme_links: [
    { global_id: 'i1', nodus_id: 'w1', theme_id: 't1' },
    { global_id: 'i2', nodus_id: 'w2', theme_id: 't1' },
  ],
  evidence: [{ id: 'ev1', global_id: 'i1', nodus_id: 'w1', quote: 'The engine might act upon other things besides number.', kind: 'explicit' }],
  edges: [
    { id: 'e1', from_id: 'i1', to_id: 'i2', type: 'supports', confidence: 0.8 },
    { id: 'e2', from_id: 'i1', to_id: 'i3', type: 'contradicts', confidence: 0.95 },
  ],
  edge_feedback: [{ type: 'contradicts', from_id: 'i1', to_id: 'i3', verdict: 'rejected' }],
  author_relations: [{ from_author: 'a1', to_author: 'a2', type: 'supports', weight: 0.7 }],
  author_dossier_synthesis: [{
    author_id: 'a1', thesis: 'Symbolic operations can be specified.', remember_json: '["Programs are sequences"]',
    positioning: 'Extends the engine beyond arithmetic.', model_json: null,
    fingerprint: hash('i1,i2,i3|a2:supports'), generated_at: '2026-08-22T00:00:00.000Z',
  }],
  synthesis_matrix_cell: [{ author_id: 'a1', theme_id: 't1', stance: 'Computation is symbolic.', fingerprint: hash('i1,i2') }],
  zotero_tags: [],
  work_zotero_tags: [],
};

test('workspace Ideas applies Desktop filters, aggregates and visible-edge semantics', () => {
  assert.equal(visibleAcademicEdges(fixture).length, 1);
  const page = workspaceIdeaPage(fixture, { offset: 0, limit: 20, sort: 'connections', type: 'claim', search: 'machine' });
  assert.equal(page.total, 1);
  assert.deepEqual(page.items[0], {
    id: 'i1', label: 'Machines manipulate symbols', type: 'claim', statement: 'A machine can operate on more than quantities.',
    workCount: 1, themes: ['Computation'], maxConfidence: 0.9, connectionCount: 1,
  });
});

test('workspace Authors keeps authorship separate from editor-only provisional attribution', () => {
  const page = workspaceAuthorPage(fixture, { offset: 0, limit: 20, sort: 'surname', synthesis: 'with' });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].fullName, 'Ada Lovelace');
  assert.equal(page.items[0].workCount, 1);
  assert.equal(page.items[0].editedCount, 1);
  assert.equal(page.items[0].ideaCount, 3);
  assert.equal(page.items[0].saved, false);

  const dossier = workspaceAuthorDossier(fixture, 'a1');
  assert.ok(dossier);
  assert.deepEqual(dossier.works.map((work) => work.nodus_id), ['w1']);
  assert.deepEqual(dossier.editedWorks.map((work) => work.nodus_id), ['w2']);
  assert.equal(dossier.ideas.find((idea) => idea.global_id === 'i2').provisional, true);
  assert.equal(dossier.synthesis.stale, false);
});

test('matrix and Argument Map routes use the same grounded rows as Desktop', () => {
  const matrix = workspaceSynthesisMatrix(fixture);
  assert.equal(matrix.authors[0].author_id, 'a1');
  assert.equal(matrix.themes[0].theme_id, 't1');
  assert.equal(matrix.cells[0].ideaCount, 2);
  assert.equal(matrix.cells[0].stance, 'Computation is symbolic.');

  const routes = workspaceArgumentRoutes(fixture);
  assert.deepEqual(routes.map((route) => route.ideaId), ['i1', 'i2']);
  assert.equal(routes[0].degree, 1);
  assert.equal(routes[0].debateCount, 0);
  assert.deepEqual(routes[0].neighborLabels, ['Describe operations as a sequence']);
});
