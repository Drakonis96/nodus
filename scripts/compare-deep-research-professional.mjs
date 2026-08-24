// Reproducible comparison between saved real reports and isolated candidate runs.
// This intentionally combines complementary signals: structural quality, coverage
// of a hand-declared research brief, literal evidence, source entropy and synthesis.
// No one metric can hide a regression in another.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const baselineFile = path.resolve(argOf('--baseline', path.join(repoRoot, 'reports/deep-research-quality-baseline.json')));
const historicalDir = path.resolve(argOf('--historical', path.join(repoRoot, 'reports/deep-research-professional/historical')));
const candidateDir = path.resolve(argOf('--candidate', path.join(repoRoot, 'reports/deep-research-professional/after')));
const outputJson = path.resolve(argOf('--out', path.join(repoRoot, 'reports/deep-research-professional-audit.json')));
const outputMd = outputJson.replace(/\.json$/u, '.md');

const BENCHMARKS = {
  'tourism-apparatus': {
    baselineId: 'cfbcca6f-e067-4501-b790-be9a9ad74956',
    facets: {
      'DGT y MIT': [/direcci[oó]n general de turismo/iu, /\bDGT\b/u, /ministerio de informaci[oó]n y turismo/iu, /\bMIT\b/u],
      'evolución hasta Fraga': [/Fraga(?: Iribarne)?/iu, /1951.{0,80}1962|1962.{0,80}1951/isu],
      'material fotográfico oficial': [/material (?:gr[aá]fico|fotogr[aá]fico)|fotograf[ií]a oficial|archivo fotogr[aá]fico/iu],
      'itinerarios, guías y Paradores': [/itinerario/iu, /parador/iu, /gu[ií]a oficial/iu],
      'oficinas y promoción exterior': [/oficina.{0,50}(?:exterior|extranjero)|promoci[oó]n internacional|propaganda exterior/isu],
      'dispositivo de visibilidad': [/dispositivo.{0,60}visibilidad|predetermin.{0,50}(?:mirada|ver|fotograf)/isu],
      'eficacia y legitimación': [/eficacia.{0,80}propaganda|propaganda.{0,80}eficacia|legitimaci[oó]n exterior/isu],
    },
  },
  'visual-modernity': {
    baselineId: 'ab1512f8-14f6-40df-904a-0c1916a6a0bc',
    facets: {
      'emblemas modernos omitidos': [/rascacielos/iu, /autom[oó]vil/iu, /ne[oó]n/iu],
      'texto frente a fotografía': [/texto.{0,80}(?:fotograf[ií]a|imagen)|(?:fotograf[ií]a|imagen).{0,80}texto/isu],
      'convención pintoresca/turística': [/pintoresc/iu, /convenci[oó]n.{0,50}tur[ií]st/isu],
      'yuxtaposición antiguo/moderno': [/yuxtaposici[oó]n/iu, /monumento.{0,100}(?:edificio|modern)|(?:antigu|tradici[oó]n).{0,100}modern/isu],
      'fotoperiodismo de posguerra': [/fotoperiodismo/iu, /prensa ilustrada/iu],
      'fotografía conservadora': [/fotograf[ií]a.{0,80}conservador|dispositivo.{0,80}conservador/isu],
      'intencionalidad frente a estructura': [/deliberad|intencional/iu, /estructural|marco de referencia|econom[ií]a editorial/iu],
    },
  },
  'rural-coercion': {
    baselineId: '1084ade7-8883-417d-acd8-2c9a3549d58d',
    facets: {
      'ruralización de posguerra': [/ruralizaci[oó]n/iu],
      'decisión política deliberada': [/decisi[oó]n pol[ií]tica|deliberad|intencional/iu],
      'salvoconductos': [/salvoconducto/iu],
      'permisos y movilidad interior': [/permiso.{0,50}(?:desplazamiento|movilidad)|movilidad interior/isu],
      'Hermandades Sindicales': [/hermandades sindicales|hermandad sindical/iu],
      'dominio de la gran propiedad': [/gran propiedad|terrateniente|latifundi/iu],
      'aparcería, arrendamiento y coacción': [/aparcer[ií]a/iu, /arrendamiento/iu, /coacci[oó]n contractual/iu],
      'casos andaluces y extremeños': [/andaluc/iu, /extremadur/iu, /estudio.{0,30}local/isu],
      'desbloqueo del éxodo rural': [/desbloque|abandono.{0,80}contenci[oó]n|[eé]xodo rural/isu],
      'debate de intencionalidad': [/debate.{0,100}intencional|intencionalidad.{0,100}(?:debate|historiogr)/isu],
    },
  },
};

