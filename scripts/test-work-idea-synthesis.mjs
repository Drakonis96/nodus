import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-work-idea-synthesis-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-work-idea-synthesis.mjs'), '--electron-work-idea-synthesis-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-work-idea-synthesis-test-'));
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'work-idea-synthesis.sqlite'));
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE works (nodus_id TEXT PRIMARY KEY)');
  db.exec(await migration25Sql());

  assert.equal(tableExists(db, 'work_idea_synthesis'), true);
  db.prepare('INSERT INTO works (nodus_id) VALUES (?)').run('work-1');
  db.prepare(
    `INSERT INTO work_idea_synthesis (
      nodus_id, thesis, remember_json, positioning, fingerprint, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run('work-1', 'Tesis', '["uno"]', 'Posicionamiento', 'abc', new Date().toISOString());
  assert.equal(count(db, 'work_idea_synthesis'), 1);
  db.prepare('DELETE FROM works WHERE nodus_id = ?').run('work-1');
  assert.equal(count(db, 'work_idea_synthesis'), 0);

  const dedupeSource = await readFile(path.join(repoRoot, 'electron/db/dedupe.ts'), 'utf8');
  assert.match(dedupeSource, /'work_idea_synthesis'/, 'dedupe merge should repoint work idea syntheses');

  db.close();
  console.log('work idea synthesis cache migration test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function migration25Sql() {
  const source = await readFile(path.join(repoRoot, 'electron/db/migrations.ts'), 'utf8');
  const match = source.match(/version:\s*25,\s*up:\s*\/\*\s*sql\s*\*\/\s*`([\s\S]*?)`\s*,\s*}\s*,/);
  assert.ok(match?.[1], 'Could not find migration 25 SQL');
  return match[1];
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}
