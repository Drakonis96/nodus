import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'passage-quality-'));
await build({ entryPoints: ['shared/passageQuality.ts'], outfile: path.join(dir, 'q.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { passageKind, stripSchemeRuns, evidenceText } = await import(pathToFileURL(path.join(dir, 'q.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

// Real passages from Carey & Sundberg Part B (a digital PDF) and McMurry.
const SCHEME = 'O O BN H CH2Br OH NO 2 PhCH2 O 7 g 5 mol% 0.7 eq BH3 -S(CH3)2 84%, 94% e.e. on 100 g scale H N B O H Ph Ph S O S O O S OH S O O 4 d BH3, S(CH3)2 98% e.e. CH3 O OTBDMS S N CH3 CH 3 OH OTBDMS S N CH3 11 k 0.5 equiv 1.5 eq BH 3 -S(CH3)2 98% 95% e.e.';
const REFERENCES = '102, 1201 (1980); J. S. Sawyer, A. Kucerovy, T. L. Macdonald, and G. J. McGarvey, J. Am. Chem. Soc., 110, 842 (1988). d. M. P. Doyle, A. B. Dyatkin, G. H. P. Roos, F. Canas, D. A. Pierson, A. van Basten, P. Mueller, and P. Polleux, J. Am. Chem. Soc., 116, 4507 (1994). e. M. A. McKervey and T. Ye, J. Chem. Soc., Chem. Commun., 823 (1992). f. T. Clayton, Jr., J. Am. Chem. Soc., 113, 8982 (1991).';
const MIXED = '135\u0005 D. F. Taber, R. E. Ruckle, and M. J. Hennessy, J. Org. Chem., 57, 4077 (1986); L. Lombardo and L. N. Mander, Synthesis, 368 (1980). 635 SECTION 7.2 Reactions of Organomagnesium and Organolithium Compounds HMPA can accelerate the reaction and improve yields when electron transfer is a complication. 77 80% n -C7H15I HMPAN CH Li NC(CH3) 3 N (CH 2)6CH 3 CH NC(CH3)3 Organolithium reagents in which the carbanion is delocalized are more useful than alkyllithium reagents in alkylation reactions, and allyllithium and benzyllithium reagents are the most common examples of this behaviour in practice.';
const PROSE = 'The malonic ester synthesis converts an alkyl halide into a carboxylic acid having two more carbons. Diethyl propanedioate is deprotonated by sodium ethoxide, the enolate is alkylated in an SN2 reaction, and the diester is hydrolysed and decarboxylated on heating, using PBr 3 where a bromide is needed.';

test('a flattened reaction scheme, a reference list and prose are told apart', () => {
  assert.equal(passageKind(SCHEME), 'scheme');
  assert.equal(passageKind(REFERENCES), 'references');
  assert.equal(passageKind(PROSE), 'prose');
});

test('evidence text drops scheme and reference pages and keeps the prose of a mixed one', () => {
  assert.equal(evidenceText(SCHEME), null);
  assert.equal(evidenceText(REFERENCES), null);
  const mixed = evidenceText(MIXED);
  assert.ok(mixed, 'the mixed passage keeps its prose');
  assert.doesNotMatch(mixed, /Taber|Hennessy|Synthesis, 368|\u0005|SECTION 7\.2/, 'citations, control characters and the running head are cut');
  assert.match(mixed, /HMPA can accelerate the reaction and improve yields when electron transfer is a complication\. \[scheme\]/);
  assert.match(mixed, /Organolithium reagents in which the carbanion is delocalized/);
});

test('a formula inside a sentence is not a scheme', () => {
  assert.equal(stripSchemeRuns(PROSE), PROSE, '"using PBr 3" stays');
  assert.equal(evidenceText(PROSE), PROSE);
});
