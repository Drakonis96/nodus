// Headless smoke for the Author Dossier + Synthesis Matrix data path. Seeds the
// bundled demo corpus into a throwaway DB and exercises the REAL service
// functions (pure-DB assembly only — no AI calls). Verifies migration 22 applies
// and that the queries return coherent, non-empty structures. Run via:
//   rm -rf /tmp/nodus-smoke-userdata && \
//   npx esbuild scripts/smoke-authors.ts --bundle --platform=node --format=esm \
//     --outfile=.smoke-authors.mjs --external:better-sqlite3 \
//     --alias:electron=./scripts/stub-electron.mjs && \
//   NODUS_TEST_USERDATA=/tmp/nodus-smoke-userdata node .smoke-authors.mjs
import { seedDemoData } from '../electron/db/demoData';
import { listAuthors, buildAuthorDossier } from '../electron/ai/authorDossier';
import { buildSynthesisMatrix } from '../electron/ai/synthesisMatrix';
import { getDb } from '../electron/db/database';

seedDemoData();

// ── Migration 22: cache tables exist ─────────────────────────────────────────
const tables = getDb()
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('author_dossier_synthesis','synthesis_matrix_cell')"
  )
  .all() as { name: string }[];
console.log(`cache tables: ${tables.map((t) => t.name).join(', ') || '(none)'}`);
if (tables.length !== 2) throw new Error('migration 22 did not create both cache tables');

// ── listAuthors ──────────────────────────────────────────────────────────────
const authors = listAuthors();
console.log(`\nauthors: ${authors.length}`);
if (authors.length === 0) throw new Error('listAuthors returned nothing');
for (const a of authors.slice(0, 5)) {
  console.log(
    `  • ${a.name} — ${a.workCount} obras, ${a.ideaCount} ideas, ${a.relationCount} conexiones` +
      (a.topThemes.length ? `, temas: ${a.topThemes.join(' / ')}` : '')
  );
}

// ── buildAuthorDossier (pick a well-connected author) ────────────────────────
const target = authors.find((a) => a.relationCount > 0) ?? authors[0];
const dossier = buildAuthorDossier(target.author_id);
if (!dossier) throw new Error('buildAuthorDossier returned null');
console.log(`\ndossier for "${dossier.author.name}":`);
console.log(
  `  ideas ${dossier.ideas.length} · relations ${dossier.relations.length} · works ${dossier.works.length} · themes ${dossier.themes.length}`
);
if (dossier.ideas.length === 0) throw new Error('dossier has no ideas');
const ideasWithEvidence = dossier.ideas.filter((i) => i.evidence.length > 0).length;
const ideasWithThemes = dossier.ideas.filter((i) => i.themes.length > 0).length;
console.log(`  ideas with evidence: ${ideasWithEvidence} · ideas with themes: ${ideasWithThemes}`);
console.log(`  synthesis cached: ${dossier.synthesis ? 'yes' : 'no (expected on fresh corpus)'}`);
for (const r of dossier.relations.slice(0, 3)) {
  console.log(`  relation: ${r.type} → ${r.name} (peso ${r.weight.toFixed(2)}, comunes: ${r.sharedThemes.join(', ') || '—'})`);
}
const sampleIdea = dossier.ideas[0];
console.log(`  sample idea [${sampleIdea.type}]: ${sampleIdea.label}`);

// ── buildSynthesisMatrix ─────────────────────────────────────────────────────
const matrix = buildSynthesisMatrix();
console.log(`\nmatrix: ${matrix.authors.length} authors × ${matrix.themes.length} themes · ${matrix.cells.length} cells`);
if (matrix.cells.length === 0) throw new Error('matrix produced no cells');
const filled = matrix.cells.filter((c) => c.ideaCount > 0).length;
console.log(`  non-empty cells: ${filled}`);
const cell = matrix.cells.reduce((a, b) => (b.ideaCount > a.ideaCount ? b : a));
const cAuthor = matrix.authors.find((a) => a.author_id === cell.authorId)?.name;
const cTheme = matrix.themes.find((t) => t.theme_id === cell.themeId)?.label;
console.log(`  densest cell: "${cAuthor}" × "${cTheme}" → ${cell.ideaCount} ideas (e.g. ${cell.ideas[0]?.label})`);
if (matrix.cells.some((c) => c.stance !== null)) throw new Error('unexpected cached stance on fresh corpus');

console.log('\nOK ✓');
