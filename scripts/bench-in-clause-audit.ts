// Sweeps every read-only IPC channel and reports the SQL statements that bind a
// corpus-sized `IN (?,?,…)` list.
//
// There are ~127 places that build such a list. Almost all of them bind a handful
// of ids and are entirely fine; the ones that matter bind thousands, because SQLite
// then drives the join from the id list and the cost grows with ids × rows. Rather
// than guess which is which, this runs the real handlers against a real vault and
// lets the database say.
import Database from 'better-sqlite3';
import { HANDLERS } from 'electron';
import { registerIpc } from '../electron/ipc';

/** A statement is interesting past this many placeholders. */
const PLACEHOLDER_FLOOR = 64;

interface Hit {
  sql: string;
  placeholders: number;
  ms: number;
  channels: Set<string>;
}

const hits = new Map<string, Hit>();
let currentChannel = '';

function placeholderRun(sql: string): number {
  let longest = 0;
  for (const match of sql.matchAll(/\?(\s*,\s*\?)+/g)) longest = Math.max(longest, (match[0].match(/\?/g) ?? []).length);
  return longest;
}

const proto = Database.prototype as unknown as { prepare: (sql: string) => unknown };
const originalPrepare = proto.prepare;
proto.prepare = function patchedPrepare(sql: string) {
  const statement = originalPrepare.call(this, sql) as Record<string, unknown>;
  const placeholders = placeholderRun(sql);
  if (placeholders < PLACEHOLDER_FLOOR) return statement;
  const shape = sql.replace(/\s+/g, ' ').trim().replace(/\?(\s*,\s*\?)+/g, `?×${placeholders}`);
  for (const method of ['all', 'get', 'run'] as const) {
    const original = statement[method];
    if (typeof original !== 'function') continue;
    statement[method] = function patched(...args: unknown[]) {
      const started = process.hrtime.bigint();
      const result = (original as (...a: unknown[]) => unknown).apply(this, args);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const hit = hits.get(shape) ?? { sql: shape, placeholders, ms: 0, channels: new Set<string>() };
      hit.ms += ms;
      hit.placeholders = Math.max(hit.placeholders, placeholders);
      hit.channels.add(currentChannel);
      hits.set(shape, hit);
      return result;
    };
  }
  return statement;
} as never;

/** Verbs that change something, cost money, or start a job. Never swept. */
const UNSAFE =
  /(create|update|delete|remove|merge|import|export|apply|restore|clear|prune|start|stop|pause|resume|retry|cancel|kill|install|download|scan|rescan|embed|summar|synthes|analy|generate|reprocess|seed|demo|save|set|move|rename|reorder|enqueue|open|login|logout|upload|write|send|process|deepen|convert|record|transcribe|translate|chat|research|suggest|improve|verify|decompose|map|route|tutor|draft|compose|ask|answer|question)/i;
const READ = /(:list|:get$|:count|:status|:tree|:aggregate|health|overview|facets|snapshot|:all|:detail|:stats|:summary|:page)/i;

async function main(): Promise<void> {
  registerIpc(() => null as never, async () => ({ status: 'idle' }) as never, () => undefined);

  const channels = [...HANDLERS.keys()].filter((c) => READ.test(c) && !UNSAFE.test(c)).sort();
  console.log(`barriendo ${channels.length} canales de lectura de ${HANDLERS.size}\n`);

  let ran = 0;
  for (const channel of channels) {
    currentChannel = channel;
    try {
      await HANDLERS.get(channel)!({} as never);
      ran += 1;
    } catch {
      // Most skipped channels simply require an argument this sweep has no value for.
    }
  }
  console.log(`ejecutados sin argumentos: ${ran}\n`);

  const rows = [...hits.values()].sort((a, b) => b.ms - a.ms);
  if (rows.length === 0) {
    console.log(`Ninguna sentencia ató ${PLACEHOLDER_FLOOR}+ parametros en estos canales.`);
    return;
  }
  console.log(`${'parametros'.padStart(11)}  ${'ms'.padStart(9)}  canal / sql`);
  console.log('-'.repeat(110));
  for (const row of rows) {
    console.log(`${String(row.placeholders).padStart(11)}  ${row.ms.toFixed(1).padStart(7)}ms  ${[...row.channels].join(', ')}`);
    console.log(`${' '.repeat(23)}${row.sql.slice(0, 84)}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
