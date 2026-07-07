// Losslessness harness for the Phase-1 idea merge. Runs the real detection +
// merge against a COPY of a Nodus database and asserts that nothing was orphaned
// or lost. Never point it at a live database — pass a copy.
//
// Build + run:
//   cp "$HOME/Library/Application Support/Nodus/nodus.sqlite" /tmp/nodus-dedupe-copy.sqlite
//   npx esbuild scripts/validate-idea-dedupe.ts --bundle --platform=node --format=esm \
//     --outfile=.validate-idea-dedupe.mjs --external:better-sqlite3 && \
//   node .validate-idea-dedupe.mjs /tmp/nodus-dedupe-copy.sqlite
import Database from 'better-sqlite3';
import { findDuplicateIdeaGroups, mergeIdeas } from '../electron/db/ideaDedupe';

const dbPath = process.argv[2];
if (!dbPath) throw new Error('usage: node validate-idea-dedupe.mjs <path-to-db-COPY>');

const db = new Database(dbPath);
const num = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;

const before = {
  ideas: num('SELECT COUNT(*) n FROM ideas'),
  evidence: num('SELECT COUNT(*) n FROM evidence'),
  occ: num('SELECT COUNT(*) n FROM idea_occurrences'),
  edges: num('SELECT COUNT(*) n FROM edges'),
  gaps: num("SELECT COUNT(*) n FROM gaps WHERE related_idea IS NOT NULL AND related_idea <> ''"),
  extRefs: num('SELECT COUNT(*) n FROM external_refs'),
  edgeTraces: num('SELECT COUNT(*) n FROM edge_traces'),
  ideasNoEvidence: num('SELECT COUNT(*) n FROM ideas i WHERE NOT EXISTS (SELECT 1 FROM evidence e WHERE e.global_id = i.global_id)'),
};

const groups = findDuplicateIdeaGroups(db);
const toRemove = groups.reduce((acc, g) => acc + (g.members.length - 1), 0);
console.log(`groups: ${groups.length} · ideas to remove: ${toRemove}`);
console.log('sample groups:');
for (const g of groups.slice(0, 5)) {
  const canon = g.members.find((m) => m.suggestedCanonical)!;
  console.log(`  ×${g.members.length}  "${canon.label}" [${canon.type}]  (canon ev=${canon.evidenceCount}, works=${canon.workCount})`);
}

let merged = 0;
for (const g of groups) {
  const canon = g.members.find((m) => m.suggestedCanonical)!;
  const dups = g.members.filter((m) => !m.suggestedCanonical).map((m) => m.global_id);
  merged += mergeIdeas(db, canon.global_id, dups);
}

const after = {
  ideas: num('SELECT COUNT(*) n FROM ideas'),
  evidence: num('SELECT COUNT(*) n FROM evidence'),
  occ: num('SELECT COUNT(*) n FROM idea_occurrences'),
  edges: num('SELECT COUNT(*) n FROM edges'),
  gaps: num("SELECT COUNT(*) n FROM gaps WHERE related_idea IS NOT NULL AND related_idea <> ''"),
  extRefs: num('SELECT COUNT(*) n FROM external_refs'),
  edgeTraces: num('SELECT COUNT(*) n FROM edge_traces'),
  ideasNoEvidence: num('SELECT COUNT(*) n FROM ideas i WHERE NOT EXISTS (SELECT 1 FROM evidence e WHERE e.global_id = i.global_id)'),
};

