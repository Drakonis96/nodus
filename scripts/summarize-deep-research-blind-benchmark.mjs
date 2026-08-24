#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const root = path.resolve(args.get('--root') ?? 'reports/deep-research-professional/luna-10-query-benchmark');
const outputPath = args.get('--out') ? path.resolve(args.get('--out')) : null;
const judgementDir = path.join(root, 'judgements');
const mappingDir = path.join(root, 'blind-evidence');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function candidateFromWave0(row, label) {
  const score = row.scores?.[label];
  assert(score, `${row.query_id}: missing ${label}`);
  const gates = score.gates ?? {};
  return {
    R: Number(score.R?.score),
    F: Number(score.F?.score),
    overall: Number(score.overall),
    coverage: Number(gates.useful_coverage),
    support: Number(gates.support_sampled_claims),
    citations: Number(gates.interpretable_valid_citations),
    redundancy: Number(gates.redundancy),
    criticalOverclaims: Number(gates.high_risk_unsupported_claims ?? 0),
    criticalGateFailure: gates.critical_gate_failure === true,
  };
}

function candidateFromWave1(row, label) {
  const score = row[label];
  assert(score, `${row.id}: missing ${label}`);
  const gates = score.critical_gates ?? {};
  return {
    R: Number(score.R),
    F: Number(score.F),
    overall: Number(score.overall),
    coverage: Number(gates.coverage_weighted),
    support: Number(score.support_rate ?? gates.direct_or_contextual_support),
    citations: Number(score.citation_valid_interpretable_rate ?? gates.citations_valid),
    redundancy: Number(score.redundancy_rate),
    criticalOverclaims: Number(score.high_risk_unsupported_claims ?? gates.high_risk_unsupported ?? 0),
    criticalGateFailure: gates.pass === false,
  };
}

function candidateFromCandidateScores(row, label) {
  const score = row.candidate_scores?.[label];
  assert(score, `${row.query_id}: missing ${label}`);
  const metrics = score.quality_metrics ?? {};
  const requirements = score.atomic_requirements ?? [];
  const weighted = requirements.reduce((sum, requirement) => {
    const weight = requirement.weight === 'high' ? 3 : requirement.weight === 'medium' ? 2 : 1;
    const value = requirement.status === 'covered' ? 1 : requirement.status === 'partial' ? 0.5 : 0;
    return { earned: sum.earned + weight * value, possible: sum.possible + weight };
  }, { earned: 0, possible: 0 });
  return {
    R: Number(score.R),
    F: Number(score.F),
    overall: Number(score.overall),
    coverage: weighted.possible ? weighted.earned / weighted.possible : 0,
    support: Number(metrics.support_rate),
    citations: Number(metrics.citation_valid_interpretable_rate),
    redundancy: Number(metrics.redundancy_rate),
    criticalOverclaims: Number(metrics.high_risk_unsupported_claims ?? 0),
    criticalGateFailure: score.gates?.high_importance_requirement_falsely_presented_as_resolved === true,
  };
}

