// Render the local-AI validation JSON into a readable Markdown summary.
// Usage: node scripts/local-ai-report-markdown.mjs [report.json] [report.md]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2] ?? path.join(root, 'audit', 'local-ai-gpu', 'report.json');
const output = process.argv[3] ?? input.replace(/\.json$/i, '.md');
const report = JSON.parse(fs.readFileSync(input, 'utf8'));

const lines = [];
lines.push('# Local AI runtime validation (issue #851)');
lines.push('');
lines.push(`- Started: ${report.startedAt ?? '—'}`);
lines.push(`- Finished: ${report.finishedAt ?? report.updatedAt ?? '—'}`);
lines.push(`- Machine: ${report.machine?.platform} ${report.machine?.arch}, ${report.machine?.cpu}, ${report.machine?.totalMemGiB} GiB RAM`);
lines.push(`- App version: ${report.appVersion ?? '—'}`);
lines.push(`- userData: \`${report.userData ?? '—'}\``);
lines.push(`- Corpus: ${(report.corpus ?? []).length} arXiv papers`);
lines.push('');

if (report.runtime) {
  lines.push('## Runtime detection');
  lines.push('');
  lines.push('| snapshot | asset | backend | device | VRAM | NVIDIA | offload | CPU only |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const [label, runtime] of Object.entries(report.runtime)) {
    const device = runtime.device ? `${runtime.device.backend}${runtime.device.index} ${runtime.device.name}` : '—';
    const nvidia = runtime.nvidia ? `${runtime.nvidia.detected ? 'yes' : 'no'}${runtime.nvidia.driver ? ` (${runtime.nvidia.driver})` : ''}` : '—';
    const offload = runtime.offload ? `${runtime.offload.layers}/${runtime.offload.totalLayers} layers${runtime.offload.fitted ? ' (fitted)' : ''}` : '—';
    lines.push(`| ${label} | ${runtime.asset ?? '—'} | ${runtime.backend ?? '—'} | ${device} | ${runtime.device ? `${runtime.device.totalMiB} MiB` : '—'} | ${nvidia} | ${offload} | ${runtime.processedOnCpu === null || runtime.processedOnCpu === undefined ? '—' : runtime.processedOnCpu ? 'yes' : 'no'} |`);
  }
  lines.push('');
}

if (report.downloads) {
  lines.push('## Model assets');
  lines.push('');
  lines.push('| model | verified in |');
  lines.push('|---|---|');
  for (const [model, info] of Object.entries(report.downloads)) {
    lines.push(`| ${model} | ${info.skipped ? 'already present' : `${Math.round((info.ms ?? 0) / 1000)} s`} |`);
  }
  lines.push('');
}

lines.push('## Per-model vaults');
lines.push('');
for (const [name, profile] of Object.entries(report.profiles ?? {})) {
  lines.push(`### ${name} — ${profile.vaultName}`);
  lines.push('');
  lines.push(`- Vault id: \`${profile.vaultId ?? '—'}\`${profile.vaultCreated ? ' (created for this run)' : ' (reused)'}`);
  lines.push(`- Imported works: ${profile.imported ?? 0}`);
  if (profile.queue) {
    lines.push(`- Queue: ${profile.queue.done}/${profile.queue.total} done, ${profile.queue.failed} failed${profile.queue.pausedReason ? `, paused: ${profile.queue.pausedReason}` : ''}`);
  }
  if (profile.reprocess) {
    lines.push(`- Theme/relation reprocessing: ${profile.reprocess.ok ? 'completed' : `refused — ${profile.reprocess.error}`}`);
  }
  if (profile.documentIndex) {
    lines.push(`- Document index: ${profile.documentIndex.jobs ?? 0} jobs, ${profile.documentIndex.failed ?? 0} failed`);
  }
  if (profile.embeddings) {
    lines.push(`- Idea embeddings: ${profile.embeddings.ideasEmbedded}/${profile.embeddings.totalIdeas}${profile.embeddings.error ? ` (error: ${profile.embeddings.error})` : ''}`);
  }
  if (profile.passageEmbeddings) {
    lines.push(`- Passage embeddings: ${profile.passageEmbeddings.passagesEmbedded}/${profile.passageEmbeddings.totalPassages}${profile.passageEmbeddings.error ? ` (error: ${profile.passageEmbeddings.error})` : ''}`);
  }
  if (profile.works?.length) {
    lines.push('');
    lines.push('| work | light | deep | summary | ideas | themes |');
    lines.push('|---|---|---|---|---|---|');
    for (const work of profile.works) {
      lines.push(`| ${work.title} | ${work.light} | ${work.deep} | ${work.summary} | ${work.ideas} | ${work.themes} |`);
    }
  }
  const runtime = report.runtime?.[`vault:${name}`];
  if (runtime?.offload) {
    lines.push('');
    lines.push(`- GPU placement during this vault: **${runtime.offload.layers}/${runtime.offload.totalLayers} layers on ${runtime.offload.deviceName}**${runtime.offload.projectedMiB ? `, projected ${runtime.offload.projectedMiB} MiB` : ''}${runtime.offload.fitted ? ', fitted to device memory' : ''}`);
  }
  if (profile.error) lines.push(`- **Error:** ${profile.error}`);
  lines.push('');
}

if (report.error) {
  lines.push('## Run error');
  lines.push('');
  lines.push('```');
  lines.push(report.error);
  lines.push('```');
  lines.push('');
}

fs.writeFileSync(output, `${lines.join('\n')}\n`, 'utf8');
console.log(`wrote ${output}`);
