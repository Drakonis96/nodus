import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'molecule-inspection-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { findSmilesCandidates, findAnswerSpecies, normalizeMoleculeDossier, formatMoleculeDossier, formatStructureAudit, MOLECULE_DOSSIER_SYSTEM_RULE, findReactionLines, findStepConditions, declaresRacemic, normalizeRouteAudit, formatRouteAudit, formatRouteFixPrompt, ROUTE_CONTINUITY_SYSTEM_RULE, findRequestedTarget, requestedTargetFor, ROUTE_FIX_PROMPT_LEAD, findStepSpeciesLabels, findDuplicateRoleProblems, findStepEquationProblems, hasCheckerScaffolding, parseRouteConsistencyVerdict, parseRouteReview, formatRouteClarification, routeLabelNames, buildRouteConsistencyRequest, ROUTE_CONSISTENCY_SYSTEM, ROUTE_REPAIR_SYSTEM, countRouteSteps, findStepNamedSpecies, buildRouteSteps, annotateSpeciesSmiles, formatNameCorrectionNote, formatNamedRouteFixPrompts, formatMissingSpeciesPrompt, parseNameFeedback, ROUTE_NAME_FEEDBACK_SYSTEM, formatUnresolvedNameClarification } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
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

test('a names-first step backticking its role labels does not report the labels as molecules', () => {
  const answer = [
    '`Reactants:`phenol — `C1=CC=C(C=C1)O`;sodium hydroxide — `[OH-].[Na+]`',
    '`Products:`sodium phenoxide — `[O-]C1=CC=CC=C1.[Na+]`',
    '`Byproducts:`water — `O`',
    '`Agents:`water (solvent)',
  ].join('\n');
  const species = findAnswerSpecies(answer);
  for (const label of ['Reactants:', 'Products:', 'Byproducts:', 'Agents:']) {
    assert.ok(!species.includes(label), `role label leaked into species: ${JSON.stringify(species)}`);
  }
  assert.deepEqual(species, ['C1=CC=C(C=C1)O', '[OH-].[Na+]', '[O-]C1=CC=CC=C1.[Na+]', 'O']);
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
  assert.match(text, /\*\*Route not verified\*\* — 1 of 2 step\(s\) do not pass \(step 1\)\./);
  assert.match(text, /Not verified: Step 1 is not balanced/);
});

test('a route review blocks the verdict and is shown as a model finding', () => {
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [passingStep(0, 'a>>b')], links: [],
  });
  assert.ok(audit);
  const clean = formatRouteAudit(audit);
  assert.match(clean, /\*\*Route verified\*\*/);
  assert.doesNotMatch(clean, /Route review/);
  const review = parseRouteReview('{"status":"problems","problems":[{"step":1,"detail":"the Products line names a different compound than the target."}]}');
  assert.deepEqual(review, { status: 'problems', problems: [{ step: 1, detail: 'the Products line names a different compound than the target.' }] });
  const blockedText = formatRouteAudit(audit, [], review);
  assert.match(blockedText, /\*\*Route not verified\*\* — a route review raised 1 problem\(s\)\./);
  assert.match(blockedText, /### Route review \(model\)/);
  assert.match(blockedText, /- Step 1: the Products line names a different compound than the target\./);
  assert.match(blockedText, /Not verified: The route review raised 1 problem\(s\)\./);
});

test('an unreadable review is not a problem and never blocks', () => {
  assert.equal(parseRouteReview('sorry, I could not read the route'), null);
  assert.equal(parseRouteReview('{"status":"problems","problems":[]}'), null);
  assert.equal(parseRouteReview('{"status":"weird"}'), null);
  assert.deepEqual(parseRouteReview('here it is: {"status":"ok"}'), { status: 'ok', problems: [] });
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'a>>b')], links: [] });
  assert.ok(audit);
  assert.match(formatRouteAudit(audit, [], null), /\*\*Route verified\*\*/);
  // A review of `ok` does not block either.
  assert.match(formatRouteAudit(audit, [], parseRouteReview('{"status":"ok"}')), /\*\*Route verified\*\*/);
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

test('the template asks for names and roles only, and forbids the model from writing SMILES', () => {
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('systematic IUPAC name ONLY'));
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('Reactants:'), 'the role labels are spelled out');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('semicolons'), 'species are separated by semicolons');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('Do NOT write any SMILES'), 'the model is told not to author SMILES');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('Every step MUST end with the four labelled lines'), 'the species lists are mandatory');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('metal-oxo oxidation'), 'redox guidance is present');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('rearrangement or isomerisation'), 'rearrangement guidance is present');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('never your job'), 'the equation is the application\'s job');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('chemistry-plan'), 'the target plan is still requested');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('true catalyst'), 'the agents field is for true catalysts only');
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('racemic'), 'a racemate can be stated in the prose');
  // It must not invite a reaction line or a per-species SMILES example any more.
  assert.ok(!SYNTHESIS_TEMPLATE_ADDENDUM.includes('BALANCED reaction SMILES'));
  assert.ok(!/backticked/.test(SYNTHESIS_TEMPLATE_ADDENDUM), 'no backticked-SMILES instruction remains');
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

const fixPayload = (fence) => JSON.parse(fence.replace(/^```nodus-route-fix\n/, '').replace(/\n```$/, ''));
const passingStep = (index, reaction, products = []) => ({ index, reaction, ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products });
const species = (canonicalSmiles, formula) => ({ input: canonicalSmiles, canonicalSmiles, skeletonSmiles: canonicalSmiles, formula, charge: 0, heavyAtoms: 1, stereocentres: 0, unspecifiedStereocentres: 0 });

