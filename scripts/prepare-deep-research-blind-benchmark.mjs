/**
 * Produce a length-neutral, version-blind report + retrieval bundle.
 *
 * Unlike the small report-only pair, this artefact lets a judge score R as well
 * as F. It keeps every cited source plus the first candidates per section, but
 * removes engine metadata, raw scores, lanes, providers and absolute paths.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const argOf = (name, fallback = '') => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const runArg = argOf('--run');
const runDir = runArg ? path.resolve(runArg) : '';
const objective = argOf('--objective').trim();
const outDir = path.resolve(argOf('--out'));
const first = argOf('--first', 'v1');
const baselineReport = argOf('--baseline-report');
const baselineSections = argOf('--baseline-sections');
const iterationReport = argOf('--iteration-report');
const iterationSections = argOf('--iteration-sections');
const iterationMode = [baselineReport, baselineSections, iterationReport, iterationSections].some(Boolean);
assert.ok(objective && outDir, 'An objective and output directory are required.');

let bundles;
let second;
if (iterationMode) {
  assert.ok([baselineReport, baselineSections, iterationReport, iterationSections].every(Boolean),
    'Iteration mode needs --baseline-report, --baseline-sections, --iteration-report and --iteration-sections.');
  assert.ok(first === 'baseline' || first === 'iteration2', '--first must be baseline or iteration2 in iteration mode');
  bundles = {
    baseline: buildBundleFromPaths(baselineReport, baselineSections),
    iteration2: buildBundleFromPaths(iterationReport, iterationSections),
  };
  second = first === 'baseline' ? 'iteration2' : 'baseline';
} else {
  assert.ok(runDir, 'Usage: --run RUN_DIR --objective TEXT --out DIR [--first v1|v2]');
  assert.ok(first === 'v1' || first === 'v2', '--first must be v1 or v2');
  bundles = { v1: buildBundle('v1'), v2: buildBundle('v2') };
  second = first === 'v1' ? 'v2' : 'v1';
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'pair.json'), `${JSON.stringify({
  objective,
  candidate1: bundles[first],
  candidate2: bundles[second],
}, null, 2)}\n`);
// The mapping is deliberately outside the blind directory supplied to judges.
const mappingPath = path.join(path.dirname(outDir), `${path.basename(outDir)}-mapping.json`);
fs.writeFileSync(mappingPath, `${JSON.stringify({ candidate1: first, candidate2: second }, null, 2)}\n`);

function buildBundle(version) {
  const reportPath = path.join(runDir, `report-${version}.md`);
  const sectionsPath = path.join(runDir, `sections-${version}.json`);
  return buildBundleFromPaths(reportPath, sectionsPath);
}

function buildBundleFromPaths(reportFile, sectionsFile) {
  const reportPath = path.resolve(reportFile);
  const sectionsPath = path.resolve(sectionsFile);
  assert.ok(fs.existsSync(reportPath), `Missing ${reportPath}`);
  assert.ok(fs.existsSync(sectionsPath), `Missing ${sectionsPath}`);
  const rawReport = fs.readFileSync(reportPath, 'utf8');
  const raw = JSON.parse(fs.readFileSync(sectionsPath, 'utf8'));
  const references = new Map();
  const refFor = (url) => {
    const canonical = String(url || '').trim();
    if (!canonical) return null;
    if (!references.has(canonical)) references.set(canonical, `C${String(references.size + 1).padStart(3, '0')}`);
    return references.get(canonical);
  };
  for (const match of rawReport.matchAll(/nodus:\/\/(?:idea|work|passage|gap|contradiction|study|archive)\/[^)\s`,;]+/giu)) {
    refFor(match[0]);
  }
  const report = anonymiseReport(rawReport, refFor);
  const cited = new Set(references.keys());
  const seenIdeas = new Set();
  const seenPassages = new Set();
  const sections = (raw.sections ?? []).map((section) => {
    const ideas = (section.ideas ?? []).filter((idea, index) => {
      const url = `nodus://idea/${encodeURIComponent(String(idea.id))}`;
      return index < 8 || cited.has(url);
    }).filter((idea) => {
      if (seenIdeas.has(idea.id)) return false;
      seenIdeas.add(idea.id);
      return true;
    }).map((idea) => {
      const url = `nodus://idea/${encodeURIComponent(String(idea.id))}`;
      return {
        ref: refFor(url),
        label: idea.label ?? '',
        statement: idea.statement ?? idea.summary ?? '',
        works: (idea.works ?? []).map((work) => ({
          title: work.title ?? '', authors: work.authors ?? [], year: work.year ?? null,
        })),
      };
    });
    const passages = (section.passages ?? []).filter((passage, index) => {
      const url = passage.citation || `nodus://passage/${encodeURIComponent(String(passage.id))}`;
      return index < 12 || cited.has(url);
    }).filter((passage) => {
      if (seenPassages.has(passage.id)) return false;
      seenPassages.add(passage.id);
      return true;
    }).map((passage) => {
      const url = passage.citation || `nodus://passage/${encodeURIComponent(String(passage.id))}`;
      return {
        ref: refFor(url),
        source: passage.label ?? '',
        page: passage.pageLabel ?? null,
        evidence: clip(passage.summary ?? '', 650),
      };
    });
    return {
      title: section.title ?? '',
      purpose: section.purpose ?? '',
      keyClaims: section.keyClaims ?? [],
      coverageQuestions: section.coverageQuestions ?? [],
      ideas,
      passages,
    };
  });
  const evidenceItems = sections.reduce(
    (total, section) => total + section.ideas.length + section.passages.length,
    0,
  );
  assert.ok(
    evidenceItems > 0,
    `Blind retrieval bundle has no evidence items: ${sectionsPath}`,
  );
  return { report, retrieval: { sections } };
}

function anonymiseReport(markdown, refFor) {
  return String(markdown)
    .replace(/^##\s+Nota de auditor[ií]a[^\n]*\n(?:^(?!##\s+).*(?:\n|$))*/gimu, '')
    .replace(/\[([^\]]*)\]\((nodus:\/\/[^)]*)\)/gu, (_whole, label, url) => `[${label} ⟦${refFor(url)}⟧]`)
    .replace(/`?(nodus:\/\/(?:idea|work|passage|gap|contradiction|study|archive)\/[^`\s),;]+)`?/giu,
      (_whole, url) => `⟦${refFor(url)}⟧`)
    .replace(/^.*(?:realVaultOpened|snapshot-v[12]|sections-v[12]|plan-v[12]|\/tmp\/nodus-dr-|openrouter\/baai\/bge-m3|generation\s+`?none`?|embedding).*$\n?/gimu, '')
    .replace(/\bInforme\s+[AB]\s*\(v[12]\)/giu, 'Informe')
    .replace(/\bInforme\s+[AB]\b/giu, 'Informe')
    .replace(/\bv[12]\b/giu, '')
    .trim();
}

function clip(value, length) {
  const text = String(value).replace(/\s+/gu, ' ').trim();
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}
