// Headless proof that a volume's EDITOR is never credited with the ideas of the
// chapters inside it, and that a corpus already carrying the old mistake repairs
// itself without losing anything.
//
// The bug this pins down: work_authors.role arrived with DEFAULT 'author', and
// the old sticky ON CONFLICT ("once an author, always an author") made the column
// unrepairable, so every editor stayed credited as an author of every chapter of
// the volumes they edited — and every idea in those chapters was attributed to
// them. Zotero's answer was never lost, only ignored: it sits in creators_json.
//
// Build+run (better-sqlite3 needs Electron's ABI, electron is stubbed):
//   npx esbuild scripts/smoke-author-roles.ts --bundle --platform=node \
//     --format=cjs --outfile=.smoke-roles.cjs --external:better-sqlite3 \
//     --external:onnxruntime-node --external:@napi-rs/canvas \
//     --alias:electron=./scripts/stub-electron.mjs
//   ELECTRON_RUN_AS_NODE=1 NODUS_TEST_USERDATA=/tmp/x npx electron .smoke-roles.cjs
import { getDb } from '../electron/db/database';
import { linkZoteroAuthors, reconcileAuthorRolesOnce, recomputeAuthorRelations } from '../electron/db/authorsRepo';
import { listAuthors, buildAuthorDossier } from '../electron/ai/authorDossier';
import { ingestZoteroItem } from '../electron/sync/syncService';
import type { ZoteroItem } from '@shared/types';

const db = getDb();

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function count(sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}
function roleOf(work: string, key: string): string | null {
  const row = db
    .prepare(
      `SELECT wa.role FROM work_authors wa JOIN authors a ON a.author_id = wa.author_id
        WHERE wa.nodus_id = ? AND a.canonical_key = ?`
    )
    .get(work, key) as { role: string } | undefined;
  return row?.role ?? null;
}
function authorIdFor(key: string): string {
  return (db.prepare('SELECT author_id FROM authors WHERE canonical_key = ?').get(key) as { author_id: string }).author_id;
}

// ── Seed an edited volume in the SHAPE THE BUG LEFT BEHIND ───────────────────
// creators_json is correct (Zotero always knew), work_authors.role is not: every
// link says 'author', exactly as migration 23's DEFAULT wrote it.
const chapters = [
  { id: 'c1', title: 'Chapter one', author: { last: 'Arco Blanco', first: 'Miguel Ángel del', key: 'arco blanco::m' } },
  { id: 'c2', title: 'Chapter two', author: { last: 'Martínez Martínez', first: 'Alba', key: 'martinez martinez::a' } },
  { id: 'c3', title: 'Chapter three', author: { last: 'Cabezas Vega', first: 'Laura', key: 'cabezas vega::l' } },
];
const editor = { last: 'Román Ruiz', first: 'Gloria', key: 'roman ruiz::g' };

const insWork = db.prepare(
  `INSERT INTO works (nodus_id, zotero_key, title, authors_json, creators_json, year, item_type, archived, deep_status)
   VALUES (?, ?, ?, ?, ?, 2024, 'bookSection', 0, 'done')`
);
const insAuthor = db.prepare('INSERT INTO authors (author_id, name, affiliation, canonical_key) VALUES (?, ?, NULL, ?)');
const insLink = db.prepare("INSERT INTO work_authors (nodus_id, author_id, role) VALUES (?, ?, 'author')");

insAuthor.run('a-editor', `${editor.last}, ${editor.first}`, editor.key);
for (const ch of chapters) {
  insAuthor.run(`a-${ch.id}`, `${ch.author.last}, ${ch.author.first}`, ch.author.key);
  insWork.run(
    ch.id,
    `z-${ch.id}`,
    ch.title,
    // Zotero puts the volume editor first on a book section — which is exactly
    // how a citation shortened to authors[0] ended up naming the editor.
    JSON.stringify([`${editor.last}, ${editor.first.charAt(0)}.`, `${ch.author.last}, ${ch.author.first.charAt(0)}.`]),
    JSON.stringify([
      { lastName: editor.last, firstName: editor.first, name: null, role: 'editor' },
      { lastName: ch.author.last, firstName: ch.author.first, name: null, role: 'author' },
    ])
  );
  insLink.run(ch.id, 'a-editor'); // ← the misfiled link
  insLink.run(ch.id, `a-${ch.id}`);
}

// A work the editor really did write, so the repair must not strip her whole footprint.
insWork.run(
  'own',
  'z-own',
  'Her own article',
  JSON.stringify([`${editor.last}, ${editor.first.charAt(0)}.`]),
  JSON.stringify([{ lastName: editor.last, firstName: editor.first, name: null, role: 'author' }])
);
insLink.run('own', 'a-editor');

