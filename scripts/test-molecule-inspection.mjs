import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'molecule-inspection-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { findSmilesCandidates, findAnswerSpecies, normalizeMoleculeDossier, formatMoleculeDossier, formatStructureAudit, MOLECULE_DOSSIER_SYSTEM_RULE, findReactionLines, findStepConditions, declaresRacemic, normalizeRouteAudit, formatRouteAudit, formatRouteFixPrompt, ROUTE_CONTINUITY_SYSTEM_RULE } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
await build({ entryPoints: ['shared/chatSkills.ts'], outfile: path.join(dir, 'chatSkills.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { splitChatVisuals, serializeChatVisualPart } = await import(pathToFileURL(path.join(dir, 'chatSkills.mjs')));
await build({ entryPoints: ['shared/synthesisPrompt.ts'], outfile: path.join(dir, 'synthesisPrompt.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { SYNTHESIS_TEMPLATE_ADDENDUM, looksLikeSynthesisRequest } = await import(pathToFileURL(path.join(dir, 'synthesisPrompt.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

const WRAPPED = `Here is the smiles string for icotrokinra.
Cc1cccc2c(C[C@H]3C(=O)N[C@@H](CCCCNC(=O)C)C(=O)N[C@H]
(C(=O)N[C@@H](Cc4ccc(cc4)OCCN)C(=O)N[C@@H]
(Cc5ccc6ccccc6c5)C(=O)NC7(CCOCC7)C(=O)N[C@@H]
(CCC(=O)O)C(=O)N[C@@H](CC(=O)N)C(=O)N[C@@H]
(Cc8cccnc8)C(=O)N(C)CC(=O)N)C(C)(C)SSC(C)(C)[C@@H]
(C(=O)N[C@@H](CC(=O)N)C(=O)N[C@@]([H])([C@@H]
(C)O)C(=O)N3)NC(=O)C)c[nH]c12 .Walk me through how you would
synthesize this from standard precursors.`;

test('detects a line-wrapped SMILES and reassembles it', () => {
  const found = findSmilesCandidates(WRAPPED);
  assert.equal(found.length, 1);
  assert.ok(found[0].startsWith('Cc1cccc2c(C[C@H]3C(=O)N'));
  assert.ok(found[0].endsWith('C)c[nH]c12'));
  assert.ok(!found[0].includes('Walk'));
  assert.ok(!found[0].includes('\n'));
});

test('ignores ordinary prose', () => {
  assert.deepEqual(findSmilesCandidates('Walk me through how you would synthesize this from standard precursors.'), []);
  assert.deepEqual(findSmilesCandidates('aspirin and benzene are aromatic'), []);
});

test('sentence punctuation glued to a SMILES is peeled off, not parsed as part of it', () => {
  const found = findSmilesCandidates('Compare the stereochemistry of C[C@H](N)C(=O)O with the ester CC(=O)Oc1ccccc1C(=O)O.');
  assert.deepEqual(found, ['C[C@H](N)C(=O)O', 'CC(=O)Oc1ccccc1C(=O)O']);
  assert.deepEqual(findSmilesCandidates('The product is "CCO".'), []);
  // An interior dot is a salt or reaction separator: it must survive.
  assert.deepEqual(findSmilesCandidates('Dissolve [Na+].[Cl-] in water.'), ['[Na+].[Cl-]']);
});

test('a verified dossier survives normalization and formats its stereo', () => {
  const dossier = normalizeMoleculeDossier({
    canonicalSmiles: 'C[C@H](N)C(=O)O',
    formula: 'C3H7NO2',
    molecularWeight: 89.09,
    atomCount: 3,
    bondCount: 2,
    atoms: [{ index: 0, element: 'C' }, { index: 1, element: 'C', cip: 'S' }, { index: 2, element: 'O', charge: -1 }],
    bonds: [{ a: 0, b: 1, order: 1 }, { a: 1, b: 2, order: 1, stereo: 'E' }],
    caveats: ['one unspecified stereocentre'],
  }, 'C[C@H](N)C(=O)O');
  assert.ok(dossier);
  assert.equal(dossier.atoms.length, 3);
  const text = formatMoleculeDossier(dossier);
  assert.match(text, /Canonical isomeric SMILES: C\[C@H\]\(N\)C\(=O\)O/);
  assert.match(text, /#1 C S/);
  assert.match(text, /0-1 1/);
  assert.match(text, /unspecified stereocentre/);
});

test('malformed artifact data is rejected rather than injected', () => {
  assert.equal(normalizeMoleculeDossier(null, 'C'), null);
  assert.equal(normalizeMoleculeDossier({ canonicalSmiles: '', atoms: [], bonds: [] }, 'C'), null);
  assert.equal(normalizeMoleculeDossier({ canonicalSmiles: 'C' }, 'C'), null);
  assert.equal(normalizeMoleculeDossier({ canonicalSmiles: 'C', atoms: [], bonds: [] }, 'C'), null);
});

test('the system rule names the authoritative field', () => {
  assert.match(MOLECULE_DOSSIER_SYSTEM_RULE, /estructura_objetivo_verificada/);
  assert.match(MOLECULE_DOSSIER_SYSTEM_RULE, /RDKit/);
});

test('answer audit extracts every species from backticked reactions and quoted species', () => {
  const answer = [
    'Step 1: ethene adds bromine to give 1,2-dibromoethane.',
    '',
    '`C=C.BrBr>>BrCCBr`',
    '',
    'The chiral intermediate `C[C@H](N)C(=O)O` is carried forward.',
  ].join('\n');
  const species = findAnswerSpecies(answer);
  for (const expected of ['C=C', 'BrBr', 'BrCCBr', 'C[C@H](N)C(=O)O']) {
    assert.ok(species.includes(expected), `missing ${expected}: ${JSON.stringify(species)}`);
  }
});

test('answer audit reads only code spans, never free prose', () => {
  const answer = [
    'The product (Z)-hex-3-ene forms; see Reagents/conditions and [Klein, 2012](nodus://idea/g-15188).',
    '',
    '`C#C.CCBr>>CC#C`',
  ].join('\n');
  assert.deepEqual(findAnswerSpecies(answer), ['C#C', 'CCBr', 'CC#C']);
});

test('a bare bond or stereo fragment is not treated as a species', () => {
  assert.deepEqual(findAnswerSpecies('quoted as `=O` and `/C=C\\` in the prose'), []);
  assert.deepEqual(findSmilesCandidates('the direction /C=C/C=C/C is not a molecule'), []);
});

test('answer audit marks verified and unparseable species deterministically', () => {
  const candidates = ['C[C@H](N)C(=O)O', 'notasmiles'];
  const dossier = normalizeMoleculeDossier({
    canonicalSmiles: 'C[C@H](N)C(=O)O',
    atomCount: 6,
    bondCount: 5,
    atoms: [{ index: 1, element: 'C', cip: 'S' }],
    bonds: [{ a: 0, b: 1, order: 1 }],
  }, 'C[C@H](N)C(=O)O');
  const text = formatStructureAudit(candidates, [dossier]);
  assert.match(text, /Structure check \(RDKit\)/);
  assert.match(text, /- OK `C\[C@H\]\(N\)C\(=O\)O`.*1 stereocentres/);
  assert.match(text, /- FAIL `notasmiles` — could not be parsed/);
});

// ---------------------------------------------------------------- synthesis routes

test('reaction lines are collected in order, and single molecules are not steps', () => {
  const answer = [
    'Here is the route.',
    '',
    '`CCO>>CC=O.[H][H]`',
    '',
    'The intermediate `CC=O` is then reduced.',
    '',
    '`CC=O.[H][H]>>CCO`',
    '',
    'No step lives in this prose.',
  ].join('\n');
  assert.deepEqual(findReactionLines(answer), ['CCO>>CC=O.[H][H]', 'CC=O.[H][H]>>CCO']);
});

test('a drawn reaction is read from a chemistry-plan intent, and the format placeholder is ignored', () => {
  const answer = [
    'Format: `reactants>agents>products`.',
    '```chemistry-plan',
    '{"version":2,"kind":"reaction","depiction":"skeletal","reactionSmiles":"C/C=C\\\\C.[H][H]>>CCCC"}',
    '```',
  ].join('\n');
  assert.deepEqual(findReactionLines(answer), ['C/C=C\\C.[H][H]>>CCCC']);
});

test('reaction lines are read from a fenced code block, one step per line, in order', () => {
  // Claude Opus and Deepseek Pro write the steps in a fence rather than inline; the route
  // check and its continuity section must run for them too.
  const answer = [
    '## Balanced reaction SMILES',
    '',
    '```',
    'C#C.CCBr.[Na+].[NH2-]>>CCC#C.N.[Na+].[Br-]',
    '```',
    '```',
    'CCC#C.CCBr.[Na+].[NH2-]>>CCC#CCC.N.[Na+].[Br-]',
    '```',
    '```',
    'CCC#CCC.[H][H]>[Pd]>CC/C=C\\CC',
    '```',
  ].join('\n');
  assert.deepEqual(findReactionLines(answer), [
    'C#C.CCBr.[Na+].[NH2-]>>CCC#C.N.[Na+].[Br-]',
    'CCC#C.CCBr.[Na+].[NH2-]>>CCC#CCC.N.[Na+].[Br-]',
    'CCC#CCC.[H][H]>[Pd]>CC/C=C\\CC',
  ]);
});

test('a multi-line fence and an inline span keep document order, and artifact JSON is ignored', () => {
  const answer = [
    'Step 1.',
    '```smiles',
    'CCO>>CC=O.[H][H]',
    '```',
    'Step 2.',
    '`CC=O.[H][H]>>CCO`',
    '```nodus-artifact',
    '{"source":"nodus-artifact://chat/abc","artifactType":"chemistry-document","view":{"svg":"<path d=\'M 1.0,2.0 L 3.0,4.0\'/>"}}',
    '```',
  ].join('\n');
  assert.deepEqual(findReactionLines(answer), ['CCO>>CC=O.[H][H]', 'CC=O.[H][H]>>CCO']);
});

test('a corrected full route in a fence outranks a rejected equation quoted inline', () => {
  // A correction often quotes the equation the checker just refused, then gives the fixed
  // route — sometimes as a fence. The fence is the authoritative route; the quoted old
  // equation must not be audited as step 1 and shift every later step.
  const answer = [
    'What went wrong:',
    '`Oc1ccccc1.[Na+].[OH-].O=C=O>>O=C([O-])c1ccccc1O.[Na+]`',
    '',
    'Corrected route:',
    '`Oc1ccccc1.[Na+].[OH-].O=C=O>>O=C([O-])c1ccccc1O.[Na+].O`',
    '',
    '```',
    'Oc1ccccc1.[Na+].[OH-].O=C=O>>O=C([O-])c1ccccc1O.[Na+].O',
    'O=C([O-])c1ccccc1O.[Na+].[H+].[Cl-]>>O=C(O)c1ccccc1O.[Na+].[Cl-]',
    'O=C(O)c1ccccc1O.CC(=O)OC(C)=O>OS(=O)(=O)O>CC(=O)Oc1ccccc1C(=O)O.CC(=O)O',
    '```',
  ].join('\n');
  assert.deepEqual(findReactionLines(answer), [
    'Oc1ccccc1.[Na+].[OH-].O=C=O>>O=C([O-])c1ccccc1O.[Na+].O',
    'O=C([O-])c1ccccc1O.[Na+].[H+].[Cl-]>>O=C(O)c1ccccc1O.[Na+].[Cl-]',
    'O=C(O)c1ccccc1O.CC(=O)OC(C)=O>OS(=O)(=O)O>CC(=O)Oc1ccccc1C(=O)O.CC(=O)O',
  ]);
});

test('step conditions are read from the prose and aligned with the reaction lines', () => {
  const answer = [
    'Step 1 — nitration.',
    'Reagents and conditions: HNO3/H2SO4, 50–55 °C, 1 h.',
    '`c1ccccc1.O[N+](=O)[O-]>OS(=O)(=O)O>O=[N+]([O-])c1ccccc1.O`',
    '',
    'Step 2 — reduction.',
    'Reagents and conditions: Sn/HCl, then NaOH workup.',
    '`O=[N+]([O-])c1ccccc1.[Sn].Cl>>Nc1ccccc1.Cl[Sn]Cl`',
  ].join('\n');
  const steps = findReactionLines(answer);
  const conditions = findStepConditions(answer, steps.length);
  assert.equal(conditions.length, steps.length);
  assert.match(conditions[0], /HNO3\/H2SO4, 50–55/);
  assert.match(conditions[1], /Sn\/HCl/);
  // A step with no conditions line, or an extra requested slot, is an empty string.
  assert.deepEqual(findStepConditions('no conditions here', 2), ['', '']);
  // A full sentence is reduced to the first clause, and "Reagents/conditions:" (no "and") is read.
  const prose = 'Reagents/conditions: NaNH₂ (sodium amide) in liquid NH₃, then CCBr; the monoalkylated alkyne is the desired product.';
  assert.equal(findStepConditions(prose, 1)[0], 'NaNH₂ in liquid NH₃, then CCBr');
});

test('a malformed route audit degrades to no audit instead of junk', () => {
  assert.equal(normalizeRouteAudit(null), null);
  assert.equal(normalizeRouteAudit({ steps: [] }), null);
  assert.equal(normalizeRouteAudit({ steps: [{}] }), null);
});

test('a route audit is normalized defensively and formatted deterministically', () => {
  const audit = normalizeRouteAudit({
    continuous: false,
    blocked: ['Step 1 is not balanced: H: reactants 6, products 4.'],
    steps: [
      { index: 0, reaction: 'CCO>>CC=O', ok: true, balanced: false, chargeBalanced: true, differences: ['H: reactants 6, products 4'], unspecifiedStereocentres: 0, reactants: [{ input: 'CCO', canonicalSmiles: 'CCO', formula: 'C2H6O', heavyAtoms: 3 }], agents: [], products: [{ input: 'CC=O', canonicalSmiles: 'CC=O', formula: 'C2H4O', heavyAtoms: 3 }] },
      { index: 1, reaction: 'CC=O.[H][H]>>CCO', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [{ canonicalSmiles: 'CC=O', formula: 'C2H4O', heavyAtoms: 3 }, { canonicalSmiles: '[H][H]', formula: 'H2', heavyAtoms: 0 }], agents: [], products: [{ canonicalSmiles: 'CCO', formula: 'C2H6O', heavyAtoms: 3 }] },
    ],
    links: [{ from: 0, to: 1, ok: true, reason: 'carried', carried: [{ canonicalSmiles: 'CC=O', formula: 'C2H4O', heavyAtoms: 3 }], skeletonOnly: [] }],
  });
  assert.ok(audit);
  assert.equal(audit.continuous, false);
  const text = formatRouteAudit(audit);
  assert.match(text, /Route check \(RDKit\)/);
  assert.match(text, /- Step 1 FAIL — NOT balanced \(H: reactants 6, products 4\)\. C2H6O → C2H4O/);
  assert.match(text, /- Step 2 OK — balanced\./);
  assert.match(text, /- Step 1 → 2 OK — carried C2H4O/);
  assert.match(text, /Route blocked: Step 1 is not balanced/);
});

test('the continuity rule tells the model to reuse the same isomeric SMILES', () => {
  assert.match(ROUTE_CONTINUITY_SYSTEM_RULE, /isomeric SMILES/);
  assert.match(ROUTE_CONTINUITY_SYSTEM_RULE, /RDKit/);
});

test('a refused route yields a one-click fix request, a clean one yields none', () => {
  const refused = normalizeRouteAudit({
    continuous: false,
    blocked: ['Step 1: "[NaNH2]" — RDKit rejected the molecular graph.'],
    steps: [{ index: 0, reaction: 'C#C.CCBr>[NaNH2]>CC#C', ok: false, error: '"[NaNH2]" — RDKit rejected the molecular graph.', balanced: null, chargeBalanced: null, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }],
    links: [],
  });
  const fence = formatRouteFixPrompt(['C#C.CCBr>[NaNH2]>CC#C'], refused);
  assert.match(fence, /^```nodus-route-fix\n/);
  const payload = JSON.parse(fence.replace(/^```nodus-route-fix\n/, '').replace(/\n```$/, ''));
  assert.match(payload.prompt, /\[NaNH2\]/, 'the failing string is quoted');
  assert.match(payload.prompt, /reactants>agents>products/, 'and the required form is restated');
  assert.ok(payload.label);

  const clean = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [{ index: 0, reaction: 'CCO>>CC=O.[H][H]', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }],
    links: [],
  });
  assert.equal(formatRouteFixPrompt(['CCO>>CC=O.[H][H]'], clean), '');
});

test('a declared-racemic step is accepted and never offered as a fix', () => {
  const racemic = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [{ index: 0, reaction: 'CC(=O)CC.[H][H]>>CCC(C)O', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 1, racemic: true }],
    links: [],
  });
  assert.ok(racemic);
  assert.equal(formatRouteFixPrompt(['CC(=O)CC.[H][H]>>CCC(C)O'], racemic), '', 'a racemate is a stated outcome, not a fixable failure');
});

test('the fix prompt names the deficient side and the general rules', () => {
  const audit = normalizeRouteAudit({
    continuous: false, blocked: ['x'],
    steps: [
      { index: 0, reaction: 'A>>B', ok: true, balanced: false, chargeBalanced: false, differences: ['Na: reactants 2, products 1', 'H: reactants 9, products 10'], unspecifiedStereocentres: 0 },
      { index: 1, reaction: 'C>>D', ok: true, balanced: false, chargeBalanced: true, differences: ['The declared species admit more than one balanced equation; name the intended byproducts, or split this transformation into consecutive balanced steps.'], unspecifiedStereocentres: 0 },
      { index: 2, reaction: 'E>>F', ok: false, error: 'A step may name at most 12 species.', balanced: null, chargeBalanced: null, differences: [], unspecifiedStereocentres: 0 },
    ],
    links: [],
  });
  const fence = formatRouteFixPrompt(['A>>B', 'C>>D', 'E>>F'], audit);
  const payload = JSON.parse(fence.replace(/^```nodus-route-fix\n/, '').replace(/\n```$/, ''));
  assert.match(payload.prompt, /Na: the reactants carry 1 more — add the missing Na-containing byproduct/);
  assert.match(payload.prompt, /H: the products carry 1 more — add the missing H-containing reagent/);
  assert.match(payload.prompt, /neither consumed nor produced/, 'ambiguity names the culprit species');
  assert.match(payload.prompt, /a salt is one species per side/, 'the species-limit reason tells the model how to shrink it');
  assert.match(payload.prompt, /Every reactive group in a molecule reacts/, 'the general stoichiometry rule is present');
  assert.match(payload.prompt, /Write each ion of a salt once per side/, 'the counterion rule is present');
  assert.match(payload.prompt, /never reorder, merge or duplicate a step/, 'the order guard is present');
  assert.match(payload.prompt, /MAY split a rejected step into consecutive steps/, 'splitting a rejected step is allowed');
  assert.match(payload.prompt, /Write the organic product neutral/, 'the neutral-product rule is present');
  assert.match(payload.prompt, /do not repeat it unchanged/, 'the rejected line is not to be echoed verbatim');
});

test('a refused route becomes a route-fix part the interface can render', () => {
  const audit = normalizeRouteAudit({
    continuous: false,
    blocked: ['Step 1: "[NaNH2]" — RDKit rejected the molecular graph.'],
    steps: [{ index: 0, reaction: 'C#C.CCBr>[NaNH2]>CC#C', ok: false, error: '"[NaNH2]" — RDKit rejected the molecular graph.', balanced: null, chargeBalanced: null, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }],
    links: [],
  });
  const fence = formatRouteFixPrompt(['C#C.CCBr>[NaNH2]>CC#C'], audit);
  const answer = `The route was proposed.\n\n${fence}\n`;
  const parts = splitChatVisuals(answer);
  const part = parts.find(entry => entry.kind === 'route-fix');
  assert.ok(part, JSON.stringify(parts.map(entry => entry.kind)));
  assert.equal(part.complete, true, 'a finished fence is a renderable button');
  const payload = JSON.parse(part.content);
  assert.match(payload.prompt, /\[NaNH2\]/);
  assert.equal(payload.label, 'Ask the model to fix the failed steps');
  // It round-trips: an answer the app rewrites keeps the fence name.
  const rewritten = parts.map(serializeChatVisualPart).join('');
  assert.ok(splitChatVisuals(rewritten).some(entry => entry.kind === 'route-fix'), 'the fence survives a rewrite');
});

test('the synthesis template is applied only to chemistry synthesis requests', () => {
  assert.equal(looksLikeSynthesisRequest('Propose a step-by-step laboratory synthesis of (Z)-hex-3-ene (SMILES: CC/C=C\\CC), starting from acetylene (C#C) and bromoethane (CCBr).'), true);
  assert.equal(looksLikeSynthesisRequest('This is a chemistry synthesis question.'), true);
  assert.equal(looksLikeSynthesisRequest('Propose a step-by-step laboratory synthesis of 2-methylbutanoic acid from diethyl malonate.'), true);
  assert.equal(looksLikeSynthesisRequest('the synthesis of factions in this world'), false, 'another vault is not a chemistry question');
  assert.equal(looksLikeSynthesisRequest('hi'), false);
  assert.equal(looksLikeSynthesisRequest('Propose a synthesis.\n\nOutput format — follow exactly.\n1. Number every step.'), false, 'an already-templated message is left alone');
});

test('the template carries the exact contract the checker expects', () => {
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('`reactants>agents>products`'));
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('`[Na+].[NH2-]`'), 'the valid-SMILES examples survive escaping');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('CC/C=C\\CC'), 'a backslash in the example survives');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('\\\\.'), 'the JSON-escaping advice keeps its double backslash');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('Never omit a product or a reactant'));
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('true catalyst'), 'the agents field is for true catalysts only');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('MUST be a reactant or a product'), 'anything consumed or produced cannot hide above the arrow');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('A metal counterion balances too'), 'a metal must leave as a salt, not be stranded');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('O=C([O-])c1ccccc1O.[Na+]'), 'the sodium-salt example survives escaping');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('A metal base is consumed and its product is a salt'), 'a metal base makes a salt, not the free acid');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('One net transformation per equation'), 'a base and an acid are not mixed in one step');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('mass balance and charge balance'), 'every reaction must survive mass and charge balance');
  assert.ok(!SYNTHESIS_TEMPLATE_ADDENDUM.includes('ONE chemical transformation'), 'merging steps is no longer forbidden');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('word racemic'), 'a racemate can be declared instead of specified');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('chemistry-plan'));
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('each ion of a salt once per side'), 'a salt ion is written once per side');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('[Na+].[Na+]'), 'the doubled-counterion example is present');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('Write an organic product neutral'), 'the organic product is written neutral, not protonated');
  for (const blocked of ['nodus-view', 'nodus-artifact', 'nodus-capability-result']) {
    assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes(blocked), `the model must not author ${blocked} results`);
  }
});

test('a declared racemate is formatted as a caveat, not a refusal', () => {
  assert.equal(declaresRacemic('The final product is a racemic mixture.'), true);
  assert.equal(declaresRacemic('obtained as a single (R) enantiomer'), false);
  const audit = normalizeRouteAudit({
    steps: [{ index: 0, reaction: 'CC(=O)CC.[H][H]>>CCC(C)O', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 1, racemic: true }],
    links: [], continuous: true, blocked: [],
  });
  assert.ok(audit);
  const text = formatRouteAudit(audit);
  assert.match(text, /declared racemic/);
  assert.doesNotMatch(text, /unspecified stereocentre/);
});
