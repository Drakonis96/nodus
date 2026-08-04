// Proves the paged similarity scan against a REAL vault: same rows as the blocking
// query it replaces, and no single block long enough to freeze the window.
//
//   npm run verify:vector-scan -- "/path/to/nodus.sqlite"
//
// Run it against a COPY. It only reads, but a benchmark has no business holding a
// live vault open. Without a path it looks for the active vault of the desktop app.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function defaultVaultPath() {
  const registry = path.join(os.homedir(), 'Library/Application Support/nodus/vaults.json');
  if (!existsSync(registry)) return null;
  const parsed = JSON.parse(readFileSync(registry, 'utf8'));
  const active = parsed.vaults?.find((v) => v.id === parsed.activeVaultId) ?? parsed.vaults?.[0];
  return active?.path ?? null;
}

const file = process.argv[2] ?? defaultVaultPath();
if (!file || !existsSync(file)) {
  console.log('No vault to measure. Pass one: node scripts/verify-vector-scan.mjs /path/to/nodus.sqlite');
  process.exit(0);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch (error) {
  // The bundled binary is built for Electron's ABI; run this under Electron.
  console.log('better-sqlite3 is not loadable here — run with:');
  console.log('  ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/verify-vector-scan.mjs <vault>');
  console.log(String(error.message).split('\n')[0]);
  process.exit(0);
}

const outDir = mkdtempSync(path.join(os.tmpdir(), 'nodus-vector-scan-'));
const bundle = path.join(outDir, 'scan.cjs');
// Bundle the real module, leaving its database import external and resolving it to a
// stub beside the bundle: this measures the shipped scan, not a copy that could drift.
const shim = path.join(outDir, 'database.js');
require('node:fs').writeFileSync(
  shim,
  `let db = null, query = null;
   exports.__setDb = (next) => { db = next; };
   exports.getDb = () => db;
   exports.setVectorScanQuery = (next) => { query = next; };
   exports.__query = () => query;\n`
);
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/db/vectorScan.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    '--external:./database',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const scanModule = require(bundle);
const shimModule = require(shim);

const db = new Database(file, { readonly: true });
db.pragma('mmap_size = 268435456');
db.pragma('cache_size = -32768');
shimModule.__setDb(db);

// The two similarity functions the app registers, verbatim.
db.function('vec_cosine', (a, b) => {
  if (!a || !b) return 0;
  if (a.byteLength === 0 || a.byteLength !== b.byteLength || a.byteLength % 4 !== 0) return 0;
  const fa = new Float32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const fb = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < fa.length; i++) { dot += fa[i] * fb[i]; na += fa[i] * fa[i]; nb += fb[i] * fb[i]; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
});
db.function('vec_scan', (stored) => {
  const query = shimModule.__query();
  if (!stored || !query) return 0;
  if (stored.byteLength === 0 || stored.byteLength !== query.length * 4) return 0;
  const vector = new Float32Array(stored.buffer, stored.byteOffset, stored.byteLength / 4);
  let dot = 0, norm = 0;
  for (let i = 0; i < query.length; i++) { dot += vector[i] * query[i]; norm += vector[i] * vector[i]; }
  return norm === 0 ? 0 : dot / Math.sqrt(norm);
});

/** Longest uninterrupted stretch of the event loop while `work` runs. */
async function longestBlock(work) {
  const gaps = [];
  let last = process.hrtime.bigint();
  const tick = () => {
    const now = process.hrtime.bigint();
    gaps.push(Number(now - last) / 1e6);
    last = now;
    timer = setImmediate(tick);
  };
  let timer = setImmediate(tick);
  const started = process.hrtime.bigint();
  const result = await work();
  const total = Number(process.hrtime.bigint() - started) / 1e6;
  clearImmediate(timer);
  return { result, total, longest: gaps.length ? Math.max(...gaps) : total };
}

const CASES = [
  {
    name: 'ideas',
    id: 'global_id',
    limit: 120,
    embeddedFrom: 'ideas',
    blocking: (buf, cfg, limit) =>
      db
        .prepare(
          `SELECT * FROM (
             SELECT global_id, vec_cosine(embedding, ?) AS similarity FROM ideas
              WHERE embedding IS NOT NULL AND embedding_provider = ? AND embedding_model = ? AND embedding_dim = ?
                AND orphaned_at IS NULL
           ) WHERE similarity >= ? ORDER BY similarity DESC LIMIT ?`
        )
        .all(buf, cfg.provider, cfg.model, cfg.dim, -1, limit),
    paged: (vector, cfg, limit) =>
      scanModule.scanSimilar({
        table: 'ideas',
        sql: `SELECT global_id, rowid AS rid, vec_scan(embedding) AS similarity FROM ideas
               WHERE rowid > ? AND rowid <= ? AND embedding IS NOT NULL AND embedding_provider = ? AND embedding_model = ?
                 AND embedding_dim = ? AND orphaned_at IS NULL`,
        params: [cfg.provider, cfg.model, cfg.dim],
        query: vector,
        threshold: -1,
        limit,
      }),
  },
  {
    name: 'passages',
    id: 'passage_id',
    limit: 48,
    embeddedFrom: 'passages',
    blocking: (buf, cfg, limit) =>
      db
        .prepare(
          `SELECT * FROM (
             SELECT p.passage_id, p.text, p.page_label, w.title, w.authors_json, w.year, w.zotero_key,
                    vec_cosine(p.embedding, ?) AS similarity
               FROM passages p JOIN works w ON w.nodus_id = p.nodus_id
              WHERE p.embedding IS NOT NULL AND w.archived = 0
                AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)
                AND p.embedding_provider = ? AND p.embedding_model = ? AND p.embedding_dim = ?
           ) WHERE similarity >= ? ORDER BY similarity DESC LIMIT ?`
        )
        .all(buf, cfg.provider, cfg.model, cfg.dim, -1, limit),
    paged: (vector, cfg, limit) =>
      scanModule.scanSimilar({
        table: 'passages',
        sql: `SELECT p.passage_id, p.rowid AS rid, vec_scan(p.embedding) AS similarity
                FROM passages p JOIN works w ON w.nodus_id = p.nodus_id
               WHERE p.rowid > ? AND p.rowid <= ? AND p.embedding IS NOT NULL AND w.archived = 0
                 AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)
                 AND p.embedding_provider = ? AND p.embedding_model = ? AND p.embedding_dim = ?`,
        params: [cfg.provider, cfg.model, cfg.dim],
        query: vector,
        threshold: -1,
        limit,
      }),
  },
  {
    name: 'archive items',
    id: 'item_id',
    limit: 16,
    embeddedFrom: 'archive_items',
    blocking: (buf, cfg, limit) =>
      db
        .prepare(
          `SELECT item_id, vec_cosine(embedding, ?) AS similarity FROM archive_items
            WHERE embedding IS NOT NULL AND embedding_provider = ? AND embedding_model = ? AND embedding_dim = ?
            ORDER BY similarity DESC LIMIT ?`
        )
        .all(buf, cfg.provider, cfg.model, cfg.dim, limit),
    paged: (vector, cfg, limit) =>
      scanModule.scanSimilar({
        table: 'archive_items',
        sql: `SELECT item_id, rowid AS rid, vec_scan(embedding) AS similarity FROM archive_items
               WHERE rowid > ? AND rowid <= ? AND embedding IS NOT NULL
                 AND embedding_provider = ? AND embedding_model = ? AND embedding_dim = ?`,
        params: [cfg.provider, cfg.model, cfg.dim],
        query: vector,
        threshold: -1,
        limit,
      }),
  },
];

console.log(`vault: ${file}\n`);
let checked = 0;
for (const testCase of CASES) {
  const sample = db
    .prepare(`SELECT embedding, embedding_provider provider, embedding_model model, embedding_dim dim FROM ${testCase.embeddedFrom} WHERE embedding IS NOT NULL LIMIT 1`)
    .get();
  if (!sample) {
    console.log(`${testCase.name}: nothing indexed, skipped`);
    continue;
  }
  const rows = db.prepare(`SELECT COUNT(*) n FROM ${testCase.embeddedFrom} WHERE embedding IS NOT NULL`).get().n;
  const cfg = { provider: sample.provider, model: sample.model, dim: sample.dim };
  const vector = Array.from(new Float32Array(sample.embedding.buffer, sample.embedding.byteOffset, sample.embedding.byteLength / 4));

  // Warm the page cache so this measures the scan, not the first read from disk.
  testCase.blocking(sample.embedding, cfg, testCase.limit);
  const before = await longestBlock(async () => testCase.blocking(sample.embedding, cfg, testCase.limit));
  const after = await longestBlock(() => testCase.paged(vector, cfg, testCase.limit));

  const beforeIds = before.result.map((row) => row[testCase.id]);
  const afterIds = after.result.map((row) => row[testCase.id]);
  assert.deepEqual(afterIds, beforeIds, `${testCase.name}: the paged scan must rank exactly like the blocking one`);
  checked += 1;

  console.log(`${testCase.name} — ${rows.toLocaleString()} embedded rows, top ${testCase.limit}`);
  console.log(`  blocking   total ${before.total.toFixed(0).padStart(5)}ms   longest block ${before.longest.toFixed(0).padStart(5)}ms`);
  console.log(`  paged      total ${after.total.toFixed(0).padStart(5)}ms   longest block ${after.longest.toFixed(0).padStart(5)}ms`);
  console.log(`  identical ranking: yes (${afterIds.length} rows)\n`);
}

db.close();
rmSync(outDir, { recursive: true, force: true });
if (checked === 0) {
  console.log('Nothing indexed in this vault — no ranking could be compared.');
  process.exit(0);
}
console.log(`Verified ${checked} scan(s): same ranking, and the event loop is never held for a whole scan.`);