// Ideas + evidence + one cross-chapter edge, so attribution and relations are measurable.
const insIdea = db.prepare("INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, 'claim', ?, ?, '2024-01-01')");
const insOcc = db.prepare("INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, 'principal', '', 0.9)");
const insEv = db.prepare("INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES (?, ?, ?, 'quote', 'p.1', 'explicit')");
const insTheme = db.prepare("INSERT INTO themes (theme_id, label) VALUES (?, ?)");
const insThemeLink = db.prepare("INSERT INTO idea_theme_links (global_id, nodus_id, theme_id, confidence, basis) VALUES (?, ?, ?, 0.9, 'explicit')");
insTheme.run('t-infancia', 'infancia');
for (const w of [...chapters.map((c) => c.id), 'own']) {
  const gid = `i-${w}`;
  insIdea.run(gid, `Idea ${w}`, `Statement ${w}`);
  insOcc.run(gid, w);
  insEv.run(`ev-${gid}`, gid, w);
  insThemeLink.run(gid, w, 't-infancia');
}
db.prepare(
  "INSERT INTO edges (id, from_id, to_id, type, basis, confidence) VALUES ('e1', 'i-c1', 'i-c2', 'contradicts', 'explicit', 0.8)"
).run();
recomputeAuthorRelations();

// ── Before: the corpus as the bug left it ────────────────────────────────────
const RESEARCH_TABLES = ['works', 'ideas', 'idea_occurrences', 'evidence', 'edges', 'themes', 'idea_theme_links'];
const snap = () => Object.fromEntries(RESEARCH_TABLES.map((t) => [t, count(`SELECT COUNT(*) AS n FROM ${t}`)]));
const researchBefore = snap();
const linksBefore = count('SELECT COUNT(*) AS n FROM work_authors');
const editorId = authorIdFor(editor.key);

const summaryBefore = listAuthors().find((a) => a.author_id === editorId)!;
console.log(`before → editor credited with ${summaryBefore.workCount} works, ${summaryBefore.ideaCount} ideas`);
assert(summaryBefore.workCount === 4, 'seed did not reproduce the bug (works)');
assert(summaryBefore.ideaCount === 4, 'seed did not reproduce the bug (ideas)');
const relBefore = count(`SELECT COUNT(*) AS n FROM author_relations WHERE from_author='${editorId}' OR to_author='${editorId}'`);
assert(relBefore > 0, 'seed did not reproduce the bug (relations routed through the editor)');

const misfiledBefore = count("SELECT COUNT(*) AS n FROM work_authors WHERE author_id='a-editor' AND role='author'");
assert(misfiledBefore === 4, 'seed did not reproduce the bug (stored roles)');

// The byline is what a citation is shortened from, and the seed has it in the
// broken shape too: editor first, unmarked.
const bylineOf = (work: string) =>
  JSON.parse((db.prepare('SELECT authors_json FROM works WHERE nodus_id = ?').get(work) as { authors_json: string }).authors_json) as string[];
assert(bylineOf('c1')[0] === 'Román Ruiz, G.', 'seed did not reproduce the bug (byline leads with the editor)');

// ── Repair ───────────────────────────────────────────────────────────────────
reconcileAuthorRolesOnce();
const misfiledAfter = count("SELECT COUNT(*) AS n FROM work_authors WHERE author_id='a-editor' AND role='author'");
// A report generated after the repair but before any Zotero resync must already
// cite the chapter's author, so the stored byline has to be repaired too.
const c1Byline = bylineOf('c1');
console.log(`byline of c1 after the repair → ${c1Byline.join(' · ')}`);
assert(c1Byline[0] === 'Arco Blanco, M.', 'the repaired byline still leads with the editor');
assert(c1Byline[1] === 'Román Ruiz, G. (ed.)', 'the repaired byline does not mark the editor');
assert(bylineOf('own')[0] === 'Román Ruiz, G.', 'the byline of the work she wrote was altered');
console.log(`roles → ${misfiledBefore} links credited to the editor as author, ${misfiledAfter} after the repair`);
assert(misfiledAfter === 1, 'the repair did not rewrite exactly the three editor links');

// ── After: roles, attribution and integrity ──────────────────────────────────
for (const ch of chapters) {
  assert(roleOf(ch.id, editor.key) === 'editor', `${ch.id}: editor still credited as author`);
  assert(roleOf(ch.id, ch.author.key) === 'author', `${ch.id}: real author lost their role`);
}
assert(roleOf('own', editor.key) === 'author', 'the work she actually wrote was demoted');

