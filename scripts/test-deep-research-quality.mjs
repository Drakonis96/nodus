import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-dr-quality-test-'));
const bundle = path.join(tmp, 'quality.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'shared/deepResearchQuality.ts')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const quality = await import(pathToFileURL(bundle).href);
test.after(() => rm(tmp, { recursive: true, force: true }));

const source = (id, evidence = 'synthesis') => ({
  citation: `nodus://${evidence === 'literal' ? 'passage' : 'idea'}/${id}`,
  sourceId: `work-${id}`,
  evidence,
});
const cite = (id, evidence = 'synthesis') => `[Autor ${id}](nodus://${evidence === 'literal' ? 'passage' : 'idea'}/${id})`;
const paragraph = (text, refs = []) => `${text} ${'El análisis desarrolla la relación histórica y explica sus consecuencias mediante evidencia delimitada. '.repeat(7)} ${refs.join(' ')}`;

test('a strong section passes grounding, diversity, direct-evidence and synthesis gates', () => {
  const sources = [source('a'), source('b'), source('c'), source('p', 'literal')];
  const markdown = [
    '## Interpretación',
    paragraph('El mecanismo se explica porque dos interpretaciones convergen, mientras que una tercera introduce un límite.', [cite('a'), cite('b')]),
    paragraph('Sin embargo, la evidencia textual permite precisar el alcance y no permite generalizar fuera del periodo.', [cite('p', 'literal'), cite('c')]),
    paragraph('Por tanto, la comparación revela una consecuencia y sugiere una hipótesis provisional.', [cite('a'), cite('c')]),
    paragraph('La síntesis relaciona el mecanismo con la pregunta y distingue lo demostrado de lo posible.', [cite('b'), cite('p', 'literal')]),
  ].join('\n\n');
  const result = quality.assessDeepResearchSection({
    markdown,
    mode: 'academic',
    objective: 'Explicar el mecanismo histórico y sus consecuencias',
    keyClaims: ['mecanismo histórico', 'consecuencias'],
    sources,
  });
  assert.equal(quality.qualityPasses(result), true);
  assert.ok(result.score >= 72);
  assert.ok(result.metrics.distinctSources >= 4);
  assert.ok(result.metrics.crossSourceParagraphs >= 1);
  assert.ok(result.metrics.directEvidenceCitations >= 1);
});

test('citation stuffing and one-source dependence do not masquerade as depth', () => {
  const repeatedCitations = Array.from({ length: 16 }, () => cite('a')).join(' ');
  const markdown = [
    '## Catálogo',
    paragraph('Datos yuxtapuestos sin comparación.', [repeatedCitations]),
    paragraph('Más datos yuxtapuestos sin explicar el mecanismo.', [repeatedCitations]),
    paragraph('Otra enumeración afirmativa.', [repeatedCitations]),
  ].join('\n\n');
  const result = quality.assessDeepResearchSection({
    markdown,
    mode: 'academic',
    objective: 'Comparar tres interpretaciones y explicar su mecanismo',
    keyClaims: ['tres interpretaciones', 'mecanismo'],
    sources: [source('a'), source('b'), source('c'), source('p', 'literal')],
  });
  assert.equal(quality.qualityPasses(result), false);
  assert.ok(result.issues.includes('citation_stuffing'));
  assert.ok(result.issues.includes('low_source_diversity'));
  assert.ok(result.issues.includes('missing_cross_source_synthesis'));
  assert.ok(result.score < 72);
});

test('substantive unsupported paragraphs fail the grounding gate', () => {
  const markdown = [
    '## Sin apoyo',
    paragraph('Una afirmación documentada porque muestra un mecanismo.', [cite('a')]),
    paragraph('Una segunda afirmación extensa que carece por completo de apoyo documental.'),
    paragraph('Una tercera afirmación extensa que tampoco ofrece una fuente comprobable.'),
    paragraph('Una última afirmación extensa que permanece sin apoyo y generaliza el resultado.'),
  ].join('\n\n');
  const result = quality.assessDeepResearchSection({ markdown, mode: 'academic', sources: [source('a')] });
  assert.equal(result.gates.grounded, false);
  assert.ok(result.issues.includes('uncited_paragraphs'));
});

test('a revision is accepted only when it improves gates and keeps the evidence boundary', () => {
  const allowedSources = [source('a'), source('b'), source('c')];
  const beforeMarkdown = [
    '## Débil',
    paragraph('Una descripción aislada.', [cite('a')]),
    paragraph('Otra descripción sin fuente.'),
    paragraph('Una conclusión sin fuente.'),
  ].join('\n\n');
  const afterMarkdown = [
    '## Mejorada',
    paragraph('La comparación explica por qué ambas interpretaciones convergen y qué mecanismo comparten.', [cite('a'), cite('b')]),
    paragraph('Sin embargo, una tercera fuente limita el alcance y sugiere una lectura provisional.', [cite('c'), cite('a')]),
    paragraph('Por tanto, la síntesis distingue la consecuencia documentada de la hipótesis.', [cite('b'), cite('c')]),
  ].join('\n\n');
  const before = quality.assessDeepResearchSection({ markdown: beforeMarkdown, mode: 'study', sources: allowedSources });
  const after = quality.assessDeepResearchSection({ markdown: afterMarkdown, mode: 'study', sources: allowedSources });
  const allowed = new Set(allowedSources.map((item) => item.citation));
  assert.equal(quality.shouldAcceptQualityRevision(before, after, allowed, afterMarkdown), true);
  const invented = `${afterMarkdown} [Falsa](nodus://idea/invented)`;
  assert.equal(quality.shouldAcceptQualityRevision(before, after, allowed, invented), false);
  assert.equal(quality.shouldAcceptQualityRevision(before, after, allowed, '## Adelgazada\n\nTexto breve.'), false);
});

test('an evidence repair may be accepted at a high score only when verifier concerns fall', () => {
  const sources = [source('a'), source('b'), source('c'), source('p', 'literal')];
  const markdown = [
    paragraph('Dos fuentes convergen porque explican el mecanismo con alcances distintos.', [cite('a'), cite('b')]),
    paragraph('Sin embargo, el pasaje limita la inferencia y no permite generalizar.', [cite('p', 'literal'), cite('c')]),
    paragraph('Por tanto, la comparación revela una consecuencia provisional.', [cite('a'), cite('c')]),
    paragraph('La síntesis distingue lo documentado de la hipótesis.', [cite('b'), cite('p', 'literal')]),
  ].join('\n\n');
  const assessed = quality.assessDeepResearchSection({ markdown, mode: 'academic',sources });
  const allowed = new Set(sources.map((item) => item.citation));
  assert.equal(quality.shouldAcceptEvidenceRepair(assessed, assessed, allowed, markdown, 5, 1), true, JSON.stringify(assessed));
  assert.equal(quality.shouldAcceptEvidenceRepair(assessed, assessed, allowed, markdown, 5, 5), false);
  assert.equal(quality.shouldAcceptEvidenceRepair(assessed, assessed, allowed, `${markdown} [Falsa](nodus://idea/invented)`, 5, 1), false);
});

test('a blind editorial win still cannot cross the deterministic evidence boundary', () => {
  const sources = [source('a'), source('b'), source('c'), source('p', 'literal')];
  const markdown = [
    paragraph('Dos fuentes convergen porque explican el mecanismo con alcances distintos.', [cite('a'), cite('b')]),
    paragraph('Sin embargo, el pasaje limita la inferencia y no permite generalizar.', [cite('p', 'literal'), cite('c')]),
    paragraph('Por tanto, la comparación revela una consecuencia provisional.', [cite('a'), cite('c')]),
    paragraph('La síntesis distingue lo documentado de la hipótesis.', [cite('b'), cite('p', 'literal')]),
  ].join('\n\n');
  const assessed = quality.assessDeepResearchSection({ markdown, mode: 'academic',sources, keyClaims: ['mecanismo'] });
  const allowed = new Set(sources.map((item) => item.citation));
  assert.equal(quality.shouldAcceptEditorialRevision(assessed, assessed, allowed, markdown), true);
  assert.equal(quality.shouldAcceptEditorialRevision(assessed, assessed, allowed, `${markdown} [Falsa](nodus://idea/invented)`), false);
  assert.equal(quality.shouldAcceptEditorialRevision(assessed, assessed, allowed, '## Recorte\n\nTexto sin evidencia.'), false);
});

test('report assessment exposes section-level pass rates and reproducible aggregate metrics', () => {
  const sources = [source('a'), source('b'), source('c')];
  const good = [
    paragraph('Dos fuentes convergen porque explican el mismo mecanismo.', [cite('a'), cite('b')]),
    paragraph('Sin embargo, otra interpretación limita la conclusión y sugiere cautela.', [cite('c'), cite('a')]),
    paragraph('Por tanto, la síntesis compara los resultados y explica su consecuencia.', [cite('b'), cite('c')]),
    paragraph('El alcance permanece provisional y no permite extrapolar.', [cite('a'), cite('c')]),
  ].join('\n\n');
  const report = quality.assessDeepResearchReport({
    mode: 'study',
    objective: 'Explicar el mecanismo',
    sections: [
      { title: 'Sólida', markdown: `## Sólida\n\n${good}`, sources },
      { title: 'Floja', markdown: `## Floja\n\n${paragraph('Una nota aislada.')}`, sources },
    ],
  });
  assert.equal(report.sections, 2);
  assert.ok(report.sectionsPassing < report.sections);
  assert.ok(report.metrics.distinctSources >= 3);
  assert.equal(report.version, 1);
  assert.match(report.caveat, /No certifican/);
});

test('a report cannot pass thresholds while omitting an atomic part of the brief', () => {
  const sources = [source('a'), source('b'), source('c')];
  const markdown = [
    paragraph('Los salvoconductos funcionaron como regulación de la movilidad porque constituían un mecanismo administrativo.', [cite('a'), cite('b')]),
    paragraph('La comparación de las fuentes sugiere límites y una aplicación desigual.', [cite('b'), cite('c')]),
    paragraph('Por tanto, el control de desplazamientos tuvo consecuencias laborales.', [cite('a'), cite('c')]),
    paragraph('La síntesis mantiene provisional el alcance de esta interpretación.', [cite('a'), cite('b')]),
  ].join('\n\n');
  const report = quality.assessDeepResearchReport({
    mode: 'academic',
    objective: 'Explicar el control rural.',
    coverageQuestions: ['¿Cómo funcionaron los salvoconductos?', '¿Cuándo se desbloqueó el éxodo rural?'],
    sections: [{ title: 'Control', markdown, sources }],
  });
  assert.equal(report.metrics.objectiveCoverage, 0.5);
  assert.ok(report.issues.includes('incomplete_objective_coverage'));
  assert.notEqual(report.grade, 'passes_thresholds');
});

test('objective coverage requires an audited answer whose evidence survives final prose', () => {
  const sources = [source('a'), source('b'), source('c')];
  const supported = cite('a');
  const markdown = [
    paragraph('El archivo documenta el mecanismo administrativo concreto.', [supported, cite('b')]),
    paragraph('Sin embargo, la comparación limita su alcance.', [cite('b'), cite('c')]),
    paragraph('Por tanto, la síntesis conserva prudencia.', [cite('a'), cite('c')]),
    paragraph('La interpretación permanece provisional.', [cite('a'), cite('b')]),
  ].join('\n\n');
  const questions = ['¿Cómo funcionó el mecanismo administrativo?', '¿Qué recepción internacional tuvo?'];
  const report = quality.assessDeepResearchReport({
    mode: 'academic',
    objective: 'Explicar el mecanismo y su recepción.',
    coverageQuestions: questions,
    coverageEvidence: [
      { question: questions[0], status: 'supported', evidenceTokens: [supported] },
      // A partial verdict without a surviving citation must count as unsupported.
      { question: questions[1], status: 'partial', evidenceTokens: [cite('missing')] },
    ],
    sections: [{ title: 'Mecanismo', markdown, sources }],
  });
  assert.equal(report.metrics.objectiveCoverage, 0.5);
  assert.equal(report.metrics.objectiveRequirementsSupported, 1);
  assert.equal(report.metrics.objectiveRequirementsPartial, 0);
  assert.equal(report.metrics.objectiveRequirementsUnsupported, 1);
  assert.notEqual(report.grade, 'passes_thresholds');
});

test('citation URLs never inflate the measured prose length', () => {
  const refs = Array.from({ length: 50 }, (_, index) => cite(`123e4567-e89b-12d3-a456-4266141740${String(index).padStart(2, '0')}`));
  const markdown = `## Longitud\n\n${'palabra '.repeat(300)} ${refs.join(' ')}`;
  const result = quality.assessDeepResearchSection({ markdown, mode: 'academic' });
  // 300 prose words + two visible label words per citation. UUID/path fragments
  // must contribute exactly zero.
  assert.ok(result.metrics.words >= 390 && result.metrics.words <= 410, `measured ${result.metrics.words} visible words`);
});

test('more words and repeated reformulations cannot improve quality by themselves', () => {
  const sources = [source('a'), source('b'), source('c')];
  const useful = [
    paragraph('Dos fuentes convergen porque explican el mecanismo desde escalas distintas.', [cite('a'), cite('b')]),
    paragraph('Sin embargo, una tercera limita la inferencia y exige cautela.', [cite('c'), cite('a')]),
  ].join('\n\n');
  const base = quality.assessDeepResearchSection({ markdown: useful, mode: 'academic', sources, keyClaims: ['mecanismo'] });
  const padded = quality.assessDeepResearchSection({
    markdown: `${useful}\n\n${'La misma conclusión se reformula sin nueva evidencia ni relación analítica. '.repeat(30)}`,
    mode: 'academic',
    sources,
    keyClaims: ['mecanismo'],
  });
  assert.ok(padded.metrics.words > base.metrics.words);
  assert.ok(padded.score <= base.score, `padding must not raise quality (${base.score} -> ${padded.score})`);
});

test('report-level redundancy is quantified and blocks the highest threshold', () => {
  const sources = [source('a'), source('b'), source('c')];
  const repeated = paragraph('Dos fuentes convergen porque explican el mecanismo y sus consecuencias.', [cite('a'), cite('b')]);
  const assessment = quality.assessDeepResearchReport({
    mode: 'academic',
    sections: [{ title: 'Duplicada', markdown: [repeated, repeated, repeated].join('\n\n'), sources, keyClaims: ['mecanismo'] }],
  });
  assert.ok(assessment.metrics.redundancyRate > 0.15);
  assert.ok(assessment.issues.includes('repetition'));
  assert.notEqual(assessment.grade, 'passes_thresholds');
});

test('a high support-repair rate blocks the top quality threshold', () => {
  const sources = [source('a'), source('b'), source('c')];
  const markdown = [
    paragraph('Dos fuentes convergen porque explican el mismo mecanismo.', [cite('a'), cite('b')]),
    paragraph('Sin embargo, otra interpretación limita la conclusión.', [cite('c'), cite('a')]),
    paragraph('Por tanto, la síntesis mantiene provisional el alcance.', [cite('b'), cite('c')]),
    paragraph('La comparación distingue evidencia e inferencia.', [cite('a'), cite('c')]),
  ].join('\n\n');
  const report = quality.assessDeepResearchReport({
    mode: 'academic',
    objective: 'Explicar el mecanismo',
    verification: { checked: 100, partial: 29, unsupported: 8, unverified: 0 },
    sections: [{ title: 'Informe', markdown, sources }],
  });
  assert.equal(report.metrics.supportConcernRate, 0.37);
  assert.ok(report.issues.includes('high_support_repair_rate'));
  assert.notEqual(report.grade, 'passes_thresholds');
});

test('an unresolved internal contradiction blocks the top quality threshold', () => {
  const sources = [source('a'), source('b'), source('c')];
  const markdown = [
    paragraph('Dos fuentes convergen porque explican el mismo mecanismo.', [cite('a'), cite('b')]),
    paragraph('Sin embargo, otra interpretación limita la conclusión.', [cite('c'), cite('a')]),
    paragraph('Por tanto, la síntesis mantiene provisional el alcance.', [cite('b'), cite('c')]),
    paragraph('La comparación distingue evidencia e inferencia.', [cite('a'), cite('c')]),
  ].join('\n\n');
  const report = quality.assessDeepResearchReport({
    mode: 'academic',
    objective: 'Explicar el mecanismo',
    internalContradictions: 1,
    sections: [{ title: 'Informe', markdown, sources }],
  });
  assert.equal(report.metrics.internalContradictions, 1);
  assert.ok(report.issues.includes('internal_contradiction'));
  assert.notEqual(report.grade, 'passes_thresholds');
});
