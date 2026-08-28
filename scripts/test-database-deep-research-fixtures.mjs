import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const out = path.join(os.tmpdir(), `nodus-dbr-fixtures-${process.pid}.cjs`);
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [path.join(root, 'shared/databaseDeepResearchFixtures.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`]);
const fixtures = require(out);

test('250k and 500k adversarial fixtures remain bounded and deterministic', () => {
  for (const size of [250_000, 500_000]) {
    const fixture = fixtures.generateAdversarialScaleFixture(size, 90210);
    assert.equal(fixture.rowCount, size);
    assert.equal(fixture.outcome.length, size);
    assert.ok(fixture.observed.some(Number.isNaN), 'fixture contains missing values');
    assert.equal(fixture.outcome[fixture.influentialRow], 1e12, 'fixture contains one influential outlier');
    const repeat = fixtures.generateAdversarialScaleFixture(size, 90210);
    for (const index of [0, 17, fixture.expectedChangeIndex, fixture.influentialRow]) assert.equal(repeat.outcome[index], fixture.outcome[index]);
  }
});

test('fixture contains a genuine Simpson reversal and MAR/MNAR labels', () => {
  const fixture = fixtures.generateAdversarialScaleFixture(20_000, 7);
  const means = fixtures.fixtureSimpsonMeans(fixture);
  assert.ok(means.aggregate[1] < means.aggregate[0], 'aggregate treatment association is negative');
  assert.ok(means.byRegion.every(([untreated, treated]) => treated > untreated), 'within every region treatment association is positive');
  assert.ok(fixture.missingKind.includes(1) && fixture.missingKind.includes(2));
});

test('null family produces no BH false discovery', () => {
  assert.equal(fixtures.nullFamilyBhDiscoveries(10_000, 0.05), 0);
});

test('relational and all-cell fixtures carry their adversarial oracles', () => {
  const relations = fixtures.generateRelationalTrapFixture();
  assert.deepEqual(relations.expected, { duplicateEdges: 1, orphanOrders: 1, orphanProducts: 1, nonReconcilingRollups: 1 });
  const lab = fixtures.generateResearchLabCellFixture();
  assert.equal(lab.length, 29, 'fixture covers every cell type currently declared by Nodus');
  assert.equal(new Set(lab.map((cell) => cell.type)).size, 29);
  assert.equal(lab.find((cell) => cell.type === 'button').analyzable, false);
  assert.match(String(lab.find((cell) => cell.type === 'rich_text').value), /IGNORE PREVIOUS/);
});

test.after(() => { try { fs.unlinkSync(out); } catch {} });
