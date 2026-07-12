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

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-gedcom-'));
const bundle = path.join(outDir, 'gedcom.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/gedcom.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const ged = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

const SAMPLE = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Juan /Pérez/
1 SEX M
1 BIRT
2 DATE ABT 1850
2 PLAC Sevilla
1 DEAT
2 DATE 1910
0 @I2@ INDI
1 NAME María /Ruiz/
1 SEX F
0 @I3@ INDI
1 NAME Pedro /Pérez/
1 SEX M
1 BIRT
2 DATE 2 MAR 1875
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 1873
2 PLAC Sevilla
0 TRLR
`;

test('parse extracts persons and families', () => {
  const data = ged.parseGedcom(SAMPLE);
  assert.equal(data.persons.length, 3);
  assert.equal(data.families.length, 1);
  const juan = data.persons.find((p) => p.xref === '@I1@');
  assert.equal(juan.given, 'Juan');
  assert.equal(juan.surname, 'Pérez');
  assert.equal(juan.sex, 'M');
  assert.equal(juan.birthDate, 'c. 1850', 'ABT date normalised on import');
  assert.equal(juan.birthPlace, 'Sevilla');
  assert.equal(juan.deathDate, '1910');
  const pedro = data.persons.find((p) => p.xref === '@I3@');
  assert.equal(pedro.birthDate, '2 mar 1875');
  const fam = data.families[0];
  assert.equal(fam.husband, '@I1@');
  assert.equal(fam.wife, '@I2@');
  assert.deepEqual(fam.children, ['@I3@']);
  assert.equal(fam.marriageDate, '1873');
});

test('date conversion round-trips through GEDCOM keywords', () => {
  assert.equal(ged.toGedcomDate('c. 1850'), 'ABT 1850');
  assert.equal(ged.toGedcomDate('antes de 1880'), 'BEF 1880');
  assert.equal(ged.toGedcomDate('después de 1850'), 'AFT 1850');
  assert.equal(ged.toGedcomDate('2 mar 1875'), '2 MAR 1875');
  assert.equal(ged.toGedcomDate('entre 1850 y 1855'), 'BET 1850 AND 1855');
  assert.equal(ged.fromGedcomDate('ABT 1850'), 'c. 1850');
  assert.equal(ged.fromGedcomDate('BET 1850 AND 1855'), 'entre 1850 y 1855');
});

test('serialize → parse is a faithful round trip', () => {
  const data = ged.parseGedcom(SAMPLE);
  const text = ged.serializeGedcom(data);
  const again = ged.parseGedcom(text);
  assert.equal(again.persons.length, data.persons.length);
  assert.equal(again.families.length, data.families.length);
  const juanA = data.persons.find((p) => p.xref === '@I1@');
  const juanB = again.persons.find((p) => p.xref === '@I1@');
  assert.deepEqual(
    { n: juanB.name, s: juanB.sex, b: juanB.birthDate, bp: juanB.birthPlace, d: juanB.deathDate },
    { n: juanA.name, s: juanA.sex, b: juanA.birthDate, bp: juanA.birthPlace, d: juanA.deathDate }
  );
  assert.deepEqual(again.families[0].children, ['@I3@']);
  assert.equal(again.families[0].marriageDate, '1873');
});

test('serialized output has HEAD/TRLR and lineage-linked header', () => {
  const text = ged.serializeGedcom({ persons: [], families: [] });
  assert.match(text, /^0 HEAD/);
  assert.match(text, /2 VERS 5\.5\.1/);
  assert.match(text, /0 TRLR\n$/);
});
