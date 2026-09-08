// Real reference-network and graph/render smoke test; NOT a held-out accuracy benchmark.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-identity-live-'));
const bundle = path.join(temporary, 'core.cjs');
await build({ stdin: { contents: `export * from './electron/ai/chemistryIdentity'; export * from './electron/chemistryValidationCore';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'rdkit', setup(api) {
  api.onResolve({ filter: /^@rdkit\/rdkit$/ }, () => ({ path: require.resolve('@rdkit/rdkit'), external: true }));
} }] });
const lib = require(bundle);
const names = ['(R)-lactic acid', '(2R,3S)-2,3-dibromobutane', '(E)-1-bromo-1-chloroprop-1-ene', '(Z)-1-bromo-1-chloroprop-1-ene', 'beta-D-glucopyranose', 'alpha-D-glucopyranose', 'cholesterol', 'strychnine', 'morphine', 'paclitaxel', 'adamantane', 'cubane', 'glucose', 'lactic acid', 'but-2-ene'];
const out = path.join(root, 'artifacts/chat-skills/chemistry-identity-v2');
await fs.mkdir(out, { recursive: true });
const results = [];
try {
  for (const [index, name] of names.entries()) {
    const source = JSON.stringify({ version: 2, kind: 'structure', depiction: 'skeletal', species: [{ id: 'target', input: { kind: 'name', value: name } }] });
    const result = await lib.resolveChemistryIntent(source, `Draw ${name}.`, { fetch, validate: lib.validateChemicalReferences });
    const id = String(index + 1).padStart(2, '0');
    if (result.status === 'verified') {
      await fs.writeFile(path.join(out, `${id}.svg`), result.species[0].svg);
      await sharp(Buffer.from(result.species[0].svg)).png().toFile(path.join(out, `${id}.png`));
    }
    results.push({ name, ...result });
    console.log(id, name, result.status, result.reason ?? '');
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ kind: 'reference-and-render-smoke-only', results }, null, 2));
  }
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
