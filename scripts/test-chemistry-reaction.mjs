import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
const temp = fs.mkdtempSync(path.join(root, 'tmp/chemistry-reaction-'));
await build({ stdin: { contents: `export * from './electron/ai/chemistryIdentity'; export * from './electron/chemistryValidationCore'; export * from './shared/chemistryReaction';`, resolveDir: root, loader: 'ts' }, outfile: path.join(temp, 'lib.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['@rdkit/rdkit', 'openchemlib', 'node-tikzjax'], logLevel: 'silent' });
const lib = await import(pathToFileURL(path.join(temp, 'lib.mjs')).href);
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
const validate = lib.validateChemicalReferences;
const parts = source => lib.reactionSmilesSpecies(source).map(s => ({ id: s.id, role: s.role, coefficient: s.coefficient, smiles: s.input.value }));
const check = source => validate({ references: [parts(source)[0].smiles], reaction: parts(source) });
const intent = reactionSmiles => JSON.stringify({ version: 2, kind: 'reaction', depiction: 'skeletal', reactionSmiles });

test('complete exact reaction SMILES preserves all fields and rejects malformed or model-created inputs', () => {
  const source = 'N.O=[N+]([O-])O>O>[NH4+].O=[N+]([O-])[O-]';
  const parsed = lib.parseChemistryIntent(intent(source), `Draw \`${source}\``);
  assert.deepEqual(parsed.species.map(s => s.role), ['reactant', 'reactant', 'agent', 'product', 'product']);
  for (const bad of ['N>O', 'N>>>O', 'N>invalid>O', 'N..O>>O', '>O>N', 'N>>', 'N> >O']) {
    if (bad.includes('invalid')) continue; // A chemical parser, not the field parser, rejects this below.
    assert.throws(() => lib.parseChemistryIntent(intent(bad), bad));
  }
  assert.throws(() => lib.parseChemistryIntent(intent('N>>N'), 'Draw ammonia'));
  assert.throws(() => lib.parseChemistryIntent(intent('N>>N'), 'O.N>>N.O'));
  assert.throws(() => lib.parseChemistryIntent(intent('N>>N'), 'SN2 mechanism N>>N'));
  assert.throws(() => lib.parseChemistryIntent(intent('N>>N'), 'resonance N>>N'));
  assert.throws(() => lib.parseChemistryIntent(intent('N>>N'), 'equilibrium N>>N'), /equilibrium/);
  assert.throws(() => lib.parseChemistryIntent(JSON.stringify(parsed), source), /complete single/);
  assert.throws(() => lib.parseChemistryIntent(JSON.stringify(parsed), '*.N>>N.*'), /complete single/);
});

test('reviewed acid/base exercise conserves nitric acid + ammonia -> ammonium + nitrate', async () => {
  const source = 'O=[N+]([O-])O.N>>[NH4+].O=[N+]([O-])[O-]';
  const result = await lib.resolveChemistryIntent(intent(source), source, { validate, fetch: () => { throw new Error('No network'); } });
  assert.equal(result.status, 'verified', result.reason);
  assert.equal(result.reaction.scope, 'balanced-scheme-not-mechanism');
  assert.equal(result.mechanism, undefined);
  assert.deepEqual(result.reaction.balance, { atoms: { '8:0': 3, '7:0': 2, '1:0': 4 }, charge: 0 });
  assert.equal(result.reaction.species.length, 4);
  assert.equal((result.reaction.chemfig.source.match(/\\chemfig\b/g) ?? []).length, 4);
  assert.equal((result.reaction.svg.match(/>−<\/text>/g) ?? []).length, 3);
  assert.equal((result.reaction.svg.match(/>\+<\/text>/g) ?? []).length, 5); // three formal charges + two separators
  assert.match(result.reaction.svg, /<svg/);
  if (process.env.NODUS_REACTION_ARTIFACTS === '1') {
    const dir = path.join(root, 'artifacts/chat-skills/reactions'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'acid-base.svg'), result.reaction.svg);
    fs.writeFileSync(path.join(dir, 'acid-base.json'), JSON.stringify(result, null, 2));
  }
});

test('counterions, agents, repeated species and explicit coefficients are never discarded', async () => {
  const result = await check('[NH4+].[Cl-]>O>[NH4+].[Cl-]');
  assert.equal(result.reaction.species.length, 5);
  assert.match(result.reaction.chemfig.source, /Agents/);
  assert.equal((result.reaction.chemfig.source.match(/Cl/g) ?? []).length, 2);
  const grouped = await validate({ references: ['[NH4+].[Cl-]'], reaction: [
    { id: 'salt-in', role: 'reactant', smiles: '[NH4+].[Cl-]', coefficient: 2 },
    { id: 'salt-out', role: 'product', smiles: '[NH4+].[Cl-]', coefficient: 2 },
  ] });
  assert.equal((grouped.reaction.chemfig.source.match(/\\chemfig\b/g) ?? []).length, 4);
  assert.match(grouped.reaction.chemfig.source, /2\\,/);
  assert.match(grouped.reaction.chemfig.source, /2\\,\(\\chemfig/);
  assert.equal(grouped.reaction.balance.atoms['1:0'], 8);
  const coefficients = await validate({ references: ['C=C'], reaction: [
    { id: 'ethene', role: 'reactant', smiles: 'C=C', coefficient: 2 },
    { id: 'cyclobutane', role: 'product', smiles: 'C1CCC1', coefficient: 1 },
  ] });
  assert.equal(coefficients.reaction.balance.atoms['6:0'], 4);
  assert.ok(coefficients.reaction.limitations.some(text => text.includes('feasibility')));
  if (process.env.NODUS_REACTION_ARTIFACTS === '1') {
    const dir = path.join(root, 'artifacts/chat-skills/reactions'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'agents.svg'), result.reaction.svg);
    fs.writeFileSync(path.join(dir, 'coefficients.svg'), grouped.reaction.svg);
  }
});

test('named scheme uses exact identity lookup and rejects missing products before network access', async () => {
  const molecules = { 'nitric acid': 'O=[N+]([O-])O', ammonia: 'N', ammonium: '[NH4+]', nitrate: 'O=[N+]([O-])[O-]' };
  const species = Object.keys(molecules).map((value, i) => ({ id: `s${i}`, input: { kind: 'name', value }, role: i < 2 ? 'reactant' : 'product', coefficient: 1 }));
  const request = { version: 2, kind: 'reaction', depiction: 'skeletal', species };
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const match = /\/opsin\/ws\/(.+)\.json$/.exec(url);
    if (!match) return new Response('{}', { status: 404 });
    const name = decodeURIComponent(match[1]); assert.ok(Object.hasOwn(molecules, name));
    return new Response(JSON.stringify({ status: 'SUCCESS', smiles: molecules[name] }));
  };
  const result = await lib.resolveChemistryIntent(JSON.stringify(request), 'Draw nitric acid + ammonia -> ammonium + nitrate. Private unrelated context.', { validate, fetch });
  assert.equal(result.status, 'verified', result.reason);
  assert.equal(result.reaction.species.length, 4);
  assert.ok(calls.every(url => !url.includes('Private')));
  const missing = await lib.resolveChemistryIntent(JSON.stringify({ ...request, species: species.slice(0, 2) }), 'nitric acid + ammonia', { validate, fetch: () => { throw new Error('Must not look up missing products'); } });
  assert.equal(missing.status, 'unsupported'); assert.match(missing.reason, /Both reaction sides/);
});

test('unbalanced atoms, isotopes, charge, missing counterions and invalid agents fail closed', async () => {
  for (const source of ['N>>O', '[NH4+].[Cl-]>>[NH4+]', '[13CH3]CO>>CCO', '[NH4+]>>N', 'N>invalid>N']) await assert.rejects(check(source));
  // Same atomic composition but different net charge, not just a lost hydrogen.
  await assert.rejects(check('[CH2-]C=C>>[CH2+]C=C'), /charge/);
  await assert.rejects(validate({ references: ['N'], reaction: [{ id: 'x', smiles: 'N', role: 'reactant', coefficient: 1 }] }));
  for (const coefficient of [0, -1, 1.5, 13]) {
    const reaction = parts('N>>N'); reaction[0].coefficient = coefficient;
    await assert.rejects(validate({ references: ['N'], reaction }));
  }
});

test('reviewed chapter-2 charge fixtures retain local formal charges, not merely net charge', async () => {
  for (const [smiles, charges] of [
    ['COP(=O)([O-])[O-]', [-1, -1]],
    ['O=[N+]([O-])[O-]', [-1, -1, 1]],
    ['C=C[CH2+]', [1]],
    ['O=C([O-])c1ccccc1', [-1]],
  ]) {
    const result = await validate({ references: [smiles], exportChemfig: true });
    assert.deepEqual(result.graph.atoms.map(a => a.charge).filter(Boolean).sort(), charges.sort());
    assert.equal(result.chemfig.status, 'validated', result.chemfig.reason);
    const structure = JSON.stringify({ version: 2, kind: 'structure', depiction: 'skeletal', species: [{ id: 's', input: { kind: 'smiles', value: smiles } }] });
    assert.throws(() => lib.parseChemistryIntent(structure, `Show all resonance contributors of ${smiles}`), /mechanism/);
  }
});

test('reaction component serialization retains specified enantiomers and alkene geometry', async () => {
  const sources = [];
  for (const smiles of ['C[C@H](O)C(=O)O', 'C[C@@H](O)C(=O)O', 'F/C=C/F', 'F/C=C\\F']) {
    const result = await check(`${smiles}>>${smiles}`);
    assert.equal(result.reaction.species[0].smiles, result.reaction.species[1].smiles);
    sources.push(result.reaction.chemfig.source);
  }
  assert.notEqual(sources[0], sources[1]); assert.notEqual(sources[2], sources[3]);
});
