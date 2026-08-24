import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve('scripts/prepare-deep-research-blind-benchmark.mjs');

function fixtureRoot(withEvidence) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-blind-bundle-'));
  const report = path.join(root, 'report.md');
  const sections = path.join(root, 'sections.json');
  fs.writeFileSync(report, '# Informe\n\nAfirmación [Fuente](nodus://idea/i-1).\n');
  fs.writeFileSync(sections, JSON.stringify({
    sections: [{
      title: 'Sección',
      ideas: withEvidence ? [{ id: 'i-1', label: 'Fuente', statement: 'Evidencia' }] : [],
      passages: [],
    }],
  }));
  return { root, report, sections };
}

function runFixture(fixture) {
  return spawnSync(process.execPath, [
    script,
    '--objective', 'Pregunta',
    '--out', path.join(fixture.root, 'blind', 'Q01'),
    '--first', 'baseline',
    '--baseline-report', fixture.report,
    '--baseline-sections', fixture.sections,
    '--iteration-report', fixture.report,
    '--iteration-sections', fixture.sections,
  ], { encoding: 'utf8' });
}

test('blind benchmark preparation keeps a real evidence bundle', () => {
  const fixture = fixtureRoot(true);
  try {
    const result = runFixture(fixture);
    assert.equal(result.status, 0, result.stderr);
    const pair = JSON.parse(fs.readFileSync(path.join(fixture.root, 'blind', 'Q01', 'pair.json'), 'utf8'));
    assert.equal(pair.candidate1.retrieval.sections[0].ideas.length, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('blind benchmark preparation refuses an evidence-empty package', () => {
  const fixture = fixtureRoot(false);
  try {
    const result = runFixture(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /has no evidence items/u);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