test('a route whose steps all pass but which is disconnected is still offered a fix', () => {
  const steps = ['O=C1CCCC1.BrBr>>O=C1C(Br)(Br)CC(Br)C1Br.Br', 'O=C1C=CC2(Br)C1C1C=CC2(Br)C1=O>>O=C(O)C1CC=CC1'];
  const audit = normalizeRouteAudit({
    continuous: false,
    blocked: ['Step 1 is disconnected: it neither uses an intermediate from an earlier step nor produces one used later.'],
    isolated: [0],
    steps: [passingStep(0, steps[0]), passingStep(1, steps[1])],
    links: [],
  });
  assert.deepEqual(audit.isolated, [0]);
  const prompt = fixPayload(formatRouteFixPrompt(steps, audit)).prompt;
  assert.ok(prompt.startsWith(ROUTE_FIX_PROMPT_LEAD));
  assert.match(prompt, /The route as a whole has these problems:/);
  assert.match(prompt, /Step 1 is disconnected/);
  assert.ok(prompt.includes(`Currently: \`${steps[0]}\``), 'the disconnected step is quoted');
  assert.match(prompt, /insert any missing step\(s\)/, 'the model may insert the missing steps');
  assert.doesNotMatch(prompt, /rejected these steps/, 'no step failed on its own');

  // An older package only writes the sentence; the step is still found.
  const legacy = normalizeRouteAudit({ ...audit, isolated: undefined });
  assert.equal(legacy.isolated, undefined);
  assert.match(fixPayload(formatRouteFixPrompt(steps, legacy)).prompt, /Step 1 is disconnected/);
});

test('a route that never forms the requested target is reported and offered a fix', () => {
  const steps = ['CCO>>CC=O.[H][H]'];
  const audit = normalizeRouteAudit({
    continuous: false,
    blocked: ['No step forms the target CC(=O)O (C2H4O2).'],
    steps: [passingStep(0, steps[0], [species('CC=O', 'C2H4O'), species('[H][H]', 'H2')])],
    links: [],
    target: { input: 'OC(C)=O', canonicalSmiles: 'CC(=O)O', formula: 'C2H4O2', formedAt: null, reason: 'not-formed' },
  });
  assert.equal(audit.target.reason, 'not-formed');
  assert.match(formatRouteAudit(audit), /Target `CC\(=O\)O` \(C2H4O2\): FAIL — no step forms it\./);
  const prompt = fixPayload(formatRouteFixPrompt(steps, audit)).prompt;
  assert.match(prompt, /never forms the requested target `CC\(=O\)O` \(C2H4O2\); its last step stops at `CC=O`, `\[H\]\[H\]`/);

  const formed = normalizeRouteAudit({ ...audit, continuous: true, blocked: [], target: { ...audit.target, canonicalSmiles: 'CC=O', formula: 'C2H4O', formedAt: 0, reason: 'formed' } });
  assert.match(formatRouteAudit(formed), /Target `CC=O` \(C2H4O\): formed in step 1\./);
  assert.equal(formatRouteFixPrompt(steps, formed), '', 'a formed target is not a failure');

  assert.equal(normalizeRouteAudit({ ...audit, target: { input: 'x', reason: 'made-up' } }).target, undefined, 'an unknown verdict is dropped');
});

test('an intermediate that changes stereochemistry between steps is offered a fix', () => {
  const steps = ['C/C=C\\C>>C/C=C/C', 'C/C=C\\C.[H][H]>>CCCC'];
  const audit = normalizeRouteAudit({
    continuous: false,
    blocked: ['Step 1 → 2: the intermediate has the same constitution but different stereochemistry or charge.'],
    steps: [passingStep(0, steps[0]), passingStep(1, steps[1])],
    links: [{ from: 0, to: 1, ok: false, reason: 'constitution-only', carried: [], skeletonOnly: [{ product: 'C/C=C/C', reactant: 'C/C=C\\C', skeletonSmiles: 'CC=CC' }] }],
  });
  const prompt = fixPayload(formatRouteFixPrompt(steps, audit)).prompt;
  assert.match(prompt, /Steps 1 → 2: the intermediate changes stereochemistry or charge/);
  assert.ok(prompt.includes('`C/C=C/C` is made but `C/C=C\\C` is used'));
});

