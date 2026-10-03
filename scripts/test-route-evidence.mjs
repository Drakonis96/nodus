import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-route-evidence-'));
const outfile = path.join(tmp, 'routeEvidence.mjs');
await build({ entryPoints: [path.join(root, 'shared/routeEvidence.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const evidence = await import(pathToFileURL(outfile).href);
test.after(() => rm(tmp, { recursive: true, force: true }));

const label = (role, name, smiles, byproduct = false) => ({ role, name, smiles, byproduct });

test('a step reads as its named reactants and main products, without byproducts', () => {
  const step = [label('reactant', 'toluene', 'Cc1ccccc1'), label('reactant', 'nitric acid', 'O=[N+]([O-])O'),
    label('product', '4-nitrotoluene', 'Cc1ccc(cc1)[N+](=O)[O-]'), label('product', 'water', 'O', true)];
  assert.equal(evidence.stepReaction(step), 'toluene + nitric acid → 4-nitrotoluene');
});

test('ORD entries map to their route steps, with the closest neighbour only for unrecorded steps', () => {
  const precedent = {
    reactions: [{ input: 'a>>b', count: 5, classes: ['nitration'] }, { input: 'b>>c', count: 0 }],
    products: [],
    similar: [{ input: 'b>>c', neighbors: [{ key: 'k', distance: 1, count: 2, similarity: 0.62 }, { key: 'j', distance: 2, count: 1, similarity: 0.4 }] }],
  };
  const byStep = evidence.ordByStep(precedent, [0, 2]);
  assert.deepEqual(byStep.get(0), { recorded: 5, classes: ['nitration'] });
  assert.deepEqual(byStep.get(2), { recorded: 0, classes: [], closest: 0.62 });
  assert.equal(byStep.has(1), false);
});

test('the brief lists each step\'s evidence and is empty when nothing was found', () => {
  assert.equal(evidence.formatEvidenceBrief([{ step: 0, reaction: 'a → b' }]), '');
  const brief = evidence.formatEvidenceBrief([
    { step: 0, reaction: 'a → b', ord: { recorded: 3, classes: ['esterification'] } },
    { step: 1, reaction: 'b → c', ord: { recorded: 0, classes: [], closest: 0.55 },
      textbook: { title: 'Organic Chemistry', location: 'p. 812', about: 'reduction', excerpt: 'Tin and HCl reduce nitro groups.' },
      web: [{ title: 'Benzocaine', url: 'https://example.org/b', snippet: 'Fischer esterification of PABA' }] },
  ]);
  assert.match(brief, /^Step 1: a → b\n- Open Reaction Database: recorded 3 time\(s\); classes: esterification/);
  assert.match(brief, /Step 2: b → c\n- Open Reaction Database: not recorded; closest recorded reaction 55% similar/);
  assert.match(brief, /- Textbook \(Organic Chemistry, p\. 812\) on reduction: "Tin and HCl reduce nitro groups\."/);
  assert.match(brief, /- Web: Benzocaine \(https:\/\/example\.org\/b\): Fischer esterification of PABA/);
});

test('the revision message carries the request, the rule, the draft and the evidence in order', () => {
  const message = evidence.revisionUserMessage('{"question":"make X"}', 'DRAFT', 'BRIEF');
  const at = (text) => message.indexOf(text);
  assert.ok(at('make X') < at('ROUTE EVIDENCE REVIEW') && at('ROUTE EVIDENCE REVIEW') < at('DRAFT') && at('DRAFT') < at('BRIEF'));
});
