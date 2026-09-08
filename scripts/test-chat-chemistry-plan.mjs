import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chemistry-plan-test-'));
const bundle = path.join(temporary, 'test.cjs');
await build({
  stdin: { contents: `export * from './electron/ai/chatChemistryPlan';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'chemistry-plan-test', setup(api) {
    api.onResolve({ filter: /^\.\/aiClient$/ }, () => ({ path: 'ai-client', namespace: 'mock' }));
    api.onResolve({ filter: /^\.\.\/chemistry$/ }, () => ({ path: 'chemistry', namespace: 'mock' }));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({ contents: name === 'ai-client'
      ? `export const completeText = (...args) => globalThis.__planCompleteText(...args);`
      : `export const compileChemfig = (...args) => globalThis.__planCompileChemfig(...args);`, loader: 'js' }));
    api.onResolve({ filter: /^@shared\// }, ({ path: specifier }) => ({ path: path.join(root, 'shared', `${specifier.slice(8)}.ts`) }));
  } }],
});
const lib = require(bundle);
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }));

const mechanism = {
  version: 1,
  kind: 'mechanism',
  title: 'SN2 inversion',
  species: [
    { id: 'hydroxide', label: 'hydroxide', formula: 'HO-', role: 'reagent', smiles: '[OH-]', connectivity: 'O-H, charge -1 on O', stereochemistry: 'none' },
    { id: 'bromobutane', label: '(R)-2-bromobutane', formula: 'C4H9Br', role: 'reactant', smiles: 'CC[C@@H](C)Br', connectivity: 'CH3-CH(Br)-CH2-CH3', stereochemistry: 'C2 is R; backside attack' },
    { id: 'butanol', label: '(S)-2-butanol', formula: 'C4H10O', role: 'product', smiles: 'CC[C@H](C)O', connectivity: 'CH3-CH(OH)-CH2-CH3', stereochemistry: 'C2 is S after inversion' },
    { id: 'bromide', label: 'bromide', formula: 'Br-', role: 'product', smiles: '[Br-]', connectivity: 'monatomic bromide', stereochemistry: 'none' },
  ],
  stages: [['hydroxide', 'bromobutane'], ['butanol', 'bromide']],
  arrows: [{ fromStage: 0, toStage: 1, type: 'reaction', label: 'SN2' }],
  electronFlow: [
    { stage: 0, from: 'oxygen lone pair', to: 'C2 electrophilic carbon', meaning: 'form C-O bond' },
    { stage: 0, from: 'C2-Br sigma bond', to: 'bromine', meaning: 'break C-Br bond' },
  ],
};

test('chemistry plans validate a strict semantic graph before typesetting', () => {
  assert.deepEqual(lib.parseChemistryPlan(JSON.stringify(mechanism)), mechanism);
  assert.throws(() => lib.parseChemistryPlan('{'), /valid JSON/);
  assert.throws(() => lib.parseChemistryPlan(JSON.stringify({ ...mechanism, stages: [['missing']] })), /unknown species/);
  assert.throws(() => lib.parseChemistryPlan(JSON.stringify({ ...mechanism, electronFlow: [] })), /must specify electron flow/);
  assert.throws(() => lib.parseChemistryPlan(JSON.stringify({ ...mechanism, arrows: [] })), /exactly one arrow/);
  assert.throws(() => lib.parseChemistryPlan(JSON.stringify({ ...mechanism, kind: 'resonance' })), /Only a mechanism/);
  const wrongStereo = structuredClone(mechanism);
  wrongStereo.species[1].smiles = 'CC[C@H](C)Br';
  assert.throws(() => lib.parseChemistryPlan(JSON.stringify(wrongStereo)), /SMILES encodes S/);
});

test('validated SMILES species become deterministic Chemfig graphs without a model typesetting pass', async () => {
  const comparison = {
    version: 1, kind: 'comparison', title: 'E and Z pair',
    species: [
      { id: 'e-isomer', label: '(E)', formula: 'C3H4BrCl', role: 'structure', smiles: 'Cl/C(Br)=C\\C', connectivity: 'alkene with Br and Cl', stereochemistry: 'E' },
      { id: 'z-isomer', label: '(Z)', formula: 'C3H4BrCl', role: 'structure', smiles: 'Cl/C(Br)=C/C', connectivity: 'alkene with Br and Cl', stereochemistry: 'Z' },
    ],
    stages: [['e-isomer', 'z-isomer']], arrows: [], electronFlow: [],
  };
  let compiled = '';
  globalThis.__planCompleteText = async () => { throw new Error('the deterministic path must not call the model'); };
  globalThis.__planCompileChemfig = async source => { compiled = source; return '<svg/>'; };
  const source = await lib.compileChemistryPlan(JSON.stringify(comparison), { provider: 'deepseek', model: 'deepseek-v4-flash' });
  assert.equal(source, compiled);
  assert.equal((source.match(/Br/g) ?? []).length, 2);
  assert.equal((source.match(/Cl/g) ?? []).length, 2);
  assert.match(source, /\{e-isomer\}/);
  assert.match(source, /\{z-isomer\}/);
  const inverted = structuredClone(comparison);
  inverted.species[0].smiles = comparison.species[1].smiles;
  assert.throws(() => lib.parseChemistryPlan(JSON.stringify(inverted)), /declares E, but SMILES encodes Z/);
  assert.match(lib.smilesToChemfig('O=C1OC(=O)\/C=C1'), /\?\[r1\]/);
  // OCL's Y axis points down, unlike Chemfig's positive angles. Preserve the
  // configuration, not a mirror image with an unchanged wedge.
  assert.match(lib.smilesToChemfig('C[C@@H](O)C(=O)O'), /<\[:-90\]OH/);
  assert.match(lib.smilesToChemfig('C[C@H](O)C(=O)O'), /<:\[:-90\]OH/);
});

test('Fischer aldose plans preserve the explicit hydroxyl sequence without model typesetting', async () => {
  const plan = { version: 1, kind: 'structure', title: 'D-glucose Fischer',
    species: [{ id: 'glucose', label: 'D-glucose', formula: 'C6H12O6', role: 'structure', connectivity: 'Open-chain aldose', stereochemistry: 'Fischer OH right-left-right-right', projection: { kind: 'fischer-aldose', hydroxylSides: ['right', 'left', 'right', 'right'] } }],
    stages: [['glucose']], arrows: [], electronFlow: [],
  };
  globalThis.__planCompleteText = async () => { throw new Error('Unexpected model call'); };
  globalThis.__planCompileChemfig = async () => '<svg/>';
  const source = await lib.compileChemistryPlan(JSON.stringify(plan), { provider: 'deepseek', model: 'deepseek-v4-flash' });
  assert.match(source, /CHO-\[6\]C\(-\[4\]H\)\(-\[0\]OH\)-\[6\]C\(-\[4\]OH\)\(-\[0\]H\)/);
  assert.doesNotMatch(source, /[<>]:?\[/);
  const compact = structuredClone(plan);
  delete compact.species[0].connectivity;
  delete compact.species[0].stereochemistry;
  assert.equal(await lib.compileChemistryPlan(JSON.stringify(compact), { provider: 'deepseek', model: 'deepseek-v4-flash' }), source);
  const invalid = structuredClone(plan);
  invalid.species[0].projection.hydroxylSides.pop();
  assert.throws(() => lib.parseChemistryPlan(JSON.stringify(invalid)), /does not match the molecular formula/);
});

test('compiler rejects an incomplete draft, repairs it and syntax-checks the final Chemfig', async () => {
  const replies = [
    '```chemfig\n\\schemestart \\chemfig{O^{-}-H} \\arrow{->} \\chemfig{Br^{-}} \\schemestop\n```',
    '```chemfig\n\\schemestart \\chemname{\\chemfig{@{nuc}O^{-}-H}}{hydroxide} \\+ \\chemname{\\chemfig{@{c2}C(-[2]H)(-[6]CH_3)(<[:-30]@{lg}Br)(<:[:-150]CH_2CH_3)}}{bromobutane} \\arrow{->[SN2]} \\chemname{\\chemfig{C(-[2]H)(-[6]CH_3)(<[:-30]OH)(<:[:-150]CH_2CH_3)}}{butanol} \\+ \\chemname{\\chemfig{Br^{-}}}{bromide} \\schemestop \\chemmove{\\draw[->](nuc).. controls +(45:8mm) and +(135:8mm).. (c2);\\draw[->](c2).. controls +(-45:8mm) and +(-135:8mm).. (lg);}\n```',
  ];
  let calls = 0, compiled = '';
  globalThis.__planCompleteText = async () => replies[calls++];
  globalThis.__planCompileChemfig = async source => { compiled = source; return '<svg/>'; };
  const source = await lib.compileChemistryPlan(JSON.stringify(mechanism), { provider: 'deepseek', model: 'deepseek-v4-flash' });
  assert.equal(calls, 2);
  assert.equal(source, compiled);
  assert.match(source, /\\chemmove/);
  assert.equal((source.match(/\\schemestart/g) ?? []).length, 1);
});

test('compiler reports a bounded error instead of exposing invalid plan JSON as a drawing', async () => {
  globalThis.__planCompleteText = async () => 'I cannot compile this.';
  globalThis.__planCompileChemfig = async () => { throw new Error('must not compile'); };
  await assert.rejects(lib.compileChemistryPlan(JSON.stringify(mechanism), { provider: 'deepseek', model: 'deepseek-v4-flash' }), /could not be compiled/);
});

test('invalid semantic plans receive one JSON repair before typesetting', async () => {
  const missingLeavingGroup = {
    ...mechanism,
    species: mechanism.species.slice(0, 3),
    stages: [mechanism.stages[0], ['butanol']],
  };
  assert.throws(() => lib.parseChemistryPlan(JSON.stringify(missingLeavingGroup)), /does not conserve atoms and charge/);
  const calls = [];
  globalThis.__planCompleteText = async request => {
    calls.push(request);
    return calls.length === 1
      ? `\`\`\`json\n${JSON.stringify(mechanism)}\n\`\`\``
      : '\\schemestart \\chemname{\\chemfig{@{nuc}O^{-}-H}}{hydroxide} \\+ \\chemname{\\chemfig{@{c2}C(-[2]H)(-[6]CH_3)(<[:-30]@{lg}Br)(<:[:-150]CH_2CH_3)}}{bromobutane} \\arrow{->[SN2]} \\chemname{\\chemfig{C(-[2]H)(-[6]CH_3)(<[:-30]OH)(<:[:-150]CH_2CH_3)}}{butanol} \\+ \\chemname{\\chemfig{Br^{-}}}{bromide} \\schemestop \\chemmove{\\draw[->](nuc).. controls +(45:8mm) and +(135:8mm).. (c2);\\draw[->](c2).. controls +(-45:8mm) and +(-135:8mm).. (lg);}';
  };
  globalThis.__planCompileChemfig = async () => '<svg/>';
  const source = await lib.compileChemistryPlan(JSON.stringify(missingLeavingGroup), { provider: 'deepseek', model: 'deepseek-v4-flash' }, undefined, 'Show the complete SN2 mechanism.');
  assert.equal(calls.length, 2);
  assert.match(calls[0].user, /Show the complete SN2 mechanism/);
  assert.match(source, /Br\^{-\}/);
});