test('the fix prompt no longer forbids the counterion it requires on both sides', () => {
  const audit = normalizeRouteAudit({
    continuous: false, blocked: ['x'],
    steps: [{ index: 0, reaction: 'A>>B', ok: true, balanced: false, chargeBalanced: true, differences: ['C: reactants 2, products 1'], unspecifiedStereocentres: 0 }],
    links: [],
  });
  const prompt = fixPayload(formatRouteFixPrompt(['A>>B'], audit)).prompt;
  assert.doesNotMatch(prompt, /Never put the same species on both sides/);
  assert.match(prompt, /the only species that appears on both sides is a salt's counterion/);
  assert.match(prompt, /Write each ion of a salt once per side/);
});

test('the requested target is read from the synthesis request', () => {
  assert.equal(findRequestedTarget('Propose a synthesis of tropinone (SMILES: CN1C2CCC1CC(=O)C2). You may use methylamine (CN).'), 'CN1C2CCC1CC(=O)C2');
  assert.equal(findRequestedTarget('Propose a step-by-step laboratory synthesis of sulfanilamide (4-aminobenzenesulfonamide, SMILES: Nc1ccc(cc1)S(N)(=O)=O), starting from benzene (c1ccccc1)'), 'Nc1ccc(cc1)S(N)(=O)=O');
  assert.equal(findRequestedTarget('Propose a synthesis of (Z)-hex-3-ene (SMILES: CC/C=C\\CC), starting from acetylene'), 'CC/C=C\\CC');
  assert.equal(findRequestedTarget('Synthesis of cubane, SMILES: `C12C3C4C1C5C2C3C45`.'), 'C12C3C4C1C5C2C3C45');
  assert.equal(findRequestedTarget('Propose a synthesis of aspirin starting from phenol (SMILES: Oc1ccccc1)'), null, 'a starting material is not the target');
  assert.equal(findRequestedTarget('Compare and contrast to this approach: Step 1 phenol, SMILES: Oc1ccccc1'), null);
  assert.equal(findRequestedTarget('What is the SMILES: of water?'), null);

  const request = 'Propose a synthesis of tropinone (SMILES: CN1C2CCC1CC(=O)C2).';
  const correction = `${ROUTE_FIX_PROMPT_LEAD}\n\nThe route checker rejected these steps: ...`;
  assert.equal(requestedTargetFor([request, correction, correction]), 'CN1C2CCC1CC(=O)C2', 'a correction keeps the target of the request it corrects');
  assert.equal(requestedTargetFor([request, 'are you saying the stereochemistry does not matter?']), null, 'a new question has its own (absent) target');
  assert.equal(requestedTargetFor([]), null);
});

// ---------------------------------------------------------------- IUPAC names in the route

test('species names are read with their SMILES and grouped into their steps', () => {
  const answer = [
    '### Step 1 — Oxidation',
    'Reagents and conditions: PCC, DCM.',
    '**Reactants:** ethanol — `CCO`',
    '**Products:** ethanal — `CC=O`; hydrogen — `[H][H]`',
    '### Step 2 — Reduction',
    '**Reactants:** ethanal — `CC=O`; hydrogen — `[H][H]`',
    '**Products:** ethanol — `CCO`',
  ].join('\n');
  const labels = findStepSpeciesLabels(answer, 2);
  assert.equal(labels.length, 2);
  assert.deepEqual(labels[0].map(entry => [entry.role, entry.name, entry.smiles]), [
    ['reactant', 'ethanol', 'CCO'],
    ['product', 'ethanal', 'CC=O'],
    ['product', 'hydrogen', '[H][H]'],
  ]);
  assert.deepEqual(labels[1].map(entry => entry.smiles), ['CC=O', '[H][H]', 'CCO']);
  assert.ok(labels.every(step => step.every(entry => entry.byproduct === false)));
});

test('a byproduct is a product with a flag, a parenthesised pair is read, and prose alone yields nothing', () => {
  const labelled = findStepSpeciesLabels(['**Products:** ethene — `C=C`', '**Byproducts:** water — `O`'].join('\n'), 1);
  assert.equal(labelled[0].length, 2);
  assert.equal(labelled[0][0].byproduct, false);
  assert.equal(labelled[0][1].role, 'product');
  assert.equal(labelled[0][1].byproduct, true);
  const paren = findStepSpeciesLabels('Reactants: ethanoic acid (`CC(=O)O`)', 1);
  assert.deepEqual(paren[0].map(entry => [entry.name, entry.smiles]), [['ethanoic acid', 'CC(=O)O']]);
  assert.deepEqual(findStepSpeciesLabels('Just prose, no species.', 1), [[]]);
  assert.deepEqual(findStepSpeciesLabels('**Reactants:** x — `CCO`', 0), []);
});

test('the route report shows the IUPAC names the answer gave', () => {
  const audit = normalizeRouteAudit({
    continuous: true, blocked: [],
    steps: [{ index: 0, reaction: 'CCO>>CC=O', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
      reactants: [{ input: 'CCO', canonicalSmiles: 'CCO', formula: 'C2H6O' }],
      agents: [],
      products: [{ input: 'CC=O', canonicalSmiles: 'CC=O', formula: 'C2H4O' }] }],
    links: [],
  });
  const labels = [[
    { role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' },
    { role: 'product', byproduct: false, name: 'ethanal', smiles: 'CC=O' },
  ]];
  const text = formatRouteAudit(audit, labels);
  assert.match(text, /ethanol \(C2H6O\) → ethanal \(C2H4O\)/);
  assert.equal(routeLabelNames(labels).get('CC=O'), 'ethanal');
});

test('a name that denotes another structure is reported, not silently accepted', () => {
  const audit = normalizeRouteAudit({
    continuous: false, blocked: [],
    steps: [{ index: 0, reaction: 'CCO>>CC=O', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
      reactants: [{ canonicalSmiles: 'CCO', formula: 'C2H6O', name: 'ethanal', nameOk: false }], agents: [], products: [] }],
    links: [],
  });
  const text = formatRouteAudit(audit);
  assert.match(text, /Species names that do not match their structure/);
  assert.match(text, /reactant "ethanal" denotes a different structure than `CCO`/);
});

test('a step whose supplied name denotes another structure fails the check and is not drawn', () => {
  const audit = normalizeRouteAudit({
    continuous: false, blocked: ['Step 1: the IUPAC name "ethanal" denotes a different structure than `CCO` (C2H6O).'],
    steps: [{ index: 0, reaction: 'CCO>>CC=O', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0,
      nameProblems: ['the IUPAC name "ethanal" denotes a different structure than `CCO` (C2H6O)'],
      reactants: [{ input: 'CCO', canonicalSmiles: 'CCO', formula: 'C2H6O', name: 'ethanal', nameOk: false }], agents: [], products: [] }],
    links: [],
  });
  assert.deepEqual(audit.steps[0].nameProblems, ['the IUPAC name "ethanal" denotes a different structure than `CCO` (C2H6O)']);
  const text = formatRouteAudit(audit);
  assert.match(text, /- Step 1 FAIL — balanced\. name check failed: the IUPAC name "ethanal"/);
  const prompt = fixPayload(formatRouteFixPrompt(['CCO>>CC=O'], audit)).prompt;
  assert.match(prompt, /rejected these steps:/);
  assert.match(prompt, /denotes a different structure/);
});

test('the fix prompt folds the name/prose problems into the same one-click correction', () => {
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'CCO>>CC=O')], links: [] });
  const fence = formatRouteFixPrompt(['CCO>>CC=O'], audit, ['- Step 1 product "ethanal" (`CC=O`): the prose says ethanol is oxidised.']);
  const payload = fixPayload(fence);
  assert.match(payload.prompt, /The route as a whole has these problems:/);
  assert.match(payload.prompt, /the prose says ethanol is oxidised/);
  assert.match(payload.prompt, /systematic IUPAC name beside the exact isomeric SMILES/, 'the repair rule is stated');
});

