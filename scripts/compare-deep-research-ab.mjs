// Re-measures two saved Deep Research runs with one identical yardstick.
//
// The per-run metrics are written by the harness at generation time; this reads the
// stored reports back and derives the comparison numbers offline, so the two sides
// are always measured by the same code even when they were generated hours apart.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2];
if (!dir) throw new Error('Usage: node scripts/compare-deep-research-ab.mjs <dir-with-before.json-and-after.json>');

const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-dr-compare-'));
try {
  const outfile = path.join(tmp, 'writingDocument.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/writingDocument.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { documentBodyForPanels } = await import(pathToFileURL(outfile).href);

  const CITATION = /\[([^\]]*)\]\(nodus:\/\/(idea|work|passage|gap|contradiction)\/([^)]+)\)/g;
  const HEADING = /^##\s+(.+)$/gmu;

  const measure = (file) => {
    const { metrics, report } = JSON.parse(readFileSync(file, 'utf8'));
    const md = report.draft.draftMarkdown ?? '';
    // Prose = what the reader actually reads: body only, no reference list, no
    // limitation bullets. Counting the bibliography made a longer report look shorter.
    const body = documentBodyForPanels(md, report.draft.abstract ?? '')
      .split(/^##\s+(?:Referencias|References|Références|Literaturverzeichnis|Kaynakça|Bibliografia|Referências)\s*$/mu)[0];
    const words = body
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*_`>|-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean).length;

    const cited = { idea: new Set(), work: new Set(), passage: new Set(), gap: new Set(), contradiction: new Set() };
    let total = 0;
    for (const m of md.matchAll(CITATION)) {
      cited[m[2]].add(decodeURIComponent(m[3]));
      total += 1;
    }
    const abstract = (report.draft.abstract ?? '').trim();
    return {
      label: metrics.label,
      sections: report.meta.sections,
      bodyWords: report.meta.words,
      bodyPages: report.meta.pages,
      targetPages: `${report.meta.targetPages.min}–${report.meta.targetPages.max}`,
      insideTarget: report.meta.pages >= report.meta.targetPages.min && report.meta.pages <= report.meta.targetPages.max,
      readerWords: words,
      headings: [...body.matchAll(HEADING)].map((m) => m[1]),
      citationsTotal: total,
      wordsPerCitation: total > 0 ? Math.round(words / total) : null,
      ideasClaimed: report.meta.ideasCovered,
      ideasCited: cited.idea.size,
      coverageHonesty: report.meta.ideasCovered > 0 ? Number((cited.idea.size / report.meta.ideasCovered).toFixed(3)) : null,
      passagesCited: cited.passage.size,
      gapsCited: cited.gap.size,
      contradictionsCited: cited.contradiction.size,
      worksCited: report.meta.worksCited,
      topUpRan: metrics.coverageTopUpRan,
      sectionRetrieval: metrics.sectionRetrieval ?? { available: false },
      limitations: report.draft.limitations.length,
      // What the reader sees once the surfaces stop repeating the structured fields.
      abstractRepeatedInReaderBody: abstract.length > 0 && documentBodyForPanels(md, abstract).includes(abstract),
      limitationsRepeatedInReaderBody: /^##\s+(Limitaciones|Limitations)/mu.test(documentBodyForPanels(md, abstract)),
    };
  };

  const before = measure(path.join(dir, 'before.json'));
  const after = measure(path.join(dir, 'after.json'));
  const rows = [
    ['secciones', before.sections, after.sections],
    ['palabras del cuerpo', before.bodyWords, after.bodyWords],
    ['páginas del cuerpo', `${before.bodyPages} (objetivo ${before.targetPages})`, `${after.bodyPages} (objetivo ${after.targetPages})`],
    ['dentro del objetivo', before.insideTarget, after.insideTarget],
    ['citas totales', before.citationsTotal, after.citationsTotal],
    ['palabras por cita', before.wordsPerCitation, after.wordsPerCitation],
    ['ideas declaradas cubiertas', before.ideasClaimed, after.ideasClaimed],
    ['ideas realmente citadas', before.ideasCited, after.ideasCited],
    ['honestidad de la cobertura', before.coverageHonesty, after.coverageHonesty],
    ['pasajes literales citados', before.passagesCited, after.passagesCited],
    ['huecos citados', before.gapsCited, after.gapsCited],
    ['contradicciones citadas', before.contradictionsCited, after.contradictionsCited],
    ['obras en la bibliografía', before.worksCited, after.worksCited],
    ['rescate de cobertura', before.topUpRan, after.topUpRan],
    ['consultas por sección', before.sectionRetrieval.calls ?? 0, after.sectionRetrieval.calls ?? 0],
    ['pasajes recuperados al redactar', before.sectionRetrieval.passages ?? 0, after.sectionRetrieval.passages ?? 0],
    ['limitaciones declaradas', before.limitations, after.limitations],
    ['resumen repetido en el lector', before.abstractRepeatedInReaderBody, after.abstractRepeatedInReaderBody],
    ['limitaciones repetidas en el lector', before.limitationsRepeatedInReaderBody, after.limitationsRepeatedInReaderBody],
  ];
  const pad = (v, n) => String(v).padEnd(n);
  console.log(`${pad('métrica', 36)}${pad('antes', 22)}después`);
  console.log('-'.repeat(78));
  for (const [name, b, a] of rows) console.log(`${pad(name, 36)}${pad(b, 22)}${a}`);
  console.log('\nEpígrafes antes:  ', before.headings.join(' · '));
  console.log('Epígrafes después:', after.headings.join(' · '));
} finally {
  await rm(tmp, { recursive: true, force: true });
}
