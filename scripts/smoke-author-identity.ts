// Headless proof that switching author identity to Zotero and consolidating the
// duplicate author nodes LOSES NO RESEARCH DATA. Two phases (PHASE env):
//
//   PHASE=consolidate  seeds a synthetic corpus in the *current* fragmented shape
//     (Zotero-format author rows + AI name-variant rows, both linked to the same
//     works, with ideas/edges) and asserts reconcileAuthorLayerOnce() collapses
//     each person to one canonical node while every work link, idea, edge and
//     piece of evidence is preserved. Also checks idempotency + editor roles.
//
//   PHASE=demo  seeds the curated demo corpus and asserts reconcile leaves it
//     byte-for-byte intact (demo-% ids are skipped; curated relations survive).
//
// Build+run (better-sqlite3 needs Electron's ABI, electron is stubbed):
//   npx esbuild scripts/smoke-author-identity.ts --bundle --platform=node \
//     --format=esm --outfile=.smoke-ai.mjs --external:better-sqlite3 \
//     --alias:electron=./scripts/stub-electron.mjs
//   PHASE=consolidate ELECTRON_RUN_AS_NODE=1 NODUS_TEST_USERDATA=/tmp/x npx electron .smoke-ai.mjs
import { getDb } from '../electron/db/database';
import { reconcileAuthorLayerOnce, linkZoteroAuthors } from '../electron/db/authorsRepo';
import { listAuthors, buildAuthorDossier } from '../electron/ai/authorDossier';
import { seedDemoData } from '../electron/db/demoData';