test('the consistency verdict is parsed defensively', () => {
  assert.equal(parseRouteConsistencyVerdict('no json here'), null);
  assert.equal(parseRouteConsistencyVerdict('{"status":"ok","problems":[]}').status, 'ok');
  const mismatch = parseRouteConsistencyVerdict('```json\n{"status":"mismatch","problems":[{"step":2,"role":"product","name":"propanone","smiles":"CC(=O)C","detail":"the prose says propan-2-ol"}]}\n```');
  assert.equal(mismatch.status, 'mismatch');
  assert.equal(mismatch.problems[0].step, 2);
  assert.equal(mismatch.problems[0].role, 'product');
  assert.equal(parseRouteConsistencyVerdict('{"status":"mismatch","problems":[]}'), null, 'a mismatch with no problem is refused');
  assert.equal(parseRouteConsistencyVerdict('{"status":"ambiguous"}'), null, 'ambiguity needs a question');
  assert.equal(parseRouteConsistencyVerdict('{"status":"ambiguous","question":"which one?"}').status, 'ambiguous');
  assert.equal(parseRouteConsistencyVerdict('{"status":"other"}'), null);
});

test('the clarification is a route-fix part that names the species and asks', () => {
  const fence = formatRouteClarification(
    [{ step: 2, role: 'product', name: 'propanone', smiles: 'CC(=O)C', detail: 'the prose says propan-2-ol' }],
    'Did you mean propan-2-ol or propanone?',
  );
  const payload = fixPayload(fence);
  assert.equal(payload.label, 'Confirm the intended structure');
  assert.match(payload.prompt, /propanone/);
  assert.match(payload.prompt, /Did you mean propan-2-ol or propanone\?/);
  assert.ok(splitChatVisuals(fence).some(part => part.kind === 'route-fix'), 'the interface can render it');
});

// The estrone route that shipped: the step title promises the Torgov diene, but the
// Products entry is the pre-isomerisation methallyl ketone and the byproducts repeat the
// products. The labels are wrapped in backticks, which the first parser missed entirely.
const ESTRONE_STEP = [
  '**Step 1 — Preparation of the Torgov diene (3-methyl-2-(pent-3-en-2-yl)cyclopent-2-en-1-one) by alkylation of a cyclopentenone enolate.**',
  '',
  'The enolate of 3-methylcyclopent-2-en-1-one is alkylated with 3-bromo-2-methylprop-1-ene (methallyl bromide) under kinetic control; the resulting 2-methallyl ketone is then isomerised to the conjugated diene under base.',
  '',
  '1. Reagents and conditions: LDA (1.05 equiv), THF, −78 °C, 30 min; then methallyl bromide (1.1 equiv), −78 °C → rt, 12 h; then DBU (1.2 equiv), 60 °C, 4 h.',
  '`Reactants:` 3-methylcyclopent-2-en-1-one — `CC1=CC(=O)CC1`; 3-bromo-2-methylprop-1-ene — `CC(=C)CBr`; lithium diisopropylamide — `CC(C)[N-]C(C)C.[Li+]`; 1,8-diazabicyclo[5.4.0]undec-7-ene — `C1CCC2=NCCCN2CC1`',
  '`Products:` 3-methyl-2-(2-methylprop-2-en-1-yl)cyclopent-2-en-1-one — `CC1=C(CC(=C)C)C(=O)CC1`; diisopropylamine — `CC(C)NC(C)C`; lithium bromide — `[Li+].[Br-]`',
  '`Byproducts:` diisopropylamine — `CC(C)NC(C)C`; lithium bromide — `[Li+].[Br-]`',
  '`Agents:` tetrahydrofuran — `C1CCOC1`',
  '',
  '`CC1=CC(=O)CC1.CC(=C)CBr.CC(C)[N-]C(C)C.[Li+].C1CCC2=NCCCN2CC1>>CC1=C(CC(=C)C)C(=O)CC1.CC(C)NC(C)C.[Li+].[Br-]`',
].join('\n');

test('a backtick-wrapped role label is read, and the labels group into their step', () => {
  const steps = findReactionLines(ESTRONE_STEP);
  assert.equal(steps.length, 1);
  const labels = findStepSpeciesLabels(ESTRONE_STEP, 1);
  assert.equal(labels.length, 1);
  const product = labels[0].find(entry => entry.role === 'product' && !entry.byproduct);
  assert.ok(product, 'the product label is read');
  assert.equal(product.name, '3-methyl-2-(2-methylprop-2-en-1-yl)cyclopent-2-en-1-one');
  assert.equal(product.smiles, 'CC1=C(CC(=C)C)C(=O)CC1');
  assert.ok(labels[0].some(entry => entry.byproduct), 'the byproducts are read');
  assert.equal(labels[0].filter(entry => entry.byproduct).length, 2);
});

