import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [baselineRoot, extensionRoot, campaignRoot, output] = process.argv.slice(2);
if (![baselineRoot, extensionRoot, campaignRoot, output].every(value => value && path.isAbsolute(value))) throw new Error('Pass absolute baseline, extension, campaign and output paths');
const read = (root, name) => JSON.parse(fs.readFileSync(path.join(root, 'artifacts', name), 'utf8'));
const ledger = read(campaignRoot, 'cost-ledger.json');
const costs = calls => ({ calls: calls.length, accountedUpperBoundUsd: calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0),
  unresolvedReservations: calls.filter(call => call.actualUsd === null).length,
  inputTokens: calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0), outputTokens: calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0) });
function summarize(root) {
  const run = read(root, 'live-campaign.json');
  if (!run.completedAt) throw new Error(`Incomplete campaign: ${root}`);
  const samples = read(root, 'live-process-metrics.json');
  const sums = samples.map(sample => ({ cpu: sample.processes.reduce((sum, item) => sum + (item.cpu?.percentCPUUsage ?? 0), 0),
    workingSetSize: sample.processes.reduce((sum, item) => sum + (item.memory?.workingSetSize ?? 0), 0) }));
  const files = fs.readdirSync(path.join(root, 'fixtures')).filter(name => /^source-\d+\.pdf$/.test(name)).sort();
  return { root, source: path.join(root, 'artifacts/live-campaign.json'), startedAt: run.startedAt, completedAt: run.completedAt,
    corpus: files.map(file => ({ file, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'fixtures', file))).digest('hex') })),
    models: run.models, preparation: run.preparation ?? read(root, 'live-preparation.json'),
    chat: run.checks.map(({ name, latencyMs, expectedAnswer, citationCount, citationsExist, knownEvidenceRetrieved, error }) => ({ name, latencyMs, expectedAnswer, citationCount, citationsExist, knownEvidenceRetrieved, error })),
    deepResearch: (run.deepResearchCases ?? []).map(item => ({ version: item.deepResearchVersion, approach: item.approach, latencyMs: item.latencyMs, error: item.error,
      verification: item.report?.meta?.verification, quality: item.report?.draft?.qualityAssessment,
      traversal: item.report?.draft?.researchTraversal, coverage: item.report?.meta?.coverage,
      claimAudit: item.report?.draft?.deepResearchStructure?.claimAudit ?? item.report?.meta?.claimAudit })),
    resources: { samples: sums.length, peakSummedWorkingSetSizeKiB: Math.max(0, ...sums.map(item => item.workingSetSize)),
      peakSummedProcessCpuPercent: Math.max(0, ...sums.map(item => item.cpu)),
      meanSummedProcessCpuPercent: sums.reduce((sum, item) => sum + item.cpu, 0) / Math.max(1, sums.length) },
    recordedWindowUsage: costs(ledger.calls.filter(call => call.reservedAt >= run.startedAt && call.reservedAt <= run.completedAt)) };
}
const baseline = summarize(baselineRoot), extension = summarize(extensionRoot);
if (JSON.stringify(baseline.corpus) !== JSON.stringify(extension.corpus)) throw new Error('Comparison requires identical PDF bytes');
const result = { generatedAt: new Date().toISOString(), baseCommit: 'f54995e7', baseline, extension, campaign: costs(ledger.calls),
  limitations: ['One synthetic three-document corpus and one run per engine; not a calibrated benchmark.',
    'Host load was shared with unrelated user processes. Latency and resource measurements are descriptive, not causal estimates.',
    'Citation existence, known-answer matching and claim support are distinct checks. A finished report is not a quality pass.',
    'Recorded-window usage excludes setup calls outside each run window. Campaign usage includes all paid attempts and retained reservations.',
    'Resource samples cover Electron processes returned by getAppMetrics, not Zotero or the separately owned provider gate.'] };
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(result, null, 2));
const rows = baseline.chat.map(before => {
  const after = extension.chat.find(item => item.name === before.name);
  return `| ${before.name} | ${(before.latencyMs / 1000).toFixed(2)} | ${after ? (after.latencyMs / 1000).toFixed(2) : '—'} | ${before.expectedAnswer === true} / ${after?.expectedAnswer === true} | ${before.citationsExist === true} / ${after?.citationsExist === true} |`;
});
const deepRows = [baseline, extension].flatMap((run, index) => run.deepResearch.map(item => `| ${index ? 'Extension' : 'Base'} | ${item.version} ${item.approach} | ${(item.latencyMs / 1000).toFixed(2)} | ${item.error ? 'Failed' : item.quality?.grade ?? 'Unrated'} | ${item.verification?.unsupported ?? '—'} | ${item.verification?.partial ?? '—'} |`));
fs.writeFileSync(path.join(output, 'comparison.md'), `# Research corpus comparison\n\nSame PDF SHA-256 hashes and exact provider models. Full source paths and measurements are in comparison.json.\n\n| Chat | Base seconds | Extension seconds | Known answer base / extension | Citation existence base / extension |\n|---|---:|---:|---|---|\n${rows.join('\n')}\n\n| Run | Deep Research | Seconds | Quality | Unsupported citations | Partial citations |\n|---|---|---:|---|---:|---:|\n${deepRows.join('\n')}\n\nShared campaign: ${result.campaign.calls} calls, $${result.campaign.accountedUpperBoundUsd.toFixed(6)} accounted upper bound, ${result.campaign.unresolvedReservations} unresolved reservations.\n\n${result.limitations.map(text => `- ${text}`).join('\n')}\n`);
console.log(JSON.stringify({ output, campaign: result.campaign, identicalCorpus: true }));