const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const historicalReports = loadReports(historicalDir);
const candidateReports = loadReports(candidateDir);
const comparisons = [];

for (const [label, config] of Object.entries(BENCHMARKS)) {
  const baselineRow = baseline.reports.find((row) => row.id === config.baselineId);
  const historical = historicalReports.get(label);
  const candidate = candidateReports.get(label);
  if (!candidate) continue;
  assert.ok(baselineRow, `missing baseline assessment for ${label}`);
  assert.ok(historical, `missing historical report for ${label}`);
  assert.ok(candidate.report?.draft?.qualityAssessment, `candidate ${label} has no quality assessment`);

  const oldText = historical.report.draft.draftMarkdown ?? '';
  const newText = candidate.report.draft.draftMarkdown ?? '';
  const oldFacets = assessFacets(oldText, config.facets);
  const newFacets = assessFacets(newText, config.facets);
  const oldQuality = baselineRow.assessment;
  const newQuality = candidate.report.draft.qualityAssessment;
  const oldPassages = baselineRow.raw.uniqueByKind.passage ?? 0;
  const newPassages = candidate.metrics?.citations?.passages ?? countLinks(newText, 'passage');
  const verification = candidate.report.meta?.verification ?? {};
  const oldComposite = professionalComposite(oldQuality, oldFacets.ratio, oldPassages);
  const newComposite = professionalComposite(newQuality, newFacets.ratio, newPassages);
  const oldSourceDensity = sourceDensity(oldQuality);
  const newSourceDensity = sourceDensity(newQuality);
  const gates = {
    qualityThreshold: newQuality.score >= 85,
    everySectionPasses: newQuality.sectionsPassing === newQuality.sections,
    objectiveCoverageNoRegression: newFacets.ratio + 0.001 >= oldFacets.ratio,
    directEvidenceNoRegression: newPassages >= oldPassages,
    // Absolute entropy alone penalizes a report for being concise. Require no loss
    // in effective sources, plus either a 5% absolute gain or a 20% gain per 1,000
    // words. The latter detects genuinely broader sourcing in a shorter argument.
    sourceBreadthImproves: newQuality.metrics.effectiveSources >= oldQuality.metrics.effectiveSources
      && (newQuality.metrics.effectiveSources >= oldQuality.metrics.effectiveSources * 1.05
        || newSourceDensity >= oldSourceDensity * 1.2),
    verificationComplete: Number(verification.unverified ?? 0) === 0 && Number(verification.checked ?? 0) > 0,
    compositeImproves: newComposite > oldComposite,
  };
  comparisons.push({
    label,
    historical: summarize(oldQuality, oldFacets, oldPassages, oldComposite, baselineRow.raw),
    candidate: summarize(newQuality, newFacets, newPassages, newComposite, {
      verification,
      bibliographyEntries: candidate.metrics?.bibliographyEntries,
      elapsedSeconds: candidate.metrics?.elapsedSeconds,
      expansions: candidate.report.meta?.expansions,
      qualityRevisions: candidate.report.meta?.qualityRevisions,
    }),
    deltas: {
      qualityScore: round(newQuality.score - oldQuality.score),
      composite: round(newComposite - oldComposite),
      objectiveCoveragePoints: round((newFacets.ratio - oldFacets.ratio) * 100),
      uniquePassages: newPassages - oldPassages,
      effectiveSources: round(newQuality.metrics.effectiveSources - oldQuality.metrics.effectiveSources),
      effectiveSourcesPerThousandWords: round(newSourceDensity - oldSourceDensity),
      crossSourceParagraphs: newQuality.metrics.crossSourceParagraphs - oldQuality.metrics.crossSourceParagraphs,
      topSourceSharePoints: round((newQuality.metrics.topSourceShare - oldQuality.metrics.topSourceShare) * 100),
    },
    gates,
    passesAllGates: Object.values(gates).every(Boolean),
  });
}

