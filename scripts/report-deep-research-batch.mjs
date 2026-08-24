// Aggregates a batch of Deep Research reports into the numbers that decide whether
// the engine is reliably good, not luckily good once.
//
//   electron -e … / ELECTRON_RUN_AS_NODE=1 electron scripts/report-deep-research-batch.mjs <batch-dir> <vault.sqlite>
//
// Every figure is derived from the saved reports; no model is asked anything.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [dir, dbPath] = process.argv.slice(2);
if (!dir) throw new Error('Usage: report-deep-research-batch.mjs <batch-dir> [vault.sqlite]');
const db = dbPath ? new (require('better-sqlite3'))(dbPath, { readonly: true }) : null;
const workOfIdea = db
  ? db.prepare('SELECT nodus_id FROM idea_occurrences WHERE global_id = ? ORDER BY confidence DESC LIMIT 1')
  : null;

const LINK = /\[[^\]\n]*\]\(nodus:\/\/(idea|work|passage|gap|contradiction)\/([^)\s]+)\)/g;
const ANY_REF = /nodus:\/\//g;

function analyze(file) {
  const { metrics, report } = JSON.parse(readFileSync(file, 'utf8'));
  const md = report.draft.draftMarkdown ?? '';

  const cited = { idea: new Set(), work: new Set(), passage: new Set(), gap: new Set(), contradiction: new Set() };
  let total = 0;
  for (const m of md.matchAll(LINK)) {
    cited[m[1]].add(decodeURIComponent(m[2]));
    total += 1;
  }
  // Anything matching nodus:// that is NOT inside a well-formed link leaked raw.
  const broken = (md.match(ANY_REF) ?? []).length - total;

  // Source concentration: the share of idea citations that trace to the single most
  // used work. High means the report is propped up on one book.
  const perWork = new Map();
  if (workOfIdea) {
    for (const id of cited.idea) {
      const row = workOfIdea.get(id);
      if (row?.nodus_id) perWork.set(row.nodus_id, (perWork.get(row.nodus_id) ?? 0) + 1);
    }
  }
  const topWorkShare = perWork.size
    ? Math.max(...perWork.values()) / [...perWork.values()].reduce((a, b) => a + b, 0)
    : null;

  const body = md
    .split(/^##\s+/mu)
    .slice(1)
    .map((b) => ({ title: b.slice(0, b.indexOf('\n')).trim(), text: b.slice(b.indexOf('\n') + 1) }))
    .filter((b) => !/^(Resumen|Abstract|Limitaciones|Limitations|Referencias|References)$/i.test(b.title));

  // A section is "thin" when it carries almost no sourcing of its own.
  const thinSections = body.filter((b) => (b.text.match(LINK) ?? []).length < 3).length;
  const colonTitles = body.filter((b) => /[:;—]/.test(b.title)).length;

  return {
    label: metrics.label,
    topic: metrics.topic,
    pages: report.meta.pages,
    words: report.meta.words,
    sections: body.length,
    thinSections,
    colonTitles,
    citations: total,
    ideas: cited.idea.size,
    passages: cited.passage.size,
    gaps: cited.gap.size,
    debates: cited.contradiction.size,
    works: report.meta.worksCited,
    distinctWorksBehindIdeas: perWork.size,
    topWorkShare,
    broken,
    verification: report.meta.verification ?? null,
    qualityScore: report.draft.qualityAssessment?.score ?? null,
    objectiveCoverage: report.draft.qualityAssessment?.metrics?.objectiveCoverage ?? null,
    redundancy: report.draft.qualityAssessment?.metrics?.redundancyRate ?? null,
    retrievals: metrics.probe?.retrievals ?? 0,
    seconds: metrics.elapsedSeconds,
    titles: body.map((b) => b.title),
  };
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const rows = files.map((f) => analyze(path.join(dir, f)));
if (rows.length === 0) throw new Error(`No reports in ${dir}`);

const pad = (v, n) => String(v).padEnd(n);
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
console.log(
  pad('informe', 15) + pad('pág', 5) + pad('calid', 7) + pad('sec', 5) + pad('flojas', 8) +
    pad('citas', 7) + pad('ideas', 7) + pad('pasajes', 9) + pad('huecos', 8) + pad('debates', 9) +
    pad('obras', 7) + pad('conc.', 7) + 'rotas'
);
console.log('─'.repeat(105));
for (const r of rows) {
  console.log(
    pad(r.label, 15) + pad(r.pages, 5) + pad(r.qualityScore ?? '—', 7) + pad(r.sections, 5) + pad(r.thinSections, 8) +
      pad(r.citations, 7) + pad(r.ideas, 7) + pad(r.passages, 9) + pad(r.gaps, 8) + pad(r.debates, 9) +
      pad(r.works, 7) + pad(pct(r.topWorkShare), 7) + r.broken
  );
}

const stat = (pick) => {
  const values = rows.map(pick).filter((v) => v != null && Number.isFinite(v));
  if (!values.length) return { mean: 0, min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { mean, min: Math.min(...values), max: Math.max(...values) };
};
const show = (name, s, fmt = (v) => v.toFixed(1)) =>
  console.log(`${pad(name, 34)}media ${pad(fmt(s.mean), 10)}rango ${fmt(s.min)} – ${fmt(s.max)}`);

console.log(`\n═══ ${rows.length} informes ═══`);
show('páginas del cuerpo', stat((r) => r.pages));
show('cobertura del encargo', stat((r) => r.objectiveCoverage), (v) => `${Math.round(v * 100)}%`);
show('redundancia proposicional', stat((r) => r.redundancy), (v) => `${Math.round(v * 100)}%`);
show('citas por informe', stat((r) => r.citations));
show('obras distintas citadas', stat((r) => r.works));
show('concentración en una obra', stat((r) => r.topWorkShare), (v) => `${Math.round(v * 100)}%`);
show('pasajes literales', stat((r) => r.passages));
show('debates citados', stat((r) => r.debates));
show('huecos citados', stat((r) => r.gaps));
show('secciones flojas (<3 citas)', stat((r) => r.thinSections));
show('referencias rotas', stat((r) => r.broken));
show('segundos por informe', stat((r) => r.seconds), (v) => v.toFixed(0));

const verified = rows.filter((r) => r.verification);
if (verified.length) {
  const checked = verified.reduce((n, r) => n + r.verification.checked, 0);
  const partial = verified.reduce((n, r) => n + r.verification.partial, 0);
  const unsupported = verified.reduce((n, r) => n + r.verification.unsupported, 0);
  console.log(`\n═══ Verificación de respaldo (${verified.length}/${rows.length} informes) ═══`);
  console.log(`Afirmaciones comprobadas      ${checked}`);
  console.log(`Respaldo parcial              ${partial} (${Math.round((partial / Math.max(1, checked)) * 100)}%)`);
  console.log(`Citas retiradas por infundadas ${unsupported} (${Math.round((unsupported / Math.max(1, checked)) * 100)}%)`);
  console.log(`Tasa de respaldo verificado   ${Math.round(((checked - unsupported) / Math.max(1, checked)) * 100)}%`);
}

const clean = rows.filter((r) => r.broken === 0).length;
const noThin = rows.filter((r) => r.thinSections === 0).length;
const withDebate = rows.filter((r) => r.debates > 0).length;
const withGap = rows.filter((r) => r.gaps > 0).length;
const withPassage = rows.filter((r) => r.passages > 0).length;
console.log(`\nCon evaluación de calidad     ${rows.filter((r) => r.qualityScore != null).length}/${rows.length}`);
console.log(`Sin referencias rotas         ${clean}/${rows.length}`);
console.log(`Sin secciones flojas          ${noThin}/${rows.length}`);
console.log(`Con al menos un debate        ${withDebate}/${rows.length}`);
console.log(`Con al menos un hueco         ${withGap}/${rows.length}`);
console.log(`Con evidencia textual         ${withPassage}/${rows.length}`);

console.log('\n═══ Orden de las secciones por tema ═══');
for (const topic of [...new Set(rows.map((r) => r.topic))]) {
  console.log(`\n▸ ${topic}`);
  for (const r of rows.filter((x) => x.topic === topic)) {
    console.log(`   ${r.label}: ${r.titles.map((t) => t.split(/[:;—]/)[0].trim().slice(0, 34)).join(' → ')}`);
  }
}
db?.close();
