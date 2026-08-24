import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.resolve(process.argv[2] ?? path.join(repoRoot, 'reports/document-understanding-quality-audit.json'));
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const { comparisons, generative } = report;

assert.equal(report.ok, true, 'the live audit did not complete successfully');
assert.equal(report.source?.unchanged, true, 'the real Nodus profile changed during the audit');
assert.equal(comparisons?.qualityGate?.considerable, true, 'document retrieval did not clear its considerable-improvement gate');
assert.equal(comparisons?.qualityGate?.validCitations, true, 'Chat or Nodi emitted an unresolved citation');

assert.ok(comparisons.chat.passageRecall.relative >= 0.20, 'Chat passage recall did not improve materially');
assert.ok(comparisons.chat.strictWorkNdcg.absolute >= -0.01, 'Chat strict work ranking regressed');
assert.ok(comparisons.chat.after.meanFacetCoverage >= comparisons.chat.before.meanFacetCoverage, 'Chat facet coverage regressed');

assert.ok(comparisons.nodi.strictWorkNdcg.relative >= 0.20, 'Nodi strict work ranking did not improve materially');
assert.ok(comparisons.nodi.passageRecall.relative >= 0.20, 'Nodi passage recall did not improve materially');
assert.ok(comparisons.nodi.after.meanFacetCoverage >= comparisons.nodi.before.meanFacetCoverage, 'Nodi facet coverage regressed');

const deep = generative?.deepResearch?.comparison;
assert.ok(deep, 'the full Deep Research comparison is missing');
assert.equal(deep.current.citations.validRate, 1, 'Deep Research emitted an unresolved citation');
assert.ok(deep.citationDensity.relative >= 0.20, 'Deep Research citation density did not improve by at least 20%');
assert.ok(deep.facetCoverage.absolute >= 0, 'Deep Research facet coverage regressed');

const immersion = generative?.immersion?.scored;
assert.ok(immersion, 'the full Immersion audit is missing');
assert.equal(immersion.stoppedReason, null, 'Immersion stopped in degraded mode');
assert.ok(immersion.citations.length > 0, 'Immersion emitted no literal passage citations');
assert.ok(comparisons.surfaces.immersionWorks.ndcg.relative >= 0.20, 'Immersion work ranking did not improve materially');

assert.equal(report.databaseVerification.profileVersions, report.campaign.generativeFreeze.versionsBefore,
  'Deep Research or Immersion expanded the frozen profile sample');

console.log('Document-understanding quality acceptance test passed.');
