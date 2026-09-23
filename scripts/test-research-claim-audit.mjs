import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-claim-audit')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-claim-audit-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
// Verdict builders. `premise` defaults to an entailed literal fact.
const premise = (text, quote, extra = {}) => ({ text, type: 'fact', entailed: true, evidence: quote ? [{ id: extra.id ?? 'inside', quote }] : [], from: [], ...extra });
const verdict = (index, premises, extra = {}) => ({ index, kind: 'fact', premises, unsupportedParts: [], explicitInference: false, supported: true, reason: 'diagnostic', ...extra });
try {
  const shared = load('shared/researchClaimAudit.ts');
  const { researchProseSpans, applyResearchProseVerdicts, validResearchProseVerdicts, normalizeResearchProseVerdicts, reconcileResearchReport, dropResearchSentences, restatesRejectedClaim } = shared;
  const sources = [{ id: 'inside', text: 'The north field measured 23 units. The south field measured 7 units.', label: 'Synthetic source', citation: 'nodus://passage/inside' }];
  const north = premise('The north field measured 23 units', 'The north field measured 23 units.');

  // ── Baseline gates retained from the first ledger ─────────────────────────
  const text = '## Findings\nThe north field measured 23 units. The south field measured 99 units. No institution opposed the intervention.';
  assert.equal(researchProseSpans(text).length, 4, 'headings, uncited facts and negative claims are all audited');
  const result = applyResearchProseVerdicts(text, sources, [verdict(0, [], { kind: 'nonfactual' }), verdict(1, [north]),
    verdict(2, [premise('The south field measured 99 units', 'The south field measured 99 units.')]),
    verdict(3, [premise('No institution opposed the intervention', '', { type: 'absence', entailed: false })], { supported: false })]);
  assert.match(result.markdown, /23 units/);
  assert.match(result.markdown, /nodus:\/\/passage\/inside/);
  assert.doesNotMatch(result.markdown, /99 units|No institution/);
  assert.deepEqual(result.claims.map(claim => claim.status), ['supported', 'supported', 'removed', 'removed']);
  assert.equal(result.claims[2].failure, 'premise_without_literal_evidence', 'a paraphrased quote is not literal evidence');
  const repairedCitation = applyResearchProseVerdicts('The north field measured 23 units ([Old attribution](nodus://passage/foreign)).', sources, [verdict(0, [north])]);
  assert.equal(repairedCitation.markdown, 'The north field measured 23 units. [Synthetic source](nodus://passage/inside)', 'replacing an attribution leaves no empty citation parentheses');
  assert.equal(applyResearchProseVerdicts('An unsupported source.', sources, [verdict(0, [premise('x', sources[0].text, { id: 'foreign' })])]).claims[0].status, 'removed');
  // One malformed item leaves only its own sentence without a verdict.
  const normalized = normalizeResearchProseVerdicts({ claims: [verdict(0, [north]), verdict(1, [north]), verdict(1, [north]),
    verdict(2, [premise('a', 'The north field measured 23 units.', { type: 'inference', from: [0] })]),
    { index: 3, kind: 'fact', supported: true, explicitInference: false, evidence: [], reason: 'old shape' },
    verdict(4, [premise('short quote', 'north field')]), verdict(9, [north])] }, 5);
  assert.ok(normalized[0], 'a valid claim survives a malformed neighbour');
  assert.equal(normalized[1], undefined, 'duplicate indexes never cover omitted claims');
  assert.equal(normalized[2], undefined, 'a premise cannot support itself');
  assert.equal(normalized[3], undefined, 'verdicts without premises are malformed');
  assert.deepEqual(normalized[4].premises[0].evidence, [], 'an over-short quote is dropped, never accepted');
  assert.equal(applyResearchProseVerdicts('The north field measured 23 units.', sources, [normalized[4]]).claims[0].failure, 'premise_without_literal_evidence');
  assert.equal(normalized.length <= 5, true, 'indexes outside the batch are ignored');
  assert.equal(validResearchProseVerdicts({ claims: Array(9).fill({}) }), false, 'an oversized batch is rejected');
  const unavailable = applyResearchProseVerdicts(text, sources, []);
  assert.ok(unavailable.claims.every(claim => claim.status === 'unverified'));
  assert.equal(unavailable.markdown, '', 'judge failure cannot retain unverified factual prose');
  assert.equal(researchProseSpans('A fact [Doe, N. (2020)](nodus://passage/inside). Another fact.').length, 2, 'author initials cannot bypass sentence auditing');
  assert.equal(researchProseSpans('A fact. [Doe, N. (2020)](nodus://passage/inside) [Roe](nodus://passage/x) Another fact.').length, 2,
    'citations appended after final punctuation still end the sentence, so audited prose can be segmented again');
  // Live regression: a nested-quantifier lookbehind backtracked exponentially over
  // a long citation mask that did not follow terminal punctuation.
  const longCitation = `[${'Synthetic research source, p. 1'.repeat(4)}](nodus://passage/${'a'.repeat(200)})`;
  assert.equal(researchProseSpans(`A claim ${longCitation} ${longCitation} Next claim. ${longCitation} Final claim.`).length, 2,
    'segmentation stays linear and splits only after terminal punctuation');

  // ── Failures observed in the 23 September live review ─────────────────────
  // The fixtures use the reviewed sentences, but every decision below depends only
  // on the verdict structure, never on the corpus wording.
  const live = [
    { id: 'north', text: 'North field measured 23 units. The observation belongs only to the named field and was recorded after a controlled inspection.', label: 'Source 1', citation: 'nodus://passage/north' },
    { id: 'south', text: 'South field measured 41 units. SOUTH41 contradicts a uniform 23-unit result.', label: 'Source 2', citation: 'nodus://passage/south' },
    { id: 'east', text: 'The comparison reports missing controls. No measurement of the east field exists.', label: 'Source 3', citation: 'nodus://passage/east' },
  ];
  const south = premise('The second report records 41 units for the south field', 'South field measured 41 units.', { id: 'south', type: 'attribution' });
  const independence = premise('The second report is independent of the first', '', { type: 'relation', entailed: false });
  const independentSentence = 'El segundo informe, independiente del primero, registra «South field measured 41 units» ([Source 2](nodus://passage/south)).';
  // (a) supported=true while one presupposition is not entailed: the boolean loses.
  let audit = applyResearchProseVerdicts(independentSentence, live, [verdict(0, [south, independence], { kind: 'attributed', reason: 'La independencia no está respaldada.' })]);
  assert.equal(audit.claims[0].status, 'removed');
  assert.equal(audit.claims[0].failure, 'premise_not_entailed');
  assert.equal(audit.markdown, '', 'an unsupported appositive premise removes the whole compound sentence');
  // (b) the judge omits the premise but lists it as uncovered text.
  audit = applyResearchProseVerdicts(independentSentence, live, [verdict(0, [south], { kind: 'attributed', unsupportedParts: ['independiente del primero'] })]);
  assert.equal(audit.claims[0].failure, 'unsupported_parts', 'uncovered words cannot coexist with approval');
  // (c) premises all entailed, but the judge itself says unsupported: not a reliable approval either way.
  audit = applyResearchProseVerdicts(independentSentence, live, [verdict(0, [south], { kind: 'attributed', supported: false })]);
  assert.equal(audit.claims[0].status, 'removed');
  // (d) an inference resting on a presupposed "same declared protocol".
  const protocol = 'Cerrar esa laguna exigiría una fuente que registrara una medición del campo este bajo el mismo protocolo declarado, y ninguna de las tres disponibles lo hace.';
  const eastAbsent = premise('No measurement of the east field exists', 'No measurement of the east field exists.', { id: 'east', type: 'absence' });
  const sharedProtocol = premise('The sources declare a shared protocol', '', { type: 'relation', entailed: false });
  audit = applyResearchProseVerdicts(protocol, live, [verdict(0, [eastAbsent, sharedProtocol, premise('A new source would close the gap', '', { type: 'inference', from: [0, 1] })],
    { kind: 'inference', explicitInference: true })]);
  assert.equal(audit.claims[0].status, 'removed', 'an inference is only as supported as every premise it rests on');
  audit = applyResearchProseVerdicts(protocol, live, [verdict(0, [eastAbsent, sharedProtocol, premise('A new source would close the gap', '', { type: 'inference', from: [0], entailed: true })],
    { kind: 'inference', explicitInference: true, supported: false })]);
  assert.equal(audit.claims[0].status, 'removed', 'an unrelated unsupported premise still blocks the sentence');
  // (e) conclusions from silence: an absence needs a source that states it.
  audit = applyResearchProseVerdicts('Cada campo cuenta con una sola observación.', live, [verdict(0, [premise('Each field has one observation only', '', { type: 'absence' })])]);
  assert.equal(audit.claims[0].failure, 'premise_without_literal_evidence');
  // (f) an explicit, qualified inference over literal premises is kept and cited.
  audit = applyResearchProseVerdicts('Por tanto, el corpus no permite comparar el campo este con los otros dos.', live, [verdict(0,
    [eastAbsent, premise('The east field cannot be compared', '', { type: 'inference', from: [0] })], { kind: 'inference', explicitInference: true })]);
  assert.equal(audit.claims[0].status, 'supported');
  assert.match(audit.markdown, /nodus:\/\/passage\/east/);
  audit = applyResearchProseVerdicts('El corpus no permite comparar el campo este con los otros dos.', live, [verdict(0,
    [eastAbsent, premise('The east field cannot be compared', '', { type: 'inference', from: [0] })], { kind: 'fact' })]);
  assert.equal(audit.claims[0].failure, 'unqualified_inference', 'an inference presented as a fact is removed');
  // (g) "nonfactual" cannot smuggle a number or a citation.
  audit = applyResearchProseVerdicts('La diferencia es de 18 unidades.', live, [verdict(0, [], { kind: 'nonfactual' })]);
  assert.equal(audit.claims[0].failure, 'nonfactual_with_content');
  // (h) headings keep their evidence in the ledger instead of sprouting links.
  audit = applyResearchProseVerdicts('## El campo sur registra 41 unidades', live, [verdict(0, [south])]);
  assert.equal(audit.markdown, '## El campo sur registra 41 unidades');
  assert.equal(audit.claims[0].evidence.length, 1);
  // (i) a sentence restating a proposition rejected earlier in the report.
  assert.ok(restatesRejectedClaim(`Además, ${protocol.toLowerCase()}`, [protocol]));
  assert.ok(!restatesRejectedClaim('Esos límites son estrictos, sin duda.', ['Esos límites son estrictos.']), 'short transitions do not identify a proposition');
  assert.ok(!restatesRejectedClaim('North field measured 23 units.', [protocol]));
  audit = applyResearchProseVerdicts(protocol.replace('lo hace', 'la aporta'), live, [verdict(0, [eastAbsent])], [protocol]);
  assert.equal(audit.claims[0].failure, 'restates_rejected_claim', 'a later favourable verdict cannot revive a retired proposition');

  // ── Whole-report reconciliation ───────────────────────────────────────────
  const series = 'La ausencia de series temporales no puede afirmarse con estas fuentes.';
  const noSeries = 'Cada fuente registra una única observación, de modo que no existen series temporales.';
  const ledger = [
    { sentence: protocol, kind: 'inference', status: 'removed', evidence: [], reason: 'protocol', failure: 'premise_not_entailed' },
    { sentence: 'El balance del corpus, en consecuencia, resulta claramente asimétrico entre campos.', kind: 'inference', status: 'removed', evidence: [], reason: 'x' },
    { sentence: 'El balance del corpus, en consecuencia, resulta claramente asimétrico entre campos.', kind: 'inference', status: 'supported', evidence: [], reason: 'y' },
    { sentence: series, kind: 'nonfactual', status: 'supported', evidence: [], reason: 'limitation' },
    { sentence: noSeries, kind: 'inference', status: 'supported', evidence: [{ id: 'north', quote: 'North field measured 23 units.' }], reason: 'z' },
  ];
  const parts = {
    sections: [`## Campos\n\nNorth field measured 23 units. [Source 1](nodus://passage/north) ${noSeries} [Source 1](nodus://passage/north)`],
    abstract: `El balance del corpus, en consecuencia, resulta claramente asimétrico entre campos. [Source 3](nodus://passage/east) North field measured 23 units. [Source 1](nodus://passage/north)`,
    limitations: [series, `${protocol.replace('lo hace', 'lo proporciona')} [Source 3](nodus://passage/east)`],
    nextSteps: [],
  };
  let asked = [];
  const reconciled = await reconcileResearchReport(structuredClone(parts), ledger, async statements => {
    asked = statements;
    return [{ a: statements.indexOf(researchPlain(noSeries)), b: statements.indexOf(series), reason: 'absence asserted and declared unknowable' }];
  });
  function researchPlain(sentence) { return shared.researchPlainSentence(sentence); }
  assert.ok(!asked.some(statement => /asimétrico|protocolo/.test(statement)), 'retired propositions are removed before the consistency check');
  assert.doesNotMatch(reconciled.parts.abstract, /asimétrico/, 'the same sentence judged both ways keeps the removal');
  assert.match(reconciled.parts.abstract, /North field measured 23 units\. \[Source 1\]/);
  assert.deepEqual(reconciled.parts.limitations, [], 'limitations cannot reintroduce a retired proposition, and contradictory ones leave');
  assert.doesNotMatch(reconciled.parts.sections[0], /series temporales/, 'both statements of a contradiction are removed');
  assert.match(reconciled.parts.sections[0], /^## Campos\n\nNorth field measured 23 units\. \[Source 1\]\(nodus:\/\/passage\/north\)$/);
  assert.equal(reconciled.conflicts, 1);
  assert.deepEqual(reconciled.conflictPairs.map(pair => pair.reason), ['absence asserted and declared unknowable'], 'removed pairs remain reviewable');
  assert.ok(reconciled.consistencyChecked);
  assert.equal(ledger[2].status, 'removed');
  assert.equal(ledger[2].failure, 'restates_rejected_claim');
  assert.equal(ledger[4].failure, 'internal_contradiction');
  const unchecked = await reconcileResearchReport(structuredClone(parts), structuredClone(ledger), async () => { throw new Error('judge unavailable'); });
  assert.equal(unchecked.consistencyChecked, false, 'an unavailable consistency check is reported, not presented as passed');
  // Removals leave structure behind: repeated body sentences and transitions whose
  // paragraph no longer contains the claim they introduced.
  const structureLedger = [
    { sentence: 'Conviene distinguir dos situaciones que suelen confundirse.', kind: 'nonfactual', status: 'supported', evidence: [], reason: 'transition' },
    { sentence: 'Esto tiene una consecuencia directa sobre la lectura.', kind: 'nonfactual', status: 'supported', evidence: [], reason: 'transition' },
  ];
  const structured = await reconcileResearchReport({
    sections: ['## A\n\nConviene distinguir dos situaciones que suelen confundirse.\n\nNorth field measured 23 units. [S](nodus://passage/north)',
      '## B\n\nNorth field measured 23 units. [S](nodus://passage/north) Esto tiene una consecuencia directa sobre la lectura. South field measured 41 units.'],
    abstract: 'North field measured 23 units. Conviene distinguir dos situaciones que suelen confundirse.', limitations: [], nextSteps: ['Conviene distinguir dos situaciones que suelen confundirse.'] }, structureLedger, async () => []);
  assert.equal(structured.parts.sections[0], '## A\n\nNorth field measured 23 units. [S](nodus://passage/north)', 'a transition cut off from its paragraph goes');
  assert.equal(structured.parts.sections[1], '## B\n\nEsto tiene una consecuencia directa sobre la lectura. South field measured 41 units.', 'a repeated body sentence keeps its first occurrence; a live transition stays');
  assert.equal(structured.parts.abstract, 'North field measured 23 units.', 'the abstract may repeat the body but not end on a dangling transition');
  assert.deepEqual(structured.parts.nextSteps, ['Conviene distinguir dos situaciones que suelen confundirse.'], 'next steps are directives, not transitions');
  assert.equal(structured.pruned, 3);
  assert.ok(structureLedger.every(claim => claim.status === 'supported'), 'structural pruning never records a factual removal');
  assert.equal(dropResearchSentences('A. [S](nodus://passage/a)  B follows.', plain => plain === 'A.').markdown, 'B follows.', 'a dropped sentence takes its citations and spacing');

  // ── Orchestrator: summaries, limitations and next steps are reconciled too ─
  const { orchestrateDeepResearch, fallbackPlan } = load('electron/ai/deepResearchCore.ts');
  const request = { objective: 'What can this corpus establish?', language: 'es', deepResearchVersion: 'v2', sectionLimit: 'single' };
  const snapshot = { generatedAt: new Date().toISOString(), brief: {}, ideas: [], passages: [], works: [], themes: [], gaps: [], contradictions: [], tutorRoutes: [], stats: {}, recommendedSelection: {} };
  let generated = 0;
  const resultWithoutEvidence = await orchestrateDeepResearch(request, { strictDocumentaryGrounding: true, buildSnapshot: async () => snapshot,
    planReport: async () => { generated++; throw new Error('must not plan empty evidence'); }, writeSection: async () => { generated++; return 'invented'; }, finalize: async () => { generated++; throw new Error('must not summarize empty evidence'); } });
  assert.equal(generated, 0);
  assert.equal(resultWithoutEvidence.meta.sections, 0);
  assert.equal(resultWithoutEvidence.meta.structure, 'single', 'abstention preserves the requested output contract');
  assert.deepEqual(resultWithoutEvidence.draft.outline, []);
  assert.match(resultWithoutEvidence.draft.draftMarkdown, /evidencia disponible no permite/);
  assert.equal(resultWithoutEvidence.draft.stats.truncated, true);
  const passages = live.map(source => ({ id: source.id, nodus_id: `work-${source.id}`, label: source.label, summary: source.text, score: 1, reason: 'fixture',
    pageLabel: '1', authors: [], year: null, zotero_key: '', citation: `nodus://passage/${source.id}` }));
  const evidenceSnapshot = { ...snapshot, passages, works: passages.map(item => ({ id: item.nodus_id, label: item.label, summary: '', score: 1, reason: 'fixture', title: item.label, authors: [], year: null, zotero_key: '' })) };
  const plan = fallbackPlan(request, { ...snapshot, passages: [{ id: 'p1', nodus_id: 'work', summary: sources[0].text }] }, 6);
  assert.equal(plan.sections.length, 1, 'a passage-only corpus needs no invented empty idea sections');
  assert.deepEqual(plan.sections[0].passageIds, ['p1']);
  // A deterministic stand-in judge: it recognizes sentences by their own verdict
  // table, exactly as the real judge returns one verdict per supplied sentence.
  const table = new Map([
    ['North field measured 23 units.', verdict(0, [premise('north 23', 'North field measured 23 units.', { id: 'north' })])],
    ['South field measured 41 units.', verdict(0, [premise('south 41', 'South field measured 41 units.', { id: 'south' })])],
    ['Both reports are independent measurements under one declared protocol.', verdict(0, [independence, sharedProtocol], { supported: false })],
    ['The two reports are independent measurements under one declared protocol, so the comparison is sound.', verdict(0, [south], { reason: 'lenient', supported: true })],
    ['No temporal series exist in these sources.', verdict(0, [premise('no series', 'No measurement of the east field exists.', { id: 'east', type: 'absence' })])],
    ['Whether temporal series exist cannot be established from these sources.', verdict(0, [premise('unknowable', 'The comparison reports missing controls.', { id: 'east' })])],
  ]);
  const judge = (consistency) => {
    const ledgerRun = { sentences: [] };
    return {
      async auditFactualProse(markdown) {
        const verdicts = researchProseSpans(markdown).map(span => {
          const found = table.get(shared.researchPlainSentence(span.text)) ?? (/^#/.test(span.text.trim()) ? verdict(0, [], { kind: 'nonfactual' }) : undefined);
          return found && { ...found, index: 0 };
        });
        const audit = applyResearchProseVerdicts(markdown, live, verdicts, ledgerRun.sentences);
        audit.claims.filter(claim => claim.status !== 'supported' && claim.kind !== 'nonfactual').forEach(claim => ledgerRun.sentences.push(shared.researchPlainSentence(claim.sentence)));
        return audit;
      },
      auditReportConsistency: consistency,
    };
  };
  const run = async (consistency) => orchestrateDeepResearch({ ...request, sectionLimit: undefined }, { strictDocumentaryGrounding: true, ...judge(consistency),
    buildSnapshot: async () => evidenceSnapshot,
    planReport: async () => ({ title: 'Fixture', abstract: '', sections: [{ id: 's1', title: 'Fields', purpose: 'compare', keyClaims: ['compare'], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: ['north', 'south', 'east'] }] }),
    writeSection: async () => '## Fields\n\nNorth field measured 23 units. South field measured 41 units. Both reports are independent measurements under one declared protocol. No temporal series exist in these sources.',
    finalize: async () => ({ title: 'Fixture', abstract: 'North field measured 23 units. The two reports are independent measurements under one declared protocol, so the comparison is sound.',
      limitations: ['Whether temporal series exist cannot be established from these sources.'], nextSteps: [] }) });
  const report = await run(async statements => {
    const a = statements.indexOf('No temporal series exist in these sources.'), b = statements.indexOf('Whether temporal series exist cannot be established from these sources.');
    return a >= 0 && b >= 0 ? [{ a, b, reason: 'contradiction' }] : [];
  });
  const whole = [report.draft.draftMarkdown, report.draft.abstract, ...report.draft.limitations, ...report.draft.nextSteps].join('\n');
  assert.doesNotMatch(whole, /independent/, 'the finalizer cannot reintroduce a premise retired in the body, even when a lenient verdict approves it');
  assert.doesNotMatch(whole, /temporal series/, 'contradictory statements across body and limitations both leave');
  assert.match(report.draft.draftMarkdown, /North field measured 23 units\./);
  assert.match(report.draft.draftMarkdown, /South field measured 41 units\./);
  assert.equal(report.meta.factualAudit.consistency.checked, true);
  assert.equal(report.meta.factualAudit.consistency.conflicts, 1);
  assert.equal(report.meta.factualAudit.consistency.pairs.length, 1);
  assert.equal(report.draft.stats.truncated, true, 'a reconciled answer is marked partial');
  assert.ok(report.draft.claimLedger.some(claim => claim.failure === 'restates_rejected_claim'));
  assert.ok(report.draft.claimLedger.some(claim => claim.failure === 'internal_contradiction'));
  assert.equal(report.draft.qualityAssessment.grade === 'strong', false, 'automatic grading never reports acceptance');
  const failedCheck = await run(async () => { throw new Error('consistency judge unavailable'); });
  assert.equal(failedCheck.meta.factualAudit.consistency.checked, false);
  assert.ok(failedCheck.draft.limitations.some(item => /coherencia interna/.test(item)), 'an unchecked report says so');
  console.log('Claim ledger: atomic premises, verdict agreement, silence, qualified inference, retired-claim carry-over, whole-report contradictions and orchestration passed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
