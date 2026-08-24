/**
 * Read-only professional-quality audit of persisted Deep Research reports.
 *
 * Run with Electron-as-Node because Nodus' better-sqlite3 binary is built for
 * Electron. The source vault is opened readonly + query_only and never migrated.
 *
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit-deep-research-quality.mjs \
 *     --db "/path/to/nodus.sqlite" --out reports/deep-research-quality-baseline.json
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (name, fallback = '') => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const dbPath = path.resolve(arg('--db', '/Users/jorgepb96/Library/Application Support/nodus/nodus.sqlite'));
const outPath = path.resolve(arg('--out', path.join(repoRoot, 'reports/deep-research-quality-baseline.json')));
const markdownPath = outPath.replace(/\.json$/iu, '.md');
const statBefore = fs.statSync(dbPath);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-dr-quality-'));

const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const stats = (values) => values.length
  ? { mean: round(mean(values)), median: round(median(values)), min: round(Math.min(...values)), max: round(Math.max(...values)) }
  : { mean: 0, median: 0, min: 0, max: 0 };
const safeJson = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};
const LINK_RE = /\[([^\]\n]*)\]\((nodus:\/\/(idea|work|passage|gap|contradiction|study|archive)\/([^)\s]+))\)/giu;

try {
  const outfile = path.join(tmp, 'deepResearchQuality.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/deepResearchQuality.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { assessDeepResearchReport } = await import(pathToFileURL(outfile).href);
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  const rows = db.prepare(
    'SELECT id,title,brief_json,selection_json,model_json,draft_json,created_at,updated_at FROM writing_saved_drafts ORDER BY updated_at ASC',
  ).all();
  assert.ok(rows.length > 0, 'No hay informes persistidos que auditar.');

  const ideaWork = db.prepare(
    `SELECT io.nodus_id,w.title,w.authors_json,w.year
       FROM idea_occurrences io JOIN works w ON w.nodus_id=io.nodus_id
      WHERE io.global_id=? ORDER BY io.confidence DESC,w.year DESC LIMIT 1`,
  );
  const passageWork = db.prepare(
    `SELECT p.nodus_id,w.title,w.authors_json,w.year
       FROM passages p JOIN works w ON w.nodus_id=p.nodus_id WHERE p.passage_id=?`,
  );
  const work = db.prepare('SELECT nodus_id,title,authors_json,year FROM works WHERE nodus_id=?');

  const reports = rows.map((row) => {
    const draft = safeJson(row.draft_json, {});
    const brief = safeJson(row.brief_json, draft.brief ?? {});
    const model = safeJson(row.model_json, draft.generationModel ?? null);
    const markdown = String(draft.draftMarkdown ?? '');
    const refs = [...markdown.matchAll(LINK_RE)].map((match) => ({
      label: match[1], citation: match[2], kind: match[3].toLowerCase(), id: decodeURIComponent(match[4]),
    }));
    const sourceByUrl = new Map();
    for (const ref of refs) {
      let rowSource = null;
      if (ref.kind === 'idea') rowSource = ideaWork.get(ref.id);
      else if (ref.kind === 'passage') rowSource = passageWork.get(ref.id);
      else if (ref.kind === 'work') rowSource = work.get(ref.id);
      const sourceId = rowSource?.nodus_id
        ?? (ref.kind === 'study' || ref.kind === 'archive' ? `${ref.kind}:${ref.id}` : `${ref.kind}:${ref.id}`);
      sourceByUrl.set(ref.citation, {
        citation: ref.citation,
        sourceId,
        evidence: ref.kind === 'passage' ? 'literal' : ref.kind === 'study' || ref.kind === 'archive' ? 'document' : 'synthesis',
      });
    }
    const blocks = markdown
      .split(/^##\s+/gmu)
      .slice(1)
      .map((block) => {
        const newline = block.indexOf('\n');
        return { title: block.slice(0, newline).trim(), markdown: block.slice(newline + 1).trim() };
      })
      .filter((block) => !/^(?:Resumen|Abstract|Résumé|Resumo|Limitaciones|Limitations|Limites|Einschränkungen|Sınırlılıklar|Referencias|References|Références|Bibliografia|Bibliography|Literaturverzeichnis|Kaynakça|Fuentes de estudio|Materiales de la unidad|Fuentes)$/iu.test(block.title));
    const assessment = assessDeepResearchReport({
      mode: 'academic',
      objective: brief.objective ?? '',
      sections: blocks.map((block) => ({ ...block, sources: [...sourceByUrl.values()] })),
    });
    const uniqueByKind = Object.fromEntries(
      ['idea', 'work', 'passage', 'gap', 'contradiction', 'study', 'archive'].map((kind) => [
        kind,
        new Set(refs.filter((ref) => ref.kind === kind).map((ref) => ref.id)).size,
      ]),
    );
    const citationsBySource = new Map();
    for (const ref of refs) {
      const source = sourceByUrl.get(ref.citation)?.sourceId ?? ref.citation;
      citationsBySource.set(source, (citationsBySource.get(source) ?? 0) + 1);
    }
    const support = draft.supportAudit ?? [];
    return {
      id: row.id,
      title: row.title,
      objective: brief.objective ?? '',
      updatedAt: row.updated_at,
      model: model ? `${model.provider}/${model.model}` : null,
      generation: support.length || draft.generationModel ? 'current' : 'legacy',
      assessment,
      raw: {
        sections: blocks.length,
        citationMentions: refs.length,
        uniqueCitations: new Set(refs.map((ref) => ref.citation)).size,
        uniqueByKind,
        bibliographyEntries: Array.isArray(draft.bibliography) ? draft.bibliography.length : 0,
        supportAuditEntries: support.length,
        supportAuditPartial: support.filter((entry) => entry.verdict === 'partial').length,
        supportAuditRemoved: support.filter((entry) => entry.verdict === 'removed').length,
        sourceCitationCounts: [...citationsBySource.values()].sort((a, b) => b - a),
      },
      sectionDetails: blocks.map((block, index) => ({
        title: block.title,
        ...assessment.sectionScores[index],
      })),
    };
  });
  db.close();

  const aggregate = (items) => ({
    reports: items.length,
    score: stats(items.map((item) => item.assessment.score)),
    passesThresholds: items.filter((item) => ['passes_thresholds', 'professional'].includes(item.assessment.grade)).length,
    strongOrBetter: items.filter((item) => ['strong', 'passes_thresholds', 'professional'].includes(item.assessment.grade)).length,
    sectionPassRate: round(items.reduce((sum, item) => sum + item.assessment.sectionsPassing, 0) / Math.max(1, items.reduce((sum, item) => sum + item.assessment.sections, 0))),
    directEvidencePerThousandWords: round(items.reduce((sum, item) => sum + item.assessment.metrics.directEvidenceCitations, 0) / Math.max(1, items.reduce((sum, item) => sum + item.assessment.metrics.words, 0) / 1000)),
    crossSourceParagraphsPerReport: round(mean(items.map((item) => item.assessment.metrics.crossSourceParagraphs))),
    effectiveSources: stats(items.map((item) => item.assessment.metrics.effectiveSources)),
    topSourceShare: stats(items.map((item) => item.assessment.metrics.topSourceShare)),
    uncitedParagraphShare: stats(items.map((item) => item.assessment.metrics.uncitedParagraphShare)),
    citationMentions: stats(items.map((item) => item.raw.citationMentions)),
    uniqueCitations: stats(items.map((item) => item.raw.uniqueCitations)),
    passageCitations: stats(items.map((item) => item.raw.uniqueByKind.passage)),
  });
  const current = reports.filter((item) => item.generation === 'current');
  const legacy = reports.filter((item) => item.generation === 'legacy');
  const issueFrequency = Object.fromEntries(
    [...new Set(reports.flatMap((item) => item.assessment.issues))].map((issue) => [
      issue,
      reports.filter((item) => item.assessment.issues.includes(issue)).length,
    ]),
  );
  const statAfter = fs.statSync(dbPath);
  const audit = {
    generatedAt: new Date().toISOString(),
    methodology: {
      rubricVersion: 1,
      source: 'Persisted Deep Research drafts, evaluated read-only with shared/deepResearchQuality.ts.',
      caveat: 'The deterministic score measures depth signals, grounding and diversity. It is paired with expert reading; it does not certify historical truth.',
      thresholds: {
        professionalScore: 85,
        sectionPassingScore: 72,
        maximumUncitedSubstantiveParagraphShare: 0.2,
        maximumTopSourceShare: 0.65,
        minimumSourcesPerSectionWhenAvailable: 3,
        minimumCrossSourceSynthesisParagraphs: 1,
      },
    },
    isolation: {
      dbPath,
      readonly: true,
      queryOnly: true,
      sourceUnchanged: statBefore.dev === statAfter.dev && statBefore.ino === statAfter.ino && statBefore.size === statAfter.size && statBefore.mtimeMs === statAfter.mtimeMs,
      before: { dev: statBefore.dev, ino: statBefore.ino, size: statBefore.size, mtimeMs: statBefore.mtimeMs },
      after: { dev: statAfter.dev, ino: statAfter.ino, size: statAfter.size, mtimeMs: statAfter.mtimeMs },
    },
    aggregate: { all: aggregate(reports), current: aggregate(current), legacy: aggregate(legacy) },
    issueFrequency,
    reports,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(audit, null, 2)}\n`);
  const pct = (value) => `${round(value * 100, 1)}%`;
  const md = [
    '# Auditoría de calidad de Deep Research',
    '',
    `Informes auditados: **${reports.length}**. La base real se abrió en modo de solo lectura y quedó sin cambios: **${audit.isolation.sourceUnchanged ? 'sí' : 'NO'}**.`,
    '',
    '## Resultado agregado',
    '',
    '| Cohorte | Informes | Puntuación media | Secciones que superan umbrales | Evidencia directa / 1.000 palabras | Fuentes efectivas | Concentración principal |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...[['Todos', audit.aggregate.all], ['Actuales', audit.aggregate.current], ['Legacy', audit.aggregate.legacy]].map(([label, group]) =>
      `| ${label} | ${group.reports} | ${group.score.mean} | ${pct(group.sectionPassRate)} | ${group.directEvidencePerThousandWords} | ${group.effectiveSources.mean} | ${pct(group.topSourceShare.mean)} |`,
    ),
    '',
    '## Fallos más frecuentes',
    '',
    ...Object.entries(issueFrequency).sort((a, b) => b[1] - a[1]).map(([issue, count]) => `- ${issue}: ${count}/${reports.length}`),
    '',
    '## Informes',
    '',
    '| Informe | Fecha | Palabras | Puntuación | Grado | Pasajes únicos | Fuentes efectivas | Concentración | Síntesis multifuente |',
    '|---|---|---:|---:|---|---:|---:|---:|---:|',
    ...[...reports].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) =>
      `| ${String(item.title).replace(/\|/g, '\\|')} | ${item.updatedAt.slice(0, 10)} | ${item.assessment.metrics.words} | ${item.assessment.score} | ${item.assessment.grade} | ${item.raw.uniqueByKind.passage} | ${item.assessment.metrics.effectiveSources} | ${pct(item.assessment.metrics.topSourceShare)} | ${item.assessment.metrics.crossSourceParagraphs} |`,
    ),
    '',
    `> ${reports[0]?.assessment.caveat ?? ''}`,
    '',
  ].join('\n');
  fs.writeFileSync(markdownPath, md);
  console.log(JSON.stringify({ outPath, markdownPath, reports: reports.length, aggregate: audit.aggregate, issues: issueFrequency, sourceUnchanged: audit.isolation.sourceUnchanged }, null, 2));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
