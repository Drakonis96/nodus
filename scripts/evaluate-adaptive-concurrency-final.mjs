#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const runsDirectory = path.resolve(arg('--runs', ''));
assert.ok(fs.existsSync(runsDirectory), 'Falta --runs con las campañas finales.');

const files = (await fsp.readdir(runsDirectory)).filter((file) => file.endsWith('.json')).sort();
const runs = files
  .map((file) => ({ file, value: JSON.parse(fs.readFileSync(path.join(runsDirectory, file), 'utf8')) }))
  .filter((entry) => entry.value.schema === 'nodus-adaptive-raw-campaign/1');
const checks = [];
const failures = [];
const check = (condition, message, detail = null) => {
  checks.push({ pass: Boolean(condition), message, ...(detail == null ? {} : { detail }) });
  if (!condition) failures.push(message);
};
const sameSet = (left = [], right = []) => JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
const percentile = (values, ratio) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
};

check(runs.length === 4, 'Existen exactamente cuatro campañas: manual y automática para los dos proveedores.', runs.map((entry) => entry.file));
for (const { file, value: run } of runs) {
  check(run.corpusSelection?.count === 3 && run.corpusSelection?.keys?.length === 3, `${file}: selección determinista de tres papers.`);
  check(run.outcome?.status === 'completed', `${file}: campaña completa sin fallo terminal.`, run.outcome);
  check(run.sqliteIntegrity === 'ok', `${file}: SQLite integrity_check=ok.`);
  check(run.queue?.failed === 0 && run.queue?.done === run.queue?.total, `${file}: cola completa sin trabajos falsamente done.`);
  const campaign = run.documentIndex?.campaigns?.find((entry) => entry.status === 'completed');
  check(campaign?.totalJobs === 3 && campaign?.completedJobs === 3 && campaign?.failedJobs === 0, `${file}: tres perfiles documentales completos.`);
  check(run.qualityAudit?.pass === true && run.qualityAudit?.works === 3, `${file}: auditoría estructural aprobada.`);
  check(run.qualityAudit?.evidence?.explicitLiteralPrecision === 1, `${file}: 100% de citas explícitas localizadas en su página.`);
  check(Object.values(run.qualityAudit?.embeddings ?? {}).every((entry) => entry.total > 0 && entry.valid === entry.total && entry.invalid === 0),
    `${file}: todos los embeddings son finitos, no nulos y dimensionalmente válidos.`);
  check(run.qualityAudit?.profiles?.current === 3 && run.qualityAudit?.profiles?.audited === 3
    && run.qualityAudit?.profiles?.minimumQualityScore >= 0.8, `${file}: perfiles actuales y auditados con calidad mínima 0,8.`);
  check(JSON.stringify(run.sourceDatabaseHashes?.protected?.before) === JSON.stringify(run.sourceDatabaseHashes?.protected?.after),
    `${file}: ninguna base real protegida cambió.`);
  check(run.featureChecks?.semantic?.available && run.featureChecks.semantic.results > 0, `${file}: búsqueda semántica funcional.`);
  for (const feature of ['chat', 'nodi', 'writing']) {
    check(run.featureChecks?.[feature]?.chars > 0 && run.featureChecks?.[feature]?.citations?.total > 0
      && run.featureChecks?.[feature]?.citations?.invalid === 0, `${file}: ${feature} completo y sin citas internas inválidas.`);
  }
  check(run.featureChecks?.immersion?.stations > 0 && !run.featureChecks?.immersion?.stoppedReason
    && run.featureChecks?.immersion?.citations > 0 && run.featureChecks?.immersion?.invalidCitations === 0,
  `${file}: Immersion completo y con citas válidas.`);
  check(run.featureChecks?.deepResearch?.length === 3 && run.featureChecks.deepResearch.every((report) =>
    report.words > 0 && report.worksCited > 0 && !report.stoppedReason
    && report.citations?.total > 0 && report.citations?.invalid === 0
    && report.verification?.checked > 0 && report.verification?.unverified === 0),
  `${file}: tres informes Deep Research completos y con citas válidas.`);
}

