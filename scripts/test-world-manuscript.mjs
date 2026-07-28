// The pure half of the manuscript: counting it, and reading its spine.
//
// There is little pure logic in this section on purpose — the order, the dates and what a
// scene must do all already exist elsewhere in the vault. What is left is the arithmetic
// that would lie silently if it were wrong: a word count and a day's progress.

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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-manuscript-'));

function load(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const ms = load('shared/worldManuscript.ts');
test.after(() => rm(outDir, { recursive: true, force: true }));

function scene(id, over = {}) {
  return {
    sceneId: id,
    title: id,
    narrativeOrder: 0,
    status: 'draft',
    wordCount: 0,
    chapter: null,
    ...over,
  };
}

test('a resolved link counts as its label, not as its URL', () => {
  // The stored prose carries RESOLVED links, so a scene naming three characters holds three
  // `nodus://` URLs. Counting those inflates every scene, every chapter and the target the
  // author set — the one number nobody would ever think to verify.
  assert.equal(ms.countWords('[Kaelen Vor](nodus://world/character/prs_7) cruzó el vado.'), 5);
  assert.equal(ms.countWords('Kaelen Vor cruzó el vado.'), 5);
});

test('marks, code and images are not words', () => {
  assert.equal(ms.countWords('## Capítulo uno'), 2);
  assert.equal(ms.countWords('*Corrió.* **Cayó.**'), 2);
  assert.equal(ms.countWords('Antes `const x = 1;` después'), 2);
  assert.equal(ms.countWords('Antes\n```\nconst x = 1;\n```\ndespués'), 2);
  assert.equal(ms.countWords('![un mapa del vado](file://x.png)'), 0);
  // A line of asterisks is a scene break, and an em dash is punctuation.
  assert.equal(ms.countWords('* * *'), 0);
  // Five: the dash glued to «y» does not swallow it, and «y» is a word.
  assert.equal(ms.countWords('Dijo —y se fue— nada.'), 5);
  assert.equal(ms.countWords(null), 0);
  assert.equal(ms.countWords('   '), 0);
});

test('a chapter is where a chapter starts, and the run before the first one is not lost', () => {
  const chapters = ms.groupIntoChapters([
    scene('s1', { narrativeOrder: 0, wordCount: 10 }),
    scene('s2', { narrativeOrder: 1, wordCount: 20, chapter: { title: 'El vado', epigraph: null } }),
    scene('s3', { narrativeOrder: 2, wordCount: 5 }),
    scene('s4', { narrativeOrder: 3, wordCount: 7, chapter: { title: 'El juicio', epigraph: 'Nadie vino.' } }),
  ]);
  assert.deepEqual(
    chapters.map((chapter) => [chapter.title, chapter.scenes.map((s) => s.sceneId), chapter.wordCount]),
    [
      // A first draft that has not been divided yet is the normal state, not an error.
      [null, ['s1'], 10],
      ['El vado', ['s2', 's3'], 25],
      ['El juicio', ['s4'], 7],
    ]
  );
  assert.equal(chapters[0].startSceneId, null);
  assert.equal(chapters[1].startSceneId, 's2');
  assert.equal(chapters[2].epigraph, 'Nadie vino.');
});

test('the spine is read in narrative order, whatever order the rows arrive in', () => {
  const chapters = ms.groupIntoChapters([
    scene('s3', { narrativeOrder: 2 }),
    scene('s1', { narrativeOrder: 0, chapter: { title: 'Uno', epigraph: null } }),
    scene('s2', { narrativeOrder: 1 }),
  ]);
  assert.equal(chapters.length, 1);
  assert.deepEqual(chapters[0].scenes.map((s) => s.sceneId), ['s1', 's2', 's3']);
});

test('an untitled break is still a chapter', () => {
  // The BREAK is what makes a chapter; an empty title is an untitled chapter, not the
  // absence of one.
  const chapters = ms.groupIntoChapters([
    scene('s1', { narrativeOrder: 0 }),
    scene('s2', { narrativeOrder: 1, chapter: { title: null, epigraph: null } }),
  ]);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[1].startSceneId, 's2');
});

test('the counts are what the author declared, never what the words suggest', () => {
  const totals = ms.manuscriptTotals(
    ms.groupIntoChapters([
      scene('s1', { narrativeOrder: 0, status: 'written', wordCount: 1200 }),
      scene('s2', { narrativeOrder: 1, status: 'written', wordCount: 0, chapter: { title: 'Dos', epigraph: null } }),
      scene('s3', { narrativeOrder: 2, status: 'outline', wordCount: 0 }),
      scene('s4', { narrativeOrder: 3, status: 'draft', wordCount: 300 }),
    ])
  );
  assert.equal(totals.words, 1500);
  assert.equal(totals.scenes, 4);
  assert.equal(totals.chapters, 1, 'only real breaks are chapters');
  assert.deepEqual(totals.byStatus, { outline: 1, draft: 1, written: 2 });
  // Reported as a fact, never corrected: nothing here recalculates behind the author.
  assert.equal(totals.writtenButEmpty, 1);
});