const db = getDb();
const phase = process.env.PHASE ?? 'consolidate';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function count(sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

if (phase === 'demo') {
  seedDemoData();
  const authorsBefore = count('SELECT COUNT(*) AS n FROM authors');
  const relBefore = count('SELECT COUNT(*) AS n FROM author_relations');
  const coauthorBefore = count("SELECT COUNT(*) AS n FROM author_relations WHERE type='coauthor'");
  reconcileAuthorLayerOnce();
  const authorsAfter = count('SELECT COUNT(*) AS n FROM authors');
  const relAfter = count('SELECT COUNT(*) AS n FROM author_relations');
  const coauthorAfter = count("SELECT COUNT(*) AS n FROM author_relations WHERE type='coauthor'");
  console.log(`demo authors: ${authorsBefore} → ${authorsAfter}`);
  console.log(`demo relations: ${relBefore} → ${relAfter} (coauthor ${coauthorBefore} → ${coauthorAfter})`);
  assert(authorsAfter === authorsBefore, 'demo author count changed');
  assert(relAfter === relBefore, 'demo relation count changed');
  assert(coauthorAfter === coauthorBefore && coauthorAfter > 0, 'demo coauthor relations not preserved');
  const flag = db.prepare("SELECT value FROM settings WHERE key='author_layer_reconciled'").get() as
    | { value: string }
    | undefined;
  assert(flag?.value === '1', 'reconcile flag not set');
  console.log('\nDEMO PRESERVED ✓');
} else {
  // ── Seed a fragmented corpus (no demo) ─────────────────────────────────────
  const insAuthor = db.prepare('INSERT INTO authors (author_id, name, affiliation) VALUES (?, ?, NULL)');
  // Zotero-format canonical rows + AI free-text variants of the SAME people.
  insAuthor.run('a-galant-z', 'Galant, I.');
  insAuthor.run('a-galant-1', 'Ivanne Galant');
  insAuthor.run('a-galant-2', 'I. Galant');
  insAuthor.run('a-fuentes-z', 'Fuentes Vega, A.');
  insAuthor.run('a-fuentes-1', 'Alicia Fuentes Vega');
  insAuthor.run('a-sweller', 'Sweller, J.'); // control: no duplicates

  const insWork = db.prepare(
    "INSERT INTO works (nodus_id, zotero_key, title, authors_json, year, item_type, archived, deep_status) VALUES (?, ?, ?, ?, ?, 'journalArticle', 0, 'done')"
  );
  const works: Record<string, string[]> = {
    w1: ['Galant, I.'],
    w2: ['Galant, I.'],
    w3: ['Galant, I.'],
    w4: ['Fuentes Vega, A.'],
    w5: ['Sweller, J.'],
    w6: ['Galant, I.', 'Fuentes Vega, A.'], // co-authored
  };
  let yr = 2015;
  for (const [w, a] of Object.entries(works)) insWork.run(w, `z-${w}`, `Work ${w}`, JSON.stringify(a), yr++);

  // Links exactly as deepScan produced them: Zotero row + whatever variant the
  // model read on that page, both attached to the same work.
  const link = db.prepare('INSERT INTO work_authors (nodus_id, author_id, role) VALUES (?, ?, \'author\')');
  const links: [string, string][] = [
    ['w1', 'a-galant-z'], ['w1', 'a-galant-1'],
    ['w2', 'a-galant-z'], ['w2', 'a-galant-2'],
    ['w3', 'a-galant-z'],
    ['w4', 'a-fuentes-z'], ['w4', 'a-fuentes-1'],
    ['w5', 'a-sweller'],
    ['w6', 'a-galant-z'], ['w6', 'a-galant-1'], ['w6', 'a-fuentes-z'], ['w6', 'a-fuentes-1'],
  ];
  for (const [w, a] of links) link.run(w, a);

  // Two ideas per work, so we can prove ideas survive and aggregate correctly.
  const insIdea = db.prepare("INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, 'claim', ?, ?, '2020-01-01')");
  const insOcc = db.prepare("INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, 'principal', '', 0.9)");
  const insEv = db.prepare("INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES (?, ?, ?, 'quote', 'p.1', 'explicit')");
  for (const w of Object.keys(works)) {
    for (let k = 0; k < 2; k++) {
      const gid = `i-${w}-${k}`;
      insIdea.run(gid, `Idea ${gid}`, `Statement ${gid}`);
      insOcc.run(gid, w);
      insEv.run(`ev-${gid}`, gid, w);
    }
  }
  // One cross-work edge (idea of w1 vs idea of w4) so relations regenerate.
  db.prepare("INSERT INTO edges (id, from_id, to_id, type, basis, confidence) VALUES ('e1', 'i-w1-0', 'i-w4-0', 'contradicts', 'explicit', 0.8)").run();

  // ── Snapshot the CORE research data (must be identical afterwards) ──────────
  const before = {
    works: count('SELECT COUNT(*) AS n FROM works'),
    ideas: count('SELECT COUNT(*) AS n FROM ideas'),
    occ: count('SELECT COUNT(*) AS n FROM idea_occurrences'),
    evidence: count('SELECT COUNT(*) AS n FROM evidence'),
    edges: count('SELECT COUNT(*) AS n FROM edges'),
  };
  const galantWorksBefore = new Set(
    (db.prepare("SELECT DISTINCT nodus_id FROM work_authors WHERE author_id LIKE 'a-galant%'").all() as { nodus_id: string }[]).map((r) => r.nodus_id)
  );

  // ── Reconcile ──────────────────────────────────────────────────────────────
  reconcileAuthorLayerOnce();

  // ── Assert: no research data lost ──────────────────────────────────────────
  const after = {
    works: count('SELECT COUNT(*) AS n FROM works'),
    ideas: count('SELECT COUNT(*) AS n FROM ideas'),
    occ: count('SELECT COUNT(*) AS n FROM idea_occurrences'),
    evidence: count('SELECT COUNT(*) AS n FROM evidence'),
    edges: count('SELECT COUNT(*) AS n FROM edges'),
  };
  console.log('core data before/after:', JSON.stringify(before), JSON.stringify(after));
  for (const k of Object.keys(before) as (keyof typeof before)[]) {
    assert(before[k] === after[k], `core table '${k}' changed (${before[k]} → ${after[k]})`);
  }

  // Every work still has at least one author.
  const orphanWorks = count(
    'SELECT COUNT(*) AS n FROM works w WHERE NOT EXISTS (SELECT 1 FROM work_authors wa WHERE wa.nodus_id = w.nodus_id)'
  );
  assert(orphanWorks === 0, `${orphanWorks} works lost all authors`);

  // No dangling links to deleted author rows.
  const dangling = count(
    'SELECT COUNT(*) AS n FROM work_authors wa WHERE NOT EXISTS (SELECT 1 FROM authors a WHERE a.author_id = wa.author_id)'
  );
  assert(dangling === 0, `${dangling} dangling work_author links`);

  // Fragmentation collapsed: 3 canonical people, AI variant rows gone.
  const authors = listAuthors();
  console.log('\nauthors after reconcile:');
  for (const a of authors) console.log(`  • ${a.name} — ${a.workCount} works, ${a.ideaCount} ideas`);
  assert(authors.length === 3, `expected 3 canonical authors, got ${authors.length}`);
  for (const gone of ['a-galant-1', 'a-galant-2', 'a-fuentes-1']) {
    assert(count(`SELECT COUNT(*) AS n FROM authors WHERE author_id='${gone}'`) === 0, `${gone} not deleted`);
  }

  const galant = db.prepare("SELECT author_id, name FROM authors WHERE canonical_key='galant::i'").get() as
    | { author_id: string; name: string }
    | undefined;
  assert(!!galant, 'no canonical galant node');
  assert(galant!.name.includes(','), `galant display should be Zotero form, got "${galant!.name}"`);
  const galantWorksAfter = new Set(
    (db.prepare('SELECT DISTINCT nodus_id FROM work_authors WHERE author_id=?').all(galant!.author_id) as { nodus_id: string }[]).map((r) => r.nodus_id)
  );
  console.log(`galant works before(any variant)=${[...galantWorksBefore].sort().join(',')} after=${[...galantWorksAfter].sort().join(',')}`);
  assert(
    galantWorksBefore.size === galantWorksAfter.size && [...galantWorksBefore].every((w) => galantWorksAfter.has(w)),
    'canonical galant lost/gained a work link vs the union of its variants'
  );
  const galantDossier = buildAuthorDossier(galant!.author_id)!;
  assert(galantDossier.ideas.length === 8, `galant should aggregate 8 ideas (w1,w2,w3,w6×2), got ${galantDossier.ideas.length}`);

  const fuentes = db.prepare("SELECT author_id FROM authors WHERE canonical_key='fuentes vega::a'").get() as { author_id: string };
  const fuentesWorks = count(`SELECT COUNT(DISTINCT nodus_id) AS n FROM work_authors WHERE author_id='${fuentes.author_id}'`);
  assert(fuentesWorks === 2, `fuentes should have 2 works (w4,w6), got ${fuentesWorks}`);

  // ── Idempotency: clearing the flag + re-running is stable ──────────────────
  db.prepare("DELETE FROM settings WHERE key='author_layer_reconciled'").run();
  reconcileAuthorLayerOnce();
  assert(listAuthors().length === 3, 're-running reconcile changed the author count');

  // ── Editor role via structured creators_json (post-sync path) ──────────────
  db.prepare(
    "INSERT INTO works (nodus_id, zotero_key, title, authors_json, creators_json, year, item_type, archived, deep_status) VALUES ('w7','z-w7','Edited Volume', ?, ?, 2021, 'book', 0, 'done')"
  ).run(
    JSON.stringify(['Vega, M.', 'López, J.']),
    JSON.stringify([
      { lastName: 'Vega', firstName: 'María', name: null, role: 'editor' },
      { lastName: 'López', firstName: 'Juan', name: null, role: 'author' },
    ])
  );
  linkZoteroAuthors('w7', { createIfMissing: true });
  const vega = db.prepare("SELECT author_id FROM authors WHERE canonical_key='vega::m'").get() as { author_id: string };
  const vegaRole = (db.prepare("SELECT role FROM work_authors WHERE nodus_id='w7' AND author_id=?").get(vega.author_id) as { role: string }).role;
  const lopez = db.prepare("SELECT author_id FROM authors WHERE canonical_key='lopez::j'").get() as { author_id: string };
  const lopezRole = (db.prepare("SELECT role FROM work_authors WHERE nodus_id='w7' AND author_id=?").get(lopez.author_id) as { role: string }).role;
  console.log(`\nw7 roles → Vega: ${vegaRole}, López: ${lopezRole}`);
  assert(vegaRole === 'editor', 'editor role not captured');
  assert(lopezRole === 'author', 'author role not captured');

  console.log('\nNO DATA LOST · FRAGMENTATION COLLAPSED · ROLES OK ✓');
}
