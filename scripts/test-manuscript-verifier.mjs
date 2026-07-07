import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-manuscript-verifier-test-'));

try {
  const outfile = path.join(tmp, 'manuscriptVerifier.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/manuscriptVerifier.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const {
    classifyClaimLocally,
    detectCitations,
    extractManuscriptClaims,
    looksLikeAuthorContribution,
    scoreLexicalMatch,
    summarizeChecks,
  } = await import(pathToFileURL(outfile).href);

  assert.deepEqual(detectCitations('Rivera (2020) muestra la relacion.'), ['Rivera (2020)']);
  assert.deepEqual(detectCitations('La relacion esta documentada (Rivera, 2020: 34).'), ['(Rivera, 2020: 34)']);
  assert.equal(looksLikeAuthorContribution('En esta tesis sostengo que el archivo opera como infraestructura.'), true);

  const claims = extractManuscriptClaims(`
# Capitulo

El turismo patrimonial organiza la memoria publica mediante rutas, relatos urbanos y practicas de seleccion institucional.

En esta tesis sostengo que el archivo municipal funciona como infraestructura de lectura propia para ordenar el caso.

Rivera (2020) muestra que las rutas patrimoniales median la memoria publica en contextos urbanos.
`);

  assert.equal(claims.length, 3);
  assert.equal(claims[0].hasCitation, false);
  assert.equal(claims[1].ownContribution, true);
  assert.equal(claims[2].hasCitation, true);
  assert.equal(scoreLexicalMatch(claims[0].excerpt, 'Las rutas de turismo patrimonial organizan la memoria publica urbana.') > 0.25, true);

  const strongEvidence = [{
    kind: 'idea',
    refId: 'g-1',
    label: 'Turismo patrimonial y memoria',
    citation: 'nodus://idea/g-1',
    snippet: 'Las rutas de turismo patrimonial organizan la memoria publica urbana.',
    score: 0.46,
  }];
  const missing = classifyClaimLocally({ claim: claims[0], evidence: strongEvidence, language: 'es' });
  assert.equal(missing.status, 'missing_citation');
  assert.equal(missing.replacementHint, '[Turismo patrimonial y memoria](nodus://idea/g-1)');

  const own = classifyClaimLocally({ claim: claims[1], evidence: strongEvidence, language: 'es' });
  assert.equal(own.status, 'own_argument');

  const covered = classifyClaimLocally({ claim: claims[2], evidence: [], language: 'en' });
  assert.equal(covered.status, 'covered');

  const summary = summarizeChecks([missing, own, covered], claims.length);
  assert.equal(summary.missingCitations, 1);
  assert.equal(summary.ownArguments, 1);
  assert.equal(summary.covered, 1);
  assert.equal(summary.citedClaims, 1);

  console.log('manuscript verifier extraction test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
