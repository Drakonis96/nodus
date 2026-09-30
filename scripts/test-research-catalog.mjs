import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

async function loadCatalog() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-catalog-'));
  try {
    await build({ entryPoints: ['shared/researchCatalog.ts'], outfile: path.join(root, 'catalog.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    return require(path.join(root, 'catalog.cjs'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// The library of the failed conversation: the same author catalogued under two spellings,
// a namesake who shares one surname, and an editor credited on another author's book.
const library = [
  { id: 'c8', title: 'Algunas notas sobre la consolidación de los relatos de viaje como género literario', authors: ['Alburquerque García, L.', 'Arellano Ayuso, I. (ed.)'], year: 2009 },
  { id: 'rf', title: 'El "relato de viajes": hitos y formas en la evolución del género', authors: ['Albuquerque García, L.'], year: 2011 },
  { id: 'gu', title: '¿Teatro de viajes?: paradojas modales de un género literario', authors: ['García Barrientos, José Luis'], year: 2011 },
  { id: 'sw', title: 'Poética del relato de viajes', authors: ['Carrizo Rueda, Sofía M.'], year: 1997 },
  { id: 'ed', title: 'Viajeros por España', authors: ['Pérez Gómez, Ana', 'Alburquerque García, Luis (ed.)'], year: 2020 },
  { id: 'fo', title: 'Fotografía y turismo en el franquismo', authors: ['Vega, Carmelo'], year: 2014 },
  { id: 'fr', title: 'El relato de viaje, un género fronterizo', authors: ['Champeau, Geneviève'], year: 2004 },
  { id: 'hi', title: 'Periodismo y literatura: el "relato de viajes" como género híbrido a la luz de la pragmática', authors: ['Albuquerque García, L.'], year: 2018 },
  { id: 'ms', title: 'Medio siglo del libro de viaje fotográfico', authors: ['Parr, Martin'], year: 2019 },
];

test('an author named as the user typed it finds every spelling the library holds, and nobody else', async () => {
  const { searchResearchCatalog } = await loadCatalog();
  const hits = searchResearchCatalog(library, { author: 'albuquerque garcía' });
  assert.deepEqual(hits.map(hit => hit.id).sort(), ['c8', 'ed', 'hi', 'rf'], 'Alburquerque and Albuquerque are the same person; García Barrientos is not');
  assert.equal(hits.at(-1).id, 'ed', 'a work the author only edited ranks below the ones they wrote');
  assert.deepEqual(searchResearchCatalog(library, { author: 'Luis Alburquerque' }).map(hit => hit.id).sort(), ['c8', 'ed', 'hi', 'rf'], 'a given name matches its initial');
  assert.deepEqual(searchResearchCatalog(library, { author: 'García' }).map(hit => hit.id).sort(), ['c8', 'ed', 'gu', 'hi', 'rf'], 'one surname alone is shared');
});

test('titles and topic words find works by what they are called, with accents folded', async () => {
  const { searchResearchCatalog, withinOneEdit } = await loadCatalog();
  const titled = searchResearchCatalog(library, { title: 'poetica relato viajes' }).map(hit => hit.id);
  assert.equal(titled[0], 'sw', 'the work named comes first; kindred titles may follow');
  assert.ok(!titled.includes('fo') && !titled.includes('gu'));
  const genre = searchResearchCatalog(library, { keywords: 'relato de viaje género literario' }).map(hit => hit.id);
  assert.ok(genre.includes('c8') && genre.includes('rf'), 'the genre-theory titles answer a question about the genre');
  assert.ok(!genre.includes('fo'));
  assert.deepEqual(searchResearchCatalog(library, { keywords: 'mecánica cuántica relativista' }), [], 'an unrelated topic finds nothing');
  assert.deepEqual(searchResearchCatalog(library, {}), []);
  assert.deepEqual(searchResearchCatalog(library, { author: 'García', year: 2011 }).map(hit => hit.id).sort(), ['gu', 'rf']);
  // A title that is mostly the topic outranks one that shares as many words but is about a case.
  const topical = searchResearchCatalog(library, { keywords: 'relato de viaje género' }).map(hit => hit.id);
  assert.ok(topical.indexOf('fr') >= 0 && topical.indexOf('fr') < topical.indexOf('hi'), `the genre title comes before the case study (${topical})`);
  assert.ok(!topical.includes('ms') && !topical.includes('fo'), 'photography books do not answer a question on the genre');
  for (const [a, b, same] of [['alburquerque', 'albuquerque', true], ['garcia', 'gracia', true], ['viaje', 'viajes', true], ['relato', 'retrato', false]]) assert.equal(withinOneEdit(a, b), same, `${a}/${b}`);
});
