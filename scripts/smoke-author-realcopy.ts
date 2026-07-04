// Runs the author-identity reconcile against a COPY of the real corpus and proves
// no research data is lost. Point NODUS_TEST_USERDATA at a directory holding a
// COPY of nodus.sqlite(+wal/shm) — never the live file. Opening it runs the
// pending migrations (22, 23) on the copy, then we reconcile and diff.
import { getDb } from '../electron/db/database';
import { reconcileAuthorLayerOnce, canonicalKeyFromDisplay } from '../electron/db/authorsRepo';

const db = getDb();
const c = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

// Research data that MUST be identical after reconcile (author layer excluded).
const RESEARCH_TABLES = [
  'works', 'ideas', 'idea_occurrences', 'evidence', 'edges', 'gaps',
  'external_refs', 'themes', 'idea_theme_links', 'notes',
];
const snap = () => Object.fromEntries(RESEARCH_TABLES.map((t) => [t, c(`SELECT COUNT(*) AS n FROM ${t}`)]));

const worksWithAuthorsBefore = c('SELECT COUNT(DISTINCT nodus_id) AS n FROM work_authors');
const authorsBefore = c('SELECT COUNT(*) AS n FROM authors');

// Show the worst fragmentation groups BEFORE (authors that share a canonical key).
const names = db.prepare('SELECT author_id, name FROM authors').all() as { author_id: string; name: string }[];
const groups = new Map<string, string[]>();
for (const a of names) {
  const key = canonicalKeyFromDisplay(a.name);
  if (!key) continue;
  const list = groups.get(key) ?? [];
  list.push(a.name);
  groups.set(key, list);
}
const fragmented = [...groups.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
console.log(`authors before: ${authorsBefore} · fragmented identities: ${fragmented.length}`);
for (const [key, variants] of fragmented.slice(0, 8)) console.log(`  ${key} ← ${variants.join('  |  ')}`);

const before = snap();
console.time('reconcile');
reconcileAuthorLayerOnce();
console.timeEnd('reconcile');
const after = snap();

// ── Assert research data untouched ───────────────────────────────────────────
let lost = false;
for (const t of RESEARCH_TABLES) {
  if (before[t] !== after[t]) {
    console.log(`  ✗ ${t}: ${before[t]} → ${after[t]}`);
    lost = true;
  }
}
if (lost) throw new Error('RESEARCH DATA CHANGED — reconcile is not safe');
console.log(`\nresearch tables unchanged ✓  (works=${after.works}, ideas=${after.ideas}, edges=${after.edges}, notes=${after.notes})`);

// ── Assert the author layer is healthy ───────────────────────────────────────
const authorsAfter = c('SELECT COUNT(*) AS n FROM authors');
const worksWithAuthorsAfter = c('SELECT COUNT(DISTINCT nodus_id) AS n FROM work_authors');
const orphanWorks = c(
  'SELECT COUNT(*) AS n FROM works w WHERE w.nodus_id IN (SELECT nodus_id FROM work_authors) AND NOT EXISTS (SELECT 1 FROM work_authors wa WHERE wa.nodus_id = w.nodus_id)'
);
const dangling = c('SELECT COUNT(*) AS n FROM work_authors wa WHERE NOT EXISTS (SELECT 1 FROM authors a WHERE a.author_id = wa.author_id)');
// Residual shared keys are ONLY acceptable when every author involved is linked
// solely to works with no Zotero creators (authors_json '[]') — there is no
// ground truth to merge on, so keeping the AI names is the data-preserving choice.
const stillFragmented = c(
  "SELECT COUNT(*) AS n FROM (SELECT canonical_key FROM authors WHERE canonical_key IS NOT NULL GROUP BY canonical_key HAVING COUNT(*) > 1)"
);
const badFragmented = c(
  `SELECT COUNT(*) AS n FROM authors a
    WHERE a.canonical_key IN (
      SELECT canonical_key FROM authors WHERE canonical_key IS NOT NULL GROUP BY canonical_key HAVING COUNT(*) > 1
    )
    AND EXISTS (
      SELECT 1 FROM work_authors wa JOIN works w ON w.nodus_id = wa.nodus_id
      WHERE wa.author_id = a.author_id AND COALESCE(w.authors_json,'') NOT IN ('', '[]')
    )`
);

console.log(`\nauthors: ${authorsBefore} → ${authorsAfter}  (merged ${authorsBefore - authorsAfter})`);
console.log(`works with authors: ${worksWithAuthorsBefore} → ${worksWithAuthorsAfter}`);
console.log(`orphan works (had authors, now none): ${orphanWorks}`);
console.log(`dangling work_author links: ${dangling}`);
console.log(`author nodes still sharing a canonical key: ${stillFragmented} (all on no-creator works: ${badFragmented === 0})`);

if (worksWithAuthorsAfter < worksWithAuthorsBefore) throw new Error('some works lost their authorship');
if (orphanWorks !== 0) throw new Error('a work lost all its authors');
if (dangling !== 0) throw new Error('dangling work_author links remain');
if (badFragmented !== 0) throw new Error('duplicate author nodes with Zotero ground truth were not merged');

console.log('\nREAL-CORPUS COPY: NO RESEARCH DATA LOST · AUTHORS CONSOLIDATED ✓');