assert.ok(comparisons.length > 0, 'no completed candidate reports');
const output = {
  generatedAt: new Date().toISOString(),
  methodology: {
    historicalReports: 'Informes reales guardados previamente en Nodus, leídos en modo solo lectura.',
    candidateReports: 'Ejecuciones aisladas sobre una copia del corpus con gemini-3.1-flash-lite y baai/bge-m3.',
    composite: '30% rúbrica estructural, 25% cobertura del encargo, 15% evidencia literal, 15% diversidad efectiva y 15% síntesis entre fuentes.',
    warning: 'La puntuación compuesta no prueba verdad historiográfica; debe interpretarse junto al juicio ciego y la auditoría de citas.',
  },
  summary: {
    completed: comparisons.length,
    passedAllGates: comparisons.filter((row) => row.passesAllGates).length,
    historicalCompositeMean: round(mean(comparisons.map((row) => row.historical.composite))),
    candidateCompositeMean: round(mean(comparisons.map((row) => row.candidate.composite))),
    compositeDelta: round(mean(comparisons.map((row) => row.deltas.composite))),
  },
  comparisons,
};
fs.mkdirSync(path.dirname(outputJson), { recursive: true });
fs.writeFileSync(outputJson, `${JSON.stringify(output, null, 2)}\n`);
fs.writeFileSync(outputMd, renderMarkdown(output));
console.log(JSON.stringify(output.summary, null, 2));
console.log(outputJson);

function loadReports(dir) {
  const map = new Map();
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'manifest.json').sort()) {
    const value = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const rawLabel = value.metrics?.topic ?? value.metrics?.label;
    const label = normaliseBenchmarkLabel(rawLabel);
    if (!label) continue;
    // Iteration artefacts may share a metrics label. The canonical `label.json`
    // always wins, irrespective of filesystem ordering.
    if (!map.has(label) || path.basename(file, '.json') === label) map.set(label, value);
  }
  return map;
}

function normaliseBenchmarkLabel(label) {
  const value = String(label ?? '');
  for (const benchmark of Object.keys(BENCHMARKS)) {
    if (value === benchmark || value.startsWith(`${benchmark}-`)) return benchmark;
  }
  return value;
}

function assessFacets(text, facets) {
  const details = Object.entries(facets).map(([name, patterns]) => {
    const hits = patterns.map((pattern) => pattern.test(text));
    // Multi-part facets require at least two elements when three were explicitly
    // declared; otherwise one well-formed match is sufficient.
    const required = patterns.length >= 3 ? 2 : 1;
    return { name, covered: hits.filter(Boolean).length >= required, hits: hits.filter(Boolean).length, required };
  });
  return { covered: details.filter((row) => row.covered).length, total: details.length, ratio: details.filter((row) => row.covered).length / details.length, details };
}

function countLinks(text, kind) {
  return new Set([...text.matchAll(new RegExp(`nodus://${kind}/([^\\s)]+)`, 'giu'))].map((match) => match[1])).size;
}

function professionalComposite(quality, facetRatio, uniquePassages) {
  const literalEvidence = Math.min(100, uniquePassages / 18 * 100);
  const diversity = Math.min(100, quality.metrics.effectiveSources / 55 * 100);
  const synthesis = Math.min(100, quality.metrics.crossSourceParagraphs / 12 * 100);
  return round(quality.score * 0.30 + facetRatio * 100 * 0.25 + literalEvidence * 0.15 + diversity * 0.15 + synthesis * 0.15);
}