const groups = runs.reduce((result, entry) => {
  const key = `${entry.value.provider}:${entry.value.model}`;
  (result[key] ??= []).push(entry);
  return result;
}, {});
const comparisons = {};
for (const [providerModel, entries] of Object.entries(groups)) {
  const manual = entries.find((entry) => entry.value.mode === 'manual')?.value;
  const automatic = entries.find((entry) => entry.value.mode === 'automatic')?.value;
  check(Boolean(manual && automatic), `${providerModel}: pareja manual/automática completa.`);
  if (!manual || !automatic) continue;
  check(manual.workingTreeStateHash === automatic.workingTreeStateHash, `${providerModel}: mismo candidato binario/lógico.`);
  check(manual.corpusManifestHash === automatic.corpusManifestHash
    && manual.promptBundleHash === automatic.promptBundleHash, `${providerModel}: mismos corpus y prompts.`);
  check(sameSet(manual.corpusSelection.keys, automatic.corpusSelection.keys), `${providerModel}: mismas obras.`);
  check(sameSet(manual.rootRequestHashes, automatic.rootRequestHashes), `${providerModel}: mismas solicitudes raíz de extracción.`);

  const manualQuality = new Map(manual.qualityAudit.papers.map((paper) => [paper.zotero_key, paper]));
  const automaticQuality = new Map(automatic.qualityAudit.papers.map((paper) => [paper.zotero_key, paper]));
  const coverage = manual.corpusSelection.keys.map((key) => ({
    key,
    ideaRatio: automaticQuality.get(key)?.ideas / manualQuality.get(key)?.ideas,
    evidenceRatio: automaticQuality.get(key)?.evidence / manualQuality.get(key)?.evidence,
  }));
  check(coverage.every((paper) => paper.ideaRatio >= 0.8), `${providerModel}: ninguna obra pierde más del 20% del recuento de ideas.`, coverage);
  check(coverage.every((paper) => paper.evidenceRatio >= 0.8), `${providerModel}: ninguna obra pierde más del 20% de cobertura de evidencia.`, coverage);
  const totalIdeasRatio = automatic.qualityAudit.papers.reduce((sum, paper) => sum + paper.ideas, 0)
    / manual.qualityAudit.papers.reduce((sum, paper) => sum + paper.ideas, 0);
  const totalEvidenceRatio = automatic.qualityAudit.papers.reduce((sum, paper) => sum + paper.evidence, 0)
    / manual.qualityAudit.papers.reduce((sum, paper) => sum + paper.evidence, 0);
  check(totalIdeasRatio >= 0.9 && totalEvidenceRatio >= 0.9, `${providerModel}: cobertura agregada automática ≥90% de manual.`, { totalIdeasRatio, totalEvidenceRatio });

  const manualP95 = percentile(manual.papers.map((paper) => paper.totalMs), 0.95);
  const automaticP95 = percentile(automatic.papers.map((paper) => paper.totalMs), 0.95);
  const indexingSpeedup = manual.indexingWindowMs / automatic.indexingWindowMs;
  const totalSpeedup = manual.totalMs / automatic.totalMs;
  check(indexingSpeedup >= 1.5, `${providerModel}: indexación de tres papers mejora al menos 1,5×.`, indexingSpeedup);
  check(automaticP95 <= manualP95 * 0.75, `${providerModel}: p95 lógico por paper mejora al menos 25%.`, { manualP95, automaticP95 });
  check(automatic.totalMs <= manual.totalMs, `${providerModel}: el flujo extendido completo no empeora.`, { manual: manual.totalMs, automatic: automatic.totalMs });
  comparisons[providerModel] = {
    manualTotalMs: manual.totalMs,
    automaticTotalMs: automatic.totalMs,
    totalSpeedup,
    totalReductionPercent: (1 - automatic.totalMs / manual.totalMs) * 100,
    manualIndexingWindowMs: manual.indexingWindowMs,
    automaticIndexingWindowMs: automatic.indexingWindowMs,
    indexingSpeedup,
    indexingReductionPercent: (1 - automatic.indexingWindowMs / manual.indexingWindowMs) * 100,
    manualPaperP95Ms: manualP95,
    automaticPaperP95Ms: automaticP95,
    totalIdeasRatio,
    totalEvidenceRatio,
  };
}

const expected = new Set(['gemini:gemini-2.5-flash-lite', 'deepseek:deepseek-v4-flash']);
check(Object.keys(groups).length === expected.size && Object.keys(groups).every((key) => expected.has(key)),
  'Solo se certifican Google Gemini 2.5 Flash Lite y DeepSeek V4 Flash directo.', Object.keys(groups));
const report = {
  schema: 'nodus-adaptive-final-verification/1',
  generatedAt: new Date().toISOString(),
  pass: failures.length === 0,
  failures,
  comparisons,
  checks,
  runs: runs.map((entry) => entry.file),
};
const output = path.resolve(arg('--out', path.join(runsDirectory, 'final-verification.json')));
await fsp.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
