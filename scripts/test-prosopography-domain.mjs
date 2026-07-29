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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-prosop-domain-'));
const bundle = path.join(outDir, 'prosopography.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'shared/prosopographyDomain.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=es2022',
  `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'inherit' });
const p = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

const stamp = '2026-07-29T10:00:00.000Z';
const date = { display: '1637', startSort: 1637, endSort: 1637, precision: 'year' };
const source = {
  sourceId: 'src1', title: 'Carta', sourceKind: 'letter', citation: 'Carta, 1637',
  repository: 'AHN', referenceCode: '1', date, description: '', coverageNotes: '',
  reliabilityNotes: '', accessStatus: 'open', rightsNotes: '', targetVaultId: null,
  targetKind: null, targetId: null, targetLabelSnapshot: null, url: null, createdAt: stamp, updatedAt: stamp,
};
const segment = {
  segmentId: 'seg1', sourceId: 'src1', locatorDisplay: 'f. 2r', locator: {},
  quotedText: 'María asistió a la academia.', transcriptionStatus: 'literal',
  language: 'es', createdAt: stamp, updatedAt: stamp,
};
const factoid = {
  factoidId: 'fac1', sourceId: 'src1', sourceSegmentId: 'seg1', captureRowId: null,
  factoidKind: 'participation', summary: 'Asistencia', status: 'reviewed',
  extractionCertainty: 'high', createdBy: 'human', createdAt: stamp, reviewedBy: 'human',
  reviewedAt: stamp, updatedAt: stamp,
};
const statement = {
  statementId: 'sta1', factoidId: 'fac1', variableId: 'occupation',
  variableRevisionId: 'rev1', statementType: 'occupation', literalValue: 'poeta',
  value: { kind: 'term', termId: 'poet', literal: 'poeta' }, negated: false,
  sourceModality: 'asserted', readingCertainty: 'high', sourceAssertionCertainty: 'medium',
  interpretationCertainty: 'high', temporalPrecision: 'year', accuracyStatus: 'unassessed',
  status: 'reviewed', createdAt: stamp, updatedAt: stamp,
};

test('reviewed evidence requires source → segment → factoid → statement', () => {
  assert.deepEqual(p.validateFactoid(factoid, source, segment), []);
  assert.deepEqual(p.validateStatement(statement, factoid), []);
  assert.ok(p.validateFactoid(factoid).length > 0);
  assert.ok(p.validateStatement(statement).length > 0);
});

test('literal survives normalization and typed values reject invalid shapes', () => {
  assert.deepEqual(p.validateTypedValue({ kind: 'number', number: Number.NaN, unit: null }), ['El valor numérico debe ser finito.']);
  const erased = { ...statement, literalValue: '', value: { kind: 'term', termId: 'poet', literal: '' } };
  assert.match(p.validateStatement(erased, factoid).join(' '), /literal/);
});

test('published versions and frozen cohorts are immutable', () => {
  assert.throws(() => p.assertPublishedVersionImmutable('published'), /inmutable/);
  assert.throws(() => p.validateCohortMutation({ kind: 'frozen', frozenAt: stamp }), /inmutable/);
});

test('projection preserves contradictions, missingness, provenance and fingerprint', () => {
  const definition = {
    grain: 'person', personIds: ['p1', 'p2'], variableIds: ['occupation'],
    questionnaireVersionId: 'q1', methodologyVersionId: 'm1', sourceIds: ['src1'],
    sourceCutoff: null, resolutionPolicy: 'reviewed_statements',
    variablePolicies: { occupation: { multivalue: 'all', missing: 'include_reason' } },
  };
  const input = {
    definition,
    statements: [statement, { ...statement, statementId: 'sta2', literalValue: 'dramaturga', value: { kind: 'term', termId: 'playwright', literal: 'dramaturga' } }],
    entities: [
      { id: 'e1', statementId: 'sta1', entityKind: 'person', entityId: 'p1', role: 'subject', position: 0 },
      { id: 'e2', statementId: 'sta2', entityKind: 'person', entityId: 'p1', role: 'subject', position: 0 },
    ],
    resolutions: [],
    missingValues: [{ missingId: 'miss1', personId: 'p2', variableId: 'occupation', questionnaireVersionId: 'q1', reason: 'source_silent', sourceScope: {}, note: '', status: 'active', createdAt: stamp, updatedAt: stamp }],
    factoidSourceIds: { fac1: 'src1' },
    now: stamp,
  };
  const left = p.buildProsopProjection(input);
  const right = p.buildProsopProjection(input);
  assert.equal(left.fingerprint, right.fingerprint);
  assert.equal(left.rows[0].cells.occupation.values.length, 2);
  assert.equal(left.rows[1].cells.occupation.missingReason, 'source_silent');
  assert.deepEqual(left.rows[0].cells.occupation.statementIds, ['sta1', 'sta2']);
});

test('frequencies declare population, known denominator and underlying cases', () => {
  const projection = {
    populationCount: 2,
    rows: [
      { personId: 'p1', cells: { occupation: { values: [{ kind: 'term', termId: 'poet', literal: 'poeta' }], missingReason: null } } },
      { personId: 'p2', cells: { occupation: { values: [], missingReason: 'source_silent' } } },
    ],
  };
  const result = p.prosopFrequencies(projection, 'occupation');
  assert.equal(result.populationN, 2);
  assert.equal(result.knownN, 1);
  assert.equal(result.missingN, 1);
  assert.deepEqual(result.items[0].personIds, ['p1']);
});

test('network origins stay separate and derived edges require fingerprints', () => {
  const edge = {
    edgeId: 'edge1', layerId: 'layer1', sourcePersonId: 'p1', targetPersonId: 'p2',
    relationTermId: null, date, weight: 1, origin: 'derived', derivationFingerprint: null,
    status: 'active', factoidIds: [], createdAt: stamp, updatedAt: stamp,
  };
  const issues = p.auditProsopInvariants({ edges: [edge] });
  assert.ok(issues.some((item) => item.code === 'untraceable_derived_edge'));
  const metrics = p.prosopNetworkMetrics(['p1', 'p2', 'p3'], [{ ...edge, derivationFingerprint: 'rule-1' }]);
  assert.equal(metrics.edgeCount, 1);
  assert.equal(metrics.components.length, 2);
  assert.equal(metrics.byOrigin.derived, 1);
});

test('IPIF draft keeps person, source, factoid and statement separate', () => {
  const ipif = p.toProsopIpif({
    generatedAt: stamp,
    people: [{ personId: 'p1', names: ['María'] }],
    sources: [source],
    segments: [segment],
    factoids: [factoid],
    statements: [statement],
    entities: [{ id: 'e1', statementId: 'sta1', entityKind: 'person', entityId: 'p1', role: 'subject', position: 0 }],
  });
  assert.equal(ipif.persons.length, 1);
  assert.equal(ipif.sources.length, 1);
  assert.equal(ipif.factoids[0].source, 'src1');
  assert.equal(ipif.statements[0].factoid, 'fac1');
  assert.deepEqual(ipif.statements[0].subjects, ['p1']);
});
