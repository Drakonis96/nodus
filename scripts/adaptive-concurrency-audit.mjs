#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusPath = path.join(root, 'audit/adaptive-concurrency/corpus.json');
const corpus = JSON.parse(await fsp.readFile(corpusPath, 'utf8'));
const command = process.argv[2] ?? 'verify';
const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const cache = path.resolve(arg('--cache', path.join(os.tmpdir(), 'nodus-adaptive-corpus-v1')));

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

function fileFor(paper) { return path.join(cache, `${paper.arxiv}.pdf`); }

async function download(paper) {
  await fsp.mkdir(cache, { recursive: true });
  const target = fileFor(paper);
  if (fs.existsSync(target) && sha256File(target) === paper.sha256) return target;
  const partial = `${target}.download`;
  const response = await fetch(paper.url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`${paper.arxiv}: HTTP ${response.status}`);
  const output = fs.createWriteStream(partial, { flags: 'w', mode: 0o600 });
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!output.write(Buffer.from(value))) await new Promise((resolve) => output.once('drain', resolve));
    }
    await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
  } catch (error) {
    output.destroy();
    throw error;
  }
  const digest = sha256File(partial);
  if (digest !== paper.sha256) throw new Error(`${paper.arxiv}: SHA-256 ${digest}, esperado ${paper.sha256}`);
  await fsp.rename(partial, target);
  return target;
}

async function pageCount(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fsp.readFile(file)), disableWorker: true }).promise;
  try { return pdf.numPages; } finally { await pdf.destroy(); }
}

async function verify(prepare = false) {
  const results = [];
  for (const paper of corpus.papers) {
    const file = prepare ? await download(paper) : fileFor(paper);
    assert.ok(fs.existsSync(file), `Falta ${file}; ejecuta prepare.`);
    const digest = sha256File(file);
    assert.equal(digest, paper.sha256, `${paper.arxiv}: cambió el PDF`);
    const pages = await pageCount(file);
    assert.equal(pages, paper.pages, `${paper.arxiv}: cambió el número de páginas`);
    results.push({ key: paper.key, arxiv: paper.arxiv, pages, sha256: digest, bytes: fs.statSync(file).size });
  }
  return results;
}

function zoteroItem(paper) {
  return { key: paper.key, version: 1, data: {
    key: paper.key, version: 1, itemType: 'journalArticle', title: paper.title,
    creators: [], date: String(paper.year), DOI: `10.48550/arXiv.${paper.arxiv.replace(/v\d+$/, '')}`,
    abstractNote: '', tags: [{ tag: 'nodus-adaptive-audit' }], collections: [],
    url: `https://arxiv.org/abs/${paper.arxiv.replace(/v\d+$/, '')}`, language: 'en',
    dateAdded: '2026-01-01 00:00:00', dateModified: '2026-01-01 00:00:00',
  } };
}

function zoteroAttachment(paper) {
  return { key: paper.attachmentKey, version: 1, data: {
    key: paper.attachmentKey, version: 1, parentItem: paper.key, itemType: 'attachment',
    title: `${paper.arxiv}.pdf`, filename: `${paper.arxiv}.pdf`, contentType: 'application/pdf',
    linkMode: 'linked_file', dateModified: '2026-01-01 00:00:00',
  } };
}