test('a product repeated as a byproduct is a deterministic failure', () => {
  const labels = findStepSpeciesLabels(ESTRONE_STEP, 1);
  const problems = findDuplicateRoleProblems(labels);
  assert.ok(problems.length >= 1, JSON.stringify(problems));
  assert.ok(problems.some(problem => problem.smiles === 'CC(C)NC(C)C' && /product and byproduct/.test(problem.detail)), JSON.stringify(problems));
  assert.ok(problems.every(problem => problem.step === 1));
  // A clean step has no duplicate-role problem.
  assert.deepEqual(findDuplicateRoleProblems([[{ role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' }, { role: 'product', byproduct: false, name: 'ethanal', smiles: 'CC=O' }]]), []);
});

test('the species list and the reaction line are cross-checked deterministically', () => {
  const steps = findReactionLines(ESTRONE_STEP);
  const labels = findStepSpeciesLabels(ESTRONE_STEP, 1);
  const problems = findStepEquationProblems(steps, labels);
  // Tetrahydrofuran is named as an agent but the reaction line has an empty agents field.
  assert.equal(problems.length, 1, JSON.stringify(problems, null, 2));
  assert.equal(problems[0].smiles, 'C1CCOC1');
  assert.match(problems[0].detail, /agents field/);

  // A list and an equation that agree produce no problem; a missing name is flagged.
  const clean = findStepEquationProblems(
    ['CCO>>CC=O.[H][H]'],
    [[
      { role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' },
      { role: 'product', byproduct: false, name: 'ethanal', smiles: 'CC=O' },
      { role: 'product', byproduct: false, name: 'hydrogen', smiles: '[H][H]' },
    ]],
  );
  assert.deepEqual(clean, []);
  const missing = findStepEquationProblems(
    ['CCO>>CC=O.[H][H]'],
    [[{ role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' }, { role: 'product', byproduct: false, name: 'ethanal', smiles: 'CC=O' }]],
  );
  assert.equal(missing.length, 1, JSON.stringify(missing));
  assert.match(missing[0].detail, /no IUPAC name/);
  assert.match(missing[0].detail, /\[H\]\[H\]/);
});

test('a catalyst above the arrow need not be named, but a named agent must be in the equation', () => {
  // The flash route: `[Pd]` sits in the agents field and the Agents line names the catalyst
  // in prose with no SMILES. That is not a failure.
  const catalyst = findStepEquationProblems(
    ['CCC#CCC.[H][H]>[Pd]>CC/C=C\\CC'],
    [[
      { role: 'reactant', byproduct: false, name: 'hex-3-yne', smiles: 'CCC#CCC' },
      { role: 'reactant', byproduct: false, name: 'hydrogen', smiles: '[H][H]' },
      { role: 'product', byproduct: false, name: '(Z)-hex-3-ene', smiles: 'CC/C=C\\CC' },
    ]],
  );
  assert.deepEqual(catalyst, []);

  // A labelled agent that is not in the agents field is still a failure.
  const misplacedAgent = findStepEquationProblems(
    ['CCC#CCC.[H][H]>>CC/C=C\\CC'],
    [[
      { role: 'reactant', byproduct: false, name: 'hex-3-yne', smiles: 'CCC#CCC' },
      { role: 'reactant', byproduct: false, name: 'hydrogen', smiles: '[H][H]' },
      { role: 'agent', byproduct: false, name: 'palladium', smiles: '[Pd]' },
      { role: 'product', byproduct: false, name: '(Z)-hex-3-ene', smiles: 'CC/C=C\\CC' },
    ]],
  );
  assert.equal(misplacedAgent.length, 1, JSON.stringify(misplacedAgent));
  assert.match(misplacedAgent[0].detail, /agents field/);
});

test('the checker scaffolding from a leaked repair is recognised and rejected', () => {
  assert.equal(hasCheckerScaffolding('The proposed answer (the prose is authoritative and must not be changed):\nCCO>>CC=O'), true);
  assert.equal(hasCheckerScaffolding('[{"step":1,"reaction":"CCO>>CC=O","species":[]}]'), true);
  assert.equal(hasCheckerScaffolding('The steps and the species named in them:\n[]'), true);
  assert.equal(hasCheckerScaffolding('Reply with the corrected step(s): each species...'), true);
  // ordinary corrected prose is not scaffolding
  assert.equal(hasCheckerScaffolding('## Step 1 — oxidation\n\n`CCO>>CC=O.[H][H]`'), false);
  assert.equal(hasCheckerScaffolding(''), false);
});

test('the consistency request gives the model the prose and the named species to compare', () => {
  const labels = findStepSpeciesLabels(ESTRONE_STEP, 1);
  const request = buildRouteConsistencyRequest(ESTRONE_STEP, findReactionLines(ESTRONE_STEP), labels);
  assert.match(request, /Torgov diene/, 'the step prose is present');
  assert.match(request, /3-methyl-2-\(2-methylprop-2-en-1-yl\)cyclopent-2-en-1-one/, 'the named product is present');
  assert.match(ROUTE_CONSISTENCY_SYSTEM, /The species the prose states the step makes must be the product/);
  assert.match(ROUTE_CONSISTENCY_SYSTEM, /must not be listed under more than one role/);
  // Guardrails against the false positives that blocked otherwise-fine routes.
  assert.match(ROUTE_CONSISTENCY_SYSTEM, /ammonia is `N`/, 'conventional simple-molecule SMILES are protected');
  assert.match(ROUTE_CONSISTENCY_SYSTEM, /Agents are catalysts, solvents and modifiers/, 'agents need not match exact speciation');
  assert.match(ROUTE_CONSISTENCY_SYSTEM, /never invent a disagreement/, 'the checker is instructed to be conservative');
});

test('the template asks for a systematic IUPAC name for every species and all four roles', () => {
  for (const role of ['Reactants:', 'Products:', 'Byproducts:', 'Agents:']) assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes(role));
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('systematic IUPAC name'));
  assert.ok(SYNTHESIS_TEMPLATE_ADDENDUM.includes('stereodescriptors'));
  assert.ok(ROUTE_CONSISTENCY_SYSTEM.includes('The prose is the fixed reference'));
  assert.ok(ROUTE_REPAIR_SYSTEM.includes('The prose is fixed'));
});

// ---------------------------------------------------------------- name-first derivation

const NAMED_ANSWER = [
  '**Step 1 — Monoalkylation of acetylene**',
  'Reactants: acetylene; sodium amide; bromoethane',
  'Products: but-1-yne',
  'Byproducts: ammonia; sodium bromide',
  'Agents: none',
  '',
  '**Step 2 — Lindlar semihydrogenation**',
  'Reactants: hex-3-yne; hydrogen',
  'Products: (Z)-hex-3-ene',
  'Agents: Lindlar catalyst',
].join('\n');

test('the step count comes from the headings or the role cycle', () => {
  assert.equal(countRouteSteps(NAMED_ANSWER), 2);
  assert.equal(countRouteSteps('Reactants: ethanol\nProducts: ethanal\nByproducts: hydrogen'), 1);
  assert.equal(countRouteSteps('Reactants: a\nProducts: b\nReactants: b\nProducts: c'), 2);
  assert.equal(countRouteSteps('no steps here'), 0);
});

test('a non-step section such as an alternative is neither counted nor grouped as a step', () => {
  const answer = [
    '**Step 1 — a**', 'Reactants: acetylene', 'Products: but-1-yne',
    '**Step 2 — b**', 'Reactants: but-1-yne', 'Products: hex-3-yne',
    '**Step 3 — c**', 'Reactants: hex-3-yne; hydrogen', 'Products: (Z)-hex-3-ene',
    '## Alternative for Step 3', 'Reactants: hex-3-yne; benzenesulfonylhydrazide', 'Products: (Z)-hex-3-ene',
  ].join('\n');
  assert.equal(countRouteSteps(answer), 3, 'the alternative does not become step 4');
  const species = findStepNamedSpecies(answer, 3);
  assert.deepEqual(species[2].map((entry) => entry.name), ['hex-3-yne', 'hydrogen', '(Z)-hex-3-ene'], 'the alternative\'s species are not merged into step 3');
});

test('a prose summary heading and a species-list heading for the same step are one step', () => {
  const answer = [
    '**Step 1 — Oxidation**', 'Product: cyclohexanone.', '',
    '### Species lists', '',
    '**Step 1**',
    '- Reactants: cyclohexanol',
    '- Products: cyclohexanone',
    '- Byproducts: chromium(III) sulfate; water',
    '- Agents: none', '',
    '**Step 2**',
    '- Reactants: cyclohexanone',
    '- Products: cyclohexanone oxime',
    '- Byproducts: none (the salt is removed; the product is neutralised)',
    '- Agents: none',
  ].join('\n');
  assert.equal(countRouteSteps(answer), 2, 'the prose heading does not create a phantom step');
  const species = findStepNamedSpecies(answer, 2);
  assert.deepEqual(species[0].map((entry) => entry.name), ['cyclohexanol', 'cyclohexanone', 'chromium(III) sulfate', 'water']);
  assert.deepEqual(species[1].map((entry) => entry.name), ['cyclohexanone', 'cyclohexanone oxime'], 'the "none (…; …)" byproduct yields nothing');
});

test('named species are read per step, per role, without any SMILES', () => {
  const species = findStepNamedSpecies(NAMED_ANSWER, 2);
  assert.deepEqual(species[0].map((entry) => [entry.role, entry.name]), [
    ['reactant', 'acetylene'], ['reactant', 'sodium amide'], ['reactant', 'bromoethane'],
    ['product', 'but-1-yne'], ['product', 'ammonia'], ['product', 'sodium bromide'],
  ]);
  assert.ok(species[0].filter((entry) => entry.byproduct).every((entry) => entry.byproduct === true), 'byproducts are flagged');
  // "Agents: none" yields no agent entries.
  assert.equal(species[0].filter((entry) => entry.role === 'agent').length, 0);
  assert.deepEqual(species[1].map((entry) => entry.name), ['hex-3-yne', 'hydrogen', '(Z)-hex-3-ene', 'Lindlar catalyst']);
  // A legacy `name — `smiles`` pair keeps the name and the declared SMILES as a fallback.
  const legacy = findStepNamedSpecies('Reactants: ethanol — `CCO`\nProducts: ethanal — `CC=O`', 1);
  assert.equal(legacy[0][0].name, 'ethanol');
  assert.equal(legacy[0][0].declaredSmiles, 'CCO');
  // A prose sentence that begins with a singular "Product:" is not a species label.
  const prose = findStepNamedSpecies('Reactants: acetylene\nProducts: but-1-yne\nProduct: but-1-yne is the product formed.', 1);
  assert.deepEqual(prose[0].map((entry) => entry.name), ['acetylene', 'but-1-yne']);
});

test('in-place annotation does not split a longer name or touch headings and prose', () => {
  const answer = [
    '**Step 1 — Oxidation of cyclohexanol**',
    'Reactants: cyclohexanol',
    'Products: cyclohexanone oxime',
  ].join('\n');
  const species = [[
    { role: 'reactant', byproduct: false, name: 'cyclohexanol', status: 'resolved', smiles: 'C1CCC(CC1)O' },
    { role: 'product', byproduct: false, name: 'cyclohexanone oxime', status: 'resolved', smiles: 'C1CCC(=NO)CC1' },
  ]];
  const out = annotateSpeciesSmiles(answer, species);
  assert.match(out, /Products: cyclohexanone oxime — `C1CCC\(=NO\)CC1`/);
  assert.doesNotMatch(out, /cyclohexanone — /, 'the product name is not split');
  assert.match(out, /\*\*Step 1 — Oxidation of cyclohexanol\*\*/, 'the heading is untouched');
});

test('reaction lines are derived from resolved species, never the model', () => {
  const resolved = [[
    { role: 'reactant', byproduct: false, name: 'acetylene', status: 'resolved', smiles: 'C#C', source: 'pubchem' },
    { role: 'reactant', byproduct: false, name: 'sodium amide', status: 'resolved', smiles: '[NH2-].[Na+]', source: 'pubchem' },
    { role: 'product', byproduct: false, name: 'but-1-yne', status: 'resolved', smiles: 'CCC#C', source: 'pubchem' },
    { role: 'product', byproduct: true, name: 'ammonia', status: 'resolved', smiles: 'N', source: 'pubchem' },
    { role: 'agent', byproduct: false, name: 'tetrahydrofuran', status: 'resolved', smiles: 'C1CCOC1', source: 'pubchem' },
  ]];
  assert.deepEqual(buildRouteSteps(resolved), ['C#C.[NH2-].[Na+]>C1CCOC1>CCC#C.N']);
  // A step with no resolvable reactant cannot form an equation.
  assert.deepEqual(buildRouteSteps([[{ role: 'product', byproduct: false, name: 'x', status: 'unresolved' }]]), []);
});

test('an ion shared by two salts is written once per side so the balance is unique', () => {
  const sulfate = 'S(=O)(=O)([O-])[O-]';
  const resolved = [[
    { role: 'reactant', byproduct: false, name: 'sodium dichromate', status: 'resolved', smiles: '[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-].[Na+].[Na+]' },
    { role: 'reactant', byproduct: false, name: 'cyclohexanol', status: 'resolved', smiles: 'C1CCC(CC1)O' },
    { role: 'product', byproduct: false, name: 'chromium(III) sulfate', status: 'resolved', smiles: `${sulfate}.[Cr+3].${sulfate}.${sulfate}.[Cr+3]` },
    { role: 'product', byproduct: false, name: 'sodium sulfate', status: 'resolved', smiles: `${sulfate}.[Na+].[Na+]` },
  ]];
  const [step] = buildRouteSteps(resolved);
  assert.deepEqual(step.split('>')[2].split('.'), [sulfate, '[Cr+3]', '[Na+]'], 'sulfate, chromium and sodium each appear once');
});

test('the resolved SMILES is attached to the name in place, replacing any declared one', () => {
  const species = [[
    { role: 'reactant', byproduct: false, name: 'but-1-yne', status: 'resolved', smiles: 'CCC#C' },
    { role: 'product', byproduct: false, name: '(Z)-hex-3-ene', status: 'resolved', smiles: 'CC/C=C\\CC' },
  ]];
  const bare = annotateSpeciesSmiles('Reactants: but-1-yne\nProducts: (Z)-hex-3-ene', species);
  assert.match(bare, /but-1-yne — `CCC#C`/);
  assert.match(bare, /\(Z\)-hex-3-ene — `CC\/C=C\\CC`/);
  const legacy = annotateSpeciesSmiles('Reactants: but-1-yne — `C#CC`', species);
  assert.match(legacy, /but-1-yne — `CCC#C`/);
  assert.doesNotMatch(legacy, /C#CC/);
});

test('corrections are summarized for the user, and the feedback prompt parses', () => {
  assert.equal(formatNameCorrectionNote([]), '', 'nothing corrected prints nothing');
  assert.equal(formatNameCorrectionNote(['sodium but-1-ynide → sodium but-1-yn-1-ide']), 'Name corrections: sodium but-1-ynide → sodium but-1-yn-1-ide');
  assert.equal(formatNameCorrectionNote(['a → b', 'a → b']), 'Name corrections: a → b', 'duplicates collapse');

  const parsed = parseNameFeedback('{"names":[{"from":"sodium but-1-ynide","to":"sodium but-1-yn-1-ide"}]}');
  assert.deepEqual(parsed, [{ from: 'sodium but-1-ynide', to: 'sodium but-1-yn-1-ide' }]);
  assert.deepEqual(parseNameFeedback('not json'), []);
  assert.ok(ROUTE_NAME_FEEDBACK_SYSTEM.includes('sodium but-1-yn-1-ide'), 'the systematic salt example is in the prompt');

  const fence = formatUnresolvedNameClarification([{ step: 1, role: 'reactant', byproduct: false, name: 'sodium but-1-ynide', feedback: 'PubChem has no exact match.' }]);
  const payload = fixPayload(fence);
  assert.equal(payload.label, 'Confirm the intended structure');
  assert.match(payload.prompt, /sodium but-1-ynide/);
});

const routeFixChips = (text) => splitChatVisuals(text).filter((part) => part.kind === 'route-fix').map((part) => JSON.parse(part.content));

test('a route derived from names is corrected with a names-only chip set, never a SMILES', () => {
  const labels = [[
    { role: 'reactant', byproduct: false, name: 'phenol', smiles: 'Oc1ccccc1' },
    { role: 'reactant', byproduct: false, name: 'sodium hydroxide', smiles: '[Na+].[OH-]' },
    { role: 'product', byproduct: false, name: 'sodium phenoxide', smiles: '[Na+].[O-]c1ccccc1' },
    { role: 'agent', byproduct: false, name: 'water', smiles: 'O' },
  ]];
  const audit = normalizeRouteAudit({
    continuous: false, blocked: ['Step 1 is not balanced.'],
    steps: [{ index: 0, reaction: 'x', ok: true, balanced: false, chargeBalanced: true, differences: ['H: reactants 7, products 8'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }],
    links: [],
  });
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit));
  assert.deepEqual(chips.map((chip) => chip.label), ['Ask the model to fix the failed steps', 'Fix from the target backwards', 'Fix step 1']);
  for (const chip of chips) {
    assert.match(chip.prompt, /Do not write SMILES/);
    assert.doesNotMatch(chip.prompt, /oc1ccccc1|\[Na\+\]\.\[OH-\]/, 'no derived SMILES is shown to the model');
  }
  assert.match(chips[0].prompt, /Reactants: phenol; sodium hydroxide/);
  assert.match(chips[0].prompt, /Products: sodium phenoxide/);
  assert.match(chips[0].prompt, /insert, remove, split or merge/, 'fix-all may re-plan');
  assert.match(chips[1].prompt, /Work backwards from the final step/);
  assert.match(chips[2].prompt, /Step 1 was rejected: not balanced/);
  assert.match(chips[2].prompt, /You may split step 1 into consecutive steps, or combine it with an adjacent step/);
  // A route whose steps all pass yields no chip.
  const clean = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'x')], links: [] });
  assert.equal(formatNamedRouteFixPrompts(labels, clean), '');
});

test('every flagged step gets a chip, emitted last-first, and passing steps get none', () => {
  const labels = Array.from({ length: 6 }, (_, index) => [
    { role: 'reactant', byproduct: false, name: `reactant ${index + 1}`, smiles: `C${index + 1}` },
    { role: 'product', byproduct: false, name: `product ${index + 1}`, smiles: `O${index + 1}` },
  ]);
  const audit = normalizeRouteAudit({
    continuous: false, isolated: [1],
    steps: [
      passingStep(0, 'a>>b'),
      { index: 1, reaction: 'b>>c', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] },
      passingStep(2, 'c>>d'),
      { index: 3, reaction: 'd>>e', ok: true, balanced: false, chargeBalanced: true, differences: ['C: reactants 9, products 8'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] },
      passingStep(4, 'e>>f'),
      { index: 5, reaction: 'f>>g', ok: true, balanced: false, chargeBalanced: true, differences: ['H: reactants 8, products 10'], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] },
    ],
    links: [],
  });
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit));
  assert.deepEqual(chips.map((chip) => chip.label), [
    'Ask the model to fix the failed steps',
    'Fix from the target backwards',
    'Fix step 6',
    'Fix step 4',
    'Fix step 2',
  ]);
  // The disconnected-but-balanced step 2 is offered; passing steps 3 and 5 are not.
  assert.match(chips[4].prompt, /Step 2 was rejected: disconnected from the rest of the route/);
  assert.match(chips[2].prompt, /Step 6 was rejected: not balanced/);
  assert.match(chips[2].prompt, /Step 5 Products: product 5/, 'the previous step is given as context');
  assert.match(chips[2].prompt, /It is the last step/, 'the last step is told to name the target');
  assert.match(chips[3].prompt, /Step 5 Reactants: reactant 5/, 'the next step is given as context');
});

