#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const root = path.resolve(
  args.get('--root')
    ?? 'reports/deep-research-professional/luna-10-query-benchmark/iteration2',
);
const outputPath = path.resolve(
  args.get('--out') ?? path.join(root, 'judgements', 'aggregate-iteration2.json'),
);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function numericScore(value) {
  return Number(typeof value === 'object' && value !== null ? value.score : value);
}

function candidateScore(entry, label) {
  const candidate = entry.candidates?.[label] ?? entry[label];
  assert(candidate, `Missing ${label}`);
  const paired = entry.paired_verdict?.scores?.[label];
  return {
    R: numericScore(candidate.R),
    F: numericScore(candidate.F),
    overall: Number(candidate.overall ?? paired?.overall),
    passesThresholds: passesThresholds(candidate),
  };
}

function passesThresholds(candidate) {
  if (typeof candidate.gates?.superior_thresholds === 'boolean') {
    return candidate.gates.superior_thresholds;
  }
  const detailed = candidate.support_and_gates?.gates;
  if (detailed) return Object.values(detailed).every(Boolean);
  const gates = candidate.gates ?? {};
  return gates.R_at_least_80 === true
    && gates.F_at_least_85 === true
    && gates.weighted_coverage_at_least_080 === true
    && gates.support_at_least_085 === true
    && gates.valid_interpretable_citations_at_least_098 === true
    && gates.high_risk_unsupported_claims_zero === true
    && gates.redundancy_at_most_015 === true
    && gates.high_importance_partial_presented_as_resolved === false;
}

function entries(document) {
  if (Array.isArray(document.judgements)) {
    return document.judgements.map((entry) => [entry.query_id, entry]);
  }
  return Object.entries(document.queries ?? {});
}

function verdict(entry, mapping, delta) {
  const comparison = entry.comparison ?? entry.paired_verdict ?? {};
  if (comparison.functional_tie === true || comparison.winner === 'functional_tie') return 'tie';
  if (comparison.winner === 'candidate1' || comparison.winner === 'candidate2') {
    return mapping[comparison.winner] === 'iteration2' ? 'iteration2_win' : 'iteration2_loss';
  }
  return Math.abs(delta) < 1 ? 'tie' : delta > 0 ? 'iteration2_win' : 'iteration2_loss';
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function seededRandom(seed = 0x4e4f4455) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function bootstrapMeanInterval(values, iterations = 20_000) {
  const random = seededRandom();
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)];
    }
    samples.push(sum / values.length);
  }
  samples.sort((left, right) => left - right);
  return [samples[Math.floor(iterations * 0.025)], samples[Math.floor(iterations * 0.975)]];
}

const rows = [];
const judgementDir = path.join(root, 'judgements');
for (const filename of fs.readdirSync(judgementDir).filter((name) => /^blind-judge-Q.*\.json$/u.test(name)).sort()) {
  const document = readJson(path.join(judgementDir, filename));
  for (const [id, entry] of entries(document)) {
    const mapping = readJson(path.join(root, 'blind', `${id}-mapping.json`));
    const candidates = {
      candidate1: candidateScore(entry, 'candidate1'),
      candidate2: candidateScore(entry, 'candidate2'),
    };
    const baselineLabel = Object.keys(mapping).find((label) => mapping[label] === 'baseline');
    const iterationLabel = Object.keys(mapping).find((label) => mapping[label] === 'iteration2');
    assert(baselineLabel && iterationLabel, `${id}: invalid mapping`);
    const baseline = candidates[baselineLabel];
    const iteration2 = candidates[iterationLabel];
    const delta = iteration2.overall - baseline.overall;
    rows.push({
      id,
      source: filename,
      baseline,
      iteration2,
      deltaOverall: Math.round(delta * 10) / 10,
      result: verdict(entry, mapping, delta),
    });
  }
}

rows.sort((left, right) => left.id.localeCompare(right.id));
assert.equal(rows.length, 7, 'The second iteration must contain exactly the seven weak cases.');
assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'Duplicate query judgement.');

const round = (value) => Math.round(value * 100) / 100;
const deltas = rows.map((row) => row.deltaOverall);
const summary = {
  schema: 'nodus-deep-research-iteration2-blind-summary-v1',
  queries: rows.length,
  wins: rows.filter((row) => row.result === 'iteration2_win').length,
  ties: rows.filter((row) => row.result === 'tie').length,
  losses: rows.filter((row) => row.result === 'iteration2_loss').length,
  baselineThresholdPasses: rows.filter((row) => row.baseline.passesThresholds).length,
  iteration2ThresholdPasses: rows.filter((row) => row.iteration2.passesThresholds).length,
  means: {
    baselineR: round(mean(rows.map((row) => row.baseline.R))),
    iteration2R: round(mean(rows.map((row) => row.iteration2.R))),
    baselineF: round(mean(rows.map((row) => row.baseline.F))),
    iteration2F: round(mean(rows.map((row) => row.iteration2.F))),
    baselineOverall: round(mean(rows.map((row) => row.baseline.overall))),
    iteration2Overall: round(mean(rows.map((row) => row.iteration2.overall))),
    pairedOverallDelta: round(mean(deltas)),
  },
  medianPairedOverallDelta: round(median(deltas)),
  bootstrap95PairedOverallDelta: bootstrapMeanInterval(deltas).map(round),
  rows,
  caveat: 'This paired blind rerun estimates the effect of the proof-contract revision on seven selected weak cases; it is not an independent market-wide benchmark.',
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