// Orphan checks: every idea-referencing row must point at a surviving idea.
const orphans = {
  evidence: num('SELECT COUNT(*) n FROM evidence x WHERE x.global_id IS NOT NULL AND x.global_id <> \'\' AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = x.global_id)'),
  occ: num('SELECT COUNT(*) n FROM idea_occurrences x WHERE NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = x.global_id)'),
  themeLinks: num('SELECT COUNT(*) n FROM idea_theme_links x WHERE NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = x.global_id)'),
  edgesFrom: num('SELECT COUNT(*) n FROM edges x WHERE x.from_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = x.from_id)'),
  edgesTo: num('SELECT COUNT(*) n FROM edges x WHERE x.to_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = x.to_id)'),
  gaps: num("SELECT COUNT(*) n FROM gaps x WHERE x.related_idea IS NOT NULL AND x.related_idea <> '' AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = x.related_idea)"),
  extRefs: num("SELECT COUNT(*) n FROM external_refs x WHERE x.from_idea IS NOT NULL AND x.from_idea <> '' AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = x.from_idea)"),
  coverage: num("SELECT COUNT(*) n FROM research_coverage_links x WHERE x.kind = 'idea' AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = x.ref_id)"),
  chapterRel: num("SELECT COUNT(*) n FROM project_chapter_idea_relations x WHERE x.target_kind = 'idea' AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = x.target_id)"),
  study: num("SELECT COUNT(*) n FROM study_progress x WHERE x.target_kind = 'idea' AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.global_id = x.target_id)"),
};

const graph = {
  selfLoops: num('SELECT COUNT(*) n FROM edges WHERE from_id = to_id'),
  dupPairs: num('SELECT COUNT(*) n FROM (SELECT from_id, to_id, type FROM edges GROUP BY from_id, to_id, type HAVING COUNT(*) > 1)'),
  edgeTraceOrphans: num('SELECT COUNT(*) n FROM edge_traces t WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.id = t.edge_id)'),
};

console.log('\n--- BEFORE / AFTER ---');
console.table({ before, after });

const checks: [string, boolean, string][] = [
  ['merged == ideas to remove', merged === toRemove, `${merged} vs ${toRemove}`],
  ['ideas dropped by exactly removed', before.ideas - after.ideas === toRemove, `${before.ideas - after.ideas}`],
  ['evidence LOSSLESS (unchanged)', before.evidence === after.evidence, `${before.evidence} -> ${after.evidence}`],
  ['gaps→idea preserved', before.gaps === after.gaps, `${before.gaps} -> ${after.gaps}`],
  ['external_refs preserved', before.extRefs === after.extRefs, `${before.extRefs} -> ${after.extRefs}`],
  ['no new ideas without evidence', after.ideasNoEvidence <= before.ideasNoEvidence, `${before.ideasNoEvidence} -> ${after.ideasNoEvidence}`],
  ['orphans: evidence', orphans.evidence === 0, `${orphans.evidence}`],
  ['orphans: idea_occurrences', orphans.occ === 0, `${orphans.occ}`],
  ['orphans: idea_theme_links', orphans.themeLinks === 0, `${orphans.themeLinks}`],
  ['orphans: edges.from_id', orphans.edgesFrom === 0, `${orphans.edgesFrom}`],
  ['orphans: edges.to_id', orphans.edgesTo === 0, `${orphans.edgesTo}`],
  ['orphans: gaps.related_idea', orphans.gaps === 0, `${orphans.gaps}`],
  ['orphans: external_refs.from_idea', orphans.extRefs === 0, `${orphans.extRefs}`],
  ['orphans: coverage_links(idea)', orphans.coverage === 0, `${orphans.coverage}`],
  ['orphans: chapter_relations(idea)', orphans.chapterRel === 0, `${orphans.chapterRel}`],
  ['orphans: study_progress(idea)', orphans.study === 0, `${orphans.study}`],
  ['graph: no self-loops', graph.selfLoops === 0, `${graph.selfLoops}`],
  ['graph: no duplicate (from,to,type)', graph.dupPairs === 0, `${graph.dupPairs}`],
  ['graph: no orphan edge_traces', graph.edgeTraceOrphans === 0, `${graph.edgeTraceOrphans}`],
];

console.log('\n--- INTEGRITY CHECKS ---');
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failed++;
}

console.log(`\n${failed === 0 ? '✅ ALL CHECKS PASSED — merge is lossless' : `❌ ${failed} CHECK(S) FAILED`}`);
db.close();
if (failed > 0) process.exit(1);