const summaryAfter = listAuthors().find((a) => a.author_id === editorId)!;
console.log(`after  → editor: ${summaryAfter.workCount} works, ${summaryAfter.editedCount} edited, ${summaryAfter.ideaCount} ideas`);
assert(summaryAfter.workCount === 1, 'authored count not corrected');
assert(summaryAfter.editedCount === 3, 'edited volumes not counted apart');
assert(summaryAfter.ideaCount === 1, 'ideas still attributed through editorship');
assert(summaryAfter.topThemes.length === 1, 'themes still attributed through editorship');

const dossier = buildAuthorDossier(editorId)!;
assert(dossier.works.length === 1 && dossier.works[0].nodus_id === 'own', 'dossier works not restricted to authorship');
assert(dossier.editedWorks.length === 3, 'edited volumes missing from the dossier');
assert(dossier.ideas.length === 1 && dossier.ideas[0].workId === 'own', 'dossier ideas still borrowed from chapters');
assert(dossier.ideas[0].evidence.length === 1, 'evidence lost for the work she wrote');

const relAfter = count(`SELECT COUNT(*) AS n FROM author_relations WHERE from_author='${editorId}' OR to_author='${editorId}'`);
assert(relAfter === 0, 'author relations still routed through the editor');
const chapterRel = count(
  `SELECT COUNT(*) AS n FROM author_relations WHERE from_author='${authorIdFor(chapters[0].author.key)}' AND to_author='${authorIdFor(chapters[1].author.key)}'`
);
assert(chapterRel === 1, 'the real authors lost the relation the edge proves');

// Nothing was created, deleted or rewritten beyond the role column.
const researchAfter = snap();
for (const table of RESEARCH_TABLES) {
  assert(researchAfter[table] === researchBefore[table], `${table} changed: ${researchBefore[table]} → ${researchAfter[table]}`);
}
assert(count('SELECT COUNT(*) AS n FROM work_authors') === linksBefore, 'work↔author links were added or dropped');

// ── Idempotency: repairing twice changes nothing ─────────────────────────────
db.prepare("DELETE FROM settings WHERE key='author_roles_reconciled'").run();
reconcileAuthorRolesOnce();
const summaryTwice = listAuthors().find((a) => a.author_id === editorId)!;
assert(summaryTwice.workCount === 1 && summaryTwice.editedCount === 3, 'second repair changed the outcome');

// ── The everyday path is self-healing on its own ─────────────────────────────
// Put one chapter back into the broken shape and resync it the way ingest does:
// the role must correct itself without the one-time pass running again.
db.prepare("UPDATE work_authors SET role='author' WHERE nodus_id='c1' AND author_id='a-editor'").run();
linkZoteroAuthors('c1', { createIfMissing: false });
assert(roleOf('c1', editor.key) === 'editor', 'a plain resync cannot correct a misfiled editor');
for (const ch of chapters) {
  linkZoteroAuthors(ch.id, { createIfMissing: false });
  assert(roleOf(ch.id, editor.key) === 'editor', `${ch.id}: resync re-credited the editor`);
}

// ── Ingest path: the byline marks editors and never leads with one ───────────
const item = {
  key: 'z-new',
  itemKey: 'z-new',
  library: { id: 'u1', type: 'user', name: 'Personal' },
  version: 1,
  title: 'A freshly synced chapter',
  creators: [
    { lastName: 'Román Ruiz', firstName: 'Gloria', creatorType: 'editor' },
    { lastName: 'Jiménez Aguilar', firstName: 'Francisco', creatorType: 'author' },
    { lastName: 'Translator', firstName: 'Tina', creatorType: 'translator' },
  ],
  year: 2024,
  itemType: 'bookSection',
  doi: null,
  abstract: null,
  tags: [],
  collections: [],
} as unknown as ZoteroItem;
ingestZoteroItem(item, 'leído');
const byline = JSON.parse(
  (db.prepare("SELECT authors_json FROM works WHERE zotero_key='z-new'").get() as { authors_json: string }).authors_json
) as string[];
console.log(`byline → ${byline.join(' · ')}`);
assert(byline.length === 2, 'the translator leaked into the byline');
assert(byline[0] === 'Jiménez Aguilar, F.', 'the byline still leads with the editor');
assert(byline[1] === 'Román Ruiz, G. (ed.)', 'the editor is not marked in the byline');

console.log('\nEDITORS ARE NOT AUTHORS · CORPUS REPAIRED · NOTHING LOST ✓');
