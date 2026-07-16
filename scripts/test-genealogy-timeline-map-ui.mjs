import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [timeline, css, map, placesMap, modal, tree, relations] = await Promise.all([
  readFile(path.join(root, 'src/views/TimelineView.tsx'), 'utf8'),
  readFile(path.join(root, 'src/index.css'), 'utf8'),
  readFile(path.join(root, 'src/views/MapView.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/PlacesMap.tsx'), 'utf8'),
  readFile(path.join(root, 'src/components/PersonDossierModal.tsx'), 'utf8'),
  readFile(path.join(root, 'src/views/TreeView.tsx'), 'utf8'),
  readFile(path.join(root, 'src/views/RelationsView.tsx'), 'utf8'),
]);

test('timeline exposes independent people and event-type multiselect filters', () => {
  assert.match(timeline, /testId="timeline-person-filter"/);
  assert.match(timeline, /testId="timeline-type-filter"/);
  assert.match(timeline, /selectedPersonIds\.length === 0 \|\| event\.participants\.some/);
  assert.match(timeline, /selectedTypes\.length === 0 \|\| selectedTypes\.includes\(event\.type\)/);
});

test('timeline cards show portraits and open the shared full record', () => {
  assert.match(timeline, /data-testid="timeline-event-card"/);
  assert.match(timeline, /<PersonPortrait person=/);
  assert.match(timeline, /data-timeline-person-id=/);
  assert.match(timeline, /<PersonDossierModal personId=\{dossierId\}/);
});

test('timeline cards, chips and evidence expose explicit light-theme surfaces', () => {
  for (const className of ['timeline-event-surface', 'timeline-event-dot', 'timeline-date-chip', 'timeline-event-participants', 'timeline-person-chip', 'timeline-detail-person', 'timeline-evidence-card']) {
    assert.match(timeline, new RegExp(className));
    assert.match(css, new RegExp(`\\.light \\.${className}`));
  }
  assert.doesNotMatch(timeline, /bg-gradient-to-br from-neutral-900\/80 to-neutral-950/);
});

test('map people are mouse and keyboard activatable and open the shared record', () => {
  assert.match(map, /onPersonClick=\{setDossierId\}/);
  assert.match(map, /<PersonDossierModal personId=\{dossierId\}/);
  assert.match(placesMap, /data-person-id=/);
  assert.match(placesMap, /closest<HTMLElement>\('\[data-person-id\]'\)/);
  assert.match(placesMap, /event\.key === 'Enter' \|\| event\.key === ' '/);
});

test('all genealogy graph surfaces reuse one dossier modal', () => {
  assert.match(modal, /data-testid="person-dossier-modal"/);
  assert.match(modal, /<PersonDossier/);
  assert.match(tree, /<PersonDossierModal/);
  assert.match(relations, /<PersonDossierModal/);
  assert.doesNotMatch(relations, /function PersonDossierLoader/);
});
