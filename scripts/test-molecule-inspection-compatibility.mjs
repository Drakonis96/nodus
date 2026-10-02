import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-route-compatibility-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'inspection.mjs');
await build({ entryPoints: [path.join(root, 'electron/ai/moleculeInspection.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'no-external-services', setup(api) {
    const mocks = {
      '../capabilities/registry': `export const capabilityRegistry=()=>({providers:new Map([['nodus:chemistry',{id:'nodus:chemistry',tools:[{id:'verify-route',inputSchema:{properties:{labels:{}}}}]}]])}); export const pinCapabilitiesForTurn=()=>[];`,
      '../capabilities/runner': `export function createTrustedCapabilityRunner(){throw Error('test must supply a runner')}`,
      './aiClient': `export function completeText(){throw Error('test must not call a model')}`,
      // The reaction index and the route evidence are optional; with no index they add nothing.
      '../reactionIndex': `export const reactionIndexService=()=>({localDirectory:async()=>null})`,
      './synthesisEvidence': `export async function invokeDisconnections(){return null} export function synthesisEvidenceWorkIds(){return []} export async function textbookPassages(){return []}`,
      './chemistryStock': `export const chemistryStockDirectory=()=>null`,
      // No textbook-scheme index built: the route report has no textbook section.
      './textbookSchemes': `export const textbookSchemeDirectory=()=>null; export const textbookCitations=()=>[]`,
    };
    // Only the electron modules' imports are mocked: a shared module's own `./textbookSchemes` is the
    // real shared file, not electron/ai/textbookSchemes.
    api.onResolve({ filter: /^(\.\/aiClient|\.\/synthesisEvidence|\.\/chemistryStock|\.\/textbookSchemes|\.\.\/reactionIndex|\.\.\/capabilities\/(registry|runner))$/ }, args => (args.importer.includes(`${path.sep}electron${path.sep}`) ? { path: args.path, namespace: 'mock' } : undefined));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { appendRouteReportAndDrawings } = await import(pathToFileURL(outfile));
const steps = ['CCO>>CC=O', '', 'CC=O>>CC(=O)O'];
const labels = steps.map(() => [{ role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' }]);
const passing = (index, reaction) => ({ index, reaction, ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] });
function runnerFor(auditSteps) {
  return { async invoke({ toolId, input }) {
    assert.equal(toolId, 'verify-route');
    assert.deepEqual(input.steps, steps);
    return { artifacts: [{ artifactType: 'route-audit', data: { steps: auditSteps, continuous: false, blocked: ['Step 2 is not built'], links: [] } }] };
  } };
}

test('an installed 2.5.6-style checker cannot attach shifted labels or corrections', async () => {
  const old = [passing(0, steps[0]), passing(1, steps[2])];
  const answer = await appendRouteReportAndDrawings('Route prose', '', { runner: runnerFor(old) }, { steps, labels });
  assert.match(answer, /Route check unavailable:.*omitted or renumbered/);
  assert.match(answer, /Update Chemistry Studio/);
  assert.doesNotMatch(answer, /Route checked: balanced|nodus-route-fix|### Route drawings/);
});

test('a checker that keeps the count but renumbers steps is also refused', async () => {
  const reordered = [passing(0, steps[0]), passing(2, steps[2]), passing(1, '')];
  const answer = await appendRouteReportAndDrawings('Route prose', '', { runner: runnerFor(reordered) }, { steps, labels });
  assert.match(answer, /omitted or renumbered/);
});

test('a 2.5.7-style checker preserves the failed step and the following step number', async () => {
  const current = [passing(0, steps[0]), { ...passing(1, ''), ok: false, error: 'Step could not be built' }, passing(2, steps[2])];
  const answer = await appendRouteReportAndDrawings('Route prose', '', { runner: runnerFor(current) }, { steps, labels });
  assert.doesNotMatch(answer, /Route check unavailable/);
  assert.match(answer, /Step 2/);
  assert.match(answer, /Step 3/);
  assert.match(answer, /Step could not be built/);
  assert.match(answer, /nodus-route-fix/);
});
