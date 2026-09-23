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
try {
  const { researchProseSpans, applyResearchProseVerdicts, validResearchProseVerdicts } = load('shared/researchClaimAudit.ts');
  const sources = [{ id: 'inside', text: 'The north field measured 23 units. The south field measured 7 units.', label: 'Synthetic source', citation: 'nodus://passage/inside' }];
  const text = '## Findings\nThe north field measured 23 units. The south field measured 99 units. No institution opposed the intervention.';
  assert.equal(researchProseSpans(text).length, 4, 'headings, uncited facts and negative claims are all audited');
  const supported = { index: 0, kind: 'fact', supported: true, explicitInference: false, evidence: [{ id: 'inside', quote: 'The north field measured 23 units.' }], reason: 'literal source' };
  const result = applyResearchProseVerdicts(text, sources, [{ ...supported, kind: 'nonfactual', evidence: [] }, supported, { ...supported, index: 2, evidence: [{ id: 'inside', quote: 'The south field measured 99 units.' }] }, { ...supported, index: 3, supported: false, reason: 'Silence is not evidence of absence.' }]);
  assert.match(result.markdown, /23 units/);
  assert.match(result.markdown, /nodus:\/\/passage\/inside/);
  assert.doesNotMatch(result.markdown, /99 units|No institution/);
  assert.deepEqual(result.claims.map(claim => claim.status), ['supported', 'supported', 'removed', 'removed']);
  assert.equal(applyResearchProseVerdicts('An unqualified conclusion.', sources, [{ ...supported, kind: 'inference' }]).claims[0].status, 'removed');
  assert.equal(applyResearchProseVerdicts('An unsupported source.', sources, [{ ...supported, evidence: [{ id: 'foreign', quote: sources[0].text }] }]).claims[0].status, 'removed');
  assert.equal(validResearchProseVerdicts({ claims: [supported, supported] }), false, 'duplicate indexes never cover omitted claims');
  const unavailable = applyResearchProseVerdicts(text, sources, []);
  assert.ok(unavailable.claims.every(claim => claim.status === 'unverified'));
  assert.equal(unavailable.markdown, '', 'judge failure cannot retain unverified factual prose');
  const spans = researchProseSpans('A fact [Doe, N. (2020)](nodus://passage/inside). Another fact.');
  assert.equal(spans.length, 2, 'author initials cannot bypass sentence auditing');

  const { orchestrateDeepResearch, fallbackPlan } = load('electron/ai/deepResearchCore.ts');
  const request = { objective: 'What can this corpus establish?', language: 'en', deepResearchVersion: 'v2' };
  const snapshot = { generatedAt: new Date().toISOString(), brief: {}, ideas: [], passages: [], works: [], themes: [], gaps: [], contradictions: [], tutorRoutes: [], stats: {}, recommendedSelection: {} };
  let generated = 0;
  const resultWithoutEvidence = await orchestrateDeepResearch(request, { strictDocumentaryGrounding: true, buildSnapshot: async () => snapshot,
    planReport: async () => { generated++; throw new Error('must not plan empty evidence'); }, writeSection: async () => { generated++; return 'invented'; }, finalize: async () => { generated++; throw new Error('must not summarize empty evidence'); } });
  assert.equal(generated, 0);
  assert.equal(resultWithoutEvidence.meta.sections, 0);
  assert.deepEqual(resultWithoutEvidence.draft.outline, []);
  assert.match(resultWithoutEvidence.draft.draftMarkdown, /cannot support/);
  assert.equal(resultWithoutEvidence.draft.stats.truncated, true);
  const plan = fallbackPlan(request, { ...snapshot, passages: [{ id: 'p1', nodus_id: 'work', summary: sources[0].text }] }, 6);
  assert.equal(plan.sections.length, 1, 'a passage-only corpus needs no invented empty idea sections');
  assert.deepEqual(plan.sections[0].passageIds, ['p1']);
  console.log('Claim ledger: uncited facts, exact source anchors, absence claims, inference qualification, unavailable judge and evidence-free abstention passed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
