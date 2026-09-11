// The application carries no discipline.
//
// This is the claim the whole capability API v2 change rests on, and it is the one that
// erodes quietly: a stray import, a re-added prompt line, a dependency someone reinstates
// "just for a type". Checking it by reading the source is not enough — what matters is
// what ends up in the bundle a user installs — so this builds the real main-process and
// renderer graphs and looks at the bytes.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-core-purity-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

/** Names that only appear if a discipline came back. Deliberately specific: "chemistry"
 *  alone would match a user's own skill text or a release note, and a check that cries
 *  wolf gets deleted. */
const ENGINES = [
  'validateChemicalReferences', 'resolveChemistryIntent', 'compileChemistryPlan',
  'exportSceneChemfig', 'deriveNewman', 'renderCheckedMechanism',
  'predictGenomics', 'retrieveLegalize', 'LEGALIZE_COUNTRIES',
  'ALPHAGENOME_REVISION', 'chemistrySvgAuditSystem',
];

const DEPENDENCIES = ['@rdkit/rdkit', 'openchemlib', 'node-tikzjax', 'RDKit_minimal'];

async function bundleOf(entry, platform) {
  const outfile = path.join(scratch, `${path.basename(entry, path.extname(entry))}-${platform}.js`);
  const result = await build({
    entryPoints: [path.join(root, entry)],
    outfile, bundle: true, platform, format: 'cjs', write: false, logLevel: 'silent',
    // Node built-ins reached from a browser graph are the app's own lazy runtime imports,
    // not something this test is about.
    external: platform === 'node'
      ? ['electron', 'better-sqlite3', 'sharp']
      : ['fs', 'path', 'crypto', 'node:fs', 'node:path', 'node:crypto', 'node:url', 'worker_threads', 'module'],
    alias: { '@shared': path.join(root, 'shared') },
    // Binary and asset files play no part in what this test measures; native bindings
    // and images are dropped so the graph resolves.
    loader: {
      '.css': 'empty', '.ttf': 'empty', '.woff': 'empty', '.woff2': 'empty',
      '.png': 'empty', '.jpg': 'empty', '.jpeg': 'empty', '.webp': 'empty', '.gif': 'empty',
      '.node': 'empty', '.wasm': 'empty', '.mp3': 'empty', '.mp4': 'empty', '.svg': 'text',
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    jsx: 'automatic',
    plugins: [{
      // Vite's `?url` and `?raw` asset imports are not esbuild syntax; they carry no code,
      // so they stand in as empty modules here.
      name: 'vite-asset-queries',
      setup(api) {
        api.onResolve({ filter: /\?(url|raw|worker)$/ }, ({ path: value }) => ({ path: value, namespace: 'asset-query' }));
        api.onLoad({ filter: /.*/, namespace: 'asset-query' }, () => ({ contents: 'export default ""; export const url = "";', loader: 'js' }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

test('the main-process bundle contains no disciplinary engine', async () => {
  const bundle = await bundleOf('electron/main.ts', 'node');
  for (const symbol of ENGINES) {
    assert.ok(!bundle.includes(symbol), `the main process bundle still contains ${symbol}`);
  }
  for (const dependency of DEPENDENCIES) {
    assert.ok(!bundle.includes(dependency), `the main process bundle still pulls in ${dependency}`);
  }
  // The capability machinery itself must be there: this test would pass trivially if the
  // whole graph had failed to resolve.
  assert.ok(bundle.includes('rebuildCapabilityRegistry'), 'the capability registry is in the bundle');
  assert.ok(bundle.includes('nodus-trusted-worker-v1'), 'the trusted runtime contract is in the bundle');
});

test('the renderer bundle contains no disciplinary renderer', async () => {
  const bundle = await bundleOf('src/main.tsx', 'browser');
  for (const symbol of [...ENGINES, 'ChatChemistryDocument', 'ChatGenomicsResult', 'ChatLegalResult', 'GenomicsConfig']) {
    assert.ok(!bundle.includes(symbol), `the renderer bundle still contains ${symbol}`);
  }
  assert.ok(bundle.includes('capability-view'), 'the declarative view renderer is in the bundle');
});

test('no disciplinary dependency is declared, packaged or unpacked', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const dependency of ['@rdkit/rdkit', 'openchemlib', 'node-tikzjax']) {
    assert.ok(!manifest.dependencies[dependency], `${dependency} is still a dependency`);
    assert.ok(!manifest.devDependencies?.[dependency], `${dependency} is still a dev dependency`);
    assert.ok(!JSON.stringify(manifest.build.asarUnpack).includes(dependency), `${dependency} is still unpacked from the asar`);
  }
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  for (const dependency of ['@rdkit/rdkit', 'openchemlib', 'node-tikzjax']) {
    assert.ok(!lock.packages[`node_modules/${dependency}`], `${dependency} is still in the lockfile`);
  }
  assert.ok(!JSON.stringify(manifest.build.extraResources).includes('alphagenome'), 'the AlphaGenome worker is still a packaged resource');
});

test('the capability ids the packages provide are reserved, not implemented', async () => {
  const contracts = await bundleOf('packages/capability-api/src/index.ts', 'node');
  // The identifiers stay: the core has to know which ones only NodusResearch may claim.
  for (const id of ['nodus:chemistry', 'nodus:legal', 'nodus:genomics']) {
    assert.ok(contracts.includes(id), `${id} is still a reserved identifier`);
  }
  const catalogue = fs.readFileSync(path.join(root, 'skill-capabilities/registry/catalog.ts'), 'utf8');
  for (const id of ['nodus:chemistry', 'nodus:legal', 'nodus:genomics']) {
    assert.ok(!catalogue.includes(id), `${id} is still registered as a built-in capability`);
  }
  assert.ok(catalogue.includes('nodus:svg') && catalogue.includes('nodus:image'), 'the two core capabilities are still built in');
});

test('no default skill belongs to a discipline', async () => {
  const outfile = path.join(scratch, 'skills.cjs');
  await build({ entryPoints: [path.join(root, 'shared/chatSkills.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { DEFAULT_CHAT_SKILLS, chatSkillsOutputContract, buildChatSkillsPrompt } = await import(`file://${outfile}`);
  for (const skill of DEFAULT_CHAT_SKILLS) {
    assert.ok(!['chemistry', 'genomics', 'legal'].includes(skill.builtin), `${skill.name} is still a default`);
  }
  // The prompt the model receives must not describe a lane the application cannot run.
  const prompts = [
    chatSkillsOutputContract(DEFAULT_CHAT_SKILLS),
    typeof buildChatSkillsPrompt === 'function' ? buildChatSkillsPrompt(DEFAULT_CHAT_SKILLS) : '',
  ].join('\n');
  for (const phrase of ['CHEMISTRY TOOL IS AVAILABLE', 'LEGAL TOOL IS AVAILABLE', 'GENOMICS TOOL IS AVAILABLE', 'Chemistry Studio']) {
    assert.ok(!prompts.includes(phrase), `the skills prompt still mentions "${phrase}"`);
  }
});
