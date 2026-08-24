/** Export three persisted reports for blind, read-only A/B comparison. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const dbPath = path.resolve(arg('--db', '/Users/jorgepb96/Library/Application Support/nodus/nodus.sqlite'));
const outDir = path.resolve(arg('--out', 'reports/deep-research-professional/historical'));
const benchmarks = [
  { id: 'cfbcca6f-e067-4501-b790-be9a9ad74956', topic: 'tourism-apparatus' },
  { id: 'ab1512f8-14f6-40df-904a-0c1916a6a0bc', topic: 'visual-modernity' },
  { id: '1084ade7-8883-417d-acd8-2c9a3549d58d', topic: 'rural-coercion' },
];
const before = fs.statSync(dbPath);
const Database = require('better-sqlite3');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const get = db.prepare('SELECT id,title,brief_json,draft_json,model_json,updated_at FROM writing_saved_drafts WHERE id=?');
fs.mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const benchmark of benchmarks) {
  const row = get.get(benchmark.id);
  assert.ok(row, `Missing benchmark ${benchmark.id}`);
  const draft = JSON.parse(row.draft_json);
  const brief = JSON.parse(row.brief_json);
  const model = row.model_json ? JSON.parse(row.model_json) : null;
  const body = String(draft.draftMarkdown ?? '').split(/^##\s+(?:Referencias|References)\s*$/mu)[0];
  const words = body.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').split(/\s+/u).filter(Boolean).length;
  const sections = [...body.matchAll(/^##\s+/gmu)].length;
  const report = {
    draft,
    meta: {
      deepResearchVersion: 'v1',
      sections,
      words,
      pages: Math.max(1, Math.round(words / 450)),
      ideasCovered: draft.stats?.selectedIdeas ?? 0,
      ideasConsidered: draft.stats?.selectedIdeas ?? 0,
      worksCited: draft.stats?.selectedWorks ?? draft.bibliography?.length ?? 0,
      stoppedReason: null,
    },
  };
  const payload = {
    metrics: { label: benchmark.topic, topic: benchmark.topic, objective: brief.objective, model, historical: true },
    report,
  };
  fs.writeFileSync(path.join(outDir, `${benchmark.topic}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  manifest.push({ ...benchmark, title: row.title, objective: brief.objective, model, updatedAt: row.updated_at });
}
db.close();
const after = fs.statSync(dbPath);
assert.deepEqual(
  { dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs },
  { dev: before.dev, ino: before.ino, size: before.size, mtimeMs: before.mtimeMs },
);
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify({ sourceUnchanged: true, benchmarks: manifest }, null, 2)}\n`);
console.log(JSON.stringify({ outDir, sourceUnchanged: true, benchmarks: manifest.map(({ topic, objective }) => ({ topic, objective })) }, null, 2));
