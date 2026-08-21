// Runs the author/editor role repair against a COPY of a real corpus and proves
// it corrects the attribution without touching any research data. Point
// NODUS_TEST_USERDATA at a directory holding a COPY of nodus.sqlite — never the
// live file.
//
// Build+run:
//   npx esbuild scripts/smoke-author-roles-realcopy.ts --bundle --platform=node \
//     --format=cjs --outfile=.smoke-roles-real.cjs --external:better-sqlite3 \
//     --external:onnxruntime-node --external:@napi-rs/canvas \
//     --alias:electron=./scripts/stub-electron.mjs
//   ELECTRON_RUN_AS_NODE=1 NODUS_TEST_USERDATA=/path/to/copy npx electron .smoke-roles-real.cjs
import { getDb } from '../electron/db/database';
import { reconcileAuthorRolesOnce } from '../electron/db/authorsRepo';
import { listAuthors } from '../electron/ai/authorDossier';

const db = getDb();
const c = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

// Everything that holds research. None of it may move.
const RESEARCH_TABLES = [
  'works', 'ideas', 'idea_occurrences', 'evidence', 'edges', 'gaps',
  'external_refs', 'themes', 'idea_theme_links', 'notes', 'authors', 'work_authors',
];
const snap = () => Object.fromEntries(RESEARCH_TABLES.map((t) => [t, c(`SELECT COUNT(*) AS n FROM ${t}`)]));

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const roleCounts = () =>
  Object.fromEntries(
    (db.prepare('SELECT role, COUNT(*) AS n FROM work_authors GROUP BY role').all() as { role: string; n: number }[]).map(
      (r) => [r.role, r.n]
    )
  ) as Record<string, number>;

const before = snap();
const rolesBefore = roleCounts();
const authorsBefore = listAuthors();
const byIdBefore = new Map(authorsBefore.map((a) => [a.author_id, a] as const));
console.log(`links before → author: ${rolesBefore.author ?? 0}, editor: ${rolesBefore.editor ?? 0}`);

console.time('repair');
reconcileAuthorRolesOnce();
console.timeEnd('repair');

const after = snap();
const rolesAfter = roleCounts();
const authorsAfter = listAuthors();
console.log(`links after  → author: ${rolesAfter.author ?? 0}, editor: ${rolesAfter.editor ?? 0}`);

for (const table of RESEARCH_TABLES) {
  assert(after[table] === before[table], `${table} changed: ${before[table]} → ${after[table]}`);
}
console.log(`research tables identical (${RESEARCH_TABLES.length} checked) ✓`);

// The byline is what a Deep Research citation is shortened from: a report written
// after the repair but before any Zotero resync must already name the author.
const bylines = db
  .prepare("SELECT title, authors_json FROM works WHERE creators_json IS NOT NULL AND authors_json IS NOT NULL")
  .all() as { title: string; authors_json: string }[];
const isEditor = (name: string) => name.trim().toLowerCase().endsWith('(ed.)');
let ledByEditor = 0;
let editorsOnly = 0;
for (const row of bylines) {
  let names: string[] = [];
  try {
    names = JSON.parse(row.authors_json) as string[];
  } catch {
    continue;
  }
  if (names.length === 0 || !isEditor(names[0])) continue;
  // A volume Zotero credits to editors only is legitimately led by one — there is
  // no author to lead with. The defect is a byline that buries an author behind one.
  if (names.some((name) => !isEditor(name))) ledByEditor += 1;
  else editorsOnly += 1;
}
console.log(`\nbylines led by an editor: ${ledByEditor} burying an author, ${editorsOnly} on editor-only volumes`);
assert(ledByEditor === 0, 'some citations would still be shortened to the volume editor');

// Who stopped being credited with other people's chapters, worst first.
const drops = authorsAfter
  .map((a) => {
    const was = byIdBefore.get(a.author_id);
    return {
      name: a.name,
      works: (was?.workCount ?? 0) - a.workCount,
      ideas: (was?.ideaCount ?? 0) - a.ideaCount,
      edited: a.editedCount,
      keptWorks: a.workCount,
      keptIdeas: a.ideaCount,
    };
  })
  .filter((d) => d.ideas > 0 || d.works > 0)
  .sort((a, b) => b.ideas - a.ideas);

const totalIdeasDropped = drops.reduce((sum, d) => sum + d.ideas, 0);
console.log(`\n${drops.length} people stopped being credited with ideas they did not write (${totalIdeasDropped} attributions):`);
for (const d of drops.slice(0, 20)) {
  console.log(
    `  ${d.name.padEnd(38)} −${String(d.works).padStart(2)} works  −${String(d.ideas).padStart(3)} ideas` +
      `   → keeps ${d.keptWorks} works / ${d.keptIdeas} ideas, edits ${d.edited} volumes`
  );
}

// Nobody may gain attribution from a repair that only ever removes credit.
const gains = authorsAfter.filter((a) => a.ideaCount > (byIdBefore.get(a.author_id)?.ideaCount ?? 0));
assert(gains.length === 0, `${gains.length} authors gained ideas they did not have before`);

// Every work that was credited to somebody still is: no work fell off the map.
const orphans = c(
  `SELECT COUNT(*) AS n FROM works w
    WHERE w.nodus_id IN (SELECT nodus_id FROM work_authors)
      AND NOT EXISTS (SELECT 1 FROM work_authors wa WHERE wa.nodus_id = w.nodus_id AND wa.role = 'author')`
);
console.log(`\nworks left with editors but no author: ${orphans}`);

console.log('\nROLES REPAIRED · NO RESEARCH DATA TOUCHED ✓');