async function serve() {
  await verify(process.argv.includes('--prepare'));
  const paperCount = Number(arg('--paper-count', String(corpus.papers.length)));
  assert.ok(Number.isInteger(paperCount) && paperCount >= 1 && paperCount <= corpus.papers.length,
    `--paper-count debe estar entre 1 y ${corpus.papers.length}.`);
  const selectedPapers = corpus.papers.slice(0, paperCount);
  const byParent = new Map(selectedPapers.map((paper) => [paper.key, paper]));
  const byAttachment = new Map(selectedPapers.map((paper) => [paper.attachmentKey, paper]));
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const prefix = '/api/users/0';
    const json = (status, body, extra = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Last-Modified-Version': '1', ...extra });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === `${prefix}/groups` || url.pathname === `${prefix}/collections`) return json(200, [], { 'Total-Results': '0' });
    if (url.pathname === `${prefix}/items/top`) return json(200, selectedPapers.map(zoteroItem), { 'Total-Results': String(selectedPapers.length) });
    if (url.pathname === `${prefix}/items`) return json(200, selectedPapers.slice(0, Number(url.searchParams.get('limit') ?? 100)).map(zoteroItem), { 'Total-Results': String(selectedPapers.length) });
    const children = new RegExp(`^${prefix}/items/([^/]+)/children$`).exec(url.pathname);
    if (children) return json(200, byParent.has(children[1]) ? [zoteroAttachment(byParent.get(children[1]))] : []);
    const fulltext = new RegExp(`^${prefix}/items/([^/]+)/fulltext$`).exec(url.pathname);
    if (fulltext) return json(404, {}); // Force Nodus to parse the canonical PDF with page markers.
    const file = new RegExp(`^${prefix}/items/([^/]+)/file$`).exec(url.pathname);
    if (file && byAttachment.has(file[1])) {
      const target = fileFor(byAttachment.get(file[1]));
      // Nodus intentionally accepts only Zotero's local file redirect here: the PDF
      // stays inside the audited cache and citations are resolved against those exact
      // bytes, rather than silently downloading a second mutable network copy.
      response.writeHead(302, { Location: pathToFileURL(target).href });
      return response.end();
    }
    const item = new RegExp(`^${prefix}/items/([^/]+)$`).exec(url.pathname);
    if (item && byParent.has(item[1])) return json(200, zoteroItem(byParent.get(item[1])));
    if (item && byAttachment.has(item[1])) return json(200, zoteroAttachment(byAttachment.get(item[1])));
    return json(404, { error: 'fixture-not-found' });
  });
  const port = Number(arg('--port', '0'));
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).once('error', reject));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  process.stdout.write(`${JSON.stringify({
    ready: true,
    baseUrl: `http://127.0.0.1:${actualPort}/api`,
    corpus: corpusPath,
    cache,
    paperKeys: selectedPapers.map((paper) => paper.key),
  })}\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

async function summarize() {
  const directory = path.resolve(arg('--runs', ''));
  assert.ok(directory && fs.existsSync(directory), 'Falta --runs <directorio>.');
  const files = (await fsp.readdir(directory)).filter((file) => file.endsWith('.json')).sort();
  const runs = files.map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')));
  assert.ok(runs.length >= 2, 'Se necesitan ejecuciones manuales y automáticas.');
  const groups = runs.reduce((acc, run) => {
    const key = `${run.provider}:${run.model}:${run.mode}`;
    (acc[key] ??= []).push(run);
    return acc;
  }, {});
  const summary = Object.fromEntries(Object.entries(groups).map(([key, entries]) => {
    const times = entries.flatMap((entry) => entry.papers.map((paper) => paper.totalMs));
    return [key, { campaigns: entries.length, papers: times.length, p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), totalMs: entries.reduce((sum, entry) => sum + entry.totalMs, 0) }];
  }));
  for (const run of runs) {
    assert.equal(run.papers.length, 10, `${run.id}: no contiene diez papers`);
    assert.equal(run.completedChunks + run.checkpointedChunks, run.plannedChunks, `${run.id}: hay huecos de chunks`);
    assert.equal(run.invalidAcceptedJson, 0, `${run.id}: aceptó JSON inválido`);
    assert.equal(run.invalidEmbeddings, 0, `${run.id}: publicó embeddings inválidos`);
    assert.equal(run.sqliteIntegrity, 'ok', `${run.id}: SQLite integrity_check falló`);
  }
  const output = { schema: 'nodus-adaptive-summary/1', corpusSha256: sha256File(corpusPath), runs: files, groups: summary };
  const destination = path.resolve(arg('--out', path.join(directory, 'summary.json')));
  await fsp.writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function hashMultiset(values) {
  return [...values].sort().join('\n');
}

