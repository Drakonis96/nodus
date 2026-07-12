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

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-bio-'));
const bundle = path.join(outDir, 'biographyContext.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/biographyContext.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const bio = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

const base = {
  name: 'Juan Pérez',
  sex: 'male',
  birthDate: 'c. 1850',
  deathDate: '1910',
  parents: ['Pedro Pérez', 'Ana Ruiz'],
  spouses: ['María López'],
  children: ['Luis Pérez'],
  siblings: [],
  events: [{ type: 'marriage', date: '1875', place: 'Sevilla' }],
  documents: [{ title: 'Partida de matrimonio', docType: 'marriage_record', text: 'contrajeron matrimonio en 1875' }],
  evidence: [{ quote: 'Juan Pérez, jornalero', location: 'p. 12' }],
};

test('context includes person, kin, events, documents and quotes', () => {
  const ctx = bio.composeBiographyContext(base);
  assert.match(ctx, /Juan Pérez/);
  assert.match(ctx, /Nacimiento: c\. 1850/);
  assert.match(ctx, /Padres: Pedro Pérez, Ana Ruiz/);
  assert.match(ctx, /Cónyuges: María López/);
  assert.match(ctx, /matrimonio, 1875, en Sevilla/);
  assert.match(ctx, /Partida de matrimonio \[marriage_record\]/);
  assert.match(ctx, /"Juan Pérez, jornalero" \(p\. 12\)/);
});

test('the system prompt forbids invention and bounds length', () => {
  assert.match(bio.BIOGRAPHY_SYSTEM, /No inventes/);
  assert.match(bio.BIOGRAPHY_SYSTEM, /120 a 220 palabras/);
});

test('hasBiographyEvidence gates empty persons', () => {
  assert.equal(bio.hasBiographyEvidence(base), true);
  const empty = { ...base, birthDate: null, deathDate: null, parents: [], spouses: [], children: [], siblings: [], events: [], documents: [], evidence: [] };
  assert.equal(bio.hasBiographyEvidence(empty), false);
  // A single linked document is enough.
  assert.equal(bio.hasBiographyEvidence({ ...empty, documents: [{ title: 'x', docType: null, text: 'y' }] }), true);
});

test('empty fields are omitted, not printed as blanks', () => {
  const sparse = {
    name: 'Anónimo',
    sex: 'unknown',
    birthDate: null,
    deathDate: null,
    parents: [],
    spouses: [],
    children: [],
    siblings: [],
    events: [],
    documents: [],
    evidence: [{ quote: 'consta en el padrón', location: null }],
  };
  const ctx = bio.composeBiographyContext(sparse);
  assert.doesNotMatch(ctx, /Nacimiento/);
  assert.doesNotMatch(ctx, /Padres/);
  assert.match(ctx, /"consta en el padrón"/);
});
