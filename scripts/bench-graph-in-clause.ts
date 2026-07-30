// Differential test for the two `IN (?,?,…9700 more)` queries in buildIdeaGraph.
//
// It times the current form against a rewrite that replaces the bound id list
// with the join that produced the list in the first place, and — the part that
// matters — asserts the two return byte-identical result sets. A faster query
// that returns something else is not a fix.
import Database from 'better-sqlite3';
import path from 'node:path';

const userData = process.env.NODUS_TEST_USERDATA;
if (!userData) throw new Error('NODUS_TEST_USERDATA is required');
const db = new Database(path.join(userData, 'nodus.sqlite'), { readonly: true });
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -32768');
db.pragma('mmap_size = 268435456');

const ideaIds = (
  db
    .prepare(
      `SELECT DISTINCT i.global_id
         FROM ideas i
         JOIN idea_occurrences io ON io.global_id = i.global_id
         JOIN works w ON w.nodus_id = io.nodus_id
        WHERE w.archived = 0 AND w.deep_status = 'done'`
    )
    .all() as { global_id: string }[]
).map((r) => r.global_id);

console.log(`ideas en el grafo: ${ideaIds.length}\n`);

function time<T>(label: string, fn: () => T): { ms: number; value: T } {
  const started = process.hrtime.bigint();
  const value = fn();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(1).padStart(8)} ms`);
  return { ms, value };
}

function canonical(rows: unknown[]): string {
  return JSON.stringify(rows.map((r) => JSON.stringify(r)).sort());
}

const placeholders = ideaIds.map(() => '?').join(',');

// ── Query A: idea → work aggregation ────────────────────────────────────────
console.log('A) filas idea×obra');
const aCurrentSql = `SELECT io.global_id, w.nodus_id, w.year, w.authors_json, w.read_tag
     FROM idea_occurrences io
     JOIN works w ON w.nodus_id = io.nodus_id
    WHERE io.global_id IN (${placeholders})
      AND w.archived = 0
      AND w.deep_status = 'done'`;
const aRewriteSql = `SELECT io.global_id, w.nodus_id, w.year, w.authors_json, w.read_tag
     FROM idea_occurrences io
     JOIN works w ON w.nodus_id = io.nodus_id
     JOIN ideas i ON i.global_id = io.global_id
    WHERE w.archived = 0
      AND w.deep_status = 'done'`;
const aCurrent = time('actual  IN (?×N)', () => db.prepare(aCurrentSql).all(...ideaIds) as unknown[]);
const aRewrite = time('reescrita  JOIN ideas', () => db.prepare(aRewriteSql).all() as unknown[]);
const aSame = canonical(aCurrent.value) === canonical(aRewrite.value);
console.log(`  filas: ${aCurrent.value.length} vs ${aRewrite.value.length} — identicas: ${aSame ? 'SI' : 'NO'}`);
console.log(`  aceleracion: ${(aCurrent.ms / aRewrite.ms).toFixed(0)}x\n`);

// ── Query B: max confidence per idea ────────────────────────────────────────
console.log('B) confianza maxima por idea');
const bCurrentSql = `SELECT io.global_id, MAX(io.confidence) AS c
     FROM idea_occurrences io
     JOIN works w ON w.nodus_id = io.nodus_id
    WHERE io.global_id IN (${placeholders})
      AND w.archived = 0
      AND w.deep_status = 'done'
    GROUP BY io.global_id`;
const bRewriteSql = `SELECT io.global_id, MAX(io.confidence) AS c
     FROM idea_occurrences io
     JOIN works w ON w.nodus_id = io.nodus_id
     JOIN ideas i ON i.global_id = io.global_id
    WHERE w.archived = 0
      AND w.deep_status = 'done'
    GROUP BY io.global_id`;
const bCurrent = time('actual  IN (?×N)', () => db.prepare(bCurrentSql).all(...ideaIds) as unknown[]);
const bRewrite = time('reescrita  JOIN ideas', () => db.prepare(bRewriteSql).all() as unknown[]);
const bSame = canonical(bCurrent.value) === canonical(bRewrite.value);
console.log(`  filas: ${bCurrent.value.length} vs ${bRewrite.value.length} — identicas: ${bSame ? 'SI' : 'NO'}`);
console.log(`  aceleracion: ${(bCurrent.ms / bRewrite.ms).toFixed(0)}x\n`);

// ── Why ─────────────────────────────────────────────────────────────────────
console.log('plan actual (A):');
for (const row of db.prepare(`EXPLAIN QUERY PLAN ${aCurrentSql}`).all(...ideaIds) as { detail: string }[]) {
  console.log(`  ${row.detail}`);
}
console.log('plan reescrito (A):');
for (const row of db.prepare(`EXPLAIN QUERY PLAN ${aRewriteSql}`).all() as { detail: string }[]) {
  console.log(`  ${row.detail}`);
}

if (!aSame || !bSame) {
  console.error('\nLa reescritura NO es equivalente — no aplicar.');
  process.exit(1);
}
console.log('\nAmbas reescrituras son equivalentes fila a fila.');