async function evaluate() {
  const directory = path.resolve(arg('--runs', ''));
  assert.ok(directory && fs.existsSync(directory), 'Falta --runs <directorio>.');
  const files = (await fsp.readdir(directory)).filter((file) => file.endsWith('.json')).sort();
  const runs = files.map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')))
    .filter((run) => run.schema === 'nodus-adaptive-campaign/1');
  const failures = [];
  const checks = [];
  const check = (condition, message, detail = null) => {
    checks.push({ pass: Boolean(condition), message, ...(detail == null ? {} : { detail }) });
    if (!condition) failures.push(message);
  };
  check(runs.length > 0, 'Hay campañas de auditoría legibles.');
  for (const run of runs) {
    check(run.papers?.length === 10, `${run.id}: contiene exactamente diez papers.`);
    check(run.completedChunks + run.checkpointedChunks === run.plannedChunks, `${run.id}: 100% de chunks completos o checkpointed.`);
    check(run.invalidAcceptedJson === 0, `${run.id}: cero JSON inválidos aceptados.`);
    check(run.invalidEmbeddings === 0, `${run.id}: cero embeddings inválidos publicados.`);
    check(run.terminalFailures === 0, `${run.id}: cero fallos terminales.`);
    check(run.sqliteIntegrity === 'ok', `${run.id}: SQLite integrity_check=ok.`);
    check(run.profileHashes?.before === run.profileHashes?.after, `${run.id}: el perfil real no cambió.`);
    check(run.papers?.every((paper) => paper.evidencePrecision === 1 && paper.citationPrecision === 1), `${run.id}: precisión de evidencias/citas del 100%.`);
    check(run.quality?.falseDistinctMerges === 0, `${run.id}: cero fusiones falsas de pares distintos.`);
    if (run.embeddings) {
      check(run.embeddings.validVectors === run.embeddings.expectedVectors, `${run.id}: 100% de vectores válidos.`);
      check(run.embeddings.minimumScalarBatchCosine >= 0.99999, `${run.id}: cosine escalar/batch ≥ 0,99999.`);
      check(Math.abs(run.embeddings.retrievalMetricRegression) <= 0.01, `${run.id}: regresión de recuperación por batch ≤ 0,01.`);
    }
    if (run.routingMode === 'controlled') {
      check((run.backendEffective ?? []).length > 0 && run.backendEffective.every((backend) => /deepinfra/i.test(backend)), `${run.id}: backend controlado permanece en DeepInfra.`);
    }
    if (run.routingMode === 'throughput') check((run.backendEffective ?? []).length > 0, `${run.id}: registra el backend efectivo.`);
  }

  const candidate = runs.filter((run) => run.build === 'candidate');
  const groups = candidate.reduce((acc, run) => {
    const host = run.host ? `${run.host.platform ?? ''}/${run.host.arch ?? ''}` : 'unspecified-host';
    const key = `${run.provider}:${run.model}:${run.routingMode}:${host}`;
    (acc[key] ??= []).push(run);
    return acc;
  }, {});
  const groupResults = {};
  for (const [key, entries] of Object.entries(groups)) {
    const manual = entries.filter((run) => run.mode === 'manual');
    const automatic = entries.filter((run) => run.mode === 'automatic');
    check(manual.length >= 3, `${key}: al menos tres campañas manuales.`);
    check(automatic.length >= 3, `${key}: al menos tres campañas automáticas.`);
    const pairIds = new Set([...manual, ...automatic].map((run) => run.pairId));
    for (const pairId of pairIds) {
      const left = manual.find((run) => run.pairId === pairId);
      const right = automatic.find((run) => run.pairId === pairId);
      check(Boolean(left && right), `${key}/${pairId}: pareja A/B completa.`);
      if (left && right) check(hashMultiset(left.requestHashes) === hashMultiset(right.requestHashes), `${key}/${pairId}: conjunto idéntico de hashes de solicitudes.`);
    }
    if (!manual.length || !automatic.length) continue;
    const manualTotal = percentile(manual.map((run) => run.totalMs), 0.5);
    const automaticTotal = percentile(automatic.map((run) => run.totalMs), 0.5);
    const manualPaperP95 = percentile(manual.flatMap((run) => run.papers.map((paper) => paper.totalMs)), 0.95);
    const automaticPaperP95 = percentile(automatic.flatMap((run) => run.papers.map((paper) => paper.totalMs)), 0.95);
    const speedup = manualTotal / automaticTotal;
    const p95Reduction = 1 - automaticPaperP95 / manualPaperP95;
    check(automaticTotal <= manualTotal * 0.5, `${key}: mediana end-to-end mejora al menos 50%.`, { manualTotal, automaticTotal, speedup });
    check(speedup >= 1.8, `${key}: throughput del corpus ≥ 1,8×.`, speedup);
    check(automaticPaperP95 <= manualPaperP95 * 0.75, `${key}: p95 por item mejora al menos 25%.`, { manualPaperP95, automaticPaperP95, p95Reduction });

    const paperKeys = corpus.papers.map((paper) => paper.key);
    const recallDiffs = paperKeys.map((paperKey) => {
      const left = average(manual.map((run) => run.papers.find((paper) => paper.key === paperKey)?.ideaRecall).filter(Number.isFinite));
      const right = average(automatic.map((run) => run.papers.find((paper) => paper.key === paperKey)?.ideaRecall).filter(Number.isFinite));
      return { paperKey, difference: right - left };
    });
    const differences = recallDiffs.map((entry) => entry.difference);
    const meanDifference = average(differences);
    const lower95 = meanDifference - 1.833 * sampleDeviation(differences) / Math.sqrt(differences.length);
    check(meanDifference >= 0, `${key}: recall medio no inferior al secuencial.`, meanDifference);
    check(lower95 >= -0.02, `${key}: límite inferior IC unilateral 95% ≥ −0,02.`, lower95);
    check(recallDiffs.every((entry) => entry.difference >= -0.05), `${key}: ningún paper pierde más de 5 puntos.`, recallDiffs);
    const manualNdcg = average(manual.map((run) => run.quality.ndcg10));
    const automaticNdcg = average(automatic.map((run) => run.quality.ndcg10));
    const manualRecall20 = average(manual.map((run) => run.quality.recall20));
    const automaticRecall20 = average(automatic.map((run) => run.quality.recall20));
    check(automaticNdcg >= manualNdcg - 0.01, `${key}: NDCG@10 no cae más de 0,01.`);
    check(automaticRecall20 >= manualRecall20 - 0.01, `${key}: Recall@20 no cae más de 0,01.`);
    const manualFusionRecall = average(manual.map((run) => run.quality.equivalentFusionRecall));
    const automaticFusionRecall = average(automatic.map((run) => run.quality.equivalentFusionRecall));
    check(automaticFusionRecall >= manualFusionRecall - 0.02, `${key}: recall de fusiones equivalentes no cae más de 2 puntos.`);
    if (entries[0].provider === 'nodus') {
      check(average(automatic.flatMap((run) => run.papers.map((paper) => paper.ideaRecall))) >= 0.8, `${key}: recall absoluto local ≥ 80%.`);
    }
    groupResults[key] = { manualCampaigns: manual.length, automaticCampaigns: automatic.length, manualTotal, automaticTotal, speedup, manualPaperP95, automaticPaperP95, meanRecallDifference: meanDifference, recallLower95: lower95 };
  }

  if (process.argv.includes('--release')) {
    const matrix = JSON.parse(await fsp.readFile(path.join(root, 'audit/adaptive-concurrency/campaign-matrix.json'), 'utf8'));
    for (const config of matrix.cloud) for (const routing of config.routingModes) {
      check(candidate.some((run) => run.provider === config.provider && run.model === config.model && run.routingMode === routing), `Release: falta ${config.provider}/${config.model}/${routing}.`);
    }
    for (const model of (matrix.localGenerativeModels ?? [])) for (const host of (matrix.fullInferenceHosts ?? [])) {
      check(candidate.some((run) => run.provider === 'nodus' && run.model === model && run.host?.platform === host.os && run.host?.arch === host.arch), `Release: falta ${model} en ${host.os}/${host.arch}.`);
    }
  }
  const report = { schema: 'nodus-adaptive-gates/1', generatedAt: new Date().toISOString(), pass: failures.length === 0, runCount: runs.length, failures, groups: groupResults, checks };
  const destination = path.resolve(arg('--out', path.join(directory, 'gate-report.json')));
  await fsp.writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
}