function candidateFromDirect(row, label) {
  const score = row[label];
  assert(score, `missing ${label}`);
  const metrics = score.metrics ?? {};
  const gates = score.gates ?? {};
  return {
    R: Number(score.R),
    F: Number(score.F),
    overall: Number(score.overall),
    coverage: Number(gates.coverage_weighted),
    support: Number(metrics.supported_claim_rate ?? gates.direct_or_contextual_support),
    citations: Number(metrics.citation_valid_interpretable_rate ?? gates.valid_citations),
    redundancy: Number(metrics.redundancy_rate),
    criticalOverclaims: Number(gates.high_risk_unsupported_claims ?? 0),
    criticalGateFailure: gates.high_requirements_falsely_presented_resolved === true,
  };
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function passesThresholds(score) {
  return score.R >= 80
    && score.F >= 85
    && score.overall >= 85
    && score.coverage >= 0.8
    && score.support >= 0.85
    && score.citations >= 0.98
    && score.redundancy <= 0.15
    && score.criticalOverclaims === 0
    && !score.criticalGateFailure;
}

function judgeDecision(row, mapping, delta) {
  const pairwise = row.pairwise ?? row.verdict ?? row.comparison ?? {};
  const raw = String(pairwise.verdict ?? pairwise.result ?? pairwise.functional_verdict ?? '').toLocaleLowerCase();
  if (pairwise.functional_tie === true || raw.includes('tie') || raw.includes('empate')) return 'tie';
  const winner = pairwise.winner ?? pairwise.point_winner
    ?? (raw.includes('candidate1') ? 'candidate1' : raw.includes('candidate2') ? 'candidate2' : null);
  if (winner === 'candidate1' || winner === 'candidate2') {
    return mapping[winner] === 'v2' ? 'v2_win' : 'v2_loss';
  }
  return Math.abs(delta) <= 1.5 ? 'tie' : delta > 0 ? 'v2_win' : 'v2_loss';
}

const rows = [];
for (const filename of fs.readdirSync(judgementDir).filter((name) => /^blind-judge-wave.*\.json$/u.test(name)).sort()) {
  const document = readJson(path.join(judgementDir, filename));
  const entries = Array.isArray(document.queries)
    ? document.queries.map((row) => ({ id: row.id, row, shape: 'wave1' }))
    : Array.isArray(document.judgements)
      ? document.judgements.map((row) => ({
        id: row.query_id,
        row,
        shape: row.candidate_scores ? 'candidate_scores' : 'wave0',
      }))
      : Object.entries(document.judgements ?? {}).map(([id, row]) => ({ id, row, shape: 'direct' }));
  for (const entry of entries) {
    const mapping = readJson(path.join(mappingDir, `${entry.id}-mapping.json`));
    const candidates = {
      candidate1: entry.shape === 'wave0'
        ? candidateFromWave0(entry.row, 'candidate1')
        : entry.shape === 'candidate_scores'
          ? candidateFromCandidateScores(entry.row, 'candidate1')
          : entry.shape === 'direct'
            ? candidateFromDirect(entry.row, 'candidate1')
          : candidateFromWave1(entry.row, 'candidate1'),
      candidate2: entry.shape === 'wave0'
        ? candidateFromWave0(entry.row, 'candidate2')
        : entry.shape === 'candidate_scores'
          ? candidateFromCandidateScores(entry.row, 'candidate2')
          : entry.shape === 'direct'
            ? candidateFromDirect(entry.row, 'candidate2')
          : candidateFromWave1(entry.row, 'candidate2'),
    };
    const v1 = candidates[Object.entries(mapping).find(([, version]) => version === 'v1')?.[0]];
    const v2 = candidates[Object.entries(mapping).find(([, version]) => version === 'v2')?.[0]];
    assert(v1 && v2, `${entry.id}: invalid mapping`);
    const delta = v2.overall - v1.overall;
    rows.push({
      id: entry.id,
      source: filename,
      v1,
      v2,
      deltaOverall: Math.round(delta * 10) / 10,
      result: judgeDecision(entry.row, mapping, delta),
      v1PassesThresholds: passesThresholds(v1),
      v2PassesThresholds: passesThresholds(v2),
    });
  }
}

rows.sort((left, right) => left.id.localeCompare(right.id));
assert(rows.length > 0, 'No blind judgements found.');
assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'Duplicate query judgement.');

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
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
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(iterations * 0.025)], samples[Math.floor(iterations * 0.975)]];
}

const deltas = rows.map((row) => row.deltaOverall);
const round = (value) => Math.round(value * 100) / 100;
const summary = {
  schema: 'nodus-deep-research-blind-summary-v1',
  queries: rows.length,
  wins: rows.filter((row) => row.result === 'v2_win').length,
  ties: rows.filter((row) => row.result === 'tie').length,
  losses: rows.filter((row) => row.result === 'v2_loss').length,
  v1ThresholdPasses: rows.filter((row) => row.v1PassesThresholds).length,
  v2ThresholdPasses: rows.filter((row) => row.v2PassesThresholds).length,
  means: {
    v1R: round(mean(rows.map((row) => row.v1.R))),
    v2R: round(mean(rows.map((row) => row.v2.R))),
    v1F: round(mean(rows.map((row) => row.v1.F))),
    v2F: round(mean(rows.map((row) => row.v2.F))),
    v1Overall: round(mean(rows.map((row) => row.v1.overall))),
    v2Overall: round(mean(rows.map((row) => row.v2.overall))),
    pairedOverallDelta: round(mean(deltas)),
  },
  medianPairedOverallDelta: round(median(deltas)),
  bootstrap95PairedOverallDelta: bootstrapMeanInterval(deltas).map(round),
  rows: rows.map((row) => ({
    ...row,
    v1: Object.fromEntries(Object.entries(row.v1).map(([key, value]) => [key, finite(value)])),
    v2: Object.fromEntries(Object.entries(row.v2).map(([key, value]) => [key, finite(value)])),
  })),
  caveat: 'A paired blind benchmark estimates performance on this frozen corpus and query matrix; it is not proof of market-wide superiority.',
};

const serialized = `${JSON.stringify(summary, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
}
process.stdout.write(serialized);