test('a day of cutting is a day of work', () => {
  const history = [
    { day: '2026-07-26', totalWords: 1000 },
    { day: '2026-07-27', totalWords: 1800 },
  ];
  assert.equal(ms.todayDelta(history, '2026-07-28', 2400), 600);
  // Negative, and shown as such: a counter that only knows how to add turns pruning into a
  // punishment.
  assert.equal(ms.todayDelta(history, '2026-07-28', 1500), -300);
  // Today's own row must not be the baseline, or the number resets to zero on every save.
  assert.equal(
    ms.todayDelta([...history, { day: '2026-07-28', totalWords: 2400 }], '2026-07-28', 2400),
    600
  );
  // The first day is the day everything was written.
  assert.equal(ms.todayDelta([], '2026-07-28', 900), 900);
});

test('a writing day ends when the author goes to bed, not at UTC midnight', () => {
  // Local components, so a session that runs past midnight in a positive-offset timezone
  // is not filed as the day before.
  const at = new Date(2026, 6, 5, 23, 40);
  assert.equal(ms.localDay(at), '2026-07-05');
});

// ── Compilar ─────────────────────────────────────────────────────────────────

function compileScene(over = {}) {
  return { title: 'El vado', status: 'written', text: null, summary: null, ...over };
}

test('un manuscrito que se manda no lleva URL internas', () => {
  // La operación inversa de toRenderableBody, y la que decide si el archivo se puede
  // enviar: el texto guardado lleva el enlace porque eso hace que un cambio de nombre no
  // rompa nada, pero una editorial no puede recibir `nodus://` en mitad de una frase.
  assert.equal(
    ms.stripWorldLinks('Cruzó con [Kaelen Vor](nodus://world/character/prs_7) detrás.'),
    'Cruzó con Kaelen Vor detrás.'
  );
  // Un `[[…]]` sin resolver es una nota del autor, no una llamada al lector.
  assert.equal(ms.stripWorldLinks('Habló de [[la Marca]].'), 'Habló de la Marca.');
  // Un enlace de Markdown corriente no es asunto suyo.
  assert.equal(ms.stripWorldLinks('[docs](https://example.com)'), '[docs](https://example.com)');
  assert.equal(ms.stripWorldLinks(null), '');
});

