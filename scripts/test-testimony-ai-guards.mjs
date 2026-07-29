// Lo que Nodus le comprueba a la IA antes de dejarla tocar un testimonio.
//
// Estas dos funciones son la diferencia entre «la IA propone» y «la IA decide». Si
// `locateQuote` aceptara una cita recompuesta, un fragmento fijado citaría al narrador
// diciendo algo que no dijo, con su minuto y todo. Si `verifyRewrite` aceptara una
// reescritura, la versión corregida sería una versión INVENTADA con aspecto de corregida.
//
// Por eso las pruebas van al caso hostil, no al fácil.

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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-ai-guards-'));
const bundle = path.join(outDir, 'guards.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/testimonyAiGuards.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
);
const { locateQuote, verifyRewrite, comparable } = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

const SEGMENTS = [
  { id: 's0', tStart: 0, text: 'En el cincuenta y dos había cuarenta y un niños en la escuela.' },
  { id: 's1', tStart: 12, text: 'Los que se marchaban no volvían. Primero el padre, y al año siguiente la familia entera.' },
  { id: 's2', tStart: 24, text: 'No. Eso no se hablaba. Se sabía, pero no se decía.' },
];

test('una cita literal se ancla a su tramo y trae su minuto', () => {
  const match = locateQuote('Se sabía, pero no se decía', SEGMENTS);
  assert.equal(match.segmentId, 's2');
  assert.equal(match.tStart, 24);
  assert.equal(match.coverage, 1);
});

test('la puntuación y las mayúsculas no impiden reconocer la cita', () => {
  const match = locateQuote('se sabia pero no se decia', SEGMENTS);
  assert.equal(match.segmentId, 's2');
});

test('una cita RECOMPUESTA de dos frases lejanas se rechaza', () => {
  // Las dos mitades existen, pero el narrador nunca dijo esa frase seguida.
  const match = locateQuote('había cuarenta y un niños pero no se decía', SEGMENTS);
  assert.equal(match.segmentId, null, 'anclarla sería inventar una frase con su minuto');
  assert.ok(match.coverage > 0.5, 'y aun así se informa de que se parecía mucho');
});

test('una cita que cruza el corte de dos tramos consecutivos sí vale', () => {
  // El corte lo puso el transcriptor, no el narrador.
  const match = locateQuote('en la escuela. Los que se marchaban no volvían', SEGMENTS);
  assert.equal(match.segmentId, 's0');
  assert.equal(match.tStart, 0);
});

test('una cita inventada entera se rechaza y su parecido es bajo', () => {
  const match = locateQuote('La emigración destruyó el tejido social del valle', SEGMENTS);
  assert.equal(match.segmentId, null);
  assert.ok(match.coverage < 0.4, `parecido ${match.coverage}`);
});

test('una cita vacía no se ancla a ningún sitio', () => {
  assert.equal(locateQuote('   ', SEGMENTS).segmentId, null);
});

test('puntuar y poner mayúsculas SÍ es corregir', () => {
  const verdict = verifyRewrite(
    'en el cincuenta y dos había cuarenta y un niños en la escuela',
    'En el cincuenta y dos había cuarenta y un niños en la escuela.',
  );
  assert.equal(verdict.accepted, true);
  assert.deepEqual(verdict.removed, []);
  assert.deepEqual(verdict.added, []);
});

test('resumir NO es corregir', () => {
  const verdict = verifyRewrite(
    'Los que se marchaban no volvían. Primero el padre, y al año siguiente la familia entera.',
    'Los que emigraban no regresaban.',
  );
  assert.equal(verdict.accepted, false);
  assert.ok(verdict.removed.length > 3, `sólo detectó ${verdict.removed.length} palabras perdidas`);
});

test('quitar una muletilla NO es corregir: es editar el testimonio', () => {
  const verdict = verifyRewrite(
    'pues yo qué sé, yo qué sé, aquello fue muy duro para todos nosotros de verdad',
    'Aquello fue muy duro para todos nosotros.',
  );
  assert.equal(verdict.accepted, false);
});

test('añadir una palabra que nadie dijo NO se acepta', () => {
  const verdict = verifyRewrite(
    'mi padre se marchó en el cuarenta y siete',
    'Mi padre se marchó, llorando, en el cuarenta y siete.',
  );
  assert.equal(verdict.accepted, false);
  assert.deepEqual(verdict.added, ['llorando']);
});

test('una falta de ortografía sí se puede arreglar', () => {
  const verdict = verifyRewrite(
    'se sabia pero no se decia se hablaba muy poco de aquello en el pueblo entero durante años',
    'Se sabía, pero no se decía. Se hablaba muy poco de aquello en el pueblo entero durante años.',
  );
  assert.equal(verdict.accepted, true, 'las tildes no cambian lo que se dijo');
});

test('un tramo vacío nunca sustituye a uno con texto', () => {
  assert.equal(verifyRewrite('mi padre se marchó', '').accepted, false);
});

test('la normalización no se come los números, que en un testimonio son fechas', () => {
  assert.equal(comparable('En 1947, con 16 años.'), 'en 1947 con 16 anos');
});