async function createRunProfile() {
  const profile = path.resolve(arg('--profile', await fsp.mkdtemp(path.join(os.tmpdir(), 'nodus-adaptive-run-'))));
  const source = arg('--source-userdata');
  await fsp.mkdir(path.join(profile, 'secrets'), { recursive: true, mode: 0o700 });
  if (source) {
    for (const provider of ['gemini', 'deepseek']) {
      const input = path.join(path.resolve(source), `secrets/ai_key_${provider}.bin`);
      if (!fs.existsSync(input)) continue;
      const before = sha256File(input);
      await fsp.copyFile(input, path.join(profile, 'secrets', path.basename(input)));
      assert.equal(sha256File(input), before, 'El perfil fuente cambió durante la copia de secretos cifrados.');
    }
  }
  const manifest = {
    schema: 'nodus-adaptive-run/1', createdAt: new Date().toISOString(), profile,
    corpus: { path: corpusPath, sha256: sha256File(corpusPath), cache },
    environment: { platform: process.platform, arch: process.arch, release: os.release(), cpus: os.cpus().map((cpu) => cpu.model), memoryBytes: os.totalmem() },
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    config: { provider: arg('--provider'), model: arg('--model'), embeddingProvider: arg('--embedding-provider'), embeddingModel: arg('--embedding-model'), mode: arg('--mode', 'automatic') },
    paths: { perfJsonl: path.join(profile, 'audit/perf.jsonl'), result: path.join(profile, 'audit/result.json') },
  };
  await fsp.mkdir(path.join(profile, 'audit'), { recursive: true, mode: 0o700 });
  await fsp.writeFile(path.join(profile, 'audit/run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (command === 'prepare') process.stdout.write(`${JSON.stringify(await verify(true), null, 2)}\n`);
else if (command === 'verify') process.stdout.write(`${JSON.stringify(await verify(false), null, 2)}\n`);
else if (command === 'serve') await serve();
else if (command === 'summarize') await summarize();
else if (command === 'create-run-profile') await createRunProfile();
else if (command === 'evaluate') await evaluate();
else throw new Error('Uso: adaptive-concurrency-audit.mjs prepare|verify|serve|summarize|create-run-profile|evaluate');