function summarize(quality, facets, passages, composite, raw) {
  return {
    composite,
    qualityScore: quality.score,
    grade: quality.grade,
    sectionsPassing: `${quality.sectionsPassing}/${quality.sections}`,
    words: quality.metrics.words,
    objectiveCoverage: round(facets.ratio * 100),
    facets: facets.details,
    uniquePassages: passages,
    effectiveSources: quality.metrics.effectiveSources,
    effectiveSourcesPerThousandWords: sourceDensity(quality),
    topSourceShare: quality.metrics.topSourceShare,
    crossSourceParagraphs: quality.metrics.crossSourceParagraphs,
    directEvidenceCitations: quality.metrics.directEvidenceCitations,
    uncitedParagraphShare: quality.metrics.uncitedParagraphShare,
    issues: quality.issues,
    raw,
  };
}

function renderMarkdown(output) {
  const lines = [
    '# Auditoría cuantitativa de Deep Research', '',
    `Generada: ${output.generatedAt}`, '',
    `Comparaciones completas: ${output.summary.completed}. Superan todos los umbrales: ${output.summary.passedAllGates}.`,
    `Compuesto medio: ${output.summary.historicalCompositeMean} → ${output.summary.candidateCompositeMean} (${signed(output.summary.compositeDelta)}).`, '',
    '| Tema | Compuesto | Calidad | Cobertura | Pasajes | Fuentes efectivas (por 1.000 palabras) | Síntesis | Todos los umbrales |',
    '|---|---:|---:|---:|---:|---:|---:|:---:|',
  ];
  for (const row of output.comparisons) {
    lines.push(`| ${row.label} | ${row.historical.composite} → ${row.candidate.composite} | ${row.historical.qualityScore} → ${row.candidate.qualityScore} | ${row.historical.objectiveCoverage}% → ${row.candidate.objectiveCoverage}% | ${row.historical.uniquePassages} → ${row.candidate.uniquePassages} | ${row.historical.effectiveSources} (${row.historical.effectiveSourcesPerThousandWords}) → ${row.candidate.effectiveSources} (${row.candidate.effectiveSourcesPerThousandWords}) | ${row.historical.crossSourceParagraphs} → ${row.candidate.crossSourceParagraphs} | ${row.passesAllGates ? 'sí' : 'no'} |`);
  }
  for (const row of output.comparisons) {
    lines.push('', `## ${row.label}`, '', `Deltas: compuesto ${signed(row.deltas.composite)}, calidad ${signed(row.deltas.qualityScore)}, cobertura ${signed(row.deltas.objectiveCoveragePoints)} pp, pasajes ${signed(row.deltas.uniquePassages)}, fuentes efectivas ${signed(row.deltas.effectiveSources)} (${signed(row.deltas.effectiveSourcesPerThousandWords)} por 1.000 palabras), síntesis ${signed(row.deltas.crossSourceParagraphs)}.`, '', 'Umbrales:');
    for (const [key, passed] of Object.entries(row.gates)) lines.push(`- ${passed ? 'PASS' : 'FAIL'} — ${key}`);
    const missed = row.candidate.facets.filter((facet) => !facet.covered).map((facet) => facet.name);
    lines.push('', `Facetas no cubiertas por el candidato: ${missed.length ? missed.join(', ') : 'ninguna'}.`);
  }
  lines.push('', 'La puntuación compuesta es una medición reproducible de propiedades observables; no certifica por sí sola la verdad historiográfica.', '');
  return lines.join('\n');
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function sourceDensity(quality) { return round(quality.metrics.effectiveSources / Math.max(1, quality.metrics.words) * 1000); }
function round(value, digits = 1) { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
function signed(value) { return `${value >= 0 ? '+' : ''}${value}`; }