test('a review-only block still offers chips, with the review findings folded in', () => {
  const labels = [[
    { role: 'reactant', byproduct: false, name: '2-hydroxybenzoic acid', smiles: 'O=C(O)c1ccccc1O' },
    { role: 'product', byproduct: false, name: '2-acetylsalicylic acid', smiles: 'CC(=O)C1(O)C=CC=CC1C(=O)O' },
  ], [
    { role: 'reactant', byproduct: false, name: 'starting material', smiles: 'C' },
    { role: 'product', byproduct: false, name: 'final product', smiles: 'CC' },
  ]];
  const audit = normalizeRouteAudit({ continuous: true, blocked: [], steps: [passingStep(0, 'a>>b'), passingStep(1, 'b>>c')], links: [] });
  const review = parseRouteReview(JSON.stringify({ status: 'problems', problems: [
    { step: 1, detail: '"2-acetylsalicylic acid" is a different compound than the requested target.' },
    { step: 0, detail: 'the route methylates and then demethylates without need.' },
  ] }));
  const chips = routeFixChips(formatNamedRouteFixPrompts(labels, audit, review));
  assert.deepEqual(chips.map((chip) => chip.label), ['Ask the model to fix the failed steps', 'Fix from the target backwards', 'Fix step 1']);
  assert.match(chips[0].prompt, /A model review of the route plan also reported:/);
  assert.match(chips[0].prompt, /Step 1: "2-acetylsalicylic acid" is a different compound/);
  assert.match(chips[0].prompt, /the route methylates and then demethylates without need\./);
  assert.match(chips[2].prompt, /Step 1 was rejected: review: "2-acetylsalicylic acid" is a different compound/);
});

test('a route with no species lists offers a one-click prompt to add them', () => {
  const fence = formatMissingSpeciesPrompt();
  const payload = fixPayload(fence);
  assert.equal(payload.label, 'Ask the model to list the species');
  assert.match(payload.prompt, /Reactants:/);
  assert.match(payload.prompt, /systematic IUPAC name/);
  assert.ok(splitChatVisuals(fence).some((part) => part.kind === 'route-fix'), 'the interface can render it');
});
