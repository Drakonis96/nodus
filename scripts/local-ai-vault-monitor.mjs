// Read-only monitor for a running validation vault: works, queue and graph counts.
// Run under Electron-as-Node so better-sqlite3 matches the app ABI:
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/local-ai-vault-monitor.mjs <vaultDir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const vaultRoot = process.argv[2] ?? 'C:\\Users\\Usuario\\AppData\\Roaming\\Nodus\\vaults';
const target = fs.existsSync(path.join(vaultRoot, 'nodus.sqlite'))
  ? path.join(vaultRoot, 'nodus.sqlite')
  : (() => {
    const entries = fs.readdirSync(vaultRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(vaultRoot, entry.name, 'nodus.sqlite')))
      .map((entry) => ({ dir: path.join(vaultRoot, entry.name, 'nodus.sqlite'), mtime: fs.statSync(path.join(vaultRoot, entry.name, 'nodus.sqlite')).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!entries.length) throw new Error(`No vault databases under ${vaultRoot}`);
    return entries[0].dir;
  })();

const db = new Database(target, { readonly: true, fileMustExist: true });
try {
  console.log(`database: ${target}`);
  const works = db.prepare('SELECT nodus_id, title, light_status, deep_status, summary_status FROM works ORDER BY rowid').all();
  for (const work of works) {
    const ideas = db.prepare('SELECT COUNT(*) AS n FROM idea_occurrences WHERE nodus_id = ?').get(work.nodus_id);
    console.log(`${String(work.title).slice(0, 58).padEnd(60)} light=${work.light_status} deep=${work.deep_status} summary=${work.summary_status} ideas=${ideas.n}`);
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const [label, table] of [['queue', 'analysis_queue'], ['ideas', 'ideas'], ['evidence', 'evidence'], ['relations', 'edges'], ['themes', 'themes'], ['docprofiles', 'document_profile_state'], ['ideavec', 'idea_embeddings'], ['passages', 'passages'], ['logs', 'pipeline_logs']]) {
    if (!tables.includes(table)) continue;
    try {
      const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
      console.log(`${label}: ${count.n}`);
    } catch (error) {
      console.log(`${label}: (${error.message})`);
    }
  }
} finally {
  db.close();
}
