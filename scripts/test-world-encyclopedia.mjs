// The pure half of the encyclopedia: keys, wiki-links, the A–Z index and the ranking.
//
// Bundled with esbuild and required, so these assert on the real exported functions
// rather than on a re-implementation of them. No database, no renderer, no model.

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-encyclopedia-'));

function load(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [
      path.join(repoRoot, file),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=es2022',
      `--outfile=${bundle}`,
    ],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const enc = load('shared/worldEncyclopedia.ts');
test.after(() => rm(outDir, { recursive: true, force: true }));

/** A minimal entry; only the fields the pure layer reads. */
function entry(kind, id, title, extra = {}) {
  return {
    kind,
    id,
    key: enc.entryKey({ kind, id }),
    title,
    titleKey: enc.normalizeTitle(title),
    aliases: [],
    summary: null,
    category: null,
    editable: kind === 'article',
    stub: false,
    spoiler: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

test('an entry is addressed by kind AND id', () => {
  const ref = { kind: 'character', id: 'prs_1' };
  assert.equal(enc.entryKey(ref), 'character:prs_1');
  assert.deepEqual(enc.parseEntryKey('character:prs_1'), ref);
  // Ids are unique per table, never across the world: keying by id alone would collide.
  assert.notEqual(enc.entryKey({ kind: 'place', id: 'x' }), enc.entryKey({ kind: 'character', id: 'x' }));
  // An id may contain anything, including the separator.
  assert.deepEqual(enc.parseEntryKey('article:a:b'), { kind: 'article', id: 'a:b' });
  assert.equal(enc.parseEntryKey('nonsense:1'), null);
  assert.equal(enc.parseEntryKey('character:'), null);
  assert.equal(enc.parseEntryKey(':prs_1'), null);
});

test('a pending key can never collide with a resolved one', () => {
  const key = enc.pendingKey('  Los   Sin Nombre ');
  assert.equal(key, '?:los sin nombre');
  assert.equal(enc.isPendingKey(key), true);
  assert.equal(enc.pendingText(key), 'los sin nombre');
  assert.equal(enc.parseEntryKey(key), null, 'and it never parses as an entry');
  // Accents fold, so «Vaël» and «Vael» wait on the same entry.
  assert.equal(enc.pendingKey('Vaël'), enc.pendingKey('Vael'));
});

test('the A–Z index folds accents and quarantines the rest', () => {
  assert.equal(enc.alphaBucket('Äther'), 'A');
  assert.equal(enc.alphaBucket('ñandú'), 'N');
  assert.equal(enc.alphaBucket('Élan'), 'E');
  assert.equal(enc.alphaBucket('  vael'), 'V');
  assert.equal(enc.alphaBucket('3 lunas'), '#');
  assert.equal(enc.alphaBucket('«Los Sin Nombre»'), '#');
  assert.equal(enc.alphaBucket(''), '#');
  assert.equal(enc.alphaBucket('龍'), '#');
});

test('parseWorldLinks reads both forms and counts repeats', () => {
  const body = [
    'Kaelen aprendió de [el Cuervo](nodus://world/character/prs_1).',
    'Más tarde [Kaelen Vor](nodus://world/character/prs_1) volvió a [[Los Sin Nombre]].',
    'Y [Puerto Gris](nodus://world/place/plc_9) ardió.',
  ].join('\n');

  const links = enc.parseWorldLinks(body);
  const byKey = new Map(links.map((l) => [l.link.status === 'resolved' ? enc.entryKey(l.link.target) : enc.pendingKey(l.link.text), l]));

  assert.equal(links.length, 3, 'two mentions of one target are ONE edge');
  assert.equal(byKey.get('character:prs_1').occurrences, 2);
  assert.equal(byKey.get('character:prs_1').link.label, 'el Cuervo', 'the first label wins');
  assert.equal(byKey.get('place:plc_9').occurrences, 1);
  assert.equal(byKey.get('?:los sin nombre').link.status, 'pending');
});

test('parseWorldLinks ignores what is not a world link', () => {
  const body = [
    'Una cita académica: [Idea](nodus://idea/abc).',
    'Un enlace externo: [web](https://example.com).',
    'Una clase inventada: [x](nodus://world/dragon/1).',
    'Corchetes vacíos: [[]] y [[ ]].',
    'Un array en prosa: a[[0]]b.',
    'En línea: `[[Codigo]]` no enlaza.',
    '```',
    '[[Tampoco esto]] ni [x](nodus://world/character/prs_9)',
    '```',
  ].join('\n');

  const links = enc.parseWorldLinks(body);
  assert.deepEqual(links.map((l) => (l.link.status === 'pending' ? l.link.text : enc.entryKey(l.link.target))), ['0']);
});

test('a rename moves nothing: the target is an id and the label is prose', () => {
  const body = 'Aprendió de [el Cuervo](nodus://world/character/prs_1).';
  const before = enc.parseWorldLinks(body)[0];
  // The character is renamed from "Kaelen Vor" to "Kaelen el Callado" — the body is not
  // touched, and the link still points at the same person under the same words.
  const after = enc.parseWorldLinks(body)[0];
  assert.deepEqual(after.link.target, before.link.target);
  assert.equal(after.link.label, 'el Cuervo', 'renaming must never rewrite a sentence');
});

test('formatWorldLink round-trips through the parser', () => {
  const target = { kind: 'place', id: 'plc con espacio/y barra' };
  const md = enc.formatWorldLink(target, 'Puerto Gris');
  assert.match(md, /^\[Puerto Gris\]\(nodus:\/\/world\/place\//);
  assert.deepEqual(enc.parseWorldLinks(md)[0].link.target, target);
});

test('toRenderableBody turns pending links into something clickable, code aside', () => {
  const rendered = enc.toRenderableBody('Ver [[Los Sin Nombre]] y `[[Codigo]]`.');
  assert.match(rendered, /\[Los Sin Nombre\]\(nodus:\/\/world\/new\/Los%20Sin%20Nombre\)/);
  assert.match(rendered, /`\[\[Codigo\]\]`/, 'code is left exactly as written');
});

test('resolvePendingLinks promotes only what now exists', () => {
  const entries = [entry('character', 'prs_1', 'Kaelen Vor', { aliases: ['el Cuervo'] })];
  const lookup = enc.entryLookup(entries);
  const resolve = (normalized) => lookup.get(normalized) ?? null;

  const out = enc.resolvePendingLinks('Ver [[Kaelen Vor]], [[el cuervo]] y [[Los Sin Nombre]].', resolve);
  assert.equal(out.resolved, 2, 'the alias resolves too, folded and case-insensitively');
  assert.match(out.body, /\[Kaelen Vor\]\(nodus:\/\/world\/character\/prs_1\)/);
  assert.match(out.body, /\[el cuervo\]\(nodus:\/\/world\/character\/prs_1\)/, 'and keeps the words typed');
  assert.match(out.body, /\[\[Los Sin Nombre\]\]/, 'what does not exist stays pending');
});

test('entryLookup lets the oldest holder of a name keep it', () => {
  const lookup = enc.entryLookup([
    entry('article', 'art_old', 'Vaël'),
    entry('article', 'art_new', 'Vael'),
  ]);
  assert.deepEqual(lookup.get('vael'), { kind: 'article', id: 'art_old' });
});

test('searchWorldEntries ranks rather than filters', () => {
  const entries = [
    entry('article', 'a1', 'Magia de sangre', { summary: 'El precio de Kaelen.' }),
    entry('character', 'c1', 'Kaelen Vor', { aliases: ['el Cuervo'] }),
    entry('place', 'p1', 'Kaelendorf'),
    entry('group', 'g1', 'Los Cuervos', { category: 'faction' }),
  ];

  const hits = enc.searchWorldEntries(entries, 'kaelen');
  assert.deepEqual(
    hits.map((h) => h.entry.id),
    ['c1', 'p1', 'a1'],
    'exact title, then prefix, then a summary mention'
  );
  assert.equal(hits[0].matched, 'title');
  assert.equal(hits[2].matched, 'summary');

  const alias = enc.searchWorldEntries(entries, 'el cuervo');
  assert.equal(alias[0].entry.id, 'c1');
  assert.equal(alias[0].matched, 'alias');

  // Accents fold in both directions.
  assert.equal(enc.searchWorldEntries([entry('article', 'v', 'Vaël')], 'vael').length, 1);
  assert.equal(enc.searchWorldEntries([entry('article', 'v', 'Vael')], 'vaël').length, 1);
});

test('an empty query is the index itself, in A–Z order', () => {
  const entries = [entry('place', 'p', 'Ávila'), entry('article', 'a', 'zafiro'), entry('character', 'c', 'Bruma')];
  assert.deepEqual(
    enc.searchWorldEntries(entries, '   ').map((h) => h.entry.id),
    ['p', 'c', 'a']
  );
});

test('the limit truncates by score, not by insertion order', () => {
  // The exact match is loaded LAST on purpose: a limit applied before the sort would
  // drop precisely the result the author was typing towards.
  const entries = [
    entry('article', 'near1', 'Kaelen y la ceniza'),
    entry('article', 'near2', 'Kaelen y el mar'),
    entry('character', 'exact', 'Kaelen'),
  ];
  const hits = enc.searchWorldEntries(entries, 'Kaelen', 1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].entry.id, 'exact');
});

test('the autocomplete offers recent work when nothing has been typed', () => {
  const entries = [
    entry('article', 'old', 'Antiguo', { updatedAt: '2026-01-01T00:00:00.000Z' }),
    entry('article', 'new', 'Reciente', { updatedAt: '2026-07-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(enc.rankEntryCandidates(entries, '', 1).map((e) => e.id), ['new']);
  assert.deepEqual(enc.rankEntryCandidates(entries, 'anti', 5).map((e) => e.id), ['old']);
});

test('extractSnippet windows the match, and accents do not shift the cut', () => {
  const text = `${'a'.repeat(200)} Vaël quemó el puerto ${'b'.repeat(200)}`;
  const snippet = enc.extractSnippet(text, 'vael', 10);
  assert.match(snippet, /Vaël quemó/, 'the accented original is shown, not the folded copy');
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…'));
  assert.ok(snippet.length < 60);

  // Length-preserving folding is what keeps this honest: one accent before the needle
  // would otherwise shift the window by one character.
  const accented = `${'á'.repeat(40)}NEEDLE${'á'.repeat(40)}`;
  assert.match(enc.extractSnippet(accented, 'needle', 5), /NEEDLE/);

  // No match at all still yields something readable rather than an empty string.
  assert.equal(enc.extractSnippet('corto', 'ausente'), 'corto');
});

test('foldPreservingLength never changes the character count', () => {
  const samples = [
    'Vaël', 'ÁÉÍÓÚñ', 'a🐉b', 'straße', '',
    // The three that actually exercise the guard. Without them this test passes even
    // when the guard is deleted, which is how it was written the first time.
    'Vaël',        // already decomposed: the combining mark folds to nothing
    '́',            // a lone combining acute
    'İstanbul',     // dotted capital I lowercases to TWO characters
  ];
  for (const sample of samples) {
    assert.equal(enc.foldPreservingLength(sample).length, sample.length, JSON.stringify(sample));
  }
});

test('the vocabularies stay in step with their labels', () => {
  for (const kind of enc.WORLD_ENTRY_KINDS) {
    assert.ok(enc.WORLD_ENTRY_KIND_LABEL[kind], `${kind} has a label`);
  }
  for (const category of enc.ARTICLE_CATEGORIES) {
    assert.ok(enc.ARTICLE_CATEGORY_LABEL[category], `${category} has a label`);
  }
  assert.equal(Object.keys(enc.ARTICLE_CATEGORY_LABEL).length, enc.ARTICLE_CATEGORIES.length);
  assert.equal(enc.isArticleCategory('magic'), true);
  assert.equal(enc.isArticleCategory('nonsense'), false);
});

// ── What the world names but never defines ───────────────────────────────────

const missing = load('shared/worldMissingEntries.ts');

function body(key, title, text, field = 'body') {
  return { key, title, field, text };
}

test('an unresolved link is always a candidate: the author already said it exists', () => {
  const candidates = missing.collectEntryCandidates(
    [body('article:a', 'Magia', 'La guardan [[Los Sin Nombre]].')],
    []
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, 'unresolved_link');
  assert.equal(candidates[0].term, 'Los Sin Nombre');
  // Once in one entry is enough — the frequency thresholds do NOT apply to a declaration.
  assert.equal(candidates[0].occurrences.length, 1);
  assert.match(candidates[0].occurrences[0].snippet, /Los Sin Nombre/);
});

test('a term that already exists is never proposed back to the author', () => {
  const entries = [entry('character', 'c1', 'Kaelen Vor', { aliases: ['el Cuervo'] })];
  const bodies = [
    body('article:a', 'A', 'Ver [[Kaelen Vor]]. Kaelen Vor llegó. Con Kaelen Vor y el Cuervo.'),
    body('article:b', 'B', 'Otra vez Kaelen Vor, y el Cuervo también.'),
  ];
  assert.deepEqual(missing.collectEntryCandidates(bodies, entries), []);
});

test('a guess needs to recur, and across more than one entry', () => {
  const once = [body('article:a', 'A', 'Bebieron aguamiel en la sala.')];
  assert.deepEqual(missing.collectEntryCandidates(once, []), []);

  // One entry, three times, and mid-sentence at least once — so the sentence-start rule
  // CANNOT be what rejects it. A guard hidden behind another guard is a guard nobody is
  // testing: written the obvious way, this passed with the entry-count check deleted.
  const oneEntryOnly = [body('article:a', 'A', 'Sirvió al Verdugo. El Verdugo habló. Temían al Verdugo.')];
  assert.deepEqual(
    missing.collectEntryCandidates(oneEntryOnly, []),
    [],
    'a word repeated inside one entry is a style tic, not a missing entry'
  );

  const spread = [
    body('article:a', 'A', 'Sirvió al Verdugo. Temían al Verdugo.'),
    body('article:b', 'B', 'Y el Verdugo volvió.'),
  ];
  const found = missing.collectEntryCandidates(spread, []);
  assert.equal(found.length, 1);
  assert.equal(found[0].term, 'Verdugo');
  assert.equal(found[0].source, 'frequency');
});

test('a capital that is only ever grammar is not a name', () => {
  // "Regresaron" only ever starts a sentence: capitalised for grammar, not a proper noun.
  const bodies = [
    body('article:a', 'A', 'Regresaron al alba. Regresaron sin nada.'),
    body('article:b', 'B', 'Regresaron por fin.'),
  ];
  assert.deepEqual(missing.collectEntryCandidates(bodies, [], { minOccurrences: 2, minEntries: 2 }), []);

  // The same word, used mid-sentence too, IS offered: that is how a proper noun behaves.
  const asName = [
    body('article:a', 'A', 'Llamaron al Regresaron. Regresaron respondió.'),
    body('article:b', 'B', 'Y Regresaron calló.'),
  ];
  assert.equal(missing.collectEntryCandidates(asName, [], { minOccurrences: 2, minEntries: 2 }).length, 1);
});

test('a word of an existing name is not an undefined term', () => {
  // The character is «Kaelen Vor», known as «el Cuervo». Prose that says just «Cuervo»
  // is talking about somebody the world already has.
  const entries = [entry('character', 'c1', 'Kaelen Vor', { aliases: ['el Cuervo'] })];
  const bodies = [
    body('article:a', 'A', 'Sirvió al Cuervo. Temían al Cuervo.'),
    body('article:b', 'B', 'Y el Cuervo volvió.'),
  ];
  assert.deepEqual(missing.collectEntryCandidates(bodies, entries), []);
  // With nobody by that name it IS proposed, so this is exclusion and not a dead branch.
  assert.deepEqual(missing.collectEntryCandidates(bodies, []).map((c) => c.term), ['Cuervo']);
});

test('a multi-word name is one term, and its halves are not proposed', () => {
  // The exact shape that made the analysis unusable: single-word matching saw
  // «Kaelen» and «Vor» as two undefined terms even though the character exists.
  const bodies = [
    body('article:a', 'A', 'Sirvió a Kaelen Vor. Temían a Kaelen Vor.'),
    body('article:b', 'B', 'Y Kaelen Vor volvió.'),
  ];
  assert.deepEqual(missing.collectEntryCandidates(bodies, [entry('character', 'c1', 'Kaelen Vor')]), []);
  // With nobody by that name, the WHOLE name is the candidate — not its halves.
  const unknown = missing.collectEntryCandidates(bodies, []);
  assert.deepEqual(unknown.map((candidate) => candidate.term), ['Kaelen Vor']);
});

test('facts come before guesses, and a term is reported once', () => {
  const bodies = [
    body('article:a', 'A', 'Sirvió al Verdugo y a [[Vael]]. Temían al Verdugo.'),
    body('article:b', 'B', 'El Verdugo volvió a [[Vael]].'),
  ];
  const found = missing.collectEntryCandidates(bodies, []);
  assert.deepEqual(found.map((candidate) => candidate.source), ['unresolved_link', 'frequency']);

  // A term the author linked AND that recurs is the stronger kind, not both.
  const both = [
    body('article:a', 'A', 'Sirvió al [[Verdugo]] y temían al Verdugo.'),
    body('article:b', 'B', 'El Verdugo volvió.'),
  ];
  const once = missing.collectEntryCandidates(both, []);
  assert.equal(once.length, 1);
  assert.equal(once[0].source, 'unresolved_link');
});

test('the model context shows where each term appears', () => {
  const candidates = missing.collectEntryCandidates([body('article:a', 'Magia', 'La guardan [[Los Sin Nombre]].')], []);
  const context = missing.composeMissingEntriesContext(candidates);
  assert.match(context, /Los Sin Nombre/);
  assert.match(context, /el autor lo enlazó y no existe/);
  assert.match(context, /en «Magia»/);
});

// ── The world bible ──────────────────────────────────────────────────────────

const bible = load('shared/worldBibleDoc.ts');

const BIBLE_DEFAULTS = {
  format: 'md',
  order: 'alpha',
  includeSpoilers: false,
  includeNotes: false,
  includeProposals: false,
  title: 'Mundo',
};

function bibleEntry(item, body = '', extra = {}) {
  return { entry: item, body, facts: [], backlinks: [], notes: null, proposedBody: null, ...extra };
}

test('a spoiler stays out unless the author says otherwise', () => {
  const entries = [entry('article', 'a', 'Público'), entry('article', 'b', 'Secreto', { spoiler: true })];
  assert.deepEqual(
    bible.selectBibleEntries(entries, BIBLE_DEFAULTS).map((e) => e.id),
    ['a'],
    'exporting is handing the file to somebody else'
  );
  assert.equal(bible.selectBibleEntries(entries, { ...BIBLE_DEFAULTS, includeSpoilers: true }).length, 2);
});

test('two entries with the same title get different anchors', () => {
  // A real situation: a city and the article about the battle fought there. An anchor
  // built from the title alone would send half the links to the wrong entry.
  const a = bible.bibleAnchor({ kind: 'place', id: 'plc_aaaaaa' }, 'Vael');
  const b = bible.bibleAnchor({ kind: 'article', id: 'art_bbbbbb' }, 'Vael');
  assert.notEqual(a, b);
  assert.match(a, /^place-vael-/);
  assert.match(b, /^article-vael-/);
  // Accents fold, so an anchor is always a valid fragment.
  assert.match(bible.bibleAnchor({ kind: 'article', id: 'x' }, 'Vaël Ñu'), /^article-vael-nu-/);
});

test('a link whose target was left out never survives as a dead URL', () => {
  const inSelection = 'Ver [Kaelen](nodus://world/character/prs_1).';
  const outOfSelection = 'Ver [Secreto](nodus://world/article/art_9).';
  const resolve = (ref) => (ref.id === 'prs_1' ? 'character-kaelen-prs1' : null);

  assert.equal(bible.rewriteLinksForExport(inSelection, resolve), 'Ver [Kaelen](#character-kaelen-prs1).');
  const stripped = bible.rewriteLinksForExport(outOfSelection, resolve);
  assert.equal(stripped, 'Ver **Secreto**.');
  // The assertion that matters: a Markdown reader renders a leftover nodus:// link as a
  // live broken link, and a PDF as unclickable blue text.
  assert.doesNotMatch(stripped, /nodus:\/\//);
  assert.equal(bible.rewriteLinksForExport('Ver [[Los Sin Nombre]].', resolve), 'Ver Los Sin Nombre.');
});

test('the exported Markdown has no nodus:// anywhere and its anchors match its index', () => {
  const kaelen = entry('character', 'prs_1', 'Kaelen Vor');
  const magia = entry('article', 'art_1', 'Magia de sangre', { category: 'magic' });
  const doc = {
    title: 'Mundo',
    generatedAt: '2026-07-28',
    entries: [
      bibleEntry(magia, 'La practican [Kaelen Vor](nodus://world/character/prs_1) y [X](nodus://world/place/plc_x).', {
        notes: 'Nota privada.',
        proposedBody: 'Borrador sin aceptar.',
      }),
      bibleEntry(kaelen, 'Aprendió solo.'),
    ],
  };
  const markdown = bible.renderWorldBibleMarkdown(doc, BIBLE_DEFAULTS);

  assert.doesNotMatch(markdown, /nodus:\/\//);
  assert.doesNotMatch(markdown, /Nota privada/, 'private notes are off by default');
  assert.doesNotMatch(markdown, /Borrador sin aceptar/, 'an unaccepted draft is not canon');
  assert.match(markdown, /\*\*X\*\*/, 'a target outside the export is plain text');

  // Every anchor referenced in the index exists as a heading anchor.
  const referenced = [...markdown.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((m) => m[1]);
  const defined = new Set([...markdown.matchAll(/\{#([a-z0-9-]+)\}/g)].map((m) => m[1]));
  assert.ok(referenced.length > 0);
  for (const anchor of referenced) assert.ok(defined.has(anchor), `#${anchor} has a heading`);

  const withExtras = bible.renderWorldBibleMarkdown(doc, {
    ...BIBLE_DEFAULTS,
    includeNotes: true,
    includeProposals: true,
  });
  assert.match(withExtras, /Nota privada/);
  assert.match(withExtras, /Propuesta sin aceptar/);
});
