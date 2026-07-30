// Attributes the cost of one main-process call to individual SQL statements, by
// wrapping better-sqlite3's prepare/all/get/run. `prepare` is timed separately
// from execution on purpose: a statement whose placeholder count varies with the
// corpus size cannot be reused by SQLite's cache and pays full parse cost on every
// call, which shows up as prepare time rather than query time.
//
// Built and run by scripts/run-bench-graph-sql.sh.
import Database from 'better-sqlite3';

interface Entry {
  sql: string;
  prepares: number;
  prepareMs: number;
  execs: number;
  execMs: number;
  rows: number;
}

const stats = new Map<string, Entry>();

function key(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** Collapse a long `IN (?,?,?,…)` list so the same query shape aggregates. */
function shape(sql: string): string {
  return key(sql).replace(/\?(\s*,\s*\?){3,}/g, '?,?,…');
}

function entry(sql: string): Entry {
  const k = shape(sql);
  let e = stats.get(k);
  if (!e) {
    e = { sql: k, prepares: 0, prepareMs: 0, execs: 0, execMs: 0, rows: 0 };
    stats.set(k, e);
  }
  return e;
}

const proto = Database.prototype as unknown as { prepare: (sql: string) => unknown };
const originalPrepare = proto.prepare;

proto.prepare = function patchedPrepare(sql: string) {
  const e = entry(sql);
  const started = process.hrtime.bigint();
  const statement = originalPrepare.call(this, sql) as Record<string, unknown>;
  e.prepareMs += Number(process.hrtime.bigint() - started) / 1e6;
  e.prepares += 1;
  for (const method of ['all', 'get', 'run', 'pluck', 'raw'] as const) {
    const original = statement[method];
    if (typeof original !== 'function') continue;
    statement[method] = function patched(...args: unknown[]) {
      if (method === 'pluck' || method === 'raw') return (original as (...a: unknown[]) => unknown).apply(this, args);
      const t0 = process.hrtime.bigint();
      const result = (original as (...a: unknown[]) => unknown).apply(this, args);
      e.execMs += Number(process.hrtime.bigint() - t0) / 1e6;
      e.execs += 1;
      if (Array.isArray(result)) e.rows += result.length;
      return result;
    };
  }
  return statement;
} as never;

async function main(): Promise<void> {
  const { buildIdeaGraph, buildIdeaGraphOverview } = await import('../electron/graph/graphService');
  const { getAcademicHomeStats } = await import('../electron/db/homeRepo');
  const { getDebates } = await import('../electron/graph/graphService');
  const { buildAuthorDossier } = await import('../electron/ai/authorDossier');
  const { buildReadingPath } = await import('../electron/graph/graphService');

  const target = process.env.BENCH_TARGET ?? 'graph';
  const run = async () => {
    if (target === 'overview') return buildIdeaGraphOverview();
    if (target === 'home') return getAcademicHomeStats();
    if (target === 'debates') return getDebates();
    if (target === 'author') return buildAuthorDossier(process.env.BENCH_AUTHOR ?? '');
    if (target === 'reading') return buildReadingPath();
    return buildIdeaGraph();
  };

  await run(); // warm the page cache so the numbers describe steady state
  stats.clear();

  const started = process.hrtime.bigint();
  const result = await run();
  const totalMs = Number(process.hrtime.bigint() - started) / 1e6;

  const rows = [...stats.values()].sort((a, b) => b.prepareMs + b.execMs - (a.prepareMs + a.execMs));
  const sqlTotal = rows.reduce((sum, r) => sum + r.prepareMs + r.execMs, 0);

  console.log(`objetivo: ${target}`);
  console.log(`total: ${totalMs.toFixed(0)} ms  ·  en SQL: ${sqlTotal.toFixed(0)} ms  ·  fuera de SQL (JS): ${(totalMs - sqlTotal).toFixed(0)} ms`);
  const nodes = (result as { nodes?: unknown[] }).nodes?.length;
  const edges = (result as { edges?: unknown[] }).edges?.length;
  if (nodes !== undefined) console.log(`grafo devuelto: ${nodes} nodos, ${edges} aristas`);
  console.log();
  console.log(`${'prepare'.padStart(9)}  ${'exec'.padStart(9)}  ${'n'.padStart(4)}  ${'filas'.padStart(7)}  sql`);
  console.log('-'.repeat(120));
  for (const r of rows.slice(0, 15)) {
    console.log(
      `${r.prepareMs.toFixed(1).padStart(7)}ms  ${r.execMs.toFixed(1).padStart(7)}ms  ${String(r.execs).padStart(4)}  ${String(r.rows).padStart(7)}  ${r.sql.slice(0, 96)}`
    );
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