test('la compilación es capítulos, epígrafes y separadores, en orden', () => {
  const out = ms.compileManuscript(
    [
      { title: null, epigraph: null, scenes: [compileScene({ text: 'Uno.' })] },
      {
        title: 'Segunda parte',
        epigraph: 'Nadie vino.',
        scenes: [compileScene({ text: 'Dos.' }), compileScene({ title: 'El juicio', text: 'Tres.' })],
      },
    ],
    { title: 'La marca de sangre' }
  );
  assert.match(out, /^# La marca de sangre/);
  assert.match(out, /## Segunda parte/);
  assert.match(out, /> Nadie vino\./);
  // El separador va ENTRE escenas de un capítulo, no antes de la primera.
  assert.equal(out.split('* * *').length, 2);
  assert.ok(out.indexOf('Uno.') < out.indexOf('Dos.'));
});

test('un hueco dice que lo es', () => {
  // Un hueco que no se anuncia se lee como el final de un capítulo.
  const out = ms.compileManuscript(
    [{ title: null, epigraph: null, scenes: [compileScene({ status: 'outline', summary: 'Cruza el vado.' })] }],
    { title: 'X', includeOutlines: true }
  );
  assert.match(out, /\[por escribir — El vado: Cruza el vado\.\]/);
});

test('«sólo lo escrito» manda un borrador parcial, no un documento con agujeros', () => {
  const chapters = [
    {
      title: null,
      epigraph: null,
      scenes: [compileScene({ text: 'Escrita.' }), compileScene({ status: 'draft', text: 'En borrador.' })],
    },
  ];
  const all = ms.compileManuscript(chapters, { title: 'X' });
  assert.match(all, /En borrador\./);
  const written = ms.compileManuscript(chapters, { title: 'X', onlyWritten: true });
  assert.doesNotMatch(written, /En borrador\./);
  assert.match(written, /Escrita\./);
});

test('un capítulo entero sin nada que compilar no deja su título suelto', () => {
  const out = ms.compileManuscript(
    [
      { title: 'Vacío', epigraph: null, scenes: [compileScene({ status: 'outline', summary: null })] },
      { title: 'Lleno', epigraph: null, scenes: [compileScene({ text: 'Aquí sí.' })] },
    ],
    { title: 'X', includeOutlines: false }
  );
  assert.doesNotMatch(out, /## Vacío/);
  assert.match(out, /## Lleno/);
});

// ── El estante: varios libros en un mundo ────────────────────────────────────

test('un libro es DÓNDE empieza un libro, igual que un capítulo', () => {
  // Una tabla de manuscritos con su propio orden más una pertenencia por escena serían un
  // segundo eje de ordenación junto al del relato, y los dos discreparían el primer día que
  // alguien moviera una escena.
  const books = ms.groupIntoBooks([
    scene('s1', { narrativeOrder: 0, wordCount: 10 }),
    scene('s2', { narrativeOrder: 1, wordCount: 20, chapter: { title: 'Uno', epigraph: null } }),
    scene('s3', {
      narrativeOrder: 2,
      wordCount: 5,
      book: { title: 'Libro segundo', subtitle: 'El juicio', targetWords: 90000 },
    }),
    scene('s4', { narrativeOrder: 3, wordCount: 7 }),
  ]);
  assert.deepEqual(
    books.map((book) => [book.title, book.scenes, book.wordCount]),
    [
      // Lo que va antes de la primera marca es el libro sin marcar: un manuscrito único no
      // tiene que anunciarse para existir.
      [null, 2, 30],
      ['Libro segundo', 2, 12],
    ]
  );
  assert.equal(books[1].targetWords, 90000);
  // Y cada libro conserva sus capítulos.
  assert.deepEqual(books[0].chapters.map((chapter) => chapter.title), [null, 'Uno']);
  assert.equal(books[1].chapters.length, 1);
});

test('el estante se lee en orden de relato, llegue como llegue', () => {
  const books = ms.groupIntoBooks([
    scene('s3', { narrativeOrder: 2, book: { title: 'Dos', subtitle: null, targetWords: null } }),
    scene('s1', { narrativeOrder: 0 }),
    scene('s2', { narrativeOrder: 1 }),
  ]);
  assert.deepEqual(books.map((book) => book.title), [null, 'Dos']);
  assert.deepEqual(books[0].chapters[0].scenes.map((s) => s.sceneId), ['s1', 's2']);
});

// ── Leer la escena contra lo que dijiste que pasaría ─────────────────────────

const review = load('shared/worldProseReview.ts');

test('sin latidos declarados o sin prosa no hay nada que leer', () => {
  const beats = [{ threadLabel: 'conflicto: El vado', mark: 'sube la presión', text: null }];
  assert.equal(review.hasProseReviewMaterial({ sceneTitle: 'X', beats, prose: 'Algo escrito.' }), true);
  assert.equal(review.hasProseReviewMaterial({ sceneTitle: 'X', beats: [], prose: 'Algo escrito.' }), false);
  assert.equal(review.hasProseReviewMaterial({ sceneTitle: 'X', beats, prose: '   ' }), false);
});

test('el prompt prohíbe opinar sobre la prosa', () => {
  // Si contestara «tu diálogo es plano» estaría opinando sobre una novela que no es suya.
  assert.match(review.WORLD_PROSE_REVIEW_SYSTEM, /NO opinas sobre la prosa/);
  assert.match(review.WORLD_PROSE_REVIEW_SYSTEM, /no la reescribes/);
  // «Está» significa que un lector se enteraría leyendo SOLO este texto.
  assert.match(review.WORLD_PROSE_REVIEW_SYSTEM, /leyendo SOLO este texto/);
});

test('la lectura vuelve en orden, y una línea sin sí/no se descarta entera', () => {
  const verdicts = review.parseProseReview(
    [
      'Vamos allá:',
      '1. **LATIDO:** sí — el juramento se rompe en la página 2.',
      'LATIDO: no — de la deuda no se dice nada.',
      'LATIDO: quizá, depende de cómo lo leas.',
      'LATIDO 4 — Sí: se insinúa cuando cierra la puerta.',
      'Un saludo.',
    ].join('\n')
  );
  assert.deepEqual(verdicts, [
    { present: true, note: 'el juramento se rompe en la página 2.' },
    { present: false, note: 'de la deuda no se dice nada.' },
    { present: true, note: 'se insinúa cuando cierra la puerta.' },
  ]);
});

test('nunca rellena: un latido sin respuesta se queda sin leer', () => {
  // Decirle al autor que algo está en la página cuando nadie lo ha comprobado es
  // exactamente el error que esta comprobación existe para no cometer.
  assert.deepEqual(review.parseProseReview('No he entendido la pregunta.'), []);
  assert.deepEqual(review.parseProseReview(''), []);
  const one = review.parseProseReview('LATIDO: sí');
  assert.deepEqual(one, [{ present: true, note: null }]);
});
