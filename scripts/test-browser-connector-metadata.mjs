// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyMetadataEdits, formatCreators, parseCreators } from '../browser-extension/lib/metadata-form.js';
import { detectCaptureCandidates } from '../browser-extension/lib/multi-capture.js';

test('browser connector creator edits round-trip common personal and institutional names', () => {
  const formatted = formatCreators([
    { creatorType: 'author', firstName: 'María', lastName: 'García Fernández', fieldMode: 0 },
    { creatorType: 'author', name: 'European Research Council', fieldMode: 1 },
  ]);
  assert.equal(formatted, 'García Fernández, María\n{European Research Council}');
  assert.deepEqual(parseCreators(formatted), [
    { creatorType: 'author', firstName: 'María', lastName: 'García Fernández', fieldMode: 0 },
    { creatorType: 'author', name: 'European Research Council', fieldMode: 1 },
  ]);
});

test('browser connector metadata edits normalize DOI and derive a reviewable year', () => {
  const edited = applyMetadataEdits({
    title: 'Old', itemType: 'journal-article', creators: [], year: null, isbn: [], issn: [], tags: [],
  }, {
    title: '  Revised title  ', creators: 'García, María; Ada Lovelace', date: 'Published 2024-05-03',
    publicationTitle: 'History Quarterly', doi: 'https://doi.org/10.1000/ABC.1',
  });
  assert.equal(edited.title, 'Revised title');
  assert.equal(edited.year, 2024);
  assert.equal(edited.doi, '10.1000/ABC.1');
  assert.equal(edited.publicationTitle, 'History Quarterly');
  assert.equal(edited.creators.length, 2);
});

test('browser connector exposes independent COinS records as a bounded multi-capture', () => {
  const candidates = detectCaptureCandidates({
    title: 'Results', url: 'https://catalog.example/search', lang: 'en', contentType: 'text/html',
    metas: [], links: [], anchors: [], jsonLd: [], html: '',
    coins: [
      'ctx_ver=Z39.88-2004&rft.genre=article&rft.atitle=First+paper&rft_id=info%3Adoi%2F10.1000%2Fone',
      'ctx_ver=Z39.88-2004&rft.genre=book&rft.btitle=Second+book&rft.isbn=9788400000000',
    ],
  });
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((entry) => entry.metadata.title), ['First paper', 'Second book']);
});
