import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chemistry-document-'));
await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ChatChemistryDocument} from './src/components/ChatChemistryDocument'; export const render = source => renderToStaticMarkup(React.createElement(ChatChemistryDocument, {source}));`, resolveDir: process.cwd(), loader: 'tsx' }, outfile: path.join(temp, 'lib.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'presentation-only', setup(api) {
  api.onResolve({ filter: /\/ChatVisual$/ }, () => ({ path: 'visual', namespace: 'mock' }));
  api.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'mock' }));
  api.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({ contents: name === 'i18n' ? 'export const t = s => s;' : 'export const ChatVisual = ({alt}) => alt;' }));
} }] });
const { render } = createRequire(import.meta.url)(path.join(temp, 'lib.cjs'));
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
const document = {
  version: 2, status: 'verified', scope: 'reference-graph-and-molfile-roundtrip',
  species: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, input: { kind: 'smiles', value: 'N' }, svg: '<svg/>', references: [{ provider: 'user' }] })),
  reaction: { scope: 'balanced-scheme-not-mechanism', svg: '<svg/>', chemfig: { status: 'validated', source: '\\schemestart...\\schemestop' }, limitations: ['Declared balance is not feasibility.'], species: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, smiles: 'N', coefficient: 1, role: i < 2 ? 'reactant' : i < 4 ? 'product' : 'agent' })) },
};
test('balanced scheme UI supports all species and visibly limits its verification claim', () => {
  const html = render(JSON.stringify(document));
  assert.match(html, /Esquema balanceado; mecanismo no verificado/);
  assert.match(html, /Agente; excluido del balance/);
  assert.match(html, /Descargar fragmento ChemFig contrastado/);
  assert.equal((html.match(/1 × N/g) ?? []).length, 5);
  assert.doesNotMatch(html, /documento químico inválido/);
});
test('malformed, mismatched and conflicting records fail closed in the UI', () => {
  const mutations = [d => { d.reaction.scope = 'mechanism-verified'; }, d => { d.reaction.species[0].id = 'other'; }, d => { d.reaction.species[0].coefficient = 0; }, d => { d.reaction.limitations = [null]; }, d => { d.reaction.chemfig.status = 'unsupported'; }, d => { d.mechanism = {}; }, d => { delete d.reaction; }];
  for (const mutate of mutations) { const bad = structuredClone(document); mutate(bad); assert.match(render(JSON.stringify(bad)), /documento químico inválido/); }
});
